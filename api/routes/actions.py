"""POST /api/action: your clicks. act() is the frame (one state lock: find the card, run the kind's handler, stamp the card,
log; then the after-lock step and the inbox entry). The handlers for card / chat / board kinds are below; snooze / unsnooze are in
api/routes/snooze.py, routine_* / schedule_* in api/routes/schedules.py. Every handler takes one Act and fills a.inbox."""
import datetime as dt
import re

from api.ctx import S
from api.router import route, action, ACTIONS, ME, OpenAsks
from api.routes.hr import HR_ID, XFER_MAX, _hire_apply

TOUCH = ("approve", "reject", "done", "comment", "answer", "reopen", "set_stage", "archive")   # ri1103-P2: you dealt with it: the snooze ends
NO_LOG = ("widget_layout", "chat_seen")   # t-widget-drag: dragging tiles is not activity worth a log line; t-ri1113-a: nor is reading a chat


class Act:
    """One /api/action call. A handler reads body / kind / st (the locked state) / it (the card named by body.item, or None) / att,
    and sets inbox (the entry to append, or None), it (when it picks the card itself) and later = (key, fn): fn() runs after the lock
    is released and its result goes into the inbox entry and the answer under key (批准入职 runs new_role.py that way)."""
    __slots__ = ("body", "kind", "st", "it", "att", "inbox", "later")

    def __init__(self, body, st, it, att):
        self.body, self.kind, self.st, self.it, self.att = body, body.get("kind"), st, it, att
        self.inbox = None
        self.later = None


def act(body):
    k = body.get("kind")
    with S.mutate() as st:
        it = S.find_item(st, body["item"]) if body.get("item") else None
        if body.get("item") and not it:
            raise ValueError(f"no item {body['item']}")
        att = body.get("attachments") or []
        try:
            fn = ACTIONS.get(k)
        except TypeError:   # an unhashable kind
            fn = None
        if fn is None:
            raise ValueError(f"unknown action {k}")
        a = Act(body, st, it, att)
        fn(a)
        it, inbox = a.it, a.inbox
        if it is not None:
            it["updated"] = S.now()
            if k in TOUCH:
                it.pop("snooze", None)
                it.pop("snoozed", None)
        if k not in NO_LOG:
            S.add_log(st, ME, f"{k}" + (f" {it['id']}" if it else ""), it["id"] if it else None)

    later = None
    if a.later:
        key, go = a.later
        later = go()
        inbox[key] = later
    if inbox and any(S.is_audio_path(p) for p in inbox.get("attachments") or []):
        with S.mutate() as st:   # t-voice-memo: transcripts already finished ride along with the message
            S.claim_transcripts(st, inbox)
    if inbox:
        inbox = S.inbox_append(inbox)
    out = {"ok": True, "inbox": inbox["id"] if inbox else None}
    if a.later:
        out[a.later[0]] = later
    return out


@route("POST", "/api/action")
def _action(h, u, body):
    return h._send(200, act(body))


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


# ---------- card kinds ----------

@action("new_task")
def _new_task(a):
    body, st, att = a.body, a.st, a.att
    text = body.get("text", "").strip()
    title = body.get("title") or text.split("\n")[0][:80] or "新委托"
    it = a.it = S.upsert_item(st, {"title": title, "summary": text, "category": body.get("category") or "daily",
                                   "owner": body.get("owner") or "manager", "platforms": body.get("platforms") or [],
                                   "due": body.get("due"), "attachments": att, "stage": "todo"}, who=ME)
    it["triage"] = not body.get("category")
    S.add_thread(it, ME, text, "msg", attachments=att)
    a.inbox = {"kind": "new_task", "item": it["id"], "text": text, "owner": body.get("owner"),
               "category": body.get("category"), "attachments": att}


@action("chat")
def _chat(a):
    body, st, att = a.body, a.st, a.att
    src = S.find_msg(st["chat"], body.get("reply_to"))   # t-option-quote: unknown / trimmed ids are ignored, the message still goes out
    st["chat"].append(S._chat_entry(ME, body["text"], attachments=att, quote=src))
    inbox = a.inbox = {"kind": "manager", "text": body["text"], "attachments": att}
    if src:
        inbox.update(S.reply_fields(src))


@action("dm")
def _dm(a):
    body, st, att = a.body, a.st, a.att
    if body["agent"] == "manager":
        raise ValueError("use chat for the manager")
    lst = st["dms"].setdefault(body["agent"], [])
    src = S.find_msg(lst, body.get("reply_to"))
    lst.append(S._chat_entry(ME, body["text"], attachments=att, quote=src))
    inbox = a.inbox = {"kind": "dm", "agent": body["agent"], "text": body["text"], "attachments": att}
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


@action("comment")
def _comment(a):
    body, it, att = a.body, a.it, a.att
    to = body.get("to") or it["owner"]
    S.add_thread(it, ME, body["text"], "msg", attachments=att, to=to)
    if it["stage"] in ("review", "done"):
        it["stage"] = "doing"
    a.inbox = {"kind": "comment", "item": it["id"], "to": to, "text": body["text"], "attachments": att}


@action("approve")
def _approve(a):
    body, it = a.body, a.it
    skipped, oa = _guard_asks(it, body)
    plan = it.get("kind") == "plan"
    if isinstance(it.get("hire"), dict) and it.get("kind") == "deliverable":   # t-hr-build: 批准入职
        if it["hire"].get("status") in ("applying", "hired", "abandoned", "transferred", "undone"):
            raise ValueError("这张卡已经处理过了")
        it["hire"]["status"] = "applying"
        it["approved"] = S.now()
        S.add_thread(it, ME, ("批准调岗" if it["hire"].get("mode") == "transfer" else "批准入职") + (f" · {body['note']}" if body.get("note") else "") + skipped, "approve")
        cid = it["id"]
        a.later = ("hire", lambda: _hire_apply(cid))   # new_role.py runs after the lock is released
        a.inbox = {"kind": "approve", "item": it["id"], "was": it.get("kind"), "note": body.get("note")}
    else:
        it["stage"] = "doing" if plan else "done"
        it["approved"] = S.now()
        if not plan:
            it["closed"] = S.now()
        # t-btn-names: the log line uses the button's own words (批准开工 / 验收 · 关单 / 回答); the action kind stays "approve"
        lbl = "批准开工" if plan else "回答" if it.get("kind") == "question" else "验收 · 关单"
        S.add_thread(it, ME, lbl + (f" · {body['note']}" if body.get("note") else "") + skipped, "approve")
        a.inbox = {"kind": "approve", "item": it["id"], "was": it.get("kind"), "note": body.get("note")}
    if oa:
        a.inbox["open_asks"] = oa


@action("reject")
def _reject(a):
    it = a.it
    reason = a.body.get("reason", "").strip()
    if not reason:
        raise ValueError("reject needs a reason")
    it["stage"] = "doing"
    it["rejects"] = it.get("rejects", 0) + 1
    S.add_thread(it, ME, f"驳回 · {reason}", "reject")
    a.inbox = {"kind": "reject", "item": it["id"], "reason": reason}


@action("done")
def _done(a):
    it = a.it
    skipped, oa = _guard_asks(it, a.body)
    it["stage"] = "done"
    it["closed"] = S.now()
    S.add_thread(it, ME, "完成 · mission complete" + skipped, "done")
    a.inbox = {"kind": "done", "item": it["id"]}
    if oa:
        a.inbox["open_asks"] = oa


@action("answer")
def _answer(a):   # t-open-questions: a click on one of an ask's options; the stage stays as it is
    body, it = a.body, a.it
    x, changed = S.answer_ask(it, body.get("ask"), body.get("opt"), ME)
    a.inbox = {"kind": "answer", "item": it["id"], "ask": x["id"], "q": x["q"], "opt": x["answer"]["opt"],
               "to": x.get("by") or it["owner"], "changed": changed, "reply_to": "ask:" + x["id"]}


@action("reopen")
def _reopen(a):
    it = a.it
    it["stage"] = "doing"
    it.pop("closed", None)
    S.add_thread(it, ME, "重开 · reopened", "event")
    a.inbox = {"kind": "reopen", "item": it["id"]}


@action("reassign")
def _reassign(a):
    body, st, it = a.body, a.st, a.it
    if body["owner"] != it.get("owner"):   # t-rb-build: the user moving a card between roles is a handoff
        S.note_hand(st, it["id"], body["owner"], "reassign", frm=it.get("owner"))
    it["owner"] = body["owner"]
    S.add_thread(it, ME, f"改派给 {body['owner']}", "event")
    a.inbox = {"kind": "dispatch", "item": it["id"], "owner": body["owner"]}


@action("set_category")
def _set_category(a):
    a.it["category"] = a.body["category"]
    S.add_thread(a.it, ME, f"分类 → {a.body['category']}", "event")


@action("set_stage")
def _set_stage(a):
    body, it = a.body, a.it
    if body["stage"] not in S.STAGES:
        raise ValueError("bad stage")
    old = it["stage"]
    skipped, oa = _guard_asks(it, body) if body["stage"] == "done" else ("", None)
    it["stage"] = body["stage"]
    S.add_thread(it, ME, f"stage {old} → {body['stage']}" + skipped, "event")
    if body["stage"] == "done":
        it["closed"] = S.now()
        a.inbox = {"kind": "done", "item": it["id"]}
        if oa:
            a.inbox["open_asks"] = oa


@action("archive")
def _archive(a):
    a.it["archived"] = True


@action("lesson")
def _lesson(a):
    x = S.decide_lesson(a.st, a.body["id"], a.body["decision"])
    a.inbox = {"kind": "lesson", "id": x["id"], "decision": x["status"], "agent": x["agent"], "text": x["text"]}


# ---------- board kinds (no card) ----------

@action("calendar_add")
def _calendar_add(a):
    body, st = a.body, a.st
    st["calendar"].append({"id": S.new_id("c"), "date": body.get("date") or dt.date.today().isoformat(),
                           "time": body.get("time", ""), "title": body["title"]})
    st["calendar"].sort(key=lambda c: (c["date"], c["time"]))


@action("calendar_del")
def _calendar_del(a):
    a.st["calendar"] = [c for c in a.st["calendar"] if c["id"] != a.body["id"]]


@action("notice_dismiss")
def _notice_dismiss(a):
    a.st["notices"] = [n for n in a.st["notices"] if n["id"] != a.body["id"]]


@action("mail_read")
def _mail_read(a):
    ids = set(a.body.get("ids") or [])
    for m in a.st["mail"]:
        if a.body.get("all") or m["id"] in ids:
            m["read"] = True


@action("chat_seen")
def _chat_seen(a):   # t-ri1113-a P1: how far the user has read each chat / DM, kept on the server (meta.chat_seen) so every device agrees
    aid, t = str(a.body.get("agent") or ""), str(a.body.get("t") or "")
    if not re.fullmatch(r"[a-z0-9_-]{1,40}", aid) or not re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?([+-]\d\d:\d\d|Z)?", t):
        raise ValueError("bad chat_seen")
    cs = a.st["meta"].setdefault("chat_seen", {})
    was = cs.get(aid, "")
    if t > was:   # only ever forward
        cs[aid] = t
    print(f"[{S.now()}] chat_seen {aid} {t}" + ("" if t > was else f" (kept {was})"), flush=True)   # cross-device path: always logged


@action("widget_layout")
def _widget_layout(a):   # t-widget-drag: the desktop widget home's order / sizes, shared by every browser (meta.widgets)
    body, st = a.body, a.st
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


@action("stamina")
def _stamina(a):
    a.st["meta"]["stamina"] = {"pct": int(a.body["pct"]), "note": a.body.get("note", "手动"), "at": S.now()}


@action("ping")
def _ping(a):
    a.inbox = {"kind": "ping"}
    if a.body.get("note"):  # t-imp-p4: e.g. 「刷新用量」 from the 系统状态 panel
        a.inbox["note"] = str(a.body["note"])[:200]


@action("report_request")
def _report_request(a):
    a.inbox = {"kind": "report_request"}
