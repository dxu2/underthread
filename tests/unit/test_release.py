"""t-oss-struct E5: tools/release.py refuses every incomplete release and tags a complete one.

Each test builds a small git repo in a temp folder (core/, tools/release.py + manifest.py, a CHANGELOG, a stub
tests/run.py whose exit code a file controls) and runs release.py there, so the checkout is never touched.
"""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

from tests.unit._core import ROOT

GOOD = """# Changelog

## [{ver}] - 2026-11-14

### Added
- A thing.

### Changed
- Nothing.

### Fixed
- Nothing.

### Upgrade notes
- Migrations: {mig}
- New config keys: {cfg}
- Extension API: unchanged
- Manual steps: {manual}

## 2026-11-09

### Added
- Old, before versioning.
"""
STUB_RUN = "import os, sys\nsys.exit(1 if os.path.exists(os.path.join(os.path.dirname(__file__), 'FAIL')) else 0)\n"
ENV = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@example.com", GIT_COMMITTER_NAME="t",
           GIT_COMMITTER_EMAIL="t@example.com", GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM="1")


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


class Repo:
    def __enter__(self):
        self.d = tempfile.mkdtemp(prefix="rt-release-")
        shutil.copytree(os.path.join(ROOT, "core"), os.path.join(self.d, "core"), ignore=shutil.ignore_patterns("__pycache__"))
        os.makedirs(os.path.join(self.d, "tools"))
        os.makedirs(os.path.join(self.d, "tests"))
        for f in ("release.py", "manifest.py"):
            shutil.copy(os.path.join(ROOT, "tools", f), os.path.join(self.d, "tools", f))
        self.write("tests/run.py", STUB_RUN)
        self.write(".gitignore", "__pycache__/\ntests/e2e/out/\ntests/FAIL\n")
        self.changelog()
        self.git("init", "-q", "-b", "main")
        self.commit("start")
        return self

    def __exit__(self, *exc):
        shutil.rmtree(self.d, ignore_errors=True)

    def write(self, rel, text):
        p = os.path.join(self.d, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as f:
            f.write(text)

    def git(self, *a):
        return subprocess.run(["git", *a], cwd=self.d, env=ENV, capture_output=True, text=True, check=True).stdout

    def commit(self, msg):
        self.git("add", "-A")
        self.git("commit", "-q", "-m", msg)

    def changelog(self, ver="0.1.0", mig="0001, 0002", manual="none", cfg=None, drop=None, ext=None):
        if cfg is None:
            cfg = ("`owner.display_name` = \"\", `port` = 8765, `report_time`, `routines`, `allowed_hosts`, "
                   "`legacy_headers`, `update.remote`, `update.check`, `feeds.interval_min`, `feeds.max_per_poll`, `feeds.snippet_chars`, "
                   "`feeds.primary_only`, `feeds.classifier`, `feeds.classifier_model`, `role.enabled`")
        text = GOOD.format(ver=ver, mig=mig, manual=manual, cfg=cfg)
        if drop:
            text = text.replace(drop, "")
        if ext:
            text = text.replace("- Extension API: unchanged", "- Extension API: " + ext)
        self.write("CHANGELOG.md", text)

    def release(self, ver="0.1.0", *extra):
        r = subprocess.run([sys.executable, "tools/release.py", ver, *extra], cwd=self.d, env=ENV, capture_output=True, text=True)
        return r.returncode, r.stdout + r.stderr

    def tags(self):
        return self.git("tag").split()


class ReleaseTest(unittest.TestCase):
    def refused(self, repo, why, ver="0.1.0"):
        head = repo.git("rev-parse", "HEAD")
        vf = os.path.join(repo.d, "VERSION")
        before = read(vf) if os.path.exists(vf) else None
        rc, out = repo.release(ver)
        self.assertEqual(rc, 1, out)
        self.assertIn("REFUSED", out)
        self.assertIn(why, out)
        self.assertEqual(repo.git("rev-parse", "HEAD"), head, "a refused release must not commit")
        self.assertNotIn(f"v{ver}", repo.tags())
        self.assertEqual(read(vf) if os.path.exists(vf) else None, before, "a refused release must not write VERSION")
        return out

    def test_complete_release_tags(self):
        with Repo() as r:
            rc, out = r.release("0.1.0", "--dry-run")
            self.assertEqual(rc, 0, out)
            self.assertEqual(r.tags(), [])
            rc, out = r.release()
            self.assertEqual(rc, 0, out)
            self.assertEqual(r.tags(), ["v0.1.0"])
            self.assertEqual(read(os.path.join(r.d, "VERSION")), "0.1.0\n")
            self.assertEqual(r.git("status", "--porcelain"), "")
            self.assertIn("Release v0.1.0", r.git("log", "-1", "--format=%s"))
            self.assertIn("### Upgrade notes", r.git("tag", "-l", "--format=%(contents)", "v0.1.0"))
            chk = subprocess.run([sys.executable, "tools/manifest.py", "--check"], cwd=r.d, capture_output=True, text=True)
            self.assertEqual(chk.returncode, 0, chk.stdout)
            self.assertIn('"version": "v0.1.0"', read(os.path.join(r.d, "core.manifest.json")))

    def test_dirty_tree(self):
        with Repo() as r:
            r.write("stray.txt", "x")
            self.refused(r, "not clean")

    def test_failing_tests(self):
        with Repo() as r:
            r.write("tests/FAIL", "")
            self.refused(r, "tests/run.py all failed")

    def test_migration_gap(self):
        with Repo() as r:
            os.rename(os.path.join(r.d, "core/migrations/0002_routines_log.py"), os.path.join(r.d, "core/migrations/0003_routines_log.py"))
            r.commit("gap")
            self.refused(r, "missing 0002")

    def test_misnamed_migration(self):
        with Repo() as r:
            r.write("core/migrations/3_oops.py", "TARGETS = ('state',)\ndef up(d, c): return d\n")
            r.commit("misnamed")
            self.refused(r, "3_oops.py not named")

    def test_missing_upgrade_notes(self):
        with Repo() as r:
            text = read(os.path.join(r.d, "CHANGELOG.md"))
            r.write("CHANGELOG.md", text[:text.index("### Upgrade notes")] + text[text.index("## 2026-11-09"):])
            r.commit("no notes")
            self.refused(r, "no '### Upgrade notes'")

    def test_upgrade_note_line_missing(self):
        with Repo() as r:
            r.changelog(drop="- Extension API: unchanged\n")
            r.commit("no ext line")
            self.refused(r, "Extension api")

    def test_unlisted_migration(self):
        with Repo() as r:
            r.changelog(mig="0001")
            r.commit("forgot 0002")
            self.refused(r, "new since the start: 0001, 0002")

    def test_unlisted_config_key(self):
        with Repo() as r:
            r.changelog(cfg="`port` = 8765")
            r.commit("forgot keys")
            self.refused(r, "does not name `allowed_hosts`")

    def test_manual_step_in_minor(self):
        with Repo() as r:
            r.changelog(manual="edit config.json by hand")
            r.commit("manual")
            self.refused(r, "only a major version")

    def test_no_section(self):
        with Repo() as r:
            self.refused(r, "no '## [0.2.0]", ver="0.2.0")

    def test_second_release_checks_only_new(self):
        with Repo() as r:
            self.assertEqual(r.release()[0], 0)
            self.refused(r, "not higher", ver="0.0.9")
            r.write("core/migrations/0003_extra.py", "TARGETS = ('state',)\ndef up(d, c): return d\n")
            r.changelog(ver="0.2.0", mig="none", cfg="none")
            r.commit("0.2.0 notes")
            self.refused(r, "new since v0.1.0: 0003", ver="0.2.0")
            r.changelog(ver="0.2.0", mig="0003", cfg="none")
            r.commit("0.2.0 notes fixed")
            rc, out = r.release("0.2.0")
            self.assertEqual(rc, 0, out)
            self.assertEqual(sorted(r.tags()), ["v0.1.0", "v0.2.0"])

    def test_extension_api(self):
        """t-oss-struct S8: the Extension API line is checked against core/registry.py API and SURFACE of the last tag."""
        with Repo() as r:
            self.assertEqual(r.release()[0], 0)
            reg = os.path.join(r.d, "core", "registry.py")
            src = read(reg)
            r.write("core/registry.py", src.replace('SURFACE = ("route",', 'SURFACE = ("widget", "route",'))
            r.changelog(ver="0.2.0", mig="none", cfg="none")
            r.commit("surface grows, notes say unchanged")
            self.refused(r, "does not name the new registry call(s) `R.widget`", ver="0.2.0")
            r.write("core/registry.py", src.replace('"health")', ')'))
            r.changelog(ver="0.2.0", mig="none", cfg="none", ext="R.health removed")
            r.commit("surface shrinks, same API")
            self.refused(r, "SURFACE dropped health without a new API number", ver="0.2.0")
            r.write("core/registry.py", src.replace("API = 1", "API = 2"))
            r.changelog(ver="0.2.0", mig="none", cfg="none", ext="api 2")
            r.commit("api bump in a minor")
            self.refused(r, "only a major version may change it", ver="0.2.0")
            r.write("core/registry.py", src.replace('SURFACE = ("route",', 'SURFACE = ("widget", "route",'))
            r.changelog(ver="0.2.0", mig="none", cfg="none", ext="new `R.widget(...)`")
            r.commit("surface grows, named")
            rc, out = r.release("0.2.0")
            self.assertEqual(rc, 0, out)


if __name__ == "__main__":
    unittest.main()
