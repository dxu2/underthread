#!/usr/bin/env python3
"""Switch the crew to a preset team.

    python3 tools/preset.py list
    python3 tools/preset.py apply content-zh       # the Chinese content-creator team (B站 / YouTube / 小红书)
    python3 tools/preset.py apply content-zh --dry # show what would change

A preset is a folder under presets/<name>/ with any of:
    roster.json            -> roster.json
    team.md, policy.md     -> same names in the project root
    roles/*.md             -> roles/
    config.json            -> merged into config.json (only the keys it lists; your port, owner and times stay)

Every file that gets replaced is first backed up under the tag preset-<time> (core/backup.py: local/backups/bak/, or
.backups/bak/ without a local/ folder). Afterwards run `python3 make_agents.py` and restart the steward session.
Undo: the restore command apply prints (python3 tools/bak.py restore preset-<time> <files>), then make_agents.py.
"""
import json
import os
import shutil
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
from core import backup as BK  # noqa: E402
PRESETS = os.path.join(ROOT, "presets")


def names():
    return sorted(d for d in os.listdir(PRESETS) if os.path.isdir(os.path.join(PRESETS, d))) if os.path.isdir(PRESETS) else []


def plan(name):
    src = os.path.join(PRESETS, name)
    if not os.path.isdir(src):
        sys.exit(f"no preset {name!r}; have: {', '.join(names()) or 'none'}")
    out = []
    for f in ("roster.json", "team.md", "policy.md"):
        if os.path.exists(os.path.join(src, f)):
            out.append((os.path.join(src, f), os.path.join(ROOT, f)))
    rd = os.path.join(src, "roles")
    if os.path.isdir(rd):
        for f in sorted(os.listdir(rd)):
            if f.endswith(".md"):
                out.append((os.path.join(rd, f), os.path.join(ROOT, "roles", f)))
    return src, out


def backup(path, tag):
    return BK.save(path, f"preset-{tag}", root=ROOT)


def apply(name, dry):
    src, files = plan(name)
    tag = time.strftime("%Y%m%d-%H%M%S")
    for a, b in files:
        rel = os.path.relpath(b, ROOT)
        if dry:
            print(f"would replace {rel}" if os.path.exists(b) else f"would add {rel}")
            continue
        bk = backup(b, tag)
        os.makedirs(os.path.dirname(b), exist_ok=True)
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
        saved = [os.path.relpath(b, ROOT) for _, b in files if BK.find(b, f"preset-{tag}", root=ROOT)]
        if os.path.exists(cj) and BK.find(os.path.join(ROOT, "config.json"), f"preset-{tag}", root=ROOT):
            saved.append("config.json")
        if saved:
            print(f"undo: python3 tools/bak.py restore preset-{tag} {' '.join(saved)}")


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
