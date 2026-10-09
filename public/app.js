(() => {
  "use strict";

  const model = window.AiVillageModel;
  const pixelEngineApi = window.AiVillagePixelEngine;
  const $ = (id) => document.getElementById(id);
  const appState = { snapshot: null, projectId: "", selection: { type: "summary", id: null }, zoom: "village", eventSource: null, tokens: new Map(), engine: null, view: null };
  const roomSlots = {
    "town-square": [14, 24], "mission-control": [48, 24], "research-library": [83, 24],
    workshop: [48, 55], "review-room": [83, 55], "ai-academy": [14, 86], archive: [83, 86],
  };
  const activeStates = new Set(["THINKING", "PLANNING", "WALKING", "RESEARCHING", "WORKING", "COLLABORATING", "WAITING", "BLOCKED", "REVIEWING", "LEARNING", "DELIVERING", "ERROR"]);
  const stateLabels = { IDLE: "대기", THINKING: "생각 중", PLANNING: "계획 중", WALKING: "이동 중", RESEARCHING: "리서치 중", WORKING: "작업 중", COLLABORATING: "협업 중", WAITING: "대기/입력 필요", BLOCKED: "막힘", REVIEWING: "리뷰 중", LEARNING: "학습 중", DELIVERING: "전달 중", DONE: "완료", ERROR: "오류", OFFLINE: "오프라인" };

  // No fake activity: tokens and labels are projections of the local event log only.
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
  }

  function formatTime(value) {
    if (!value) return "시간 미기록";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  }

  function stateText(value) {
    return stateLabels[value] || value || "기록 없음";
  }

  async function api(path, options = {}) {
    const response = await fetch(path, { ...options, headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }

  function setConnection(label, kind = "waiting") {
    const element = $("connectionStatus");
    if (!element) return;
    element.textContent = label;
    element.dataset.connection = kind;
  }

  function currentView() {
    return model.buildVillageView(appState.snapshot || {}, { projectId: appState.projectId || null });
  }

  function ensurePixelWorld() {
    if (appState.engine || !pixelEngineApi?.createPixelWorldEngine) return;
    const canvas = $("pixelWorldCanvas");
    if (!canvas) return;
    appState.engine = pixelEngineApi.createPixelWorldEngine(canvas, { autoStart: true });
    canvas.addEventListener("click", (event) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / Math.max(1, rect.width);
      const scaleY = canvas.height / Math.max(1, rect.height);
      const agentId = appState.engine.hitTest((event.clientX - rect.left) * scaleX, (event.clientY - rect.top) * scaleY);
      if (agentId) selectEntity("agent", agentId);
      else {
        const roomId = appState.engine.hitRoom((event.clientX - rect.left) * scaleX, (event.clientY - rect.top) * scaleY);
        if (roomId) selectEntity("room", roomId);
      }
    });
  }

  function selectEntity(type, id = null) {
    appState.selection = { type, id };
    if (appState.engine) appState.engine.selectAgent(type === "agent" ? id : null);
    render();
  }

  function entityLink(type, id, label) {
    return `<button type="button" class="entity-link" data-select-type="${escapeHtml(type)}" data-select-id="${escapeHtml(id)}">${escapeHtml(label)}</button>`;
  }

  function bindEntityLinks() {
    document.querySelectorAll("[data-select-type]").forEach((element) => {
      if (element.dataset.bound) return;
      element.dataset.bound = "1";
      element.addEventListener("click", () => selectEntity(element.dataset.selectType, element.dataset.selectId));
    });
  }

  function renderProjects(view) {
    const select = $("projectSelect");
    if (!select) return;
    const projects = Array.isArray(appState.snapshot?.projects) ? appState.snapshot.projects : [];
    const current = appState.projectId;
    const nameCounts = new Map();
    projects.forEach((project) => { const name = String(project.name || project.id); nameCounts.set(name, (nameCounts.get(name) || 0) + 1); });
    select.innerHTML = projects.length
      ? projects.map((project) => { const name = String(project.name || project.id); const label = nameCounts.get(name) > 1 ? `${name} · ${String(project.id).slice(-8)}` : name; return `<option value="${escapeHtml(project.id)}">${escapeHtml(label)}</option>`; }).join("")
      : `<option value="">이벤트 대기</option>`;
    select.disabled = projects.length === 0;
    if (current && projects.some((project) => String(project.id) === String(current))) select.value = current;
    else if (projects.length === 1) { appState.projectId = String(projects[0].id); select.value = appState.projectId; }
    else select.value = "";
    if (view.project) select.value = String(view.project.id);
  }

  function renderTop(view) {
    const project = view.project;
    const active = view.summary.activeAgents;
    $("projectGoal").textContent = project?.goal ? `목표 · ${project.goal}` : "목표 기록 없음";
    $("agentCount").textContent = `${view.summary.totalAgents} agents · ${active} active`;
    $("needsCount").textContent = String(view.summary.needsUser);
    const last = view.eventFeed[0];
    $("activityStatus").textContent = view.summary.eventCount === 0
      ? "저장된 이벤트를 기다리는 중입니다."
      : `${active}명 활동 · 마지막 기록 ${last?.title || "이벤트"} · ${formatTime(last?.createdAt)}`;
    const statusLabel = view.summary.eventCount === 0 ? "LOCAL · waiting for events" : (view.simulationOnly ? "LOCAL · simulation records" : "LOCAL · event stream");
    setConnection(statusLabel, view.summary.eventCount === 0 ? "waiting" : "live");
  }

  function renderRooms(view) {
    const roomById = new Map(view.rooms.map((room) => [room.id, room]));
    document.querySelectorAll(".room[data-room]").forEach((roomElement) => {
      const id = roomElement.dataset.room;
      const record = roomById.get(id);
      const count = record?.activeCount || 0;
      roomElement.dataset.active = count > 0 ? "true" : "false";
      roomElement.classList.toggle("selected", appState.selection.type === "room" && appState.selection.id === id);
      roomElement.querySelector("[data-room-count]").textContent = String(record?.occupants?.length || 0);
      roomElement.setAttribute("aria-label", `${record?.label || id} · ${record?.occupants?.length || 0}명`);
      if (!roomElement.dataset.bound) {
        roomElement.dataset.bound = "1";
        roomElement.addEventListener("click", () => selectEntity("room", id));
        roomElement.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectEntity("room", id); } });
      }
    });
    $("mapEmpty").classList.toggle("is-hidden", view.agents.length > 0);
  }

  function agentPosition(agent, index, counts) {
    if (agent.location && Number.isFinite(Number(agent.location.x)) && Number.isFinite(Number(agent.location.y))) {
      return { left: Math.max(4, Math.min(96, (Number(agent.location.x) / 64) * 100)), top: Math.max(5, Math.min(95, (Number(agent.location.y) / 36) * 100)) };
    }
    const base = roomSlots[agent.roomId] || roomSlots["town-square"];
    const slot = counts[agent.roomId] || 0;
    counts[agent.roomId] = slot + 1;
    const column = slot % 3;
    const row = Math.floor(slot / 3);
    return { left: Math.max(6, Math.min(94, base[0] + (column - 1) * 7)), top: Math.max(7, Math.min(94, base[1] + (row - 1) * 7 + (index % 2 ? 3 : 0))) };
  }

  function initials(name) {
    return String(name || "AI").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase().slice(0, 2) || "AI";
  }

  function createAgentToken(agent) {
    const token = document.createElement("button");
    token.type = "button";
    token.className = "village-agent";
    token.innerHTML = `<span class="agent-avatar" aria-hidden="true"></span><span class="agent-name"></span><span class="agent-state"></span>`;
    token.addEventListener("click", () => selectEntity("agent", agent.id));
    return token;
  }

  function renderAgents(view) {
    const layer = $("agentLayer");
    const counts = {};
    const seen = new Set();
    view.agents.forEach((agent, index) => {
      const id = String(agent.id);
      let token = appState.tokens.get(id);
      if (!token) { token = createAgentToken(agent); appState.tokens.set(id, token); layer.appendChild(token); }
      seen.add(id);
      const position = agentPosition(agent, index, counts);
      token.dataset.agent = id;
      token.dataset.villageState = agent.state;
      token.dataset.villageRoom = agent.roomId;
      token.dataset.state = agent.state;
      token.setAttribute("data-village-state", agent.state);
      token.setAttribute("data-village-room", agent.roomId);
      token.setAttribute("aria-pressed", appState.selection.type === "agent" && String(appState.selection.id) === id ? "true" : "false");
      token.setAttribute("aria-label", `${agent.name} · ${stateText(agent.state)} · ${agent.provider}`);
      token.title = `${agent.name} · ${stateText(agent.state)} · ${agent.roomId}`;
      token.style.left = `${position.left}%`;
      token.style.top = `${position.top}%`;
      token.classList.toggle("selected", appState.selection.type === "agent" && String(appState.selection.id) === id);
      token.querySelector(".agent-avatar").textContent = initials(agent.name);
      token.querySelector(".agent-name").textContent = agent.name;
      token.querySelector(".agent-state").textContent = agent.progress ? `${stateText(agent.state)} · ${agent.progress.current}/${agent.progress.total} ${agent.progress.unit}` : stateText(agent.state);
      let bubble = token.querySelector(".world-bubble");
      if (agent.worldSummary) {
        if (!bubble) { bubble = document.createElement("span"); bubble.className = "world-bubble"; token.appendChild(bubble); }
        bubble.textContent = agent.worldSummary;
      } else if (bubble) bubble.remove();
    });
    for (const [id, token] of appState.tokens) if (!seen.has(id)) { token.remove(); appState.tokens.delete(id); }
  }

  function renderFeed(view) {
    const feed = $("eventFeedItems");
    $("eventFeedCount").textContent = String(view.eventFeed.length);
    feed.innerHTML = view.eventFeed.length ? view.eventFeed.slice(0, 12).map((event) => `<button type="button" class="event-item" data-select-type="event" data-select-id="${escapeHtml(event.id)}"><strong>${escapeHtml(event.agentName)}</strong><span>${escapeHtml(event.body)}</span><small>${event.simulation ? '<span class="sim-tag">SIM</span> · ' : ""}${escapeHtml(formatTime(event.createdAt))}</small></button>`).join("") : `<p class="empty-copy">아직 기록된 이벤트가 없습니다.</p>`;
    bindEntityLinks();
  }

  function summaryInspector(view) {
    const active = view.agents.filter((agent) => activeStates.has(agent.state));
    const activity = active.length ? `<ul class="detail-list">${active.slice(0, 6).map((agent) => `<li>${entityLink("agent", agent.id, agent.name)}<span>${escapeHtml(stateText(agent.state))} · ${escapeHtml(view.rooms.find((room) => room.id === agent.roomId)?.label || agent.roomId)}</span></li>`).join("")}</ul>` : `<p>저장된 활성 작업이 없습니다. 캐릭터를 움직이지 않습니다.</p>`;
    const interactions = Object.values(view.world?.interactions || {}).filter((interaction) => interaction.phase && interaction.phase !== "completed" && interaction.phase !== "resolved");
    const worldActivity = interactions.length ? `<ul class="detail-list">${interactions.slice(0, 5).map((interaction) => `<li><span>${escapeHtml(interaction.kind || "interaction")}</span><span>${escapeHtml(interaction.phase)}</span></li>`).join("")}</ul>` : `<p>진행 중인 협업·핸드오프가 없습니다.</p>`;
    const rooms = view.rooms.filter((room) => room.occupants.length).map((room) => `<li>${entityLink("room", room.id, room.label)}<span>${room.occupants.length}명 · ${room.activeCount} active</span></li>`).join("");
    return `<div class="truth-banner"><strong>Projection only</strong><span>마을은 append-only semantic event에서 재구성됩니다. 생성형 작업에는 임의의 퍼센트를 표시하지 않습니다.</span></div><div class="metric-grid"><div class="metric"><span>에이전트</span><strong>${view.summary.totalAgents}</strong></div><div class="metric"><span>활동 중</span><strong>${view.summary.activeAgents}</strong></div><div class="metric"><span>작업</span><strong>${view.summary.taskCount}</strong></div><div class="metric"><span>이벤트</span><strong>${view.summary.eventCount}</strong></div></div><section class="inspector-section"><h3>현재 시스템 상태</h3>${activity}</section><section class="inspector-section"><h3>현재 월드 상호작용</h3>${worldActivity}</section><section class="inspector-section"><h3>점유 공간</h3>${rooms ? `<ul class="detail-list">${rooms}</ul>` : "<p>기록된 에이전트가 없습니다.</p>"}</section>${view.needsUser.length ? `<section class="inspector-section"><h3>사용자에게 필요한 것</h3><ul class="detail-list">${view.needsUser.map((need) => `<li>${need.agentId ? entityLink("agent", need.agentId, need.agentId) : escapeHtml(need.taskId || "작업")}<span>${escapeHtml(need.reason)}</span></li>`).join("")}</ul></section>` : ""}`;
  }

  function agentInspector(view, agent) {
    if (!agent) return summaryInspector(view);
    const deps = agent.dependencies.length ? `<ul class="detail-list">${agent.dependencies.map((dependency) => `<li>${entityLink("dependency", dependency.id, dependency.label)}<span>${escapeHtml(dependency.status)}</span></li>`).join("")}</ul>` : `<p>기록된 의존성 없음</p>`;
    const artifacts = agent.artifacts.length ? `<ul class="detail-list">${agent.artifacts.map((artifact) => `<li>${entityLink("artifact", artifact.id, artifact.name)}<span>${escapeHtml(artifact.status || "CREATED")}</span></li>`).join("")}</ul>` : `<p>기록된 산출물 없음</p>`;
    const history = agent.activityHistory.length ? `<ul class="detail-list">${agent.activityHistory.slice(0, 6).map((event) => `<li><span>${escapeHtml(event.type || "EVENT")}</span><span>${escapeHtml(formatTime(event.createdAt))}</span></li>`).join("")}</ul>` : `<p>최근 저장 활동 없음</p>`;
    const record = agent.fullContent ? `<details><summary class="record-toggle">전체 기록 보기</summary><pre class="record">${escapeHtml(agent.fullContent)}</pre></details>` : "";
    const movement = agent.movement ? `${agent.movement.reason || "이벤트 이동"} · ${agent.movement.path?.length || 0} cells` : "현재 이동 intent 없음";
    const location = agent.location ? `${Math.round(agent.location.x)}, ${Math.round(agent.location.y)}` : "좌표 기록 없음";
    return `<div class="agent-meta"><strong>${escapeHtml(agent.role)}</strong><span>${escapeHtml(agent.provider)} · ${escapeHtml(agent.model)}</span></div><dl class="detail-dl"><dt>상태</dt><dd>${escapeHtml(stateText(agent.state))}</dd><dt>위치</dt><dd>${escapeHtml(view.rooms.find((room) => room.id === agent.roomId)?.label || agent.roomId)} · ${escapeHtml(location)}</dd><dt>이동 근거</dt><dd>${escapeHtml(movement)}</dd><dt>현재 작업</dt><dd>${escapeHtml(agent.currentTask || "기록된 작업 없음")}</dd><dt>목표</dt><dd>${escapeHtml(agent.currentGoal || "기록된 목표 없음")}</dd></dl>${agent.progress ? `<div class="truth-banner"><strong>실제 카운터</strong><span>${agent.progress.current}/${agent.progress.total} ${escapeHtml(agent.progress.unit)}</span></div>` : `<p class="empty-copy">생성형 작업 카운터 없음 · 단계로 표시</p>`}<section class="inspector-section"><h3>Working with</h3><p>${agent.collaborators.length ? agent.collaborators.map((id) => entityLink("agent", id, view.agents.find((item) => String(item.id) === String(id))?.name || id)).join(" · ") : "기록된 협업 상대 없음"}</p></section><section class="inspector-section"><h3>Dependencies</h3>${deps}</section><section class="inspector-section"><h3>Inputs / Outputs</h3><p>${escapeHtml([...agent.inputs, ...agent.outputs].join(" · ") || "기록된 입출력 없음")}</p></section><section class="inspector-section"><h3>Artifacts</h3>${artifacts}</section><section class="inspector-section"><h3>Recent activity</h3>${history}</section>${agent.needsUser.length ? `<div class="sim-label">사용자 입력 ${agent.needsUser.length}건 필요</div>` : ""}${record}`;
  }

  function selectedInspector(view) {
    const selection = appState.selection;
    if (selection.type === "agent") return agentInspector(view, view.agents.find((agent) => String(agent.id) === String(selection.id)));
    if (selection.type === "room") {
      const room = view.rooms.find((item) => item.id === selection.id);
      return room ? `<div class="truth-banner"><strong>${escapeHtml(room.label)}</strong><span>${escapeHtml(room.purpose)}</span></div><section class="inspector-section"><h3>Occupants</h3>${room.occupants.length ? `<ul class="detail-list">${room.occupants.map((id) => `<li>${entityLink("agent", id, view.agents.find((agent) => String(agent.id) === String(id))?.name || id)}<span>${escapeHtml(stateText(view.agents.find((agent) => String(agent.id) === String(id))?.state))}</span></li>`).join("")}</ul>` : "<p>이 공간에 기록된 에이전트가 없습니다.</p>"}</section>` : summaryInspector(view);
    }
    if (selection.type === "event") {
      const event = view.eventFeed.find((item) => String(item.id) === String(selection.id));
      return event ? `<div class="sim-label">${event.simulation ? "시뮬레이션 기록" : "저장된 기록"}</div><dl class="detail-dl"><dt>이벤트</dt><dd>${escapeHtml(event.title)}</dd><dt>에이전트</dt><dd>${event.agentId ? entityLink("agent", event.agentId, event.agentName) : escapeHtml(event.agentName)}</dd><dt>상태</dt><dd>${escapeHtml(stateText(event.state))}</dd><dt>시각</dt><dd>${escapeHtml(formatTime(event.createdAt))}</dd><dt>요약</dt><dd>${escapeHtml(event.body)}</dd></dl>${event.fullContent ? `<details open><summary class="record-toggle">전체 이벤트 기록</summary><pre class="record">${escapeHtml(event.fullContent)}</pre></details>` : ""}${event.raw ? `<details><summary class="record-toggle">raw provider data</summary><pre class="record">${escapeHtml(JSON.stringify(event.raw, null, 2))}</pre></details>` : ""}` : summaryInspector(view);
    }
    if (selection.type === "task") {
      const task = view.tasks.find((item) => String(item.id) === String(selection.id));
      return task ? `<dl class="detail-dl"><dt>작업</dt><dd>${escapeHtml(task.title)}</dd><dt>상태</dt><dd>${escapeHtml(task.status)}</dd><dt>담당</dt><dd>${task.ownerAgentId ? entityLink("agent", task.ownerAgentId, task.ownerName) : "미배정"}</dd><dt>설명</dt><dd>${escapeHtml(task.detail || "기록된 설명 없음")}</dd></dl>` : summaryInspector(view);
    }
    if (selection.type === "artifact") {
      const artifact = view.artifacts.find((item) => String(item.id) === String(selection.id));
      return artifact ? `<dl class="detail-dl"><dt>산출물</dt><dd>${escapeHtml(artifact.name)}</dd><dt>상태</dt><dd>${escapeHtml(artifact.status)}</dd><dt>종류</dt><dd>${escapeHtml(artifact.kind)}</dd><dt>경로</dt><dd>${escapeHtml(artifact.path || "기록 없음")}</dd><dt>생성자</dt><dd>${artifact.ownerAgentId ? entityLink("agent", artifact.ownerAgentId, view.agents.find((agent) => String(agent.id) === String(artifact.ownerAgentId))?.name || artifact.ownerAgentId) : "기록 없음"}</dd></dl>` : summaryInspector(view);
    }
    if (selection.type === "dependency") {
      const dependency = view.dependencies.find((item) => String(item.id) === String(selection.id));
      return dependency ? `<dl class="detail-dl"><dt>필요 항목</dt><dd>${escapeHtml(dependency.label)}</dd><dt>상태</dt><dd>${escapeHtml(dependency.status)}</dd><dt>작업</dt><dd>${entityLink("task", dependency.taskId, view.tasks.find((task) => String(task.id) === String(dependency.taskId))?.title || dependency.taskId)}</dd><dt>사유</dt><dd>${escapeHtml(dependency.reason || "기록된 사유 없음")}</dd></dl>` : summaryInspector(view);
    }
    if (selection.type === "conversation") {
      const conversation = view.conversations.find((item) => String(item.id) === String(selection.id));
      return conversation ? `<section class="inspector-section"><h3>${escapeHtml(conversation.title || "Agent conversation")}</h3><div class="conversation-record">${conversation.messages.map((message) => `<article><strong>${escapeHtml(message.senderName)}</strong><p>${escapeHtml(message.fullContent)}</p><small>${escapeHtml(formatTime(message.createdAt))}</small></article>`).join("") || "<p>기록된 메시지 없음</p>"}</div></section>` : summaryInspector(view);
    }
    return summaryInspector(view);
  }

  function inspectorTitle(view) {
    const selection = appState.selection;
    if (selection.type === "agent") return view.agents.find((agent) => String(agent.id) === String(selection.id))?.name || "Village summary";
    if (selection.type === "room") return view.rooms.find((room) => room.id === selection.id)?.label || "Village summary";
    if (selection.type === "event") return view.eventFeed.find((event) => String(event.id) === String(selection.id))?.title || "Village summary";
    if (selection.type === "task") return view.tasks.find((task) => String(task.id) === String(selection.id))?.title || "Village summary";
    return "Village summary";
  }

  function inspectorState(view) {
    if (appState.selection.type === "agent") return view.agents.find((agent) => String(agent.id) === String(appState.selection.id))?.state || "OFFLINE";
    if (appState.selection.type === "event") return view.eventFeed.find((event) => String(event.id) === String(appState.selection.id))?.state || "OFFLINE";
    return view.summary.eventCount ? "LIVE" : "OFFLINE";
  }

  function renderInspector(view) {
    const title = inspectorTitle(view);
    $("inspectorTitle").textContent = title;
    $("inspectorSubtitle").textContent = view.project ? `${view.project.name} · full record on selection` : "선택하면 전체 기록을 확인합니다.";
    const badge = $("inspectorState");
    const state = inspectorState(view);
    badge.textContent = stateText(state);
    badge.dataset.state = state;
    $("inspectorContent").innerHTML = selectedInspector(view);
    bindEntityLinks();
  }

  function render() {
    if (!model) return;
    const view = currentView();
    appState.view = view;
    ensurePixelWorld();
    if (appState.engine) appState.engine.setSnapshot(view);
    renderProjects(view);
    renderTop(view);
    renderRooms(view);
    renderAgents(view);
    renderFeed(view);
    renderInspector(view);
    document.querySelectorAll("[data-zoom]").forEach((button) => { if (button.dataset.zoom) { button.classList.toggle("is-active", button.dataset.zoom === appState.zoom); button.setAttribute("aria-pressed", button.dataset.zoom === appState.zoom ? "true" : "false"); } });
    $("villageViewport").dataset.zoom = appState.zoom;
  }

  function explainActivity() {
    const view = appState.view || currentView();
    const active = view.agents.filter((agent) => activeStates.has(agent.state));
    const lines = view.summary.eventCount === 0 ? ["아직 append-only event가 없습니다.", "어댑터가 semantic event를 보내거나 샘플 시나리오를 명시적으로 재생하세요."] : [`이 화면은 ${view.summary.eventCount}개 저장 이벤트에서 재구성되었습니다.`, active.length ? `${active.length}명의 에이전트가 기록된 활동을 갖고 있습니다.` : "활성 상태로 기록된 에이전트가 없습니다.", ...active.slice(0, 5).map((agent) => `${agent.name}: ${stateText(agent.state)} · ${view.rooms.find((room) => room.id === agent.roomId)?.label || agent.roomId}`), view.needsUser.length ? `사용자 입력 필요 ${view.needsUser.length}건` : "사용자 입력 요청 없음"];
    appState.selection = { type: "summary", id: null };
    render();
    $("inspectorContent").insertAdjacentHTML("afterbegin", `<pre class="explanation">${escapeHtml(lines.join("\n"))}</pre>`);
  }

  function needsMe() {
    const view = appState.view || currentView();
    const need = view.needsUser[0];
    if (need?.agentId) return selectEntity("agent", need.agentId);
    if (need?.taskId) return selectEntity("task", need.taskId);
    explainActivity();
  }

  async function playDemo() {
    const button = $("demoButton");
    button.disabled = true;
    button.textContent = "시뮬레이션 기록 중…";
    try {
      const result = await api("/api/demo", { method: "POST" });
      appState.snapshot = result.state;
      appState.projectId = result.events[0]?.projectId || appState.projectId;
      appState.selection = { type: "summary", id: null };
      render();
      setConnection("LOCAL · simulation records", "live");
    } catch (error) {
      setConnection(`LOCAL · error · ${error.message}`, "error");
    } finally {
      button.disabled = false;
      button.innerHTML = "샘플 시나리오 재생 <small>(SIMULATION · 시뮬레이션)</small>";
    }
  }

  async function sendEvent() {
    const status = $("eventInputStatus");
    try {
      const input = JSON.parse($("eventJson").value);
      const result = await api("/api/events", { method: "POST", body: JSON.stringify(input) });
      appState.snapshot = await api("/api/state");
      appState.projectId = input.projectId || input.payload?.projectId || appState.projectId;
      render();
      status.textContent = `기록됨 · sequence ${result.sequence}`;
      status.dataset.kind = "ok";
    } catch (error) {
      status.textContent = `실패 · ${error.message}`;
      status.dataset.kind = "error";
    }
  }

  function connectRealtime() {
    if (!window.EventSource) return setConnection("LOCAL · realtime unsupported", "error");
    const source = new EventSource("/api/realtime");
    appState.eventSource = source;
    source.addEventListener("open", () => { const view = appState.view || currentView(); setConnection(view.summary.eventCount ? "LOCAL · live event stream" : "LOCAL · waiting for events", view.summary.eventCount ? "live" : "waiting"); });
    source.addEventListener("snapshot", (message) => { try { appState.snapshot = JSON.parse(message.data).state; render(); } catch (error) { setConnection(`LOCAL · snapshot error · ${error.message}`, "error"); } });
    source.addEventListener("semantic", (message) => { try { const data = JSON.parse(message.data); if (data.event?.type === "PROJECT_CREATED" && data.event.projectId) appState.projectId = data.event.projectId; appState.snapshot = data.state; render(); } catch (error) { setConnection(`LOCAL · event error · ${error.message}`, "error"); } });
    source.addEventListener("demo", (message) => { try { const data = JSON.parse(message.data); appState.projectId = data.events?.[0]?.projectId || appState.projectId; appState.snapshot = data.state; render(); } catch (error) { setConnection(`LOCAL · demo error · ${error.message}`, "error"); } });
    source.onerror = () => setConnection("LOCAL · reconnecting…", "reconnecting");
  }

  async function init() {
    $("projectSelect").addEventListener("change", (event) => { appState.projectId = event.target.value; appState.selection = { type: "summary", id: null }; render(); });
    $("demoButton").addEventListener("click", playDemo);
    $("sendEventButton").addEventListener("click", sendEvent);
    $("explainButton").addEventListener("click", explainActivity);
    $("needsButton").addEventListener("click", needsMe);
    document.querySelectorAll("[data-zoom]").forEach((button) => button.addEventListener("click", () => { appState.zoom = button.dataset.zoom; render(); }));
    try { appState.snapshot = await api("/api/state"); render(); connectRealtime(); } catch (error) { setConnection(`LOCAL · error · ${error.message}`, "error"); render(); }
    window.addEventListener("beforeunload", () => { appState.eventSource?.close(); appState.engine?.destroy(); });
  }

  window.AiVillageApp = { render, playDemo, sendEvent, getState: () => appState.snapshot };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true }); else init();
})();
