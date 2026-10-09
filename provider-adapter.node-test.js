const test = require("node:test");
const assert = require("node:assert/strict");

test("normalizes provider dot events into canonical village events", () => {
  const { normalizeProviderEnvelope } = require("./provider-adapter.js");
  const event = normalizeProviderEnvelope({
    provider: "hermes",
    projectId: "project-1",
    runId: "run-1",
    event: {
      type: "message.created",
      agentId: "hermes-1",
      payload: { body: "Three verified sources.", channel: "collaboration", senderName: "Hermes" },
    },
  });

  assert.equal(event.type, "MESSAGE_CREATED");
  assert.equal(event.source, "hermes");
  assert.equal(event.projectId, "project-1");
  assert.equal(event.runId, "run-1");
  assert.equal(event.agentId, "hermes-1");
  assert.equal(event.payload.body, "Three verified sources.");
});

test("normalizes provider status aliases without inventing room or state", () => {
  const { normalizeProviderEnvelope } = require("./provider-adapter.js");
  const event = normalizeProviderEnvelope({
    provider: "codex",
    event: {
      type: "agent.status",
      agentId: "codex-1",
      payload: { status: "working", roomId: "workshop", reason: "Implementing adapter" },
    },
  });

  assert.equal(event.type, "AGENT_STATUS_CHANGED");
  assert.equal(event.agentId, "codex-1");
  assert.equal(event.payload.state, "WORKING");
  assert.equal(event.payload.roomId, "workshop");
  assert.equal(event.payload.reason, "Implementing adapter");
});

test("rejects unknown providers and secret-bearing provider records", () => {
  const { normalizeProviderEnvelope } = require("./provider-adapter.js");
  assert.throws(() => normalizeProviderEnvelope({ provider: "unknown", event: { type: "message" } }), /Unsupported provider/);
  assert.throws(() => normalizeProviderEnvelope({
    provider: "n8n",
    event: { type: "message", payload: { apiKey: "never-store" } },
  }), /secret/i);
  assert.throws(() => normalizeProviderEnvelope({
    provider: "openai",
    apiKey: "never-store",
    event: { type: "message", payload: { body: "safe text" } },
  }), /secret/i);
});
