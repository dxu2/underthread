"""tools/uninstall.py (./start --uninstall). Runs on a temp copy of tools/start.py + tools/uninstall.py; every outside location
(LaunchAgents, launchctl, the icon folder, backups, ~/.claude) is pointed at a temp folder by environment variables, so the
tests never see this machine's real login item, icon or Claude Code logs."""
import contextlib
import importlib.util
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ENV_KEYS = ("UNDERTHREAD_APPS", "UNDERTHREAD_LAUNCHAGENTS", "UNDERTHREAD_LAUNCHCTL", "UNDERTHREAD_BACKUPS", "CLAUDE_CONFIG_DIR")
PLIST = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>com.underthread.server</string>
<key>WorkingDirectory</key><string>{}</string></dict></plist>
"""


class UninstallTest(unittest.TestCase):
    def setUp(self):
        self.t = os.path.realpath(tempfile.mkdtemp(prefix="rt-uninst-"))
        self.d = os.path.join(self.t, "underthread")
        os.makedirs(os.path.join(self.d, "tools"))
        for f in ("start.py", "uninstall.py"):
            shutil.copy(os.path.join(ROOT, "tools", f), os.path.join(self.d, "tools", f))
        shutil.copy(os.path.join(ROOT, "start"), os.path.join(self.d, "start"))
        with open(os.path.join(self.d, "state.json"), "w") as f:
            f.write("{}")
        os.makedirs(os.path.join(self.d, ".git"))
        for k in ("apps", "la", "bak", "claude/projects/-other"):
            os.makedirs(os.path.join(self.t, k))
        self.calls = os.path.join(self.t, "launchctl.log")
        fake = os.path.join(self.t, "launchctl")
        with open(fake, "w") as f:
            f.write(f'#!/bin/sh\necho "$@" >> "{self.calls}"\n')
        os.chmod(fake, 0o755)
        self.saved = {k: os.environ.get(k) for k in ENV_KEYS}
        os.environ.update({"UNDERTHREAD_APPS": os.path.join(self.t, "apps"), "UNDERTHREAD_LAUNCHAGENTS": os.path.join(self.t, "la"),
                           "UNDERTHREAD_LAUNCHCTL": fake, "UNDERTHREAD_BACKUPS": os.path.join(self.t, "bak"),
                           "CLAUDE_CONFIG_DIR": os.path.join(self.t, "claude")})
        self.logs = os.path.join(self.t, "claude", "projects", re.sub(r"[^A-Za-z0-9]", "-", self.d))
        os.makedirs(self.logs)
        self.argv = sys.argv
        sys.argv = ["uninstall.py"]
        sys.path.insert(0, os.path.join(self.d, "tools"))
        for name in ("start", "uninstall"):
            sys.modules.pop(name, None)
        spec = importlib.util.spec_from_file_location("uninstall", os.path.join(self.d, "tools", "uninstall.py"))
        self.u = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.u)
        self.u.board_pids = lambda: []
        self.u.S.steward_pids = lambda: []
        self.u.S.heartbeat_age = lambda: None

    def tearDown(self):
        sys.argv = self.argv
        sys.path.remove(os.path.join(self.d, "tools"))
        for name in ("start", "uninstall"):
            sys.modules.pop(name, None)
        for k, v in self.saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        shutil.rmtree(self.t, ignore_errors=True)

    def plist(self, wd):
        p = os.path.join(self.t, "la", "com.underthread.server.plist")
        with open(p, "w") as f:
            f.write(PLIST.format(wd))
        return p

    def start_file(self):   # something for the "go ahead?" question to be about
        os.makedirs(os.path.join(self.d, "logs"), exist_ok=True)
        open(os.path.join(self.d, "logs", "steward.tty"), "w").close()

    def answers(self, *a):
        it = iter(a)
        self.asked = []

        def ask(q, default=False):
            self.asked.append(q)
            return next(it)
        self.u.ask = ask

    @unittest.skipUnless(shutil.which("plutil"), "plutil (macOS)")
    def test_login_item_only_when_it_runs_this_folder(self):
        self.plist("/somewhere/else")
        self.assertIsNone(self.u.login_item())
        p = self.plist(self.d)
        self.assertEqual(self.u.login_item(), p)

    def test_claude_logs_folder_name(self):
        self.assertEqual(self.u.claude_logs(), self.logs)

    def test_dry_run_needs_no_terminal_and_changes_nothing(self):
        env = dict(os.environ)
        r = subprocess.run([os.path.join(self.d, "start"), "--uninstall", "--dry-run"], capture_output=True, text=True, stdin=subprocess.DEVNULL,
                           env=env, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("--dry-run", r.stdout)
        self.assertIn("Claude Code itself", r.stdout)
        self.assertTrue(os.path.exists(os.path.join(self.d, "state.json")))
        self.assertTrue(os.path.isdir(self.logs))

    def test_refuses_without_a_terminal(self):
        r = subprocess.run([os.path.join(self.d, "start"), "--uninstall"], capture_output=True, text=True, stdin=subprocess.DEVNULL, timeout=60)
        self.assertEqual(r.returncode, 2)
        self.assertTrue(os.path.exists(os.path.join(self.d, "state.json")))

    def run_main(self):
        self.u.sys.stdin = type("TTY", (), {"isatty": staticmethod(lambda: True)})()
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                return self.u.main()
        finally:
            self.u.sys.stdin = sys.__stdin__

    def test_no_means_nothing_changes(self):
        os.makedirs(os.path.join(self.d, "logs"))
        open(os.path.join(self.d, "logs", "steward.command"), "w").close()
        self.answers(False)
        self.assertEqual(self.run_main(), 1)
        self.assertTrue(os.path.exists(os.path.join(self.d, "logs", "steward.command")))
        self.assertEqual(len(self.asked), 1)

    def test_yes_keeps_data_by_default(self):
        desktop = os.path.join(self.t, "apps", "underthread.desktop")
        with open(desktop, "w") as f:
            f.write(f"[Desktop Entry]\nX-Underthread-Root={self.d}\n")
        if sys.platform == "darwin":
            self.u.icon = lambda: desktop   # the .app path is covered by test_start; here any icon file of ours will do
        os.makedirs(os.path.join(self.d, "logs"))
        open(os.path.join(self.d, "logs", "start.log"), "w").close()
        self.answers(True, False, False)   # go ahead, keep folder, keep logs
        self.assertEqual(self.run_main(), 0)
        self.assertFalse(os.path.exists(desktop))
        self.assertFalse(os.path.exists(os.path.join(self.d, "logs", "start.log")))
        self.assertTrue(os.path.exists(os.path.join(self.d, "state.json")))
        self.assertTrue(os.path.isdir(self.logs))
        self.assertTrue(os.path.isdir(os.path.join(self.t, "claude", "projects", "-other")))

    @unittest.skipUnless(shutil.which("plutil"), "plutil (macOS)")
    def test_login_item_removed_through_launchctl(self):
        p = self.plist(self.d)
        self.assertEqual(self.u.login_item(), p)
        self.answers(True, False, False)
        self.run_main()
        self.assertFalse(os.path.exists(p))
        with open(self.calls) as f:
            self.assertIn("bootout gui/", f.read())

    def test_someone_elses_icon_and_login_item_stay(self):
        desktop = os.path.join(self.t, "apps", "underthread.desktop")
        with open(desktop, "w") as f:
            f.write("[Desktop Entry]\nX-Underthread-Root=/another/install\n")
        p = self.plist("/another/install")
        self.start_file()
        if sys.platform != "darwin":
            self.assertIsNone(self.u.icon())
        self.answers(True, False, False)
        self.run_main()
        self.assertTrue(os.path.exists(desktop))
        self.assertTrue(os.path.exists(p))
        self.assertFalse(os.path.exists(self.calls))

    def test_delete_folder_with_backup_and_logs(self):
        self.start_file()
        self.answers(True, True, True, True)   # go ahead, delete folder, backup first, delete logs
        self.assertEqual(self.run_main(), 0)
        self.assertFalse(os.path.exists(self.d))
        self.assertFalse(os.path.exists(self.logs))
        self.assertTrue(os.path.isdir(os.path.join(self.t, "claude", "projects", "-other")))
        zips = os.listdir(os.path.join(self.t, "bak"))
        self.assertEqual(len(zips), 1)
        with zipfile.ZipFile(os.path.join(self.t, "bak", zips[0])) as z:
            names = z.namelist()
        self.assertIn("underthread/state.json", names)
        self.assertFalse(any(n.startswith("underthread/.git") for n in names))


if __name__ == "__main__":
    unittest.main()
