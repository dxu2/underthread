"""t-oss-struct S9 (A1): the page scripts are ES modules loaded through web/main.js, versioned by the server's import map.

- web/index.html carries no hand-written ?v= (the server adds the content hash);
- every page script is imported by main.js, except the few that must stay classic (they run before the modules, in <head>);
- every imported file parses as a module (strict mode), when Node is installed;
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
            for f in ["main.js"] + main_imports():
                p = os.path.join(d, f.replace("/", "_") + ".mjs")
                shutil.copy(os.path.join(WEB, f), p)
                r = subprocess.run(["node", "--check", p], capture_output=True, text=True)
                self.assertEqual(r.returncode, 0, f"{f} does not parse as a module:\n{r.stderr[-800:]}")


if __name__ == "__main__":
    unittest.main()
