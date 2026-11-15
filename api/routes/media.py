"""Uploads and voice memos: pasted files (base64), raw streamed uploads (up to 8 GB), the iPhone Shortcut's /api/memo, local
transcription (tools/transcribe.py) and /api/thumb."""
import base64
import datetime as dt
import os
import re
import subprocess
import sys
import uuid

from api.ctx import S, ROOT, UPLOADS
from api.router import route
from api.routes.actions import act
from api.routes.push import _agent_name


def transcribe_async(rel, force=False):
    """t-voice-memo: start tools/transcribe.py for an audio upload in the background (never blocks a request)."""
    if not S.is_audio_path(rel):
        return False
    os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
    with open(os.path.join(ROOT, "logs", "transcribe.log"), "a") as lf:
        subprocess.Popen([sys.executable, os.path.join(ROOT, "tools", "transcribe.py"), rel] + (["--force"] if force else []),
                         cwd=ROOT, stdin=subprocess.DEVNULL, stdout=lf, stderr=lf, start_new_session=True)
    return True


MEMO_DEFAULT = "🎙 语音备忘录（从 iPhone 分享）"


def memo_post(rfile, length, q):
    """t-share-memo: the iPhone Shortcut 「发给暗线」. Raw file body -> uploads/, posted as my message to the
    manager chat (to=manager) or as a DM (to=<role id>), transcription started. Returns (code, one line of plain text)."""
    to = (q.get("to") or ["manager"])[0].strip() or "manager"
    st = S.read()
    agents = st.get("agents") or {}
    if to != "manager" and (to not in agents or agents[to].get("enabled") is False):
        return 400, f"发送失败：没有「{to}」这个收件人（可用：manager 或角色 id）"
    name = (q.get("name") or ["memo.m4a"])[0] or "memo.m4a"   # parse_qs already %-decoded it; _upload_name strips / and ..
    text = (q.get("text") or [""])[0].strip()[:2000] or MEMO_DEFAULT
    res = save_upload_stream(rfile, length, name)
    body = {"kind": "chat", "text": text, "attachments": [res["path"]]} if to == "manager" else \
           {"kind": "dm", "agent": to, "text": text, "attachments": [res["path"]]}
    act(body)
    started = transcribe_async(res["path"])
    who = _agent_name(st, to)
    return 200, f"已发给{who}" + (" · 正在本机转写" if started else "")


def save_upload(body):
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", body.get("name") or "paste.png")[-60:]
    data = body["data"]
    if "," in data[:100]:
        data = data.split(",", 1)[1]
    raw = base64.b64decode(data)
    if len(raw) > 50 * 1024 * 1024:
        raise ValueError("file too large (50MB max)")
    fn = f"{dt.datetime.now():%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:4]}-{name}"
    with open(os.path.join(UPLOADS, fn), "wb") as f:
        f.write(raw)
    return {"ok": True, "path": f"uploads/{fn}"}   # audit SM-15: no absolute path in responses


MAX_UPLOAD = 8 * 1024**3  # 8 GB: raw footage


def _upload_name(name):
    name = re.sub(r"[^\w.\-]+", "_", name or "file")[-80:] or "file"
    return f"{dt.datetime.now():%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:4]}-{name}"


def save_upload_stream(rfile, length, name):
    """Stream a raw request body to uploads/ in 1 MB chunks (no base64, no whole-file buffering)."""
    if length <= 0:
        raise ValueError("empty upload")
    if length > MAX_UPLOAD:
        raise ValueError("file too large (8 GB max)")
    fn = _upload_name(name)
    dest = os.path.join(UPLOADS, fn)
    part = dest + ".part"
    left = length
    try:
        with open(part, "wb") as f:
            while left:
                chunk = rfile.read(min(1 << 20, left))
                if not chunk:
                    raise ValueError("upload interrupted")
                f.write(chunk)
                left -= len(chunk)
        os.replace(part, dest)
    finally:
        if os.path.exists(part):
            os.remove(part)
    return {"ok": True, "path": f"uploads/{fn}", "bytes": length}   # audit SM-15


@route("GET", "/api/thumb")
def _thumb(h, u, q):
    try:
        tw = int(q.get("w", ["360"])[0])
    except ValueError:
        tw = 360
    return h._thumb(q.get("p", [""])[0], tw)


@route("POST", "/api/memo", raw=True)
def _memo(h, u, q, n):   # t-share-memo: one request from the iPhone Shortcut, plain-text answer for its notification
    try:
        code, msg = memo_post(h.rfile, n, q)
    except Exception as e:  # noqa: BLE001
        code, msg = 400, f"发送失败：{e}"
    return h._send(code, msg, ctype="text/plain; charset=utf-8")


@route("POST", "/api/upload/raw", raw=True)
def _upload_raw(h, u, q, n):  # raw bytes, streamed straight to disk
    name = q.get("name", ["file"])[0]
    res = save_upload_stream(h.rfile, n, name)
    transcribe_async(res["path"])
    return h._send(200, res)


@route("POST", "/api/upload")
def _upload(h, u, body):
    res = save_upload(body)
    transcribe_async(res["path"])
    return h._send(200, res)


@route("POST", "/api/transcribe")
def _transcribe(h, u, body):   # t-voice-memo: 重试 / 转写 an older memo
    rel = body.get("path") or ""
    full = os.path.realpath(os.path.join(ROOT, rel))
    if not (rel.startswith(("uploads/", "work/")) and full.startswith(ROOT + os.sep) and os.path.isfile(full) and S.is_audio_path(rel)):
        return h._send(400, {"error": "not an audio attachment"})
    return h._send(200, {"ok": transcribe_async(rel, force=True)})
