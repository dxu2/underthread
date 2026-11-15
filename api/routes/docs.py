"""Read-only docs and role memory for the dashboard's 文档 / 记忆 views: /api/docs, /api/doc, /api/memory."""
import os
import re

from api.ctx import C, ROOT
from api.router import route


DOC_DIRS = ["roles", "docs", ".claude/agents", ".claude/skills", "local/roles"]   # local/: your own layer (stateutil.LOCAL)
DOC_FILES = ["SETUP-GUIDE.md", "team.md", "policy.md", "manager.md", "manager-handoff.md",
             "local/manager.md", "local/dispatch.md", "local/team.md", "local/policy.md", "local/CLAUDE.md"]


def list_docs():
    out = []
    for f in DOC_FILES:
        if os.path.exists(os.path.join(ROOT, f)):
            out.append({"path": f, "group": "core"})
    for d in DOC_DIRS:
        base = os.path.join(ROOT, d)
        if not os.path.isdir(base):
            continue
        for dirpath, _, files in os.walk(base):
            for f in sorted(files):
                if f.endswith(".md"):
                    rel = os.path.relpath(os.path.join(dirpath, f), ROOT)
                    out.append({"path": rel, "group": d})
    return out


def read_doc(path):
    allowed = {d["path"] for d in list_docs()}
    if path not in allowed:
        raise ValueError("not a dashboard doc")
    with open(os.path.join(ROOT, path), encoding="utf-8") as f:
        return f.read()


# ---- role memory viewer (read-only). Whitelist: <ROOT>/.claude/agent-memory/<agent_name>/ for roster agents,
# plus ONE explicit outside dir: the manager's own memory under ~/.claude/projects/<slug of ROOT>/memory.
# Only direct *.md files in those dirs are served; ids come from roster.json, never from a client path.
MEM_BASE = os.path.join(ROOT, ".claude", "agent-memory")
MANAGER_MEM = os.path.join(os.path.expanduser("~"), ".claude", "projects", re.sub(r"[^A-Za-z0-9]", "-", ROOT), "memory")


def _mem_dir(rid):
    if rid == "manager":
        return MANAGER_MEM, True
    for r in C.roster(ROOT).get("roles", []):
        if r.get("id") == rid and r.get("agent_name") and re.fullmatch(r"[A-Za-z0-9_-]+", r["agent_name"]):
            return os.path.join(MEM_BASE, r["agent_name"]), False
    raise ValueError("unknown role")


def _mem_files(d):
    if not os.path.isdir(d):
        return []
    real = os.path.realpath(d)
    names = [f for f in os.listdir(d) if f.endswith(".md") and not f.startswith(".")]
    names.sort(key=lambda f: (f != "MEMORY.md", f))
    out = []
    for f in names:
        fp = os.path.realpath(os.path.join(d, f))
        if os.path.dirname(fp) == real and os.path.isfile(fp):
            out.append((f, fp))
    return out


def role_memory(rid=None):
    if rid is None:
        counts = {}
        for r in C.roster(ROOT).get("roles", []):
            try:
                counts[r["id"]] = len([f for f in _mem_files(_mem_dir(r["id"])[0]) if f[0] != "MEMORY.md"])
            except ValueError:
                pass
        return {"counts": counts}
    d, external = _mem_dir(rid)
    files = []
    for name, fp in _mem_files(d):
        with open(fp, encoding="utf-8", errors="replace") as fh:
            files.append({"name": name, "text": fh.read(200000)})
    return {"id": rid, "dir": d if external else os.path.relpath(d, ROOT), "external": external, "readonly": True, "files": files}


@route("GET", "/api/docs")
def _docs(h, u, q):
    return h._send(200, list_docs())


@route("GET", "/api/doc")
def _doc(h, u, q):
    return h._send(200, {"path": q["path"][0], "text": read_doc(q["path"][0])})


@route("GET", "/api/memory")
def _memory(h, u, q):
    try:
        return h._send(200, role_memory(q.get("id", [None])[0]))
    except ValueError as ex:
        return h._send(404, {"error": str(ex)})
