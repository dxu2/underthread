/* t-phone-filter-row (user 11-22): on the phone the 委托 category row is the 通知 filter row (.filters.mb-row > .seg): same side margins,
 * height, pill colour, ring, radius and button padding in every skin; it is built once (polls do not replay its entrance); a button cut by
 * the track's edge fades (scroll-driven opacity, where the engine has view timelines); the desk has no such row.
 *   node tests/e2e/drive.js run tests/e2e/journeys/filterrow.js --out work/<item>/verify/<run> --engines chromium,webkit */
const SK = [["white", "ut", "leather1"], ["white", "ut", "knit1"], ["dark", "ut", "off"], ["white", "", "off"], ["dark", "", "off"], ["white", "ink", "off"], ["dark", "ink", "off"]];
const KEYS = ["x", "w", "h", "mt", "mb", "pad", "radius", "bg", "ring", "ipad", "ih"];
module.exports = {
  views: ["phone", "desk"],
  hash: () => "",
  async run(c) {
    const p = c.p, errs = [];
    p.on("pageerror", e => { const s = String(e).split("\n")[0]; if (!/access control checks/.test(s)) errs.push(s); });
    const ready = () => p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 20000 });
    const set = (th, ut, tx, lang) => p.evaluate(([th, ut, tx, lang]) => { const s = (k, v) => localStorage.setItem("rt." + k, JSON.stringify(v));
      s("lang", lang); s("theme", th); s("themeMode", "manual"); ut ? s("ut", ut) : localStorage.removeItem("rt.ut"); s("texture", tx); s("stage", false); }, [th, ut, tx, lang]);
    if (c.view === "desk") {
      await set("white", "ut", "leather1", "en"); await p.reload({ waitUntil: "load" }); await ready();
      await p.evaluate(() => App.go ? App.go("quests") : (location.hash = "#quests")); await c.sleep(1000);
      const d = await p.evaluate(() => { const r = document.querySelector(".m-seg"); return r ? getComputedStyle(r).display : "absent"; });
      c.check("desk: no phone category row", d === "absent" || d === "none", d);
      c.check("no page errors", !errs.length, errs);
      return;
    }
    const row = sel => p.evaluate(sel => { const r = document.querySelector(sel), s = r && r.querySelector(".seg"), i = s && s.querySelector(".seg-i"); if (!s) return null;
      const R = r.getBoundingClientRect(), S = s.getBoundingClientRect(), cr = getComputedStyle(r), cs = getComputedStyle(s), ci = getComputedStyle(i);
      return { x: Math.round(S.x), w: Math.round(R.width), h: Math.round(S.height), mt: cr.marginTop, mb: cr.marginBottom, pad: cs.padding, radius: cs.borderRadius, bg: cs.backgroundColor, ring: cs.boxShadow, ipad: ci.paddingLeft, ih: Math.round(i.getBoundingClientRect().height) }; }, sel);
    for (const [th, ut, tx] of SK) {
      const tag = `${th}-${ut || "plain"}-${tx}`;
      await set(th, ut, tx, "en"); await p.reload({ waitUntil: "load" }); await ready();
      await c.tap("#tabbar button[data-k=activity]"); await c.sleep(700);
      const m = await row(".filters.mb-row:not(.m-seg)");
      await c.tap("#tabbar button[data-k=quests]"); await c.sleep(700);
      const q = await row(".m-seg.q");
      const diff = m && q ? KEYS.filter(k => k !== "w" && m[k] !== q[k]) : ["missing"];
      c.check(`${tag}: 委托 row = 通知 row (margins, height, pill, ring, padding)`, !diff.length && q.x === 16, { diff, m, q });
      if (tag === "white-ut-leather1") await c.shot("quests-leather", "#pagebody");
    }
    /* built once: a poll does not rebuild it or replay the entrance */
    await p.evaluate(() => { window.__row = document.querySelector(".m-seg.q"); window.__an = 0; document.addEventListener("animationstart", e => { if (e.target.closest && e.target.closest(".m-seg.q") && e.animationName !== "qf-edge") window.__an++; }, true); });
    await c.sleep(6000);
    const st = await p.evaluate(() => ({ same: window.__row === document.querySelector(".m-seg.q"), n: document.querySelectorAll(".m-seg.q").length, an: window.__an }));
    c.check("the row survives polls without replaying its entrance", st.same && st.n === 1 && st.an === 0, st);
    /* edge fade (en labels overflow 358 px) */
    const ops = () => p.evaluate(() => [...document.querySelectorAll(".m-seg.q .seg-i")].map(b => +(+getComputedStyle(b).opacity).toFixed(2)));
    const vt = await p.evaluate(() => CSS.supports("animation-timeline: view()"));
    const o1 = await ops();
    await p.evaluate(() => { document.querySelector(".m-seg.q .seg").scrollLeft = 9999; }); await c.sleep(400);
    const o2 = await ops();
    c.check(vt ? "a button cut by the right edge fades, then by the left edge after a swipe" : "no view timelines: plain clip like the 通知 row",
      vt ? o1[0] === 1 && o1[o1.length - 1] < 1 && o2[0] < 1 && o2[o2.length - 1] === 1 : o1.every(x => x === 1), { vt, o1, o2 });
    await c.shot("quests-swiped", ".m-seg.q");
    await c.tap('.m-seg [data-go="urgent"]'); await c.sleep(900);
    const u = await p.evaluate(() => ({ page: App.UI.page, on: (document.querySelector(".m-seg.q .seg-i.on") || {}).dataset?.go }));
    c.check("tapping a category still switches the list", u.page === "urgent" && u.on === "urgent", u);
    await p.emulateMedia({ reducedMotion: "reduce" }); await c.sleep(300);
    const rm = await p.evaluate(() => getComputedStyle(document.querySelector(".m-seg.q .seg-i")).animationName);
    c.check("reduced motion: no fade animation", rm === "none", rm);
    await p.emulateMedia({ reducedMotion: "no-preference" });
    c.check("no page errors", !errs.length, errs);
  },
};
