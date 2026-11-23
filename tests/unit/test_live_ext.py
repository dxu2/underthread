"""t-oss-live: 看画面 / Watch as a built-in extension (ext/live).

- built-in extensions load from ext/<name>/; a local/ext/<name> with the same name replaces the built-in one
- config.json extensions.live switches it (default on); stateutil live-frame and the hook do nothing while it is off
- tools/live_hook.py: a Chrome step with an image -> .live/<id>.jpg, never in state.json or the log; the subagent is found by
  roster agent_name; Stop clears the flag the hook set
- .claude/settings.json ships the hooks; ./start notices a second copy in settings.local.json and leaves it alone
Each test runs in a throwaway copy of the repository's code (no state.json, config.json or local/ of the checkout)."""
import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
JPEG = b"\xff\xd8\xff\xe0" + b"underthread-test-frame" * 8


class Copy:
    def __enter__(self):
        self.d = os.path.realpath(tempfile.mkdtemp(prefix="rt-live-"))
        for f in ("stateutil.py", "roster.example.json"):
            shutil.copy(os.path.join(ROOT, f), self.d)
        for d in ("core", "ext"):
            shutil.copytree(os.path.join(ROOT, d), os.path.join(self.d, d), ignore=shutil.ignore_patterns("__pycache__"))
        os.makedirs(os.path.join(self.d, "tools"))
        shutil.copy(os.path.join(ROOT, "tools", "live_hook.py"), os.path.join(self.d, "tools"))
        shutil.copy(os.path.join(ROOT, "roster.example.json"), os.path.join(self.d, "roster.json"))
        self.env = dict(os.environ, UNDERTHREAD_LOCAL=os.path.join(self.d, "local"))
        seed = ("import json, stateutil as S\n"
                "roles = json.load(open('roster.json'))['roles']\n"
                "with S.mutate() as st:\n"
                "    for r in roles:\n"
                "        st['agents'][r['id']] = {'id': r['id'], 'status': 'working', 'agent_name': r.get('agent_name')}\n")
        subprocess.run([sys.executable, "-c", seed], cwd=self.d, env=self.env, check=True, timeout=60)   # what the server's roster sync does
        return self

    def __exit__(self, *exc):
        shutil.rmtree(self.d, ignore_errors=True)

    def su(self, *args, check=True):
        r = subprocess.run([sys.executable, "stateutil.py", *args], cwd=self.d, env=self.env, capture_output=True, text=True, timeout=60)
        if check and r.returncode:
            raise AssertionError(r.stderr or r.stdout)
        return r

    def hook(self, mode, payload):
        return subprocess.run([sys.executable, "tools/live_hook.py", mode], cwd=self.d, env=self.env, input=json.dumps(payload),
                              capture_output=True, text=True, timeout=60)

    def state(self):
        with open(os.path.join(self.d, "state.json"), encoding="utf-8") as f:
            return json.load(f)

    def config(self, data):
        with open(os.path.join(self.d, "config.json"), "w", encoding="utf-8") as f:
            json.dump(data, f)

    def p(self, *parts):
        return os.path.join(self.d, *parts)


def step(agent_type, image=True):
    resp = [{"type": "text", "text": "ok"}]
    if image:
        resp.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": base64.b64encode(JPEG).decode()}})
    return {"session_id": "s1", "agent_id": "a1", "agent_type": agent_type, "tool_name": "mcp__claude-in-chrome__computer", "tool_response": resp}


class LiveExt(unittest.TestCase):
    def test_cli_and_switch(self):
        with Copy() as c:
            self.assertIn("live-frame", c.su("--help").stdout)
            img = c.p("shot.jpg")
            with open(img, "wb") as f:
                f.write(JPEG)
            c.su("live-frame", "scout", img)
            self.assertTrue(os.path.exists(c.p(".live", "scout.jpg")))
            c.config({"extensions": {"live": False}})
            r = c.su("live-frame", "scout", img, check=False)
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("switched off", r.stderr)

    def test_hook_pushes_frame_not_state(self):
        with Copy() as c:
            name = next(r["agent_name"] for r in json.load(open(c.p("roster.json")))["roles"] if r["id"] == "scout")
            self.assertEqual(c.hook("sync", step(name)).returncode, 0)
            self.assertEqual(c.hook("post", step(name)).returncode, 0)
            self.assertTrue(os.path.exists(c.p(".live", "scout.jpg")), "frame written for the agent named by agent_name")
            self.assertEqual(c.state()["agents"]["scout"].get("tool"), "chrome", "sync sets the tool flag")
            raw = open(c.p("state.json"), encoding="utf-8").read()
            self.assertNotIn(base64.b64encode(JPEG).decode()[:24], raw)
            log = c.p("logs", "live_hook.log")
            if os.path.exists(log):
                self.assertNotIn(base64.b64encode(JPEG).decode()[:24], open(log, encoding="utf-8").read())
            self.assertEqual(c.hook("stop", {"session_id": "s1", "agent_id": "a1"}).returncode, 0)
            self.assertFalse(c.state()["agents"]["scout"].get("tool"), "stop clears the flag the hook set")
            self.assertFalse(os.path.exists(c.p(".live", "scout.jpg")), "and the frame goes with it")

    def test_hook_off_does_nothing(self):
        with Copy() as c:
            c.config({"extensions": {"live": False}})
            name = next(r["agent_name"] for r in json.load(open(c.p("roster.json")))["roles"] if r["id"] == "scout")
            for m in ("sync", "post"):
                self.assertEqual(c.hook(m, step(name)).returncode, 0)
            self.assertFalse(os.path.exists(c.p(".live", "scout.jpg")))
            self.assertFalse(c.state()["agents"]["scout"].get("tool"))

    def test_unknown_agent_type_is_ignored(self):
        with Copy() as c:
            for m in ("sync", "post"):
                self.assertEqual(c.hook(m, step("someone-else")).returncode, 0)
            self.assertEqual(os.listdir(c.p(".live")) if os.path.isdir(c.p(".live")) else [], [])

    def test_local_copy_replaces_builtin(self):
        with Copy() as c:
            mine = c.p("local", "ext", "live")
            shutil.copytree(c.p("ext", "live"), mine)
            code = ("import json, sys; sys.path.insert(0, '.'); from core import ext; "
                    "print(json.dumps([d for d in ext.ext_dirs()]))")
            r = subprocess.run([sys.executable, "-c", code], cwd=c.d, env=c.env, capture_output=True, text=True, timeout=30)
            dirs = json.loads(r.stdout)
            self.assertEqual([d for d in dirs if d.endswith(os.sep + "live")], [mine])


class Config(unittest.TestCase):
    def test_default_and_writer_keep_other_keys(self):
        sys.path.insert(0, ROOT)
        from core import config as C
        self.assertIs(C.DEFAULTS["extensions"]["live"], True)
        d = tempfile.mkdtemp(prefix="rt-cfg-")
        try:
            with open(os.path.join(d, "config.json"), "w") as f:
                json.dump({"port": 9000, "_schema": 1}, f)
            C.set_ext(d, "live", False)
            got = json.load(open(os.path.join(d, "config.json")))
            self.assertEqual(got, {"port": 9000, "_schema": 1, "extensions": {"live": False}})
            self.assertIs(C.merge(C.DEFAULTS, {"port": 1})["extensions"]["live"], True, "an old config.json without the key gets it on")
        finally:
            shutil.rmtree(d, ignore_errors=True)


class Shipped(unittest.TestCase):
    def test_settings_json_wires_hooks(self):
        s = json.load(open(os.path.join(ROOT, ".claude", "settings.json")))
        cmds = lambda ev: [h["command"] for b in s["hooks"].get(ev, []) for h in b["hooks"]]
        post = cmds("PostToolUse")
        self.assertTrue(any("live_hook.py\" post" in x for x in post) and any("live_hook.py\" sync" in x for x in post))
        for ev in ("Stop", "SubagentStop"):
            self.assertTrue(any("live_hook.py\" stop" in x for x in cmds(ev)), ev)

    def test_no_private_prefix(self):
        for p in ("tools/live_hook.py", "ext/live/server_ext.py", "ext/live/stateutil_ext.py", "ext/live/web/live.js"):
            self.assertNotIn("rover", open(os.path.join(ROOT, p), encoding="utf-8").read().lower(), p)

    def test_start_notices_duplicate(self):
        import importlib.util
        d = os.path.realpath(tempfile.mkdtemp(prefix="rt-start-"))
        try:
            os.makedirs(os.path.join(d, "tools"))
            os.makedirs(os.path.join(d, ".claude"))
            shutil.copy(os.path.join(ROOT, "tools", "start.py"), os.path.join(d, "tools", "start.py"))
            argv, sys.argv = sys.argv, ["start.py"]
            try:
                spec = importlib.util.spec_from_file_location("start_live", os.path.join(d, "tools", "start.py"))
                m = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(m)
            finally:
                sys.argv = argv
            self.assertFalse(m.dup_live_hook())
            p = os.path.join(d, ".claude", "settings.local.json")
            with open(p, "w") as f:
                f.write('{"hooks": {"Stop": [{"hooks": [{"type": "command", "command": "python3 tools/live_hook.py stop"}]}]}}')
            before = open(p).read()
            self.assertTrue(m.dup_live_hook())
            self.assertEqual(open(p).read(), before, "the user's file is never edited")
        finally:
            shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
