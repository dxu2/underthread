"""The board: /api/state (cached, long-poll, slim for the phone), /api/archive, /api/history, /api/handoffs, /api/item,
/api/roster, and the roster -> state.agents sync."""
import datetime as dt
import gzip
import json
import os
import threading
import time
import uuid

from api.ctx import S, C, MG, ROOT, WEB, AVATARS, CONFIG
from api.router import route
from api.routes.schedules import routines_view
from core import rolelook as RL

_roster_mtime = None


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
    roster = C.roster(ROOT)
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
            RL.apply(a, r, ROOT)   # t-roster-rail: your display name / avatar pick (团队 page) over the roster's own
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
# body (raw + gzip) by those plus avatars/, archive.json and the minute (routines' next run moves with the clock).
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
            ("cut", os.path.join(WEB, "art", "cut"), ".webp"), ("sheet", os.path.join(AVATARS, "ut", "_s"), "-work-160.webp"),
            # t-yarn-anim: a role with a level-2 yarn kitten script has art/yarn/<id>.json next to an <id>/ folder (eyes, kitten, eyeless art).
            # Core ships none (every role gets the generic kitten); your own layer adds them under local/web/art/yarn/. Value = mtime (cache key).
            ("yarn", os.path.join(WEB, "art", "yarn"), ".json"), ("yarn", os.path.join(S.LOCAL, "web", "art", "yarn"), ".json"))
_ART = {"sig": None, "map": {}}
# Spare stage seats for roles whose roster entry has no "seat" key (an explicit "seat": null keeps a role off the stage).
STAGE_SPARE = [[.22, .62], [.60, .22], [.74, .34], [.10, .70], [.46, .76], [.84, .26]]


def art_sig():
    return tuple(_fsig(d) for _, d, _ in ART_DIRS)


# t-avatar-live-refresh: the two small-avatar manifests (tools/avatar_sizes.py) as one short version string. A swapped avatar never
# touches state.json, so rev does not move; the page compares meta.avv (in full answers and in "same" ones) and refetches both
# manifests when it changes. stat calls only; "" when neither manifest exists.
AVV_FILES = (os.path.join(AVATARS, "_s", "index.json"), os.path.join(AVATARS, "ut", "_s", "index.json"))


def avatar_stamp():
    sig = [_fsig(p) for p in AVV_FILES]
    return ".".join("%x-%x" % (x[1], x[2]) if x else "0" for x in sig) if any(sig) else ""


# t-hire-celebration: the welcome animation (web/js/welcome.js) plays once per browser for a role that tools/new_role.py hired in the last
# HIRE_WINDOW hours. Source = the "apply" lines of logs/new_role.jsonl (written at the end of every hire, old installs have them too), minus
# roles that are gone or retired since. t = when it may play: the hire time, or later when the 特典 avatar was replaced after the hire. A hire
# that got the recoloured placeholder avatar ("avatar": "recolour") waits until avatars/ut/<id>.png is replaced (the picked avatar), at most
# hire_welcome.wait_avatar_min minutes (config; 0 = play at once). Cached on the log's signature; the avatar stats are a few stat calls.
HIRE_LOG = os.path.join(ROOT, "logs", "new_role.jsonl")
HIRE_WINDOW = 72
_HIRES = {"sig": None, "rows": []}


def _hire_rows():
    sig = _fsig(HIRE_LOG)
    if sig != _HIRES["sig"]:
        rows = {}
        try:
            with open(HIRE_LOG, encoding="utf-8") as f:
                for ln in f:
                    try:
                        d = json.loads(ln)
                    except ValueError:
                        continue
                    if not isinstance(d, dict) or not d.get("id"):
                        continue
                    if d.get("op") == "apply":
                        rows[d["id"]] = d
                    elif d.get("op") == "retire":
                        rows.pop(d["id"], None)
        except OSError:
            pass
        _HIRES.update(sig=sig, rows=list(rows.values()))
    return _HIRES["rows"]


def hire_welcomes(agents=None):
    """[{id, t}] for meta.hires, oldest first."""
    if agents is None:
        agents = S.read().get("agents") or {}
    now = dt.datetime.now().astimezone()
    wait = float(((CONFIG.get("hire_welcome") or {}).get("wait_avatar_min")) or 0)
    out = []
    for d in _hire_rows():
        i = d["id"]
        a = agents.get(i)
        if not a or a.get("enabled") is False:
            continue
        try:
            at = dt.datetime.fromisoformat(d.get("t", "")).astimezone()
        except (TypeError, ValueError):
            continue
        if (now - at).total_seconds() > HIRE_WINDOW * 3600:
            continue
        try:
            um = dt.datetime.fromtimestamp(os.path.getmtime(os.path.join(AVATARS, "ut", f"{i}.png"))).astimezone()
        except (OSError, ValueError):
            um = None
        swapped = um is not None and (um - at).total_seconds() > 20   # copied by new_role.py itself = same second as the hire
        if d.get("avatar") == "recolour" and not swapped:
            if (now - at).total_seconds() < wait * 60:
                continue   # still the placeholder: wait for the picked avatar
            t = at + dt.timedelta(minutes=wait)
        else:
            t = max(at, um) if swapped else at
        out.append({"id": i, "at": at.isoformat(timespec="seconds"), "t": t.isoformat(timespec="seconds")})
    return sorted(out, key=lambda x: x["t"])


_HW = {"k": None, "v": []}


def hire_welcomes_cached():
    """For long-poll "same" answers: re-read only when the log, state.json, the avatar manifests or the minute moved."""
    k = (_fsig(HIRE_LOG), _fsig(S.STATE), avatar_stamp(), dt.datetime.now().strftime("%Y-%m-%d %H:%M"))
    if k != _HW["k"]:
        _HW.update(k=k, v=hire_welcomes())
    return _HW["v"]


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
                if k == "yarn":
                    try:
                        m.setdefault(f[:-len(ext)], {})[k] = int(os.path.getmtime(os.path.join(d, f)))
                    except OSError:
                        pass
                    continue
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


CONFIG_JSON = os.path.join(ROOT, "config.json")
_PLATS = {"sig": False, "val": False}


def platforms_set():
    """t-oss-gen-s5: config.json has a non-empty "platforms" block (the content preset sets it). With meta.studio ("on" / "off",
    unset = auto) and any role's "pipe", the page decides whether 制作组 shows 制作线 / 频道 and drafts get platform previews.
    Read from the file (cached on its stat), so a preset switch shows without a restart."""
    sig = _fsig(CONFIG_JSON)
    if sig != _PLATS["sig"]:
        try:
            with open(CONFIG_JSON, encoding="utf-8") as f:
                val = bool(json.load(f).get("platforms"))
        except (OSError, ValueError, AttributeError):
            val = False
        _PLATS.update(sig=sig, val=val)
    return _PLATS["val"]


def public_state_cached(slim):
    k = (_fsig(S.STATE), _fsig(CONFIG_JSON), _fsig(S.INBOX), _fsig(AVATARS), _fsig(HIRE_LOG), _fsig(S.ARCHIVE), art_sig(), avatar_stamp(), json.dumps(codex_quota()), dt.datetime.now().strftime("%Y-%m-%d %H:%M"))
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
    st["meta"]["codex"] = codex_quota()   # t-soul-widget
    C.owner_live(ROOT, CONFIG)   # t-onboard-name: a name set by stateutil owner set shows without a restart
    st["meta"]["owner"] = (CONFIG.get("owner") or {}).get("display_name", "")
    st["meta"]["owner_loc"] = C.owner_location(ROOT)   # t-oss-location: {lat, lon, tz} / {declined} / None (never asked)
    st["meta"]["avatars"] = {f.rsplit(".", 1)[0]: f for f in sorted(os.listdir(AVATARS))
                             if f.lower().endswith((".png", ".jpg", ".jpeg", ".webp", ".gif"))}
    st["meta"]["inbox_unacked"] = rev_unacked()[1]
    st["meta"]["art"] = art_scan()
    st["meta"]["avv"] = avatar_stamp()   # t-avatar-live-refresh
    st["meta"]["hires"] = hire_welcomes(st.get("agents") or {})   # t-hire-celebration
    st["meta"]["seats"] = stage_seats(st.get("agents") or {})
    a, live = archive_cached(), {i.get("id") for i in st.get("items", [])}
    ix = [[i.get("id"), i.get("title", ""), i.get("owner", ""), str(i.get("closed") or i.get("updated") or "")[:10]] for i in a["items"] if i.get("id") not in live]
    st["meta"]["archive"] = {"n": len(ix), "v": (a["sig"] or [0, 0])[1], "ix": ix}   # t-perf A: id chips, title search, deep links know archived cards
    st["meta"]["server_time"] = S.now()
    st["meta"]["routines"] = routines_view(st["meta"], items=st.get("items"), scheds=st.get("schedules"))
    st["schedules"] = [x for x in st.get("schedules") or [] if not x.get("deleted")]   # t-schedule-backend: removed ones stay 30 days for undo, not shown
    st["meta"]["schema_code"] = MG.LATEST   # t-oss-struct E1: meta.schema > this = data from a newer version (settings shows a line)
    st["meta"]["report_time"] = str(CONFIG.get("report_time", "18:00"))   # ri1103-P1: the 日报 row of 今日日程
    st["meta"]["platforms_set"] = platforms_set()   # t-oss-gen-s5: content mode (web/js/views/left.js contentMode)
    from api.routes import setup as SU   # t-onboarding P0: the 开工清单, only while it is not retired (the page draws nothing without it)
    if not SU.retired(st["meta"].get("onboarding") or {}):
        st["meta"]["setup"] = SU.view(st, a["items"])
    st["meta"]["plan_tip"] = SU.plan_tip(st, list(st.get("items") or []) + list(a["items"] or []))   # t-oss-polish-1121 ④: the one-time 批准开工 bubble
    from core.ext import EXT, ext_on   # t-oss-live: built-in extensions the page may show (Settings -> Connections switches them)
    st["meta"]["exts"] = {"live": bool((EXT.get("live") or {}).get("server")) and ext_on("live")}
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


def mail_unread(m):
    """r-improve-1120 P2: a ⏰ reminder letter (kind remind) never counts as unread: it is pushed on time and stays in the mailbox,
    but it does not bold, add a dot or raise any count. Mirrors web/js/core/store.js unreadM()."""
    return not m.get("read") and m.get("kind") != "remind"


def trim_state(st):
    chat, mail = st.get("chat") or [], st.get("mail") or []
    base = max(0, len(chat) - CHAT_KEEP)
    st["chat"] = chat[base:]
    cut = max(0, len(mail) - MAIL_KEEP)
    st["mail"] = [m for i, m in enumerate(mail) if i >= cut or mail_unread(m)]
    st["meta"]["mail_unread"] = sum(1 for m in mail if mail_unread(m))
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
        return {"k": "mail", "list": [m for m in mail[:cut] if not mail_unread(m)], "total": len(mail)}
    if k == "logs":
        logs, ag = st.get("logs") or [], q.get("agent", [""])[0]
        return {"k": "logs", "list": [l for l in logs if not ag or l.get("agent") == ag][-400:], "total": len(logs), "rev": st["meta"].get("rev")}
    raise ValueError("k must be chat, mail or logs")


def _unacked_count():
    acked = set(S.read()["meta"]["inbox_acked"])
    return sum(1 for e in S.inbox_all() if e["id"] not in acked)


@route("GET", "/api/state")
def _state(h, u, q):   # t-perf B: cached rev / body (see public_state_cached)
    from api.routes import setup as SU
    SU.note_phone(h)   # t-onb-polish: a phone through Tailscale Serve ticks the optional phone step (header check only; writes once)
    sync_roster()   # t-hr-registry: mtime check only; a roster edit shows up even when the watch loop is off (NO_LOOPS) or stuck
    rev, un = rev_unacked()
    # ri1105-P5: ?wait=N (<= 25) holds a "same" answer until rev or the inbox count moves, checked every 0.1 s (stat calls only:
    # rev_unacked re-reads only when state.json / inbox.jsonl changed). The cached body moves every minute; rev does not.
    try:
        wait = min(25.0, max(0.0, float(q.get("wait", ["0"])[0] or 0)))
    except ValueError:
        wait = 0.0
    avv = avatar_stamp()   # t-avatar-live-refresh: a swapped avatar wakes the wait too (the "same" answer carries the new avv)
    if wait and q.get("rev", [""])[0] == str(rev):
        t_end = time.monotonic() + wait
        while time.monotonic() < t_end:
            time.sleep(0.1)
            r2, u2 = rev_unacked()
            v2 = avatar_stamp()
            if (r2, u2, v2) != (rev, un, avv):
                rev, un, avv = r2, u2, v2
                break
    if q.get("rev", [""])[0] == str(rev):
        return h._send(200, {"same": True, "meta": {"server_time": S.now(), "inbox_unacked": un, "avv": avv, "hires": hire_welcomes_cached()}})
    _, raw, gzb = public_state_cached(q.get("slim", [""])[0] == "1")
    if "gzip" in (h.headers.get("Accept-Encoding") or ""):
        return h._send(200, gzb, extra={"Content-Encoding": "gzip", "Vary": "Accept-Encoding"})
    return h._send(200, raw)


@route("GET", "/api/archive")
def _archive(h, u, q):   # t-perf A
    if "gzip" in (h.headers.get("Accept-Encoding") or ""):
        return h._send(200, archive_body(True), extra={"Content-Encoding": "gzip", "Vary": "Accept-Encoding"})
    return h._send(200, archive_body(False))


@route("GET", "/api/history")
def _history(h, u, q):   # ri1105-P4: what a poll leaves out (chat before the window, older letters, logs)
    return h._send(200, history(q))


@route("GET", "/api/handoffs")
def _handoffs(h, u, q):   # t-rb-build
    return h._send(200, handoffs(q))


@route("GET", "/api/item")
def _item(h, u, q):   # t-mobile-crash-state: the full card (draft + versions) for a slim one
    it = public_item(q.get("id", [""])[0])
    return h._send(200, it) if it else h._send(404, {"error": "no such item"})


@route("GET", "/api/roster")
def _roster(h, u, q):
    return h._send(200, C.roster(ROOT))
