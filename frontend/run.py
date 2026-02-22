"""
启动入口：
1. 设置 METAGPT_REPORTER_URL 环境变量
2. 拦截 loguru logger，把进度相关 INFO 日志也推送到前端
3. 调用 metagpt 主流程
"""
import os
import sys

import requests

# ─── 1. 设置 Reporter 回调地址 ────────────────────────────────────────────────
os.environ["METAGPT_REPORTER_URL"] = "http://127.0.0.1:8765/report"

# ─── 2. 拦截 loguru logger ────────────────────────────────────────────────────
from metagpt.logs import logger

PROGRESS_KEYWORDS = [
    "Investment:",
    "New requirement detected",
    "Requirement update detected",
    "Bugfix detected",
    "Writing ",
    "Code review and rewrite",
    "Summarize code",
    "Debug and rewrite",
    "Running ",
    "The terminal is at",
    "Total running cost",
    "end current run",
    "manually reply to human",
    "to do ",
]


def _should_forward(message: str) -> bool:
    return any(kw in message for kw in PROGRESS_KEYWORDS)


def logger_sink(message):
    """loguru sink：把进度相关的 INFO/WARNING 日志转发给接收服务器"""
    record = message.record
    if record["level"].name not in ("INFO", "WARNING"):
        return
    text = record["message"]
    if not _should_forward(text):
        return
    payload = {
        "block": "Log",
        "name": record["level"].name.lower(),
        "value": text,
        "role": None,
    }
    try:
        requests.post("http://127.0.0.1:8765/report", json=payload, timeout=1)
    except Exception:
        pass


logger.add(logger_sink, level="INFO")

# ─── 3. 运行 MetaGPT ──────────────────────────────────────────────────────────
if __name__ == "__main__":
    requirement = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else \
        "制作一个打砖块游戏，使用 pygame，包含挡板、小球和多行砖块，支持生命值系统"

    from metagpt.software_company import generate_repo
    generate_repo(idea=requirement)  # generate_repo 内部已调用 asyncio.run，直接调用即可
