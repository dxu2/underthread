#!/usr/bin/env python3
"""Make one picture with whatever image backend this install has. Stdlib only.

    python3 tools/image.py backend [--json]          # which backend `gen` would use, and why
    python3 tools/image.py gen [-i REF.png]... "<prompt>" <out_dir> [timeout_s | --timeout S]

stdout of `gen`: the absolute path of the new PNG (one line). Everything else goes to stderr.

Backend = config.json → image.backend:
    auto   (default) codex if it is logged in with ChatGPT, else none
           (t-oss-no-comfy: the old "comfy" setting is read as auto; ComfyUI support was removed)
    codex  tools/gpt_image.sh: the codex in ChatGPT.app (or on PATH), on the ChatGPT subscription; never an API key
    none   no backend: exit 6. Callers fall back to template art (tools/new_role.py) or tools/work_strip.py --bob.

Exit codes: 0 ok · 2 usage · 3 codex not logged in with ChatGPT · 4 quota / rate limit · 5 no image produced
            6 no image backend configured · 124 timeout · other = the backend's own exit code
One picture per call, no retries: every call may cost subscription quota.
"""
import json
import os
import shutil
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GPT = os.path.join(ROOT, "tools", "gpt_image.sh")
CODEX_TRIED = ("/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex", "/Applications/ChatGPT.app/Contents/Resources/codex")
BACKENDS = ("auto", "codex", "none")
RETIRED = ("comfy",)   # t-oss-no-comfy: read as auto, so an older config.json keeps working


def config():
    if ROOT not in sys.path:
        sys.path.insert(0, ROOT)
    from core import config as C
    return C.load(ROOT)


def codex_bin():
    if os.environ.get("CODEX_BIN"):
        return os.environ["CODEX_BIN"]
    for c in CODEX_TRIED:
        if os.access(c, os.X_OK):
            return c
    return shutil.which("codex")


def codex_ready():
    """(ok, why). Logged in with ChatGPT = ok; an API-key login does not count (gpt_image.sh refuses it)."""
    if not os.access(GPT, os.X_OK):
        return False, "tools/gpt_image.sh missing"
    b = codex_bin()
    if not b:
        return False, "codex not found"
    try:
        r = subprocess.run([b, "login", "status"], capture_output=True, text=True, timeout=20, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.TimeoutExpired) as e:
        return False, f"codex login status failed ({e.__class__.__name__})"
    ok = "ChatGPT" in (r.stdout + r.stderr)
    return ok, "codex logged in with ChatGPT" if ok else "codex not logged in with ChatGPT"


def resolve(cfg=None):
    """{"backend": codex|none, "setting": auto|..., "why": "..."}. Never generates anything."""
    cfg = cfg if cfg is not None else config()
    want = str((cfg.get("image") or {}).get("backend") or "auto")
    note = ""
    if want in RETIRED:
        want, note = "auto", f"image.backend {want!r} is no longer supported, read as auto; "
    if want not in BACKENDS:
        return {"backend": "none", "setting": want, "why": f"unknown image.backend {want!r} (use {', '.join(BACKENDS)})"}
    if want == "none":
        return {"backend": "none", "setting": want, "why": "image.backend is none"}
    if want == "codex":
        ok, why = codex_ready()
        return {"backend": "codex" if ok else "none", "setting": want, "why": why}
    ok, why = codex_ready()
    return {"backend": "codex" if ok else "none", "setting": want, "why": note + why}


def gen_codex(refs, prompt, out, timeout):
    cmd = [GPT] + sum((["-i", r] for r in refs), []) + [prompt, out, str(timeout)]
    r = subprocess.run(cmd, stdout=subprocess.PIPE, text=True, stdin=subprocess.DEVNULL)
    if r.returncode:
        return r.returncode, None
    lines = r.stdout.strip().splitlines()
    return 0, lines[-1] if lines else None


def usage(code=2):
    print(__doc__, file=sys.stderr)
    sys.exit(code)


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        usage(0 if argv else 2)
    cmd, rest = argv[0], argv[1:]
    if cmd == "backend":
        r = resolve()
        print(json.dumps(r, ensure_ascii=False) if "--json" in rest else f"{r['backend']} ({r['why']})")
        return 0
    if cmd != "gen":
        usage()
    refs, pos, timeout = [], [], 240
    i = 0
    while i < len(rest):
        a = rest[i]
        if a in ("-i", "--image") and i + 1 < len(rest):
            refs.append(rest[i + 1]); i += 2; continue
        if a == "--timeout" and i + 1 < len(rest):
            timeout = int(rest[i + 1]); i += 2; continue
        pos.append(a); i += 1
    if len(pos) == 3 and pos[2].isdigit():   # same as gpt_image.sh: an optional trailing timeout in seconds
        timeout = int(pos.pop())
    if len(pos) != 2 or not pos[0]:
        usage()
    prompt, out = pos
    for r in refs:
        if not os.path.isfile(r):
            print(f"error: reference image not found: {r}", file=sys.stderr)
            return 2
    cfg = config()
    b = resolve(cfg)
    if b["backend"] == "none":
        print(f"error: no image backend ({b['why']}). Log codex in with ChatGPT; "
              "without it, use template art or tools/work_strip.py --bob.", file=sys.stderr)
        return 6
    os.makedirs(out, exist_ok=True)
    t0 = time.time()
    rc, path = gen_codex(refs, prompt, out, timeout)
    if rc:
        return rc
    if not path or not os.path.isfile(path):
        print("error: the backend finished but no image was produced", file=sys.stderr)
        return 5
    print(f"ok: {b['backend']}, {time.time() - t0:.0f}s", file=sys.stderr)
    print(os.path.abspath(path))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
