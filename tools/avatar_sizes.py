#!/usr/bin/env python3
"""ri1105-P1: small WebP copies of the team avatars for the dashboard.

For every avatars/<name>.(png|jpg|jpeg|webp) this writes
  avatars/_s/<name>-160.webp   (round avatars, <= 50 px on screen)
  avatars/_s/<name>-512.webp   (the phone home's ~210 px art slot)
and avatars/_s/index.json = {name: {"src": file, "etag": '"<mtime hex>-<size hex>"'}}.
The originals are never touched. The page uses a small copy only while the manifest's
src + etag match the original (same ETag format as server.py _file), so a replaced
avatar falls back to the original until this script runs again.

t-avatar-style: the same again for avatars/ut/<name>.png (the Underthread set, shown only under html[data-ut])
  -> avatars/ut/_s/<name>-160.webp, -512.webp, index.json (same format). No flag: one run does both; no avatars/ut/ = skipped.

ri1106-P5: after both runs it prints "! UT 缺图：<id>" for every roster.json role that has no avatars/ut/<id> file (me is skipped).

Run after adding or replacing an avatar:  python3 tools/avatar_sizes.py
Needs cwebp (brew install webp). Without it nothing is written and the page keeps the PNGs.
"""
import json, os, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AV = os.path.join(ROOT, "avatars")
OUT = os.path.join(AV, "_s")
UT = os.path.join(AV, "ut")
SIZES = (160, 512)


def etag(p):
    st = os.stat(p)
    return '"%x-%x"' % (int(st.st_mtime), st.st_size)


def gen(cw, AV, OUT):
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
    print(f"{len(man)} avatars, {made} regenerated -> {os.path.relpath(OUT, ROOT)}/")


def ut_missing():
    """ri1106-P5: roster roles with no avatars/ut/<id>.* file. Under 特典 such a role silently shows its normal avatar, so say it here.
    'me' is not a roster role and has no needle-thread version on purpose."""
    try:
        roles = [r.get("id") for r in json.load(open(os.path.join(ROOT, "roster.json"))).get("roles", [])]
    except Exception as e:
        print("! UT check skipped: roster.json unreadable (%s)" % e)
        return []
    have = {f.rsplit(".", 1)[0] for f in os.listdir(UT) if f.lower().endswith((".png", ".jpg", ".jpeg", ".webp")) and not f.startswith(".")} if os.path.isdir(UT) else set()
    miss = [i for i in roles if i and i != "me" and i not in have]
    for i in miss:
        print(f"! UT 缺图：{i}（放 avatars/ut/{i}.png 后再跑一次本脚本）")
    return miss


def main():
    cw = shutil.which("cwebp") or next((p for p in ("/opt/homebrew/bin/cwebp", "/usr/local/bin/cwebp") if os.path.exists(p)), None)
    if not cw:
        print("cwebp not found (brew install webp); nothing written")
        return 1
    gen(cw, AV, OUT)
    if os.path.isdir(UT):
        gen(cw, UT, os.path.join(UT, "_s"))
    ut_missing()
    return 0


if __name__ == "__main__":
    sys.exit(main())
