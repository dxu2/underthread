"""Upgrade test (t-oss-struct S5): a git install of the previous release, used like a real one, updated to this commit
with tools/update.py, then rolled back. Checks the promise in CHANGELOG.md: no manual step, local/ untouched, data
migrated, config kept, your own edits to core files kept (or refused cleanly when they do not fit).

The install is a `git clone` of this repository checked out at the newest vX.Y.Z tag before HEAD. When that release
has no tools/update.py yet (v0.1.0), that one file is dropped in untracked (the way a user would get the first
updater); the update then moves them aside, because the new version tracks them. Needs git; the commit under test is
HEAD (commit first: uncommitted changes are not in the clone), or, with `python3 tests/run.py upgrade --worktree`, the
working tree as it is now (committed in a throwaway clone; this checkout is not touched). UPGRADE_DATA=<install dir> uses
a copy of that install's data files and local/ instead of the fixture board (`--data live` in run.py: this checkout's).
Takes about a minute (several trial servers).
"""
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PY = sys.executable
SEMVER = re.compile(r"^v(\d+)\.(\d+)\.(\d+)$")


def sh(*cmd, cwd, check=True, env=None):
    r = subprocess.run(list(cmd), cwd=cwd, capture_output=True, text=True, env=env, stdin=subprocess.DEVNULL)
    if check and r.returncode:
        raise AssertionError(f"{' '.join(cmd)} -> {r.returncode}\n{r.stdout}\n{r.stderr}")
    return r


def git(*a, cwd):
    return sh("git", *a, cwd=cwd).stdout.strip()


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def get(port, path, timeout=5):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=timeout) as r:
        return json.loads(r.read().decode())


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def write(p, s):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        f.write(s)


def prev_tag():
    """The newest vX.Y.Z tag that is an ancestor of HEAD and not HEAD itself."""
    if not os.path.exists(os.path.join(ROOT, ".git")):
        return None, None
    head = git("rev-parse", "HEAD", cwd=ROOT)
    tags = [t for t in git("tag", "--list", "v*", cwd=ROOT).split() if SEMVER.match(t)]
    tags.sort(key=lambda t: tuple(int(x) for x in SEMVER.match(t).groups()), reverse=True)
    for t in tags:
        c = git("rev-parse", t + "^{commit}", cwd=ROOT)
        if c != head and subprocess.run(["git", "merge-base", "--is-ancestor", c, head], cwd=ROOT).returncode == 0:
            return t, head
    return None, head


class Server:
    """The install's own server on a spare port, NO_LOOPS (no report, no push)."""

    def __init__(self, d, port):
        self.d, self.port = d, port

    def __enter__(self):
        self.logf = os.path.join(self.d, "logs", "test-server.txt")
        os.makedirs(os.path.dirname(self.logf), exist_ok=True)
        self.log = open(self.logf, "w")
        self.p = subprocess.Popen([PY, "server.py"], cwd=self.d, env=dict(os.environ, PORT=str(self.port), NO_LOOPS="1"),
                                  stdout=self.log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL)
        for _ in range(80):
            try:
                get(self.port, "/api/state?rev=-1")
                return self
            except Exception:
                time.sleep(0.25)
        self.__exit__()
        raise AssertionError("server did not start:\n" + read(self.logf)[-2000:])

    def __exit__(self, *a):
        self.p.terminate()
        try:
            self.p.wait(10)
        except subprocess.TimeoutExpired:
            self.p.kill()
        self.log.close()


PREV, HEAD = prev_tag()


@unittest.skipUnless(PREV, "needs git and an earlier vX.Y.Z tag")
class Upgrade(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="ut-upgrade-")
        cls.d = d = os.path.join(cls.tmp, "inst")
        sh("git", "clone", "--quiet", "--no-hardlinks", ROOT, d, cwd=cls.tmp)
        sh("git", "checkout", "--quiet", "-B", "main", PREV, cwd=d)   # a user who cloned the previous release
        cls.prev = git("rev-parse", "HEAD", cwd=d)
        cls.port = free_port()
        cls.bootstrapped = not os.path.exists(os.path.join(d, "tools", "update.py"))
        if cls.bootstrapped:   # the first updater arrives untracked
            write(os.path.join(d, "tools", "update.py"), git("show", f"{HEAD}:tools/update.py", cwd=ROOT) + "\n")
        real = os.environ.get("UPGRADE_DATA")   # t-iter-upgrade: rehearse on a copy of a real install's data and local/
        if real:
            for f in ("state.json", "config.json", "roster.json", "archive.json", "inbox.jsonl", "feeds.json"):
                if os.path.exists(os.path.join(real, f)):
                    shutil.copy2(os.path.join(real, f), os.path.join(d, f))
            if os.path.isdir(os.path.join(real, "local")):
                shutil.copytree(os.path.join(real, "local"), os.path.join(d, "local"), symlinks=True, dirs_exist_ok=True,
                                ignore=shutil.ignore_patterns("backups", "__pycache__", "*.tar.gz"))
        else:
            sh(PY, os.path.join(ROOT, "tests", "e2e", "fixtures", "load.py"), d, cwd=ROOT)
        cfg = json.loads(read(os.path.join(d, "config.json")))
        cfg.update(port=cls.port, report_time="07:30")   # a value you changed; the port keeps the checks off any live dashboard
        write(os.path.join(d, "config.json"), json.dumps(cfg, ensure_ascii=False, indent=2) + "\n")
        cls.local = {
            "local/roles/writer.md": "# My writer rules\n- Short titles. (2026-01-01)\n",
            "local/manager.md": "# My steward notes\n",
            "local/ext/hello/server_ext.py": ("def register(srv):\n"
                                              "    def hello(h, u, q):\n"
                                              "        if u.path == '/api/hello':\n"
                                              "            return h._send(200, {'hello': 1})\n"
                                              "    srv.EXT_GET.append(hello)\n"),
        }
        for k, v in cls.local.items():
            write(os.path.join(d, k), v)
        changed = set(git("diff", "--no-renames", "--name-only", PREV, HEAD, cwd=ROOT).split())   # a moved file counts as changed (SECURITY.md went to .github/)
        cls.mine = next(f for f in ("policy.md", "team.md", "SECURITY.md", "CODE_OF_CONDUCT.md", "LICENSE") if f not in changed)
        write(os.path.join(d, cls.mine), read(os.path.join(d, cls.mine)) + "\n<!-- my own line -->\n")
        with Server(d, cls.port) as s:   # the old version runs once on this data
            cls.cards = len(get(s.port, "/api/state?rev=-1").get("items") or [])
            cls.ext_old = get(s.port, "/api/hello")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def upd(self, *a):
        return sh(PY, "tools/update.py", *a, cwd=self.d, check=False, env=dict(os.environ, UPDATE_HEALTH_WAIT="20"))

    def working(self):
        st = json.loads(read(os.path.join(self.d, "state.json")))
        return [i for i, a in (st.get("agents") or {}).items() if a.get("status") == "working" and i != "manager"]

    def test_upgrade_then_rollback(self):
        d = self.d
        self.assertEqual(self.ext_old, {"hello": 1})
        busy = self.working()
        if busy:   # the fixture board has crew at work: the update must wait
            r = self.upd("apply", "--to", HEAD)
            self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
            self.assertIn("working now", r.stdout, r.stdout + r.stderr)
            self.assertEqual(git("rev-parse", "HEAD", cwd=d), self.prev, "a refused update changes nothing")
        for i in busy:
            sh(PY, "stateutil.py", "set-agent", i, "--status", "idle", cwd=d)

        # ---- trial only (t-iter-upgrade): nothing on the install changes ----
        r = self.upd("apply", "--to", HEAD, "--dry-run")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("nothing changed here", r.stdout)
        self.assertEqual(git("rev-parse", "HEAD", cwd=d), self.prev, "a dry run does not switch")

        # ---- update ----
        r = self.upd("apply", "--to", HEAD)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(git("rev-parse", "HEAD", cwd=d), HEAD)
        self.assertEqual(read(os.path.join(d, "VERSION")).strip(), git("show", f"{HEAD}:VERSION", cwd=ROOT))
        for k, v in self.local.items():
            self.assertEqual(read(os.path.join(d, k)), v, f"{k} must not change")
        self.assertIn("<!-- my own line -->", read(os.path.join(d, self.mine)), "your core edit is put back")
        self.assertEqual(git("status", "--porcelain", "--untracked-files=no", cwd=d), f"M {self.mine}")
        cfg = json.loads(read(os.path.join(d, "config.json")))
        self.assertEqual((cfg["report_time"], cfg["port"]), ("07:30", self.port), "your settings stay")
        self.assertNotIn("update", cfg, "defaults are merged at read time, never written into config.json")
        sch = json.loads(sh(PY, "stateutil.py", "schema", "--json", cwd=d).stdout)
        self.assertEqual(sch["state"], sch["code"])
        hist = json.loads(read(os.path.join(d, "local", "backups", "update", "history.json")))
        self.assertEqual(hist[-1]["status"], "ok")
        self.assertTrue(os.path.exists(os.path.join(d, hist[-1]["data"])), "data snapshot")
        if self.bootstrapped:
            self.assertEqual(hist[-1]["aside"], ["tools/update.py"])
        inbox = [json.loads(x) for x in read(os.path.join(d, "inbox.jsonl")).splitlines() if x.strip()]
        self.assertEqual(inbox[-1]["kind"], "update_done")
        self.assertEqual(len(git("worktree", "list", cwd=d).splitlines()), 1, "trial worktree removed")
        with Server(d, self.port) as s:
            self.assertEqual(len(get(s.port, "/api/state?rev=-1").get("items") or []), self.cards)
            self.assertEqual(get(s.port, "/api/hello"), {"hello": 1}, "an old-style extension still loads")
            pc = sh(PY, "-c", "import importlib.util as I, sys; s = I.spec_from_file_location('u', 'tools/update.py'); "
                    "u = I.module_from_spec(s); s.loader.exec_module(u); print(u.page_check(int(sys.argv[1])))", str(s.port), cwd=d)
            self.assertEqual(pc.stdout.strip(), "[]", "the new page and every file it loads answer 200 (t-iter-upgrade)")
            u = get(s.port, "/api/update")
            self.assertEqual((u["version"], u["git"]), (read(os.path.join(d, "VERSION")).strip(), True))
            self.assertTrue(u["rollback"], "the settings page offers a way back")
            self.assertEqual(u["run"]["ok"], True)

        # ---- rollback ----
        r = self.upd("rollback")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(git("rev-parse", "HEAD", cwd=d), self.prev)
        self.assertIn("<!-- my own line -->", read(os.path.join(d, self.mine)))
        for k, v in self.local.items():
            self.assertEqual(read(os.path.join(d, k)), v)
        if self.bootstrapped:
            self.assertTrue(os.path.exists(os.path.join(d, "tools", "update.py")), "moved-aside files come back")
        with Server(d, self.port) as s:   # the old code reads the data the new code wrote
            self.assertEqual(len(get(s.port, "/api/state?rev=-1").get("items") or []), self.cards)
            self.assertEqual(get(s.port, "/api/hello"), {"hello": 1})
        r = self.upd("rollback")
        self.assertEqual(r.returncode, 1, "nothing left to go back from")

        # ---- your core edit does not fit the new version ----
        sh("git", "checkout", "--quiet", "--", self.mine, cwd=d)
        write(os.path.join(d, "CHANGELOG.md"), "mine\n")
        r = self.upd("apply", "--to", HEAD)
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("CONFLICT", r.stdout, r.stdout + r.stderr)
        self.assertEqual(git("rev-parse", "HEAD", cwd=d), self.prev, "a conflict stops before the switch")
        self.assertEqual(read(os.path.join(d, "CHANGELOG.md")), "mine\n")
        r = self.upd("apply", "--to", HEAD, "--discard-mine")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(git("rev-parse", "HEAD", cwd=d), HEAD)
        self.assertEqual(git("status", "--porcelain", "--untracked-files=no", cwd=d), "")
        hist = json.loads(read(os.path.join(d, "local", "backups", "update", "history.json")))
        self.assertTrue(hist[-1]["dropped_mine"])
        self.assertIn("mine", read(os.path.join(d, hist[-1]["patch"])), "the dropped edit is kept as a patch")


class NotGit(unittest.TestCase):
    def test_zip_install_is_told_to_use_git(self):
        tmp = tempfile.mkdtemp(prefix="ut-zip-")
        try:
            for f in ("tools/update.py", "VERSION"):
                os.makedirs(os.path.dirname(os.path.join(tmp, f)), exist_ok=True)
                shutil.copy(os.path.join(ROOT, f), os.path.join(tmp, f))
            for cmd in ("check", "apply"):
                r = sh(PY, "tools/update.py", cmd, cwd=tmp, check=False)
                self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
                self.assertIn("git clone", r.stdout)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
