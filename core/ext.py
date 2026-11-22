"""Extensions (built-in ext/<name>/ and your own local/ext/<name>/: stateutil_ext.py and server_ext.py) and the hook lists they fill.
Moved from stateutil.py (t-oss-struct B1); stateutil re-exports these exact objects, so `S.UPSERT_HOOKS.append(fn)` in an
extension reaches the code in core/ that runs the hooks.

t-oss-struct S8: an extension with an ext.json manifest is checked against the registry API (core/registry.py) first and its
register() gets a registry handle R; one without a manifest is the old way (register(module)), still loaded in 0.2.x.
"""
import os
import sys

from core.paths import ROOT, local_path

BUILTIN = os.path.join(ROOT, "ext")   # t-oss-live: extensions that ship with the repository (ext/<name>/), same layout as local/ext/<name>/

EXT = {}            # name -> {"dir": path, "stateutil": module or None, "server": module or None, "error": text or None}
CLI_EXT = []        # fn(subparsers): an extension adds its own stateutil subcommands
SET_AGENT_HOOKS = []   # fn(st, agent_id, agent, auto, tool): after set_agent changed an agent (inside the state lock)
UPSERT_HOOKS = []      # fn(phase, ctx): phase "before" / "after" (inside the lock) and "done" (after it); see cmd_upsert_item


def _subdirs(base):
    if not os.path.isdir(base):
        return []
    return [os.path.join(base, n) for n in sorted(os.listdir(base))
            if not n.startswith((".", "_")) and os.path.isdir(os.path.join(base, n))]


def ext_dirs():
    """Built-in extensions (ext/<name>/) first, then your own (local/ext/<name>/). A local folder with the same name as a built-in
    one replaces it (t-oss-live: an install that already had local/ext/live keeps running its own copy)."""
    loc = _subdirs(local_path("ext"))
    mine = {os.path.basename(d) for d in loc}
    return [d for d in _subdirs(BUILTIN) if os.path.basename(d) not in mine] + loc


def is_builtin(d):
    return os.path.dirname(os.path.abspath(d)) == os.path.abspath(BUILTIN)


def ext_on(name, root=None):
    """t-oss-live: is extension <name> switched on? config.json "extensions": {"<name>": false} turns a built-in one off
    (core/config.py DEFAULTS holds the default, true). Your own local/ext/<name> is always on: delete the folder to drop it.
    Read from disk every call, so Settings -> Connections takes effect without a restart."""
    from core import config as C
    e = EXT.get(name) or {}
    if e.get("dir") and not is_builtin(e["dir"]):
        return True
    try:
        return C.load(root or ROOT).get("extensions", {}).get(name, True) is not False
    except (OSError, ValueError):
        return True


def load_ext(kind, target):
    """Import local/ext/<name>/<kind>_ext.py (kind "stateutil" or "server") for every extension and call register(target).
    Each extension folder is also put on sys.path, so its plain modules import by name. A broken extension prints one line
    to stderr and is skipped: it must never take the CLI or the dashboard down."""
    import importlib.util
    from core import registry
    dirs = ext_dirs()
    registry.scan(dirs)
    for d in dirs:
        name = os.path.basename(d)
        e = EXT.setdefault(name, {"dir": d, "stateutil": None, "server": None, "error": None})
        info = registry.EXTS.get(name) or {}
        if info.get("skipped"):   # api / requires mismatch or a broken ext.json: none of its code runs
            e["error"] = "skipped: " + info["skipped"]
            continue
        if d not in sys.path:
            sys.path.insert(0, d)
        f = os.path.join(d, f"{kind}_ext.py")
        if not os.path.exists(f):
            continue
        try:
            spec = importlib.util.spec_from_file_location(f"_ext_{name}_{kind}", f)
            m = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(m)
            if hasattr(m, "register"):
                m.register(target if info.get("legacy", True) else registry.Reg(name, kind, target))
            e[kind] = m
        except Exception as ex:  # noqa: BLE001
            e["error"] = f"{kind}: {ex!r}"
