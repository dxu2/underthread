"""t-oss-polish-1121: estimates in agent time reach every role (make_agents hard rules + plan template); the one-time 批准开工 bubble rule."""
import importlib
import unittest

import make_agents as MA

ME = "me"


class Estimates(unittest.TestCase):
    def test_both_hard_rule_sets_and_the_plan_step(self):
        for general in (False, True):
            r = {"id": "scout", "agent_name": "underthread-scout", "name": "Scout", "title": "Researcher", "duty": "x", "specialties": ["x"], **({"team": "general"} if general else {})}
            txt = MA.agent_file(r)
            self.assertIn("Estimates in agent time", txt)
            self.assertIn("Effort: ~N agent min + M review rounds", txt)

    def test_manager_docs_say_it(self):
        for p in ("manager.md", "roles/manager.md", "presets/content-zh/roles/manager.md", "presets/classic/policy.md", "presets/content-zh/policy.md"):
            with open(p, encoding="utf-8") as f:
                t = f.read()
            self.assertTrue("agent min" in t or "agent 时间" in t, p)


class PlanTip(unittest.TestCase):
    def setUp(self):
        self.SU = importlib.import_module("api.routes.setup")

    def st(self, ob=None):
        return {"meta": {"onboarding": ob or {}}}

    def test_new_board_shows_it(self):
        self.assertTrue(self.SU.plan_tip(self.st(), [{"id": "q-demo-plan", "kind": "plan", "thread": []}]))

    def test_any_decision_hides_it(self):
        for it in ({"id": "t-1", "thread": [{"who": ME, "kind": "approve"}]}, {"id": "t-2", "thread": [{"who": ME, "kind": "reject"}]},
                   {"id": "t-3", "asks": [{"answer": {"by": ME}}]}):
            self.assertFalse(self.SU.plan_tip(self.st(), [it]), it["id"])

    def test_dismissed_stays_dismissed(self):
        self.assertFalse(self.SU.plan_tip(self.st({"plan_tip_at": "2026-11-21T19:00:00-08:00"}), []))


if __name__ == "__main__":
    unittest.main()
