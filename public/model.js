(() => {
"use strict";
/* AI Agent Village is a projection of recorded semantic events, never a fake activity generator. */
const PIXEL_MODEL = (() => {
  if (typeof require === "function") {
    try { return require("./pixel-world-model.js"); } catch { /* browser bundle or optional module */ }
  }
  return typeof window !== "undefined" ? window.AiVillagePixelModel || null : null;
})();
const AGENT_STATES = Object.freeze([
  "IDLE", "THINKING", "PLANNING", "WALKING", "RESEARCHING", "WORKING", "COLLABORATING",
  "WAITING", "BLOCKED", "REVIEWING", "LEARNING", "DELIVERING", "DONE", "ERROR", "OFFLINE",
]);

const VILLAGE_ROOMS = Object.freeze([
  { id: "town-square", label: "Town Square", ko: "타운 스퀘어", purpose: "에이전트와 사용자의 현재 상황을 모읍니다." },
  { id: "mission-control", label: "Mission Control", ko: "미션 컨트롤", purpose: "목표, 작업, 실행 큐를 확인합니다." },
  { id: "research-library", label: "Research Library", ko: "리서치 라이브러리", purpose: "검색·자료·근거를 다룹니다." },
  { id: "workshop", label: "Workshop", ko: "워크숍", purpose: "도구 실행과 산출물 제작이 일어납니다." },
  { id: "review-room", label: "Review Room", ko: "리뷰 룸", purpose: "검토, 승인, 사용자 입력 요청을 모읍니다." },
  { id: "ai-academy", label: "AI Academy", ko: "AI 아카데미", purpose: "학습 기록과 재사용 가능한 지식을 모읍니다." },
  { id: "archive", label: "Archive", ko: "아카이브", purpose: "완료된 작업과 이벤트 기록을 보관합니다." },
]);

const ROOM_FOR_STATE = Object.freeze({
  IDLE: "town-square",
  THINKING: "mission-control",
  PLANNING: "mission-control",
  WALKING: "town-square",
  RESEARCHING: "research-library",
  WORKING: "workshop",
  COLLABORATING: "town-square",
  WAITING: "review-room",
  BLOCKED: "review-room",
  REVIEWING: "review-room",
  LEARNING: "ai-academy",
  DELIVERING: "archive",
  DONE: "archive",
  ERROR: "review-room",
  OFFLINE: "town-square",
});

const IMPORTANT_EVENT_TYPES = new Set([
  "PROJECT_CREATED", "TASK_CREATED", "AGENT_REGISTERED", "AGENT_STATUS_CHANGED", "RUN_STARTED", "RUN_FINISHED",
  "TOOL_CALL_STARTED", "TOOL_CALL_FINISHED", "MESSAGE_CREATED", "HANDOFF_CREATED", "ARTIFACT_CREATED",
  "REVIEW_REQUESTED", "REVIEW_COMMENTED", "REVIEW_APPROVED", "REVIEW_REJECTED", "TASK_COMPLETED",
  "USER_INPUT_REQUIRED", "USER_INPUT_RESOLVED", "ERROR_REPORTED", "MOVEMENT_INTENT", "POSITION_REACHED",
  "COLLABORATION_STARTED", "COLLABORATION_ENDED", "HANDOFF_STARTED", "HANDOFF_COMPLETED", "ARTIFACT_CARRIED",
]);

const EVENT_LABELS = Object.freeze({
  PROJECT_CREATED: "프로젝트 생성",
  TASK_CREATED: "작업 생성",
  AGENT_REGISTERED: "에이전트 등록",
  AGENT_STATUS_CHANGED: "상태 변경",
  RUN_STARTED: "실행 시작",
  RUN_FINISHED: "실행 종료",
  TOOL_CALL_STARTED: "도구 실행",
  TOOL_CALL_FINISHED: "도구 완료",
  MESSAGE_CREATED: "메시지",
  HANDOFF_CREATED: "핸드오프",
  ARTIFACT_CREATED: "산출물 생성",
  REVIEW_REQUESTED: "리뷰 요청",
  REVIEW_COMMENTED: "리뷰 코멘트",
  REVIEW_APPROVED: "리뷰 승인",
  REVIEW_REJECTED: "리뷰 반려",
  TASK_COMPLETED: "작업 완료",
  USER_INPUT_REQUIRED: "사용자 입력 필요",
  USER_INPUT_RESOLVED: "사용자 입력 해결",
  ERROR_REPORTED: "오류",
  MOVEMENT_INTENT: "이동 시작",
  POSITION_REACHED: "위치 도착",
  COLLABORATION_STARTED: "협업 시작",
  COLLABORATION_ENDED: "협업 종료",
  HANDOFF_STARTED: "핸드오프 시작",
  HANDOFF_COMPLETED: "핸드오프 완료",
  ARTIFACT_CARRIED: "산출물 이동",
});

const ACTIVE_STATES = new Set([
  "THINKING", "PLANNING", "WALKING", "RESEARCHING", "WORKING", "COLLABORATING", "WAITING", "BLOCKED", "REVIEWING", "LEARNING", "DELIVERING", "ERROR",
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function normalizeState(value) {
  const state = text(value, "OFFLINE").trim().toUpperCase();
  return AGENT_STATES.includes(state) ? state : "OFFLINE";
}

function roomForState(state) {
  return ROOM_FOR_STATE[normalizeState(state)] || "town-square";
}

function finiteCounter(value) {
  if (!value || typeof value !== "object") return null;
  const current = Number(value.current);
  const total = Number(value.total);
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0 || current < 0 || current > total) return null;
  return { current, total, unit: text(value.unit, "items") };
}

function eventBody(event) {
  const payload = event && event.payload && typeof event.payload === "object" ? event.payload : {};
  return event?.body || event?.summary || payload.summary || payload.body || payload.label || payload.message || event?.type || "활동 기록";
}

function summarizeWorldMessage(input) {
  const value = typeof input === "string" ? input : eventBody(input);
  const compact = text(value, "활동 기록").replace(/\s+/g, " ").trim() || "활동 기록";
  return compact.length > 60 ? `${compact.slice(0, 59)}…` : compact;
}

function eventProjectMatches(event, projectId) {
  return !projectId || !event?.projectId || String(event.projectId) === String(projectId);
}

function entityProjectMatches(entity, projectId, taskIds = new Set()) {
  return !projectId || !entity?.projectId || String(entity.projectId) === String(projectId) || taskIds.has(String(entity.currentTaskId || entity.taskId));
}

function latestForAgent(events, agentId) {
  const relevant = events.filter((event) => String(event.agentId || event.payload?.agentId || "") === String(agentId));
  return relevant.length ? relevant[relevant.length - 1] : null;
}

function projectWorld(events, agents, artifacts) {
  const interactionSeed = { interactions: {}, artifacts: Object.fromEntries(asArray(artifacts).map((artifact) => [String(artifact.id), { ...artifact }])) };
  const interactionState = events.reduce((world, event) => PIXEL_MODEL?.reduceInteraction ? PIXEL_MODEL.reduceInteraction(world, event) : world, interactionSeed);
  const movementIntents = [];
  if (PIXEL_MODEL?.deriveMovementIntents) {
    for (const event of events) {
      const intents = PIXEL_MODEL.deriveMovementIntents(event, agents);
      for (const intent of intents) movementIntents.push({ ...intent, eventId: event.id || null, eventType: event.type, createdAt: event.createdAt || null });
    }
  }
  const latestMovement = new Map();
  for (const intent of movementIntents) latestMovement.set(String(intent.agentId), intent);
  for (const event of events) {
    if (event.type === "POSITION_REACHED") latestMovement.delete(String(event.agentId || event.payload?.agentId || ""));
  }
  const visualStates = new Map();
  for (const interaction of Object.values(interactionState.interactions || {})) {
    if (["gathering", "talking"].includes(interaction.phase)) {
      for (const id of interaction.participantAgentIds || []) visualStates.set(String(id), "COLLABORATING");
    }
    if (["approach", "carrying", "transfer"].includes(interaction.phase)) {
      if (interaction.sourceAgentId) visualStates.set(String(interaction.sourceAgentId), interaction.phase === "transfer" ? "TALKING" : "CARRYING");
      if (interaction.targetAgentId && interaction.phase === "transfer") visualStates.set(String(interaction.targetAgentId), "TALKING");
    }
    if (interaction.phase === "waiting" && interaction.agentId) visualStates.set(String(interaction.agentId), "WAITING");
  }
  const worldAgents = agents.map((agent) => {
    const anchor = PIXEL_MODEL?.roomAnchor?.(agent.roomId) || { x: 2, y: 2, id: null };
    const movement = latestMovement.get(String(agent.id)) || null;
    const location = movement?.target ? { x: movement.target.x, y: movement.target.y } : { x: anchor.x, y: anchor.y };
    return { ...agent, visualState: visualStates.get(String(agent.id)) || agent.state, location, anchorId: movement?.toAnchorId || anchor.id || null, movement };
  });
  return {
    mapVersion: "v1",
    lastEventId: events.length ? events[events.length - 1].id || null : null,
    movementIntents,
    interactions: interactionState.interactions || {},
    artifacts: interactionState.artifacts || {},
    agents: worldAgents,
  };
}

function buildVillageView(rawState = {}, options = {}) {
  const state = rawState && typeof rawState === "object" ? rawState : {};
  const projects = asArray(state.projects);
  const requestedProjectId = options.projectId || state.selectedProjectId || null;
  const projectId = requestedProjectId || (projects.length === 1 ? projects[0].id : null);
  const project = projects.find((item) => String(item.id) === String(projectId)) || (projectId ? null : projects[projects.length - 1] || null);
  const scopedProjectId = project?.id || projectId || null;
  const allTasks = asArray(state.tasks);
  const tasks = allTasks.filter((task) => !scopedProjectId || !task.projectId || String(task.projectId) === String(scopedProjectId));
  const taskIds = new Set(tasks.map((task) => String(task.id)));
  const events = asArray(state.events).filter((event) => eventProjectMatches(event, scopedProjectId));
  let agents = asArray(state.agents)
    .filter((agent) => entityProjectMatches(agent, scopedProjectId, taskIds))
    .map((agent, index) => {
      const latest = latestForAgent(events, agent.id);
      const payload = latest?.payload && typeof latest.payload === "object" ? latest.payload : {};
      const projectedState = normalizeState(agent.state || agent.status);
      const stateValue = projectedState === "DONE" ? "DONE" : normalizeState(payload.state || latest?.state || projectedState);
      const taskId = payload.taskId || latest?.taskId || agent.currentTaskId || null;
      const task = tasks.find((item) => String(item.id) === String(taskId));
      const roomId = payload.roomId || latest?.roomId || agent.roomId || roomForState(stateValue);
      const history = events.filter((event) => String(event.agentId || event.payload?.agentId || "") === String(agent.id));
      const latestMessage = history.slice().reverse().find((event) => event.type === "MESSAGE_CREATED" || event.payload?.worldSummary);
      const handoffs = events.filter((event) => event.type === "HANDOFF_CREATED" && (String(event.payload?.fromAgentId || event.payload?.toAgentId || "") === String(agent.id)));
      const collaborators = [...new Set(handoffs.flatMap((event) => [event.payload?.fromAgentId, event.payload?.toAgentId]).filter((id) => id && String(id) !== String(agent.id)).map(String))];
      const conversationIds = [...new Set(asArray(state.messages).filter((message) => String(message.senderAgentId || message.agentId || "") === String(agent.id)).map((message) => message.conversationId).filter(Boolean).map(String))];
      const artifactIds = new Set(asArray(state.artifacts).filter((artifact) => String(artifact.ownerAgentId || artifact.agentId || "") === String(agent.id)).map((artifact) => String(artifact.id)));
      const artifactViews = asArray(state.artifacts).filter((artifact) => artifactIds.has(String(artifact.id)) || String(artifact.ownerAgentId || artifact.agentId || "") === String(agent.id));
      const counter = finiteCounter(payload.counter || latest?.counter || agent.counter);
      const needsUser = tasks.filter((item) => String(item.ownerAgentId || item.assigneeId || "") === String(agent.id) && (item.needsUser || item.status === "WAITING" || item.status === "BLOCKED"));
      return {
        id: text(agent.id, `agent-${index + 1}`),
        name: text(agent.name || agent.displayName, `Agent ${index + 1}`),
        provider: text(agent.provider, "Provider 미기록"),
        role: text(agent.role, "Agent"),
        model: text(agent.model, "Model 미기록"),
        state: stateValue,
        roomId: VILLAGE_ROOMS.some((room) => room.id === roomId) ? roomId : roomForState(stateValue),
        currentTaskId: taskId,
        currentTask: task?.title || text(agent.currentTask, ""),
        currentGoal: text(agent.currentGoal || project?.goal, ""),
        progress: counter,
        worldSummary: summarizeWorldMessage(latestMessage || latest || agent.worldSummary || "대기 중 · 저장된 이벤트 없음"),
        collaborators,
        dependencies: tasks.filter((item) => String(item.ownerAgentId || item.assigneeId || "") === String(agent.id)).flatMap((item) => asArray(item.dependencies || item.dependencyIds).map((dep, depIndex) => typeof dep === "object" ? dep : { id: `${item.id}-dependency-${depIndex + 1}`, label: dep, status: "PENDING", taskId: item.id })),
        inputs: asArray(agent.inputs).map(String),
        outputs: asArray(agent.outputs).map(String),
        artifacts: artifactViews,
        conversationIds,
        activityHistory: history.slice(-8).reverse(),
        needsUser,
        fullContent: latest?.fullContent || payload.fullContent || agent.fullContent || "",
      };
    });

  const worldArtifactSeed = asArray(state.artifacts).filter((artifact) => !scopedProjectId || !artifact.projectId || String(artifact.projectId) === String(scopedProjectId) || taskIds.has(String(artifact.taskId)));
  const world = projectWorld(events, agents, worldArtifactSeed);
  agents = world.agents;

  const scopedArtifacts = asArray(state.artifacts).filter((artifact) => !scopedProjectId || !artifact.projectId || String(artifact.projectId) === String(scopedProjectId) || taskIds.has(String(artifact.taskId)));
  const artifactIds = new Set(scopedArtifacts.map((artifact) => String(artifact.id)));
  const reviews = asArray(state.reviews).filter((review) => !scopedProjectId || !review.projectId || String(review.projectId) === String(scopedProjectId) || artifactIds.has(String(review.artifactId)));
  const dependencies = tasks.flatMap((task) => asArray(task.dependencies || task.dependencyIds).map((item, index) => {
    const value = typeof item === "object" ? item : { label: item };
    return { id: text(value.id, `${task.id}-dependency-${index + 1}`), taskId: task.id, label: text(value.label || value.name, "Dependency"), status: text(value.status, "PENDING"), reason: text(value.reason, ""), projectId: task.projectId };
  }));
  const conversations = asArray(state.conversations).filter((conversation) => !scopedProjectId || !conversation.projectId || String(conversation.projectId) === String(scopedProjectId)).map((conversation) => ({
    ...conversation,
    messages: asArray(state.messages).filter((message) => String(message.conversationId) === String(conversation.id)).map((message) => ({ ...message, senderName: agents.find((agent) => String(agent.id) === String(message.senderAgentId || message.agentId))?.name || message.senderName || "Participant", fullContent: text(message.fullContent || message.body || message.content, "") })),
  }));
  const agentById = new Map(agents.map((agent) => [String(agent.id), agent]));
  const eventFeed = events.filter((event) => IMPORTANT_EVENT_TYPES.has(event.type)).slice().reverse().map((event, index) => {
    const agentId = event.agentId || event.payload?.agentId || event.payload?.ownerAgentId || null;
    const agent = agentById.get(String(agentId));
    const eventState = normalizeState(event.payload?.state || event.state || agent?.state || "OFFLINE");
    return {
      id: text(event.id, `event-${index + 1}`),
      type: text(event.type, "EVENT"),
      title: EVENT_LABELS[event.type] || text(event.type, "이벤트"),
      body: summarizeWorldMessage(event),
      fullContent: text(event.fullContent || event.payload?.fullContent, ""),
      createdAt: event.createdAt || event.timestamp || null,
      agentId: agent?.id || agentId,
      agentName: agent?.name || text(event.agentName || agentId, "System"),
      roomId: event.payload?.roomId || event.roomId || agent?.roomId || roomForState(eventState),
      state: eventState,
      simulation: Boolean(event.simulation),
      raw: event.raw || null,
    };
  });

  const needsUser = [];
  for (const task of tasks) {
    if (task.needsUser || task.status === "WAITING" || task.status === "BLOCKED") needsUser.push({ taskId: task.id, agentId: task.ownerAgentId || task.assigneeId || null, reason: text(task.needsUserReason || task.reason, "사용자 입력이 필요합니다.") });
  }
  for (const event of events) {
    if (event.type === "USER_INPUT_REQUIRED") needsUser.push({ taskId: event.taskId || event.payload?.taskId || null, agentId: event.agentId || event.payload?.agentId || null, reason: text(event.reason || event.payload?.reason || eventBody(event), "사용자 입력이 필요합니다."), eventId: event.id });
  }
  const dedupedNeeds = [...new Map(needsUser.map((item) => [`${item.taskId || ""}:${item.agentId || ""}:${item.reason}`, item])).values()];
  const rooms = VILLAGE_ROOMS.map((room) => {
    const occupants = agents.filter((agent) => agent.roomId === room.id).map((agent) => agent.id);
    return { ...room, occupants, activeCount: occupants.filter((id) => ACTIVE_STATES.has(agentById.get(String(id))?.state)).length };
  });
  const activeAgents = agents.filter((agent) => ACTIVE_STATES.has(agent.state));
  return {
    project,
    projectId: scopedProjectId,
    rooms,
    agents,
    tasks: tasks.map((task) => ({ ...task, ownerName: agentById.get(String(task.ownerAgentId || task.assigneeId))?.name || "미배정" })),
    artifacts: scopedArtifacts,
    reviews,
    dependencies,
    conversations,
    eventFeed,
    needsUser: dedupedNeeds,
    summary: {
      totalAgents: agents.length,
      activeAgents: activeAgents.length,
      needsUser: dedupedNeeds.length,
      eventCount: events.length,
      artifactCount: scopedArtifacts.length,
      taskCount: tasks.length,
      progress: null,
    },
    world,
    source: text(state.source, "local"),
    simulationOnly: events.length > 0 && events.every((event) => Boolean(event.simulation)),
  };
}

const exported = { AGENT_STATES, VILLAGE_ROOMS, ROOM_FOR_STATE, EVENT_LABELS, buildVillageView, summarizeWorldMessage, normalizeState, roomForState };
if (typeof module !== "undefined") module.exports = exported;
if (typeof window !== "undefined") window.AiVillageModel = exported;
})();
