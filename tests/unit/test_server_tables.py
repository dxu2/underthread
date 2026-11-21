"""t-oss-struct S7 (B2-B4): server.py is split into api/ with a route table, an action table and api/loops.py.

What is pinned here (the answers themselves are pinned by tests/api/test_golden.py):
  - every route and every action kind, with the module that owns it, so a moved or dropped endpoint is a visible diff;
  - every top-level name the single-file server.py had is still reachable as server.<name> (local/ext server extensions get
    the server module in register(srv) and used srv.S, srv.EXT_GET, ...);
  - the import rule: core/ never imports api/ or server, api/ never imports server;
  - server.py is the entry point only, and the request handler has no per-path if/elif left.
The server is imported in a throwaway copy (no local/, no state.json of yours), in a subprocess so its module globals do not leak."""
import ast
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SKIP = {".git", ".demo", "uploads", "work", "logs", "local", "node_modules", "__pycache__", "archive", ".live", ".claude", "tests",
        "web", "avatars", "templates", "docs", "state.json", "roster.json", "config.json", "inbox.jsonl", "archive.json", "push_subs.json"}

# Top-level names of server.py at v0.1.0 (before the split), helpers and imported modules included.
BEFORE = """ART_DIRS AVATARS BaseHTTPRequestHandler C CHAT_KEEP CODEX_SESS CONFIG CORE_IDS DOC_DIRS DOC_FILES EXT_GET GH GZ_MIN H HR_ID
HR_Q HT_OPS KEEPALIVE_IDLE MAIL_KEEP MANAGER_MEM MAX_UPLOAD MEMO_DEFAULT MEM_BASE MG NR OpenAsks PUSH_DEFAULT PUSH_EN PUSH_SUBS
QuietServer ROOT ROUTINES_LOG_KEEP S SLIM_LOGS SNOOZE_PRESETS SNOOZE_REPLY_DAYS STAGE_SPARE START TIERS TPL_AV_CACHE TPL_DIR
ThreadingHTTPServer UPLOADS USAGE VC WEB WP XFER_MAX _AR _ART _CODEX _GUARD_LOG _GZC _GZL _HEX _HOI _HOSTS _PSC _PSL _RID _RV _SV
_VH _agent_name _ask_brief _busy_msg _codex_files _codex_tail _comfy _ep_short _fsig _guard_asks _gz_type _health _hire_apply
_ho_infer _hr_on _ht_lesson _mail_target _mem_dir _mem_files _nr _nr_mod _on_user _owned_schedules _plog _pt _push _retire_restore
_role _roster_mtime _routine_runs _row_lang _row_update _save_subs _subs _tpl_list _ts _unacked_count _uniq_id _upload_name _vhash
_work_size act archive_body archive_cached archive_role art_scan art_sig base64 codex_quota comfy_probe_loop digest_payload dt
ensure_live_files ext_web guard_log gzip handoffs health hire hire_legacy history host_name host_ok in_quiet index_html interview
json list_docs load_json local_names log_routine_run main memo_post mimetypes notify os parse_qs pending_count public_item
public_state public_state_cached push_class push_history push_loop push_payload push_prefs push_status push_text_en push_tick re
read_doc read_text_safe rehire_role report_loop retire_plan retire_role rev_unacked rname role_memory roster_watch_loop routine_item
routines_fire routines_view save_upload save_upload_stream schedule_loop schedules_fire schedules_import shutil slim_state
snooze_active snooze_due snooze_loop snooze_tick snooze_until socket stage_seats subprocess sync_roster sys templates_payload
threading tier_allows time tpl_avatar transcribe_async transfer_plan transfer_start trim_state undo_retire undo_update unpark unquote
urlparse usage_roll uuid wake_loop web_file""".split()

# (method, path, flags, module). "*" = path prefix. flags: raw = the handler reads the body; late = after the extension routes.
ROUTES = [
    ("GET", "/", "", "api.routes.web"), ("GET", "/api/archive", "", "api.routes.state"), ("GET", "/api/doc", "", "api.routes.docs"),
    ("GET", "/api/docs", "", "api.routes.docs"), ("GET", "/api/ext", "", "api.routes.health"), ("GET", "/api/feeds", "", "api.routes.feeds"), ("GET", "/api/handoffs", "", "api.routes.state"),
    ("GET", "/api/health", "", "api.routes.health"), ("GET", "/api/history", "", "api.routes.state"),
    ("GET", "/api/item", "", "api.routes.state"), ("GET", "/api/memory", "", "api.routes.docs"),
    ("GET", "/api/push/history", "", "api.routes.push"), ("GET", "/api/push/key", "", "api.routes.push"),
    ("GET", "/api/push/latest", "", "api.routes.push"), ("GET", "/api/push/status", "", "api.routes.push"),
    ("GET", "/api/presets", "", "api.routes.hr"), ("POST", "/api/preset", "", "api.routes.hr"),
    ("GET", "/api/retire-plan", "", "api.routes.hr"), ("GET", "/api/roster", "", "api.routes.state"),
    ("GET", "/api/secret/github", "", "api.routes.secret"), ("GET", "/api/setup", "", "api.routes.setup"), ("GET", "/api/state", "", "api.routes.state"),
    ("GET", "/api/templates", "", "api.routes.hr"), ("GET", "/api/thumb", "", "api.routes.media"),
    ("GET", "/api/tpl-av", "", "api.routes.hr"), ("GET", "/api/transfer-plan", "", "api.routes.hr"),
    ("GET", "/api/update", "", "api.routes.update"), ("POST", "/api/update", "", "api.routes.update"),
    ("GET", "/api/usage", "", "api.routes.health"), ("GET", "/api/voice/*", "", "api.routes.voice"),
    ("GET", "/index.html", "", "api.routes.web"), ("GET", "/manifest.webmanifest", "", "api.routes.web"),
    ("GET", "/sw.js", "", "api.routes.web"),
    ("GET", "/avatars/*", "late", "api.routes.web"), ("GET", "/avatars/_s/index.json", "late", "api.routes.web"),
    ("GET", "/static/*", "late", "api.routes.web"), ("GET", "/uploads/*", "late", "api.routes.web"), ("GET", "/work/*", "late", "api.routes.web"),
    ("POST", "/api/action", "", "api.routes.actions"), ("POST", "/api/hire", "", "api.routes.hr"),
    ("POST", "/api/interview", "", "api.routes.hr"), ("POST", "/api/push/log", "", "api.routes.push"),
    ("POST", "/api/push/prefs", "", "api.routes.push"), ("POST", "/api/push/subscribe", "", "api.routes.push"),
    ("POST", "/api/push/test", "", "api.routes.push"), ("POST", "/api/push/unsubscribe", "", "api.routes.push"),
    ("POST", "/api/transcribe", "", "api.routes.media"), ("POST", "/api/upload", "", "api.routes.media"),
    ("POST", "/api/memo", "raw", "api.routes.media"), ("POST", "/api/feeds", "raw", "api.routes.feeds"), ("POST", "/api/secret/github", "raw", "api.routes.secret"),
    ("POST", "/api/upload/raw", "raw", "api.routes.media"), ("POST", "/api/voice/*", "raw", "api.routes.voice"),
]

A, SC, SN = "api.routes.actions", "api.routes.schedules", "api.routes.snooze"
ACTIONS = {"answer": A, "approve": A, "archive": A, "calendar_add": A, "calendar_del": A, "chat": A, "chat_seen": A, "comment": A,
           "dm": A, "done": A, "lesson": A, "mail_read": A, "new_task": A, "notice_dismiss": A, "onboarding": "api.routes.setup", "owner_name": A, "ping": A, "reassign": A, "reject": A,
           "reopen": A, "report_request": A, "routine_pause": SC, "routine_resume": SC, "schedule_fire": SC, "schedule_pause": SC,
           "schedule_resume": SC, "schedule_rm": SC, "set_category": A, "set_stage": A, "snooze": SN, "stamina": A, "studio_mode": A, "unsnooze": SN,
           "widget_layout": A}

PROBE = """
import json, server
from api import router, loops
print(json.dumps({"names": sorted(k for k in vars(server) if not k.startswith("__")), "table": router.table(),
                  "loops": [f.__name__ for f in loops.LOOPS], "ext_get_same": server.EXT_GET is router.EXT_GET,
                  "config_same": server.CONFIG is __import__("api.ctx").ctx.CONFIG}))
"""


class ServerTables(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp(prefix="rt-srv-")
        root = os.path.join(cls.dir, "rt")

        def ignore(d, names):
            return {n for n in names if n in SKIP or ".bak" in n or (os.path.basename(d) == "tools" and n in ("models", "voice"))}
        shutil.copytree(ROOT, root, ignore=ignore, symlinks=True)
        r = subprocess.run([sys.executable, "-c", PROBE], cwd=root, capture_output=True, text=True, timeout=60,
                           env=dict(os.environ, HOME=cls.dir))
        if r.returncode:
            raise AssertionError("importing server.py failed:\n" + r.stderr[-3000:])
        cls.info = json.loads(r.stdout.strip().splitlines()[-1])

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.dir, ignore_errors=True)

    def test_every_old_name_is_still_there(self):
        missing = [n for n in BEFORE if n not in self.info["names"]]
        self.assertEqual(missing, [], "server.<name> lost names the single-file server had (local/ext extensions use srv.<name>)")

    def test_shared_objects_are_the_same(self):
        self.assertTrue(self.info["ext_get_same"], "server.EXT_GET must be the list the request handler reads")
        self.assertTrue(self.info["config_same"], "server.CONFIG must be the dict api.ctx fills")

    def test_route_table(self):
        got = sorted(tuple(r) for r in self.info["table"]["routes"])
        self.assertEqual(got, sorted(ROUTES), "routes changed: update ROUTES here (and docs/architecture.md) if that was meant")

    def test_action_table(self):
        self.assertEqual(self.info["table"]["actions"], ACTIONS)

    def test_loops(self):
        self.assertEqual(self.info["loops"], ["comfy_probe_loop", "report_loop", "roster_watch_loop", "push_loop", "wake_loop",
                                              "schedule_loop", "snooze_loop", "update_check_loop", "feeds_loop"])

    def test_import_rule(self):
        """core/ never imports api/ or server; api/ never imports server (server.py is the entry point, not a library)."""
        bad = []
        for f in glob.glob(os.path.join(ROOT, "core", "**", "*.py"), recursive=True) + glob.glob(os.path.join(ROOT, "api", "**", "*.py"), recursive=True):
            rel = os.path.relpath(f, ROOT)
            with open(f, encoding="utf-8") as fh:
                tree = ast.parse(fh.read())
            for n in ast.walk(tree):
                mods = [a.name for a in n.names] if isinstance(n, ast.Import) else [n.module or ""] if isinstance(n, ast.ImportFrom) else []
                for m in mods:
                    if m == "server" or m.startswith("server.") or (rel.startswith("core") and (m == "api" or m.startswith("api."))):
                        bad.append(f"{rel}: import {m}")
        self.assertEqual(bad, [])

    def test_entry_point_only(self):
        with open(os.path.join(ROOT, "server.py"), encoding="utf-8") as f:
            tree = ast.parse(f.read())
        defs = [n.name for n in tree.body if isinstance(n, (ast.FunctionDef, ast.ClassDef))]
        self.assertEqual(defs, ["main"], "server.py keeps only main(); put new code in api/")
        with open(os.path.join(ROOT, "api", "http.py"), encoding="utf-8") as f:
            http = f.read()
        self.assertNotIn("u.path ==", http, "a path check in the request handler: register a route in api/routes/ instead")


if __name__ == "__main__":
    unittest.main()
