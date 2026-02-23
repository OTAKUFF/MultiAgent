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
def _run_metagpt(idea: str):
    global metagpt_running, metagpt_proc
    buf = OutputBuffer()
    try:
        metagpt_exe = os.path.join(os.path.dirname(PYTHON_EXE), "metagpt")
        cmd = [metagpt_exe, idea]
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
        if self.path in ("/", "/index.html"):
            filepath = os.path.join(FRONTEND_DIR, "index.html")
            try:
                with open(filepath, "rb") as f:
                    content = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(content)))
                self.end_headers()
                self.wfile.write(content)
            except FileNotFoundError:
                self.send_response(404)
                self.end_headers()
                self.wfile.write(b"index.html not found")
        elif self.path == "/api/projects":
            self._handle_projects()
        else:
            self.send_response(404)
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
                projects.append({"id": name, "name": proj_name, "timestamp": timestamp})
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
            idea = json.loads(body).get("idea", "").strip()
        except Exception:
            idea = ""
        if not idea:
            self._json(400, {"error": "idea 不能为空"})
            return
        metagpt_running = True
        _broadcast_control("running")
        threading.Thread(target=_run_metagpt, args=(idea,), daemon=True).start()
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
