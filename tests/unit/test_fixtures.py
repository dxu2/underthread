"""tests/e2e/fixtures: the committed fixture is what build.py makes today, and load.py keeps its spacing."""
import datetime as dt
import importlib.util
import json
import os
import subprocess
import sys
import unittest

FX = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "e2e", "fixtures")


def _load_mod():
    spec = importlib.util.spec_from_file_location("rt_fx_load", os.path.join(FX, "load.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


class Fixtures(unittest.TestCase):
    def test_committed_fixture_matches_a_fresh_build(self):
        r = subprocess.run([sys.executable, os.path.join(FX, "build.py"), "--check"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_fixture_has_the_ids_journeys_use(self):
        with open(os.path.join(FX, "state.json"), encoding="utf-8") as f:
            st = json.load(f)
        ids = {i["id"]: i for i in st["items"]}
        for n in range(1, 8):
            self.assertIn(f"fx-{n}", ids)
        self.assertEqual(ids["fx-4"]["stage"], "done")
        self.assertTrue(any(a.get("answer") is None for a in ids["fx-7"].get("asks", [])))
        self.assertGreaterEqual(len(st["schedules"]), 2)

    def test_rebase_keeps_spacing_and_lands_near_now(self):
        m = _load_mod()
        st = {"meta": {"fixture": {"end": "2026-01-15T12:00:00+00:00"}},
              "a": "2026-01-15T11:00:00+00:00", "b": "2026-01-15T12:00:00+00:00", "d": "2026-01-15"}
        now = dt.datetime(2026, 3, 1, 8, 0, tzinfo=dt.timezone.utc)
        out = m.rebase(st, now)
        a, b = dt.datetime.fromisoformat(out["a"]), dt.datetime.fromisoformat(out["b"])
        self.assertEqual(b - a, dt.timedelta(hours=1))
        self.assertEqual(now - b, dt.timedelta(minutes=1))
        self.assertEqual(out["d"], (dt.date(2026, 1, 15) + dt.timedelta(days=(now.date() - dt.date(2026, 1, 15)).days)).isoformat())


if __name__ == "__main__":
    unittest.main()
