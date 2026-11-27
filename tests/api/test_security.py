"""t-oss-secreview (v0.3.1): response headers and the hardening of the action API, on the fixture board."""
import json
import os
import subprocess
import sys
import unittest

from tests.api._server import FixtureServer

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class Security(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.s = FixtureServer()

    @classmethod
    def tearDownClass(cls):
        cls.s.stop()

    def _hdr(self, path):
        import urllib.request
        r = urllib.request.urlopen(f"http://127.0.0.1:{self.s.port}{path}")
        return {k.lower(): v for k, v in r.headers.items()}

    def test_pages_refuse_cross_site_framing(self):
        for p in ("/", "/api/health"):
            h = self._hdr(p)
            self.assertEqual(h.get("x-frame-options"), "SAMEORIGIN", p)
            self.assertIn("frame-ancestors 'self'", h.get("content-security-policy", ""), p)
            self.assertEqual(h.get("x-content-type-options"), "nosniff", p)

    def test_user_html_and_svg_are_sandboxed(self):
        d = os.path.join(self.s.root, "work", "sec-test")
        os.makedirs(d, exist_ok=True)
        for n, body in (("a.html", "<p>x</p>"), ("a.svg", "<svg xmlns='http://www.w3.org/2000/svg'/>"), ("a.png", "")):
            with open(os.path.join(d, n), "w") as f:
                f.write(body)
        for n in ("a.html", "a.svg"):
            self.assertIn("sandbox", self._hdr(f"/work/sec-test/{n}").get("content-security-policy", ""), n)
        self.assertNotIn("sandbox", self._hdr("/work/sec-test/a.png").get("content-security-policy", ""))
        self.assertNotIn("sandbox", self._hdr("/").get("content-security-policy", ""))

    def test_server_error_does_not_echo_details(self):
        c, b = self.s.action({"kind": "mail_read", "ids": 5})   # set(5) raises TypeError inside the handler
        self.assertEqual(c, 500)
        self.assertEqual(json.loads(b)["error"], "server error")

    def test_forged_push_link_does_not_mark_mail_read(self):
        st = self.s.json("/api/state")
        m = next((x for x in st["mail"] if not x.get("read")), None)
        if m is None:
            self.skipTest("fixture has no unread mail")
        c, _ = self.s.action({"kind": "mail_read", "ids": [m["id"]], "push": "made-up"})
        self.assertEqual(c, 200)
        self.assertFalse(next(x for x in self.s.json("/api/state")["mail"] if x["id"] == m["id"]).get("read"))
        c, _ = self.s.action({"kind": "mail_read", "ids": [m["id"]]})   # an in-page click still marks it
        self.assertTrue(next(x for x in self.s.json("/api/state")["mail"] if x["id"] == m["id"]).get("read"))

    def test_bad_ids_are_refused(self):
        r = subprocess.run([sys.executable, "stateutil.py", "upsert-item", "--id", 'x"><img>', "--title", "t"], cwd=self.s.root, capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("bad card id", r.stderr + r.stdout)
        r = subprocess.run([sys.executable, "stateutil.py", "upsert-item", "--id", "sec-ok-1", "--title", "t", "--attach", "work/a'b.png"], cwd=self.s.root, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)   # an apostrophe in a file name is fine (the page no longer puts paths in inline JS)
        r = subprocess.run([sys.executable, "stateutil.py", "upsert-item", "--id", "sec-ok-2", "--title", "t", "--attach", 'work/a"b.png'], cwd=self.s.root, capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0)
        r = subprocess.run([sys.executable, "stateutil.py", "set-agent", "a<b", "--status", "idle"], cwd=self.s.root, capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0)


if __name__ == "__main__":
    unittest.main()
