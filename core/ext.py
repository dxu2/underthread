"""Extensions of the local/ layer (local/ext/<name>/stateutil_ext.py and server_ext.py) and the hook lists they fill.
Moved from stateutil.py (t-oss-struct B1); stateutil re-exports these exact objects, so `S.UPSERT_HOOKS.append(fn)` in an
extension reaches the code in core/ that runs the hooks.
"""
import os
import sys

from core.paths import local_path

EXT = {}            # name -> {"dir": path, "stateutil": module or None, "server": module or None, "error": text or None}
CLI_EXT = []        # fn(subparsers): an extension adds its own stateutil subcommands
SET_AGENT_HOOKS = []   # fn(st, agent_id, agent, auto, tool): after set_agent changed an agent (inside the state lock)
UPSERT_HOOKS = []      # fn(phase, ctx): phase "before" / "after" (inside the lock) and "done" (after it); see cmd_upsert_item


def ext_dirs():
    base = local_path("ext")
    if not os.path.isdir(base):
        return []
    return [os.path.join(base, n) for n in sorted(os.listdir(base))
            if not n.startswith((".", "_")) and os.path.isdir(os.path.join(base, n))]


def load_ext(kind, target):
    """Import local/ext/<name>/<kind>_ext.py (kind "stateutil" or "server") for every extension and call register(target).
    Each extension folder is also put on sys.path, so its plain modules import by name. A broken extension prints one line
    to stderr and is skipped: it must never take the CLI or the dashboard down."""
    import importlib.util
    for d in ext_dirs():
        name = os.path.basename(d)
        e = EXT.setdefault(name, {"dir": d, "stateutil": None, "server": None, "error": None})
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
                m.register(target)
            e[kind] = m
        except Exception as ex:  # noqa: BLE001
            e["error"] = f"{kind}: {ex!r}"
