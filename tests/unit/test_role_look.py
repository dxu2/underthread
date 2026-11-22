"""t-roster-rail: a role's display name and avatar pick, set on the 团队 page (core/rolelook.py). Kept in roster.json on the role's own
entry; the original name, other roles and other keys are left alone."""
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from core import rolelook as RL  # noqa: E402

PNG = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000"
                    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082")


class RoleLook(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.roster = {"_note": "keep", "roles": [{"id": "scout", "name": "Scout", "name_en": "Scout", "model": "opus"},
                                                  {"id": "writer", "name": "Quill", "name_en": "Quill"}]}
        self.write()
        for rel in ("avatars/ut/scout.png", "avatars/scout.jpg", "avatars/choices/scout/b.png", "avatars/choices/scout/a.webp",
                    "avatars/choices/scout/notes.txt", "avatars/choices/scout/x.png.bak-1"):
            p = os.path.join(self.d, rel)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "wb") as f:
                f.write(PNG)

    def tearDown(self):
        shutil.rmtree(self.d)

    def write(self):
        with open(os.path.join(self.d, "roster.json"), "w", encoding="utf-8") as f:
            json.dump(self.roster, f, ensure_ascii=False, indent=2)
            f.write("\n")

    def read(self):
        with open(os.path.join(self.d, "roster.json"), encoding="utf-8") as f:
            return json.load(f)

    def role(self, rid):
        return next(r for r in self.read()["roles"] if r["id"] == rid)

    def test_choices_order_and_filter(self):
        self.assertEqual([c["src"] for c in RL.choices(self.d, "scout")],
                         ["ut/scout.png", "scout.jpg", "choices/scout/a.webp", "choices/scout/b.png"])
        self.assertEqual(RL.choices(self.d, "writer"), [])

    def test_rename_is_display_only_and_resets(self):
        RL.set_look(self.d, "scout", name="侦察", name_en="Ranger")
        r = self.role("scout")
        self.assertEqual((r["name"], r["display_name"], r["display_name_en"], r["model"]), ("Scout", "侦察", "Ranger", "opus"))
        self.assertEqual(self.role("writer"), {"id": "writer", "name": "Quill", "name_en": "Quill"})
        self.assertEqual(self.read()["_note"], "keep")
        a = {"id": "scout"}
        RL.apply(a, r, self.d)
        self.assertEqual((a["name"], a["name_orig"], a["name_en"], a["name_en_orig"]), ("侦察", "Scout", "Ranger", "Scout"))
        RL.set_look(self.d, "scout", name="", name_en="Scout")   # empty or the original = back to the original
        r = self.role("scout")
        self.assertNotIn("display_name", r)
        self.assertNotIn("display_name_en", r)
        RL.apply(a, r, self.d)
        self.assertEqual(a["name"], "Scout")
        self.assertNotIn("name_orig", a)

    def test_bad_input_refused(self):
        with self.assertRaises(ValueError):
            RL.set_look(self.d, "nope", name="x")
        with self.assertRaises(ValueError):
            RL.set_look(self.d, "scout", name="<b>")
        with self.assertRaises(ValueError):
            RL.set_look(self.d, "scout", name="x" * 25)
        for bad in ("../roster.json", "ut/writer.png", "choices/scout/notes.txt", "/etc/passwd"):
            with self.assertRaises(ValueError):
                RL.set_look(self.d, "scout", avatar=bad)
        self.assertNotIn("avatar_pick", self.role("scout"))

    def test_pick_and_default(self):
        RL.set_look(self.d, "scout", avatar="choices/scout/b.png")
        r = self.role("scout")
        self.assertEqual(r["avatar_pick"], "choices/scout/b.png")
        a = {"id": "scout"}
        RL.apply(a, r, self.d)
        self.assertEqual(a["avpick"]["src"], "choices/scout/b.png")
        self.assertIn(a["avpick"]["s"], (0, 1))   # 1 only where cwebp is installed
        os.remove(os.path.join(self.d, "avatars/choices/scout/b.png"))   # the file went away: default again, no broken image
        RL.apply(a, r, self.d)
        self.assertNotIn("avpick", a)
        RL.set_look(self.d, "scout", avatar="")
        self.assertNotIn("avatar_pick", self.role("scout"))


if __name__ == "__main__":
    unittest.main()
