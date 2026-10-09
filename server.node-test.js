const test = require("node:test");
const assert = require("node:assert/strict");

const { createInitialState, validateEvent, appendEvent, createVillageServer } = require("./server.js");

test("validates semantic events and rejects secrets", () => {
  assert.throws(() => validateEvent({ type: "NOT_A_REAL_EVENT" }), /Unsupported event type/);
  assert.throws(() => validateEvent({ type: "PROJECT_CREATED", payload: { apiKey: "do-not-store" } }), /secret/i);
  assert.throws(() => validateEvent({ type: "PROJECT_CREATED", payload: { chainOfThought: "do-not-store" } }), /reasoning/i);
  assert.equal(validateEvent({ type: "PROJECT_CREATED", projectId: "p1", payload: { name: "Alpha" } }).type, "PROJECT_CREATED");
  for (const type of ["MOVEMENT_INTENT", "POSITION_REACHED", "COLLABORATION_STARTED", "COLLABORATION_ENDED", "HANDOFF_STARTED", "HANDOFF_COMPLETED", "ARTIFACT_CARRIED"]) {
    assert.equal(validateEvent({ type, payload: {} }).type, type);
  }
});

test("appendEvent reconstructs canonical entities without overwriting history", () => {
  const state = createInitialState();
  appendEvent(state, { id: "p-event", type: "PROJECT_CREATED", projectId: "p1", payload: { name: "Alpha", goal: "Ship" } });
  appendEvent(state, { id: "a-event", type: "AGENT_REGISTERED", projectId: "p1", agentId: "a1", payload: { name: "Hermes", provider: "Hermes", state: "OFFLINE" } });
  appendEvent(state, { id: "s-event", type: "AGENT_STATUS_CHANGED", projectId: "p1", agentId: "a1", payload: { state: "WORKING", roomId: "workshop" } });
  assert.equal(state.events.length, 3);
  assert.equal(state.projects[0].name, "Alpha");
  assert.equal(state.agents[0].state, "WORKING");
  assert.equal(state.agents[0].roomId, "workshop");
  assert.equal(state.sequence, 3);
});

test("serves health/state and accepts a real semantic event", async () => {
  const server = createVillageServer({ publicDir: require("node:path").join(__dirname, "public") });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  const health = await fetch(`${base}/healthz`).then((response) => response.json());
  assert.equal(health.ok, true);
  const created = await fetch(`${base}/api/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "PROJECT_CREATED", projectId: "p-http", payload: { name: "HTTP project" } }) });
  assert.equal(created.status, 201);
  const state = await fetch(`${base}/api/state`).then((response) => response.json());
  assert.equal(state.projects[0].name, "HTTP project");
  await new Promise((resolve) => server.close(resolve));
});

test("ingests one provider event through the canonical event boundary", async () => {
  const server = createVillageServer({ publicDir: require("node:path").join(__dirname, "public") });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  const response = await fetch(`${base}/api/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: "n8n",
      projectId: "p-ingest",
      event: { type: "task.created", taskId: "t-ingest", payload: { title: "Ingested task" } },
    }),
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.event.type, "TASK_CREATED");
  assert.equal(body.event.source, "n8n");
  assert.equal(body.event.payload.title, "Ingested task");
  await new Promise((resolve) => server.close(resolve));
});

test("persists semantic movement and interaction events without fabricating agent state", () => {
  const state = createInitialState();
  appendEvent(state, { id: "agent", type: "AGENT_REGISTERED", agentId: "a1", payload: { name: "A", state: "WORKING" } });
  appendEvent(state, { id: "move", type: "MOVEMENT_INTENT", agentId: "a1", payload: { toRoomId: "workshop", toAnchorId: "build-bench", reason: "task started" } });
  appendEvent(state, { id: "collab", type: "COLLABORATION_STARTED", payload: { interactionId: "c1", participantAgentIds: ["a1"] } });
  appendEvent(state, { id: "handoff", type: "HANDOFF_STARTED", payload: { interactionId: "h1", sourceAgentId: "a1", targetAgentId: "a2", artifactId: "art-1" } });
  assert.equal(state.events.length, 4);
  assert.equal(state.agents[0].state, "WORKING");
  assert.equal(state.events.at(-1).payload.artifactId, "art-1");
});
