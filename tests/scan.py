#!/usr/bin/env python3
"""Leak scan for tracked text files: home-folder paths, private IPs, token-looking strings, real-looking emails, and tracked
install avatars (anything under avatars/ outside avatars/seed/).

    python3 tests/scan.py            # tracked files (git ls-files)
    python3 tests/scan.py --staged   # only what is staged for the next commit

Exit 1 on any hit. Add a project-specific word list in tests/scan-words.txt (one word per line, git-ignored is fine)
to also catch names you never want in the repo.
"""
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATTERNS = [
    ("home path", re.compile(r"/(?:Users|home)/(?!<|\$|you\b|me\b|runner\b|name\b|user\b|USER\b)[A-Za-z0-9._-]+/")),
    ("private IP", re.compile(r"\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01])|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7]))\.\d{1,3}\.\d{1,3}\b")),
    ("tailnet name", re.compile(r"\b[a-z0-9-]+\.[a-z0-9-]+\.ts\.net\b")),
    ("token", re.compile(r"\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-ant-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9]{32,}|xox[bpa]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})")),
    ("email", re.compile(r"\b[A-Za-z0-9._%+-]+@(?!\dx\b)(?!example\.(?:com|org)\b|users\.noreply\.github\.com\b|anthropic\.com\b)[A-Za-z0-9.-]+\.[a-z]{2,}\b")),
]
TEXT = (".py", ".js", ".css", ".html", ".md", ".json", ".sh", ".txt", ".yml", ".yaml", ".webmanifest", ".toml", "")


def files(staged):
    cmd = ["git", "diff", "--cached", "--name-only", "--diff-filter=AM"] if staged else ["git", "ls-files"]
    out = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True).stdout.split("\n")
    return [f for f in out if f and os.path.splitext(f)[1] in TEXT and os.path.isfile(os.path.join(ROOT, f))]


def main():
    pats = list(PATTERNS)
    wl = os.path.join(ROOT, "tests", "scan-words.txt")
    if os.path.exists(wl):
        words = [w.strip() for w in open(wl, encoding="utf-8") if w.strip() and not w.startswith("#")]
        if words:
            # whole words only on the ASCII side: "5090" must not hit inside a sha256 in core.manifest.json
            pats.append(("listed word", re.compile("(?<![A-Za-z0-9])(?:" + "|".join(re.escape(w) for w in words) + ")(?![A-Za-z0-9])", re.I)))
    hits = 0
    # t-oss-generic S1: avatars/ is install data (git-ignored); only the shipped defaults in avatars/seed/ may be tracked.
    # A tracked avatars/ut/<id> is somebody's own picture leaking into the repo (food/buyer once did).
    cmd = ["git", "diff", "--cached", "--name-only", "--diff-filter=AM"] if "--staged" in sys.argv else ["git", "ls-files"]
    for f in subprocess.run(cmd + ["--", "avatars"], cwd=ROOT, capture_output=True, text=True).stdout.split("\n"):
        if f and not f.startswith("avatars/seed/"):
            hits += 1
            print(f"{f}: install avatar tracked (avatars/ is install data; defaults go in avatars/seed/)")
    for f in files("--staged" in sys.argv):
        if f in ("tests/scan.py", "tests/scan-words.txt"):
            continue
        try:
            lines = open(os.path.join(ROOT, f), encoding="utf-8").read().splitlines()
        except UnicodeDecodeError:
            continue
        for n, line in enumerate(lines, 1):
            for name, rx in pats:
                m = rx.search(line)
                if m:
                    hits += 1
                    print(f"{f}:{n}: {name}: {m.group(0)}")
    print("scan:", "clean" if not hits else f"{hits} hits")
    sys.exit(1 if hits else 0)


if __name__ == "__main__":
    main()
