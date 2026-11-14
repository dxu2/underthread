"""Agent status (set_agent + its extension hooks), the open HR interview, and role-name aliases.
Moved from stateutil.py (t-oss-struct B1); stateutil re-exports every name."""
from core.ext import SET_AGENT_HOOKS
from core.store import now, read

# ---------- agents ----------

def set_agent(st, agent_id, auto=False, **fields):
    """auto=True: the change comes from automation (a hook), not from the agent itself; extensions may treat it differently."""
    a = st["agents"].setdefault(agent_id, {"id": agent_id, "status": "idle"})
    was = a.get("status")
    tool = fields.pop("tool", None)
    for k, v in fields.items():
        if v is not None:
            a[k] = v
    new = fields.get("status")
    if new == "working" and (was != "working" or not a.get("since")):
        a["since"] = now()          # t-office-d1: when this stretch of work started; the home strip shows "23:12 起 · 12 分钟"
    elif new and new != "working":
        a.pop("since", None)
    if fields.get("status") == "idle":
        a["item"] = None
    if fields.get("status") and fields["status"] != "sleeping":
        a.pop("wake_at", None)
    # t-chrome-badge: agents[id].tool = the outside tool this agent is driving right now ("chrome", "computer", ...); "" / idle / offline / sleeping clears it
    if tool is not None:
        if tool.strip():
            if a.get("tool") != tool.strip():
                a["tool_since"] = now()
            a["tool"] = tool.strip()
        else:
            a.pop("tool", None); a.pop("tool_since", None)
    if new in ("idle", "offline", "sleeping") and not (tool and tool.strip()):
        a.pop("tool", None); a.pop("tool_since", None)
    for h in SET_AGENT_HOOKS:
        h(st, agent_id, a, auto, tool)
    a["last_seen"] = now()
    return a


# ---------- t-hr-build: HR interview cards (hire-*) ----------
# it["hire"] = {job, variant, job_name, variant_label, status: asking|applying|hired|failed|abandoned, turns, filled, hired_id}
HIRE_SLOTS = 5


def open_interview(st):
    """The one interview still running (not hired / abandoned, card not done), or None. HR talks to one person at a time."""
    for it in st.get("items", []):
        h = it.get("hire")
        if isinstance(h, dict) and it.get("stage") != "done" and h.get("status") not in ("hired", "abandoned"):
            return it
    return None


def norm_who(w):
    """q-1030-2214: a writer id that is not a roster id but a role's own name (e.g. its name_en, "steward" for manager) is stored as that role's id,
    so the dashboard finds its avatar. Unknown ids and "me" stay as they are."""
    if not w or w == "me":
        return w
    try:
        ags = read().get("agents") or {}
    except Exception:  # noqa: BLE001
        return w
    if w in ags:
        return w
    k = w.strip().lower()
    for aid, ag in ags.items():
        if any(n and str(n).strip().lower() == k for n in (ag.get("name_en"), ag.get("name"))):
            return aid
    return w
