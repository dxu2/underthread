"""Shared context of the dashboard server (t-oss-struct B2): paths, config, the optional helper modules (webpush, voicecall,
ghcred, usage_roll) and small helpers every api module uses. Nothing here imports another api module.

CONFIG is one dict for the life of the process: server.main() fills it in place (CONFIG.update), so `from api.ctx import CONFIG`
always sees the loaded config."""
import datetime as dt
import json
import mimetypes
import os
import shutil
import sys
import threading
import time

import stateutil as S
from core import config as C   # t-oss-struct E2: DEFAULTS deep-merged with config.json; roster ROLE_DEFAULTS
from core import migrate as MG  # noqa: F401  (t-oss-struct E1; used by api.routes.state / health)
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools"))
import webpush as WP  # noqa: E402,F401  (used by api.routes.push)
try:   # t-vb-2: voice calls (a missing or broken voicecall.py must never take the dashboard down)
    import voicecall as VC  # noqa: E402
except ModuleNotFoundError:   # voice calls are not part of this repo: stay quiet
    VC = None
except Exception as _e:  # noqa: BLE001
    VC = None
    print("voicecall not loaded:", repr(_e))
try:   # t-dash-token: GitHub push token (a broken ghcred.py must never take the dashboard down)
    import ghcred as GH  # noqa: E402
except Exception as _e:  # noqa: BLE001
    GH = None
    print("ghcred not loaded:", type(_e).__name__)


ROOT = S.ROOT
WEB = os.path.join(ROOT, "web")
UPLOADS = os.path.join(ROOT, "uploads")
AVATARS = os.path.join(ROOT, "avatars")
# t-voice-memo: Python's table says audio/mp4a-latm for .m4a, which iOS Safari will not play
mimetypes.add_type("audio/mp4", ".m4a")
mimetypes.add_type("audio/aac", ".aac")
mimetypes.add_type("audio/ogg", ".opus")


def rname(rid, fallback):
    """A role's display name from roster.json (so messages say your HR's name, not a fixed one); fallback when it is not on the team."""
    for r in C.roster(ROOT).get("roles", []):
        if r.get("id") == rid and r.get("enabled", True) is not False:
            return r.get("name") or fallback
    return fallback


def ensure_live_files():
    for name in ("config", "roster"):
        live, ex = os.path.join(ROOT, f"{name}.json"), os.path.join(ROOT, f"{name}.example.json")
        if not os.path.exists(live) and os.path.exists(ex):
            shutil.copy(ex, live)
    for d in (UPLOADS, AVATARS, os.path.join(ROOT, "roles"), os.path.join(ROOT, "work")):
        os.makedirs(d, exist_ok=True)


def load_json(name, default):
    try:
        with open(os.path.join(ROOT, name), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return default


CONFIG = {}   # filled in place by server.main()


_comfy = {"online": None, "at": None, "configured": False}   # configured: config.json has a "comfy" block (otherwise the UI hides the row); set in load_config
START = time.time()  # t-imp-p4: server uptime for /api/health
try:   # t-home-usage: per-role token rollup; a broken module must not stop the dashboard
    import usage_roll
    USAGE = usage_roll.Roll(ROOT)
except Exception as e:  # noqa: BLE001
    print("usage_roll:", e)
    USAGE = None
_health = {"disk": None, "disk_t": 0, "work": None, "work_t": 0, "work_busy": False, "lock": threading.Lock()}


def _ts(v):
    try:
        return dt.datetime.fromisoformat(str(v).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        return None
