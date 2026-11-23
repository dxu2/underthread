#!/usr/bin/env python3
"""看画面 / Watch (built-in ext/live, t-oss-live): Claude Code hooks that feed the dashboard's viewer without the agent doing anything.

Wired in .claude/settings.json (shipped with the repository, so a fresh clone and an update both get it):
  PostToolUse  mcp__claude-in-chrome__.*  `live_hook.py post`   (async) -> pushes the LAST image of the result to .live/<agent>.jpg
  PostToolUse  mcp__claude-in-chrome__.*  `live_hook.py sync`   (sync)  -> sets the chrome tool flag if missing (.auto marker);
                                                                          step returned no image, a viewer is open (.watch < 6 s),
                                                                          last frame > 8 s old, last nudge > 15 s -> additionalContext
  Stop / SubagentStop                     `live_hook.py stop`           -> clears a flag this hook set, for that same session/subagent

Switched off (config.json extensions.live = false, Settings -> Connections): every mode returns at once and touches nothing.
Who: the subagent's agent_type is matched against roster agent_name; no agent_type (the main session) -> manager; anything else ->
the one agent holding tool=chrome. Screenshots stay in .live/ on this computer: never in state.json, never in a log, never uploaded.
Never raises: errors go to logs/live_hook.log (error text only, never image data). Exit code is always 0.
"""
import base64
import glob
import json
import os
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIVE = os.path.join(ROOT, ".live")
WATCH_S, STALE_S, NUDGE_S, MIN_GAP = 6, 8, 15, 0.5
NUDGE = ("The user is watching your browser on the dashboard (看画面 / Watch), and this step returned no screenshot. On the next step, "
         "take a computer screenshot (scale 0.5 is enough) or end the browser_batch with one, so the view keeps up. No need to run "
         "live-frame: the hook pushes it. / 用户正在看板上看「看画面」，这一步没有截图：下一步顺手截一张，钩子会自动推送。")


def on():
    """config.json extensions.live (default on); read without importing stateutil, so a switched-off hook costs one small file read."""
    sys.path.insert(0, ROOT)
    try:
        from core import config as C
        return C.load(ROOT).get("extensions", {}).get("live", True) is not False
    except Exception:  # noqa: BLE001
        return True


def log(msg):
    try:
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "live_hook.log"), "a") as f:
            f.write(time.strftime("%Y-%m-%dT%H:%M:%S ") + msg + "\n")
    except OSError:
        pass


def base(agent):
    import re
    return os.path.join(LIVE, re.sub(r"[^\w.-]", "_", str(agent)))


def mtime(p):
    try:
        return os.path.getmtime(p)
    except OSError:
        return 0


def owner(d):
    """the session or subagent that owns an .auto flag"""
    return d.get("agent_id") or ("s:" + str(d.get("session_id") or ""))


def who(d, agents):
    t = d.get("agent_type") or ""
    hit = [k for k, v in agents.items() if t and v.get("agent_name") == t]   # roster agent_name (make_agents.py writes it)
    if hit:
        return hit[0]
    if not t:
        return "manager" if "manager" in agents else None
    held = [k for k, v in agents.items() if v.get("tool") == "chrome"]
    return held[0] if len(held) == 1 else None


def images(resp):
    """-> list of (media_type, b64) in order. Walks nested lists/dicts so browser_batch shapes are covered too."""
    out = []

    def walk(x):
        if isinstance(x, dict):
            src = x.get("source") if x.get("type") == "image" else None
            if isinstance(src, dict) and src.get("data"):
                out.append((src.get("media_type") or "", src["data"]))
                return
            if x.get("type") == "image" and x.get("data"):
                out.append((x.get("mimeType") or "", x["data"]))
                return
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
    walk(resp)
    return out


def sutil():
    sys.path.insert(0, ROOT)
    import stateutil as S
    return S


def post(d):
    """async: push the last image of this result. The flag is the sync hook's job (so Stop can never race ahead of it)."""
    imgs = images(d.get("tool_response"))
    if not imgs:
        return
    S = sutil()
    a = who(d, S.read().get("agents") or {})
    if not a:
        return log("post: no agent for %s/%s" % (d.get("agent_type"), d.get("tool_name")))
    if time.time() - mtime(base(a) + ".jpg") < MIN_GAP:
        return
    mt, b64 = imgs[-1]
    os.makedirs(LIVE, exist_ok=True)
    fd, tmp = tempfile.mkstemp(suffix=".png" if "png" in mt else ".jpg", dir=LIVE)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(base64.b64decode(b64))
        S.live_write(a, tmp)
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def flag(d, S, agents):
    """sync: the agent forgot `set-agent --tool chrome` -> set it and leave an .auto marker naming this session/subagent"""
    a = who(d, agents)
    if not a or (agents.get(a) or {}).get("tool"):
        return a
    with S.mutate() as st:
        S.set_agent(st, a, auto=True, tool="chrome")
    os.makedirs(LIVE, exist_ok=True)
    with open(base(a) + ".auto", "w") as f:
        f.write(owner(d))
    log("sync: auto tool=chrome for %s (%s)" % (a, owner(d)))
    return a


def sync(d):
    S = sutil()
    a = flag(d, S, S.read().get("agents") or {})
    if not a or images(d.get("tool_response")):
        return
    b, t = base(a), time.time()
    if t - mtime(b + ".watch") >= WATCH_S or t - mtime(b + ".jpg") < STALE_S or t - mtime(b + ".nudge") < NUDGE_S:
        return
    os.makedirs(LIVE, exist_ok=True)
    with open(b + ".nudge", "w"):
        pass
    os.utime(b + ".nudge", None)
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": NUDGE}}, ensure_ascii=False))


def stop(d):
    autos = glob.glob(os.path.join(LIVE, "*.auto"))
    if not autos:
        return
    me = owner(d)
    for p in autos:
        try:
            if open(p).read().strip() != me:
                continue
        except OSError:
            continue
        a = os.path.basename(p)[:-5]
        S = sutil()
        with S.mutate() as st:
            if a in st.get("agents", {}):
                S.set_agent(st, a, tool="")
        S.live_drop(a)
        log("stop: cleared auto tool for %s (%s)" % (a, me))


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        d = json.load(sys.stdin)
        if mode != "stop" and not on():
            return sys.exit(0)
        {"post": post, "sync": sync, "stop": stop}[mode](d)
    except Exception as e:  # noqa: BLE001  never block the agent
        log("%s: %s: %s" % (mode, type(e).__name__, str(e)[:200]))
    sys.exit(0)


if __name__ == "__main__":
    main()
