"""One way to read roster.json / config.json / state.json (t-oss-struct B1): through core.config and core.store, so every
reader sees migrated data and the defaults. A script that opens one of them itself would read data from before a migration."""
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest

from tests.unit._core import Core

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# files allowed to open the data files themselves: core/ owns them; demo.py writes a separate demo folder's seed files
ALLOWED = ("core/", "tests/", "tools/demo.py", "tools/preset.py")
_OPEN = re.compile(r'"(roster|config|state)\.json"')


class OneReader(unittest.TestCase):
    def test_no_script_opens_the_data_files_itself(self):
        files = subprocess.run(["git", "ls-files", "*.py"], cwd=ROOT, capture_output=True, text=True).stdout.split()
        if not files:
            self.skipTest("not a git checkout")
        bad = []
        for f in files:
            if f.startswith(ALLOWED):
                continue
            with open(os.path.join(ROOT, f), encoding="utf-8") as fh:
                for n, line in enumerate(fh, 1):
                    if _OPEN.search(line) and re.search(r"\bopen\(|json\.load", line):
                        bad.append(f"{f}:{n}: {line.strip()[:100]}")
        self.assertEqual(bad, [], "read these through core.config (roster / load) or core.store (read)")


class RosterReaders(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp(prefix="rt-readers-")

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def _write(self, name, data, raw=None):
        with open(os.path.join(self.d, name), "w", encoding="utf-8") as f:
            f.write(raw if raw is not None else json.dumps(data, ensure_ascii=False, indent=2) + "\n")

    def test_example_fallback_only_when_asked_and_never_written(self):
        with Core():
            from core import config as C
            self._write("roster.example.json", {"roles": [{"id": "ex"}]})
            before = open(os.path.join(self.d, "roster.example.json"), encoding="utf-8").read()
            self.assertEqual(C.roster(self.d)["roles"], [])
            self.assertEqual([r["id"] for r in C.roster(self.d, example=True)["roles"]], ["ex"])
            self.assertEqual(open(os.path.join(self.d, "roster.example.json"), encoding="utf-8").read(), before)
            self._write("roster.json", {"roles": [{"id": "mine"}]})
            self.assertEqual([r["id"] for r in C.roster(self.d, example=True)["roles"]], ["mine"])

    def test_strict_raises_on_missing_or_broken(self):
        with Core():
            from core import config as C
            with self.assertRaises(OSError):
                C.roster(self.d, strict=True)
            self._write("roster.json", None, raw="{broken")
            with self.assertRaises(ValueError):
                C.roster(self.d, strict=True)
            self.assertEqual(C.roster(self.d)["roles"], [])   # lenient readers still get an empty roster

    def test_roster_file_round_trip_adds_nothing(self):
        with Core():
            from core import config as C
            data = {"_note": "x", "roles": [{"id": "a", "name": "A"}, {"id": "b", "enabled": False}]}
            self._write("roster.json", data)
            got = C.roster_file(self.d)
            self.assertEqual(got, data)   # no ROLE_DEFAULTS, no _schema stamp the file did not have
            self.assertNotIn("enabled", got["roles"][0])
            self._write("roster.json", dict(data, _schema=1))
            self.assertIn("_schema", C.roster_file(self.d))

    def test_roster_file_raises_on_broken(self):
        with Core():
            from core import config as C
            self._write("roster.json", None, raw="{broken")
            with self.assertRaises(ValueError):
                C.roster_file(self.d)


if __name__ == "__main__":
    unittest.main()
