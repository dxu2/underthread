"""Golden snapshots of the server's answers (t-oss-struct B0). A refactor that moves code around (core/ split, route table,
action table) must leave every answer below byte-for-byte the same.

What runs: a fixture server copy (tests/api/_server.py) on a FIXED clock with seeded ids (tests/api/_frozen), HOME pointed at
an empty folder (no transcripts, no keychain), then in this order
  1. every GET endpoint,
  2. every /api/action kind (plus the refusals), each with the card it touched and the inbox lines it wrote,
  3. the stateutil CLI (every subcommand that does not need a real file or a timer),
  4. a few hiring calls (new_role.py plan),
  5. the whole board at the end (/api/state, inbox.jsonl, roster.json).
Each answer is stored in tests/api/golden/<section>.json, keyed by a short name. Only things that cannot be fixed are masked
(see VOLATILE / scrub): the temp folder, the port, pid / uptime / disk numbers, the VAPID key and ?v= content hashes.

    python3 tests/run.py api -k golden             compare
    GOLDEN_UPDATE=1 python3 tests/run.py api -k golden   rewrite the snapshots (only when a change is MEANT to change answers;
                                                    say so in the commit and the CHANGELOG)
"""
import difflib
import json
import os
import re
import shutil
import tempfile
import unittest

from tests.api._server import FixtureServer

HERE = os.path.dirname(os.path.abspath(__file__))
GOLDEN = os.path.join(HERE, "golden")
FROZEN = "2026-01-20T10:00:00+00:00"
UPDATE = os.environ.get("GOLDEN_UPDATE") == "1"

# dotted paths (per section key prefix) whose values depend on the machine or the moment the process started
VOLATILE = {
    "health": ("server.started", "server.uptime", "server.pid", "disk.free", "disk.total", "disk.work", "disk.work_at",
               "image"),   # t-oss-gen-s3: which picture backend this machine has
    "push_key": ("key",),
    "usage": ("at",),   # usage_roll stamps its cache with the real clock (time.time)
    "ext": ("version",),   # VERSION moves with every release
    "secret": ("helper",),   # whether git ships git-credential-osxkeychain (macOS yes, Linux CI no)
    "state": ("meta.avv",   # t-avatar-live-refresh: mtimes of the avatar manifests (a checkout sets them)
              "meta.setup.opt"),   # t-onb-polish: whether this machine has Codex / Tailscale (background probe)
}
_V = re.compile(r"\?v=[0-9a-zA-Z._-]+")


def _mask(o, path):
    head, _, rest = path.partition(".")
    if isinstance(o, dict) and head in o:
        if rest:
            _mask(o[head], rest)
        else:
            o[head] = "<volatile>"


class Golden(unittest.TestCase):
    maxDiff = None

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="rt-golden-")
        home = os.path.join(cls.tmp, "home")
        os.makedirs(home)
        cls.env = {"PYTHONPATH": os.path.join(HERE, "_frozen"), "RT_FROZEN_NOW": FROZEN, "RT_FROZEN_SEQ": os.path.join(cls.tmp, "seq"),
                   "TZ": "UTC", "HOME": home, "LANG": "C.UTF-8"}
        cls.s = FixtureServer(env=cls.env)
        cls.got = {}
        try:
            cls._run()
        except Exception:
            cls.s.stop()
            raise

    @classmethod
    def tearDownClass(cls):
        cls.s.stop()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    # ---------- recording ----------
    @classmethod
    def scrub(cls, v):
        s = json.dumps(v, ensure_ascii=False, sort_keys=True)
        s = s.replace(os.path.realpath(cls.s.root), "<ROOT>").replace(cls.s.root, "<ROOT>")   # realpath first: on macOS /tmp is /private/tmp (meta.setup.root).replace(cls.s.dir, "<TMP>").replace(cls.tmp, "<TMP>").replace(str(cls.s.port), "<PORT>")
        return json.loads(s)

    @classmethod
    def put(cls, section, key, v):
        v = cls.scrub(v)
        for pre, paths in VOLATILE.items():
            if key == pre or key.startswith(pre + "_"):
                for p in paths:
                    _mask(v.get("body") if isinstance(v, dict) and "body" in v else v, p)
        cls.got.setdefault(section, {})[key] = v

    @classmethod
    def body(cls, code, raw, ctype=None):
        try:
            b = json.loads(raw)
        except ValueError:
            t = raw.decode("utf-8", "replace")
            if "<html" in t[:200].lower() or "<!doctype" in t[:200].lower():   # index.html: which scripts / styles, not their hashes
                b = {"html_refs": [_V.sub("?v=<h>", m) for m in re.findall(r'(?:src|href)="([^"]+)"', t)]}
                im = re.search(r'<script type="importmap">(.*?)</script>', t)   # S9: which scripts the import map versions
                if im:
                    b["import_map"] = {k: _V.sub("?v=<h>", v) for k, v in sorted(json.loads(im.group(1))["imports"].items())}
            else:
                b = {"bytes": len(raw)}
        return {"code": code, "body": b}

    @classmethod
    def get(cls, key, path):
        c, raw = cls.s.get(path)
        cls.put("get", key, cls.body(c, raw))

    @classmethod
    def inbox_len(cls):
        return len(cls.s.inbox())

    @classmethod
    def item(cls, iid):
        c, raw = cls.s.get(f"/api/item?id={iid}")
        return json.loads(raw) if c == 200 else {"code": c}

    @classmethod
    def act(cls, key, body, item=None):
        n = cls.inbox_len()
        c, raw = cls.s.action(body)
        rec = cls.body(c, raw)
        rec["inbox"] = cls.s.inbox()[n:]
        if item:
            rec["item"] = cls.item(item)
        cls.put("actions", key, rec)

    @classmethod
    def su(cls, key, *args, stdin=None):
        import subprocess
        import sys
        env = dict(os.environ, **cls.env)
        r = subprocess.run([sys.executable, "stateutil.py", *args], cwd=cls.s.root, capture_output=True, text=True, env=env, input=stdin)
        out, err = r.stdout, r.stderr.strip().splitlines()[-1:] if r.stderr.strip() else []
        if args[:1] == ("--help",):   # argparse layout differs between Python versions: keep only the subcommand list
            m = re.search(r"\{([^}]*)\}", out)
            out = sorted(m.group(1).split(",")) if m else out
        if r.returncode == 2:   # argparse usage error: its wording differs between Python versions
            err = ["<usage error>"]
        cls.put("cli", key, {"rc": r.returncode, "out": out, "err": err})

    @classmethod
    def _run(cls):
        s = cls.s
        # 1. GET
        st = s.json("/api/state")
        for k, p in (("health", "/api/health"), ("state", "/api/state"), ("state_slim", "/api/state?slim=1"),
                     ("state_same", f"/api/state?rev={st['meta']['rev']}"), ("archive", "/api/archive"),
                     ("history_chat", "/api/history?k=chat&n=5"), ("history_mail", "/api/history?k=mail"),
                     ("history_logs", "/api/history?k=logs"), ("history_logs_agent", "/api/history?k=logs&agent=writer"),
                     ("history_bad", "/api/history?k=nope"), ("handoffs", "/api/handoffs"),
                     ("item", "/api/item?id=fx-4"), ("item_ask", "/api/item?id=fx-7"), ("item_missing", "/api/item?id=nope"),
                     ("secret_github", "/api/secret/github"), ("usage", "/api/usage"), ("docs", "/api/docs"),
                     ("doc", "/api/doc?path=docs/local.md"), ("doc_bad", "/api/doc?path=../etc/passwd"),
                     ("memory", "/api/memory"), ("memory_writer", "/api/memory?id=writer"), ("memory_bad", "/api/memory?id=nope"),
                     ("templates", "/api/templates"), ("retire_plan", "/api/retire-plan?id=writer"), ("retire_plan_bad", "/api/retire-plan?id=nope"),
                     ("transfer_plan", "/api/transfer-plan?item=fx-1"), ("tpl_av_missing", "/api/tpl-av?job=nope&v=x"),
                     ("roster", "/api/roster"), ("thumb_missing", "/api/thumb?p=uploads/nope.png"),
                     ("push_key", "/api/push/key"), ("push_latest", "/api/push/latest"), ("push_status", "/api/push/status"),
                     ("push_history", "/api/push/history"), ("index", "/"), ("sw", "/sw.js"), ("manifest", "/manifest.webmanifest"),
                     ("avatars_index", "/avatars/_s/index.json"), ("static_missing", "/static/nope.js"), ("static_escape", "/static/..%2fstate.json"),
                     ("voice_off", "/api/voice/health"), ("not_found", "/nope"), ("avatar_choices_bad", "/api/avatar-choices?id=nope"),
                     ("ext", "/api/ext"), ("static_ext_missing", "/static/ext/nope/x.js")):
            cls.get(k, p)

        # 2. actions, in an order where each one finds what it needs
        a = cls.act
        a("new_task", {"kind": "new_task", "text": "Golden task\nsecond line", "owner": "writer", "category": "side"})
        new_id = next(i["id"] for i in s.json("/api/state")["items"] if i["title"] == "Golden task")
        cls.put("actions", "new_task_card", cls.item(new_id))
        a("new_task_triage", {"kind": "new_task", "text": "No category given"})
        a("chat", {"kind": "chat", "text": "golden chat"})
        cid = s.json("/api/state")["chat"][-1]["id"]
        a("chat_reply", {"kind": "chat", "text": "quoting", "reply_to": cid})
        a("dm", {"kind": "dm", "agent": "writer", "text": "golden dm"})
        a("dm_manager_refused", {"kind": "dm", "agent": "manager", "text": "x"})
        a("comment", {"kind": "comment", "item": "fx-5", "text": "golden comment"}, "fx-5")
        a("comment_to", {"kind": "comment", "item": "fx-1", "text": "to scout", "to": "scout"}, "fx-1")
        a("approve_plan", {"kind": "approve", "item": "fx-3", "note": "go"}, "fx-3")
        a("approve_deliverable", {"kind": "approve", "item": "q-demo-email"}, "q-demo-email")
        a("reject_no_reason", {"kind": "reject", "item": "q-demo-plan", "reason": " "}, "q-demo-plan")
        a("reject", {"kind": "reject", "item": "q-demo-plan", "reason": "tighter"}, "q-demo-plan")
        ask = (cls.item("fx-7").get("asks") or [{}])[0]
        a("answer", {"kind": "answer", "item": "fx-7", "ask": ask.get("id"), "opt": (ask.get("options") or ["x"])[0]}, "fx-7")
        a("done_open_ask", {"kind": "done", "item": "q-demo-ask"}, "q-demo-ask")
        a("reopen", {"kind": "reopen", "item": "fx-4"}, "fx-4")
        a("reassign", {"kind": "reassign", "item": "fx-6", "owner": "ops"}, "fx-6")
        a("set_category", {"kind": "set_category", "item": "fx-6", "category": "urgent"}, "fx-6")
        a("set_stage_bad", {"kind": "set_stage", "item": "fx-6", "stage": "nope"}, "fx-6")
        a("set_stage_done", {"kind": "set_stage", "item": "fx-6", "stage": "done"}, "fx-6")
        a("snooze_bad", {"kind": "snooze", "item": "fx-5", "preset": "nope"}, "fx-5")
        a("snooze_reply", {"kind": "snooze", "item": "fx-1", "preset": "reply"}, "fx-1")
        a("snooze_tomorrow", {"kind": "snooze", "item": "q-demo-plan", "preset": "morning"}, "q-demo-plan")
        a("unsnooze", {"kind": "unsnooze", "item": "fx-1"}, "fx-1")
        a("archive", {"kind": "archive", "item": "fx-4"}, "fx-4")
        les = s.json("/api/state")["lessons"]
        a("lesson", {"kind": "lesson", "id": les[0]["id"] if les else "nope", "decision": "adopt"})
        a("calendar_add", {"kind": "calendar_add", "title": "Golden shoot", "date": "2026-01-22", "time": "09:30"})
        cal = s.json("/api/state")["calendar"]
        a("calendar_del", {"kind": "calendar_del", "id": cal[0]["id"] if cal else "nope"})
        nts = s.json("/api/state")["notices"]
        a("notice_dismiss", {"kind": "notice_dismiss", "id": nts[0]["id"] if nts else "nope"})
        a("mail_read", {"kind": "mail_read", "ids": [m["id"] for m in s.json("/api/state")["mail"][:2]]})
        a("mail_read_all", {"kind": "mail_read", "all": True})
        a("chat_seen", {"kind": "chat_seen", "agent": "writer", "t": "2026-01-20T09:00:00+00:00"})
        a("chat_seen_bad", {"kind": "chat_seen", "agent": "Bad Id", "t": "x"})
        a("widget_layout", {"kind": "widget_layout", "layout": [["inbox", "m"], ["team", "s"]]})
        a("widget_layout_bad", {"kind": "widget_layout", "layout": [["inbox", "x"]]})
        a("widget_layout_reset", {"kind": "widget_layout", "reset": True})
        a("widget_layout_seen", {"kind": "widget_layout", "layout": [["team", "m"], ["demo-ext_1", "s"]], "seen": ["team", "demo-ext_1", "usage"]})
        a("studio_mode_on", {"kind": "studio_mode", "mode": "on"})   # t-oss-gen-s5
        a("studio_mode_bad", {"kind": "studio_mode", "mode": "maybe"})
        a("studio_mode_auto", {"kind": "studio_mode", "mode": "auto"})
        a("widget_layout_seen_bad", {"kind": "widget_layout", "layout": [["team", "m"]], "seen": ["Bad id"]})
        a("widget_layout_reset_keeps_seen", {"kind": "widget_layout", "reset": True})
        a("role_look", {"kind": "role_look", "id": "writer", "name": "Golden Quill", "name_en": "Goldie"})   # t-roster-rail
        a("role_look_reset", {"kind": "role_look", "id": "writer", "name": "", "name_en": ""})
        a("role_look_bad_avatar", {"kind": "role_look", "id": "writer", "avatar": "../state.json"})
        a("role_look_bad_name", {"kind": "role_look", "id": "writer", "name": "<b>x</b>"})
        a("role_look_unknown", {"kind": "role_look", "id": "nope", "name": "x"})
        a("stamina", {"kind": "stamina", "pct": 42, "note": "golden"})
        a("ping", {"kind": "ping", "note": "刷新用量"})
        a("report_request", {"kind": "report_request"})
        a("routine_pause_not_standing", {"kind": "routine_pause", "item": "fx-2"}, "fx-2")
        a("routine_pause_unknown", {"kind": "routine_pause", "routine": "nope"})
        sch = s.json("/api/state")["schedules"]
        sid = sch[0]["id"] if sch else "nope"
        a("schedule_pause", {"kind": "schedule_pause", "schedule": sid})
        a("schedule_resume", {"kind": "schedule_resume", "schedule": sid})
        a("schedule_fire", {"kind": "schedule_fire", "schedule": sid})
        a("schedule_rm", {"kind": "schedule_rm", "schedule": sch[-1]["id"] if sch else "nope"})
        a("schedule_unknown", {"kind": "schedule_pause", "schedule": "nope"})
        a("unknown_kind", {"kind": "nope"})
        a("unknown_item", {"kind": "comment", "item": "nope", "text": "x"})

        # 3. stateutil CLI
        u = cls.su
        u("show", "show", "fx-7")
        u("show_full", "show", "fx-2", "--full")
        u("show_missing", "show", "nope")
        u("items", "items")
        u("items_review", "items", "--stage", "review")
        u("items_owner_all", "items", "--owner", "writer", "--all")
        u("schema", "schema")
        u("schema_json", "schema", "--json")
        u("config_show", "config", "show")
        u("config_show_json", "config", "show", "--json")
        u("inbox_pending", "inbox-pending")
        u("set_agent", "set-agent", "writer", "--status", "working", "--item", "fx-2", "--activity", "golden status")
        u("set_agent_tool", "set-agent", "artist", "--status", "working", "--tool", "chrome")
        u("set_agent_by_name", "set-agent", "Writer", "--status", "idle")
        u("log", "log", "fx-2", "writer", "golden log line")
        u("reply", "reply", "fx-2", "writer", "golden reply")
        u("upsert_new", "upsert-item", "--title", "Golden CLI card", "--who", "scout", "--category", "daily", "--kind", "task", "--stage", "todo", "--platform", "bili")
        u("upsert_draft", "upsert-item", "--id", "fx-2", "--who", "writer", "--kind", "deliverable", "--stage", "review", "--draft", "-",
          "--label", "v2: golden", "--confidence", "med", "--confidence-note", "fixed clock", "--evidence", "golden", "--ask", "Which? :: A | B* | C",
          stdin="# Golden draft\n\nbody\n")
        u("upsert_bad_stage", "upsert-item", "--id", "fx-2", "--stage", "nope")
        u("ask", "ask", "fx-5", "ops", "Ship it?", "--options", "Yes*|No")
        st2 = s.json("/api/state")
        open_ask = next((x for x in (next(i for i in st2["items"] if i["id"] == "fx-5").get("asks") or []) if not x.get("answer")), {})
        u("ask_close", "ask-close", "fx-5", open_ask.get("id", "nope"), "--who", "ops")
        u("say_mgr", "say-mgr", "golden manager line", "--options", "A|B", "--multi")
        u("dm_cli", "dm", "scout", "golden scout dm", "--options", "x|y")
        u("handoff", "handoff", "fx-2", "director", "--via", "dispatch")
        u("handoffs_cli", "handoffs", "-n", "5")
        u("lesson_cli", "lesson", "writer", "golden rule", "--item", "fx-2")
        u("notice", "notice", "golden notice", "--level", "urgent", "--hours", "2")
        u("report", "report", "--text", "golden report", "--title", "Daily", "--date", "2026-01-20")
        u("set_stamina", "set-stamina", "--pct", "70", "--note", "cli", "--focus", "3")
        u("set_usage", "set-usage", "--five", "12.5", "--five-reset", "2026-01-20T12:00:00+00:00", "--week", "40", "--context", "33")
        u("sched_add_dry", "schedule", "add", "--title", "Golden remind", "--rule", "daily 09:00", "--tz", "UTC", "--dry-run")
        u("sched_add", "schedule", "add", "--title", "Golden remind", "--kind", "remind", "--rule", "weekly mon 09:00", "--tz", "UTC", "--said", "每周一提醒")
        u("sched_bad_rule", "schedule", "add", "--title", "x", "--rule", "whenever")
        u("sched_list", "schedule", "list", "--all")
        u("sched_list_json", "schedule", "list", "--json")
        sid2 = next((x["id"] for x in s.json("/api/state")["schedules"] if x.get("title") == "Golden remind"), "nope")
        u("sched_show", "schedule", "show", sid2)
        u("sched_edit", "schedule", "edit", sid2, "--rule", "daily 08:00", "--tz", "UTC")
        u("sched_pause", "schedule", "pause", sid2)
        u("sched_resume", "schedule", "resume", sid2)
        u("sched_fire", "schedule", "fire", sid2)
        u("sched_rm", "schedule", "rm", sid2)
        u("archive_list", "archive", "list")
        u("archive_sweep", "archive", "sweep")
        u("transcript_missing", "transcript", "uploads/nope.m4a")
        u("interview_missing", "interview", "nope", "--filled", "2")
        u("sleep", "sleep", "--until", "2026-01-20T15:00:00+00:00", "--reason", "golden")
        u("set_agent_wake", "set-agent", "manager", "--status", "idle")
        u("inbox_ack_all", "inbox-ack", "all")
        u("inbox_pending_after", "inbox-pending")
        u("help", "--help")

        # 4. hiring: new_role.py plan (reads the roster) + the refusals
        def hire(key, body):
            c, raw = s.req("/api/hire", "POST", body, {"Content-Type": "application/json", "Origin": f"http://127.0.0.1:{s.port}", "X-Underthread": "1"})
            cls.put("hire", key, cls.body(c, raw))
        tpls = s.json("/api/templates")
        tl = (tpls.get("list") or tpls.get("templates") or []) if isinstance(tpls, dict) else tpls
        t = tl[0] if tl else {"key": "nope", "variants": [{"key": "nope"}]}
        hire("plan", {"op": "plan", "job": t["key"], "variant": t["variants"][0]["key"], "id": "golden", "name": "Golden"})
        hire("plan_bad_id", {"op": "plan", "job": t["key"], "variant": t["variants"][0]["key"], "id": "Bad Id", "name": "x"})
        hire("retire_core", {"op": "retire", "id": "manager"})
        hire("unknown_job", {"op": "plan", "job": "nope", "variant": "x", "id": "golden", "name": "x"})

        # 5. the whole board at the end
        cls.get("state_end", "/api/state")
        cls.put("end", "inbox", s.inbox())
        with open(os.path.join(s.root, "roster.json"), encoding="utf-8") as f:
            cls.put("end", "roster_file", json.load(f))
        with open(os.path.join(s.root, "state.json"), encoding="utf-8") as f:
            cls.put("end", "state_file", json.load(f))

    # ---------- compare ----------
    def _check(self, section):
        got = self.got.get(section, {})
        path = os.path.join(GOLDEN, f"{section}.json")
        if UPDATE:
            os.makedirs(GOLDEN, exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                json.dump(got, f, ensure_ascii=False, indent=1, sort_keys=True)
                f.write("\n")
            return
        self.assertTrue(os.path.exists(path), f"no snapshot {path}; run with GOLDEN_UPDATE=1 once")
        with open(path, encoding="utf-8") as f:
            want = json.load(f)
        self.assertEqual(sorted(got), sorted(want), f"{section}: snapshot keys differ")
        bad = []
        for k in sorted(want):
            if got[k] != want[k]:
                a = json.dumps(want[k], ensure_ascii=False, indent=1, sort_keys=True).splitlines()
                b = json.dumps(got[k], ensure_ascii=False, indent=1, sort_keys=True).splitlines()
                bad.append(f"--- {section}.{k}\n" + "\n".join(list(difflib.unified_diff(a, b, "golden", "now", lineterm="", n=2))[:60]))
        self.assertFalse(bad, "\n".join(bad[:8]) + (f"\n... and {len(bad) - 8} more" if len(bad) > 8 else ""))

    def test_get(self):
        self._check("get")

    def test_actions(self):
        self._check("actions")

    def test_cli(self):
        self._check("cli")

    def test_hire(self):
        self._check("hire")

    def test_end_state(self):
        self._check("end")


if __name__ == "__main__":
    unittest.main()
