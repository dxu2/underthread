"""core/backup.py + tools/bak.py (t-oss-struct S1): backups of untracked files go to local/backups/bak/, a used tag is
refused, old <file>.bak-<tag> copies still restore, and sweep / unsweep move scattered copies out and back exactly."""
import os
import subprocess
import sys
import tempfile
import unittest

from tests.unit._core import ROOT

sys.path.insert(0, ROOT)
from core import backup as B  # noqa: E402


def write(p, text):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        f.write(text)


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


class Backup(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.r = os.path.realpath(self.tmp.name)
        os.makedirs(os.path.join(self.r, "local"))
        write(os.path.join(self.r, "state.json"), "v1")

    def tearDown(self):
        self.tmp.cleanup()

    def test_save_goes_to_local_backups_and_refuses_reuse(self):
        f = os.path.join(self.r, "state.json")
        b = B.save(f, "t1", root=self.r)
        self.assertEqual(b, os.path.join(self.r, "local", "backups", "bak", "state.json.bak-t1"))
        self.assertEqual(read(b), "v1")
        self.assertFalse([n for n in os.listdir(self.r) if ".bak" in n], "nothing lands next to the file")
        write(f, "v2")
        with self.assertRaises(FileExistsError):
            B.save(f, "t1", root=self.r)
        self.assertEqual(read(b), "v1", "the old backup is untouched")
        self.assertIsNone(B.save(os.path.join(self.r, "nope.json"), "t1", root=self.r))

    def test_without_local_uses_dot_backups(self):
        os.rmdir(os.path.join(self.r, "local"))
        b = B.save(os.path.join(self.r, "state.json"), "t1", root=self.r)
        self.assertTrue(b.startswith(os.path.join(self.r, ".backups", "bak") + os.sep))
        self.assertFalse(os.path.exists(os.path.join(self.r, "local")), "never creates local/")

    def test_legacy_copy_is_found_and_blocks_the_tag(self):
        f = os.path.join(self.r, "state.json")
        write(f + ".bak-old", "v0")
        self.assertEqual(B.find(f, "old", root=self.r), f + ".bak-old")
        with self.assertRaises(FileExistsError):
            B.save(f, "old", root=self.r)
        b, keep = B.restore(f, "old", root=self.r)
        self.assertEqual(read(f), "v0")
        self.assertEqual(read(keep), "v1", "restore saves the current file first")

    def test_restore_and_listing(self):
        f = os.path.join(self.r, "local", "roles", "smith.md")
        write(f, "a")
        B.save(f, "x", root=self.r)
        write(f, "b")
        B.restore(f, "x", root=self.r)
        self.assertEqual(read(f), "a")
        tags = sorted(t for r, t, *_ in B.listing(root=self.r) if r == os.path.join("local", "roles", "smith.md"))
        self.assertEqual(len(tags), 2)
        self.assertIn("x", tags)
        with self.assertRaises(ValueError):
            B.save(f, "../evil", root=self.r)

    def test_sweep_and_unsweep(self):
        files = ["web/app.js.bak-p3", "web/style.css.bak", "roles/smith.md.bak-mem", "tools/x.py.bak2"]
        for p in files:
            write(os.path.join(self.r, p), p)
        os.makedirs(os.path.join(self.r, "tools", "voice", "voices.bak-src"))
        write(os.path.join(self.r, "work", "c", "a.bak-1"), "w")
        write(os.path.join(self.r, "local", "backups", "bak", "state.json.bak-t"), "keep")
        write(os.path.join(self.r, "web", "bakery.js"), "not a backup")
        write(os.path.join(self.r, "web", "app.js"), "live")
        self.assertEqual(sorted(B.scattered(self.r)), sorted(files))
        dest = os.path.join(self.r + "-out")
        try:
            sizes, total = B.sweep(dest, root=self.r, apply=True)
            self.assertEqual(len(sizes), 4)
            self.assertEqual(B.scattered(self.r), [])
            self.assertTrue(os.path.exists(os.path.join(self.r, "work", "c", "a.bak-1")), "work/ is left alone")
            self.assertTrue(os.path.isdir(os.path.join(self.r, "tools", "voice", "voices.bak-src")))
            with self.assertRaises(FileExistsError):
                B.sweep(dest, root=self.r, apply=True)
            back, skipped = B.unsweep(dest, root=self.r)
            self.assertEqual((len(back), skipped), (4, []))
            for p in files:
                self.assertEqual(read(os.path.join(self.r, p)), p)
        finally:
            import shutil
            shutil.rmtree(dest, ignore_errors=True)

    def test_cli_refuses_a_used_tag_for_any_file(self):
        env = dict(os.environ, UNDERTHREAD_LOCAL=os.path.join(self.r, "local"))
        tool = os.path.join(ROOT, "tools", "bak.py")
        a, b = os.path.join(ROOT, "VERSION"), os.path.join(ROOT, "LICENSE")
        r = subprocess.run([sys.executable, tool, "save", "unit-t", a, b], env=env, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        r = subprocess.run([sys.executable, tool, "save", "unit-t", b], env=env, capture_output=True, text=True)
        self.assertEqual(r.returncode, 1)
        self.assertIn("already used", r.stdout)
        self.assertTrue(os.path.exists(os.path.join(self.r, "local", "backups", "bak", "VERSION.bak-unit-t")))


class NoScatteredBackups(unittest.TestCase):
    def test_none_tracked(self):
        try:
            out = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True).stdout.split("\n")
        except OSError:
            self.skipTest("no git")
        self.assertEqual([f for f in out if B.BAK_RE.search(os.path.basename(f))], [])

    def test_none_in_web_or_templates(self):
        bad = [r for r in B.scattered(ROOT) if r.split(os.sep)[0] in ("web", "templates")]
        self.assertEqual(bad, [], "backup copies under web/ or templates/: move them with tools/bak.py sweep")


if __name__ == "__main__":
    unittest.main()
