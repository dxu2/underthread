/* t-rail-overflow: the folded chat column (desk, 80px avatar strip) has no composer, so the quick-phrase row must not poke out of it.
 * Desk: unfolded, the yarn pill reads 「想说点什么？」; folded, it is the ball alone, centred inside the strip; a tap on the ball unfolds the column
 * and opens the chips; folded again with chips showing, the row is gone. Phone (no fold there): the row still shows in full.
 * The pill only shows after 20 of your own steward messages; the journey fakes that count in the page (App.chatList), so it runs on the fixture board.
 *   node tests/e2e/drive.js run tests/e2e/journeys/railfold.js --out work/<item>/verify/<run> --engines chromium,webkit
 */
async function boot(c, fold, fake = true) {
  await c.p.evaluate(([f, f2]) => { const s = (k, v) => localStorage.setItem("rt." + k, JSON.stringify(v)); s("lang", "zh"); s("chatFold", f); if (f2) s("texture", f2); localStorage.removeItem("rt.qg"); }, [fold, process.env.RF_TEXTURE || ""]);
  await c.p.reload({ waitUntil: "load" });
  await c.p.waitForFunction(() => window.App && App.ST && App.ST.meta && window.Onboard && !document.getElementById("ut-splash"), null, { timeout: 15000 });
  await c.p.evaluate(fake => {   /* 20+ of your own steward lines -> the yarn pill instead of the chips */
    if (fake) { const o = App.chatList.bind(App); App.chatList = id => { const l = o(id) || []; return id === "manager" ? l.concat(Array.from({ length: 20 }, () => ({ who: "me", text: "x" }))) : l; }; }
    App.route("#dm=manager");
  }, fake);
  await c.sleep(2800);   /* one poll repaints the row */
}
const geo = p => p.evaluate(() => {
  const r = document.querySelector("#right"), q = document.querySelector("#right > .qg-row"), b = q && q.querySelector(".qg-bulb"), nq = b && b.querySelector(".nq");
  const R = r.getBoundingClientRect(), Q = q && q.getBoundingClientRect(), B = b && b.getBoundingClientRect();
  return { folded: document.body.classList.contains("chat-folded"), rw: Math.round(R.width),
    row: !!q && !q.hidden && getComputedStyle(q).display !== "none" && Q.width > 0, bulb: !!B && B.width > 0, chips: q ? q.querySelectorAll(".qg-c").length : 0,
    inside: !B || (B.left >= R.left - .5 && B.right <= R.right + .5), centred: !B || Math.abs((B.left + B.right) / 2 - (R.left + R.right) / 2) < 2,
    bw: B ? Math.round(B.width) : 0, txt: nq ? parseFloat(getComputedStyle(nq).fontSize) : null, label: b && b.getAttribute("aria-label") };
});
module.exports = {
  views: ["desk", "phone"],
  hash: view => (view === "desk" ? "#page=review" : ""),
  async run(c) {
    const p = c.p, errs = [];
    p.on("pageerror", e => errs.push(String(e).split("\n")[0]));
    if (c.view === "desk") {
      await boot(c, false);
      const a = await geo(p);
      c.check("unfolded: the yarn pill shows with its words", !a.folded && a.bulb && a.bw > 100 && a.txt > 10, a);
      await c.shot("desk-unfolded", "#right");
      await c.tap("#right .ch-fold"); await c.sleep(900);
      const b = await geo(p);
      c.check("folded: only the ball, centred inside the 80px strip", b.folded && b.rw <= 82 && b.bulb && b.inside && b.centred && b.bw === 40 && b.txt === 0 && !!b.label, b);
      await c.shot("desk-folded", "#right");
      await c.sleep(2800);
      const b2 = await geo(p);
      c.check("still the ball after a poll", b2.folded && b2.bulb && b2.inside && b2.bw === 40, b2);
      await c.tap("#right .qg-bulb"); await c.sleep(1000);
      const d = await geo(p);
      c.check("tapping the ball unfolds the column and opens the chips", !d.folded && d.row && !d.bulb && d.chips > 1 && d.rw > 200, d);
      await c.shot("desk-ball-tapped", "#right");
      await c.tap("#right .ch-fold"); await c.sleep(900);
      const e = await geo(p);
      c.check("folded with chips: the row is hidden", e.folded && !e.row, e);
      await c.shot("desk-folded-chips", "#right");
      await c.tap("#right .ch-fold"); await c.sleep(900);
    } else {
      await boot(c, process.env.RF_PHONEFOLD === "1", false);   /* real chat list. RF_PHONEFOLD=1 replays a desk fold flag on the phone: the thread itself goes blank then (old 03-chat-lists-modal rules, not this card) */
      const f = await geo(p);
      const pr = await p.evaluate(() => { const q = document.querySelector("#right > .qg-row"); return q && !q.hidden && getComputedStyle(q).display !== "none" ? Math.round(q.getBoundingClientRect().width) : 0; });
      c.check("phone: quick phrases show in full", pr > 300 && (f.bulb ? f.bw > 100 && f.txt > 10 : f.chips > 1), { rowW: pr, ...f });
      await c.shot("phone-chat");
      await p.evaluate(() => localStorage.setItem("rt.chatFold", "false"));
    }
    c.check("no page errors", !errs.length, errs);
  },
};
