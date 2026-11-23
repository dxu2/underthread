/* t-home-clock: the home date line (beside 「今天.」) shows H:MM right after the date: the locale's 12 / 24-hour habit, tabular figures, no
 * seconds, a size up from the date and the same colour. It repaints on the minute boundary (a changed digit rolls up, transform / opacity
 * only), not while the tab is hidden, and under reduced motion it just changes. Desk widget home and phone home.
 *   node tests/e2e/drive.js run tests/e2e/journeys/homeclock.js --out work/<item>/verify/<run> --engines chromium,webkit
 * Uses Playwright's clock (installed before the reload) so the minute boundary comes on demand. */
const OK = new Set(["transform", "opacity", "offset", "easing", "composite", "computedOffset"]);
module.exports = {
  views: ["desk", "phone"],
  hash: () => "#page=review",
  async run(c) {
    const p = c.p, errs = [];
    p.on("pageerror", e => { const m = String(e).split("\n")[0]; if (!/due to access control checks/.test(m)) errs.push(m); });
    const t0 = new Date(); t0.setHours(14, 7, 50, 0);
    await p.clock.install({ time: t0 });
    await p.evaluate(() => { const s = (k, v) => localStorage.setItem("rt." + k, JSON.stringify(v)); s("lang", "zh"); s("ut", "ut"); s("texture", "knit1"); s("chatFold", false); });
    await p.reload({ waitUntil: "load" });
    await p.clock.runFor(3000);
    await p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 20000 });
    if (c.view === "phone") { await c.tap("#tabbar button[data-k=home]"); await p.clock.runFor(800); }
    const look = () => p.evaluate(() => {
      const k = document.querySelector("#inkhello .hc-clk"), eb = k && k.closest(".ink-eb");
      if (!k) return null;
      const cs = getComputedStyle(k), es = getComputedStyle(eb), R = k.getBoundingClientRect(), mine = e => e && e.closest && e.closest(".hc-clk");
      const an = document.getAnimations().filter(a => a.effect && mine(a.effect.target));
      return { text: k.textContent, dt: k.dateTime, vis: R.width > 0 && R.height > 0, prev: (k.previousSibling || {}).textContent || "", fs: parseFloat(cs.fontSize), efs: parseFloat(es.fontSize), col: cs.color, ecol: es.color,
        num: cs.fontVariantNumeric, rolls: k.querySelectorAll(".hc-roll").length, props: [...new Set(an.flatMap(a => a.effect.getKeyframes().flatMap(f => Object.keys(f))))], anims: an.length,
        h12: /h1[12]/.test(new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hourCycle || "") };
    });
    const a = await look();
    c.check("the clock sits right after the date on the home line", a && a.vis && /\d+月\d+日/.test(a.prev), a);
    c.check("H:MM in the locale's hour habit, no seconds", a && (a.h12 ? /^2:07/.test(a.text) : a.text === "14:07") && !/:\d\d:/.test(a.text) && a.dt === "14:07", a);
    c.check("a size up from the date, same colour, tabular figures", a && a.fs > a.efs && a.col === a.ecol && /tabular-nums/.test(a.num), a);
    c.check("first paint: nothing rolls", a && a.rolls === 0, a);
    await c.shot("clock", "#inkhello");
    /* the minute boundary: 14:07 -> 14:08, only the last digit rolls */
    await p.clock.runFor(10500);
    const b = await look();
    c.check("on the minute boundary it turns to 14:08", b && b.dt === "14:08", b);
    c.check("only the changed digit rolls, transform / opacity only", b && b.rolls === 1 && b.props.every(k => OK.has(k)), b);
    await c.shot("clock-roll", "#inkhello");
    /* hidden tab: no repaint; back: catches up at once */
    await p.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
    await p.clock.runFor(125000);
    const h = await look();
    c.check("hidden tab: the clock does not repaint", h && h.dt === "14:08", h);
    await p.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange")); });
    await p.clock.runFor(200);
    const v = await look();
    c.check("visible again: it catches up straight away", v && v.dt === "14:10", v);
    /* reduced motion: the digits change, nothing rolls */
    await p.emulateMedia({ reducedMotion: "reduce" });
    await p.clock.runFor(60000);
    const r = await look();
    c.check("reduced motion: changes to 14:11 without a roll", r && r.dt === "14:11" && r.anims === 0, r);
    await p.emulateMedia({ reducedMotion: "no-preference" });
    c.check("no page errors", !errs.length, errs);
  },
};
