"""Data versions and ordered migrations (t-oss-struct E1). An update never needs a manual data step.

Every data file carries a schema number: state.json in meta.schema, config.json and roster.json in "_schema". No number = 0.
core/migrations/NNNN_<name>.py are the steps, numbered 0001, 0002, ... with no gaps. Each declares

    TARGETS = ("state",)          # which files it touches: any of "state", "config", "roster"
    def up(data, ctx): ...        # change `data` in place; ctx = {"root": <install dir>, "now": <iso time>}

A file at schema s runs every step numbered above s that lists its target, in order, then is stamped LATEST.
Rules for writing a step:
  - idempotent: running it twice gives the same data (a crash between migrate and save reruns it);
  - add-only inside a minor version: add keys, change defaults, copy to a new place and leave the old one. Deleting or
    changing the meaning of a key waits for a major version and is written in the CHANGELOG upgrade notes. That keeps a
    rollback safe: old code keeps the keys it does not know, because every file is read and written as a whole dict;
  - a renamed config key is a step here, never a default (core/config.py DEFAULTS only fills keys that are missing).

Data newer than the code (after a rollback): nothing runs, nothing is refused; ahead() says so and the server reports it.
Who calls this: stateutil._load (state, inside the state lock, first read after an update), core.config.load / roster
(config + roster, in memory, written back only when a step really changed something).
"""
import datetime as dt
import importlib.util
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
MIG_DIR = os.path.join(HERE, "migrations")
TARGETS = ("state", "config", "roster")
LOG_KEEP = 50   # meta.migrations entries kept
_NAME = re.compile(r"^(\d{4})_([a-z0-9_]+)\.py$")


class Step:
    def __init__(self, n, name, mod):
        self.n, self.name, self.mod = n, name, mod
        self.id = f"{n:04d}_{name}"
        self.targets = tuple(getattr(mod, "TARGETS", ()))


def discover(path=MIG_DIR):
    """The steps in order. Raises on a gap, a duplicate number or a step without up() / with an unknown target."""
    found = []
    for f in sorted(os.listdir(path)) if os.path.isdir(path) else []:
        m = _NAME.match(f)
        if not m:
            continue
        spec = importlib.util.spec_from_file_location(f"_rt_migration_{m.group(1)}", os.path.join(path, f))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        found.append(Step(int(m.group(1)), m.group(2), mod))
    for i, s in enumerate(found, 1):
        if s.n != i:
            raise RuntimeError(f"migrations must be numbered 0001.. with no gaps or duplicates; found {s.id} at position {i}")
        if not callable(getattr(s.mod, "up", None)) or not s.targets or set(s.targets) - set(TARGETS):
            raise RuntimeError(f"migration {s.id}: needs up(data, ctx) and TARGETS within {TARGETS}")
    return found


STEPS = discover()
LATEST = STEPS[-1].n if STEPS else 0


def version(target, data):
    v = (data.get("meta") or {}).get("schema") if target == "state" else data.get("_schema")
    try:
        return max(0, int(v or 0))
    except (TypeError, ValueError):
        return 0


def needs(target, data):
    return version(target, data) < LATEST


def ahead(target, data):
    return version(target, data) > LATEST


def _stamp(target, data, v):
    if target == "state":
        data.setdefault("meta", {})["schema"] = v
    else:   # keep "_schema" as the first key so it is easy to spot in a hand-edited file
        rest = {k: data.pop(k) for k in list(data) if k != "_schema"}
        data["_schema"] = v
        data.update(rest)


def run(target, data, root, now=None, steps=None):
    """Bring `data` (a dict, changed in place) up to LATEST. Returns the ids of the steps that ran ([] = already current or ahead)."""
    steps = STEPS if steps is None else steps
    latest = steps[-1].n if steps else 0
    v = version(target, data)
    if v >= latest:
        return []
    t = now or dt.datetime.now().astimezone().isoformat(timespec="seconds")
    ctx = {"root": root, "now": t}
    ran = []
    for s in steps:
        if s.n > v and target in s.targets:
            s.mod.up(data, ctx)
            ran.append(s.id)
    _stamp(target, data, latest)
    if target == "state":
        lg = data["meta"].setdefault("migrations", [])
        lg.append({"from": v, "to": latest, "ran": ran, "at": t})
        del lg[:-LOG_KEEP]
    return ran


def backup_dir(root):
    """local/backups/migrate when the install has a local/ layer, else .backups/migrate (git-ignored). Never creates local/:
    its presence changes where rule files are written (stateutil.role_md)."""
    loc = os.path.abspath(os.environ.get("UNDERTHREAD_LOCAL") or os.path.join(root, "local"))
    return os.path.join(loc, "backups", "migrate") if os.path.isdir(loc) else os.path.join(root, ".backups", "migrate")


def backup(root, name, raw, old):
    """Save the file exactly as it was before a migration: <backup_dir>/<name>-s<old>-<time>.json. Returns the path."""
    d = backup_dir(root)
    os.makedirs(d, exist_ok=True)
    base = os.path.join(d, f"{name}-s{old}-{dt.datetime.now():%Y%m%d-%H%M%S}")
    p, i = base + ".json", 1
    while os.path.exists(p):
        i += 1
        p = f"{base}-{i}.json"
    with open(p, "wb") as f:
        f.write(raw if isinstance(raw, bytes) else raw.encode("utf-8"))
    return p


def migrate_file(root, name, target, indent=2, write=True):
    """config.json / roster.json: read, migrate in memory, and write back (after a backup) only when a step changed something
    besides the schema stamp. Returns (data, ran). A missing or unreadable file gives ({}, []).
    write=False never touches the file (used for the shipped *.example.json files)."""
    path = os.path.join(root, name)
    try:
        with open(path, "rb") as f:
            raw = f.read()
        data = json.loads(raw.decode("utf-8"))
    except (OSError, ValueError):
        return {}, []
    if not isinstance(data, dict) or not needs(target, data):
        return data if isinstance(data, dict) else {}, []
    old = version(target, data)
    before = json.dumps({k: v for k, v in data.items() if k != "_schema"}, sort_keys=True)
    ran = run(target, data, root)
    if write and json.dumps({k: v for k, v in data.items() if k != "_schema"}, sort_keys=True) != before:
        backup(root, name, raw, old)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=indent)
            f.write("\n")
        os.replace(tmp, path)
    return data, ran


def status(root, state):
    """One line per file for `stateutil.py schema` and /api/health."""
    out = {"code": LATEST, "steps": [s.id for s in STEPS], "state": version("state", state)}
    for name, target in (("config.json", "config"), ("roster.json", "roster")):
        try:
            with open(os.path.join(root, name), encoding="utf-8") as f:
                out[target] = version(target, json.load(f))
        except (OSError, ValueError):
            out[target] = None
    out["ahead"] = [t for t in TARGETS if isinstance(out.get(t), int) and out[t] > LATEST]
    return out
