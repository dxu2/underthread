#!/usr/bin/env python3
"""Write core.manifest.json: every git-tracked (core) file with its sha256, for installs that are not a git checkout.

    python3 tools/manifest.py           # write core.manifest.json
    python3 tools/manifest.py --check   # list core files that differ from the manifest or are missing from it (exit 1 if any)
    python3 tools/manifest.py --version v0.1.0   # stamp this version instead of `git describe` (tools/release.py does)
"""
import hashlib
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "core.manifest.json")


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 16), b""):
            h.update(b)
    return h.hexdigest()


def main():
    if "--check" in sys.argv[1:]:
        man = json.load(open(OUT, encoding="utf-8"))
        bad = [f for f, h in man["files"].items() if not os.path.isfile(os.path.join(ROOT, f)) or sha(os.path.join(ROOT, f)) != h]
        r = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True)
        if r.returncode == 0:   # in a git checkout, a tracked file the manifest does not list is a mismatch too
            bad += [f"{f} (not in the manifest)" for f in r.stdout.split("\n")
                    if f and f != "core.manifest.json" and f not in man["files"] and os.path.isfile(os.path.join(ROOT, f))]
        print("\n".join(bad) or "core files match the manifest")
        return 1 if bad else 0
    files = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split("\n")
    files = sorted(f for f in files if f and f != "core.manifest.json" and os.path.isfile(os.path.join(ROOT, f)))
    a = sys.argv[1:]
    ver = a[a.index("--version") + 1] if "--version" in a[:-1] else \
        subprocess.run(["git", "describe", "--tags", "--always"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"version": ver, "files": {p: sha(os.path.join(ROOT, p)) for p in files}}, f, indent=0, sort_keys=True)
        f.write("\n")
    print(f"core.manifest.json: {len(files)} files, version {ver}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
