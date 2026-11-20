"""t-onb-polish: the steward's sessions count as Steward from what they do (the heartbeat tool calls), not from the session title."""
import json
import os
import tempfile
import unittest

from core import usage_roll as U

TS = "2026-11-19T10:00:00Z"


def bash(cmd, mid):
    return {"type": "assistant", "timestamp": TS, "message": {"id": mid, "usage": {"input_tokens": 10, "output_tokens": 5},
            "content": [{"type": "tool_use", "name": "Bash", "input": {"command": cmd}}]}}


def text(t, mid):
    return {"type": "assistant", "timestamp": TS, "message": {"id": mid, "usage": {"input_tokens": 7, "output_tokens": 1},
            "content": [{"type": "text", "text": t}]}}


def user(t):
    return {"type": "user", "timestamp": TS, "message": {"role": "user", "content": t}}


class StewardLine(unittest.TestCase):
    def test_heartbeat_calls(self):
        self.assertTrue(U.steward_line(bash('python3 stateutil.py set-agent manager --status working', "a")))
        self.assertTrue(U.steward_line(bash('cd "/x y" && python3 stateutil.py inbox-ack 12', "a")))
        self.assertFalse(U.steward_line(bash('python3 stateutil.py set-agent scout --status idle', "a")))
        self.assertFalse(U.steward_line(bash('python3 stateutil.py set-agent managerial', "a")))

    def test_start_prompt(self):
        self.assertTrue(U.steward_line(user("Start the manager per manager.md")))
        self.assertTrue(U.steward_line({"type": "user", "message": {"content": [{"type": "text", "text": "Start the manager per manager.md, please"}]}}))
        self.assertFalse(U.steward_line(user("what does 'Start the manager per manager.md' mean?")))

    def test_quoted_text_does_not_count(self):
        self.assertFalse(U.steward_line(text("manager.md says: run python3 stateutil.py set-agent manager --status working", "a")))


class Roles(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = os.path.join(self.tmp.name, "root")
        self.proj = os.path.join(self.tmp.name, "proj")
        os.makedirs(self.proj)
        os.makedirs(os.path.join(self.root, "work"))
        self.env = os.environ.get("USAGE_PROJ")
        os.environ["USAGE_PROJ"] = self.proj

    def tearDown(self):
        if self.env is None:
            os.environ.pop("USAGE_PROJ", None)
        else:
            os.environ["USAGE_PROJ"] = self.env
        self.tmp.cleanup()

    def write(self, sid, lines, mode="w"):
        with open(os.path.join(self.proj, sid + ".jsonl"), mode) as f:
            for d in lines:
                f.write(json.dumps(d) + "\n")

    def roles(self, r):
        return {x["id"]: x["new"] for x in r.report(day="2026-11-19")["roles"]}

    def test_live_scan_marks_steward_and_keeps_quotes_other(self):
        self.write("s1", [user("Start the manager per manager.md"), bash("python3 stateutil.py set-agent manager --status working", "m1")])
        self.write("s2", [text("python3 stateutil.py set-agent manager", "m2")])   # a voice chat that quotes manager.md
        r = U.Roll(self.root)
        got = self.roles(r)
        self.assertEqual(got.get("manager"), 15)
        self.assertEqual(got.get("other"), 8)
        self.assertEqual(r.ledger.get("_marker_v"), U.MARKER_V)

    def test_backfill_moves_old_usage_once(self):
        # an older install already counted s1 (offset at its end) without knowing it was the steward
        self.write("s1", [bash("python3 stateutil.py inbox-ack 3", "m1")])
        r = U.Roll(self.root)
        r.ledger = {}
        r.data = {"files": {"s1": {"off": os.path.getsize(os.path.join(self.proj, "s1.jsonl")), "ids": ["m1"]}},
                  "days": {"2026-11-19": {"s1": [10, 0, 0, 5, 1]}}}
        r.t = 0
        self.assertEqual(self.roles(r).get("manager"), 15)
        with open(r.ledger_path) as f:
            self.assertEqual(json.load(f), {"s1": "manager", "_marker_v": U.MARKER_V})

    def test_voice_session_keeps_its_role(self):
        os.makedirs(os.path.join(self.root, "work", "voice"))
        with open(os.path.join(self.root, "work", "voice", "sessions.json"), "w") as f:
            json.dump({"scout": {"sid": "s3"}}, f)
        self.write("s3", [bash("python3 stateutil.py inbox-ack 1", "m3")])
        self.assertEqual(self.roles(U.Roll(self.root)), {"scout": 15})


if __name__ == "__main__":
    unittest.main()
