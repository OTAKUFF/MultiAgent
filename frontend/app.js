/* ── Constants & Config ───────────────────────────────────────────── */
const WS_URL = "ws://127.0.0.1:8766";
const TEAM = [
  {id:"Mike",  role:"TeamLeader",    color:"#4f8cff", initial:"M"},
  {id:"Alice", role:"ProductManager", color:"#e84393", initial:"A"},
  {id:"Bob",   role:"Architect",     color:"#7c3aed", initial:"B"},
  {id:"Alex",  role:"Engineer",      color:"#ea580c", initial:"X"},
  {id:"Dana",  role:"DataAnalyst",   color:"#059669", initial:"D"},
  {id:"Eve",   role:"QA",           color:"#d97706", initial:"E"},
  {id:"David", role:"Developer",     color:"#0d9488", initial:"V"},
];
const ROLE_COLOR = {};
const ROLE_INITIAL = {};
TEAM.forEach(m => { ROLE_COLOR[m.id] = m.color; ROLE_INITIAL[m.id] = m.initial; });

/* ── State ────────────────────────────────────────────────────────── */
let ws, forgeRunning = false;
let llmBuffer = "", thinkingEl = null;
let projects = [];          // all project objects
let activeProjectId = null; // currently selected project id (null = new project mode)
let previewMode = null;     // null | "viewer" | "editor"
let isResizing = false;
let menuTargetId = null;    // project id for context menu
let openTabs = [];          // [{filePath, fileName, treeItem}]
let activeTabPath = null;

/* ── Helpers ──────────────────────────────────────────────────────── */
function now(){ return new Date().toLocaleTimeString("zh-CN",{hour12:false}); }
function escHtml(s){ const d=document.createElement("div"); d.textContent=s; return d.innerHTML; }
function renderMarkdown(text){
  let html = escHtml(text);
  html = html.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code}</code></pre>`);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  return html;
}
function getActiveProject(){
  return projects.find(p => p.id === activeProjectId) || null;
}

/* ── Project Management ──────────────────────────────────────────── */
function createProject(idea){
  const ts = Math.floor(Date.now() / 1000);
  const name = idea.length > 20 ? idea.slice(0, 20) + "..." : idea;
  const proj = {
    id: "tmp_" + ts,
    name: name,
    timestamp: String(ts),
    path: "",
    status: "running",
    chatHistory: []
  };
  projects.unshift(proj);
  activeProjectId = proj.id;
  renderProjectList();
  return proj;
}

function switchProject(id){
  if(forgeRunning && activeProjectId !== id){
    // Don't switch away from running project's chat, but allow selecting it
  }
  activeProjectId = id;
  renderProjectList();
  renderChatHistory();
  const input = document.getElementById("chatInput");
  const btn = document.getElementById("sendBtn");
  const proj = getActiveProject();
  if(proj && proj.status === "running"){
    input.placeholder = "项目运行中，请等待完成...";
    input.disabled = true;
    btn.disabled = true;
  } else if(proj && proj.path){
    input.placeholder = "补充需求，团队将在此项目上增量开发...";
    input.disabled = false;
    btn.disabled = false;
    btn.textContent = "发送";
  } else {
    input.placeholder = "输入你的需求，例如：制作一个打砖块游戏...";
    input.disabled = false;
    btn.disabled = false;
    btn.textContent = "发送";
  }
}

function updateProjectPath(path){
  const proj = getActiveProject();
  if(!proj) return;
  proj.path = path;
  // Update id from temp to directory name
  const dirName = path.replace(/\\/g, "/").split("/").pop();
  if(dirName && proj.id.startsWith("tmp_")){
    proj.id = dirName;
    activeProjectId = dirName;
  }
  renderProjectList();
}

function updateProjectStatus(status){
  const proj = getActiveProject();
  if(!proj) return;
  proj.status = status;
  renderProjectList();
  // Re-enable input if finished
  if(status === "finished" || status === "error"){
    const input = document.getElementById("chatInput");
    const btn = document.getElementById("sendBtn");
    input.disabled = false;
    btn.disabled = false;
    btn.textContent = "发送";
    if(proj.path){
      input.placeholder = "补充需求，团队将在此项目上增量开发...";
    }
  }
}

function loadProjects(){
  fetch("/api/projects").then(r => r.json()).then(data => {
    const serverProjects = data.projects || [];
    // Merge server projects with local ones (keep local running projects)
    serverProjects.forEach(sp => {
      const existing = projects.find(p => p.id === sp.id);
      if(existing){
        existing.path = sp.path || existing.path;
        existing.name = sp.name || existing.name;
        existing.timestamp = sp.timestamp || existing.timestamp;
        if(existing.status !== "running") existing.status = "finished";
      } else {
        projects.push({
          id: sp.id,
          name: sp.name,
          timestamp: sp.timestamp,
          path: sp.path || "",
          status: "finished",
          chatHistory: []
        });
      }
    });
    // Sort: running first, then by timestamp desc
    projects.sort((a, b) => {
      if(a.status === "running" && b.status !== "running") return -1;
      if(b.status === "running" && a.status !== "running") return 1;
      return (parseInt(b.timestamp)||0) - (parseInt(a.timestamp)||0);
    });
    renderProjectList();
  }).catch(() => {});
}

function renderProjectList(){
  const list = document.getElementById("projectList");
  list.innerHTML = "";
  projects.forEach(p => {
    const div = document.createElement("div");
    div.className = "project-item" + (p.id === activeProjectId ? " active" : "");
    div.dataset.id = p.id;
    let timeStr = "";
    if(p.timestamp){
      const ts = parseInt(p.timestamp);
      if(!isNaN(ts)) timeStr = new Date(ts * 1000).toLocaleString("zh-CN");
    }
    const statusLabel = p.status === "running" ? "运行中" : (p.status === "error" ? "出错" : "");
    const statusClass = p.status === "running" ? "" : (p.status === "error" ? "error" : "done");
    div.innerHTML =
      `<div class="p-info">` +
      `<div class="p-name">${escHtml(p.name)}</div>` +
      (timeStr ? `<div class="p-time">${timeStr}</div>` : "") +
      (statusLabel ? `<div class="p-status ${statusClass}">${statusLabel}</div>` : "") +
      `</div>` +
      `<button class="p-menu-btn" data-pid="${escHtml(p.id)}"><span></span><span></span><span></span></button>`;
    div.querySelector(".p-menu-btn").onclick = function(e){
      e.stopPropagation();
      showProjectMenu(e, p.id);
    };
    div.onclick = () => switchProject(p.id);
    list.appendChild(div);
  });
}

/* ── Project Context Menu ────────────────────────────────────────── */
function showProjectMenu(e, projectId){
  menuTargetId = projectId;
  const menu = document.getElementById("projectContextMenu");
  const btn = e.currentTarget;
  const rect = btn.getBoundingClientRect();
  menu.style.top = rect.bottom + 4 + "px";
  menu.style.left = rect.left + "px";
  menu.classList.add("show");
  btn.classList.add("open");
}
function hideProjectMenu(){
  const menu = document.getElementById("projectContextMenu");
  menu.classList.remove("show");
  menuTargetId = null;
  document.querySelectorAll(".p-menu-btn.open").forEach(b => b.classList.remove("open"));
}
function renameProject(){
  const id = menuTargetId;
  hideProjectMenu();
  const proj = projects.find(p => p.id === id);
  if(!proj) return;
  const newName = prompt("输入新名称:", proj.name);
  if(newName !== null && newName.trim()){
    proj.name = newName.trim();
    renderProjectList();
  }
}
function deleteProject(){
  const id = menuTargetId;
  hideProjectMenu();
  const proj = projects.find(p => p.id === id);
  if(!proj) return;
  if(!confirm("确定删除项目「" + proj.name + "」？")) return;
  projects = projects.filter(p => p.id !== id);
  if(activeProjectId === id){
    activeProjectId = null;
    newProject();
  }
  renderProjectList();
}
document.addEventListener("click", function(e){
  const menu = document.getElementById("projectContextMenu");
  if(menu && !menu.contains(e.target) && !e.target.closest(".p-menu-btn")){
    hideProjectMenu();
  }
});

/* ── Chat Rendering ──────────────────────────────────────────────── */
function addChatMessage(role, text, type){
  const empty = document.getElementById("chatEmpty");
  if(empty) empty.remove();
  removeThinking();

  // Store in active project's history
  const proj = getActiveProject();
  if(proj){
    proj.chatHistory.push({ role: role, text: text, type: type, time: now() });
  }

  _renderOneMessage(role, text, type, now());
}

function _renderOneMessage(role, text, type, time){
  const scroll = document.getElementById("chatScroll");
  const wrap = document.createElement("div");
  if(type === "system"){
    wrap.className = "chat-msg system";
    wrap.innerHTML = `<div class="chat-bubble">${renderMarkdown(text)}</div>`;
  } else if(type === "user"){
    wrap.className = "chat-msg user";
    wrap.innerHTML =
      `<div class="chat-avatar" style="background:var(--accent)">U</div>` +
      `<div><div class="chat-bubble">${renderMarkdown(text)}</div>` +
      `<div class="chat-time" style="text-align:right">${time}</div></div>`;
  } else {
    const c = ROLE_COLOR[role] || "#64748b";
    const ini = ROLE_INITIAL[role] || (role ? role[0].toUpperCase() : "?");
    wrap.className = "chat-msg role";
    wrap.innerHTML =
      `<div class="chat-avatar" style="background:${c}">${ini}</div>` +
      `<div><div class="chat-sender" style="color:${c}">${escHtml(role||"System")}</div>` +
      `<div class="chat-bubble">${renderMarkdown(text)}</div>` +
      `<div class="chat-time">${time}</div></div>`;
  }
  scroll.appendChild(wrap);
  while(scroll.children.length > 300) scroll.removeChild(scroll.firstChild);
  scroll.scrollTop = scroll.scrollHeight;
}

function renderChatHistory(){
  const scroll = document.getElementById("chatScroll");
  scroll.innerHTML = "";
  const proj = getActiveProject();
  if(!proj || proj.chatHistory.length === 0){
    scroll.innerHTML =
      `<div class="chat-empty" id="chatEmpty">` +
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/></svg>` +
      `<p>输入需求，开始与 AI 团队协作</p></div>`;
    return;
  }
  proj.chatHistory.forEach(msg => {
    _renderOneMessage(msg.role, msg.text, msg.type, msg.time);
  });
}

/* ── Thinking Indicator ──────────────────────────────────────────── */
function showThinking(){
  if(thinkingEl) return;
  const scroll = document.getElementById("chatScroll");
  thinkingEl = document.createElement("div");
  thinkingEl.className = "thinking-indicator";
  thinkingEl.innerHTML =
    `<div class="thinking-dots"><span></span><span></span><span></span></div>` +
    `<span>AI 思考中...</span>` +
    `<div class="thinking-content" id="thinkingContent"></div>`;
  thinkingEl.onclick = () => thinkingEl.classList.toggle("expanded");
  scroll.appendChild(thinkingEl);
  scroll.scrollTop = scroll.scrollHeight;
}
function updateThinking(text){
  if(!thinkingEl) showThinking();
  const content = thinkingEl.querySelector(".thinking-content");
  if(content) content.textContent = text.slice(-2000);
}
function removeThinking(){
  if(thinkingEl){ thinkingEl.remove(); thinkingEl = null; }
}

/* ── WebSocket Message Handler ────────────────────────────────────── */
function handleMessage(data){
  const block = data.block || "";
  const name  = data.name  || "";
  const value = data.value;
  const role  = data.role  || "";

  // Control: project_path
  if(block === "Control" && name === "project_path"){
    updateProjectPath(value);
    return;
  }

  // Control: status
  if(block === "Control" && name === "status"){
    const btn = document.getElementById("sendBtn");
    if(value === "running"){
      forgeRunning = true;
      btn.textContent = "运行中...";
      btn.disabled = true;
    } else {
      forgeRunning = false;
      removeThinking();
      if(value === "finished"){
        addChatMessage(null, "Code Forge 运行完成", "system");
        updateProjectStatus("finished");
        // Auto-refresh preview if open
        if(previewMode){
          const proj = getActiveProject();
          if(proj && proj.path){
            if(previewMode === "viewer") loadAppViewer(proj);
            else loadCodeEditor(proj);
          }
        }
      } else if(value === "error"){
        addChatMessage(null, "Code Forge 运行出错", "system");
        updateProjectStatus("error");
      }
      btn.textContent = "发送";
      btn.disabled = false;
    }
    return;
  }

  // LLM streaming tokens
  if(name === "content" && typeof value === "string"){
    llmBuffer += value;
    showThinking();
    updateThinking(llmBuffer);
    return;
  }
  // LLM stream end
  if(name === "end_marker"){
    llmBuffer = "";
    removeThinking();
    return;
  }
  // Task list update
  if(block === "Task" && name === "object" && value && value.tasks){
    addChatMessage(role || "System", "任务状态更新 — 当前: " + (value.current_task_id || "—"), "role");
    return;
  }
  // Thought events
  if(block === "Thought" && name === "object" && value){
    const type = value.type || "";
    const stage = value.stage || "";
    const labels = {"react":"思考中","classify":"意图分类","quick":"快速回答","search":"搜索增强"};
    addChatMessage(role, (labels[type] || type) + (stage ? " / " + stage : ""), "role");
    return;
  }
  // Docs events
  if(block === "Docs"){
    if(name === "meta" && value && value.type){
      const labels = {"prd":"需求文档","design":"系统设计","task":"任务列表"};
      addChatMessage(role || "Alice", "正在撰写" + (labels[value.type] || value.type) + "...", "role");
    } else if(name === "path"){
      const filename = String(value).split(/[\\/]/).pop();
      addChatMessage(role || "System", "文档已保存: " + filename, "role");
    }
    return;
  }

  // Editor events
  if(block === "Editor"){
    if(name === "meta" && value && value.filename){
      addChatMessage(role || "Alex", "正在编写: " + value.filename, "role");
    } else if(name === "path"){
      const filename = String(value).split(/[\\/]/).pop();
      addChatMessage(role || "Alex", "代码已保存: " + filename, "role");
    }
    return;
  }
  // Terminal events
  if(block === "Terminal" && name === "cmd"){
    addChatMessage(role || "Alex", "$ " + String(value).trim().slice(0,80), "role");
    return;
  }
  // Log messages
  if(block === "Log"){
    addChatMessage(role || "System", value, "role");
    return;
  }
}

/* ── WebSocket Connection ────────────────────────────────────────── */
function connect(){
  ws = new WebSocket(WS_URL);
  const dot  = document.getElementById("connDot");
  const text = document.getElementById("connText");
  ws.onopen = () => {
    dot.classList.add("on");
    text.textContent = "已连接";
    addChatMessage(null, "已连接到 Code Forge 服务，请输入需求开始", "system");
  };
  ws.onmessage = (e) => {
    try { handleMessage(JSON.parse(e.data)); }
    catch(err){ addChatMessage(null, "消息解析失败", "system"); }
  };
  ws.onclose = () => {
    dot.classList.remove("on");
    text.textContent = "已断开";
    setTimeout(connect, 5000);
  };
  ws.onerror = () => ws.close();
}

/* ── Send / Start ────────────────────────────────────────────────── */
function sendMessage(){
  const input = document.getElementById("chatInput");
  const btn = document.getElementById("sendBtn");
  const idea = input.value.trim();
  if(!idea) return;

  // Determine new vs incremental mode
  const proj = getActiveProject();
  const isIncremental = proj && proj.path && (proj.status === "finished" || proj.status === "error");

  if(!isIncremental && !activeProjectId){
    // New project mode
    createProject(idea);
  }

  addChatMessage(null, idea, "user");
  input.value = "";
  input.style.height = "auto";

  if(forgeRunning){
    addChatMessage(null, "Code Forge 正在运行中，请等待完成...", "system");
    return;
  }

  // Mark project as running again for incremental
  if(isIncremental && proj){
    proj.status = "running";
    renderProjectList();
  }

  btn.textContent = "提交中...";
  btn.disabled = true;
  input.disabled = true;

  const body = { idea: idea };
  if(isIncremental && proj) body.project_path = proj.path;

  fetch("/start", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(body)
  }).then(r => r.json()).then(data => {
    if(data.error){
      addChatMessage(null, data.error, "system");
      btn.textContent = "发送";
      btn.disabled = false;
      input.disabled = false;
    }
  }).catch(err => {
    addChatMessage(null, "请求失败: " + err.message, "system");
    btn.textContent = "发送";
    btn.disabled = false;
    input.disabled = false;
  });
}

/* ── Input: Enter/Shift+Enter & Auto-resize ──────────────────────── */
const chatInput = document.getElementById("chatInput");
chatInput.addEventListener("keydown", function(e){
  if(e.key === "Enter" && !e.shiftKey){
    e.preventDefault();
    sendMessage();
  }
});
chatInput.addEventListener("input", function(){
  this.style.height = "auto";
  this.style.height = Math.min(this.scrollHeight, 120) + "px";
});

/* ── New Project Button ──────────────────────────────────────────── */
function newProject(){
  activeProjectId = null;
  const scroll = document.getElementById("chatScroll");
  scroll.innerHTML =
    `<div class="chat-empty" id="chatEmpty">` +
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/></svg>` +
    `<p>输入需求，开始与 AI 团队协作</p></div>`;
  const input = document.getElementById("chatInput");
  const btn = document.getElementById("sendBtn");
  input.placeholder = "输入你的需求，例如：制作一个打砖块游戏...";
  input.disabled = false;
  btn.disabled = false;
  btn.textContent = "发送";
  input.focus();
  renderProjectList();
}

/* ── Panel Toggle ────────────────────────────────────────────────── */
function toggleLeft(){
  document.getElementById("mainGrid").classList.toggle("left-collapsed");
  document.getElementById("toggleLeft").classList.toggle("active");
}

/* ── Preview Panel ───────────────────────────────────────────────── */
function openPreview(mode){
  previewMode = mode;
  const grid = document.getElementById("mainGrid");
  const viewer = document.getElementById("appViewer");
  const editor = document.getElementById("codeEditor");
  const title = document.getElementById("rightPanelTitle");
  const btnV = document.getElementById("btnViewer");
  const btnE = document.getElementById("btnEditor");

  grid.classList.add("right-open");
  btnV.classList.toggle("active", mode === "viewer");
  btnE.classList.toggle("active", mode === "editor");

  if(mode === "viewer"){
    viewer.style.display = "flex";
    editor.style.display = "none";
    title.textContent = "应用查看器";
    const proj = getActiveProject();
    if(proj && proj.path) loadAppViewer(proj);
    else showViewerMsg("请先选择一个项目");
  } else {
    viewer.style.display = "none";
    editor.style.display = "grid";
    title.textContent = "代码编辑器";
    const proj = getActiveProject();
    if(proj && proj.path) loadCodeEditor(proj);
    else document.getElementById("fileTree").innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:0.8rem">请先选择一个项目</div>';
  }
}

function closePreview(){
  previewMode = null;
  const grid = document.getElementById("mainGrid");
  grid.classList.remove("right-open");
  document.getElementById("btnViewer").classList.remove("active");
  document.getElementById("btnEditor").classList.remove("active");
  document.getElementById("appViewer").style.display = "none";
  document.getElementById("codeEditor").style.display = "none";
  // Clear iframe
  document.getElementById("previewIframe").src = "about:blank";
  // Reset custom width
  grid.style.gridTemplateColumns = "";
}

function showViewerMsg(msg){
  const iframe = document.getElementById("previewIframe");
  const msgEl = document.getElementById("viewerMsg");
  iframe.style.display = "none";
  iframe.src = "about:blank";
  iframe.onload = null;
  iframe.onerror = null;
  msgEl.style.display = "flex";
  msgEl.textContent = msg;
}

/* ── App Viewer ──────────────────────────────────────────────────── */
function loadAppViewer(proj){
  const iframe = document.getElementById("previewIframe");
  const msgEl = document.getElementById("viewerMsg");
  // Always show message first, hide iframe
  iframe.style.display = "none";
  iframe.src = "about:blank";
  msgEl.style.display = "flex";
  msgEl.textContent = "检测项目类型...";

  fetch("/api/project-info?path=" + encodeURIComponent(proj.path))
    .then(r => r.json())
    .then(info => {
      if(info.type === "web_built" || info.type === "web_static"){
        const dirName = proj.path.replace(/\\/g, "/").split("/").pop();
        const previewUrl = "/preview/" + encodeURIComponent(dirName) + "/index.html";
        msgEl.textContent = "加载应用中...";
        // Set up load/error handlers before setting src
        iframe.onload = function(){
          // Check if iframe actually loaded content (not about:blank)
          if(iframe.src && !iframe.src.endsWith("about:blank")){
            iframe.style.display = "block";
            msgEl.style.display = "none";
          }
        };
        iframe.onerror = function(){
          showViewerMsg("应用加载失败，请尝试代码编辑器查看");
        };
        iframe.src = previewUrl;
        // Fallback: if iframe doesn't load within 8s, show error
        setTimeout(function(){
          if(iframe.style.display === "none" && msgEl.textContent === "加载应用中..."){
            showViewerMsg("应用加载超时，可能不支持预览。已切换到代码编辑器");
            setTimeout(() => openPreview("editor"), 1500);
          }
        }, 8000);
      } else if(info.type === "python"){
        showViewerMsg("Python 项目不支持应用预览，正在切换到代码编辑器...");
        setTimeout(() => openPreview("editor"), 800);
      } else if(info.type === "web_unbuilt"){
        showViewerMsg("项目尚未构建（缺少 dist/），请先运行 npm run build");
      } else {
        showViewerMsg("未检测到可预览的应用（需要 index.html）");
      }
    })
    .catch(err => {
      console.error("project-info fetch failed:", err);
      showViewerMsg("无法检测项目类型: " + (err.message || "请求失败"));
    });
}

/* ── Code Editor ─────────────────────────────────────────────────── */
function loadCodeEditor(proj){
  const tree = document.getElementById("fileTree");
  const content = document.getElementById("codeContent");
  tree.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:0.8rem">加载中...</div>';
  content.innerHTML = '<div class="no-file">选择文件查看代码</div>';
  openTabs = [];
  activeTabPath = null;
  renderTabs();

  fetch("/api/project-files?path=" + encodeURIComponent(proj.path))
    .then(r => r.json())
    .then(data => {
      tree.innerHTML = "";
      renderFileTree(data.files || [], tree, 0, proj.path);
    })
    .catch(() => {
      tree.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:0.8rem">加载失败</div>';
    });
}

/* ── File Tree Rendering ──────────────────────────────────────────── */
function renderFileTree(entries, container, depth, projPath){
  entries.forEach(entry => {
    const item = document.createElement("div");
    item.className = "file-tree-item" + (entry.type === "dir" ? " dir" : "");
    item.style.paddingLeft = (10 + depth * 14) + "px";

    if(entry.type === "dir"){
      const arrow = document.createElement("span");
      arrow.className = "arrow";
      arrow.textContent = "\u25B6";
      item.appendChild(arrow);
      const nameSpan = document.createElement("span");
      nameSpan.textContent = entry.name;
      item.appendChild(nameSpan);

      const childContainer = document.createElement("div");
      childContainer.className = "file-tree-children";
      renderFileTree(entry.children || [], childContainer, depth + 1, projPath);

      item.onclick = function(e){
        e.stopPropagation();
        const isOpen = childContainer.classList.toggle("open");
        arrow.classList.toggle("open", isOpen);
      };
      container.appendChild(item);
      container.appendChild(childContainer);
    } else {
      const indent = document.createElement("span");
      indent.style.width = "12px";
      indent.style.flexShrink = "0";
      item.appendChild(indent);
      const nameSpan = document.createElement("span");
      nameSpan.textContent = entry.name;
      item.appendChild(nameSpan);

      item.onclick = function(e){
        e.stopPropagation();
        const filePath = projPath + "/" + entry.path.replace(/\\/g, "/");
        loadFileContent(filePath, item);
      };
      container.appendChild(item);
    }
  });
}

function loadFileContent(filePath, treeItem){
  // Manage tabs
  const fileName = filePath.split("/").pop();
  const existing = openTabs.find(t => t.filePath === filePath);
  if(existing){
    existing.treeItem = treeItem || existing.treeItem;
  } else {
    openTabs.push({ filePath, fileName, treeItem });
  }
  activeTabPath = filePath;
  renderTabs();

  // Highlight active item
  document.querySelectorAll(".file-tree-item.active").forEach(el => el.classList.remove("active"));
  if(treeItem) treeItem.classList.add("active");

  const content = document.getElementById("codeContent");
  content.innerHTML = '<div class="no-file">加载中...</div>';

  fetch("/api/file-content?path=" + encodeURIComponent(filePath))
    .then(r => r.json())
    .then(data => {
      if(data.error){
        content.innerHTML = '<div class="no-file">' + escHtml(data.error) + '</div>';
        return;
      }
      const ext = filePath.split(".").pop().toLowerCase();
      const langMap = {
        js:"javascript", ts:"typescript", tsx:"typescript", jsx:"javascript",
        py:"python", html:"xml", css:"css", json:"json", md:"markdown",
        java:"java", go:"go", rs:"rust", cpp:"cpp", c:"c", sh:"bash",
        yaml:"yaml", yml:"yaml", xml:"xml", sql:"sql", rb:"ruby",
      };
      const lang = langMap[ext] || "";
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      if(lang) code.className = "language-" + lang;
      code.textContent = data.content;
      pre.appendChild(code);
      content.innerHTML = "";
      content.appendChild(pre);
      if(window.hljs) hljs.highlightElement(code);
    })
    .catch(() => {
      content.innerHTML = '<div class="no-file">加载失败</div>';
    });
}

/* ── Editor Tabs ─────────────────────────────────────────────────── */
function renderTabs(){
  const container = document.getElementById("editorTabs");
  if(!container) return;
  container.innerHTML = "";
  openTabs.forEach(tab => {
    const el = document.createElement("div");
    el.className = "editor-tab" + (tab.filePath === activeTabPath ? " active" : "");
    const nameSpan = document.createElement("span");
    nameSpan.textContent = tab.fileName;
    el.appendChild(nameSpan);
    const closeBtn = document.createElement("button");
    closeBtn.className = "tab-close";
    closeBtn.innerHTML = "&times;";
    closeBtn.onclick = function(e){
      e.stopPropagation();
      closeTab(tab.filePath);
    };
    el.appendChild(closeBtn);
    el.onclick = function(){ switchTab(tab.filePath); };
    container.appendChild(el);
  });
}

function switchTab(filePath){
  const tab = openTabs.find(t => t.filePath === filePath);
  if(!tab) return;
  loadFileContent(tab.filePath, tab.treeItem);
}

function closeTab(filePath){
  const idx = openTabs.findIndex(t => t.filePath === filePath);
  if(idx === -1) return;
  openTabs.splice(idx, 1);
  if(activeTabPath === filePath){
    if(openTabs.length > 0){
      const next = openTabs[Math.min(idx, openTabs.length - 1)];
      loadFileContent(next.filePath, next.treeItem);
    } else {
      activeTabPath = null;
      renderTabs();
      const content = document.getElementById("codeContent");
      content.innerHTML = '<div class="no-file">选择文件查看代码</div>';
    }
  } else {
    renderTabs();
  }
}

/* ── Resize Handle ───────────────────────────────────────────────── */
function initResize(){
  const handle = document.getElementById("resizeHandle");
  const grid = document.getElementById("mainGrid");

  handle.addEventListener("mousedown", function(e){
    e.preventDefault();
    isResizing = true;
    handle.classList.add("active");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function onMouseMove(e){
      if(!isResizing) return;
      const totalWidth = window.innerWidth;
      const rightWidth = totalWidth - e.clientX;
      const clamped = Math.max(250, Math.min(rightWidth, totalWidth * 0.6));
      grid.style.gridTemplateColumns =
        "var(--left-width) 1fr 5px " + clamped + "px";
    }
    function onMouseUp(){
      isResizing = false;
      handle.classList.remove("active");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });
}

/* ── Init ────────────────────────────────────────────────────────── */
connect();
loadProjects();
initResize();
