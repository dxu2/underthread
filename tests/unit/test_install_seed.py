"""core/install_seed.py (t-oss-generic S1, S2): avatars/ut/ is install data. A roster role with no picture gets its default from
avatars/seed/ut/ (then presets/<name>/avatars/ut/), with the small copies, the work strip and an index.json entry; a file that
is there is never overwritten, a role that is not on the roster gets nothing, and a second run copies nothing."""
import hashlib
import json
import os
import sys
import tempfile
import unittest

from tests.unit._core import ROOT

sys.path.insert(0, ROOT)
from core import install_seed as A  # noqa: E402

SUF = ("160", "512", "work-160", "work-320", "work-512")


def put(p, data):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "wb") as f:
        f.write(data)


def jl(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def sha(p):
    with open(p, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


class Seed(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.r = os.path.realpath(self.tmp.name)
        for d, i in (("avatars/seed/ut", "manager"), ("avatars/seed/ut", "scout"), ("presets/classic/avatars/ut", "writer"),
                     ("presets/classic/avatars/ut", "scout"), ("avatars/seed/ut", "unused")):
            put(os.path.join(self.r, d, f"{i}.png"), f"{d}/{i}".encode())
            for s in SUF:
                put(os.path.join(self.r, d, "_s", f"{i}-{s}.webp"), f"{d}/{i}-{s}".encode())
        self.roster(["manager", "scout", "writer", "mine"])
        self.ut = os.path.join(self.r, "avatars", "ut")

    def tearDown(self):
        self.tmp.cleanup()

    def roster(self, ids):
        with open(os.path.join(self.r, "roster.json"), "w", encoding="utf-8") as f:
            json.dump({"roles": [{"id": i} for i in ids]}, f)

    def test_fresh_install(self):
        made = A.seed(self.r, background=False)
        self.assertEqual(sorted(f for f in os.listdir(self.ut) if f.endswith(".png")), ["manager.png", "scout.png", "writer.png"])
        self.assertEqual(len(made), 3 * 6)
        with open(os.path.join(self.ut, "scout.png"), "rb") as f:
            self.assertEqual(f.read(), b"avatars/seed/ut/scout", "avatars/seed wins over a preset")
        man = jl(os.path.join(self.ut, "_s", "index.json"))
        self.assertEqual(sorted(man), ["manager", "scout", "writer"])
        self.assertEqual(man["writer"], {"src": "writer.png", "etag": A.etag(os.path.join(self.ut, "writer.png"))})
        self.assertTrue(os.path.exists(os.path.join(self.ut, "_s", "writer-work-512.webp")))
        self.assertFalse(os.path.exists(os.path.join(self.ut, "unused.png")), "not on the roster")
        self.assertEqual(A.seed(self.r, background=False), [], "second run copies nothing")

    def test_never_overwrites(self):
        put(os.path.join(self.ut, "scout.png"), b"picked")
        put(os.path.join(self.ut, "mine.png"), b"hired")
        put(os.path.join(self.ut, "_s", "index.json"), json.dumps({"scout": {"src": "scout.png", "etag": "x"}}).encode())
        put(os.path.join(self.ut, "_s", "manager-160.webp"), b"old small")
        before = {f: sha(os.path.join(self.ut, f)) for f in ("scout.png", "mine.png", "_s/manager-160.webp")}
        A.seed(self.r, background=False)
        self.assertEqual(before, {f: sha(os.path.join(self.ut, f)) for f in before})
        self.assertFalse(os.path.exists(os.path.join(self.ut, "_s", "scout-160.webp")), "a role with a picture gets no seed files")
        man = jl(os.path.join(self.ut, "_s", "index.json"))
        self.assertEqual(man["scout"], {"src": "scout.png", "etag": "x"}, "existing entries kept")
        self.assertIn("writer", man)
        self.assertNotIn("manager", man, "a kept stale small copy is not vouched for (avatar_sizes rebuilds it)")

    def test_dry_and_example_roster(self):
        os.remove(os.path.join(self.r, "roster.json"))
        with open(os.path.join(self.r, "roster.example.json"), "w", encoding="utf-8") as f:
            json.dump({"roles": [{"id": "manager"}, {"id": "me"}]}, f)
        self.assertEqual(sorted(A.seed(self.r, dry=True)), sorted(["avatars/ut/manager.png"] + [f"avatars/ut/_s/manager-{s}.webp" for s in SUF]))
        self.assertFalse(os.path.exists(self.ut), "dry run writes nothing")


class RoleNotes(unittest.TestCase):
    """S2: roles/{writer,director,ops}.md left core for presets/classic/roles/. A roster role that reads one gets it back."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.r = os.path.realpath(self.tmp.name)
        put(os.path.join(self.r, "presets/classic/roles/writer.md"), b"classic writer")
        put(os.path.join(self.r, "presets/content-zh/roles/writer.md"), b"zh writer")
        put(os.path.join(self.r, "presets/content-zh/roles/director.md"), b"zh director")
        put(os.path.join(self.r, "roles/ops.md"), b"mine")
        put(os.path.join(self.r, "presets/classic/roles/ops.md"), b"classic ops")
        with open(os.path.join(self.r, "roster.json"), "w", encoding="utf-8") as f:
            json.dump({"roles": [{"id": "writer"}, {"id": "director", "notebooks": ["roles/common.md", "roles/director.md"]},
                                 {"id": "ops"}, {"id": "scout"}]}, f)

    def tearDown(self):
        self.tmp.cleanup()

    def test_copy_missing_only(self):
        self.assertEqual(A.role_notes(self.r), ["roles/writer.md", "roles/director.md"])
        with open(os.path.join(self.r, "roles/writer.md"), "rb") as f:
            self.assertEqual(f.read(), b"classic writer", "classic wins over other presets")
        with open(os.path.join(self.r, "roles/ops.md"), "rb") as f:
            self.assertEqual(f.read(), b"mine", "never overwrites")
        self.assertFalse(os.path.exists(os.path.join(self.r, "roles/scout.md")), "no preset copy, nothing made")
        self.assertEqual(A.role_notes(self.r), [], "second run copies nothing")


if __name__ == "__main__":
    unittest.main()
