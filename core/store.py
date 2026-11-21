"""state.json, archive.json and inbox.jsonl: locked reads and writes, plus the small record helpers every writer uses
(thread lines, log lines, letters). Moved from stateutil.py (t-oss-struct B1); stateutil re-exports every name.

Layering: core.paths <- core.store <- core.items / asks / chat / agents / handoffs / lessons / schedule_store <- stateutil, server.
A module only imports from the ones to its left.
"""
import contextlib
import datetime as dt
import fcntl
import json
import os
import re
import uuid

from core import migrate as MG
from core.paths import ARCHIVE, INBOX, INBOX_LOCK, ROOT, STATE, STATE_LOCK

CATEGORIES = ["main", "side", "daily", "urgent", "ongoing"]
STAGES = ["todo", "doing", "review", "waiting", "done"]
KINDS = ["plan", "deliverable", "question", "task"]
PLATFORMS = ["bili", "yt", "xhs"]
CAPS = {"logs": 3000, "mail": 1500, "chat": 1500, "dm": 400, "thread": 400,
        "inbox_acked": 5000, "reports": 200, "notices": 100, "handoffs": 500}


def now():
    return dt.datetime.now().astimezone().isoformat(timespec="seconds")


def new_id(prefix):
    return f"{prefix}-{dt.datetime.now():%m%d}-{uuid.uuid4().hex[:4]}"


def blank_state():
    return {
        "meta": {"rev": 0, "updated": now(), "stamina": {"pct": None, "note": "", "at": None},
                 "focus": {"pct": None, "at": None}, "inbox_acked": [], "last_report_date": None},
        "items": [], "agents": {}, "logs": [], "lessons": [], "notices": [], "reports": [],
        "calendar": [], "chat": [], "dms": {}, "mail": [], "media": {}, "schedules": [],
        "handoffs": [], "ho_last": {},   # t-rb-build: explicit handoff log (see note_hand)
    }


def _shape(st):
    base = blank_state()
    for k, v in base.items():
        st.setdefault(k, v)
    for k, v in base["meta"].items():
        st["meta"].setdefault(k, v)
    return st


_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)?$")


def _fresh_times(st):
    """Shift every timestamp in the sample state so the newest one is a few minutes ago, in local time.
    Otherwise a fresh install opens on cards that have been 'waiting 17 days'."""
    stamps = []

    def walk(o, fn):
        if isinstance(o, dict):
            for k, v in o.items():
                o[k] = walk(v, fn)
        elif isinstance(o, list):
            for i, v in enumerate(o):
                o[i] = walk(v, fn)
        elif isinstance(o, str) and _ISO.match(o):
            return fn(o)
        return o

    def parse(s):
        t = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
        return t if t.tzinfo else t.astimezone()

    walk(st, lambda s: stamps.append(parse(s)) or s)
    if not stamps:
        return st
    shift = dt.datetime.now().astimezone() - dt.timedelta(minutes=5) - max(stamps)
    return walk(st, lambda s: (parse(s) + shift).astimezone().isoformat(timespec="seconds"))


class _NeedsMigration(Exception):
    """_load under a shared lock found an old schema; read() retakes the lock exclusively and migrates."""


def _load(exclusive=True):
    """state.json as a dict. Called with the state lock held (exclusive in mutate(), shared in read()).
    t-oss-struct E1: an older meta.schema is migrated here, once, under the exclusive lock: the file as it was is saved to
    local/backups/migrate/ (core.migrate.backup_dir), the steps run, the result is written back. Newer data (after a code
    rollback) is read as it is."""
    if not os.path.exists(STATE):
        example = os.path.join(ROOT, "state.example.json")
        if os.path.exists(example):
            with open(example, encoding="utf-8") as f:
                seed = _fresh_times(json.load(f))
            MG.run("state", seed, ROOT, now=now())   # a fresh install starts current; nothing worth a backup yet
            _save(seed)
        else:
            st = blank_state()
            st["meta"]["schema"] = MG.LATEST   # nothing to migrate in a state that starts now
            return st
    with open(STATE, "rb") as f:
        raw = f.read()
    st = json.loads(raw.decode("utf-8"))
    if MG.needs("state", st):
        if not exclusive:
            raise _NeedsMigration
        MG.backup(ROOT, "state.json", raw, MG.version("state", st))
        MG.run("state", st, ROOT, now=now())
        _save(st)   # at once: a mutate that fails later must not leave the migrated data unsaved
    return _shape(st)


def _save(st):
    tmp = STATE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(st, f, ensure_ascii=False, indent=1)
    os.replace(tmp, STATE)


def _ask_snapshot(st):
    """t-ask-autoclose: stage, open ask ids and draft_at of every card, taken when a mutate starts."""
    return {i.get("id"): (i.get("stage"), {a.get("id") for a in i.get("asks") or [] if not a.get("answer") and not a.get("closed")}, i.get("draft_at"))
            for i in st.get("items") or []}


SHOWN = ("review", "done")


def _stale_asks(it, old):
    """Which of the asks open when the mutate started belong to an earlier round (r-improve-1120 P1 + r-improve-1121 P1).
    A round starts when the card leaves review / done (it goes back to work) and ends with the next delivery; asks made during
    the round are that delivery's questions and stay. Rules:
    - review/done -> another of them (review -> done, done -> review): every ask that was open goes (the old behaviour);
    - stays in review/done but a new version came in (draft_at moved): every ask that was open goes (1120: the plan's
      「开工吗？」 hung on the delivered card); asks added in this same mutate are not in the snapshot, so they stay;
    - work stage -> review/done: only asks made before the card left review last time (it["left_review"]); asks made while it
      was being worked on stay (1121: `stateutil ask` then `upsert --stage review` is two mutates). A card that left review before
      left_review was recorded falls back to its previous draft_at; a card that was never delivered has no earlier round."""
    stage, (ostage, open_ids, odraft) = it.get("stage"), old
    if stage not in SHOWN:
        return []
    if ostage == stage:
        if it.get("draft_at") == odraft:
            return []
        cut, strict = None, False   # a new version: everything that was open
    elif ostage in SHOWN:
        cut, strict = None, False
    else:
        # left_review: an ask in that same second came after the card went back to work (keep); draft_at: an ask in the delivery's
        # own second was asked with that delivery (`upsert --ask`), so it belongs to the old round
        lr = it.get("left_review")
        cut, strict = (lr, True) if lr else (odraft, False)
        if not cut:
            return []
    early = lambda a: (a.get("t") or "") < cut if strict else (a.get("t") or "") <= cut
    return [a for a in it.get("asks") or [] if a.get("id") in open_ids and not a.get("answer") and not a.get("closed")
            and (cut is None or early(a))]


def _autoclose_asks(st, before):
    """t-ask-autoclose: a delivery (a card moving into review or done, or a new version while it stays there) withdraws the asks
    left over from an earlier round (same effect as ask-close); see _stale_asks for what counts as earlier. Answered asks are never
    touched, and doing / todo / waiting never close anything. Also stamps left_review when a card goes from review / done back to
    work, the start of the next round. One path for stateutil, server.py and the sweeps."""
    for it in st.get("items") or []:
        old = before.get(it.get("id"))
        if not old:
            continue
        if old[0] in SHOWN and it.get("stage") not in SHOWN:
            it["left_review"] = now()
            continue
        stale = _stale_asks(it, old)
        if not stale:
            continue
        t = now()
        for a in stale:
            a["closed"] = t
            a["auto"] = it.get("stage")
        add_thread(it, "manager", f"已撤 {len(stale)} 个过期提问", "event")
        add_log(st, "manager", f"ask-autoclose {','.join(a['id'] for a in stale)} (stage {old[0]} -> {it.get('stage')})", it.get("id"))


@contextlib.contextmanager
def mutate():
    """Locked read-modify-write. Bumps meta.rev on exit.
    t-perf A: find_item() inside a mutate may pull an archived card (and its family) back into st["items"]; the archive file
    drops them only after state.json is saved. Once an hour the sweep moves done families older than ARCHIVE_DAYS out:
    archive.json is written first, then state.json (a crash in between leaves a card in both; state wins, never lost)."""
    with open(STATE_LOCK, "a+") as lf:
        fcntl.flock(lf, fcntl.LOCK_EX)
        try:
            st = _load()
            st["_mut"] = []   # ids restored from the archive during this mutate
            before = _ask_snapshot(st)
            yield st
            restored = st.pop("_mut", None) or []
            _autoclose_asks(st, before)
            archive_sweep(st)
            st["meta"]["rev"] = int(st["meta"].get("rev", 0)) + 1
            st["meta"]["updated"] = now()
            _save(st)
            if restored:   # only now that state.json holds them
                gone = set(restored)
                archive_write([i for i in archive_load() if i.get("id") not in gone])
        finally:
            fcntl.flock(lf, fcntl.LOCK_UN)


# ---------- t-perf A: archive of old done cards ----------
# A card is archived when it is done and nothing on it (updated / activity / closed) moved for ARCHIVE_DAYS days, and only together with
# its whole family (parent card via tags, sub-cards): a family with any live member stays in state.json. Nothing is deleted.
# ARCHIVE_OFF=1 stops new archiving (restoring still works). `stateutil.py unarchive-all` puts everything back.
ARCHIVE_DAYS = float(os.environ.get("ARCHIVE_DAYS", "3"))
ARCHIVE_EVERY = 3600   # seconds between sweeps (meta.archive_at)


def archive_load():
    try:
        with open(ARCHIVE, encoding="utf-8") as f:
            return json.load(f).get("items") or []
    except FileNotFoundError:
        return []


def archive_write(items):
    tmp = ARCHIVE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"items": items}, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, ARCHIVE)


def _ts(v):
    try:
        t = dt.datetime.fromisoformat(str(v))
        return t if t.tzinfo else t.astimezone()
    except (TypeError, ValueError):
        return None


def _parent_id(it, ids):
    for t in it.get("tags") or []:
        if t != it.get("id") and t in ids:
            return t
    return None


def archive_candidates(items, nowt=None, days=None):
    """ids of the cards that may leave state.json now (whole families only)."""
    nowt = nowt or dt.datetime.now().astimezone()
    days = ARCHIVE_DAYS if days is None else days
    ids = {i.get("id") for i in items}
    def old(i):
        if i.get("stage") != "done":
            return False
        ts = [t for t in (_ts(i.get("updated")), _ts(i.get("activity")), _ts(i.get("closed"))) if t]
        return bool(ts) and (nowt - max(ts)).total_seconds() >= days * 86400
    ok = {i["id"] for i in items if old(i)}
    par = {i["id"]: _parent_id(i, ids) for i in items}
    kids = {}
    for c, p in par.items():
        if p:
            kids.setdefault(p, []).append(c)
    changed = True
    while changed:   # a member whose parent or any sub-card stays makes it stay too
        changed = False
        for i in list(ok):
            if (par.get(i) and par[i] not in ok) or any(k not in ok for k in kids.get(i, [])):
                ok.discard(i); changed = True
    return ok


def archive_sweep(st, force=False):
    if os.environ.get("ARCHIVE_OFF"):
        return []
    nowt = dt.datetime.now().astimezone()
    last = _ts(st["meta"].get("archive_at"))
    if not force and last and (nowt - last).total_seconds() < ARCHIVE_EVERY:
        return []
    st["meta"]["archive_at"] = now()
    ids = archive_candidates(st["items"], nowt)
    if not ids:
        return []
    moved = [i for i in st["items"] if i["id"] in ids]
    archive_write([i for i in archive_load() if i.get("id") not in ids] + moved)   # archive first, then the caller saves state
    st["items"] = [i for i in st["items"] if i["id"] not in ids]
    return moved


def archive_find(item_id):
    for it in archive_load():
        if it.get("id") == item_id:
            return it
    return None


def archive_family(arch, item_id):
    """The archived cards connected to item_id through parent / sub-card links (the whole family, it included)."""
    by = {i.get("id"): i for i in arch}
    if item_id not in by:
        return []
    fam, grow = {item_id}, True
    while grow:
        grow = False
        for i in arch:
            iid = i.get("id")
            if iid in fam:
                ups = {t for t in i.get("tags") or [] if t != iid and t in by}
            else:
                ups = set()
                if any(t in fam for t in i.get("tags") or [] if t != iid):
                    fam.add(iid); grow = True
            if ups - fam:
                fam |= ups; grow = True
    return [i for i in arch if i.get("id") in fam]


def _restore(st, item_id):
    """Inside mutate(): bring an archived card plus its whole archived family back into st["items"]."""
    back = archive_family(archive_load(), item_id)
    if not back:
        return None
    have = {i["id"] for i in st["items"]}
    for i in back:
        if i["id"] not in have:
            i["activity"] = now()   # fresh again: it will not be swept back out for ARCHIVE_DAYS
            st["items"].append(i)
            st["_mut"].append(i["id"])
    return next(i for i in st["items"] if i["id"] == item_id)


def read():
    with open(STATE_LOCK, "a+") as lf:
        fcntl.flock(lf, fcntl.LOCK_SH)
        try:
            return _load(exclusive=False)
        except _NeedsMigration:
            fcntl.flock(lf, fcntl.LOCK_EX)   # converts the shared lock; the first reader after an update migrates
            return _load()
        finally:
            fcntl.flock(lf, fcntl.LOCK_UN)


def norm_attach(x):
    """Attachment path -> path relative to ROOT when it resolves inside ROOT; else unchanged."""
    if isinstance(x, list):
        return [norm_attach(i) for i in x]
    if not isinstance(x, str) or not x or "://" in x:
        return x
    if not (os.path.isabs(x) or x.startswith("./") or ".." in x.split("/")):
        return x
    root = os.path.realpath(ROOT)
    full = os.path.realpath(x if os.path.isabs(x) else os.path.join(ROOT, x))
    if full == root or not full.startswith(root + os.sep):
        return x
    return os.path.relpath(full, root)


def _cap(lst, key):
    n = CAPS[key]
    if len(lst) > n:
        del lst[: len(lst) - n]


def add_thread(it, who, text, kind="msg", attachments=None, to=None):
    e = {"id": uuid.uuid4().hex[:8], "t": now(), "who": who, "text": text, "kind": kind}
    if attachments:
        e["attachments"] = norm_attach(list(attachments))
    if to:
        e["to"] = to
    it["thread"].append(e)
    it["activity"] = e["t"]
    _cap(it["thread"], "thread")
    return e


def push_mail(st, kind, text, item=None, agent=None):
    st["mail"].append({"id": uuid.uuid4().hex[:8], "t": now(), "kind": kind, "text": text,
                       "item": item, "agent": agent, "read": False})
    _cap(st["mail"], "mail")


def add_log(st, agent, text, item=None):
    st["logs"].append({"t": now(), "agent": agent, "item": item, "text": text})
    _cap(st["logs"], "logs")


# ---------- inbox ----------

def inbox_append(entry):
    entry = dict(entry)
    entry.setdefault("id", new_id("in"))
    entry.setdefault("t", now())
    with open(INBOX_LOCK, "a+") as lf:
        fcntl.flock(lf, fcntl.LOCK_EX)
        try:
            with open(INBOX, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        finally:
            fcntl.flock(lf, fcntl.LOCK_UN)
    return entry


def inbox_all():
    if not os.path.exists(INBOX):
        return []
    out = []
    with open(INBOX, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return out
