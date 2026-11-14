"""Rule proposals (lessons) and adopting them into the role's rule file. Moved from stateutil.py (t-oss-struct B1)."""
import datetime as dt
import os

from core.paths import role_md
from core.store import new_id, now, push_mail

# ---------- lessons ----------

def add_lesson(st, agent, text, item=None):
    pending = [l for l in st["lessons"] if l.get("item") == item and l["status"] == "pending" and item]
    if len(pending) >= 2:
        raise SystemExit("at most 2 pending lessons per item")
    l = {"id": new_id("L"), "t": now(), "agent": agent, "text": text, "item": item, "status": "pending"}
    st["lessons"].append(l)
    push_mail(st, "update", f"新规则提议 · {agent}: {text}", item, agent)
    return l


def decide_lesson(st, lesson_id, decision):
    for l in st["lessons"]:
        if l["id"] == lesson_id:
            l["status"] = "adopted" if decision == "adopt" else "dropped"
            l["decided"] = now()
            if l["status"] == "adopted":
                _append_rule(l["agent"], l["text"])
            return l
    raise SystemExit(f"no lesson {lesson_id}")


def _append_rule(agent, text):
    path = role_md(agent, write=True)   # core / local split: with a local layer, adopted rules go to local/roles/<id>.md
    os.makedirs(os.path.dirname(path), exist_ok=True)
    body = open(path, encoding="utf-8").read() if os.path.exists(path) else f"# {agent}\n"
    if "## Confirmed rules" not in body:
        body = body.rstrip() + "\n\n## Confirmed rules\n"
    body = body.rstrip() + f"\n- {text} ({dt.date.today().isoformat()})\n"
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
