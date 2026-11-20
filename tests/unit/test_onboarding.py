"""t-onboarding P0: migration 0003 (existing boards never see the checklist) and the retire rule of the 开工清单."""
import datetime as dt
import importlib
import unittest

M = importlib.import_module("core.migrations.0003_onboarding")
NOW = "2026-11-19T10:00:00-08:00"


class Migration(unittest.TestCase):
    def run_up(self, data):
        return M.up(data, {"now": NOW})

    def test_fresh_seed_gets_an_empty_record(self):
        d = self.run_up({"meta": {}, "items": [{"id": "q-demo-plan"}], "chat": [], "agents": {"manager": {}}})
        self.assertEqual(d["meta"]["onboarding"], {})

    def test_used_board_is_done_and_retired(self):
        for d in ({"meta": {}, "items": [{"id": "t-1"}]}, {"meta": {}, "chat": [{"who": "me"}]},
                  {"meta": {}, "agents": {"manager": {"last_seen": NOW}}}):
            ob = self.run_up(d)["meta"]["onboarding"]
            self.assertEqual((ob["done_at"], ob["retired_at"], ob["by"]), (NOW, NOW, "upgrade"))

    def test_idempotent_and_marks_widget_seen(self):
        d = {"meta": {"onboarding": {"keep": True}, "widgets": {"layout": None, "seen": ["busy"]}}}
        d = self.run_up(self.run_up(d))
        self.assertEqual(d["meta"]["onboarding"], {"keep": True})
        self.assertEqual(d["meta"]["widgets"]["seen"], ["busy", "setup"])


class Retire(unittest.TestCase):
    def setUp(self):
        self.SU = importlib.import_module("api.routes.setup")

    def test_rule(self):
        r, today = self.SU.retired, dt.date(2026, 11, 19)
        self.assertFalse(r({}, today))
        self.assertFalse(r({"done_at": "2026-11-19T09:00:00-08:00"}, today))       # done today: still shows (the done line)
        self.assertTrue(r({"done_at": "2026-11-18T09:00:00-08:00"}, today))        # the next day it retires
        self.assertFalse(r({"done_at": "2026-11-18T09:00:00-08:00", "keep": True}, today))   # brought back from 编辑小组件
        self.assertTrue(r({"retired_at": NOW}, today))


class Polish(unittest.TestCase):
    """t-onb-polish: six numbered steps for six counted ones; 清掉示例 archives only the q-demo-* samples."""
    def setUp(self):
        self.SU = importlib.import_module("api.routes.setup")

    def test_steps_match_the_count(self):
        v = self.SU.view({"meta": {}, "items": [], "chat": [], "agents": {}}, archived=[])
        self.assertEqual(len(v["steps"]), v["of"])
        self.assertFalse(any(s["optional"] for s in v["steps"]))

    def test_clear_samples(self):
        from api.router import ACTIONS

        class A:
            pass
        a = A()
        a.body = {"op": "clear_samples"}
        a.st = {"meta": {}, "log": [], "items": [{"id": "q-demo-plan"}, {"id": "q-demo-ask", "archived": True}, {"id": "t-real"}]}
        ACTIONS["onboarding"](a)
        self.assertEqual([bool(i.get("archived")) for i in a.st["items"]], [True, True, False])


class Optional(unittest.TestCase):
    """t-onb-polish B: five optional steps, never counted; tick / skip / unskip; the phone tick from Tailscale Serve; the probes."""
    def setUp(self):
        self.SU = importlib.import_module("api.routes.setup")
        from api.router import ACTIONS
        self.act = ACTIONS["onboarding"]

    def run_op(self, st, **body):
        class A:
            pass
        a = A()
        a.body, a.st = body, st
        self.act(a)
        return st["meta"]["onboarding"]

    def test_optional_never_counted(self):
        v = self.SU.view({"meta": {"onboarding": {"chrome_at": NOW, "look_at": NOW}}, "items": [], "chat": [], "agents": {}}, archived=[])
        self.assertEqual(v["of"], 6)
        self.assertEqual([s["id"] for s in v["opt"]["steps"]], ["codex", "chrome", "app", "look", "phone"])
        self.assertEqual([s["done"] for s in v["opt"]["steps"]][1:], [True, False, True, False])

    def test_tick_skip_unskip(self):
        st = {"meta": {"onboarding": {"done_at": NOW, "by": "upgrade"}}}
        ob = self.run_op(st, op="tick", k="look", auto=True)
        self.assertTrue(ob["look_at"])
        self.assertEqual(ob["tick_by"], {"look": "auto"})
        self.assertEqual(ob["by"], "upgrade")   # the migration's own field is left alone
        first = ob["look_at"]
        self.run_op(st, op="tick", k="look")
        self.assertEqual(ob["look_at"], first)   # once
        self.run_op(st, op="skip", k="codex")
        self.run_op(st, op="skip", k="codex")
        self.assertEqual(ob["skip"], ["codex"])
        v = self.SU.opt_view(ob, None)
        self.assertTrue(next(s for s in v["steps"] if s["id"] == "codex")["skipped"])
        self.run_op(st, op="unskip", k="codex")
        self.assertEqual(ob["skip"], [])
        with self.assertRaises(ValueError):
            self.run_op(st, op="tick", k="codex")   # Codex ticks only from the probe
        with self.assertRaises(ValueError):
            self.run_op(st, op="skip", k="nope")

    def test_phone_needs_tailnet_and_a_phone(self):
        SU = self.SU
        seen = []

        class H:
            def __init__(self, hd):
                self.headers = hd
        orig = SU.S.mutate
        import contextlib

        @contextlib.contextmanager
        def fake():
            st = {"meta": {}}
            yield st
            seen.append(st["meta"]["onboarding"])
        SU.S.mutate = fake
        try:
            iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148"
            for hd in ({"Host": "127.0.0.1:8765", "User-Agent": iphone},                       # local devtools emulation
                       {"Host": "mini.example.ts.net", "User-Agent": "Mozilla/5.0 (Macintosh)"}):   # the desktop over Serve
                SU._PHONE["seen"] = False
                SU.note_phone(H(hd))
            self.assertEqual(seen, [])
            SU._PHONE["seen"] = False
            SU.note_phone(H({"Host": "mini.example.ts.net", "User-Agent": iphone}))
            SU.note_phone(H({"Host": "mini.example.ts.net", "User-Agent": iphone}))   # once per process
            self.assertEqual(len(seen), 1)
            self.assertTrue(seen[0]["phone_at"])
        finally:
            SU.S.mutate = orig
            SU._PHONE["seen"] = False

    def test_tailscale_probe(self):
        import os
        import stat
        import tempfile
        d = tempfile.mkdtemp()
        fake = os.path.join(d, "tailscale")
        with open(fake, "w") as f:
            f.write("""#!/bin/sh
if [ "$1" = status ]; then echo '{"BackendState":"Running","Self":{"DNSName":"box.example.ts.net."}}'; exit 0; fi
echo '{"TCP":{"443":{"HTTPS":true}},"Web":{"box.example.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:8765"}}}}}'
""")
        os.chmod(fake, os.stat(fake).st_mode | stat.S_IEXEC)
        old = os.environ.get("TAILSCALE_BIN")
        os.environ["TAILSCALE_BIN"] = fake
        try:
            ts = self.SU._tailscale(8765)
            self.assertEqual((ts["on"], ts["host"], ts["served"], ts["url"]), (True, "box.example.ts.net", True, "https://box.example.ts.net"))
            self.assertFalse(self.SU._tailscale(8799)["served"])   # another port is not this board
        finally:
            if old is None:
                os.environ.pop("TAILSCALE_BIN", None)
            else:
                os.environ["TAILSCALE_BIN"] = old


class OnbMark(unittest.TestCase):
    def test_marks_chrome_once(self):
        import json
        import os
        import shutil
        import subprocess
        import sys
        import tempfile
        root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        d = tempfile.mkdtemp()
        shutil.copytree(os.path.join(root, "core"), os.path.join(d, "core"))
        os.makedirs(os.path.join(d, "tools"))
        shutil.copy(os.path.join(root, "tools", "onb_mark.py"), os.path.join(d, "tools"))
        with open(os.path.join(d, "state.json"), "w") as f:
            json.dump({"meta": {"onboarding": {}}, "items": [], "chat": [], "agents": {}}, f)
        for _ in range(2):
            r = subprocess.run([sys.executable, os.path.join(d, "tools", "onb_mark.py"), "chrome"], input="{}", text=True, capture_output=True)
            self.assertEqual(r.returncode, 0, r.stderr)
        with open(os.path.join(d, "state.json")) as f:
            ob = json.load(f)["meta"]["onboarding"]
        self.assertTrue(ob["chrome_at"])
        self.assertEqual(ob["tick_by"], {"chrome": "auto"})
        shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
