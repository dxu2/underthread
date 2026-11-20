"""t-onboarding P0: the 开工清单 (setup checklist) and GET /api/setup.

Six steps, each ticked from what is really there (nothing is ticked by a click):
  1 board   the dashboard answered (always true once a page asks)
  2 team    .claude/agents/ has at least one agent file (make_agents.py ran)
  3 wake    the manager has a heartbeat (agents.manager.last_seen)
  4 say     a chat message from you
  5 card    a card that is not one of the q-demo-* samples (live or archived)
  6 decide  you approved, rejected or answered something (samples count)
(「让管家认识你」 was listed as an optional 7th step that could never be ticked; t-onb-polish took it out until it exists, so the page
no longer shows "3 / 6" next to seven numbered steps.)
meta.onboarding = {done_at, retired_at, keep, by}: done_at is written once (action onboarding op=done, sent by the page the first time it sees
1-6 ticked); the checklist retires the day after done_at; 「添加小组件」 brings it back (op=show sets keep). Existing boards are recorded as
done + retired by core/migrations/0003_onboarding.py, so an update never shows it. public_state() carries meta.setup (the view below) only
while the checklist is not retired; /api/setup always answers in full.

t-onb-polish B: five optional steps beside the six, never counted, never in the way of 「全部完成」:
  codex   Codex logged in with ChatGPT (tools/image.py codex_ready, probed in the background, cached 10 min; op=recheck asks again)
  chrome  Claude in Chrome was used once: tools/onb_mark.py chrome (a PostToolUse hook on mcp__claude-in-chrome__* in
          .claude/settings.json) writes meta.onboarding.chrome_at; 「我装好了」 (op=tick k=chrome) writes it by hand
  app     the page was opened as an installed app (display-mode standalone): the page sends op=tick k=app
  look    the skin, texture, theme or language was changed once, or 「就这样」 (op=tick k=look)
  phone   a phone opened the board through Tailscale Serve (note_phone() on /api/state: a *.ts.net Host or a Tailscale-User-Login
          header, and a phone user agent), or 「手机上能用了」 (op=tick k=phone). The probe also reads `tailscale status` and
          `tailscale serve status` (only the server's own port counts) for the three-step guide and the QR code.
op=skip k=<id> folds one away (meta.onboarding.skip), op=unskip brings it back. All new fields; older code does not read them."""
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import threading
import time

from api.ctx import S, ROOT
from api.router import route, action, ME

STEPS = ("board", "team", "wake", "say", "card", "decide")
REQUIRED = STEPS
OPTIONAL = ("codex", "chrome", "app", "look", "phone")
CMD = 'claude "Start the manager per manager.md"'


def _agents_ready():
    d = os.path.join(ROOT, ".claude", "agents")
    try:
        return any(f.endswith(".md") for f in os.listdir(d))
    except OSError:
        return False


def _real(i):
    return not str(i.get("id", "")).startswith("q-demo-")


def _decided(i):
    if any(e.get("who") == ME and e.get("kind") in ("approve", "reject") for e in i.get("thread") or []):
        return True
    return any((a.get("answer") or {}).get("by") == ME for a in i.get("asks") or [])


def _local_day(iso):
    try:
        return dt.datetime.fromisoformat(str(iso)).astimezone().date()
    except (TypeError, ValueError):
        return None


def retired(ob, today=None):
    if not isinstance(ob, dict) or ob.get("keep"):
        return False
    if ob.get("retired_at"):
        return True
    d = _local_day(ob.get("done_at"))
    return bool(d and d < (today or dt.date.today()))


# ---------- optional steps: what the machine says (background probe, never in the request path) ----------
_PR = {"t": 0.0, "v": None, "busy": False}
TS_APP = "/Applications/Tailscale.app/Contents/MacOS/Tailscale"


def _run(args, timeout=8):
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)
        return r.returncode, r.stdout
    except (OSError, subprocess.TimeoutExpired):
        return -1, ""


def _ts_bin():
    b = os.environ.get("TAILSCALE_BIN") or shutil.which("tailscale")
    return b or (TS_APP if os.access(TS_APP, os.X_OK) else None)


def _tailscale(port):
    """{have, on, host, served, url}. on = this computer is signed in and connected; served = `tailscale serve` publishes this port."""
    b = _ts_bin()
    out = {"have": bool(b), "on": False, "host": "", "served": False, "url": ""}
    if not b:
        return out
    rc, so = _run([b, "status", "--json"])
    try:
        js = json.loads(so) if rc == 0 else {}
    except ValueError:
        js = {}
    out["on"] = js.get("BackendState") == "Running"
    out["host"] = str((js.get("Self") or {}).get("DNSName") or "").rstrip(".")
    rc, so = _run([b, "serve", "status", "--json"])
    try:
        sv = json.loads(so) if rc == 0 and so.strip() else {}
    except ValueError:
        sv = {}
    for hp, web in (sv.get("Web") or {}).items():
        for hd in (web.get("Handlers") or {}).values():
            if re.search(r"(127\.0\.0\.1|localhost):%d/?$" % port, str(hd.get("Proxy") or "")):
                out["served"] = True
                name = hp.rsplit(":", 1)[0]
                out["url"] = "https://" + name + ("" if hp.endswith(":443") else ":" + hp.rsplit(":", 1)[1])
    return out


def _codex():
    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location("rt_image_ob", os.path.join(ROOT, "tools", "image.py"))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)   # tools/image.py is not a package
        ok, why = mod.codex_ready()
        return {"ok": bool(ok), "have": bool(mod.codex_bin()), "why": why}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "have": False, "why": f"probe failed ({e.__class__.__name__})"}


def _probe_run():
    try:
        port = int(os.environ.get("PORT") or 8765)
        _PR["v"] = {"codex": _codex(), "ts": _tailscale(port), "at": S.now()}
    finally:
        _PR["t"], _PR["busy"] = time.time(), False


def probe(force=False):
    """The cached machine facts (None until the first background run finishes)."""
    if (force or time.time() - _PR["t"] > 600) and not _PR["busy"]:
        _PR["busy"] = True
        threading.Thread(target=_probe_run, daemon=True).start()
    return _PR["v"]


_MOBILE = re.compile(r"iPhone|iPad|iPod|Android|Mobile", re.I)
_PHONE = {"seen": False}


def note_phone(h):
    """/api/state: the first phone that comes in through Tailscale Serve ticks the phone step (meta.onboarding.phone_at, once)."""
    if _PHONE["seen"]:
        return
    hd = h.headers
    host = (hd.get("Host") or "").split(":")[0].lower().rstrip(".")
    if not (host.endswith(".ts.net") or hd.get("Tailscale-User-Login")):
        return
    if not _MOBILE.search(hd.get("User-Agent") or ""):
        return
    _PHONE["seen"] = True
    try:
        with S.mutate() as st:
            ob = st["meta"].get("onboarding")
            if not isinstance(ob, dict):
                ob = st["meta"]["onboarding"] = {}
            if not ob.get("phone_at"):
                ob["phone_at"] = S.now()
                ob.setdefault("tick_by", {})["phone"] = "auto"
    except Exception as e:  # noqa: BLE001
        print("onboarding phone tick failed:", repr(e), flush=True)


def opt_view(ob, pr):
    pr = pr or {}
    skip = set(ob.get("skip") or [])
    cx, ts = pr.get("codex") or {}, pr.get("ts") or {}
    done = {"codex": bool(cx.get("ok")), "chrome": bool(ob.get("chrome_at")), "app": bool(ob.get("app_at")),
            "look": bool(ob.get("look_at")), "phone": bool(ob.get("phone_at"))}
    return {"steps": [{"id": k, "done": done[k], "skipped": k in skip and not done[k]} for k in OPTIONAL],
            "codex": {"have": cx.get("have"), "why": cx.get("why", "")} if cx else None,
            "ts": ts or None, "checked": pr.get("at"), "port": int(os.environ.get("PORT") or 8765)}


def view(st, archived=None):
    """The checklist as the page draws it. archived = the archive.json items (None = read them here)."""
    if archived is None:
        from api.routes.state import archive_cached   # state.py imports this module lazily too
        archived = archive_cached()["items"]
    items = list(st.get("items") or []) + list(archived or [])
    mgr = (st.get("agents") or {}).get("manager") or {}
    ob = st["meta"].get("onboarding") if isinstance(st["meta"].get("onboarding"), dict) else {}
    done = {
        "board": True,
        "team": _agents_ready(),
        "wake": bool(mgr.get("last_seen")),
        "say": any(m.get("who") == ME for m in st.get("chat") or []),
        "card": any(_real(i) for i in items),
        "decide": any(_decided(i) for i in items),
    }
    req = [k for k in REQUIRED if done[k]]
    nxt = next((k for k in REQUIRED if not done[k]), None)
    return {"steps": [{"id": k, "done": done[k], "optional": False} for k in STEPS],
            "n": len(req), "of": len(REQUIRED), "next": nxt, "all": nxt is None,
            "done_at": ob.get("done_at"), "keep": bool(ob.get("keep")), "retired": retired(ob),
            "cmd": CMD, "root": ROOT, "agents_cmd": "python3 make_agents.py", "opt": opt_view(ob, probe())}


@route("GET", "/api/setup")
def _setup(h, u, q):
    return h._send(200, view(S.read()))


TICK = {"chrome": "chrome_at", "app": "app_at", "look": "look_at", "phone": "phone_at"}


@action("onboarding")
def _onboarding(a):
    """op=done: record done_at once (only when steps 1-6 really are ticked); op=show: 「添加小组件」 brought the checklist back (keep);
    op=hide: retire it now (the − on the tile only removes it from the layout; this is for the phone card's 不再显示);
    op=clear_samples: archive every live q-demo-* sample card (t-onb-polish 清掉示例; they stay findable in the archive);
    op=tick k=chrome|app|look|phone: an optional step is done (meta.onboarding.tick_by[k] = me, or auto for app / look, which only the page sees);
    op=skip / unskip k=<optional id>: fold one away or bring it back; op=recheck: probe Codex and Tailscale again now."""
    op, ob = a.body.get("op"), a.st["meta"].setdefault("onboarding", {})
    if not isinstance(ob, dict):
        ob = a.st["meta"]["onboarding"] = {}
    k = a.body.get("k")
    if op in ("skip", "unskip", "tick") and k not in (OPTIONAL if op != "tick" else TICK):
        raise ValueError("bad optional step")
    if op == "tick":
        if not ob.get(TICK[k]):
            ob[TICK[k]] = S.now()
            ob.setdefault("tick_by", {})[k] = "auto" if a.body.get("auto") else ME
        return
    if op in ("skip", "unskip"):
        sk = [x for x in (ob.get("skip") or []) if x in OPTIONAL and x != k]
        ob["skip"] = sk + [k] if op == "skip" else sk
        return
    if op == "recheck":
        probe(force=True)
        return
    if op == "done":
        if not ob.get("done_at") and view(a.st)["all"]:
            ob["done_at"] = S.now()
    elif op == "show":
        ob["keep"] = True
        ob.pop("retired_at", None)
    elif op == "clear_samples":
        for it in a.st.get("items") or []:
            if not _real(it) and not it.get("archived"):
                it["archived"] = True
                it["updated"] = S.now()
        return
    elif op == "hide":
        ob["keep"] = False
        ob["retired_at"] = S.now()
    else:
        raise ValueError("bad onboarding op")
