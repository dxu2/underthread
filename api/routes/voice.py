"""t-vb-2: voice calls. /api/voice/* goes to voicecall.py when it is installed (a local/ module); without it the paths fall
through (GET: 404 at the end; POST: read as JSON, then 404), as before the route table."""
from api.ctx import VC
from api.router import route, NEXT


@route("GET", "/api/voice/", prefix=True)
def _get(h, u, q):
    if not VC:
        return NEXT
    r = VC.handle_get(u.path, q)
    if r:
        return h._send(*r)
    return NEXT


@route("POST", "/api/voice/", prefix=True, raw=True)
def _post(h, u, q, n):   # the clip upload is a raw body, the rest JSON
    if not VC:
        return NEXT
    r = VC.handle_post(u.path, q, h.rfile, n, h.headers)
    if r:
        return h._send(*r)
    return h._send(404, {"error": "not found"})
