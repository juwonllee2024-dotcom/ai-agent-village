const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { AGENT_STATES, normalizeState, roomForState } = require("./public/model.js");
const { normalizeProviderEnvelope } = require("./provider-adapter.js");

const EVENT_TYPES = new Set([
  "PROJECT_CREATED", "TASK_CREATED", "AGENT_REGISTERED", "AGENT_STATUS_CHANGED", "RUN_STARTED", "RUN_FINISHED",
  "TOOL_CALL_STARTED", "TOOL_CALL_FINISHED", "MESSAGE_CREATED", "HANDOFF_CREATED", "ARTIFACT_CREATED",
  "REVIEW_REQUESTED", "REVIEW_COMMENTED", "REVIEW_APPROVED", "REVIEW_REJECTED", "TASK_COMPLETED",
  "USER_INPUT_REQUIRED", "USER_INPUT_RESOLVED", "ERROR_REPORTED", "MOVEMENT_INTENT", "POSITION_REACHED",
  "COLLABORATION_STARTED", "COLLABORATION_ENDED", "HANDOFF_STARTED", "HANDOFF_COMPLETED", "ARTIFACT_CARRIED",
]);
const SECRET_KEY = /(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization|cookie|private[_-]?key)/i;
const PRIVATE_REASONING_KEY = /(chain[_-]?of[_-]?thought|chainOfThought|reasoning|thoughts?)/i;
const MAX_BODY_BYTES = 1024 * 1024;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function valueText(value, fallback = "") {
  return value === null || value === undefined ? fallback : String(value);
}

function hasSecretKey(value, parentKey = "") {
  if (parentKey && SECRET_KEY.test(parentKey)) return true;
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => hasSecretKey(item));
  return Object.entries(value).some(([key, item]) => hasSecretKey(item, key));
}

function hasPrivateReasoning(value, parentKey = "") {
  if (parentKey && PRIVATE_REASONING_KEY.test(parentKey)) return true;
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => hasPrivateReasoning(item));
  return Object.entries(value).some(([key, item]) => hasPrivateReasoning(item, key));
}

function validateEvent(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Event must be a JSON object");
  if (typeof input.type !== "string" || !EVENT_TYPES.has(input.type)) throw new Error(`Unsupported event type: ${valueText(input.type, "missing")}`);
  if (hasSecretKey(input)) throw new Error("Secrets and browser credentials cannot be stored in the event log");
  if (hasPrivateReasoning(input)) throw new Error("Private chain-of-thought/reasoning cannot be stored in the event log");
  if (input.payload !== undefined && (!input.payload || typeof input.payload !== "object" || Array.isArray(input.payload))) throw new Error("payload must be an object");
  if (input.createdAt !== undefined && Number.isNaN(Date.parse(input.createdAt))) throw new Error("createdAt must be an ISO date");
  if (input.type === "AGENT_STATUS_CHANGED" || input.type === "RUN_STARTED") {
    const requestedState = input.state || input.payload?.state;
    if (requestedState && !AGENT_STATES.includes(String(requestedState).toUpperCase())) throw new Error(`Unsupported agent state: ${requestedState}`);
  }
  return {
    ...clone(input),
    type: input.type,
    payload: clone(input.payload || {}),
  };
}

function createInitialState() {
  return {
    version: 2,
    source: "local",
    sequence: 0,
    projects: [],
    agents: [],
    tasks: [],
    artifacts: [],
    reviews: [],
    conversations: [],
    messages: [],
    handoffs: [],
    movementIntents: [],
    interactions: {},
    events: [],
  };
}

function upsert(list, id, create) {
  const existing = list.find((item) => String(item.id) === String(id));
  if (existing) return existing;
  const item = create();
  list.push(item);
  return item;
}

function projectIdFor(event) {
  return event.projectId || event.payload?.projectId || null;
}

function agentIdFor(event) {
  return event.agentId || event.payload?.agentId || event.payload?.senderAgentId || event.payload?.sourceAgentId || event.payload?.carrierAgentId || null;
}

function taskIdFor(event) {
  return event.taskId || event.payload?.taskId || null;
}

function applyEvent(state, event) {
  const payload = event.payload || {};
  const projectId = projectIdFor(event);
  const agentId = agentIdFor(event);
  const taskId = taskIdFor(event);
  switch (event.type) {
    case "PROJECT_CREATED": {
      const id = valueText(projectId || payload.id, `project-${state.sequence}`);
      const project = upsert(state.projects, id, () => ({ id }));
      Object.assign(project, { id, name: valueText(payload.name || payload.title, id), goal: valueText(payload.goal || payload.objective, ""), createdAt: event.createdAt, source: event.source, simulation: Boolean(event.simulation) });
      break;
    }
    case "AGENT_REGISTERED": {
      const id = valueText(agentId || payload.id, `agent-${state.sequence}`);
      const agent = upsert(state.agents, id, () => ({ id }));
      const stateValue = normalizeState(payload.state || payload.status || "OFFLINE");
      Object.assign(agent, { id, projectId, name: valueText(payload.name || payload.displayName, id), provider: valueText(payload.provider, "Provider 미기록"), role: valueText(payload.role, "Agent"), model: valueText(payload.model, "Model 미기록"), state: stateValue, roomId: payload.roomId || roomForState(stateValue), registeredAt: event.createdAt, source: event.source, simulation: Boolean(event.simulation) });
      break;
    }
    case "AGENT_STATUS_CHANGED": {
      const agent = upsert(state.agents, valueText(agentId, `agent-${state.sequence}`), () => ({ id: valueText(agentId, `agent-${state.sequence}`), name: valueText(agentId, "Agent") }));
      const stateValue = normalizeState(payload.state || event.state || agent.state);
      Object.assign(agent, { projectId: projectId || agent.projectId, state: stateValue, roomId: payload.roomId || event.roomId || roomForState(stateValue), currentTaskId: payload.taskId || agent.currentTaskId || null, statusReason: valueText(payload.reason || event.body, "") });
      break;
    }
    case "MOVEMENT_INTENT": {
      if (!Array.isArray(state.movementIntents)) state.movementIntents = [];
      state.movementIntents.push({ id: event.id, projectId, agentId, ...clone(payload), createdAt: event.createdAt });
      break;
    }
    case "POSITION_REACHED": {
      const agent = state.agents.find((item) => String(item.id) === String(agentId));
      if (agent) Object.assign(agent, { roomId: payload.roomId || agent.roomId, anchorId: payload.anchorId || agent.anchorId || null, position: payload.position || agent.position || null });
      break;
    }
    case "COLLABORATION_STARTED":
    case "COLLABORATION_ENDED":
    case "HANDOFF_STARTED":
    case "HANDOFF_COMPLETED":
    case "ARTIFACT_CARRIED": {
      if (!state.interactions || typeof state.interactions !== "object") state.interactions = {};
      const interactionId = valueText(payload.interactionId || event.interactionId || event.id, event.id);
      state.interactions[interactionId] = { ...(state.interactions[interactionId] || {}), id: interactionId, type: event.type, ...clone(payload), updatedAt: event.createdAt };
      if (event.type === "HANDOFF_COMPLETED" && payload.artifactId) {
        const artifact = state.artifacts.find((item) => String(item.id) === String(payload.artifactId));
        if (artifact) Object.assign(artifact, { ownerAgentId: payload.targetAgentId || artifact.ownerAgentId, status: "TRANSFERRED" });
      }
      break;
    }
    case "RUN_STARTED": {
      const agent = upsert(state.agents, valueText(agentId, `agent-${state.sequence}`), () => ({ id: valueText(agentId, `agent-${state.sequence}`), name: valueText(agentId, "Agent") }));
      const stateValue = normalizeState(payload.state || "WORKING");
      Object.assign(agent, { projectId: projectId || agent.projectId, state: stateValue, roomId: payload.roomId || roomForState(stateValue), currentTaskId: taskId || agent.currentTaskId || null });
      const task = taskId && upsert(state.tasks, taskId, () => ({ id: taskId }));
      if (task) Object.assign(task, { projectId: projectId || task.projectId, status: valueText(payload.taskStatus, "RUNNING"), ownerAgentId: task.ownerAgentId || agent.id });
      break;
    }
    case "RUN_FINISHED": {
      const agent = state.agents.find((item) => String(item.id) === String(agentId));
      if (agent) Object.assign(agent, { state: normalizeState(payload.state || "WAITING"), roomId: payload.roomId || roomForState(payload.state || "WAITING") });
      break;
    }
    case "TASK_CREATED": {
      const id = valueText(taskId || payload.id, `task-${state.sequence}`);
      const task = upsert(state.tasks, id, () => ({ id }));
      Object.assign(task, { id, projectId, title: valueText(payload.title || payload.name, id), detail: valueText(payload.detail || payload.description, ""), status: valueText(payload.status, "TODO").toUpperCase(), ownerAgentId: payload.ownerAgentId || payload.assigneeId || null, dependencyIds: Array.isArray(payload.dependencyIds) ? clone(payload.dependencyIds) : [], dependencies: Array.isArray(payload.dependencies) ? clone(payload.dependencies) : [], needsUser: Boolean(payload.needsUser), needsUserReason: valueText(payload.needsUserReason, "") });
      break;
    }
    case "MESSAGE_CREATED": {
      const conversationId = valueText(payload.conversationId || event.conversationId, `conversation-${state.sequence}`);
      upsert(state.conversations, conversationId, () => ({ id: conversationId, projectId, title: valueText(payload.conversationTitle, "Agent conversation") }));
      state.messages.push({ id: valueText(payload.id || event.messageId, `message-${state.sequence}`), conversationId, projectId, senderAgentId: payload.senderAgentId || agentId, senderName: valueText(payload.senderName || event.agentName, agentId || "Participant"), body: valueText(payload.body || event.body, ""), fullContent: valueText(payload.fullContent || payload.body || event.body, ""), channel: valueText(payload.channel, "quick"), worldSummary: valueText(payload.worldSummary, ""), createdAt: event.createdAt, simulation: Boolean(event.simulation) });
      break;
    }
    case "HANDOFF_CREATED":
      state.handoffs.push({ id: valueText(payload.id || event.id, `handoff-${state.sequence}`), projectId, taskId, fromAgentId: payload.fromAgentId || agentId, toAgentId: payload.toAgentId || null, label: valueText(payload.label || event.body, "Handoff"), createdAt: event.createdAt, simulation: Boolean(event.simulation) });
      break;
    case "ARTIFACT_CREATED": {
      const id = valueText(payload.id || event.artifactId, `artifact-${state.sequence}`);
      const artifact = upsert(state.artifacts, id, () => ({ id }));
      Object.assign(artifact, { id, projectId, taskId, ownerAgentId: payload.ownerAgentId || agentId, name: valueText(payload.name || payload.filename, id), kind: valueText(payload.kind, "artifact"), path: valueText(payload.path, ""), status: valueText(payload.status, "CREATED").toUpperCase(), createdAt: event.createdAt, simulation: Boolean(event.simulation) });
      break;
    }
    case "REVIEW_REQUESTED": {
      const id = valueText(payload.reviewId || event.reviewId, `review-${state.sequence}`);
      const review = upsert(state.reviews, id, () => ({ id, comments: [] }));
      Object.assign(review, { id, projectId, artifactId: payload.artifactId || event.artifactId || null, taskId, reviewerAgentId: payload.reviewerAgentId || null, status: "PENDING", requestedAt: event.createdAt, simulation: Boolean(event.simulation) });
      const reviewAgent = state.agents.find((item) => String(item.id) === String(agentId));
      if (reviewAgent) Object.assign(reviewAgent, { state: "REVIEWING", roomId: payload.roomId || "review-room" });
      break;
    }
    case "REVIEW_COMMENTED": {
      const review = state.reviews.find((item) => String(item.id) === String(payload.reviewId || event.reviewId));
      if (review) review.comments = [...(review.comments || []), { body: valueText(payload.body || event.body, ""), createdAt: event.createdAt, authorAgentId: agentId }];
      break;
    }
    case "REVIEW_APPROVED":
    case "REVIEW_REJECTED": {
      const review = state.reviews.find((item) => String(item.id) === String(payload.reviewId || event.reviewId));
      if (review) review.status = event.type === "REVIEW_APPROVED" ? "APPROVED" : "REJECTED";
      const artifact = state.artifacts.find((item) => String(item.id) === String(payload.artifactId || event.artifactId));
      if (artifact) artifact.status = event.type === "REVIEW_APPROVED" ? "APPROVED" : "CHANGES_REQUESTED";
      break;
    }
    case "TASK_COMPLETED": {
      const task = state.tasks.find((item) => String(item.id) === String(taskId));
      if (task) Object.assign(task, { status: "DONE", completedAt: event.createdAt, needsUser: false });
      const matchingAgents = state.agents.filter((item) => String(item.id) === String(agentId || task?.ownerAgentId) || (taskId && String(item.currentTaskId) === String(taskId)));
      for (const agent of matchingAgents) Object.assign(agent, { state: "DONE", roomId: "archive", currentTaskId: taskId || agent.currentTaskId });
      break;
    }
    case "USER_INPUT_REQUIRED": {
      const task = taskId && state.tasks.find((item) => String(item.id) === String(taskId));
      if (task) Object.assign(task, { status: "WAITING", needsUser: true, needsUserReason: valueText(payload.reason || event.reason || event.body, "사용자 입력이 필요합니다.") });
      const agent = state.agents.find((item) => String(item.id) === String(agentId));
      if (agent) Object.assign(agent, { state: "WAITING", roomId: "review-room", currentTaskId: taskId || agent.currentTaskId });
      break;
    }
    case "USER_INPUT_RESOLVED": {
      const task = taskId && state.tasks.find((item) => String(item.id) === String(taskId));
      if (task) Object.assign(task, { needsUser: false, needsUserReason: "", status: valueText(payload.status, task.status === "WAITING" ? "RUNNING" : task.status).toUpperCase() });
      break;
    }
    case "ERROR_REPORTED": {
      const agent = state.agents.find((item) => String(item.id) === String(agentId));
      if (agent) Object.assign(agent, { state: "ERROR", roomId: "review-room", statusReason: valueText(payload.reason || event.body, "오류") });
      break;
    }
    case "TOOL_CALL_STARTED":
    case "TOOL_CALL_FINISHED": {
      const agent = state.agents.find((item) => String(item.id) === String(agentId));
      if (agent && payload.state) Object.assign(agent, { state: normalizeState(payload.state), roomId: payload.roomId || roomForState(payload.state), currentTaskId: taskId || agent.currentTaskId });
      break;
    }
    default:
      break;
  }
}

function appendEvent(state, input) {
  const incoming = validateEvent(input);
  if (incoming.id && state.events.some((event) => String(event.id) === String(incoming.id))) throw new Error(`Duplicate event id: ${incoming.id}`);
  state.sequence += 1;
  const event = {
    ...incoming,
    id: valueText(incoming.id, `event-${state.sequence}`),
    sequence: state.sequence,
    projectId: projectIdFor(incoming),
    agentId: agentIdFor(incoming),
    taskId: taskIdFor(incoming),
    createdAt: incoming.createdAt || new Date().toISOString(),
    source: valueText(incoming.source, "local"),
    simulation: Boolean(incoming.simulation),
    payload: clone(incoming.payload || {}),
  };
  state.events.push(event);
  applyEvent(state, event);
  return clone(event);
}

function demoEvents(runId) {
  const projectId = `demo-project-${runId}`;
  const taskId = `demo-task-${runId}`;
  const hermesId = `demo-hermes-${runId}`;
  const plannerId = `demo-planner-${runId}`;
  const artifactId = `demo-artifact-${runId}`;
  const reviewId = `demo-review-${runId}`;
  const conversationId = `demo-conversation-${runId}`;
  const base = Date.now();
  const at = (offset) => new Date(base + offset * 1000).toISOString();
  const common = { projectId, simulation: true, source: "local-demo" };
  return [
    { ...common, id: `${runId}-01`, type: "PROJECT_CREATED", createdAt: at(1), payload: { name: "Village Demo Project", goal: "A verified brief from a small agent team" } },
    { ...common, id: `${runId}-02`, type: "AGENT_REGISTERED", createdAt: at(2), agentId: hermesId, payload: { name: "Hermes", provider: "Hermes Gateway (simulation)", role: "Researcher", model: "hermes-local", state: "OFFLINE" } },
    { ...common, id: `${runId}-03`, type: "AGENT_REGISTERED", createdAt: at(3), agentId: plannerId, payload: { name: "Planner", provider: "ChatGPT import (simulation)", role: "Planner", model: "gpt-5.4-mini", state: "IDLE" } },
    { ...common, id: `${runId}-04`, type: "TASK_CREATED", createdAt: at(4), taskId, payload: { title: "Make a sourced one-page brief", detail: "Collect evidence, draft, and request review.", status: "PLANNING", ownerAgentId: plannerId } },
    { ...common, id: `${runId}-05`, type: "AGENT_STATUS_CHANGED", createdAt: at(5), agentId: plannerId, payload: { state: "PLANNING", roomId: "mission-control", taskId } },
    { ...common, id: `${runId}-06`, type: "RUN_STARTED", createdAt: at(6), agentId: plannerId, taskId, payload: { state: "WORKING", roomId: "workshop" } },
    { ...common, id: `${runId}-07`, type: "AGENT_STATUS_CHANGED", createdAt: at(7), agentId: hermesId, taskId, payload: { state: "RESEARCHING", roomId: "research-library", taskId } },
    { ...common, id: `${runId}-08`, type: "COLLABORATION_STARTED", createdAt: at(8), payload: { interactionId: `${runId}-collab`, participantAgentIds: [hermesId, plannerId], roomId: "town-square", anchorId: "collab-table", topic: "Align evidence and brief" } },
    { ...common, id: `${runId}-09`, type: "MESSAGE_CREATED", createdAt: at(9), agentId: hermesId, payload: { conversationId, conversationTitle: "Brief handoff", channel: "collaboration", senderAgentId: hermesId, senderName: "Hermes", body: "I will bring three verified sources." } },
    { ...common, id: `${runId}-10`, type: "MESSAGE_CREATED", createdAt: at(10), agentId: plannerId, payload: { conversationId, conversationTitle: "Brief handoff", channel: "collaboration", senderAgentId: plannerId, senderName: "Planner", body: "I will draft after the evidence arrives." } },
    { ...common, id: `${runId}-11`, type: "COLLABORATION_ENDED", createdAt: at(11), payload: { interactionId: `${runId}-collab`, outcome: "plan aligned" } },
    { ...common, id: `${runId}-12`, type: "TOOL_CALL_STARTED", createdAt: at(12), agentId: hermesId, taskId, body: "Search sources", payload: { state: "RESEARCHING", roomId: "research-library" } },
    { ...common, id: `${runId}-13`, type: "TOOL_CALL_FINISHED", createdAt: at(13), agentId: hermesId, taskId, body: "3 sources recorded", payload: { state: "RESEARCHING", roomId: "research-library", counter: { current: 3, total: 3, unit: "sources" } } },
    { ...common, id: `${runId}-14`, type: "ARTIFACT_CREATED", createdAt: at(14), agentId: hermesId, taskId, artifactId: `${artifactId}-sources`, payload: { id: `${artifactId}-sources`, name: "sources.json", kind: "evidence", path: "demo/sources.json", ownerAgentId: hermesId } },
    { ...common, id: `${runId}-15`, type: "HANDOFF_STARTED", createdAt: at(15), payload: { interactionId: `${runId}-handoff`, sourceAgentId: hermesId, targetAgentId: plannerId, artifactId: `${artifactId}-sources`, artifactName: "sources.json", summary: "3 verified sources" } },
    { ...common, id: `${runId}-16`, type: "ARTIFACT_CARRIED", createdAt: at(16), payload: { interactionId: `${runId}-handoff`, artifactId: `${artifactId}-sources`, carrierAgentId: hermesId, stage: "picked-up" } },
    { ...common, id: `${runId}-17`, type: "ARTIFACT_CARRIED", createdAt: at(17), payload: { interactionId: `${runId}-handoff`, artifactId: `${artifactId}-sources`, carrierAgentId: hermesId, stage: "in-transit" } },
    { ...common, id: `${runId}-18`, type: "HANDOFF_COMPLETED", createdAt: at(18), payload: { interactionId: `${runId}-handoff`, sourceAgentId: hermesId, targetAgentId: plannerId, artifactId: `${artifactId}-sources`, nextRoomId: "workshop", outcome: "received" } },
    { ...common, id: `${runId}-19`, type: "AGENT_STATUS_CHANGED", createdAt: at(19), agentId: hermesId, taskId, payload: { state: "DELIVERING", roomId: "archive", taskId, reason: "Evidence delivered" } },
    { ...common, id: `${runId}-20`, type: "AGENT_STATUS_CHANGED", createdAt: at(20), agentId: plannerId, taskId, payload: { state: "WORKING", roomId: "workshop", taskId } },
    { ...common, id: `${runId}-21`, type: "MESSAGE_CREATED", createdAt: at(21), agentId: plannerId, payload: { conversationId, conversationTitle: "Brief handoff", channel: "quick", senderAgentId: plannerId, senderName: "Planner", body: "Draft is ready for a human check." } },
    { ...common, id: `${runId}-22`, type: "ARTIFACT_CREATED", createdAt: at(22), agentId: plannerId, taskId, artifactId, payload: { id: artifactId, name: "brief.md", kind: "markdown", path: "demo/brief.md", ownerAgentId: plannerId } },
    { ...common, id: `${runId}-23`, type: "REVIEW_REQUESTED", createdAt: at(23), agentId: plannerId, taskId, artifactId, payload: { reviewId, artifactId, reviewerAgentId: plannerId, roomId: "review-room", summary: "Check sources and wording" } },
    { ...common, id: `${runId}-24`, type: "REVIEW_COMMENTED", createdAt: at(24), agentId: plannerId, taskId, body: "Evidence links are present; wording is ready for approval.", payload: { reviewId, body: "Evidence links are present; wording is ready for approval." } },
    { ...common, id: `${runId}-25`, type: "REVIEW_APPROVED", createdAt: at(25), agentId: plannerId, taskId, artifactId, payload: { reviewId, artifactId } },
    { ...common, id: `${runId}-26`, type: "TASK_COMPLETED", createdAt: at(26), agentId: plannerId, taskId, body: "Brief approved and archived", payload: { taskId, artifactId } },
  ];
}

function loadStateFromFile(stateFile) {
  const state = createInitialState();
  if (!stateFile || !fs.existsSync(stateFile)) return state;
  const lines = fs.readFileSync(stateFile, "utf8").split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    try { appendEvent(state, JSON.parse(line)); } catch { /* keep a corrupt line from taking the localhost down */ }
  }
  return state;
}

function persistEvent(stateFile, event) {
  if (!stateFile) return;
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.appendFileSync(stateFile, `${JSON.stringify(event)}\n`, "utf8");
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let total = 0;
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      total += Buffer.byteLength(chunk);
      if (total > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Request body too large"), { statusCode: 413 }));
        request.destroy();
        return;
      }
      body += chunk;
    });
    request.on("end", () => {
      if (!body.trim()) return resolve({});
      try { resolve(JSON.parse(body)); } catch { reject(Object.assign(new Error("Request body must be valid JSON"), { statusCode: 400 })); }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(payload));
}

function mimeType(filePath) {
  return { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon" }[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function createVillageServer({ port = 4988, publicDir = path.join(__dirname, "public"), state, stateFile = null } = {}) {
  const villageState = state || loadStateFromFile(stateFile);
  const root = path.resolve(publicDir);
  const clients = new Set();
  const broadcast = (type, data) => {
    const frame = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const response of clients) {
      try { response.write(frame); } catch { clients.delete(response); }
    }
  };
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const pathname = decodeURIComponent(url.pathname);
    try {
      if (request.method === "GET" && pathname === "/healthz") return sendJson(response, 200, { ok: true, service: "ai-agent-village", mode: "local", version: 1 });
      if (request.method === "GET" && pathname === "/api/state") return sendJson(response, 200, clone(villageState));
      if (request.method === "GET" && pathname === "/api/events") {
        const projectId = url.searchParams.get("projectId");
        const after = Number(url.searchParams.get("after") || 0);
        const events = villageState.events.filter((event) => (!projectId || !event.projectId || String(event.projectId) === String(projectId)) && (!after || event.sequence > after));
        return sendJson(response, 200, { events: clone(events), sequence: villageState.sequence });
      }
      if (request.method === "GET" && pathname === "/api/realtime") {
        response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" });
        response.write(`retry: 2000\nevent: snapshot\ndata: ${JSON.stringify({ state: clone(villageState) })}\n\n`);
        clients.add(response);
        request.on("close", () => clients.delete(response));
        return;
      }
      if (request.method === "POST" && pathname === "/api/events") {
        const input = await readJson(request);
        const event = appendEvent(villageState, input);
        persistEvent(stateFile, event);
        broadcast("semantic", { event, state: clone(villageState) });
        return sendJson(response, 201, { event, sequence: villageState.sequence });
      }
      if (request.method === "POST" && pathname === "/api/ingest") {
        const input = await readJson(request);
        const event = appendEvent(villageState, normalizeProviderEnvelope(input));
        persistEvent(stateFile, event);
        broadcast("semantic", { event, state: clone(villageState) });
        return sendJson(response, 201, { event, sequence: villageState.sequence });
      }
      if (request.method === "POST" && pathname === "/api/demo") {
        const runId = `${Date.now()}-${villageState.sequence + 1}`;
        const created = [];
        for (const input of demoEvents(runId)) {
          const event = appendEvent(villageState, input);
          persistEvent(stateFile, event);
          created.push(event);
          broadcast("semantic", { event, state: clone(villageState) });
          await new Promise((resolve) => setTimeout(resolve, 140));
        }
        broadcast("demo", { simulation: true, events: created, state: clone(villageState) });
        return sendJson(response, 201, { simulation: true, events: created, state: clone(villageState) });
      }
      if (request.method === "GET" || request.method === "HEAD") {
        const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
        const filePath = path.resolve(root, relativePath);
        const relative = path.relative(root, filePath);
        if (relative.startsWith("..") || path.isAbsolute(relative)) return sendJson(response, 404, { error: "Not found" });
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return sendJson(response, 404, { error: "Not found" });
        response.writeHead(200, { "content-type": mimeType(filePath), "cache-control": "no-store" });
        if (request.method === "HEAD") return response.end();
        return fs.createReadStream(filePath).pipe(response);
      }
      return sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      return sendJson(response, error.statusCode || 400, { error: error.message || "Request failed" });
    }
  });
  server.villageState = villageState;
  server.broadcast = broadcast;
  server.port = port;
  server.stateFile = stateFile;
  return server;
}

if (require.main === module) {
  const cliPortIndex = process.argv.indexOf("--port");
  const cliPort = cliPortIndex >= 0 ? Number(process.argv[cliPortIndex + 1]) : Number(process.env.AI_VILLAGE_PORT || 4988);
  const port = Number.isInteger(cliPort) && cliPort > 0 && cliPort < 65536 ? cliPort : 4988;
  const server = createVillageServer({ port, stateFile: path.join(__dirname, "data", "events.jsonl") });
  server.listen(port, "127.0.0.1", () => console.log(`AI Agent Village running at http://127.0.0.1:${port}/`));
}

module.exports = { EVENT_TYPES, createInitialState, validateEvent, appendEvent, createVillageServer, demoEvents, loadStateFromFile };
