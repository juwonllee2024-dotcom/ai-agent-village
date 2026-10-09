const test = require("node:test");
const assert = require("node:assert/strict");

const { buildVillageView, summarizeWorldMessage } = require("./model.js");

test("projects a task run into a truthful village view", () => {
  const state = {
    projects: [{ id: "p1", name: "Alpha", goal: "Ship the brief" }],
    agents: [{ id: "a1", name: "Hermes", provider: "Hermes", role: "researcher", model: "hermes", state: "RESEARCHING", roomId: "research-library", currentTaskId: "t1" }],
    tasks: [{ id: "t1", projectId: "p1", title: "Find sources", status: "RESEARCHING", ownerAgentId: "a1", dependencyIds: [] }],
    artifacts: [],
    reviews: [],
    conversations: [],
    messages: [],
    events: [{ id: "e1", type: "TOOL_CALL_STARTED", projectId: "p1", agentId: "a1", body: "Searching sources", createdAt: "2026-08-30T00:00:00.000Z" }],
  };
  const view = buildVillageView(state, { projectId: "p1" });
  assert.equal(view.project.name, "Alpha");
  assert.equal(view.agents[0].state, "RESEARCHING");
  assert.equal(view.agents[0].roomId, "research-library");
  assert.equal(view.agents[0].progress, null);
  assert.equal(view.rooms.find((room) => room.id === "research-library").activeCount, 1);
  assert.equal(view.eventFeed[0].body, "Searching sources");
});

test("does not invent activity, percentages, or long world bubbles", () => {
  const view = buildVillageView({ projects: [], agents: [], tasks: [], artifacts: [], reviews: [], conversations: [], messages: [], events: [] });
  assert.equal(view.summary.totalAgents, 0);
  assert.equal(view.summary.activeAgents, 0);
  assert.equal(view.summary.progress, null);
  assert.equal(view.eventFeed.length, 0);
  assert.equal(summarizeWorldMessage({ body: "x".repeat(120) }).length, 60);
});

test("keeps project data isolated", () => {
  const state = {
    projects: [{ id: "p1", name: "One" }, { id: "p2", name: "Two" }],
    agents: [{ id: "a1", name: "One Agent", projectId: "p1", state: "WORKING" }, { id: "a2", name: "Two Agent", projectId: "p2", state: "WORKING" }],
    tasks: [], artifacts: [], reviews: [], conversations: [], messages: [], events: [],
  };
  const view = buildVillageView(state, { projectId: "p1" });
  assert.deepEqual(view.agents.map((agent) => agent.id), ["a1"]);
});

test("projects semantic world location, movement, interactions, and artifacts", () => {
  const state = {
    projects: [{ id: "p1", name: "World", goal: "Ship" }],
    agents: [
      { id: "a1", name: "Planner", provider: "Codex", state: "WORKING", roomId: "workshop", projectId: "p1" },
      { id: "a2", name: "Researcher", provider: "Hermes", state: "RESEARCHING", roomId: "research-library", projectId: "p1" },
    ],
    tasks: [],
    artifacts: [{ id: "art-1", name: "brief.md", ownerAgentId: "a1", projectId: "p1", status: "CREATED" }],
    reviews: [], conversations: [], messages: [],
    events: [
      { id: "e1", type: "COLLABORATION_STARTED", projectId: "p1", payload: { interactionId: "c1", participantAgentIds: ["a1", "a2"], topic: "Plan" } },
      { id: "e2", type: "MESSAGE_CREATED", projectId: "p1", agentId: "a1", payload: { channel: "quick", body: "Sources ready" } },
      { id: "e3", type: "HANDOFF_STARTED", projectId: "p1", payload: { interactionId: "h1", sourceAgentId: "a1", targetAgentId: "a2", artifactId: "art-1" } },
      { id: "e4", type: "ARTIFACT_CARRIED", projectId: "p1", payload: { interactionId: "h1", artifactId: "art-1", carrierAgentId: "a1", stage: "in-transit" } },
    ],
  };
  const view = buildVillageView(state, { projectId: "p1" });
  assert.equal(view.world.lastEventId, "e4");
  assert.equal(view.world.interactions.c1.phase, "gathering");
  assert.equal(view.world.interactions.h1.phase, "transfer");
  assert.equal(view.world.artifacts["art-1"].carrierAgentId, "a1");
  assert.ok(view.agents.every((agent) => agent.location?.x !== undefined && agent.location?.y !== undefined));
  assert.ok(view.agents.some((agent) => agent.movement?.interactionId === "h1"));
  assert.equal(view.agents.find((agent) => agent.id === "a1").visualState, "TALKING");
  assert.equal(view.agents.find((agent) => agent.id === "a1").worldSummary, "Sources ready");
});

test("semantic world projection does not invent movement for a quick message", () => {
  const view = buildVillageView({
    projects: [{ id: "p1", name: "World" }],
    agents: [{ id: "a1", name: "Agent", projectId: "p1", state: "WORKING", roomId: "workshop" }],
    tasks: [], artifacts: [], reviews: [], conversations: [], messages: [],
    events: [{ id: "e1", type: "MESSAGE_CREATED", projectId: "p1", agentId: "a1", payload: { channel: "quick", body: "Hello" } }],
  }, { projectId: "p1" });
  assert.equal(view.agents[0].movement, null);
  assert.equal(view.world.movementIntents.length, 0);
});

test("keeps world artifacts isolated with the selected project", () => {
  const view = buildVillageView({
    projects: [{ id: "p1", name: "One" }, { id: "p2", name: "Two" }],
    agents: [{ id: "a1", name: "One Agent", projectId: "p1", state: "WORKING" }],
    tasks: [],
    artifacts: [{ id: "a-p1", projectId: "p1" }, { id: "a-p2", projectId: "p2" }],
    reviews: [], conversations: [], messages: [], events: [],
  }, { projectId: "p1" });
  assert.deepEqual(Object.keys(view.world.artifacts), ["a-p1"]);
});

test("position reached clears stale movement intent on replay", () => {
  const view = buildVillageView({
    projects: [{ id: "p1", name: "One" }],
    agents: [{ id: "a1", name: "Agent", projectId: "p1", state: "WORKING", roomId: "workshop" }],
    tasks: [], artifacts: [], reviews: [], conversations: [], messages: [],
    events: [
      { id: "move-1", type: "AGENT_STATUS_CHANGED", projectId: "p1", agentId: "a1", payload: { state: "WORKING", roomId: "workshop" } },
      { id: "reach-1", type: "POSITION_REACHED", projectId: "p1", agentId: "a1", payload: { roomId: "workshop", anchorId: "build-bench", position: { x: 10, y: 21 } } },
    ],
  }, { projectId: "p1" });
  assert.equal(view.agents[0].movement, null);
  assert.deepEqual(view.agents[0].location, { x: 10, y: 21 });
});
