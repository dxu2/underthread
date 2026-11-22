/* t-yarn-anim: knit kittens. (1) A kitten plays only on the HOME 「此刻在忙 / Working now」 card (user 11-22 10:21): by the working role's avatar in
 * the phone A2 rows and by the desk busy widget's patch (特典). The TEAM rail and the phone chat list carry none. A role with a level-2 script
 * (meta.art[id].yarn, your local/ layer) also gets the moving eye layer. Idle -> working = the start beat (fades in), then the loop on the 16 s
 * phase; a poll never swaps the kitten or the avatar node. Phone: a role that finishes its card keeps its row for the 委托完成 plate, and the
 * kitten plays the done beat there. Reduced motion: the static rest kitten. (2) The Notice line kitten: B naps by default, A nudges the ball
 * when a new notice arrives, C tugs the thread now and then (forced here with the window.__nykNext hook), night = B only. Transform / opacity only.
 *   node tests/e2e/drive.js run tests/e2e/journeys/yarnkit.js --out work/<item>/verify/<run> --engines chromium,webkit
 * Makes its own card per run (fx-yk-<run>-<engine><view>) and drives a role that is idle at the start (a level-2 role if there is one). */
const RUN = Date.now().toString(36);
const OK = new Set(["transform", "opacity", "offset", "easing", "composite", "computedOffset"]);
module.exports = {
  views: ["desk", "phone"],
  hash: () => "",
  async run(c) {
    const p = c.p, errs = [], tag = `${RUN}-${c.engine.slice(0, 2)}${c.view[0]}`, phone = c.view === "phone";
    p.on("pageerror", e => { const m = String(e).split("\n")[0]; if (!/due to access control checks/.test(m)) errs.push(m); });   /* WebKit reports the long poll a reload aborts as a page error */
    await p.evaluate(() => { const s = (k, v) => localStorage.setItem("rt." + k, JSON.stringify(v)); s("lang", "zh"); s("ut", "ut"); s("texture", "leather1"); s("chatFold", false); localStorage.removeItem("rt.yk"); });
    await p.reload({ waitUntil: "load" });
    await p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 20000 });
    const st0 = await c.state(), ag = Object.values(st0.agents || {}), art = (st0.meta || {}).art || {};
    const idle = ag.filter(a => a.id !== "manager" && a.status !== "working" && a.enabled !== false);
    const role = (idle.find(a => (art[a.id] || {}).yarn) || idle[0]).id, l2 = !!(art[role] || {}).yarn;
    c.note(`role ${role}${l2 ? " (level 2)" : " (generic kitten)"}`);
    const home = phone ? ".hd-a2" : ".wg-busy";
    const goHome = async () => { if (phone) { await c.tap("#tabbar button[data-k=home]"); await c.sleep(700); } else await p.evaluate(() => { location.hash = ""; }); };
    await goHome();
    const box = `${home} .yk[data-yk="${role}"]`;
    const probe = () => p.evaluate(sel => {
      const y = document.querySelector(sel), fx = y && y.querySelector(".yk-fx");
      return y ? { cls: y.className, key: y.dataset.ykk, fx: !!fx, ey: !!y.querySelector(".yk-ey"), fxAnim: fx ? getComputedStyle(fx).animationName : null, fxImg: fx ? getComputedStyle(fx).backgroundImage : "", bx: fx ? getComputedStyle(fx).backgroundPositionX : null } : null;
    }, box);
    /* every class the role's wrapper shows, so a 1.6 s beat between two checks is not missed */
    await p.evaluate(sel => { window.__ykSeen = []; const rec = () => { const y = document.querySelector(sel); const k = y ? y.className : "none"; if (window.__ykSeen[window.__ykSeen.length - 1] !== k) window.__ykSeen.push(k); }; new MutationObserver(rec).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] }); rec(); }, box);
    const seen = () => p.evaluate(() => window.__ykSeen.slice());
    /* nowhere but the home card: no wrapper in the TEAM rail / chat list */
    const where = () => p.evaluate(h => [...document.querySelectorAll(".yk")].filter(y => !y.closest(h)).map(y => (y.parentElement.closest("[id]") || {}).id || y.parentElement.className), home);

    const w0 = await where();
    c.check("no kitten outside the home 「此刻在忙」 card (TEAM rail, chat list)", !w0.length, w0);
    const a0 = await probe();
    c.check("idle role: not on the card, no kitten", !a0, a0);
    await c.shot("rest", home);

    /* 1. idle -> working: start beat, then the loop (changes in the first 4 s after a load are taken as the boot snapshot catching up) */
    await c.until(() => p.evaluate(() => performance.now() > 4600), 15000);   /* past yarnkit.js's 4 s boot guard (a fast fixture load gets here sooner) */
    const card = `fx-yk-${tag}`;
    c.su("upsert-item", "--id", card, "--title", `毛线猫测试 ${tag}`, "--who", role, "--owner", role, "--category", "side", "--kind", "deliverable", "--stage", "doing");
    c.su("set-agent", role, "--status", "working", "--item", card, "--activity", "yarn test");
    await c.until(() => seen().then(s => s.some(x => /yk-start/.test(x))), 10000);
    await c.shot("start-beat", home);
    const run = await c.until(() => probe().then(x => x && /yk-run/.test(x.cls) && x), 8000);
    c.check("working: the start beat played, then the loop runs", (await seen()).some(x => /yk-start yk-beat/.test(x)) && !!run, await seen());
    const b1 = (await probe()).bx; await c.sleep(450); const b2 = (await probe()).bx;
    c.check("the loop sprite steps (background-position moves)", run && run.fxAnim === "yk-x" && b1 !== b2, { b1, b2 });
    c.check(l2 ? "level-2 role: eye layer while it works" : "generic role: kitten only, no eye layer", run && run.ey === l2, run);
    const w1 = await where();
    c.check("still nowhere else while it works", !w1.length, w1);
    await c.shot("run", home);

    /* 2. polls never swap the kitten or the avatar (no restart, no flash) */
    await p.evaluate(sel => { const y = document.querySelector(sel); window.__ykNodes = [y, y.firstElementChild, y.querySelector(".yk-fx")]; }, box);
    c.su("set-agent", role, "--status", "working", "--item", card, "--activity", "yarn test 2");
    c.su("log", card, role, "yarn poll");
    await c.sleep(2600);
    const same = await p.evaluate(sel => { const y = document.querySelector(sel); return !!y && window.__ykNodes[0] === y && window.__ykNodes[1] === y.firstElementChild && window.__ykNodes[2] === y.querySelector(".yk-fx"); }, box);
    c.check("two polls later: the same wrapper, avatar and kitten nodes", same);

    /* 3. stop. Phone: the card is done, the row stays for the 委托完成 plate and the kitten plays the done beat, then the row goes.
          Desk: the busy widget moves on; the role's kitten is gone. */
    c.su("upsert-item", "--id", card, "--who", role, "--kind", "deliverable", "--stage", phone ? "done" : "review", "--draft", "yarn test draft", "--label", "v1");
    c.su("set-agent", role, "--status", "idle");
    if (phone) {
      await c.until(() => seen().then(s => s.some(x => /yk-done/.test(x))), 10000);
      await c.shot("done-beat", home);
      c.check("phone: the finishing row plays the done beat", (await seen()).some(x => /yk-done yk-beat/.test(x)), await seen());
    }
    const gone = await c.until(() => probe().then(x => !x || (/yk-off/.test(x.cls) && !x.fx) ? "gone" : null), 9000);
    c.check("stopped: no kitten for the role any more", gone === "gone", await probe());
    await c.sleep(3200);
    const g2 = await probe();
    c.check("still no kitten after two polls", !g2 || (/yk-off/.test(g2.cls) && !g2.fx), g2);
    await c.shot("off", home);
    c.su("upsert-item", "--id", card, "--who", role, "--stage", "doing");

    /* 4. a second start still gets the start beat (the role was not drawn while idle) */
    await p.evaluate(() => { window.__ykSeen.length = 0; });
    c.su("set-agent", role, "--status", "working", "--item", card);
    await c.until(() => probe().then(x => x && /yk-run/.test(x.cls)), 10000);
    c.check("a second start plays the start beat again", (await seen()).some(x => /yk-start yk-beat/.test(x)), await seen());

    /* 5. a reload draws the target state without replaying a beat */
    await p.reload({ waitUntil: "load" });
    await p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 20000 });
    await goHome();
    await c.sleep(800);
    const rl = await probe();
    c.check("after a reload: straight to the loop, no start beat", rl && /yk-run/.test(rl.cls) && !/yk-beat/.test(rl.cls), rl);

    /* 6. reduced motion: static rest kitten, nothing moves */
    await p.emulateMedia({ reducedMotion: "reduce" }); await c.sleep(300);
    const rm = await probe();
    c.check("reduced motion: no sprite animation, the rest kitten", rm && rm.fxAnim === "none" && rm.fxImg.includes("fx-rest"), rm);
    await c.shot("reduced", home);
    await p.emulateMedia({ reducedMotion: "no-preference" });
    c.su("set-agent", role, "--status", "idle");
    c.su("upsert-item", "--id", card, "--who", role, "--stage", "done");

    /* 7. the Notice line kitten (clock fixed to the afternoon: 22:30-08:00 is night, B only) */
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
