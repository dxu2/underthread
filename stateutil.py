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
STATE = os.path.join(ROOT, "state.json")
STATE_LOCK = os.path.join(ROOT, ".state.lock")
INBOX = os.path.join(ROOT, "inbox.jsonl")
INBOX_LOCK = os.path.join(ROOT, ".inbox.lock")
ROLES_DIR = os.path.join(ROOT, "roles")

CATEGORIES = ["main", "side", "daily", "urgent", "ongoing"]
STAGES = ["todo", "doing", "review", "waiting", "done"]
KINDS = ["plan", "deliverable", "question", "task"]
PLATFORMS = ["bili", "yt", "xhs"]
CAPS = {"logs": 3000, "mail": 1500, "chat": 1500, "dm": 400, "thread": 400,
        "inbox_acked": 5000, "reports": 200, "notices": 100}


def now():
    return dt.datetime.now().astimezone().isoformat(timespec="seconds")


def new_id(prefix):
    return f"{prefix}-{dt.datetime.now():%m%d}-{uuid.uuid4().hex[:4]}"


def blank_state():
    return {
        "meta": {"rev": 0, "updated": now(), "stamina": {"pct": None, "note": "", "at": None},
                 "focus": {"pct": None, "at": None}, "inbox_acked": [], "last_report_date": None},
        "items": [], "agents": {}, "logs": [], "lessons": [], "notices": [], "reports": [],
        "calendar": [], "chat": [], "dms": {}, "mail": [], "media": {},
    }


def _shape(st):
    base = blank_state()
    for k, v in base.items():
        st.setdefault(k, v)
    for k, v in base["meta"].items():
        st["meta"].setdefault(k, v)
    return st


def _load():
    if not os.path.exists(STATE):
        example = os.path.join(ROOT, "state.example.json")
        if os.path.exists(example):
            shutil.copy(example, STATE)
        else:
            return blank_state()
    with open(STATE, encoding="utf-8") as f:
        return _shape(json.load(f))


def _save(st):
    tmp = STATE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(st, f, ensure_ascii=False, indent=1)
    os.replace(tmp, STATE)


@contextlib.contextmanager
def mutate():
    """Locked read-modify-write. Bumps meta.rev on exit."""
    with open(STATE_LOCK, "a+") as lf:
        fcntl.flock(lf, fcntl.LOCK_EX)
        try:
            st = _load()
            yield st
            st["meta"]["rev"] = int(st["meta"].get("rev", 0)) + 1
            st["meta"]["updated"] = now()
            _save(st)
        finally:
            fcntl.flock(lf, fcntl.LOCK_UN)


def read():
    with open(STATE_LOCK, "a+") as lf:
        fcntl.flock(lf, fcntl.LOCK_SH)
        try:
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


def find_item(st, item_id):
    for it in st["items"]:
        if it["id"] == item_id:
            return it
    return None


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
    add_thread(it, who, f"{'改选' if changed else '回答'} · {a['q']} → {opt}", "msg", to=a.get("by"))
    return a, changed


def push_mail(st, kind, text, item=None, agent=None):
    st["mail"].append({"id": uuid.uuid4().hex[:8], "t": now(), "kind": kind, "text": text,
                       "item": item, "agent": agent, "read": False})
    _cap(st["mail"], "mail")


def add_log(st, agent, text, item=None):
    st["logs"].append({"t": now(), "agent": agent, "item": item, "text": text})
    _cap(st["logs"], "logs")


# ---------- agents ----------

def set_agent(st, agent_id, **fields):
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
    a["last_seen"] = now()
    return a


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
    os.makedirs(ROLES_DIR, exist_ok=True)
    path = os.path.join(ROLES_DIR, f"{agent}.md")
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
    with mutate() as st:
        before = find_item(st, fields.get("id")) if fields.get("id") else None
        old_stage = before["stage"] if before else None
        it = upsert_item(st, fields, who=a.who)
        for spec in a.ask or []:   # t-open-questions
            q, opts = parse_ask(spec)
            add_ask(it, a.who, q, opts)
        if it["stage"] == "review" and old_stage != "review":
            add_thread(it, a.who, "提交审核 · submitted for review", "event")
            push_mail(st, "update", f"待审核: {it['title']}", it["id"], a.who)
        elif old_stage and old_stage != it["stage"]:
            add_thread(it, a.who, f"stage {old_stage} → {it['stage']}", "event")
        add_log(st, a.who, f"upsert {it['id']} [{it['stage']}] {it['title']}", it["id"])
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
        if a.activity:
            add_log(st, a.id, a.activity, a.item)
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
        add_thread(it, a.agent, text, "msg", attachments=a.attach)
        push_mail(st, "reply", text[:200], a.item, a.agent)
        add_log(st, a.agent, f"reply on {a.item}", a.item)
    print("ok")


def _chat_entry(who, text, options=None, attachments=None):
    e = {"id": uuid.uuid4().hex[:8], "t": now(), "who": who, "text": text}
    if options:
        e["options"] = [o.strip() for o in options.split("|") if o.strip()]
    if attachments:
        e["attachments"] = norm_attach(list(attachments))
    return e


def cmd_say_mgr(a):
    with mutate() as st:
        st["chat"].append(_chat_entry("manager", _text_arg(a.text), a.options, a.attach))
        _cap(st["chat"], "chat")
        push_mail(st, "reply", "管家: " + _text_arg(a.text)[:160], None, "manager")
    print("ok")


def cmd_dm(a):
    with mutate() as st:
        lst = st["dms"].setdefault(a.agent, [])
        lst.append(_chat_entry(a.agent, _text_arg(a.text), a.options, a.attach))
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
    s.set_defaults(fn=cmd_say_mgr)

    s = sub.add_parser("dm", help="agent DM to the user"); s.add_argument("agent"); s.add_argument("text")
    s.add_argument("--options"); s.add_argument("--attach", action="append"); s.set_defaults(fn=cmd_dm)

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
    s = sub.add_parser("ask-close", help="withdraw a question that no longer applies")
    s.add_argument("item"); s.add_argument("ask_id"); s.add_argument("--who", default="manager")
    s.set_defaults(fn=cmd_ask_close)


if __name__ == "__main__":
    main()
