"""Settings -> System -> Updates (t-oss-struct S5). GET /api/update: version, the last check, what would make an update
wait, the running update's steps, whether a rollback is possible and whether the server needs a restart (its Python changed on
disk since it started). POST /api/update {"op": "check" | "apply" | "rollback" | "restart"}: starts tools/update.py in its own process group (it restarts this server; keepalive / launchd bring the new
one up) and answers at once; the page polls GET for the steps. The daily check runs in api/loops.py (update_check_loop)."""
import datetime as dt
import importlib.util
import os
import subprocess
import sys
import threading
import time

from api.ctx import S, ROOT, CONFIG, VC
from api.router import route

_U = {"mod": None, "lock": threading.Lock(), "spawned": 0}


def U():
    """tools/update.py as a module (tools/ is not a package)."""
    if _U["mod"] is None:
        spec = importlib.util.spec_from_file_location("ut_update", os.path.join(ROOT, "tools", "update.py"))
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        _U["mod"] = m
    return _U["mod"]


def _blockers():
    """The cheap, in-process half of update.blockers() (no HTTP to ourselves): a voice call, crew at work, another run."""
    out = []
    u = U()
    if not u.is_git():
        return [{"code": "zip", "text": "not a git install"}]
    r = u.running()
    if r:
        out.append({"code": "running", "text": r.get("op") or "update"})
    if VC:
        try:
            code, vh = VC.handle_get("/api/voice/health", {})
            if code == 200 and isinstance(vh, dict) and vh.get("calls"):
                out.append({"code": "call", "text": "voice call"})
        except Exception:
            pass
    ag = S.read().get("agents") or {}
    busy = sorted(a.get("id") for a in (ag.values() if isinstance(ag, dict) else ag)
                  if isinstance(a, dict) and a.get("status") == "working" and a.get("id") != "manager")
    if busy:
        out.append({"code": "agents", "text": ", ".join(busy)})
    return out


def view():
    u = U()
    c = u.rj(u.upath("check.json"), {}) or {}
    h = u.history()
    git = u.is_git()
    head = u.git("rev-parse", "HEAD", check=False) if git else ""
    ver = u.version_file()
    last_ok = next((x for x in reversed(h) if x.get("op") == "apply" and x.get("status") == "ok"), None)
    run = u.rj(u.upath("run.json"))
    if run and not run.get("done") and not u.pid_alive(run.get("pid")):
        run = dict(run, done=True, ok=False, message="the update process ended without a result")
    lt = c.get("latest")
    return {
        "git": git, "version": ver, "commit": head[:7],
        "check": {k: c.get(k) for k in ("at", "latest", "latest_commit", "error", "remote")},
        "notes": [dict(n, text=n.get("text", "")[:4000]) for n in (c.get("notes") or [])][:6],
        "available": bool(lt and u.vt(lt) and u.vt(lt) > (u.vt(ver) or (0, 0, 0))),
        "blockers": _blockers(),
        "run": run,
        "rollback": ({"to": last_ok["from"][:7], "version": last_ok.get("from_version"), "at": last_ok.get("done")}
                     if last_ok and head == last_ok.get("to") else None),
        "last": h[-1] if h else None,
        "auto_check": (CONFIG.get("update") or {}).get("check", True) is not False,
        "restart": _restart_view(),
    }


def _restart_view():
    """t-iter-upgrade: {"needed": bool, "changed": [...]} from api/routes/health.code_changed (files changed since start)."""
    try:
        from api.routes.health import code_changed
        ch = code_changed()
    except Exception:  # noqa: BLE001
        ch = []
    return {"needed": bool(ch), "changed": ch[:8], "count": len(ch)}


def spawn(op):
    """Run tools/update.py <op> detached: its own session, so restarting this server does not stop it."""
    u = U()
    os.makedirs(u.upd_dir(), exist_ok=True)
    log = open(os.path.join(u.upd_dir(), "run.log"), "a")
    log.write(f"\n==== {dt.datetime.now().astimezone().isoformat(timespec='seconds')} {op}\n")
    log.flush()
    subprocess.Popen([sys.executable, os.path.join(ROOT, "tools", "update.py"), op], cwd=ROOT, stdin=subprocess.DEVNULL,
                     stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
                     env={k: v for k, v in os.environ.items() if k not in ("PORT", "NO_LOOPS")})
    _U["spawned"] = time.time()


@route("GET", "/api/update")
def _get(h, u, q):
    return h._send(200, view())


@route("POST", "/api/update")
def _post(h, u, body):
    op = body.get("op")
    if op not in ("check", "apply", "rollback", "restart"):
        return h._send(400, {"error": "op must be check, apply, rollback or restart"})
    with _U["lock"]:
        if time.time() - _U["spawned"] < 3 or U().running():
            return h._send(409, {"error": "an update is already running"})
        if op != "check":
            b = [x for x in _blockers() if x["code"] != "running" and not (op == "restart" and x["code"] == "agents")]   # a restart does not stop teammates
            if b:
                return h._send(409, {"error": "not now", "blockers": b})
        spawn(op)
    return h._send(200, {"ok": True, "op": op})


def check_due():
    """For the daily loop: True when the last check is older than a day and checks are on."""
    if (CONFIG.get("update") or {}).get("check", True) is False:
        return False
    u = U()
    if not u.is_git():
        return False
    c = u.rj(u.upath("check.json"), {}) or {}
    try:
        last = dt.datetime.fromisoformat(c["at"]).timestamp()
    except (KeyError, ValueError, TypeError):
        last = 0
    return time.time() - last > 86400


def run_check():
    if check_due() and not U().running():
        subprocess.run([sys.executable, os.path.join(ROOT, "tools", "update.py"), "check"], cwd=ROOT,
                       stdin=subprocess.DEVNULL, capture_output=True, timeout=180)
        try:
            with S.mutate():
                pass   # wake the long poll so an open settings page shows the result
        except Exception:
            pass
