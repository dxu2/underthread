/* r-improve-1122: four polish fixes.
 *  P1 phone arrival pill: the 「还有 N 条 / N more」 chip is a +N badge on the avatar corner, so an English title is not cut; tapping it steps on. Desk keeps the chip.
 *  P2 phone 素材 (two rows) and 招聘市场 use the 委托 / 通知 filter row (.filters.mb-row.m-seg.q > .seg): same height, sliding pill; desk keeps its chips.
 *  P3 the 推荐 tag never splits across two lines.
 *  P4 desk, Knit: top-right reply cards carry the pill's stitched edge and 22 px corner; Leather and plain skins unchanged.
 *   node tests/e2e/drive.js run tests/e2e/journeys/ri1122.js --out work/<item>/verify/<run> --views desk,phone --engines chromium,webkit
 */
const SKINS = [["ut", "knit1", "dark"], ["ut", "leather1", "dark"], ["ink", "off", "white"], ["ut", "off", "white"]];
const seed = async (c, ut, tex, theme, lang) => {
  await c.p.evaluate(o => { const s = (k, v) => localStorage.setItem("rt." + k, JSON.stringify(v)); s("ut", o.ut); s("texture", o.tex); s("theme", o.theme); s("themeMode", "manual"); s("stage", false); s("lang", o.lang); s("home3", "widgets"); }, { ut, tex, theme, lang });
  await c.p.reload({ waitUntil: "load" });
  await c.p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 15000 }); await c.sleep(1500);
};
const pill = p => p.evaluate(() => { const w = document.querySelector("#lka-pw .lka-pill"); if (!w) return null; const b = w.querySelector(".lka-tx b"), m = w.querySelector(".lka-more"), a = w.querySelector(".lka-pav");
  const mr = m.getBoundingClientRect(), ar = a.getBoundingClientRect(), pr = w.getBoundingClientRect(), mb = m.querySelector(".lka-mb"), mf = m.querySelector(".lka-mf");
  return { title: b.textContent, cut: b.scrollWidth > b.clientWidth + 1, hidden: m.hidden, badge: mb && getComputedStyle(mb).display !== "none" ? mb.textContent : "", chip: mf && getComputedStyle(mf).display !== "none" ? mf.textContent : "",
    aria: m.getAttribute("aria-label"), onAv: mr.left < ar.right && mr.right > ar.left + ar.width / 2 && mr.top < ar.top + ar.height / 2, inPill: mr.top >= pr.top && mr.right <= pr.right, mw: Math.round(mr.width), mh: Math.round(mr.height) }; });
module.exports = {
  views: ["desk", "phone"],
  hash: view => (view === "desk" ? "#page=review" : ""),
  async run(c) {
    const p = c.p, desk = c.view === "desk";
    /* P1 */
    for (const lang of ["en", "zh"]) {
      await seed(c, "ut", "knit1", "dark", lang);
      if (!(await p.evaluate(() => !!window.LookAway))) { c.note("P1 skipped: this tree has no arrival pill (web/js/lookaway.js)"); break; }
      await p.evaluate(() => { LookAway.pillOut(); return new Promise(r => setTimeout(() => { LookAway.pillAdd([{ cls: "decide", agent: "writer", sub: "Script v2" }, { cls: "reply", agent: "smith", sub: "x" }, { cls: "ask", agent: "scout", sub: "y" }]); r(); }, 600)); });
      await c.sleep(1300); let P = await pill(p);
      if (desk) c.check(`P1 ${lang} desk: the chip stays (${lang === "en" ? "2 more" : "还有 2 条"}), no badge`, P && !P.hidden && /2/.test(P.chip) && !P.badge, P);
      else {
        c.check(`P1 ${lang} phone: +2 badge on the avatar corner, chip text hidden, label kept for screen readers`, P && P.badge === "+2" && !P.chip && P.onAv && P.inPill && /2/.test(P.aria), P);
        c.check(`P1 ${lang} phone: the title is not cut`, P && !P.cut, P);
        await c.shot(`p1-${lang}`);
        await p.evaluate(() => LookAway.pillOut()); await c.sleep(500);
        await p.evaluate(() => LookAway.pillAdd([{ cls: "decide", agent: "writer", sub: "Script v2" }, { cls: "reply", agent: "smith", sub: "x" }, { cls: "ask", agent: "scout", sub: "y" }])); await c.sleep(900);
        const bb = await p.locator("#lka-pw .lka-more").boundingBox();   /* the pill re-renders as it counts down: tap the badge's spot, not the node */
        await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); await c.sleep(600); P = await pill(p);
        c.check(`P1 ${lang} phone: tapping the badge steps to the next (+1)`, P && P.badge === "+1", P);
      }
      await p.evaluate(() => LookAway.pillOut()); await c.sleep(500);
    }
    /* P2 */
    for (const [ut, tex, theme] of SKINS) {
      await seed(c, ut, tex, theme, "zh");
      const ref = desk ? null : await (async () => { await p.evaluate(() => App.go("quests")); await c.sleep(1200);
        return p.evaluate(() => { const s = document.querySelector(".m-seg.q .seg"), i = s && s.querySelector(".seg-i"); return s && { h: s.offsetHeight, ih: i.offsetHeight, bg: getComputedStyle(s).backgroundColor, sh: getComputedStyle(s).boxShadow, fs: getComputedStyle(i).fontSize }; }); })();
      for (const pg of ["assets", "market"]) {
        await p.evaluate(pg => App.go(pg), pg); await c.sleep(1500); await p.evaluate(() => scrollTo(0, 0));
        const R = await p.evaluate(() => [...document.querySelectorAll("#pagebody .ri22-row .seg")].map(s => { const i = s.querySelector(".seg-i"), on = s.querySelector(".seg-i.on"), ind = s.querySelector(".seg-ind");
          const ir = ind && ind.getBoundingClientRect(), or = on && on.getBoundingClientRect();
          return { key: s.dataset.seg, h: s.offsetHeight, ih: i.offsetHeight, bg: getComputedStyle(s).backgroundColor, sh: getComputedStyle(s).boxShadow, fs: getComputedStyle(i).fontSize, pillOn: !!(ir && or && Math.abs(ir.left - or.left) < 2 && Math.abs(ir.width - or.width) < 2) }; }));
        const old = await p.evaluate(() => document.querySelectorAll("#pagebody .lib-seg, #pagebody .mk-chips").length);
        if (desk) { c.check(`P2 ${pg} ${ut}/${tex}/${theme} desk: old chips kept, no phone row`, R.length === 0 && old >= 1, { R, old }); continue; }
        const want = pg === "assets" ? 2 : 1;
        c.check(`P2 ${pg} ${ut}/${tex}/${theme} phone: ${want} filter row(s) like 委托 (track ${ref && ref.h}px, buttons ${ref && ref.ih}px, same fill / ring / font), pill under the pick, no old chips`,
          R.length === want && old === 0 && R.every(r => ref && r.h === ref.h && r.ih === ref.ih && r.bg === ref.bg && r.sh === ref.sh && r.fs === ref.fs && r.pillOn), { R, ref });
        if (tex === "knit1") await c.shot(`p2-${pg}-${tex}`, "#pagebody .ri22-row");
        /* pick the second button: the pick moves, the pill follows, the list filters */
        const sel = "#pagebody .ri22-row .seg > .seg-i:nth-of-type(2)";
        const before = await p.evaluate(() => document.querySelectorAll(".mk-card, .lib-f").length);
        await c.tap(sel); await c.sleep(900);
        const A = await p.evaluate(s => { const b = document.querySelector(s), seg = b && b.parentElement, ind = seg && seg.querySelector(".seg-ind"); const ir = ind && ind.getBoundingClientRect(), br = b && b.getBoundingClientRect();
          return { on: b && b.classList.contains("on"), ons: seg ? seg.querySelectorAll(".seg-i.on").length : -1, pill: !!(ir && br && Math.abs(ir.left - br.left) < 2), n: document.querySelectorAll(".mk-card, .lib-f").length }; }, sel);
        c.check(`P2 ${pg} ${ut}/${tex}/${theme} phone: tapping the 2nd filter picks it, the pill follows, the list filters`, A.on && A.ons === 1 && A.pill && A.n <= before, { A, before });
      }
    }
    /* P3 */
    const r3 = await p.evaluate(() => { const w = document.createElement("div"); w.style.cssText = "position:fixed;left:0;top:0;width:150px;font-size:14px;z-index:99999";
      w.innerHTML = ["ask-o rec", "opts", "ri13-o"].map(k => k === "opts" ? `<div class="opts"><button class="btn-s">一二三四五六七八九<em class="rec-b">推荐</em></button></div>` : `<button class="${k}" style="width:150px">一二三四五六七八九<em class="rec-b">推荐</em></button>`).join("");
      document.body.appendChild(w); const n = [...w.querySelectorAll(".rec-b")].map(e => e.getClientRects().length); w.remove(); return n; });
    c.check("P3 the 推荐 tag is one piece in .ask-o / .opts / .ri13-o (one line box each)", r3.length === 3 && r3.every(n => n === 1), r3);
    /* P4 (desk only: the phone shows no top-right cards) */
    if (desk) for (const [ut, tex, theme, want] of [["ut", "knit1", "dark", "knit"], ["ut", "knit1", "white", "knit"], ["ut", "leather1", "dark", "leather"], ["ut", "off", "dark", "plain"], ["ink", "off", "white", "plain"]]) {
      await seed(c, ut, tex, theme, "zh");
      await p.evaluate(() => { const it = App.items()[0]; WebToast.show({ cls: "reply", agent: "scout", it, text: "选题第二版放上去了，你看看" }); });
      await p.waitForFunction(() => document.querySelector("#wtoasts .wt.in"), null, { timeout: 6000 }).catch(() => {}); await c.sleep(600);
      const T = await p.evaluate(() => { const w = document.querySelector("#wtoasts .wt"); if (!w) return null; const a = getComputedStyle(w, "::after"); return { br: getComputedStyle(w).borderRadius, after: a.content, bs: a.borderStyle }; });
      const ok = !T ? false : want === "knit" ? T.br === "22px" && T.bs === "dashed" : T.br === "16px" && T.bs !== "dashed";
      c.check(`P4 ${ut}/${tex}/${theme}: reply card ${want === "knit" ? "stitched, 22px corner" : "unchanged (16px, no stitch)"}`, ok, T);
      if (want !== "plain" || ut === "ink") await c.shot(`p4-${ut}-${tex}-${theme}`, "#wtoasts");
      await p.evaluate(() => document.querySelectorAll("#wtoasts .wt").forEach(e => e.remove()));
    }
  }
};
