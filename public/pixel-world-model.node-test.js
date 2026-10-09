const test = require("node:test");
const assert = require("node:assert/strict");

const {
  WORLD_MAP,
  ROOM_IDS,
  getRoom,
  isWalkable,
  aStar,
  assignRoomSlots,
  roomAnchor,
  deriveMovementIntents,
  reduceInteraction,
  summarizeBubble,
} = require("./pixel-world-model.js");

test("fixed map exposes seven connected rooms and walkable anchors", () => {
  assert.equal(WORLD_MAP.width, 64);
  assert.equal(WORLD_MAP.height, 36);
  assert.deepEqual(ROOM_IDS, [
    "town-square",
    "mission-control",
    "research-library",
    "workshop",
    "review-room",
    "ai-academy",
    "archive",
  ]);
  for (const roomId of ROOM_IDS) {
    const room = getRoom(roomId);
    assert.ok(room, roomId);
    for (const anchor of Object.values(room.anchors)) {
      assert.equal(isWalkable(anchor, WORLD_MAP), true, `${roomId}:${anchor.id}`);
    }
  }
  const path = aStar(roomAnchor("town-square", "collab-table"), roomAnchor("archive", "archive-shelf"), WORLD_MAP);
  assert.ok(path && path.length > 2);
  assert.deepEqual(path, aStar(path[0], path.at(-1), WORLD_MAP));
});

test("A* is deterministic and avoids blocked and occupied cells", () => {
  const start = { x: 4, y: 4 };
  const goal = { x: 14, y: 4 };
  const blocked = [{ x: 6, y: 4 }, { x: 7, y: 4 }, { x: 8, y: 4 }];
  const first = aStar(start, goal, WORLD_MAP, { blocked });
  const second = aStar(start, goal, WORLD_MAP, { blocked });
  assert.deepEqual(first, second);
  assert.ok(first.every((cell) => !blocked.some((item) => item.x === cell.x && item.y === cell.y)));
  assert.equal(aStar(start, goal, WORLD_MAP, { blocked: [{ x: 3, y: 4 }, { x: 4, y: 3 }, { x: 4, y: 5 }, { x: 5, y: 4 }] }), null);
});

test("room slots are stable by agent id and movement intents explain events", () => {
  const slots = assignRoomSlots([
    { id: "agent-b" },
    { id: "agent-a" },
  ], "town-square");
  assert.notDeepEqual(slots["agent-a"], slots["agent-b"]);
  assert.ok(slots["agent-a"].anchorId);
  const intents = deriveMovementIntents({
    type: "COLLABORATION_STARTED",
    payload: { interactionId: "collab-1", participantAgentIds: ["agent-b", "agent-a"], roomId: "town-square", anchorId: "collab-table" },
  }, [
    { id: "agent-a", roomId: "research-library" },
    { id: "agent-b", roomId: "workshop" },
  ]);
  assert.deepEqual(intents.map((item) => item.agentId), ["agent-a", "agent-b"]);
  assert.ok(intents.every((item) => item.toRoomId === "town-square" && item.path?.length));
  const quick = deriveMovementIntents({ type: "MESSAGE_CREATED", payload: { channel: "quick", senderAgentId: "agent-a" } }, [{ id: "agent-a", roomId: "workshop" }]);
  assert.deepEqual(quick, []);
});

test("interaction reducer keeps explicit collaboration and handoff phases", () => {
  let state = { interactions: {}, artifacts: {} };
  state = reduceInteraction(state, { id: "e1", type: "COLLABORATION_STARTED", payload: { interactionId: "c1", participantAgentIds: ["a", "b"], topic: "Plan" } });
  assert.equal(state.interactions.c1.phase, "gathering");
  state = reduceInteraction(state, { id: "e2", type: "HANDOFF_STARTED", payload: { interactionId: "h1", sourceAgentId: "a", targetAgentId: "b", artifactId: "art-1" } });
  assert.equal(state.interactions.h1.phase, "approach");
  state = reduceInteraction(state, { id: "e3", type: "ARTIFACT_CARRIED", payload: { interactionId: "h1", artifactId: "art-1", carrierAgentId: "a", stage: "in-transit" } });
  assert.equal(state.interactions.h1.phase, "transfer");
  assert.equal(state.artifacts["art-1"].carrierAgentId, "a");
  state = reduceInteraction(state, { id: "e4", type: "HANDOFF_COMPLETED", payload: { interactionId: "h1", sourceAgentId: "a", targetAgentId: "b", artifactId: "art-1", nextRoomId: "workshop" } });
  assert.equal(state.interactions.h1.phase, "completed");
  assert.equal(state.artifacts["art-1"].ownerAgentId, "b");
  assert.equal(summarizeBubble("x".repeat(100)).length, 60);
});

test("review interaction closes when its review is approved", () => {
  let state = { interactions: {}, artifacts: {} };
  state = reduceInteraction(state, { id: "review-request", type: "REVIEW_REQUESTED", payload: { reviewId: "r1", artifactId: "art-1", agentId: "a1" } });
  const interactionId = Object.keys(state.interactions)[0];
  assert.equal(state.interactions[interactionId].phase, "review");
  state = reduceInteraction(state, { id: "review-approved", type: "REVIEW_APPROVED", payload: { reviewId: "r1", artifactId: "art-1" } });
  assert.equal(state.interactions[interactionId].phase, "completed");
});
