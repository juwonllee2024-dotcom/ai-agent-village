const test = require("node:test");
const assert = require("node:assert/strict");

const { createPixelWorldEngine } = require("./pixel-world-engine.js");

function makeCanvas() {
  const calls = [];
  const context = new Proxy({
    fillStyle: "",
    strokeStyle: "",
    font: "",
    globalAlpha: 1,
    imageSmoothingEnabled: true,
  }, {
    get(target, property) {
      if (property in target) return target[property];
      return (...args) => calls.push({ property, args });
    },
  });
  return { width: 1024, height: 576, getContext: () => context, calls, context };
}

test("empty snapshot renders the map without inventing agents", () => {
  const canvas = makeCanvas();
  const engine = createPixelWorldEngine(canvas, { autoStart: false });
  engine.setSnapshot({ agents: [], world: { movementIntents: [], interactions: {}, artifacts: {} } });
  engine.render();
  assert.equal(engine.getState().characters.length, 0);
  assert.ok(canvas.calls.some((call) => call.property === "fillRect"));
  assert.equal(canvas.context.imageSmoothingEnabled, false);
  engine.destroy();
});

test("walking consumes deterministic path without a network call", () => {
  const canvas = makeCanvas();
  const engine = createPixelWorldEngine(canvas, { autoStart: false, speed: 10, animateInitialPath: true });
  engine.setSnapshot({
    agents: [{ id: "a1", name: "A", state: "WALKING", roomId: "workshop", provider: "Codex", location: { x: 10, y: 21 }, movement: { eventId: "move-1", path: [{ x: 8, y: 21 }, { x: 9, y: 21 }, { x: 10, y: 21 }], target: { x: 10, y: 21 }, toRoomId: "workshop" } }],
    world: { movementIntents: [], interactions: {}, artifacts: {} },
  });
  assert.deepEqual(engine.getState().characters[0].position, { x: 8, y: 21 });
  engine.update(250);
  assert.deepEqual(engine.getState().characters[0].position, { x: 10, y: 21 });
  assert.equal(engine.getState().characters[0].moving, false);
  assert.equal(engine.hitRoom(10 * 16, 21 * 16), "workshop");
  engine.destroy();
});

test("reduced motion snaps to target and carries artifact marker", () => {
  const canvas = makeCanvas();
  const engine = createPixelWorldEngine(canvas, { autoStart: false, reducedMotion: true });
  engine.setSnapshot({
    agents: [{ id: "a1", name: "A", state: "CARRYING", roomId: "town-square", location: { x: 12, y: 7 }, movement: { eventId: "move-2", path: [{ x: 8, y: 7 }, { x: 12, y: 7 }], target: { x: 12, y: 7 } } }],
    world: { movementIntents: [], interactions: { h1: { phase: "transfer", artifactId: "art-1" } }, artifacts: { "art-1": { id: "art-1", carrierAgentId: "a1", name: "brief.md" } } },
  });
  assert.deepEqual(engine.getState().characters[0].position, { x: 12, y: 7 });
  assert.equal(engine.getState().characters[0].carryingArtifactId, "art-1");
  engine.render();
  assert.ok(canvas.calls.some((call) => call.property === "fillText"));
  engine.destroy();
});
