"""t-oss-location: owner.location in config.json (core.config clean_location / set_location / owner_location)."""
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from core import config as C  # noqa: E402


class OwnerLocation(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        with open(os.path.join(self.d, "config.json"), "w") as f:
            json.dump({"owner": {"display_name": "Ada"}, "_schema": 3}, f)

    def tearDown(self):
        shutil.rmtree(self.d)

    def cfg(self):
        with open(os.path.join(self.d, "config.json")) as f:
            return json.load(f)

    def test_absent_means_never_asked(self):
        self.assertIsNone(C.owner_location(self.d))

    def test_rounds_to_two_decimals_and_keeps_other_keys(self):
        C.set_location(self.d, C.clean_location(37.774929, -122.419416, "America/Los_Angeles"))
        c = self.cfg()
        loc = c["owner"]["location"]
        self.assertEqual((loc["lat"], loc["lon"], loc["tz"]), (37.77, -122.42, "America/Los_Angeles"))
        self.assertIn("at", loc)
        self.assertEqual(c["owner"]["display_name"], "Ada")
        self.assertEqual(c["_schema"], 3)

    def test_declined_then_cleared(self):
        C.set_location(self.d, {"declined": True})
        self.assertTrue(C.owner_location(self.d)["declined"])
        C.set_location(self.d, None)
        self.assertNotIn("location", self.cfg()["owner"])
        self.assertIsNone(C.owner_location(self.d))

    def test_rejects_bad_input(self):
        for args in [(91, 0), (0, 181), ("x", 0), (None, 0), (float("nan"), 0), (1, 1, "not a tz!"), (1, 1, "a" * 80)]:
            with self.assertRaises(ValueError, msg=repr(args)):
                C.clean_location(*args)
        self.assertNotIn("tz", C.clean_location(1, 2, ""))


if __name__ == "__main__":
    unittest.main()
