(() => {
"use strict";
/*
 * Deterministic world geometry and interaction projection for AI Agent Village.
 * This module has no DOM, timers, network calls, or random values. It can run
 * in Node tests and in the browser with the same inputs and outputs.
 */

const ROOM_IDS = Object.freeze([
  "town-square",
  "mission-control",
  "research-library",
  "workshop",
  "review-room",
  "ai-academy",
  "archive",
]);

const ROOM_META = Object.freeze({
  "town-square": { label: "Town Square", ko: "타운 스퀘어", purpose: "에이전트와 사용자의 현재 상황을 모읍니다.", x: 2, y: 2, width: 16, height: 10, color: "#dbeafe", anchors: { "collab-table": { id: "collab-table", x: 10, y: 7, kind: "table" }, "handoff-desk": { id: "handoff-desk", x: 14, y: 7, kind: "desk" }, "north-door": { id: "north-door", x: 10, y: 2, kind: "door" } }, slots: [{ x: 8, y: 7 }, { x: 12, y: 7 }, { x: 10, y: 5 }, { x: 10, y: 9 }] },
  "mission-control": { label: "Mission Control", ko: "미션 컨트롤", purpose: "목표, 작업, 실행 큐를 확인합니다.", x: 20, y: 2, width: 16, height: 10, color: "#ede9fe", anchors: { "command-desk": { id: "command-desk", x: 28, y: 7, kind: "desk" }, "north-door": { id: "north-door", x: 28, y: 2, kind: "door" } }, slots: [{ x: 25, y: 7 }, { x: 31, y: 7 }, { x: 28, y: 5 }, { x: 28, y: 9 }] },
  "research-library": { label: "Research Library", ko: "리서치 라이브러리", purpose: "검색·자료·근거를 다룹니다.", x: 38, y: 2, width: 16, height: 10, color: "#dcfce7", anchors: { "research-desk": { id: "research-desk", x: 46, y: 7, kind: "desk" }, "north-door": { id: "north-door", x: 46, y: 2, kind: "door" } }, slots: [{ x: 43, y: 7 }, { x: 49, y: 7 }, { x: 46, y: 5 }, { x: 46, y: 9 }] },
  workshop: { label: "Workshop", ko: "워크숍", purpose: "도구 실행과 산출물 제작이 일어납니다.", x: 2, y: 16, width: 16, height: 10, color: "#ffedd5", anchors: { "build-bench": { id: "build-bench", x: 10, y: 21, kind: "bench" }, "north-door": { id: "north-door", x: 10, y: 16, kind: "door" } }, slots: [{ x: 8, y: 21 }, { x: 12, y: 21 }, { x: 10, y: 19 }, { x: 10, y: 23 }] },
  "review-room": { label: "Review Room", ko: "리뷰 룸", purpose: "검토, 승인, 사용자 입력 요청을 모읍니다.", x: 20, y: 16, width: 16, height: 10, color: "#fee2e2", anchors: { "review-desk": { id: "review-desk", x: 28, y: 21, kind: "desk" }, "north-door": { id: "north-door", x: 28, y: 16, kind: "door" } }, slots: [{ x: 25, y: 21 }, { x: 31, y: 21 }, { x: 28, y: 19 }, { x: 28, y: 23 }] },
  "ai-academy": { label: "AI Academy", ko: "AI 아카데미", purpose: "학습 기록과 재사용 가능한 지식을 모읍니다.", x: 38, y: 16, width: 16, height: 10, color: "#fef3c7", anchors: { "lesson-board": { id: "lesson-board", x: 46, y: 21, kind: "board" }, "north-door": { id: "north-door", x: 46, y: 16, kind: "door" } }, slots: [{ x: 43, y: 21 }, { x: 49, y: 21 }, { x: 46, y: 19 }, { x: 46, y: 23 }] },
  archive: { label: "Archive", ko: "아카이브", purpose: "완료된 작업과 이벤트 기록을 보관합니다.", x: 48, y: 29, width: 14, height: 5, color: "#e2e8f0", anchors: { "archive-shelf": { id: "archive-shelf", x: 55, y: 31, kind: "shelf" }, "north-door": { id: "north-door", x: 55, y: 29, kind: "door" } }, slots: [{ x: 52, y: 31 }, { x: 58, y: 31 }, { x: 55, y: 30 }] },
});

function cellKey(cell) {
  return `${Number(cell.x)},${Number(cell.y)}`;
}

function makeBlockedCells() {
  const cells = [];
  for (let x = 0; x < 64; x += 1) {
    cells.push({ x, y: 0 }, { x, y: 35 });
  }
  for (let y = 1; y < 35; y += 1) {
    cells.push({ x: 0, y }, { x: 63, y });
  }
  // Furniture collision cells. Anchors remain on the walkable side of each item.
  for (const room of Object.values(ROOM_META)) {
    const desk = Object.values(room.anchors).find((anchor) => ["desk", "bench", "board", "shelf"].includes(anchor.kind));
    if (!desk) continue;
    cells.push({ x: desk.x, y: desk.y - 1 }, { x: desk.x - 1, y: desk.y - 1 }, { x: desk.x + 1, y: desk.y - 1 });
  }
  return Object.freeze(cells);
}

const WORLD_MAP = Object.freeze({
  width: 64,
  height: 36,
  tileSize: 16,
  rooms: ROOM_META,
  blocked: makeBlockedCells(),
});

function getRoom(roomId) {
  return ROOM_META[String(roomId)] || null;
}

function normalizeCell(value) {
  if (!value || !Number.isFinite(Number(value.x)) || !Number.isFinite(Number(value.y))) return null;
  return { x: Math.round(Number(value.x)), y: Math.round(Number(value.y)) };
}

function isSameCell(left, right) {
  return Boolean(left && right && Number(left.x) === Number(right.x) && Number(left.y) === Number(right.y));
}

function isWalkable(value, map = WORLD_MAP, options = {}) {
  const cell = normalizeCell(value);
  if (!cell || cell.x < 1 || cell.y < 1 || cell.x >= map.width - 1 || cell.y >= map.height - 1) return false;
  const blocked = options.blockedSet || new Set((map.blocked || []).map(cellKey));
  if (blocked.has(cellKey(cell))) return false;
  return true;
}

function heuristic(left, right) {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}

function aStar(startValue, goalValue, map = WORLD_MAP, options = {}) {
  const start = normalizeCell(startValue);
  const goal = normalizeCell(goalValue);
  if (!start || !goal) return null;
  const blockedSet = options.blockedSet || new Set([
    ...(map.blocked || []).map(cellKey),
    ...((options.blocked || []).map(normalizeCell).filter(Boolean).map(cellKey)),
  ]);
  if (!isWalkable(start, map, { blockedSet }) || !isWalkable(goal, map, { blockedSet })) return null;
  if (isSameCell(start, goal)) return [start];

  const directions = Object.freeze([{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }]);
  const open = [{ cell: start, g: 0, h: heuristic(start, goal), order: 0 }];
  const cameFrom = new Map();
  const bestG = new Map([[cellKey(start), 0]]);
  let order = 1;

  while (open.length) {
    open.sort((left, right) => (left.g + left.h) - (right.g + right.h) || left.h - right.h || left.order - right.order);
    const current = open.shift();
    if (isSameCell(current.cell, goal)) {
      const path = [current.cell];
      let cursor = cellKey(current.cell);
      while (cameFrom.has(cursor)) {
        const previous = cameFrom.get(cursor);
        path.push(previous);
        cursor = cellKey(previous);
      }
      return path.reverse();
    }
    for (const direction of directions) {
      const neighbor = { x: current.cell.x + direction.x, y: current.cell.y + direction.y };
      const key = cellKey(neighbor);
      if (!isWalkable(neighbor, map, { blockedSet })) continue;
      const candidateG = current.g + 1;
      if (candidateG >= (bestG.get(key) ?? Infinity)) continue;
      cameFrom.set(key, current.cell);
      bestG.set(key, candidateG);
      open.push({ cell: neighbor, g: candidateG, h: heuristic(neighbor, goal), order });
      order += 1;
    }
  }
  return null;
}

function roomAnchor(roomId, anchorId) {
  const room = getRoom(roomId);
  if (!room) return null;
  const anchors = Object.values(room.anchors);
  const anchor = room.anchors[anchorId] || anchors[0];
  return anchor ? { x: anchor.x, y: anchor.y, id: anchor.id, kind: anchor.kind, roomId } : null;
}

function defaultAnchorId(roomId) {
  const room = getRoom(roomId);
  if (!room) return null;
  return Object.values(room.anchors).find((anchor) => anchor.kind !== "door")?.id || Object.values(room.anchors)[0]?.id || null;
}

function assignRoomSlots(agents, roomId, anchorId = defaultAnchorId(roomId)) {
  const room = getRoom(roomId);
  if (!room) return {};
  const list = Array.isArray(agents) ? agents.slice().sort((left, right) => String(left.id).localeCompare(String(right.id))) : [];
  const anchor = room.anchors[anchorId] || room.anchors[defaultAnchorId(roomId)] || Object.values(room.anchors)[0];
  const slots = room.slots?.length ? room.slots : [{ x: anchor.x, y: anchor.y }];
  const result = {};
  list.forEach((agent, index) => {
    const slot = slots[index % slots.length];
    result[String(agent.id)] = { x: slot.x, y: slot.y, roomId, anchorId: anchor.id, slotIndex: index };
  });
  return result;
}

function agentStartCell(agent) {
  return normalizeCell(agent?.position) || roomAnchor(agent?.roomId || "town-square") || { x: 2, y: 2 };
}

function createIntent(agent, target, reason, interactionId, map) {
  if (!agent || !target) return null;
  const start = agentStartCell(agent);
  const path = aStar(start, target, map);
  return {
    agentId: String(agent.id),
    fromRoomId: agent.roomId || null,
    fromAnchorId: agent.anchorId || null,
    toRoomId: target.roomId,
    toAnchorId: target.anchorId || null,
    target: { x: target.x, y: target.y },
    path,
    reason: String(reason || "event movement"),
    interactionId: interactionId || null,
  };
}

function deriveMovementIntents(event, agents = [], map = WORLD_MAP) {
  if (!event || typeof event !== "object") return [];
  const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
  const list = Array.isArray(agents) ? agents : [];
  const byId = new Map(list.map((agent) => [String(agent.id), agent]));
  const getAgent = (id) => byId.get(String(id));
  const intentForRoom = (agent, roomId, anchorId, reason, interactionId, targetOverride) => {
    if (!agent || !getRoom(roomId)) return null;
    const anchor = targetOverride || roomAnchor(roomId, anchorId || defaultAnchorId(roomId));
    return createIntent(agent, { ...anchor, roomId, anchorId: anchor.id }, reason, interactionId, map);
  };

  if (event.type === "MOVEMENT_INTENT") {
    const agent = getAgent(payload.agentId || event.agentId);
    if (!agent) return [];
    const target = normalizeCell(payload.target) || roomAnchor(payload.toRoomId, payload.toAnchorId || defaultAnchorId(payload.toRoomId));
    if (!target) return [];
    const generated = createIntent(agent, { ...target, roomId: payload.toRoomId || agent.roomId, anchorId: payload.toAnchorId || target.id }, payload.reason || "explicit movement", payload.interactionId, map);
    if (Array.isArray(payload.path) && payload.path.length) generated.path = payload.path.map(normalizeCell).filter(Boolean);
    return generated ? [generated] : [];
  }

  if (event.type === "MESSAGE_CREATED" && !["collaboration", "handoff"].includes(payload.channel)) return [];

  if (["AGENT_STATUS_CHANGED", "RUN_STARTED", "TASK_COMPLETED"].includes(event.type)) {
    const agent = getAgent(payload.agentId || event.agentId);
    const roomId = payload.nextRoomId || payload.roomId || event.roomId;
    const state = String(payload.state || event.state || "").toUpperCase();
    const fallbackRoom = roomId || ({ RESEARCHING: "research-library", WORKING: "workshop", PLANNING: "mission-control", WAITING: "review-room", REVIEWING: "review-room", LEARNING: "ai-academy", DONE: "archive" }[state] || (event.type === "TASK_COMPLETED" ? "archive" : agent?.roomId) || "town-square");
    const roomPeers = list.filter((item) => String(item.roomId || "") === String(fallbackRoom));
    const slotMap = roomPeers.length && getRoom(fallbackRoom) ? assignRoomSlots(roomPeers, fallbackRoom, payload.anchorId || defaultAnchorId(fallbackRoom)) : {};
    const targetSlot = slotMap[String(agent?.id)] || null;
    const intent = intentForRoom(agent, fallbackRoom, payload.anchorId, payload.reason || (event.type === "TASK_COMPLETED" ? "task completed" : `status ${state || "changed"}`), payload.interactionId, targetSlot ? { ...targetSlot, id: payload.anchorId || defaultAnchorId(fallbackRoom), kind: "slot" } : undefined);
    return intent ? [intent] : [];
  }

  if (event.type === "HANDOFF_COMPLETED") {
    const agent = getAgent(payload.targetAgentId);
    const intent = intentForRoom(agent, payload.nextRoomId || agent?.roomId || "workshop", payload.nextAnchorId, "handoff received", payload.interactionId);
    return intent ? [intent] : [];
  }

  if (event.type === "COLLABORATION_STARTED") {
    const participantIds = [...new Set((payload.participantAgentIds || payload.participants || []).map(String))].sort();
    const participantAgents = participantIds.map(getAgent).filter(Boolean);
    const roomId = payload.roomId || "town-square";
    const anchorId = payload.anchorId || "collab-table";
    const slots = assignRoomSlots(participantAgents, roomId, anchorId);
    return participantAgents.map((agent) => {
      const slot = slots[String(agent.id)];
      const intent = intentForRoom(agent, roomId, anchorId, `collaboration ${payload.topic || "gather"}`, payload.interactionId, { ...slot, id: anchorId, kind: "table" });
      return intent;
    }).filter(Boolean);
  }

  if (event.type === "HANDOFF_STARTED") {
    const interactionId = payload.interactionId;
    const roomId = payload.roomId || "town-square";
    const anchorId = payload.handoffAnchorId || "handoff-desk";
    return [payload.sourceAgentId, payload.targetAgentId].map((id) => {
      const agent = getAgent(id);
      return intentForRoom(agent, roomId, anchorId, `handoff ${payload.artifactId || "artifact"}`, interactionId);
    }).filter(Boolean).sort((left, right) => left.agentId.localeCompare(right.agentId));
  }

  if (["REVIEW_REQUESTED", "USER_INPUT_REQUIRED"].includes(event.type)) {
    const agent = getAgent(payload.agentId || event.agentId);
    const intent = intentForRoom(agent, payload.roomId || "review-room", payload.anchorId || "review-desk", event.type === "REVIEW_REQUESTED" ? "review requested" : "user input required", payload.interactionId);
    return intent ? [intent] : [];
  }
  return [];
}

function reduceInteraction(previous = {}, event = {}) {
  const state = previous && typeof previous === "object" ? previous : {};
  const interactions = { ...(state.interactions || {}) };
  const artifacts = { ...(state.artifacts || {}) };
  const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
  const interactionId = payload.interactionId || event.interactionId || event.id;
  if (!interactionId) return { ...state, interactions, artifacts };
  const current = { ...(interactions[interactionId] || { id: interactionId }) };

  if (event.type === "COLLABORATION_STARTED") {
    interactions[interactionId] = { ...current, kind: "collaboration", phase: "gathering", participantAgentIds: [...new Set((payload.participantAgentIds || []).map(String))], topic: payload.topic || "", startedAt: event.createdAt || null };
  } else if (event.type === "COLLABORATION_ENDED") {
    interactions[interactionId] = { ...current, phase: "completed", outcome: payload.outcome || "completed", endedAt: event.createdAt || null };
  } else if (event.type === "HANDOFF_STARTED") {
    interactions[interactionId] = { ...current, kind: "handoff", phase: "approach", sourceAgentId: payload.sourceAgentId || null, targetAgentId: payload.targetAgentId || null, artifactId: payload.artifactId || null, summary: payload.summary || "", startedAt: event.createdAt || null };
    if (payload.artifactId) artifacts[payload.artifactId] = { ...(artifacts[payload.artifactId] || { id: payload.artifactId }), id: payload.artifactId, sourceAgentId: payload.sourceAgentId || null, targetAgentId: payload.targetAgentId || null, status: "IN_TRANSIT" };
  } else if (event.type === "ARTIFACT_CARRIED") {
    const artifactId = payload.artifactId || current.artifactId;
    interactions[interactionId] = { ...current, phase: payload.stage === "picked-up" ? "carrying" : payload.stage === "placed" ? "transfer" : "transfer", artifactStage: payload.stage || "in-transit" };
    if (artifactId) artifacts[artifactId] = { ...(artifacts[artifactId] || { id: artifactId }), id: artifactId, carrierAgentId: payload.carrierAgentId || null, status: String(payload.stage || "in-transit").toUpperCase() };
  } else if (event.type === "HANDOFF_COMPLETED") {
    const artifactId = payload.artifactId || current.artifactId;
    interactions[interactionId] = { ...current, phase: "completed", outcome: payload.outcome || "transferred", completedAt: event.createdAt || null, nextRoomId: payload.nextRoomId || null };
    if (artifactId) artifacts[artifactId] = { ...(artifacts[artifactId] || { id: artifactId }), id: artifactId, ownerAgentId: payload.targetAgentId || null, carrierAgentId: null, status: "TRANSFERRED" };
  } else if (event.type === "REVIEW_REQUESTED") {
    interactions[interactionId] = { ...current, kind: "review", phase: "review", reviewId: payload.reviewId || event.reviewId || null, agentId: payload.agentId || event.agentId || null, artifactIds: payload.artifactIds || (payload.artifactId ? [payload.artifactId] : []), summary: payload.summary || "", startedAt: event.createdAt || null };
  } else if (event.type === "USER_INPUT_REQUIRED") {
    interactions[interactionId] = { ...current, kind: "user-input", phase: "waiting", agentId: payload.agentId || event.agentId || null, question: payload.question || payload.reason || "", blocking: payload.blocking !== false, startedAt: event.createdAt || null };
  } else if (["REVIEW_APPROVED", "REVIEW_REJECTED"].includes(event.type)) {
    const reviewId = payload.reviewId || event.reviewId || null;
    const matchingId = interactionId && interactions[interactionId] ? interactionId : Object.keys(interactions).find((id) => interactions[id]?.kind === "review" && ((reviewId && interactions[id].reviewId === reviewId) || (payload.artifactId && (interactions[id].artifactIds || []).map(String).includes(String(payload.artifactId)))));
    if (matchingId) interactions[matchingId] = { ...interactions[matchingId], phase: event.type === "REVIEW_APPROVED" ? "completed" : "rejected", outcome: event.type === "REVIEW_APPROVED" ? "approved" : "changes requested", endedAt: event.createdAt || null };
  } else if (event.type === "USER_INPUT_RESOLVED") {
    const matchingId = interactionId && interactions[interactionId] ? interactionId : Object.keys(interactions).find((id) => interactions[id]?.kind === "user-input" && String(interactions[id].agentId || "") === String(payload.agentId || event.agentId || ""));
    if (matchingId) interactions[matchingId] = { ...interactions[matchingId], phase: "resolved", resolvedAt: event.createdAt || null };
  }
  return { ...state, interactions, artifacts };
}

function summarizeBubble(value) {
  const compact = String(value ?? "활동 기록").replace(/\s+/g, " ").trim() || "활동 기록";
  return compact.length > 60 ? `${compact.slice(0, 59)}…` : compact;
}

const exported = { WORLD_MAP, ROOM_IDS, ROOM_META, getRoom, isWalkable, aStar, assignRoomSlots, roomAnchor, deriveMovementIntents, reduceInteraction, summarizeBubble, cellKey };
if (typeof module !== "undefined") module.exports = exported;
if (typeof window !== "undefined") window.AiVillagePixelModel = exported;
})();
