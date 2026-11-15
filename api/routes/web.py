"""Page and files: index.html (with local/ext.json applied and ?v= content hashes), sw.js, the manifest, and the file routes
/static/ (local/web/ wins over web/), /uploads/, /avatars/, /work/."""
import json
import os
import re
from urllib.parse import unquote

from api.ctx import S, WEB, UPLOADS, AVATARS, ROOT
from api.router import route, NEXT
from core import registry as REG


def ext_web():
    """The old way (until 0.3.0; index_html now reads core/registry.py web_blocks, which includes this file as _legacy).
    local/ext.json: {"css": [{"href": "x.css", "after": "skin-ink.css"}], "js": [{"src": "x.js"}], "drop": ["oss.css"]}.
    Files resolve like /static/ (local/web/ first, then web/). Missing or broken file = no extras."""
    try:
        with open(S.local_path("ext.json"), encoding="utf-8") as f:
            j = json.load(f)
        return j if isinstance(j, dict) else {}
    except (OSError, ValueError):
        return {}


def ext_file(rel):
    """t-oss-struct S8: /static/ext/<name>/<file> -> local/ext/<name>/web/<file> of a loaded extension; None when it is not one."""
    m = re.fullmatch(r"ext/([\w.-]+)/(.+)", rel)
    if not m:
        return None
    d = REG.web_dir(m.group(1))
    if not d:
        return ""
    p = os.path.realpath(os.path.join(d, m.group(2)))
    return p if p.startswith(os.path.realpath(d) + os.sep) else ""


def web_file(rel):
    """/static/<rel>: local/web/<rel> wins over web/<rel> (core / local split); ext/<name>/... is an extension's web/ folder."""
    xf = ext_file(rel)
    if xf is not None:
        return xf
    lp = os.path.join(S.LOCAL, "web", rel)
    return lp if os.path.isfile(lp) and os.path.realpath(lp).startswith(os.path.realpath(os.path.join(S.LOCAL, "web")) + os.sep) else os.path.join(WEB, rel)


_VH = {}   # (path, mtime_ns, size) -> short content hash


def _vhash(rel):
    p = web_file(rel)
    try:
        st = os.stat(p)
    except OSError:
        return ""
    k = (p, st.st_mtime_ns, st.st_size)
    h = _VH.get(k)
    if h is None:
        import hashlib
        with open(p, "rb") as f:
            h = _VH[k] = hashlib.sha1(f.read()).hexdigest()[:8]
    return h


def index_html():
    """web/index.html with local/ext.json applied (<!-- EXT:CSS --> / <!-- EXT:JS --> or after an anchor file; "drop" removes a line),
    and every /static/<f>?v=N turned into ?v=N.<content hash>: js / css are cached as immutable, so a file that changes without a
    ?v= bump (an update, a local override) still gets a new URL."""
    with open(os.path.join(WEB, "index.html"), encoding="utf-8") as f:
        lines = f.read().split("\n")
    blocks = REG.web_blocks()   # t-oss-struct S8: local/ext.json (as _legacy) first, then every loaded extension's ext.json "web"
    drop = [d for _, b in blocks for d in b.get("drop") or [] if isinstance(d, str) and d]
    lines = [ln for ln in lines if not any(f"/static/{d}?" in ln or f'/static/{d}"' in ln for d in drop)]
    for kind, mark in (("css", "<!-- EXT:CSS -->"), ("js", "<!-- EXT:JS -->")):
        for name, ext in blocks:
            for e in ext.get(kind) or []:
                ref = e.get("href") or e.get("src") if isinstance(e, dict) else e
                if not isinstance(ref, str) or not re.fullmatch(r"[\w./-]+", ref) or ".." in ref:
                    continue
                note = "local/ext.json" if name == "_legacy" else f"ext:{name}"
                tag = (f'<link rel="stylesheet" href="/static/{ref}?v=1"' + (f' media="{e["media"]}"' if isinstance(e, dict) and e.get("media") else "") + ">"
                       if kind == "css" else f'<script src="/static/{ref}?v=1"></script>') + f"   <!-- {note} -->"
                after = e.get("after") if isinstance(e, dict) else None
                at = next((i for i, ln in enumerate(lines) if after and f"/static/{after}?" in ln), None)
                if at is None:
                    at = next((i - 1 for i, ln in enumerate(lines) if mark in ln), len(lines) - 1)
                lines.insert(at + 1, tag)
    html = "\n".join(lines)
    return re.sub(r'/static/([\w./-]+)\?v=(\d+)', lambda m: f"/static/{m.group(1)}?v={m.group(2)}.{_vhash(m.group(1))}" if _vhash(m.group(1)) else m.group(0), html)


@route("GET", "/sw.js")
def _sw(h, u, q):
    return h._file(os.path.join(WEB, "sw.js"), {"Service-Worker-Allowed": "/"})


@route("GET", "/manifest.webmanifest")
def _manifest(h, u, q):
    return h._file(os.path.join(WEB, "manifest.webmanifest"))


@route("GET", "/")
@route("GET", "/index.html")
def _index(h, u, q):
    return h._send(200, index_html().encode("utf-8"), "text/html; charset=utf-8")


@route("GET", "/avatars/_s/index.json", late=True)
def _avatar_index(h, u, q):
    if os.path.exists(os.path.join(AVATARS, "_s", "index.json")):
        return NEXT
    return h._send(200, {})   # audit SM-05: no small-avatar manifest yet (tools/avatar_sizes.py not run): empty, not a console 404


def _files(prefix, base):
    def serve(h, u, q):
        p = h._safe(base, unquote(u.path[len(prefix):]))
        xf = ext_file(unquote(u.path[len(prefix):])) if prefix == "/static/" else None
        if xf is not None:   # t-oss-struct S8: an extension's own web/ folder
            if not xf or not os.path.isfile(xf):
                return h._send(404, {"error": "not found"})
            return h._file(xf, media="static")
        if prefix == "/static/" and os.path.isdir(os.path.join(S.LOCAL, "web")):   # core / local split: local/web/ wins
            lp = h._safe(os.path.join(S.LOCAL, "web"), unquote(u.path[len(prefix):]))
            if lp and os.path.isfile(lp):
                p = lp   # t-voice-memo: %-encoded names (新录音_12.m4a) 404ed before
        if not p:
            return h._send(403, {"error": "forbidden"})
        return h._file(p, media="static" if prefix == "/static/" else True)
    route("GET", prefix, prefix=True, late=True)(serve)


for _p, _b in (("/static/", WEB), ("/uploads/", UPLOADS), ("/avatars/", AVATARS), ("/work/", os.path.join(ROOT, "work"))):
    _files(_p, _b)
