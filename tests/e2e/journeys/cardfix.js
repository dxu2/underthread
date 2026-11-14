/* t-card-fn-fix: the five category pages (main / side / daily / urgent / ongoing) drew their cards with card(), which t-home-style-trim
 * removed, so a click threw "ReferenceError: card is not defined" at stageGroups. Clicks each page from the left nav (desk) or the 更多 drawer
 * (phone), plus the phone quests tab (全部), in en and zh; asserts no page error per page and that the page body rendered.
 *   node tests/e2e/drive.js run tests/e2e/journeys/cardfix.js --out work/t-card-fn-fix/verify/<run> --engines chromium,webkit
 */
const PAGES = ["main", "side", "daily", "urgent", "ongoing"];
module.exports = {
  views: ["desk", "phone"],
  async run(c) {
    const p = c.p, errs = [];
    p.on("pageerror", e => errs.push(String(e).split("\n")[0]));
    /* one open card per category so every page really calls card() */
    if (!(await c.state()).items.some(i => i.id === `fx-cardfix-${PAGES[0]}`)) for (const pg of PAGES)   /* seed once per server (run.py gives each run a fresh one) */ await c.su("upsert-item", "--id", `fx-cardfix-${pg}`, "--category", pg, "--stage", "doing", "--kind", "task", "--owner", "smith", "--title", `fixture ${pg}`);
    for (const lang of ["en", "zh"]) {
      await p.evaluate(l => localStorage.setItem("rt.lang", JSON.stringify(l)), lang);
      await p.goto(c.BASE + "/", { waitUntil: "load" });
      await p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 20000 });
      await c.sleep(800);
      const list = c.view === "phone" ? [...PAGES, "quests"] : PAGES;
      for (const pg of list) {
        const n0 = errs.length;
        if (c.view === "desk") await c.tap(`#nav [data-go="${pg}"]`);
        else if (pg === "quests") await c.tap("#tabbar button[data-k=quests]");
        else { await c.tap("#tabbar button[data-k=quests]"); await c.sleep(600); await c.tap(`.m-seg [data-go="${pg}"]`); }
        await c.sleep(2600);   /* one poll re-render too */
        const r = await p.evaluate(pg => { const b = document.getElementById("pagebody"); return { page: App.UI.page, fixture: !!(b && b.querySelector(`[data-item="fx-cardfix-${pg}"]`)), cards: b ? b.querySelectorAll(".card, .act-row").length : -1, len: b ? b.innerHTML.length : 0 }; }, pg);
        const mine = errs.slice(n0);
        c.check(`${lang} ${pg}: no page error, page rendered`, !mine.length && r.page === pg && (pg === "quests" || r.fixture), { ...r, errs: mine });
        await c.shot(`${lang}-${pg}`);
      }
    }
  },
};
