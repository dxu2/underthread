#!/usr/bin/env python3
"""ComfyUI on your GPU machine, over an SSH tunnel. Stdlib only.

    python3 tools/comfy.py tunnel                 # ssh -f -N -L <local>:127.0.0.1:<remote> <host>
    python3 tools/comfy.py ping                   # GPU / VRAM / queue
    python3 tools/comfy.py run WF.json --set 6.text="a cat" --set 3.seed=42 --out work/<item>/art
    python3 tools/comfy.py nodes WF.json          # list node ids, class types and inputs you can --set

WF.json is an API-format workflow ("Save (API)" in ComfyUI). Config: config.json → comfy.
"""
import argparse
import json
import os
import random
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def cfg():
    if ROOT not in sys.path:
        sys.path.insert(0, ROOT)
    from core import config as C   # t-oss-struct B1: no config.json yet = defaults, which have no comfy block
    return C.load(ROOT).get("comfy", {})


C = cfg()
BASE = f"http://127.0.0.1:{C.get('local_port', 8188)}"


def get(path, timeout=10):
    with urllib.request.urlopen(BASE + path, timeout=timeout) as r:
        return r.read()


def post(path, body):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def cmd_tunnel(a):
    host = C.get("ssh_host")
    if not host or host.startswith("<"):
        sys.exit("set comfy.ssh_host in config.json first")
    lp, rp = C.get("local_port", 8188), C.get("remote_port", 8188)
    try:
        get("/system_stats", timeout=2)
        print(f"tunnel already up on {BASE}")
        return
    except OSError:
        pass
    cmd = ["ssh", "-f", "-N", "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=30",
           "-L", f"{lp}:127.0.0.1:{rp}", host]
    print(" ".join(cmd))
    subprocess.run(cmd, check=True)
    print(f"tunnel up → {BASE}")


def cmd_ping(a):
    try:
        s = json.loads(get("/system_stats", timeout=3))
    except OSError as e:
        sys.exit(f"ComfyUI not reachable at {BASE} ({e}). Run: python3 tools/comfy.py tunnel")
    for d in s.get("devices", []):
        free, total = d.get("vram_free", 0) / 2**30, d.get("vram_total", 0) / 2**30
        print(f"{d.get('name')}: {free:.1f} / {total:.1f} GiB free")
    q = json.loads(get("/queue"))
    print(f"queue: {len(q.get('queue_running', []))} running, {len(q.get('queue_pending', []))} pending")
    print(f"comfyui {s.get('system', {}).get('comfyui_version', '?')}")


def load_wf(path):
    with open(path, encoding="utf-8") as f:
        wf = json.load(f)
    if "nodes" in wf and "links" in wf:
        sys.exit("this is a UI-format workflow; export it with 'Save (API)' instead")
    return wf


def cmd_nodes(a):
    wf = load_wf(a.workflow)
    for nid, n in wf.items():
        if not isinstance(n, dict):
            continue
        ins = {k: v for k, v in n.get("inputs", {}).items() if not isinstance(v, list)}
        title = n.get("_meta", {}).get("title", "")
        print(f"{nid:>4}  {n.get('class_type')}  {title}")
        for k, v in ins.items():
            s = json.dumps(v, ensure_ascii=False)
            print(f"        {k} = {s[:80]}")


def apply_sets(wf, sets):
    for s in sets or []:
        key, _, val = s.partition("=")
        nid, _, inp = key.partition(".")
        if nid not in wf or not inp:
            sys.exit(f"bad --set {s!r} (node {nid!r} not in workflow)")
        try:
            v = json.loads(val)
        except json.JSONDecodeError:
            v = val
        wf[nid]["inputs"][inp] = v


def cmd_run(a):
    wf = load_wf(a.workflow)
    apply_sets(wf, a.set)
    if a.random_seed:
        for n in wf.values():
            if isinstance(n, dict) and "seed" in n.get("inputs", {}):
                n["inputs"]["seed"] = random.randint(0, 2**48)
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, f"workflow-{int(time.time())}.json"), "w", encoding="utf-8") as f:
        json.dump(wf, f, ensure_ascii=False, indent=1)
    try:
        r = post("/prompt", {"prompt": wf, "client_id": uuid.uuid4().hex})
    except urllib.error.HTTPError as e:
        sys.exit(f"ComfyUI rejected the workflow: {e.read().decode()[:2000]}")
    except OSError as e:
        sys.exit(f"ComfyUI not reachable ({e}). Run: python3 tools/comfy.py tunnel")
    pid = r["prompt_id"]
    print(f"queued {pid}", flush=True)
    t0 = time.time()
    while True:
        if time.time() - t0 > a.timeout:
            sys.exit(f"timed out after {a.timeout}s (prompt {pid} may still finish; check /history/{pid})")
        h = json.loads(get(f"/history/{pid}")).get(pid)
        if h and (h.get("outputs") or h.get("status", {}).get("completed")):
            break
        if h and h.get("status", {}).get("status_str") == "error":
            sys.exit(f"ComfyUI error: {json.dumps(h['status'], ensure_ascii=False)[:2000]}")
        time.sleep(2)
    saved = []
    for node_out in h.get("outputs", {}).values():
        for kind in ("images", "gifs", "videos"):
            for im in node_out.get(kind, []):
                q = urllib.parse.urlencode({"filename": im["filename"], "subfolder": im.get("subfolder", ""), "type": im.get("type", "output")})
                dest = os.path.join(a.out, im["filename"])
                with open(dest, "wb") as f:
                    f.write(get(f"/view?{q}", timeout=120))
                saved.append(dest)
    print(f"done in {time.time() - t0:.0f}s")
    for s in saved:
        print(s)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd")
    sub.add_parser("tunnel").set_defaults(fn=cmd_tunnel)
    sub.add_parser("ping").set_defaults(fn=cmd_ping)
    n = sub.add_parser("nodes"); n.add_argument("workflow"); n.set_defaults(fn=cmd_nodes)
    r = sub.add_parser("run"); r.add_argument("workflow")
    r.add_argument("--set", action="append", help="NODE.INPUT=VALUE (JSON or string)")
    r.add_argument("--random-seed", action="store_true"); r.add_argument("--out", required=True)
    r.add_argument("--timeout", type=int, default=900); r.set_defaults(fn=cmd_run)
    a = p.parse_args()
    if not a.cmd:
        p.print_help()
        return
    a.fn(a)


if __name__ == "__main__":
    main()
