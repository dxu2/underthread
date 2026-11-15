"""t-feed-inbox: Settings -> Connections (core/feeds, docs/feeds.md).

GET  /api/feeds   status of every source (never a password, never a cursor).
POST /api/feeds   {"op": ..., "source": ...}. Reads its own body and has its own error handling, like /api/secret/github: the body
                  may hold a password, so it is never logged, echoed, stored in state / inbox or put in an error.
    connect {source, account, secret, interval?}   log in, store the password, start collecting (old mail is not replayed)
    disconnect {source} · set {source, enabled?, interval?} · poll {source} (fetch now) · probe (keychain check)
    use_file {confirm: true} / use_keychain        where the NEXT connection stores its password
"""
import json
from urllib.parse import urlparse

from api.router import route
from core.feeds import collector as FC


@route("GET", "/api/feeds")
def _status(h, u, q):
    try:
        return h._send(200, FC.status())
    except Exception:  # noqa: BLE001
        return h._send(500, {"error": "读状态失败"})


def _origin_ok(h):
    origin = h.headers.get("Origin")
    if not origin:
        return True
    host = h.headers.get("Host") or ""
    oh = urlparse(origin).hostname or ""
    return urlparse(origin).netloc in (host, h.headers.get("X-Forwarded-Host") or host) or oh in ("127.0.0.1", "localhost") or oh.endswith(".ts.net")


@route("POST", "/api/feeds", raw=True)
def _post(h, u, q, n):
    try:
        raw = h.rfile.read(n) if 0 < n <= 4096 else b""
        ctype = (h.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if not h._hdr_ok() or ctype != "application/json" or not _origin_ok(h):
            return h._send(403, {"ok": False, "error": "forbidden"})
        try:
            body = json.loads(raw or b"{}")
        except ValueError:
            body = None
        raw = None
        if not isinstance(body, dict):
            return h._send(400, {"ok": False, "error": "bad request"})
        op, src = body.get("op"), str(body.get("source") or "")
        if op == "connect":
            r = FC.connect(src, body.get("account"), body.get("secret"), body.get("interval"))
        elif op == "disconnect":
            r = FC.disconnect(src)
        elif op == "set":
            r = FC.configure(src, body.get("enabled") if isinstance(body.get("enabled"), bool) else None, body.get("interval"))
        elif op == "poll":
            r = FC.poll(src, manual=True)
            r["status"] = FC.status()
        elif op == "probe":
            r = FC.probe()
        elif op == "use_file":
            r = FC.use_method("file", body.get("confirm") is True)
        elif op == "use_keychain":
            r = FC.use_method("keychain")
        else:
            r = {"ok": False, "error": "unknown op"}
        body = None
        return h._send(200 if r.get("ok") else 400, r)
    except Exception:  # noqa: BLE001
        return h._send(500, {"ok": False, "error": "出错了（细节不显示，避免带出密码）"})
