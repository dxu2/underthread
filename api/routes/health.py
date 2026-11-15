"""/api/health (the 系统状态 panel) and /api/usage (per-role tokens from the local transcripts)."""
import datetime as dt
import os
import re
import shutil
import threading
import time

from api.ctx import S, MG, ROOT, CONFIG, START, USAGE, _comfy, _health
from api.router import route
from api.routes.push import _subs


def _work_size():
    """Bytes under work/ (os.walk is slow on big folders: runs in a thread, cached 15 minutes)."""
    total = 0
    for d, _, files in os.walk(os.path.join(ROOT, "work")):
        for f in files:
            try:
                total += os.lstat(os.path.join(d, f)).st_size
            except OSError:
                pass
    with _health["lock"]:
        _health["work"], _health["work_t"], _health["work_busy"] = total, time.time(), False


def health():
    """t-imp-p4: the 系统状态 panel. Cheap and cached; NOT part of /api/state (polled every 2.5 s).
    Usage and the manager heartbeat are already in /api/state, so they are not repeated here."""
    t = time.time()
    with _health["lock"]:
        if t - _health["disk_t"] > 60:
            try:
                du = shutil.disk_usage(ROOT)
                _health["disk"] = {"free": du.free, "total": du.total}
            except OSError:
                _health["disk"] = None
            _health["disk_t"] = t
        if t - _health["work_t"] > 900 and not _health["work_busy"]:
            _health["work_busy"] = True
            threading.Thread(target=_work_size, daemon=True).start()
        disk = dict(_health["disk"] or {}, work=_health["work"],
                    work_at=dt.datetime.fromtimestamp(_health["work_t"]).astimezone().isoformat(timespec="seconds") if _health["work_t"] else None)
    subs = _subs()
    sends = sorted((s for s in subs if s.get("last_at")), key=lambda s: s["last_at"])
    last = sends[-1] if sends else None
    st = S.read()
    return {
        "now": S.now(),
        "server": {"started": dt.datetime.fromtimestamp(START).astimezone().isoformat(timespec="seconds"),
                   "uptime": int(t - START), "pid": os.getpid(), "rev": st["meta"].get("rev"),
                   "loops": not os.environ.get("NO_LOOPS")},
        "comfy": dict(_comfy),
        "schema": MG.status(ROOT, st),   # t-oss-struct E1: code / state / config / roster schema numbers, "ahead" after a rollback
        "push": {"devices": len(subs), "last_at": last and last["last_at"], "last_code": last and last.get("last_code"),
                 "failing": sum(1 for s in subs if s.get("last_code") and not 200 <= s["last_code"] < 300)},
        "report": {"time": CONFIG.get("report_time", "18:00"), "last_date": st["meta"].get("last_report_date"),
                   "queued": st["meta"].get("report_queued")},
        "disk": disk if disk.get("total") else None,
    }


@route("GET", "/api/health")
def _health_route(h, u, q):
    return h._send(200, health())


@route("GET", "/api/usage")
def _usage(h, u, q):   # t-home-usage: per-role tokens today from the local transcripts (usage_roll.py, 60 s cache)
    if not USAGE:
        return h._send(503, {"error": "usage_roll not loaded"})
    d = q.get("day", [""])[0]
    return h._send(200, USAGE.report(d if re.fullmatch(r"\d{4}-\d{2}-\d{2}", d or "") else None))
