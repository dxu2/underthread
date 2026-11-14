"""One server per test class: a copy of the checkout (no .git, no local/, no runtime data) with the e2e fixtures loaded,
on a free port with the loops off. Your own state.json is never read."""
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SKIP = {".git", ".demo", "uploads", "work", "logs", "local", "node_modules", "__pycache__", "archive", "rcshots", ".live", ".claude",
        "state.json", "roster.json", "config.json", "inbox.jsonl", "archive.json", "push_subs.json", "vapid.json"}
MODELS = {"models", "voice"}   # tools/models, tools/voice: big local downloads


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class FixtureServer:
    def __init__(self):
        self.dir = tempfile.mkdtemp(prefix="rt-api-")
        self.root = os.path.join(self.dir, "rt")

        def ignore(d, names):
            out = {n for n in names if n in SKIP or ".bak" in n or n.startswith(".state") or n.startswith(".inbox")}
            if os.path.basename(d) == "tools":
                out |= {n for n in names if n in MODELS}
            return out
        shutil.copytree(ROOT, self.root, ignore=ignore, symlinks=True)
        subprocess.run([sys.executable, os.path.join(ROOT, "tests", "e2e", "fixtures", "load.py"), self.root], check=True, capture_output=True)
        self.port = free_port()
        self.log = open(os.path.join(self.dir, "server.log"), "w")
        env = dict(os.environ, PORT=str(self.port), NO_LOOPS="1")
        self.p = subprocess.Popen([sys.executable, "server.py"], cwd=self.root, env=env, stdout=self.log, stderr=subprocess.STDOUT)
        t0 = time.time()
        while time.time() - t0 < 20:
            try:
                if self.get("/api/health")[0] == 200:
                    return
            except OSError:
                pass
            if self.p.poll() is not None:
                break
            time.sleep(0.2)
        self.stop()
        raise RuntimeError("fixture server did not start; see " + os.path.join(self.dir, "server.log"))

    def req(self, path, method="GET", body=None, headers=None):
        h = {"Host": f"127.0.0.1:{self.port}"}
        h.update(headers or {})
        data = json.dumps(body).encode() if isinstance(body, (dict, list)) else body
        r = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(r, timeout=10) as x:
                return x.status, x.read()
        except urllib.error.HTTPError as e:
            with e:
                return e.code, e.read()

    def get(self, path):
        return self.req(path)

    def json(self, path):
        c, b = self.get(path)
        assert c == 200, (path, c, b[:200])
        return json.loads(b)

    def action(self, body):
        o = f"http://127.0.0.1:{self.port}"
        return self.req("/api/action", "POST", body, {"Content-Type": "application/json", "Origin": o, "X-Underthread": "1"})

    def su(self, *args):
        return subprocess.run([sys.executable, "stateutil.py", *args], cwd=self.root, capture_output=True, text=True, check=True).stdout

    def inbox(self):
        p = os.path.join(self.root, "inbox.jsonl")
        if not os.path.exists(p):
            return []
        with open(p, encoding="utf-8") as f:
            return [json.loads(l) for l in f if l.strip()]

    def stop(self):
        if self.p.poll() is None:
            self.p.terminate()
            try:
                self.p.wait(5)
            except subprocess.TimeoutExpired:
                self.p.kill()
        self.log.close()
        shutil.rmtree(self.dir, ignore_errors=True)
