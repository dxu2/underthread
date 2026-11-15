"""Schedules in state.json: create, fire, pause, import old config routines. The rule maths are core/schedules.py.
Moved from stateutil.py (t-oss-struct B1); stateutil re-exports every name."""
import datetime as dt

from core import schedules as SC
from core.store import inbox_append, new_id, now, push_mail

# ---------- t-schedule-backend: one-sentence schedules (state.schedules) ----------
# The manager turns "一小时后提醒我 X" / "以后每周一 9 点跑 Y" into `schedule add`. server.py schedule_loop (30 s) calls schedules_due():
# a due entry drops an inbox entry for the manager (kind schedule_due; imported config routines keep kind routine_due), and a reminder
# also goes into the mailbox, which push_loop sends to the phone with no manager needed. Rule maths live in core/schedules.py.

SCHED_PURGE_DAYS = 30   # soft-deleted entries are dropped after this


def _aware_now(tz=None):
    return dt.datetime.now(SC.zone(tz))


def schedule_find(st, sid):
    return next((x for x in st.setdefault("schedules", []) if x.get("id") == sid and not x.get("deleted")), None)


def schedule_new(st, title, kind, rule, tz=None, text="", agent=None, item=None, said="", by="manager", end=None, routine=None,
                 nowt=None, sid=None):
    """Build (not store) a schedule entry with its first `next`. Raises SC.RuleError."""
    tz = tz or SC.local_tz_name()
    SC.zone(tz); SC.check_rule(rule)
    if kind not in SC.KINDS and kind != "job":   # "job" = an extension's scheduled job (core/registry.py jobs_import), never typed by hand
        raise SC.RuleError(f"kind 只能是 remind 或 task，收到 {kind!r}")
    if not (title or "").strip():
        raise SC.RuleError("要有标题（--title）")
    nowt = nowt or _aware_now(tz)
    nxt = SC.next_after(rule, tz, nowt)
    if not nxt:
        raise SC.RuleError(f"{SC.describe(rule)} 已经过去了")
    return {"id": sid or new_id("s"), "title": title.strip(), "kind": kind, "rule": rule, "tz": tz,
            "task": {"text": text or "", "agent": agent, "item": item}, "said": said or "", "enabled": True,
            "next": SC.iso(nxt), "last": None, "runs": [], "created": now(), "by": by, "routine": routine, "end": end or None}


def schedule_emit(st, s, for_iso, late, manual=False, skipped=0):
    """What a run produces. Called inside mutate() so a failed inbox append also drops the state change."""
    tk = s.get("task") or {}
    if s.get("kind") == "job":   # t-oss-struct S8: no inbox entry; the server runs the extension's function (registry.run_pending)
        s["job_pending"] = {"for": for_iso, "manual": bool(manual)}
        return {"kind": "job_due", "schedule": s["id"], "job": s.get("job"), "title": s["title"], "for": for_iso, "late_min": late,
                **({"manual": True} if manual else {}), **({"skipped": skipped} if skipped else {})}
    day = (SC.parse_iso(for_iso) or _aware_now(s.get("tz"))).astimezone(SC.zone(s.get("tz"))).date().isoformat()
    if s.get("routine"):   # imported config routine: same entry as before, so manager.md's routine_due handling is unchanged
        e = {"kind": "routine_due", "routine": s["routine"], "label": s["title"], "time": s["rule"].get("at"), "date": day,
             "schedule": s["id"], "late_min": late}
        if not manual:
            st["meta"].setdefault("routines_fired", {})[s["routine"]] = day
    else:
        e = {"kind": "schedule_due", "schedule": s["id"], "type": s["kind"], "title": s["title"], "text": tk.get("text", ""),
             "agent": tk.get("agent"), "item": tk.get("item"), "for": for_iso, "late_min": late}
    if manual:
        e["manual"] = True
    if skipped:
        e["skipped"] = skipped   # earlier runs missed while the server was down; only this one fires
    inbox_append(e)
    if s["kind"] == "remind":
        txt = f"⏰ 提醒：{s['title']}"
        if late >= 5:
            txt += f"（晚了 {late} 分钟，看板刚恢复）"
        push_mail(st, "remind", txt, item=tk.get("item"), agent=tk.get("agent"))
    return e


def schedules_due(st, nowt=None):
    """Fire every enabled entry whose `next` has passed (one run each, however many were missed). Returns [(entry, inbox entry)]."""
    nowt = nowt or _aware_now()
    out = []
    for s in st.setdefault("schedules", []):
        if s.get("deleted") or not s.get("enabled") or not s.get("next"):
            continue
        if nowt >= SC.parse_iso(s["next"]):
            for_iso, late, skipped = SC.advance(s, nowt)
            out.append((s, schedule_emit(st, s, for_iso, late, skipped=skipped)))
    cut = (nowt - dt.timedelta(days=SCHED_PURGE_DAYS)).isoformat()
    st["schedules"] = [s for s in st["schedules"] if not (s.get("deleted") and s["deleted"] < cut)]
    return out


def schedules_needs_tick(st, nowt=None):
    """Cheap read-only test, so the loop only takes the write lock when something is due."""
    nowt = nowt or _aware_now()
    return any(not s.get("deleted") and s.get("enabled") and s.get("next") and nowt >= SC.parse_iso(s["next"])
               for s in st.get("schedules") or [])


def schedules_import_routines(st, routines, nowt=None):
    """Once per routine id: config.json routines -> schedules (daily task entries tagged with routine=<id>).
    meta.schedules_imported lists the ids already taken, so a schedule you delete is not re-imported, while a routine added to
    config.json later still is. Keeps today's state: fired today -> next is tomorrow; not fired yet -> today's time (it fires on the
    next tick if that has passed, as before); never seen -> next run after now (the old 'first seen after its time' rule)."""
    meta = st["meta"]
    done = meta.setdefault("schedules_imported", [])
    fired, paused, log = meta.get("routines_fired") or {}, meta.get("routines_paused") or {}, meta.get("routines_log") or {}
    tz = SC.local_tz_name()
    nowt = nowt or _aware_now(tz)
    today = nowt.astimezone(SC.zone(tz)).date()
    added = []
    for r in routines or []:
        if not isinstance(r, dict) or not r.get("id") or r["id"] in done:
            continue
        rid, tm = r["id"], SC._hm(str(r.get("time", "10:00")))
        rule = {"type": "daily", "at": tm}
        s = schedule_new(st, r.get("label") or rid, "task", rule, tz=tz, text=r.get("label", ""), item=r.get("item") or "r-" + rid,
                         by="import", routine=rid, nowt=nowt, sid="s-rt-" + rid)
        if rid in fired and fired[rid] != today.isoformat():
            s["next"] = SC.iso(SC.wall(today, tm, SC.zone(tz)))   # today's run still owed (may already be due)
        s["last"] = fired.get(rid) or None
        s["runs"] = [{"for": SC.iso(SC.wall(dt.date.fromisoformat(d), tm, SC.zone(tz))), "at": None, "late": 0} for d in (log.get(rid) or [])[-SC.RUNS_KEEP:]]
        if rid in paused or r.get("enabled", True) is False:
            s["enabled"] = False
            p = paused.get(rid)
            s["paused"] = p if isinstance(p, dict) else {"at": p or now(), "by": "import"}
        st.setdefault("schedules", []).append(s)
        done.append(rid)
        added.append(s["id"])
    if added:
        meta["schedules_migrated"] = meta.get("schedules_migrated") or now()
    return added


def schedule_pause(st, s, on, by="manager", nowt=None):
    """on=True pauses. Resuming never starts a run that was missed while paused: next = first run after now."""
    if on:
        s["enabled"] = False
        s["paused"] = {"at": now(), "by": by}
        return
    if s.get("finished") and s["rule"]["type"] == "once":
        raise SC.RuleError("一次性的已经跑过了，不能再开；要再提醒就新建一条")
    nxt = SC.next_after(s["rule"], s.get("tz"), nowt or _aware_now(s.get("tz")))
    if not nxt:
        raise SC.RuleError(f"{SC.describe(s['rule'])} 已经过去了")
    s.update(enabled=True, next=SC.iso(nxt)); s.pop("paused", None); s.pop("finished", None)
