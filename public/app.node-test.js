const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;

test("village UI contains the seven rooms and a visible truthfulness contract", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  for (const roomId of ["town-square", "mission-control", "research-library", "workshop", "review-room", "ai-academy", "archive"]) assert.match(html, new RegExp(`data-room=["']${roomId}["']`));
  assert.match(html, /AI Agent Village/i);
  assert.match(html, /waiting for events/i);
  assert.match(html, /simulation/i);
  assert.match(html, /villageInspector/);
  assert.match(html, /pixelWorldCanvas/);
  assert.match(html, /pixel-world-engine\.js/);
});

test("UI code uses semantic state hooks and realtime events instead of random motion", () => {
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  assert.match(app, /EventSource/);
  assert.match(app, /data-village-state/);
  assert.match(app, /api\/demo/);
  assert.match(app, /No fake activity|가짜|simulation/i);
  assert.doesNotMatch(app, /Math\.random\(/);
  assert.match(app, /createPixelWorldEngine/);
  assert.match(app, /engine\.setSnapshot/);
  assert.match(app, /engine\.hitRoom/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /village-agent\[data-state/);
});
