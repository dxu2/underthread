"""Page and files: index.html (extension web files, ?v= content hashes, the import map), sw.js, the manifest, and the file routes
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


_SKIP_DIRS = ("art", "fonts", "brand", "knit", "leather")   # image / font folders: no scripts, not worth walking on every page load


def _js_files():
    """t-oss-struct S9: every page script a module may import, as /static/ paths: web/**.js, local/web/**.js (which win), and each loaded
    extension's web/*.js as ext/<name>/... sw.js is the service worker (its own route), not a module."""
    out = set()
    for base in (WEB, os.path.join(S.LOCAL, "web")):
        if not os.path.isdir(base):
            continue
        for d, dirs, files in os.walk(base):
            rel = os.path.relpath(d, base)
            dirs[:] = [x for x in dirs if not x.startswith(".") and not (rel == "." and x in _SKIP_DIRS)]
            for fn in files:
                if fn.endswith(".js") and not (rel == "." and fn == "sw.js"):
                    out.add(fn if rel == "." else f"{rel}/{fn}".replace(os.sep, "/"))
    for name in sorted(REG.EXTS):
        d = REG.web_dir(name)
        if d:
            for fn in sorted(os.listdir(d)):
                if fn.endswith(".js"):
                    out.add(f"ext/{name}/{fn}")
    return sorted(out)


def _ver(rel, n=""):
    """?v= for /static/<rel>: the content hash, or N.<hash> when the reference still has a hand-written ?v=N (old local/ext.json, an old override)."""
    h = _vhash(rel)
    return (f"{n}.{h}" if n else h) if h else n


_STATIC_REF = re.compile(r'/static/([\w./@-]+\.[A-Za-z0-9]+)(?:\?v=(\d+))?(?=["\s,])')


def index_html():
    """web/index.html as the browser gets it (t-oss-struct S9):
    - extension web files (ext.json "web" blocks, and the old local/ext.json) added: css at <!-- EXT:CSS --> or after their "after" file;
      js after its "after" file as a plain <script> (it runs while the page parses, like before), else at <!-- EXT:JS --> after the
      module entry as <script defer> (it runs after the page modules, in order; "module": true makes it a <script type="module">);
      "drop" removes a line;
    - every /static/<file> reference gets ?v=<content hash> (js / css are cached for a year as immutable, so a changed file always gets a
      new URL; nobody writes ?v= by hand any more);
    - <!-- IMPORTMAP --> becomes <meta name="ut-build"> (a hash of the whole page, read by the 'board updated' pill), the import map
      (/static/<f>.js -> /static/<f>.js?v=<hash> for every page script, so relative imports between modules are versioned too) and one
      modulepreload per main.js import (fetched in parallel instead of after main.js)."""
    with open(os.path.join(WEB, "index.html"), encoding="utf-8") as f:
        lines = f.read().split("\n")
    blocks = REG.web_blocks()   # t-oss-struct S8: local/ext.json (as _legacy) first, then every loaded extension's ext.json "web"
    on = lambda ln, ref: f"/static/{ref}?" in ln or f'/static/{ref}"' in ln
    drop = [d for _, b in blocks for d in b.get("drop") or [] if isinstance(d, str) and d]
    lines = [ln for ln in lines if not any(on(ln, d) for d in drop)]
    for kind, mark in (("css", "<!-- EXT:CSS -->"), ("js", "<!-- EXT:JS -->")):
        for name, ext in blocks:
            for e in ext.get(kind) or []:
                ref = e.get("href") or e.get("src") if isinstance(e, dict) else e
                if not isinstance(ref, str) or not re.fullmatch(r"[\w./-]+", ref) or ".." in ref:
                    continue
                note = "local/ext.json" if name == "_legacy" else f"ext:{name}"
                after = e.get("after") if isinstance(e, dict) else None
                at = next((i for i, ln in enumerate(lines) if after and on(ln, after)), None)
                if kind == "css":
                    tag = f'<link rel="stylesheet" href="/static/{ref}"' + (f' media="{e["media"]}"' if isinstance(e, dict) and e.get("media") else "") + ">"
                elif isinstance(e, dict) and e.get("module") is True:
                    tag = f'<script type="module" src="/static/{ref}"></script>'
                else:
                    tag = f'<script src="/static/{ref}"></script>' if at is not None else f'<script defer src="/static/{ref}"></script>'
                if at is None:
                    at = next((i - 1 for i, ln in enumerate(lines) if mark in ln), len(lines) - 1)
                lines.insert(at + 1, tag + f"   <!-- {note} -->")
    html = _STATIC_REF.sub(lambda m: f"/static/{m.group(1)}?v={_ver(m.group(1), m.group(2) or '')}" if _ver(m.group(1), m.group(2) or "") else m.group(0),
                           "\n".join(lines))
    imports = {f"/static/{r}": f"/static/{r}?v={_vhash(r)}" for r in _js_files() if _vhash(r)}
    pre = []
    try:
        with open(web_file("main.js"), encoding="utf-8") as f:
            pre = [r for r in re.findall(r'^import\s+"\./([\w./-]+\.js)";', f.read(), re.M) if f"/static/{r}" in imports]
    except OSError:
        pass
    head = (f'<script type="importmap">{json.dumps({"imports": imports}, ensure_ascii=False, separators=(",", ":"))}</script>\n'
            + "".join(f'<link rel="modulepreload" href="{imports["/static/" + r]}">\n' for r in pre))
    import hashlib
    build = hashlib.sha1((html + head).encode("utf-8")).hexdigest()[:12]
    return html.replace("<!-- IMPORTMAP -->", f'<meta name="ut-build" content="{build}">\n' + head.rstrip("\n"), 1)


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
