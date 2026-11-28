"""t-oss-monitor-check: ./start says when the installed Claude Code has no Monitor tool (the steward would never hear the
dashboard), and manager.md documents every inbox kind tools/update.py sends. Versions from Claude Code's CHANGELOG:
Monitor in 2.1.98; on Bedrock / Vertex / Foundry or with telemetry / nonessential traffic off, in 2.1.310."""
import importlib.util
import json
import os
import re
import shutil
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GATES = ("CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY",
         "DISABLE_TELEMETRY", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC")


class MonitorCheck(unittest.TestCase):
    def setUp(self):
        self.d = os.path.realpath(tempfile.mkdtemp(prefix="rt-mon-"))
        os.makedirs(os.path.join(self.d, "tools"))
        shutil.copy(os.path.join(ROOT, "tools", "start.py"), os.path.join(self.d, "tools", "start.py"))
        self.home = os.path.join(self.d, "home")
        os.makedirs(os.path.join(self.home, ".claude"))
        self.saved = {k: os.environ.get(k) for k in GATES + ("HOME", "LANG", "LC_ALL")}
        for k in GATES:
            os.environ.pop(k, None)
        os.environ.update(HOME=self.home, LANG="en_US.UTF-8", LC_ALL="")
        self.argv, sys.argv = sys.argv, ["start.py"]
        spec = importlib.util.spec_from_file_location(f"start_mon_{id(self)}", os.path.join(self.d, "tools", "start.py"))
        self.m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.m)

    def tearDown(self):
        sys.argv = self.argv
        for k, v in self.saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        shutil.rmtree(self.d, ignore_errors=True)

    def fake(self, out, code=0):
        p = os.path.join(self.d, "claude")
        with open(p, "w") as f:
            f.write(f"#!/bin/sh\nprintf '%s\\n' {json.dumps(out)}\nexit {code}\n")
        os.chmod(p, 0o755)
        return p

    def test_new_enough(self):
        ok, msg = self.m.monitor_check(self.fake("2.1.319 (Claude Code)"))
        self.assertTrue(ok, msg)
        self.assertIn("2.1.319", msg)

    def test_exact_minimum(self):
        self.assertTrue(self.m.monitor_check(self.fake("2.1.98 (Claude Code)"))[0])

    def test_too_old_says_how_to_fix(self):
        ok, msg = self.m.monitor_check(self.fake("2.1.97 (Claude Code)"))
        self.assertFalse(ok)
        self.assertIn("2.1.98", msg)
        self.assertIn("claude update", msg)
        ok, _ = self.m.monitor_check(self.fake("1.0.120 (Claude Code)"))
        self.assertFalse(ok)

    def test_unreadable_version_is_a_warning(self):
        ok, msg = self.m.monitor_check(self.fake("", 1))
        self.assertFalse(ok)
        self.assertIn("claude --version", msg)
        self.assertFalse(self.m.monitor_check(os.path.join(self.d, "missing"))[0], "a missing binary does not raise")

    def test_gated_setups_need_2_1_310(self):
        os.environ["CLAUDE_CODE_USE_BEDROCK"] = "1"
        ok, msg = self.m.monitor_check(self.fake("2.1.200 (Claude Code)"))
        self.assertFalse(ok)
        self.assertIn("CLAUDE_CODE_USE_BEDROCK", msg)
        self.assertTrue(self.m.monitor_check(self.fake("2.1.310 (Claude Code)"))[0])
        os.environ["CLAUDE_CODE_USE_BEDROCK"] = "0"
        self.assertTrue(self.m.monitor_check(self.fake("2.1.200 (Claude Code)"))[0], "0 means off")

    def test_gate_from_user_settings_env(self):
        with open(os.path.join(self.home, ".claude", "settings.json"), "w") as f:
            json.dump({"env": {"DISABLE_TELEMETRY": "1"}}, f)
        ok, msg = self.m.monitor_check(self.fake("2.1.250 (Claude Code)"))
        self.assertFalse(ok)
        self.assertIn("DISABLE_TELEMETRY", msg)

    def test_monitor_denied_in_project_settings(self):
        os.makedirs(os.path.join(self.d, ".claude"))
        with open(os.path.join(self.d, ".claude", "settings.local.json"), "w") as f:
            json.dump({"permissions": {"deny": ["Monitor"]}}, f)
        ok, msg = self.m.monitor_check(self.fake("2.1.319 (Claude Code)"))
        self.assertFalse(ok)
        self.assertIn("permissions.deny", msg)

    def test_broken_settings_file_is_ignored(self):
        with open(os.path.join(self.home, ".claude", "settings.json"), "w") as f:
            f.write("{not json")
        self.assertTrue(self.m.monitor_check(self.fake("2.1.319 (Claude Code)"))[0])

    def test_zh(self):
        self.m.ZH = True
        ok, msg = self.m.monitor_check(self.fake("2.1.50 (Claude Code)"))
        self.assertFalse(ok)
        self.assertIn("Monitor", msg)
        self.assertIn("claude update", msg)
        self.assertRegex(msg, "[一-鿿]")


class ManagerKnowsUpdateKinds(unittest.TestCase):
    def test_every_update_inbox_kind_has_a_row(self):
        with open(os.path.join(ROOT, "tools", "update.py"), encoding="utf-8") as f:
            kinds = set(re.findall(r'notify\(\{"kind":\s*"([a-z_]+)"', f.read()))
        self.assertIn("update_done", kinds)
        with open(os.path.join(ROOT, "manager.md"), encoding="utf-8") as f:
            md = f.read()
        rows = set(re.findall(r"^\| `([a-z_]+)` \|", md, re.M))
        self.assertEqual(kinds - rows, set(), "manager.md section 3 needs a row for each")
        row = next(l for l in md.splitlines() if l.startswith("| `update_done` |"))
        for w in ("steward_restart", "rules_changed", "local/manager.md", "make_agents.py", "say-mgr", "No restart"):
            self.assertIn(w, row)

    def test_manager_says_when_monitor_is_missing(self):
        with open(os.path.join(ROOT, "manager.md"), encoding="utf-8") as f:
            self.assertIn("No Monitor tool in your tool list?", f.read())


if __name__ == "__main__":
    unittest.main()
