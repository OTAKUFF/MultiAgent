/* ── Constants & Config ───────────────────────────────────────────── */
const WS_URL = "ws://127.0.0.1:8766";
const TEAM = [
  {id:"Mike",  role:"TeamLeader",    title:"团队领导", color:"#4f8cff", initial:"M"},
  {id:"Alice", role:"ProductManager", title:"产品经理", color:"#e84393", initial:"A"},
  {id:"Bob",   role:"Architect",     title:"架构师",   color:"#7c3aed", initial:"B"},
  {id:"Alex",  role:"Engineer",      title:"工程师",   color:"#ea580c", initial:"X"},
  {id:"Dana",  role:"DataAnalyst",   title:"数据分析", color:"#059669", initial:"D"},
  {id:"Eve",   role:"QA",           title:"测试",     color:"#d97706", initial:"E"},
  {id:"David", role:"Developer",     title:"开发者",   color:"#0d9488", initial:"V"},
];
const ROLE_MAP = {};
TEAM.forEach(m => { ROLE_MAP[m.id] = m; });

const STEP_ICONS = {
  "Plan.append_task":"📋","Plan.finish_current_task":"✅",
  "Editor.create_file":"📄","Editor.write":"✏️","Editor.read":"📖",
  "Terminal.run":"💻","Terminal.execute":"💻",
  "TeamLeader.publish_message":"📨",
  "RoleZero.reply_to_human":"💬","end":"⏹️",
  "CheckUI":"👁️","ImageGenerator":"🖼️",
  "Browser.goto":"🌐","Browser.screenshot":"📸",
};
const STEP_LABELS = {
  "Plan.append_task":"添加任务","Plan.finish_current_task":"完成任务",
  "Editor.create_file":"创建文件","Editor.write":"写入文件","Editor.read":"读取文件",
  "Terminal.run":"在终端中运行命令","Terminal.execute":"在终端中运行命令",
  "TeamLeader.publish_message":"发送消息",
  "CheckUI":"可视化检查","ImageGenerator":"生成图像",
  "Browser.goto":"访问网页","Browser.screenshot":"截图",
};

/* ── State ────────────────────────────────────────────────────────── */
let ws, forgeRunning = false;
let llmBuffer = "", thinkingEl = null;
let projects = [];
let activeProjectId = null;
let previewMode = null;
let isResizing = false;
let menuTargetId = null;
let openTabs = [];
let activeTabPath = null;
let lastRoleCardEl = null;   // last rendered role card element
let lastRoleCardRole = null; // role of last card
/* ── Helpers ──────────────────────────────────────────────────────── */
function now(){ return new Date().toLocaleTimeString("zh-CN",{hour12:false}); }
function escHtml(s){ const d=document.createElement("div"); d.textContent=s; return d.innerHTML; }
function renderMarkdown(text){
  let html = escHtml(text);
  html = html.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code}</code></pre>`);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\n/g, '<br>');
  return html;
}
function getActiveProject(){ return projects.find(p => p.id === activeProjectId) || null; }

/* ── Chat History Persistence ────────────────────────────────────── */
function saveChatHistory(projectId){
  if(!projectId) return;
  const proj = projects.find(p => p.id === projectId);
  if(!proj) return;
  try { localStorage.setItem("chat_" + projectId, JSON.stringify(proj.chatHistory)); } catch(e){}
}
function loadChatHistory(projectId){
  try { const raw = localStorage.getItem("chat_" + projectId); if(raw) return JSON.parse(raw); } catch(e){}
  return [];
}
function migrateChatKey(oldId, newId){
  try {
    const raw = localStorage.getItem("chat_" + oldId);
    if(raw){ localStorage.setItem("chat_" + newId, raw); localStorage.removeItem("chat_" + oldId); }
  } catch(e){}
}

/* ── Project Management ──────────────────────────────────────────── */
function createProject(idea){
  const ts = Math.floor(Date.now() / 1000);
  const name = idea.length > 20 ? idea.slice(0, 20) + "..." : idea;
  const proj = { id:"tmp_"+ts, name, timestamp:String(ts), path:"", status:"running", chatHistory:[] };
  projects.unshift(proj);
  activeProjectId = proj.id;
  renderProjectList();
  return proj;
}
function switchProject(id){
  activeProjectId = id;
  lastRoleCardEl = null; lastRoleCardRole = null;
  renderProjectList(); renderChatHistory();
  const input = document.getElementById("chatInput");
  const btn = document.getElementById("sendBtn");
  const proj = getActiveProject();
  if(proj && proj.status === "running"){ input.placeholder="项目运行中，请等待完成..."; input.disabled=true; btn.disabled=true; }
  else if(proj && proj.path){ input.placeholder="补充需求，团队将在此项目上增量开发..."; input.disabled=false; btn.disabled=false; btn.textContent="发送"; }
  else { input.placeholder="输入你的需求，例如：制作一个打砖块游戏..."; input.disabled=false; btn.disabled=false; btn.textContent="发送"; }
}
function updateProjectPath(path){
  const proj = getActiveProject();
  if(!proj) return;
  proj.path = path;
  const dirName = path.replace(/\\/g, "/").split("/").pop();
  if(dirName && proj.id.startsWith("tmp_")){
    const oldId = proj.id; proj.id = dirName; activeProjectId = dirName;
    migrateChatKey(oldId, dirName);
  }
  renderProjectList();
}
function updateProjectStatus(status){
  const proj = getActiveProject();
  if(!proj) return;
  proj.status = status; renderProjectList();
  if(status === "finished" || status === "error"){
    const input = document.getElementById("chatInput"), btn = document.getElementById("sendBtn");
    input.disabled=false; btn.disabled=false; btn.textContent="发送";
    if(proj.path) input.placeholder="补充需求，团队将在此项目上增量开发...";
  }
}
function loadProjects(){
  fetch("/api/projects").then(r=>r.json()).then(data=>{
    const serverProjects = data.projects || [];
    serverProjects.forEach(sp=>{
      const existing = projects.find(p=>p.id===sp.id);
      if(existing){ existing.path=sp.path||existing.path; existing.name=sp.name||existing.name; existing.timestamp=sp.timestamp||existing.timestamp; if(existing.status!=="running") existing.status="finished"; }
      else { projects.push({id:sp.id,name:sp.name,timestamp:sp.timestamp,path:sp.path||"",status:"finished",chatHistory:loadChatHistory(sp.id)}); }
    });
    projects.sort((a,b)=>{ if(a.status==="running"&&b.status!=="running") return -1; if(b.status==="running"&&a.status!=="running") return 1; return (parseInt(b.timestamp)||0)-(parseInt(a.timestamp)||0); });
    renderProjectList();
  }).catch(()=>{});
}
function renderProjectList(){
  const list = document.getElementById("projectList"); list.innerHTML = "";
  projects.forEach(p=>{
    const div = document.createElement("div");
    div.className = "project-item" + (p.id===activeProjectId?" active":"");
    div.dataset.id = p.id;
    let timeStr = "";
    if(p.timestamp){ const ts=parseInt(p.timestamp); if(!isNaN(ts)) timeStr=new Date(ts*1000).toLocaleString("zh-CN"); }
    const statusLabel = p.status==="running"?"运行中":(p.status==="error"?"出错":"");
    const statusClass = p.status==="running"?"":(p.status==="error"?"error":"done");
    div.innerHTML =
      `<div class="p-info"><div class="p-name">${escHtml(p.name)}</div>`+
      (timeStr?`<div class="p-time">${timeStr}</div>`:"")+
      (statusLabel?`<div class="p-status ${statusClass}">${statusLabel}</div>`:"")+
      `</div><button class="p-menu-btn" data-pid="${escHtml(p.id)}"><span></span><span></span><span></span></button>`;
    div.querySelector(".p-menu-btn").onclick = function(e){ e.stopPropagation(); showProjectMenu(e,p.id); };
    div.onclick = ()=>switchProject(p.id);
    list.appendChild(div);
  });
}
/* ── Project Context Menu ────────────────────────────────────────── */
function showProjectMenu(e, projectId){
  menuTargetId = projectId;
  const menu = document.getElementById("projectContextMenu");
  const btn = e.currentTarget; const rect = btn.getBoundingClientRect();
  menu.style.top = rect.bottom+4+"px"; menu.style.left = rect.left+"px";
  menu.classList.add("show"); btn.classList.add("open");
}
function hideProjectMenu(){
  document.getElementById("projectContextMenu").classList.remove("show");
  menuTargetId=null;
  document.querySelectorAll(".p-menu-btn.open").forEach(b=>b.classList.remove("open"));
}
function renameProject(){
  const id=menuTargetId; hideProjectMenu();
  const proj=projects.find(p=>p.id===id); if(!proj) return;
  const newName=prompt("输入新名称:",proj.name);
  if(newName!==null&&newName.trim()){ proj.name=newName.trim(); renderProjectList(); }
}
function deleteProject(){
  const id=menuTargetId; hideProjectMenu();
  const proj=projects.find(p=>p.id===id); if(!proj) return;
  if(!confirm("确定删除项目「"+proj.name+"」？")) return;
  projects=projects.filter(p=>p.id!==id);
  try{localStorage.removeItem("chat_"+id);}catch(e){}
  if(activeProjectId===id){ activeProjectId=null; newProject(); }
  renderProjectList();
}
document.addEventListener("click",function(e){
  const menu=document.getElementById("projectContextMenu");
  if(menu&&!menu.contains(e.target)&&!e.target.closest(".p-menu-btn")) hideProjectMenu();
});

/* ── Log Text Parser ─────────────────────────────────────────────── */
function parseLogText(text, role){
  const lines = text.split("\n");
  const logLineRe = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s*\|/;
  const cmdExecRe = /^Command\s+(\S+)\s+executed/;
  const warningRe = /\|\s*WARNING\s*\|/;
  let thinking = [], steps = [], reply = null, mentions = [];
  let inCommandsBlock = false, commandsText = "";

  for(let i=0; i<lines.length; i++){
    const line = lines[i];
    if(!line.trim()) continue;
    // Skip warnings
    if(warningRe.test(line)) continue;
    // Detect "- Commands:" start
    if(line.includes("- Commands:") && !line.includes("Commands outputs:")){
      inCommandsBlock = true; commandsText = "";
      const after = line.split("- Commands:")[1]||"";
      if(after.trim()) commandsText += after;
      continue;
    }
    // Detect "- Commands outputs:" - end of commands block
    if(line.includes("- Commands outputs:")){
      inCommandsBlock = false;
      if(commandsText) _extractFromCommandsText(commandsText, steps, mentions);
      commandsText = "";
      continue;
    }
    if(inCommandsBlock){ commandsText += line; continue; }
    // Command execution result lines
    const execMatch = line.match(cmdExecRe);
    if(execMatch){
      // Already tracked from commands block; skip duplicate
      const cmd = execMatch[1];
      const existing = steps.find(s=>s.cmd===cmd&&!s.executed);
      if(existing) existing.executed = true;
      else steps.push({cmd, label:STEP_LABELS[cmd]||cmd, detail:"", executed:true});
      continue;
    }
    // Skip loguru INFO lines that aren't commands
    if(logLineRe.test(line)){
      // Check for special patterns
      if(line.includes("manually reply to human")) continue;
      if(line.includes("end current run")) continue;
      if(line.includes("Investment:")) continue;
      continue;
    }
    // Non-loguru lines = thinking text (skip some noise)
    const trimmed = line.trim();
    if(trimmed.startsWith("Response Category:")) continue;
    if(trimmed.startsWith("D:\\") && trimmed.includes("UserWarning")) continue;
    if(trimmed.startsWith("return ") || trimmed.startsWith("ret =")) continue;
    if(trimmed === "Chinese" || trimmed === "English") continue;
    thinking.push(line);
  }
  // Flush remaining commands text
  if(commandsText) _extractFromCommandsText(commandsText, steps, mentions);
  // Extract reply from steps
  const replyIdx = steps.findIndex(s=>s.cmd==="RoleZero.reply_to_human"&&s.replyContent);
  if(replyIdx>=0){ reply=steps[replyIdx].replyContent; steps.splice(replyIdx,1); }
  // Filter out 'end' steps
  steps = steps.filter(s=>s.cmd!=="end");
  // Clean thinking
  const thinkText = thinking.join("\n").trim();
  return { role, thinking:thinkText, steps, reply, mentions };
}

function _extractFromCommandsText(text, steps, mentions){
  // Extract individual commands from Python repr text
  const cmdRe = /'command_name':\s*'([^']+)'/g;
  let m;
  const cmds = [];
  while((m=cmdRe.exec(text))!==null) cmds.push({cmd:m[1], pos:m.index});
  cmds.forEach((c,idx)=>{
    const cmd = c.cmd;
    const chunk = text.slice(c.pos, idx<cmds.length-1?cmds[idx+1].pos:undefined);
    let detail = "";
    let replyContent = null;
    // Extract filename
    const fnMatch = chunk.match(/'filename':\s*'([^']+)'/);
    if(fnMatch) detail = fnMatch[1].split(/[\\/]/).pop();
    // Extract path
    const pathMatch = chunk.match(/'path':\s*'([^']+)'/);
    if(pathMatch && !detail) detail = pathMatch[1].split(/[\\/]/).pop();
    // Extract send_to
    const sendMatch = chunk.match(/'send_to':\s*'([^']+)'/);
    if(sendMatch){ detail = "给 " + sendMatch[1]; mentions.push(sendMatch[1]); }
    // Extract assignee
    const assignMatch = chunk.match(/'assignee':\s*'([^']+)'/);
    if(assignMatch && cmd==="Plan.append_task") detail = assignMatch[1];
    // Extract reply content
    if(cmd==="RoleZero.reply_to_human"){
      const contentMatch = chunk.match(/'content':\s*'([\s\S]*?)'\s*\}\s*\}/);
      if(contentMatch) replyContent = contentMatch[1].replace(/\\n/g,"\n").replace(/\\'/g,"'");
    }
    const label = STEP_LABELS[cmd] || cmd.split(".").pop();
    const step = {cmd, label, detail, executed:false};
    if(replyContent) step.replyContent = replyContent;
    steps.push(step);
  });
}

/* ── Role Card Renderer ──────────────────────────────────────────── */
function renderRoleCard(parsed, time){
  const scroll = document.getElementById("chatScroll");
  const empty = document.getElementById("chatEmpty");
  if(empty) empty.remove();
  removeThinking();

  const info = ROLE_MAP[parsed.role] || {color:"#64748b",initial:"?",title:"",id:parsed.role};
  const stepCount = parsed.steps.length;

  // Try to merge with last card if same role
  if(lastRoleCardEl && lastRoleCardRole === parsed.role){
    _appendToExistingCard(lastRoleCardEl, parsed, time);
    scroll.scrollTop = scroll.scrollHeight;
    return;
  }

  const card = document.createElement("div");
  card.className = "role-card";
  // Header
  const header = document.createElement("div");
  header.className = "role-card-header";
  header.innerHTML =
    `<div class="role-card-avatar" style="background:${info.color}">${info.initial}</div>`+
    `<span class="role-card-name" style="color:${info.color}">${escHtml(info.id)}</span>`+
    `<span class="role-card-title">${escHtml(info.title)}</span>`+
    `<span class="role-card-badge" data-steps="${stepCount}">已处理 <b>${stepCount}</b> 步</span>`;
  card.appendChild(header);

  // Body
  const body = document.createElement("div");
  body.className = "role-card-body";

  // Thinking
  if(parsed.thinking){
    const think = document.createElement("div");
    think.className = "role-card-thinking";
    think.textContent = parsed.thinking;
    body.appendChild(think);
    requestAnimationFrame(()=>{
      if(think.scrollHeight > 124){ think.classList.add("clamped"); think.onclick=()=>think.classList.toggle("expanded"); think.style.cursor="pointer"; }
    });
  }

  // Mentions
  parsed.mentions.forEach(m=>{
    const tag = document.createElement("span");
    tag.className = "role-card-mention";
    tag.textContent = "@ " + m;
    body.appendChild(tag);
  });

  // Steps
  if(stepCount > 0){
    const stepsEl = _buildStepsList(parsed.steps);
    body.appendChild(stepsEl);
  }

  // Reply
  if(parsed.reply){
    const replyEl = document.createElement("div");
    replyEl.className = "role-card-reply";
    replyEl.innerHTML = renderMarkdown(parsed.reply);
    body.appendChild(replyEl);
  }

  // Time
  const timeEl = document.createElement("div");
  timeEl.className = "role-card-time";
  timeEl.textContent = time;
  body.appendChild(timeEl);

  card.appendChild(body);
  scroll.appendChild(card);
  while(scroll.children.length > 300) scroll.removeChild(scroll.firstChild);
  scroll.scrollTop = scroll.scrollHeight;

  lastRoleCardEl = card;
  lastRoleCardRole = parsed.role;
}

function _appendToExistingCard(card, parsed, time){
  const body = card.querySelector(".role-card-body");
  const badge = card.querySelector(".role-card-badge");
  // Update step count
  const oldCount = parseInt(badge.dataset.steps)||0;
  const newCount = oldCount + parsed.steps.length;
  badge.dataset.steps = newCount;
  badge.innerHTML = `已处理 <b>${newCount}</b> 步`;

  // Append thinking
  if(parsed.thinking){
    let thinkEl = body.querySelector(".role-card-thinking");
    if(thinkEl){ thinkEl.textContent += "\n" + parsed.thinking; }
    else { thinkEl=document.createElement("div"); thinkEl.className="role-card-thinking"; thinkEl.textContent=parsed.thinking; body.insertBefore(thinkEl,body.firstChild); }
  }
  // Append steps
  if(parsed.steps.length>0){
    let stepsEl = body.querySelector(".role-card-steps");
    if(stepsEl){
      parsed.steps.forEach(s=>{
        stepsEl.appendChild(_buildStepEl(s));
      });
      _reapplyCollapse(stepsEl);
    } else {
      stepsEl = _buildStepsList(parsed.steps);
      const replyEl = body.querySelector(".role-card-reply");
      if(replyEl) body.insertBefore(stepsEl, replyEl);
      else { const timeEl=body.querySelector(".role-card-time"); body.insertBefore(stepsEl,timeEl); }
    }
  }
  // Append/replace reply
  if(parsed.reply){
    let replyEl = body.querySelector(".role-card-reply");
    if(!replyEl){ replyEl=document.createElement("div"); replyEl.className="role-card-reply"; const timeEl=body.querySelector(".role-card-time"); body.insertBefore(replyEl,timeEl); }
    replyEl.innerHTML = renderMarkdown(parsed.reply);
  }
  // Update time
  const timeEl = body.querySelector(".role-card-time");
  if(timeEl) timeEl.textContent = time;
}

function _buildStepEl(step){
  const el = document.createElement("div");
  el.className = "role-card-step";
  const icon = STEP_ICONS[step.cmd] || "▸";
  el.innerHTML = `<span class="step-icon">${icon}</span><span class="step-label">${escHtml(step.label)}</span>`+
    (step.detail ? `<span class="step-detail">${escHtml(step.detail)}</span>` : "");
  return el;
}

function _buildStepsList(steps){
  const container = document.createElement("div");
  container.className = "role-card-steps";
  const VISIBLE = 3;
  if(steps.length <= VISIBLE + 1){
    steps.forEach(s=>container.appendChild(_buildStepEl(s)));
  } else {
    // Show first VISIBLE, collapse rest
    for(let i=0;i<VISIBLE;i++) container.appendChild(_buildStepEl(steps[i]));
    const hidden = document.createElement("div");
    hidden.className = "step-group-hidden";
    for(let i=VISIBLE;i<steps.length;i++) hidden.appendChild(_buildStepEl(steps[i]));
    const expandBtn = document.createElement("button");
    expandBtn.className = "step-expand";
    expandBtn.textContent = `显示 ${steps.length-VISIBLE} 个更多`;
    expandBtn.onclick = ()=>{ hidden.classList.toggle("show"); expandBtn.textContent=hidden.classList.contains("show")?"收起":`显示 ${steps.length-VISIBLE} 个更多`; };
    container.appendChild(expandBtn);
    container.appendChild(hidden);
  }
  return container;
}

function _reapplyCollapse(stepsEl){
  const allSteps = stepsEl.querySelectorAll(".role-card-step");
  const VISIBLE = 3;
  if(allSteps.length <= VISIBLE+1) return;
  // Remove old expand/hidden
  const oldBtn = stepsEl.querySelector(".step-expand");
  const oldHidden = stepsEl.querySelector(".step-group-hidden");
  if(oldBtn) oldBtn.remove(); if(oldHidden) oldHidden.remove();
  // Rebuild
  const hidden = document.createElement("div");
  hidden.className = "step-group-hidden";
  const arr = Array.from(allSteps);
  for(let i=VISIBLE;i<arr.length;i++){ hidden.appendChild(arr[i]); }
  const expandBtn = document.createElement("button");
  expandBtn.className = "step-expand";
  const count = arr.length - VISIBLE;
  expandBtn.textContent = `显示 ${count} 个更多`;
  expandBtn.onclick = ()=>{ hidden.classList.toggle("show"); expandBtn.textContent=hidden.classList.contains("show")?"收起":`显示 ${count} 个更多`; };
  stepsEl.appendChild(expandBtn);
  stepsEl.appendChild(hidden);
}

/* ── Chat Rendering (user & system only) ─────────────────────────── */
function addChatMessage(role, text, type){
  if(type === "system") return;
  const empty = document.getElementById("chatEmpty");
  if(empty) empty.remove();
  removeThinking();
  const proj = getActiveProject();
  if(proj){ proj.chatHistory.push({role,text,type,time:now()}); saveChatHistory(proj.id); }
  _renderOneMessage(role, text, type, now());
}
function _renderOneMessage(role, text, type, time){
  const scroll = document.getElementById("chatScroll");
  const wrap = document.createElement("div");
  if(type === "user"){
    wrap.className = "chat-msg user";
    wrap.innerHTML =
      `<div class="chat-avatar" style="background:var(--accent)">U</div>`+
      `<div><div class="chat-bubble">${renderMarkdown(text)}</div>`+
      `<div class="chat-time" style="text-align:right">${time}</div></div>`;
  } else if(type === "role-card"){
    // Restore role cards from history
    try {
      const parsed = JSON.parse(text);
      renderRoleCard(parsed, time);
      return;
    } catch(e){}
  } else {
    // system fallback
    wrap.className = "chat-msg system";
    wrap.innerHTML = `<div class="chat-bubble">${renderMarkdown(text)}</div>`;
  }
  scroll.appendChild(wrap);
  while(scroll.children.length > 300) scroll.removeChild(scroll.firstChild);
  scroll.scrollTop = scroll.scrollHeight;
}
function renderChatHistory(){
  const scroll = document.getElementById("chatScroll");
  scroll.innerHTML = "";
  lastRoleCardEl = null; lastRoleCardRole = null;
  const proj = getActiveProject();
  if(!proj || proj.chatHistory.length === 0){
    scroll.innerHTML =
      `<div class="chat-empty" id="chatEmpty">`+
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/></svg>`+
      `<p>输入需求，开始与 AI 团队协作</p></div>`;
    return;
  }
  proj.chatHistory.forEach(msg=>{ _renderOneMessage(msg.role, msg.text, msg.type, msg.time); });
}

/* ── Thinking Indicator ──────────────────────────────────────────── */
function showThinking(){
  if(thinkingEl) return;
  const scroll = document.getElementById("chatScroll");
  thinkingEl = document.createElement("div");
  thinkingEl.className = "thinking-indicator";
  thinkingEl.innerHTML =
    `<div class="thinking-dots"><span></span><span></span><span></span></div>`+
    `<span>AI 思考中...</span>`+
    `<div class="thinking-content" id="thinkingContent"></div>`;
  thinkingEl.onclick = ()=>thinkingEl.classList.toggle("expanded");
  scroll.appendChild(thinkingEl);
  scroll.scrollTop = scroll.scrollHeight;
}
function updateThinking(text){
  if(!thinkingEl) showThinking();
  const content = thinkingEl.querySelector(".thinking-content");
  if(content) content.textContent = text.slice(-2000);
}
function removeThinking(){ if(thinkingEl){ thinkingEl.remove(); thinkingEl=null; } }

/* ── WebSocket Message Handler ────────────────────────────────────── */
function handleMessage(data){
  const block = data.block || "";
  const name  = data.name  || "";
  const value = data.value;
  const role  = data.role  || "";

  // Control: project_path
  if(block === "Control" && name === "project_path"){ updateProjectPath(value); return; }
  // Control: status
  if(block === "Control" && name === "status"){
    const btn = document.getElementById("sendBtn");
    if(value === "running"){
      forgeRunning = true; btn.textContent="运行中..."; btn.disabled=true;
    } else {
      forgeRunning = false; removeThinking();
      if(value === "finished"){
        updateProjectStatus("finished");
        if(previewMode){
          const proj = getActiveProject();
          if(proj && proj.path){ if(previewMode==="viewer") loadAppViewer(proj); else loadCodeEditor(proj); }
        }
      } else if(value === "error"){ updateProjectStatus("error"); }
      btn.textContent="发送"; btn.disabled=false;
    }
    return;
  }
  // LLM streaming tokens
  if(name === "content" && typeof value === "string"){
    llmBuffer += value; showThinking(); updateThinking(llmBuffer); return;
  }
  // LLM stream end
  if(name === "end_marker"){ llmBuffer=""; removeThinking(); return; }

  // Log messages → parse and render as role cards
  if(block === "Log"){
    if(role && role !== "System"){
      const parsed = parseLogText(value, role);
      // Only render if there's meaningful content
      if(parsed.steps.length > 0 || parsed.reply || parsed.thinking){
        // Save as role-card type in history
        const proj = getActiveProject();
        if(proj){ proj.chatHistory.push({role, text:JSON.stringify(parsed), type:"role-card", time:now()}); saveChatHistory(proj.id); }
        renderRoleCard(parsed, now());
      }
    }
    return;
  }
  // Task/Thought/Docs/Editor/Terminal - render as role cards too
  if(block === "Docs" || block === "Editor" || block === "Terminal"){
    const stepCmd = block==="Docs"?"Editor.write":block==="Editor"?"Editor.write":"Terminal.run";
    let detail = "";
    if(name==="path"||name==="meta"){
      if(typeof value==="string") detail=value.split(/[\\/]/).pop();
      else if(value&&value.filename) detail=value.filename;
      else if(value&&value.type) detail=value.type;
    }
    if(detail){
      const parsed = {role:role||"Alex",thinking:"",steps:[{cmd:stepCmd,label:STEP_LABELS[stepCmd]||stepCmd,detail,executed:true}],reply:null,mentions:[]};
      renderRoleCard(parsed, now());
    }
    return;
  }
}

/* ── WebSocket Connection ────────────────────────────────────────── */
function connect(){
  ws = new WebSocket(WS_URL);
  const dot = document.getElementById("connDot");
  const text = document.getElementById("connText");
  ws.onopen = ()=>{ dot.classList.add("on"); text.textContent="已连接"; };
  ws.onmessage = (e)=>{
    try { handleMessage(JSON.parse(e.data)); }
    catch(err){ console.error("msg parse error",err); }
  };
  ws.onclose = ()=>{ dot.classList.remove("on"); text.textContent="已断开"; setTimeout(connect,5000); };
  ws.onerror = ()=>ws.close();
}

/* ── Send / Start ────────────────────────────────────────────────── */
function sendMessage(){
  const input = document.getElementById("chatInput");
  const btn = document.getElementById("sendBtn");
  const idea = input.value.trim();
  if(!idea) return;
  const proj = getActiveProject();
  const isIncremental = proj && proj.path && (proj.status==="finished"||proj.status==="error");
  if(!isIncremental && !activeProjectId) createProject(idea);
  addChatMessage(null, idea, "user");
  input.value=""; input.style.height="auto";
  if(forgeRunning) return;
  if(isIncremental && proj){ proj.status="running"; renderProjectList(); }
  btn.textContent="提交中..."; btn.disabled=true; input.disabled=true;
  lastRoleCardEl=null; lastRoleCardRole=null;
  const body = {idea};
  if(isIncremental && proj) body.project_path = proj.path;
  fetch("/start",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})
    .then(r=>r.json()).then(data=>{
      if(data.error){ btn.textContent="发送"; btn.disabled=false; input.disabled=false; }
    }).catch(err=>{
      btn.textContent="发送"; btn.disabled=false; input.disabled=false;
    });
}

/* ── Input: Enter/Shift+Enter & Auto-resize ──────────────────────── */
const chatInput = document.getElementById("chatInput");
chatInput.addEventListener("keydown",function(e){
  if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); sendMessage(); }
});
chatInput.addEventListener("input",function(){
  this.style.height="auto";
  this.style.height=Math.min(this.scrollHeight,120)+"px";
});

/* ── New Project Button ──────────────────────────────────────────── */
function newProject(){
  activeProjectId=null; lastRoleCardEl=null; lastRoleCardRole=null;
  const scroll = document.getElementById("chatScroll");
  scroll.innerHTML =
    `<div class="chat-empty" id="chatEmpty">`+
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/></svg>`+
    `<p>输入需求，开始与 AI 团队协作</p></div>`;
  const input=document.getElementById("chatInput"), btn=document.getElementById("sendBtn");
  input.placeholder="输入你的需求，例如：制作一个打砖块游戏...";
  input.disabled=false; btn.disabled=false; btn.textContent="发送"; input.focus();
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
  const grid=document.getElementById("mainGrid");
  const viewer=document.getElementById("appViewer");
  const editor=document.getElementById("codeEditor");
  const title=document.getElementById("rightPanelTitle");
  const btnV=document.getElementById("btnViewer");
  const btnE=document.getElementById("btnEditor");
  grid.classList.add("right-open");
  btnV.classList.toggle("active",mode==="viewer");
  btnE.classList.toggle("active",mode==="editor");
  if(mode==="viewer"){
    viewer.style.display="flex"; editor.style.display="none"; title.textContent="应用查看器";
    const proj=getActiveProject();
    if(proj&&proj.path) loadAppViewer(proj); else showViewerMsg("请先选择一个项目");
  } else {
    viewer.style.display="none"; editor.style.display="grid"; title.textContent="代码编辑器";
    const proj=getActiveProject();
    if(proj&&proj.path) loadCodeEditor(proj);
    else document.getElementById("fileTree").innerHTML='<div style="padding:12px;color:var(--text-muted);font-size:0.8rem">请先选择一个项目</div>';
  }
}
function closePreview(){
  previewMode=null;
  const grid=document.getElementById("mainGrid");
  grid.classList.remove("right-open");
  document.getElementById("btnViewer").classList.remove("active");
  document.getElementById("btnEditor").classList.remove("active");
  document.getElementById("appViewer").style.display="none";
  document.getElementById("codeEditor").style.display="none";
  document.getElementById("previewIframe").src="about:blank";
  grid.style.gridTemplateColumns="";
}
function showViewerMsg(msg){
  const iframe=document.getElementById("previewIframe");
  const msgEl=document.getElementById("viewerMsg");
  iframe.style.display="none"; iframe.src="about:blank"; iframe.onload=null; iframe.onerror=null;
  msgEl.style.display="flex"; msgEl.textContent=msg;
}

/* ── App Viewer ──────────────────────────────────────────────────── */
function loadAppViewer(proj){
  const iframe=document.getElementById("previewIframe");
  const msgEl=document.getElementById("viewerMsg");
  iframe.style.display="none"; iframe.src="about:blank";
  msgEl.style.display="flex"; msgEl.textContent="检测项目类型...";
  fetch("/api/project-info?path="+encodeURIComponent(proj.path))
    .then(r=>r.json()).then(info=>{
      if(info.type==="web_built"||info.type==="web_static"){
        const dirName=proj.path.replace(/\\/g,"/").split("/").pop();
        const previewUrl="/preview/"+encodeURIComponent(dirName)+"/index.html";
        msgEl.textContent="加载应用中...";
        iframe.onload=function(){ if(iframe.src&&!iframe.src.endsWith("about:blank")){ iframe.style.display="block"; msgEl.style.display="none"; } };
        iframe.onerror=function(){ showViewerMsg("应用加载失败，请尝试代码编辑器查看"); };
        iframe.src=previewUrl;
        setTimeout(function(){ if(iframe.style.display==="none"&&msgEl.textContent==="加载应用中..."){ showViewerMsg("应用加载超时"); setTimeout(()=>openPreview("editor"),1500); } },8000);
      } else if(info.type==="python"){ showViewerMsg("Python 项目不支持应用预览"); setTimeout(()=>openPreview("editor"),800); }
      else if(info.type==="web_unbuilt"){ showViewerMsg("项目尚未构建（缺少 dist/），请先运行 npm run build"); }
      else { showViewerMsg("未检测到可预览的应用"); }
    }).catch(err=>{ showViewerMsg("无法检测项目类型: "+(err.message||"请求失败")); });
}

/* ── Code Editor ─────────────────────────────────────────────────── */
function loadCodeEditor(proj){
  const tree=document.getElementById("fileTree");
  const content=document.getElementById("codeContent");
  tree.innerHTML='<div style="padding:12px;color:var(--text-muted);font-size:0.8rem">加载中...</div>';
  content.innerHTML='<div class="no-file">选择文件查看代码</div>';
  openTabs=[]; activeTabPath=null; renderTabs();
  fetch("/api/project-files?path="+encodeURIComponent(proj.path))
    .then(r=>r.json()).then(data=>{ tree.innerHTML=""; renderFileTree(data.files||[],tree,0,proj.path); })
    .catch(()=>{ tree.innerHTML='<div style="padding:12px;color:var(--text-muted);font-size:0.8rem">加载失败</div>'; });
}

function renderFileTree(entries, container, depth, projPath){
  entries.forEach(entry=>{
    const item=document.createElement("div");
    item.className="file-tree-item"+(entry.type==="dir"?" dir":"");
    item.style.paddingLeft=(10+depth*14)+"px";
    if(entry.type==="dir"){
      const arrow=document.createElement("span"); arrow.className="arrow"; arrow.textContent="\u25B6"; item.appendChild(arrow);
      const nameSpan=document.createElement("span"); nameSpan.textContent=entry.name; item.appendChild(nameSpan);
      const childContainer=document.createElement("div"); childContainer.className="file-tree-children";
      renderFileTree(entry.children||[],childContainer,depth+1,projPath);
      item.onclick=function(e){ e.stopPropagation(); const isOpen=childContainer.classList.toggle("open"); arrow.classList.toggle("open",isOpen); };
      container.appendChild(item); container.appendChild(childContainer);
    } else {
      const indent=document.createElement("span"); indent.style.width="12px"; indent.style.flexShrink="0"; item.appendChild(indent);
      const nameSpan=document.createElement("span"); nameSpan.textContent=entry.name; item.appendChild(nameSpan);
      item.onclick=function(e){ e.stopPropagation(); loadFileContent(projPath+"/"+entry.path.replace(/\\/g,"/"),item); };
      container.appendChild(item);
    }
  });
}

function loadFileContent(filePath, treeItem){
  const fileName=filePath.split("/").pop();
  const existing=openTabs.find(t=>t.filePath===filePath);
  if(existing) existing.treeItem=treeItem||existing.treeItem;
  else openTabs.push({filePath,fileName,treeItem});
  activeTabPath=filePath; renderTabs();
  document.querySelectorAll(".file-tree-item.active").forEach(el=>el.classList.remove("active"));
  if(treeItem) treeItem.classList.add("active");
  const content=document.getElementById("codeContent");
  content.innerHTML='<div class="no-file">加载中...</div>';
  fetch("/api/file-content?path="+encodeURIComponent(filePath))
    .then(r=>r.json()).then(data=>{
      if(data.error){ content.innerHTML='<div class="no-file">'+escHtml(data.error)+'</div>'; return; }
      const ext=filePath.split(".").pop().toLowerCase();
      const langMap={js:"javascript",ts:"typescript",tsx:"typescript",jsx:"javascript",py:"python",html:"xml",css:"css",json:"json",md:"markdown",java:"java",go:"go",rs:"rust",cpp:"cpp",c:"c",sh:"bash",yaml:"yaml",yml:"yaml",xml:"xml",sql:"sql",rb:"ruby"};
      const lang=langMap[ext]||"";
      const pre=document.createElement("pre"), code=document.createElement("code");
      if(lang) code.className="language-"+lang;
      code.textContent=data.content; pre.appendChild(code);
      content.innerHTML=""; content.appendChild(pre);
      if(window.hljs) hljs.highlightElement(code);
    }).catch(()=>{ content.innerHTML='<div class="no-file">加载失败</div>'; });
}

/* ── Editor Tabs ─────────────────────────────────────────────────── */
function renderTabs(){
  const container=document.getElementById("editorTabs"); if(!container) return;
  container.innerHTML="";
  openTabs.forEach(tab=>{
    const el=document.createElement("div");
    el.className="editor-tab"+(tab.filePath===activeTabPath?" active":"");
    const nameSpan=document.createElement("span"); nameSpan.textContent=tab.fileName; el.appendChild(nameSpan);
    const closeBtn=document.createElement("button"); closeBtn.className="tab-close"; closeBtn.innerHTML="&times;";
    closeBtn.onclick=function(e){ e.stopPropagation(); closeTab(tab.filePath); };
    el.appendChild(closeBtn);
    el.onclick=function(){ switchTab(tab.filePath); };
    container.appendChild(el);
  });
}
function switchTab(filePath){ const tab=openTabs.find(t=>t.filePath===filePath); if(tab) loadFileContent(tab.filePath,tab.treeItem); }
function closeTab(filePath){
  const idx=openTabs.findIndex(t=>t.filePath===filePath); if(idx===-1) return;
  openTabs.splice(idx,1);
  if(activeTabPath===filePath){
    if(openTabs.length>0){ const next=openTabs[Math.min(idx,openTabs.length-1)]; loadFileContent(next.filePath,next.treeItem); }
    else { activeTabPath=null; renderTabs(); document.getElementById("codeContent").innerHTML='<div class="no-file">选择文件查看代码</div>'; }
  } else renderTabs();
}

/* ── Resize Handle ───────────────────────────────────────────────── */
function initResize(){
  const handle=document.getElementById("resizeHandle");
  const grid=document.getElementById("mainGrid");
  handle.addEventListener("mousedown",function(e){
    e.preventDefault(); isResizing=true; handle.classList.add("active");
    document.body.style.cursor="col-resize"; document.body.style.userSelect="none";
    function onMouseMove(e){
      if(!isResizing) return;
      const totalWidth=window.innerWidth;
      const rightWidth=totalWidth-e.clientX;
      const clamped=Math.max(250,Math.min(rightWidth,totalWidth*0.6));
      grid.style.gridTemplateColumns="var(--left-width) 1fr 5px "+clamped+"px";
    }
    function onMouseUp(){
      isResizing=false; handle.classList.remove("active");
      document.body.style.cursor=""; document.body.style.userSelect="";
      document.removeEventListener("mousemove",onMouseMove);
      document.removeEventListener("mouseup",onMouseUp);
    }
    document.addEventListener("mousemove",onMouseMove);
    document.addEventListener("mouseup",onMouseUp);
  });
}

/* ── Init ────────────────────────────────────────────────────────── */
connect();
loadProjects();
initResize();
