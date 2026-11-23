/* t-home-sml P1: every core home widget offers S / M / L in 编辑, each size draws its own content without overflow, the grid packs them dense,
 * and meta.widgets.chosen stops the auto shrink (a short L tile drops to M) only for a size the user picked. Old [id, size] layouts without
 * chosen look as before. Also guards the knit week-L 「-9-9」 bug (each count is a plain number).
 *   node tests/e2e/drive.js run tests/e2e/journeys/homesml.js --out work/<item>/verify/<run> --engines chromium,webkit
 * Skins: knit (Underthread + knit1) and ink. The board's own layout is put back.
 * P2 (phone 390): the list home stays the default; 设置 · 手机首页 = 小组件 turns on the same widgets in 2 columns (S = one column, M = full row,
 * L = full row × 2), 编辑 by a hold (no drag on a phone), 44px controls, no overflow, the ink greeting stays (the D1 strip does not: same counts as the widgets). */
const CORE = ["review", "usage", "busy", "replies", "today", "week", "ongoing", "media"];
const act = (p, body) => p.evaluate(b => fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(r => r.status), body);
const boot = async (c, skin, lang) => {
  await c.p.evaluate(([sk, lg]) => { const s = (k, v) => localStorage.setItem("rt." + k, JSON.stringify(v)); s("lang", lg || "zh"); s("ut", sk === "ink" ? "ink" : "ut"); s("texture", "knit1"); s("chatFold", false);
    localStorage.removeItem("rt.widgets"); localStorage.removeItem("rt.wgChosen"); }, [skin, lang]);
  await c.p.reload({ waitUntil: "load" });
  await c.p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash") && document.querySelector("#wg .wg-grid > .wg"), null, { timeout: 20000 });
  await c.sleep(1800);
};
const editOn = async c => { await c.p.evaluate(() => { const b = document.querySelector("#wg [data-wg-edit]:not(.on)"); if (b) b.click(); }); await c.sleep(700); };
const editOff = async c => { await c.p.evaluate(() => { const b = document.querySelector("#wg [data-wg-edit].on"); if (b) b.click(); }); await c.sleep(500); };
/* every tile: its size class, its box, and any visible descendant that sticks out of it (ellipsis / clamp / overflow:hidden parents are fine) */
const look = p => p.evaluate(() => {
  const g = document.querySelector("#wg .wg-grid"), G = g.getBoundingClientRect(), cols = getComputedStyle(g).gridTemplateColumns.split(" ").length;
  const out = {};
  g.querySelectorAll(":scope > .wg[data-wg]").forEach(t => {
    const R = t.getBoundingClientRect(), bad = [];
    t.querySelectorAll("*").forEach(e => {
      if (e.closest(".wg-sz, .wg-x, .wg-mv, .wg-eband, .sct-pin, .bpl-knot, .yk")) return;
      if (e.children.length && e.tagName !== "SVG") return;   /* leaves only: a box whose padding overhangs is fine, its text is what counts */
      const r = e.getBoundingClientRect(); if (!r.width || !r.height) return;
      const cs = getComputedStyle(e); if (cs.visibility === "hidden" || cs.position === "fixed") return;
      for (let a = e.parentElement; a && a !== t; a = a.parentElement) { const s = getComputedStyle(a); if (s.overflow !== "visible" || s.display === "none") return; }
      if (r.right > R.right + 1.5 || r.bottom > R.bottom + 1.5 || r.left < R.left - 1.5) bad.push((e.className && e.className.baseVal == null ? e.className : e.tagName) + " " + Math.round(r.right - R.right) + "," + Math.round(r.bottom - R.bottom));
    });
    /* user 11-22 19:43 「M 都出去了」: the tile itself must not scroll, and no child box (pill, row) may leave the tile's rect */
    /* the yarn kitten (t-yarn-anim: a role working 5+ min wins a 1-in-3 draw seeded from id + since, so it shows on some runs only) draws its
       effect layer at 130% and its tap area past the patch; the tile clips both (overflow: hidden), they are decoration like the .yk leaves
       skipped above, so they are left out of the scroll size. Everything else, the kitten's body included, still counts. */
    const deco = [...t.querySelectorAll(".yk > .yk-fx, .yk > .yk-hit")], was = deco.map(e => e.style.display);
    deco.forEach(e => { e.style.display = "none"; });
    if (t.scrollHeight > t.clientHeight + 1) bad.push("scrollHeight " + t.scrollHeight + ">" + t.clientHeight);
    deco.forEach((e, i) => { e.style.display = was[i]; });
    t.querySelectorAll(":scope > *, :scope > * > *").forEach(e => { if (e.closest(".wg-sz, .wg-x, .wg-mv, .wg-eband, .sct-pin, .bpl-knot, .yk, .wg-top, .wg-eb, .wg-bg, .wg-sh") || getComputedStyle(e).position === "fixed") return;
      const r = e.getBoundingClientRect(); if (!r.width || !r.height) return;
      if (r.right > R.right + 1.5 || r.bottom > R.bottom + 1.5 || r.left < R.left - 1.5 || r.top < R.top - 1.5) bad.push("box " + (typeof e.className === "string" ? e.className.split(" ")[0] : e.tagName) + " " + Math.round(r.right - R.right) + "," + Math.round(r.bottom - R.bottom)); });
    out[t.dataset.wg] = { cls: t.className, w: Math.round(R.width), h: Math.round(R.height), bad: bad.slice(0, 4) };
  });
  return { cols, gw: Math.round(G.width), tiles: out, order: [...g.children].filter(t => t.dataset.wg).map(t => t.dataset.wg) };
});
const cnt = p => p.evaluate(() => ({ nr: App.newReplies().length, waiting: document.querySelector("#wg .wg-review .wg-big") && document.querySelector("#wg .wg-review .wg-big").textContent }));
const pboot = async (c, skin, ph) => {
  await c.p.evaluate(([sk, v]) => { const s = (k, x) => localStorage.setItem("rt." + k, JSON.stringify(x)); s("lang", "zh"); s("ut", sk === "ink" ? "ink" : "ut"); s("texture", "knit1"); s("setTab", "general");
    if (v) s("phoneHome", v); else localStorage.removeItem("rt.phoneHome"); localStorage.removeItem("rt.widgets"); localStorage.removeItem("rt.wgChosen"); }, [skin, ph]);
  await c.p.reload({ waitUntil: "load" });
  await c.p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash") && document.getElementById("pagebody") && document.getElementById("pagebody").children.length, null, { timeout: 20000 });
  await c.sleep(1800);
};
const home = p => p.evaluate(() => ({ home: document.documentElement.dataset.home, wg: !!document.querySelector("#wg .wg-grid"), ob: !!document.getElementById("officebox") && !document.getElementById("officebox").hidden,
  list: !!document.querySelector("#pagebody .ph-bar"), sw: document.documentElement.scrollWidth, vw: innerWidth }));
async function phone(c) {
  const p = c.p, errs = [];
  p.on("pageerror", e => { const m = String(e).split("\n")[0]; if (!/due to access control checks/.test(m)) errs.push(m); });
  await pboot(c, "knit", null);
  const orig = await p.evaluate(() => JSON.parse(JSON.stringify(App.ST.meta.widgets || null)));
  try {
    /* 1. an existing install: nothing picked, the phone home is the list home exactly as before */
    const h0 = await home(p);
    c.check("phone default: list home (data-home classic, no widget grid, D1 strip, sort bar)", h0.home === "classic" && !h0.wg && h0.ob && h0.list, h0);
    await c.shot("p-default-list");

    /* 2. 设置 · 手机首页: 列表 is on; tap 小组件 */
    await c.go("settings"); await c.sleep(800);
    const row = await p.evaluate(() => { const b = [...document.querySelectorAll("[data-phhome-set]")]; return b.map(x => x.dataset.phhomeSet + (x.classList.contains("on") ? "*" : "")); });
    c.check("设置 has 手机首页 with 列表 on", row.join(",") === "list*,widgets", row);
    await p.evaluate(() => document.querySelector('[data-phhome-set="widgets"]').click()); await c.sleep(400);
    c.check("tapping 小组件 stores rt.phoneHome = widgets and flips the segment in place", await p.evaluate(() => localStorage.getItem("rt.phoneHome") === '"widgets"' && document.querySelector('[data-phhome-set="widgets"]').classList.contains("on")));
    await c.go("review"); await c.sleep(1500);
    const h1 = await home(p);
    c.check("phone widget home: data-home widgets, grid drawn, no list / D1 strip (the widgets carry those counts), no sideways scroll", h1.home === "widgets" && h1.wg && !h1.ob && !h1.list && h1.sw <= h1.vw, h1);

    /* 3. each size, both skins: S one column, M the full row, L the full row and two rows; nothing sticks out */
    for (const skin of ["knit", "ink"]) {
      for (const z of ["s", "m", "l", "mix"]) {
        const L = z === "mix" ? [["review", "m"], ["usage", "s"], ["busy", "s"], ["replies", "l"], ["today", "s"], ["week", "m"], ["ongoing", "l"], ["media", "s"]] : CORE.map(k => [k, z]);
        await act(p, { kind: "widget_layout", layout: L, chosen: CORE });
        await pboot(c, skin, "widgets");
        await p.waitForFunction(() => document.querySelector("#wg .wg-grid > .wg"), null, { timeout: 10000 });
        const v = await look(p), gap = await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector("#wg .wg-grid")).columnGap) || 0);
        const col = (v.gw - gap) / 2, row = await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector("#wg .wg-grid")).gridAutoRows) || 0);
        const bad = Object.entries(v.tiles).filter(([k, t]) => { const zz = k === "review" ? null : (L.find(x => x[0] === k) || [])[1]; if (!zz) return false;
          return zz === "s" ? Math.abs(t.w - col) > 2 : zz === "m" ? Math.abs(t.w - v.gw) > 2 || Math.abs(t.h - row) > 2 : Math.abs(t.w - v.gw) > 2 || Math.abs(t.h - (2 * row + gap)) > 2; }).map(([k, t]) => [k, t.w, t.h]);
        c.check(`phone ${skin} ${z}: 2 columns, S = one column, M = full row, L = full row × 2`, v.cols === 2 && !bad.length, { cols: v.cols, gw: v.gw, col, row, bad });
        const over = Object.entries(v.tiles).filter(([, t]) => t.bad.length).map(([k, t]) => [k, t.bad]);
        c.check(`phone ${skin} ${z}: no content sticks out of any tile`, !over.length, over);
        c.check(`phone ${skin} ${z}: no sideways scroll`, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        if (z === "mix") {
          const hi = await p.evaluate(() => { const e = document.getElementById("inkhello"); return e ? getComputedStyle(e).display !== "none" && e.getBoundingClientRect().height > 0 : null; });
          if (skin === "ink") c.check("phone ink: the greeting still shows above the widgets", hi === true, hi);
          await p.evaluate(() => document.querySelector("#wg").scrollIntoView()); await c.shot(`p-${skin}-mix`);
        }
      }
    }

    /* 4. 编辑 on the phone: a hold opens it without picking the tile up, controls are 44px, S M L and ← → work */
    await act(p, { kind: "widget_layout", layout: [["review", "m"], ["busy", "m"], ["replies", "m"], ["usage", "l"], ["today", "m"], ["week", "m"], ["ongoing", "m"], ["media", "m"]] });
    await pboot(c, "knit", "widgets");
    const bx = await p.evaluate(() => { const t = document.querySelector("#wg .wg-week"); t.scrollIntoView({ block: "center" }); const r = t.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await c.sleep(300);
    await p.mouse.move(bx.x, bx.y); await p.mouse.down(); await c.sleep(700); await p.mouse.move(bx.x + 20, bx.y + 30, { steps: 4 });
    const ed = await p.evaluate(() => ({ edit: !!document.querySelector("#wg.edit"), lift: !!document.querySelector("#wg .wg-lift, .wg-ghost"), drag: document.documentElement.classList.contains("wg-dragging") }));
    await p.mouse.up(); await c.sleep(500);
    c.check("phone: a hold opens 编辑 and does not pick the tile up (the finger can still scroll)", ed.edit && !ed.lift && !ed.drag, ed);
    const ta = await p.evaluate(() => getComputedStyle(document.querySelector("#wg.edit .wg-week")).touchAction);
    c.check("phone 编辑: tiles keep vertical panning", /pan-y|auto|manipulation/.test(ta), ta);
    const small = await p.evaluate(() => [...document.querySelectorAll("#wg .wg-sz button, #wg .wg-mv button, #wg .wg-hd .wg-btn")].map(b => { const r = b.getBoundingClientRect(); return [b.textContent.trim(), Math.round(r.width), Math.round(r.height)]; }).filter(x => x[1] < 44 || x[2] < 44));
    c.check("phone 编辑: S M L, ← → and the header buttons are at least 44 px", !small.length, small.slice(0, 6));
    const xr = await p.evaluate(() => { const b = document.querySelector("#wg .wg-x"), r = b.getBoundingClientRect(), a = getComputedStyle(b, "::before"); return { w: r.width + 2 * Math.max(0, -parseFloat(a.left) || 0), h: r.height + 2 * Math.max(0, -parseFloat(a.top) || 0) }; });
    c.check("phone 编辑: the remove button's touch area is at least 44 px", xr.w >= 44 && xr.h >= 44, xr);
    await c.shot("p-edit");
    await p.evaluate(() => document.querySelector('#wg [data-wg-size="week:s"]').click()); await c.sleep(900);
    c.check("phone 编辑: S makes 本周进度 one column", await p.evaluate(() => { const t = document.querySelector("#wg .wg-week"), g = document.querySelector("#wg .wg-grid"); return t.classList.contains("sz-s") && t.getBoundingClientRect().width < g.getBoundingClientRect().width / 2 + 2; }));
    const o0 = (await look(p)).order;
    await p.evaluate(() => document.querySelector('#wg [data-wg-move="week:-1"]').click()); await c.sleep(900);
    const o1 = (await look(p)).order;
    c.check("phone 编辑: ← moves the tile one place up", o1.indexOf("week") === o0.indexOf("week") - 1, { o0, o1 });
    await editOff(c);
    await c.until(() => p.evaluate(() => fetch("/api/state").then(r => r.json()).then(s => ((s.meta.widgets || {}).chosen || []).includes("week"))), 6000);
    c.check("phone: the picked size is stored on the server (same layout as the desk)", await p.evaluate(() => fetch("/api/state").then(r => r.json()).then(s => s.meta.widgets.layout.some(x => x[0] === "week" && x[1] === "s"))));

    /* 5. back to 列表: the list home returns */
    await pboot(c, "knit", "list");
    const h2 = await home(p);
    c.check("phone 手机首页 = 列表 again: the list home is back", h2.home === "classic" && !h2.wg && h2.list, h2);
    c.check("phone: no page errors", !errs.length, errs);
  } finally {
    await p.evaluate(() => localStorage.removeItem("rt.phoneHome"));
    await act(p, { kind: "widget_layout", reset: true });
    if (orig && orig.layout) await act(p, Object.assign({ kind: "widget_layout", layout: orig.layout }, orig.chosen ? { chosen: orig.chosen } : {}));
  }
}
module.exports = {
  views: ["desk", "phone"],
  hash: () => "#page=review",
  async run(c) {
    if (c.view === "phone") return phone(c);
    const p = c.p, errs = [], RUN = Date.now().toString(36) + c.engine.slice(0, 2);
    p.on("pageerror", e => { const m = String(e).split("\n")[0]; if (!/due to access control checks/.test(m)) errs.push(m); });
    await boot(c, "knit");
    const orig = await p.evaluate(() => JSON.parse(JSON.stringify(App.ST.meta.widgets || null)));
    const ag = await p.evaluate(() => { const a = Object.values(App.ST.agents || {}).filter(a => a.enabled !== false && a.id !== "manager"); const w = a.find(x => x.status !== "working") || a[0]; return { id: w.id, status: w.status, item: w.item || "" }; });
    const cards = [];
    const mk = (id, extra) => { cards.push(id); c.su("upsert-item", "--id", id, "--who", ag.id, "--owner", ag.id, ...extra); };
    try {
      for (let i = 0; i < 3; i++) mk(`fx-sml-${RUN}-r${i}`, ["--title", `尺寸 S/M/L 测试卡 ${i} · 一个比较长的标题看看会不会挤出去`, "--category", "side", "--kind", "deliverable", "--stage", "review", "--draft", "x", "--label", "v1"]);
      mk(`fx-sml-${RUN}-busy`, ["--title", "此刻在忙测试卡", "--category", "side", "--kind", "task", "--stage", "doing"]);
      c.su("set-agent", ag.id, "--status", "working", "--item", `fx-sml-${RUN}-busy`, "--activity", "S/M/L test");
      mk(`fx-sml-${RUN}-done`, ["--title", "今天交付测试卡", "--category", "side", "--kind", "deliverable", "--stage", "done"]);
      mk(`fx-sml-${RUN}-on`, ["--title", "每日测试卡", "--category", "ongoing", "--kind", "task", "--stage", "doing"]);
      /* one new reply, nothing else unread: replies has a single row, so an unpicked L shrinks to M */
      await act(p, { kind: "mail_read", all: true });
      c.su("reply", `fx-sml-${RUN}-busy`, ag.id, "回你一句：S/M/L 测试的新回复");
      await boot(c, "knit");

      /* 1. 编辑: every core widget offers S / M / L */
      await act(p, { kind: "widget_layout", reset: true });
      await boot(c, "knit"); await editOn(c);
      const sz = await p.evaluate(K => Object.fromEntries(K.map(k => [k, [...document.querySelectorAll(`#wg .wg-${k} [data-wg-size]`)].map(b => b.textContent).join("")])), CORE);
      c.check("编辑: every core widget has S M L buttons", CORE.every(k => sz[k] === "SML"), sz);
      await c.shot("edit-knit");
      await editOff(c);

      /* 2. each size for every widget, both skins: right class, nothing sticks out, the grid is dense */
      const SHOTS = {};
      /* 1440 zh as before, then 1280 in English (longer names and labels: the 此刻在忙 M overflow of 11-22 only showed in English) */
      for (const [W, lang] of [[1440, "zh"], [1280, "en"]]) for (const skin of ["knit", "ink"]) {
        await p.setViewportSize({ width: W, height: 900 });
        const sk = W === 1440 ? skin : `${skin} ${W} ${lang}`;
        for (const z of ["s", "m", "l", "mix"]) {
          const L = z === "mix" ? [["review", "m"], ["usage", "s"], ["busy", "l"], ["replies", "s"], ["today", "s"], ["week", "l"], ["ongoing", "m"], ["media", "s"]] : CORE.map(k => [k, z]);
          c.check(`${sk} ${z}: layout stored with chosen`, await act(p, { kind: "widget_layout", layout: L, chosen: CORE }) === 200);
          await boot(c, skin, lang);
          const v = await look(p);
          const want = k => { const s = L.find(x => x[0] === k)[1]; return k === "review" ? ({ s: "sz-s", m: "sz-l", l: "sz-w" })[s] : "sz-" + s; };
          const wrong = CORE.filter(k => v.tiles[k] && !v.tiles[k].cls.includes(want(k)));
          c.check(`${sk} ${z}: every tile drawn at its picked size (chosen: no auto shrink)`, !wrong.length, { wrong: wrong.map(k => [k, v.tiles[k].cls]), cols: v.cols });
          const over = Object.entries(v.tiles).filter(([, t]) => t.bad.length).map(([k, t]) => [k, t.bad]);
          c.check(`${sk} ${z}: no content sticks out of any tile`, !over.length, over);
          if (z === "s") { const col = (v.gw - (v.cols - 1) * 0) / v.cols, wide = Object.entries(v.tiles).filter(([k, t]) => t.w > col + 2).map(([k, t]) => [k, t.w]);
            c.check(`${sk} S: each tile is one grid column`, !wide.length, { col: Math.round(col), wide }); }
          if (z === "l") {
            const wk = await p.evaluate(() => [...document.querySelectorAll("#wg .wg-week .sml-wk3 .wg-big")].map(e => e.textContent.trim()));
            c.check(`${sk} week L: three counts, each a plain number (no 「-9-9」)`, wk.length === 3 && wk.every(x => /^\d+$/.test(x)), wk);
            const m9 = await p.evaluate(() => { const g = document.querySelector("#wg .wg-media .wg-thumbs"); return g ? { g9: g.classList.contains("sml-g9"), n: g.children.length } : null; });
            if (m9) c.check(`${sk} media L: 3 × 3 grid (up to 9)`, m9.g9 && m9.n <= 9, m9);
            const on = await p.evaluate(() => document.querySelectorAll("#wg .wg-ongoing .wg-row").length);
            c.check(`${sk} ongoing L: up to 6 rows`, on >= 1 && on <= 6, on);
          }
          if (z === "s") {
            const s1 = await p.evaluate(() => ({ rv: (document.querySelector("#wg .wg-review .wg-big") || {}).textContent, n: App.items().filter(i => App.onYouCard(i) || (App.onYou(i) && App.awaitsUser(i))).length,
              busy: document.querySelectorAll("#wg .wg-busy .sml-stack img").length, rep: !!document.querySelector("#wg .wg-replies .sml-who"), use: !!document.querySelector("#wg .wg-usage .ru-tot, #wg .wg-usage .ru-wait") }));
            c.check(`${sk} S content: 等你拍板 count, 此刻在忙 faces, 新回复 latest, 用量 total`, +s1.rv === s1.n && s1.busy >= 1 && s1.rep && s1.use, s1);
          }
          await p.setViewportSize({ width: W, height: 2400 }); await c.sleep(600);   /* tall window: the whole grid fits, so the element shot is not cut by the scroll pane */
          SHOTS[`${skin}-${z}-${W}`] = await c.shot(`${skin}-${z}-${W}`, "#wg .wg-grid");
          await p.setViewportSize({ width: W, height: 900 }); await c.sleep(300);
        }
      }

      await p.setViewportSize({ width: 1440, height: 900 });
      /* 2b. the knit 「-9-9」 bug: switch 本周进度 M -> L in 编辑 and watch the three counts while they roll */
      await act(p, { kind: "widget_layout", layout: CORE.map(k => [k, "m"]), chosen: CORE });
      await boot(c, "knit"); await editOn(c);
      const seen = await p.evaluate(async () => { document.querySelector('#wg [data-wg-size="week:l"]').click(); const out = new Set();
        for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 40)); document.querySelectorAll("#wg .wg-week .wg-big, #wg .wg-week .wg-eb .n").forEach(e => out.add(e.textContent.trim())); } return [...out]; });
      c.check("knit week M -> L: every count stays a plain number while it rolls", seen.length && seen.every(x => /^\d+$/.test(x)), seen);
      await editOff(c);

      /* 3. old layout, no chosen (an existing install): a short L tile still drops to M, exactly as before */
      await act(p, { kind: "widget_layout", reset: true });
      c.check("恢复默认 clears chosen", await p.evaluate(() => fetch("/api/state").then(r => r.json()).then(s => !(s.meta.widgets || {}).chosen)));
      const OLD = [["review", "m"], ["busy", "l"], ["replies", "l"], ["usage", "l"], ["today", "m"], ["week", "m"], ["ongoing", "m"], ["media", "m"]];
      await act(p, { kind: "widget_layout", layout: OLD });
      await boot(c, "knit");
      const n0 = await cnt(p), o1 = await look(p);
      c.check("old layout (no chosen): 新回复 L with one reply still shows as M", n0.nr === 1 && /sz-m/.test(o1.tiles.replies && o1.tiles.replies.cls), { n0, cls: o1.tiles.replies && o1.tiles.replies.cls });
      c.check("old layout: 等你拍板 M is still the half tile", /sz-l/.test(o1.tiles.review.cls) && /wy-half/.test(o1.tiles.review.cls), o1.tiles.review.cls);

      /* 4. the user picks L in 编辑: stored as chosen, and the tile stays L after 完成 */
      await editOn(c);
      await p.evaluate(() => document.querySelector('#wg [data-wg-size="replies:s"]').click()); await c.sleep(900);
      await p.evaluate(() => document.querySelector('#wg [data-wg-size="replies:l"]').click()); await c.sleep(900);
      await editOff(c);
      await c.until(() => p.evaluate(() => fetch("/api/state").then(r => r.json()).then(s => ((s.meta.widgets || {}).chosen || []).includes("replies"))), 6000);
      const st = await p.evaluate(() => fetch("/api/state").then(r => r.json()).then(s => s.meta.widgets));
      c.check("a size click stores chosen on the server", (st.chosen || []).includes("replies") && st.layout.find(x => x[0] === "replies")[1] === "l", st);
      await boot(c, "knit");
      const o2 = await look(p);
      c.check("picked L stays L with one reply (no auto shrink)", /sz-l/.test(o2.tiles.replies && o2.tiles.replies.cls), o2.tiles.replies);
      c.check("the rest of the old layout is unchanged", JSON.stringify(st.layout.map(x => x[0])) === JSON.stringify(OLD.map(x => x[0])) && st.layout.filter(x => x[0] !== "replies").every(x => OLD.some(y => y[0] === x[0] && y[1] === x[1])), st.layout);
      await c.shot("picked-L");
   /* a bad chosen is refused: tests/api golden widget_layout_chosen_bad */
      c.check("no page errors", !errs.length, errs);
    } finally {
      await editOff(c);
      await act(p, { kind: "widget_layout", reset: true });
      if (orig && orig.layout) await act(p, Object.assign({ kind: "widget_layout", layout: orig.layout }, orig.chosen ? { chosen: orig.chosen } : {}));
      if (ag.status === "working" && ag.item) c.su("set-agent", ag.id, "--status", "working", "--item", ag.item); else c.su("set-agent", ag.id, "--status", "idle");
      for (const id of cards) c.su("upsert-item", "--id", id, "--who", ag.id, "--stage", "done");
    }
  },
};
