/* t-phone-docs: 设置 → 文档 on the phone. Tapping a doc must show its text in view, with a way back to the list.
 *   node tests/e2e/drive.js run tests/e2e/journeys/pdocs.js --out work/<item>/verify/<run> --views phone,desk --engines chromium,webkit
 */
const vis = p => p.evaluate(() => { const m = document.querySelector(".docs .md"); if (!m) return { md: false };
  const r = m.getBoundingClientRect(), h = m.querySelector("h1,h2,h3,p"), hr = h && h.getBoundingClientRect(), dl = document.querySelector(".docs .dl");
  return { md: true, mdTop: Math.round(r.top), mdH: Math.round(r.height), inView: !!hr && hr.top < innerHeight && hr.bottom > 0, txt: (h && h.textContent || "").slice(0, 30),
    list: !!dl && dl.getBoundingClientRect().height > 0, back: !!document.querySelector(".docs .doc-back") && document.querySelector(".docs .doc-back").getBoundingClientRect().height > 0, vh: innerHeight }; });
module.exports = {
  views: ["phone", "desk"],
  hash: () => "#page=settings",
  async run(c) {
    const p = c.p;
    if (c.view === "phone") { await c.tap("#tabbar button[data-k=more]"); await c.sleep(600); await c.tap('[data-go="settings"]'); await c.sleep(800); }
    else { await c.tap("#nav [data-go=settings]"); await c.sleep(800); }
    await c.tap("[data-settab=docs]"); await c.sleep(1500);
    await c.until(() => p.evaluate(() => document.querySelectorAll(".docs [data-doc]").length > 3), 10000);
    await c.shot("list");
    const btns = await p.evaluate(() => [...document.querySelectorAll(".docs [data-doc]")].map(b => b.dataset.doc));
    /* t-phone-docs v2: SETUP-GUIDE.md has a wide table that stretched the 1fr column past the screen on the iPhone; v1 only opened a table-free doc */
    const pick = btns.find(b => /SETUP-GUIDE/.test(b)) || btns[Math.min(4, btns.length - 1)];
    await c.tap(`.docs [data-doc="${pick}"]`); await c.sleep(2500);
    const a = await vis(p);
    c.check(`tap ${pick}: its text is on screen`, a.md && a.inView, a);
    if (c.view === "phone") c.check("phone: list hidden while reading, back button shown", !a.list && a.back, a);
    else c.check("desk: two panes stay (list + text)", a.list && !a.back, a);
    const ov = await p.evaluate(() => { const m = document.querySelector(".docs .md"), b = document.querySelector(".docs .doc-back"), sp = b && b.querySelector("span");
      const wide = m ? [...m.querySelectorAll("*")].filter(e => !e.closest(".tbl, pre") && e.getBoundingClientRect().right > innerWidth + 1).length : -1;
      return { docW: document.documentElement.scrollWidth, vw: innerWidth, mdR: m && Math.round(m.getBoundingClientRect().right), wide, nameIn: !sp || !b.getBoundingClientRect().width || (sp.getBoundingClientRect().right <= innerWidth && sp.getBoundingClientRect().width > 0) }; });
    c.check("text fits the screen: no element outside .tbl / pre (they scroll) past the right edge, file name on screen", ov.wide === 0 && ov.mdR <= ov.vw && ov.nameIn, ov);
    await c.shot("open");
    await c.sleep(6000);
    const a2 = await vis(p); c.check("still open after two polls", a2.md && a2.inView, a2);
    if (c.view === "phone") {
      await c.tap(".docs .doc-back"); await c.sleep(1200);
      const b = await vis(p); c.check("back: the list returns", b.list && !b.back, b);
      const on = await p.evaluate(sel => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { on: e.classList.contains("on"), inView: r.top >= 0 && r.bottom <= innerHeight }; }, `.docs [data-doc="${pick}"]`);
      c.check("back: the doc just read is still marked and in view", on && on.on && on.inView, on);
      await c.shot("back");
    }
  },
};
