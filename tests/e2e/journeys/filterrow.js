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
    /* t-phone-filter-row v2 (user 11-22 「一下一下」): a pick slides the pill (ui4 .seg-ind, one spring) on every animation frame: the pill never
       vanishes, never jumps, the row never fades out; the 委托 row is the same node after the page re-render (nav.js QROW keeps it) */
    const slide = async (sel, i) => {
      await p.evaluate(sel => { window.__fr = []; const t0 = performance.now(), r0 = document.querySelector(sel);
        const f = ts => { const r = document.querySelector(sel), ind = r && r.querySelector(".seg-ind"), ir = ind && ind.getBoundingClientRect();
          const sg = ind && ind.parentElement;   /* x on the track, not the screen: the track may scroll the picked button into view while the pill slides,
            and on a slow WebKit frame the scroll runs ahead of the pill's start, which on screen looks like a step back (19 -> 8 -> 32) */
          window.__fr.push({ t: ts - t0, same: r === r0, x: ir ? ir.x - sg.getBoundingClientRect().x + sg.scrollLeft : null, sl: sg ? sg.scrollLeft : 0, w: ir ? ir.width : 0, io: ind ? +getComputedStyle(ind).opacity : 0, ro: r ? +getComputedStyle(r).opacity : 0 });
          if (performance.now() - t0 < 900) requestAnimationFrame(f); };
        requestAnimationFrame(f); }, sel);
      const bt = (await p.$$(`${sel} .seg-i`))[i]; await bt.tap(); await c.sleep(1100);
      return p.evaluate(sel => { const F = window.__fr, on = document.querySelector(sel + " .seg-i.on"), ind = document.querySelector(sel + " .seg-ind");
        const a = on.getBoundingClientRect(), b = ind.getBoundingClientRect(); let vel = 0, back = 0, gone = 0, fade = 1, moved = 0, jt = null;
        for (let k = 1; k < F.length; k++) { if (F[k].x == null || F[k].w < 4 || F[k].io < .99) gone++; else if (F[k - 1].x != null) { const d = F[k].x - F[k - 1].x, v = Math.abs(d) / Math.max(16.7, F[k].t - F[k - 1].t); if (v > vel) { vel = v; jt = [Math.round(F[k - 1].t), Math.round(F[k].t), Math.round(F[k - 1].x), Math.round(F[k].x)]; } if (Math.abs(d) > .5) moved++; back = Math.max(back, -Math.sign(F.at(-1).x - F[0].x) * d); } fade = Math.min(fade, F[k].ro); }
        return { jt, xs: F.map(f => f.x == null ? -1 : Math.round(f.x)).join(" "), frames: F.length, same: F.every(x => x.same), gone, vel: +vel.toFixed(2), back: Math.round(back), moved, fade, end: Math.round(Math.abs(a.x - b.x)) + Math.round(Math.abs(a.width - b.width)), scr: Math.round(Math.max(...F.map(f => f.sl)) - Math.min(...F.map(f => f.sl))),
          travel: F.length ? Math.round(Math.abs(F.at(-1).x - F[0].x)) : 0, sf: (() => { const mv = F.map((f, k) => k && f.x != null && F[k - 1].x != null && Math.abs(f.x - F[k - 1].x) > .5).map((m, k) => m ? k : -1).filter(k => k > 0); return mv.length ? mv.at(-1) - mv[0] + 1 : 0; })() }; }, sel);
    };
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
      for (const [nm, sel, tab] of [["委托", ".m-seg.q", "quests"], ["通知", ".filters.mb-row:not(.m-seg)", "activity"]]) {
        if (tab === "activity") { await c.tap("#tabbar button[data-k=activity]"); await c.sleep(900); }
        for (const i of [3, 1]) {
          const r = await slide(sel, i);
          /* speed, not distance per frame: a render frame can be long (WebKit ~90 ms), the pill keeps its pace through it (transform-only, compositor);
             the spring's peak is ~1.4 px/ms over a 4-button pick; no step backwards beyond the spring's small overshoot; the track scrolls only enough to show the picked button (scr), not to centre it (scr).
             Frame-rate aware (CI WebKit draws a frame every ~100-180 ms): the step back may be the spring's whole overshoot (~4% of the travel, 5% allowed)
             when one long frame spans it, and a slide drawn in few frames moves in all of them but one (sf = frames from its first move to its last; 6 at 60 fps).
             A one-frame jump is still caught by vel */
          c.check(`${tag} ${nm} -> ${i}: pill slides every frame, never vanishes, row never fades, row kept`,
            r.gone === 0 && r.vel <= 2.2 && r.back <= Math.max(4, r.travel * .05) && r.moved >= Math.min(6, r.sf - 1) && r.fade >= .99 && r.end <= 2 && r.same && r.scr <= 48, r);
        }
        if (tab === "activity") { await c.tap("#tabbar button[data-k=quests]"); await c.sleep(900); }
      }
    }
    /* built once: a poll does not rebuild it or replay the entrance */
    await p.evaluate(() => { window.__row = document.querySelector(".m-seg.q"); window.__an = 0; document.addEventListener("animationstart", e => { if (e.target.closest && e.target.closest(".m-seg.q") && e.animationName !== "qf-edge") window.__an++; }, true); });
    await c.sleep(6000);
    const st = await p.evaluate(() => ({ same: window.__row === document.querySelector(".m-seg.q"), n: document.querySelectorAll(".m-seg.q").length, an: window.__an }));
    c.check("the row survives polls without replaying its entrance", st.same && st.n === 1 && st.an === 0, st);
    /* edge fade (en labels overflow 358 px) */
    const ops = () => p.evaluate(() => [...document.querySelectorAll(".m-seg.q .seg-i")].map(b => +(+getComputedStyle(b).opacity).toFixed(2)));
    const vt = await p.evaluate(() => CSS.supports("animation-timeline: view()"));
    await p.evaluate(() => { document.querySelector(".m-seg.q .seg").scrollLeft = 0; }); await c.sleep(400);   /* the picks above may leave it scrolled */
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
