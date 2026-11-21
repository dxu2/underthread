"""Config defaults (t-oss-struct E2). Effective config = DEFAULTS deep-merged with config.json; a key you set wins.

Defaults are never written into your config.json, so a default that changes in an update reaches everyone who never set
that key, and a value you did set stays yours. config.example.json is generated from here:

    python3 -m core.config example          # print it (tests/unit checks the committed file matches)
    python3 -m core.config example --write  # rewrite config.example.json
    python3 stateutil.py config show        # effective values and where each one comes from

A renamed or moved key is a migration (core/migrations), never a default. Blocks that switch a feature on by being present
(voice, github, platforms) have no default here: an empty default would look "configured".
roster.json works the same way per role: ROLE_DEFAULTS fill keys a role does not have, at read time.
"""
import copy
import json
import os
import sys

try:
    from core import migrate as MG
except ImportError:   # python3 core/config.py
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from core import migrate as MG

DEFAULTS = {
    "owner": {"display_name": ""},
    "port": 8765,
    "report_time": "18:00",
    "routines": [],          # legacy: imported once into schedules (stateutil.schedules_import_routines)
    "allowed_hosts": [],     # extra Host names the server answers (e.g. a Tailscale name); 127.0.0.1 / localhost always work
    "legacy_headers": [],    # extra CSRF header names accepted besides X-Underthread
    "update": {"remote": "", "check": True},   # tools/update.py: git remote to update from ("" = upstream / origin), daily check
    # t-feed-inbox (docs/feeds.md): tunables only. Which sources are connected, on/off and their interval live in feeds.json (set on
    # Settings -> Connections); passwords live in the keychain. classifier: "auto" (claude if on PATH) | "claude" | "off"
    "feeds": {"interval_min": 5, "max_per_poll": 30, "snippet_chars": 120, "primary_only": True, "classifier": "auto",
              "classifier_model": "haiku"},
    # t-hire-celebration: the welcome animation for a new hire waits this many minutes for a picked 特典 avatar when tools/new_role.py
    # gave the role the recoloured placeholder (0 = play as soon as the hire lands)
    "hire_welcome": {"wait_avatar_min": 0},
    # t-oss-gen-s3: tools/image.py picks the picture backend. "auto" = codex if logged in with ChatGPT, else none (hires fall back
    # to template art). t-oss-no-comfy: ComfyUI was removed; an old "comfy" setting is read as auto and old comfy keys are ignored.
    "image": {"backend": "auto"},
}
EXAMPLE = {"owner": {"display_name": "<your name>"}}   # placeholders shown only in config.example.json
ROLE_DEFAULTS = {"enabled": True}


def merge(base, over):
    """Deep merge: dicts merge key by key, anything else in `over` replaces. Returns a new dict; neither input is changed."""
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        out[k] = merge(out[k], v) if isinstance(out.get(k), dict) and isinstance(v, dict) else copy.deepcopy(v)
    return out


def user(root):
    """config.json as you wrote it (after migrations), without defaults and without the "_schema" stamp."""
    data, _ = MG.migrate_file(root, "config.json", "config")
    return {k: v for k, v in data.items() if k != "_schema"}


def load(root):
    return merge(DEFAULTS, user(root))


# ---------- t-onboard-name: what the steward and the team call you ----------
# owner.display_name is unset when empty or still a placeholder like "<your name>". The steward asks once, in its first
# message after coming online (stateutil say-mgr --ask-name); the answer is written here and nowhere else.
def owner_real(name):
    n = str(name or "").strip()
    return n if n and not n.startswith("<") else ""


def clean_owner(name):
    """The name as typed, trimmed; ValueError when it cannot be a name (empty, a placeholder, over 40 characters, control characters)."""
    n = " ".join(str(name or "").split())
    if not n or n.startswith("<") or len(n) > 40 or any(ord(c) < 32 for c in n):
        raise ValueError("name: 1-40 characters, not a <placeholder>")
    return n


def _write_owner(root, key, value):
    """Set (or, with value None, drop) owner.<key> in config.json; every other key (and _schema) stays as it is. Creates the file if missing."""
    path = os.path.join(root, "config.json")
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        data = {}
    if not isinstance(data, dict):
        raise ValueError("config.json is not an object")
    if not isinstance(data.get("owner"), dict):
        data["owner"] = {}
    if value is None:
        data["owner"].pop(key, None)
    else:
        data["owner"][key] = value
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)
    _OWN["m"] = None


def set_owner(root, name):
    """Write owner.display_name into config.json; every other key (and _schema) stays as it is. Creates the file if missing."""
    n = clean_owner(name)
    _write_owner(root, "display_name", n)
    return n


# ---------- t-oss-location: where you are, from the browser (navigator.geolocation), never from a third party ----------
# owner.location = {"lat": 37.77, "lon": -122.42, "tz": "America/Los_Angeles", "at": "<iso>"} (2 decimals, about 1 km), or
# {"declined": true, "at": "<iso>"} when you said no (the board never asks again). Absent = never asked. No reverse geocoding:
# whatever needs weather or sunrise reads lat / lon from here.
_TZ_RE = r"[A-Za-z][A-Za-z0-9_+\-]*(/[A-Za-z0-9_+\-]+){0,2}"


def clean_location(lat, lon, tz=""):
    """{lat, lon, tz} rounded to 2 decimals; ValueError when they are not real coordinates or tz is not an IANA-looking name."""
    import re
    try:
        la, lo = float(lat), float(lon)
    except (TypeError, ValueError):
        raise ValueError("location: lat / lon must be numbers")
    if not (-90 <= la <= 90 and -180 <= lo <= 180) or la != la or lo != lo:
        raise ValueError("location: lat -90..90, lon -180..180")
    tz = str(tz or "").strip()
    if tz and (len(tz) > 64 or not re.fullmatch(_TZ_RE, tz)):
        raise ValueError("location: tz must look like Area/City")
    out = {"lat": round(la, 2), "lon": round(lo, 2)}
    if tz:
        out["tz"] = tz
    return out


def set_location(root, loc):
    """loc = clean_location(...) result, {"declined": True}, or None (forget it, so the board may ask again). Stamps "at"."""
    import datetime as _dt
    if loc is not None:
        loc = dict(loc, at=_dt.datetime.now().astimezone().isoformat(timespec="seconds"))
    _write_owner(root, "location", loc)
    return loc


def owner_location(root):
    """owner.location as config.json says now: the dict above, or None when never asked."""
    try:
        v = (user(root).get("owner") or {}).get("location")
    except (OSError, ValueError):
        return None
    return v if isinstance(v, dict) else None


_OWN = {"m": None, "v": ""}


def owner_live(root, cfg=None):
    """owner.display_name as config.json says now (re-read when the file changes, so a name set by stateutil reaches a running
    server without a restart). Updates cfg["owner"] in place when given. Returns the real name or ""."""
    try:
        m = os.path.getmtime(os.path.join(root, "config.json"))
    except OSError:
        m = 0
    if m != _OWN["m"]:
        try:
            _OWN["v"] = ((user(root).get("owner") or {}).get("display_name") or "")
        except (OSError, ValueError):
            _OWN["v"] = ""
        _OWN["m"] = m
        if cfg is not None:
            cfg.setdefault("owner", {})["display_name"] = _OWN["v"]
    return owner_real(_OWN["v"])


def roster(root, example=False, strict=False):
    """roster.json (after migrations) with ROLE_DEFAULTS filled into every role. Missing file -> {"roles": []}.
    example=True: when there is no roster.json yet, read roster.example.json instead (never written back).
    strict=True: a missing or broken file raises (OSError / ValueError) instead of giving an empty roster."""
    name = "roster.json"
    if example and not os.path.exists(os.path.join(root, name)) and os.path.exists(os.path.join(root, "roster.example.json")):
        name = "roster.example.json"
    if strict:
        with open(os.path.join(root, name), encoding="utf-8") as f:
            json.load(f)
    data, _ = MG.migrate_file(root, name, "roster", write=name == "roster.json")
    out = {k: v for k, v in data.items() if k != "_schema"}
    out["roles"] = [merge(ROLE_DEFAULTS, r) if isinstance(r, dict) else r for r in data.get("roles") or []]
    return out


def roster_file(root):
    """roster.json for a tool that edits and writes it back (tools/new_role.py): migrated, but no ROLE_DEFAULTS filled in, and
    "_schema" kept only when the file on disk already carries it, so a round trip changes nothing else. Raises when unreadable."""
    path = os.path.join(root, "roster.json")
    with open(path, encoding="utf-8") as f:
        disk = json.load(f)   # an unreadable roster must stop the tool, as before
    data, _ = MG.migrate_file(root, "roster.json", "roster")
    if "_schema" not in disk:
        try:
            with open(path, encoding="utf-8") as f:
                disk = json.load(f)   # a step may just have written it (with the stamp)
        except (OSError, ValueError):
            pass
    if "_schema" not in disk:
        data = {k: v for k, v in data.items() if k != "_schema"}
    return data


def sources(root):
    """[(dotted key, effective value, "default" | "yours")] for every leaf of the effective config."""
    mine, rows = user(root), []

    def walk(eff, own, path):
        for k, v in eff.items():
            p = f"{path}.{k}" if path else k
            has = isinstance(own, dict) and k in own
            if isinstance(v, dict) and v:
                walk(v, own.get(k) if has else None, p)
            else:
                rows.append((p, v, "yours" if has else "default"))
    walk(merge(DEFAULTS, mine), mine, "")
    return rows


def example_text():
    ex = {"_schema": MG.LATEST}
    ex.update(merge(DEFAULTS, EXAMPLE))
    return json.dumps(ex, ensure_ascii=False, indent=2) + "\n"


if __name__ == "__main__":
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if sys.argv[1:2] == ["example"]:
        if "--write" in sys.argv:
            with open(os.path.join(root, "config.example.json"), "w", encoding="utf-8") as f:
                f.write(example_text())
            print("wrote config.example.json")
        else:
            sys.stdout.write(example_text())
    else:
        sys.exit(__doc__)
