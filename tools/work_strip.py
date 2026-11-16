#!/usr/bin/env python3
"""Build the 4-frame work animation for a role's avatar: three horizontal sprite sheets work-{160,320,512}.webp.
Needs ffmpeg and cwebp (brew install ffmpeg webp).

    # a prop that moves: one transparent 2x2 sheet of the same small prop (frame 1 top-left, 2 top-right, 3 bottom-left,
    # 4 bottom-right), drawn by the artist; each cell is centred on the prop's alpha centroid (frames do not drift),
    # scaled to BOX px and laid over the 512 px avatar with its centre at (AX, AY)
    python3 tools/work_strip.py AVATAR.png OUT_DIR --props SHEET.png --at AX AY --box BOX

    # no image backend: the avatar itself sways a little (frame 1 = the avatar unchanged, then -SWAY, 0, +SWAY degrees)
    python3 tools/work_strip.py AVATAR.png OUT_DIR --bob [--sway 4]

    --install ID   also copy the sheets to avatars/ut/_s/ID-work-{160,320,512}.webp (the files the dashboard plays)

OUT_DIR gets f1.png..f4.png and work-{160,320,512}.webp. Frame 1 of --props is the avatar with the prop in its first pose;
frame 1 of --bob is the avatar as it is.
"""
import argparse
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIZES = (160, 320, 512)


def ff(*a):
    r = subprocess.run(["ffmpeg", "-loglevel", "error", "-y", *a], capture_output=True, text=True)
    if r.returncode:
        sys.exit("ffmpeg failed: " + r.stderr[-400:])


def width(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "stream=width", "-of", "csv=p=0", path],
                       capture_output=True, text=True)
    try:
        return int(r.stdout.strip())
    except ValueError:
        sys.exit(f"cannot read {path}")


def base512(avatar, out):
    """The avatar as a 512 px RGBA square (frames are built at 512)."""
    p = os.path.join(out, "base.png")
    ff("-i", avatar, "-vf", "format=rgba,scale=512:512:flags=lanczos", "-frames:v", "1", p)
    return p


def frames_props(orig, sheet, out, ax, ay, box):
    W = width(sheet)
    cell, S = W // 2, 200                                  # analyse at 200 px/cell
    PAD, CROP = 300, 560                                   # the square cut round each centroid; pad so it never leaves the image
    for i, (cx, cy) in enumerate([(0, 0), (1, 0), (0, 1), (1, 1)], 1):
        buf = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", sheet, "-vf",
                              f"format=rgba,crop={cell}:{cell}:{cx * cell}:{cy * cell},scale={S}:{S}:flags=area",
                              "-f", "rawvideo", "-pix_fmt", "rgba", "-"], capture_output=True, check=True).stdout
        sx = sy = n = 0
        for p in range(S * S):
            if buf[p * 4 + 3] > 128:
                sx += p % S; sy += p // S; n += 1
        if not n:
            sys.exit(f"cell {i} of {sheet} is empty")
        kx, ky = sx / n * cell / S + cx * cell + PAD, sy / n * cell / S + cy * cell + PAD
        left, top = int(round(kx - CROP / 2)), int(round(ky - CROP / 2))
        px, py = int(round(ax - box / 2)), int(round(ay - box / 2))
        ff("-i", orig, "-i", sheet, "-filter_complex",
           f"[1]format=rgba,pad={W + 2 * PAD}:{W + 2 * PAD}:{PAD}:{PAD}:color=0x00000000,crop={CROP}:{CROP}:{left}:{top},"
           f"lut=a='if(gte(val\\,240)\\,255\\,val)',scale={box}:{box}:flags=lanczos[n];[0]format=rgba,split[o][m];[m]alphaextract[ma];"
           f"[o][n]overlay={px}:{py}:format=auto[c];[c][ma]alphamerge",
           "-frames:v", "1", os.path.join(out, f"f{i}.png"))
        print(f"frame {i}: prop centroid ({kx - PAD:.0f},{ky - PAD:.0f}), {n} px", file=sys.stderr)


def frames_bob(orig, out, sway):
    for i, deg in enumerate((0, -sway, 0, sway), 1):
        dst = os.path.join(out, f"f{i}.png")
        if not deg:
            shutil.copyfile(orig, dst)
            continue
        ff("-i", orig, "-vf", f"format=rgba,rotate={deg}*PI/180:c=none:ow=iw:oh=ih", "-frames:v", "1", dst)


def sheets(out):
    made = []
    for s in SIZES:
        tmp = os.path.join(out, f"sheet-{s}.png")
        ff(*sum((["-i", os.path.join(out, f"f{k}.png")] for k in range(1, 5)), []), "-filter_complex",
           ";".join(f"[{k}]scale={s}:{s}:flags=lanczos[v{k}]" for k in range(4)) + ";" + "".join(f"[v{k}]" for k in range(4)) + "hstack=4", tmp)
        dst = os.path.join(out, f"work-{s}.webp")
        r = subprocess.run(["cwebp", "-quiet", "-q", "82", "-alpha_q", "80", tmp, "-o", dst], capture_output=True, text=True)
        os.remove(tmp)
        if r.returncode:
            sys.exit("cwebp failed: " + r.stderr[-300:])
        made.append(dst)
    return made


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("avatar"); p.add_argument("out")
    p.add_argument("--props"); p.add_argument("--at", nargs=2, type=float, metavar=("AX", "AY")); p.add_argument("--box", type=int)
    p.add_argument("--bob", action="store_true"); p.add_argument("--sway", type=float, default=4)
    p.add_argument("--install", metavar="ID")
    a = p.parse_args()
    for tool in ("ffmpeg", "ffprobe", "cwebp"):
        if not shutil.which(tool):
            sys.exit(f"{tool} not found (brew install ffmpeg webp)")
    if a.bob == bool(a.props):
        sys.exit("give exactly one of --props SHEET.png (with --at and --box) or --bob")
    if a.props and (not a.at or not a.box):
        sys.exit("--props needs --at AX AY and --box BOX (positions on the 512 px avatar)")
    if a.install and not all(c.isalnum() or c in "-_" for c in a.install):
        sys.exit(f"bad role id {a.install!r}")
    os.makedirs(a.out, exist_ok=True)
    orig = base512(a.avatar, a.out)
    if a.bob:
        frames_bob(orig, a.out, a.sway)
    else:
        frames_props(orig, a.props, a.out, a.at[0], a.at[1], a.box)
    os.remove(orig)
    made = sheets(a.out)
    for m in made:
        print(os.path.abspath(m))
    if a.install:
        d = os.path.join(ROOT, "avatars", "ut", "_s")
        os.makedirs(d, exist_ok=True)
        for s, m in zip(SIZES, made):
            shutil.copyfile(m, os.path.join(d, f"{a.install}-work-{s}.webp"))
        print(f"installed avatars/ut/_s/{a.install}-work-{{160,320,512}}.webp", file=sys.stderr)


if __name__ == "__main__":
    main()
