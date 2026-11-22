/* t-section-titles: the desk widget home. Every section wears a sewn-on label on its top edge with a one-line subtitle (Underthread skins; under
 * leather the label takes the section's dye), 等你拍板 is first and full width whatever the saved layout says, 团队交接 is gone (its busy count is in
 * the 此刻在忙 label), 最近 is a full-width row of up to 5 cards at the bottom, and the chat column's avatar row starts flush with the fold button.
 * Upgrade: a saved layout that still holds team (and review at L) loses team and shows review first at full width. 最近 is opt-in (user 11-21 23:50):
 * not in the default, never auto-inserted, taken out once from a layout that got it earlier, and added back from 添加小组件 it sticks.
 * Fresh install (恢复默认) = the default order. The board's own layout is put back at the end.
 *   node tests/e2e/drive.js run tests/e2e/journeys/sectiontitles.js --out work/<item>/verify/<run> --engines chromium,webkit
 *   ST_TEXTURE=knit1|leather1 (default knit1)
 */
const act = (p, body) => p.evaluate(b => fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(r => r.status), body);
const boot = async (c, tex) => {
  await c.p.evaluate(t => { const s = (k, v) => localStorage.setItem("rt." + k, JSON.stringify(v)); s("lang", "zh"); s("ut", "ut"); s("texture", t); s("chatFold", false); localStorage.removeItem("rt.widgets"); }, tex);
  await c.p.reload({ waitUntil: "load" });
  await c.p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash") && document.querySelector("#wg .wg-grid > .wg"), null, { timeout: 20000 });
  await c.sleep(2600);
};
const look = p => p.evaluate(() => {
  const g = [...document.querySelectorAll("#wg .wg-grid > .wg[data-wg]")];
  const lab = g.map(w => { const e = w.querySelector(".wg-eb"), W = w.getBoundingClientRect(), E = e && e.getBoundingClientRect(), s = w.querySelector(".sct-sub");
    return { k: w.dataset.wg, sz: [...w.classList].find(x => x.startsWith("sz-")), above: !!E && E.top < W.top, inside: !!E && E.left >= W.left && E.right <= W.right + 1,
      sub: !!s && getComputedStyle(s).display !== "none", subClear: !s || !E || s.getBoundingClientRect().top >= E.bottom - 2 }; });
  const rv = document.querySelector("#wg .wg-review"), rc = document.querySelector("#wg .wg-recent");
  const busy = document.querySelector("#wg .wg-busy .wg-eb");
  return { order: g.map(w => w.dataset.wg), lab, review: rv && { w: Math.round(rv.getBoundingClientRect().width), grid: Math.round(document.querySelector("#wg .wg-grid").getBoundingClientRect().width), cols: rv.querySelector(".sct-rows") ? getComputedStyle(rv.querySelector(".sct-rows")).gridTemplateColumns.split(" ").length : 0 },
    recent: rc && { tiles: rc.querySelectorAll(".sct-tile[data-item]").length, w: Math.round(rc.getBoundingClientRect().width) }, busy: busy && busy.textContent,
    team: !!document.querySelector("#wg .wg-team"), dye: rc && getComputedStyle(rc).getPropertyValue("--dye").trim() };
});
module.exports = {
  views: ["desk"],
  hash: () => "#page=review",
  async run(c) {
    const p = c.p, errs = [], tex = process.env.ST_TEXTURE || "knit1";
    p.on("pageerror", e => { const m = String(e).split("\n")[0]; if (!/due to access control checks/.test(m)) errs.push(m); });
    await boot(c, tex);
    const orig = await p.evaluate(() => JSON.parse(JSON.stringify(App.ST.meta.widgets || null)));
    try {
      /* fresh install = default layout */
      c.check("恢复默认 accepted", await act(p, { kind: "widget_layout", reset: true }) === 200);
      await boot(c, tex);
      const a = await look(p), nums = await p.evaluate(() => [...document.querySelectorAll("#wg .wg-eb .wnb-num")].map(n => { const e = n.closest(".wg-eb").getBoundingClientRect(), r = n.getBoundingClientRect(); return { k: n.closest(".wg").dataset.wg, inside: r.top >= e.top - 1 && r.bottom <= e.bottom + 1, box: getComputedStyle(n, "::before").content }; }));
      c.check("default: 等你拍板 first and full width, two columns of rows", a.order[0] === "review" && a.review.w >= a.review.grid - 2 && a.review.cols === 2, a);
      c.check("default: no 团队交接, no 最近", !a.team && !a.order.includes("team") && !a.order.includes("recent"), a.order);
      c.check("此刻在忙 label carries the busy count", !a.busy || /\d+\s*人在忙/.test(a.busy), a.busy);
      c.check("every section label sits on its top edge, inside the card, subtitle under it", a.lab.length && a.lab.every(x => x.above && x.inside && x.sub && x.subClear || x.k === "setup"), a.lab.filter(x => !(x.above && x.inside && x.sub && x.subClear)));
      c.check("label counts are plain figures inside the label (no stitched number box)", nums.every(x => x.inside && (x.box === "none" || x.box === "normal")), nums);
      await c.shot(`home-top-${tex}`);
      const g = await p.evaluate(() => { const r = e => e && Math.round(e.getBoundingClientRect().left); return { fold: r(document.querySelector("#right .ch-fold")), first: r(document.querySelector("#right .ch-roster > button")) }; });
      c.check("avatar row starts flush with the fold button (no empty gutter)", g.first != null && Math.abs(g.first - g.fold) <= 8, g);
      await c.shot("chat-head", "#right .ch-head");

      /* upgrade from a layout saved before this card: team in it, review at L in the middle, recent never seen */
      const old = [["busy", "l"], ["team", "m"], ["review", "l"], ["usage", "l"], ["today", "m"], ["media", "m"]];
      const seenOld = ["busy", "media", "ongoing", "replies", "review", "setup", "team", "today", "usage", "week"];
      c.check("old layout stored", await act(p, { kind: "widget_layout", layout: old, seen: seenOld }) === 200);
      await boot(c, tex); await c.sleep(1500);
      const b = await look(p), sv = await p.evaluate(() => App.ST.meta.widgets);
      c.check("upgrade: no team tile, no empty slot, review first and full width", !b.team && b.order[0] === "review" && b.review.w >= b.review.grid - 2 && b.order.every(k => k === "recent" || old.some(x => x[0] === k)), b.order);   /* empty sections fold into the calm line, so the count depends on the board */
      c.check("upgrade: 最近 is not inserted", !b.order.includes("recent") && !sv.layout.some(x => x[0] === "recent"), { order: b.order, sv });
      await c.shot("upgrade-top");
      /* removing 最近 sticks */
      await c.tap('[data-wg-edit]'); await c.sleep(600);
      const ed = await p.evaluate(() => { const r = document.querySelector("#wg .wg-review"); return { edit: !!document.querySelector("#wg.edit"), size: r ? [...r.querySelectorAll("[data-wg-size]")].map(b => b.textContent).join("") : "", move: r ? r.querySelectorAll("[data-wg-move]").length : -1, pin: !!(r && r.querySelector(".sct-pin")) }; });
      c.check("edit mode: 等你拍板 offers M / L, no move buttons, says it is pinned", ed.edit && ed.size === "ML" && ed.move === 0 && ed.pin, ed);
      await c.shot("edit");
      /* M = compact half-width tile, still first; L = full width (user 11-21 23:41) */
      await c.tap('#wg .wg-review [data-wg-size="review:m"]'); await c.sleep(900);
      const m = await look(p), sm = await p.evaluate(() => App.ST.meta.widgets.layout.find(x => x[0] === "review"));
      c.check("size M: 等你拍板 is a half-width tile, still first", m.order[0] === "review" && m.lab[0].sz === "sz-m" && m.review.w < m.review.grid * 0.6 && m.review.cols === 0, { w: m.review, sz: m.lab[0].sz });
      await c.shot("edit-review-m");
      await c.tap('#wg .wg-review [data-wg-size="review:l"]'); await c.sleep(900);
      const l = await look(p);
      c.check("size L: back to full width", l.order[0] === "review" && l.review.w >= l.review.grid - 2, l.review);
      /* 最近 is offered in 添加小组件; added back it sticks over a reload */
      c.check("添加小组件 offers 最近", await p.evaluate(() => !!document.querySelector('[data-wg-add="recent"]')));
      await c.tap('[data-wg-add="recent"]'); await c.sleep(900);
      await c.tap('[data-wg-edit]'); await c.sleep(300);
      await boot(c, tex); await c.sleep(1200);
      const d = await look(p);
      c.check("added 最近 stays after a reload: last, full width, up to 5 tiles", d.order[d.order.length - 1] === "recent" && d.recent && d.recent.tiles > 0 && d.recent.tiles <= 5, d.order);
      await p.evaluate(() => document.querySelector("#wg .wg-recent").scrollIntoView({ block: "end" })); await c.sleep(400);
      await c.shot(`recent-added-${tex}`);
      /* a board that got 最近 from the first build (seen without the recent-off mark) loses it once */
      c.check("layout from the first build stored", await act(p, { kind: "widget_layout", layout: [["review", "l"], ["busy", "l"], ["recent", "w"]], seen: seenOld.concat("recent") }) === 200);
      await boot(c, tex); await c.sleep(1500);
      const e = await look(p), se = await p.evaluate(() => App.ST.meta.widgets);
      c.check("first-build layout: 最近 taken out once, mark saved", !e.order.includes("recent") && !se.layout.some(x => x[0] === "recent") && se.seen.includes("recent-off"), { order: e.order, se });
    } finally {
      if (orig && orig.layout) await act(p, { kind: "widget_layout", layout: orig.layout, seen: orig.seen });
      else await act(p, { kind: "widget_layout", reset: true, seen: orig && orig.seen });
    }
    c.check("no page errors", !errs.length, errs);
  },
};
