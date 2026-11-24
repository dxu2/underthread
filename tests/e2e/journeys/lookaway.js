/* t-lookaway-fx: full-screen ink arrival (#lka-fs) and the top pill (#lka-pw). Real path: stateutil writes in the scratch copy -> long poll ->
 * toast.js -> LookAway.take. Checks: a card handed in for review plays the full screen (48 px backdrop blur even under the knit palette, avatar,
 * title, gone after ~3 s); a second one within 20 min becomes the pill; the pill drops in with an overshoot; reply + DM merge into 「还有 N 条」;
 * the chip shows the next; hover pauses the 5 s countdown; click opens the card; 设置 has no 提醒动效 row (t-drop-arrival-fx) and a stale saved pref is ignored;
 * reduced motion = pill, no slide; day's end plays once.
 *   node tests/e2e/drive.js run tests/e2e/journeys/lookaway.js --out work/<item>/verify/<run> --views desk,phone --engines chromium,webkit
 */
const S = process.env.VERIFY_SCRATCH || `/tmp/rt-verify-${process.env.VERIFY_PORT || 8799}`;
const pillInfo = p => p.evaluate(() => { const e = document.querySelector("#lka-pw .lka-pill"); if (!e || e.parentElement._out) return null; const r = e.getBoundingClientRect(), m = e.querySelector(".lka-more");
  return { cls: e.className, who: e.querySelector(".lka-tx b").textContent, sub: e.querySelector(".lka-tx small").textContent, more: m && !m.hidden ? m.textContent : "", x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), cx: Math.round(r.left + r.width / 2) }; });
const fsInfo = p => p.evaluate(() => { const e = document.getElementById("lka-fs"); if (!e) return null; const b = e.querySelector(".lka-blur"), cs = getComputedStyle(b);
  return { title: e.querySelector(".lka-title").textContent, line: (e.querySelector(".lka-line") || {}).textContent || "", bf: cs.backdropFilter || cs.webkitBackdropFilter, avs: e.querySelectorAll(".lka-avs img").length }; });
const waitPill = (p, ms = 9000) => p.waitForFunction(() => { const e = document.querySelector("#lka-pw .lka-pill"); return e && !e.parentElement._out; }, null, { timeout: ms }).then(() => true, () => false);
const waitFs = (p, ms = 9000) => p.waitForFunction(() => !!document.getElementById("lka-fs"), null, { timeout: ms }).then(() => true, () => false);
module.exports = {
  hash: () => "#page=review",
  async run(c) {
    const p = c.p, desk = c.view === "desk", su = c.su;
    const raw = async name => { const d = process.env.LKA_SHOTS; if (d) await p.screenshot({ path: `${d}/${c.engine}-${c.view}-${name}.png` }); };   // optional mid-animation frames
    await p.evaluate(() => { const s = (k, v) => localStorage.setItem("rt." + k, JSON.stringify(v)); s("ut", "ut"); s("texture", "knit1"); s("lang", "zh"); s("chat", "manager"); s("chatFold", false);
      s("lka.quiet", false); s("setTab", "general"); localStorage.removeItem("rt.lka.fsAt"); localStorage.removeItem("rt.lka.eod"); });
    await p.reload({ waitUntil: "load" }); await p.waitForFunction(() => window.App && App.ST && App.ST.meta && window.LookAway && !document.getElementById("ut-splash"), null, { timeout: 15000 }); await c.sleep(2500);
    /* rv: cards that can be handed in (3 needed; the fixture board has exactly 3); any: reply targets */
    const any = await p.evaluate(() => App.items().filter(i => i.stage !== "done" && !i.archived).map(i => i.id));
    let rv = await p.evaluate(() => App.items().filter(i => !["done", "review"].includes(i.stage) && !i.archived).slice(0, 3).map(i => i.id));
    if (rv.length < 3) {   // the views share one server: an earlier view already handed these in, so put three back to doing first
      rv = any.slice(0, 3); rv.forEach(id => su("upsert-item", "--id", id, "--stage", "doing"));
      await p.waitForFunction(ids => ids.every(id => (App.items().find(i => i.id === id) || {}).stage === "doing"), rv, { timeout: 9000 }).catch(() => {}); await c.sleep(1500);
    }
    const items = [rv[0], rv[1], any[(any.indexOf(rv[1]) + 1) % any.length], any[(any.indexOf(rv[1]) + 2) % any.length], rv[2]];
    c.check("enough cards on the board for this journey", rv.length === 3 && any.length >= 4, { rv, any: any.length });
    const toReview = id => su("upsert-item", "--id", id, "--who", "smith", "--kind", "deliverable", "--stage", "review", "--draft", "lookaway test draft", "--label", "lka test");

    /* 1 · full screen */
    toReview(items[0]);
    c.check("review hand-in plays the full screen", await waitFs(p));
    await c.sleep(1500); let F = await fsInfo(p);
    c.check("full screen: title, card line, avatar, 48 px backdrop blur under the knit palette", F && /交稿了/.test(F.title) && F.line.length > 0 && F.avs === 1 && /blur\(48px\)/.test(F.bf), F);
    await raw("fullscreen-hold");   // a plain screenshot: c.shot() finishes finite animations, which would end the full screen
    await c.sleep(2200);
    c.check("full screen gone after ~3 s", !(await fsInfo(p)));
    c.check("fsAt recorded", await p.evaluate(() => +JSON.parse(localStorage.getItem("rt.lka.fsAt") || "0") > 0));

    /* 2 · second review within 20 min = pill, with overshoot */
    const samp = p.evaluate(() => new Promise(res => { const ys = []; const t0 = performance.now();
      const f = () => { const e = document.querySelector("#lka-pw .lka-pill"); if (e) ys.push(e.getBoundingClientRect().top); if (performance.now() - t0 < 9000 && !(ys.length > 50)) requestAnimationFrame(f); else res(ys); }; f(); }));
    toReview(items[1]);
    c.check("second hand-in within 20 min = pill, not full screen", await waitPill(p) && !(await fsInfo(p)));
    const ys = await samp; await c.sleep(300); let P = await pillInfo(p);
    const maxY = Math.max(...ys), rest = P ? P.y : 0;
    c.check("pill drops in and overshoots ~12 px past its rest", ys.length > 5 && ys[0] < rest - 30 && maxY - rest >= 7 && maxY - rest <= 16, { first: Math.round(ys[0]), max: Math.round(maxY), rest });
    c.check("pill at top centre, review kind", P && /lka-c-decide/.test(P.cls) && Math.abs(P.cx - (await p.evaluate(() => innerWidth)) / 2) < 3 && P.y < 70, P);

    /* 3 · merge. Split A (11-22): on a computer replies / DMs go to the top-right cards, never the pill; the phone keeps them in the pill. */
    su("reply", items[2], "smith", "lookaway test reply");
    su("dm", "smith", "lookaway test DM");
    if (desk) {
      await p.waitForFunction(() => document.querySelectorAll("#wtoasts .wt").length >= 2, null, { timeout: 9000 }).catch(() => {});
      const sp = await p.evaluate(() => ({ wt: [...document.querySelectorAll("#wtoasts .wt")].map(e => e.className), q: LookAway._S.q.map(n => n.cls) }));
      c.check("desk: reply + DM become top-right cards, not pill entries", sp.wt.length === 2 && sp.wt.every(x => /wt-reply/.test(x)) && !sp.q.includes("reply"), sp);
      await p.evaluate(() => document.querySelectorAll("#wtoasts .wt").forEach(e => e.remove()));
      su("ask", items[2], "smith", "lookaway test ask", "--options", "a|b");
      su("ask", items[0], "smith", "lookaway test ask 2", "--options", "a|b");
      await p.waitForFunction(() => { const m = document.querySelector("#lka-pw .lka-more"); return m && !m.hidden && /2/.test(m.textContent); }, null, { timeout: 9000 }).catch(() => {});
      P = await pillInfo(p);
      c.check("desk: two questions merge into the chip 还有 2 条, no top-right card for them", P && /还有 2 条/.test(P.more) && (await p.evaluate(() => document.querySelectorAll("#lka-pw .lka-pill").length + document.querySelectorAll("#wtoasts .wt").length)) === 1, P);
    } else {
      await p.waitForFunction(() => { const m = document.querySelector("#lka-pw .lka-more"); return m && !m.hidden && /2/.test(m.textContent); }, null, { timeout: 9000 }).catch(() => {});
      P = await pillInfo(p);
      c.check("reply + DM merge into the chip 还有 2 条, no stacked edges", P && /还有 2 条/.test(P.more) && (await p.evaluate(() => document.querySelectorAll("#lka-pw .lka-pill").length)) === 1, P);
    }
    await raw("pill-merged");
    await (desk ? p.click("#lka-pw .lka-more") : p.tap("#lka-pw .lka-more")); await c.sleep(400);
    const P2 = await pillInfo(p);
    c.check("chip shows the next notice", P2 && P2.cls !== P.cls || (P2 && P2.sub !== P.sub), [P && P.sub, P2 && P2.sub]);
    if (desk) {
      await p.hover("#lka-pw .lka-tx"); await c.sleep(6500);
      c.check("hover pauses the 5 s countdown", !!(await pillInfo(p)));
      await p.mouse.move(300, 600); await c.sleep(6000);
      c.check("leaving resumes and it goes", !(await pillInfo(p)));
    } else {
      await c.sleep(6000); c.check("pill goes by itself after 5 s", !(await pillInfo(p)));
    }

    /* 4 · click opens the card */
    if (desk) su("ask", items[3], "smith", "lookaway test open", "--options", "a|b"); else su("reply", items[3], "smith", "lookaway test open");
    await waitPill(p); await c.sleep(700);
    await (desk ? p.click("#lka-pw .lka-tx") : p.tap("#lka-pw .lka-tx")); await c.sleep(1200);
    c.check("click opens that card", await p.evaluate(() => App.UI.item) === items[3]);
    await p.keyboard.press("Escape"); await c.sleep(600); await p.evaluate(() => App.route("#page=review")); await c.sleep(800);

    /* 5 · reduced motion = pill even when full screen would be allowed */
    await p.evaluate(() => localStorage.removeItem("rt.lka.fsAt"));
    await p.emulateMedia({ reducedMotion: "reduce" });
    toReview(items[4]);
    c.check("reduced motion: pill, never full screen", await waitPill(p) && !(await fsInfo(p)));
    await p.emulateMedia({ reducedMotion: "no-preference" });
    await p.evaluate(() => LookAway.pillOut()); await c.sleep(500);

    /* 6 · t-drop-arrival-fx: no 设置 row; a pref saved by an older build ("off") is dropped at load and the effects still play */
    await p.evaluate(() => { localStorage.setItem("rt.lka", JSON.stringify("off")); document.querySelectorAll("#wtoasts .wt").forEach(e => e.remove()); });
    await p.reload({ waitUntil: "load" }); await p.waitForFunction(() => window.LookAway && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 15000 }); await c.sleep(1500);
    c.check("stale rt.lka = off removed at load, mode on", await p.evaluate(() => localStorage.getItem("rt.lka") === null && LookAway.mode() === "on"));
    if (desk) { await p.evaluate(() => { location.hash = "#page=settings"; }); await p.reload({ waitUntil: "load" }); await p.waitForFunction(() => window.LookAway && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 15000 }); await c.sleep(800); }
    else await c.go("settings");
    await c.sleep(1200);
    const st = await p.evaluate(() => ({ page: App.UI.page, row: !!document.querySelector(".lka-set,[data-lka-set],[data-lka-prev]"), push: document.querySelectorAll(".st-row").length }));
    c.check("设置 has no 提醒动效 row", !st.row && st.push > 0, st);
    await c.shot("settings-no-lka");
    su("reply", items[2], "smith", "lookaway test stale off");
    await c.sleep(4500);
    const off = await p.evaluate(() => ({ pill: !!document.querySelector("#lka-pw .lka-pill"), wt: document.querySelectorAll("#wtoasts .wt").length }));
    c.check(desk ? "stale 关 ignored: reply still goes to the top-right card" : "stale 关 ignored: reply shows the pill on the phone", desk ? off.wt >= 1 : off.pill, off);
    await p.evaluate(() => LookAway.pillOut()); await c.sleep(500);

    /* 7 · day's end once */
    await p.evaluate(() => { localStorage.removeItem("rt.lka.eod"); document.querySelectorAll("#wtoasts .wt").forEach(e => e.remove()); });
    const eod = await p.evaluate(() => { const d = new Date(), t = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      LookAway._S.eod = "2000-01-01"; App.ST.meta.last_report_date = t; LookAway.eodCheck(); const a = !!document.getElementById("lka-fs") && /收工/.test(document.querySelector("#lka-fs .lka-title").textContent);
      LookAway.fsEnd(); LookAway._S.eod = "2000-01-01"; LookAway.eodCheck(); return { a, again: !!document.getElementById("lka-fs") || !!document.querySelector("#lka-pw .lka-pill") }; });
    c.check("day's end plays once (manager, 今天收工了), not twice", eod.a && !eod.again, eod);
  },
};
