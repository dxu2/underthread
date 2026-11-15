"""t-oss-struct S9 (A1): the page scripts are ES modules loaded through web/main.js, versioned by the server's import map.

- web/index.html carries no hand-written ?v= (the server adds the content hash);
- every page script is imported by main.js, except the few that must stay classic (they run before the modules, in <head>);
- every imported file parses as a module (strict mode), when Node is installed;
- S10: the files app.js is split into (web/core/, web/views/, web/phone/) import only names their target file exports, and every one of
  them is reachable from main.js;
The rendered page (import map, modulepreload, ut-build) is checked by tests/smoke.py against a running server.
"""
import os
import re
import shutil
import subprocess
import tempfile
import unittest

from tests.unit._core import ROOT

WEB = os.path.join(ROOT, "web")
CLASSIC = {"lsmigrate.js", "splash.js", "sw.js"}   # head scripts that must run before the modules, and the service worker


def main_imports():
    with open(os.path.join(WEB, "main.js"), encoding="utf-8") as f:
        return re.findall(r'^import\s+"\./([\w./-]+\.js)";', f.read(), re.M)

IMPORT = re.compile(r'^import\s+\{([^}]*)\}\s+from\s+"(\.{1,2}/[\w./-]+\.js)";', re.M)
SIDE = re.compile(r'^import\s+(?:[^"\n]*?\bfrom\s+)?"(\.{1,2}/[\w./-]+\.js)";', re.M)


def exports_of(src):
    names = set()
    for block in re.findall(r'^export\s*\{([^}]*)\}', src, re.M):
        names |= {n.strip().split(" as ")[-1] for n in block.split(",") if n.strip()}
    names |= set(re.findall(r'^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([\w$]+)', src, re.M))
    return names


def graph():
    """every page script reachable from main.js by static imports, as paths relative to web/"""
    out, queue = [], ["main.js"]
    while queue:
        rel = queue.pop(0)
        with open(os.path.join(WEB, rel), encoding="utf-8") as f:
            src = f.read()
        for spec in SIDE.findall(src):
            r = os.path.normpath(os.path.join(os.path.dirname(rel), spec)).replace(os.sep, "/")
            if r not in out:
                out.append(r)
                queue.append(r)
    return out


class WebModules(unittest.TestCase):
    def test_no_hand_written_versions(self):
        with open(os.path.join(WEB, "index.html"), encoding="utf-8") as f:
            html = f.read()
        self.assertEqual(re.findall(r'/static/[\w./@-]+\?v=\d+', html), [], "the server adds ?v=<hash>; do not write ?v= in index.html")
        self.assertIn("<!-- IMPORTMAP -->", html)
        self.assertLess(html.index("<!-- IMPORTMAP -->"), html.index('<script type="module"'))
        self.assertEqual(re.findall(r'<script src="/static/[\w.-]+\.js"', html), ['<script src="/static/lsmigrate.js"', '<script src="/static/splash.js"'],
                         "page scripts are imported by main.js, not loaded with their own <script> tag")

    def test_every_script_is_imported(self):
        imp = main_imports()
        self.assertEqual(len(imp), len(set(imp)), "a file imported twice")
        for f in imp:
            self.assertTrue(os.path.isfile(os.path.join(WEB, f)), f"main.js imports a missing file: {f}")
        top = {f for f in os.listdir(WEB) if f.endswith(".js")}
        missing = top - set(imp) - CLASSIC - {"main.js"}
        self.assertEqual(missing, set(), "a web/*.js file nobody loads: import it in web/main.js (or list it in CLASSIC here)")
        self.assertLess(imp.index("ext.js"), imp.index("app.js"))
        self.assertLess(imp.index("app.js"), imp.index("widgets.js"))

    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_modules_parse_in_strict_mode(self):
        with tempfile.TemporaryDirectory() as d:
            for f in ["main.js"] + graph():
                p = os.path.join(d, f.replace("/", "_") + ".mjs")
                shutil.copy(os.path.join(WEB, f), p)
                r = subprocess.run(["node", "--check", p], capture_output=True, text=True)
                self.assertEqual(r.returncode, 0, f"{f} does not parse as a module:\n{r.stderr[-800:]}")

    def test_split_modules_link(self):
        """t-oss-struct S10: a named import must exist in the file it comes from (a missing one is a SyntaxError that stops the whole page),
        and every split file must be loaded."""
        reach = set(graph())
        for sub in ("core", "views", "phone"):
            d = os.path.join(WEB, sub)
            for dp, _, fs in os.walk(d):
                for fn in fs:
                    if fn.endswith(".js"):
                        rel = os.path.relpath(os.path.join(dp, fn), WEB).replace(os.sep, "/")
                        self.assertIn(rel, reach, f"{rel} is not imported by anything reachable from main.js")
        for rel in reach:
            with open(os.path.join(WEB, rel), encoding="utf-8") as f:
                src = f.read()
            for names, spec in IMPORT.findall(src):
                tgt = os.path.normpath(os.path.join(os.path.dirname(rel), spec)).replace(os.sep, "/")
                with open(os.path.join(WEB, tgt), encoding="utf-8") as f:
                    have = exports_of(f.read())
                want = {n.strip().split(" as ")[0] for n in names.split(",") if n.strip()}
                self.assertEqual(want - have, set(), f"{rel} imports names {tgt} does not export")


if __name__ == "__main__":
    unittest.main()
