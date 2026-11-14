"""t-schedule-backend: one-sentence schedules (state.schedules). Pure helpers: rule parsing, next-run maths, descriptions.

No file I/O here. core/schedule_store.py owns the state writes (schedules_due, schedule_*), stateutil.py the schedule commands,
and server.py runs schedule_loop. Moved from the root schedules.py (t-oss-struct B1), which still imports as this module.

Rules (stored as dicts, written on the command line as a short string):
  once 2026-11-08 02:50 | in 90m / in 1h / in 2d   -> {"type": "once", "at": "2026-11-08T02:50"}
  daily 09:00                                       -> {"type": "daily", "at": "09:00"}
  weekly mon,thu 09:00                              -> {"type": "weekly", "at": "09:00", "days": [1, 4]}   (ISO weekday, 1 = Monday)
  monthly 1 18:00 | monthly last 18:00              -> {"type": "monthly", "at": "18:00", "mday": 1 | -1}  (31 in a short month = its last day)
Times are wall-clock in the entry's IANA tz, so "every Monday 09:00" stays 09:00 across DST. A time that does not exist
(spring forward) moves to the first minute that does; a repeated one (fall back) fires on its first occurrence only.
"""
import calendar
import datetime as dt
import os
import re
from zoneinfo import ZoneInfo

DAY_KEYS = {"mon": 1, "tue": 2, "wed": 3, "thu": 4, "fri": 5, "sat": 6, "sun": 7,
            "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7}
DAY_ZH = {1: "一", 2: "二", 3: "三", 4: "四", 5: "五", 6: "六", 7: "日"}
KINDS = ("remind", "task")
RUNS_KEEP = 30


class RuleError(ValueError):
    pass


def local_tz_name():
    """IANA name of this machine's zone: $TZ, else the /etc/localtime link, else UTC."""
    tz = os.environ.get("TZ", "").strip()
    if tz and "/" in tz:
        return tz
    try:
        p = os.path.realpath("/etc/localtime")
        if "zoneinfo/" in p:
            return p.split("zoneinfo/", 1)[1]
    except OSError:
        pass
    return "UTC"


def zone(name):
    try:
        return ZoneInfo(name or local_tz_name())
    except Exception:
        raise RuleError(f"未知时区 {name!r}（要 IANA 名字，例如 America/Los_Angeles、Asia/Shanghai）")


def _hm(s):
    m = re.fullmatch(r"([01]?\d|2[0-3]):([0-5]\d)", s or "")
    if not m:
        raise RuleError(f"时间要写成 HH:MM（00:00–23:59），收到 {s!r}")
    return f"{int(m.group(1)):02d}:{m.group(2)}"


def parse_rule(spec, tz=None, nowt=None):
    """'weekly mon,thu 09:00' -> rule dict. Raises RuleError with a Chinese message. nowt (aware) is only used for 'in 90m'."""
    tzi = zone(tz)
    nowt = (nowt or dt.datetime.now(tzi)).astimezone(tzi)
    t = (spec or "").strip().split()
    if not t:
        raise RuleError("规则是空的；例如 'once 2026-11-08 09:00'、'in 1h'、'daily 09:00'、'weekly mon,thu 09:00'、'monthly last 18:00'")
    k = t[0].lower()
    if k == "in":
        m = re.fullmatch(r"(\d+)\s*([mhd])", "".join(t[1:]).lower())
        if not m or int(m.group(1)) <= 0:
            raise RuleError("相对时间写成 'in 90m' / 'in 1h' / 'in 2d'")
        n, u = int(m.group(1)), m.group(2)
        at = nowt + dt.timedelta(minutes=n if u == "m" else n * 60 if u == "h" else n * 1440)
        at = at.replace(second=0, microsecond=0)
        return {"type": "once", "at": at.strftime("%Y-%m-%dT%H:%M")}
    if k == "once":
        if len(t) != 3:
            raise RuleError("一次性写成 'once YYYY-MM-DD HH:MM'")
        try:
            d = dt.date.fromisoformat(t[1])
        except ValueError:
            raise RuleError(f"日期要写成 YYYY-MM-DD，收到 {t[1]!r}")
        return {"type": "once", "at": f"{d.isoformat()}T{_hm(t[2])}"}
    if k == "daily":
        if len(t) != 2:
            raise RuleError("每天写成 'daily HH:MM'")
        return {"type": "daily", "at": _hm(t[1])}
    if k == "weekly":
        if len(t) != 3:
            raise RuleError("每周写成 'weekly mon,thu 09:00'（星期用 mon..sun 或 一..日）")
        days = []
        for p in re.split(r"[,，、]", t[1]):
            p = p.strip().lower()[:3] if p.strip().isascii() else p.strip().replace("周", "").replace("星期", "")
            if p not in DAY_KEYS:
                raise RuleError(f"看不懂星期 {p!r}；用 mon,tue,wed,thu,fri,sat,sun 或 一,二,…,日")
            days.append(DAY_KEYS[p])
        return {"type": "weekly", "at": _hm(t[2]), "days": sorted(set(days))}
    if k == "monthly":
        if len(t) != 3:
            raise RuleError("每月写成 'monthly 1 18:00' 或 'monthly last 18:00'")
        if t[1].lower() in ("last", "末", "月末"):
            md = -1
        else:
            try:
                md = int(t[1])
            except ValueError:
                md = 0
            if not 1 <= md <= 31:
                raise RuleError(f"每月的日子要 1–31 或 last，收到 {t[1]!r}")
        return {"type": "monthly", "at": _hm(t[2]), "mday": md}
    raise RuleError(f"不认识的规则 {t[0]!r}；只有 once / in / daily / weekly / monthly")


def check_rule(rule):
    """Validate a stored rule dict (from --json or an older entry); returns it."""
    if not isinstance(rule, dict) or rule.get("type") not in ("once", "daily", "weekly", "monthly"):
        raise RuleError(f"坏规则 {rule!r}")
    if rule["type"] == "once":
        try:
            dt.datetime.strptime(rule.get("at", ""), "%Y-%m-%dT%H:%M")
        except ValueError:
            raise RuleError(f"一次性的 at 要 YYYY-MM-DDTHH:MM，收到 {rule.get('at')!r}")
    else:
        _hm(rule.get("at"))
    if rule["type"] == "weekly" and not (rule.get("days") and all(d in range(1, 8) for d in rule["days"])):
        raise RuleError("每周规则缺星期")
    if rule["type"] == "monthly" and rule.get("mday") not in [-1] + list(range(1, 32)):
        raise RuleError("每月规则的日子要 1–31 或 -1")
    return rule


def wall(day, hm, tzi):
    """Aware datetime for local wall time `hm` on `day`. Non-existent (DST gap) -> first valid minute after; ambiguous -> first."""
    h, m = map(int, hm.split(":"))
    naive = dt.datetime.combine(day, dt.time(h, m))
    for _ in range(181):
        t = naive.replace(tzinfo=tzi, fold=0)
        back = t.astimezone(dt.timezone.utc).astimezone(tzi)
        if back.replace(tzinfo=None) == naive:
            return t
        naive += dt.timedelta(minutes=1)
    return naive.replace(tzinfo=tzi)


def _matches(rule, d):
    ty = rule["type"]
    if ty == "daily":
        return True
    if ty == "weekly":
        return d.isoweekday() in rule["days"]
    if ty == "monthly":
        last = calendar.monthrange(d.year, d.month)[1]
        md = rule["mday"]
        return d.day == (last if md == -1 else min(md, last))
    return False


def next_after(rule, tz, after):
    """First run strictly after `after` (aware), or None (a once rule already past)."""
    tzi = zone(tz)
    after = after.astimezone(tzi)
    if rule["type"] == "once":
        d, hm = rule["at"].split("T")
        t = wall(dt.date.fromisoformat(d), hm, tzi)
        return t if t > after else None
    d = after.date()
    for _ in range(400):
        if _matches(rule, d):
            t = wall(d, rule["at"], tzi)
            if t > after:
                return t
        d += dt.timedelta(days=1)
    return None


def upcoming(rule, tz, after, n=3):
    out, t = [], after
    for _ in range(n):
        t = next_after(rule, tz, t)
        if not t:
            break
        out.append(t)
    return out


def describe(rule):
    """Chinese one-liner for chat confirmations and the page: 每周一、四 09:00."""
    ty, at = rule["type"], rule.get("at", "")
    if ty == "once":
        d, hm = at.split("T")
        return f"一次性 {d} {hm}"
    if ty == "daily":
        return f"每天 {at}"
    if ty == "weekly":
        return "每周" + "、".join(DAY_ZH[d] for d in rule["days"]) + f" {at}"
    return ("每月最后一天" if rule["mday"] == -1 else f"每月 {rule['mday']} 号") + f" {at}"


def iso(t):
    return t.isoformat(timespec="seconds") if t else None


def parse_iso(s):
    return dt.datetime.fromisoformat(s) if s else None


def advance(s, nowt):
    """The entry is due at nowt: record the run and move `next` to the first run after nowt (missed runs collapse into this one).
    Returns (for_iso, late_minutes, skipped). Caller checks due-ness and writes the outputs in the same lock."""
    due, skipped = parse_iso(s["next"]), 0
    for _ in range(400):   # several runs missed while the server was down: report the latest one, count the rest as skipped
        n2 = next_after(s["rule"], s.get("tz"), due)
        if not n2 or n2 > nowt:
            break
        due, skipped = n2, skipped + 1
    late = max(0, int((nowt - due).total_seconds() // 60))
    s["last"] = iso(nowt)
    run = {"for": iso(due), "at": iso(nowt), "late": late}
    if skipped:
        run["skipped"] = skipped
    s.setdefault("runs", []).append(run)
    del s["runs"][:-RUNS_KEEP]
    nxt = next_after(s["rule"], s.get("tz"), nowt)
    end = s.get("end") or {}
    if nxt and end.get("count") and len(s["runs"]) >= int(end["count"]):
        nxt = None
    if nxt and end.get("until") and nxt.astimezone(zone(s.get("tz"))).date().isoformat() > end["until"]:
        nxt = None
    s["next"] = iso(nxt)
    if not nxt:
        s["enabled"] = False
        s["finished"] = iso(nowt)
    return iso(due), late, skipped
