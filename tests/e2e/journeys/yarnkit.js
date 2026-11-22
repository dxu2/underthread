/* t-yarn-anim: knit kittens. (1) Every teammate in the TEAM rail (desk) / chat list (phone) carries a kitten layer; a role with a level-2
 * script (meta.art[id].yarn, your local/ layer) also gets the moving eye layer. A state change plays one beat: idle -> working = start (then
 * the loop on the 16 s phase), working -> idle with its card in review = review (held on its last frame), card done = done (then asleep).
 * Reduced motion: the static rest kitten, nothing moves. (2) The Notice line kitten: B naps by default, A nudges the ball when a new notice
 * arrives, C tugs the thread now and then (forced here with the window.__nykNext hook), night = B only. Transform / opacity only.
 *   node tests/e2e/drive.js run tests/e2e/journeys/yarnkit.js --out work/<item>/verify/<run> --engines chromium,webkit
 * Makes its own card per run (fx-yk-<run>-<engine><view>) and drives a role that is idle at the start (a level-2 role if there is one). */
const RUN = Date.now().toString(36);
const OK = new Set(["transform", "opacity", "offset", "easing", "composite", "computedOffset"]);
module.exports = {
  views: ["desk", "phone"],
  hash: () => "",
  async run(c) {
    const p = c.p, errs = [], tag = `${RUN}-${c.engine.slice(0, 2)}${c.view[0]}`;
    p.on("pageerror", e => errs.push(String(e).split("\n")[0]));
    await p.evaluate(() => { const s = (k, v) => localStorage.setItem("rt." + k, JSON.stringify(v)); s("lang", "zh"); s("ut", "ut"); s("texture", "leather1"); s("chatFold", false); localStorage.removeItem("rt.yk"); });
    await p.reload({ waitUntil: "load" });
    await p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 20000 });
    const st0 = await c.state(), ag = Object.values(st0.agents || {}), art = (st0.meta || {}).art || {};
    const idle = ag.filter(a => a.id !== "manager" && a.status !== "working" && a.enabled !== false);
    const role = (idle.find(a => (art[a.id] || {}).yarn) || idle[0]).id, l2 = !!(art[role] || {}).yarn;
    c.note(`role ${role}${l2 ? " (level 2)" : " (generic kitten)"}`);
    const scope = c.view === "phone" ? ".cl-rows" : "#team";
    if (c.view === "phone") { await c.tap("#tabbar button[data-k=dms]"); await c.sleep(900); }
    else await p.evaluate(() => document.querySelector("#team").scrollIntoView({ block: "center" }));
    const box = `${scope} .yk[data-yk="${role}"]`;
    const probe = () => p.evaluate(sel => {
      const y = document.querySelector(sel), fx = y && y.querySelector(".yk-fx");
      return y ? { cls: y.className, ey: !!y.querySelector(".yk-ey"), fxAnim: fx ? getComputedStyle(fx).animationName : null, fxImg: fx ? getComputedStyle(fx).backgroundImage : "", fx0: y.style.getPropertyValue("--yk-fx0"), bx: fx ? getComputedStyle(fx).backgroundPositionX : null } : null;
    }, box);
    /* every class the role's wrapper shows, so a 1.6 s beat between two checks is not missed */
    await p.evaluate(sel => { window.__ykSeen = []; const rec = () => { const y = document.querySelector(sel); if (y && window.__ykSeen[window.__ykSeen.length - 1] !== y.className) window.__ykSeen.push(y.className); }; new MutationObserver(rec).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] }); rec(); }, box);
    const seen = () => p.evaluate(() => window.__ykSeen.slice());

    const all = await p.evaluate(s => { const rows = [...document.querySelectorAll(s === "#team" ? "#team .team-i" : ".cl-rows .cl-row")]; return { rows: rows.length, yk: rows.filter(r => r.querySelector(".yk > .av + * , .yk > .yk-fx")).length }; }, scope);
    c.check("every teammate row carries a kitten layer", all.rows > 0 && all.rows === all.yk, all);
    const a0 = await probe();
    c.check("idle role: asleep (yk-rest), no beat on first draw", a0 && /yk-rest/.test(a0.cls) && !/yk-beat/.test(a0.cls), a0);
    c.check(l2 ? "level-2 role: eye layer on top of the eyeless art" : "generic role: kitten only, no eye layer", a0 && a0.ey === l2, a0);
    await c.shot("rest", scope);

    /* 1. idle -> working: start beat, then the loop (changes in the first 4 s after a load are taken as the boot snapshot catching up) */
    await c.until(() => p.evaluate(() => performance.now() > 4600), 15000);   /* past yarnkit.js's 4 s boot guard (a fast fixture load gets here sooner) */
    const card = `fx-yk-${tag}`;
    c.su("upsert-item", "--id", card, "--title", `毛线猫测试 ${tag}`, "--who", role, "--owner", role, "--category", "side", "--kind", "deliverable", "--stage", "doing");
    c.su("set-agent", role, "--status", "working", "--item", card, "--activity", "yarn test");
    await c.until(() => seen().then(s => s.some(x => /yk-start/.test(x))), 10000);
    await c.shot("start-beat", scope);
    const run = await c.until(() => probe().then(x => x && /yk-run/.test(x.cls) && x), 8000);
    c.check("working: the start beat played, then the loop runs", (await seen()).some(x => /yk-start yk-beat/.test(x)) && !!run, await seen());
    const b1 = (await probe()).bx; await c.sleep(450); const b2 = (await probe()).bx;
    c.check("the loop sprite steps (background-position moves)", run && run.fxAnim === "yk-x" && b1 !== b2, { b1, b2 });
    await c.shot("run", scope);

    /* 2. working -> idle with the card in review: review beat, held on its last frame (also after a re-render) */
    c.su("upsert-item", "--id", card, "--who", role, "--kind", "deliverable", "--stage", "review", "--draft", "yarn test draft", "--label", "v1");
    c.su("set-agent", role, "--status", "idle");
    const rv = await c.until(() => probe().then(x => x && /yk-review/.test(x.cls) && x), 10000);
    c.check("card in review: the review beat plays and holds", !!rv, rv);
    await c.sleep(3200);
    const rv2 = await probe();
    c.check("still holding the review pose after two polls", rv2 && /yk-review/.test(rv2.cls), rv2);
    await c.shot("review", scope);

    /* 3. card done: done beat, then asleep */
    c.su("upsert-item", "--id", card, "--who", role, "--stage", "done");
    await c.until(() => seen().then(s => s.some(x => /yk-done/.test(x))), 10000);
    const rest = await c.until(() => probe().then(x => x && /yk-rest/.test(x.cls) && x), 8000);
    c.check("card done: the done beat played, then asleep", (await seen()).some(x => /yk-done yk-beat/.test(x)) && !!rest, await seen());

    /* 4. a reload draws the target state without replaying a beat */
    c.su("set-agent", role, "--status", "working", "--item", card);
    await c.until(() => probe().then(x => x && /yk-run/.test(x.cls)), 10000);
    await p.reload({ waitUntil: "load" });
    await p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 20000 });
    if (c.view === "phone") { await c.tap("#tabbar button[data-k=dms]"); await c.sleep(900); }
    await c.sleep(800);
    const rl = await probe();
    c.check("after a reload: straight to the loop, no start beat", rl && /yk-run/.test(rl.cls) && !/yk-beat/.test(rl.cls), rl);

    /* 5. reduced motion: static rest kitten, nothing moves */
    await p.emulateMedia({ reducedMotion: "reduce" }); await c.sleep(300);
    const rm = await probe();
    c.check("reduced motion: no sprite animation, the rest kitten", rm && rm.fxAnim === "none" && rm.fxImg.includes("fx-rest"), rm);
    await c.shot("reduced", scope);
    await p.emulateMedia({ reducedMotion: "no-preference" });
    c.su("set-agent", role, "--status", "idle");

    /* 6. the Notice line kitten (clock fixed to the afternoon: 22:30-08:00 is night, B only) */
    const day = new Date(); day.setHours(14, 0, 0, 0);
    await p.clock.setFixedTime(day);
    await p.reload({ waitUntil: "load" });   /* daytime list from the first draw: cards held overnight are not "new" here */
    await p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 20000 });
    await c.sleep(800);
    if (c.view === "phone") { await c.tap("#tabbar button[data-k=home]"); await c.sleep(600); }
    const tk = () => p.evaluate(() => { const t = document.getElementById("ticker"), mine = e => e && e.closest && e.closest("#ticker");
      const an = document.getAnimations().filter(a => a.effect && mine(a.effect.target) && /^nyk-/.test(a.animationName || ""));
      return { cls: t.className, pose: (t.querySelector(".nyk svg") || {}).classList ? t.querySelector(".nyk svg").getAttribute("class") : null, text: (t.querySelector(".msg") || {}).textContent || "",
        props: [...new Set(an.flatMap(a => a.effect.getKeyframes().flatMap(k => Object.keys(k))))], names: [...new Set(an.map(a => a.animationName))] }; });
    const t0 = await tk();
    c.check("Notice kitten: naps by default (B)", /nyk-b/.test(t0.cls) && t0.pose === "nyk-nap", t0);
    await c.shot("ticker-b", "#ticker");
    c.su("notice", `毛线猫通知 ${tag}`, "--hours", "30");
    const ta = await c.until(() => tk().then(x => /nyk-a/.test(x.cls) && x), 10000);
    c.check("a new notice jumps in with the nudge (A), the kitten sits up", ta && ta.pose === "nyk-sit" && ta.text.includes(tag), ta);
    await c.sleep(500);
    const ta2 = await tk();
    c.check("A animates transform / opacity only", ta2.props.every(k => OK.has(k)), ta2);
    await c.shot("ticker-a", "#ticker");
    await p.evaluate(() => { window.__nykNext = "c"; });
    const tc = await c.until(() => tk().then(x => /nyk-c/.test(x.cls) && x), 9000);
    c.check("now and then a switch tugs the thread (C)", !!tc && tc.pose === "nyk-sit", tc);
    await c.sleep(300);
    const tc2 = await tk();
    c.check("C animates transform / opacity only", tc2.props.every(k => OK.has(k)), tc2);
    await c.shot("ticker-c", "#ticker");
    const tb = await c.until(() => tk().then(x => /nyk-b/.test(x.cls) && x), 9000);
    c.check("the next switch naps again (B)", !!tb && tb.pose === "nyk-nap", tb);

    /* night: B only, even for a new notice */
    const night = new Date(); night.setHours(23, 40, 0, 0);
    await p.clock.setFixedTime(night);
    c.su("notice", `毛线猫夜里 ${tag}`, "--hours", "30");
    await c.until(() => tk().then(x => x.text.includes(`夜里 ${tag}`)), 10000);
    await c.sleep(2600);   /* a later poll must not turn it into A either */
    const tn = await tk();
    c.check("night: a new notice still gets the nap (B)", /nyk-b/.test(tn.cls) && !/nyk-a/.test(tn.cls), tn);
    c.check("no page errors", !errs.length, errs);
  },
};
