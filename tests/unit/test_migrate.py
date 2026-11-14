"""t-oss-struct E1 + E2: schema numbers, ordered migrations, config defaults, localStorage steps."""
import copy
import json
import os
import shutil
import subprocess
import tempfile
import unittest

from tests.unit._core import ROOT, Core

FIXTURE = os.path.join(ROOT, "tests", "e2e", "fixtures", "state.json")


def old_install_state():
    """The fixture board as an install from before schema numbers would have it."""
    with open(FIXTURE, encoding="utf-8") as f:
        st = json.load(f)
    st["meta"].pop("schema", None)
    st["meta"].pop("migrations", None)
    return st


def write(path, data, indent=1):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=indent)


def readb(path):
    with open(path, "rb") as f:
        return f.read()


def readj(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def step_file(d, name, body):
    with open(os.path.join(d, name), "w", encoding="utf-8") as f:
        f.write(body)


class Framework(unittest.TestCase):
    def test_steps_numbered_without_gaps(self):
        with Core() as c:
            MG = c.stateutil.MG
            self.assertEqual([s.n for s in MG.STEPS], list(range(1, len(MG.STEPS) + 1)))
            self.assertEqual(MG.LATEST, len(MG.STEPS))
            self.assertTrue(all(s.targets for s in MG.STEPS))

    def test_gap_or_bad_step_is_refused(self):
        with Core() as c:
            MG = c.stateutil.MG
            d = tempfile.mkdtemp()
            try:
                step_file(d, "0001_a.py", "TARGETS = ('state',)\ndef up(d, c): pass\n")
                step_file(d, "0003_c.py", "TARGETS = ('state',)\ndef up(d, c): pass\n")
                with self.assertRaises(RuntimeError):
                    MG.discover(d)
                os.remove(os.path.join(d, "0003_c.py"))
                step_file(d, "0002_b.py", "TARGETS = ('nope',)\ndef up(d, c): pass\n")
                with self.assertRaises(RuntimeError):
                    MG.discover(d)
            finally:
                shutil.rmtree(d)

    def test_every_step_is_idempotent(self):
        with Core() as c:
            MG = c.stateutil.MG
            for target, data in (("state", old_install_state()), ("config", {"port": 8765}), ("roster", {"roles": [{"id": "a"}]})):
                for s in MG.STEPS:
                    if target not in s.targets:
                        continue
                    once = copy.deepcopy(data)
                    s.mod.up(once, {"root": c.dir, "now": "2026-01-01T00:00:00+00:00"})
                    twice = copy.deepcopy(once)
                    s.mod.up(twice, {"root": c.dir, "now": "2026-01-01T00:00:00+00:00"})
                    self.assertEqual(once, twice, f"{s.id} on {target}")

    def test_run_stamps_logs_and_is_a_noop_the_second_time(self):
        with Core() as c:
            MG = c.stateutil.MG
            st = old_install_state()
            ran = MG.run("state", st, c.dir, now="2026-01-01T00:00:00+00:00")
            self.assertEqual(ran, [s.id for s in MG.STEPS if "state" in s.targets])
            self.assertEqual(st["meta"]["schema"], MG.LATEST)
            self.assertEqual(st["meta"]["migrations"][-1], {"from": 0, "to": MG.LATEST, "ran": ran, "at": "2026-01-01T00:00:00+00:00"})
            again = copy.deepcopy(st)
            self.assertEqual(MG.run("state", again, c.dir), [])
            self.assertEqual(again, st)

    def test_steps_only_add(self):
        """Minor-version rule: a migrated old state keeps every key it had, with the same value (old code can still read it)."""
        with Core() as c:
            MG = c.stateutil.MG
            old = old_install_state()
            new = copy.deepcopy(old)
            MG.run("state", new, c.dir)

            def check(a, b, path):
                if isinstance(a, dict):
                    for k, v in a.items():
                        self.assertIn(k, b, f"{path}.{k} removed")
                        check(v, b[k], f"{path}.{k}")
                else:
                    self.assertEqual(a, b, path)
            check(old, new, "state")

    def test_data_ahead_of_code_is_left_alone(self):
        with Core() as c:
            S, MG = c.stateutil, c.stateutil.MG
            st = old_install_state()
            st["meta"]["schema"] = MG.LATEST + 5
            write(S.STATE, st)
            before = readb(S.STATE)
            got = S.read()
            self.assertEqual(got["meta"]["schema"], MG.LATEST + 5)
            self.assertEqual(readb(S.STATE), before)
            self.assertEqual(MG.status(c.dir, got)["ahead"], ["state"])
            with S.mutate() as m:   # writes still work and keep the newer number
                m["chat"].append(S._chat_entry("me", "hi"))
            self.assertEqual(S.read()["meta"]["schema"], MG.LATEST + 5)


class StateUpgrade(unittest.TestCase):
    def test_first_read_migrates_once_with_a_byte_exact_backup(self):
        with Core() as c:
            S, MG = c.stateutil, c.stateutil.MG
            write(S.STATE, old_install_state())
            raw = readb(S.STATE)
            st = S.read()   # read() holds a shared lock: it must retake it exclusively and migrate
            self.assertEqual(st["meta"]["schema"], MG.LATEST)
            self.assertEqual(readj(S.STATE)["meta"]["schema"], MG.LATEST)
            bdir = os.path.join(c.dir, ".backups", "migrate")   # no local/ in this copy
            files = os.listdir(bdir)
            self.assertEqual(len(files), 1)
            self.assertTrue(files[0].startswith("state.json-s0-"))
            self.assertEqual(readb(os.path.join(bdir, files[0])), raw)
            S.read()
            with S.mutate():
                pass
            self.assertEqual(len(os.listdir(bdir)), 1, "a current state is never backed up again")
            self.assertEqual(len(S.read()["meta"]["migrations"]), 1)
            self.assertFalse(os.path.isdir(os.path.join(c.dir, "local")), "a backup must not create local/")

    def test_backup_goes_to_local_when_the_layer_exists(self):
        with Core() as c:
            S = c.stateutil
            os.makedirs(os.path.join(c.dir, "local"))
            write(S.STATE, old_install_state())
            with S.mutate():
                pass
            self.assertEqual(len(os.listdir(os.path.join(c.dir, "local", "backups", "migrate"))), 1)

    def test_fresh_install_starts_current_without_a_backup(self):
        with Core() as c:
            S, MG = c.stateutil, c.stateutil.MG
            shutil.copy(os.path.join(ROOT, "state.example.json"), c.dir)
            self.assertEqual(S.read()["meta"]["schema"], MG.LATEST)
            self.assertFalse(os.path.exists(os.path.join(c.dir, ".backups")))

    def test_routines_log_step(self):
        with Core() as c:
            S = c.stateutil
            st = old_install_state()
            st["meta"].pop("routines_log", None)
            write(S.STATE, st)
            with open(S.INBOX, "w", encoding="utf-8") as f:
                for d in ("2026-01-02", "2026-01-01", "2026-01-02"):
                    f.write(json.dumps({"kind": "routine_due", "routine": "paper", "date": d}) + "\n")
                f.write("not json\n")
            self.assertEqual(S.read()["meta"]["routines_log"], {"paper": ["2026-01-01", "2026-01-02"]})
            st = old_install_state()
            st["meta"]["routines_log"] = {"x": ["2025-12-31"]}
            write(S.STATE, st)
            self.assertEqual(S.read()["meta"]["routines_log"], {"x": ["2025-12-31"]}, "an existing log is kept")


class ConfigDefaults(unittest.TestCase):
    def setUp(self):
        self.c = Core().__enter__()
        from core import config as C   # the copy's core (Core put its folder first on sys.path)
        self.C = C

    def tearDown(self):
        self.c.__exit__(None, None, None)

    def test_merge_fills_missing_and_keeps_yours(self):
        C = self.C
        path = os.path.join(self.c.dir, "config.json")
        write(path, {"report_time": "20:30", "owner": {"display_name": "Me", "extra": 1}, "comfy": {"ssh_host": "h"}}, indent=2)
        raw = readb(path)
        eff = C.load(self.c.dir)
        self.assertEqual(eff["report_time"], "20:30")
        self.assertEqual(eff["port"], 8765)
        self.assertEqual(eff["owner"], {"display_name": "Me", "extra": 1})
        self.assertEqual(eff["allowed_hosts"], [])
        self.assertEqual(eff["comfy"], {"ssh_host": "h"})
        self.assertEqual(readb(path), raw, "defaults are never written into config.json")
        src = dict((k, f) for k, _, f in C.sources(self.c.dir))
        self.assertEqual(src["report_time"], "yours")
        self.assertEqual(src["port"], "default")
        self.assertEqual(src["owner.display_name"], "yours")

    def test_no_feature_block_defaults(self):
        """A present comfy / voice / github block switches a feature on; DEFAULTS must not invent one."""
        for k in ("comfy", "voice", "github", "platforms"):
            self.assertNotIn(k, self.C.DEFAULTS)
        self.assertEqual(self.C.load(self.c.dir), self.C.DEFAULTS, "missing config.json = defaults")

    def test_merge_does_not_share_lists(self):
        a = self.C.load(self.c.dir)
        a["routines"].append(1)
        self.assertEqual(self.C.DEFAULTS["routines"], [])

    def test_example_is_generated(self):
        with open(os.path.join(ROOT, "config.example.json"), encoding="utf-8") as f:
            self.assertEqual(f.read(), self.C.example_text(), "run python3 -m core.config example --write")

    def test_roster_role_defaults(self):
        write(os.path.join(self.c.dir, "roster.json"), {"roles": [{"id": "a"}, {"id": "b", "enabled": False}]}, indent=2)
        roles = self.C.roster(self.c.dir)["roles"]
        self.assertEqual([r["enabled"] for r in roles], [True, False])
        self.assertNotIn("enabled", readj(os.path.join(self.c.dir, "roster.json"))["roles"][0])

    def test_config_step_rewrites_only_on_change(self):
        """A step that renames a key: the file is backed up, rewritten with _schema first; an unchanged file is left as it is."""
        MG = self.C.MG
        d = tempfile.mkdtemp()
        try:
            for s in MG.STEPS:
                shutil.copy(os.path.join(MG.MIG_DIR, f"{s.id}.py"), d)
            n = MG.LATEST + 1
            step_file(d, f"{n:04d}_rename.py", "TARGETS = ('config',)\ndef up(c, x):\n    if 'reportTime' in c:\n        c.setdefault('report_time', c['reportTime'])\n")
            steps = MG.discover(d)
            saved = MG.STEPS, MG.LATEST
            MG.STEPS, MG.LATEST = steps, n
            try:
                path = os.path.join(self.c.dir, "config.json")
                write(path, {"port": 9000}, indent=2)
                raw = readb(path)
                self.C.load(self.c.dir)
                self.assertEqual(readb(path), raw)
                write(path, {"reportTime": "07:00"}, indent=2)
                self.assertEqual(self.C.load(self.c.dir)["report_time"], "07:00")
                on_disk = readj(path)
                self.assertEqual(list(on_disk)[0], "_schema")
                self.assertEqual(on_disk["_schema"], n)
                self.assertEqual(on_disk["reportTime"], "07:00", "add-only: the old key stays")
                self.assertTrue(any(f.startswith("config.json-s0-") for f in os.listdir(os.path.join(self.c.dir, ".backups", "migrate"))))
            finally:
                MG.STEPS, MG.LATEST = saved
        finally:
            shutil.rmtree(d)


@unittest.skipUnless(shutil.which("node"), "node not installed")
class LocalStorageSteps(unittest.TestCase):
    JS = r"""
const fs = require("fs"); const store = new Map(Object.entries(JSON.parse(process.argv[2])));
const L = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
global.window = { localStorage: L };
for (let i = 0; i < 2; i++) eval(fs.readFileSync(process.argv[1], "utf8"));
console.log(JSON.stringify({ store: Object.fromEntries(store), n: window.RT_LS_SCHEMA }));
"""

    def run_js(self, store):
        r = subprocess.run(["node", "-e", self.JS, os.path.join(ROOT, "web", "lsmigrate.js"), json.dumps(store)],
                           capture_output=True, text=True, check=True)
        return json.loads(r.stdout)

    def test_steps_run_once_in_order(self):
        out = self.run_js({"rt.mailUnread": "true", "rt.esMiss": "1", "rt.theme": "\"dark\""})
        self.assertEqual(out["store"], {"rt.theme": "\"dark\"", "rt.schema": str(out["n"])})

    def test_device_ahead_is_left_alone(self):
        out = self.run_js({"rt.schema": "99", "rt.mailUnread": "true"})
        self.assertEqual(out["store"], {"rt.schema": "99", "rt.mailUnread": "true"})

    def test_loaded_first(self):
        html = readb(os.path.join(ROOT, "web", "index.html")).decode("utf-8")
        self.assertLess(html.index("/static/lsmigrate.js"), html.index("localStorage"), "lsmigrate.js must run before any inline script reads rt.*")


if __name__ == "__main__":
    unittest.main()
