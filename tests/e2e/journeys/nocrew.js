/* t-drop-team-tab: the 团队 (crew) page is gone from the desk rail and the phone 更多 list; #page=team / crew and a stored
 * rt.page "crew" land on 首页; the 团队交接 widget (web/js/team.js) still draws and links nowhere.
 *   node tests/e2e/drive.js run tests/e2e/journeys/nocrew.js --out work/<item>/verify/<run> --views desk,phone --engines chromium,webkit
 */
const ready = async c => { await c.p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 15000 }); await c.sleep(1500); };
module.exports = {
  views: ["desk", "phone"],
  hash: () => "#page=review",
  async run(c) {
    const p = c.p;
    const crewDom = () => p.evaluate(() => [...document.querySelectorAll('[data-go="crew"], [data-go="team"]')].length);
    if (c.view === "desk") {
      const rail = await p.evaluate(() => [...document.querySelectorAll("#nav [data-go]")].map(e => e.dataset.go));
      c.check("desk rail has no 团队 row, 招聘市场 still there", !rail.includes("crew") && rail.includes("market"), rail);
      const w = await p.evaluate(() => { const t = document.querySelector(".wg-team"); return t ? { svg: !!t.querySelector("svg"), txt: t.textContent.replace(/\s+/g, " ").slice(0, 80) } : null; });
      c.check("团队交接 widget still draws", !!w && w.svg, w);
      c.check("no element links to the 团队 page", await crewDom() === 0);
      await c.shot("home");
      if (w) { await p.click(".wg-team svg", { force: true }).catch(() => {}); await c.sleep(1000);
        c.check("clicking the widget graph stays on 首页", await p.evaluate(() => App.UI.page) === "review"); }
      await p.keyboard.press("Meta+k"); await c.sleep(600); await p.keyboard.type("团队"); await c.sleep(600);
      const pal = await p.evaluate(() => { const a = document.activeElement; let e = a; for (let i = 0; i < 4 && e && e.parentElement; i++) e = e.parentElement; return { inInput: a && a.tagName, txt: e ? e.textContent.replace(/\s+/g, " ").slice(0, 300) : "" }; });
      c.check("palette search 团队 offers no 跳到「团队」", pal.inInput === "INPUT" && !/跳到「团队」/.test(pal.txt), pal);
      await p.keyboard.press("Escape");
    } else {
      await c.tap("#tabbar button[data-k=more]"); await c.sleep(800);
      const more = await p.evaluate(() => [...document.querySelectorAll("[data-go]")].filter(e => e.getBoundingClientRect().width).map(e => e.dataset.go));
      c.check("phone 更多 has no 团队 row", !more.includes("crew") && more.includes("market"), more);
      await c.shot("more");
    }
    for (const h of ["team", "crew"]) {
      await p.goto(c.BASE + "/#page=" + h, { waitUntil: "load" }); await p.reload({ waitUntil: "load" }); await ready(c);
      const pg = await p.evaluate(() => App.UI.page);
      c.check(`#page=${h} lands on 首页`, pg === "review", pg);
    }
    await p.evaluate(() => localStorage.setItem("rt.page", JSON.stringify("crew"))); await p.goto(c.BASE + "/", { waitUntil: "load" }); await ready(c);
    const pg2 = await p.evaluate(() => App.UI.page);
    c.check("stored rt.page = crew lands on 首页", pg2 === "review", pg2);
    c.check("still no 团队 links after reload", await crewDom() === 0);
  },
};
