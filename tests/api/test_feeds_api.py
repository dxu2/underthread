"""/api/feeds (t-feed-inbox) on a fixture server with a fake IMAP server: the page's connect flow end to end, and that the
password never comes back in an answer. No real mailbox, no keychain (UNDERTHREAD_FEED_KEYCHAIN=0, a throwaway file)."""
import json
import os
import tempfile
import unittest

from tests.api._server import FixtureServer
from tests.unit._fake_imap import FakeImap

PW = "wxyz wxyz wxyz wxyz"


class FeedsApi(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.imap = FakeImap(user="me@example.com", password=PW).start()
        cls.tmp = tempfile.mkdtemp(prefix="rt-feedapi-")
        cls.cred = os.path.join(cls.tmp, "cred.json")
        cls.s = FixtureServer(env={"UNDERTHREAD_FEED_IMAP": f"127.0.0.1:{cls.imap.port}:plain", "UNDERTHREAD_FEED_KEYCHAIN": "0",
                                   "UNDERTHREAD_FEED_CRED_FILE": cls.cred})
        with open(os.path.join(cls.s.root, "config.json")) as f:
            c = json.load(f)
        c["feeds"] = {"classifier": "off"}
        with open(os.path.join(cls.s.root, "config.json"), "w") as f:
            json.dump(c, f)

    @classmethod
    def tearDownClass(cls):
        cls.s.stop()
        cls.imap.stop()

    def post(self, body, hdr=True):
        h = {"Content-Type": "application/json", "Origin": f"http://127.0.0.1:{self.s.port}"}
        if hdr:
            h["X-Underthread"] = "1"
        c, b = self.s.req("/api/feeds", "POST", body, h)
        return c, json.loads(b or b"{}")

    def test_flow(self):
        st = self.s.json("/api/feeds")
        self.assertEqual([x["id"] for x in st["sources"]], ["gmail", "slack"])
        self.assertFalse(st["sources"][0]["connected"])
        self.assertEqual(self.post({"op": "connect", "source": "gmail", "account": "me@example.com", "secret": PW}, hdr=False)[0], 403)
        c, r = self.post({"op": "connect", "source": "gmail", "account": "me@example.com", "secret": "nope-nope"})
        self.assertEqual((c, r["code"]), (400, "auth"))
        self.assertNotIn("nope-nope", json.dumps(r))
        self.assertTrue(self.post({"op": "use_file", "confirm": True})[1]["ok"])
        c, r = self.post({"op": "connect", "source": "gmail", "account": "me@example.com", "secret": PW, "interval": 15})
        self.assertEqual(c, 200, r)
        g = r["status"]["sources"][0]
        self.assertTrue(g["connected"] and g["enabled"])
        self.assertEqual(g["interval_min"], 15)
        self.imap.add(subject="Hello from the fake server")
        c, r = self.post({"op": "poll", "source": "gmail"})
        self.assertEqual((c, r["new"]), (200, 1))
        feed = [e for e in self.s.inbox() if e.get("kind") == "feed"]
        self.assertEqual(feed[-1]["mail"][0]["subject"], "Hello from the fake server")
        self.assertEqual(self.s.json("/api/health")["feeds"]["connected"], 1)
        with open(os.path.join(self.s.root, "feeds.json"), encoding="utf-8") as f:
            blob = json.dumps(self.s.json("/api/feeds")) + f.read()
        self.assertNotIn(PW.replace(" ", ""), blob)
        self.assertNotIn("cursor", json.dumps(self.s.json("/api/feeds")))
        self.assertFalse(self.post({"op": "set", "source": "gmail", "enabled": False})[1]["status"]["sources"][0]["enabled"])
        self.assertTrue(self.post({"op": "disconnect", "source": "gmail"})[1]["ok"])
        self.assertFalse(os.path.exists(self.cred))
        self.assertFalse(self.s.json("/api/feeds")["sources"][0]["connected"])


if __name__ == "__main__":
    unittest.main()
