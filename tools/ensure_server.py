#!/usr/bin/env python3
"""Make sure the dashboard is up; start it if not. Safe to run any time.

    python3 tools/ensure_server.py        # prints "up" or how it was started

Order: already answering → nothing to do; launchd service installed (macOS) → kickstart it;
otherwise start tools/keepalive.sh with bash, detached, logging to logs/server.log (macOS and Linux).
"""
import json
import os
import shutil
import subprocess
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LABEL = "com.underthread.server"


def port():
    try:
        with open(os.path.join(ROOT, "config.json")) as f:
            return int(json.load(f).get("port", 8765))
    except (OSError, ValueError):
        return 8765


def up(p):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{p}/api/state?rev=-1", timeout=3) as r:
            return r.status == 200
    except OSError:
        return False


def main():
    p = port()
    if up(p):
        print("up")
        return
    uid = os.getuid()
    if shutil.which("launchctl") and subprocess.run(["launchctl", "print", f"gui/{uid}/{LABEL}"], capture_output=True).returncode == 0:
        subprocess.run(["launchctl", "kickstart", "-k", f"gui/{uid}/{LABEL}"])
        how = "kickstarted launchd service"
    else:
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        log = open(os.path.join(ROOT, "logs", "keepalive.out"), "a")
        subprocess.Popen(["bash", os.path.join(ROOT, "tools", "keepalive.sh")], cwd=ROOT, stdout=log, stderr=log,
                         stdin=subprocess.DEVNULL, start_new_session=True)
        how = "started tools/keepalive.sh in the background"
    for _ in range(20):
        time.sleep(0.5)
        if up(p):
            print(f"was down; {how}; up again")
            return
    print(f"was down; {how}; still not answering. Check logs/server.log")


if __name__ == "__main__":
    main()
