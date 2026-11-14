/* t-ui-audit: smoke journey. Clicks EVERY left-nav page (desk) and every phone tab, 更多 row, 委托 segment, 制作 sub tab and 设置 tab,
 * in en and zh, and asserts 0 page errors (pageerror + console.error) and a non-empty #pagebody per stop.
 * Born from t-card-fn-fix: card() was deleted and five list pages threw for ~7 hours without anyone clicking them.
 * Runs by default: `node drive.js smoke --out <dir>` (= run journeys/navall.js on chromium,webkit).
 *   node tests/e2e/drive.js run tests/e2e/journeys/navall.js --out work/<item>/verify/<run> --engines chromium,webkit
 * Read-only: makes no fixtures, writes nothing to state.
 */
module.exports = {
  views: ["desk", "phone"],
  async run(c) {
    const p = c.p, errs = [];
    p.on("pageerror", e => errs.push(String(e).split("\n")[0]));
    p.on("console", m => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errs.push("console: " + m.text().slice(0, 160)); });
    const desk = c.view === "desk";
    /* desk: plain click; phone on WebKit: tap() on a div fires no click, so click() there too (buttons are fine either way) */
    const hit = async sel => { const l = p.locator(sel).first(); await l.waitFor({ state: "visible", timeout: 8000 }); return desk || c.engine === "webkit" ? l.click() : l.tap(); };
    const body = () => p.evaluate(() => { const b = document.getElementById("pagebody"); return { page: App.UI.page, setTab: App.UI.setTab, len: b ? b.innerHTML.length : 0 }; });
    const stop = async (label, act, want) => {
      const n0 = errs.length;
      try { await act(); } catch (e) { errs.push(`could not reach ${label}: ${String(e).split("\n")[0]}`); }
      await c.sleep(2700);   /* one poll re-render too (renderPage rebuilds every non-home page) */
      const r = await body(), mine = errs.slice(n0);
      c.check(`${label}: 0 page errors, page drawn`, !mine.length && r.len > 0 && (!want || r.page === want), { ...r, errs: mine });
    };
    for (const lang of ["en", "zh"]) {
      await p.evaluate(l => localStorage.setItem("rt.lang", JSON.stringify(l)), lang);
      await p.goto(c.BASE + "/", { waitUntil: "load" });
      await p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 20000 });
      await c.sleep(800);
      if (desk) {
        const keys = await p.$$eval("#nav [data-go]", bs => bs.filter(b => b.offsetParent).map(b => b.dataset.go));
        c.check(`${lang} desk nav has rows`, keys.length >= 8, keys);
        for (const k of keys) {
          await stop(`${lang} nav ${k}`, () => hit(`#nav [data-go="${k}"]`), k === "studio" ? null : k);
          if (k === "studio") for (const s of await p.$$eval("[data-stutab]", bs => bs.map(b => b.dataset.stutab)))
            await stop(`${lang} studio ${s}`, () => hit(`[data-stutab="${s}"]`), s);
          if (k === "settings") for (const s of await p.$$eval("[data-settab]", bs => bs.map(b => b.dataset.settab)))
            await stop(`${lang} settings ${s}`, () => hit(`[data-settab="${s}"]`), "settings");
        }
        /* 信箱 has no visible rail row on desk (the top-bar button opens a drop-down); reach the page the way the bell link does */
        await stop(`${lang} mail page`, () => p.evaluate(() => App.go("mail")), "mail");
      } else {
        for (const k of ["home", "dms", "activity", "quests", "more"]) {
          await stop(`${lang} tab ${k}`, () => hit(`#tabbar button[data-k=${k}]`));
          if (k === "quests") for (const s of await p.$$eval(".m-seg [data-go]", bs => bs.map(b => b.dataset.go)))
            await stop(`${lang} quests ${s}`, () => hit(`.m-seg [data-go="${s}"]`), s);
        }
        await hit("#tabbar button[data-k=more]"); await c.sleep(600);
        const rows = await p.$$eval("#left [data-go]", bs => bs.filter(b => b.offsetParent).map(b => b.dataset.go));
        c.check(`${lang} 更多 has rows`, rows.length >= 5, rows);   /* t-drop-team-tab (11-12): 团队 row removed, 6 -> 5 */
        for (const k of rows) {
          await stop(`${lang} more ${k}`, async () => { await hit("#tabbar button[data-k=more]"); await c.sleep(500); await hit(`#left [data-go="${k}"]`); }, k === "studio" ? null : k);
          if (k === "settings") for (const s of await p.$$eval("[data-settab]", bs => bs.map(b => b.dataset.settab)))
            await stop(`${lang} settings ${s}`, () => hit(`[data-settab="${s}"]`), "settings");
          if (k === "studio") for (const s of await p.$$eval("[data-stutab]", bs => bs.map(b => b.dataset.stutab)))
            await stop(`${lang} studio ${s}`, () => hit(`[data-stutab="${s}"]`), s);
        }
      }
      await c.shot(`${lang}-last`);
    }
  },
};
