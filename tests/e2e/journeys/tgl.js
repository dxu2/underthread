/* t-plain-toggle: settings switches (.sw) are a plain toggle — round knob in a pill track, accent track when on, knob slides (translate).
 * Taps the 「Opening animation」 switch (data-splash-tog, a local pref) off and back on with the real control, checks aria-checked + knob position,
 * shoots on / mid-slide / off, checks the keyboard focus ring. Desk: 设置 rail; phone: tab bar 更多 -> 设置.
 *   node tests/e2e/drive.js run tests/e2e/journeys/tgl.js --out work/<item>/verify/<run> --engines chromium,webkit [--theme white]
 */
const CFG = [["ut-leather1", "ut", "leather1"], ["ink-none", null, "none"]];
async function seed(c, ut, tex) {
  await c.p.evaluate(([ut, tex]) => { const s = (k, v) => localStorage.setItem("rt." + k, JSON.stringify(v)); if (ut) s("ut", ut); else localStorage.removeItem("rt.ut"); s("texture", tex); s("home3", "widgets"); s("lang", "en"); }, [ut, tex]);
  await c.p.reload({ waitUntil: "load" });
  await c.p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 15000 });
  await c.sleep(1500);
}
const SW = "[data-splash-tog]";
const knob = p => p.evaluate(s => { const b = document.querySelector(s), sw = b.querySelector(".sw") || b, i = sw.querySelector("i"), cs = getComputedStyle(i), ts = getComputedStyle(sw), r = i.getBoundingClientRect(), t = sw.getBoundingClientRect();
  return { aria: b.getAttribute("aria-checked"), on: sw.classList.contains("on"), x: Math.round(r.left - t.left), round: cs.borderRadius, track: ts.backgroundColor, w: Math.round(t.width), h: Math.round(t.height), kw: Math.round(r.width) }; }, SW);
module.exports = {
  views: ["desk", "phone"],
  hash: view => (view === "desk" ? "#page=review" : ""),
  async run(c) {
    const p = c.p, path = require("path"), out = process.argv[process.argv.indexOf("--out") + 1];
    for (const [name, ut, tex] of CFG) {
      await seed(c, ut, tex);
      const theme = await p.evaluate(() => document.documentElement.dataset.theme);
      if (c.view === "desk") { await c.tap("#nav [data-go=settings]"); await c.sleep(1000); }
      else { await c.tap("#tabbar button[data-k=more]"); await c.sleep(700); await c.tap('[data-go="settings"]'); await c.sleep(1000); }
      await p.locator(SW).first().scrollIntoViewIfNeeded(); await c.sleep(300);
      const sec = await p.evaluate(s => { const e = document.querySelector(s).closest(".st-sec, section") || document.querySelector(s).parentElement; e.id = e.id || "tgl-sec"; return "#" + e.id; }, SW);
      const k0 = await knob(p);
      await c.shot(`${name}-${theme}-on`, sec);
      c.check(`${name} ${theme}: plain toggle when on (round knob on the right, track filled)`, k0.aria === "true" && k0.on && k0.round === "50%" && k0.x >= 18 && k0.w === 44 && k0.h === 26, k0);
      await p.evaluate(s => { window.__sw = []; document.querySelector(s).addEventListener("click", () => { const i = document.querySelector(s + " .sw i"), t0 = performance.now();
        const tick = () => { window.__sw.push(Math.round(i.getBoundingClientRect().left - i.parentElement.getBoundingClientRect().left)); if (performance.now() - t0 < 400) requestAnimationFrame(tick); }; requestAnimationFrame(tick);
        /* hold the slide at 50 ms for the mid frame */
        const a = i.getAnimations()[0]; if (a) { a.pause(); a.currentTime = 50; setTimeout(() => a.play(), 700); } }, { once: true }); }, SW);
      await c.tap(SW); await c.sleep(150);
      const fm = path.join(out, `${c.engine}-${c.view}`, `mid-${name}-${theme}.png`);
      await p.locator(sec).screenshot({ path: fm }); c.note(`shot ${fm} (slide held at 50 ms)`);
      await c.sleep(800);
      const km = await p.evaluate(() => window.__sw); km.x = km.length ? km.find(x => x > 3 && x < 21) || km[0] : -1;
      await c.sleep(600);
      const k1 = await knob(p);
      await c.shot(`${name}-${theme}-off`, sec);
      c.check(`${name} ${theme}: tap -> aria-checked false, knob slid left, track changed`, k1.aria === "false" && !k1.on && k1.x <= 4 && k1.track !== k0.track, { k1, mid: km });
      c.check(`${name} ${theme}: knob slides (mid frame between ends)`, km.x > 3 && km.x < 21, km);
      await c.tap(SW); await c.sleep(700);
      const k2 = await knob(p);
      c.check(`${name} ${theme}: tap again -> back on`, k2.aria === "true" && k2.on && k2.x >= 18, k2);
      if (c.view === "desk") {
        /* Keyboard focus without knowing the platform's Tab rules: WebKit on macOS skips buttons on plain Tab unless Alt is held (full keyboard
           access); Linux WebKit (CI) and Chromium do not. Try plain Tab first, then Alt+Tab, then a forward Tab walk, and keep the first that lands on the switch (the log says which). */
        let ring = null;
        for (const tab of ["Tab", "Alt+Tab", "walk"]) {
          if (tab === "walk") {   /* last resort: from the top of the page, Tab forward until the switch has focus (no Shift+Tab involved) */
            await p.evaluate(() => document.activeElement && document.activeElement.blur());
            for (let i = 0; i < 80 && !(await p.evaluate(s => document.activeElement === document.querySelector(s), SW)); i++) await p.keyboard.press("Tab");
            await c.sleep(200);
          } else { await p.focus(SW); await p.keyboard.press("Shift+" + tab); await p.keyboard.press(tab); await c.sleep(200); }
          ring = await p.evaluate(s => { const t = document.querySelector(s), sw = t.querySelector(".sw") || t, cs = getComputedStyle(sw), a = document.activeElement;
            return { fv: t.matches(":focus-visible"), o: cs.outlineStyle, w: cs.outlineWidth, on: a === t, active: a ? a.tagName + (a.className ? "." + String(a.className).split(" ")[0] : "") : null }; }, SW);
          ring.key = tab;
          if (ring.on && ring.fv) break;
        }
        await c.shot(`${name}-${theme}-focus`, sec);
        c.check(`${name} ${theme}: keyboard focus shows a ring on the switch`, ring.fv && ring.o === "solid", ring);
      }
    }
  },
};
