"""t-oss-struct S8: the extension registry (core/registry.py) on its own: version checks, manifest checks, card kinds, jobs.
The end-to-end path (a fake extension with routes, actions, a job, web files, a skipped one, then removed) is tests/smoke.py registry."""
import json
import os
import shutil
import tempfile
import unittest

from tests.unit._core import ROOT  # noqa: F401  (puts the checkout on sys.path)
from core import registry as R
from core import store


class Registry(unittest.TestCase):
    def test_requires(self):
        self.assertTrue(R.requires_ok("", "0.2.0"))
        self.assertTrue(R.requires_ok(">=0.2", "0.2.0"))
        self.assertTrue(R.requires_ok(">=0.1,<1", "0.9.3"))
        self.assertFalse(R.requires_ok(">=0.3", "0.2.9"))
        self.assertFalse(R.requires_ok("<1", "1.0.0"))
        self.assertTrue(R.requires_ok("==0.2.1", "0.2.1"))
        self.assertFalse(R.requires_ok("about 0.2", "0.2.0"), "an unreadable spec must not load the extension")

    def test_check(self):
        self.assertIsNone(R.check("x", {"name": "x", "api": R.API}))
        self.assertIn("api", R.check("x", {"api": R.API + 1}))
        self.assertIn("没写 api", R.check("x", {}))
        self.assertIn("name", R.check("x", {"name": "y", "api": R.API}))
        self.assertIn("需要", R.check("x", {"api": R.API, "requires": ">=99"}))

    def test_surface_is_reg(self):
        for n in R.SURFACE:
            self.assertTrue(callable(getattr(R.Reg, n, None)), f"SURFACE names {n}, Reg has no such method")
        public = sorted(n for n in vars(R.Reg) if not n.startswith("_") and callable(getattr(R.Reg, n)))
        self.assertEqual(public, sorted(R.SURFACE), "a public Reg method missing from SURFACE (tools/release.py checks SURFACE)")

    def test_core_kinds_and_new_kind(self):
        self.assertEqual(list(R.CARD_KINDS)[:4], ["plan", "deliverable", "question", "task"])
        self.assertEqual(store.KINDS[:4], ["plan", "deliverable", "question", "task"])
        before = list(store.KINDS)
        try:
            R._card_kind("t1", "zz-kind", "测试", "Test")
            self.assertIn("zz-kind", store.KINDS)
            with self.assertRaises(ValueError):
                R._card_kind("t2", "zz-kind", "又一个")
            with self.assertRaises(ValueError):
                R._card_kind("t1", "Bad Kind")
        finally:
            R.CARD_KINDS.pop("zz-kind", None)
            store.KINDS[:] = before

    def test_scan_skips_bad(self):
        d = tempfile.mkdtemp(prefix="rt-reg-")
        try:
            for name, man in (("good", {"name": "good", "api": R.API, "card_kinds": [{"id": "zz-good", "label": ["好", "Good"]}]}),
                              ("newer", {"api": R.API + 1}), ("broken", "{not json")):
                os.makedirs(os.path.join(d, name))
                with open(os.path.join(d, name, "ext.json"), "w") as f:
                    f.write(man if isinstance(man, str) else json.dumps(man))
            os.makedirs(os.path.join(d, "plain"))
            before = list(store.KINDS)
            R.scan([os.path.join(d, n) for n in ("good", "newer", "broken", "plain")])
            try:
                self.assertIsNone(R.EXTS["good"]["skipped"])
                self.assertIn("zz-good", store.KINDS)
                self.assertTrue(R.EXTS["newer"]["skipped"])
                self.assertIn("读不了", R.EXTS["broken"]["skipped"])
                self.assertTrue(R.EXTS["plain"]["legacy"])
            finally:
                for n in ("good", "newer", "broken", "plain"):
                    R.EXTS.pop(n, None)
                R.CARD_KINDS.pop("zz-good", None)
                store.KINDS[:] = before
        finally:
            shutil.rmtree(d)

    def test_job_rules(self):
        reg = R.Reg.__new__(R.Reg)
        reg.name, reg.side = "t", "server"
        try:
            reg.job("t.one", lambda c: None, "weekly mon 09:00", label="One")
            self.assertEqual(R.JOBS["t.one"]["rule"], {"type": "weekly", "at": "09:00", "days": [1]})
            with self.assertRaises(ValueError):
                reg.job("Bad Id", lambda c: None)
            st = {"meta": {}, "schedules": []}
            self.assertEqual(R.jobs_import(st), ["s-job-t.one"])
            self.assertEqual(R.jobs_import(st), [], "a job gets its schedule entry once")
            s = st["schedules"][0]
            self.assertEqual((s["kind"], s["job"], s["title"]), ("job", "t.one", "One"))
        finally:
            R.JOBS.pop("t.one", None)


if __name__ == "__main__":
    unittest.main()
