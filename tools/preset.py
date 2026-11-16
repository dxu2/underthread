#!/usr/bin/env python3
"""Switch the crew to a preset team.

    python3 tools/preset.py list
    python3 tools/preset.py apply content-zh       # the Chinese content-creator team (B站 / YouTube / 小红书)
    python3 tools/preset.py apply content-zh --dry # show what would change

A preset is a folder under presets/<name>/ with any of:
    roster.json            -> roster.json
    team.md, policy.md     -> local/team.md, local/policy.md (read over the core files; local wins)
    roles/<f>.md           -> local/roles/<f>.md when core ships roles/<f>.md (a "## Confirmed rules" list already there is
                              kept), else roles/<f>.md (install data, git-ignored, as core/install_seed.py fills it)
    config.json            -> merged into config.json (only the keys it lists; your port, owner and times stay)

Core files (git-tracked: manager.md, policy.md, team.md, roles/*.md) are never written, so an update never meets a local
change in them (t-oss-gen-s5). local/ is made if the install has none.

Every file that gets replaced is first backed up under the tag preset-<time> (core/backup.py: local/backups/bak/, or
.backups/bak/ without a local/ folder). Afterwards run `python3 make_agents.py` and restart the steward session.
Undo: the restore command apply prints (python3 tools/bak.py restore preset-<time> <files>), then make_agents.py.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
from core import backup as BK  # noqa: E402
from core.paths import LOCAL  # noqa: E402
PRESETS = os.path.join(ROOT, "presets")
RULES = "## Confirmed rules"


def names():
    return sorted(d for d in os.listdir(PRESETS) if os.path.isdir(os.path.join(PRESETS, d))) if os.path.isdir(PRESETS) else []


def plan(name):
    src = os.path.join(PRESETS, name)
    if not os.path.isdir(src):
        sys.exit(f"no preset {name!r}; have: {', '.join(names()) or 'none'}")
    out = []
    if os.path.exists(os.path.join(src, "roster.json")):
        out.append((os.path.join(src, "roster.json"), os.path.join(ROOT, "roster.json")))
    for f in ("team.md", "policy.md"):
        if os.path.exists(os.path.join(src, f)):
            out.append((os.path.join(src, f), os.path.join(LOCAL, f)))
    rd = os.path.join(src, "roles")
    if os.path.isdir(rd):
        for f in sorted(os.listdir(rd)):
            if f.endswith(".md"):
                core = is_core(f"roles/{f}")
                out.append((os.path.join(rd, f), os.path.join(LOCAL, "roles", f) if core else os.path.join(ROOT, "roles", f)))
    return src, out


def is_core(rel):
    """rel is a file core ships (git-tracked in a checkout; else listed in core.manifest.json, written at release, and present).
    Those are never written here."""
    try:
        r = subprocess.run(["git", "ls-files", "--error-unmatch", rel], cwd=ROOT, capture_output=True, timeout=20, stdin=subprocess.DEVNULL)
        if os.path.isdir(os.path.join(ROOT, ".git")) or os.path.isfile(os.path.join(ROOT, ".git")):
            return r.returncode == 0
    except (OSError, subprocess.SubprocessError):
        pass
    try:
        with open(os.path.join(ROOT, "core.manifest.json"), encoding="utf-8") as f:
            return rel in (json.load(f).get("files") or {}) and os.path.exists(os.path.join(ROOT, rel))   # listed and still there
    except (OSError, ValueError, AttributeError):
        return os.path.exists(os.path.join(ROOT, rel))


def kept_rules(old_text, new_text):
    """new_text with the "## Confirmed rules" list of old_text in place of its own, so a preset never drops rules the user
    adopted (they live in local/roles/<id>.md). Unchanged when old_text has no rules under that heading."""
    if RULES not in old_text:
        return new_text
    mine = old_text.split(RULES, 1)[1]
    if not any(ln.lstrip().startswith("- ") for ln in re.sub(r"<!--.*?-->", "", mine, flags=re.S).splitlines()):   # the template's example lines are a comment
        return new_text
    head = new_text.split(RULES, 1)[0] if RULES in new_text else new_text.rstrip() + "\n\n"
    return head + RULES + mine


def rel_out(p):
    """local/... for a file under the local layer (even when $UNDERTHREAD_LOCAL moves it), else relative to the install."""
    lr = os.path.relpath(p, LOCAL)
    return os.path.join("local", lr) if not lr.startswith("..") else os.path.relpath(p, ROOT)


def backup(path, tag):
    return BK.save(path, f"preset-{tag}", root=ROOT)


def apply(name, dry):
    src, files = plan(name)
    tag = time.strftime("%Y%m%d-%H%M%S")
    for a, b in files:
        rel = rel_out(b)
        if dry:
            print(f"would replace {rel}" if os.path.exists(b) else f"would add {rel}")
            continue
        bk = backup(b, tag)
        os.makedirs(os.path.dirname(b), exist_ok=True)
        if b.endswith(".md") and os.path.exists(b):
            with open(a, encoding="utf-8") as f:
                body = f.read()
            with open(b, encoding="utf-8") as f:
                body = kept_rules(f.read(), body)
            with open(b, "w", encoding="utf-8") as f:
                f.write(body)
        else:
            shutil.copy(a, b)
        print(f"{rel}" + (f"  (old copy: {os.path.relpath(bk, ROOT)})" if bk else "  (new)"))
    cj = os.path.join(src, "config.json")
    if os.path.exists(cj):
        with open(cj, encoding="utf-8") as f:
            add = {k: v for k, v in json.load(f).items() if not k.startswith("_")}
        live = os.path.join(ROOT, "config.json")
        if not os.path.exists(live) and os.path.exists(os.path.join(ROOT, "config.example.json")):
            shutil.copy(os.path.join(ROOT, "config.example.json"), live)
        try:
            with open(live, encoding="utf-8") as f:
                cfg = json.load(f)
        except (OSError, ValueError):
            cfg = {}
        if dry:
            print(f"would set config.json keys: {', '.join(add)}")
        else:
            backup(live, tag)
            cfg.update(add)
            with open(live, "w", encoding="utf-8") as f:
                json.dump(cfg, f, ensure_ascii=False, indent=2)
                f.write("\n")
            print(f"config.json: set {', '.join(add)}")
    if not dry:
        print("next: python3 make_agents.py, then restart the steward session")
        saved = [rel_out(b) for _, b in files if BK.find(b, f"preset-{tag}", root=ROOT)]
        if os.path.exists(cj) and BK.find(os.path.join(ROOT, "config.json"), f"preset-{tag}", root=ROOT):
            saved.append("config.json")
        if saved:
            print(f"undo: python3 tools/bak.py restore preset-{tag} {' '.join(saved)}")
        new = [rel_out(b) for _, b in files if rel_out(b) not in saved]
        if new:
            print(f"undo also: delete the new {' '.join(new)}")


def main():
    a = sys.argv[1:]
    if not a or a[0] in ("-h", "--help"):
        print(__doc__.strip())
        return
    if a[0] == "list":
        for n in names():
            print(n)
        return
    if a[0] == "apply" and len(a) >= 2:
        return apply(a[1], "--dry" in a)
    sys.exit("usage: python3 tools/preset.py list | apply <name> [--dry]")


if __name__ == "__main__":
    main()
