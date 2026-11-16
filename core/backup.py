"""Backups of files git does not track (t-oss-struct S1, plan section F).

Core files (everything git tracks) are backed up by git: change them on a branch, and the commit before is the way back.
Everything else (state.json, config.json, roster.json, manager-handoff.md, files under local/, .claude/agents/) is copied
here before a change, so the install folder no longer fills up with `<file>.bak-<tag>` copies:

    <backups>/bak/<path relative to the install>.bak-<tag>

<backups> is local/backups when the install has a local/ layer, else .backups (git-ignored); a folder that already
holds backups keeps being used (core/paths.backups_dir, shared with core/migrate.py). An update never touches either. A tag is used once per file: save() refuses to overwrite an existing
backup (the check and the copy are one step). find() also looks at the old place, `<file>.bak-<tag>` next to the file,
so backups made before this version still restore.

The command line is tools/bak.py.
"""
import os
import re
import shutil
import time

from . import paths as P

BAK_RE = re.compile(r"\.bak(?:$|[-_.0-9])")   # what .gitignore's *.bak* catches, minus words like ".bakery"


def root_dir(root=None):
    """<backups>: core/paths.backups_dir (local/backups, or .backups on an install that has no local/ layer, or had none when
    it made its first backup). Never creates local/."""
    return P.backups_dir(root)


def rel(path, root=None):
    root = os.path.realpath(root or P.ROOT)
    ap = os.path.realpath(os.path.abspath(path))
    r = os.path.relpath(ap, root)
    if r.startswith(".."):
        # a local/ layer moved elsewhere with $UNDERTHREAD_LOCAL is still "local/..." in the backup tree
        lr = os.path.relpath(ap, os.path.realpath(P.LOCAL))
        if not lr.startswith(".."):
            return os.path.join("local", lr)
        raise ValueError(f"{path} is outside the install folder")
    return r


def check_tag(tag):
    if not tag or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,80}", tag):
        raise ValueError(f"bad tag {tag!r}: letters, digits, . _ - only")
    return tag


def where(path, tag, root=None):
    """Where save(path, tag) puts the copy."""
    return os.path.join(root_dir(root), "bak", rel(path, root) + ".bak-" + check_tag(tag))


def legacy(path, tag):
    return f"{os.path.abspath(path)}.bak-{tag}"


def exists(path, tag, root=None):
    return os.path.exists(where(path, tag, root)) or os.path.exists(legacy(path, tag))


def save(path, tag, root=None, dry=False):
    """Copy path to its backup. Returns the backup path, or None when path does not exist. Raises FileExistsError when
    this tag was already used for this file (in either place); nothing is overwritten."""
    if not os.path.exists(path):
        return None
    dst = where(path, tag, root)
    if os.path.exists(legacy(path, tag)):
        raise FileExistsError(legacy(path, tag))
    if dry:
        if os.path.exists(dst):
            raise FileExistsError(dst)
        return dst
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    fd = os.open(dst, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)   # exclusive create: the check and the copy are one step
    out = os.fdopen(fd, "wb")
    with out, open(path, "rb") as src:
        shutil.copyfileobj(src, out)
    shutil.copystat(path, dst)
    return dst


def find(path, tag, root=None):
    """The backup of path under tag: the backups folder first, then the old place next to the file. None if neither."""
    for b in (where(path, tag, root), legacy(path, tag)):
        if os.path.exists(b):
            return b
    return None


def restore(path, tag, root=None):
    """Put a backup back. The current file is saved first under restore-<time>, so a restore can be undone too."""
    b = find(path, tag, root)
    if not b:
        raise FileNotFoundError(f"no backup of {rel(path, root)} tagged {tag}")
    keep = None
    if os.path.exists(path):
        keep = save(path, "restore-" + time.strftime("%Y%m%d-%H%M%S"), root)
    shutil.copy2(b, path)
    return b, keep


def listing(root=None, path=None):
    """[(relative file, tag, backup path, size, mtime)] newest first, both places. path narrows it to one file."""
    root = root or P.ROOT
    out = []
    base = os.path.join(root_dir(root), "bak")
    want = rel(path, root) if path else None
    for d, _, fs in os.walk(base):
        for f in fs:
            m = re.match(r"(.+)\.bak-(.+)$", f)
            if not m:
                continue
            r = os.path.relpath(os.path.join(d, m.group(1)), base)
            if want and r != want:
                continue
            fp = os.path.join(d, f)
            st = os.stat(fp)
            out.append((r, m.group(2), fp, st.st_size, st.st_mtime))
    if want:
        d0, n0 = os.path.split(os.path.join(root, want))
        try:
            for f in os.listdir(d0):
                if f.startswith(n0 + ".bak-"):
                    fp = os.path.join(d0, f)
                    st = os.stat(fp)
                    out.append((want, f[len(n0) + 5:], fp, st.st_size, st.st_mtime))
        except OSError:
            pass
    return sorted(out, key=lambda x: -x[4])


# ===== sweep: move the old scattered <file>.bak* copies out of the install (plan F1). Moves only, never deletes. =====

SKIP_DIRS = {".git", "node_modules", "__pycache__", "work", "uploads", "logs", "archive", ".demo", ".backups",
             ".split-backup", ".venv"}
SKIP_PATHS = {os.path.join("tools", "models"), os.path.join("tools", "voice"), os.path.join("local", "backups"),
              os.path.join("tests", "e2e", "out")}


def scattered(root=None):
    """Every *.bak* file or folder in the install outside the runtime / data folders, as paths relative to root."""
    root = root or P.ROOT
    out = []
    for d, dirs, fs in os.walk(root):
        rd = os.path.relpath(d, root)
        keep = []
        for n in sorted(dirs):
            r = os.path.normpath(os.path.join(rd, n))
            if n in SKIP_DIRS or r in SKIP_PATHS or n.startswith(".venv"):
                continue
            if BAK_RE.search(n):
                out.append(r)   # a backed-up folder moves as one piece
                continue
            keep.append(n)
        dirs[:] = keep
        out += [os.path.normpath(os.path.join(rd, f)) for f in sorted(fs) if BAK_RE.search(f)]
    return out


def size_of(p):
    if os.path.isdir(p) and not os.path.islink(p):
        return sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(p) for f in fs
                   if not os.path.islink(os.path.join(d, f)))
    return os.lstat(p).st_size


def sweep(dest, root=None, apply=False):
    """Move every scattered backup to dest/<same relative path>, and write dest/index.tsv (path, bytes). Returns the
    list and the total size. Refuses a dest that already has an index (one sweep per folder, so unsweep stays exact)."""
    root = root or P.ROOT
    items = scattered(root)
    sizes = [(r, size_of(os.path.join(root, r))) for r in items]
    total = sum(s for _, s in sizes)
    if not apply:
        return sizes, total
    idx = os.path.join(dest, "index.tsv")
    if os.path.exists(idx):
        raise FileExistsError(idx)
    os.makedirs(dest, exist_ok=True)
    with open(idx, "w", encoding="utf-8") as f:
        f.write(f"# swept from {root} at {time.strftime('%Y-%m-%d %H:%M:%S')}; put back with: tools/bak.py unsweep {dest}\n")
        for r, s in sizes:
            dst = os.path.join(dest, r)
            if os.path.lexists(dst):
                raise FileExistsError(dst)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.move(os.path.join(root, r), dst)
            f.write(f"{r}\t{s}\n")
            f.flush()
    return sizes, total


def unsweep(dest, root=None):
    """Move everything a sweep put in dest back where it was. Skips (and reports) a path that exists again."""
    root = root or P.ROOT
    back, skipped = [], []
    with open(os.path.join(dest, "index.tsv"), encoding="utf-8") as f:
        rows = [ln.rstrip("\n").split("\t")[0] for ln in f if ln.strip() and not ln.startswith("#")]
    for r in rows:
        src, dst = os.path.join(dest, r), os.path.join(root, r)
        if os.path.lexists(dst) or not os.path.lexists(src):
            skipped.append(r)
            continue
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.move(src, dst)
        back.append(r)
    return back, skipped
