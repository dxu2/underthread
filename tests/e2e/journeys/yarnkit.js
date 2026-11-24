/* t-yarn-anim: knit kittens. (1) A kitten plays only on the HOME 「此刻在忙 / Working now」 card (user 11-22 10:21): by the working role's avatar in
 * the phone A2 rows and by the desk busy widget's patch (特典). The TEAM rail and the phone chat list carry none. A role with a level-2 script
 * (meta.art[id].yarn, your local/ layer) also gets the moving eye layer. Idle -> working = the start beat (fades in), then the loop on the 16 s
 * phase; a poll never swaps the kitten or the avatar node. Phone: a role that finishes its card keeps its row for the 委托完成 plate, and the
 * kitten plays the done beat there. Reduced motion: the static rest kitten. (2) The Notice line kitten (t-kitten-daypart): one action per part of
 * the day, 08-12 A nudges the ball, 12-18 C tugs the thread, 18-22:30 B dozes, night N sleeps. Transform / opacity only.
 *   node tests/e2e/drive.js run tests/e2e/journeys/yarnkit.js --out work/<item>/verify/<run> --engines chromium,webkit
 * Makes its own card per run (fx-yk-<run>-<engine><view>) and drives a role that is idle at the start (a level-2 role if there is one).
 * t-yarn-sleep: the kitten is an easter egg: only after 5 minutes of work (since), one 1-in-3 draw per stretch (id + since), asleep at night
 * (22:30-08:00), a tap stretches / rolls it and opens nothing, 设置 › 外观 › 小猫彩蛋 turns it off. The test hook window.__yk = { now, draw, since }
 * (kept across reloads here through sessionStorage) forces the clock, the draw and since; sections 1-6 run with "won, 6 minutes in, 14:00". */
const RUN = Date.now().toString(36);
const OK = new Set(["transform", "opacity", "offset", "easing", "composite", "computedOffset"]);
/* yarnkit.js lot(): FNV-1a of id|since, one in three wins */
const lot = (id, sn) => { let h = 2166136261; const x = id + "|" + sn; for (let i = 0; i < x.length; i++) { h ^= x.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) % 3 === 0; };
const at = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return +d; };
const DAY = at(14, 0), NIGHT = at(23, 40);
module.exports = {
  views: ["desk", "phone"],
  hash: () => "",
  async run(c) {
    const p = c.p, errs = [], tag = `${RUN}-${c.engine.slice(0, 2)}${c.view[0]}`, phone = c.view === "phone";
    p.on("pageerror", e => { const m = String(e).split("\n")[0]; if (!/due to access control checks/.test(m)) errs.push(m); });   /* WebKit reports the long poll a reload aborts as a page error */
    await p.addInitScript(() => { try { const v = sessionStorage.getItem("__ykT"); if (v) window.__yk = JSON.parse(v); } catch (_) { } });
    /* the test hook; redraw = draw the home now instead of waiting for yarnkit's 15 s check */
    const hook = async (o, redraw = true) => { await p.evaluate(([o, r]) => { sessionStorage.setItem("__ykT", JSON.stringify(o)); window.__yk = o; if (r) App.refreshPage(); }, [o, redraw]); await c.sleep(redraw ? 500 : 0); };
    const WON = { now: DAY, since: new Date(DAY - 6 * 60000).toISOString(), draw: true };
    await p.evaluate(o => sessionStorage.setItem("__ykT", JSON.stringify(o)), WON);
    await p.evaluate(() => { const s = (k, v) => localStorage.setItem("rt." + k, JSON.stringify(v)); s("lang", "zh"); s("ut", "ut"); s("texture", "leather1"); s("chatFold", false); localStorage.removeItem("rt.yk"); localStorage.removeItem("rt.ykOn"); });
    await p.reload({ waitUntil: "load" });
    await p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 20000 });
    const st0 = await c.state(), ag = Object.values(st0.agents || {}), art = (st0.meta || {}).art || {};
    const idle = ag.filter(a => a.id !== "manager" && a.status !== "working" && a.enabled !== false);
    const role = (idle.find(a => (art[a.id] || {}).yarn) || idle[0]).id, l2 = !!(art[role] || {}).yarn;
    c.note(`role ${role}${l2 ? " (level 2)" : " (generic kitten)"}`);
    const home = phone ? ".hd-a2" : ".wg-busy";
    const goHome = async () => { if (phone) { await c.tap("#tabbar button[data-k=home]"); await c.sleep(700); } else await p.evaluate(() => { location.hash = ""; if (App.UI.page !== "review") App.go("review"); }); };
    await goHome();
    const box = `${home} .yk[data-yk="${role}"]`;
    const probe = () => p.evaluate(sel => {
      const y = document.querySelector(sel), fx = y && y.querySelector(".yk-fx");
      return y ? { cls: y.className, key: y.dataset.ykk, fx: !!fx, ey: !!y.querySelector(".yk-ey"), fxAnim: fx ? getComputedStyle(fx).animationName : null, fxImg: fx ? getComputedStyle(fx).backgroundImage : "", bx: fx ? getComputedStyle(fx).backgroundPositionX : null } : null;
    }, box);
    /* every class the role's wrapper shows, so a 1.6 s beat between two checks is not missed */
    const recSeen = () => p.evaluate(sel => { window.__ykSeen = []; const rec = () => { const y = document.querySelector(sel); const k = y ? y.className : "none"; if (window.__ykSeen[window.__ykSeen.length - 1] !== k) window.__ykSeen.push(k); }; new MutationObserver(rec).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] }); rec(); }, box);
    await recSeen();
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

    /* 8. t-yarn-sleep: the easter-egg rules on a fresh work stretch */
    const card2 = `fx-yks-${tag}`, ui = () => p.evaluate(() => ({ chat: App.UI.chat, item: App.UI.item, page: App.UI.page, hash: location.hash }));
    c.su("upsert-item", "--id", card2, "--title", `毛线猫睡觉 ${tag}`, "--who", role, "--owner", role, "--category", "side", "--kind", "deliverable", "--stage", "doing");
    await hook({ now: DAY, since: new Date(DAY - 2 * 60000).toISOString(), draw: true });
    c.su("set-agent", role, "--status", "working", "--item", card2, "--activity", "yarn sleep test");
    await c.until(() => p.evaluate(sel => !!document.querySelector(sel), box), 10000);
    await c.sleep(2600);
    const g0 = await probe();
    c.check("8a. under 5 minutes of work: no kitten yet", g0 && /yk-off/.test(g0.cls) && !g0.fx, g0);
    await recSeen();
    await hook({ now: DAY, since: new Date(DAY - 5 * 60000 - 1000).toISOString(), draw: true }, false);   /* no redraw: yarnkit's own 15 s check must notice */
    const g1 = await c.until(() => probe().then(x => x && /yk-run/.test(x.cls) && x), 25000);
    c.check("8a. the 5-minute mark passes without a poll: the kitten wakes with the start beat", !!g1 && (await seen()).some(x => /yk-start yk-beat/.test(x)), await seen());
    /* the draw: one in three, from id + since, the same after a reload */
    let win = null, lose = null;
    for (let k = 6; k < 200 && !(win && lose); k++) { const sn = new Date(DAY - k * 60000).toISOString(); if (lot(role, sn)) win = win || sn; else lose = lose || sn; }
    let w = 0; for (let k = 0; k < 3000; k++) if (lot(role, new Date(DAY - k * 61000).toISOString())) w++;
    c.check("8b. the draw wins about one stretch in three", w > 850 && w < 1150, { w, of: 3000 });
    await hook({ now: DAY, since: lose });
    const l1 = await c.until(() => probe().then(x => x && /yk-off/.test(x.cls) && !x.fx && x), 6000) || await probe();   /* it was awake: the done beat and the fade first */
    c.check("8b. a stretch that lost the draw: no kitten", l1 && /yk-off/.test(l1.cls) && !l1.fx, l1);
    await p.reload({ waitUntil: "load" });
    await p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 20000 });
    await goHome(); await c.sleep(1200);
    const l2r = await probe();
    c.check("8b. still no kitten after a reload (no re-roll)", l2r && /yk-off/.test(l2r.cls) && !l2r.fx, l2r);
    await hook({ now: DAY, since: win });
    const wn = await c.until(() => probe().then(x => x && /yk-run|yk-start/.test(x.cls) && x), 5000);
    c.check("8b. a stretch that won the draw: the kitten", !!wn, await probe());
    /* night */
    const nap = () => p.evaluate(sel => { const y = document.querySelector(sel), n = y && y.querySelector(".yk-fx svg.yk-nap"), bd = n && n.querySelector(".bd"), z = n && n.querySelector(".z"), ey = y && y.querySelector(".yk-ey");
      return y ? { cls: y.className, nap: !!n, bd: bd ? getComputedStyle(bd).animationName : null, z: z ? getComputedStyle(z).animationName : null, ey: ey ? getComputedStyle(ey).backgroundPositionX : null, hit: !!y.querySelector(".yk-hit"), title: y.getAttribute("title") || (y.querySelector(".yk-hit") || {}).title || "" } : null; }, box);
    await hook({ now: NIGHT, since: new Date(NIGHT - 6 * 60000).toISOString(), draw: true });
    const n1 = await c.until(() => nap().then(x => x && x.nap && x), 5000);
    c.check("8c. night (23:40): the kitten sleeps curled up (pose A), breathing, z's drifting", n1 && /yk-sleep/.test(n1.cls) && n1.bd === "yk-breathe" && n1.z === "yk-z", n1);
    c.check(l2 ? "8c. level-2 role asleep: the closed-eyes pose" : "8c. generic role asleep: no eye layer", n1 && (l2 ? n1.ey === "100%" : n1.ey === null), n1);
    c.check("8c. no hint anywhere: no title on the kitten", n1 && !n1.title, n1);
    await c.shot("sleep", home);
    await hook({ now: at(3, 0), since: new Date(at(3, 0) - 6 * 60000).toISOString(), draw: true });
    const n3 = await nap();
    c.check("8c. 03:00 is still night", n3 && n3.nap, n3);
    await hook({ now: at(8, 30), since: new Date(at(8, 30) - 6 * 60000).toISOString(), draw: true });
    const n8 = await c.until(() => probe().then(x => x && /yk-run/.test(x.cls) && x), 5000);
    c.check("8c. 08:30 is day: awake again (no beat replayed)", !!n8 && !/yk-beat/.test(n8.cls), await probe());
    /* a tap: night = roll-over, day = stretch; never the chat or the card; once per 10 s */
    const tapK = async () => { const u0 = await ui(); const h = await p.$(`${box} .yk-hit`); if (!h) return { none: true };
      if (phone) await h.tap({ force: true }); else await h.click({ force: true });
      await c.sleep(250);
      const an = await p.evaluate(sel => document.getAnimations().filter(a => !a.animationName && a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest(sel)).map(a => (a.effect.target.getAttribute("class") || "")), box);
      await c.sleep(900); const u1 = await ui(); return { an, same: JSON.stringify(u0) === JSON.stringify(u1), u0, u1 }; };
    await hook({ now: DAY, since: new Date(DAY - 6 * 60000).toISOString(), draw: true });
    await c.until(() => probe().then(x => x && /yk-run/.test(x.cls)), 5000);
    const td1 = await tapK();
    c.check("8d. day tap: the kitten stretches (WAAPI on the kitten layer)", td1.an && td1.an.includes("yk-fx"), td1);
    c.check("8d. day tap opens nothing", td1.same, td1);
    const td2 = await tapK();
    c.check("8d. a second tap within 10 s: no second move", td2.an && !td2.an.length && td2.same, td2);
    await c.sleep(9000);   /* one move per kitten per 10 s */
    await hook({ now: NIGHT, since: new Date(NIGHT - 6 * 60000).toISOString(), draw: true });
    await c.until(() => nap().then(x => x && x.nap), 5000);
    const tn1 = await tapK();
    c.check("8e. night tap: the kitten rolls over (WAAPI on the sleeping kitten)", tn1.an && tn1.an.includes("yk-roll"), tn1);
    c.check("8e. night tap opens nothing (chat, card, page unchanged)", tn1.same, tn1);
    await c.shot("night-tap", home);
    /* reduced motion at night: static, a tap does nothing */
    await hook({ now: NIGHT, since: new Date(NIGHT - 6 * 60000).toISOString(), draw: true });
    await p.emulateMedia({ reducedMotion: "reduce" }); await c.sleep(300);
    const nr = await nap();
    c.check("8f. reduced motion at night: the sleeping kitten is still", nr && nr.nap && nr.bd === "none" && nr.z === "none", nr);
    await p.emulateMedia({ reducedMotion: "no-preference" });
    /* 设置 › 外观 › 小猫彩蛋: per device, default on, off = no kitten */
    const row = () => p.evaluate(() => { const r = document.querySelector("[data-yk-tog]"); return r ? { on: r.getAttribute("aria-pressed"), sw: r.querySelector(".sw").classList.contains("on"), b: r.querySelector("b").textContent, small: !!r.querySelector("small"), ls: localStorage.getItem("rt.ykOn") } : null; });
    const openSet = () => phone ? c.go("settings") : p.evaluate(() => App.go("settings"));
    await openSet(); await c.sleep(900);
    const r0 = await row();
    c.check("8g. 设置: a 小猫彩蛋 switch, on by default, no caption", r0 && r0.on === "true" && r0.sw && r0.b === "小猫彩蛋" && !r0.small, r0);
    await c.tap("[data-yk-tog]"); await c.sleep(400);
    const r1 = await row();
    c.check("8g. switched off in place (kept on this device)", r1 && r1.on === "false" && !r1.sw && r1.ls === "0", r1);
    await goHome(); if (!phone) await c.sleep(600);
    await p.evaluate(() => App.refreshPage()); await c.sleep(600);
    const o1 = await probe();
    c.check("8g. off: no kitten on the home card", o1 && /yk-off/.test(o1.cls) && !o1.fx, o1);
    await p.evaluate(() => { localStorage.setItem("rt.lang", JSON.stringify("en")); }); await p.reload({ waitUntil: "load" });
    await p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 20000 });
    await openSet(); await c.sleep(900);
    const r2 = await row();
    c.check("8g. English label, still off after a reload", r2 && r2.b === "Yarn kitten" && r2.on === "false", r2);
    await c.tap("[data-yk-tog]"); await c.sleep(400);
    await p.evaluate(() => { localStorage.setItem("rt.lang", JSON.stringify("zh")); }); await p.reload({ waitUntil: "load" });
    await p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 20000 });
    await goHome(); await c.sleep(1200);
    const o2 = await probe();
    c.check("8g. back on: the kitten again", o2 && /yk-run|yk-sleep/.test(o2.cls) && o2.fx, o2);
    /* every skin: the kitten draws (phone everywhere; desk under 特典, the only place its patch exists), day and night */
    const skins = [["white", "ut", "leather1"], ["dark", "ut", "leather1"], ["white", "ut", "knit1"], ["dark", "ut", "knit1"], ["white", "ut", "off"], ["dark", "ut", "off"], ["white", "ink", "off"], ["dark", "ink", "off"], ["white", "ink", "off", true], ["dark", "ink", "off", true]];
    const bad = [];
    for (const [th, ut, tx, stg] of skins) {
      await p.evaluate(([th, ut, tx, stg]) => { const s = (k, v) => localStorage.setItem("rt." + k, JSON.stringify(v)); s("theme", th); s("themeMode", "manual"); s("ut", ut); s("texture", tx); s("stage", !!stg); }, [th, ut, tx, stg]);
      await p.reload({ waitUntil: "load" });
      await p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 20000 });
      await goHome(); await c.sleep(900);
      const drawn = phone || ut === "ut";
      for (const [nm, t] of [["day", DAY], ["night", NIGHT]]) {
        await hook({ now: t, since: new Date(t - 6 * 60000).toISOString(), draw: true });
        const x = await nap(), ok = drawn ? x && (nm === "night" ? x.nap : /yk-run|yk-start/.test(x.cls)) : !x;
        if (!ok) bad.push({ th, ut, tx, stg, nm, x });
        if (drawn) await c.shot(`skin-${th}-${ut}-${tx}${stg ? "-stage" : ""}-${nm}`, home);
      }
    }
    c.check("8h. every skin (white / dark × 特典 leather / knit / plain, 墨刊, 墨刊 + 舞台): day kitten and sleeping kitten draw", !bad.length, bad);
    await p.evaluate(() => { const s = (k, v) => localStorage.setItem("rt." + k, JSON.stringify(v)); s("ut", "ut"); s("texture", "leather1"); localStorage.removeItem("rt.theme"); localStorage.removeItem("rt.themeMode"); });
    c.su("set-agent", role, "--status", "idle");
    c.su("upsert-item", "--id", card2, "--who", role, "--stage", "done");

    /* 7. the Notice line kitten. t-kitten-daypart: one action per part of the day (local time): 08-12 A, 12-18 C, 18-22:30 B, night N.
       The 12:00 / 22:30 switches happen without a reload: the 6 s rotation and every poll redraw the kitten. */
    const day = new Date(); day.setHours(14, 0, 0, 0);
    await p.clock.setFixedTime(day);
    await p.reload({ waitUntil: "load" });
    await p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 20000 });
    await c.sleep(800);
    if (c.view === "phone") { await c.tap("#tabbar button[data-k=home]"); await c.sleep(600); }
    const tk = () => p.evaluate(() => { const t = document.getElementById("ticker"), mine = e => e && e.closest && e.closest("#ticker");
      const an = document.getAnimations().filter(a => a.effect && mine(a.effect.target) && /^nyk-/.test(a.animationName || ""));
      return { cls: t.className, part: t.dataset.nykPart || "", pose: (t.querySelector(".nyk svg") || {}).classList ? t.querySelector(".nyk svg").getAttribute("class") : null, text: (t.querySelector(".msg") || {}).textContent || "",
        props: [...new Set(an.flatMap(a => a.effect.getKeyframes().flatMap(k => Object.keys(k))))], names: [...new Set(an.map(a => a.animationName))] }; });
    const t0 = await tk();
    c.check("Notice kitten at 14:00: the midday pose (sits, C)", t0.part === "c" && t0.pose === "nyk-sit", t0);
    c.su("notice", `毛线猫通知 ${tag}`, "--hours", "30");
    const tc = await c.until(() => tk().then(x => /nyk-c/.test(x.cls) && x.text.includes(tag) && x), 10000);
    c.check("a new notice jumps in with the midday action (C tugs the thread)", !!tc && tc.pose === "nyk-sit", tc);
    await c.sleep(300);
    const tc2 = await tk();
    c.check("C animates transform / opacity only", tc2.props.every(k => OK.has(k)), tc2);
    await c.shot("ticker-c", "#ticker");
    const morning = new Date(); morning.setHours(9, 0, 0, 0);
    await p.clock.setFixedTime(morning);
    const ta = await c.until(() => tk().then(x => /nyk-a/.test(x.cls) && x), 9000);
    c.check("09:00: the next switch nudges the ball (A), the kitten sits up", !!ta && ta.pose === "nyk-sit", ta);
    await c.sleep(500);
    const ta2 = await tk();
    c.check("A animates transform / opacity only", ta2.props.every(k => OK.has(k)), ta2);
    await c.shot("ticker-a", "#ticker");
    const eve = new Date(); eve.setHours(19, 30, 0, 0);
    await p.clock.setFixedTime(eve);
    const tb = await c.until(() => tk().then(x => /nyk-b/.test(x.cls) && x), 9000);
    c.check("19:30: the evening doze (B)", !!tb && tb.pose === "nyk-nap", tb);

    /* night: N (asleep) only, even for a new notice */
    const night = new Date(); night.setHours(23, 40, 0, 0);
    await p.clock.setFixedTime(night);
    c.su("notice", `毛线猫夜里 ${tag}`, "--hours", "30");
    await c.until(() => tk().then(x => x.text.includes(`夜里 ${tag}`)), 10000);
    await c.sleep(2600);   /* a later poll must not wake it either */
    const tn = await tk();
    c.check("night: a new notice keeps the kitten asleep (N)", /nyk-n/.test(tn.cls) && tn.pose === "nyk-nap" && !/nyk-[abc]\b/.test(tn.cls), tn);
    c.check("no page errors", !errs.length, errs);
  },
};
