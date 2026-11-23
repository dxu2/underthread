/* t-web-quest-cards (plan B, 2026-11-22): on a desk the lane pages (主线 / 支线 / 杂活 / 紧急活动) show their cards in the phone card format,
 * up to three columns (chat column folded), with the ask options kept inside the card. The phone list is unchanged.
 *   node tests/e2e/drive.js run tests/e2e/journeys/questcards.js --out work/<item>/verify/<run> --engines chromium,webkit
 * Checks per combo (1440 zh, 1280 en) x (knit, ink): 3 columns in 等你拍板, no card scrolls or has a child outside its rect, an ask option is
 * hit-testable; once per engine a real click on an ask option answers it without opening the card. 1440 with the chat column open: 2 columns.
 * Pictures: a card with an image wears it on top, same pick and fallback as the phone review card; none = no cover.
 * Seeds three cards on 主线 (fixture-safe); the scratch state.json is snapshotted at load and put back after each view.
 * t-web-quest-cards-p2: masonry columns (.qc-col: cards keep their own height, no hole under a short card), one footer row with
 * the date on the right and 归档 / 完成 over it on hover, ask chips inline with 「其他…」 + 「还有 N 题」 on one line, a near-blank cover (white page,
 * one needle) is dropped, 推迟过 + 等了 N 天 fold into one pill (page clock +3 d), a resize that changes the column count deals the cards again.
 */
const fs = require("fs"), path = require("path");
const SCR = process.env.VERIFY_SCRATCH || `/tmp/rt-verify-${process.env.VERIFY_PORT || "8799"}`;
const SNAP = path.join(SCR, "state.questcards.json");
if (!fs.existsSync(SNAP)) fs.copyFileSync(path.join(SCR, "state.json"), SNAP);
const RUN = Date.now().toString(36);
const ID = k => `qc-${RUN}-${k}`;
/* a 900x600 white PNG with one thin grey bar (the "needle"): written with zlib, no image library */
const zlib = require("zlib");
const blankPng = () => {
  const W = 900, H = 600, raw = Buffer.alloc((W * 3 + 1) * H, 255);
  for (let y = 40; y < 100; y++) { raw[y * (W * 3 + 1)] = 0; for (let x = 440; x < 446; x++) raw.fill(128, y * (W * 3 + 1) + 1 + x * 3, y * (W * 3 + 1) + 4 + x * 3); }
  for (let y = 0; y < H; y++) raw[y * (W * 3 + 1)] = 0;
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
};

const seed = c => {
  /* pictures: card a has one (an icon from the repo, copied into the scratch work/), card c points at a missing file (falls back to no cover) */
  const wd = path.join(SCR, "work", "qc-test"); fs.mkdirSync(wd, { recursive: true });
  fs.copyFileSync(path.join(__dirname, "..", "..", "..", "web", "icons", "icon-512.png"), path.join(wd, "cover.png"));
  fs.writeFileSync(path.join(wd, "blank.png"), blankPng());
  c.su("upsert-item", "--id", ID("a"), "--title", "三列卡片测试：带问题的方案", "--summary", "这张卡有一个问题，选项故意写得很长，看它在三百多像素宽的卡里会不会折行出界。",
    "--category", "main", "--stage", "review", "--kind", "plan", "--owner", "smith", "--who", "smith", "--json", JSON.stringify({ attachments: ["work/qc-test/cover.png"] }));
  c.su("ask", ID("a"), "smith", "选项很长时卡片会不会撑破？", "--options", "我来收候选：1119/1120 还没定的几条 + smoke.py 注册表偶发失败*|第二个选项|第三个");
  c.su("ask", ID("a"), "smith", "第二个问题", "--options", "好|不好");   /* -> 「还有 1 题 ›」 next to 「其他…」 */
  c.su("upsert-item", "--id", ID("b"), "--title", "三列卡片测试：待验收", "--summary", "没有问题的卡，只有摘要和标签。", "--category", "main", "--stage", "review", "--kind", "deliverable", "--owner", "smith", "--who", "smith");
  c.su("upsert-item", "--id", ID("c"), "--title", "Quest cards test: a question card with an English title long enough to wrap", "--summary", "Third card in the first row.",
    "--category", "main", "--stage", "review", "--kind", "question", "--owner", "smith", "--who", "smith", "--json", JSON.stringify({ attachments: ["work/qc-test/missing.png"] }));
  c.su("ask", ID("c"), "smith", "Pick one", "--options", "Yes*|No");
  /* p2: d wears a near-blank picture (dropped); e came back from Later (folds into the waiting pill once it waits > 24 h, page clock +3 d) */
  c.su("upsert-item", "--id", ID("d"), "--title", "空白封面测试", "--summary", "图片几乎全白，只有一根针。", "--category", "main", "--stage", "review", "--kind", "deliverable",
    "--owner", "smith", "--who", "smith", "--json", JSON.stringify({ attachments: ["work/qc-test/blank.png"] }));
  const t0 = Date.now();
  c.su("upsert-item", "--id", ID("e"), "--title", "推迟过的卡", "--summary", "点过稍后，到点回来了。", "--category", "main", "--stage", "review", "--kind", "plan",
    "--owner", "smith", "--who", "smith", "--json", JSON.stringify({ snoozed: { at: new Date(t0 - 2 * 864e5).toISOString(), back: new Date(t0 + 3600e3).toISOString(), why: "time" } }));
};

const boot = async (c, skin, lang, fold) => {
  await c.p.evaluate(([sk, lg, f]) => { const s = (k, v) => localStorage.setItem("rt." + k, JSON.stringify(v)); s("lang", lg); s("ut", sk === "ink" ? "ink" : "ut"); s("texture", "knit1"); s("chatFold", f); }, [skin, lang, fold]);
  await c.p.reload({ waitUntil: "load" });
  await c.p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 20000 });
  await c.sleep(1200);
  if (c.view === "desk") await c.p.click("#nav [data-go=main]"); else await c.p.evaluate(() => App.go("main"));
  await c.p.waitForFunction(id => document.querySelector(`#pagebody .qc-grid [data-item="${id}"]`), ID("a"), { timeout: 10000 });
  await c.sleep(1600);
};

/* the first .qc-grid (等你拍板): its columns (.qc-col), the first card of each column, holes (gap between stacked cards), and per card any scroll,
   any child box outside the card, or a card taller than its content (a stretched row) */
const look = p => p.evaluate(() => {
  const g = document.querySelector("#pagebody .qc-grid"), cs = getComputedStyle(g);
  const cols = [...g.children].filter(e => e.classList.contains("qc-col"));
  const bad = [], holes = [], tall = [];
  for (const col of cols) { const ks = [...col.children]; for (let i = 1; i < ks.length; i++) { const d = ks[i].getBoundingClientRect().top - ks[i - 1].getBoundingClientRect().bottom; if (d > 16) holes.push(ks[i].dataset.item + " " + Math.round(d)); } }
  for (const k of document.querySelectorAll("#pagebody .qc-grid .card")) {
    const R = k.getBoundingClientRect(), id = k.dataset.item;
    if (k.scrollHeight > k.clientHeight + 1 || k.scrollWidth > k.clientWidth + 1) bad.push(id + " scroll " + k.scrollWidth + "x" + k.scrollHeight + ">" + k.clientWidth + "x" + k.clientHeight);
    const m = k.querySelector(".meta"); if (m && cols.length && R.bottom - m.getBoundingClientRect().bottom > 24) tall.push(id + " " + Math.round(R.bottom - m.getBoundingClientRect().bottom));
    k.querySelectorAll("*").forEach(e => {
      if (e.closest(".wk-fx, .yk") || getComputedStyle(e).position === "fixed") return;
      const r = e.getBoundingClientRect(); if (!r.width || !r.height) return;
      const s = getComputedStyle(e); if (s.visibility === "hidden" || s.display === "none") return;
      for (let a = e.parentElement; a && a !== k; a = a.parentElement) { const t = getComputedStyle(a); if (t.overflow !== "visible") return; }
      if (r.right > R.right + 1.5 || r.bottom > R.bottom + 1.5 || r.left < R.left - 1.5 || r.top < R.top - 1.5)
        bad.push(id + " " + (typeof e.className === "string" && e.className ? e.className.split(" ")[0] : e.tagName) + " " + Math.round(r.right - R.right) + "," + Math.round(r.bottom - R.bottom));
    });
  }
  const firsts = cols.length ? cols.map(c => c.firstElementChild).filter(Boolean) : [...g.children].filter(e => e.classList.contains("card")).slice(0, 3);
  const top = firsts.map(k => { const r = k.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width) }; });
  const pb = document.getElementById("pagebody");
  return { display: cs.display, cols: cols.length, n: g.querySelectorAll(".card").length, top, bad: bad.slice(0, 6), holes, tall,
    gw: Math.round(g.getBoundingClientRect().width), sw: document.documentElement.scrollWidth, vw: innerWidth, pbOver: pb.scrollWidth > pb.clientWidth + 1 };
});
/* footer: the date sits at the right edge of the card's content and, when the row has room, on the same line as the first pill; on hover 归档 / 完成
   show over it (date faded) and do not cover a pill */
const foot = (p, id) => p.evaluate(id => {
  const k = document.querySelector(`#pagebody [data-item="${id}"]`); if (!k) return { found: false };
  const K = k.getBoundingClientRect(), dt = k.querySelector(".meta > .qc-dt"), pill = k.querySelector(".meta > .tag"), D = dt.getBoundingClientRect(), P = pill.getBoundingClientRect();
  return { found: true, right: Math.round(K.right - D.right), sameRow: Math.abs((D.top + D.bottom) / 2 - (P.top + P.bottom) / 2) < 4, pillsRight: Math.round(Math.max(...[...k.querySelectorAll(".meta > .tag, .meta > .wait-d, .meta > .snz-was")].map(e => e.getBoundingClientRect().right))) };
}, id);
const hov = (p, id) => p.evaluate(id => {
  const k = document.querySelector(`#pagebody [data-item="${id}"]`), a = k.querySelector(".acts"), dt = k.querySelector(".meta > .qc-dt"), A = a.getBoundingClientRect();
  const pr = Math.max(...[...k.querySelectorAll(".meta > .tag, .meta > .wait-d, .meta > .snz-was")].map(e => e.getBoundingClientRect().right));
  return { acts: +getComputedStyle(a).opacity, dt: +getComputedStyle(dt).opacity, clear: A.left >= pr - 1 || A.top >= k.querySelector(".meta > .tag").getBoundingClientRect().bottom - 1, aR: Math.round(A.left), pr: Math.round(pr) };
}, id);
/* chips: inline (two short options share a line), 「其他…」 and 「还有 N 题」 on one line */
const chips = (p, id) => p.evaluate(id => {
  const k = document.querySelector(`#pagebody [data-item="${id}"]`); if (!k) return { found: false };
  const o = k.querySelector(".ask-o.ghost"), m = k.querySelector(".ri14-more"), b2 = k.querySelector('.ask-o[data-ask-opt="第二个选项"]'), b3 = k.querySelector('.ask-o[data-ask-opt="第三个"]');
  const r = e => e && e.getBoundingClientRect();
  return { found: true, tail: !!k.querySelector(".ask-tail"), more: !!m, otherMore: !!o && !!m && Math.abs(r(o).top - r(m).top) < 2, inline: !!b2 && !!b3 && Math.abs(r(b2).top - r(b3).top) < 2 };
}, id);
/* pictures: a = cover loaded inside the card, avatar below it; b = no picture, no cover; c = missing file, cover removed (phone: no cover shown) */
const pics = (p, ids) => p.evaluate(ids => ids.map(id => { const k = document.querySelector(`#pagebody [data-item="${id}"]`), v = k && k.querySelector(".qc-cv"), im = v && v.querySelector("img");
  if (!k) return { id, found: false };
  const K = k.getBoundingClientRect(), V = v && v.getBoundingClientRect(), A = k.querySelector(".owner .av").getBoundingClientRect(), shown = !!v && getComputedStyle(v).display !== "none";
  return { id, found: true, cv: !!v, hasCv: k.classList.contains("has-cv"), shown, loaded: !!im && im.complete && im.naturalWidth > 0,
    inside: !V || (V.left >= K.left && V.right <= K.right + 1 && V.top >= K.top && V.height > 60), avBelow: !shown || A.top >= V.bottom - 1 };
}), ids);
/* the seeded long option: visible, inside its card, and the topmost element at its centre (clickable) */
const hit = (p, id) => p.evaluate(id => {
  const b = document.querySelector(`#pagebody [data-item="${id}"] .ask-o[data-ask-opt="第二个选项"]`); if (!b) return { found: false };
  b.scrollIntoView({ block: "center" }); const r = b.getBoundingClientRect(), K = b.closest(".card").getBoundingClientRect();
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const lng = document.querySelector(`#pagebody [data-item="${id}"] .ask-o.rec`).getBoundingClientRect();
  return { found: true, hit: !!top && b.contains(top), inside: r.left >= K.left && r.right <= K.right + 1 && lng.right <= K.right + 1, w: Math.round(r.width) };
}, id);

module.exports = {
  views: ["desk", "phone"],
  hash: () => "#page=review",
  async run(c) {
    const p = c.p, errs = [];
    p.on("pageerror", e => { const m = String(e).split("\n")[0]; if (!/due to access control checks/.test(m)) errs.push(m); });
    seed(c);
    if (c.view === "phone") {
      /* the phone keeps its single-column list: the wrapper is a plain block and each card spans it; none of the desk p2 parts show */
      await boot(c, "knit", "zh", false);
      const a = await look(p);
      const ph = await pics(p, [ID("a")]);
      c.check("phone: no desk cover on the list (not even hidden: no thumb fetched)", ph[0].found && !ph[0].cv && !ph[0].shown, ph);
      c.check("phone: list unchanged (block wrapper, no columns, one column, full-width cards, no sideways scroll)", a.display === "block" && !a.cols && a.top.length >= 2 && a.top[0].l === a.top[1].l && a.top[0].w >= a.gw - 2 && a.sw <= a.vw, a);
      const ph2 = await p.evaluate(() => ({ tail: !!document.querySelector("#pagebody .ask-tail"), fold: !!document.querySelector("#pagebody .wait-d.snz") }));
      c.check("phone: chips and pills as before (no .ask-tail, no folded snooze pill)", !ph2.tail && !ph2.fold, ph2);
      await c.shot("phone-main-knit");
      c.check("phone: no page errors", !errs.length, errs);
      return;
    }
    for (const [W, lang] of [[1440, "zh"], [1280, "en"]]) for (const skin of ["knit", "ink"]) {
      await p.setViewportSize({ width: W, height: 900 });
      await boot(c, skin, lang, true);
      await c.sleep(800);   /* the blank cover's check may deal the columns once more */
      const a = await look(p), tag = `${W} ${lang} ${skin}`;
      c.check(`${tag}: 3 columns, first row side by side`, a.display === "flex" && a.cols === 3 && a.top.length === 3 && new Set(a.top.map(x => x.t)).size === 1 && new Set(a.top.map(x => x.l)).size === 3, a);
      c.check(`${tag}: masonry, no hole under a short card, no card stretched past its footer`, !a.holes.length && !a.tall.length, { holes: a.holes, tall: a.tall });
      c.check(`${tag}: no card scrolls, no child outside its card, no sideways scroll`, !a.bad.length && !a.pbOver && a.sw <= a.vw, { bad: a.bad, sw: a.sw, vw: a.vw });
      const [pa, pb, pc, pd] = await pics(p, [ID("a"), ID("b"), ID("c"), ID("d")]);
      c.check(`${tag}: picture card shows its cover (loaded, inside the card, avatar below)`, pa.cv && pa.shown && pa.loaded && pa.inside && pa.avBelow, pa);
      c.check(`${tag}: no picture = no cover; missing file falls back to no cover`, !pb.cv && !pb.hasCv && !pc.cv && !pc.hasCv, { pb, pc });
      pd.http = await p.evaluate(() => fetch("/api/thumb?p=" + encodeURIComponent("work/qc-test/blank.png") + "&w=780").then(r => r.status));   /* it loads: dropped as blank, not as a 404 */
      c.check(`${tag}: near-blank picture (white page, one needle) = no cover`, pd.found && !pd.cv && !pd.hasCv && pd.http === 200, pd);
      for (const k of ["a", "b"]) { const f = await foot(p, ID(k));
        c.check(`${tag}: footer ${k}: date at the right edge, same row as the pills`, f.found && f.right >= 10 && f.right <= 20 && f.sameRow, f); }
      const ch = await chips(p, ID("a"));
      c.check(`${tag}: chips inline; 其他… and 还有 1 题 share one line`, ch.found && ch.tail && ch.more && ch.otherMore && ch.inline, ch);
      const h = await hit(p, ID("a"));
      c.check(`${tag}: ask options inside the card and clickable`, h.found && h.hit && h.inside, h);
      await p.hover(`#pagebody [data-item="${ID("b")}"] .body h3`); await c.sleep(500);
      const hv = await hov(p, ID("b"));
      c.check(`${tag}: hover: 归档 / 完成 over the date, date faded, no pill covered`, hv.acts > .9 && hv.dt < .1 && hv.clear, hv);
      await p.mouse.move(2, 2);
      await p.evaluate(() => document.getElementById("page").scrollTo(0, 0)); await c.sleep(300);
      await c.shot(`main-${W}-${lang}-${skin}`);
    }
    /* chat column open at 1440: the page is narrower, so two columns, still nothing out of a card */
    await p.setViewportSize({ width: 1440, height: 900 });
    await boot(c, "knit", "zh", false);
    await c.sleep(800);
    const o = await look(p);
    c.check("1440 chat open: 2 columns, no overflow, no holes", o.cols === 2 && !o.bad.length && !o.holes.length && o.sw <= o.vw, o);
    await c.shot("main-1440-zh-knit-chatopen");
    /* a resize that changes the column count deals the cards again (ResizeObserver -> refreshPage) */
    await p.setViewportSize({ width: 1900, height: 900 });
    const n3 = await c.until(() => p.evaluate(() => { const g = document.querySelector("#pagebody .qc-grid"); return g && g.querySelectorAll(":scope > .qc-col").length === 3 ? 3 : 0; }), 4000);
    c.check("resize 1440 -> 1900 (chat open): 3 columns without a reload", n3 === 3, n3);
    await p.setViewportSize({ width: 1440, height: 900 });
    /* a real click on an option: answered (server), card not opened */
    await boot(c, "knit", "zh", true);
    await p.evaluate(id => document.querySelector(`#pagebody [data-item="${id}"] .ask-o[data-ask-opt="第二个选项"]`).scrollIntoView({ block: "center" }), ID("a"));
    await p.click(`#pagebody [data-item="${ID("a")}"] .ask-o[data-ask-opt="第二个选项"]`);
    const ans = await c.until(async () => { const s = await c.state(); const it = s.items.find(i => i.id === ID("a")); const q = it && (it.asks || [])[0]; return q && q.answer && q.answer.opt; }, 8000);
    const opened = await p.evaluate(() => !!(window.App && App.UI && App.UI.item));
    c.check("click on an ask option answers it (server) and does not open the card", ans === "第二个选项" && !opened, { ans, opened });
    /* 推迟过 + 等了 N 天 -> one pill: move the page clock 3 days on so e has come back from Later and waited > 24 h */
    await boot(c, "knit", "zh", true);
    await p.clock.setFixedTime(new Date(Date.now() + 3 * 864e5));
    await p.evaluate(() => App.refreshPage()); await c.sleep(600);
    const fd = await p.evaluate(id => { const k = document.querySelector(`#pagebody [data-item="${id}"]`); return k && { fold: [...k.querySelectorAll(".meta .wait-d.snz")].map(e => e.textContent), was: k.querySelectorAll(".meta .snz-was").length, wait: k.querySelectorAll(".meta .wait-d").length }; }, ID("e"));
    c.check("snoozed + waiting fold into one pill (推迟过 · N 天)", !!fd && fd.fold.length === 1 && /^推迟过 · \d+ 天$/.test(fd.fold[0]) && !fd.was && fd.wait === 1, fd);
    await c.shot("snooze-fold", `#pagebody [data-item="${ID("e")}"]`);
    c.check("desk: no page errors", !errs.length, errs);
  },
  async cleanup({ log }) {
    fs.copyFileSync(SNAP, path.join(SCR, "state.json")); log("questcards: scratch state.json put back");
    fs.rmSync(path.join(SCR, "work", "qc-test"), { recursive: true, force: true });
  },
};
