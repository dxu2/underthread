"""t-avatar-live-refresh: a swapped avatar (tools/avatar_sizes.py rewrites avatars/_s/index.json or avatars/ut/_s/index.json) never
touches state.json, so rev stays put. The server reports the two manifests' version as meta.avv, in full answers and in long-poll
"same" answers, and wakes a waiting long poll when it moves; the page refetches the manifests on a change (web/js/core/av.js avvSeen)."""
import json
import os
import threading
import time
import unittest

from tests.api._server import FixtureServer


class AvatarVersion(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.s = FixtureServer()

    @classmethod
    def tearDownClass(cls):
        cls.s.stop()

    def bump(self, rel):
        p = os.path.join(self.s.root, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        try:
            m = json.load(open(p))
        except (OSError, ValueError):
            m = {}
        m["zz-test"] = {"src": "zz-test.png", "etag": '"%x-1"' % time.time_ns()}
        tmp = p + ".tmp"
        with open(tmp, "w") as fh:
            json.dump(m, fh)
        os.replace(tmp, p)   # same as avatar_sizes.py

    def test_full_and_same_answers_carry_avv(self):
        st = self.s.json("/api/state?slim=1")
        self.assertIn("avv", st["meta"])
        same = self.s.json(f"/api/state?slim=1&rev={st['meta']['rev']}")
        self.assertTrue(same.get("same"))
        self.assertEqual(same["meta"]["avv"], st["meta"]["avv"])

    def test_manifest_rewrite_moves_avv_and_full_state(self):
        for rel in ("avatars/_s/index.json", "avatars/ut/_s/index.json"):
            v0 = self.s.json("/api/state?slim=1")["meta"]["avv"]
            time.sleep(0.01)
            self.bump(rel)
            st = self.s.json("/api/state?slim=1")
            self.assertNotEqual(st["meta"]["avv"], v0, rel)   # the cached body is not served stale
            self.assertEqual(self.s.json(f"/api/state?slim=1&rev={st['meta']['rev']}")["meta"]["avv"], st["meta"]["avv"])

    def test_long_poll_wakes_on_avatar_change(self):
        st = self.s.json("/api/state?slim=1")
        threading.Timer(1.0, self.bump, ["avatars/ut/_s/index.json"]).start()
        t0 = time.time()
        same = self.s.json(f"/api/state?slim=1&rev={st['meta']['rev']}&wait=10")
        self.assertLess(time.time() - t0, 5, "the wait should end when the manifest changes, not after 10 s")
        self.assertTrue(same.get("same"))
        self.assertNotEqual(same["meta"]["avv"], st["meta"]["avv"])


if __name__ == "__main__":
    unittest.main()
