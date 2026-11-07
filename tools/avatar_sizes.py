#!/usr/bin/env python3
"""ri1105-P1: small WebP copies of the team avatars for the dashboard.

For every avatars/<name>.(png|jpg|jpeg|webp) this writes
  avatars/_s/<name>-160.webp   (round avatars, <= 50 px on screen)
  avatars/_s/<name>-512.webp   (the phone home's ~210 px art slot)
and avatars/_s/index.json = {name: {"src": file, "etag": '"<mtime hex>-<size hex>"'}}.
The originals are never touched. The page uses a small copy only while the manifest's
src + etag match the original (same ETag format as server.py _file), so a replaced
avatar falls back to the original until this script runs again.

Run after adding or replacing an avatar:  python3 tools/avatar_sizes.py
Needs cwebp (brew install webp). Without it nothing is written and the page keeps the PNGs.
"""
import json, os, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AV = os.path.join(ROOT, "avatars")
OUT = os.path.join(AV, "_s")
SIZES = (160, 512)


def etag(p):
    st = os.stat(p)
    return '"%x-%x"' % (int(st.st_mtime), st.st_size)


def main():
    cw = shutil.which("cwebp") or next((p for p in ("/opt/homebrew/bin/cwebp", "/usr/local/bin/cwebp") if os.path.exists(p)), None)
    if not cw:
        print("cwebp not found (brew install webp); nothing written")
        return 1
    os.makedirs(OUT, exist_ok=True)
    man_p = os.path.join(OUT, "index.json")
    try:
        old = json.load(open(man_p))
    except Exception:
        old = {}
    man, made = {}, 0
    for f in sorted(os.listdir(AV)):
        if not f.lower().endswith((".png", ".jpg", ".jpeg", ".webp")) or f.startswith("."):
            continue
        name, src = f.rsplit(".", 1)[0], os.path.join(AV, f)
        e = etag(src)
        outs = [os.path.join(OUT, f"{name}-{s}.webp") for s in SIZES]
        if old.get(name) == {"src": f, "etag": e} and all(os.path.exists(o) for o in outs):
            man[name] = old[name]
            continue
        ok = True
        for s, o in zip(SIZES, outs):
            tmp = o + ".tmp"
            r = subprocess.run([cw, "-quiet", "-q", "82", "-m", "6", "-resize", str(s), str(s), src, "-o", tmp], capture_output=True)
            if r.returncode or not os.path.exists(tmp):
                ok = False
                print("failed", f, s, r.stderr.decode()[:200])
                break
            os.replace(tmp, o)
        if ok:
            man[name] = {"src": f, "etag": e}
            made += 1
    tmp = man_p + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(man, fh, ensure_ascii=False, indent=1)
    os.replace(tmp, man_p)
    print(f"{len(man)} avatars, {made} regenerated -> avatars/_s/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
