"""t-onboarding P0: migration 0003 (existing boards never see the checklist) and the retire rule of the 开工清单."""
import datetime as dt
import importlib
import unittest

M = importlib.import_module("core.migrations.0003_onboarding")
NOW = "2026-11-19T10:00:00-08:00"


class Migration(unittest.TestCase):
    def run_up(self, data):
        return M.up(data, {"now": NOW})

    def test_fresh_seed_gets_an_empty_record(self):
        d = self.run_up({"meta": {}, "items": [{"id": "q-demo-plan"}], "chat": [], "agents": {"manager": {}}})
        self.assertEqual(d["meta"]["onboarding"], {})

    def test_used_board_is_done_and_retired(self):
        for d in ({"meta": {}, "items": [{"id": "t-1"}]}, {"meta": {}, "chat": [{"who": "me"}]},
                  {"meta": {}, "agents": {"manager": {"last_seen": NOW}}}):
            ob = self.run_up(d)["meta"]["onboarding"]
            self.assertEqual((ob["done_at"], ob["retired_at"], ob["by"]), (NOW, NOW, "upgrade"))

    def test_idempotent_and_marks_widget_seen(self):
        d = {"meta": {"onboarding": {"keep": True}, "widgets": {"layout": None, "seen": ["busy"]}}}
        d = self.run_up(self.run_up(d))
        self.assertEqual(d["meta"]["onboarding"], {"keep": True})
        self.assertEqual(d["meta"]["widgets"]["seen"], ["busy", "setup"])


class Retire(unittest.TestCase):
    def setUp(self):
        self.SU = importlib.import_module("api.routes.setup")

    def test_rule(self):
        r, today = self.SU.retired, dt.date(2026, 11, 19)
        self.assertFalse(r({}, today))
        self.assertFalse(r({"done_at": "2026-11-19T09:00:00-08:00"}, today))       # done today: still shows (the done line)
        self.assertTrue(r({"done_at": "2026-11-18T09:00:00-08:00"}, today))        # the next day it retires
        self.assertFalse(r({"done_at": "2026-11-18T09:00:00-08:00", "keep": True}, today))   # brought back from 编辑小组件
        self.assertTrue(r({"retired_at": NOW}, today))


if __name__ == "__main__":
    unittest.main()


class Polish(unittest.TestCase):
    """t-onb-polish: six numbered steps for six counted ones; 清掉示例 archives only the q-demo-* samples."""
    def setUp(self):
        self.SU = importlib.import_module("api.routes.setup")

    def test_steps_match_the_count(self):
        v = self.SU.view({"meta": {}, "items": [], "chat": [], "agents": {}}, archived=[])
        self.assertEqual(len(v["steps"]), v["of"])
        self.assertFalse(any(s["optional"] for s in v["steps"]))

    def test_clear_samples(self):
        from api.router import ACTIONS

        class A:
            pass
        a = A()
        a.body = {"op": "clear_samples"}
        a.st = {"meta": {}, "log": [], "items": [{"id": "q-demo-plan"}, {"id": "q-demo-ask", "archived": True}, {"id": "t-real"}]}
        ACTIONS["onboarding"](a)
        self.assertEqual([bool(i.get("archived")) for i in a.st["items"]], [True, True, False])
