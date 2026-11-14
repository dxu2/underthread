"""Upgrade tests: from the previous release tag to this commit, with a populated install (plan step S5, tools/update.py).

Placeholder until S5 lands: the test is skipped, and run.py / CI already call this folder so the job exists.
What S5 adds here: check out the last tag into a temp dir, load tests/e2e/fixtures, run its server once, then update to
HEAD with tools/update.py and assert the data migrated, the server is healthy and the user's local/ is untouched."""
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class Upgrade(unittest.TestCase):
    @unittest.skipUnless(os.path.exists(os.path.join(ROOT, "tools", "update.py")), "tools/update.py comes in plan step S5")
    def test_upgrade_from_last_tag(self):
        self.fail("write me in S5")


if __name__ == "__main__":
    unittest.main()
