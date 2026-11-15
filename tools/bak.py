#!/usr/bin/env python3
"""Back up a file git does not track before you change it, and put it back (t-oss-struct S1).

    python3 tools/bak.py save <tag> <file> [<file> ...]   copy each file to the backups folder under <tag>
    python3 tools/bak.py list [<file>]                    backups, newest first (also old <file>.bak-* copies)
    python3 tools/bak.py restore <tag> <file> [...]       put the backup back (the current file is saved first)
    python3 tools/bak.py where                            print the backups folder
    python3 tools/bak.py sweep [--apply] [--to DIR]       move old <file>.bak* copies out of the install
    python3 tools/bak.py unsweep DIR                      move a sweep back

Core files (tracked by git) do not need this: change them on a branch, git is the backup. This is for state.json,
config.json, roster.json, *-handoff.md, local/ and .claude/agents/. Copies go to local/backups/bak/<path>.bak-<tag>
(.backups/bak/ when there is no local/ folder), never next to the file. A tag that was already used for a file is
refused, nothing is overwritten: pick another tag. Tags: letters, digits, . _ -.

sweep without --apply only lists what it would move. The default destination is ~/UnderthreadBackups/bak-sweep-<date>,
outside the install; an index.tsv there lists every moved path, and `unsweep` puts them back exactly.
"""
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from core import backup as B  # noqa: E402


def human(n):
    for u in ("B", "KB", "MB", "GB"):
        if n < 1024 or u == "GB":
            return f"{n:.0f} {u}" if u == "B" else f"{n:.1f} {u}"
        n /= 1024


def main(argv):
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(__doc__)
        return 0 if argv else 2
    cmd, args = argv[0], argv[1:]
    if cmd == "where":
        print(B.root_dir())
        return 0
    if cmd == "save":
        if len(args) < 2:
            print("usage: tools/bak.py save <tag> <file> [<file> ...]")
            return 2
        tag, files = args[0], args[1:]
        try:
            B.check_tag(tag)
            used = [f for f in files if B.exists(f, tag)]
        except ValueError as e:
            print(f"refused: {e}")
            return 2
        if used:   # all or nothing: a half-done set of backups under one tag is what the old rule kept losing
            print(f"refused: tag {tag} is already used for {', '.join(used)}; nothing copied, pick another tag")
            return 1
        for f in files:
            try:
                b = B.save(f, tag)
            except FileExistsError as e:
                print(f"refused: {e} exists")
                return 1
            print(f"{f} -> {os.path.relpath(b, ROOT)}" if b else f"{f}: no such file, skipped")
        return 0
    if cmd == "list":
        rows = B.listing(path=args[0] if args else None)
        for r, tag, fp, size, mt in rows:
            print(f"{time.strftime('%Y-%m-%d %H:%M', time.localtime(mt))}  {tag:28} {r}  ({human(size)})")
        if not rows:
            print("no backups")
        return 0
    if cmd == "restore":
        if len(args) < 2:
            print("usage: tools/bak.py restore <tag> <file> [...]")
            return 2
        tag, rc = args[0], 0
        for f in args[1:]:
            try:
                b, keep = B.restore(f, tag)
                print(f"{f} <- {os.path.relpath(b, ROOT)}" + (f"  (the file before: {os.path.relpath(keep, ROOT)})" if keep else ""))
            except (FileNotFoundError, ValueError) as e:
                print(f"skipped: {e}")
                rc = 1
        return rc
    if cmd == "sweep":
        dest = None
        if "--to" in args:
            dest = os.path.abspath(os.path.expanduser(args[args.index("--to") + 1]))
        dest = dest or os.path.expanduser(f"~/UnderthreadBackups/bak-sweep-{time.strftime('%Y%m%d-%H%M%S')}")
        if os.path.realpath(dest).startswith(os.path.realpath(ROOT) + os.sep):
            print("refused: the destination must be outside the install folder")
            return 2
        apply = "--apply" in args
        try:
            sizes, total = B.sweep(dest, apply=apply)
        except FileExistsError as e:
            print(f"refused: {e} exists; nothing more moved")
            return 1
        tops = {}
        for r, s in sizes:
            k = r.split(os.sep)[0] if os.sep in r else "."
            n, t = tops.get(k, (0, 0))
            tops[k] = (n + 1, t + s)
        for k, (n, t) in sorted(tops.items(), key=lambda x: -x[1][1]):
            print(f"  {k + '/':24} {n:6} files  {human(t)}")
        print(("moved" if apply else "would move") + f" {len(sizes)} backups, {human(total)}" + (f" to {dest}" if apply else ""))
        if apply:
            print(f"undo: python3 tools/bak.py unsweep {dest}")
        elif sizes:
            print("run again with --apply to move them (add --to DIR for another place)")
        return 0
    if cmd == "unsweep":
        if not args:
            print("usage: tools/bak.py unsweep DIR")
            return 2
        back, skipped = B.unsweep(os.path.abspath(os.path.expanduser(args[0])))
        print(f"moved back {len(back)}" + (f"; skipped {len(skipped)} (already there or missing): {', '.join(skipped[:10])}" if skipped else ""))
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
