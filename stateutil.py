#!/usr/bin/env python3
"""Underthread state store.

state.json is the single source of truth. Every writer (server, manager,
agents) goes through this module, which holds an exclusive file lock for the
whole read-modify-write. Never hand-edit state.json.

Run with no arguments for usage. Typical alias:
    alias S='python3 "$HOME/underthread/stateutil.py"'
"""
import argparse
import contextlib
import datetime as dt
import fcntl
import json
import os
import re
import shutil
import sys
import uuid

ROOT = os.path.dirname(os.path.abspath(__file__))
if ROOT not in sys.path:   # core/ lives next to this file; tools import stateutil from elsewhere
    sys.path.insert(0, ROOT)
from core import migrate as MG   # noqa: E402  t-oss-struct E1: data schema + ordered migrations
STATE = os.path.join(ROOT, "state.json")
STATE_LOCK = os.path.join(ROOT, ".state.lock")
INBOX = os.path.join(ROOT, "inbox.jsonl")
ARCHIVE = os.path.join(ROOT, "archive.json")   # t-perf A: done cards older than ARCHIVE_DAYS live here, out of every poll
INBOX_LOCK = os.path.join(ROOT, ".inbox.lock")
ROLES_DIR = os.path.join(ROOT, "roles")

# ===== core / local split (docs/local.md). The repository is "core": an update may replace any tracked file. "local" is your own
# layer, never tracked and never written by an update: your rules (local/roles/<id>.md), manager notes (local/manager.md), and
# extensions (local/ext/<name>/). Read core first, then local; where they differ, local wins. No local/ folder = nothing changes.
LOCAL = os.path.abspath(os.environ.get("UNDERTHREAD_LOCAL") or os.path.join(ROOT, "local"))
EXT = {}            # name -> {"dir": path, "stateutil": module or None, "server": module or None, "error": text or None}
CLI_EXT = []        # fn(subparsers): an extension adds its own stateutil subcommands
SET_AGENT_HOOKS = []   # fn(st, agent_id, agent, auto, tool): after set_agent changed an agent (inside the state lock)
UPSERT_HOOKS = []      # fn(phase, ctx): phase "before" / "after" (inside the lock) and "done" (after it); see cmd_upsert_item


def has_local():
    return os.path.isdir(LOCAL)


def local_path(*parts):
    return os.path.join(LOCAL, *parts)


def role_md(rid, write=False):
    """A role's rule file. Reading: local/roles/<id>.md when it exists, else roles/<id>.md. Writing (adopted lessons, hiring,
    transfers): local/roles/<id>.md whenever the local layer exists, so core rule files stay exactly as the update shipped them."""
    lp, cp = local_path("roles", f"{rid}.md"), os.path.join(ROLES_DIR, f"{rid}.md")
    if write:
        return lp if has_local() else cp
    return lp if os.path.exists(lp) else cp


def ext_dirs():
    base = local_path("ext")
    if not os.path.isdir(base):
        return []
    return [os.path.join(base, n) for n in sorted(os.listdir(base))
            if not n.startswith((".", "_")) and os.path.isdir(os.path.join(base, n))]


def load_ext(kind, target):
    """Import local/ext/<name>/<kind>_ext.py (kind "stateutil" or "server") for every extension and call register(target).
    Each extension folder is also put on sys.path, so its plain modules import by name. A broken extension prints one line
    to stderr and is skipped: it must never take the CLI or the dashboard down."""
    import importlib.util
    for d in ext_dirs():
        name = os.path.basename(d)
        e = EXT.setdefault(name, {"dir": d, "stateutil": None, "server": None, "error": None})
        if d not in sys.path:
            sys.path.insert(0, d)
        f = os.path.join(d, f"{kind}_ext.py")
        if not os.path.exists(f):
            continue
        try:
            spec = importlib.util.spec_from_file_location(f"_ext_{name}_{kind}", f)
            m = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(m)
            if hasattr(m, "register"):
                m.register(target)
            e[kind] = m
        except Exception as ex:  # noqa: BLE001
            e["error"] = f"{kind}: {ex!r}"
            print(f"extension {name} ({kind}) not loaded: {ex!r}", file=sys.stderr)

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
    """t-ask-autoclose: stage + open ask ids of every card, taken when a mutate starts."""
    return {i.get("id"): (i.get("stage"), {a.get("id") for a in i.get("asks") or [] if not a.get("answer") and not a.get("closed")})
            for i in st.get("items") or []}


def _autoclose_asks(st, before):
    """t-ask-autoclose: a card that moved into review or done during this mutate withdraws the asks that were already open
    before the move (same effect as ask-close). Asks added in the same mutate (a delivery that asks a question) stay, answered
    asks are never touched, and doing / todo / waiting never close anything. One path for stateutil, server.py and the sweeps."""
    for it in st.get("items") or []:
        old = before.get(it.get("id"))
        if not old or it.get("stage") not in ("review", "done") or old[0] == it.get("stage"):
            continue
        stale = [a for a in it.get("asks") or [] if a.get("id") in old[1] and not a.get("answer") and not a.get("closed")]
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


# ---------- items ----------

# ---------- t-voice-memo: voice memos ----------
# Attachments stay plain path strings. Facts about an audio file live in st["media"][path]:
#   {"kind": "audio"|"video", "dur": s, "peaks": [48 x 0..1], "tx": {"status": queued|working|done|failed, "text", "lang", "model", "secs", "error", "notified"}}
AUDIO_EXT = (".m4a", ".mp3", ".wav", ".aac", ".ogg", ".opus", ".webm")


def is_audio_path(p):
    return isinstance(p, str) and p.lower().endswith(AUDIO_EXT)


def set_media(st, path, tx=None, **fields):
    m = st.setdefault("media", {}).setdefault(path, {})
    m.update(fields)
    if tx is not None:
        m.setdefault("tx", {}).update(tx)
    return m


def _tx_text(st, path):
    tx = (st.get("media", {}).get(path) or {}).get("tx") or {}
    return tx.get("text") if tx.get("status") == "done" else None


def item_transcripts(st, it):
    paths = list(it.get("attachments") or []) + list(it.get("draft_attachments") or [])
    for e in it.get("thread") or []:
        paths += e.get("attachments") or []
    for v in it.get("versions") or []:
        paths += v.get("attachments") or []
    out = {}
    for p in paths:
        t = _tx_text(st, p) if is_audio_path(p) else None
        if t is not None:
            out[p] = t
    return out


def memo_name(path):
    return re.sub(r"^\d{8}-\d{6}-[0-9a-f]{4}-", "", path.rsplit("/", 1)[-1])


def claim_transcripts(st, entry):
    """Message just sent: fold transcripts that are already done into its inbox entry (marks them notified)."""
    added = []
    for p in entry.get("attachments") or []:
        m = st.get("media", {}).get(p) or {}
        tx = m.get("tx") or {}
        if is_audio_path(p) and tx.get("status") == "done" and not tx.get("notified"):
            tx["notified"] = now()
            added.append(f"【录音转写 · {memo_name(p)}（机器转写）】\n{tx.get('text') or '（没听到说话）'}")
    if added:
        entry["text"] = (entry.get("text") or "").rstrip() + "\n\n" + "\n\n".join(added)
        entry["transcripts"] = len(added)
    return entry


def memo_followup(st, path):
    """Transcript finished after the message went out: an inbox entry shaped like the original message's kind."""
    tx = (st.get("media", {}).get(path) or {}).get("tx") or {}
    if tx.get("status") != "done" or tx.get("notified"):
        return None
    head = f"【录音转写 · {memo_name(path)}（机器转写）】\n{tx.get('text') or '（没听到说话）'}"
    hit = lambda e: path in (e.get("attachments") or [])
    for e in reversed(st.get("chat") or []):
        if hit(e):
            tx["notified"] = now()
            return {"kind": "manager", "text": f"{head}\n\n（补充上一条消息：{(e.get('text') or '')[:80]}）", "attachments": [path], "transcript_of": path}
    for aid, msgs in (st.get("dms") or {}).items():
        for e in reversed(msgs):
            if hit(e):
                tx["notified"] = now()
                return {"kind": "dm", "agent": aid, "text": f"{head}\n\n（补充上一条私信：{(e.get('text') or '')[:80]}）", "attachments": [path], "transcript_of": path}
    for it in st.get("items") or []:
        for e in reversed(it.get("thread") or []):
            if hit(e):
                tx["notified"] = now()
                return {"kind": "comment", "item": it["id"], "to": e.get("to") or it.get("owner"), "text": f"{head}\n\n（补充这张卡上的评论：{(e.get('text') or '')[:80]}）", "attachments": [path], "transcript_of": path}
    return None   # not sent yet: the send path (claim_transcripts) picks it up


def find_item(st, item_id, restore=True):
    """t-perf A: a card that is not in state.json is looked up in archive.json. Inside mutate() (restore=True) it is moved back;
    in a plain read() a copy is returned and nothing moves. restore=False never looks in the archive."""
    for it in st["items"]:
        if it["id"] == item_id:
            return it
    if not item_id or not restore:
        return None
    if isinstance(st.get("_mut"), list):
        return _restore(st, item_id)
    return archive_find(item_id)


def upsert_item(st, fields, who="manager"):
    if fields.get("attachments"):
        fields = dict(fields, attachments=norm_attach(fields["attachments"] if isinstance(fields["attachments"], list) else [fields["attachments"]]))
    item_id = fields.get("id")
    it = find_item(st, item_id) if item_id else None
    created = it is None
    if created:
        it = {"id": item_id or new_id("q"), "title": "", "summary": "", "category": "daily",
              "stage": "todo", "kind": "task", "owner": "manager", "platforms": [], "tags": [],
              "draft": "", "versions": [], "evidence": [], "attachments": [], "confidence": None,
              "confidence_note": "", "due": None, "links": [], "thread": [], "rejects": 0,
              "created": now(), "updated": now(), "activity": now()}
        st["items"].append(it)
    for k in ("category", "stage", "kind"):
        allowed = {"category": CATEGORIES, "stage": STAGES, "kind": KINDS}[k]
        if fields.get(k) is not None and fields[k] not in allowed:
            raise SystemExit(f"bad {k} {fields[k]!r}; one of {allowed}")
    if "draft" in fields and fields["draft"] is not None and fields["draft"] != it.get("draft"):
        if it.get("draft"):
            ver = {"t": it.get("draft_at") or it["updated"], "draft": it["draft"],
                   "label": it.get("draft_label", "")}
            if it.get("draft_attachments"):
                ver["attachments"] = it["draft_attachments"]
            it["versions"].append(ver)
        it["draft_attachments"] = []  # ui6: files belong to the version they were submitted with
        it["draft_at"] = now()
        it["draft_label"] = fields.get("draft_label") or f"v{len(it['versions']) + 1}"
    if fields.get("draft") is not None and fields.get("attachments"):
        av = fields["attachments"] if isinstance(fields["attachments"], list) else [fields["attachments"]]
        it["draft_attachments"] = it.get("draft_attachments", []) + [x for x in av if x not in it.get("draft_attachments", [])]
    for k, v in fields.items():
        if v is None or k in ("id", "draft_label"):
            continue
        if k in ("evidence", "attachments", "links", "platforms", "tags") and not isinstance(v, list):
            v = [v]
        if k in ("evidence", "attachments", "links"):
            it[k] = it.get(k, []) + [x for x in v if x not in it.get(k, [])]
        else:
            it[k] = v
    it["updated"] = it["activity"] = now()
    if created:
        add_thread(it, who, f"created · {it['title']}", "event")
    return it


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


# ---------- t-open-questions: asks = questions for the user, answered by a click ----------
# it["asks"] = [{id, q, options[], other, by, t, answer: None | {opt, by, t}, closed?: time}]

def parse_ask(spec):
    """'问题 :: A | B | C' -> ('问题', ['A', 'B', 'C'])"""
    q, _, opts = spec.partition("::")
    return q.strip(), [o.strip() for o in opts.split("|") if o.strip()]


def split_rec(options):
    """t-ask-rec: a trailing * marks the asker's recommended option: ['换', '不换*'] -> (['换', '不换'], '不换'). First * wins."""
    rec, out = None, []
    for o in options:
        if o.endswith("*") and o.rstrip("*").strip():
            o = o.rstrip("*").strip()
            rec = rec or o
        out.append(o)
    return out, rec


def add_ask(it, who, q, options, other=True):
    if not q:
        raise SystemExit("ask needs a question")
    if not options:
        raise SystemExit("ask needs options, e.g. 'question :: A | B'")
    options, rec = split_rec(options)
    a = {"id": uuid.uuid4().hex[:6], "q": q, "options": options, "other": bool(other), "by": who, "t": now(), "answer": None}
    if rec:
        a["rec"] = rec
    it.setdefault("asks", []).append(a)
    add_thread(it, who, f"提问 · {q}（{' / '.join(o + ('（推荐）' if o == rec else '') for o in options)}）", "event")
    return a


def open_asks(it):
    """Asks still waiting on the user (not answered, not withdrawn)."""
    return [a for a in it.get("asks") or [] if not a.get("answer") and not a.get("closed")]


def answer_ask(it, ask_id, opt, who="me"):
    a = next((x for x in it.get("asks") or [] if x["id"] == ask_id), None)
    if not a:
        raise ValueError(f"no ask {ask_id}")
    if a.get("closed"):
        raise ValueError("这个问题已经撤回了")
    if opt not in a["options"]:
        raise ValueError("不是这个问题的选项")
    changed = bool(a.get("answer"))
    a["answer"] = {"opt": opt, "by": who, "t": now()}
    e = add_thread(it, who, f"{'改选' if changed else '回答'} · {a['q']} → {opt}", "msg", to=a.get("by"))
    e["reply_to"] = "ask:" + a["id"]   # t-option-quote: the card shows it as a quote of the question + the option
    return a, changed


def push_mail(st, kind, text, item=None, agent=None):
    st["mail"].append({"id": uuid.uuid4().hex[:8], "t": now(), "kind": kind, "text": text,
                       "item": item, "agent": agent, "read": False})
    _cap(st["mail"], "mail")


def add_log(st, agent, text, item=None):
    st["logs"].append({"t": now(), "agent": agent, "item": item, "text": text})
    _cap(st["logs"], "logs")


# ---------- agents ----------

def set_agent(st, agent_id, auto=False, **fields):
    """auto=True: the change comes from automation (a hook), not from the agent itself; extensions may treat it differently."""
    a = st["agents"].setdefault(agent_id, {"id": agent_id, "status": "idle"})
    was = a.get("status")
    tool = fields.pop("tool", None)
    for k, v in fields.items():
        if v is not None:
            a[k] = v
    new = fields.get("status")
    if new == "working" and (was != "working" or not a.get("since")):
        a["since"] = now()          # t-office-d1: when this stretch of work started; the home strip shows "23:12 起 · 12 分钟"
    elif new and new != "working":
        a.pop("since", None)
    if fields.get("status") == "idle":
        a["item"] = None
    if fields.get("status") and fields["status"] != "sleeping":
        a.pop("wake_at", None)
    # t-chrome-badge: agents[id].tool = the outside tool this agent is driving right now ("chrome", "computer", ...); "" / idle / offline / sleeping clears it
    if tool is not None:
        if tool.strip():
            if a.get("tool") != tool.strip():
                a["tool_since"] = now()
            a["tool"] = tool.strip()
        else:
            a.pop("tool", None); a.pop("tool_since", None)
    if new in ("idle", "offline", "sleeping") and not (tool and tool.strip()):
        a.pop("tool", None); a.pop("tool_since", None)
    for h in SET_AGENT_HOOKS:
        h(st, agent_id, a, auto, tool)
    a["last_seen"] = now()
    return a


# ---------- t-rb-build: explicit handoff log ----------
# st["handoffs"] = [{id, t, f, to, item, title, via}] (last CAPS["handoffs"]), st["ho_last"] = {item: agent who last held it}.
# A handoff = work on one card moves from one team role to another: set-agent X working --item I (via "dispatch" when the
# manager held it, else "pickup"), a reply on the card by a different role ("reply"), `stateutil handoff` ("dispatch"), and the
# user's 改派 on the dashboard ("reassign", server.py). The user ("me") never counts. The first time a card is seen, the last
# holder is taken from its thread (last role that wrote on it). meta.ho_start = when the log began; server.py infers the
# history before that from card threads (ho.py's rule) and marks those entries inf=1.
HO_LAST_MAX = 2000


def _ho_seed(st, it, who):
    ids = st.get("agents") or {}
    for m in reversed(it.get("thread") or []):
        w = m.get("who")
        if w in ids and w != "me":
            return w
    return None


def ho_touch(st, item_id, who):
    """The manager editing a card (upsert) takes it back silently, so its next set-agent counts as a dispatch from the manager."""
    if item_id and who in (st.get("agents") or {}):
        last = st.setdefault("ho_last", {}); last.pop(item_id, None); last[item_id] = who


def note_hand(st, item_id, who, via, frm=None):
    """Record a handoff on item_id to `who` if the card was last held by another role. Returns the entry or None."""
    ids = st.get("agents") or {}
    if not item_id or not who or who == "me" or who not in ids:
        return None
    st.setdefault("handoffs", []); last = st.setdefault("ho_last", {})
    st["meta"].setdefault("ho_start", now())
    it = find_item(st, item_id)
    prev = frm or last.get(item_id) or (_ho_seed(st, it, who) if it else None)
    last.pop(item_id, None); last[item_id] = who   # re-insert: newest at the end, oldest trimmed first
    if len(last) > HO_LAST_MAX:
        for k in list(last)[: len(last) - HO_LAST_MAX]:
            last.pop(k, None)
    if not prev or prev == who or prev == "me" or prev not in ids:
        return None
    if via in ("pickup", "auto"):
        via = "dispatch" if prev == "manager" else "pickup"
    e = {"id": uuid.uuid4().hex[:8], "t": now(), "f": prev, "to": who, "item": item_id,
         "title": (it or {}).get("title", "")[:120], "via": via}
    st["handoffs"].append(e)
    _cap(st["handoffs"], "handoffs")
    return e


# ---------- lessons ----------

def add_lesson(st, agent, text, item=None):
    pending = [l for l in st["lessons"] if l.get("item") == item and l["status"] == "pending" and item]
    if len(pending) >= 2:
        raise SystemExit("at most 2 pending lessons per item")
    l = {"id": new_id("L"), "t": now(), "agent": agent, "text": text, "item": item, "status": "pending"}
    st["lessons"].append(l)
    push_mail(st, "update", f"新规则提议 · {agent}: {text}", item, agent)
    return l


def decide_lesson(st, lesson_id, decision):
    for l in st["lessons"]:
        if l["id"] == lesson_id:
            l["status"] = "adopted" if decision == "adopt" else "dropped"
            l["decided"] = now()
            if l["status"] == "adopted":
                _append_rule(l["agent"], l["text"])
            return l
    raise SystemExit(f"no lesson {lesson_id}")


def _append_rule(agent, text):
    path = role_md(agent, write=True)   # core / local split: with a local layer, adopted rules go to local/roles/<id>.md
    os.makedirs(os.path.dirname(path), exist_ok=True)
    body = open(path, encoding="utf-8").read() if os.path.exists(path) else f"# {agent}\n"
    if "## Confirmed rules" not in body:
        body = body.rstrip() + "\n\n## Confirmed rules\n"
    body = body.rstrip() + f"\n- {text} ({dt.date.today().isoformat()})\n"
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)


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


# ---------- CLI ----------

def _text_arg(v):
    if v == "-":
        return sys.stdin.read()
    return v


def _read_file(p):
    with open(os.path.expanduser(p), encoding="utf-8") as f:
        return f.read()


def cmd_upsert(a):
    fields = json.loads(a.json) if a.json else {}
    for k in ("id", "title", "summary", "category", "stage", "kind", "owner", "due", "confidence"):
        v = getattr(a, k)
        if v is not None:
            fields[k] = v
    if a.confidence_note:
        fields["confidence_note"] = a.confidence_note
    if a.draft is not None:
        fields["draft"] = _text_arg(a.draft)
    if a.draft_file:
        fields["draft"] = _read_file(a.draft_file)
    if a.label:
        fields["draft_label"] = a.label
    for k in ("evidence", "platform", "attach", "link", "tag"):
        v = getattr(a, k)
        if v:
            fields[{"platform": "platforms", "attach": "attachments", "link": "links", "tag": "tags"}.get(k, k)] = v
    ctx = {"args": a, "fields": fields}   # UPSERT_HOOKS: "before" may edit fields; "after" sees the card; "done" runs outside the lock
    with mutate() as st:
        before = find_item(st, fields.get("id")) if fields.get("id") else None
        old_stage = before["stage"] if before else None
        ctx.update(st=st, before=before)
        for h in UPSERT_HOOKS:
            h("before", ctx)
        it = upsert_item(st, fields, who=a.who)
        ctx["item"] = it
        for h in UPSERT_HOOKS:
            h("after", ctx)
        for spec in a.ask or []:   # t-open-questions
            q, opts = parse_ask(spec)
            add_ask(it, a.who, q, opts)
        if it["stage"] == "review" and old_stage != "review":
            add_thread(it, a.who, "提交审核 · submitted for review", "event")
            push_mail(st, "update", f"待审核: {it['title']}", it["id"], a.who)
        elif old_stage and old_stage != it["stage"]:
            add_thread(it, a.who, f"stage {old_stage} → {it['stage']}", "event")
        add_log(st, a.who, f"upsert {it['id']} [{it['stage']}] {it['title']}", it["id"])
        if a.who == "manager":
            ho_touch(st, it["id"], "manager")   # t-rb-build
    ctx.pop("st", None)
    for h in UPSERT_HOOKS:
        try:
            h("done", ctx)
        except Exception as e:  # noqa: BLE001
            print(f"upsert hook failed: {e!r}", file=sys.stderr)
    print(it["id"])


def cmd_show(a):
    st = read()
    it = find_item(st, a.id)
    if not it:
        raise SystemExit(f"no item {a.id}")
    tx = item_transcripts(st, it)
    if tx:   # t-voice-memo: machine transcripts of the item's voice memos, keyed by attachment path
        it = dict(it, transcripts=tx)
    if not a.full:
        it = dict(it, versions=f"<{len(it['versions'])} older drafts>", thread=it["thread"][-30:])
    print(json.dumps(it, ensure_ascii=False, indent=1))


def cmd_archive(a):   # t-perf A: sweep now / list / put everything back
    if a.op == "list":
        for it in archive_load():
            print(f"{it['id']:<26} {str(it.get('closed') or it.get('updated'))[:16]}  {it.get('title', '')}")
        return
    with mutate() as st:
        if a.op == "sweep":
            st["meta"].pop("archive_at", None)
            n0 = len(st["items"])
            archive_sweep(st, force=True)
            print(f"archived {n0 - len(st['items'])}, archive now {len(archive_load())}")
        elif a.op == "unarchive-all":
            have = {i["id"] for i in st["items"]}
            back = [i for i in archive_load() if i.get("id") not in have]
            st["items"].extend(back)
            st["meta"]["archive_at"] = now()   # no sweep in this same write
            print(f"restored {len(back)}")
    if a.op == "unarchive-all":
        archive_write([])


def cmd_items(a):
    st = read()
    for it in st["items"]:
        if a.stage and it["stage"] != a.stage:
            continue
        if a.owner and it["owner"] != a.owner:
            continue
        if not a.all and it["stage"] == "done":
            continue
        print(f"{it['id']}\t{it['category']}\t{it['stage']}\t{it['owner']}\t{it['title']}")


def cmd_set_agent(a):
    with mutate() as st:
        set_agent(st, a.id, status=a.status, item=a.item, activity=a.activity, tool=a.tool)
        if a.status == "working" and a.item:
            note_hand(st, a.item, a.id, "auto")   # t-rb-build
        if a.activity:
            add_log(st, a.id, a.activity, a.item)
    print("ok")


# ---------- t-hr-build: HR interview cards (hire-*) ----------
# it["hire"] = {job, variant, job_name, variant_label, status: asking|applying|hired|failed|abandoned, turns, filled, hired_id}
HIRE_SLOTS = 5


def open_interview(st):
    """The one interview still running (not hired / abandoned, card not done), or None. HR talks to one person at a time."""
    for it in st.get("items", []):
        h = it.get("hire")
        if isinstance(h, dict) and it.get("stage") != "done" and h.get("status") not in ("hired", "abandoned"):
            return it
    return None


def cmd_interview(a):
    """HR: after each turn, record how many of the five things are settled (the DM bar shows 已问清 N/5)."""
    with mutate() as st:
        it = find_item(st, a.item)
        if not it or not isinstance(it.get("hire"), dict):
            sys.exit(f"{a.item} is not an interview card")
        if a.filled is not None:
            it["hire"]["filled"] = max(0, min(HIRE_SLOTS, a.filled))
        it["updated"] = now()
    print("ok")


def cmd_sleep(a):
    """Manager goes quiet until the plan's usage resets; the server queues a `wake` inbox entry after --until."""
    until = dt.datetime.fromisoformat(a.until.replace("Z", "+00:00")).astimezone()
    hhmm = until.strftime("%H:%M")
    with mutate() as st:
        set_agent(st, "manager", status="sleeping", activity=f"休眠中 · {hhmm} 复活", item=None)
        st["agents"]["manager"]["wake_at"] = until.isoformat(timespec="seconds")
        add_log(st, "manager", f"休眠：{a.reason or '用量快到上限'}，{hhmm} 复活")
        push_mail(st, "update", f"管家休眠 · {hhmm} 复活。{a.reason or '用量快到上限'}；新指令会排队，醒来自动处理。", None, "manager")
    print("ok")


def cmd_ask(a):
    with mutate() as st:
        it = find_item(st, a.item)
        if not it:
            raise SystemExit(f"no item {a.item}")
        x = add_ask(it, a.who, _text_arg(a.question), [o.strip() for o in (a.options or "").split("|") if o.strip()], other=not a.no_other)
        add_log(st, a.who, f"ask {x['id']}: {x['q']}", a.item)
    print(x["id"])


def cmd_ask_close(a):
    with mutate() as st:
        it = find_item(st, a.item)
        if not it:
            raise SystemExit(f"no item {a.item}")
        x = next((q for q in it.get("asks") or [] if q["id"] == a.ask_id), None)
        if not x:
            raise SystemExit(f"no ask {a.ask_id} on {a.item}")
        x["closed"] = now()
        add_thread(it, a.who, f"撤回问题 · {x['q']}", "event")
        add_log(st, a.who, f"ask-close {x['id']}", a.item)
    print("ok")


def cmd_log(a):
    with mutate() as st:
        it = find_item(st, a.item)
        if not it:
            raise SystemExit(f"no item {a.item}")
        add_thread(it, a.agent, _text_arg(a.text), "log")
        add_log(st, a.agent, _text_arg(a.text), a.item)
    print("ok")


def cmd_reply(a):
    text = _text_arg(a.text)
    with mutate() as st:
        it = find_item(st, a.item)
        if not it:
            raise SystemExit(f"no item {a.item}")
        note_hand(st, a.item, a.agent, "reply")   # t-rb-build: before add_thread, so the seed sees the previous writer
        add_thread(it, a.agent, text, "msg", attachments=a.attach)
        push_mail(st, "reply", text[:200], a.item, a.agent)
        add_log(st, a.agent, f"reply on {a.item}", a.item)
    print("ok")


def cmd_handoff(a):   # t-rb-build: the manager records a dispatch explicitly
    with mutate() as st:
        if not find_item(st, a.item):
            raise SystemExit(f"no item {a.item}")
        if a.to not in (st.get("agents") or {}):
            raise SystemExit(f"unknown agent {a.to}")
        e = note_hand(st, a.item, a.to, a.via, frm=a.frm)
    print(json.dumps(e, ensure_ascii=False) if e else "no handoff (same holder)")


def cmd_handoffs(a):
    st = read()
    for e in (st.get("handoffs") or [])[-a.n:]:
        print(f"{e['t'][5:16]}  {e['f']:>9} -> {e['to']:<9} {e['via']:<8} {e['item']}  {e.get('title', '')[:40]}")


# t-option-quote: a reply that quotes an earlier chat / DM message (a quick-option click). The quote is taken from the server's own copy,
# never from the browser: rq = {who, text} (plain text, first 80 chars) stays readable after the original is trimmed out of the list.
def plain_text(t):
    t = re.sub(r"```[\s\S]*?```", " ", str(t or ""))
    t = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", t)
    t = re.sub(r"^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+", "", t, flags=re.M)
    t = re.sub(r"[*_`~]+", "", t)
    return re.sub(r"\s+", " ", t).strip()


def find_msg(lst, mid):
    if not mid or not isinstance(mid, str):
        return None
    return next((m for m in reversed(lst or []) if m.get("id") == mid), None)


def quote_of(src):
    return {"who": src.get("who"), "text": plain_text(src.get("text"))[:80]}


def reply_fields(src):
    """inbox fields for a reply: reply_to = message id, reply_q = original text (head + tail, 300 chars), reply_opts = its options."""
    q = plain_text(src.get("text"))
    if len(q) > 300:
        q = q[:120] + " … " + q[-170:]
    out = {"reply_to": src.get("id"), "reply_q": q}
    if src.get("options"):
        out["reply_opts"] = [re.sub(r"\s*[*＊]\s*$", "", o) for o in src["options"]]
    return out


def _chat_entry(who, text, options=None, attachments=None, quote=None, multi=False):
    e = {"id": uuid.uuid4().hex[:8], "t": now(), "who": who, "text": text}
    if quote:
        e["reply_to"] = quote.get("id")
        e["rq"] = quote_of(quote)
    if options:
        e["options"] = [o.strip() for o in options.split("|") if o.strip()]
        if multi and len(e["options"]) > 1:
            e["multi"] = True   # t-hr-multiselect: chips toggle, one 发送（n） sends 「A、B」
    if attachments:
        e["attachments"] = norm_attach(list(attachments))
    return e


def cmd_say_mgr(a):
    with mutate() as st:
        st["chat"].append(_chat_entry("manager", _text_arg(a.text), a.options, a.attach, multi=a.multi))
        _cap(st["chat"], "chat")
        push_mail(st, "reply", "管家: " + _text_arg(a.text)[:160], None, "manager")
    print("ok")


def cmd_dm(a):
    with mutate() as st:
        lst = st["dms"].setdefault(a.agent, [])
        lst.append(_chat_entry(a.agent, _text_arg(a.text), a.options, a.attach, multi=a.multi))
        _cap(lst, "dm")
        push_mail(st, "reply", f"{a.agent}: " + _text_arg(a.text)[:160], None, a.agent)
    print("ok")


def cmd_inbox_pending(a):
    acked = set(read()["meta"]["inbox_acked"])
    rows = [e for e in inbox_all() if e["id"] not in acked]
    for e in rows:
        print(json.dumps(e, ensure_ascii=False))
    if not rows:
        print("(inbox empty)", file=sys.stderr)


def cmd_inbox_ack(a):
    with mutate() as st:
        acked = st["meta"]["inbox_acked"]
        ids = a.ids
        if ids == ["all"]:
            have = set(acked)
            ids = [e["id"] for e in inbox_all() if e["id"] not in have]
        acked.extend(i for i in ids if i not in acked)
        _cap(acked, "inbox_acked")
    print(f"acked {len(ids)}")


def cmd_lesson(a):
    with mutate() as st:
        l = add_lesson(st, a.agent, a.text, a.item)
    print(l["id"])


def cmd_notice(a):
    with mutate() as st:
        until = None
        if a.hours:
            until = (dt.datetime.now().astimezone() + dt.timedelta(hours=a.hours)).isoformat(timespec="seconds")
        st["notices"].append({"id": new_id("n"), "t": now(), "text": a.text, "level": a.level, "until": until})
        _cap(st["notices"], "notices")
    print("ok")


def cmd_report(a):
    body = _read_file(a.file) if a.file else _text_arg(a.text)
    with mutate() as st:
        r = {"id": new_id("r"), "t": now(), "date": a.date or dt.date.today().isoformat(),
             "title": a.title or "日报", "body": body}
        st["reports"].append(r)
        _cap(st["reports"], "reports")
        st["meta"]["last_report_date"] = r["date"]
        push_mail(st, "update", f"{r['title']} · {r['date']}", None, "manager")
    print(r["id"])


def cmd_set_stamina(a):
    with mutate() as st:
        if a.pct is not None:
            st["meta"]["stamina"] = {"pct": a.pct, "note": a.note or "", "at": now()}
        if a.focus is not None:
            st["meta"]["focus"] = {"pct": a.focus, "at": now()}
    print("ok")


def cmd_set_usage(a):
    """Plan usage for the stamina orb (from the desktop app's usage tool, or tools/statusline.py)."""
    win = lambda used, reset: None if used is None else {"used": float(used), "resets_at": reset}
    with mutate() as st:
        old = st["meta"].get("usage") or {}
        st["meta"]["usage"] = {
            "five_hour": win(a.five, a.five_reset) or old.get("five_hour"),
            "seven_day": win(a.week, a.week_reset) or old.get("seven_day"),
            "context": a.context if a.context is not None else old.get("context"),
            "source": a.source, "at": now()}
    print("ok")


def main():
    p = argparse.ArgumentParser(prog="stateutil.py", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd")

    u = sub.add_parser("upsert-item", help="create or update an item (prints id)")
    u.add_argument("--id"); u.add_argument("--title"); u.add_argument("--summary")
    u.add_argument("--category", choices=CATEGORIES); u.add_argument("--stage", choices=STAGES)
    u.add_argument("--kind", choices=KINDS); u.add_argument("--owner"); u.add_argument("--due")
    u.add_argument("--confidence", choices=["high", "med", "low"]); u.add_argument("--confidence-note")
    u.add_argument("--draft", help="markdown, or - for stdin"); u.add_argument("--draft-file")
    u.add_argument("--label", help="draft version label, e.g. 'v2: tighter hook'")
    u.add_argument("--evidence", action="append"); u.add_argument("--platform", action="append", choices=PLATFORMS)
    u.add_argument("--attach", action="append", help="local file path"); u.add_argument("--link", action="append")
    u.add_argument("--tag", action="append"); u.add_argument("--json", help="raw JSON fields to merge")
    u.add_argument("--who", default="manager", help="agent id doing the write")
    u.add_argument("--ask", action="append", help="question for the user with clickable options: 'question :: A | B* | C' (repeatable; a trailing * marks your recommended option)")
    u.set_defaults(fn=cmd_upsert)

    s = sub.add_parser("show", help="print one item"); s.add_argument("id")
    s.add_argument("--full", action="store_true"); s.set_defaults(fn=cmd_show)

    s = sub.add_parser("archive", help="t-perf A: sweep | list | unarchive-all"); s.add_argument("op", choices=["sweep", "list", "unarchive-all"]); s.set_defaults(fn=cmd_archive)
    s = sub.add_parser("items", help="list open items"); s.add_argument("--stage"); s.add_argument("--owner")
    s.add_argument("--all", action="store_true"); s.set_defaults(fn=cmd_items)

    s = sub.add_parser("set-agent", help="set agent status"); s.add_argument("id")
    s.add_argument("--status", choices=["idle", "working", "offline", "sleeping"]); s.add_argument("--item")
    s.add_argument("--activity")
    s.add_argument("--tool", help='outside tool in use, e.g. chrome / computer; "" = done (idle/offline also clears it)')
    s.set_defaults(fn=cmd_set_agent)

    s = sub.add_parser("sleep", help="manager sleeps until the usage window resets")
    s.add_argument("--until", required=True, help="ISO reset time (resetsAt from the usage tool)")
    s.add_argument("--reason"); s.set_defaults(fn=cmd_sleep)

    s = sub.add_parser("log", help="work log line on an item"); s.add_argument("item"); s.add_argument("agent")
    s.add_argument("text"); s.set_defaults(fn=cmd_log)

    s = sub.add_parser("reply", help="message to the user on an item"); s.add_argument("item"); s.add_argument("agent")
    s.add_argument("text"); s.add_argument("--attach", action="append"); s.set_defaults(fn=cmd_reply)

    s = sub.add_parser("say-mgr", help="manager chat message to the user"); s.add_argument("text")
    s.add_argument("--options", help="quick replies, 'a|b|c'"); s.add_argument("--attach", action="append")
    s.add_argument("--multi", action="store_true", help="the user may pick several options, sent as 'a、b'")
    s.set_defaults(fn=cmd_say_mgr)

    s = sub.add_parser("dm", help="agent DM to the user"); s.add_argument("agent"); s.add_argument("text")
    s.add_argument("--options"); s.add_argument("--attach", action="append")
    s.add_argument("--multi", action="store_true", help="the user may pick several options, sent as 'a、b'"); s.set_defaults(fn=cmd_dm)

    s = sub.add_parser("inbox-pending", help="print unacked inbox entries (JSON lines)")
    s.set_defaults(fn=cmd_inbox_pending)
    s = sub.add_parser("inbox-ack", help="ack inbox ids (or 'all')"); s.add_argument("ids", nargs="+")
    s.set_defaults(fn=cmd_inbox_ack)

    s = sub.add_parser("lesson", help="propose a one-line rule"); s.add_argument("agent"); s.add_argument("text")
    s.add_argument("--item"); s.set_defaults(fn=cmd_lesson)

    s = sub.add_parser("notice", help="ticker banner"); s.add_argument("text")
    s.add_argument("--level", default="info", choices=["info", "urgent"]); s.add_argument("--hours", type=float)
    s.set_defaults(fn=cmd_notice)

    s = sub.add_parser("report", help="publish a daily report"); s.add_argument("--file"); s.add_argument("--text")
    s.add_argument("--title"); s.add_argument("--date"); s.set_defaults(fn=cmd_report)

    s = sub.add_parser("set-stamina", help="budget / focus bars"); s.add_argument("--pct", type=int)
    s.add_argument("--note"); s.add_argument("--focus", type=int); s.set_defaults(fn=cmd_set_stamina)

    s = sub.add_parser("set-usage", help="plan usage for the stamina orb")
    s.add_argument("--five", type=float, help="5-hour window percent USED"); s.add_argument("--five-reset", help="ISO reset time")
    s.add_argument("--week", type=float, help="weekly percent USED"); s.add_argument("--week-reset", help="ISO reset time")
    s.add_argument("--context", type=int, help="manager context-window percent used"); s.add_argument("--source", default="manager")
    s.set_defaults(fn=cmd_set_usage)

    _add_ask_parsers(sub)
    _add_schedule_parsers(sub)   # t-schedule-backend
    for fn in CLI_EXT:   # core / local split: extension subcommands (local/ext/<name>/stateutil_ext.py)
        fn(sub)
    s = sub.add_parser("handoff", help="t-rb-build: record that work on a card moves to another role (prints the entry)")
    s.add_argument("item"); s.add_argument("to"); s.add_argument("--from", dest="frm", help="previous holder (default: whoever last held the card)")
    s.add_argument("--via", default="dispatch", choices=["dispatch", "pickup", "reply", "reassign"]); s.set_defaults(fn=cmd_handoff)
    s = sub.add_parser("handoffs", help="t-rb-build: print the last N handoffs"); s.add_argument("-n", type=int, default=20); s.set_defaults(fn=cmd_handoffs)
    a = p.parse_args()
    if not a.cmd:
        p.print_help()
        return
    for k in ("who", "agent"):   # q-1030-2214
        if isinstance(getattr(a, k, None), str):
            setattr(a, k, norm_who(getattr(a, k)))
    a.fn(a)


def norm_who(w):
    """q-1030-2214: a writer id that is not a roster id but a role's own name (e.g. its name_en, "steward" for manager) is stored as that role's id,
    so the dashboard finds its avatar. Unknown ids and "me" stay as they are."""
    if not w or w == "me":
        return w
    try:
        ags = read().get("agents") or {}
    except Exception:  # noqa: BLE001
        return w
    if w in ags:
        return w
    k = w.strip().lower()
    for aid, ag in ags.items():
        if any(n and str(n).strip().lower() == k for n in (ag.get("name_en"), ag.get("name"))):
            return aid
    return w


def cmd_transcript(a):   # t-voice-memo
    m = read().get("media", {}).get(a.path)
    if not m:
        raise SystemExit(f"no media entry for {a.path} (not a voice memo, or uploaded before transcription existed)")
    tx = m.get("tx") or {}
    if tx.get("status") != "done":
        raise SystemExit(f"transcript {tx.get('status') or 'missing'}" + (f": {tx.get('error')}" if tx.get("error") else ""))
    print(tx.get("text") or "")


def _add_ask_parsers(sub):   # t-open-questions
    s = sub.add_parser("transcript", help="print the machine transcript of a voice memo (t-voice-memo)")
    s.add_argument("path", help="attachment path, e.g. uploads/2026...-memo.m4a"); s.set_defaults(fn=cmd_transcript)
    s = sub.add_parser("ask", help="ask the user a question with clickable options (prints the ask id)")
    s.add_argument("item"); s.add_argument("who"); s.add_argument("question", help="text, or - for stdin")
    s.add_argument("--options", required=True, help="'A|B*|C' (a trailing * marks your recommended option)"); s.add_argument("--no-other", action="store_true", help="hide the 其他… button")
    s.set_defaults(fn=cmd_ask)
    s = sub.add_parser("interview", help="t-hr-build: HR records interview progress on a hire-* card")
    s.add_argument("item"); s.add_argument("--filled", type=int, help="how many of the five things are settled (0-5)")
    s.set_defaults(fn=cmd_interview)
    s = sub.add_parser("ask-close", help="withdraw a question that no longer applies")
    s.add_argument("item"); s.add_argument("ask_id"); s.add_argument("--who", default="manager")
    s.set_defaults(fn=cmd_ask_close)


# ---------- t-schedule-backend: one-sentence schedules (state.schedules) ----------
# The manager turns "一小时后提醒我 X" / "以后每周一 9 点跑 Y" into `schedule add`. server.py schedule_loop (30 s) calls schedules_due():
# a due entry drops an inbox entry for the manager (kind schedule_due; imported config routines keep kind routine_due), and a reminder
# also goes into the mailbox, which push_loop sends to the phone with no manager needed. Rule maths live in schedules.py.
import schedules as SC   # noqa: E402

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
    if kind not in SC.KINDS:
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


def _sched_line(s):
    st_ = "开" if s.get("enabled") else ("完" if s.get("finished") else "停")
    nx = (s.get("next") or "—")[:16].replace("T", " ")
    who = (s.get("task") or {}).get("agent") or ""
    return f"{s['id']:<22} {st_} {s['kind']:<6} {SC.describe(s['rule']):<18} 下次 {nx:<16} {s['title']}{' @' + who if who else ''}"


def _sched_preview(s):
    nxt = SC.parse_iso(s["next"])
    ups = [t.astimezone(SC.zone(s["tz"])) for t in [nxt] + SC.upcoming(s["rule"], s["tz"], nxt, 2)]
    return (f"{'提醒' if s['kind'] == 'remind' else '任务'} · {SC.describe(s['rule'])} · {s['title']}"
            + (f" → {s['task']['agent']}" if s["task"].get("agent") else "") + f"\n时区 {s['tz']}\n接下来："
            + "".join(f"\n  {t.strftime('%Y-%m-%d %a %H:%M %Z')}" for t in ups))


def _rule_arg(a):
    try:
        if getattr(a, "rule_json", None):
            return SC.check_rule(json.loads(a.rule_json))
        return SC.parse_rule(a.rule, a.tz)
    except SC.RuleError:
        raise
    except Exception as e:
        raise SC.RuleError(str(e))


def _end_arg(a):
    if getattr(a, "until", None):
        return {"until": dt.date.fromisoformat(a.until).isoformat()}
    if getattr(a, "count", None):
        return {"count": int(a.count)}
    return None


def _sched_cmd(fn):
    def run(a):
        try:
            fn(a)
        except SC.RuleError as e:
            print(f"error: {e}", file=sys.stderr)
            sys.exit(2)
    return run


def cmd_schedule_add(a):
    rule = _rule_arg(a)
    st0 = read()
    s = schedule_new(st0, a.title, a.kind, rule, tz=a.tz, text=_text_arg(a.text) if a.text else "", agent=a.agent, item=a.item,
                     said=a.said or "", by=a.who, end=_end_arg(a))
    if a.dry_run:
        print("(dry run, nothing saved)\n" + _sched_preview(s))
        return
    with mutate() as st:
        st.setdefault("schedules", []).append(s)
    print(s["id"]); print(_sched_preview(s))


def cmd_schedule_list(a):
    ss = [s for s in read().get("schedules") or [] if not s.get("deleted") and (a.all or s.get("enabled"))]
    if a.json:
        print(json.dumps(ss, ensure_ascii=False, indent=1)); return
    for s in sorted(ss, key=lambda x: x.get("next") or "9"):
        print(_sched_line(s))
    if not ss:
        print("(没有定时)" if a.all else "(没有启用中的定时；--all 看全部)")


def cmd_schedule_show(a):
    s = schedule_find(read(), a.id)
    if not s:
        raise SC.RuleError(f"没有定时 {a.id}")
    print(json.dumps(s, ensure_ascii=False, indent=1))


def _sched_mut(a, f):
    with mutate() as st:
        s = schedule_find(st, a.id)
        if not s:
            raise SC.RuleError(f"没有定时 {a.id}")
        r = f(st, s)
    return s, r


def cmd_schedule_pause(a):
    s, _ = _sched_mut(a, lambda st, s: schedule_pause(st, s, True, by=a.who)); print("paused", s["id"])


def cmd_schedule_resume(a):
    s, _ = _sched_mut(a, lambda st, s: schedule_pause(st, s, False, by=a.who)); print("resumed", s["id"], "next", s["next"])


def cmd_schedule_rm(a):
    s, _ = _sched_mut(a, lambda st, s: s.update(deleted=now(), enabled=False)); print("removed", s["id"])


def cmd_schedule_edit(a):
    def f(st, s):
        if a.title: s["title"] = a.title.strip()
        if a.kind: s["kind"] = a.kind
        if a.text is not None: s["task"]["text"] = _text_arg(a.text)
        if a.agent is not None: s["task"]["agent"] = a.agent or None
        if a.item is not None: s["task"]["item"] = a.item or None
        if a.tz: SC.zone(a.tz); s["tz"] = a.tz
        if a.rule or a.rule_json: s["rule"] = _rule_arg(a)
        if a.until or a.count: s["end"] = _end_arg(a)
        if s.get("enabled"):
            nxt = SC.next_after(s["rule"], s["tz"], _aware_now(s["tz"]))
            if not nxt:
                raise SC.RuleError(f"{SC.describe(s['rule'])} 已经过去了")
            s["next"] = SC.iso(nxt)
    s, _ = _sched_mut(a, f); print(_sched_preview(s) if s.get("next") else _sched_line(s))


def cmd_schedule_fire(a):
    def f(st, s):
        nowt = _aware_now(s.get("tz"))
        s.setdefault("runs", []).append({"for": SC.iso(nowt), "at": SC.iso(nowt), "late": 0, "manual": True})
        del s["runs"][:-SC.RUNS_KEEP]
        s["last"] = SC.iso(nowt)
        return schedule_emit(st, s, SC.iso(nowt), 0, manual=True)
    s, e = _sched_mut(a, f); print(json.dumps(e, ensure_ascii=False))


def _add_schedule_parsers(sub):
    def common(s, add):
        s.add_argument("--title", required=add); s.add_argument("--kind", choices=list(SC.KINDS), default="remind" if add else None)
        s.add_argument("--rule", required=False, help="'once 2026-11-08 09:00' | 'in 90m' | 'daily 09:00' | 'weekly mon,thu 09:00' | 'monthly 1|last 18:00'")
        s.add_argument("--rule-json", help="rule as JSON (rare)")
        s.add_argument("--text", default=None, help="task text, or - for stdin"); s.add_argument("--agent", default=None); s.add_argument("--item", default=None)
        s.add_argument("--tz", help="IANA zone (default: this machine's)"); s.add_argument("--until", help="last date YYYY-MM-DD"); s.add_argument("--count", type=int)
        s.add_argument("--who", default="manager")
    sc = sub.add_parser("schedule", help="t-schedule-backend: one-off / daily / weekly / monthly schedules").add_subparsers(dest="op", required=True)
    s = sc.add_parser("add", help="new schedule (prints id + the next 3 runs)"); common(s, True)
    s.add_argument("--said", help="the user's own sentence"); s.add_argument("--dry-run", action="store_true", help="parse and preview only; saves nothing")
    s.set_defaults(fn=_sched_cmd(lambda a: (_need_rule(a), cmd_schedule_add(a))))
    s = sc.add_parser("list"); s.add_argument("--all", action="store_true"); s.add_argument("--json", action="store_true"); s.set_defaults(fn=_sched_cmd(cmd_schedule_list))
    for name, fn in (("show", cmd_schedule_show), ("pause", cmd_schedule_pause), ("resume", cmd_schedule_resume), ("rm", cmd_schedule_rm), ("fire", cmd_schedule_fire)):
        s = sc.add_parser(name); s.add_argument("id"); s.add_argument("--who", default="manager"); s.set_defaults(fn=_sched_cmd(fn))
    s = sc.add_parser("edit"); s.add_argument("id"); common(s, False); s.set_defaults(fn=_sched_cmd(cmd_schedule_edit))
    s = sub.add_parser("schema", help="t-oss-struct E1: data schema numbers (code / state / config / roster) and the migrations log")
    s.add_argument("--json", action="store_true"); s.set_defaults(fn=cmd_schema)
    s = sub.add_parser("config", help="t-oss-struct E2: effective config").add_subparsers(dest="op", required=True)
    s = s.add_parser("show", help="every effective value and whether it is a default or yours"); s.add_argument("--json", action="store_true")
    s.set_defaults(fn=cmd_config_show)


def cmd_schema(a):
    st = read()   # migrates first if this code is newer than the data
    info = MG.status(ROOT, st)
    info["log"] = st["meta"].get("migrations") or []
    if a.json:
        print(json.dumps(info, ensure_ascii=False, indent=1))
        return
    print(f"code {info['code']} ({', '.join(info['steps']) or 'no steps'})")
    for t in ("state", "config", "roster"):
        v = info.get(t)
        print(f"  {t:7} {'missing' if v is None else v}" + ("  (newer than this code)" if t in info["ahead"] else ""))
    print("  config / roster carry _schema only after a step changed them; 0 there is normal")
    for e in info["log"][-10:]:
        print(f"  {e.get('at', '')[:19]}  {e.get('from')} -> {e.get('to')}  {', '.join(e.get('ran') or []) or '(stamp only)'}")


def cmd_config_show(a):
    from core import config as C
    rows = C.sources(ROOT)
    if a.json:
        print(json.dumps([{"key": k, "value": v, "from": f} for k, v, f in rows], ensure_ascii=False, indent=1))
        return
    for k, v, f in rows:
        print(f"{k:28} {json.dumps(v, ensure_ascii=False)[:60]:60} {'你改的' if f == 'yours' else '默认'}")


def _need_rule(a):
    if not (a.rule or a.rule_json):
        raise SC.RuleError("要 --rule，例如 --rule 'in 1h' 或 --rule 'weekly mon 09:00'")


load_ext("stateutil", sys.modules[__name__])   # core / local split: last, so an extension sees every function above

if __name__ == "__main__":
    main()
