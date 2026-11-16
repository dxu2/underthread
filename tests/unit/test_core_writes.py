"""t-oss-gen-s5: nothing writes a git-tracked core file at runtime. make_agents.py puts the dispatch table in
local/dispatch.md (making local/ when missing), adopted rules and hires write local/roles/, and once local/ appears an
install keeps using the backups folder it already had (core/paths.backups_dir)."""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

from tests.unit._core import ROOT

sys.path.insert(0, ROOT)
from core import paths as P  # noqa: E402

COPY = ("make_agents.py", "manager.md", "roster.example.json", "core", "roles", "templates", "presets")


class CoreWrites(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.r = os.path.realpath(self.tmp.name)
        for n in COPY:
            s, d = os.path.join(ROOT, n), os.path.join(self.r, n)
            (shutil.copytree(s, d, ignore=shutil.ignore_patterns("__pycache__", "art")) if os.path.isdir(s) else shutil.copy2(s, d))
        shutil.copy2(os.path.join(self.r, "roster.example.json"), os.path.join(self.r, "roster.json"))

    def tearDown(self):
        self.tmp.cleanup()

    def run_make_agents(self):
        env = {k: v for k, v in os.environ.items() if k != "UNDERTHREAD_LOCAL"}
        r = subprocess.run([sys.executable, "make_agents.py"], cwd=self.r, capture_output=True, text=True, env=env)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout

    def test_make_agents_without_local_leaves_manager_md(self):
        before = open(os.path.join(self.r, "manager.md"), "rb").read()
        out = self.run_make_agents()
        self.assertEqual(open(os.path.join(self.r, "manager.md"), "rb").read(), before)
        self.assertIn("updated local/dispatch.md", out)
        d = open(os.path.join(self.r, "local", "dispatch.md"), encoding="utf-8").read()
        self.assertIn("`underthread-hr`", d)
        # the shipped default table is what make_agents writes for the default crew
        cut = lambda t: t[t.index("<!-- DISPATCH:BEGIN"):t.index("<!-- DISPATCH:END")]  # noqa: E731
        self.assertEqual(cut(d), cut(before.decode()))
        # HR got its template notes, not a bare stub
        self.assertTrue(open(os.path.join(self.r, "roles", "hr.md"), encoding="utf-8").read().startswith("# Thimble · HR"))
        self.assertFalse(os.path.exists(os.path.join(self.r, "local", "roles", "hr.md")))

    def test_role_md_write_is_always_local(self):
        self.assertEqual(P.role_md("scout", write=True), P.local_path("roles", "scout.md"))

    def test_backups_dir_is_sticky(self):
        r = self.r
        self.assertEqual(P.backups_dir(r), os.path.join(r, ".backups"))
        os.makedirs(os.path.join(r, ".backups"))
        os.makedirs(os.path.join(r, "local"))
        self.assertEqual(P.backups_dir(r), os.path.join(r, ".backups"), "a local/ made later must not hide .backups")
        shutil.rmtree(os.path.join(r, ".backups"))
        self.assertEqual(P.backups_dir(r), os.path.join(r, "local", "backups"))
        os.makedirs(os.path.join(r, ".backups"))
        os.makedirs(os.path.join(r, "local", "backups"))
        self.assertEqual(P.backups_dir(r), os.path.join(r, "local", "backups"))


if __name__ == "__main__":
    unittest.main()
