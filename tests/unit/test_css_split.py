"""t-oss-struct S11: style.css and mobile.css live as section files in web/css/<stem>/NN-<section>.css (file-name order = cascade order).
Each section must start and end at the top level (no rule or comment split across two files) and the numbers must be unique."""
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def clean_end(src):
    """True when src ends at brace depth 0, outside a comment and a string."""
    d, com, q, j = 0, False, None, 0
    while j < len(src):
        c = src[j]
        if com:
            if src.startswith("*/", j):
                com = False
                j += 1
        elif q:
            if c == "\\":
                j += 1
            elif c == q or c == "\n":
                q = None
        elif src.startswith("/*", j):
            com = True
            j += 1
        elif c in "\"'":
            q = c
        elif c == "{":
            d += 1
        elif c == "}":
            d -= 1
            if d < 0:
                return False
        j += 1
    return d == 0 and not com and q is None


class CssSplit(unittest.TestCase):
    def test_sections(self):
        for stem in ("style", "mobile"):
            d = os.path.join(ROOT, "web", "css", stem)
            files = sorted(f for f in os.listdir(d) if f.endswith(".css"))
            self.assertTrue(files, stem)
            self.assertFalse(os.path.exists(os.path.join(ROOT, "web", f"{stem}.css")), f"web/{stem}.css came back next to web/css/{stem}/")
            nums = [f[:2] for f in files]
            for f in files:
                self.assertRegex(f, r"^\d\d-[a-z0-9-]+\.css$")
                with open(os.path.join(d, f), encoding="utf-8") as fh:
                    self.assertTrue(clean_end(fh.read()), f"css/{stem}/{f} does not end at the top level")
            self.assertEqual(len(nums), len(set(nums)), f"css/{stem}: two sections share a number")


if __name__ == "__main__":
    unittest.main()
