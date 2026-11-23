/* t-wy-size: 等你拍板 at M is half of L (half the grid row, a normal two-row-tall tile with full rows, not a compact one), and a hold on that pinned tile enters 编辑 like every other tile; dragging it only bounces back (it stays first).
 *   node tests/e2e/drive.js run tests/e2e/journeys/wysize.js --out work/<item>/verify/<run> --engines chromium,webkit
 * The widget home is desktop only (phone home unchanged), so desk only; WY_W=900 checks the 4-column grid. The board's own layout is put back. */
const act = (p, body) => p.evaluate(b => fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(r => r.status), body);
const boot = async c => {
  await c.p.evaluate(() => { const s = (k, v) => localStorage.setItem("rt." + k, JSON.stringify(v)); s("lang", "zh"); s("ut", "ut"); s("texture", "knit1"); s("chatFold", false); localStorage.removeItem("rt.widgets"); });
  await c.p.reload({ waitUntil: "load" });
  await c.p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash") && document.querySelector("#wg .wg-grid > .wg"), null, { timeout: 20000 });
  await c.sleep(2200);
};
const look = p => p.evaluate(() => {
  const g = document.querySelector("#wg .wg-grid"), rv = document.querySelector("#wg .wg-review"), R = rv && rv.getBoundingClientRect();
  const first = [...g.children].find(t => t.dataset.wg);
  return { grid: Math.round(g.getBoundingClientRect().width), w: R && Math.round(R.width), h: R && Math.round(R.height), cls: rv && rv.className, first: first && first.dataset.wg,
    rows: rv ? rv.querySelectorAll(".wg-row").length : 0, rowH: rv && rv.querySelector(".wg-row") ? Math.round(rv.querySelector(".wg-row").getBoundingClientRect().height) : 0,
    clipped: rv ? [...rv.querySelectorAll(".wg-row, .wg-more")].some(e => e.getBoundingClientRect().bottom > R.bottom + 1) : null,
    edit: !!document.querySelector("#wg [data-wg-edit].on"), waiting: App.ST && Object.values(App.ST.items || {}).length };
});
module.exports = {
  views: ["desk"],
  hash: () => "#page=review",
  async run(c) {
    const p = c.p, errs = [], RUN = Date.now().toString(36) + c.engine.slice(0, 2) + c.view[0];
    p.on("pageerror", e => { const m = String(e).split("\n")[0]; if (!/due to access control checks/.test(m)) errs.push(m); });
    if (process.env.WY_W) await p.setViewportSize({ width: +process.env.WY_W, height: 900 });
    await boot(c);
    const orig = await p.evaluate(() => JSON.parse(JSON.stringify(App.ST.meta.widgets || null)));
    const cards = [];
    try {
      /* enough cards waiting that the tile has rows to show */
      for (let i = 0; i < 6; i++) { const id = `fx-wy-${RUN}-${i}`; cards.push(id); c.su("upsert-item", "--id", id, "--title", `尺寸测试 ${i}`, "--who", "smith", "--owner", "smith", "--category", "side", "--kind", "deliverable", "--stage", "review", "--draft", "x", "--label", "v1"); }
      const L0 = [["review", "l"], ["busy", "l"], ["usage", "l"], ["today", "m"], ["week", "m"], ["media", "m"]];
      c.check("layout with 等你拍板 at L stored", await act(p, { kind: "widget_layout", layout: L0 }) === 200);
      await boot(c);
      const l = await look(p);
      c.check("L: full width, first", l.first === "review" && l.w >= l.grid - 2, l);
      await c.shot("review-L");
      c.check("layout with 等你拍板 at M stored", await act(p, { kind: "widget_layout", layout: L0.map(x => x[0] === "review" ? ["review", "m"] : x) }) === 200);
      await boot(c);
      const m = await look(p);
      if (m.grid >= 640) c.check("M: half of L (half the row)", m.first === "review" && Math.abs(m.w - l.w / 2) <= 12, { m, l });
      else c.check("M in a narrow (2-column) grid: keeps the full row, half would be one narrow column", m.first === "review" && m.w >= m.grid - 2, { m, l });
      c.check("M: a normal tall tile (two grid rows) with 4+ full rows and the footer, nothing clipped", /sz-l/.test(m.cls) && m.rows >= 4 && m.rowH >= 34 && !m.clipped && m.h >= 340, m);
      await c.shot("review-M");

      /* hold the pinned tile: 编辑 opens (no drag), the size buttons are there; a drag bounces back and leaves it first */
      const box = await p.evaluate(() => { const r = document.querySelector("#wg .wg-review .wg-eb").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 + 30 }; });
      await p.mouse.move(box.x, box.y); await p.mouse.down(); await c.sleep(700); await p.mouse.up();
      await c.sleep(400);
      const e1 = await p.evaluate(() => ({ edit: !!document.querySelector("#wg [data-wg-edit].on"), size: document.querySelectorAll("#wg .wg-review [data-wg-size]").length, lift: !!document.querySelector("#wg .wg-lift") }));
      c.check("a hold on 等你拍板 enters 编辑 (size buttons shown), nothing lifted", e1.edit && e1.size >= 2 && !e1.lift, e1);
      await c.shot("pinned-edit");
      const anims = await p.evaluate(() => { window.__wyA = []; const o = Element.prototype.animate; Element.prototype.animate = function (k, t) { if (this.matches && this.matches("#wg .wg-review")) window.__wyA.push(JSON.stringify(k)); return o.call(this, k, t); }; return true; });
      const b2 = await p.evaluate(() => { const r = document.querySelector("#wg .wg-review").getBoundingClientRect(); return { x: r.left + 40, y: r.top + 60 }; });
      await p.mouse.move(b2.x, b2.y); await p.mouse.down(); await p.mouse.move(b2.x + 60, b2.y + 260, { steps: 8 }); await p.mouse.up(); await c.sleep(600);
      const e2 = await p.evaluate(() => ({ a: window.__wyA, lift: !!document.querySelector("#wg .wg-lift"), first: [...document.querySelector("#wg .wg-grid").children].find(t => t.dataset.wg).dataset.wg, order: App.ST.meta.widgets.layout.map(x => x[0]) }));
      c.check("dragging the pinned tile: a bounce-back, never lifted, still first", anims && e2.a.length >= 1 && /translate/.test(e2.a[0]) && !e2.lift && e2.first === "review", e2);
      /* another tile dropped on it does not move in front of it */
      const t3 = await p.evaluate(() => { const g = [...document.querySelectorAll("#wg .wg-grid > .wg[data-wg]:not([data-pin])")][0], r = g.getBoundingClientRect(), v = document.querySelector("#wg .wg-review").getBoundingClientRect(); return { k: g.dataset.wg, x: r.left + 30, y: r.top + 40, tx: v.left + 30, ty: v.top + 40 }; });
      await p.mouse.move(t3.x, t3.y); await p.mouse.down(); await p.mouse.move(t3.tx, t3.ty, { steps: 12 }); await c.sleep(300); await p.mouse.up(); await c.sleep(700);
      const e3 = await p.evaluate(() => [...document.querySelector("#wg .wg-grid").children].filter(t => t.dataset.wg).map(t => t.dataset.wg));
      c.check("another tile dropped on 等你拍板 stays behind it", e3[0] === "review", { dragged: t3.k, order: e3 });
      const s1 = await p.evaluate(() => { const b = document.querySelector('#wg .wg-review [data-wg-size="review:l"], #wg .wg-review [data-wg-size$=":l"]'); if (b) b.click(); return !!b; });
      await c.sleep(900);
      const l2 = await look(p);
      c.check("in 编辑 the pinned tile can be resized back to L", s1 && /sz-w/.test(l2.cls), l2);
      c.check("no page errors", !errs.length, errs);
    } finally {
      await p.evaluate(() => { const b = document.querySelector("#wg [data-wg-edit].on"); if (b) b.click(); });
      await act(p, orig && orig.layout ? { kind: "widget_layout", layout: orig.layout } : { kind: "widget_layout", reset: true });
      for (const id of cards) c.su("upsert-item", "--id", id, "--who", "smith", "--stage", "done");
    }
  },
};
