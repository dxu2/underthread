"""tools/start.py (./start and the Underthread icon). Each test loads a copy of start.py inside a temp folder, so ROOT,
local/start.json and logs/ are the temp folder's; the icon goes to UNDERTHREAD_APPS (a temp folder), never ~/Applications."""
import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MAC_TOOLS = sys.platform == "darwin" and all(shutil.which(t) for t in ("osacompile", "sips", "iconutil", "plutil", "codesign"))


class StartTest(unittest.TestCase):
    def setUp(self):
        self.d = os.path.realpath(tempfile.mkdtemp(prefix="rt-start-"))
        os.makedirs(os.path.join(self.d, "tools", "app"))
        shutil.copy(os.path.join(ROOT, "tools", "start.py"), os.path.join(self.d, "tools", "start.py"))
        shutil.copy(os.path.join(ROOT, "tools", "app", "icon-1024.png"), os.path.join(self.d, "tools", "app", "icon-1024.png"))
        shutil.copy(os.path.join(ROOT, "start"), os.path.join(self.d, "start"))
        self.apps = os.path.join(self.d, "apps")
        self.env = {k: os.environ.get(k) for k in ("UNDERTHREAD_APPS",)}
        os.environ["UNDERTHREAD_APPS"] = self.apps
        self.argv = sys.argv
        sys.argv = ["start.py"]
        spec = importlib.util.spec_from_file_location(f"start_{id(self)}", os.path.join(self.d, "tools", "start.py"))
        self.m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.m)

    def tearDown(self):
        sys.argv = self.argv
        for k, v in self.env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        shutil.rmtree(self.d, ignore_errors=True)

    def test_help_runs_through_the_wrapper(self):
        r = subprocess.run([os.path.join(self.d, "start"), "--help"], capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("--no-steward", r.stdout)
        self.assertIn("--app", r.stdout)

    def test_wrapper_and_script_are_executable_in_git(self):
        out = subprocess.run(["git", "ls-files", "-s", "start", "tools/start.py"], cwd=ROOT, capture_output=True, text=True).stdout
        for line in out.splitlines():
            self.assertTrue(line.startswith("100755"), line)

    def test_prefs_round_trip(self):
        self.assertEqual(self.m.prefs(), {})
        self.m.save_prefs(icon=True)
        self.m.save_prefs(login_item=False)
        self.assertEqual(self.m.prefs(), {"icon": True, "login_item": False})
        self.assertTrue(os.path.exists(os.path.join(self.d, "local", "start.json")))

    def test_no_questions_without_a_terminal(self):
        self.m.FROM_APP = True
        self.assertIsNone(self.m.ask_yes("q", True))

    def test_agents_stale(self):
        self.assertTrue(self.m.agents_stale())   # no .claude/agents yet
        ag = os.path.join(self.d, ".claude", "agents")
        os.makedirs(ag)
        open(os.path.join(ag, "underthread-scout.md"), "w").close()
        self.assertFalse(self.m.agents_stale())
        r = os.path.join(self.d, "roster.json")
        open(r, "w").close()
        later = time.time() + 5
        os.utime(r, (later, later))
        self.assertTrue(self.m.agents_stale())   # roster changed after the agents were made
        os.utime(r, None)
        os.utime(os.path.join(ag, "underthread-scout.md"), (later + 5, later + 5))
        self.assertFalse(self.m.agents_stale())
        mk = os.path.join(self.d, "make_agents.py")
        open(mk, "w").close()
        os.utime(mk, (later + 10, later + 10))
        self.assertTrue(self.m.agents_stale())   # an update brought new hard rules (t-oss-polish-1121)

    def test_a_click_a_moment_ago_counts_as_online(self):
        os.makedirs(os.path.join(self.d, "logs"))
        open(self.m.LAUNCH, "w").close()
        self.assertTrue(self.m.steward_online())
        old = time.time() - 120
        os.utime(self.m.LAUNCH, (old, old))
        self.m.heartbeat_age = lambda: None
        self.m.steward_process = lambda: None
        self.assertIsNone(self.m.steward_online())
        self.m.heartbeat_age = lambda: 5.0
        self.assertTrue(self.m.steward_online())
        self.m.heartbeat_age = lambda: 45.0
        self.assertIsNone(self.m.steward_online())

    def test_steward_script(self):
        p = self.m.steward_script("/opt/x/claude")
        with open(p) as f:
            body = f.read()
        self.assertTrue(os.access(p, os.X_OK))
        self.assertIn("exec /opt/x/claude 'Start the manager per manager.md'", body)
        self.assertIn(self.m.TTY_FILE, body)

    def test_applescript_bakes_the_folder_and_path(self):
        s = self.m.applescript('/Users/a b/under"thread', "/opt/homebrew/bin:/usr/bin")
        self.assertIn('"/Users/a b/under\\"thread/start"', s)
        self.assertIn("/opt/homebrew/bin:/usr/bin", s)
        self.assertIn("--from-app", s)
        self.assertIn("./start", s)   # the folder-moved dialog says what to do

    def test_desktop_file(self):
        self.m.build_desktop_file()
        with open(os.path.join(self.apps, "underthread.desktop")) as f:
            body = f.read()
        self.assertIn("Terminal=false", body)
        self.assertIn(f'Exec="{self.d}/start" --from-app', body)
        self.assertIn(f"X-Underthread-Root={self.d}", body)

    @unittest.skipUnless(MAC_TOOLS, "macOS with osacompile, sips, iconutil, plutil and codesign")
    def test_mac_app(self):
        self.assertIsNone(self.m.build_mac_app())
        app = os.path.join(self.apps, "Underthread.app")
        self.assertEqual(self.m.app_root(app), self.d)
        self.assertTrue(os.path.getsize(os.path.join(app, "Contents", "Resources", "applet.icns")) > 50_000)
        sig = subprocess.run(["codesign", "-dv", app], capture_output=True, text=True).stderr
        self.assertIn("Signature=adhoc", sig)
        self.assertIn("Identifier=com.underthread.start", sig)
        self.assertEqual(subprocess.run(["codesign", "--verify", "--deep", app], capture_output=True).returncode, 0)
        xattrs = subprocess.run(["xattr", app], capture_output=True, text=True).stdout
        self.assertNotIn("com.apple.quarantine", xattrs)
        # an Underthread.app not made by ./start is never replaced
        shutil.rmtree(app)
        os.makedirs(os.path.join(app, "Contents"))
        self.assertIsNotNone(self.m.build_mac_app())
        self.assertFalse(os.path.exists(os.path.join(app, "Contents", "Info.plist")))


if __name__ == "__main__":
    unittest.main()
