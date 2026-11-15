"""Push notifications to the iPhone home-screen app: subscriptions (push_subs.json), per-device tiers / quiet hours / digest,
the payloads, and the /api/push/* routes. The 3 s timer that turns new mailbox entries into pushes is in api/loops.py."""
import datetime as dt
import json
import os
import re
import threading
import uuid
from urllib.parse import urlparse

from api.ctx import S, WP, ROOT, load_json
from api.router import route
from api.routes.snooze import snooze_active


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


@route("GET", "/api/push/key")
def _key(h, u, q):
    return h._send(200, {"key": WP.keys()[1]})


@route("GET", "/api/push/latest")
def _latest(h, u, q):
    pq, ep = _push["queue"], q.get("endpoint", [""])[0]   # t-imp29-p1: sw v5 sends its endpoint; older sw gets the global latest
    mine = _push["dev"].get(ep) if ep else None
    lang = _row_lang(next((x for x in _subs() if x["sub"].get("endpoint") == ep), None)) if ep else "zh"   # t-i18n-b
    n = dict(mine) if mine else dict(pq[-1]) if pq else {"title": "Underthread", "body": "New activity" if lang == "en" else "有新动态", "url": "/", "tag": "underthread"}
    n.setdefault("lang", lang)
    try:
        n["badge"] = pending_count(S.read())   # t-app-badge: counted when the device asks, so it is current
    except Exception as e:
        print("push/latest badge:", e)
    return h._send(200, n)


@route("GET", "/api/push/status")
def _status(h, u, q):
    return h._send(200, push_status(q.get("endpoint", [""])[0]))


@route("GET", "/api/push/history")
def _history(h, u, q):   # t-imp29-p1: the 24h chart in 设置 → 推送通知
    return h._send(200, push_history(q.get("endpoint", [""])[0]))


@route("POST", "/api/push/subscribe")
def _subscribe(h, u, body):
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
    return h._send(200, {"ok": True, "devices": len(subs), "mine": True})


@route("POST", "/api/push/prefs")
def _prefs(h, u, body):   # t-imp29-p1: tier / quiet hours / digest for one device
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
        return h._send(404, {"error": "这台设备还没在服务器登记推送"})
    _plog(f"prefs {_ep_short(ep)} -> {json.dumps(row['prefs'], ensure_ascii=False)} lang={_row_lang(row)}")
    return h._send(200, {"ok": True, "prefs": row["prefs"]})


@route("POST", "/api/push/unsubscribe")
def _unsubscribe(h, u, body):
    subs = [x for x in _subs() if x["sub"]["endpoint"] != body.get("endpoint")]
    _save_subs(subs)
    _plog(f"unsubscribe {_ep_short(body.get('endpoint'))} · {len(subs)} device(s)")
    return h._send(200, {"ok": True, "devices": len(subs)})


@route("POST", "/api/push/log")
def _log(h, u, body):   # the phone reports each step of turning push on
    keys = ("step", "perm", "standalone", "secure", "has_sub", "server_has_me", "result", "name", "message", "endpoint_host", "ios")
    parts = [f"{k}={str(body[k])[:120]}" for k in keys if k in body]
    _plog("client " + " ".join(parts))
    return h._send(200, {"ok": True})


@route("POST", "/api/push/test")
def _test(h, u, body):
    return h._send(200, notify({"title": "Underthread", "body": body.get("text") or "推送已接通。新的待审核和回复会出现在这里。", "url": "/"},
                               en=None if body.get("text") else {"body": "Push is on. New reviews and replies will show up here."}))
