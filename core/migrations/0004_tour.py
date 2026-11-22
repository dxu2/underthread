"""t-onboard-tour: meta.onboarding.tour, where the first-run welcome (five pages) + the anchored tour have been seen, per form factor:
{"desk": {"at", "how"}, "phone": {"at", "how"}}; how = done | skip | upgrade. The page opens the welcome by itself only while its form has
no entry. A board that has already been used (same test as 0003: a card that is not a q-demo-* sample, a chat message or a manager
heartbeat) is an existing install: both forms are recorded as how=upgrade, so an update never shows the tour (Settings → 再走一遍 still can).
A fresh seed is left alone. Idempotent and add-only."""

TARGETS = ("state",)


def used(data):
    items = data.get("items") or []
    mgr = (data.get("agents") or {}).get("manager") or {}
    return (any(not str(i.get("id", "")).startswith("q-demo-") for i in items)
            or bool(data.get("chat")) or bool(mgr.get("last_seen")))


def up(data, ctx):
    meta = data.setdefault("meta", {})
    ob = meta.get("onboarding")
    if not isinstance(ob, dict):
        ob = meta["onboarding"] = {}
    tour = ob.get("tour")
    if not isinstance(tour, dict):
        tour = ob["tour"] = {}
    if used(data):
        for form in ("desk", "phone"):
            tour.setdefault(form, {"at": ctx["now"], "how": "upgrade"})
    return data
