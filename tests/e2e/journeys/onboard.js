/* t-onboarding P0: the 开工清单 (setup checklist), quick phrases and the 点亮 ring, on the fixture board (a fresh board: meta.onboarding = {}).
 * Desk: the full-width setup widget fits its row; the chip row fills the steward's field without sending; 全部说法 lists the nine groups;
 * Settings → 快捷句 hides / shows the row; 点亮 step 3 rings the offline card and Esc closes it. Phone: the checklist card under the numbers, 全部 › opens
 * all seven steps; the chips float above the composer pill without covering it.
 *   node tests/e2e/drive.js run tests/e2e/journeys/onboard.js --out work/<item>/verify/<run> --engines chromium,webkit
 */
async function boot(c) {
  await c.p.evaluate(() => { const s = (k, v) => localStorage.setItem("rt." + k, JSON.stringify(v)); s("home3", "widgets"); s("lang", "zh"); localStorage.removeItem("rt.qg"); });
  await c.p.reload({ waitUntil: "load" });
  await c.p.waitForFunction(() => window.App && App.ST && App.ST.meta && window.Onboard && !document.getElementById("ut-splash"), null, { timeout: 15000 });
  await c.sleep(1500);
}
const chatCount = p => p.evaluate(() => (App.ST.chat || []).length);
module.exports = {
  views: ["desk", "phone"],
  hash: view => (view === "desk" ? "#page=review" : ""),
  async run(c) {
    const p = c.p;
    await boot(c);
    const su = await p.evaluate(() => App.ST.meta.setup && { n: App.ST.meta.setup.n, of: App.ST.meta.setup.of, next: App.ST.meta.setup.next, steps: App.ST.meta.setup.steps.length });
    c.check("fresh board: meta.setup is there (checklist not retired)", !!su && su.of === 6 && su.steps === 7, su);

    if (c.view === "desk") {
      const w = await p.evaluate(() => { const e = document.querySelector(".wg-setup"); if (!e) return null; const r = e.getBoundingClientRect(), g = e.parentElement.getBoundingClientRect();
        return { h: Math.round(r.height), sh: e.scrollHeight, ch: e.clientHeight, full: Math.abs(r.width - g.width) < 2, steps: e.querySelectorAll(".ob-st").length, cur: (e.querySelector(".ob-st.cur b") || {}).textContent }; });
      await c.shot("desk-setup", ".wg-setup");
      c.check("desk: setup widget spans the grid row, seven steps, nothing clipped", !!w && w.full && w.steps === 7 && w.sh <= w.ch + 1, w);

      const n0 = await chatCount(p);
      await c.tap("#right .qg-row .qg-c"); await c.sleep(500);
      const f = await p.evaluate(() => { const t = document.querySelector("#right .ch-comp textarea"); return { v: t.value, a: document.activeElement === t, sel: t.value.slice(t.selectionStart, t.selectionEnd), row: document.querySelector("#right .qg-row").hidden }; });
      await c.shot("desk-chip-filled", "#right");
      c.check("desk: a chip fills the steward's field, focuses it and selects the X", f.v.length > 3 && f.a && f.sel === "X", f);
      c.check("desk: the chip row hides while the field has text", f.row === true, f);
      await c.sleep(1500);
      c.check("desk: filling never sends", (await chatCount(p)) === n0, { n0, n1: await chatCount(p) });
      await p.evaluate(() => { const t = document.querySelector("#right .ch-comp textarea"); t.value = ""; t.dispatchEvent(new Event("input", { bubbles: true })); });
      await c.sleep(300);

      await c.tap("#right .qg-row [data-qg-all]"); await c.sleep(500);
      const pop = await p.evaluate(() => { const e = document.querySelector("#right .qg-pop"); return e && { groups: e.querySelectorAll("section:not(.qg-ans)").length, r: e.getBoundingClientRect().top }; });
      await c.shot("desk-all-phrases", "#right");
      c.check("desk: 全部说法 lists the nine groups", !!pop && pop.groups === 9 && pop.r >= 0, pop);
      await c.tap("#right .qg-pop [data-qg-close]"); await c.sleep(300);

      /* the fixture steward has never been seen: step 3 (wake) is open, step 4 (say) is already ticked by the fixture chat */
      await p.evaluate(() => Onboard.light("wake")); await c.sleep(1200);
      const ring = await p.evaluate(() => { const r = document.querySelector(".ob-ring"), b = document.querySelector(".ob-bub"), o = document.querySelector("#right .ob-off"), sc = o && o.closest(".ch-msgs");
        if (!r || r.hidden || !o) return null; const q = r.getBoundingClientRect(), t = o.getBoundingClientRect();
        return { around: q.left <= t.left && q.right >= t.right && q.top <= t.top && q.bottom >= t.bottom, inView: t.top >= sc.getBoundingClientRect().top - 1, copy: !!b.querySelector("[data-ob-copy]") }; });
      await c.shot("desk-light-wake");
      c.check("desk: 点亮 step 3 rings the offline card, scrolled into view, with a copy button", !!ring && ring.around && ring.inView && ring.copy, ring);
      await p.keyboard.press("Escape"); await c.sleep(300);
      c.check("desk: Esc closes the light", await p.evaluate(() => !document.querySelector(".ob-ring")));

      await c.tap("#nav [data-go=settings]"); await c.sleep(900);
      await p.locator("[data-qg-tog]").first().scrollIntoViewIfNeeded();
      await c.tap("[data-qg-tog]"); await c.sleep(400);
      const off = await p.evaluate(() => [localStorage.getItem("rt.qg"), document.querySelector("#right .qg-row").hidden]);
      await c.tap("[data-qg-tog]"); await c.sleep(400);
      const on = await p.evaluate(() => [localStorage.getItem("rt.qg"), document.querySelector("#right .qg-row").hidden]);
      c.check("desk: Settings → 快捷句 hides and brings back the chip row", off[0] === "false" && off[1] === true && on[0] === "true" && on[1] === false, { off, on });
    } else {
      const card = await p.evaluate(() => { const e = document.querySelector(".ob-card"); return e && { steps: e.querySelectorAll(".ob-st").length, w: Math.round(e.getBoundingClientRect().width), vw: innerWidth, over: e.scrollWidth > e.clientWidth + 1 }; });
      await p.locator(".ob-card").first().scrollIntoViewIfNeeded(); await c.sleep(300);
      await c.shot("phone-card", ".ob-card");
      c.check("phone: checklist card shows the current step only, no sideways overflow", !!card && card.steps === 1 && !card.over, card);
      await c.tap(".ob-card [data-ob-all]"); await c.sleep(500);
      const all = await p.evaluate(() => document.querySelectorAll(".ob-card .ob-st").length);
      await c.shot("phone-card-all", ".ob-card");
      c.check("phone: 全部 › opens all seven steps", all === 7, all);

      await p.evaluate(() => App.route("#dm=manager")); await c.sleep(1500);
      const g = await p.evaluate(() => { const r = document.querySelector("#right .qg-row"), m = document.querySelector("#right .ch-comp"); if (!r || r.hidden) return null;
        const a = r.getBoundingClientRect(), b = m.getBoundingClientRect(); return { rowBottom: Math.round(a.bottom), compTop: Math.round(b.top), h: Math.round(a.height) }; });
      await c.shot("phone-chat");
      c.check("phone: chips float just above the composer pill", !!g && g.rowBottom <= g.compTop + 1 && g.compTop - g.rowBottom < 20 && g.h > 20, g);
      const n0 = await chatCount(p);
      await c.tap("#right .qg-row .qg-c"); await c.sleep(600);
      const v = await p.evaluate(() => document.querySelector("#right .ch-comp textarea").value);
      await c.shot("phone-chip-filled");
      c.check("phone: a chip fills the field and sends nothing", v.length > 3 && (await chatCount(p)) === n0, { v });
    }
  },
};
