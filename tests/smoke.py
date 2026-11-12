#!/usr/bin/env python3
"""Smoke test for a fresh checkout. Stdlib only, no Claude Code needed.

    python3 tests/smoke.py            # everything below, about 30 seconds
    python3 tests/smoke.py -k guard   # only the checks whose name contains "guard"

It copies the checkout (without .git, templates art and runtime folders) into a temporary folder and works there,
so your own state.json, inbox and work/ are never touched. Checks:
  compile      every .py compiles; every web/*.js parses (if node is installed)
  json         every tracked .json file parses
  agents       make_agents.py writes one agent per non-manager roster role
  preset       tools/preset.py apply content-zh switches the roster, then make_agents still works
  server       a fresh start copies the example files, serves the page and /api/state, no 404 for the avatar manifest
  guard        unknown Host -> 421; cross-site browser POST -> 403; same-origin POST without X-Underthread -> 403; with it -> ok
  stateutil    upsert-item / say-mgr / log land in /api/state; a POST from the page shows up in the inbox
  demo         python3 tools/demo.py --fast starts, cards move, and the checkout's own state stays absent
  keepalive    tools/keepalive.sh is valid bash
"""
import glob
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import traceback
import urllib.error
import urllib.request

SRC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = sys.executable
ONLY = sys.argv[sys.argv.index("-k") + 1] if "-k" in sys.argv else ""
SKIP = {".git", ".demo", "uploads", "work", "logs", "__pycache__", "node_modules"}
RUNTIME = ("state.json", "roster.json", "config.json", "inbox.jsonl", "archive.json")


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def copy_tree(dst):
    def ignore(d, names):
        out = {n for n in names if n in SKIP or ".bak" in n}
        if os.path.abspath(d) == SRC:
            out |= {n for n in names if n in RUNTIME or n.startswith(".state") or n.startswith(".inbox")}
        if os.path.basename(d) == ".claude":
            out |= {n for n in names if n in ("agents", "agent-memory", "settings.local.json")}
        return out
    shutil.copytree(SRC, dst, ignore=ignore, symlinks=True)


def req(port, path, method="GET", body=None, headers=None, host=None):
    h = {"Host": host or f"127.0.0.1:{port}"}
    h.update(headers or {})
    data = json.dumps(body).encode() if isinstance(body, (dict, list)) else body
    r = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=10) as x:
            return x.status, x.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def wait_up(port, timeout=20):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            if req(port, "/api/health")[0] == 200:
                return True
        except OSError:
            time.sleep(0.3)
    return False


class Server:
    def __init__(self, root, env=None, args=None):
        self.port = free_port()
        e = dict(os.environ, PORT=str(self.port), NO_LOOPS="1")
        e.update(env or {})
        self.log = open(os.path.join(root, "server-test.log"), "w")
        self.p = subprocess.Popen([PY, *(args or ["server.py"])], cwd=root, env=e, stdout=self.log, stderr=subprocess.STDOUT)
        if not wait_up(self.port):
            self.stop()
            raise AssertionError("server did not come up:\n" + open(os.path.join(root, "server-test.log")).read()[-2000:])

    def stop(self):
        self.p.terminate()
        try:
            self.p.wait(8)
        except subprocess.TimeoutExpired:
            self.p.kill()
        self.log.close()


def S(root, *args, stdin=None):
    r = subprocess.run([PY, "stateutil.py", *args], cwd=root, input=stdin, capture_output=True, text=True)
    assert r.returncode == 0, f"stateutil {args[0]} failed: {r.stderr[-500:]}"
    return r.stdout


# ---------------------------------------------------------------- checks

def t_compile(root):
    bad = []
    for f in glob.glob(os.path.join(root, "**", "*.py"), recursive=True):
        if "/templates/" in f:
            continue
        r = subprocess.run([PY, "-m", "py_compile", f], capture_output=True, text=True)
        if r.returncode:
            bad.append(r.stderr.strip())
    if shutil.which("node"):
        for f in sorted(glob.glob(os.path.join(root, "web", "*.js"))):
            r = subprocess.run(["node", "--check", f], capture_output=True, text=True)
            if r.returncode:
                bad.append(f"{os.path.basename(f)}: {r.stderr.strip()[:300]}")
    else:
        print("    (node not installed: web/*.js not parsed)")
    assert not bad, "\n".join(bad)


def t_json(root):
    bad = []
    for f in glob.glob(os.path.join(root, "**", "*.json"), recursive=True) + glob.glob(os.path.join(root, ".claude", "*.json")):
        try:
            with open(f, encoding="utf-8") as x:
                json.load(x)
        except ValueError as e:
            bad.append(f"{os.path.relpath(f, root)}: {e}")
    assert not bad, "\n".join(bad)


def t_agents(root):
    r = subprocess.run([PY, "make_agents.py"], cwd=root, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    with open(os.path.join(root, "roster.example.json"), encoding="utf-8") as f:
        roles = [x for x in json.load(f)["roles"] if x["id"] != "manager" and x.get("agent_name")]
    files = sorted(os.listdir(os.path.join(root, ".claude", "agents")))
    assert files == sorted(f"{x['agent_name']}.md" for x in roles), files
    txt = open(os.path.join(root, ".claude", "agents", files[0]), encoding="utf-8").read()
    assert "## Hard rules" in txt and "stateutil.py" in txt
    assert "B站" not in txt, "the default crew should not carry content-platform rules"


def t_preset(root):
    before = {f: os.path.exists(os.path.join(root, f)) for f in ("roster.json", "config.json")}
    r = subprocess.run([PY, "tools/preset.py", "apply", "content-zh"], cwd=root, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    with open(os.path.join(root, "roster.json"), encoding="utf-8") as f:
        assert "B站" in json.load(f).get("team", "")
    assert glob.glob(os.path.join(root, "roles", "writer.md.bak-preset-*")), "no backup of the replaced role notes"
    r = subprocess.run([PY, "make_agents.py"], cwd=root, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    # put the default crew back for the next checks
    for f in glob.glob(os.path.join(root, "*.bak-preset-*")) + glob.glob(os.path.join(root, "roles", "*.bak-preset-*")):
        shutil.move(f, f.split(".bak-preset-")[0])
    for f, was in before.items():
        if not was and os.path.exists(os.path.join(root, f)):
            os.remove(os.path.join(root, f))
    shutil.rmtree(os.path.join(root, ".claude", "agents"), ignore_errors=True)
    subprocess.run([PY, "make_agents.py"], cwd=root, capture_output=True, text=True)   # manager.md dispatch table back to default


def t_server(root):
    for f in RUNTIME:
        assert not os.path.exists(os.path.join(root, f)), f"{f} should not be in a fresh checkout"
    shutil.copy(os.path.join(root, "state.example.json"), os.path.join(root, "state.json"))
    s = Server(root)
    try:
        assert os.path.exists(os.path.join(root, "roster.json")) and os.path.exists(os.path.join(root, "config.json"))
        c, b = req(s.port, "/")
        assert c == 200 and b"Underthread" in b, c
        c, b = req(s.port, "/api/state")
        st = json.loads(b)
        assert c == 200 and len(st["items"]) >= 3 and "manager" in st["agents"], (c, len(st.get("items", [])))
        assert req(s.port, "/avatars/_s/index.json")[0] == 200, "avatar manifest should not 404"
        idx = req(s.port, "/")[1].decode()
        import re
        for path in sorted(set(re.findall(r'"/static/([^"?]+)\?v=', idx))):
            assert req(s.port, "/static/" + path)[0] == 200, f"/static/{path} missing"
    finally:
        s.stop()


def t_guard(root):
    s = Server(root)
    try:
        p, o = s.port, f"http://127.0.0.1:{s.port}"
        assert req(p, "/api/state", host="evil.example")[0] == 421
        body = {"kind": "chat", "text": "hello from a test"}
        assert req(p, "/api/action", "POST", body, {"Content-Type": "application/json", "Origin": "http://evil.example"})[0] == 403
        assert req(p, "/api/action", "POST", body, {"Content-Type": "application/json", "Origin": o})[0] == 403
        c, b = req(p, "/api/action", "POST", body, {"Content-Type": "application/json", "Origin": o, "X-Underthread": "1"})
        assert c == 200, (c, b[:200])
        c, _ = req(p, "/api/action", "POST", body, {"Content-Type": "application/json"})   # curl / scripts: no browser headers
        assert c == 200, c
    finally:
        s.stop()


def t_stateutil(root):
    s = Server(root)
    try:
        S(root, "upsert-item", "--id", "t-smoke", "--who", "scout", "--title", "Smoke card", "--stage", "review",
          "--kind", "deliverable", "--owner", "scout", "--draft", "-", "--label", "v1", stdin="# Draft\n\nok")
        S(root, "log", "t-smoke", "scout", "checked")
        S(root, "say-mgr", "smoke says hi")
        st = json.loads(req(s.port, "/api/state")[1])
        it = next(i for i in st["items"] if i["id"] == "t-smoke")
        assert it["stage"] == "review" and it["owner"] == "scout"
        assert any("smoke says hi" in (m.get("text") or "") for m in st.get("chat", []))
        o = f"http://127.0.0.1:{s.port}"
        c, _ = req(s.port, "/api/action", "POST", {"kind": "comment", "item": "t-smoke", "text": "looks good"},
                   {"Content-Type": "application/json", "Origin": o, "X-Underthread": "1"})
        assert c == 200, c
        assert "looks good" in S(root, "inbox-pending"), "the comment did not reach the inbox"
    finally:
        s.stop()


def t_demo(root):
    d = tempfile.mkdtemp(prefix="ut-demo-")
    try:
        copy_tree(os.path.join(d, "repo"))
        r = os.path.join(d, "repo")
        port = free_port()
        log = open(os.path.join(d, "demo.log"), "w")
        p = subprocess.Popen([PY, "server.py", "--demo", "--fast"], cwd=r, env=dict(os.environ, PORT=str(port)),
                             stdout=log, stderr=subprocess.STDOUT)
        try:
            assert wait_up(port), open(os.path.join(d, "demo.log")).read()[-1500:]
            seen = set()
            t0 = time.time()
            while time.time() - t0 < 40 and len(seen) < 2:
                st = json.loads(req(port, "/api/state")[1])
                seen |= {i["id"] for i in st["items"] if i["stage"] == "review"}
                time.sleep(1)
            assert len(seen) >= 2, f"demo cards did not reach review: {seen}"
            assert not os.path.exists(os.path.join(r, "state.json")), "demo wrote the checkout's own state.json"
        finally:
            p.terminate()
            try:
                p.wait(8)
            except subprocess.TimeoutExpired:
                p.kill()
            log.close()
    finally:
        shutil.rmtree(d, ignore_errors=True)


def t_keepalive(root):
    r = subprocess.run(["bash", "-n", os.path.join(root, "tools", "keepalive.sh")], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert open(os.path.join(root, "tools", "keepalive.sh")).readline().strip() == "#!/usr/bin/env bash"


CHECKS = [("compile", t_compile), ("json", t_json), ("agents", t_agents), ("preset", t_preset), ("server", t_server),
          ("guard", t_guard), ("stateutil", t_stateutil), ("demo", t_demo), ("keepalive", t_keepalive)]


def main():
    tmp = tempfile.mkdtemp(prefix="ut-smoke-")
    root = os.path.join(tmp, "repo")
    copy_tree(root)
    failed = 0
    try:
        for name, fn in CHECKS:
            if ONLY and ONLY not in name:
                continue
            t0 = time.time()
            try:
                fn(root)
                print(f"ok    {name} ({time.time() - t0:.1f}s)", flush=True)
            except Exception:  # noqa: BLE001
                failed += 1
                print(f"FAIL  {name}\n" + "".join("      " + x + "\n" for x in traceback.format_exc().strip().splitlines()[-12:]), flush=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print("smoke:", "all passed" if not failed else f"{failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
