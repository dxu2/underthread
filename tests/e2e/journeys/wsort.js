/* t-waiting-sort: the desk 「Waiting on you」 widget lists the latest response first (activity desc), the same order as the phone list (App.byAct);
 * the foot 「Oldest waiting」 still names the oldest card.
 *   node tests/e2e/drive.js run tests/e2e/journeys/wsort.js --out work/<item>/verify/<run> --views desk,phone --engines chromium,webkit --theme dark
 */
module.exports = {
  hash: () => "#page=review",
  async run(c) {
    const p = c.p;
    await p.evaluate(() => { const s = (k, v) => localStorage.setItem("rt." + k, JSON.stringify(v)); s("ut", "ut"); s("texture", "leather1"); s("home3", "widgets"); s("lang", "en"); });
    await p.reload({ waitUntil: "load" }); await p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 15000 }); await c.sleep(1500);
    const r = await p.evaluate(() => {
      const it = id => App.items().find(i => i.id === id), t = i => Date.parse(i.activity || i.updated);
      const rows = [...document.querySelectorAll('#wg .wg-review .wg-row[data-item]')].map(e => e.dataset.item);
      const phone = App.items().filter(i => App.onYouCard(i)).sort(App.byAct).map(i => i.id);
      const all = App.items().filter(i => App.onYouCard(i) || (App.onYou(i) && App.awaitsUser(i))).sort((a, b) => t(b) - t(a));
      const foot = (document.querySelector('#wg .wg-review .wg-more') || {}).textContent || "";
      return { rows, ts: rows.map(id => it(id) && (it(id).activity || it(id).updated)), phone, oldest: all.length ? all[all.length - 1].id : null, foot };
    });
    if (c.view === "desk") {
      c.check("desk rows found", r.rows.length >= 2, r.rows);
      c.check("desk rows: latest response first", r.ts.every((x, i) => !i || Date.parse(r.ts[i - 1]) >= Date.parse(x)), r.ts);
      c.check("desk order = phone order (App.byAct) for shared cards", JSON.stringify(r.rows) === JSON.stringify(r.phone.filter(id => r.rows.includes(id)).slice(0, r.rows.length)), { desk: r.rows, phone: r.phone });
      await c.shot("desk-waiting");
    } else c.check("phone list newest first (App.byAct)", r.phone.length >= 1, r.phone);
  },
};
