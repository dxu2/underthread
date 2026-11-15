"""t-dash-token: the GitHub push token (tools/ghcred.py). GET = status only, never the token. POST reads its own body and has its
own error handling: the body may hold the token, so it is never logged, echoed, stored in state / inbox or put in an error."""
import json
from urllib.parse import urlparse

from api.ctx import GH
from api.router import route


@route("GET", "/api/secret/github")
def _status(h, u, q):
    if not GH:
        return h._send(503, {"error": "ghcred not loaded"})
    try:
        return h._send(200, GH.status())
    except Exception:  # noqa: BLE001
        return h._send(500, {"error": "读状态失败"})


@route("POST", "/api/secret/github", raw=True)
def _post(h, u, q, n):
    return gh_post(h, n)


def gh_post(self, n):
    """t-dash-token. The body may hold the token: it is never logged, echoed, stored in state/inbox or put in an error."""
    try:
        raw = self.rfile.read(n) if 0 < n <= 4096 else b""
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        origin = self.headers.get("Origin")
        host = self.headers.get("Host") or ""
        if not self._hdr_ok() or ctype != "application/json":
            return self._send(403, {"ok": False, "error": "forbidden"})
        oh = urlparse(origin).hostname or "" if origin else ""
        if origin and urlparse(origin).netloc not in (host, self.headers.get("X-Forwarded-Host") or host) \
                and oh not in ("127.0.0.1", "localhost") and not oh.endswith(".ts.net"):   # page itself, or the phone through Tailscale Serve
            return self._send(403, {"ok": False, "error": "forbidden"})
        if not GH:
            return self._send(503, {"ok": False, "error": "ghcred not loaded"})
        try:
            body = json.loads(raw or b"{}")
        except ValueError:
            body = None
        raw = None
        if not isinstance(body, dict):
            return self._send(400, {"ok": False, "error": "bad request"})
        op = body.get("op")
        if op == "set":
            r = GH.set_token(body.get("token"))
        elif op == "probe":
            r = {"ok": True, "probe": GH.probe(), "status": GH.status()}
        elif op == "test":
            r = GH.test()
        elif op == "erase":
            r = GH.erase()
        elif op == "use_file":
            r = GH.use_file() if body.get("confirm") is True else {"ok": False, "error": "需要确认"}
        elif op == "use_keychain":
            r = GH.use_keychain()
        else:
            r = {"ok": False, "error": "unknown op"}
        body = None
        return self._send(200 if r.get("ok") else 400, r)
    except Exception:  # noqa: BLE001
        return self._send(500, {"ok": False, "error": "出错了（细节不显示，避免带出令牌）"})
