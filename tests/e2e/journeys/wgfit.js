/* t-home-sml-audit: no home widget text may be cut by, or sit on, its stitched border.
 * User 11-22 22:36: the S 「今天交付 / Shipped today」 tile had its last title line cut in half by the bottom stitch, and
 * homesml.js did not see it (it only compared boxes with the tile's outer rect). This journey measures every visible text LINE
 * (Range client rects, so a clamp or ellipsis is judged by what is actually drawn) in every core widget against:
 *   stitch  — the stitched inner area: the tile rect inset by its negative outline-offset (knit dashed outline / leather groove
 *             at the stitch line); a line whose visible part crosses it sits on the thread;
 *   cut     — a clipping ancestor (overflow != visible) cuts a line part-way (half-hidden glyphs). Lines a clamp hides whole are fine;
 *             a sideways cut is fine only under text-overflow: ellipsis;
 *   label   — a line that overlaps the sewn tab label (.wg-eb b) without being part of it;
 *   scroll  — the tile itself scrolls (scrollHeight > clientHeight).
 * Matrix: S / M / L / mix × zh / en × Underthread knit, Underthread leather, ink; desk 1440 and phone 390 (opt-in widget home).
 * Each run seeds real-length data (long zh and en titles, many shipped / waiting / replies) with per-run ids and closes them after.
 *   node tests/e2e/drive.js run tests/e2e/journeys/wgfit.js --out work/<item>/verify/<run> --engines chromium,webkit
 * WGFIT_OUT=<file.json> also writes every finding (with a tile screenshot per finding) for an audit sheet. */
const fs = require("fs"), path = require("path");
const CORE = ["review", "usage", "busy", "replies", "today", "week", "ongoing", "media"];
const LOOKS = [["ut", "knit1"], ["ut", "leather1"], ["ink", "knit1"]];
const act = (p, body) => p.evaluate(b => fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(r => r.status), body);
const boot = async (c, look, lang, phone) => {
  await c.p.evaluate(([sk, tx, lg, ph]) => { const s = (k, v) => localStorage.setItem("rt." + k, JSON.stringify(v)); s("lang", lg); s("ut", sk); s("texture", tx); s("chatFold", false);
    if (ph) s("phoneHome", "widgets"); localStorage.removeItem("rt.widgets"); localStorage.removeItem("rt.wgChosen"); }, [look[0], look[1], lang, !!phone]);
  await c.p.reload({ waitUntil: "load" });
  await c.p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash") && document.querySelector("#wg .wg-grid > .wg"), null, { timeout: 20000 });
  await c.sleep(1600);
  await c.p.evaluate(() => document.getAnimations().forEach(a => { try { if (a.effect && a.effect.getComputedTiming().iterations !== Infinity) a.finish(); } catch (_) { } }));
  await c.sleep(200);
};
/* every finding in every tile; see the header for the kinds */
const measure = p => p.evaluate(() => {
  const SKIP = ".wg-sz, .wg-x, .wg-mv, .wg-eband, .sct-pin, .bpl-knot, .yk, [aria-hidden=true]";
  const vis = e => { for (let a = e; a; a = a.parentElement) { const s = getComputedStyle(a); if (s.display === "none" || s.visibility === "hidden" || +s.opacity === 0) return false; } return true; };
  const isect = (a, b) => ({ left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) });
  const out = [];
  document.querySelectorAll("#wg .wg-grid > .wg[data-wg]").forEach(t => {
    const k = t.dataset.wg, R = t.getBoundingClientRect(), cs = getComputedStyle(t), oo = parseFloat(cs.outlineOffset) || 0;
    const ins = cs.outlineStyle !== "none" && oo < 0 ? -oo : 0;
    const IN = { left: R.left + ins, top: R.top + ins, right: R.right - ins, bottom: R.bottom - ins };
    const lab = t.querySelector(".wg-eb > b"), LR = lab && vis(lab) ? lab.getBoundingClientRect() : null, EB = t.querySelector(".wg-eb");
    const add = (kind, e, txt, d) => out.push({ k, kind, cls: (typeof e.className === "string" ? e.className : e.tagName).split(" ").slice(0, 2).join("."), txt: txt.slice(0, 28), d });
    if (t.scrollHeight > t.clientHeight + 1) add("scroll", t, "", t.scrollHeight - t.clientHeight);
    const tw = document.createTreeWalker(t, NodeFilter.SHOW_TEXT, { acceptNode: n => n.nodeValue.trim() ? 1 : 2 });
    for (let n; (n = tw.nextNode());) {
      const e = n.parentElement; if (!e || e.closest(SKIP) || !vis(e)) continue;
      /* the clip box: the intersection of every clipping ancestor up to the tile (the tile counts: it clips too) */
      let C = { left: -1e9, top: -1e9, right: 1e9, bottom: 1e9 }, ell = false, clamp = false;
      for (let a = e; a; a = a.parentElement) { const s = getComputedStyle(a);
        if (s.textOverflow === "ellipsis") ell = true; if (s.webkitLineClamp && s.webkitLineClamp !== "none") clamp = true;
        if (s.overflowX !== "visible" || s.overflowY !== "visible") C = isect(C, a.getBoundingClientRect());
        if (a === t) break; }
      const r = document.createRange(); r.selectNodeContents(n);
      const inLab = EB && EB.contains(e);   /* the eyebrow row: the sewn tab label and its count tab sit on the edge on purpose */
      [...r.getClientRects()].forEach(L => {
        if (L.width < 1 || L.height < 1) return;
        const V = isect(L, C), vh = V.bottom - V.top, vw = V.right - V.left;
        if (vh <= 0.5 || vw <= 0.5) return;   /* hidden whole (a clamp or the tile dropped the line): fine */
        const ch = L.height - vh; if (ch > 2 && vh < L.height - 2) add("cut", e, n.nodeValue.trim(), Math.round(ch));   /* half a line shows */
        if (L.right - V.right > 2 && !ell && !clamp) add("cut-x", e, n.nodeValue.trim(), Math.round(L.right - V.right));
        if (inLab) return;
        const o = Math.max(IN.top - V.top, V.bottom - IN.bottom, IN.left - V.left, V.right - IN.right);
        /* glyph boxes carry ~15% leading above and below the ink: allow 3 px before calling it a stitch overlap */
        if (o > 3) add("stitch", e, n.nodeValue.trim(), Math.round(o));
        if (LR) { const X = isect(V, LR); if (X.right - X.left > 2 && X.bottom - X.top > 2) add("label", e, n.nodeValue.trim(), Math.round(X.bottom - X.top)); }
      });
    }
  });
  /* one finding per (tile, kind, element class): the same clamp shows once */
  const seen = new Set(); return { n: document.querySelectorAll("#wg .wg-grid > .wg[data-wg]").length, F: out.filter(f => { const key = f.k + f.kind + f.cls + f.txt; if (seen.has(key)) return false; seen.add(key); return true; }) };
});
const LONG_ZH = ["首页 S/M/L 第二步：手机版小组件首页的长标题，看看会不会被底部缝线切掉一半", "B站 十一月合集封面 + 简介 + 置顶评论，三个平台一起交的那一版", "每周数据复盘：YouTube 留存曲线和小红书收藏率对比"];
const LONG_EN = ["Weekly analytics review — YouTube retention against Xiaohongshu saves, long English title", "Thumbnail set for the November compilation (three platforms, final)", "Supercalifragilisticexpialidocious_unbroken_filename_title_v12_final.png"];
let SEED = null;
async function seed(c) {
  const RUN = Date.now().toString(36) + c.engine.slice(0, 2) + c.view[0], ids = [], T = [...LONG_ZH, ...LONG_EN];
  const ag = await c.p.evaluate(() => { const a = Object.values(App.ST.agents || {}).filter(a => a.enabled !== false && a.id !== "manager"); const w = a.find(x => x.status !== "working") || a[0]; return { id: w.id, status: w.status, item: w.item || "" }; });
  const mk = (id, extra) => { ids.push(id); c.su("upsert-item", "--id", id, "--who", ag.id, "--owner", ag.id, ...extra); };
  /* shipped today = closed today: only the done action stamps closed, so these go review -> done through it (newest = the last, a long zh title) */
  for (let i = 5; i >= 0; i--) { mk(`fx-fit-${RUN}-d${i}`, ["--title", T[i], "--category", "side", "--kind", "deliverable", "--stage", "review", "--draft", "x", "--label", "v1"]);
    await act(c.p, { kind: "done", item: `fx-fit-${RUN}-d${i}` }); }
  for (let i = 0; i < 4; i++) mk(`fx-fit-${RUN}-r${i}`, ["--title", T[(i + 2) % 6], "--category", "side", "--kind", "deliverable", "--stage", "review", "--draft", "x", "--label", "v1"]);
  for (let i = 0; i < 2; i++) mk(`fx-fit-${RUN}-o${i}`, ["--title", T[(i + 3) % 6], "--category", "ongoing", "--kind", "task", "--stage", "doing"]);
  mk(`fx-fit-${RUN}-b`, ["--title", T[0], "--category", "side", "--kind", "task", "--stage", "doing"]);
  c.su("set-agent", ag.id, "--status", "working", "--item", `fx-fit-${RUN}-b`, "--activity", "wgfit");
  for (let i = 0; i < 3; i++) c.su("reply", `fx-fit-${RUN}-r${i}`, ag.id, i % 2 ? "Long reply in English to see how the preview line wraps inside a small tile, and whether it gets clamped cleanly" : "回你一句比较长的话：封面三个版本都放在卡上了，第二版字更大，手机上看得清，你挑一个我就出终版");
  SEED = { ids, ag };
}
async function unseed(c) {
  if (!SEED) return; const { ids, ag } = SEED; SEED = null;
  if (ag.status === "working" && ag.item) c.su("set-agent", ag.id, "--status", "working", "--item", ag.item); else c.su("set-agent", ag.id, "--status", "idle");
  for (const id of ids) c.su("upsert-item", "--id", id, "--who", ag.id, "--stage", "done");
}
module.exports = {
  views: ["desk", "phone"],
  hash: () => "#page=review",
  async run(c) {
    const p = c.p, phone = c.view === "phone", errs = [], ALL = [];
    p.on("pageerror", e => { const m = String(e).split("\n")[0]; if (!/due to access control checks/.test(m)) errs.push(m); });
    await c.sleep(800);
    const orig = await p.evaluate(() => JSON.parse(JSON.stringify(App.ST.meta.widgets || null)));
    try {
      await seed(c);
      /* 各角色用量 reads session transcripts, which a scratch copy has none of: zh runs get a full day (every role plus 其他会话, so ruFit
         has rows to drop), en runs the empty day (「No tokens used yet today」). */
      const ids = await p.evaluate(() => Object.values(App.ST.agents || {}).filter(a => a.enabled !== false).map(a => a.id));
      let FULL = true;
      await p.route("**/api/usage*", async r => { const res = await r.fetch(), d = await res.json();
        if (FULL) { d.roles = [...ids, "other"].map((id, i) => ({ id, new: Math.round(9e6 / (i + 1)), in: 1000, out: 2e5, cw: 1e6, cr: 5e7, msgs: 200, sessions: 3 })); d.total = d.roles.reduce((t, x) => t + x.new, 0); d.cache_read = 6.3e8; }
        await r.fulfill({ response: res, json: d }); });
      for (const look of LOOKS) for (const lang of ["zh", "en"]) for (const z of ["s", "m", "l", "mix"]) {
        const L = z === "mix" ? [["review", "m"], ["usage", "s"], ["busy", "l"], ["replies", "s"], ["today", "s"], ["week", "l"], ["ongoing", "m"], ["media", "s"]] : CORE.map(k => [k, z]);
        await act(p, { kind: "widget_layout", layout: L, chosen: CORE });
        FULL = lang === "zh";
        await boot(c, look, lang, phone);
        const M = await measure(p), F = M.F, tag = `${look[0]}-${look[1]} ${lang} ${z}`;
        c.check(`${tag}: at least 7 widgets measured`, M.n >= 7, M.n);
        c.check(`${tag}: no widget text cut, on the stitch or under the label`, !F.length, F.slice(0, 6));
        for (const f of F) {
          const f2 = Object.assign({ engine: c.engine, view: c.view, look: look.join("-"), lang, z }, f);
          if (process.env.WGFIT_OUT && !ALL.some(x => x.k === f.k && x.kind === f.kind && x.look === f2.look && x.lang === lang && x.z === z)) f2.shot = await c.shot(`${f.k}-${z}-${look.join("-")}-${lang}-${f.kind}`, `#wg .wg-grid > .wg[data-wg="${f.k}"]`);
          ALL.push(f2);
        }
      }
      c.check("no page errors", !errs.length, errs);
    } finally {
      if (process.env.WGFIT_OUT) { let prev = []; try { prev = JSON.parse(fs.readFileSync(process.env.WGFIT_OUT, "utf8")); } catch (_) { } fs.writeFileSync(process.env.WGFIT_OUT, JSON.stringify(prev.concat(ALL), null, 1)); }
      await unseed(c);
      if (phone) await p.evaluate(() => localStorage.removeItem("rt.phoneHome"));
      await act(p, { kind: "widget_layout", reset: true });
      if (orig && orig.layout) await act(p, Object.assign({ kind: "widget_layout", layout: orig.layout }, orig.chosen ? { chosen: orig.chosen } : {}));
    }
  },
};
