#!/usr/bin/env python3
"""Underthread local dashboard server (127.0.0.1 only, stdlib only).

    python3 server.py            # http://127.0.0.1:8765
    PORT=8799 python3 server.py  # scratch copy for UI testing

Serves web/, a JSON API over state.json, and turns your clicks into
inbox.jsonl entries the manager session watches.
"""
import base64
import datetime as dt
import json
import mimetypes
import os
import re
import shutil
import socket
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import gzip
from urllib.parse import parse_qs, unquote, urlparse

import stateutil as S
import sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "tools"))
import webpush as WP  # noqa: E402
try:   # t-vb-2: voice calls (a missing or broken voicecall.py must never take the dashboard down)
    import voicecall as VC  # noqa: E402
except Exception as _e:  # noqa: BLE001
    VC = None
    print("voicecall not loaded:", repr(_e))
try:   # t-dash-token: GitHub push token (a broken ghcred.py must never take the dashboard down)
    import ghcred as GH  # noqa: E402
except Exception as _e:  # noqa: BLE001
    GH = None
    print("ghcred not loaded:", type(_e).__name__)

ROOT = S.ROOT
WEB = os.path.join(ROOT, "web")
UPLOADS = os.path.join(ROOT, "uploads")
AVATARS = os.path.join(ROOT, "avatars")
# t-voice-memo: Python's table says audio/mp4a-latm for .m4a, which iOS Safari will not play
mimetypes.add_type("audio/mp4", ".m4a")
mimetypes.add_type("audio/aac", ".aac")
mimetypes.add_type("audio/ogg", ".opus")
DOC_DIRS = ["roles", "docs", ".claude/agents", ".claude/skills"]
DOC_FILES = ["SETUP-GUIDE.md", "team.md", "policy.md", "manager.md", "manager-handoff.md"]


def ensure_live_files():
    for name in ("config", "roster"):
        live, ex = os.path.join(ROOT, f"{name}.json"), os.path.join(ROOT, f"{name}.example.json")
        if not os.path.exists(live) and os.path.exists(ex):
            shutil.copy(ex, live)
    for d in (UPLOADS, AVATARS, os.path.join(ROOT, "roles"), os.path.join(ROOT, "work")):
        os.makedirs(d, exist_ok=True)


def load_json(name, default):
    try:
        with open(os.path.join(ROOT, name), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return default


CONFIG = {}
_roster_mtime = None
_comfy = {"online": None, "at": None}
START = time.time()  # t-imp-p4: server uptime for /api/health
try:   # t-home-usage: per-role token rollup; a broken module must not stop the dashboard
    import usage_roll
    USAGE = usage_roll.Roll(ROOT)
except Exception as e:  # noqa: BLE001
    print("usage_roll:", e)
    USAGE = None
_health = {"disk": None, "disk_t": 0, "work": None, "work_t": 0, "work_busy": False, "lock": threading.Lock()}


def sync_roster():
    """Make sure every roster role exists in state.agents with its display fields."""
    global _roster_mtime
    path = os.path.join(ROOT, "roster.json")
    try:
        m = os.path.getmtime(path)
    except OSError:
        return
    if m == _roster_mtime:
        return
    _roster_mtime = m
    roster = load_json("roster.json", {"roles": []})
    keys = ("name", "name_en", "title", "title_en", "duty", "duty_en", "color", "room", "agent_name", "order", "look", "voice",
            "tint", "seat", "pipe")   # t-hr-registry: tint = art backdrop colour, seat = stage [x, y] (null = no seat), pipe = production-line column(s)
    with S.mutate() as st:
        for i, r in enumerate(roster.get("roles", [])):
            a = st["agents"].setdefault(r["id"], {"id": r["id"], "status": "idle"})
            for k in keys:
                if k in r:
                    a[k] = r[k]
                elif k in ("tint", "seat", "pipe"):
                    a.pop(k, None)
            a["order"] = r.get("order", i)
            a["enabled"] = r.get("enabled", True)
            if r["id"] == "manager" and not a.get("last_seen"):
                a["status"] = "offline"
        # roles removed from the roster: drop them, hand their open items to the manager
        ids = {r["id"] for r in roster.get("roles", [])}
        for gone in [k for k in st["agents"] if k not in ids]:
            del st["agents"][gone]
            for it in st["items"]:
                if it.get("owner") == gone and it.get("stage") != "done":
                    it["owner"] = "manager"
                    S.add_thread(it, "manager", f"角色 {gone} 已从 roster 移除，转回管家", "event")


def comfy_probe_loop():
    c = CONFIG.get("comfy") or {}
    port = int(c.get("local_port", 8188))
    while True:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                _comfy["online"] = True
        except OSError:
            _comfy["online"] = False
        _comfy["at"] = S.now()
        time.sleep(60)


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


def routines_log_backfill():
    """t-ri1104-p3, once: build meta.routines_log from the routine_due entries already in inbox.jsonl
    (every run since t-routine-trigger is there with its date). Skipped once the key exists."""
    if "routines_log" in S.read()["meta"]:
        return
    days = {}
    try:
        with open(S.INBOX, encoding="utf-8") as f:
            for line in f:
                try:
                    e = json.loads(line)
                except ValueError:
                    continue
                if isinstance(e, dict) and e.get("kind") == "routine_due" and e.get("routine") and e.get("date"):
                    days.setdefault(str(e["routine"]), set()).add(str(e["date"]))
    except FileNotFoundError:
        pass
    with S.mutate() as st:
        if "routines_log" not in st["meta"]:
            st["meta"]["routines_log"] = {rid: sorted(ds)[-ROUTINES_LOG_KEEP:] for rid, ds in days.items()}
    print("routines_log: backfilled from inbox:", {k: len(v) for k, v in days.items()})


def routine_item(r):
    """The card a routine belongs to: config "item", else "r-" + id (smith-improve -> r-smith-improve)."""
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


def schedule_loop():
    """t-schedule-backend: replaces routine_loop. 30 s, so a reminder is at most ~30 s late."""
    while True:
        try:
            schedules_fire()
        except Exception as e:  # keep the loop alive
            print("schedule_loop:", e)
        time.sleep(30)


# ---------- ri1103-P2: 稍后 (snooze a card until a time, or until the specialist's next reply) ----------
# it["snooze"] = {until: iso | None, wait: "reply" | None, preset, at, by}. While active the card leaves 等你拍板 (web counts,
# the app badge, pushes). snooze_loop clears it: time up -> back to 等你拍板 + one 待审核 push; reply -> back (the reply itself pushes).
# it["snoozed"] = {at, back, why} is the 「推迟过」 mark; a click on the card (approve / reject / comment / ...) removes both.
SNOOZE_PRESETS = ("tonight", "morning", "monday", "reply", "custom")
SNOOZE_REPLY_DAYS = 3   # 「等专员回复」 also ends after 3 days with no reply (user's answer on t-ri1103-p2, 11-03)


def _on_user(it):
    """Mirrors web/app.js onYou(): review, a waiting plan / question, or open asks (busy is web-only and ignored here)."""
    if it.get("archived") or it.get("stage") == "done":
        return False
    return (it.get("stage") == "review" or (it.get("stage") == "waiting" and it.get("kind") in ("plan", "question"))
            or bool(S.open_asks(it)))


def snooze_until(preset, custom=None, nowt=None):
    """Local wall-clock target for a preset. tonight = today 20:00; morning = next 09:00 (today if before 05:00);
    monday = next Monday 09:00 (a week on if today is Monday); custom = the ISO time the page sent (future, <= 60 days)."""
    nowt = nowt or dt.datetime.now()
    at = lambda d, h: dt.datetime.combine(d, dt.time(h, 0))
    if preset == "tonight":
        t = at(nowt.date(), 20)
        if t <= nowt:
            raise ValueError("已经过了今晚 20:00，选明早或自己选时间")
    elif preset == "morning":
        t = at(nowt.date() if nowt.hour < 5 else nowt.date() + dt.timedelta(days=1), 9)
    elif preset == "monday":
        t = at(nowt.date() + dt.timedelta(days=(7 - nowt.weekday()) or 7), 9)
    elif preset == "custom":
        try:
            t = dt.datetime.fromisoformat(str(custom).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            raise ValueError("时间格式不对")
        if t.tzinfo:
            t = t.astimezone().replace(tzinfo=None)
        if t <= nowt + dt.timedelta(minutes=1) or t > nowt + dt.timedelta(days=60):
            raise ValueError("选一个 1 分钟以后、60 天以内的时间")
    else:
        raise ValueError(f"bad preset {preset}")
    return t.astimezone().isoformat(timespec="seconds")


def snooze_due(it, now=None):
    """Why an active snooze should end now: "gone" (the card is no longer on the user), "time", "reply", or None (keep)."""
    sn = it.get("snooze")
    if not isinstance(sn, dict):
        return None
    if not _on_user(it):
        return "gone"
    now = now or time.time()
    u = _ts(sn.get("until")) if sn.get("until") else None
    if u is not None and u <= now:
        return "time"
    if sn.get("wait") == "reply":
        at = _ts(sn.get("at")) or 0
        if any(e.get("who") != "me" and e.get("kind") != "event" and (_ts(e.get("t")) or 0) > at for e in it.get("thread") or []):
            return "reply"
        if (_ts(it.get("draft_at")) or 0) > at:
            return "reply"
    return None


def snooze_active(it):
    return isinstance(it.get("snooze"), dict) and snooze_due(it) is None


def snooze_tick(now=None):
    """Clear snoozes that are due. Writes only when something changed. Returns [(item id, why)]."""
    st = S.read()
    due = [i["id"] for i in st.get("items", []) if isinstance(i.get("snooze"), dict) and snooze_due(i, now)]
    if not due:
        return []
    out = []
    with S.mutate() as st:
        for iid in due:
            it = S.find_item(st, iid)
            why = it and snooze_due(it, now)
            if not why:
                continue
            sn = it.pop("snooze")
            out.append((iid, why))
            if why == "gone":   # the card moved on by itself (new stage, closed): nothing comes back
                continue
            it["snoozed"] = {"at": sn.get("at"), "back": S.now(), "why": why}
            waited = why == "time" and sn.get("wait") == "reply"
            S.add_thread(it, "me", f"{SNOOZE_REPLY_DAYS} 天没等到回复 · 回到等你拍板" if waited else "稍后到点 · 回到等你拍板" if why == "time"
                         else "有新回复 · 推迟结束，回到等你拍板", "event")
            if why == "time":   # the reply case already pushed through its own mail entry
                S.push_mail(st, "update", f"待审核: {it['title']}（{f'{SNOOZE_REPLY_DAYS} 天没回复' if waited else '推迟到点'}）", it["id"], it.get("owner"))
            print(f"snooze: {iid} back ({why})", flush=True)
    return out


def snooze_loop():
    while True:
        try:
            snooze_tick()
        except Exception as e:  # keep the loop alive
            print("snooze_loop:", e)
        time.sleep(20)


# ---------- push notifications (iPhone home-screen app) ----------
PUSH_SUBS = os.path.join(ROOT, "push_subs.json")
_push = {"queue": [], "lock": threading.Lock(), "dev": {}}   # dev: endpoint -> last notification sent to it


def _subs():
    return load_json("push_subs.json", [])


def _save_subs(subs):
    with open(PUSH_SUBS, "w", encoding="utf-8") as f:
        json.dump(subs, f, ensure_ascii=False, indent=1)


def _plog(msg):
    """One line in logs/server.log (stdout goes there under keepalive.sh and launchd). Never keys or full endpoints."""
    msg = re.sub(r"[\r\n]+", " ", str(msg))[:400]
    print(f"[{dt.datetime.now():%Y-%m-%d %H:%M:%S}] push: {msg}", flush=True)


def _ep_short(endpoint):
    """Push-service host plus the last 6 chars of the endpoint, enough to tell devices apart."""
    u = urlparse(endpoint or "")
    return f"{u.netloc}…{(endpoint or '')[-6:]}"


def push_status(endpoint=None):
    subs = _subs()
    out = {"devices": len(subs), "mine": False, "subs": []}
    for s in subs:
        ep = s["sub"].get("endpoint", "")
        row = {"device": _ep_short(ep), "ua": (s.get("ua") or "")[:60], "at": s.get("at"),
               "last_code": s.get("last_code"), "last_at": s.get("last_at"), "prefs": push_prefs(s), "held": len(s.get("held") or [])}
        out["subs"].append(row)
        if endpoint and ep == endpoint:
            out["mine"] = True
            out["me"] = row
    return out


def pending_count(st):
    """t-app-badge: the app-icon badge = the home page's 「等你拍板」 count. Mirrors web/app.js counts().review
    (stage review, or awaitsUser(): waiting + kind plan/question; archived items excluded). Change both together."""
    on = {i["id"] for i in st.get("items", []) if not i.get("archived") and not snooze_active(i)   # ri1103-P2: snoozed cards don't count
          and (i.get("stage") == "review" or (i.get("stage") == "waiting" and i.get("kind") in ("plan", "question")))}
    # t-review-unread: + open cards with an unread team reply (mail kind "reply" with a card id), each card once. Mirrors app.js newReplies().
    nr = {m.get("item") for m in st.get("mail", []) if m.get("kind") == "reply" and not m.get("read") and m.get("item") not in (None, "", "None")}
    nr = {i["id"] for i in st.get("items", []) if i["id"] in nr and i["id"] not in on and not i.get("archived")
          and i.get("stage") != "done" and not snooze_active(i)}
    return len(on) + len(nr)


def notify(n, only=None, en=None):
    """Queue a notification and wake the subscribed devices (all, or only those whose endpoint is in `only`).
    The device fetches the text from /api/push/latest?endpoint=… (t-imp29-p1: per device, since tiers make devices differ)."""
    n = dict(n, id=n.get("id") or uuid.uuid4().hex[:10], t=S.now())
    n.setdefault("tag", n["id"])
    if en:   # t-i18n-b: devices whose UI is English get the English twin (same id / tag / url)
        en = dict(n, **en, lang="en")
        n.setdefault("lang", "zh")
    with _push["lock"]:
        _push["queue"].append(n)
        del _push["queue"][:-30]
        subs = _subs()
        keep, sent, codes = [], 0, []
        for s in subs:
            ep = s["sub"].get("endpoint", "")
            if only is not None and ep not in only:
                keep.append(s)
                continue
            _push["dev"][ep] = en if en and _row_lang(s) == "en" else n
            code = WP.send(s["sub"], s.get("subject") or "mailto:underthread@example.com")
            codes.append(code)
            _plog(f"send {_ep_short(ep)} -> {code} ({n.get('title', '')[:30]})")
            if code in (404, 410):
                _plog(f"drop {_ep_short(ep)} (subscription gone)")
                continue  # device unsubscribed
            s["last_code"], s["last_at"] = code, S.now()
            keep.append(s)
            sent += 200 <= code < 300
        if subs:
            _save_subs(keep)
    return {"devices": len(keep), "sent": sent, "codes": codes}


# ---------- t-imp29-p1: push tiers, quiet hours, morning digest (per device, stored on the push_subs.json row as "prefs") ----------
PUSH_DEFAULT = {"tier": "reply", "quiet": True, "from": 23, "to": 9, "digest": True}
TIERS = ("decide", "reply", "all")   # 只推等你拍板 / 拍板 + 私信回复 / 全部动态


def push_prefs(row):
    p = dict(PUSH_DEFAULT)
    p.update({k: v for k, v in (row.get("prefs") or {}).items() if k in PUSH_DEFAULT})
    if p["tier"] not in TIERS:
        p["tier"] = PUSH_DEFAULT["tier"]
    for k in ("from", "to"):
        p[k] = int(p[k]) % 24
    p["quiet"], p["digest"] = bool(p["quiet"]), bool(p["digest"])
    return p


def push_class(st, m):
    """decide = something waits on the user (an item entering review, a rule proposal); reply = a message to the user
    (manager chat, DMs, replies on items); other = everything else (daily report, manager sleep notice).
    Returns (class, urgent). urgent = the entry's item is in 紧急活动: it passes quiet hours."""
    text, it = m.get("text") or "", None
    if m.get("item"):
        it = next((i for i in st.get("items", []) if i.get("id") == m["item"]), None)
    urgent = bool(it and it.get("category") == "urgent")
    if m.get("kind") == "remind":   # t-schedule-backend: a reminder you set yourself: every tier, through quiet hours
        return "remind", True
    if text.startswith(("待审核", "新规则提议")):
        return "decide", urgent
    if m.get("kind") == "reply":
        return "reply", urgent
    return "other", urgent


def tier_allows(tier, cls):
    return tier == "all" or cls in ("decide", "remind") or (tier == "reply" and cls == "reply")


def in_quiet(p, now=None):
    if not p["quiet"] or p["from"] == p["to"]:
        return False
    h = (now or dt.datetime.now()).hour
    return (p["from"] <= h < p["to"]) if p["from"] < p["to"] else (h >= p["from"] or h < p["to"])


def digest_payload(st, held, en=False):
    """One push for everything held during quiet hours: 「夜里 N 张卡有进展 · M 件等你拍板」."""
    items, loose = [], 0
    for m in held:
        if m.get("item"):
            if m["item"] not in items:
                items.append(m["item"])
        else:
            loose += 1
    byid = {i["id"]: i for i in st.get("items", [])}
    wait = pending_count(st)
    if en:   # t-i18n-b
        head = (f"Overnight: {len(items)} card{'s' if len(items) != 1 else ''} moved" if items else f"Overnight: {len(held)} new message{'s' if len(held) != 1 else ''}") \
            + (f" · {wait} waiting on you" if wait else "")
    else:
        head = (f"夜里 {len(items)} 张卡有进展" if items else f"夜里 {len(held)} 条新消息") + (f" · {wait} 件等你拍板" if wait else "")
    titles = [(en and byid[i].get("title_en")) or byid[i]["title"] for i in items if i in byid][:3]
    body = " · ".join(t[:28 if en else 18] for t in titles) or (push_text_en(held[-1]["text"]) if en else held[-1]["text"])[:60]
    if loose and items:
        body += f" (+{loose} more message{'s' if loose != 1 else ''})" if en else f"（另有 {loose} 条消息）"
    nid = uuid.uuid4().hex[:10]
    return {"id": nid, "title": head, "body": body, "url": f"/#page=mail&push={nid}", "digest": True, "lang": "en" if en else "zh"}


def push_history(endpoint, hours=24):
    """Pushes sent to this device per hour over the last `hours` hours, read from logs/server.log (send lines carry the short endpoint)."""
    tag, now = _ep_short(endpoint), dt.datetime.now()
    start = (now - dt.timedelta(hours=hours - 1)).replace(minute=0, second=0, microsecond=0)
    counts = [0] * hours
    held = 0
    try:
        path = os.path.join(ROOT, "logs", "server.log")
        with open(path, "rb") as f:
            f.seek(max(0, os.path.getsize(path) - 3_000_000))
            lines = f.read().decode("utf-8", "replace").splitlines()
        for ln in lines:
            if tag not in ln or " push: " not in ln:
                continue
            try:
                t = dt.datetime.strptime(ln[1:20], "%Y-%m-%d %H:%M:%S")
            except ValueError:
                continue
            if t < start:
                continue
            if " push: send " in ln:
                i = int((t - start).total_seconds() // 3600)
                if 0 <= i < hours:
                    counts[i] += 1
            elif " push: hold " in ln:
                held += 1
    except OSError:
        pass
    return {"start_hour": start.hour, "counts": counts, "held": held}


def _row_update(endpoint, fn):
    """Read-modify-write one push_subs.json row under the push lock. Returns the updated row (None if the endpoint is unknown)."""
    with _push["lock"]:
        subs = _subs()
        row = next((x for x in subs if x["sub"].get("endpoint") == endpoint), None)
        if row is None:
            return None
        fn(row)
        _save_subs(subs)
        return row


def _agent_name(st, aid, en=False):
    a = (st.get("agents") or {}).get(aid) or {}
    return (en and a.get("name_en")) or a.get("name") or aid or "Underthread"


# t-i18n-b: each push_subs.json row carries the device's UI language ("lang": zh|en, sent by push.js on subscribe and on a switch).
# Mailbox text is stored in Chinese (push_class / _mail_target branch on the prefixes), so English pushes translate the known
# server-written shapes here; web/app.js srvT() does the same for the page. Anything else (agents' own words) passes through.
PUSH_EN = [
    (re.compile(r"^待审核\s*[:：]\s*(.*?)(（(?:(\d+) 天没回复|推迟到点)）)?$", re.S),
     lambda m: m.group(1) + ((f" (no reply in {m.group(3)} days)" if m.group(3) else " (snooze over)") if m.group(2) else "")),
    (re.compile(r"^新规则提议 · ([^:\s]+): (.*)$", re.S), lambda m: f"Rule proposal · {m.group(1)}: {m.group(2)}"),
    (re.compile(r"^管家休眠 · (\d\d:\d\d) 复活。(.*?)；新指令会排队，醒来自动处理。$", re.S),
     lambda m: f"Manager asleep · back at {m.group(1)}. {'Usage is near the limit' if m.group(2) == '用量快到上限' else m.group(2)}; new orders queue up and run on wake."),
    (re.compile(r"^⏰ 提醒：(.*?)(?:（晚了 (\d+) 分钟，看板刚恢复）)?$", re.S),
     lambda m: f"⏰ Reminder: {m.group(1)}" + (f" ({m.group(2)} min late, the dashboard just came back)" if m.group(2) else "")),
    (re.compile(r"^管家[:：]\s*(.*)$", re.S), lambda m: m.group(1)),
    (re.compile(r"^日报 · (.*)$", re.S), lambda m: "Daily report · " + re.sub(r"（周([一二三四五六日])）", lambda d: f" ({['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']['一二三四五六日'.index(d.group(1))]})", m.group(1))),
]


def push_text_en(text):
    for rx, fn in PUSH_EN:
        m = rx.match(text or "")
        if m:
            return fn(m)
    return text or ""


def _row_lang(row):
    return "en" if (row or {}).get("lang") == "en" else "zh"


def _mail_target(st, m):
    """Where tapping this mailbox entry's push should land (t-push-deeplink), as hash params the page routes on.
    Mirrors a mailbox-row click: a card if it has one, the report it announces, the pending rules on review, else that agent's DM (manager = the manager chat)."""
    if m.get("item"):
        return f"item={m['item']}"
    text, who = m.get("text") or "", m.get("agent")
    if text.startswith("新规则提议"):
        return "page=review"
    if who == "manager" and m.get("kind") == "update":
        for r in reversed(st.get("reports") or []):
            if f"{r.get('title')} · {r.get('date')}" == text:
                return f"rep={r['id']}"
    if who:
        return f"dm={who}"
    return "page=mail"


def push_payload(st, new, en=False):
    """Build the notification for a batch of new mailbox entries. url = /#<target>&mail=<ids>&push=<id>; push= marks it as a push tap (the page routes once, marks those entries read and clears the hash)."""
    nid = uuid.uuid4().hex[:10]
    targets = [_mail_target(st, m) for m in new]
    one = len(set(targets)) == 1
    tail = (f"&mail={','.join(m['id'] for m in new[-20:])}" if one else "") + f"&push={nid}"
    url = "/#" + (targets[0] if one else "page=mail") + tail
    if len(new) == 1:
        m = new[0]
        review = m["text"].startswith("待审核")
        if en:   # t-i18n-b
            it = next((i for i in st.get("items", []) if i.get("id") == m.get("item")), None) if review else None
            body = (it.get("title_en") or push_text_en(m["text"])) if it and it.get("title_en") else push_text_en(m["text"])
            return {"id": nid, "title": "For your review" if review else _agent_name(st, m.get("agent"), True), "body": body, "url": url, "lang": "en"}
        return {"id": nid, "title": "待你审核" if review else _agent_name(st, m.get("agent")),
                "body": m["text"].replace("待审核: ", "", 1) if review else m["text"], "url": url, "lang": "zh"}
    who = []
    for m in new:
        n = _agent_name(st, m.get("agent"), en)
        if n not in who:
            who.append(n)
    if en:
        return {"id": nid, "title": f"{len(new)} new updates", "body": ", ".join(who[:4]) + " · " + push_text_en(new[-1]["text"])[:60], "url": url, "lang": "en"}
    return {"id": nid, "title": f"{len(new)} 条新动态", "body": "、".join(who[:4]) + " · " + new[-1]["text"][:60], "url": url, "lang": "zh"}


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


def push_tick(st, new, now=None):
    """One pass: route `new` mailbox entries per device, and send digests for devices whose quiet hours just ended."""
    now = now or dt.datetime.now()
    plan = {}    # endpoint -> entries to send now
    langs = {}   # t-i18n-b: endpoint -> "en" | "zh"
    with _push["lock"]:
        subs = _subs()
        dirty = False
        for row in subs:
            ep, p = row["sub"].get("endpoint", ""), push_prefs(row)
            langs[ep] = _row_lang(row)
            quiet = in_quiet(p, now)
            for m in new:
                cls, urgent = push_class(st, m)
                sit = m.get("item") and next((i for i in st.get("items", []) if i.get("id") == m["item"]), None)
                if sit and snooze_active(sit):   # ri1103-P2: a snoozed card stays quiet until it comes back
                    _plog(f"skip {_ep_short(ep)} {m['id']} (item {sit['id']} snoozed)")
                elif not tier_allows(p["tier"], cls):
                    _plog(f"skip {_ep_short(ep)} {m['id']} ({cls}, tier {p['tier']})")
                elif quiet and not urgent:
                    row.setdefault("held", []).append(m["id"])
                    del row["held"][:-200]
                    dirty = True
                    _plog(f"hold {_ep_short(ep)} {m['id']} ({cls}, quiet {p['from']:02d}-{p['to']:02d})")
                else:
                    plan.setdefault(ep, []).append(m)
            if row.get("held") and not quiet:
                byid = {m["id"]: m for m in st.get("mail", [])}
                held = [byid[i] for i in row["held"] if i in byid and not byid[i].get("read")]
                row["held"], dirty = [], True
                if p["digest"] and held:
                    plan.setdefault(ep, [])
                    row["_digest"] = [m["id"] for m in held]
                else:
                    _plog(f"digest {_ep_short(ep)} skipped ({len(held)} unread held, digest {'on' if p['digest'] else 'off'})")
        digests = {x["sub"]["endpoint"]: x.pop("_digest") for x in subs if "_digest" in x}
        if dirty:
            _save_subs(subs)
    for ep, ms in plan.items():
        if ep in digests:
            byid = {m["id"]: m for m in st.get("mail", [])}
            n = digest_payload(st, [byid[i] for i in digests[ep]] + ms, langs.get(ep) == "en")
            _plog(f"digest {_ep_short(ep)} {len(digests[ep])} held + {len(ms)} new")
        elif ms:
            n = push_payload(st, ms, langs.get(ep) == "en")
        else:
            continue
        _plog(f"target {n['url']}")
        notify(n, only={ep})


def _work_size():
    """Bytes under work/ (os.walk is slow on big folders: runs in a thread, cached 15 minutes)."""
    total = 0
    for d, _, files in os.walk(os.path.join(ROOT, "work")):
        for f in files:
            try:
                total += os.lstat(os.path.join(d, f)).st_size
            except OSError:
                pass
    with _health["lock"]:
        _health["work"], _health["work_t"], _health["work_busy"] = total, time.time(), False


def health():
    """t-imp-p4: the 系统状态 panel. Cheap and cached; NOT part of /api/state (polled every 2.5 s).
    Usage and the manager heartbeat are already in /api/state, so they are not repeated here."""
    t = time.time()
    with _health["lock"]:
        if t - _health["disk_t"] > 60:
            try:
                du = shutil.disk_usage(ROOT)
                _health["disk"] = {"free": du.free, "total": du.total}
            except OSError:
                _health["disk"] = None
            _health["disk_t"] = t
        if t - _health["work_t"] > 900 and not _health["work_busy"]:
            _health["work_busy"] = True
            threading.Thread(target=_work_size, daemon=True).start()
        disk = dict(_health["disk"] or {}, work=_health["work"],
                    work_at=dt.datetime.fromtimestamp(_health["work_t"]).astimezone().isoformat(timespec="seconds") if _health["work_t"] else None)
    subs = _subs()
    sends = sorted((s for s in subs if s.get("last_at")), key=lambda s: s["last_at"])
    last = sends[-1] if sends else None
    st = S.read()
    return {
        "now": S.now(),
        "server": {"started": dt.datetime.fromtimestamp(START).astimezone().isoformat(timespec="seconds"),
                   "uptime": int(t - START), "pid": os.getpid(), "rev": st["meta"].get("rev"),
                   "loops": not os.environ.get("NO_LOOPS")},
        "comfy": dict(_comfy),
        "push": {"devices": len(subs), "last_at": last and last["last_at"], "last_code": last and last.get("last_code"),
                 "failing": sum(1 for s in subs if s.get("last_code") and not 200 <= s["last_code"] < 300)},
        "report": {"time": CONFIG.get("report_time", "18:00"), "last_date": st["meta"].get("last_report_date"),
                   "queued": st["meta"].get("report_queued")},
        "disk": disk if disk.get("total") else None,
    }


def _ts(v):
    try:
        return dt.datetime.fromisoformat(str(v).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        return None


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


def roster_watch_loop():
    while True:
        try:
            sync_roster()
        except Exception as e:
            print("roster sync:", e)
        time.sleep(5)


# ---------- actions (your clicks) ----------

class OpenAsks(Exception):
    """t-open-questions: approve / done while the item still has unanswered asks and the click didn't say skip_asks."""
    def __init__(self, asks):
        super().__init__(f"还有 {len(asks)} 个问题没回答。刷新页面后在单子里点选，或者选择跳过。")
        self.asks = asks


def _ask_brief(a):
    return {"id": a["id"], "q": a["q"], "options": a["options"], "by": a.get("by")}


def _guard_asks(it, body):
    """Raises OpenAsks unless skip_asks; returns (thread suffix, open_asks list for the inbox) when skipping."""
    oa = S.open_asks(it)
    if not oa:
        return "", None
    if not body.get("skip_asks"):
        raise OpenAsks([_ask_brief(a) for a in oa])
    return f" · 跳过 {len(oa)} 个未答问题：" + "；".join(a["q"] for a in oa), [_ask_brief(a) for a in oa]


# ===== t-hm-build: 招聘市场. Templates from templates/roles/<job>/template.json, hiring through tools/new_role.py (plan / apply / retire / rehire).
TPL_DIR = os.path.join(ROOT, "templates", "roles")
TPL_AV_CACHE = os.path.join(ROOT, "logs", "tpl-av")   # recoloured default avatars, rebuilt on demand (logs/ is not synced or published)
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
_RID = re.compile(r"^[a-z][a-z0-9-]{1,15}$")


def _tpl_list():
    out = []
    for job in sorted(os.listdir(TPL_DIR)) if os.path.isdir(TPL_DIR) else []:
        p = os.path.join(TPL_DIR, job, "template.json")
        if job.startswith(("_", ".")) or not os.path.isfile(p):
            continue
        try:
            t = json.load(open(p, encoding="utf-8"))
        except ValueError:
            continue
        vs = [{"key": v.get("key"), "label": v.get("label") or v.get("key"), "label_en": v.get("label_en") or "", "tint": v.get("tint") or "#6f7f8f",
               "style": (v.get("voice") or {}).get("style", ""), "habits": (v.get("voice") or {}).get("habits", []),
               "style_en": v.get("style_en") or "", "sample_en": v.get("sample_en") or ""}   # t-i18n-c
              for v in t.get("variants") or [] if v.get("key")]
        out.append({"key": job, "cat": t.get("cat") or "", "job": t.get("job") or t.get("title") or job, "title": t.get("title") or "",
                    "title_en": t.get("title_en") or "", "duty": t.get("duty") or "", "duty_en": t.get("duty_en") or "",
                    "model": t.get("model") or "", "starters": (t.get("starters") or [])[:3], "starters_en": (t.get("starters_en") or [])[:3], "variants": vs,
                    "avatar": os.path.isfile(os.path.join(TPL_DIR, job, "avatar.png"))})
    return out


def templates_payload():
    roster = load_json("roster.json", {"roles": []}).get("roles", [])
    hired = {}
    for r in roster:
        if r.get("template"):
            hired.setdefault(r["template"], []).append({"id": r["id"], "name": r.get("name") or r["id"], "variant": r.get("variant"),
                                                        "on": r.get("enabled", True) is not False})
    return {"templates": _tpl_list(), "hired": hired, "ids": [r["id"] for r in roster]}


def tpl_avatar(job, key):
    """Per-variant art, else the job's own avatar.png, else the bundled default recoloured to the variant tint (same ffmpeg as new_role.py)."""
    if not re.match(r"^[a-z0-9-]{1,32}$", job or "") or not re.match(r"^[a-z0-9_-]{0,32}$", key or ""):
        return None
    d = os.path.join(TPL_DIR, job)
    for p in (os.path.join(d, "art", key, "avatar.png"), os.path.join(d, "avatar.png")):
        if key is not None and os.path.isfile(p):
            return p
    t = next((x for x in _tpl_list() if x["key"] == job), None)
    v = t and next((x for x in t["variants"] if x["key"] == key), None)
    tint = (v or {}).get("tint", "#6f7f8f")
    if not _HEX.match(tint):
        return None
    out = os.path.join(TPL_AV_CACHE, tint.lstrip("#").lower() + ".png")
    if not os.path.isfile(out):
        os.makedirs(TPL_AV_CACHE, exist_ok=True)
        sys.path.insert(0, os.path.join(ROOT, "tools"))
        import new_role   # noqa: E402
        tmp = out + ".tmp.png"
        new_role.recolour(tint, tmp)
        os.replace(tmp, out)
    return out


def hire(body):
    """t-ht-build: retire with a handover / rehire get their own paths; everything else is hire_legacy."""
    op = body.get("op")
    if op == "retire" and "handover" in body:
        return retire_role(body)
    if op == "rehire":
        return rehire_role(body)
    return hire_legacy(body)


def hire_legacy(body):
    """One new_role.py call. Every argument is checked here and passed as an argv list (no shell)."""
    op = body.get("op")
    if op in HT_OPS:   # t-ht-build: 退休交接单 / 撤销 / 返聘 / 归档 / 撤回调岗
        return HT_OPS[op](body)
    if op in ("retire", "rehire"):   # market undo-after-hire (no handover): plain soft retire
        rid = str(body.get("id") or "")
        if not _RID.match(rid):
            raise ValueError("bad id")
        r = _role(rid)
        if not r:
            raise ValueError("no such role")
        if op == "retire" and rid in CORE_IDS:
            raise ValueError("管家、HR、工具管家不能退休")
        args = [op, rid]
    elif op in ("plan", "apply"):
        t = next((x for x in _tpl_list() if x["key"] == body.get("job")), None)
        if not t:
            raise ValueError("no such template")
        v = next((x for x in t["variants"] if x["key"] == body.get("variant")), None)
        if not v:
            raise ValueError("no such personality")
        rid, name, tint = str(body.get("id") or ""), str(body.get("name") or "").strip(), str(body.get("tint") or v["tint"])
        if not _RID.match(rid):
            raise ValueError("id 要小写字母开头，只用 a-z 0-9 -，2–16 个字")
        if not name or len(name) > 20 or re.search(r"[\x00-\x1f<>]", name):
            raise ValueError("名字 1–20 个字")
        if not _HEX.match(tint):
            raise ValueError("颜色要 #rrggbb")
        args = [op, "--template", t["key"], "--variant", v["key"], "--id", rid, "--name", name, "--tint", tint, "--color", tint]
    else:
        raise ValueError("unknown op")
    r = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "new_role.py"), *args], cwd=ROOT, capture_output=True, text=True,
                       timeout=180, stdin=subprocess.DEVNULL)
    log_line = f"hire {op} {' '.join(args[1:3])} -> {r.returncode}"
    print(log_line, flush=True)
    return {"ok": r.returncode == 0, "op": op, "out": r.stdout[-4000:], "err": r.stderr[-2000:].replace("✗ ", "")}


# ===== t-hr-build: HR interview. 面试 on a market card -> a hire-* card + her opening DM (no agent wait); every DM you send her
# while it runs is stamped with the card id and lights her typing dots; 批准入职 on the card runs new_role.py apply --from-item.
HR_ID = "hr"
HR_Q = os.path.join(ROOT, "templates", "hr", "interview.json")


def _hr_on():
    r = next((x for x in load_json("roster.json", {"roles": []}).get("roles", []) if x["id"] == HR_ID), None)
    return bool(r) and r.get("enabled", True) is not False


def interview(body):
    op = body.get("op") or "start"
    if op == "abandon":
        with S.mutate() as st:
            it = S.find_item(st, str(body.get("item") or ""))
            if not it or not isinstance(it.get("hire"), dict):
                raise ValueError("不是面试卡")
            if it["hire"].get("status") in ("hired", "abandoned") or it.get("stage") == "done":
                return {"ok": True, "item": it["id"], "already": True}
            it["hire"]["status"] = "abandoned"
            it["stage"] = "done"
            it["closed"] = it["updated"] = S.now()
            S.add_thread(it, "me", "放弃面试", "done")
            a = st["agents"].get(HR_ID)
            if a and a.get("item") == it["id"]:
                S.set_agent(st, HR_ID, status="idle")
            S.add_log(st, "me", f"abandon {it['id']}", it["id"])
        S.inbox_append({"kind": "done", "item": it["id"], "hire": "abandoned"})
        return {"ok": True, "item": it["id"]}
    if op != "start":
        raise ValueError("unknown op")
    if body.get("mode") == "transfer":   # t-ht-build: 调岗 from 设置 · 角色
        return transfer_start(body)
    if not _hr_on():
        raise ValueError("HR 还没上岗")
    t = next((x for x in _tpl_list() if x["key"] == body.get("job")), None)
    if not t:
        raise ValueError("no such template")
    v = next((x for x in t["variants"] if x["key"] == body.get("variant")), None)
    if not v:
        raise ValueError("no such personality")
    q = load_json(os.path.relpath(HR_Q, ROOT), {})
    en = body.get("lang") == "en" and bool(q.get("opening_en"))   # t-i18n-c: the browser sends its UI language; English lines from interview.json
    if en:
        fill = lambda x: str(x).replace("{job}", t.get("title_en") or t["job"]).replace("{variant}", v.get("label_en") or v["label"]).replace("{duty}", t.get("duty_en") or t["duty"])
        opening = fill(q["opening_en"])
        opts = [fill(o) for o in (q.get("first_options_en") or ["{duty}"]) if fill(o).strip()][:3]
    else:
        fill = lambda x: str(x).replace("{job}", t["job"]).replace("{variant}", v["label"]).replace("{duty}", t["duty"])
        opening = fill(q.get("opening") or "这位{job}（{variant}）我先替你把把关。第一件事：你招 TA 主要替你干什么？")
        opts = [fill(o) for o in (q.get("first_options") or ["{duty}"]) if fill(o).strip()][:3]
    with S.mutate() as st:
        busy = S.open_interview(st)
        if busy:
            return {"ok": False, "busy": busy["id"], "title": busy.get("title", ""), "error": _busy_msg(busy)}
        base = f"hire-{t['key']}-{dt.datetime.now().strftime('%m%d-%H%M')}"
        cid, n = base, 2
        while S.find_item(st, cid, restore=False) or S.archive_find(cid):
            cid, n = f"{base}-{n}", n + 1
        it = S.upsert_item(st, {"id": cid, "title": f"面试：{t['job']}（{v['label']}）",
                                "title_en": f"Interview: {t.get('title_en') or t['job']} ({v.get('label_en') or v['label']})",   # t-i18n-b
                                "summary": f"HR在私聊里和你一问一答，问清五件事后出入职草案。模板 {t['key']} · 性格 {v['key']}。",
                                "category": "side", "owner": HR_ID, "stage": "doing", "kind": "task"}, who="me")
        it["hire"] = {"job": t["key"], "variant": v["key"], "job_name": t["job"], "variant_label": v["label"], "tint": v["tint"],
                      "status": "asking", "turns": 0, "filled": 0}
        lst = st["dms"].setdefault(HR_ID, [])
        lst.append(S._chat_entry(HR_ID, opening, "|".join(o.replace("|", "/") for o in opts) or None))
        S.add_thread(it, HR_ID, "开场白已发到私聊：" + opening, "event")
        S.add_log(st, "me", f"interview {cid}", cid)
    wd = os.path.join(ROOT, "work", cid)
    os.makedirs(wd, exist_ok=True)
    slots = q.get("slots") or []
    with open(os.path.join(wd, "interview.json"), "w", encoding="utf-8") as f:
        json.dump({"item": cid, "job": t["key"], "job_name": t["job"], "variant": v["key"], "variant_label": v["label"],
                   "duty": t["duty"], "starters": t.get("starters", []), "style": v.get("style", ""),
                   "slots": {x["key"]: None for x in slots if x.get("key")}, "turns": 0, "max_turns": q.get("max_turns", 8),
                   "opening": opening, **({"lang": "en", "lang_note": q.get("lang_note_en") or "", "job_name_en": t.get("title_en") or "",
                                           "variant_label_en": v.get("label_en") or "", "duty_en": t.get("duty_en") or "",
                                           "starters_en": t.get("starters_en", []), "style_en": v.get("style_en") or "",
                                           "asks_en": {x["key"]: x.get("ask_en") or x.get("ask") for x in slots if x.get("key")}} if en else {})},
                  f, ensure_ascii=False, indent=2)
    return {"ok": True, "item": cid}


def _hire_apply(cid):
    """批准入职 / 批准调岗: new_role.py apply|update --from-item, outside the state lock (it nudges the poll through stateutil.mutate itself)."""
    h0 = (S.find_item(S.read(), cid) or {}).get("hire") or {}
    xfer = h0.get("mode") == "transfer"   # t-ht-build
    args = ["update", str(h0.get("target") or ""), "--from-item", cid, "--json"] if xfer else ["apply", "--from-item", cid, "--json"]
    r = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "new_role.py"), *args], cwd=ROOT,
                       capture_output=True, text=True, timeout=180, stdin=subprocess.DEVNULL)
    try:
        j = json.loads((r.stdout.strip().splitlines() or ["{}"])[-1])
    except ValueError:
        j = {}
    ok = r.returncode == 0 and j.get("ok") is True
    print(f"hire {'update' if xfer else 'apply'}_item {cid} -> {r.returncode}", flush=True)
    err = None if ok else (j.get("error") or (r.stderr or "").replace("✗ ", "").strip()[-600:] or f"exit {r.returncode}")
    if ok and xfer:   # what the card's ht-diff shows once the files have moved on
        try:
            with open(os.path.join(ROOT, "work", cid, "applied.json"), "w", encoding="utf-8") as f:
                json.dump(j, f, ensure_ascii=False, indent=1)
        except OSError:
            pass
    with S.mutate() as st:
        it = S.find_item(st, cid)
        h = it["hire"]
        if ok and xfer:
            h.update(status="transferred", at=S.now(), backup_tag=j.get("backup_tag"))
            it["stage"], it["closed"] = "done", S.now()
            keys = "、".join(c["key"] for c in j.get("changes") or []) or "无"
            S.add_thread(it, "me", f"已调岗 · {j.get('name') or h.get('target')}：改了 {keys}。备份 .bak-newrole-{j.get('backup_tag')}；10 分钟内可在卡上「撤回调岗」", "done")
            for x in j.get("lessons") or []:
                _ht_lesson(st, h.get("target"), x, cid)
            if j.get("lessons"):
                S.add_thread(it, "me", f"{len(j['lessons'])} 条新红线变成了规则提议，在「审核」页点头才生效", "event")
            a = st["agents"].get(HR_ID)
            if a and a.get("item") == cid:
                S.set_agent(st, HR_ID, status="idle")
        elif ok:
            h.update(status="hired", hired_id=j.get("id"))
            it["stage"], it["closed"] = "done", S.now()
            S.add_thread(it, "me", f"已入职 · {j.get('name')}（{j.get('id')}）出现在团队里", "done")
            a = st["agents"].get(HR_ID)
            if a and a.get("item") == cid:
                S.set_agent(st, HR_ID, status="idle")
        else:
            h["status"] = "failed"
            it["stage"] = "review"
            S.add_thread(it, "me", ("调岗没办成：" if xfer else "入职没办成：") + err, "event", to=HR_ID)
        it["updated"] = S.now()
    if not ok:   # t-ht-build (t-hr-build leftover): HR hears about it like any comment addressed to her, not only via the approve entry
        S.inbox_append({"kind": "comment", "item": cid, "to": HR_ID, "auto": "hire_failed", "mode": "transfer" if xfer else "hire",
                        "text": ("批准调岗" if xfer else "批准入职") + f"失败：{err}。请按原因改 work/{cid}/" + ("transfer.json" if xfer else "role.json")
                                + "，重新交审（upsert-item --stage review），并在私聊里跟用户说一句。"})
    if ok and xfer:
        S.inbox_append({"kind": "role_changed", "id": h0.get("target"), "item": cid, "backup_tag": j.get("backup_tag"),
                        "lessons": len(j.get("lessons") or [])})
    return {"ok": ok, "id": j.get("id"), "name": j.get("name"), "mode": "transfer" if xfer else "hire", "error": err}


# ===== t-ht-build: 调岗 / 退休 from 设置 · 角色 (plan work/t-hr-transfer/plan.md). 调岗 = an HR DM like the interview (xfer-* card,
# work/<card>/transfer.json, new_role.py update on 批准调岗); 退休 = a handover sheet (GET /api/retire-plan, POST /api/hire retire + handover),
# a record card retire-<id>-<MMDD>, 8 s undo. CORE roles never retire, the manager is never transferred, founding roles soft-retire only.
CORE_IDS = {"manager", "hr", "smith"}
XFER_MAX = 5
NR = os.path.join(ROOT, "tools", "new_role.py")


def _role(rid):
    return next((x for x in load_json("roster.json", {"roles": []}).get("roles", []) if x["id"] == rid), None)


def _nr_mod():
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    import new_role   # noqa: E402
    return new_role


def _nr(*args, timeout=180):
    r = subprocess.run([sys.executable, NR, *args], cwd=ROOT, capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)
    print(f"ht new_role {' '.join(args[:3])} -> {r.returncode}", flush=True)
    return r, (r.stderr or "").replace("✗ ", "").strip()[-800:]


def _busy_msg(it):
    h = it.get("hire") or {}
    return (f"HR 正在给「{h.get('job_name', '')}」调岗" if h.get("mode") == "transfer" else f"HR 正在面试「{h.get('job_name', '')}」") + "，先聊完或放弃"


def _ht_lesson(st, agent, text, item):
    """A rule proposal without add_lesson's 2-per-card cap (a transfer can carry several red lines)."""
    st["lessons"].append({"id": S.new_id("L"), "t": S.now(), "agent": agent, "text": text, "item": item, "status": "pending", "via": "transfer"})
    S.push_mail(st, "update", f"新规则提议 · {agent}: {text}", item, agent)


def _uniq_id(st, base):
    cid, n = base, 2
    while S.find_item(st, cid, restore=False) or S.archive_find(cid):
        cid, n = f"{base}-{n}", n + 1
    return cid


def transfer_start(body):
    rid = str(body.get("target") or "")
    if not _RID.match(rid):
        raise ValueError("bad id")
    if rid == "manager":
        raise ValueError("管家不能调岗（manager.md 归她自己，改它走规则提议）")
    if not _hr_on():
        raise ValueError("HR 还没上岗")
    r = _role(rid)
    if not r or r.get("enabled") is False:
        raise ValueError("这个角色不在岗")
    q0 = load_json(os.path.relpath(HR_Q, ROOT), {}) or {}
    q = q0.get("transfer") or {}
    name = r.get("name") or rid
    en = body.get("lang") == "en" and bool(q.get("opening_en"))   # t-i18n-c
    if en:
        opening = str(q["opening_en"]).replace("{name}", r.get("name_en") or name)
        opts = [str(o).replace("{name}", r.get("name_en") or name) for o in (q.get("options_en") or q.get("options") or [])][:5]
    else:
        opening = str(q.get("opening") or "{name} 想改哪块？可以多选，也可以直接说想怎么改。").replace("{name}", name)
        opts = [str(o).replace("{name}", name) for o in (q.get("options") or ["职责", "说话味道", "名字称呼", "工具", "加一条红线"])][:5]
    with S.mutate() as st:
        busy = S.open_interview(st)
        if busy:
            return {"ok": False, "busy": busy["id"], "title": busy.get("title", ""), "error": _busy_msg(busy)}
        cid = _uniq_id(st, f"xfer-{rid}-{dt.datetime.now().strftime('%m%d-%H%M')}")
        it = S.upsert_item(st, {"id": cid, "title": f"调岗：{name}", "title_en": f"Transfer: {r.get('name_en') or name}",   # t-i18n-b
                                "summary": f"HR在私聊里问清改哪块、改成什么（≤{XFER_MAX} 轮），出前后对比草案；你点「批准调岗」才落地。"
                                           "Confirmed rules 不动，新红线变成规则提议。",
                                "category": "side", "owner": HR_ID, "stage": "doing", "kind": "task"}, who="me")
        it["hire"] = {"mode": "transfer", "target": rid, "job_name": name, "variant_label": r.get("title") or "",
                      "tint": r.get("tint") or r.get("color"), "status": "asking", "turns": 0, "filled": 0, "max_turns": XFER_MAX}
        st["dms"].setdefault(HR_ID, []).append(S._chat_entry(HR_ID, opening, "|".join(o.replace("|", "/") for o in opts) or None))
        S.add_thread(it, HR_ID, "开场白已发到私聊：" + opening, "event")
        S.add_log(st, "me", f"transfer {cid}", cid)
    NRm = _nr_mod()
    md = read_text_safe(os.path.join(ROOT, "roles", f"{rid}.md"))
    secs = NRm.md_sections(md)
    locked = set(NRm.md_locked(secs))
    wd = os.path.join(ROOT, "work", cid)
    os.makedirs(wd, exist_ok=True)
    with open(os.path.join(wd, "transfer.json"), "w", encoding="utf-8") as f:
        json.dump({"target": rid, "item": cid, "name": name,
                   "before": {"roster": r, "md_sha": NRm.sha(md),
                              "md_sections": {t: b.strip() for k, (t, b) in enumerate(secs) if t and k not in locked},
                              "locked_sections": [secs[k][0] for k in sorted(locked)]},
                   "after": {"roster": {}, "md_sections": {}, "lessons": []},
                   "fields": list(NRm.XFER_FIELDS), "turns": 0, "max_turns": XFER_MAX, "opening": opening,
                   **({"lang": "en", "lang_note": q0.get("lang_note_en") or ""} if en else {})}, f, ensure_ascii=False, indent=2)
    return {"ok": True, "item": cid}


def read_text_safe(p):
    try:
        return open(p, encoding="utf-8").read()
    except OSError:
        return ""


def transfer_plan(cid):
    """GET /api/transfer-plan?item=: the draft's before/after (new_role.py update --plan), or what was applied."""
    it = S.find_item(S.read(), cid) if re.match(r"^[a-z0-9][a-z0-9-]{1,60}$", cid or "") else None
    h = (it or {}).get("hire") or {}
    if h.get("mode") != "transfer":
        return {"ok": False, "error": "不是调岗卡"}
    ap = os.path.join(ROOT, "work", cid, "applied.json")
    if h.get("status") in ("transferred", "undone") and os.path.isfile(ap):
        j = load_json(os.path.relpath(ap, ROOT), {})
        j.update(applied=True, status=h.get("status"), at=h.get("at"))
        return j
    r, err = _nr("update", str(h.get("target") or ""), "--from-item", cid, "--plan", "--json", timeout=60)
    try:
        j = json.loads((r.stdout.strip().splitlines() or ["{}"])[-1])
    except ValueError:
        j = {"ok": False}
    if r.returncode or not j.get("ok"):
        return {"ok": False, "error": j.get("error") or err or "plan failed"}
    return j


def _owned_schedules(st, rid):
    out = []
    for sc in st.get("schedules") or []:
        if sc.get("deleted"):
            continue
        t = sc.get("task") or {}
        ow = t.get("agent")
        if not ow and t.get("item"):
            ow = (S.find_item(st, t["item"], restore=False) or {}).get("owner")
        if ow == rid:
            out.append(sc)
    return out


def retire_plan(rid):
    """GET /api/retire-plan?id=: what the 退休交接单 lists. Read only."""
    if not _RID.match(rid or ""):
        return {"ok": False, "error": "bad id"}
    sync_roster()   # the role must be in state.agents for note_hand to log the handoffs
    r = _role(rid)
    if not r:
        return {"ok": False, "error": "no such role"}
    st = S.read()
    a = st["agents"].get(rid) or {}
    block = None
    if rid in CORE_IDS:
        block = "管家、HR、工具管家不能退休"
    elif r.get("enabled") is False:
        block = "已经退休了"
    elif a.get("status") == "working":
        cur = S.find_item(st, a.get("item"), restore=False) if a.get("item") else None
        block = f"她在做「{(cur or {}).get('title') or a.get('activity') or '手上的事'}」，交回后再退"
    else:
        rr, err = _nr("retire", rid, "--dry", timeout=60)
        if rr.returncode:
            block = err
    pipe = r.get("pipe")
    pipes = set([pipe] if isinstance(pipe, str) else pipe or [])
    cands = []
    for x in load_json("roster.json", {"roles": []}).get("roles", []):
        if x["id"] in (rid,) or x.get("enabled") is False:
            continue
        xp = x.get("pipe")
        same = bool(pipes & set([xp] if isinstance(xp, str) else xp or []))
        cands.append({"id": x["id"], "name": x.get("name") or x["id"], "same": same})
    cands.sort(key=lambda c: (c["id"] != "manager", not c["same"]))
    items = [{"id": i["id"], "title": i.get("title", ""), "stage": i.get("stage")} for i in st["items"]
             if i.get("owner") == rid and i.get("stage") != "done"]
    scheds = [{"id": sc["id"], "title": sc.get("title") or (sc.get("task") or {}).get("text", ""), "routine": sc.get("routine"),
               "enabled": sc.get("enabled", True)} for sc in _owned_schedules(st, rid)]
    lessons = [{"id": l["id"], "text": l["text"]} for l in st["lessons"] if l.get("agent") == rid and l.get("status") == "pending"]
    agent = r.get("agent_name") or f"underthread-{rid}"
    keep = [f for f in (f"roles/{rid}.md", f".claude/agent-memory/{agent}/", f"work/{rid}-handoff.md", f"avatars/{rid}.png")
            if os.path.exists(os.path.join(ROOT, f))]
    return {"ok": True, "id": rid, "name": r.get("name") or rid, "title": r.get("title"), "founding": not r.get("template"),
            "block": block, "items": items, "schedules": scheds, "lessons": lessons, "candidates": cands, "keep": keep}


def retire_role(body):
    """退休 with a handover sheet. Cards / schedules / proposals move first (one mutate), then new_role.py retire runs outside the lock;
    if it refuses, the handover is put back."""
    rid = str(body.get("id") or "")
    if "handover" not in body:
        return hire_legacy(body)
    plan = retire_plan(rid)
    if not plan.get("ok"):
        raise ValueError(plan.get("error"))
    if plan.get("block"):
        raise ValueError(plan["block"])
    ho = body.get("handover") or {}
    ip, sp = ho.get("items") or {}, ho.get("schedules") or {}
    name = plan["name"]
    on = {c["id"] for c in plan["candidates"]}
    with S.mutate() as st:
        rec = {"id": rid, "name": name, "t": S.now(), "items": [], "schedules": [], "lessons": []}
        for sc in _owned_schedules(st, rid):
            act_ = sp.get(sc["id"], "pause")
            t = sc.setdefault("task", {})
            e = {"id": sc["id"], "title": sc.get("title", ""), "action": act_, "agent": t.get("agent"), "enabled": sc.get("enabled", True)}
            if act_ == "manager":
                t["agent"] = "manager"
            elif sc.get("enabled", True):
                S.schedule_pause(st, sc, True, by="me")
            rec["schedules"].append(e)
        lines = []
        for it in st["items"]:
            if it.get("owner") != rid or it.get("stage") == "done":
                continue
            to = ip.get(it["id"], "manager")
            if to != "park" and to not in on:
                to = "manager"
            e = {"id": it["id"], "title": it.get("title", ""), "stage": it.get("stage"), "to": to}
            if to == "park":
                it["owner"], it["stage"], it["parked_from"] = "manager", "todo", rid
                S.add_thread(it, "me", f"搁置 · {name} 退休，返聘时可以一键拿回", "event")
                lines.append(f"- {it.get('title', it['id'])} → 搁置")
            else:
                it["owner"] = to
                S.note_hand(st, it["id"], to, "reassign", frm=rid)
                S.add_thread(it, "me", f"交接自 {name}（退休），接手前先读 work/{rid}-handoff.md", "event", to=to)
                lines.append(f"- {it.get('title', it['id'])} → {(st['agents'].get(to) or {}).get('name') or to}")
            it["updated"] = S.now()
            e["at"] = it["updated"]
            rec["items"].append(e)
        for l in st["lessons"]:
            if l.get("agent") == rid and l.get("status") == "pending":
                l["status"], l["parked"] = "parked", S.now()
                rec["lessons"].append(l["id"])
        rcid = _uniq_id(st, f"retire-{rid}-{dt.datetime.now().strftime('%m%d')}")
        card = S.upsert_item(st, {"id": rcid, "title": f"退休：{name}", "title_en": f"Retired: {(_role(rid) or {}).get('name_en') or name}", "category": "side", "owner": HR_ID if HR_ID in st["agents"] else "manager",
                                  "stage": "done", "kind": "task",
                                  "summary": f"{name}（{rid}）软退休：roles/{rid}.md、记忆、交接单、声音、头像都留着，返聘就回来。"}, who="me")
        card["retire"] = rec
        card["closed"] = S.now()
        sl = "；".join(f"{x['title']} → {'转管家' if x['action'] == 'manager' else '暂停'}" for x in rec["schedules"])
        txt = ["交接清单："] + (lines or ["- 手上没有没完成的单子"]) + ([f"- 定时：{sl}"] if sl else []) + ([f"- 规则提议 {len(rec['lessons'])} 条挂起，返聘时放回"] if rec["lessons"] else [])
        S.add_thread(card, "me", "\n".join(txt), "done")
        S.add_log(st, "me", f"retire {rid}", rcid)
    r, err = _nr("retire", rid)
    if r.returncode:
        _retire_restore(rcid, rid, rehire=False)
        raise ValueError(err or "retire failed")
    S.inbox_append({"kind": "retired", "id": rid, "record": rcid, "items": [{"id": e["id"], "to": e["to"]} for e in rec["items"]],
                    "schedules": [{"id": e["id"], "action": e["action"]} for e in rec["schedules"]]})
    return {"ok": True, "id": rid, "record": rcid, "moved": len(rec["items"])}


def _retire_restore(rcid, rid, rehire=True):
    """Put a retirement back: cards the new owner has not touched since, schedules, parked proposals."""
    back, kept = [], []
    with S.mutate() as st:
        card = S.find_item(st, rcid)
        rec = (card or {}).get("retire") or {}
        if rec.get("id") != rid or rec.get("undone"):
            raise ValueError("没有可撤销的退休记录")
        for e in rec.get("items") or []:
            it = S.find_item(st, e["id"])
            want = "manager" if e["to"] == "park" else e["to"]
            if it and it.get("owner") == want and it.get("updated") == e.get("at"):
                it["owner"], it["stage"] = rid, e.get("stage") or it.get("stage")
                it.pop("parked_from", None)
                if want != "manager" or e["to"] != "park":
                    S.note_hand(st, it["id"], rid, "reassign", frm=want)
                S.add_thread(it, "me", f"撤销退休 · 单子回到 {rec.get('name') or rid}", "event", to=rid)
                it["updated"] = S.now()
                back.append(e["id"])
            else:
                kept.append(e["id"])
        for e in rec.get("schedules") or []:
            sc = next((x for x in st.get("schedules") or [] if x["id"] == e["id"]), None)
            if not sc:
                continue
            sc.setdefault("task", {})["agent"] = e.get("agent")
            if e.get("enabled") and not sc.get("enabled", True):
                try:
                    S.schedule_pause(st, sc, False, by="me")
                except Exception:   # noqa: BLE001  (a once-rule already past stays paused)
                    pass
        for l in st["lessons"]:
            if l["id"] in (rec.get("lessons") or []) and l.get("status") == "parked":
                l["status"] = "pending"
                l.pop("parked", None)
        rec["undone"] = S.now()
        if card:
            S.add_thread(card, "me", f"已撤销退休 · 回来 {len(back)} 张单子" + (f"，{len(kept)} 张新主人已经动过，留在原处" if kept else ""), "event")
    return back, kept


def undo_retire(body):
    rid = str(body.get("id") or "")
    st = S.read()
    recs = [i for i in st["items"] if (i.get("retire") or {}).get("id") == rid and not i["retire"].get("undone")]
    if not recs:
        raise ValueError("没有可撤销的退休记录")
    rcid = recs[-1]["id"]
    r, err = _nr("rehire", rid)
    if r.returncode:
        raise ValueError(err or "rehire failed")
    back, kept = _retire_restore(rcid, rid)
    S.inbox_append({"kind": "retire_undone", "id": rid, "record": rcid, "back": back, "kept": kept})
    return {"ok": True, "id": rid, "back": len(back), "kept": len(kept)}


def rehire_role(body):
    rid = str(body.get("id") or "")
    if not _RID.match(rid):
        raise ValueError("bad id")
    r = _role(rid)
    if not r:
        raise ValueError("不在 roster 里（硬归档的用 new_role.py rehire --from-archive）")
    res, err = _nr("rehire", rid)
    if res.returncode:
        return {"ok": False, "op": "rehire", "err": err}
    with S.mutate() as st:
        n = 0
        for l in st["lessons"]:
            if l.get("agent") == rid and l.get("status") == "parked":
                l["status"] = "pending"
                l.pop("parked", None)
                n += 1
        parked = [i["id"] for i in st["items"] if i.get("parked_from") == rid and i.get("stage") != "done"]
        paused = [sc["id"] for sc in _owned_schedules(st, rid) if not sc.get("enabled", True) and (sc.get("paused") or {}).get("by") == "me"]
        S.add_log(st, "me", f"rehire {rid}")
    S.inbox_append({"kind": "rehired", "id": rid, "lessons": n, "parked": parked, "paused": paused})
    return {"ok": True, "op": "rehire", "id": rid, "lessons": n, "parked": parked, "paused": paused}


def unpark(body):
    rid = str(body.get("id") or "")
    r = _role(rid)
    if not r or r.get("enabled") is False:
        raise ValueError("先返聘")
    with S.mutate() as st:
        got = []
        for it in st["items"]:
            if it.get("parked_from") == rid and it.get("stage") != "done" and it.get("owner") == "manager":
                it["owner"] = rid
                it.pop("parked_from", None)
                S.note_hand(st, it["id"], rid, "reassign", frm="manager")
                S.add_thread(it, "me", f"拿回搁置的单子 · 回到 {r.get('name') or rid}", "event", to=rid)
                it["updated"] = S.now()
                got.append(it["id"])
    if got:
        S.inbox_append({"kind": "unparked", "id": rid, "items": got})
    return {"ok": True, "items": got}


def archive_role(body):
    rid = str(body.get("id") or "")
    r = _role(rid)
    if not r:
        raise ValueError("no such role")
    if not r.get("template"):
        raise ValueError("创始成员只能软退休，不能归档")
    if body.get("confirm") != rid:
        raise ValueError("归档要二次确认")
    if r.get("enabled") is not False:
        raise ValueError("先软退休，再归档")
    res, err = _nr("retire", rid, "--hard")
    return {"ok": res.returncode == 0, "op": "archive", "out": res.stdout[-2000:], "err": err}


def undo_update(body):
    cid = str(body.get("item") or "")
    with S.mutate() as st:
        it = S.find_item(st, cid)
        h = (it or {}).get("hire") or {}
        if h.get("mode") != "transfer" or h.get("status") != "transferred":
            raise ValueError("这张卡没有可撤回的调岗")
        if not h.get("at") or (dt.datetime.now().astimezone() - dt.datetime.fromisoformat(h["at"])).total_seconds() > 600:
            raise ValueError("超过 10 分钟了，撤回要找工具管家按备份手动改回")
    r, err = _nr("update", "--undo", cid, "--json")
    if r.returncode:
        raise ValueError(err or "undo failed")
    with S.mutate() as st:
        it = S.find_item(st, cid)
        it["hire"]["status"] = "undone"
        S.add_thread(it, "me", "已撤回调岗 · roster 和 roles 文件按备份改回", "event")
        for l in st["lessons"]:
            if l.get("item") == cid and l.get("status") == "pending" and l.get("via") == "transfer":
                l["status"], l["decided"] = "dropped", S.now()
        it["updated"] = S.now()
    S.inbox_append({"kind": "role_changed", "id": h.get("target"), "item": cid, "undo": True})
    return {"ok": True, "item": cid}


HT_OPS = {"undo_retire": undo_retire, "unpark": unpark, "archive": archive_role, "undo_update": undo_update}


def act(body):
    k = body.get("kind")
    me = "me"
    inbox = None
    hire_go = None   # t-hr-build: 批准入职 runs new_role.py after the lock is released
    with S.mutate() as st:
        it = S.find_item(st, body["item"]) if body.get("item") else None
        if body.get("item") and not it:
            raise ValueError(f"no item {body['item']}")
        att = body.get("attachments") or []

        if k == "new_task":
            text = body.get("text", "").strip()
            title = body.get("title") or text.split("\n")[0][:80] or "新委托"
            it = S.upsert_item(st, {"title": title, "summary": text, "category": body.get("category") or "daily",
                                    "owner": body.get("owner") or "manager", "platforms": body.get("platforms") or [],
                                    "due": body.get("due"), "attachments": att, "stage": "todo"}, who=me)
            it["triage"] = not body.get("category")
            S.add_thread(it, me, text, "msg", attachments=att)
            inbox = {"kind": "new_task", "item": it["id"], "text": text, "owner": body.get("owner"),
                     "category": body.get("category"), "attachments": att}

        elif k == "chat":
            src = S.find_msg(st["chat"], body.get("reply_to"))   # t-option-quote: unknown / trimmed ids are ignored, the message still goes out
            st["chat"].append(S._chat_entry(me, body["text"], attachments=att, quote=src))
            inbox = {"kind": "manager", "text": body["text"], "attachments": att}
            if src:
                inbox.update(S.reply_fields(src))

        elif k == "dm":
            if body["agent"] == "manager":
                raise ValueError("use chat for the manager")
            lst = st["dms"].setdefault(body["agent"], [])
            src = S.find_msg(lst, body.get("reply_to"))
            lst.append(S._chat_entry(me, body["text"], attachments=att, quote=src))
            inbox = {"kind": "dm", "agent": body["agent"], "text": body["text"], "attachments": att}
            if src:
                inbox.update(S.reply_fields(src))
            iv = S.open_interview(st) if body["agent"] == HR_ID and HR_ID in st["agents"] else None
            if iv:   # t-hr-build: which interview this is for, and her typing dots at once (not when the manager gets round to it)
                h = iv["hire"]
                if h.get("status") == "asking" and iv.get("stage") != "review":
                    h["turns"] = h.get("turns", 0) + 1
                inbox.update(item=iv["id"], turn=h.get("turns", 0), hire=h.get("status"))
                if h.get("mode") == "transfer":   # t-ht-build
                    inbox.update(mode="transfer", target=h.get("target"), max_turns=h.get("max_turns", XFER_MAX))
                S.set_agent(st, HR_ID, status="working", item=iv["id"], activity="调岗中 · 在想" if h.get("mode") == "transfer" else "面试中 · 在想")

        elif k == "comment":
            to = body.get("to") or it["owner"]
            S.add_thread(it, me, body["text"], "msg", attachments=att, to=to)
            if it["stage"] in ("review", "done"):
                it["stage"] = "doing"
            inbox = {"kind": "comment", "item": it["id"], "to": to, "text": body["text"], "attachments": att}

        elif k == "approve":
            skipped, oa = _guard_asks(it, body)
            plan = it.get("kind") == "plan"
            if isinstance(it.get("hire"), dict) and it.get("kind") == "deliverable":   # t-hr-build: 批准入职
                if it["hire"].get("status") in ("applying", "hired", "abandoned", "transferred", "undone"):
                    raise ValueError("这张卡已经处理过了")
                it["hire"]["status"] = "applying"
                it["approved"] = S.now()
                S.add_thread(it, me, ("批准调岗" if it["hire"].get("mode") == "transfer" else "批准入职") + (f" · {body['note']}" if body.get("note") else "") + skipped, "approve")
                hire_go = it["id"]
                inbox = {"kind": "approve", "item": it["id"], "was": it.get("kind"), "note": body.get("note")}
            else:
                it["stage"] = "doing" if plan else "done"
                it["approved"] = S.now()
                if not plan:
                    it["closed"] = S.now()
                # t-btn-names: the log line uses the button's own words (批准开工 / 验收 · 关单 / 回答); the action kind stays "approve"
                lbl = "批准开工" if plan else "回答" if it.get("kind") == "question" else "验收 · 关单"
                S.add_thread(it, me, lbl + (f" · {body['note']}" if body.get("note") else "") + skipped, "approve")
                inbox = {"kind": "approve", "item": it["id"], "was": it.get("kind"), "note": body.get("note")}
            if oa:
                inbox["open_asks"] = oa

        elif k == "reject":
            reason = body.get("reason", "").strip()
            if not reason:
                raise ValueError("reject needs a reason")
            it["stage"] = "doing"
            it["rejects"] = it.get("rejects", 0) + 1
            S.add_thread(it, me, f"驳回 · {reason}", "reject")
            inbox = {"kind": "reject", "item": it["id"], "reason": reason}

        elif k == "done":
            skipped, oa = _guard_asks(it, body)
            it["stage"] = "done"
            it["closed"] = S.now()
            S.add_thread(it, me, "完成 · mission complete" + skipped, "done")
            inbox = {"kind": "done", "item": it["id"]}
            if oa:
                inbox["open_asks"] = oa

        elif k == "answer":   # t-open-questions: a click on one of an ask's options; the stage stays as it is
            a, changed = S.answer_ask(it, body.get("ask"), body.get("opt"), me)
            inbox = {"kind": "answer", "item": it["id"], "ask": a["id"], "q": a["q"], "opt": a["answer"]["opt"],
                     "to": a.get("by") or it["owner"], "changed": changed, "reply_to": "ask:" + a["id"]}

        elif k == "reopen":
            it["stage"] = "doing"
            it.pop("closed", None)
            S.add_thread(it, me, "重开 · reopened", "event")
            inbox = {"kind": "reopen", "item": it["id"]}

        elif k == "reassign":
            if body["owner"] != it.get("owner"):   # t-rb-build: the user moving a card between roles is a handoff
                S.note_hand(st, it["id"], body["owner"], "reassign", frm=it.get("owner"))
            it["owner"] = body["owner"]
            S.add_thread(it, me, f"改派给 {body['owner']}", "event")
            inbox = {"kind": "dispatch", "item": it["id"], "owner": body["owner"]}

        elif k == "set_category":
            it["category"] = body["category"]
            S.add_thread(it, me, f"分类 → {body['category']}", "event")

        elif k == "set_stage":
            if body["stage"] not in S.STAGES:
                raise ValueError("bad stage")
            old = it["stage"]
            skipped, oa = _guard_asks(it, body) if body["stage"] == "done" else ("", None)
            it["stage"] = body["stage"]
            S.add_thread(it, me, f"stage {old} → {body['stage']}" + skipped, "event")
            if body["stage"] == "done":
                it["closed"] = S.now()
                inbox = {"kind": "done", "item": it["id"]}
                if oa:
                    inbox["open_asks"] = oa

        elif k == "archive":
            it["archived"] = True

        elif k == "lesson":
            l = S.decide_lesson(st, body["id"], body["decision"])
            inbox = {"kind": "lesson", "id": l["id"], "decision": l["status"], "agent": l["agent"], "text": l["text"]}

        elif k == "calendar_add":
            st["calendar"].append({"id": S.new_id("c"), "date": body.get("date") or dt.date.today().isoformat(),
                                   "time": body.get("time", ""), "title": body["title"]})
            st["calendar"].sort(key=lambda c: (c["date"], c["time"]))
        elif k == "calendar_del":
            st["calendar"] = [c for c in st["calendar"] if c["id"] != body["id"]]

        elif k == "notice_dismiss":
            st["notices"] = [n for n in st["notices"] if n["id"] != body["id"]]

        elif k == "mail_read":
            ids = set(body.get("ids") or [])
            for m in st["mail"]:
                if body.get("all") or m["id"] in ids:
                    m["read"] = True

        elif k == "widget_layout":   # t-widget-drag: the desktop widget home's order / sizes, shared by every browser (meta.widgets)
            if body.get("reset"):
                st["meta"]["widgets"] = {"layout": None, "at": S.now()}   # explicit default: an old per-browser layout must not re-upload over it
            else:
                lay = body.get("layout")
                if not isinstance(lay, list) or not 0 < len(lay) <= 24:
                    raise ValueError("bad layout")
                out, seen = [], set()
                for x in lay:
                    if not (isinstance(x, list) and len(x) == 2 and isinstance(x[0], str) and re.fullmatch(r"[a-z]{1,16}", x[0])
                            and x[1] in ("s", "m", "l") and x[0] not in seen):
                        raise ValueError("bad layout entry")
                    seen.add(x[0])
                    out.append([x[0], x[1]])
                st["meta"]["widgets"] = {"layout": out, "at": S.now()}

        elif k == "stamina":
            st["meta"]["stamina"] = {"pct": int(body["pct"]), "note": body.get("note", "手动"), "at": S.now()}

        elif k == "ping":
            inbox = {"kind": "ping"}
            if body.get("note"):  # t-imp-p4: e.g. 「刷新用量」 from the 系统状态 panel
                inbox["note"] = str(body["note"])[:200]
        elif k == "report_request":
            inbox = {"kind": "report_request"}

        elif k == "snooze":   # ri1103-P2
            preset = body.get("preset")
            if preset not in SNOOZE_PRESETS:
                raise ValueError("bad preset")
            if not _on_user(it):
                raise ValueError("这张卡现在不在等你拍板，不用推迟")
            until = ((dt.datetime.now() + dt.timedelta(days=SNOOZE_REPLY_DAYS)).astimezone().isoformat(timespec="seconds")
                     if preset == "reply" else snooze_until(preset, body.get("until")))
            it["snooze"] = {"until": until, "wait": "reply" if preset == "reply" else None, "preset": preset, "at": S.now(), "by": me}
            it.pop("snoozed", None)
            lbl = str(body.get("label") or "")[:40]
            S.add_thread(it, me, "稍后 · " + (lbl or ("等下条回复" if preset == "reply" else until[5:16].replace("T", " ").replace("-", "/"))), "event")

        elif k == "unsnooze":   # ri1103-P2
            if it.pop("snooze", None) is not None:
                S.add_thread(it, me, "取消推迟 · 回到等你拍板", "event")

        elif k in ("routine_pause", "routine_resume"):   # t-routine-close
            r = next((x for x in CONFIG.get("routines") or [] if isinstance(x, dict) and x.get("id") == body.get("routine")), None)
            if not r and it is not None and not body.get("routine"):
                # t-routine-detect: a standing card with no server timer (按需常驻, e.g. t-oss-sync): paused by item. Same test as app.js routineOf:
                # ongoing, in doing, not a child card (no tag naming another card). The manager skips a card with it["paused"].
                child = any(t != it["id"] and S.find_item(st, t, restore=False) for t in it.get("tags") or [])
                if it.get("category") != "ongoing" or it.get("stage") != "doing" or child:
                    raise ValueError(f"not a standing card {it['id']}")
                if k == "routine_pause":
                    it["paused"] = {"at": S.now(), "by": me}
                    msg = "暂停常驻 · 管家不再做这张卡"
                else:
                    it.pop("paused", None)
                    msg = "恢复常驻 · 管家照常做这张卡"
                S.add_thread(it, me, msg, "event")
                inbox = {"kind": k, "routine": None, "item": it["id"]}
            else:
                rid = body.get("routine")
                sc = next((x for x in st.get("schedules") or [] if x.get("routine") == rid and not x.get("deleted")), None)
                if not sc:
                    raise ValueError(f"no routine {rid}")
                it = it or S.find_item(st, (sc.get("task") or {}).get("item") or "r-" + rid)
                S.schedule_pause(st, sc, k == "routine_pause", by=me)   # t-schedule-backend: resuming never starts a missed same-day run
                st["meta"].setdefault("routines_paused", {}).pop(rid, None)
                msg = "停止常驻任务 · 定时器已停，不会再开新的子卡" if k == "routine_pause" else f"恢复常驻任务 · 每天 {sc['rule'].get('at')}"
                if it is not None:
                    S.add_thread(it, me, msg, "event")
                inbox = {"kind": k, "routine": rid, "item": it["id"] if it else None}

        elif k in ("schedule_pause", "schedule_resume", "schedule_rm", "schedule_fire"):   # t-schedule-backend: the 定时 page
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
                S.schedule_pause(st, sc, k == "schedule_pause", by=me)
            if sc.get("routine") and k in ("schedule_pause", "schedule_resume"):
                st["meta"].setdefault("routines_paused", {}).pop(sc["routine"], None)
            inbox = {"kind": k, "schedule": sc["id"], "title": sc.get("title"), "item": (sc.get("task") or {}).get("item")}
        else:
            raise ValueError(f"unknown action {k}")

        if it is not None:
            it["updated"] = S.now()
            if k in ("approve", "reject", "done", "comment", "answer", "reopen", "set_stage", "archive"):   # ri1103-P2: you dealt with it
                it.pop("snooze", None)
                it.pop("snoozed", None)
        if k != "widget_layout":   # t-widget-drag: dragging tiles is not activity worth a log line
            S.add_log(st, me, f"{k}" + (f" {it['id']}" if it else ""), it["id"] if it else None)

    hire_res = None
    if hire_go:
        hire_res = _hire_apply(hire_go)
        inbox["hire"] = hire_res
    if inbox and any(S.is_audio_path(p) for p in inbox.get("attachments") or []):
        with S.mutate() as st:   # t-voice-memo: transcripts already finished ride along with the message
            S.claim_transcripts(st, inbox)
    if inbox:
        inbox = S.inbox_append(inbox)
    out = {"ok": True, "inbox": inbox["id"] if inbox else None}
    if hire_res is not None:
        out["hire"] = hire_res
    return out


def transcribe_async(rel, force=False):
    """t-voice-memo: start tools/transcribe.py for an audio upload in the background (never blocks a request)."""
    if not S.is_audio_path(rel):
        return False
    os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
    with open(os.path.join(ROOT, "logs", "transcribe.log"), "a") as lf:
        subprocess.Popen([sys.executable, os.path.join(ROOT, "tools", "transcribe.py"), rel] + (["--force"] if force else []),
                         cwd=ROOT, stdin=subprocess.DEVNULL, stdout=lf, stderr=lf, start_new_session=True)
    return True


MEMO_DEFAULT = "🎙 语音备忘录（从 iPhone 分享）"


def memo_post(rfile, length, q):
    """t-share-memo: the iPhone Shortcut 「发给暗线」. Raw file body -> uploads/, posted as my message to the
    manager chat (to=manager) or as a DM (to=<role id>), transcription started. Returns (code, one line of plain text)."""
    to = (q.get("to") or ["manager"])[0].strip() or "manager"
    st = S.read()
    agents = st.get("agents") or {}
    if to != "manager" and (to not in agents or agents[to].get("enabled") is False):
        return 400, f"发送失败：没有「{to}」这个收件人（可用：manager 或角色 id）"
    name = (q.get("name") or ["memo.m4a"])[0] or "memo.m4a"   # parse_qs already %-decoded it; _upload_name strips / and ..
    text = (q.get("text") or [""])[0].strip()[:2000] or MEMO_DEFAULT
    res = save_upload_stream(rfile, length, name)
    body = {"kind": "chat", "text": text, "attachments": [res["path"]]} if to == "manager" else \
           {"kind": "dm", "agent": to, "text": text, "attachments": [res["path"]]}
    act(body)
    started = transcribe_async(res["path"])
    who = _agent_name(st, to)
    return 200, f"已发给{who}" + (" · 正在本机转写" if started else "")


def save_upload(body):
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", body.get("name") or "paste.png")[-60:]
    data = body["data"]
    if "," in data[:100]:
        data = data.split(",", 1)[1]
    raw = base64.b64decode(data)
    if len(raw) > 50 * 1024 * 1024:
        raise ValueError("file too large (50MB max)")
    fn = f"{dt.datetime.now():%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:4]}-{name}"
    with open(os.path.join(UPLOADS, fn), "wb") as f:
        f.write(raw)
    return {"ok": True, "path": f"uploads/{fn}", "abs": os.path.join(UPLOADS, fn)}


MAX_UPLOAD = 8 * 1024**3  # 8 GB: raw footage


def _upload_name(name):
    name = re.sub(r"[^\w.\-]+", "_", name or "file")[-80:] or "file"
    return f"{dt.datetime.now():%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:4]}-{name}"


def save_upload_stream(rfile, length, name):
    """Stream a raw request body to uploads/ in 1 MB chunks (no base64, no whole-file buffering)."""
    if length <= 0:
        raise ValueError("empty upload")
    if length > MAX_UPLOAD:
        raise ValueError("file too large (8 GB max)")
    fn = _upload_name(name)
    dest = os.path.join(UPLOADS, fn)
    part = dest + ".part"
    left = length
    try:
        with open(part, "wb") as f:
            while left:
                chunk = rfile.read(min(1 << 20, left))
                if not chunk:
                    raise ValueError("upload interrupted")
                f.write(chunk)
                left -= len(chunk)
        os.replace(part, dest)
    finally:
        if os.path.exists(part):
            os.remove(part)
    return {"ok": True, "path": f"uploads/{fn}", "abs": dest, "bytes": length}


def list_docs():
    out = []
    for f in DOC_FILES:
        if os.path.exists(os.path.join(ROOT, f)):
            out.append({"path": f, "group": "core"})
    for d in DOC_DIRS:
        base = os.path.join(ROOT, d)
        if not os.path.isdir(base):
            continue
        for dirpath, _, files in os.walk(base):
            for f in sorted(files):
                if f.endswith(".md"):
                    rel = os.path.relpath(os.path.join(dirpath, f), ROOT)
                    out.append({"path": rel, "group": d})
    return out


def read_doc(path):
    allowed = {d["path"] for d in list_docs()}
    if path not in allowed:
        raise ValueError("not a dashboard doc")
    with open(os.path.join(ROOT, path), encoding="utf-8") as f:
        return f.read()


# ---- role memory viewer (read-only). Whitelist: <ROOT>/.claude/agent-memory/<agent_name>/ for roster agents,
# plus ONE explicit outside dir: the manager's own memory under ~/.claude/projects/<slug of ROOT>/memory.
# Only direct *.md files in those dirs are served; ids come from roster.json, never from a client path.
MEM_BASE = os.path.join(ROOT, ".claude", "agent-memory")
MANAGER_MEM = os.path.join(os.path.expanduser("~"), ".claude", "projects", re.sub(r"[^A-Za-z0-9]", "-", ROOT), "memory")


def _mem_dir(rid):
    if rid == "manager":
        return MANAGER_MEM, True
    for r in load_json("roster.json", {"roles": []}).get("roles", []):
        if r.get("id") == rid and r.get("agent_name") and re.fullmatch(r"[A-Za-z0-9_-]+", r["agent_name"]):
            return os.path.join(MEM_BASE, r["agent_name"]), False
    raise ValueError("unknown role")


def _mem_files(d):
    if not os.path.isdir(d):
        return []
    real = os.path.realpath(d)
    names = [f for f in os.listdir(d) if f.endswith(".md") and not f.startswith(".")]
    names.sort(key=lambda f: (f != "MEMORY.md", f))
    out = []
    for f in names:
        fp = os.path.realpath(os.path.join(d, f))
        if os.path.dirname(fp) == real and os.path.isfile(fp):
            out.append((f, fp))
    return out


def role_memory(rid=None):
    if rid is None:
        counts = {}
        for r in load_json("roster.json", {"roles": []}).get("roles", []):
            try:
                counts[r["id"]] = len([f for f in _mem_files(_mem_dir(r["id"])[0]) if f[0] != "MEMORY.md"])
            except ValueError:
                pass
        return {"counts": counts}
    d, external = _mem_dir(rid)
    files = []
    for name, fp in _mem_files(d):
        with open(fp, encoding="utf-8", errors="replace") as fh:
            files.append({"name": name, "text": fh.read(200000)})
    return {"id": rid, "dir": d if external else os.path.relpath(d, ROOT), "external": external, "readonly": True, "files": files}


# t-mobile-crash-state: the phone polls with ?slim=1. Done / archived cards leave out draft + versions (the drawer fetches them from
# /api/item on open), and logs keep the last 400 overall plus the last 400 per agent (= exactly what the 动态 page can show).
SLIM_LOGS = 400


def slim_state(st):
    for it in st.get("items", []):
        if it.get("stage") == "done" or it.get("archived"):
            it["versions_n"] = len(it.get("versions") or [])
            it.pop("versions", None)
            it.pop("draft", None)
            it["slim"] = 1
    if "logs" not in st:   # ri1105-P4: trim_state already took the logs out
        return st
    logs = st.get("logs") or []
    keep, per = set(range(max(0, len(logs) - SLIM_LOGS), len(logs))), {}
    for i, l in enumerate(logs):
        per.setdefault(l.get("agent"), []).append(i)
    for ix in per.values():
        keep.update(ix[-SLIM_LOGS:])
    st["logs"] = [logs[i] for i in sorted(keep)]
    return st


def public_item(iid):
    for it in S.read().get("items", []):
        if it.get("id") == iid:
            return it
    # t-perf A: an archived card comes with its archived parent / sub-cards, so the detail can draw the family
    arch = archive_cached()["items"]
    it = next((i for i in arch if i.get("id") == iid), None)
    if not it:
        return None
    return dict(it, archived_store=1, family=[i for i in S.archive_family(arch, iid) if i.get("id") != iid])


# ---------- t-perf B: nothing is re-read or re-encoded unless a file it comes from changed ----------
# A poll used to read state.json twice (public_state + _unacked_count, ~43 ms for a "same") and json-encode + gzip the whole state for
# every client (~75 ms). Now: rev + unacked count are cached by the (inode, mtime_ns, size) of state.json and inbox.jsonl; the encoded
# body (raw + gzip) by those plus avatars/, archive.json, the 5090 probe and the minute (routines' next run moves with the clock).
# state.json is only ever replaced with os.replace (stateutil._save), so a new inode / mtime always marks a new version.
def _fsig(p):
    try:
        x = os.stat(p)
        return (x.st_ino, x.st_mtime_ns, x.st_size)
    except OSError:
        return None


_RV = {"sig": None, "rev": None, "un": 0}
_PSC, _PSL = {}, threading.Lock()
_AR = {"sig": None, "items": [], "body": None}


def rev_unacked():
    k = (_fsig(S.STATE), _fsig(S.INBOX))
    if k != _RV["sig"]:
        st = S.read()
        acked = set(st["meta"].get("inbox_acked") or [])
        un = sum(1 for e in S.inbox_all() if e["id"] not in acked)
        _RV.update(sig=k, rev=st["meta"]["rev"], un=un)
    return _RV["rev"], _RV["un"]


def archive_cached():
    sig = _fsig(S.ARCHIVE)
    if sig != _AR["sig"]:
        _AR.update(sig=sig, items=S.archive_load(), body=None)
    return _AR


def archive_body(gz):
    """/api/archive: every archived card in full (search + 素材库 load it on demand), cached until archive.json or state.json changes."""
    a, ssig = archive_cached(), _fsig(S.STATE)
    if not a["body"] or a["body"][0] != ssig:
        live = {i.get("id") for i in S.read().get("items", [])}
        raw = json.dumps({"v": (a["sig"] or [0, 0])[1], "items": [i for i in a["items"] if i.get("id") not in live]}, ensure_ascii=False).encode()
        a["body"] = (ssig, raw, gzip.compress(raw, 5))
    return a["body"][2] if gz else a["body"][1]


# ---- t-hr-registry: which art files each role has (web/art/<id>.jpg, panels/, cut/, avatars/ut/_s/<id>-work-160.webp). The web reads meta.art
# instead of hard-coded id lists, so a new role's art shows up without a code edit. Cached on the four directories' signatures.
ART_DIRS = (("jpg", os.path.join(WEB, "art"), ".jpg"), ("panel", os.path.join(WEB, "art", "panels"), ".webp"),
            ("cut", os.path.join(WEB, "art", "cut"), ".webp"), ("sheet", os.path.join(AVATARS, "ut", "_s"), "-work-160.webp"))
_ART = {"sig": None, "map": {}}
# Spare stage seats for roles whose roster entry has no "seat" key (an explicit "seat": null keeps a role off the stage).
STAGE_SPARE = [[.22, .62], [.60, .22], [.74, .34], [.10, .70], [.46, .76], [.84, .26]]


def art_sig():
    return tuple(_fsig(d) for _, d, _ in ART_DIRS)


def art_scan():
    sig = art_sig()
    if sig == _ART["sig"]:
        return _ART["map"]
    m = {}
    for k, d, ext in ART_DIRS:
        try:
            names = os.listdir(d)
        except OSError:
            continue
        for f in names:
            if f.endswith(ext) and not f.startswith("."):
                m.setdefault(f[:-len(ext)], {})[k] = 1
    _ART.update(sig=sig, map=m)
    return m


def stage_seats(agents):
    used = [tuple(a["seat"]) for a in agents.values() if isinstance(a.get("seat"), list)]
    free = [s for s in STAGE_SPARE if tuple(s) not in used]
    out = {}
    for a in sorted(agents.values(), key=lambda a: a.get("order", 99)):
        if "seat" not in a and a.get("enabled", True) and free:
            out[a["id"]] = free.pop(0)
    return out


# t-soul-widget: Codex quota for the Usage widget's Soul rows. Codex writes a rate_limits snapshot into its session log
# (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl) each time it runs; we read the newest one. Read only the file tail, cache by
# (path, mtime, size), rescan the folders at most once a minute, and return None on any problem (the row then says "not read").
_CODEX = {"scan": 0.0, "files": [], "sig": None, "val": None}
CODEX_SESS = os.path.expanduser("~/.codex/sessions")


def _codex_files():
    out = []
    try:
        for y in sorted((d for d in os.listdir(CODEX_SESS) if d.isdigit()), reverse=True):
            for m in sorted((d for d in os.listdir(os.path.join(CODEX_SESS, y)) if d.isdigit()), reverse=True):
                for d in sorted((d for d in os.listdir(os.path.join(CODEX_SESS, y, m)) if d.isdigit()), reverse=True):
                    p = os.path.join(CODEX_SESS, y, m, d)
                    fs = sorted((f for f in os.listdir(p) if f.startswith("rollout-") and f.endswith(".jsonl")), reverse=True)
                    out += [os.path.join(p, f) for f in fs]
                    if len(out) >= 12:
                        return out
    except OSError:
        pass
    return out


def _codex_tail(path):
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            n = f.tell()
            f.seek(max(0, n - 512 * 1024))
            lines = f.read().decode("utf-8", "replace").splitlines()
    except OSError:
        return None
    for ln in reversed(lines):
        if '"rate_limits"' not in ln:
            continue
        try:
            d = json.loads(ln)
        except ValueError:
            continue
        rl = (d.get("payload") or {}).get("rate_limits") if isinstance(d, dict) else None
        p = (rl or {}).get("primary") if isinstance(rl, dict) else None
        if not isinstance(p, dict) or p.get("used_percent") is None:
            continue
        ra = p.get("resets_at")
        return {"plan": rl.get("plan_type") or "", "used": round(float(p["used_percent"]), 1),
                "window_min": p.get("window_minutes"),
                "resets_at": dt.datetime.fromtimestamp(ra).astimezone().isoformat(timespec="seconds") if isinstance(ra, (int, float)) else None,
                "at": d.get("timestamp") or dt.datetime.fromtimestamp(os.path.getmtime(path)).astimezone().isoformat(timespec="seconds")}
    return None


def codex_quota():
    try:
        now = time.time()
        if now - _CODEX["scan"] > 60:
            _CODEX["scan"], _CODEX["files"] = now, _codex_files()
        fs = _CODEX["files"]
        sig = tuple((f, os.path.getmtime(f), os.path.getsize(f)) for f in fs[:1] if os.path.exists(f)) + (len(fs),)
        if sig == _CODEX["sig"]:
            return _CODEX["val"]
        val = None
        for f in fs:
            val = _codex_tail(f)
            if val:
                break
        _CODEX["sig"], _CODEX["val"] = sig, val
        return val
    except Exception as e:   # never take /api/state down over a quota line
        print("codex_quota:", e, flush=True)
        return None


def public_state_cached(slim):
    k = (_fsig(S.STATE), _fsig(S.INBOX), _fsig(AVATARS), _fsig(S.ARCHIVE), art_sig(), json.dumps(_comfy, sort_keys=True), json.dumps(codex_quota()), dt.datetime.now().strftime("%Y-%m-%d %H:%M"))
    with _PSL:
        c = _PSC.get(slim)
        if c and c[0] == k:
            return c
        raw = json.dumps(public_state(slim), ensure_ascii=False).encode()
        c = _PSC[slim] = (k, raw, gzip.compress(raw, 5))
        return c


def public_state(slim=False):
    st = S.read()
    st["meta"].pop("inbox_acked", None)
    st["meta"]["comfy"] = _comfy
    st["meta"]["codex"] = codex_quota()   # t-soul-widget
    st["meta"]["owner"] = (CONFIG.get("owner") or {}).get("display_name", "")
    st["meta"]["avatars"] = {f.rsplit(".", 1)[0]: f for f in sorted(os.listdir(AVATARS))
                             if f.lower().endswith((".png", ".jpg", ".jpeg", ".webp", ".gif"))}
    st["meta"]["inbox_unacked"] = rev_unacked()[1]
    st["meta"]["art"] = art_scan()
    st["meta"]["seats"] = stage_seats(st.get("agents") or {})
    a, live = archive_cached(), {i.get("id") for i in st.get("items", [])}
    ix = [[i.get("id"), i.get("title", ""), i.get("owner", ""), str(i.get("closed") or i.get("updated") or "")[:10]] for i in a["items"] if i.get("id") not in live]
    st["meta"]["archive"] = {"n": len(ix), "v": (a["sig"] or [0, 0])[1], "ix": ix}   # t-perf A: id chips, title search, deep links know archived cards
    st["meta"]["server_time"] = S.now()
    st["meta"]["routines"] = routines_view(st["meta"], items=st.get("items"), scheds=st.get("schedules"))
    st["schedules"] = [x for x in st.get("schedules") or [] if not x.get("deleted")]   # t-schedule-backend: removed ones stay 30 days for undo, not shown
    st["meta"]["report_time"] = str(CONFIG.get("report_time", "18:00"))   # ri1103-P1: the 日报 row of 今日日程
    st["meta"]["media_v"] = 1   # t-voice-memo: this server transcribes (the page hides 转写/重试 on older servers)
    trim_state(st)
    ho = st.pop("handoffs", None) or []   # t-rb-build: the log is fetched from /api/handoffs; a poll carries only where it ends
    st.pop("ho_last", None)
    st["meta"]["ho"] = {"n": len(ho), "last": ho[-1]["id"] if ho else "", "t": ho[-1]["t"] if ho else "", "start": st["meta"].pop("ho_start", "")}
    return slim_state(st) if slim else st


# ---------- t-rb-build: /api/handoffs ----------
# GET /api/handoffs?since=<iso>[&until=<iso>] -> {list: [{id, t, f, to, item, title, via, inf?}], start, now}. Logged entries
# (state.handoffs) come first-hand; the stretch before meta.ho_start (when the log began) is inferred from card threads with
# ho.py's rule (a change of speaker between two roles on one card = one handoff, the same pair on the same card once) and
# marked inf=1. Inference is cached on the state file signature.
_HOI = {"k": None, "v": []}


def _pt(x):
    try:
        d = dt.datetime.fromisoformat(str(x).replace("Z", "+00:00"))
        return d if d.tzinfo else d.astimezone()
    except (TypeError, ValueError):
        return None


def _ho_infer(st):
    k = _fsig(S.STATE)
    if _HOI["k"] == k:
        return _HOI["v"]
    ids, ev = set(st.get("agents") or {}), []
    ids.discard("me")
    for it in st.get("items") or []:
        prev, seen = None, set()
        for m in it.get("thread") or []:
            w, t = m.get("who"), m.get("t")
            if w not in ids or not t:
                continue
            if prev and prev != w and (prev, w) not in seen:
                seen.add((prev, w))
                ev.append({"id": "i" + uuid.uuid5(uuid.NAMESPACE_URL, f"{it['id']}|{prev}|{w}").hex[:7], "t": t, "f": prev, "to": w,
                           "item": it["id"], "title": str(it.get("title", ""))[:120], "via": "dispatch" if prev == "manager" else "reply", "inf": 1})
            prev = w
    ev.sort(key=lambda e: _pt(e["t"]) or dt.datetime.min.replace(tzinfo=dt.timezone.utc))
    _HOI.update(k=k, v=ev)
    return ev


def handoffs(q):
    st = S.read()
    nowt = dt.datetime.now().astimezone()
    since = _pt(q.get("since", [""])[0]) or (nowt - dt.timedelta(hours=24))
    until = _pt(q.get("until", [""])[0])
    log, start = st.get("handoffs") or [], _pt(st["meta"].get("ho_start"))
    ok = lambda d: d is not None and d > since and (until is None or d <= until)
    out = [e for e in _ho_infer(st) if ok(_pt(e["t"])) and (start is None or _pt(e["t"]) < start)]
    out += [e for e in log if ok(_pt(e["t"]))]
    return {"list": out[-1000:], "start": st["meta"].get("ho_start", ""), "now": S.now()}


# ri1105-P4: a poll carries the newest CHAT_KEEP manager-chat messages, the newest MAIL_KEEP letters plus every unread one, and no logs.
# meta.trim says what was left out: chat = [index of the first message sent, total], mail = [total, sent]. The page asks /api/history
# for the rest (加载更早 past the window, the log tab, older letters under a filter, ⌘K over old chat). meta.mail_unread = the true count.
CHAT_KEEP, MAIL_KEEP = 200, 300


def trim_state(st):
    chat, mail = st.get("chat") or [], st.get("mail") or []
    base = max(0, len(chat) - CHAT_KEEP)
    st["chat"] = chat[base:]
    cut = max(0, len(mail) - MAIL_KEEP)
    st["mail"] = [m for i, m in enumerate(mail) if i >= cut or not m.get("read")]
    st["meta"]["mail_unread"] = sum(1 for m in mail if not m.get("read"))
    st["meta"]["trim"] = {"chat": [base, len(chat)], "mail": [len(mail), len(st["mail"])], "logs": len(st.get("logs") or [])}
    st.pop("logs", None)
    return st


def history(q):
    """ri1105-P4 /api/history?k=chat&end=<index>&n=<count> | k=mail (letters a poll leaves out) | k=logs[&agent=<id>]"""
    st, k = S.read(), q.get("k", [""])[0]
    if k == "chat":
        chat = st.get("chat") or []
        end = min(len(chat), max(0, int(q.get("end", [len(chat)])[0] or 0)))
        n = max(1, min(int(q.get("n", ["200"])[0] or 200), len(chat) or 1))
        start = max(0, end - n)
        return {"k": "chat", "start": start, "list": chat[start:end], "total": len(chat)}
    if k == "mail":
        mail = st.get("mail") or []
        cut = max(0, len(mail) - MAIL_KEEP)
        return {"k": "mail", "list": [m for m in mail[:cut] if m.get("read")], "total": len(mail)}
    if k == "logs":
        logs, ag = st.get("logs") or [], q.get("agent", [""])[0]
        return {"k": "logs", "list": [l for l in logs if not ag or l.get("agent") == ag][-400:], "total": len(logs), "rev": st["meta"].get("rev")}
    raise ValueError("k must be chat, mail or logs")


def _unacked_count():
    acked = set(S.read()["meta"]["inbox_acked"])
    return sum(1 for e in S.inbox_all() if e["id"] not in acked)


GZ_MIN = 2048
KEEPALIVE_IDLE = 15   # ri1105-P2: idle seconds a kept-alive connection may wait for its next request
_GZC, _GZL, _SV = {}, threading.Lock(), {}   # ri1105-P2: static gzip cache (path -> etag, raw, gz); (path, ?v=) -> file version seen


def _gz_type(ctype):
    c = (ctype or "").split(";")[0].strip()
    return c.startswith("text/") or c in ("application/json", "application/javascript", "application/manifest+json", "image/svg+xml")


# t-csrf-live (OSS audit SM-01/02): who may talk to this server.
# 1) Host allowlist on every request, against DNS rebinding: a page on attacker.example that re-resolves to 127.0.0.1 sends
#    Host: attacker.example and gets 421. Allowed: loopback names, this machine's hostname / .local name / LAN and tailnet IPs,
#    any *.ts.net name (the phone comes in through Tailscale Serve), plus config.allowed_hosts. A missing Host is let through.
# 2) Browser guard on every POST, against cross-site requests: a request that carries Origin or Sec-Fetch-Site comes from a
#    browser and must be same-origin AND carry X-Underthread: 1 (a custom header forces a CORS preflight, which this server never
#    grants). Scripts, curl and the iPhone Shortcut send neither header and are not affected.
_HOSTS = {"at": 0.0, "names": set()}


def local_names():
    if time.time() - _HOSTS["at"] < 60:
        return _HOSTS["names"]
    names = {"127.0.0.1", "localhost", "::1"}
    try:
        hn = socket.gethostname().lower().rstrip(".")
        short = hn.split(".")[0]
        names |= {hn, short, short + ".local"}
        for info in socket.getaddrinfo(hn, None):
            names.add(str(info[4][0]).lower())
    except OSError:
        pass
    try:   # the LAN address of the default route; connect() on UDP sends nothing
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("192.0.2.1", 9))
            names.add(s.getsockname()[0])
        finally:
            s.close()
    except OSError:
        pass
    names |= {str(h).lower().rstrip(".") for h in (CONFIG.get("allowed_hosts") or [])}
    _HOSTS.update(at=time.time(), names=names)
    return names


def host_name(h):
    """'[::1]:8765' -> '::1', 'Mini.local:8765' -> 'mini.local', 'host' -> 'host'."""
    h = (h or "").strip().lower()
    if h.startswith("["):
        return h[1:h.find("]")] if "]" in h else h[1:]
    if h.count(":") == 1:
        h = h.split(":")[0]
    return h.rstrip(".")


def host_ok(h):
    if not (h or "").strip():
        return True
    n = host_name(h)
    return n in local_names() or n.endswith(".ts.net")


_GUARD_LOG = {"at": 0.0, "n": 0}


def guard_log(kind, h, path):
    """One line per refusal, at most 30 a minute, so a probe storm cannot fill server.log."""
    t = time.time()
    if t - _GUARD_LOG["at"] > 60:
        _GUARD_LOG.update(at=t, n=0)
    _GUARD_LOG["n"] += 1
    if _GUARD_LOG["n"] <= 30:
        print(f"[{S.now()}] guard: refused {kind} {h.command} {path[:120]} host={(h.headers.get('Host') or '')[:80]!r} "
              f"origin={(h.headers.get('Origin') or '')[:80]!r} site={h.headers.get('Sec-Fetch-Site') or ''}", flush=True)


class H(BaseHTTPRequestHandler):
    server_version = "Underthread/1"
    # ri1105-P2: HTTP/1.1 keep-alive. Every answer carries Content-Length (304 / HEAD carry no body). A connection may sit idle between
    # requests for KEEPALIVE_IDLE s, then it is closed (a phone that holds a socket does not pin a thread forever). Reading a request body
    # and writing an answer have no timeout, as before (big uploads / video). POSTs whose body was not read in full close the connection.
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        if os.environ.get("VERBOSE"):
            super().log_message(fmt, *args)

    def handle_one_request(self):
        self._sent = False
        self._body_ok = False
        try:
            self.connection.settimeout(KEEPALIVE_IDLE)
        except OSError:
            pass
        super().handle_one_request()

    def parse_request(self):
        ok = super().parse_request()
        try:
            self.connection.settimeout(None)
        except OSError:
            pass
        self._body_ok = False
        return ok

    def _keep(self):
        """False = close the connection after this answer (a POST body we did not read in full would be read as the next request)."""
        if self.command == "POST" and not self._body_ok:
            self.close_connection = True
            return False
        return True

    def _send(self, code, body, ctype="application/json; charset=utf-8", extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode()
        elif isinstance(body, str):
            body = body.encode()
        enc = None
        if (len(body) >= GZ_MIN and _gz_type(ctype) and "gzip" in (self.headers.get("Accept-Encoding") or "")
                and not self.path.startswith("/api/voice/") and not (extra or {}).get("Content-Encoding")):
            body, enc = gzip.compress(body, 5), "gzip"   # t-mobile-crash-state: /api/state 2.5 MB -> ~0.7 MB
        self._sent = True
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        if not (extra or {}).get("Cache-Control"):
            self.send_header("Cache-Control", "no-store")
        if enc:
            self.send_header("Content-Encoding", enc)
            self.send_header("Vary", "Accept-Encoding")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        if not self._keep():
            self.send_header("Connection", "close")
        self.end_headers()
        if self.command != "HEAD":   # ri1105-P2: on a kept-alive connection a HEAD body would be read as the next answer
            self.wfile.write(body)

    def _static(self, path, ctype, extra):
        """ri1105-P2: web/ files. A ?v= js / css / font never changes under the same URL (every edit bumps ?v=): cached for a year, immutable.
        Everything else (images, ?v= images too, files without ?v=): ETag + 304. index.html and sw.js stay no-store (their own routes).
        Gzip is done once per file version and kept in memory."""
        st = os.stat(path)
        etag = '"%x-%x"' % (st.st_mtime_ns // 1000, st.st_size)
        v = parse_qs(urlparse(self.path).query).get("v", [""])[0]
        imm = bool(v) and path.endswith((".js", ".css", ".woff2", ".woff"))
        if imm:
            k, sig = (path, v), (st.st_mtime_ns, st.st_size)
            old = _SV.setdefault(k, sig)
            if old != sig:   # the file changed but the URL did not: browsers that cached it keep the old copy
                print(f"[{S.now()}] static: {os.path.relpath(path, WEB)} changed under the same ?v={v} — bump ?v= in index.html", flush=True)
                _SV[k] = sig
        hdr = {"ETag": etag, "Cache-Control": "public, max-age=31536000, immutable" if imm else "no-cache"}
        hdr.update(extra or {})
        if self.headers.get("If-None-Match") == etag:
            self._sent = True
            self.send_response(304)
            for k2, v2 in hdr.items():
                self.send_header(k2, v2)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        gz = "gzip" in (self.headers.get("Accept-Encoding") or "") and _gz_type(ctype) and st.st_size >= GZ_MIN
        with _GZL:
            c = _GZC.get(path)
        if not c or c[0] != etag:
            with open(path, "rb") as f:
                raw = f.read()
            c = (etag, raw, gzip.compress(raw, 6) if _gz_type(ctype) and len(raw) >= GZ_MIN else None)
            with _GZL:
                _GZC[path] = c
        if gz and c[2] is not None:
            hdr.update({"Content-Encoding": "gzip", "Vary": "Accept-Encoding"})
            return self._send(200, c[2], ctype, hdr)
        return self._send(200, c[1], ctype, hdr)

    def _file(self, path, extra=None, media=False):
        """Serve a file. media=True (uploads/work/avatars): Range/206, ETag/304, streamed in 64KB chunks."""
        if not os.path.isfile(path):
            return self._send(404, {"error": "not found"})
        ctype = "application/manifest+json" if path.endswith(".webmanifest") else (mimetypes.guess_type(path)[0] or "application/octet-stream")
        if ctype.startswith("text/") or ctype in ("application/javascript",):
            ctype += "; charset=utf-8"
        if media == "static":
            return self._static(path, ctype, extra)
        if not media:
            with open(path, "rb") as f:
                return self._send(200, f.read(), ctype, extra)
        self._sent = True
        st = os.stat(path)
        size = st.st_size
        etag = '"%x-%x"' % (int(st.st_mtime), size)
        hdr = {"Accept-Ranges": "bytes", "ETag": etag, "Cache-Control": "private, max-age=0, must-revalidate"}
        hdr.update(extra or {})
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            for k, v in hdr.items():
                self.send_header(k, v)
            self.end_headers()
            return
        start, end, code = 0, size - 1, 200
        rng = self.headers.get("Range")
        if rng:
            m = re.fullmatch(r"\s*bytes=(\d*)-(\d*)\s*", rng)
            ok = bool(m) and (m.group(1) or m.group(2))
            if ok:
                if m.group(1) == "":  # suffix: last N bytes
                    n = int(m.group(2))
                    start, end = max(size - n, 0), size - 1
                else:
                    start = int(m.group(1))
                    end = min(int(m.group(2)), size - 1) if m.group(2) else size - 1
                ok = size > 0 and start < size and start <= end
            if not ok:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                return
            code = 206
            hdr["Content-Range"] = f"bytes {start}-{end}/{size}"
        length = end - start + 1 if size else 0
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        for k, v in hdr.items():
            self.send_header(k, v)
        self.end_headers()
        if self.command == "HEAD":
            return
        try:
            with open(path, "rb") as f:
                f.seek(start)
                left = length
                while left > 0:
                    chunk = f.read(min(65536, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            self.close_connection = True

    def _host_guard(self):
        """t-csrf-live: False (and a 421 already sent) when the Host header is not one of ours."""
        if host_ok(self.headers.get("Host")):
            return True
        guard_log("host", self, self.path)
        self._send(421, {"error": "unknown host"})
        return False

    def _browser_ok(self):
        """t-csrf-live: a POST from a browser must be same-origin and carry X-Underthread: 1; non-browser callers pass."""
        o, site = self.headers.get("Origin"), (self.headers.get("Sec-Fetch-Site") or "").lower()
        if o is None and not site:
            return True
        if site == "cross-site":
            return False
        if o is not None:
            net = urlparse(o).netloc if o != "null" else ""
            if not net or not (net == (self.headers.get("Host") or "") or net == self.headers.get("X-Forwarded-Host") or host_ok(net)):
                return False
        return self.headers.get("X-Underthread") == "1"

    def do_HEAD(self):
        self.do_GET()

    def _thumb(self, rel, w):
        """JPEG thumbnail of an image/video under uploads/ or work/, cached in work/.thumbs/ (originals untouched)."""
        import hashlib
        import subprocess
        rel = rel.lstrip("/")
        base = UPLOADS if rel.startswith("uploads/") else os.path.join(ROOT, "work") if rel.startswith("work/") else None
        if base is None:
            return self._send(403, {"error": "forbidden"})
        src = self._safe(base, rel.split("/", 1)[1])
        if not src or not os.path.isfile(src) or "/.thumbs/" in src:
            return self._send(404, {"error": "not found"})
        w = max(64, min(w, 1200))
        st = os.stat(src)
        key = hashlib.sha1(f"{rel}|{st.st_mtime_ns}|{st.st_size}|{w}".encode()).hexdigest()[:24]
        tdir = os.path.join(ROOT, "work", ".thumbs")
        os.makedirs(tdir, exist_ok=True)
        out = os.path.join(tdir, key + ".jpg")
        if not os.path.isfile(out):
            tmp = out + f".{os.getpid()}.{threading.get_ident()}.tmp.jpg"
            try:
                if re.search(r"\.(mp4|mov|m4v|webm)$", src, re.I):
                    cmd = ["ffmpeg", "-v", "error", "-y", "-ss", "0.1", "-i", src, "-frames:v", "1",
                           "-vf", f"scale='min({w},iw)':-2", "-q:v", "4", tmp]
                else:
                    cmd = ["sips", "-s", "format", "jpeg", "-s", "formatOptions", "70", "-Z", str(w), src, "--out", tmp]
                env = dict(os.environ, PATH="/opt/homebrew/bin:/usr/local/bin:" + os.environ.get("PATH", ""))
                subprocess.run(cmd, check=True, capture_output=True, timeout=30, env=env)
                os.replace(tmp, out)
            except Exception:
                try:
                    os.remove(tmp)
                except OSError:
                    pass
                return self._send(415, {"error": "no thumbnail"})
        return self._file(out, media=True)

    def _safe(self, base, rel):
        p = os.path.realpath(os.path.join(base, rel))
        return p if p.startswith(os.path.realpath(base) + os.sep) else None

    def do_GET(self):
        if not self._host_guard():
            return
        u = urlparse(self.path)
        q = parse_qs(u.query)
        try:
            if u.path == "/sw.js":
                return self._file(os.path.join(WEB, "sw.js"), {"Service-Worker-Allowed": "/"})
            if u.path == "/manifest.webmanifest":
                return self._file(os.path.join(WEB, "manifest.webmanifest"))
            if u.path == "/api/push/key":
                return self._send(200, {"key": WP.keys()[1]})
            if u.path == "/api/push/latest":
                pq, ep = _push["queue"], q.get("endpoint", [""])[0]   # t-imp29-p1: sw v5 sends its endpoint; older sw gets the global latest
                mine = _push["dev"].get(ep) if ep else None
                lang = _row_lang(next((x for x in _subs() if x["sub"].get("endpoint") == ep), None)) if ep else "zh"   # t-i18n-b
                n = dict(mine) if mine else dict(pq[-1]) if pq else {"title": "Underthread", "body": "New activity" if lang == "en" else "有新动态", "url": "/", "tag": "underthread"}
                n.setdefault("lang", lang)
                try:
                    n["badge"] = pending_count(S.read())   # t-app-badge: counted when the device asks, so it is current
                except Exception as e:
                    print("push/latest badge:", e)
                return self._send(200, n)
            if u.path == "/api/push/status":
                return self._send(200, push_status(q.get("endpoint", [""])[0]))
            if u.path == "/api/push/history":   # t-imp29-p1: the 24h chart in 设置 → 推送通知
                return self._send(200, push_history(q.get("endpoint", [""])[0]))
            if u.path in ("/", "/index.html"):
                return self._file(os.path.join(WEB, "index.html"))
            if u.path == "/api/state":   # t-perf B: cached rev / body (see public_state_cached)
                sync_roster()   # t-hr-registry: mtime check only; a roster edit shows up even when the watch loop is off (NO_LOOPS) or stuck
                rev, un = rev_unacked()
                # ri1105-P5: ?wait=N (<= 25) holds a "same" answer until rev or the inbox count moves, checked every 0.1 s (stat calls only:
                # rev_unacked re-reads only when state.json / inbox.jsonl changed). The cached body moves every minute; rev does not.
                try:
                    wait = min(25.0, max(0.0, float(q.get("wait", ["0"])[0] or 0)))
                except ValueError:
                    wait = 0.0
                if wait and q.get("rev", [""])[0] == str(rev):
                    t_end = time.monotonic() + wait
                    while time.monotonic() < t_end:
                        time.sleep(0.1)
                        r2, u2 = rev_unacked()
                        if (r2, u2) != (rev, un):
                            rev, un = r2, u2
                            break
                if q.get("rev", [""])[0] == str(rev):
                    return self._send(200, {"same": True, "meta": {"comfy": _comfy, "server_time": S.now(), "inbox_unacked": un}})
                _, raw, gzb = public_state_cached(q.get("slim", [""])[0] == "1")
                if "gzip" in (self.headers.get("Accept-Encoding") or ""):
                    return self._send(200, gzb, extra={"Content-Encoding": "gzip", "Vary": "Accept-Encoding"})
                return self._send(200, raw)
            if u.path == "/api/archive":   # t-perf A
                if "gzip" in (self.headers.get("Accept-Encoding") or ""):
                    return self._send(200, archive_body(True), extra={"Content-Encoding": "gzip", "Vary": "Accept-Encoding"})
                return self._send(200, archive_body(False))
            if u.path == "/api/history":   # ri1105-P4: what a poll leaves out (chat before the window, older letters, logs)
                return self._send(200, history(q))
            if u.path == "/api/handoffs":   # t-rb-build
                return self._send(200, handoffs(q))
            if u.path == "/api/item":   # t-mobile-crash-state: the full card (draft + versions) for a slim one
                it = public_item(q.get("id", [""])[0])
                return self._send(200, it) if it else self._send(404, {"error": "no such item"})
            if u.path == "/api/secret/github":   # t-dash-token: status only, never the token
                if not GH:
                    return self._send(503, {"error": "ghcred not loaded"})
                try:
                    return self._send(200, GH.status())
                except Exception:  # noqa: BLE001
                    return self._send(500, {"error": "读状态失败"})
            if u.path == "/api/health":
                return self._send(200, health())
            if u.path == "/api/usage":   # t-home-usage: per-role tokens today from the local transcripts (usage_roll.py, 60 s cache)
                if not USAGE:
                    return self._send(503, {"error": "usage_roll not loaded"})
                d = q.get("day", [""])[0]
                return self._send(200, USAGE.report(d if re.fullmatch(r"\d{4}-\d{2}-\d{2}", d or "") else None))
            if u.path == "/api/docs":
                return self._send(200, list_docs())
            if u.path == "/api/doc":
                return self._send(200, {"path": q["path"][0], "text": read_doc(q["path"][0])})
            if u.path == "/api/memory":
                try:
                    return self._send(200, role_memory(q.get("id", [None])[0]))
                except ValueError as ex:
                    return self._send(404, {"error": str(ex)})
            if u.path == "/api/templates":   # t-hm-build
                return self._send(200, templates_payload())
            if u.path == "/api/retire-plan":   # t-ht-build
                return self._send(200, retire_plan(q.get("id", [""])[0]))
            if u.path == "/api/transfer-plan":   # t-ht-build
                return self._send(200, transfer_plan(q.get("item", [""])[0]))
            if u.path == "/api/tpl-av":   # t-hm-build
                p = tpl_avatar(q.get("job", [""])[0], q.get("v", [""])[0])
                return self._file(p, media=True) if p else self._send(404, {"error": "not found"})
            if u.path == "/api/roster":
                return self._send(200, load_json("roster.json", {"roles": []}))
            if u.path.startswith("/api/voice/") and VC:   # t-vb-2
                r = VC.handle_get(u.path, q)
                if r:
                    return self._send(*r)
            if u.path == "/api/thumb":
                try:
                    tw = int(q.get("w", ["360"])[0])
                except ValueError:
                    tw = 360
                return self._thumb(q.get("p", [""])[0], tw)
            for prefix, base in (("/static/", WEB), ("/uploads/", UPLOADS), ("/avatars/", AVATARS),
                                 ("/work/", os.path.join(ROOT, "work"))):
                if u.path.startswith(prefix):
                    p = self._safe(base, unquote(u.path[len(prefix):]))   # t-voice-memo: %-encoded names (新录音_12.m4a) 404ed before
                    if not p:
                        return self._send(403, {"error": "forbidden"})
                    return self._file(p, media="static" if prefix == "/static/" else True)
            self._send(404, {"error": "not found"})
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            self.close_connection = True
        except Exception as e:
            if self._sent:   # ri1105-P2: an answer is already on the wire; a second one would corrupt the kept-alive stream
                self.close_connection = True
                print("GET after send:", u.path, repr(e))
                return
            self._send(400, {"error": str(e)})

    def _gh_post(self, n):
        """t-dash-token. The body may hold the token: it is never logged, echoed, stored in state/inbox or put in an error."""
        try:
            raw = self.rfile.read(n) if 0 < n <= 4096 else b""
            ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            origin = self.headers.get("Origin")
            host = self.headers.get("Host") or ""
            if self.headers.get("X-Underthread") != "1" or ctype != "application/json":
                return self._send(403, {"ok": False, "error": "forbidden"})
            oh = urlparse(origin).hostname or "" if origin else ""
            if origin and urlparse(origin).netloc not in (host, self.headers.get("X-Forwarded-Host") or host) \
                    and oh not in ("127.0.0.1", "localhost") and not oh.endswith(".ts.net"):   # page itself, or the phone through Tailscale Serve
                return self._send(403, {"ok": False, "error": "forbidden"})
            if not GH:
                return self._send(503, {"ok": False, "error": "ghcred not loaded"})
            try:
                body = json.loads(raw or b"{}")
            except ValueError:
                body = None
            raw = None
            if not isinstance(body, dict):
                return self._send(400, {"ok": False, "error": "bad request"})
            op = body.get("op")
            if op == "set":
                r = GH.set_token(body.get("token"))
            elif op == "probe":
                r = {"ok": True, "probe": GH.probe(), "status": GH.status()}
            elif op == "test":
                r = GH.test()
            elif op == "erase":
                r = GH.erase()
            elif op == "use_file":
                r = GH.use_file() if body.get("confirm") is True else {"ok": False, "error": "需要确认"}
            elif op == "use_keychain":
                r = GH.use_keychain()
            else:
                r = {"ok": False, "error": "unknown op"}
            body = None
            return self._send(200 if r.get("ok") else 400, r)
        except Exception:  # noqa: BLE001
            return self._send(500, {"ok": False, "error": "出错了（细节不显示，避免带出令牌）"})

    def do_POST(self):
        if not self._host_guard():
            return
        u = urlparse(self.path)
        if not self._browser_ok():   # t-csrf-live: before the body is read; _keep() then closes the connection
            guard_log("origin", self, u.path)
            return self._send(403, {"error": "forbidden"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if u.path == "/api/memo":   # t-share-memo: one request from the iPhone Shortcut, plain-text answer for its notification
                try:
                    code, msg = memo_post(self.rfile, n, parse_qs(u.query))
                except Exception as e:  # noqa: BLE001
                    code, msg = 400, f"发送失败：{e}"
                return self._send(code, msg, ctype="text/plain; charset=utf-8")
            if u.path == "/api/upload/raw":  # raw bytes, streamed straight to disk
                name = parse_qs(u.query).get("name", ["file"])[0]
                res = save_upload_stream(self.rfile, n, name)
                transcribe_async(res["path"])
                return self._send(200, res)
            if u.path.startswith("/api/voice/") and VC:   # t-vb-2: the clip upload is a raw body, the rest JSON
                r = VC.handle_post(u.path, parse_qs(u.query), self.rfile, n, self.headers)
                if r:
                    return self._send(*r)
                return self._send(404, {"error": "not found"})
            if u.path == "/api/secret/github":   # t-dash-token: own body read + own error handling (the generic one echoes repr(e))
                return self._gh_post(n)
            body = json.loads(self.rfile.read(n) or b"{}")
            self._body_ok = True   # ri1105-P2: the whole body is read, this connection can stay open
            if u.path == "/api/action":
                return self._send(200, act(body))
            if u.path == "/api/hire":   # t-hm-build: own header (like /api/secret/github) so a stray cross-site form cannot hire
                if self.headers.get("X-Underthread") != "1":
                    return self._send(403, {"ok": False, "error": "forbidden"})
                return self._send(200, hire(body))
            if u.path == "/api/interview":   # t-hr-build: same header guard as /api/hire
                if self.headers.get("X-Underthread") != "1":
                    return self._send(403, {"ok": False, "error": "forbidden"})
                return self._send(200, interview(body))
            if u.path == "/api/push/subscribe":
                sub = body["subscription"]
                origin = body.get("origin") or ""
                subject = origin if origin.startswith("https://") else "mailto:underthread@example.com"
                if not str(sub.get("endpoint", "")).startswith("https://"):
                    raise ValueError("subscription has no https endpoint")
                ua = body.get("ua", "")[:160]
                with _push["lock"]:
                    allsubs = _subs()
                    old = [x for x in allsubs if x["sub"]["endpoint"] == sub["endpoint"]]
                    # t-imp29-p1: one row per device. Re-adding the home-screen app gives a new endpoint while the old one still
                    # answers 201, so the phone buzzed once per row. Same user agent = same device: keep only this (newest) row.
                    dupes = [x for x in allsubs if x["sub"]["endpoint"] != sub["endpoint"] and ua and x.get("ua") == ua]
                    subs = [x for x in allsubs if x["sub"]["endpoint"] != sub["endpoint"] and x not in dupes]
                    row = {"sub": sub, "subject": subject, "ua": ua, "at": S.now()}
                    if body.get("lang") in ("zh", "en"):   # t-i18n-b
                        row["lang"] = body["lang"]
                    src = old[0] if old else (sorted(dupes, key=lambda x: x.get("at") or "")[-1] if dupes else None)
                    if src:  # same device re-sent on app open (or re-added): keep its settings, held entries and last send result
                        row.update({k: src[k] for k in ("last_code", "last_at", "prefs", "held") if k in src})
                        if "lang" not in row and src.get("lang"):
                            row["lang"] = src["lang"]
                    subs.append(row)
                    _save_subs(subs)
                for x in dupes:
                    _plog(f"dedupe {_ep_short(x['sub']['endpoint'])} (same device as {_ep_short(sub['endpoint'])}, added {x.get('at')})")
                _plog(f"{'refresh' if old else 'subscribe'} {_ep_short(sub['endpoint'])} · {len(subs)} device(s)")
                return self._send(200, {"ok": True, "devices": len(subs), "mine": True})
            if u.path == "/api/push/prefs":   # t-imp29-p1: tier / quiet hours / digest for one device
                ep, inc = body.get("endpoint") or "", body.get("prefs") or {}

                def setp(row):
                    p = push_prefs(row)
                    p.update({k: inc[k] for k in PUSH_DEFAULT if k in inc})
                    row["prefs"] = push_prefs({"prefs": p})
                    if body.get("lang") in ("zh", "en"):   # t-i18n-b: push.js sends the UI language on a switch
                        row["lang"] = body["lang"]
                row = _row_update(ep, setp)
                if row is None:
                    _plog(f"prefs {_ep_short(ep)} -> unknown device")
                    return self._send(404, {"error": "这台设备还没在服务器登记推送"})
                _plog(f"prefs {_ep_short(ep)} -> {json.dumps(row['prefs'], ensure_ascii=False)} lang={_row_lang(row)}")
                return self._send(200, {"ok": True, "prefs": row["prefs"]})
            if u.path == "/api/push/unsubscribe":
                subs = [x for x in _subs() if x["sub"]["endpoint"] != body.get("endpoint")]
                _save_subs(subs)
                _plog(f"unsubscribe {_ep_short(body.get('endpoint'))} · {len(subs)} device(s)")
                return self._send(200, {"ok": True, "devices": len(subs)})
            if u.path == "/api/push/log":  # the phone reports each step of turning push on
                keys = ("step", "perm", "standalone", "secure", "has_sub", "server_has_me", "result", "name", "message", "endpoint_host", "ios")
                parts = [f"{k}={str(body[k])[:120]}" for k in keys if k in body]
                _plog("client " + " ".join(parts))
                return self._send(200, {"ok": True})
            if u.path == "/api/push/test":
                return self._send(200, notify({"title": "Underthread", "body": body.get("text") or "推送已接通。新的待审核和回复会出现在这里。", "url": "/"},
                                              en=None if body.get("text") else {"body": "Push is on. New reviews and replies will show up here."}))
            if u.path == "/api/upload":
                res = save_upload(body)
                transcribe_async(res["path"])
                return self._send(200, res)
            if u.path == "/api/transcribe":   # t-voice-memo: 重试 / 转写 an older memo
                rel = body.get("path") or ""
                full = os.path.realpath(os.path.join(ROOT, rel))
                if not (rel.startswith(("uploads/", "work/")) and full.startswith(ROOT + os.sep) and os.path.isfile(full) and S.is_audio_path(rel)):
                    return self._send(400, {"error": "not an audio attachment"})
                return self._send(200, {"ok": transcribe_async(rel, force=True)})
            self._send(404, {"error": "not found"})
        except OpenAsks as e:   # t-open-questions: the page shows its 还有问题没回答 sheet
            self._send(409, {"error": str(e), "open_asks": e.asks})
        except (ValueError, KeyError, SystemExit) as e:
            self._send(400, {"error": str(e)})
        except Exception as e:
            self._send(500, {"error": repr(e)})


def main():
    global CONFIG
    ensure_live_files()
    CONFIG = load_json("config.json", {})
    sync_roster()
    try:
        routines_log_backfill()   # t-ri1104-p3
    except Exception as e:
        print("routines_log_backfill:", e)
    try:
        schedules_import()   # t-schedule-backend: also with NO_LOOPS, so a scratch copy shows the imported routines
    except Exception as e:
        print("schedules_import:", e)
    port = int(os.environ.get("PORT") or CONFIG.get("port") or 8765)
    if not os.environ.get("NO_LOOPS"):
        for fn in (comfy_probe_loop, report_loop, roster_watch_loop, push_loop, wake_loop, schedule_loop, snooze_loop):
            threading.Thread(target=fn, daemon=True).start()
    srv = QuietServer(("127.0.0.1", port), H)
    print(f"Underthread → http://127.0.0.1:{port}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


class QuietServer(ThreadingHTTPServer):
    """t-ri1106-b (r-improve-1106 P2): a phone or browser dropping an idle keep-alive connection raised BrokenPipe / ConnectionReset /
    ConnectionAborted inside socketserver, which printed a ~30-line traceback each time (45% of logs/server.log on 11-06).
    Those are now only counted, and one line per hour sums them up: "[time] conn: N client disconnects in the last hour".
    Every other exception still goes to the stock handle_error (full traceback ending in "XxxError: ...")."""
    QUIET = (BrokenPipeError, ConnectionResetError, ConnectionAbortedError)

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._qlock = threading.Lock()
        self._qn = 0
        self._qt = time.time()

    def handle_error(self, request, client_address):
        e = sys.exc_info()[1]
        if not isinstance(e, self.QUIET):
            return super().handle_error(request, client_address)
        with self._qlock:
            self._qn += 1
            now = time.time()
            if now - self._qt < 3600:
                return
            n, self._qn, self._qt = self._qn, 0, now
        print(f"[{dt.datetime.now():%Y-%m-%d %H:%M:%S}] conn: {n} client disconnects in the last hour", flush=True)


if __name__ == "__main__":
    main()
