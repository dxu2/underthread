"""Questions for the user on a card, answered by a click (t-open-questions). Moved from stateutil.py (t-oss-struct B1)."""
import uuid

from core.store import add_thread, now

# ---------- t-open-questions: asks = questions for the user, answered by a click ----------
# it["asks"] = [{id, q, options[], other, by, t, answer: None | {opt, by, t}, closed?: time}]

def parse_ask(spec):
    """'问题 :: A | B | C' -> ('问题', ['A', 'B', 'C'])"""
    q, _, opts = spec.partition("::")
    return q.strip(), [o.strip() for o in opts.split("|") if o.strip()]


def split_rec(options):
    """t-ask-rec: a trailing * marks the asker's recommended option: ['换', '不换*'] -> (['换', '不换'], '不换'). First * wins."""
    rec, out = None, []
    for o in options:
        if o.endswith("*") and o.rstrip("*").strip():
            o = o.rstrip("*").strip()
            rec = rec or o
        out.append(o)
    return out, rec


def add_ask(it, who, q, options, other=True):
    if not q:
        raise SystemExit("ask needs a question")
    if not options:
        raise SystemExit("ask needs options, e.g. 'question :: A | B'")
    options, rec = split_rec(options)
    a = {"id": uuid.uuid4().hex[:6], "q": q, "options": options, "other": bool(other), "by": who, "t": now(), "answer": None}
    if rec:
        a["rec"] = rec
    it.setdefault("asks", []).append(a)
    add_thread(it, who, f"提问 · {q}（{' / '.join(o + ('（推荐）' if o == rec else '') for o in options)}）", "event")
    return a


def open_asks(it):
    """Asks still waiting on the user (not answered, not withdrawn)."""
    return [a for a in it.get("asks") or [] if not a.get("answer") and not a.get("closed")]


def answer_ask(it, ask_id, opt, who="me"):
    a = next((x for x in it.get("asks") or [] if x["id"] == ask_id), None)
    if not a:
        raise ValueError(f"no ask {ask_id}")
    if a.get("closed"):
        raise ValueError("这个问题已经撤回了")
    if opt not in a["options"]:
        raise ValueError("不是这个问题的选项")
    changed = bool(a.get("answer"))
    a["answer"] = {"opt": opt, "by": who, "t": now()}
    e = add_thread(it, who, f"{'改选' if changed else '回答'} · {a['q']} → {opt}", "msg", to=a.get("by"))
    e["reply_to"] = "ask:" + a["id"]   # t-option-quote: the card shows it as a quote of the question + the option
    return a, changed
