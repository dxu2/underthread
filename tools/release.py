#!/usr/bin/env python3
"""Cut a release: check everything, then write VERSION and core.manifest.json, commit and make an annotated tag.

    python3 tools/release.py 0.2.0             # check, commit "Release v0.2.0", tag v0.2.0
    python3 tools/release.py 0.2.0 --dry-run   # run every check, write nothing

It refuses (exit 1, nothing written) unless all of these hold, cheapest first:
  1. X.Y.Z is a version, higher than the last vX.Y.Z tag, and that tag does not exist yet; HEAD is on a branch
  2. the working tree is clean (no changes, nothing untracked that git does not ignore)
  3. core/migrations/NNNN_<name>.py run 0001, 0002, ... with no gap, no duplicate, no misnamed file,
     and each one loads with up() and TARGETS (core.migrate.discover)
  4. CHANGELOG.md has "## [X.Y.Z] - YYYY-MM-DD" with Added / Changed / Fixed / Upgrade notes, none empty, and the
     upgrade notes have the four lines (format at the top of CHANGELOG.md):
       Migrations: every step added since the last tag, by number (or "none")
       New config keys: every key added to core/config.py DEFAULTS / ROLE_DEFAULTS since the last tag, in backticks (or "none")
       Extension API: says something; and against the previous tag's core/registry.py (API number, SURFACE tuple):
         a changed API number needs a major version; a name dropped from SURFACE needs a new API number; a name added to
         SURFACE is named on the line (e.g. `R.job`); any registry change means the line cannot say "unchanged"
       Manual steps: none   (only a major version may say anything else)
  5. python3 tests/run.py all passes (the browser tests need Node; this is the slow part)
Then: VERSION = X.Y.Z, core.manifest.json regenerated with version vX.Y.Z, one commit, annotated tag vX.Y.Z whose message
is the changelog section. It never pushes: push the branch and the tag yourself.
"""
import ast
import datetime as dt
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = sys.executable
SEMVER = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
MIG_FILE = re.compile(r"^(\d{4})_([a-z0-9_]+)\.py$")
PARTS = ("Added", "Changed", "Fixed", "Upgrade notes")


class Refuse(Exception):
    pass


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def git(*args, check=True):
    r = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)
    if check and r.returncode:
        raise Refuse(f"git {' '.join(args)} failed: {r.stderr.strip()}")
    return r.stdout


def vtuple(v):
    return tuple(int(x) for x in v.split("."))


def last_tag():
    """Highest vX.Y.Z tag, or None before the first release."""
    tags = [t[1:] for t in git("tag", "--list", "v*").split() if SEMVER.match(t[1:])]
    return max(tags, key=vtuple) if tags else None


# ---- 1 + 2: version and tree ----

def check_version(ver, prev):
    if not SEMVER.match(ver):
        raise Refuse(f"'{ver}' is not a version: use X.Y.Z, e.g. 0.2.0 (no leading v)")
    if git("tag", "--list", f"v{ver}").strip():
        raise Refuse(f"tag v{ver} already exists")
    if prev and vtuple(ver) <= vtuple(prev):
        raise Refuse(f"{ver} is not higher than the last release v{prev}")
    if git("symbolic-ref", "-q", "HEAD", check=False).strip() == "":
        raise Refuse("HEAD is detached: check out the branch you release from")


def check_clean():
    dirty = git("status", "--porcelain")
    if dirty.strip():
        lines = dirty.rstrip("\n").split("\n")
        raise Refuse("the working tree is not clean; commit or stash first:\n  " + "\n  ".join(lines[:15])
                     + (f"\n  ... and {len(lines) - 15} more" if len(lines) > 15 else ""))


# ---- 3: migrations ----

def migration_numbers(names):
    nums, bad = [], []
    for f in names:
        if not f.endswith(".py") or f == "__init__.py":
            continue
        m = MIG_FILE.match(f)
        (nums.append(int(m.group(1))) if m else bad.append(f))
    return sorted(nums), bad


def check_migrations():
    d = os.path.join(ROOT, "core", "migrations")
    nums, bad = migration_numbers(os.listdir(d) if os.path.isdir(d) else [])
    if bad:
        raise Refuse(f"core/migrations: {', '.join(bad)} not named NNNN_<lowercase_name>.py")
    want = list(range(1, len(nums) + 1))
    if nums != want:
        gaps = sorted(set(want) - set(nums))
        dups = sorted({n for n in nums if nums.count(n) > 1})
        raise Refuse("core/migrations must be numbered 0001.. with no gaps or duplicates: have "
                     + ", ".join(f"{n:04d}" for n in nums)
                     + (f"; missing {', '.join(f'{n:04d}' for n in gaps)}" if gaps else "")
                     + (f"; duplicate {', '.join(f'{n:04d}' for n in dups)}" if dups else ""))
    r = subprocess.run([PY, "-c", "import core.migrate as m; print(m.LATEST)"], cwd=ROOT, capture_output=True, text=True)
    if r.returncode:
        raise Refuse("core.migrate does not load the steps:\n  " + (r.stderr.strip().splitlines() or ["?"])[-1])
    return nums


def migrations_at(tag):
    if not tag:
        return []
    out = git("ls-tree", "--name-only", f"v{tag}", "core/migrations/", check=False)
    return migration_numbers([os.path.basename(p) for p in out.split()])[0]


# ---- 4: changelog ----

def leaf_keys(d, prefix=""):
    out = set()
    for k, v in d.items():
        if isinstance(v, dict) and v:
            out |= leaf_keys(v, f"{prefix}{k}.")
        else:
            out.add(prefix + k)
    return out


def config_keys(src):
    """Leaf keys of DEFAULTS, plus ROLE_DEFAULTS as role.<key>, read with ast (the file is not imported)."""
    keys = set()
    if not src:
        return keys
    for node in ast.parse(src).body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            name = node.targets[0].id
            if name in ("DEFAULTS", "ROLE_DEFAULTS"):
                val = ast.literal_eval(node.value)
                keys |= leaf_keys(val, "role." if name == "ROLE_DEFAULTS" else "")
    return keys


def registry_api(src):
    """(API, SURFACE) from core/registry.py source, read with ast; None when there is no registry (before 0.2)."""
    if not src:
        return None
    api, surface = None, ()
    for node in ast.parse(src).body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            if node.targets[0].id == "API":
                api = ast.literal_eval(node.value)
            elif node.targets[0].id == "SURFACE":
                surface = tuple(ast.literal_eval(node.value))
    return (api, surface) if api is not None else None


def ext_api_problems(line, ver, prev, now_src, old_src):
    """S8 (t-oss-struct): the "Extension API:" upgrade note against the registry's API number and public surface."""
    now, old = registry_api(now_src), registry_api(old_src)
    if now is None:
        return []
    unchanged = line.lower().rstrip(".").startswith("unchanged")
    major = prev is None or vtuple(ver)[0] > vtuple(prev)[0]
    if old is None:
        return ["Upgrade notes: Extension API says 'unchanged' but the extension registry (core/registry.py) is new since "
                + (f"v{prev}" if prev else "the start")] if unchanged and prev else []
    out = []
    (api, surf), (api0, surf0) = now, old
    if api != api0 and not major:
        out.append(f"Extension API: core/registry.py API went {api0} -> {api}; only a major version may change it")
    gone = [n for n in surf0 if n not in surf]
    if gone and api == api0:
        out.append("Extension API: SURFACE dropped " + ", ".join(gone) + f" without a new API number (still {api})")
    added = [n for n in surf if n not in surf0]
    missing = [n for n in added if n not in line]
    if missing:
        out.append("Upgrade notes: Extension API does not name the new registry call(s) " + ", ".join(f"`R.{n}`" for n in missing))
    if unchanged and (api != api0 or gone or added):
        out.append("Upgrade notes: Extension API says 'unchanged' but core/registry.py changed since v" + str(prev))
    return out


def changelog_section(ver):
    path = os.path.join(ROOT, "CHANGELOG.md")
    if not os.path.isfile(path):
        raise Refuse("CHANGELOG.md is missing")
    text = read(path)
    m = re.search(rf"^## \[{re.escape(ver)}\] - (\d{{4}}-\d{{2}}-\d{{2}})[ \t]*$", text, re.M)
    if not m:
        raise Refuse(f"CHANGELOG.md has no '## [{ver}] - YYYY-MM-DD' heading (rename '## Unreleased' and add the date)")
    end = re.search(r"^## ", text[m.end():], re.M)
    return m.group(1), text[m.end(): m.end() + end.start() if end else len(text)].strip("\n")


def check_changelog(ver, prev, nums):
    date, body = changelog_section(ver)
    try:
        dt.date.fromisoformat(date)
    except ValueError:
        raise Refuse(f"CHANGELOG.md [{ver}]: '{date}' is not a date")
    parts, cur = {}, None
    for line in body.split("\n"):
        h = re.match(r"^### (.+?)\s*$", line)
        if h:
            cur = h.group(1)
            parts.setdefault(cur, [])
        elif cur:
            parts[cur].append(line)
    problems = []
    for p in PARTS:
        if p not in parts:
            problems.append(f"no '### {p}'")
        elif not "\n".join(parts[p]).strip():
            problems.append(f"'### {p}' is empty (write 'Nothing.' if so)")
    extra = [p for p in parts if p not in PARTS]
    if extra:
        problems.append("unknown parts: " + ", ".join(extra) + f" (use {', '.join(PARTS)})")
    if "Upgrade notes" in parts:
        notes = {}
        for line in parts["Upgrade notes"]:
            n = re.match(r"^\s*-\s*([A-Za-z ]+?):\s*(.*)$", line)
            if n:
                notes[n.group(1).strip().lower()] = n.group(2).strip()
        for key in ("migrations", "new config keys", "extension api", "manual steps"):
            if not notes.get(key):
                problems.append(f"Upgrade notes: no '- {key[0].upper() + key[1:]}: ...' line")
        if notes.get("migrations"):
            new = [n for n in nums if n not in migrations_at(prev)]
            listed = {int(x) for x in re.findall(r"(?<![\d-])(\d{4})(?![\d-])", notes["migrations"])}   # not a date
            if new and sorted(listed) != new:
                problems.append("Upgrade notes: Migrations lists " + (", ".join(f"{n:04d}" for n in sorted(listed)) or "none")
                                + "; new since " + (f"v{prev}" if prev else "the start") + ": " + ", ".join(f"{n:04d}" for n in new))
            if not new and listed:
                problems.append("Upgrade notes: Migrations lists steps but none is new since v" + str(prev))
            if not new and not listed and notes["migrations"].lower().rstrip(".") != "none":
                problems.append("Upgrade notes: Migrations should say 'none' (no new step)")
        if notes.get("new config keys"):
            cfg = os.path.join(ROOT, "core", "config.py")
            now = config_keys(read(cfg) if os.path.isfile(cfg) else "")
            old = config_keys(git("show", f"v{prev}:core/config.py", check=False) if prev else "")
            new = sorted(now - old)
            named = set(re.findall(r"`([^`]+)`", notes["new config keys"]))
            missing = [k for k in new if k not in named]
            if missing:
                problems.append("Upgrade notes: New config keys does not name " + ", ".join(f"`{k}`" for k in missing))
            if not new and notes["new config keys"].lower().rstrip(".") != "none":
                problems.append("Upgrade notes: New config keys should say 'none' (no key added to core/config.py)")
        if notes.get("extension api"):
            reg = os.path.join(ROOT, "core", "registry.py")
            problems += ext_api_problems(notes["extension api"], ver, prev, read(reg) if os.path.isfile(reg) else "",
                                         git("show", f"v{prev}:core/registry.py", check=False) if prev else "")
        manual = notes.get("manual steps", "")
        major = prev is None or vtuple(ver)[0] > vtuple(prev)[0]
        if manual and manual.lower().rstrip(".") != "none" and not (major and prev is not None):
            problems.append(f"Upgrade notes: 'Manual steps: {manual}' -- only a major version may need a manual step; "
                            "make the change upgrade itself (a migration or a default) or wait for the next major version")
    if problems:
        raise Refuse(f"CHANGELOG.md [{ver}] is not complete:\n  " + "\n  ".join(problems))
    return date, body


# ---- 5: tests ----

def check_tests():
    print("running python3 tests/run.py all (takes a few minutes) ...", flush=True)
    r = subprocess.run([PY, os.path.join("tests", "run.py"), "all"], cwd=ROOT, capture_output=True, text=True)
    log = os.path.join(ROOT, "tests", "e2e", "out", "release-tests.log")
    os.makedirs(os.path.dirname(log), exist_ok=True)   # tests/e2e/out is git-ignored
    with open(log, "w", encoding="utf-8") as f:
        f.write(r.stdout + r.stderr)
    tail = r.stdout[r.stdout.rfind("== summary =="):] if "== summary ==" in r.stdout else r.stdout[-1500:]
    print(tail.rstrip())
    if r.returncode:
        raise Refuse(f"tests/run.py all failed (full output: {os.path.relpath(log, ROOT)})")
    if git("status", "--porcelain").strip():   # a test that leaves files behind would end up in the release commit
        raise Refuse("the tests left the working tree dirty:\n  " + git("status", "--porcelain").strip().replace("\n", "\n  "))


# ---- write ----

def cut(ver, body):
    with open(os.path.join(ROOT, "VERSION"), "w", encoding="utf-8") as f:
        f.write(ver + "\n")
    git("add", "VERSION")   # tracked before the manifest is written, so the manifest lists it
    r = subprocess.run([PY, os.path.join("tools", "manifest.py"), "--version", f"v{ver}"], cwd=ROOT, capture_output=True, text=True)
    if r.returncode:
        raise Refuse("tools/manifest.py failed: " + r.stderr.strip())
    print(r.stdout.strip())
    git("add", "core.manifest.json")
    git("commit", "-q", "-m", f"Release v{ver}", "-m", "VERSION and core.manifest.json written by tools/release.py.")
    r = subprocess.run([PY, os.path.join("tools", "manifest.py"), "--check"], cwd=ROOT, capture_output=True, text=True)
    if r.returncode or git("status", "--porcelain").strip():
        raise Refuse("after the commit the manifest does not match the files (commit kept, no tag):\n" + r.stdout)
    git("tag", "-a", "--cleanup=verbatim", f"v{ver}", "-m", f"Underthread v{ver}\n\n{body}\n")   # verbatim: keep the ### lines
    return git("rev-parse", "--short", "HEAD").strip()


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry = "--dry-run" in sys.argv[1:]
    if len(args) != 1 or "-h" in sys.argv or "--help" in sys.argv:
        print(__doc__)
        return 2
    ver = args[0]
    try:
        prev = last_tag()
        check_version(ver, prev)
        print(f"ok  version {ver} (last release: {'v' + prev if prev else 'none'})")
        check_clean()
        print("ok  working tree clean")
        nums = check_migrations()
        print(f"ok  migrations 0001..{len(nums):04d}, no gaps")
        date, body = check_changelog(ver, prev, nums)
        print(f"ok  CHANGELOG [{ver}] - {date}: Added / Changed / Fixed / Upgrade notes")
        check_tests()
        print("ok  tests/run.py all")
        if dry:
            print(f"dry run: every check passed; nothing written. Run without --dry-run to tag v{ver}.")
            return 0
        sha = cut(ver, body)
        print(f"released v{ver} at {sha}. Not pushed; when you are ready: git push origin HEAD v{ver}")
        return 0
    except Refuse as e:
        print(f"REFUSED: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
