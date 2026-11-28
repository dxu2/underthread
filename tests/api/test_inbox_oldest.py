"""t-oss-monitor-check: meta.inbox_oldest = when the oldest inbox entry the steward has not acked yet was written (None when
everything is acked). The page shows "not listening?" when it is 10+ minutes old (web/js/views/header.js mgrState), in the
full state and in the long poll's "same" answer alike."""
import json
import os
import unittest

from tests.api._server import FixtureServer


class InboxOldest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.s = FixtureServer()

    @classmethod
    def tearDownClass(cls):
        cls.s.stop()

    def add(self, eid, t):
        with open(os.path.join(self.s.root, "inbox.jsonl"), "a", encoding="utf-8") as f:
            f.write(json.dumps({"kind": "manager", "text": "hi", "id": eid, "t": t}) + "\n")

    def test_oldest_unacked_and_ack(self):
        self.s.su("inbox-ack", *[e["id"] for e in self.s.inbox()] or ["none"])
        st = self.s.json("/api/state?rev=-1")
        self.assertIsNone(st["meta"].get("inbox_oldest"), "nothing waiting")
        self.add("in-test-a", "2026-01-02T03:04:05+00:00")
        self.add("in-test-b", "2026-01-02T03:09:00+00:00")
        st = self.s.json("/api/state?rev=-1")
        self.assertEqual(st["meta"]["inbox_unacked"], 2)
        self.assertEqual(st["meta"]["inbox_oldest"], "2026-01-02T03:04:05+00:00")
        same = self.s.json(f"/api/state?rev={st['meta']['rev']}&slim=1")
        self.assertTrue(same.get("same"), same)
        self.assertEqual(same["meta"]["inbox_oldest"], "2026-01-02T03:04:05+00:00", "the long poll carries it too")
        self.s.su("inbox-ack", "in-test-a")
        self.assertEqual(self.s.json("/api/state?rev=-1")["meta"]["inbox_oldest"], "2026-01-02T03:09:00+00:00")
        self.s.su("inbox-ack", "in-test-b")
        self.assertIsNone(self.s.json("/api/state?rev=-1")["meta"].get("inbox_oldest"))


if __name__ == "__main__":
    unittest.main()
