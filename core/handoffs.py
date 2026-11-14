"""The handoff log (t-rb-build). Moved from stateutil.py (t-oss-struct B1); stateutil re-exports every name."""
import uuid

from core.items import find_item
from core.store import _cap, now

# ---------- t-rb-build: explicit handoff log ----------
# st["handoffs"] = [{id, t, f, to, item, title, via}] (last CAPS["handoffs"]), st["ho_last"] = {item: agent who last held it}.
# A handoff = work on one card moves from one team role to another: set-agent X working --item I (via "dispatch" when the
# manager held it, else "pickup"), a reply on the card by a different role ("reply"), `stateutil handoff` ("dispatch"), and the
# user's 改派 on the dashboard ("reassign", server.py). The user ("me") never counts. The first time a card is seen, the last
# holder is taken from its thread (last role that wrote on it). meta.ho_start = when the log began; server.py infers the
# history before that from card threads (ho.py's rule) and marks those entries inf=1.
HO_LAST_MAX = 2000


def _ho_seed(st, it, who):
    ids = st.get("agents") or {}
    for m in reversed(it.get("thread") or []):
        w = m.get("who")
        if w in ids and w != "me":
            return w
    return None


def ho_touch(st, item_id, who):
    """The manager editing a card (upsert) takes it back silently, so its next set-agent counts as a dispatch from the manager."""
    if item_id and who in (st.get("agents") or {}):
        last = st.setdefault("ho_last", {}); last.pop(item_id, None); last[item_id] = who


def note_hand(st, item_id, who, via, frm=None):
    """Record a handoff on item_id to `who` if the card was last held by another role. Returns the entry or None."""
    ids = st.get("agents") or {}
    if not item_id or not who or who == "me" or who not in ids:
        return None
    st.setdefault("handoffs", []); last = st.setdefault("ho_last", {})
    st["meta"].setdefault("ho_start", now())
    it = find_item(st, item_id)
    prev = frm or last.get(item_id) or (_ho_seed(st, it, who) if it else None)
    last.pop(item_id, None); last[item_id] = who   # re-insert: newest at the end, oldest trimmed first
    if len(last) > HO_LAST_MAX:
        for k in list(last)[: len(last) - HO_LAST_MAX]:
            last.pop(k, None)
    if not prev or prev == who or prev == "me" or prev not in ids:
        return None
    if via in ("pickup", "auto"):
        via = "dispatch" if prev == "manager" else "pickup"
    e = {"id": uuid.uuid4().hex[:8], "t": now(), "f": prev, "to": who, "item": item_id,
         "title": (it or {}).get("title", "")[:120], "via": via}
    st["handoffs"].append(e)
    _cap(st["handoffs"], "handoffs")
    return e
