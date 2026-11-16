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


def backups_dir(root=None):
    """Where backups go (core/backup.py, core/migrate.py; tools/update.py keeps a stdlib copy of this rule). local/backups
    when it exists, else .backups when it exists, else local/backups when there is a local/ layer, else .backups.
    t-oss-gen-s5: the folder that already holds backups wins, so a local/ layer created later (make_agents.py, preset.py,
    an adopted rule) never hides the .backups copies an install made before it had one."""
    root = root or ROOT
    loc = LOCAL if os.path.abspath(root) == ROOT else os.path.join(root, "local")
    lb, ob = os.path.join(loc, "backups"), os.path.join(root, ".backups")
    if os.path.isdir(lb):
        return lb
    if os.path.isdir(ob):
        return ob
    return lb if os.path.isdir(loc) else ob


def local_path(*parts):
    return os.path.join(LOCAL, *parts)


def role_md(rid, write=False):
    """A role's rule file. Reading: local/roles/<id>.md when it exists, else roles/<id>.md. Writing (adopted lessons, hiring,
    transfers): always local/roles/<id>.md (the caller creates the folder), so core rule files stay exactly as the update
    shipped them (t-oss-gen-s5: before, an install without local/ had its adopted rules written into core roles/<id>.md)."""
    lp, cp = local_path("roles", f"{rid}.md"), os.path.join(ROLES_DIR, f"{rid}.md")
    if write:
        return lp
    return lp if os.path.exists(lp) else cp
