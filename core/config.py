"""Config defaults (t-oss-struct E2). Effective config = DEFAULTS deep-merged with config.json; a key you set wins.

Defaults are never written into your config.json, so a default that changes in an update reaches everyone who never set
that key, and a value you did set stays yours. config.example.json is generated from here:

    python3 -m core.config example          # print it (tests/unit checks the committed file matches)
    python3 -m core.config example --write  # rewrite config.example.json
    python3 stateutil.py config show        # effective values and where each one comes from

A renamed or moved key is a migration (core/migrations), never a default. Blocks that switch a feature on by being present
(comfy, voice, github, platforms) have no default here: an empty default would look "configured".
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
