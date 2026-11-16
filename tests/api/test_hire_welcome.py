"""t-hire-celebration: meta.hires tells the page which recent hires it may welcome (web/js/welcome.js plays each once per browser).
Source = the "apply" lines tools/new_role.py writes to logs/new_role.jsonl; a later "retire" line, a role gone from the roster or a hire
older than 72 h drops out. A hire that got the recoloured placeholder avatar ("avatar": "recolour") waits until avatars/ut/<id>.png is
replaced (the picked avatar; tools/avatar_sizes.py then moves meta.avv), at most config hire_welcome.wait_avatar_min minutes."""
import datetime as dt
import json
import os
import sys
import time
import unittest

from tests.api._server import FixtureServer, ROOT as _ROOT

sys.path.insert(0, _ROOT)
from core.avatar_seed import seed  # noqa: E402

NOW = dt.datetime.now().astimezone()


def iso(d):
    return d.isoformat(timespec="seconds")


def rj(p):
    with open(p) as f:
        return json.load(f)


def wj(p, v):
    with open(p, "w") as f:
        json.dump(v, f)


IDS = {}


def prepare(root):
    seed(root, background=False)   # t-oss-generic S1: avatars/ut/ is install data; the server seeds it at start, prepare runs before
    roles = [r["id"] for r in rj(os.path.join(root, "roster.json"))["roles"] if r["id"] != "manager"]
    ut = [i for i in roles if os.path.exists(os.path.join(root, "avatars", "ut", f"{i}.png"))]
    IDS.update(given=roles[0], wait=ut[-1], old=roles[1], gone=roles[2])
    lines = [
        {"t": iso(NOW - dt.timedelta(hours=1)), "op": "apply", "id": IDS["given"], "avatar": "given"},
        {"t": iso(NOW - dt.timedelta(minutes=10)), "op": "apply", "id": IDS["wait"], "avatar": "recolour"},
        {"t": iso(NOW - dt.timedelta(hours=100)), "op": "apply", "id": IDS["old"]},
        {"t": iso(NOW - dt.timedelta(hours=2)), "op": "apply", "id": IDS["gone"]},
        {"t": iso(NOW - dt.timedelta(hours=1)), "op": "retire", "id": IDS["gone"], "hard": False},
        {"t": iso(NOW - dt.timedelta(minutes=5)), "op": "apply", "id": "zz-not-in-roster"},
        "not json",
    ]
    os.makedirs(os.path.join(root, "logs"), exist_ok=True)
    with open(os.path.join(root, "logs", "new_role.jsonl"), "w") as f:
        for ln in lines:
            f.write((ln if isinstance(ln, str) else json.dumps(ln)) + "\n")
    p = os.path.join(root, "avatars", "ut", f"{IDS['wait']}.png")   # the placeholder: written by new_role.py in the hire's second
    t = (NOW - dt.timedelta(minutes=10)).timestamp()
    os.utime(p, (t, t))
    cfg = os.path.join(root, "config.json")
    c = rj(cfg) if os.path.exists(cfg) else {}
    c["hire_welcome"] = {"wait_avatar_min": 30}
    wj(cfg, c)


class HireWelcome(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.s = FixtureServer(prepare=prepare)

    @classmethod
    def tearDownClass(cls):
        cls.s.stop()

    def hires(self, same=False):
        st = self.s.json("/api/state?slim=1")
        if same:
            st = self.s.json(f"/api/state?slim=1&rev={st['meta']['rev']}")
            self.assertTrue(st.get("same"))
        return {h["id"]: h for h in st["meta"]["hires"]}

    def test_1_listed_and_dropped(self):
        h = self.hires()
        self.assertIn(IDS["given"], h)
        self.assertGreaterEqual(h[IDS["given"]]["t"], h[IDS["given"]]["at"])   # t moves only when the 特典 avatar file is newer than the hire
        for k in ("old", "gone"):
            self.assertNotIn(IDS[k], h, k)
        self.assertNotIn("zz-not-in-roster", h)
        self.assertEqual(h, self.hires(same=True), "the long-poll same answer carries the same list")

    def test_2_placeholder_waits_for_the_picked_avatar(self):
        self.assertNotIn(IDS["wait"], self.hires(), "a recoloured placeholder waits")
        p = os.path.join(self.s.root, "avatars", "ut", f"{IDS['wait']}.png")
        os.utime(p, None)   # the picked avatar is installed ...
        m = os.path.join(self.s.root, "avatars", "ut", "_s", "index.json")   # ... and avatar_sizes.py rewrites the manifest
        j = rj(m)
        j["zz-bump"] = {"src": "zz.png", "etag": '"%x-1"' % time.time_ns()}
        wj(m, j)
        h = self.hires(same=True)
        self.assertIn(IDS["wait"], h)
        self.assertGreater(h[IDS["wait"]]["t"], h[IDS["wait"]]["at"], "t = when the avatar was replaced")
        self.assertIn(IDS["wait"], self.hires())


if __name__ == "__main__":
    unittest.main()
