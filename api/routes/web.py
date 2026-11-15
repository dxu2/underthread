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


# t-oss-tidy: web/ was sorted into js/, css/ and icons/. Old /static/ names keep working: an old open page or home-screen app, an
# extension's "after" / "drop" anchor ("skin-ink.css", "icon-180.png") and a local/web/ override saved under the old name all resolve.
_MOVED_JS = ("app diff ext fx glass home lsmigrate market md mobile palette preview push rolefiles splash team toast transfer viewer "
             "widgets").split()
_MOVED_CSS = "glass oss skin-ink splash team texture-knit texture-leather theme-ut widgets".split()
MOVED = {**{f"{n}.js": f"js/{n}.js" for n in _MOVED_JS}, **{f"{n}.css": f"css/{n}.css" for n in _MOVED_CSS},
         **{f: f"icons/{f}" for f in ("favicon-16.png", "favicon-32.png", "favicon.ico", "icon-180.png", "icon-192.png", "icon-512.png")}}
MOVED_DIRS = {"core/": "js/core/", "views/": "js/views/", "phone/": "js/phone/"}


def moved(rel):
    """The new /static/ path of an old (pre t-oss-tidy) one, or None."""
    if rel in MOVED:
        return MOVED[rel]
    return next((new + rel[len(old):] for old, new in MOVED_DIRS.items() if rel.startswith(old)), None)


def _was(rel):
    """The old name of a moved /static/ path (for local/web/ overrides saved before the move), or None."""
    for old, new in MOVED.items():
        if new == rel:
            return old
    return next((old + rel[len(new):] for old, new in MOVED_DIRS.items() if rel.startswith(new)), None)


def _local_web(rel):
    lw = os.path.join(S.LOCAL, "web")
    for r in (rel, _was(rel)):
        if r:
            lp = os.path.join(lw, r)
            if os.path.isfile(lp) and os.path.realpath(lp).startswith(os.path.realpath(lw) + os.sep):
                return lp
    return None


def web_file(rel):
    """/static/<rel>: local/web/<rel> wins over web/<rel> (core / local split); ext/<name>/... is an extension's web/ folder.
    A pre-tidy name (app.js, skin-ink.css, core/x.js) resolves to where the file lives now."""
    xf = ext_file(rel)
    if xf is not None:
        return xf
    lp = _local_web(rel)
    if lp:
        return lp
    p = os.path.join(WEB, rel)
    if not os.path.exists(p) and moved(rel):
        return web_file(moved(rel))
    return p


_VH = {}   # (path, mtime_ns, size) -> short content hash


def _vhash(rel):
    p = web_file(rel)
    if not os.path.isfile(p) and css_parts(rel):   # S11: a split sheet's old name = its joined parts
        import hashlib
        return hashlib.sha1(css_bundle(rel)).hexdigest()[:8]
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


CSS_GROUPS = ("style.css", "mobile.css")   # t-oss-struct S11: cut into web/css/<stem>/NN-<section>.css; the parts in file-name order = the old file


def css_parts(name):
    """t-oss-struct S11: the section files of a split stylesheet, in cascade order, as /static/ paths (web/css/<stem>/*.css plus
    local/web/css/<stem>/*.css, where a same-named local file replaces one section and a new name slots in by its number).
    None when <name> is not split, or when local/web/<name> exists: an old whole-file override still replaces the whole sheet."""
    if name not in CSS_GROUPS or os.path.isfile(os.path.join(S.LOCAL, "web", name)):
        return None
    sub, names = f"css/{name[:-4]}", set()
    for base in (WEB, os.path.join(S.LOCAL, "web")):
        d = os.path.join(base, "css", name[:-4])
        if os.path.isdir(d):
            names.update(f for f in os.listdir(d) if f.endswith(".css") and not f.startswith("."))
    return [f"{sub}/{f}" for f in sorted(names)] or None


def css_bundle(name):
    """/static/style.css (or mobile.css) after the split: the parts joined, byte-identical to the old file (an old cached page, a link
    from outside). None when it is not a split sheet."""
    parts = css_parts(name)
    if not parts:
        return None
    out = []
    for r in parts:
        with open(web_file(r), "rb") as f:
            out.append(f.read())
    return b"".join(out)


_SKIP_DIRS = ("art", "fonts", "brand", "knit", "leather", "icons")   # image / font folders: no scripts, not worth walking on every page load


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


_IMPORT = re.compile(r'^import\s+(?:[^"\n]*?\bfrom\s+)?"(\.{1,2}/[\w./-]+\.js)";', re.M)


def _module_graph(entry):
    """t-oss-struct S10: every page script reachable from main.js through static imports (main.js's own imports first, in order, then the
    files they import, e.g. core/*.js), so each gets a modulepreload and the browser fetches them in parallel instead of one level at a time."""
    out, queue = [], [entry]
    while queue:
        rel = queue.pop(0)
        try:
            with open(web_file(rel), encoding="utf-8") as f:
                src = f.read()
        except (OSError, ValueError):
            continue
        for spec in _IMPORT.findall(src):
            r = os.path.normpath(os.path.join(os.path.dirname(rel), spec)).replace(os.sep, "/")
            if r.startswith("..") or r in out or r == entry:
                continue
            out.append(r)
            queue.append(r)
    return out


_STATIC_REF = re.compile(r'/static/([\w./@-]+\.[A-Za-z0-9]+)(?:\?v=(\d+))?(?=["\s,])')


def index_html():
    """web/index.html as the browser gets it (t-oss-struct S9):
    - extension web files (ext.json "web" blocks, and the old local/ext.json) added: css at <!-- EXT:CSS --> or after their "after" file;
      js after its "after" file as a plain <script> (it runs while the page parses, like before), else at <!-- EXT:JS --> after the
      module entry as <script defer> (it runs after the page modules, in order; "module": true makes it a <script type="module">);
      "drop" removes a line;
    - a split stylesheet (style.css, mobile.css; S11) becomes one <link> per section file, same attributes (media) and same place, so an
      extension anchored "after": "style.css" still lands after the whole sheet;
    - every /static/<file> reference gets ?v=<content hash> (js / css are cached for a year as immutable, so a changed file always gets a
      new URL; nobody writes ?v= by hand any more);
    - <!-- IMPORTMAP --> becomes <meta name="ut-build"> (a hash of the whole page, read by the 'board updated' pill), the import map
      (/static/<f>.js -> /static/<f>.js?v=<hash> for every page script, so relative imports between modules are versioned too) and one
      modulepreload per main.js import (fetched in parallel instead of after main.js)."""
    with open(os.path.join(WEB, "index.html"), encoding="utf-8") as f:
        lines = f.read().split("\n")
    blocks = REG.web_blocks()   # t-oss-struct S8: local/ext.json (as _legacy) first, then every loaded extension's ext.json "web"
    on = lambda ln, ref: any(f"/static/{r}?" in ln or f'/static/{r}"' in ln for r in (ref, moved(ref)) if r)   # t-oss-tidy: old names match
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
    for name in CSS_GROUPS:
        parts = css_parts(name)
        at = next((i for i, ln in enumerate(lines) if parts and "<link" in ln and on(ln, name)), None)
        if at is not None:
            ln = lines[at]
            lines[at:at + 1] = [ln.replace(f"/static/{name}", f"/static/{r}", 1) for r in parts]
    html = _STATIC_REF.sub(lambda m: f"/static/{m.group(1)}?v={_ver(m.group(1), m.group(2) or '')}" if _ver(m.group(1), m.group(2) or "") else m.group(0),
                           "\n".join(lines))
    imports = {f"/static/{r}": f"/static/{r}?v={_vhash(r)}" for r in _js_files() if _vhash(r)}
    pre = [r for r in _module_graph("main.js") if f"/static/{r}" in imports]
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
            else:
                lp = _local_web(unquote(u.path[len(prefix):]))   # t-oss-tidy: an override saved under the pre-tidy name
                if lp:
                    p = lp
        if not p:
            return h._send(403, {"error": "forbidden"})
        if prefix == "/static/" and not os.path.isfile(p):
            new = moved(unquote(u.path[len(prefix):]))   # t-oss-tidy: a pre-tidy path (old page, old home-screen app, bookmark)
            if new and ".." not in new.split("/"):
                np = web_file(new)
                if np and os.path.isfile(np):
                    p = np
        if prefix == "/static/" and not os.path.isfile(p):
            b = css_bundle(unquote(u.path[len(prefix):]))   # S11: the old name of a split sheet
            if b is not None:
                return h._send(200, b, "text/css; charset=utf-8", {"Cache-Control": "no-cache"})
        return h._file(p, media="static" if prefix == "/static/" else True)
    route("GET", prefix, prefix=True, late=True)(serve)


for _p, _b in (("/static/", WEB), ("/uploads/", UPLOADS), ("/avatars/", AVATARS), ("/work/", os.path.join(ROOT, "work"))):
    _files(_p, _b)
