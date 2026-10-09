# AI Agent Village — standalone local host

AI Agent Village is a separate local app for seeing real AI-agent work as a readable village. It is not embedded in JUWON COMMAND and does not change the existing company OS.

## Run

```powershell
rtk node server.js --port 4988
```

Windows에서는 `start.cmd`를 더블클릭해도 됩니다.

Open [http://127.0.0.1:4988/](http://127.0.0.1:4988/). The server binds to loopback only.

## What works now

- Seven rooms: Town Square, Mission Control, Research Library, Workshop, Review Room, AI Academy, and Archive.
- Canonical event projection for projects, agents, tasks, runs, tool calls, messages, handoffs, artifacts, reviews, user-input requests, completion, and errors.
- Semantic agent states, deterministic A* movement, and a Canvas 2D pixel world. Characters walk, face one another, talk with short bubbles, carry artifacts, and wait in Review Room only when the event log says so. No random wandering and no invented generative-work percentages.
- Agent/room/event/task/artifact/dependency/conversation inspector, important-event feed, Explain Activity, Needs Me, keyboard selection, responsive layout, and reduced-motion support.
- `GET /api/state`, `GET /api/events`, `GET /api/realtime` (SSE), `POST /api/events`, `POST /api/ingest`, `POST /api/demo`, and `GET /healthz`.
- `POST /api/ingest` is the safe provider boundary. It accepts one OpenAI, Codex, Hermes, CrewAI, n8n, user, or system record, maps common provider event names to the canonical contract, and immediately broadcasts the result through SSE.
- The sample button is explicitly labelled **SIMULATION**. It creates a deterministic, inspectable planning → collaboration → research → physical handoff → artifact → review → approval → archive trace. The 140ms event cadence makes each semantic movement visible while the server remains the source of truth.
- Event input validates the semantic contract and rejects secrets, browser credentials, and tokens.

## Truth boundary

This first localhost is an adapter-ready visual/event core. It does **not** claim a live Hermes Gateway, Hermes history import, ChatGPT export import, or live ChatGPT bridge. Connect one provider by sending durable records to `POST /api/ingest`; the UI will update through SSE. The loopback server appends events to `data/events.jsonl`, so a refresh or server restart reconstructs the current village.

The UI shows short summaries in the village and keeps full event/message content in the inspector. It never displays chain-of-thought or accepts provider secrets.

`pixel-world-model.js` owns the fixed 64×36 map, room anchors, stable slots, A* paths, and interaction phases. `pixel-world-engine.js` owns only 60fps Canvas drawing and consumes immutable snapshots; it never fetches or runs commands.

## Example event

```json
{
  "type": "AGENT_STATUS_CHANGED",
  "projectId": "project-1",
  "agentId": "agent-1",
  "payload": {
    "state": "RESEARCHING",
    "roomId": "research-library",
    "taskId": "task-1"
  }
}
```

### Provider ingest example

```json
{
  "provider": "hermes",
  "projectId": "project-1",
  "runId": "run-1",
  "event": {
    "type": "message.created",
    "agentId": "hermes-1",
    "payload": {
      "channel": "collaboration",
      "body": "Three verified sources.",
      "worldSummary": "Hermes reports evidence to Planner."
    }
  }
}
```

Post that JSON to `http://127.0.0.1:4988/api/ingest`. The adapter emits `MESSAGE_CREATED` with `source: "hermes"`; secrets and private reasoning fields are rejected before persistence.

## Files

- `server.js` — loopback HTTP server, event core, JSON API, SSE, and labelled demo.
- `provider-adapter.js` — provider-neutral ingest normalizer for OpenAI/Codex/Hermes/CrewAI/n8n records; no external network calls.
- `public/model.js` — pure canonical-to-village projection.
- `public/pixel-world-model.js` — fixed map, collision cells, A*, movement intents, collaboration/handoff reducer.
- `public/pixel-world-engine.js` — Canvas pixel renderer and animation state machine.
- `public/index.html`, `public/styles.css`, `public/app.js` — standalone UI, accessible agent selection, SSE, and Inspector.
- `docs/superpowers/plans/2026-08-30-ai-agent-village-localhost.md` — implementation plan.
- `docs/superpowers/specs/2026-08-30-ai-agent-village-pixel-world-design.md` — approved pixel-world design.
- `docs/superpowers/plans/2026-08-30-ai-agent-village-pixel-world.md` — pixel-world implementation plan.

## Verification

```powershell
rtk node --test provider-adapter.node-test.js public/model.node-test.js public/pixel-world-model.node-test.js public/pixel-world-engine.node-test.js public/app.node-test.js server.node-test.js
rtk node --check server.js
rtk node --check public/app.js
```
