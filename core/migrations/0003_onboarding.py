"""t-onboarding P0: meta.onboarding, the state of the 开工清单 (setup checklist). A board that has already been used (a card that is not
one of the q-demo-* samples, a chat message or a manager heartbeat) is an existing user: it is recorded as done and retired, so the
checklist never appears after an update. A fresh seed gets an empty dict. "setup" also joins meta.widgets.seen so an existing saved
widget layout is not handed the new tile (web/js/widgets.js meet()). Idempotent and add-only."""

TARGETS = ("state",)


def used(data):
    items = data.get("items") or []
    mgr = (data.get("agents") or {}).get("manager") or {}
    return (any(not str(i.get("id", "")).startswith("q-demo-") for i in items)
            or bool(data.get("chat")) or bool(mgr.get("last_seen")))


def up(data, ctx):
    meta = data.setdefault("meta", {})
    if not isinstance(meta.get("onboarding"), dict):
        meta["onboarding"] = {"done_at": ctx["now"], "retired_at": ctx["now"], "by": "upgrade"} if used(data) else {}
    w = meta.get("widgets")
    if isinstance(w, dict) and isinstance(w.get("seen"), list) and "setup" not in w["seen"]:
        w["seen"] = sorted(set(w["seen"]) | {"setup"})
    return data
