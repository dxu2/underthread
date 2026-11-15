#!/usr/bin/env python3
"""Underthread state store.

state.json is the single source of truth. Every writer (server, manager,
agents) goes through this module, which holds an exclusive file lock for the
whole read-modify-write. Never hand-edit state.json.

Run with no arguments for usage. Typical alias:
    alias S='python3 "$HOME/underthread/stateutil.py"'

t-oss-struct B1: the functions live in core/ (paths, ext, store, items, asks, chat, agents, handoffs, lessons, schedule_store);
this file is the command line plus a re-export of every name it used to define, so `import stateutil as S` (server.py,
tools, local/ extensions) keeps working unchanged. tests/unit/test_exports.py lists the names that must stay.
"""
import argparse
import contextlib  # noqa: F401  (re-exported: S.contextlib used to exist)
import datetime as dt
import fcntl  # noqa: F401
import json
import os
import re  # noqa: F401
import shutil  # noqa: F401
import sys
import uuid  # noqa: F401

if __name__ == "__main__":   # `python3 stateutil.py`: a later `import stateutil` in this process gets this same module (one set of hooks)
    sys.modules.setdefault("stateutil", sys.modules[__name__])
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:   # core/ lives next to this file; tools import stateutil from elsewhere
    sys.path.insert(0, _HERE)

# ---------- re-exports (t-oss-struct B1): every name below used to be defined in this file ----------
from core import migrate as MG   # noqa: E402,F401
from core import schedules as SC   # noqa: E402
sys.modules.setdefault("schedules", SC)   # t-oss-tidy: the root schedules.py shim is gone; an old `import schedules` (local extension,
#                                          your own script that imports stateutil first) still gets core/schedules.py, same module object
from core.paths import (ARCHIVE, INBOX, INBOX_LOCK, LOCAL, ROLES_DIR, ROOT, STATE, STATE_LOCK,  # noqa: E402,F401
                        has_local, local_path, role_md)
from core.ext import CLI_EXT, EXT, SET_AGENT_HOOKS, UPSERT_HOOKS, ext_dirs, load_ext  # noqa: E402,F401
from core.store import (ARCHIVE_DAYS, ARCHIVE_EVERY, CAPS, CATEGORIES, KINDS, PLATFORMS, STAGES, _ISO,  # noqa: E402,F401
                        _NeedsMigration, _ask_snapshot, _autoclose_asks, _cap, _fresh_times, _load, _parent_id, _restore,
                        _save, _shape, _ts, add_log, add_thread, archive_candidates, archive_family, archive_find,
                        archive_load, archive_sweep, archive_write, blank_state, inbox_all, inbox_append, mutate, new_id,
                        norm_attach, now, push_mail, read)
from core.items import (AUDIO_EXT, _tx_text, claim_transcripts, find_item, is_audio_path, item_transcripts,  # noqa: E402,F401
                        memo_followup, memo_name, set_media, upsert_item)
from core.asks import add_ask, answer_ask, open_asks, parse_ask, split_rec  # noqa: E402,F401
from core.chat import _chat_entry, find_msg, plain_text, quote_of, reply_fields  # noqa: E402,F401
from core.agents import HIRE_SLOTS, norm_who, open_interview, set_agent  # noqa: E402,F401
from core.handoffs import HO_LAST_MAX, _ho_seed, ho_touch, note_hand  # noqa: E402,F401
from core.lessons import _append_rule, add_lesson, decide_lesson  # noqa: E402,F401
from core.schedule_store import (SCHED_PURGE_DAYS, _aware_now, schedule_emit, schedule_find, schedule_new,  # noqa: E402,F401
                                 schedule_pause, schedules_due, schedules_import_routines, schedules_needs_tick)


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

# ---------- t-schedule-backend: the schedule commands (state side: core/schedule_store.py, rule maths: core/schedules.py) ----------
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
