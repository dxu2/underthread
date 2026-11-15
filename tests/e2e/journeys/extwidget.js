/* t-oss-struct S8: the front-end extension registry (web/ext.js, App.ext). The nine core home widgets come from the registry; a board with a saved
 * layout and no "seen" list gets one on first load without its layout changing; a widget registered by an extension appears once, can be removed,
 * and stays removed after a reload; a registered card kind gets its label; an extension 系统状态 row is collected.
 *   node tests/e2e/drive.js run tests/e2e/journeys/extwidget.js --out <dir> --views desk --engines chromium,webkit
 */
const ID = "e2e-x" + (Date.now() % 1e5);
const reg = id => {
  UTExt.widget({ id, name: ["扩展测试", "Ext test"], sizes: ["s", "m"], size: "s", html: (s, D, k) => k.eb(id, 7) + `<div class="wg-sub" data-e2e="${id}">size ${s}</div>` });
  UTExt.cardKind({ id: "e2eclip", label: ["测试剪辑", "Test clip"] });
  UTExt.statusRow(en => ({ t: "E2E", s: "fine", lv: "ok" }));
};
module.exports = {
  views: ["desk"],
  hash: () => "#page=review",
  async run(c) {
    const p = c.p;
    const ready = async () => { await p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 15000 }); await c.sleep(1200); };
    await p.evaluate(() => { const s = (k, v) => localStorage.setItem("rt." + k, JSON.stringify(v)); s("ut", "ut"); s("home3", "widgets"); s("lang", "en"); });
    // a layout saved before S8 (no seen list), like a live board on upgrade day
    const before = [["team", "m"], ["usage", "l"], ["review", "l"], ["busy", "l"], ["today", "m"], ["week", "m"]];
    await p.evaluate(L => fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "widget_layout", layout: L }) }), before);
    await p.reload({ waitUntil: "load" }); await ready();
    const core = await p.evaluate(() => UTExt.widgets().filter(w => w.core).map(w => w.id));
    c.check("core nine registered through UTExt", core.length === 9 && ["team", "usage", "review", "busy", "replies", "today", "week", "ongoing", "media"].every(k => core.includes(k)), core);
    c.check("App.ext is UTExt", await p.evaluate(() => App.ext === window.UTExt && App.ext.api === 1));
    await c.until(async () => { const w = (await c.state()).meta.widgets; return w && Array.isArray(w.seen); }, 8000);
    let w = (await c.state()).meta.widgets;
    c.check("upgrade: seen seeded with the core nine", w && Array.isArray(w.seen) && core.every(k => w.seen.includes(k)), w);
    c.check("upgrade: saved layout unchanged", w && JSON.stringify(w.layout) === JSON.stringify(before), w && w.layout);
    // an extension registers a widget, a card kind and a status row
    await p.evaluate(reg, ID);
    await c.until(async () => { const x = (await c.state()).meta.widgets; return x && x.layout && x.layout.some(e => e[0] === ID); }, 8000);
    w = (await c.state()).meta.widgets;
    c.check("new widget added to the saved layout once, at the end, at its size", w.layout.length === before.length + 1 && JSON.stringify(w.layout[w.layout.length - 1]) === JSON.stringify([ID, "s"]), w.layout);
    c.check("new widget is seen", w.seen.includes(ID), w.seen);
    await c.until(() => p.evaluate(id => !!document.querySelector(`#wg [data-wg="${id}"] [data-e2e]`), ID), 5000);
    c.check("tile drawn with the core eyebrow", await p.evaluate(id => { const t = document.querySelector(`#wg [data-wg="${id}"]`); return !!t && t.classList.contains("sz-s") && /Ext test/.test(t.textContent); }, ID));
    c.check("card kind label from the registry", await p.evaluate(() => App.t("k_e2eclip") === "Test clip"));
    c.check("status row collected", await p.evaluate(() => UTExt.statusRows(true).some(r => r.t === "E2E")));
    await c.shot("ext-widget");
    // remove it in 编辑小组件: stays removed after a reload (the extension registers it again)
    await c.tap("[data-wg-edit]"); await c.sleep(400);
    await c.tap(`[data-wg-hide="${ID}"]`); await c.sleep(300);
    c.check("tray offers it back", await p.evaluate(id => !!document.querySelector(`[data-wg-add="${id}"]`), ID));
    await c.tap("[data-wg-edit]");
    await c.until(async () => !(await c.state()).meta.widgets.layout.some(e => e[0] === ID), 8000);
    await p.reload({ waitUntil: "load" }); await ready();
    await p.evaluate(reg, ID); await c.sleep(3500);   // two polls
    w = (await c.state()).meta.widgets;
    c.check("removed widget stays removed after reload", !w.layout.some(e => e[0] === ID) && w.seen.includes(ID), w);
    c.check("no tile after reload", await p.evaluate(id => !document.querySelector(`#wg [data-wg="${id}"]`), ID));
    // 恢复默认: core nine in order, then the extension widget; seen kept
    await c.tap("[data-wg-edit]"); await c.sleep(300); await c.tap("[data-wg-reset]"); await c.sleep(300); await c.tap("[data-wg-edit]");
    await c.until(async () => (await c.state()).meta.widgets.layout === null, 8000);
    w = (await c.state()).meta.widgets;
    c.check("reset keeps seen", w.layout === null && w.seen.includes(ID), w);
    await c.sleep(800);
    const order = await p.evaluate(() => [...document.querySelectorAll("#wg .wg-grid > [data-wg]")].map(t => t.dataset.wg));
    c.check("default layout ends with the extension widget", order[order.length - 1] === ID, order);
    await c.shot("ext-widget-reset");
  },
};
