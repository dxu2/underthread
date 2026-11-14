"""HTTP contract of server.py on the fixture board: what the page and the scripts rely on.
Golden snapshots of whole responses come with the server split (plan step S6); these are the stable basics."""
import time
import unittest

from tests.api._server import FixtureServer


class Api(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.s = FixtureServer()

    @classmethod
    def tearDownClass(cls):
        cls.s.stop()

    def test_health_reports_loops_off(self):
        h = self.s.json("/api/health")
        self.assertFalse(h["server"]["loops"])

    def test_state_has_the_fixture_board(self):
        st = self.s.json("/api/state")
        ids = {i["id"] for i in st["items"]}
        self.assertTrue({"fx-1", "fx-7", "q-demo-plan"} <= ids, ids)
        for k in ("meta", "agents", "chat", "dms", "mail", "schedules"):
            self.assertIn(k, st)

    def test_slim_state_leaves_out_done_drafts(self):
        st = self.s.json("/api/state?slim=1")
        done = [i for i in st["items"] if i["stage"] == "done"]
        self.assertTrue(done)
        self.assertTrue(all(i.get("slim") for i in done), done)

    def test_item_endpoint_returns_full_card(self):
        it = self.s.json("/api/item?id=fx-4")
        it = it.get("item", it)
        self.assertEqual(it["id"], "fx-4")
        self.assertTrue(it.get("draft"))

    def test_unknown_host_is_refused(self):
        c, _ = self.s.req("/api/state", headers={"Host": "evil.example"})
        self.assertEqual(c, 421)

    def test_browser_post_needs_the_header(self):
        o = f"http://127.0.0.1:{self.s.port}"
        c, _ = self.s.req("/api/action", "POST", {"kind": "comment", "item": "fx-1", "text": "x"}, {"Content-Type": "application/json", "Origin": o})
        self.assertEqual(c, 403)

    def test_comment_reaches_card_and_inbox(self):
        c, _ = self.s.action({"kind": "comment", "item": "fx-5", "text": "api test comment"})
        self.assertEqual(c, 200)
        it = self.s.json("/api/item?id=fx-5")
        it = it.get("item", it)
        self.assertTrue(any(e.get("text") == "api test comment" for e in it["thread"]))
        self.assertTrue(any(e.get("item") == "fx-5" and e.get("kind") == "comment" for e in self.s.inbox()))

    def test_stateutil_write_shows_up_with_a_higher_rev(self):
        rev = self.s.json("/api/state")["meta"]["rev"]
        self.s.su("say-mgr", "api test line")
        t0 = time.time()
        while time.time() - t0 < 5:
            st = self.s.json("/api/state")
            if st["meta"]["rev"] > rev:
                break
            time.sleep(0.2)
        self.assertGreater(st["meta"]["rev"], rev)
        self.assertTrue(any(m.get("text") == "api test line" for m in st["chat"]))


if __name__ == "__main__":
    unittest.main()
