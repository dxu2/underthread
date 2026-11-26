/* t-home-cards-redesign V3: phone list home status card (big headline, accent "on you" patch, three knit tags, 「Last shipped」 last line) + usage card
 * (total headline, one bar split by role, role list without bars, knit swatch "quota left"); desk: the Usage widget (total + split bar + % per role, Soul "% left").
 *   node tests/e2e/drive.js run tests/e2e/journeys/hv3.js --out work/<item>/verify/<run> --engines chromium,webkit
 *   SKINS=white:knit1,dark:knit1,white:leather1,dark:leather1 LANGS=en,zh for the full matrix (default: white knit, en + zh).
 * /api/usage is answered with a fixed sample (a scratch copy reads no transcripts, so it would always be 0). */
const USG = JSON.stringify({ day: "2026-01-01", at: new Date().toISOString(), roles: [
  { id: "scout", in: 1582, cw: 2795630, cr: 116730186, out: 490023, msgs: 756, sessions: 10, new: 3287235 },
  { id: "manager", in: 1498, cw: 544671, cr: 106334376, out: 137834, msgs: 582, sessions: 1, new: 684003 },
  { id: "writer", in: 210, cw: 601924, cr: 12489011, out: 52210, msgs: 99, sessions: 2, new: 654344 },
  { id: "artist", in: 8, cw: 76405, cr: 207009, out: 1377, msgs: 4, sessions: 1, new: 77790 }], total: 4703372, cache_read: 235760582, history: [] });
const SKINS = (process.env.SKINS || "white:knit1").split(",").map(s => s.split(":"));
const LANGS = (process.env.LANGS || "en,zh").split(",");
const boot = async (c, th, tx, lg, extra) => {
  const p = c.p;
  await p.evaluate(([th, tx, lg, ex]) => { const s = (k, v) => localStorage.setItem("rt." + k, JSON.stringify(v)); s("ut", "ut"); s("texture", tx); s("theme", th); s("themeMode", "manual"); s("lang", lg); s("home3", "widgets");
    localStorage.removeItem("rt.skin"); if (ex === "ink") s("skin", "ink");
    localStorage.setItem("rt.welcome", JSON.stringify({ v: 1, seen: Object.fromEntries(((window.App && App.ST && App.ST.meta && App.ST.meta.hires) || []).map(h => [h.id + "@" + h.at, 1])) })); }, [th, tx, lg, extra || ""]);
  await p.reload({ waitUntil: "load" });
  await p.waitForFunction(() => !document.getElementById("ut-splash") && window.App && App.ST && App.ST.meta, null, { timeout: 15000 });
  await c.sleep(2200);
  await p.mouse.move(2, 2); await c.sleep(400);
};
const probePhone = p => p.evaluate(() => {
  const hd = document.querySelector("#officebox .hd-a2"), ru = document.querySelector(".ru-card");
  const box = e => e && e.getBoundingClientRect();
  const over = root => root ? [...root.querySelectorAll("*")].filter(e => { const s = getComputedStyle(e); if (s.display === "none" || s.visibility === "hidden") return false;
    const r = e.getBoundingClientRect(), R = root.getBoundingClientRect(); return r.width > 0 && (r.right > R.right + 1 || r.left < R.left - 1); }).map(e => e.className && e.className.baseVal == null ? e.className : e.tagName).slice(0, 6) : null;
  const ell = root => root ? [...root.querySelectorAll(".hv3-pc span, .hv3-pc small, .hv3-tag span, .hv3-pn span, .ru-n .t")].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent) : null;
  const patch = hd && hd.querySelector(".hv3-patch");
  return { patch: !!patch, patchIsReview: !!(patch && patch.matches('.hd-stat[data-hd-f="review"]')), tags: hd ? [...hd.querySelectorAll(".hv3-tag")].map(t => t.dataset.hdF + "=" + t.textContent.replace(/\s+/g, " ").trim()) : null,
    head: hd && hd.querySelector(".a2-rest-t") ? hd.querySelector(".a2-rest-t").textContent : null, foot: hd && hd.querySelector(".hv3-foot") ? hd.querySelector(".hv3-foot").textContent.replace(/\s+/g, " ").trim() : null,
    chips: patch ? [...patch.querySelectorAll(".hv3-pc > *")].map(e => e.textContent) : null, patchBg: patch ? getComputedStyle(patch).backgroundColor : null,
    seg: ru ? ru.querySelectorAll(".ru-seg i").length : null, bars: ru ? ru.querySelectorAll(".ru-bar").length : null, sh: ru ? [...ru.querySelectorAll(".ru-sh")].map(e => e.textContent) : null,
    big: ru && ru.querySelector(".ru-tot") ? ru.querySelector(".ru-tot").textContent.replace(/\s+/g, " ").trim() : null,
    q: ru ? [...ru.querySelectorAll(".hv3-m")].map(m => m.textContent.replace(/\s+/g, " ").trim() + " on=" + m.querySelectorAll(".on").length) : null, qh: ru && ru.querySelector(".hv3-qh") ? ru.querySelector(".hv3-qh").textContent : null,
    overHd: over(hd), overRu: over(ru), ell: [...(ell(hd) || []), ...(ell(ru) || [])],
    hdH: hd ? Math.round(box(hd).height) : null, ruH: ru ? Math.round(box(ru).height) : null,
    inf: document.getAnimations().filter(a => { const t = a.effect && a.effect.target; return t && (t.closest(".hv3-patch, .hv3-tags, .hv3-foot, .ru-seg, .hv3-q")) && a.effect.getComputedTiming().iterations === Infinity; }).map(a => a.animationName || a.effect.target.className) };
});
const probeDesk = p => p.evaluate(() => {
  const w = document.querySelector("#wg [data-wg=usage]"); if (!w) return null;
  const R = w.getBoundingClientRect();
  return { cls: w.className, seg: w.querySelectorAll(".ru-seg i").length, bars: w.querySelectorAll(".ru-bar").length, sh: [...w.querySelectorAll(".ru-row:not(.fit-hide) .ru-sh")].map(e => e.textContent),
    tot: w.querySelector(".ru-tot") ? w.querySelector(".ru-tot").textContent.replace(/\s+/g, " ").trim() : null, left: [...w.querySelectorAll(".sl-b > b")].map(b => b.textContent),
    out: [...w.querySelectorAll(".ru-row:not(.fit-hide), .ru-tot, .ru-seg, .sl")].filter(e => { const r = e.getBoundingClientRect(); return r.bottom > R.bottom + 1 || r.right > R.right + 1; }).map(e => e.className),
    rowsShown: w.querySelectorAll(".ru-row:not(.fit-hide)").length };
});
module.exports = {
  views: ["desk", "phone"],
  hash: () => "#page=review",
  async run(c) {
    const p = c.p, phone = c.view === "phone";
    c.su("set-usage", "--five", "38", "--week", "72", "--context", "41");   /* the fixture board has no usage feed: the quota meters need one */
    await p.route("**/api/usage", r => r.fulfill({ status: 200, contentType: "application/json", body: USG }));
    /* WebKit: page.route misses fetch() (Playwright WebKit), so the page's fetch is shimmed for /api/usage too */
    await c.p.context().addInitScript(body => { const f0 = window.fetch; window.fetch = (u, o) => String(u).startsWith("/api/usage") ? Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "application/json" } })) : f0(u, o); }, USG);
    await p.setViewportSize(phone ? { width: 390, height: 1400 } : { width: 1440, height: 1100 });
    for (const [th, tx] of SKINS) for (const lg of LANGS) {
      if (lg !== "en" && !(th === SKINS[0][0] && tx === SKINS[0][1])) continue;   /* zh only on the first skin */
      await boot(c, th, tx, lg);
      const tag = `${th}-${tx}-${lg}`;
      await c.shot(tag);
      if (phone) {
        const r = await probePhone(p); c.note(tag + " " + JSON.stringify(r));
        c.check(`${tag}: patch is the review stat (filter + tour target)`, r.patch && r.patchIsReview, r);
        c.check(`${tag}: three tags doing/todo/week`, r.tags && r.tags.map(t => t.split("=")[0]).join() === "doing,todo,week", r.tags);
        c.check(`${tag}: usage = total headline + split bar, no per-row bars`, r.big && r.seg >= 2 && r.bars === 0 && r.sh.length >= 2, { big: r.big, seg: r.seg, bars: r.bars, sh: r.sh });
        c.check(`${tag}: quota meters say LEFT, 3 swatches`, r.q && r.q.length === 3 && /left|剩余/i.test(r.qh || ""), { q: r.q, qh: r.qh });
        c.check(`${tag}: nothing sticks out of either card`, !(r.overHd || []).length && !(r.overRu || []).length, { hd: r.overHd, ru: r.overRu });
        c.check(`${tag}: no clipped labels`, !r.ell.length, r.ell);
        c.check(`${tag}: no endless animation in the new parts`, !r.inf.length, r.inf);
      } else {
        const r = await probeDesk(p); c.note(tag + " " + JSON.stringify(r));
        c.check(`${tag}: desk widget has split bar and % per role, no per-row bars`, r && r.seg >= 2 && r.bars === 0 && r.sh.length === r.rowsShown, r);
        c.check(`${tag}: Soul numbers say left`, r && r.left.length && r.left.every(t => /left|剩/.test(t) || t === "—"), r && r.left);
        c.check(`${tag}: nothing past the widget edge`, r && !r.out.length, r && r.out);
      }
    }
    if (!phone) return;
    /* interactions (phone, white knit, en) */
    await boot(c, SKINS[0][0], SKINS[0][1], "en");
    const hf = () => p.evaluate(() => App.UI.hf || "review");
    await c.tap('#officebox .hv3-tag[data-hd-f="todo"]'); await c.sleep(700);
    c.check("tap To do tag filters the list", await hf() === "todo" && await p.evaluate(() => !!document.querySelector('#officebox .hv3-tag[data-hd-f="todo"].on')), await hf());
    await c.shot("filter-todo");
    await c.tap('#officebox .hv3-tag[data-hd-f="todo"]'); await c.sleep(700);
    /* t-home-v3-jump (11-23): a phone tile jumps to its list and no longer toggles back on a second tap; the patch is the way back */
    c.check("tap again keeps To do (jump, no toggle)", await hf() === "todo", await hf());
    await c.tap('#officebox .hv3-tag[data-hd-f="week"]'); await c.sleep(600);
    await c.tap('#officebox .hv3-patch'); await c.sleep(600);
    c.check("tap the patch goes back to on you", await hf() === "review", await hf());
    const stk = await p.evaluate(() => { const s = document.querySelector("#officebox .a2-stack"); return s && !s.hidden; });
    if (stk) {
      await c.tap("#officebox .a2-stack"); await c.sleep(700);
      c.check("idle stack expands", await p.evaluate(() => document.querySelector("#officebox .a2-exp").classList.contains("on")));
      await c.shot("idle-open");
      await c.tap("#officebox .a2-stack"); await c.sleep(600);
      /* long-press a face -> the quick sheet */
      const f = await p.evaluate(() => { const e = document.querySelector("#officebox .a2-faces i[data-lp]"); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      if (f) { await p.mouse.move(f.x, f.y); await p.mouse.down(); await c.sleep(650); await p.mouse.up(); await c.sleep(500);
        c.check("long-press an idle face opens the quick sheet", await p.evaluate(() => !!document.querySelector(".dp-sheet-w")));
        await p.evaluate(() => { const w = document.querySelector(".dp-sheet-w"); if (w) w.remove(); }); }
    }
    /* working state: a fake working member (client only) -> rows on top, headline + last shipped hidden, role dye kept */
    await p.evaluate(() => { const a = App.agent("scout"); a.status = "working"; a.since = new Date(Date.now() - 12 * 6e4).toISOString(); a.activity = "Testing the V3 card"; App.refreshPage(); });
    await c.sleep(1200);
    const wr = await p.evaluate(() => { const hd = document.querySelector("#officebox .hd-a2"); return { rows: hd.querySelectorAll(".a2-r").length, role: hd.dataset.role || null, rest: hd.querySelector(".a2-rest").hidden, foot: hd.querySelector(".hv3-foot") ? hd.querySelector(".hv3-foot").hidden : null }; });
    c.check("working: a row shows, card dyed, headline + last-shipped line hidden", wr.rows >= 1 && wr.role && wr.rest && wr.foot, wr);
    await c.shot("working");
    /* ink skin smoke */
    await boot(c, "white", "knit1", "en", "ink");
    const ink = await probePhone(p); c.check("ink skin: patch + tags render, nothing sticks out", ink.patch && ink.tags.length === 3 && !(ink.overHd || []).length, ink);
    await c.shot("ink");
  }
};
