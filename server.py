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
    keys = ("name", "name_en", "title", "title_en", "duty", "duty_en", "color", "room", "agent_name", "order", "look", "voice")
    with S.mutate() as st:
        for i, r in enumerate(roster.get("roles", [])):
            a = st["agents"].setdefault(r["id"], {"id": r["id"], "status": "idle"})
            for k in keys:
                if k in r:
                    a[k] = r[k]
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


def routines_fire(nowt=None):
    """t-routine-trigger: queue one {kind: routine_due} inbox entry per config.routines entry per day.
    meta.routines_fired[id] = last date fired, so restarts never fire twice; a missed time (server down)
    fires on the next check. A routine first seen AFTER its time today is only recorded (fires from
    tomorrow), so adding one mid-day doesn't start an unplanned run; first seen before its time, it
    fires today as normal. Returns the fired ids."""
    nowt = nowt or dt.datetime.now()
    today, hm = nowt.date().isoformat(), nowt.strftime("%H:%M")
    meta = S.read()["meta"]
    paused = meta.get("routines_paused") or {}   # t-routine-close: 停止常驻任务 from the card; config.json stays the schedule
    rs = [r for r in (CONFIG.get("routines") or []) if isinstance(r, dict) and r.get("id")
          and r.get("enabled", True) is not False and r["id"] not in paused]
    is_due = lambda r: hm >= str(r.get("time", "10:00"))
    fired_map = meta.get("routines_fired") or {}
    if not any(r["id"] not in fired_map or (is_due(r) and fired_map[r["id"]] != today) for r in rs):
        return []   # nothing to do: skip the write so meta.rev doesn't bump every minute
    fired = []
    with S.mutate() as st:
        done = st["meta"].setdefault("routines_fired", {})
        for r in rs:
            rid = r["id"]
            if rid not in done:
                done[rid] = today if is_due(r) else ""
                if is_due(r):
                    print(f"routines: {rid} first seen after {r.get('time')} today; recorded, fires from tomorrow")
                continue
            if not is_due(r) or done.get(rid) == today:
                continue
            done[rid] = today
            # append inside the state lock: if the append fails, the mark isn't saved either
            S.inbox_append({"kind": "routine_due", "routine": rid, "label": r.get("label", ""),
                            "time": r.get("time", "10:00"), "date": today})
            fired.append(rid)
            print(f"routines: queued routine_due {rid} for {today}")
    return fired


def routine_item(r):
    """The card a routine belongs to: config "item", else "r-" + id (smith-improve -> r-smith-improve)."""
    return r.get("item") or "r-" + r["id"]


def routines_view(meta, nowt=None):
    """t-routine-close: schedule + paused + next run for the dashboard (read-only; computed, never stored)."""
    nowt = nowt or dt.datetime.now()
    today, hm = nowt.date().isoformat(), nowt.strftime("%H:%M")
    paused, fired = meta.get("routines_paused") or {}, meta.get("routines_fired") or {}
    out = []
    for r in CONFIG.get("routines") or []:
        if not isinstance(r, dict) or not r.get("id"):
            continue
        rid, tm = r["id"], str(r.get("time", "10:00"))
        p = paused.get(rid)
        if p or r.get("enabled", True) is False:
            nxt = None
        else:
            day = nowt.date()
            if fired.get(rid) == today or (hm >= tm and rid not in fired):
                day += dt.timedelta(days=1)
            nxt = dt.datetime.combine(day, dt.time(*map(int, tm.split(":")))).astimezone().isoformat(timespec="seconds")
        out.append({"id": rid, "item": routine_item(r), "time": tm, "label": r.get("label", ""),
                    "paused": (p or {}).get("at") if isinstance(p, dict) else p, "disabled": r.get("enabled", True) is False,
                    "last": fired.get(rid) or None, "next": nxt})
    return out


def routine_loop():
    while True:
        try:
            routines_fire()
        except Exception as e:  # keep the loop alive
            print("routine_loop:", e)
        time.sleep(60)


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
    return sum(1 for i in st.get("items", []) if not i.get("archived")
               and (i.get("stage") == "review" or (i.get("stage") == "waiting" and i.get("kind") in ("plan", "question"))))


def notify(n, only=None):
    """Queue a notification and wake the subscribed devices (all, or only those whose endpoint is in `only`).
    The device fetches the text from /api/push/latest?endpoint=… (t-imp29-p1: per device, since tiers make devices differ)."""
    n = dict(n, id=n.get("id") or uuid.uuid4().hex[:10], t=S.now())
    n.setdefault("tag", n["id"])
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
            _push["dev"][ep] = n
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
    if text.startswith(("待审核", "新规则提议")):
        return "decide", urgent
    if m.get("kind") == "reply":
        return "reply", urgent
    return "other", urgent


def tier_allows(tier, cls):
    return tier == "all" or cls == "decide" or (tier == "reply" and cls == "reply")


def in_quiet(p, now=None):
    if not p["quiet"] or p["from"] == p["to"]:
        return False
    h = (now or dt.datetime.now()).hour
    return (p["from"] <= h < p["to"]) if p["from"] < p["to"] else (h >= p["from"] or h < p["to"])


def digest_payload(st, held):
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
    head = (f"夜里 {len(items)} 张卡有进展" if items else f"夜里 {len(held)} 条新消息") + (f" · {wait} 件等你拍板" if wait else "")
    titles = [byid[i]["title"] for i in items if i in byid][:3]
    body = " · ".join(t[:18] for t in titles) or held[-1]["text"][:60]
    if loose and items:
        body += f"（另有 {loose} 条消息）"
    nid = uuid.uuid4().hex[:10]
    return {"id": nid, "title": head, "body": body, "url": f"/#page=mail&push={nid}", "digest": True}


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


def _agent_name(st, aid):
    a = (st.get("agents") or {}).get(aid) or {}
    return a.get("name") or aid or "Underthread"


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


def push_payload(st, new):
    """Build the notification for a batch of new mailbox entries. url = /#<target>&mail=<ids>&push=<id>; push= marks it as a push tap (the page routes once, marks those entries read and clears the hash)."""
    nid = uuid.uuid4().hex[:10]
    targets = [_mail_target(st, m) for m in new]
    one = len(set(targets)) == 1
    tail = (f"&mail={','.join(m['id'] for m in new[-20:])}" if one else "") + f"&push={nid}"
    url = "/#" + (targets[0] if one else "page=mail") + tail
    if len(new) == 1:
        m = new[0]
        review = m["text"].startswith("待审核")
        return {"id": nid, "title": "待你审核" if review else _agent_name(st, m.get("agent")),
                "body": m["text"].replace("待审核: ", "", 1) if review else m["text"], "url": url}
    who = []
    for m in new:
        n = _agent_name(st, m.get("agent"))
        if n not in who:
            who.append(n)
    return {"id": nid, "title": f"{len(new)} 条新动态", "body": "、".join(who[:4]) + " · " + new[-1]["text"][:60], "url": url}


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
    with _push["lock"]:
        subs = _subs()
        dirty = False
        for row in subs:
            ep, p = row["sub"].get("endpoint", ""), push_prefs(row)
            quiet = in_quiet(p, now)
            for m in new:
                cls, urgent = push_class(st, m)
                if not tier_allows(p["tier"], cls):
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
            n = digest_payload(st, [byid[i] for i in digests[ep]] + ms)
            _plog(f"digest {_ep_short(ep)} {len(digests[ep])} held + {len(ms)} new")
        elif ms:
            n = push_payload(st, ms)
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


def act(body):
    k = body.get("kind")
    me = "me"
    inbox = None
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
            st["chat"].append(S._chat_entry(me, body["text"], attachments=att))
            inbox = {"kind": "manager", "text": body["text"], "attachments": att}

        elif k == "dm":
            if body["agent"] == "manager":
                raise ValueError("use chat for the manager")
            st["dms"].setdefault(body["agent"], []).append(S._chat_entry(me, body["text"], attachments=att))
            inbox = {"kind": "dm", "agent": body["agent"], "text": body["text"], "attachments": att}

        elif k == "comment":
            to = body.get("to") or it["owner"]
            S.add_thread(it, me, body["text"], "msg", attachments=att, to=to)
            if it["stage"] in ("review", "done"):
                it["stage"] = "doing"
            inbox = {"kind": "comment", "item": it["id"], "to": to, "text": body["text"], "attachments": att}

        elif k == "approve":
            skipped, oa = _guard_asks(it, body)
            plan = it.get("kind") == "plan"
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
                     "to": a.get("by") or it["owner"], "changed": changed}

        elif k == "reopen":
            it["stage"] = "doing"
            it.pop("closed", None)
            S.add_thread(it, me, "重开 · reopened", "event")
            inbox = {"kind": "reopen", "item": it["id"]}

        elif k == "reassign":
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

        elif k == "stamina":
            st["meta"]["stamina"] = {"pct": int(body["pct"]), "note": body.get("note", "手动"), "at": S.now()}

        elif k == "ping":
            inbox = {"kind": "ping"}
            if body.get("note"):  # t-imp-p4: e.g. 「刷新用量」 from the 系统状态 panel
                inbox["note"] = str(body["note"])[:200]
        elif k == "report_request":
            inbox = {"kind": "report_request"}

        elif k in ("routine_pause", "routine_resume"):   # t-routine-close
            r = next((x for x in CONFIG.get("routines") or [] if isinstance(x, dict) and x.get("id") == body.get("routine")), None)
            if not r:
                raise ValueError(f"no routine {body.get('routine')}")
            rid = r["id"]
            it = it or S.find_item(st, routine_item(r))
            pmap = st["meta"].setdefault("routines_paused", {})
            if k == "routine_pause":
                pmap[rid] = {"at": S.now(), "by": me}
                msg = "停止常驻任务 · 定时器已停，不会再开新的子卡"
            else:
                pmap.pop(rid, None)
                nowt = dt.datetime.now()
                # resuming after today's time never starts a same-day run: mark today as fired, next run is tomorrow
                if nowt.strftime("%H:%M") >= str(r.get("time", "10:00")):
                    st["meta"].setdefault("routines_fired", {})[rid] = nowt.date().isoformat()
                msg = f"恢复常驻任务 · 每天 {r.get('time', '10:00')}"
            if it is not None:
                S.add_thread(it, me, msg, "event")
            inbox = {"kind": k, "routine": rid, "item": it["id"] if it else None}
        else:
            raise ValueError(f"unknown action {k}")

        if it is not None:
            it["updated"] = S.now()
        S.add_log(st, me, f"{k}" + (f" {it['id']}" if it else ""), it["id"] if it else None)

    if inbox and any(S.is_audio_path(p) for p in inbox.get("attachments") or []):
        with S.mutate() as st:   # t-voice-memo: transcripts already finished ride along with the message
            S.claim_transcripts(st, inbox)
    if inbox:
        inbox = S.inbox_append(inbox)
    return {"ok": True, "inbox": inbox["id"] if inbox else None}


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
    return None


def public_state(slim=False):
    st = S.read()
    st["meta"].pop("inbox_acked", None)
    st["meta"]["comfy"] = _comfy
    st["meta"]["owner"] = (CONFIG.get("owner") or {}).get("display_name", "")
    st["meta"]["avatars"] = {f.rsplit(".", 1)[0]: f for f in sorted(os.listdir(AVATARS))
                             if f.lower().endswith((".png", ".jpg", ".jpeg", ".webp", ".gif"))}
    st["meta"]["inbox_unacked"] = _unacked_count()
    st["meta"]["server_time"] = S.now()
    st["meta"]["routines"] = routines_view(st["meta"])
    st["meta"]["media_v"] = 1   # t-voice-memo: this server transcribes (the page hides 转写/重试 on older servers)
    return slim_state(st) if slim else st


def _unacked_count():
    acked = set(S.read()["meta"]["inbox_acked"])
    return sum(1 for e in S.inbox_all() if e["id"] not in acked)


GZ_MIN = 2048


def _gz_type(ctype):
    c = (ctype or "").split(";")[0].strip()
    return c.startswith("text/") or c in ("application/json", "application/javascript", "application/manifest+json", "image/svg+xml")


class H(BaseHTTPRequestHandler):
    server_version = "Underthread/1"

    def log_message(self, fmt, *args):
        if os.environ.get("VERBOSE"):
            super().log_message(fmt, *args)

    def _send(self, code, body, ctype="application/json; charset=utf-8", extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode()
        elif isinstance(body, str):
            body = body.encode()
        enc = None
        if (len(body) >= GZ_MIN and _gz_type(ctype) and "gzip" in (self.headers.get("Accept-Encoding") or "")
                and not self.path.startswith("/api/voice/") and not (extra or {}).get("Content-Encoding")):
            body, enc = gzip.compress(body, 5), "gzip"   # t-mobile-crash-state: /api/state 2.5 MB -> ~0.7 MB; JS/CSS too (they are no-store)
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if enc:
            self.send_header("Content-Encoding", enc)
            self.send_header("Vary", "Accept-Encoding")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _file(self, path, extra=None, media=False):
        """Serve a file. media=True (uploads/work/avatars): Range/206, ETag/304, streamed in 64KB chunks."""
        if not os.path.isfile(path):
            return self._send(404, {"error": "not found"})
        ctype = "application/manifest+json" if path.endswith(".webmanifest") else (mimetypes.guess_type(path)[0] or "application/octet-stream")
        if ctype.startswith("text/") or ctype in ("application/javascript",):
            ctype += "; charset=utf-8"
        if not media:
            with open(path, "rb") as f:
                return self._send(200, f.read(), ctype, extra)
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
                n = dict(mine) if mine else dict(pq[-1]) if pq else {"title": "Underthread", "body": "有新动态", "url": "/", "tag": "underthread"}
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
            if u.path == "/api/state":
                st = public_state(q.get("slim", [""])[0] == "1")
                if q.get("rev", [""])[0] == str(st["meta"]["rev"]):
                    return self._send(200, {"same": True, "meta": {"comfy": _comfy, "server_time": S.now(),
                                                                      "inbox_unacked": st["meta"]["inbox_unacked"]}})
                return self._send(200, st)
            if u.path == "/api/item":   # t-mobile-crash-state: the full card (draft + versions) for a slim one
                it = public_item(q.get("id", [""])[0])
                return self._send(200, it) if it else self._send(404, {"error": "no such item"})
            if u.path == "/api/health":
                return self._send(200, health())
            if u.path == "/api/docs":
                return self._send(200, list_docs())
            if u.path == "/api/doc":
                return self._send(200, {"path": q["path"][0], "text": read_doc(q["path"][0])})
            if u.path == "/api/memory":
                try:
                    return self._send(200, role_memory(q.get("id", [None])[0]))
                except ValueError as ex:
                    return self._send(404, {"error": str(ex)})
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
                    return self._file(p, media=prefix != "/static/")
            self._send(404, {"error": "not found"})
        except Exception as e:
            self._send(400, {"error": str(e)})

    def do_POST(self):
        u = urlparse(self.path)
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
            body = json.loads(self.rfile.read(n) or b"{}")
            if u.path == "/api/action":
                return self._send(200, act(body))
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
                    src = old[0] if old else (sorted(dupes, key=lambda x: x.get("at") or "")[-1] if dupes else None)
                    if src:  # same device re-sent on app open (or re-added): keep its settings, held entries and last send result
                        row.update({k: src[k] for k in ("last_code", "last_at", "prefs", "held") if k in src})
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
                row = _row_update(ep, setp)
                if row is None:
                    _plog(f"prefs {_ep_short(ep)} -> unknown device")
                    return self._send(404, {"error": "这台设备还没在服务器登记推送"})
                _plog(f"prefs {_ep_short(ep)} -> {json.dumps(row['prefs'], ensure_ascii=False)}")
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
                return self._send(200, notify({"title": "Underthread", "body": body.get("text") or "推送已接通。新的待审核和回复会出现在这里。", "url": "/"}))
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
    port = int(os.environ.get("PORT") or CONFIG.get("port") or 8765)
    if not os.environ.get("NO_LOOPS"):
        for fn in (comfy_probe_loop, report_loop, roster_watch_loop, push_loop, wake_loop, routine_loop):
            threading.Thread(target=fn, daemon=True).start()
    srv = ThreadingHTTPServer(("127.0.0.1", port), H)
    print(f"Underthread → http://127.0.0.1:{port}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
