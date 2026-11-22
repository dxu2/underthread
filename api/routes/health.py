"""/api/health (the 系统状态 panel) and /api/usage (per-role tokens from the local transcripts)."""
import datetime as dt
import os
import re
import shutil
import threading
import time

from api.ctx import S, MG, ROOT, CONFIG, START, USAGE, _health
from api.router import route
from core import registry as REG
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


CODE_DIRS = ("core", "api", "ext", os.path.join("local", "ext"))
CODE_FILES = ("server.py", "stateutil.py")


def _code_sig():
    """t-iter-upgrade: {relative path: (mtime_ns, size)} of the Python this server runs (server.py, stateutil.py, core/, api/,
    local/ext/). Taken once at start; /api/health compares, so a git pull, an update without a restart or an edit on disk shows
    up as "restart needed" instead of the old code quietly running on."""
    out = {}
    for f in CODE_FILES:
        try:
            st = os.stat(os.path.join(ROOT, f))
            out[f] = (st.st_mtime_ns, st.st_size)
        except OSError:
            pass
    for d in CODE_DIRS:
        for base, dirs, files in os.walk(os.path.join(ROOT, d)):
            dirs[:] = [x for x in dirs if x not in ("__pycache__", "backups", "node_modules") and not x.startswith(".")]
            for f in files:
                if f.endswith(".py"):
                    p = os.path.join(base, f)
                    try:
                        st = os.stat(p)
                    except OSError:
                        continue
                    out[os.path.relpath(p, ROOT)] = (st.st_mtime_ns, st.st_size)
    return out


_CODE0 = _code_sig()
_code = {"t": 0.0, "changed": []}


def code_changed():
    """Python files added, removed or changed since this server started (sorted, cached 20 s)."""
    t = time.time()
    if t - _code["t"] > 20:
        now = _code_sig()
        _code["changed"] = sorted(k for k in set(now) | set(_CODE0) if now.get(k) != _CODE0.get(k))
        _code["t"] = t
    return _code["changed"]


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
                   "loops": not os.environ.get("NO_LOOPS"),
                   "code_stale": bool(code_changed()), "code_changed": code_changed()[:8]},   # t-iter-upgrade: restart needed
        "schema": MG.status(ROOT, st),   # t-oss-struct E1: code / state / config / roster schema numbers, "ahead" after a rollback
        "push": {"devices": len(subs), "last_at": last and last["last_at"], "last_code": last and last.get("last_code"),
                 "failing": sum(1 for s in subs if s.get("last_code") and not 200 <= s["last_code"] < 300)},
        "report": {"time": CONFIG.get("report_time", "18:00"), "last_date": st["meta"].get("last_report_date"),
                   "queued": st["meta"].get("report_queued")},
        "disk": disk if disk.get("total") else None,
        "ext": _ext_brief(),
        "feeds": _feeds(),
        "image": _image(),
    }


_img = {"t": 0.0, "v": None, "busy": False}


def _image_probe():
    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location("rt_image", os.path.join(ROOT, "tools", "image.py"))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)   # tools/image.py (not a package)
        _img["v"] = mod.resolve()
    except Exception as e:  # noqa: BLE001
        _img["v"] = {"backend": "none", "setting": "?", "why": f"probe failed ({e.__class__.__name__})"}
    _img["t"], _img["busy"] = time.time(), False


def _image():
    """t-oss-gen-s3: which picture backend tools/image.py would use (cached 10 min; the first call answers None)."""
    if time.time() - _img["t"] > 600 and not _img["busy"]:
        _img["busy"] = True
        threading.Thread(target=_image_probe, daemon=True).start()
    return _img["v"]


def _feeds():
    """t-feed-inbox: connected sources, how many are on, which have an error, messages today."""
    try:
        from core.feeds import collector
        return collector.summary()
    except Exception:  # noqa: BLE001
        return None


def _ext_brief():
    """t-oss-struct S8: registry API number, each extension's state and its R.health lines (full view: /api/ext)."""
    v = REG.view()
    return {"api": v["api"], "extensions": [{k: e[k] for k in ("name", "legacy", "skipped", "error")} for e in v["extensions"]],
            "health": v["health"]}


@route("GET", "/api/ext")
def _ext(h, u, q):   # t-oss-struct S8: the registry (extensions, card kinds, jobs) for the page and docs
    return h._send(200, REG.view())


@route("GET", "/api/health")
def _health_route(h, u, q):
    return h._send(200, health())


@route("GET", "/api/usage")
def _usage(h, u, q):   # t-home-usage: per-role tokens today from the local transcripts (core/usage_roll.py, 60 s cache)
    if not USAGE:
        return h._send(503, {"error": "usage_roll not loaded"})
    d = q.get("day", [""])[0]
    return h._send(200, USAGE.report(d if re.fullmatch(r"\d{4}-\d{2}-\d{2}", d or "") else None))
