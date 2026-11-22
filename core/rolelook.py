"""t-roster-rail: how a role looks on the board, set by you on the 团队 / Team page. Two things, both kept in roster.json on the role's own
entry (your file: updates never replace it, core/backup.py copies it, a retire + rehire keeps the entry):

  display_name / display_name_en   the name the board shows. The role's id, its agent file and its notes keep the original "name"
                                   (rename = display only); empty = back to the original.
  avatar_pick                      one of the role's candidate pictures, as a path under avatars/ (see choices()); absent = the default
                                   (the palette's own avatar: avatars/ut/<id>.png under 特典, avatars/<id>.* or the letter circle otherwise).

Candidates for a role: avatars/ut/<id>.png (the stitched patch that ships with the repo), avatars/<id>.(png|jpg|jpeg|webp) (your own
picture), and every picture in avatars/choices/<id>/ (drop files there; avatars/ is yours and git ignores it). A pick gets two small WebP
copies in avatars/_pick/<id>-160.webp / -512.webp (cwebp, when installed), so the page does not pull a full-size PNG for a 40 px circle.
"""
import json
import os
import re
import shutil
import subprocess

from core import config as C

EXT = (".png", ".jpg", ".jpeg", ".webp")
NAME_MAX = 24
SIZES = (160, 512)


def _etag(p):
    st = os.stat(p)
    return "%x-%x" % (int(st.st_mtime), st.st_size)


def choices(root, rid):
    """[{src, kind}] for one role, in a fixed order. kind = "ut" | "own" | "extra". Paths are relative to avatars/."""
    av = os.path.join(root, "avatars")
    out = []
    if os.path.isfile(os.path.join(av, "ut", f"{rid}.png")):
        out.append({"src": f"ut/{rid}.png", "kind": "ut"})
    for e in EXT:
        if os.path.isfile(os.path.join(av, rid + e)):
            out.append({"src": rid + e, "kind": "own"})
            break
    d = os.path.join(av, "choices", rid)
    try:
        names = sorted(os.listdir(d))
    except OSError:
        names = []
    for f in names:
        if f.startswith(".") or not f.lower().endswith(EXT) or ".bak" in f:
            continue
        if os.path.isfile(os.path.join(d, f)):
            out.append({"src": f"choices/{rid}/{f}", "kind": "extra"})
    for c in out:
        c["v"] = _etag(os.path.join(av, c["src"]))
    return out


def pick_view(root, role):
    """The agent's "avpick" for state.agents (None = default): {src, v, s} with s = 1 when the small copies match the source."""
    src = role.get("avatar_pick") if isinstance(role, dict) else None
    if not src or not isinstance(src, str):
        return None
    p = os.path.join(root, "avatars", src)
    if not os.path.isfile(p):
        return None   # the file went away: fall back to the default instead of a broken image
    v = _etag(p)
    try:
        with open(os.path.join(root, "avatars", "_pick", "index.json"), encoding="utf-8") as f:
            m = json.load(f).get(role["id"]) or {}
    except (OSError, ValueError):
        m = {}
    s = int(m.get("src") == src and m.get("v") == v and all(os.path.exists(os.path.join(root, "avatars", "_pick", f"{role['id']}-{z}.webp")) for z in SIZES))
    return {"src": src, "v": v, "s": s}


def apply(agent, role, root):
    """Fill one state.agents entry from its roster role: display names over "name" / "name_en" (originals kept in name_orig /
    name_en_orig so a thread line signed with the old name still finds the role), and avpick. Called by sync_roster and the action."""
    for k in ("name", "name_en"):
        d = str(role.get("display_" + k) or "").strip()
        if d and d != role.get(k):
            agent[k] = d
            agent[k + "_orig"] = role.get(k) or ""
        else:
            if k in role:
                agent[k] = role[k]
            agent.pop(k + "_orig", None)
    pv = pick_view(root, role)
    if pv:
        agent["avpick"] = pv
    else:
        agent.pop("avpick", None)


def _clean_name(v):
    n = re.sub(r"\s+", " ", str(v or "")).strip()
    if len(n) > NAME_MAX or re.search(r"[<>\x00-\x1f]", n):
        raise ValueError(f"name: at most {NAME_MAX} characters, no < > or control characters")
    return n


def _cwebp():
    return shutil.which("cwebp") or next((p for p in ("/opt/homebrew/bin/cwebp", "/usr/local/bin/cwebp") if os.path.exists(p)), None)


def _small(root, rid, src):
    """Write avatars/_pick/<rid>-160/-512.webp for src and record it in avatars/_pick/index.json. No cwebp = nothing (the page uses the original)."""
    cw = _cwebp()
    if not cw:
        return False
    out = os.path.join(root, "avatars", "_pick")
    os.makedirs(out, exist_ok=True)
    s = os.path.join(root, "avatars", src)
    for z in SIZES:
        o = os.path.join(out, f"{rid}-{z}.webp")
        tmp = o + ".tmp"
        r = subprocess.run([cw, "-quiet", "-q", "82", "-m", "4", "-resize", str(z), str(z), s, "-o", tmp], capture_output=True, timeout=60)
        if r.returncode or not os.path.exists(tmp):
            return False
        os.replace(tmp, o)
    mp = os.path.join(out, "index.json")
    try:
        with open(mp, encoding="utf-8") as f:
            man = json.load(f)
    except (OSError, ValueError):
        man = {}
    man[rid] = {"src": src, "v": _etag(s)}
    tmp = mp + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(man, f, ensure_ascii=False, indent=1)
    os.replace(tmp, mp)
    return True


def set_look(root, rid, name=None, name_en=None, avatar=None):
    """Change a role's look in roster.json. name / name_en: str (empty = original), None = leave. avatar: a src from choices(), "" = default,
    None = leave. Returns the role entry as written. Raises ValueError on an unknown role or a src that is not one of its candidates."""
    data = C.roster_file(root)
    role = next((r for r in data.get("roles") or [] if isinstance(r, dict) and r.get("id") == rid), None)
    if role is None:
        raise ValueError(f"no role {rid}")
    for k, v in (("name", name), ("name_en", name_en)):
        if v is None:
            continue
        n = _clean_name(v)
        if n and n != role.get(k):
            role["display_" + k] = n
        else:
            role.pop("display_" + k, None)
    if avatar is not None:
        if avatar == "":
            role.pop("avatar_pick", None)
        else:
            if avatar not in {c["src"] for c in choices(root, rid)}:
                raise ValueError("avatar: not one of this role's pictures")
            role["avatar_pick"] = avatar
            _small(root, rid, avatar)
    path = os.path.join(root, "roster.json")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)   # same format as tools/new_role.py: other entries stay byte-identical
        f.write("\n")
    os.replace(tmp, path)
    return role
