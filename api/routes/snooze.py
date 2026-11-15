"""ri1103-P2 稍后: snooze a card until a time, or until the specialist's next reply. The 20 s timer is in api/loops.py."""
import datetime as dt
import time

from api.ctx import S, _ts
from api.router import action, ME


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


@action("snooze")
def _snooze(a):   # ri1103-P2
    body, it = a.body, a.it
    preset = body.get("preset")
    if preset not in SNOOZE_PRESETS:
        raise ValueError("bad preset")
    if not _on_user(it):
        raise ValueError("这张卡现在不在等你拍板，不用推迟")
    until = ((dt.datetime.now() + dt.timedelta(days=SNOOZE_REPLY_DAYS)).astimezone().isoformat(timespec="seconds")
             if preset == "reply" else snooze_until(preset, body.get("until")))
    it["snooze"] = {"until": until, "wait": "reply" if preset == "reply" else None, "preset": preset, "at": S.now(), "by": ME}
    it.pop("snoozed", None)
    lbl = str(body.get("label") or "")[:40]
    S.add_thread(it, ME, "稍后 · " + (lbl or ("等下条回复" if preset == "reply" else until[5:16].replace("T", " ").replace("-", "/"))), "event")


@action("unsnooze")
def _unsnooze(a):   # ri1103-P2
    if a.it.pop("snooze", None) is not None:
        S.add_thread(a.it, ME, "取消推迟 · 回到等你拍板", "event")
