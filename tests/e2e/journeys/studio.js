/* t-oss-gen-s5: content mode. A board with no platforms in config.json and no role owning a pipeline column shows only
 * 委托板 / 素材 under 制作 (#page=studio opens 委托板, the palette offers no 制作线 / 频道); 设置 → 制作线和频道 (meta.studio,
 * shared by every browser) forces them on or off, and 自动 goes back to the rule. The fixture board is such a board.
 *   node tests/e2e/drive.js run tests/e2e/journeys/studio.js --out work/<item>/verify/<run> --views desk,phone --engines chromium,webkit
 */
const ready = async c => { await c.p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 15000 }); await c.sleep(1500); };
module.exports = {
  views: ["desk", "phone"],
  hash: () => "#page=studio",
  async run(c) {
    const p = c.p;
    const tabs = () => p.evaluate(() => [...document.querySelectorAll("[data-stutab]")].map(b => b.dataset.stutab));
    const studio = async () => { await p.evaluate(() => App.go("studio")); await c.sleep(900); return { page: await p.evaluate(() => App.UI.page), tabs: await tabs() }; };
    const setMode = async m => {
      await p.evaluate(() => App.go("settings")); await c.sleep(700);
      const ok = await p.evaluate(m => { const b = document.querySelector(`[data-studio-set="${m}"]`); if (!b) return false; b.click(); return true; }, m);
      c.check(`设置 has the 制作线和频道 switch (${m})`, ok);
      await p.waitForFunction(m => fetch("/api/state").then(r => r.json()).then(s => (s.meta.studio || "auto") === m), m, { timeout: 8000 }).catch(() => {});
      const srv = await p.evaluate(() => fetch("/api/state").then(r => r.json()).then(s => s.meta.studio || "auto"));
      c.check(`server keeps meta.studio = ${m}`, srv === m, srv);
      return srv;
    };
    const m0 = await p.evaluate(() => ({ plat: App.ST.meta.platforms_set, studio: App.ST.meta.studio || "auto", cm: App.contentMode() }));
    c.check("fixture board: no platforms, auto, content mode off", m0.plat === false && m0.studio === "auto" && m0.cm === false, m0);
    let s = await studio();
    c.check("#page=studio opens 委托板", s.page === "board", s.page);
    c.check("制作 tabs = 委托板, 素材", JSON.stringify(s.tabs) === JSON.stringify(["board", "assets"]), s.tabs);
    await c.shot("studio-auto");
    if (c.view === "desk") {
      await p.keyboard.press("Meta+k"); await c.sleep(600); await p.keyboard.type("pipeline"); await c.sleep(600);
      const pal = await p.evaluate(() => (document.querySelector(".pal") || document.body).textContent.replace(/\s+/g, " ").slice(0, 400));
      c.check("palette offers no Pipeline page", !/Go to “Pipeline”|跳到「制作线」/.test(pal), pal.slice(0, 160));
      await p.keyboard.press("Escape"); await c.sleep(300);
    }
    await setMode("on");
    await c.shot("settings-on");
    s = await studio();
    c.check("on: 制作线 and 频道 are back", s.tabs.includes("pipe") && s.tabs.includes("channels"), s.tabs);
    await p.evaluate(() => App.go("pipe")); await c.sleep(800);
    c.check("on: 制作线 page renders", await p.evaluate(() => App.UI.page === "pipe" && !!document.querySelector(".ph-pipe")));
    await c.shot("studio-on");
    await setMode("off");
    s = await studio();
    c.check("off: 委托板, 素材 only", JSON.stringify(s.tabs) === JSON.stringify(["board", "assets"]), s.tabs);
    await setMode("auto");
    await p.reload({ waitUntil: "load" }); await ready(c);
    s = await studio();
    c.check("auto again after a reload: 委托板, 素材", JSON.stringify(s.tabs) === JSON.stringify(["board", "assets"]), s.tabs);
  },
};
