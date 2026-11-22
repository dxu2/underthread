/* t-oss-struct S8: the front-end side of the extension registry (docs/extensions.md). Loaded before app.js; App.ext is this object.
   Core registers its own home widgets here too (widgets.js), so an extension's widget is a first-class one.

     UTExt.widget({ id, name: [zh, en], sizes: ["s","m","l"], size: "m", html(size, D), empty(D), calm: [zh, en], first })
         a home widget. html() returns the tile's inner HTML; D is the shared home data (waiting, busy, nr, shipped, days, ongoing, imgs);
         empty(D) true = the tile leaves the grid and calm becomes one quiet line above it. A widget new to this board is put into the
         layout once (at the front with first: true), and removing it sticks (meta.widgets.seen).
     UTExt.cardKind({ id, label: [zh, en] })     labels for a card kind (kinds from ext.json "card_kinds" are loaded from /api/ext)
     UTExt.toolPill(fn)                          fn(agent, toolKey, stale) -> extra HTML in a working agent's tool pill
     UTExt.statusRow(fn)                         fn(en) -> { t, s, lv: "ok"|"warn"|"bad" } or null: one more row in 系统状态
     UTExt.tourStep({ id, after, t: [zh, en], b: [zh, en], desk(), phone(), side })
         one more step in the first-run tour (web/js/tour.js). desk() / phone() return the element to ring (null = the step is skipped on
         that form); after = the core step id it follows ("chat" | "review" | "team"; default: the end). b may hold <em>; {mgr} = the steward.
   UTExt.api is the registry API number (same as core/registry.py API). Registering after the page has drawn redraws it. */
(() => {
  const W = new Map(), K = {}, PILLS = [], ROWS = [], TOUR = [];
  let tm = 0;
  const changed = () => { clearTimeout(tm); tm = setTimeout(() => { const A = window.App; if (A && A.refreshPage) try { A.refreshPage(); } catch (e) { } }, 30); };
  const idOk = id => typeof id === "string" && /^[a-z][a-z0-9_-]{0,23}$/.test(id);
  const X = {
    api: 1,
    widget(spec) {
      if (!spec || !idOk(spec.id) || typeof spec.html !== "function") { console.warn("UTExt.widget: needs id (a-z0-9_-) and html()", spec); return; }
      const sizes = (spec.sizes || ["m"]).filter(z => ["s", "m", "l", "w"].includes(z));   /* t-onboarding P0: w = a full-width row (the 开工清单) */
      W.set(spec.id, { ...spec, sizes: sizes.length ? sizes : ["m"], name: spec.name || [spec.id, spec.id], size: sizes.includes(spec.size) ? spec.size : sizes.includes("m") ? "m" : sizes[0] });
      changed();
    },
    widgets: () => [...W.values()],
    widgetOf: id => W.get(id),
    cardKind(spec) {
      if (!spec || !idOk(spec.id)) return;
      const l = spec.label || [spec.id, spec.id];
      K[spec.id] = { id: spec.id, label: [l[0] || spec.id, l[1] || l[0] || spec.id], ext: spec.ext || "web" };
      changed();
    },
    kinds: () => ({ ...K }),
    /* app.js t(): "k_<id>" (the kind) and "<id>" (the review tag) for a registered kind; undefined for anything else */
    label(key, lang) {
      const id = String(key).replace(/^k_/, ""), k = K[id];
      return k ? k.label[lang === "en" ? 1 : 0] : undefined;
    },
    toolPill(fn) { if (typeof fn === "function") { PILLS.push(fn); const A = window.App; if (A && A.addToolExtra) A.addToolExtra(fn); } },
    pills: () => PILLS.slice(),
    statusRow(fn) { if (typeof fn === "function") ROWS.push(fn); },
    tourStep(spec) { if (spec && idOk(spec.id) && Array.isArray(spec.t) && Array.isArray(spec.b) && !TOUR.some(x => x.id === spec.id)) TOUR.push(spec); },   /* t-onboard-tour */
    tourSteps: () => TOUR.slice(),
    statusRows(en) { return ROWS.map(fn => { try { return fn(en); } catch (e) { return null; } }).filter(r => r && r.t); },
    info: null,   // GET /api/ext, once
  };
  window.UTExt = X;
  /* card kinds an extension declared in ext.json (core kinds have their own labels in app.js) */
  try {
    fetch("/api/ext").then(r => r.ok ? r.json() : null).then(j => {
      if (!j) return;
      X.info = j;
      (j.card_kinds || []).forEach(k => { if (k.ext !== "core" && !K[k.id]) X.cardKind({ id: k.id, label: k.label, ext: k.ext }); });
    }).catch(() => { });
  } catch (e) { }
})();
