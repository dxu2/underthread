"""看画面 / Watch, stateutil side (built-in extension, t-oss-live).

`stateutil live-frame <agent> <image>` puts a screenshot into .live/<agent>.jpg (atomic rename), for the dashboard's viewer.
tools/live_hook.py does the same on its own after every Claude in Chrome step that returned an image, so agents rarely need it.
Frames never go into state.json; server_ext.py serves one only while the agent still has a --tool flag and the file is younger
than its TTL; clearing the flag deletes it. tools/live_hook.py calls S.live_write / S.live_path / S.live_drop, so those names are
put on the stateutil module.
"""
import os
import re
import shutil
import subprocess
import sys

from core.ext import ext_on


def register(R):
    S = R.S
    LIVE_DIR = os.path.join(S.ROOT, ".live")
    LIVE_W = 1200
    LIVE_COPY_W = 1600

    def live_path(agent_id):
        return os.path.join(LIVE_DIR, re.sub(r"[^\w.-]", "_", str(agent_id)) + ".jpg")

    def live_drop(agent_id):
        # .watch (a viewer is open), .auto (the hook set the tool flag) and .nudge go with the frame
        base = live_path(agent_id)[:-4]
        for p in (base + ".jpg", base + ".watch", base + ".auto", base + ".nudge"):
            try:
                os.unlink(p)
            except OSError:
                pass

    def _width(src):
        if not shutil.which("sips"):
            return 0
        w = subprocess.run(["sips", "-g", "pixelWidth", src], capture_output=True, text=True).stdout.split()[-1:]
        return int(w[0]) if (w and w[0].isdigit()) else 0

    def live_write(agent_id, src):
        """Put image file `src` into .live/<agent>.jpg (atomic). On a Mac a JPEG up to LIVE_COPY_W wide is copied as is, anything
        else goes through sips (built in) to a LIVE_W JPEG. Without sips (Linux) the bytes are copied unchanged."""
        os.makedirs(LIVE_DIR, exist_ok=True)
        dst = live_path(agent_id)
        tmp = dst + ".%d.tmp.jpg" % os.getpid()
        with open(src, "rb") as f:
            jpeg = f.read(3) == b"\xff\xd8\xff"
        w = _width(src)
        if not shutil.which("sips") or (jpeg and 0 < w <= LIVE_COPY_W):
            shutil.copyfile(src, tmp)
        else:
            big = ["--resampleWidth", str(LIVE_W)] if w > LIVE_W else []   # never upscale a 0.5-scale shot
            r = subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "75", *big, src, "--out", tmp], capture_output=True)
            if r.returncode or not os.path.exists(tmp):
                shutil.copyfile(src, tmp)
        os.replace(tmp, dst)

    def on_set_agent(st, agent_id, a, auto, tool):
        if tool is not None and tool.strip() and not auto:
            try:
                os.unlink(live_path(agent_id)[:-4] + ".auto")   # a manual --tool owns the flag now
            except OSError:
                pass
        if not a.get("tool"):
            live_drop(agent_id)   # the tool flag is gone, so is the last frame

    def cmd_live_frame(a):
        if not ext_on("live"):
            sys.exit("看画面 is switched off (Settings -> Connections, or config.json extensions.live)")
        src = os.path.expanduser(a.image)
        if not os.path.isfile(src):
            sys.exit(f"no such image: {src}")
        if a.agent not in (S.read().get("agents") or {}):
            sys.exit(f"unknown agent: {a.agent}")
        live_write(a.agent, src)
        print("ok")

    def cli(sub):
        s = sub.add_parser("live-frame", help="看画面 / Watch: push a screenshot you took in Chrome to the dashboard's viewer (the hook usually does this for you)")
        s.add_argument("agent")
        s.add_argument("image", help="path of the saved screenshot")
        s.set_defaults(fn=cmd_live_frame)

    S.LIVE_DIR, S.LIVE_W, S.LIVE_COPY_W = LIVE_DIR, LIVE_W, LIVE_COPY_W
    S.live_path, S.live_drop, S.live_write, S.cmd_live_frame = live_path, live_drop, live_write, cmd_live_frame
    R.on_set_agent(on_set_agent)
    R.cli(cli)
