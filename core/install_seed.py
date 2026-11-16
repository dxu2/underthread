"""Install data that core ships defaults for: Underthread avatars (t-oss-generic S1) and preset role notes (S2). Stdlib only.

run(root) = role_notes(root) + seed(root). Called by server.py at start and by tools/update.py after an update, before
make_agents.py. Neither step overwrites or deletes anything.

Role notes: the classic Quill / Lens / Signal notes left core (roles/{writer,director,ops}.md -> presets/classic/roles/). A
roster role whose notebook roles/<f>.md is missing gets the first preset copy back at roles/<f>.md (where tools/preset.py
puts preset notes too; git-ignored), so an older crew keeps reading exactly what it read before.

Avatars:

avatars/ut/ is install data (git-ignored, like roster.json): every install keeps its own patches there, hired roles included.
The defaults ship in git in seed folders:

    avatars/seed/ut/<id>.png + _s/<id>-{160,512,work-160,work-320,work-512}.webp     the default crew
    presets/<name>/avatars/ut/...                                                    roles of an optional preset (same layout)

seed(root) gives every roster role that has NO avatars/ut/<id>.* file the first seed picture found for its id (avatars/seed
first, then presets in name order), with its small copies and work strip. It never overwrites or deletes anything, so a
picked or hand-made avatar always wins. Copied pictures keep the seed file's mtime and get their avatars/ut/_s/index.json
entry here, so no cwebp is needed. If a picture that was already there has no index entry (a git pull that untracked
avatars/ut removes index.json), tools/avatar_sizes.py runs once to rebuild it.

    python3 core/install_seed.py [--dry]
"""
import json
import os
import shutil
import subprocess
import sys
import threading

EXTS = (".png", ".jpg", ".jpeg", ".webp")
SMALL = ("160", "512")
WORK = ("work-160", "work-320", "work-512")


def preset_dirs(root, *sub):
    pre = os.path.join(root, "presets")
    names = sorted(os.listdir(pre)) if os.path.isdir(pre) else []
    return [d for d in (os.path.join(pre, p, *sub) for p in names) if os.path.isdir(d)]


def sources(root):
    return [d for d in [os.path.join(root, "avatars", "seed", "ut")] if os.path.isdir(d)] + preset_dirs(root, "avatars", "ut")


def roster_roles(root):
    """Roles of roster.json (roster.example.json before the first start). Read raw: no migration is run from here."""
    for name in ("roster.json", "roster.example.json"):
        try:
            with open(os.path.join(root, name), encoding="utf-8") as f:
                roles = json.load(f).get("roles") or []
            return [r for r in roles if isinstance(r, dict) and r.get("id") and r.get("id") != "me"]
        except (OSError, ValueError, AttributeError):
            continue
    return []


def roster_ids(root):
    return [r["id"] for r in roster_roles(root)]


def role_notes(root, dry=False):
    """Copy a missing roles/<f>.md notebook of a roster role from presets/<name>/roles/ (classic first). Returns the paths."""
    made = []
    try:
        for r in roster_roles(root):
            for n in r.get("notebooks") or ["roles/common.md", f"roles/{r['id']}.md"]:
                if not isinstance(n, str) or not n.startswith("roles/") or not n.endswith(".md") or "/" in n[6:] or n in made:
                    continue
                dst = os.path.join(root, n)
                if os.path.exists(dst):
                    continue
                src = next((os.path.join(d, n[6:]) for d in preset_dirs(root, "roles") if os.path.isfile(os.path.join(d, n[6:]))), None)
                if not src:
                    continue
                if not dry:
                    os.makedirs(os.path.dirname(dst), exist_ok=True)
                    shutil.copy2(src, dst)
                made.append(n)
        if made and not dry:
            print("install_seed: role notes " + ", ".join(made), flush=True)
    except Exception as e:  # noqa: BLE001  (never stops the dashboard)
        print("install_seed (role notes):", type(e).__name__, e, flush=True)
    return made


def run(root, dry=False, background=True):
    return role_notes(root, dry=dry) + seed(root, dry=dry, background=background)


def have(ut, i):
    return any(os.path.exists(os.path.join(ut, i + e)) for e in EXTS)


def etag(p):   # same format as tools/avatar_sizes.py and the server's ETag
    st = os.stat(p)
    return '"%x-%x"' % (int(st.st_mtime), st.st_size)


def plan(root):
    """[(id, [(src, dst), ...])] for every roster role whose avatar is missing and has a seed picture."""
    ut = os.path.join(root, "avatars", "ut")
    out = []
    for i in roster_ids(root):
        if have(ut, i):
            continue
        for d in sources(root):
            src = next((os.path.join(d, i + e) for e in EXTS if os.path.isfile(os.path.join(d, i + e))), None)
            if not src:
                continue
            pairs = [(src, os.path.join(ut, os.path.basename(src)))]
            for s in SMALL + WORK:
                f = os.path.join(d, "_s", f"{i}-{s}.webp")
                if os.path.isfile(f):
                    pairs.append((f, os.path.join(ut, "_s", f"{i}-{s}.webp")))
            out.append((i, pairs))
            break
    return out


def _sizes(root):
    try:
        subprocess.run([sys.executable, os.path.join(root, "tools", "avatar_sizes.py")], cwd=root, capture_output=True,
                       stdin=subprocess.DEVNULL, timeout=300)
    except Exception as e:  # noqa: BLE001  (a missing cwebp or a slow disk must never stop the dashboard)
        print("install_seed: avatar_sizes failed:", e, flush=True)


def seed(root, dry=False, background=True):
    """Copy the missing defaults. Returns the copied paths (relative to root). Never raises."""
    try:
        ut = os.path.join(root, "avatars", "ut")
        man_p = os.path.join(ut, "_s", "index.json")
        todo = plan(root)
        made, entries = [], {}
        for i, pairs in todo:
            done = set()
            for src, dst in pairs:
                if os.path.exists(dst):
                    continue
                if not dry:
                    os.makedirs(os.path.dirname(dst), exist_ok=True)
                    shutil.copy2(src, dst)   # keeps the seed mtime: the index etag below is computed from the copy
                made.append(os.path.relpath(dst, root))
                done.add(os.path.basename(dst))
            pic = os.path.basename(pairs[0][1])
            if pic in done and all(f"{i}-{s}.webp" in done for s in SMALL):
                entries[i] = pic
        if dry or not made:
            return made
        try:
            with open(man_p, encoding="utf-8") as f:
                man = json.load(f)
        except (OSError, ValueError):
            man = {}
        if entries:
            for i, pic in entries.items():
                man[i] = {"src": pic, "etag": etag(os.path.join(ut, pic))}
            os.makedirs(os.path.dirname(man_p), exist_ok=True)
            tmp = man_p + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(man, f, ensure_ascii=False, indent=1)
            os.replace(tmp, man_p)
        print("install_seed: avatars " + ", ".join(i for i, _ in todo) + f" ({len(made)} files)", flush=True)
        stale = [f for f in os.listdir(ut) if f.lower().endswith(EXTS) and not f.startswith(".") and f.rsplit(".", 1)[0] not in man]
        if stale:
            # pictures with no index entry (hired roles after a pull removed index.json, or a seed without small copies):
            # tools/avatar_sizes.py rebuilds them; cwebp runs off the start path
            if background:
                threading.Thread(target=_sizes, args=(root,), daemon=True, name="avatar_sizes").start()
            else:
                _sizes(root)
        return made
    except Exception as e:  # noqa: BLE001
        print("install_seed (avatars):", type(e).__name__, e, flush=True)
        return []


if __name__ == "__main__":
    R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    dry = "--dry" in sys.argv[1:]
    got = run(R, dry=dry, background=False)
    print(("would copy: " if dry else "copied: ") + (", ".join(got) if got else "nothing"))
