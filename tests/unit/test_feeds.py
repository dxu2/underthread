"""Feed collector (t-feed-inbox) against a fake IMAP server (tests/unit/_fake_imap.py). No real mailbox, no real credentials,
no keychain: the password goes to a throwaway file (UNDERTHREAD_FEED_CRED_FILE) and the keychain helper is switched off."""
import json
import os
import tempfile
import unittest

from tests.unit._core import Core
from tests.unit._fake_imap import FakeImap

PW = "abcd efgh ijkl mnop"   # a made-up app password, the shape Google shows
USER = "me@example.com"


class Feeds(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="rt-feed-")
        self.env = {k: os.environ.get(k) for k in ("UNDERTHREAD_FEED_CRED_FILE", "UNDERTHREAD_FEED_KEYCHAIN", "UNDERTHREAD_FEED_IMAP")}
        self.srv = FakeImap(user=USER, password=PW).start()
        os.environ["UNDERTHREAD_FEED_CRED_FILE"] = os.path.join(self.tmp, "cred.json")
        os.environ["UNDERTHREAD_FEED_KEYCHAIN"] = "0"
        os.environ["UNDERTHREAD_FEED_IMAP"] = f"127.0.0.1:{self.srv.port}:plain"
        self.core = Core().__enter__()
        with open(os.path.join(self.core.dir, "config.json"), "w") as f:
            json.dump({"feeds": {"classifier": "off"}}, f)
        import importlib
        self.FC = importlib.import_module("core.feeds.collector")
        self.CL = importlib.import_module("core.feeds.classify")
        self.S = self.core.stateutil
        self.assertTrue(self.FC.use_method("file", confirm=True)["ok"])

    def tearDown(self):
        self.core.__exit__(None, None, None)
        self.srv.stop()
        for k, v in self.env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def feeds(self):
        return [e for e in self.S.inbox_all() if e.get("kind") == "feed"]

    def connect(self):
        r = self.FC.connect("gmail", USER, PW)
        self.assertTrue(r["ok"], r)
        return r

    def test_first_connect_does_not_replay_old_mail(self):
        for i in range(3):
            self.srv.add(subject=f"old {i}")
        self.connect()
        r = self.FC.poll("gmail")
        self.assertEqual(r["new"], 0)
        self.assertEqual(self.feeds(), [])   # nothing new = nothing written

    def test_new_mail_is_one_event_with_headers_only(self):
        self.srv.add(subject="old")
        self.connect()
        self.srv.add(subject="Invoice 42", sender="Bob <bob@example.com>", body="SECRET-BODY-LINE " * 40)
        self.srv.add(subject="Lunch?", body="hi")
        r = self.FC.poll("gmail")
        self.assertEqual(r["new"], 2)
        ev = self.feeds()
        self.assertEqual(len(ev), 1)
        e = ev[0]
        self.assertTrue(e["untrusted"])
        self.assertEqual(e["n"], 2)
        self.assertEqual([m["subject"] for m in e["mail"]], ["Invoice 42", "Lunch?"])
        self.assertLessEqual(len(e["mail"][0]["snippet"]), 120)
        self.assertNotIn("body", e["mail"][0])
        self.assertIn("rfc822msgid", e["mail"][0]["link"])
        self.assertEqual(e["counts"]["unsorted"], 2)
        # second poll: nothing new, nothing written
        self.assertEqual(self.FC.poll("gmail")["new"], 0)
        self.assertEqual(len(self.feeds()), 1)

    def test_read_only_and_primary_search(self):
        self.connect()
        self.srv.add()
        self.FC.poll("gmail")
        self.assertEqual(self.srv.bad, [])   # no STORE / SELECT / fetch without PEEK
        self.assertIn("EXAMINE", self.srv.log)
        self.assertTrue(any("category:primary" in s for s in self.srv.searches))

    def test_same_thread_is_one_row_and_again_later(self):
        self.connect()
        self.srv.add(subject="Plan", thread=55)
        self.srv.add(subject="Re: Plan", thread=55)
        self.FC.poll("gmail")
        e = self.feeds()[-1]
        self.assertEqual(len(e["mail"]), 1)
        self.assertEqual(e["mail"][0]["n"], 2)
        self.assertFalse(e["mail"][0]["again"])
        self.S.cmd_inbox_ack(type("A", (), {"ids": ["all"]})())
        self.srv.add(subject="Re: Re: Plan", thread=55)
        self.FC.poll("gmail")
        self.assertTrue(self.feeds()[-1]["mail"][0]["again"])

    def test_unacked_backlog_merges_into_one_event(self):
        self.connect()
        self.srv.add(subject="one")
        self.FC.poll("gmail")
        first = self.feeds()[-1]["id"]
        self.srv.add(subject="two")
        self.FC.poll("gmail")
        acked = set(self.S.read()["meta"]["inbox_acked"])
        pending = [e for e in self.feeds() if e["id"] not in acked]
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0]["n"], 2)
        self.assertEqual(pending[0]["merged"], [first])
        self.assertEqual([m["subject"] for m in pending[0]["mail"]], ["one", "two"])

    def test_uidvalidity_change_restarts_from_now(self):
        self.connect()
        self.srv.uidvalidity = 99
        self.srv.add(subject="after rebuild")
        self.assertEqual(self.FC.poll("gmail")["new"], 0)
        self.srv.add(subject="really new")
        self.assertEqual(self.FC.poll("gmail")["new"], 1)

    def test_wrong_password_is_refused_and_not_stored(self):
        r = self.FC.connect("gmail", USER, "wrong-password-xx")
        self.assertFalse(r["ok"])
        self.assertEqual(r["code"], "auth")
        self.assertFalse(os.path.exists(os.environ["UNDERTHREAD_FEED_CRED_FILE"]))
        self.assertFalse(self.FC.status()["sources"][0]["connected"])

    def test_password_never_in_status_files_or_inbox(self):
        self.connect()
        self.srv.add(subject="x")
        self.FC.poll("gmail")
        pw = PW.replace(" ", "")
        blob = json.dumps(self.FC.status())
        for p in (self.FC.FILE, os.path.join(self.core.dir, "inbox.jsonl"), os.path.join(self.core.dir, "state.json")):
            if not os.path.exists(p):
                continue
            with open(p, encoding="utf-8") as f:
                blob += f.read()
        self.assertNotIn(pw, blob)
        self.assertNotIn(PW, blob)
        self.assertEqual(oct(os.stat(os.environ["UNDERTHREAD_FEED_CRED_FILE"]).st_mode & 0o777), "0o600")

    def test_disconnect_removes_password_and_stops(self):
        self.connect()
        self.assertTrue(self.FC.disconnect("gmail")["ok"])
        self.assertFalse(os.path.exists(os.environ["UNDERTHREAD_FEED_CRED_FILE"]))
        self.assertFalse(self.FC.poll("gmail")["ok"])
        self.assertEqual(self.FC.tick(), [])

    def test_auth_failure_while_polling_pauses_the_source(self):
        self.connect()
        self.srv.password = "changed"
        r = self.FC.poll("gmail")
        self.assertEqual(r["code"], "auth")
        s = self.FC.status()["sources"][0]
        self.assertFalse(s["enabled"])
        self.assertTrue(s["paused"])
        self.assertEqual(self.FC.tick(), [])   # paused: no more login attempts

    def test_tick_respects_interval_and_switch(self):
        self.connect()
        self.assertEqual(self.FC.tick(), [])   # just connected: not due yet
        d = self.FC._load()
        d["sources"]["gmail"]["last_fetch"] = "2020-01-01T00:00:00+00:00"
        self.FC._save(d)
        self.assertEqual(self.FC.tick(), ["gmail"])
        self.FC.configure("gmail", enabled=False)
        d = self.FC._load()
        d["sources"]["gmail"]["last_fetch"] = "2020-01-01T00:00:00+00:00"
        self.FC._save(d)
        self.assertEqual(self.FC.tick(), [])

    def test_classifier_verdicts_and_fallback(self):
        with open(os.path.join(self.core.dir, "config.json"), "w") as f:
            json.dump({"feeds": {"classifier": "fake"}}, f)
        seen = {}

        def fake(msgs, cfg):
            seen["bodies"] = [m["body"] for m in msgs]
            return {1: {"cat": "needs_user", "why": "要你回"}, 2: {"cat": "bogus", "why": "x"}}
        self.CL.CLASSIFIERS["fake"] = fake
        self.connect()
        self.srv.add(subject="Contract", body="please sign by Friday")
        self.srv.add(subject="Newsletter", body="weekly news")
        self.FC.poll("gmail")
        e = self.feeds()[-1]
        self.assertEqual(e["classifier"], "fake")
        self.assertEqual(seen["bodies"][0], "please sign by Friday")   # the body goes to the classifier ...
        self.assertNotIn("please sign by Friday", json.dumps(e))   # ... and not to the inbox: a sorted row has "why", no snippet
        self.assertEqual(e["mail"][1]["snippet"], "weekly news")   # an unsorted row keeps its snippet
        self.assertEqual([m["cat"] for m in e["mail"]], ["needs_user", None])
        self.assertEqual(e["counts"]["needs_user"], 1)
        self.CL.CLASSIFIERS["fake"] = lambda msgs, cfg: (_ for _ in ()).throw(RuntimeError("boom"))
        self.srv.add(subject="Third")
        self.S.cmd_inbox_ack(type("A", (), {"ids": ["all"]})())
        self.FC.poll("gmail")
        self.assertEqual(self.feeds()[-1]["classifier"], "failed")

    def test_parse_rejects_junk(self):
        P = self.CL.parse
        self.assertIsNone(P("no json here", 2))
        self.assertIsNone(P('{"1": {"cat": "delete_all"}}', 1))
        self.assertEqual(P('sure! {"1": {"cat": "fyi", "why": "a\\u202eb\\nc"}}', 1), {1: {"cat": "fyi", "why": "ab c"}})
        self.assertIsNone(P('{"9": {"cat": "fyi"}}', 1))

    def test_clean_strips_control_and_direction_chars(self):
        from core.feeds.base import clean
        self.assertEqual(clean("a‮​b\r\n\tc", 50), "ab c")
        self.assertEqual(len(clean("x" * 500, 120)), 120)

    def test_slack_is_listed_but_cannot_connect(self):
        s = [x for x in self.FC.status()["sources"] if x["id"] == "slack"][0]
        self.assertFalse(s["available"])
        self.assertFalse(self.FC.connect("slack", "a.slack.com", "xoxp-1")["ok"])

    def test_file_method_needs_confirm(self):
        self.assertFalse(self.FC.use_method("file")["ok"])


if __name__ == "__main__":
    unittest.main()
