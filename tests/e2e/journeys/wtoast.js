/* t-web-toast: desktop in-app notice. Real path: stateutil writes in the scratch copy (reply / ask / dm) -> long poll -> render -> web/js/toast.js.
 * Checks: reply / ask / dm each pop a card top right; hover pauses the 5 s auto-hide; at most 3 stacked; click opens the card; nothing for the open card;
 * reduced motion = no slide; phone shows nothing.
 *   node tests/e2e/drive.js run tests/e2e/journeys/wtoast.js --out work/<item>/verify/<run> --views desk,phone --engines chromium,webkit --theme dark
 */
const { execFileSync } = require("child_process");
const S = process.env.VERIFY_SCRATCH || `/tmp/rt-verify-${process.env.VERIFY_PORT || 8799}`;
const su = (...a) => execFileSync("python3", ["stateutil.py", ...a], { cwd: S }).toString().trim();
const toasts = p => p.evaluate(() => [...document.querySelectorAll("#wtoasts .wt")].filter(e => !e._gone).map(e => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
  return { cls: e.className, who: e.querySelector(".wt-h b").textContent, line: e.querySelector("p").textContent, sub: e.querySelector("small").textContent, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), vis: cs.display !== "none" && r.width > 0, tf: cs.transform, bg: /leather/.test(cs.backgroundImage) }; }));
const waitN = (p, n, ms = 9000) => p.waitForFunction(n => document.querySelectorAll("#wtoasts .wt.in").length >= n, n, { timeout: ms }).then(() => true, () => false);
module.exports = {
  hash: () => "#page=review",
  async run(c) {
    const p = c.p, desk = c.view === "desk";
    await p.evaluate(() => { const s = (k, v) => localStorage.setItem("rt." + k, JSON.stringify(v)); s("ut", "ut"); s("texture", "leather1"); s("home3", "widgets"); s("lang", "en"); s("chat", "manager"); s("chatFold", false); s("lka", "off"); });   /* t-lookaway-fx: these are the 关 path; journeys/lookaway.js covers the pill */
    await p.reload({ waitUntil: "load" }); await p.waitForFunction(() => window.App && App.ST && App.ST.meta && window.WebToast && !document.getElementById("ut-splash"), null, { timeout: 15000 }); await c.sleep(2500);
    const items = await p.evaluate(() => App.items().filter(i => i.stage !== "done" && !i.archived).slice(0, 4).map(i => i.id));
    if (!desk) { su("reply", items[0], "smith", "toast test (phone)"); await c.sleep(4000); const T = await toasts(p); c.check("phone: no in-app toast", T.every(t => !t.vis), T); return; }
    su("reply", items[0], "smith", "Toast test: a reply on a card, long enough to wrap onto a second line so the clamp shows how two lines read in the card.");
    c.check("reply pops a toast", await waitN(p, 1)); let T = await toasts(p);
    c.check("toast top right, leather, names the card", T[0] && T[0].x + T[0].w > 1400 && T[0].y < 120 && T[0].bg && /wt-reply/.test(T[0].cls) && T[0].sub.length > 0, T);
    await c.sleep(400); await c.shot("reply");
    await p.hover("#wtoasts .wt"); await c.sleep(6500); T = await toasts(p); c.check("hover pauses auto-hide (6.5 s)", T.length === 1, T.length);
    await p.mouse.move(400, 500); await c.sleep(6000); T = await toasts(p); c.check("leaving resumes and it hides", T.length === 0, T.length);
    su("reply", items[2], "smith", "Toast test reply 3");
    su("reply", items[3] || items[2], "smith", "Toast test reply 4");
    su("dm", "smith", "Toast test DM from smith");
    su("ask", items[1], "smith", "Toast test question: which one?", "--options", "A*|B");
    await waitN(p, 3); await c.sleep(900); T = await toasts(p);
    c.check("at most 3 stacked, newest on top", T.length === 3 && T[0].y < T[1].y && T[1].y < T[2].y, T.map(t => t.cls + " " + t.line));
    await c.shot("stack3");
    const kinds = T.map(t => t.cls).join(" ");
    c.check("ask and DM kinds show (ask + chat)", /wt-ask/.test(kinds) && T.some(t => /Asks/.test(t.line)) && T.some(t => /Chat/.test(t.sub)), T.map(t => [t.cls, t.sub, t.line]));
    const want = await p.evaluate(() => { const e = document.querySelector("#wtoasts .wt.wt-ask:not(.out)"); return e ? e._n.it.id : null; });
    await p.click("#wtoasts .wt.wt-ask:not(.out) p", { timeout: 3000 }).catch(() => {}); await c.sleep(1500);
    const open = await p.evaluate(() => App.UI.item || null); c.check("click opens that card", !!open && open === want, { open, want });
    await p.evaluate(() => document.querySelectorAll("#wtoasts .wt").forEach(e => e.remove()));
    su("reply", open || items[0], "smith", "Toast test: reply on the open card");
    await c.sleep(4500); T = await toasts(p); c.check("no toast for the card that is open", T.length === 0, T);
    await p.keyboard.press("Escape"); await c.sleep(600);
    await p.emulateMedia({ reducedMotion: "reduce" });
    await p.evaluate(() => WebToast.show({ cls: "reply", agent: "smith", it: App.items()[0], text: "reduced motion" })); await c.sleep(120);
    T = await toasts(p); c.check("reduced motion: no slide transform", T[0] && (T[0].tf === "none" || /matrix\(1, 0, 0, 1, 0, 0\)/.test(T[0].tf)), T[0] && T[0].tf);
    await p.emulateMedia({ reducedMotion: "no-preference" });
    for (const tex of ["none", "knit1"]) { await p.evaluate(t => { localStorage.setItem("rt.texture", JSON.stringify(t)); }, tex); await p.reload({ waitUntil: "load" });
      await p.waitForFunction(() => window.WebToast && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 15000 }); await c.sleep(1500);
      await p.evaluate(() => WebToast.show({ cls: "ask", agent: "smith", it: App.items()[0], text: "Which one?" })); await c.sleep(600); T = await toasts(p);
      c.check(`${tex}: toast renders`, T[0] && T[0].vis && T[0].w > 300, T[0]); await c.shot(`tex-${tex}`); }
  },
};
