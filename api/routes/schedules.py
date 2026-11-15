"""Schedules and routines (t-schedule-backend): firing due entries, the one-time import of config.json routines, the routines
view on the board, and the 定时 page / 常驻 card actions (schedule_*, routine_*). The 30 s timer is in api/loops.py."""
import datetime as dt

from api.ctx import S, CONFIG
from api.router import action, ME


def schedules_fire(nowt=None):
    """t-schedule-backend (was t-routine-trigger routines_fire): every entry in state.schedules whose `next` has passed fires once,
    however many runs were missed while the server was down (the inbox entry says late_min). Imported config routines keep their
    routine_due inbox entry, meta.routines_fired and the dated routines_log. `next` moves on in the same lock as the inbox append,
    so a restart never fires twice. nowt: aware datetime (tests). Returns the fired schedule ids."""
    nowt = nowt or dt.datetime.now().astimezone()
    if not S.schedules_needs_tick(S.read(), nowt):
        return []   # nothing due: skip the write so meta.rev doesn't bump every tick
    fired = []
    with S.mutate() as st:
        for sc, e in S.schedules_due(st, nowt):
            if sc.get("routine"):
                log_routine_run(st["meta"], sc["routine"], e["date"])   # t-ri1104-p3: dated run history for the 常驻活动 7-day row
            fired.append(sc["id"])
            print(f"schedules: fired {sc['id']} ({e['kind']}, late {e.get('late_min', 0)} min)")
    return fired


routines_fire = schedules_fire   # old name


def schedules_import():
    """t-schedule-backend: config.json routines -> state.schedules, once per routine id (see stateutil.schedules_import_routines)."""
    st0 = S.read()
    have = set((st0["meta"].get("schedules_imported") or []))
    if all(not isinstance(r, dict) or not r.get("id") or r["id"] in have for r in CONFIG.get("routines") or []):
        return []
    with S.mutate() as st:
        added = S.schedules_import_routines(st, CONFIG.get("routines") or [])
    print("schedules: imported config routines", added, "(config.json routines are only read for this one-time import now)")
    return added


ROUTINES_LOG_KEEP = 30   # t-ri1104-p3: dates kept per routine in meta.routines_log


def log_routine_run(meta, rid, day):
    """t-ri1104-p3: meta.routines_log[id] = sorted dates the routine fired (last ROUTINES_LOG_KEEP)."""
    lg = meta.setdefault("routines_log", {}).setdefault(rid, [])
    if day not in lg:
        lg.append(day)
        lg.sort()
        del lg[:-ROUTINES_LOG_KEEP]


def routine_item(r):
    """The card a routine belongs to: config "item", else "r-" + id (daily-check -> r-daily-check)."""
    return r.get("item") or "r-" + r["id"]


def routines_view(meta, nowt=None, items=None, scheds=None):
    """t-routine-close: schedule + paused + next run for the dashboard (read-only; computed, never stored).
    t-schedule-backend: built from the imported routine entries in state.schedules (same fields as before, so app.js is unchanged).
    t-ri1104-p3: + runs = the last 14 logged dates, each with the run card made that day."""
    log = meta.get("routines_log") or {}
    out = []
    for sc in scheds or []:
        if not sc.get("routine") or sc.get("deleted"):
            continue
        rid = sc["routine"]
        p = sc.get("paused")
        out.append({"id": rid, "item": (sc.get("task") or {}).get("item") or "r-" + rid, "time": sc["rule"].get("at"), "label": sc.get("title", ""),
                    "paused": (p or {}).get("at") if isinstance(p, dict) else p, "disabled": not sc.get("enabled") and not p,
                    "last": (meta.get("routines_fired") or {}).get(rid) or None, "next": sc.get("next") if sc.get("enabled") else None,
                    "schedule": sc["id"], "runs": _routine_runs((sc.get("task") or {}).get("item") or "r-" + rid, log.get(rid) or [], items or [])})
    return out


def _routine_runs(parent, dates, items):
    kids = [i for i in items if isinstance(i, dict) and i.get("id") != parent and parent in (i.get("tags") or [])]
    out = []
    for d in dates[-14:]:
        k = next((i for i in kids if str(i.get("created", ""))[:10] == d), None)
        out.append({"date": d, "item": k["id"] if k else None, "stage": k.get("stage") if k else None})
    return out


@action("routine_pause", "routine_resume")
def _routine_pause(a):   # t-routine-close
    k, body, st, it = a.kind, a.body, a.st, a.it
    r = next((x for x in CONFIG.get("routines") or [] if isinstance(x, dict) and x.get("id") == body.get("routine")), None)
    if not r and it is not None and not body.get("routine"):
        # t-routine-detect: a standing card with no server timer (按需常驻, e.g. t-oss-sync): paused by item. Same test as app.js routineOf:
        # ongoing, in doing, not a child card (no tag naming another card). The manager skips a card with it["paused"].
        child = any(t != it["id"] and S.find_item(st, t, restore=False) for t in it.get("tags") or [])
        if it.get("category") != "ongoing" or it.get("stage") != "doing" or child:
            raise ValueError(f"not a standing card {it['id']}")
        if k == "routine_pause":
            it["paused"] = {"at": S.now(), "by": ME}
            msg = "暂停常驻 · 管家不再做这张卡"
        else:
            it.pop("paused", None)
            msg = "恢复常驻 · 管家照常做这张卡"
        S.add_thread(it, ME, msg, "event")
        a.inbox = {"kind": k, "routine": None, "item": it["id"]}
    else:
        rid = body.get("routine")
        sc = next((x for x in st.get("schedules") or [] if x.get("routine") == rid and not x.get("deleted")), None)
        if not sc:
            raise ValueError(f"no routine {rid}")
        it = a.it = it or S.find_item(st, (sc.get("task") or {}).get("item") or "r-" + rid)
        S.schedule_pause(st, sc, k == "routine_pause", by=ME)   # t-schedule-backend: resuming never starts a missed same-day run
        st["meta"].setdefault("routines_paused", {}).pop(rid, None)
        msg = "停止常驻任务 · 定时器已停，不会再开新的子卡" if k == "routine_pause" else f"恢复常驻任务 · 每天 {sc['rule'].get('at')}"
        if it is not None:
            S.add_thread(it, ME, msg, "event")
        a.inbox = {"kind": k, "routine": rid, "item": it["id"] if it else None}


@action("schedule_pause", "schedule_resume", "schedule_rm", "schedule_fire")
def _schedule(a):   # t-schedule-backend: the 定时 page
    k, body, st = a.kind, a.body, a.st
    sc = S.schedule_find(st, body.get("schedule") or "")
    if not sc:
        raise ValueError(f"no schedule {body.get('schedule')}")
    if k == "schedule_rm":
        sc.update(deleted=S.now(), enabled=False)
    elif k == "schedule_fire":
        t0 = dt.datetime.now().astimezone()
        sc.setdefault("runs", []).append({"for": t0.isoformat(timespec="seconds"), "at": t0.isoformat(timespec="seconds"), "late": 0, "manual": True})
        sc["last"] = t0.isoformat(timespec="seconds")
        S.schedule_emit(st, sc, sc["last"], 0, manual=True)
    else:
        S.schedule_pause(st, sc, k == "schedule_pause", by=ME)
    if sc.get("routine") and k in ("schedule_pause", "schedule_resume"):
        st["meta"].setdefault("routines_paused", {}).pop(sc["routine"], None)
    a.inbox = {"kind": k, "schedule": sc["id"], "title": sc.get("title"), "item": (sc.get("task") or {}).get("item")}
