/* t-phone-nav-glass (user 11-22, ask b0ba19): the phone tab bar's selection lens. Motion B everywhere (grows ~1.3x, lifts 4px, settles with an
 * overshoot; a retarget starts where the lens is), look per skin (glass rim, or a stitched patch + thread under knit). Checks per skin:
 * the look, navigation lands in the same task as the tap (never waits for the animation), the moving lens animates only transform / opacity, no backdrop-filter
 * on the moving lens, the lens ends on the button, a double tap does not jump, frame pacing during a slide, reduced motion = fade in place.
 *   node tests/e2e/drive.js run tests/e2e/journeys/navglass.js --out work/<item>/verify/<run> --views phone --engines chromium,webkit */
const SK = [["white", "ut", "leather1"], ["white", "ut", "knit1"], ["dark", "ut", "knit1"], ["dark", "ut", "off"], ["white", "", "off"], ["dark", "", "off"], ["white", "ink", "off"], ["dark", "ink", "off"]];
module.exports = {
  views: ["phone"],
  hash: () => "",
  async run(c) {
    const p = c.p, errs = [];
    p.on("pageerror", e => { const s = String(e).split("\n")[0]; if (!/access control checks/.test(s)) errs.push(s); });
    const ready = () => p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 20000 });
    const set = (th, ut, tx) => p.evaluate(([th, ut, tx]) => { const s = (k, v) => localStorage.setItem("rt." + k, JSON.stringify(v));
      s("lang", "zh"); s("theme", th); s("themeMode", "manual"); ut ? s("ut", ut) : localStorage.removeItem("rt.ut"); s("texture", tx); s("stage", false); }, [th, ut, tx]);
    const fps = [];
    for (const [th, ut, tx] of SK) {
      const tag = `${th}-${ut || "plain"}-${tx}`, knit = /^knit/.test(tx);
      await set(th, ut, tx); await p.reload({ waitUntil: "load" }); await ready();
      await c.tap("#tabbar button[data-k=home]"); await c.sleep(900);
      const look = await p.evaluate(() => { const s = document.querySelector("#tabbar .tb-sel"), f = s.querySelector(".ngl-f"), r = s.querySelector(".ngl-r"), t = document.querySelector("#tabbar .ngl-thr");
        const cs = getComputedStyle(s), cf = getComputedStyle(f), cr = getComputedStyle(r);
        return { bf: cs.backdropFilter || cs.webkitBackdropFilter || "none", selBg: cs.backgroundColor, fill: cf.backgroundColor, rimImg: cr.backgroundImage.slice(0, 15), rimBorder: cr.borderTopStyle, rimOp: +cr.opacity, thr: getComputedStyle(t).display }; });
      c.check(`${tag}: lens has a fill and no backdrop-filter`, (look.bf === "none" || !look.bf) && look.fill !== "rgba(0, 0, 0, 0)" && look.selBg === "rgba(0, 0, 0, 0)", look);
      c.check(`${tag}: look = ${knit ? "stitched patch + thread" : "glass rim"}`, knit ? look.rimBorder === "dashed" && look.rimImg === "none" && look.thr !== "none"
        : look.rimImg.startsWith("linear-gradient") && look.rimBorder !== "dashed" && look.thr === "none", look);
      /* tap = navigation in the same task; then sample the lens mid-slide; frame pacing over the whole slide */
      const r = await p.evaluate(async () => {
        const b = document.querySelector("#tabbar button[data-k=activity]"), s = document.querySelector("#tabbar .tb-sel");
        const dts = []; let last = performance.now(), on = true; const loop = t => { dts.push(t - last); last = t; if (on) requestAnimationFrame(loop); }; requestAnimationFrame(loop);
        b.click();
        const now = { on: b.classList.contains("on"), mtab: document.body.dataset.mtab || "", page: App.UI.page };
        const anims = document.getAnimations().filter(a => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest("#tabbar .tb-sel, #tabbar .ngl-thr"));
        const props = [...new Set(anims.flatMap(a => a.effect.getKeyframes().flatMap(k => Object.keys(k).filter(x => !["offset", "computedOffset", "easing", "composite"].includes(x)))))];
        await new Promise(res => setTimeout(res, 160));
        const mid = new DOMMatrix(getComputedStyle(s).transform);
        await new Promise(res => setTimeout(res, 900)); on = false;
        const br = b.getBoundingClientRect(), sr = s.getBoundingClientRect(), end = new DOMMatrix(getComputedStyle(s).transform);
        const d = dts.slice(2).sort((a, b) => a - b);
        return { now, props, mid: { sx: +mid.a.toFixed(2), ty: +mid.f.toFixed(1) }, end: { dx: Math.round(sr.left - br.left), dw: Math.round(sr.width - br.width), sx: end.a },
          frames: d.length, p50: +d[d.length >> 1].toFixed(1), p95: +d[Math.floor(d.length * .95)].toFixed(1), max: +d[d.length - 1].toFixed(1) };
      });
      c.check(`${tag}: the tap navigates at once (does not wait for the animation)`, r.now.on, r.now);
      c.check(`${tag}: the moving lens animates only transform / opacity`, r.props.length && r.props.every(x => x === "transform" || x === "opacity"), r.props);
      c.check(`${tag}: mid-slide the lens is grown and lifted`, r.mid.sx > 1.1 && r.mid.ty < -1, r.mid);
      c.check(`${tag}: the lens ends on the button at rest size`, Math.abs(r.end.dx) <= 1 && Math.abs(r.end.dw) <= 1 && Math.abs(r.end.sx - 1) < .01, r.end);
      fps.push([tag, r.p50, r.p95, r.max]);
      /* frame pacing is a check on a real machine; CI runners render in software, so there it is only noted */
      if (process.env.CI) c.note(`${tag}: frame pacing p50 ${r.p50} ms, p95 ${r.p95} ms (CI, not checked)`);
      else c.check(`${tag}: frame pacing during the slide (p50 ${r.p50} ms, p95 ${r.p95} ms)`, r.p50 <= 18 && r.p95 <= 34, r);
      /* double tap: the lens keeps moving; its speed (px per ms, so a long frame from the page switch is not counted as a jump) at the second tap
         is no higher than during the slide itself */
      const j = await p.evaluate(async () => {
        const s = document.querySelector("#tabbar .tb-sel"), xs = [], fr = () => new Promise(r => requestAnimationFrame(r));
        const pos = () => { const m = new DOMMatrix(getComputedStyle(s).transform); return [m.e, m.f, m.a, performance.now()]; };
        document.querySelector("#tabbar button[data-k=dms]").click();
        const t0 = performance.now(); let tapAt = -1;
        while (performance.now() - t0 < 700) { await fr(); xs.push(pos()); if (tapAt < 0 && performance.now() - t0 > 140) { document.querySelector("#tabbar button[data-k=home]").click(); tapAt = xs.length; } }
        const st = xs.slice(1).map((v, i) => Math.hypot(v[0] - xs[i][0], v[1] - xs[i][1], (v[2] - xs[i][2]) * 50) / Math.max(8, v[3] - xs[i][3]));
        const at = Math.max(st[tapAt - 1] || 0, st[tapAt] || 0), before = Math.max(...st.slice(0, tapAt - 1));
        await new Promise(res => setTimeout(res, 500));
        return { at: +at.toFixed(2), before: +before.toFixed(2), on: document.querySelector("#tabbar button.on").dataset.k };
      });
      c.check(`${tag}: a second tap mid-slide does not jump`, j.at <= Math.max(.35, j.before * 1.3) && j.on === "home", j);
      if (tag === "white-ut-leather1" || tag === "white-ut-knit1" || tag === "dark-plain-off") {
        await p.evaluate(() => document.querySelector("#tabbar button[data-k=activity]").click()); await c.sleep(150);
        await c.shot(`mid-${tag}`, "#tabbar"); await c.sleep(900); await c.shot(`rest-${tag}`, "#tabbar");
      }
    }
    c.note("frame pacing (tag, p50, p95, max ms): " + JSON.stringify(fps));
    /* reduced motion: no slide, no grow; a short fade in place */
    await p.emulateMedia({ reducedMotion: "reduce" }); await c.sleep(200);
    const rm = await p.evaluate(async () => {
      document.querySelector("#tabbar button[data-k=dms]").click();
      const anims = document.getAnimations().filter(a => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest("#tabbar .tb-sel, #tabbar .ngl-thr"));
      const props = [...new Set(anims.flatMap(a => a.effect.getKeyframes().flatMap(k => Object.keys(k).filter(x => !["offset", "computedOffset", "easing", "composite"].includes(x)))))];
      return { props, dur: Math.max(0, ...anims.map(a => a.effect.getTiming().duration)) };
    });
    c.check("reduced motion: fade in place only (opacity, <= 160 ms)", rm.props.every(x => x === "opacity") && rm.dur <= 160, rm);
    await p.emulateMedia({ reducedMotion: "no-preference" });
    c.check("no page errors", !errs.length, errs);
  },
};
