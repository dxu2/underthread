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
while the checklist is not retired; /api/setup always answers in full."""
import datetime as dt
import os

from api.ctx import S, ROOT
from api.router import route, action, ME

STEPS = ("board", "team", "wake", "say", "card", "decide")
REQUIRED = STEPS
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
            "cmd": CMD, "root": ROOT, "agents_cmd": "python3 make_agents.py"}


@route("GET", "/api/setup")
def _setup(h, u, q):
    return h._send(200, view(S.read()))


@action("onboarding")
def _onboarding(a):
    """op=done: record done_at once (only when steps 1-6 really are ticked); op=show: 「添加小组件」 brought the checklist back (keep);
    op=hide: retire it now (the − on the tile only removes it from the layout; this is for the phone card's 不再显示);
    op=clear_samples: archive every live q-demo-* sample card (t-onb-polish 清掉示例; they stay findable in the archive)."""
    op, ob = a.body.get("op"), a.st["meta"].setdefault("onboarding", {})
    if not isinstance(ob, dict):
        ob = a.st["meta"]["onboarding"] = {}
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
