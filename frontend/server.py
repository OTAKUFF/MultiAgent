"""
MetaGPT 前端服务器（subprocess 方案）
- GET  /       → 返回 index.html
- POST /start  → 启动 metagpt 子进程
- WebSocket :8766 → 实时推送控制台输出到浏览器
"""
import asyncio
import json
import os
import re
import subprocess
import sys
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer

import websockets

FRONTEND_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(FRONTEND_DIR)

PYTHON_EXE = sys.executable

ws_clients: set = set()
ws_loop: asyncio.AbstractEventLoop = None
metagpt_running: bool = False
metagpt_proc: subprocess.Popen = None

KNOWN_ROLES = ["Mike", "Alice", "Bob", "Alex", "Dana", "Eve", "David"]

MIME_MAP = {
    ".html": "text/html", ".js": "application/javascript",
    ".css": "text/css", ".json": "application/json",
    ".svg": "image/svg+xml", ".png": "image/png",
    ".jpg": "image/jpeg", ".gif": "image/gif",
    ".ico": "image/x-icon", ".woff2": "font/woff2",
    ".woff": "font/woff", ".ttf": "font/ttf",
    ".map": "application/json", ".py": "text/x-python",
    ".ts": "text/typescript", ".tsx": "text/typescript",
    ".jsx": "text/javascript", ".md": "text/markdown",
}

SKIP_DIRS = {"node_modules", "__pycache__", ".git", ".venv", "venv", ".idea", ".vscode"}


def _safe_resolve(base_dir, relative_path):
    """路径安全校验，防目录穿越"""
    base = os.path.realpath(base_dir)
    target = os.path.realpath(os.path.join(base_dir, relative_path))
    if not target.startswith(base + os.sep) and target != base:
        return None
    return target


def _detect_project_type(project_path):
    """检测项目类型：web_built / web_static / web_unbuilt / python / empty"""
    if not os.path.isdir(project_path):
        return {"type": "empty", "serve_root": ""}
    dist_index = os.path.join(project_path, "dist", "index.html")
    root_index = os.path.join(project_path, "index.html")
    if os.path.isfile(dist_index):
        return {"type": "web_built", "serve_root": os.path.join(project_path, "dist")}
    if os.path.isfile(root_index):
        return {"type": "web_static", "serve_root": project_path}
    if os.path.isfile(os.path.join(project_path, "package.json")):
        return {"type": "web_unbuilt", "serve_root": ""}
    try:
        if any(f.endswith(".py") for f in os.listdir(project_path)):
            return {"type": "python", "serve_root": ""}
    except OSError:
        pass
    return {"type": "empty", "serve_root": ""}


def _build_file_tree(dir_path, rel_prefix=""):
    """递归构建文件树"""
    entries = []
    try:
        items = sorted(os.listdir(dir_path))
    except OSError:
        return entries
    dirs_list = []
    files_list = []
    for name in items:
        if name.startswith("."):
            continue
        full = os.path.join(dir_path, name)
        rel = os.path.join(rel_prefix, name).replace("\\", "/")
        if os.path.isdir(full):
            if name in SKIP_DIRS:
                continue
            children = _build_file_tree(full, rel)
            dirs_list.append({"name": name, "path": rel, "type": "dir", "children": children})
        else:
            files_list.append({"name": name, "path": rel, "type": "file"})
    return dirs_list + files_list


# ─── 广播到所有 WebSocket 客户端 ─────────────────────────────────────────────

async def broadcast(data: dict):
    if not ws_clients:
        return
    msg = json.dumps(data, ensure_ascii=False)
    await asyncio.gather(*(client.send(msg) for client in list(ws_clients)))


def _broadcast(data: dict):
    if ws_loop:
        asyncio.run_coroutine_threadsafe(broadcast(data), ws_loop)


def _broadcast_control(status: str):
    _broadcast({"block": "Control", "name": "status", "value": status})


def _broadcast_message(role: str, text: str):
    """发送一整块角色消息到前端"""
    _broadcast({"block": "Log", "name": "info", "value": text, "role": role})


# ─── 解析角色名 ──────────────────────────────────────────────────────────────

def _detect_role(line: str):
    """从一行输出中检测角色名，返回 (role, is_new_speaker)"""
    # 匹配 "Mike：" 或 "Alice:" 开头（中英文冒号）
    for name in KNOWN_ROLES:
        if line.startswith(name + "：") or line.startswith(name + ":"):
            return name, True
        if line.startswith(name + "(") or line.startswith(name + "（"):
            return name, True
    # loguru 日志行中检测角色，如 "metagpt.roles.xxx - Mike(TeamLeader)"
    for name in KNOWN_ROLES:
        if name in line:
            return name, False
    return None, False


# ─── 输出缓冲器：攒同一角色的连续输出，合并成一块发送 ─────────────────────────

class OutputBuffer:
    def __init__(self):
        self._role = None
        self._lines = []
        self._timer = None
        self._lock = threading.Lock()
        self.FLUSH_DELAY = 0.8  # 0.8秒没有新输出就刷新

    def add_line(self, line: str):
        with self._lock:
            role, is_new_speaker = _detect_role(line)
            # 如果检测到新角色开始说话，先刷新之前的缓冲
            if is_new_speaker and self._lines and role != self._role:
                self._flush_locked()
            # 更新当前角色
            if role:
                self._role = role
            self._lines.append(line)
            # 重置定时器
            if self._timer:
                self._timer.cancel()
            self._timer = threading.Timer(self.FLUSH_DELAY, self._flush)
            self._timer.start()

    def _flush(self):
        with self._lock:
            self._flush_locked()

    def _flush_locked(self):
        if not self._lines:
            return
        text = "\n".join(self._lines)
        role = self._role or "System"
        self._lines = []
        # 不重置 self._role，后续无角色的行继续归属当前角色
        _broadcast_message(role, text)

    def flush_final(self):
        if self._timer:
            self._timer.cancel()
        self._flush()


# ─── 子进程运行 MetaGPT ──────────────────────────────────────────────────────
def _run_metagpt(idea: str, project_path: str = ""):
    global metagpt_running, metagpt_proc
    buf = OutputBuffer()
    try:
        workspace = os.path.join(PROJECT_DIR, "workspace")
        before = set(os.listdir(workspace)) if os.path.isdir(workspace) else set()

        metagpt_exe = os.path.join(os.path.dirname(PYTHON_EXE), "metagpt")
        cmd = [metagpt_exe, idea]
        if project_path:
            cmd += ["--project-path", project_path]
        metagpt_proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="gbk",
            errors="replace",
            cwd=PROJECT_DIR,
            bufsize=1,
        )
        for line in metagpt_proc.stdout:
            line = line.rstrip("\n\r")
            if line:
                print(line)
                buf.add_line(line)
        buf.flush_final()
        metagpt_proc.wait()

        # Detect project path after run
        after = set(os.listdir(workspace)) if os.path.isdir(workspace) else set()
        new_dirs = after - before
        detected_path = ""
        if project_path:
            detected_path = project_path
        elif new_dirs:
            detected_path = os.path.join(workspace, sorted(new_dirs)[-1])
        if detected_path:
            _broadcast({"block": "Control", "name": "project_path", "value": detected_path})

        if metagpt_proc.returncode == 0:
            _broadcast_control("finished")
        else:
            _broadcast_message("System", f"metagpt 退出码: {metagpt_proc.returncode}")
            _broadcast_control("error")
    except Exception as e:
        buf.flush_final()
        _broadcast_message("System", f"启动 metagpt 失败: {e}")
        _broadcast_control("error")
    finally:
        metagpt_running = False
        metagpt_proc = None


# ─── HTTP 服务器 ─────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = dict(urllib.parse.parse_qsl(parsed.query))

        if path in ("/", "/index.html"):
            self._serve_frontend_file("index.html", "text/html; charset=utf-8")
        elif path == "/app.js":
            self._serve_frontend_file("app.js", "application/javascript; charset=utf-8")
        elif path == "/api/projects":
            self._handle_projects()
        elif path == "/api/project-info":
            self._handle_project_info(qs)
        elif path == "/api/project-files":
            self._handle_project_files(qs)
        elif path == "/api/file-content":
            self._handle_file_content(qs)
        elif path.startswith("/preview/"):
            self._handle_preview(path)
        else:
            self.send_response(404)
            self.end_headers()

    def _serve_frontend_file(self, filename, content_type):
        filepath = os.path.join(FRONTEND_DIR, filename)
        try:
            with open(filepath, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        except FileNotFoundError:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(f"{filename} not found".encode())

    def _handle_project_info(self, qs):
        proj_path = qs.get("path", "")
        if not proj_path:
            self._json(400, {"error": "missing path"})
            return
        workspace = os.path.join(PROJECT_DIR, "workspace")
        real_proj = os.path.realpath(proj_path)
        real_ws = os.path.realpath(workspace)
        if not real_proj.startswith(real_ws):
            self._json(403, {"error": "forbidden"})
            return
        info = _detect_project_type(proj_path)
        self._json(200, info)

    def _handle_project_files(self, qs):
        proj_path = qs.get("path", "")
        if not proj_path:
            self._json(400, {"error": "missing path"})
            return
        workspace = os.path.join(PROJECT_DIR, "workspace")
        real_proj = os.path.realpath(proj_path)
        real_ws = os.path.realpath(workspace)
        if not real_proj.startswith(real_ws):
            self._json(403, {"error": "forbidden"})
            return
        files = _build_file_tree(proj_path)
        self._json(200, {"files": files})

    def _handle_file_content(self, qs):
        file_path = qs.get("path", "")
        if not file_path:
            self._json(400, {"error": "missing path"})
            return
        workspace = os.path.join(PROJECT_DIR, "workspace")
        real_file = os.path.realpath(file_path)
        real_ws = os.path.realpath(workspace)
        if not real_file.startswith(real_ws):
            self._json(403, {"error": "forbidden"})
            return
        if not os.path.isfile(file_path):
            self._json(404, {"error": "file not found"})
            return
        try:
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
            self._json(200, {"content": content})
        except Exception as e:
            self._json(500, {"error": str(e)})

    def _handle_preview(self, path):
        # /preview/<dir_name>/rest/of/path
        parts = path[len("/preview/"):].split("/", 1)
        if len(parts) < 1:
            self.send_response(404)
            self.end_headers()
            return
        dir_name = urllib.parse.unquote(parts[0])
        file_rel = parts[1] if len(parts) > 1 else "index.html"
        workspace = os.path.join(PROJECT_DIR, "workspace")
        proj_path = os.path.join(workspace, dir_name)
        if not os.path.isdir(proj_path):
            self.send_response(404)
            self.end_headers()
            return
        info = _detect_project_type(proj_path)
        serve_root = info.get("serve_root", "") or proj_path
        target = _safe_resolve(serve_root, file_rel)
        if not target or not os.path.isfile(target):
            self.send_response(404)
            self.end_headers()
            return
        ext = os.path.splitext(target)[1].lower()
        mime = MIME_MAP.get(ext, "application/octet-stream")
        try:
            with open(target, "rb") as f:
                content = f.read()
            # Rewrite absolute asset paths in HTML so they route through /preview/<dir>/
            if ext == ".html":
                dir_prefix = b"/preview/" + urllib.parse.quote(dir_name).encode() + b"/"
                # Replace absolute paths like /assets/, /js/, /css/, /img/, /fonts/, /static/
                for prefix in [b"/assets/", b"/js/", b"/css/", b"/img/", b"/fonts/", b"/static/"]:
                    content = content.replace(
                        b'="' + prefix, b'="' + dir_prefix + prefix[1:]
                    )
                    content = content.replace(
                        b"='" + prefix, b"='" + dir_prefix + prefix[1:]
                    )
                    # Also handle src=/href= without quotes (rare but possible)
                    content = content.replace(
                        b'(' + prefix, b'(' + dir_prefix + prefix[1:]
                    )
                mime = "text/html; charset=utf-8"
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(content)
        except Exception:
            self.send_response(500)
            self.end_headers()

    def _handle_projects(self):
        workspace = os.path.join(PROJECT_DIR, "workspace")
        projects = []
        skip = {"storage", "__pycache__"}
        if os.path.isdir(workspace):
            for name in os.listdir(workspace):
                full = os.path.join(workspace, name)
                if not os.path.isdir(full):
                    continue
                if name in skip or name.startswith("-") or name.startswith("."):
                    continue
                # parse {project_name}_{timestamp} pattern
                parts = name.rsplit("_", 1)
                proj_name = parts[0] if len(parts) == 2 and parts[1].isdigit() else name
                timestamp = parts[1] if len(parts) == 2 and parts[1].isdigit() else ""
                projects.append({"id": name, "name": proj_name, "timestamp": timestamp, "path": full})
        projects.sort(key=lambda p: p["timestamp"], reverse=True)
        self._json(200, {"projects": projects})

    def do_POST(self):
        if self.path == "/start":
            self._handle_start()
        else:
            self.send_response(404)
            self.end_headers()

    def _handle_start(self):
        global metagpt_running
        if metagpt_running:
            self._json(409, {"error": "MetaGPT 正在运行中"})
            return
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        try:
            payload = json.loads(body)
            idea = payload.get("idea", "").strip()
            project_path = payload.get("project_path", "").strip()
        except Exception:
            idea = ""
            project_path = ""
        if not idea:
            self._json(400, {"error": "idea 不能为空"})
            return
        metagpt_running = True
        _broadcast_control("running")
        threading.Thread(target=_run_metagpt, args=(idea, project_path), daemon=True).start()
        self._json(200, {"status": "started"})

    def _json(self, code, obj):
        payload = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt, *args):
        pass


# ─── WebSocket 服务器 ────────────────────────────────────────────────────────

async def ws_handler(websocket):
    ws_clients.add(websocket)
    try:
        await websocket.wait_closed()
    finally:
        ws_clients.discard(websocket)


async def run_ws_server():
    global ws_loop
    ws_loop = asyncio.get_event_loop()
    async with websockets.serve(ws_handler, "0.0.0.0", 8766):
        print("[server] WebSocket 监听 ws://0.0.0.0:8766")
        await asyncio.Future()


def main():
    threading.Thread(
        target=lambda: HTTPServer(("0.0.0.0", 8765), Handler).serve_forever(),
        daemon=True,
    ).start()
    print("[server] HTTP 监听 http://localhost:8765 (浏览器打开此地址)")
    asyncio.run(run_ws_server())


if __name__ == "__main__":
    main()
