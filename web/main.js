/* t-oss-struct S9 (A1): the page's one module entry. index.html loads it as <script type="module">; it imports the page scripts in the
   order the old <script> tags had. Each file is still a self-contained IIFE that talks to the others through window (App, UTExt, FX, ...),
   so for now these are side-effect imports; S10 turns app.js into real modules that import each other.
   Versions: the server writes an import map into the page (api/routes/web.py) that maps every /static/<file>.js to /static/<file>.js?v=<content
   hash>, so a relative import here gets a new URL exactly when that file changes. Never write ?v= by hand.
   Adding a file: import it here at the right place. Modules run in strict mode (a typo'd variable throws instead of making a global). */
import "./md.js";
import "./fx.js";
import "./diff.js";
import "./ext.js";
import "./app.js";
import "./market.js";
import "./transfer.js";
import "./preview.js";
import "./palette.js";
import "./home.js";
import "./team.js";
import "./widgets.js";
import "./toast.js";
import "./rolefiles.js";
import "./viewer.js";
import "./glass.js";
import "./mobile.js";
import "./push.js";
