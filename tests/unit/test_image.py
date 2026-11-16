"""t-oss-gen-s3: tools/image.py picks a picture backend without generating anything; tools/work_strip.py --bob builds the
4-frame sheets with frame 1 = the avatar as it is."""
import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def load_image():
    spec = importlib.util.spec_from_file_location("rt_image_test", os.path.join(ROOT, "tools", "image.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


class Resolve(unittest.TestCase):
    def setUp(self):
        self.m = load_image()
        self.tmp = tempfile.mkdtemp(prefix="rt-image-")
        self.old = os.environ.get("CODEX_BIN")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)
        if self.old is None:
            os.environ.pop("CODEX_BIN", None)
        else:
            os.environ["CODEX_BIN"] = self.old

    def fake_codex(self, says):
        p = os.path.join(self.tmp, "codex")
        with open(p, "w") as f:
            f.write(f"#!/bin/sh\necho '{says}'\n")
        os.chmod(p, 0o755)
        os.environ["CODEX_BIN"] = p

    def test_none_setting(self):
        self.assertEqual(self.m.resolve({"image": {"backend": "none"}, "comfy": {"ssh_host": "x"}})["backend"], "none")

    def test_unknown_setting(self):
        r = self.m.resolve({"image": {"backend": "dalle"}})
        self.assertEqual(r["backend"], "none")
        self.assertIn("unknown", r["why"])

    def test_comfy_needs_block(self):
        self.assertEqual(self.m.resolve({"image": {"backend": "comfy"}})["backend"], "none")
        self.assertEqual(self.m.resolve({"image": {"backend": "comfy"}, "comfy": {"ssh_host": "x"}})["backend"], "comfy")

    def test_auto_prefers_chatgpt_codex(self):
        self.fake_codex("Logged in using ChatGPT")
        self.assertEqual(self.m.resolve({"image": {"backend": "auto"}, "comfy": {"ssh_host": "x"}})["backend"], "codex")

    def test_api_key_login_does_not_count(self):
        self.fake_codex("Logged in using an API key")
        self.assertEqual(self.m.resolve({"image": {"backend": "auto"}})["backend"], "none")
        self.assertEqual(self.m.resolve({"image": {"backend": "auto"}, "comfy": {"ssh_host": "x"}})["backend"], "comfy")

    def test_gen_without_backend_exits_6(self):
        self.fake_codex("Not logged in")
        root = os.path.join(self.tmp, "inst")
        os.makedirs(os.path.join(root, "tools"))
        shutil.copytree(os.path.join(ROOT, "core"), os.path.join(root, "core"))
        shutil.copy(os.path.join(ROOT, "tools", "image.py"), os.path.join(root, "tools"))
        with open(os.path.join(root, "config.json"), "w") as f:
            f.write('{"image": {"backend": "none"}}')
        r = subprocess.run([sys.executable, os.path.join(root, "tools", "image.py"), "gen", "a cat", os.path.join(self.tmp, "out")],
                           capture_output=True, text=True, stdin=subprocess.DEVNULL)
        self.assertEqual(r.returncode, 6, r.stderr)
        self.assertEqual(r.stdout, "")


@unittest.skipUnless(all(shutil.which(t) for t in ("ffmpeg", "ffprobe", "cwebp")), "needs ffmpeg and cwebp")
class Bob(unittest.TestCase):
    def test_bob_sheets(self):
        tmp = tempfile.mkdtemp(prefix="rt-strip-")
        try:
            av = os.path.join(tmp, "av.png")
            subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x8a5a3c:s=512x512", "-frames:v", "1", av], check=True)
            out = os.path.join(tmp, "out")
            r = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "work_strip.py"), av, out, "--bob"], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            for s in (160, 320, 512):
                w = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0",
                                    os.path.join(out, f"work-{s}.webp")], capture_output=True, text=True).stdout.strip()
                self.assertEqual(w, f"{4 * s},{s}")
            self.assertFalse(os.path.exists(os.path.join(out, "base.png")))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_needs_one_mode(self):
        r = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "work_strip.py"), "x.png", "out"], capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0)


if __name__ == "__main__":
    unittest.main()
