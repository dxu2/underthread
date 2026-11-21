"""Background threads (t-oss-struct B4): daily report, roster watch, push, wake after a usage reset, schedules,
snoozes. server.main() starts them unless NO_LOOPS is set; each one keeps itself alive (an exception prints one line and the
loop goes on). The logic each loop runs lives with its feature (api/routes/*); this file only holds the timers."""
import datetime as dt
import os
import threading
import time

from api.ctx import S, CONFIG, _ts
from api.routes.push import PUSH_SUBS, push_tick
from api.routes.schedules import schedules_fire
from api.routes.snooze import snooze_tick
from api.routes.state import sync_roster
from api.routes.update import run_check as update_run_check
from core.feeds import collector as feeds_collector


def report_loop():
    """Queue a report_due entry once a day at config.report_time."""
    hhmm = CONFIG.get("report_time", "18:00")
    while True:
        try:
            nowt = dt.datetime.now()
            today = nowt.date().isoformat()
            st = S.read()
            due = nowt.strftime("%H:%M") >= hhmm
            if due and st["meta"].get("last_report_date") != today and st["meta"].get("report_queued") != today:
                S.inbox_append({"kind": "report_due", "date": today})
                with S.mutate() as st2:
                    st2["meta"]["report_queued"] = today
        except Exception as e:  # keep the loop alive
            print("report_loop:", e)
        time.sleep(60)


def schedule_loop():
    """t-schedule-backend: replaces routine_loop. 30 s, so a reminder is at most ~30 s late."""
    while True:
        try:
            schedules_fire()
        except Exception as e:  # keep the loop alive
            print("schedule_loop:", e)
        time.sleep(30)


def snooze_loop():
    while True:
        try:
            snooze_tick()
        except Exception as e:  # keep the loop alive
            print("snooze_loop:", e)
        time.sleep(20)


def push_loop():
    """Turn new mailbox entries (agent replies, items entering review, reports) into pushes.
    t-imp29-p1: each device has a tier and quiet hours; held entries go out as one digest when quiet hours end."""
    seen = {m["id"] for m in S.read().get("mail", [])}
    while True:
        time.sleep(3)
        try:
            if not os.path.exists(PUSH_SUBS):
                seen = {m["id"] for m in S.read().get("mail", [])}
                continue
            st = S.read()
            new = [m for m in st.get("mail", []) if m["id"] not in seen]
            seen.update(m["id"] for m in new)
            push_tick(st, new)
        except Exception as e:
            print("push_loop:", e)


def wake_loop():
    """After a usage reset, queue one `wake` inbox entry so a manager stopped by the plan limit picks the backlog up.
    Covers both a planned sleep (`S sleep --until`) and a hard stop (a window at ~100% that has since reset)."""
    while True:
        time.sleep(30)
        try:
            st = S.read()
            m = st["agents"].get("manager") or {}
            u = st["meta"].get("usage") or {}
            targets = [m.get("wake_at")] if m.get("status") == "sleeping" else []
            targets += [w.get("resets_at") for w in (u.get("five_hour"), u.get("seven_day")) if w and w.get("used", 0) >= 98]
            seen, nowt = _ts(m.get("last_seen")) or 0, time.time()
            for t in targets:
                ts = _ts(t)
                if ts is None or not (ts + 60 <= nowt < ts + 6 * 3600) or seen >= ts or t in (st["meta"].get("wake_queued") or []):
                    continue
                S.inbox_append({"kind": "wake", "reason": "usage reset", "reset": t})
                with S.mutate() as st2:
                    q = st2["meta"].get("wake_queued")
                    st2["meta"]["wake_queued"] = ((q if isinstance(q, list) else []) + [t])[-10:]
                print(f"wake_loop: queued wake for reset {t}", flush=True)
                break
        except Exception as e:
            print("wake_loop:", e)


def update_check_loop():
    """t-oss-struct S5: once a day, `tools/update.py check` (fetch the release tags) for Settings -> Updates.
    config update.check = false turns it off. First run 10 minutes after the start, so a restart loop never hammers the remote."""
    time.sleep(600)
    while True:
        try:
            update_run_check()
        except Exception as e:
            print("update_check_loop:", e)
        time.sleep(3600)


def feeds_loop():
    """t-feed-inbox: every 30 s, poll each connected feed source that is switched on and due (Settings -> Connections).
    Nothing connected = nothing happens. The work and its rules live in core/feeds/collector.py."""
    time.sleep(20)
    while True:
        try:
            feeds_collector.tick()
        except Exception as e:
            print("feeds_loop:", type(e).__name__)   # never the message: it could carry text from the mail server
        time.sleep(30)


def roster_watch_loop():
    while True:
        try:
            sync_roster()
        except Exception as e:
            print("roster sync:", e)
        time.sleep(5)


LOOPS = (report_loop, roster_watch_loop, push_loop, wake_loop, schedule_loop, snooze_loop, update_check_loop, feeds_loop)


def start(only=None):
    """One daemon thread per loop (server.main(), unless NO_LOOPS). Returns the threads.
    only: names to start (NO_LOOPS=1 FEEDS_LOOP=1 starts just feeds_loop, for a scratch copy)."""
    out = []
    for fn in LOOPS:
        if only and fn.__name__ not in only:
            continue
        t = threading.Thread(target=fn, daemon=True, name=fn.__name__)
        t.start()
        out.append(t)
    return out


def status():
    """Which loop threads are alive (for /api/health and the cutover check)."""
    alive = {t.name for t in threading.enumerate()}
    return {fn.__name__: fn.__name__ in alive for fn in LOOPS}
