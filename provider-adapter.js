const PROVIDERS = new Set(["openai", "codex", "hermes", "crewai", "crew", "n8n", "user", "system"]);

const EVENT_ALIASES = Object.freeze({
  "project.created": "PROJECT_CREATED",
  "task.created": "TASK_CREATED",
  "task.started": "RUN_STARTED",
  "task.completed": "TASK_COMPLETED",
  "agent.created": "AGENT_REGISTERED",
  "agent.registered": "AGENT_REGISTERED",
  "agent.started": "AGENT_STATUS_CHANGED",
  "agent.finished": "RUN_FINISHED",
  "agent.status": "AGENT_STATUS_CHANGED",
  "agent.status.changed": "AGENT_STATUS_CHANGED",
  "run.started": "RUN_STARTED",
  "run.finished": "RUN_FINISHED",
  "response.created": "RUN_STARTED",
  "response.completed": "RUN_FINISHED",
  "tool.start": "TOOL_CALL_STARTED",
  "tool.started": "TOOL_CALL_STARTED",
  "tool.finish": "TOOL_CALL_FINISHED",
  "tool.finished": "TOOL_CALL_FINISHED",
  "node.started": "TOOL_CALL_STARTED",
  "node.finished": "TOOL_CALL_FINISHED",
  "workflow.started": "RUN_STARTED",
  "workflow.finished": "RUN_FINISHED",
  "message": "MESSAGE_CREATED",
  "message.created": "MESSAGE_CREATED",
  "response.output_text.done": "MESSAGE_CREATED",
  "handoff.created": "HANDOFF_CREATED",
  "handoff.started": "HANDOFF_STARTED",
  "handoff.completed": "HANDOFF_COMPLETED",
  "artifact.created": "ARTIFACT_CREATED",
  "artifact.carried": "ARTIFACT_CARRIED",
  "review.requested": "REVIEW_REQUESTED",
  "review.commented": "REVIEW_COMMENTED",
  "review.approved": "REVIEW_APPROVED",
  "review.rejected": "REVIEW_REJECTED",
  "user.input.required": "USER_INPUT_REQUIRED",
  "user.input.resolved": "USER_INPUT_RESOLVED",
  "error": "ERROR_REPORTED",
  "error.reported": "ERROR_REPORTED",
  "movement.intent": "MOVEMENT_INTENT",
  "position.reached": "POSITION_REACHED",
  "collaboration.started": "COLLABORATION_STARTED",
  "collaboration.ended": "COLLABORATION_ENDED",
});

const CANONICAL_TYPES = new Set(Object.values(EVENT_ALIASES));
const SECRET_KEY = /(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization|cookie|private[_-]?key)/i;
const PRIVATE_REASONING_KEY = /(chain[_-]?of[_-]?thought|chainOfThought|reasoning|thoughts?)/i;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function hasForbiddenKey(value, matcher, parentKey = "") {
  if (parentKey && matcher.test(parentKey)) return true;
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => hasForbiddenKey(item, matcher));
  return Object.entries(value).some(([key, item]) => hasForbiddenKey(item, matcher, key));
}

function normalizeProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  if (!PROVIDERS.has(provider)) throw new Error(`Unsupported provider: ${provider || "missing"}`);
  return provider;
}

function normalizeType(value) {
  const raw = String(value || "").trim();
  const canonical = raw.toUpperCase().replace(/[.\- ]+/g, "_");
  if (CANONICAL_TYPES.has(canonical)) return canonical;
  const alias = EVENT_ALIASES[raw.toLowerCase().replace(/[\-_]+/g, ".")];
  if (alias) return alias;
  throw new Error(`Unsupported provider event type: ${raw || "missing"}`);
}

function compactEvent(event) {
  return Object.fromEntries(Object.entries(event).filter(([, value]) => value !== undefined && value !== null && value !== ""));
}

function normalizeProviderEnvelope(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Provider envelope must be a JSON object");
  const provider = normalizeProvider(input.provider || input.source);
  if (hasForbiddenKey(input, SECRET_KEY) || hasForbiddenKey(input, PRIVATE_REASONING_KEY)) {
    throw new Error("Secrets and private reasoning cannot enter the event boundary");
  }
  const raw = input.event && typeof input.event === "object" && !Array.isArray(input.event) ? input.event : input;
  const type = normalizeType(raw.type || raw.eventType || input.type);
  const sourcePayload = raw.payload && typeof raw.payload === "object" && !Array.isArray(raw.payload)
    ? raw.payload
    : (input.payload && typeof input.payload === "object" && !Array.isArray(input.payload) ? input.payload : {});
  if (hasForbiddenKey(sourcePayload, SECRET_KEY) || hasForbiddenKey(sourcePayload, PRIVATE_REASONING_KEY)) {
    throw new Error("Secrets and private reasoning cannot enter the event boundary");
  }
  const payload = clone(sourcePayload);
  const stateAlias = payload.state || payload.status || raw.state || input.state;
  if ((type === "AGENT_STATUS_CHANGED" || type === "RUN_STARTED" || type === "RUN_FINISHED") && stateAlias && !payload.state) {
    payload.state = String(stateAlias).toUpperCase();
  }
  if (type === "MESSAGE_CREATED" && !payload.body) {
    const body = payload.text || raw.text || input.text || raw.body || input.body;
    if (body !== undefined) payload.body = String(body);
  }
  const agent = raw.agent && typeof raw.agent === "object" ? raw.agent : null;
  if (type === "AGENT_REGISTERED" && agent) {
    for (const key of ["id", "name", "displayName", "provider", "role", "model", "state", "roomId"]) {
      if (payload[key] === undefined && agent[key] !== undefined) payload[key] = clone(agent[key]);
    }
  }
  return compactEvent({
    id: raw.id || input.id,
    type,
    source: provider,
    projectId: raw.projectId || input.projectId || payload.projectId,
    runId: raw.runId || input.runId || payload.runId,
    agentId: raw.agentId || input.agentId || payload.agentId || payload.senderAgentId || payload.sourceAgentId || payload.carrierAgentId,
    taskId: raw.taskId || input.taskId || payload.taskId,
    createdAt: raw.createdAt || input.createdAt,
    payload,
  });
}

module.exports = { PROVIDERS, EVENT_ALIASES, normalizeProviderEnvelope };
