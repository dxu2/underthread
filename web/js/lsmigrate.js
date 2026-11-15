/* t-oss-struct E1, browser side: ordered localStorage migrations, run before any other script reads a key.
   rt.schema = how many steps this browser has run. A step runs once, in order, and must be safe to run twice.
   Old key renamed or dropped by an update = a new step at the end of STEPS (never edit or reorder a shipped one).
   A device that is ahead (newer page opened, then the code rolled back) is left alone. Load: first <script> in index.html. */
(function () {
  var STEPS = [
    /* 1 */ function (L) {   // t-mail-unread-pill + t-ui-fix-r3 R3-07 (were removeItem calls on every app.js boot)
      L.removeItem("rt.mailUnread");
      L.removeItem("rt.esMiss");
    }
  ];
  window.RT_LS_SCHEMA = STEPS.length;
  try {
    var L = window.localStorage, v = parseInt(L.getItem("rt.schema") || "0", 10) || 0;
    for (var i = v; i < STEPS.length; i++) {
      try { STEPS[i](L); } catch (e) { }
      L.setItem("rt.schema", String(i + 1));
    }
  } catch (e) { }   // storage blocked (private mode): nothing stored, nothing to migrate
})();
