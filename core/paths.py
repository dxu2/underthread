"""Where everything lives (t-oss-struct B1). The one place that knows the install folder and the local/ layer.

ROOT is the folder that holds server.py and stateutil.py (core/'s parent). Moved here from stateutil.py, which still
re-exports every name, so `S.STATE`, `S.LOCAL`, `S.role_md(...)` keep working.
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE = os.path.join(ROOT, "state.json")
STATE_LOCK = os.path.join(ROOT, ".state.lock")
INBOX = os.path.join(ROOT, "inbox.jsonl")
ARCHIVE = os.path.join(ROOT, "archive.json")   # t-perf A: done cards older than ARCHIVE_DAYS live here, out of every poll
INBOX_LOCK = os.path.join(ROOT, ".inbox.lock")
ROLES_DIR = os.path.join(ROOT, "roles")

# ===== core / local split (docs/local.md). The repository is "core": an update may replace any tracked file. "local" is your own
# layer, never tracked and never written by an update: your rules (local/roles/<id>.md), manager notes (local/manager.md), and
# extensions (local/ext/<name>/). Read core first, then local; where they differ, local wins. No local/ folder = nothing changes.
LOCAL = os.path.abspath(os.environ.get("UNDERTHREAD_LOCAL") or os.path.join(ROOT, "local"))


def has_local():
    return os.path.isdir(LOCAL)


def local_path(*parts):
    return os.path.join(LOCAL, *parts)


def role_md(rid, write=False):
    """A role's rule file. Reading: local/roles/<id>.md when it exists, else roles/<id>.md. Writing (adopted lessons, hiring,
    transfers): local/roles/<id>.md whenever the local layer exists, so core rule files stay exactly as the update shipped them."""
    lp, cp = local_path("roles", f"{rid}.md"), os.path.join(ROLES_DIR, f"{rid}.md")
    if write:
        return lp if has_local() else cp
    return lp if os.path.exists(lp) else cp
