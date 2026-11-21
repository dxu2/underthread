"""t-ask-autoclose rounds (r-improve-1120 P1 + r-improve-1121 P1): a delivery withdraws the asks left over from an earlier round and
keeps the ones asked for this delivery, whatever order `ask` and `upsert --stage review` run in. Runs stateutil on a throwaway copy."""
import json
import os
import subprocess
import sys
import time
import unittest

from tests.unit._core import Core


class AskRounds(unittest.TestCase):
    def setUp(self):
        self.core = Core().__enter__()
        self.n = 0

    def tearDown(self):
        self.core.__exit__(None, None, None)

    def su(self, *args):
        r = subprocess.run([sys.executable, "stateutil.py", *args], cwd=self.core.dir, capture_output=True, text=True, stdin=subprocess.DEVNULL)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout.strip()

    def card(self, cid="t-x", stage="doing"):
        self.su("upsert-item", "--id", cid, "--title", "x", "--stage", stage, "--kind", "plan", "--who", "smith")

    def deliver(self, cid="t-x", *extra):
        self.n += 1
        self.su("upsert-item", "--id", cid, "--who", "smith", "--stage", "review", "--draft", f"v{self.n}", "--label", f"v{self.n}", *extra)

    def ask(self, cid="t-x", q="Which?"):
        return self.su("ask", cid, "smith", q, "--options", "A*|B").splitlines()[-1]

    def asks(self, cid="t-x"):
        with open(os.path.join(self.core.dir, "state.json"), encoding="utf-8") as f:
            it = next(i for i in json.load(f)["items"] if i["id"] == cid)
        return {a["id"]: a for a in it.get("asks") or []}, it

    def is_open(self, a):
        return not a.get("closed") and not a.get("answer")

    def test_ask_then_deliver_keeps_the_ask(self):
        """1121: `stateutil ask` first, `upsert --stage review` second (two mutates): the ask is this delivery's question."""
        self.card()
        aid = self.ask()
        self.deliver()
        a, it = self.asks()
        self.assertTrue(self.is_open(a[aid]), a[aid])
        self.assertFalse(any("过期提问" in e["text"] for e in it["thread"]))

    def test_ask_in_the_same_mutate_stays(self):
        self.card()
        self.deliver("t-x", "--ask", "Go? :: yes* | no")
        a, _ = self.asks()
        self.assertEqual(len(a), 1)
        self.assertTrue(all(self.is_open(x) for x in a.values()))

    def test_previous_versions_ask_goes_when_a_new_version_comes_in(self):
        """1120: plan delivered + asked, then a deliverable lands while the card stays in review: the plan's ask is withdrawn."""
        self.card()
        self.deliver()
        old = self.ask(q="开工吗？")
        time.sleep(1.1)
        self.deliver()
        a, it = self.asks()
        self.assertTrue(a[old].get("closed"), a[old])
        self.assertEqual(a[old].get("auto"), "review")
        self.assertTrue(any("已撤 1 个过期提问" in e["text"] for e in it["thread"]))

    def test_back_to_work_then_new_ask_and_delivery(self):
        """A round starts when the card leaves review: the ask from the earlier round goes, the one asked during the work stays."""
        self.card()
        self.deliver()
        old = self.ask(q="old")
        time.sleep(1.1)   # the user comments later; an ask in the very second the card goes back to work counts as the new round
        self.su("upsert-item", "--id", "t-x", "--who", "smith", "--stage", "doing")
        _, it = self.asks()
        self.assertTrue(it.get("left_review"))
        time.sleep(1.1)
        new = self.ask(q="new")
        self.deliver()
        a, _ = self.asks()
        self.assertTrue(a[old].get("closed"), a[old])
        self.assertTrue(self.is_open(a[new]), a[new])

    def test_put_back_without_a_new_version_closes_nothing(self):
        self.card()
        self.deliver()
        aid = self.ask()
        self.su("upsert-item", "--id", "t-x", "--who", "smith", "--stage", "review", "--label", "same")
        a, _ = self.asks()
        self.assertTrue(self.is_open(a[aid]), a[aid])

    def test_done_withdraws_every_open_ask(self):
        self.card()
        self.deliver()
        aid = self.ask()
        self.su("upsert-item", "--id", "t-x", "--who", "smith", "--stage", "done")
        a, _ = self.asks()
        self.assertEqual(a[aid].get("auto"), "done")

    def test_answered_asks_are_never_touched(self):
        self.card()
        self.deliver()
        aid = self.ask()
        p = os.path.join(self.core.dir, "state.json")
        with open(p, encoding="utf-8") as f:
            st = json.load(f)
        it = next(i for i in st["items"] if i["id"] == "t-x")
        next(a for a in it["asks"] if a["id"] == aid)["answer"] = {"opt": "A", "by": "me", "t": it["draft_at"]}
        with open(p, "w", encoding="utf-8") as f:
            json.dump(st, f)
        time.sleep(1.1)
        self.deliver()
        a, _ = self.asks()
        self.assertFalse(a[aid].get("closed"), a[aid])

if __name__ == "__main__":
    unittest.main()
