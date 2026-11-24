/* t-oss-struct S9 (A1): the page's one module entry. index.html loads it as <script type="module">; it imports the page scripts in the
   order the old <script> tags had. Each file is still a self-contained IIFE that talks to the others through window (App, UTExt, FX, ...),
   so for now these are side-effect imports; S10 turns app.js into real modules that import each other.
   Versions: the server writes an import map into the page (api/routes/web.py) that maps every /static/<file>.js to /static/<file>.js?v=<content
   hash>, so a relative import here gets a new URL exactly when that file changes. Never write ?v= by hand.
   Adding a file: import it here at the right place. Modules run in strict mode (a typo'd variable throws instead of making a global). */
import "./js/md.js";
import "./js/fx.js";
import "./js/diff.js";
import "./js/ext.js";
import "./js/app.js";
import "./js/market.js";
import "./js/transfer.js";
import "./js/preview.js";
import "./js/palette.js";
import "./js/home.js";
import "./js/team.js";
import "./js/widgets.js";
import "./js/core/quickguide.js";   // t-onboarding P0: 快捷指南 data (window.QGDATA)
import "./js/vendor/qrcode.js";   // t-onb-polish: QR code for the phone step (window.QRLite; Kazuhiko Arase, MIT)
import "./js/onboard.js";   // t-onboarding P0: 开工清单 widget / phone card, steward offline card, quick phrases, 点亮
import "./js/toast.js";
import "./js/pilldrop.js";   // t-pill-wellness: WebGL droplet morphs of the top pill (window.PillDrop, used by lookaway.js)
import "./js/lookaway.js";   // t-lookaway-fx: full-screen ink arrival + top pill; takes over toast.js notices (no setting since t-drop-arrival-fx)
import "./js/rolefiles.js";
import "./js/viewer.js";
import "./js/glass.js";
import "./js/mobile.js";
import "./js/push.js";
import "./js/welcome.js";   // t-hire-celebration: the new-teammate welcome (meta.hires)
import "./js/tour.js";   // t-onboard-tour: first-run welcome pages + anchored tour (meta.onboarding.tour)
