/* t-onboard-tour, fresh install: the five welcome pages (web/js/tour.js + web/css/tour.css) and the anchored tour after them.
 * The journey resets this form's entry (action onboarding op=tour how=reset: what a fresh install looks like to the page), reloads, then:
 * the welcome opens by itself, five pages with Next / Back, page 1's one-line fine print, the hand-off into the tour, every tour step rings a
 * live target, finishing records meta.onboarding.tour[form].how = done and a reload does not reopen it. While the tour is open no lookaway
 * cue and no board-pulse tug plays (desk: a card lands mid-tour). Reduced motion = 150 ms crossfade, no kitten walk. Entry points:
 * Settings 通用 「再走一遍」 (welcome + tour) and the checklist 「导览 ›」 (tour only).
 *   node tests/e2e/drive.js run tests/e2e/journeys/tour.js --out work/<item>/verify/<run> --engines chromium,webkit
 * Run tourup.js first on a fixtures scratch: this one leaves both forms recorded as done. */
const B = c => c.BASE + "/api/action";
const act = (c, body) => fetch(B(c), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "onboarding", ...body }) }).then(r => r.json());
const look = p => p.evaluate(() => {
  const w = document.querySelector(".otr-w"), t = document.querySelector(".otr-t"), S = window.Tour && Tour._S;
  const box = e => { if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
  const pg = w && w.querySelector(`.otr-pg[data-i="${S.W.cur}"]`);
  return { w: !!w, t: !!t, open: Tour.isOpen(), attr: document.documentElement.hasAttribute("data-otr"), cur: S && S.W.cur, dots: w ? w.querySelectorAll(".otr-dots i").length : 0,
    text: pg ? pg.textContent.replace(/\s+/g, " ").trim() : "", next: w ? w.querySelector(".otr-next").textContent.trim() : "",
    focusIn: !!(document.activeElement && document.activeElement.closest(".otr-w,.otr-t")),
    step: t && t.querySelector(".otr-c") ? t.querySelector(".otr-c").dataset.step : null, ring: box(t && t.querySelector(".otr-ring")), card: box(t && t.querySelector(".otr-c")),
    ghosts: w ? w.querySelectorAll(".otr-ghost").length : 0, anims: document.getAnimations().filter(a => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest(".otr-w")).map(a => Math.round(a.effect.getComputedTiming().duration)) };
});
const tourOf = async (c, f) => { const s = await c.state(); return ((((s.meta || {}).onboarding || {}).tour) || {})[f] || null; };
const waitW = (p, ms = 9000) => p.waitForSelector(".otr-w", { state: "visible", timeout: ms }).then(() => true, () => false);

module.exports = {
  views: ["desk", "phone"],
  async run(c) {
    const p = c.p, f = c.view, errs = [], tag = Date.now().toString(36) + c.engine.slice(0, 2);
    p.on("pageerror", e => { const m = String(e).split("\n")[0]; if (!/due to access control checks/.test(m)) errs.push(m); });
    await p.evaluate(() => { const s = (k, v) => localStorage.setItem("rt." + k, JSON.stringify(v)); s("lang", "zh"); s("ut", "ut"); s("texture", "knit1"); localStorage.removeItem("rt.otr.desk"); localStorage.removeItem("rt.otr.phone"); });
    await act(c, { op: "tour", form: f, how: "reset" });
    await p.reload({ waitUntil: "load" });
    const opened = await waitW(p);
    c.check("fresh form: the welcome opens by itself after the board loads", opened);
    if (!opened) return;
    await c.sleep(1800);
    let a = await look(p);
    c.check("five pages, page 1 first, html[data-otr] set, focus inside", a.dots === 5 && a.cur === 0 && a.attr && a.focusIn, a);
    c.check("page 1 fine print is the one trimmed line", /东西都在你自己的电脑上。/.test(a.text) && !/不会上传|云端|账号/.test(a.text), a.text);
    await c.shot("w1");

    /* lookaway: a cue that arrives while the welcome is open is held, not played */
    const lk0 = await p.evaluate(() => window.LookAway ? { mode: LookAway.mode(), took: LookAway.take([{ text: "测试提示", cls: "info" }]), held: (LookAway._S.held || []).length, pill: !!(LookAway._S.pill && LookAway._S.pill.isConnected) } : null);
    if (lk0 && lk0.mode !== "off") c.check("lookaway: a cue during the welcome is held (no pill, no full screen)", lk0.took && lk0.held >= 1 && !lk0.pill, lk0);
    else c.note("lookaway mode off on this board: hold check skipped " + JSON.stringify(lk0));

    for (let i = 1; i < 5; i++) {
      await c.tap(".otr-next"); await c.sleep(1400);
      a = await look(p);
      c.check(`Next goes to page ${i + 1}`, a.cur === i && a.text.length > 20, { cur: a.cur, text: a.text.slice(0, 40) });
      if (i === 2) await c.shot("w3");
    }
    c.check("the last page's button says 带我认一下路", /带我认一下路/.test(a.next), a.next);
    await c.tap(".otr-back"); await c.sleep(900);
    c.check("Back returns one page", (await look(p)).cur === 3);
    await c.tap(".otr-next"); await c.sleep(900);
    await c.shot("w5");

    /* hand-off: the welcome card morphs into the first tour ring */
    await c.tap(".otr-next");
    await c.until(() => look(p).then(x => !x.w && x.t && x.step), 6000);
    await c.sleep(700);
    a = await look(p);
    c.check("hand-off: welcome gone, tour open on its first step", !a.w && a.t && a.step === "chat" && a.open, a);

    /* desk: a card lands mid-tour, no tug and no full-screen cue */
    if (f === "desk") {
      await p.evaluate(() => { App.quietNight = () => false; });
      c.su("upsert-item", "--id", `fx-otr-${tag}`, "--title", `导览期间到达 ${tag}`, "--who", "smith", "--kind", "plan", "--stage", "review", "--draft", "x");
      await c.sleep(5000);
      const q = await p.evaluate(() => ({ tug: document.getAnimations().some(x => x.effect && x.effect.target && x.effect.target.closest && x.effect.target.closest("#wg .wg-eb") && /^bpl-/.test(x.animationName || "bpl-")),
        svg: !!document.querySelector("#wg .bpl-svg"), fs: !!document.querySelector(".lka-fs"), held: window.LookAway ? (LookAway._S.held || []).length : 0, open: Tour.isOpen() }));
      c.check("a card landing during the tour: no board-pulse stitch, no lookaway full screen", !q.svg && !q.fs && q.open, q);
    }

    const steps = [];
    for (let k = 0; k < 6; k++) {
      a = await look(p); if (!a.t || !a.step) break;
      const ok = a.ring && a.ring[2] > 8 && a.ring[3] > 8 && a.ring[0] >= -2 && a.ring[1] >= -2 && a.ring[0] + a.ring[2] <= (await p.evaluate(() => innerWidth)) + 2;
      steps.push({ step: a.step, ok, ring: a.ring });
      await c.shot("t-" + a.step);
      await c.tap(".otr-nx"); await c.sleep(900);
    }
    c.check("every tour step rings a target on screen", steps.length >= 3 && steps.every(s => s.ok), steps);
    c.check("the core steps chat → review → team are there in order", steps.slice(0, 3).map(s => s.step).join() === "chat,review,team", steps.map(s => s.step));
    await c.sleep(500);
    a = await look(p);
    c.check("Done closes everything and drops html[data-otr]", !a.w && !a.t && !a.open && !a.attr, a);
    const rec = await c.until(() => tourOf(c, f).then(x => x && x.how === "done" && x), 4000);
    c.check(`server records tour.${f}.how = done`, rec && rec.how === "done", rec);
    if (lk0 && lk0.mode !== "off") {
      const lk1 = await p.evaluate(() => ({ held: (LookAway._S.held || []).length }));
      c.check("held lookaway cues are released when the tour closes", lk1.held === 0, lk1);
    }

    await p.reload({ waitUntil: "load" });
    c.check("reload: it does not open again", !(await waitW(p, 4000)));

    /* Settings → 通用 → 再走一遍: welcome + tour again */
    if (f === "desk") await p.evaluate(() => App.go("settings")); else await c.go("settings");   /* desk: a later #page= hash no longer routes (only at boot), so drive.js go() misses */
    await p.waitForSelector("[data-otr-replay]", { timeout: 6000 }).catch(() => c.note("settings row not found; page " + p.url()));
    const row = await p.$("[data-otr-replay]");
    c.check("Settings 通用 has 上手引导 · 再走一遍 with the last walk", !!row && /再走一遍/.test(await row.textContent()) && /走完|跳过|升级/.test(await row.textContent()), row && (await row.textContent()));
    if (row) {
      await c.shot("settings", "[data-otr-replay]");
      await c.tap("[data-otr-replay]");
      c.check("再走一遍 opens the welcome again", await waitW(p, 4000));
      await c.sleep(600);
      await c.tap(".otr-skip"); await c.sleep(600);
      a = await look(p);
      c.check("跳过 closes it at once", !a.w && !a.t && !a.open, a);
      const r2 = await c.until(() => tourOf(c, f).then(x => x && x.how === "skip" && x), 4000);
      c.check(`skipping records tour.${f}.how = skip`, r2 && r2.how === "skip", r2);
    }

    /* the checklist header 「导览 ›」: tour only */
    const shown = !!(await c.state()).meta.setup;   /* the checklist is on (fixture board): leave it as it is; else bring it back and retire it again after */
    if (!shown) await act(c, { op: "show" });
    await c.sleep(300); await p.reload({ waitUntil: "load" });
    await p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 15000 });
    if (f === "phone") { await c.tap("#tabbar button[data-k=home]"); }
    await c.sleep(1200);
    const lnk = await p.$$eval(".otr-link", els => els.filter(e => e.getBoundingClientRect().width > 0).length);
    if (lnk) {
      await p.locator(".otr-link").first().evaluate(e => e.scrollIntoView({ block: "center" })); await c.sleep(300);
      await c.shot("checklist-link", f === "desk" ? ".otr-link" : ".ob-hd");
      await c.tap(".otr-link"); await c.sleep(1200);
      a = await look(p);
      c.check("导览 › opens the tour only (no welcome pages)", !a.w && a.t && a.open, a);
      await c.tap(".otr-sk"); await c.sleep(600);
      c.check("跳过引导 closes the tour", !(await look(p)).open);
    } else c.note("checklist not on screen for this view: 导览 › not clicked");
    if (!shown) await act(c, { op: "hide" });

    /* reduced motion: 150 ms crossfades, no walk */
    await p.emulateMedia({ reducedMotion: "reduce" });
    await p.evaluate(() => Tour.welcome());
    await waitW(p, 4000); await c.sleep(400);
    await c.tap(".otr-next"); await c.sleep(40);
    a = await look(p);
    c.check("reduced motion: the page swap is a 150 ms crossfade", a.cur === 1 && a.anims.length > 0 && a.anims.every(d => d <= 200) && a.anims.includes(150), a.anims);
    const walk = await p.evaluate(() => Tour._S.W.walk);
    c.check("reduced motion: the kitten does not walk", !walk, walk);
    await c.tap(".otr-skip"); await c.sleep(400);
    await p.emulateMedia({ reducedMotion: "no-preference" });
    await act(c, { op: "tour", form: f, how: "done" });
    c.check("no page errors", !errs.length, errs);
  },
};
