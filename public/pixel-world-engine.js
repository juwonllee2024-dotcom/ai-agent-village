(() => {
"use strict";
/* Canvas renderer for AI Agent Village. It consumes immutable view snapshots only. */
const PIXEL = (() => {
  if (typeof require === "function") {
    try { return require("./pixel-world-model.js"); } catch { /* browser */ }
  }
  return typeof window !== "undefined" ? window.AiVillagePixelModel || null : null;
})();

const FALLBACK_MAP = { width: 64, height: 36, tileSize: 16, rooms: {} };
const STATE_COLORS = Object.freeze({
  IDLE: "#64748b", THINKING: "#7c3aed", PLANNING: "#4f46e5", WALKING: "#2563eb", RESEARCHING: "#059669", WORKING: "#ea580c", COLLABORATING: "#0891b2", WAITING: "#ca8a04", BLOCKED: "#dc2626", REVIEWING: "#db2777", LEARNING: "#9333ea", DELIVERING: "#0f766e", DONE: "#475569", ERROR: "#b91c1c", OFFLINE: "#94a3b8", CARRYING: "#0f766e" });
const PROVIDER_COLORS = Object.freeze({ codex: "#2563eb", openai: "#059669", hermes: "#d97706", crew: "#7c3aed", chatgpt: "#0f766e", local: "#475569" });

function compact(value, limit = 60) {
  const result = String(value ?? "").replace(/\s+/g, " ").trim();
  return result.length > limit ? `${result.slice(0, limit - 1)}…` : result;
}

function normalizeCell(value) {
  if (!value || !Number.isFinite(Number(value.x)) || !Number.isFinite(Number(value.y))) return null;
  return { x: Number(value.x), y: Number(value.y) };
}

function colorFor(agent) {
  const provider = String(agent?.provider || "").toLowerCase();
  for (const [key, color] of Object.entries(PROVIDER_COLORS)) if (provider.includes(key)) return color;
  return STATE_COLORS[String(agent?.state || "OFFLINE").toUpperCase()] || "#475569";
}

function createPixelWorldEngine(canvas, options = {}) {
  if (!canvas || typeof canvas.getContext !== "function") throw new Error("A Canvas element is required");
  const ctx = canvas.getContext("2d");
  const map = options.map || PIXEL?.WORLD_MAP || FALLBACK_MAP;
  const speed = Number.isFinite(Number(options.speed)) ? Number(options.speed) : 6;
  const animateInitialPath = options.animateInitialPath === true;
  const reducedMotion = options.reducedMotion ?? (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  const chars = new Map();
  let snapshot = { agents: [], world: { movementIntents: [], interactions: {}, artifacts: {} } };
  let selectedAgentId = null;
  let frameHandle = null;
  let lastFrameTime = null;
  let destroyed = false;

  ctx.imageSmoothingEnabled = false;

  function mapSize() {
    const tile = Number(map.tileSize) || 16;
    return { tile, width: Number(map.width) || 64, height: Number(map.height) || 36 };
  }

  function positionFrom(agent, movement) {
    const path = Array.isArray(movement?.path) ? movement.path.map(normalizeCell).filter(Boolean) : [];
    const location = normalizeCell(agent?.location || agent?.position);
    return path[0] || location || PIXEL?.roomAnchor?.(agent?.roomId) || { x: 2, y: 2 };
  }

  function targetFrom(agent, movement) {
    const path = Array.isArray(movement?.path) ? movement.path.map(normalizeCell).filter(Boolean) : [];
    return normalizeCell(movement?.target) || normalizeCell(agent?.location || agent?.position) || path.at(-1) || positionFrom(agent, movement);
  }

  function movementFor(agent, world) {
    if (agent?.movement && typeof agent.movement === "object") return agent.movement;
    const intents = Array.isArray(world?.movementIntents) ? world.movementIntents : [];
    return intents.slice().reverse().find((intent) => String(intent.agentId) === String(agent?.id)) || null;
  }

  function setSnapshot(next) {
    snapshot = next && typeof next === "object" ? next : { agents: [] };
    const agents = Array.isArray(snapshot.agents) ? snapshot.agents.slice().sort((left, right) => String(left.id).localeCompare(String(right.id))) : [];
    const nextChars = new Map();
    for (const agent of agents) {
      const id = String(agent.id);
      const movement = movementFor(agent, snapshot.world);
      const previous = chars.get(id);
      const path = Array.isArray(movement?.path) ? movement.path.map(normalizeCell).filter(Boolean) : [];
      const target = targetFrom(agent, movement);
      const character = previous || {
        id,
        position: positionFrom(agent, movement),
        pathQueue: [],
        moving: false,
        frame: 0,
        elapsed: 0,
        direction: "down",
        lastMovementEventId: null,
      };
      character.name = String(agent.name || id);
      character.provider = String(agent.provider || "Provider");
      character.role = String(agent.role || "Agent");
      character.state = String(agent.visualState || agent.state || "OFFLINE").toUpperCase();
      character.color = colorFor(agent);
      character.target = target;
      character.worldSummary = compact(agent.worldSummary || "");
      character.bubble = character.worldSummary && character.worldSummary !== "대기 중 · 저장된 이벤트 없음" ? character.worldSummary : "";
      character.carryingArtifactId = null;
      const artifactMap = snapshot.world?.artifacts || {};
      for (const artifact of Object.values(artifactMap)) {
        if (String(artifact?.carrierAgentId || "") === id) { character.carryingArtifactId = String(artifact.id); break; }
      }
      const isNewMovement = movement && movement.eventId && movement.eventId !== character.lastMovementEventId;
      if (isNewMovement || (!previous && path.length && animateInitialPath)) {
        const start = path[0] || character.position;
        if (!previous) character.position = { x: start.x, y: start.y };
        character.pathQueue = path.slice(previous ? 0 : 1);
        if (previous && path.length && !isAdjacent(character.position, path[0])) character.position = { x: path[0].x, y: path[0].y };
        if (previous && path.length && isAdjacent(character.position, path[0])) character.pathQueue = path.slice(1);
        character.moving = character.pathQueue.length > 0;
        character.lastMovementEventId = movement.eventId;
      } else if (!movement && !character.moving) {
        character.position = positionFrom(agent, movement);
        character.target = character.position;
        character.pathQueue = [];
      } else if (!previous) {
        character.position = { x: target.x, y: target.y };
        character.pathQueue = [];
        character.moving = false;
        character.lastMovementEventId = movement?.eventId || null;
      }
      if (reducedMotion) {
        character.position = { x: target.x, y: target.y };
        character.pathQueue = [];
        character.moving = false;
      }
      nextChars.set(id, character);
    }
    chars.clear();
    for (const [id, character] of nextChars) chars.set(id, character);
    render();
  }

  function isAdjacent(left, right) {
    return Boolean(left && right && Math.abs(left.x - right.x) <= 1 && Math.abs(left.y - right.y) <= 1);
  }

  function update(deltaMs = 16) {
    if (destroyed || reducedMotion) return;
    const dt = Math.max(0, Number(deltaMs) || 0);
    const distance = speed * dt / 1000;
    for (const character of chars.values()) {
      character.elapsed += dt;
      if (character.pathQueue.length) {
        let remaining = distance;
        while (remaining > 0 && character.pathQueue.length) {
          const next = character.pathQueue[0];
          const dx = next.x - character.position.x;
          const dy = next.y - character.position.y;
          const length = Math.sqrt(dx * dx + dy * dy) || 1;
          if (length <= remaining) {
            character.position = { x: next.x, y: next.y };
            character.pathQueue.shift();
            remaining -= length;
          } else {
            character.position = { x: character.position.x + (dx / length) * remaining, y: character.position.y + (dy / length) * remaining };
            remaining = 0;
          }
          if (Math.abs(dx) > Math.abs(dy)) character.direction = dx >= 0 ? "right" : "left";
          else if (Math.abs(dy) > 0) character.direction = dy >= 0 ? "down" : "up";
        }
        character.moving = character.pathQueue.length > 0;
        character.frame = Math.floor(character.elapsed / 110) % 4;
      } else {
        character.moving = false;
        character.frame = Math.floor(character.elapsed / 460) % (character.state === "TALKING" || character.state === "COLLABORATING" ? 2 : 2);
      }
    }
    render();
  }

  function drawRoom(room, tile) {
    const x = room.x * tile;
    const y = room.y * tile;
    const width = room.width * tile;
    const height = room.height * tile;
    ctx.fillStyle = room.color || "#e2e8f0";
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = "#94a3b8";
    ctx.strokeRect(x + 1, y + 1, width - 2, height - 2);
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 12px monospace";
    ctx.fillText(room.label || room.id, x + tile, y + tile + 2);
    ctx.font = "10px monospace";
    if (room.ko) ctx.fillText(room.ko, x + tile, y + tile + 15);
    ctx.fillStyle = "#475569";
    ctx.font = "9px monospace";
    ctx.fillText(`${Number(room.occupantCount || 0)} agent${Number(room.occupantCount || 0) === 1 ? "" : "s"}`, x + tile, y + height - tile);
    for (const anchor of Object.values(room.anchors || {})) {
      const ax = anchor.x * tile;
      const ay = anchor.y * tile;
      ctx.fillStyle = anchor.kind === "door" ? "#f8fafc" : "#64748b";
      const size = anchor.kind === "table" ? tile * 2 : tile;
      ctx.fillRect(ax - size / 2, ay - size / 2, size, Math.max(4, tile / 2));
    }
  }

  function drawArtifact(artifact, x, y, tile) {
    ctx.fillStyle = "#f59e0b";
    ctx.fillRect(x - tile * 0.35, y - tile * 0.3, tile * 0.7, tile * 0.6);
    ctx.fillStyle = "#451a03";
    ctx.font = "bold 9px monospace";
    ctx.fillText(compact(artifact.name || artifact.id, 5), x - tile * 0.3, y + 3);
  }

  function drawCharacter(character, tile) {
    const x = character.position.x * tile + tile / 2;
    const y = character.position.y * tile + tile / 2;
    ctx.fillStyle = "rgba(15, 23, 42, 0.16)";
    ctx.fillRect(x - 6, y + 6, 12, 3);
    ctx.fillStyle = character.color;
    ctx.fillRect(x - 5, y - 8, 10, 8);
    ctx.fillRect(x - 7, y, 14, 10);
    const legOffset = character.moving ? (character.frame % 2 ? 2 : -2) : 0;
    ctx.fillRect(x - 6 + legOffset, y + 9, 4, 5);
    ctx.fillRect(x + 2 - legOffset, y + 9, 4, 5);
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(x - 3, y - 5, 2, 2);
    ctx.fillRect(x + 1, y - 5, 2, 2);
    if (character.state === "WAITING" || character.state === "BLOCKED" || character.state === "ERROR") {
      ctx.fillStyle = character.state === "ERROR" ? "#dc2626" : "#eab308";
      ctx.fillRect(x + 7, y - 14, 7, 7);
      ctx.fillStyle = "#0f172a";
      ctx.font = "bold 8px monospace";
      ctx.fillText(character.state === "ERROR" ? "!" : "?", x + 9, y - 8);
    }
    if (character.carryingArtifactId) {
      ctx.fillStyle = "#f59e0b";
      ctx.fillRect(x + 7, y + 1, 6, 6);
    }
    if (selectedAgentId === character.id) {
      ctx.strokeStyle = "#0f172a";
      ctx.strokeRect(x - 11, y - 16, 22, 32);
    }
    ctx.fillStyle = "#0f172a";
    ctx.font = "9px monospace";
    ctx.fillText(compact(character.name, 12), x - 24, y + 26);
    if (character.bubble && (character.state === "TALKING" || character.state === "COLLABORATING" || character.moving === false)) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x - 45, y - 38, 90, 18);
      ctx.strokeStyle = "#475569";
      ctx.strokeRect(x - 45, y - 38, 90, 18);
      ctx.fillStyle = "#0f172a";
      ctx.font = "9px monospace";
      ctx.fillText(compact(character.bubble, 18), x - 41, y - 26);
    }
  }

  function render() {
    if (destroyed) return;
    const { tile, width, height } = mapSize();
    if (canvas.width !== width * tile) canvas.width = width * tile;
    if (canvas.height !== height * tile) canvas.height = height * tile;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const roomViews = new Map((Array.isArray(snapshot.rooms) ? snapshot.rooms : []).map((room) => [String(room.id), room]));
    for (const [roomId, room] of Object.entries(map.rooms || {})) {
      const roomKey = room.id || roomId;
      const roomView = roomViews.get(String(roomKey));
      drawRoom({ ...room, id: roomKey, occupantCount: roomView?.occupants?.length || 0 }, tile);
    }
    const artifactMap = snapshot.world?.artifacts || {};
    const interactions = snapshot.world?.interactions || {};
    const table = PIXEL?.roomAnchor?.("town-square", "collab-table");
    if (table) {
      const active = Object.values(interactions).some((interaction) => interaction.phase === "gathering" || interaction.phase === "talking");
      if (active) for (const artifact of Object.values(artifactMap)) if (!artifact.carrierAgentId) drawArtifact(artifact, table.x * tile + tile / 2, table.y * tile + tile / 2, tile);
    }
    [...chars.values()].sort((left, right) => left.position.y - right.position.y || left.id.localeCompare(right.id)).forEach((character) => drawCharacter(character, tile));
  }

  function getState() {
    return {
      selectedAgentId,
      characters: [...chars.values()].map((character) => ({ id: character.id, name: character.name, state: character.state, position: { x: Number(character.position.x), y: Number(character.position.y) }, moving: character.moving, direction: character.direction, frame: character.frame, carryingArtifactId: character.carryingArtifactId, bubble: character.bubble })),
    };
  }

  function selectAgent(agentId) {
    selectedAgentId = agentId === null || agentId === undefined ? null : String(agentId);
    render();
  }

  function hitTest(pixelX, pixelY) {
    const { tile } = mapSize();
    const worldX = Number(pixelX) / tile;
    const worldY = Number(pixelY) / tile;
    let hit = null;
    for (const character of chars.values()) {
      if (Math.abs(character.position.x - worldX) <= 0.8 && Math.abs(character.position.y - worldY) <= 0.8) hit = character.id;
    }
    return hit;
  }

  function hitRoom(pixelX, pixelY) {
    const { tile } = mapSize();
    const worldX = Number(pixelX) / tile;
    const worldY = Number(pixelY) / tile;
    for (const [roomId, room] of Object.entries(map.rooms || {})) {
      if (worldX >= room.x && worldX <= room.x + room.width && worldY >= room.y && worldY <= room.y + room.height) return room.id || roomId;
    }
    return null;
  }

  function loop(timestamp) {
    if (destroyed) return;
    if (lastFrameTime === null) lastFrameTime = timestamp;
    update(timestamp - lastFrameTime);
    lastFrameTime = timestamp;
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") frameHandle = window.requestAnimationFrame(loop);
  }

  if (options.autoStart !== false && typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") frameHandle = window.requestAnimationFrame(loop);

  return {
    setSnapshot,
    update,
    render,
    selectAgent,
    hitTest,
    hitRoom,
    getState,
    destroy() {
      destroyed = true;
      if (frameHandle !== null && typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(frameHandle);
      chars.clear();
    },
  };
}

const exported = { createPixelWorldEngine, STATE_COLORS, PROVIDER_COLORS };
if (typeof module !== "undefined") module.exports = exported;
if (typeof window !== "undefined") window.AiVillagePixelEngine = exported;
})();
