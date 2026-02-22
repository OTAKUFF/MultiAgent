"""
MetaGPT 前端服务器（subprocess 方案）
- GET  /       → 返回 index.html
- POST /start  → 启动 metagpt 子进程
- WebSocket :8766 → 实时推送控制台输出到浏览器
"""
import asyncio
import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import websockets

FRONTEND_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(FRONTEND_DIR)

# 找到 metagpt 所在的 python 解释器
PYTHON_EXE = sys.executable

ws_clients: set = set()
ws_loop: asyncio.AbstractEventLoop = None
metagpt_running: bool = False
metagpt_proc: subprocess.Popen = None


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


def _broadcast_line(line: str):
    _broadcast({"block": "Log", "name": "info", "value": line, "role": None})


# ─── 子进程运行 MetaGPT ──────────────────────────────────────────────────────
def _run_metagpt(idea: str):
    global metagpt_running, metagpt_proc
    try:
        # 跟命令行一样：metagpt "需求"
        metagpt_exe = os.path.join(os.path.dirname(PYTHON_EXE), "metagpt")
        cmd = [metagpt_exe, idea]
        metagpt_proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            cwd=PROJECT_DIR,
            bufsize=1,
        )
        for line in metagpt_proc.stdout:
            line = line.rstrip("\n\r")
            if line:
                print(line)  # 同时打印到服务器控制台
                _broadcast_line(line)
        metagpt_proc.wait()
        if metagpt_proc.returncode == 0:
            _broadcast_control("finished")
        else:
            _broadcast_line(f"metagpt 退出码: {metagpt_proc.returncode}")
            _broadcast_control("error")
    except Exception as e:
        _broadcast_line(f"启动 metagpt 失败: {e}")
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
        else:
            self.send_response(404)
            self.end_headers()

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
