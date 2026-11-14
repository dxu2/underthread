"""schedules.py: rule parsing and the next-run maths."""
import datetime as dt
import unittest

from tests.unit._core import Core

UTC = dt.timezone.utc


class Rules(unittest.TestCase):
    def test_parse_daily_and_weekly(self):
        with Core() as c:
            S = c.schedules
            self.assertEqual(S.parse_rule("daily 09:00", "UTC"), {"type": "daily", "at": "09:00"})
            self.assertEqual(S.parse_rule("weekly mon,thu 09:00", "UTC"), {"type": "weekly", "at": "09:00", "days": [1, 4]})

    def test_bad_rule_raises_rule_error(self):
        with Core() as c:
            with self.assertRaises(c.schedules.RuleError):
                c.schedules.parse_rule("bogus", "UTC")

    def test_next_after_is_strictly_after(self):
        with Core() as c:
            S = c.schedules
            r = S.parse_rule("daily 09:00", "UTC")
            self.assertEqual(S.next_after(r, "UTC", dt.datetime(2026, 1, 15, 9, 0, tzinfo=UTC)), dt.datetime(2026, 1, 16, 9, 0, tzinfo=UTC))
            self.assertEqual(S.next_after(r, "UTC", dt.datetime(2026, 1, 15, 8, 59, tzinfo=UTC)), dt.datetime(2026, 1, 15, 9, 0, tzinfo=UTC))

    def test_upcoming_weekly(self):
        with Core() as c:
            S = c.schedules
            r = S.parse_rule("weekly mon 10:00", "UTC")
            runs = S.upcoming(r, "UTC", dt.datetime(2026, 1, 15, tzinfo=UTC), 3)   # a Thursday
        self.assertEqual([t.date().isoformat() for t in runs], ["2026-01-19", "2026-01-26", "2026-02-02"])


if __name__ == "__main__":
    unittest.main()
