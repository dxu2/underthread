"""t-ri1104-p3: build meta.routines_log (dates each routine fired, last 30 per routine) from the routine_due entries already
in inbox.jsonl. Was server.routines_log_backfill(), run on every start until the key existed. A state that has the key
(every install that ran a server since 2026-11-04) is left alone."""
import json
import os

TARGETS = ("state",)
KEEP = 30   # frozen: what server.ROUTINES_LOG_KEEP was when this step was written


def up(data, ctx):
    meta = data.setdefault("meta", {})
    if "routines_log" in meta:
        return data
    days = {}
    try:
        with open(os.path.join(ctx["root"], "inbox.jsonl"), encoding="utf-8") as f:
            for line in f:
                try:
                    e = json.loads(line)
                except ValueError:
                    continue
                if isinstance(e, dict) and e.get("kind") == "routine_due" and e.get("routine") and e.get("date"):
                    days.setdefault(str(e["routine"]), set()).add(str(e["date"]))
    except OSError:
        pass
    meta["routines_log"] = {rid: sorted(ds)[-KEEP:] for rid, ds in days.items()}
    return data
