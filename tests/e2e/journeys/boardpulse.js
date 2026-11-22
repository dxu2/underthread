/* t-board-pulse: a home board that gets something new tugs its label once and runs one stitch of light around its border; a knot stays on the
 * label until the board has been seen (0.8 s hover, a click, or 2 s fully on screen with focus). Anti-spam: one cue per board per 20 s (the
 * knot still comes back), quiet hours = knot only, reduced motion = the label brightens, nothing moves. Only transform-type properties
 * (rotate / translate / scale), opacity and stroke-dashoffset are animated.
 * New cards land in 等你拍板 through stateutil (plan cards in review), so it runs on the fixture board.
 *   node tests/e2e/drive.js run tests/e2e/journeys/boardpulse.js --out work/<item>/verify/<run> --engines chromium,webkit
 *   BP_TEXTURE=knit1|leather1 (default knit1)
 */
const OK = new Set(["rotate", "translate", "scale", "transform", "opacity", "strokeDashoffset", "offset", "easing", "composite", "computedOffset"]);
const probe = p => p.evaluate(() => {
  const el = document.querySelector('#wg .wg-grid > .wg[data-wg="review"]'), eb = el && el.querySelector(".wg-eb");
  const mine = t => t && t.matches && t.matches("#wg .wg-eb, #wg .wg-eb *, #wg .bpl-svg, #wg .bpl-svg *, #wg .bpl-new");   /* this card's animations, not the board's own (sprites, tile enter) */
  const anims = document.getAnimations().filter(a => a.effect && mine(a.effect.target) && (!a.animationName || /^bpl-/.test(a.animationName)));
  const props = [...new Set(anims.flatMap(a => a.effect.getKeyframes ? a.effect.getKeyframes().flatMap(k => Object.keys(k)) : []))];
  const css = anims.filter(a => a.animationName).map(a => a.animationName);
  return { tug: !!eb && eb.getAnimations().some(a => a.effect.getKeyframes().some(k => k.rotate)), flash: !!eb && eb.getAnimations().some(a => a.effect.getKeyframes().every(k => k.opacity != null && !k.rotate)),
    svg: !!(el && el.querySelector(".bpl-svg")), knot: !!(eb && eb.querySelector(".bpl-knot")), unseen: window.BoardPulse ? BoardPulse.unseen() : null, props, css,
    newRow: !!(el && el.querySelector(".wg-row.bpl-new")) };
});
module.exports = {
  views: ["desk"],
  hash: () => "#page=review",
  async run(c) {
    const p = c.p, errs = [], tag = Date.now().toString(36) + c.engine.slice(0, 2), tex = process.env.BP_TEXTURE || "knit1";
    p.on("pageerror", e => { const m = String(e).split("\n")[0]; if (!/due to access control checks/.test(m)) errs.push(m); });
    let n = 0; const land = () => c.su("upsert-item", "--id", `fx-bp-${tag}-${++n}`, "--title", `看板提醒测试 ${n} ${tag}`, "--who", "smith", "--kind", "plan", "--stage", "review", "--draft", "x");
    const reset = () => p.evaluate(() => { for (const k in BoardPulse._last) delete BoardPulse._last[k]; });
    await p.evaluate(t => { const s = (k, v) => localStorage.setItem("rt." + k, JSON.stringify(v)); s("lang", "zh"); s("ut", "ut"); s("texture", t); s("chatFold", false); localStorage.removeItem("rt.bpUnseen"); localStorage.removeItem("rt.widgets"); }, tex);
    await p.reload({ waitUntil: "load" });
    await p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash") && document.querySelector("#wg .wg-review") && window.BoardPulse, null, { timeout: 20000 });
    await p.evaluate(() => { App.quietNight = () => false; document.querySelector("#wg").scrollIntoView({ block: "start" }); });
    await p.mouse.move(5, 890); await c.sleep(2500);
    const a0 = await probe(p);
    c.check("first load: no cue, no knot", !a0.tug && !a0.svg && !a0.knot, a0);

    /* 1. a card lands: tug + stitch loop + knot, transform / opacity / dashoffset only */
    land();
    await c.until(() => probe(p).then(x => x.tug || x.flash), 8000);
    await c.sleep(450);
    const a = await probe(p);
    c.check("new card in 等你拍板: label tugged, stitch of light runs, knot on the label", a.tug && a.svg && a.knot && a.unseen.includes("review"), a);
    c.check("the new row is marked and slides in", a.newRow, a);
    c.check("only transform / opacity / stroke-dashoffset are animated", a.props.every(k => OK.has(k)) && a.css.every(x => x === "bpl-wash"), a);
    await c.shot(`cue-mid-${tex}`, "#wg .wg-review");
    await c.sleep(1500);
    const a2 = await probe(p);
    c.check("after ~2 s: the loop is gone, the knot stays", !a2.svg && a2.knot, a2);
    await c.shot(`cue-after-${tex}`, "#wg .wg-review");
    await c.sleep(3200);
    const a3 = await probe(p);
    c.check("2 s fully on screen with focus clears the knot", !a3.knot && !a3.unseen.includes("review"), a3);

    /* 2. another card within 20 s: no second cue, but the knot comes back; a 0.8 s hover clears it */
    land();
    await c.until(() => probe(p).then(x => x.knot), 8000);
    const b = await probe(p);
    c.check("within 20 s: no second cue, knot is back", !b.tug && !b.svg && b.knot, b);
    const box = await p.evaluate(() => { const r = document.querySelector("#wg .wg-review").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await p.mouse.move(box.x, box.y); await c.sleep(1350);
    const b2 = await probe(p);
    c.check("a 0.8 s hover clears the knot (before the 2 s view rule could)", !b2.knot, b2);
    await p.mouse.move(5, 890);

    /* 3. quiet hours: knot only */
    await reset(); await p.evaluate(() => { App.quietNight = () => true; });
    land();
    await c.until(() => probe(p).then(x => x.knot), 8000); await c.sleep(300);
    const q = await probe(p);
    c.check("quiet hours: knot only, nothing moves", q.knot && !q.tug && !q.svg && !q.flash, q);
    await p.evaluate(() => { App.quietNight = () => false; BoardPulse.seen("review"); });

    /* 4. reduced motion: the label brightens, nothing moves */
    await reset(); await p.emulateMedia({ reducedMotion: "reduce" });
    await p.evaluate(() => { document.hasFocus = () => false; });   /* from here the window counts as unfocused, so only the steps below can clear the knot */
    land();
    await c.until(() => probe(p).then(x => x.knot), 8000);
    const r = await probe(p);
    c.check("reduced motion: a 300 ms brighten, no tug, no loop, knot stays", r.knot && !r.tug && !r.svg, r);
    await p.emulateMedia({ reducedMotion: "no-preference" });

    /* 5. reload keeps the knot until seen */
    await p.addInitScript(() => { document.hasFocus = () => false; });   /* window without focus: the 2 s view rule must not clear it while we look */
    await p.reload({ waitUntil: "load" });
    await p.waitForFunction(() => window.BoardPulse && document.querySelector("#wg .wg-review"), null, { timeout: 20000 });
    await c.sleep(600);
    const k = await p.evaluate(() => ({ knot: !!document.querySelector("#wg .wg-review .bpl-knot"), unseen: BoardPulse.unseen(), ls: localStorage.getItem("rt.bpUnseen") }));
    c.check("a reload keeps an unseen knot (window without focus)", k.knot, k);
    await p.evaluate(() => BoardPulse.seen("review"));
    c.check("no page errors", !errs.length, errs);
  },
};
