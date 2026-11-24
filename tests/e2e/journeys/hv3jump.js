/* t-home-v3-jump: phone home status card. Tapping a stat tile (等你看 / 进行中 / 待办 / 近 7 天交付) scrolls #page to that list's head (smooth; instant under reduced motion). */
module.exports = { views: ["phone"], hash: () => "",
  async run(c) {
    const p = c.p; await c.sleep(1200);
    const st = () => p.evaluate(() => { const pg = document.getElementById("page"), t = pg.querySelector("#pagebody :is(.nr:has(> .nr-h), .ph-bar, .dc-h, .dc-none, .rv-list, .act-list, .empty)");
      return { top: pg.scrollTop, head: t ? Math.round(t.getBoundingClientRect().top - pg.getBoundingClientRect().top) : null, cls: t && t.className, label: ((document.querySelector("#pagebody .ph-bar .count") || {}).textContent || "").trim(), hf: App.UI.hf || "review" }; });
    c.check("status card tiles on the phone home", await p.evaluate(() => ["review", "doing", "todo", "week"].every(k => !!document.querySelector(`#officebox [data-hd-f=${k}]`))));
    await c.shot("home-top");
    for (const k of ["review", "doing", "todo", "week", "review"]) {
      await p.evaluate(() => { document.getElementById("page").scrollTop = 0; }); await c.sleep(300);
      await c.tap(`#officebox [data-hd-f=${k}]`);
      const mid = await (async () => { await c.sleep(120); return st(); })();
      await c.sleep(1100); const s = await st();
      c.check(`${k}: scrolled to its list head (head 0–30 px below the page top, or page at its end)`, s.hf === k && s.top > 0 && (s.head >= 0 && s.head <= 30 || await p.evaluate(() => { const pg = document.getElementById("page"); return pg.scrollTop + pg.clientHeight >= pg.scrollHeight - 2; })), { mid, s });
      if (s.top > 150) c.check(`${k}: smooth (still moving after 120 ms)`, mid.top > 0 && mid.top < s.top, { mid: mid.top, end: s.top }); else c.note(`${k}: short list, page ends ${s.top} px down (head visible at ${s.head} px)`);
      await c.shot("jump-" + k);
    }
    await p.emulateMedia({ reducedMotion: "reduce" });
    await p.evaluate(() => { document.getElementById("page").scrollTop = 0; }); await c.sleep(300);
    await c.tap("#officebox [data-hd-f=week]"); await c.sleep(80);
    const r = await st(); c.check("reduced motion: lands at once (head 0–30 px below the top, or page at its end)", r.hf === "week" && (r.head >= 0 && r.head <= 30 || await p.evaluate(() => { const pg = document.getElementById("page"); return pg.scrollTop > 0 && pg.scrollTop + pg.clientHeight >= pg.scrollHeight - 2; })), r);
    await p.emulateMedia({ reducedMotion: "no-preference" });
    await c.tap("#officebox [data-hd-f=review]"); await c.sleep(1000);
  },
};
