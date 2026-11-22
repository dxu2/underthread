"""看画面 / Watch, server side (built-in extension, t-oss-live).

GET /api/live/<agent>.jpg -> the last screenshot that agent pushed (.live/<agent>.jpg, written by tools/live_hook.py or
`stateutil live-frame`). Served only while the agent has a --tool flag and the extension is on: 204 = no flag or switched off (the viewer shows
"ended"), 202 = no frame yet or one older than LIVE_TTL (the viewer keeps waiting); X-Live-Err says which. No 4xx for these
normal states, so a waiting viewer leaves no red lines in the browser console. ETag = mtime, so the viewer's poll
gets 304 until a new frame lands. Frames never go into state.json or a log, and nothing here talks to another host.
"""
import os
import time

from core.ext import ext_on

LIVE_TTL = 15 * 60
_live_w = {}


def register(R):
    srv = R.srv
    S = srv.S

    def live_watch(wp):
        """A viewer is polling -> touch .live/<agent>.watch (at most every 2 s). tools/live_hook.py reads its mtime to decide
        whether to ask the agent for a screenshot after a step that returned no image."""
        t = time.time()
        if t - _live_w.get(wp, 0) < 2:
            return
        _live_w[wp] = t
        try:
            os.makedirs(os.path.dirname(wp), exist_ok=True)
            with open(wp, "a"):
                pass
            os.utime(wp, None)
        except OSError:
            pass

    def live_frame(agent, inm=None):
        """-> (code, jpeg bytes or None, etag, error text)"""
        if not ext_on("live"):
            return 204, None, "", "off"
        a = (S.read().get("agents") or {}).get(agent) or {}
        if not a.get("tool"):
            return 204, None, "", "no tool"
        p = S.live_path(agent)
        live_watch(p[:-4] + ".watch")
        try:
            mt = os.path.getmtime(p)
        except OSError:
            return 202, None, "", "no frame yet"
        if time.time() - mt > LIVE_TTL:
            return 202, None, "", "frame too old"
        tag = '"%d"' % int(mt * 1000)
        if inm and inm == tag:
            return 304, None, tag, ""
        with open(p, "rb") as f:
            return 200, f.read(), tag, ""

    def route(h, u, q):
        if not (u.path.startswith("/api/live/") and u.path.endswith(".jpg")):
            return R.NEXT
        code, jpg, tag, err = live_frame(u.path[len("/api/live/"):-4], q.get("have", [""])[0] or h.headers.get("If-None-Match"))
        hd = {"X-Live-Err": err, "Cache-Control": "no-store"} if err else {"Cache-Control": "no-store"}
        if tag:
            hd.update({"ETag": tag, "X-Live-T": tag.strip('"')})
        if code == 200:
            h._send(200, jpg, "image/jpeg", extra=hd)
        else:
            h._send(code, b"", "text/plain", extra=hd)
        return True

    srv.LIVE_TTL, srv.live_frame, srv.live_watch = LIVE_TTL, live_frame, live_watch
    R.route("GET", "/api/live/", route, prefix=True)
