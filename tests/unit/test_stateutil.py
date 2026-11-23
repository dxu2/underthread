"""stateutil.py: the pure helpers every writer goes through. Runs on a throwaway copy (see _core.py)."""
import datetime as dt
import json
import os
import unittest

from tests.unit._core import Core


class StateShape(unittest.TestCase):
    def test_blank_state_has_every_top_level_key(self):
        with Core() as c:
            st = c.stateutil.blank_state()
        for k in ("meta", "items", "agents", "chat", "dms", "mail", "schedules", "handoffs"):
            self.assertIn(k, st)

    def test_shape_fills_missing_keys_without_touching_existing(self):
        with Core() as c:
            st = c.stateutil._shape({"meta": {"rev": 7}, "items": [{"id": "x"}]})
        self.assertEqual(st["meta"]["rev"], 7)
        self.assertEqual(st["items"], [{"id": "x"}])
        self.assertEqual(st["dms"], {})
        self.assertIn("stamina", st["meta"])

    def test_fresh_times_moves_newest_stamp_to_a_few_minutes_ago(self):
        with Core() as c:
            st = c.stateutil._fresh_times({"a": "2020-01-01T10:00:00+00:00", "b": ["2020-01-01T09:00:00+00:00"], "c": "not a time"})
        a, b = (dt.datetime.fromisoformat(x) for x in (st["a"], st["b"][0]))
        self.assertEqual(a - b, dt.timedelta(hours=1))
        age = dt.datetime.now().astimezone() - a
        self.assertTrue(dt.timedelta(minutes=4) < age < dt.timedelta(minutes=6), age)
        self.assertEqual(st["c"], "not a time")


class Asks(unittest.TestCase):
    def test_parse_ask(self):
        with Core() as c:
            self.assertEqual(c.stateutil.parse_ask("Which one? :: A | B* | C"), ("Which one?", ["A", "B*", "C"]))

    def test_split_rec_first_star_wins(self):
        with Core() as c:
            self.assertEqual(c.stateutil.split_rec(["A", "B*", "C*"]), (["A", "B", "C"], "B"))
            self.assertEqual(c.stateutil.split_rec(["A", "B"]), (["A", "B"], None))


class ApprovedPlanBack(unittest.TestCase):   # r-improve-1118 P1
    def _card(self, S, cid, approve_text):
        with S.mutate() as st:
            it = S.upsert_item(st, {"id": cid, "title": "T", "kind": "plan", "stage": "review", "owner": "smith"})
            S.add_thread(it, "me", approve_text, "approve")
            it["stage"] = "doing"

    def test_approved_plan_handed_back_without_kind_becomes_deliverable(self):
        with Core() as c:
            S = c.stateutil
            self._card(S, "p-1", "批准开工")
            with S.mutate() as st:
                it = S.upsert_item(st, {"id": "p-1", "stage": "review"}, who="smith")
            self.assertEqual(it["kind"], "deliverable")

    def test_explicit_kind_plan_and_unapproved_plans_stay_plans(self):
        with Core() as c:
            S = c.stateutil
            self._card(S, "p-2", "批准开工")
            with S.mutate() as st:
                self.assertEqual(S.upsert_item(st, {"id": "p-2", "stage": "review", "kind": "plan"}, who="smith")["kind"], "plan")
            self._card(S, "p-3", "验收 · 关单")
            with S.mutate() as st:
                self.assertEqual(S.upsert_item(st, {"id": "p-3", "stage": "review"}, who="smith")["kind"], "plan")


class Writes(unittest.TestCase):
    def test_upsert_creates_then_updates_one_card_and_bumps_rev(self):
        with Core() as c:
            S = c.stateutil
            with S.mutate() as st:
                it = S.upsert_item(st, {"id": "u-1", "title": "T", "stage": "todo", "owner": "scout"})
            with S.mutate() as st:
                S.upsert_item(st, {"id": "u-1", "stage": "review"}, who="scout")
            with open(os.path.join(c.dir, "state.json"), encoding="utf-8") as f:
                st = json.load(f)
        cards = [i for i in st["items"] if i["id"] == "u-1"]
        self.assertEqual(len(cards), 1)
        self.assertEqual(cards[0]["stage"], "review")
        self.assertGreaterEqual(st["meta"]["rev"], 2)
        self.assertEqual(it["id"], "u-1")


if __name__ == "__main__":
    unittest.main()
