/* t-mail-width: the mailbox keeps a fixed width and never scrolls sideways, whatever the letters hold.
 * Seeds letters with a very long URL, an unbroken token, a code line, a markdown table, an image link and a long card title, then opens
 * the desk drop-down (top 信箱 button), the desk 信箱 page (App.go("mail")) and the phone mail view, and checks that no container is
 * wider than its box: scrollWidth <= clientWidth on the panel, its list and every row, and nothing pokes past the panel's right edge.
 *   node tests/e2e/drive.js run tests/e2e/journeys/mailwidth.js --out work/<item>/verify/<run> --engines chromium,webkit
 */
const LONG = "https://example.com/" + "a-very-long-path-segment-".repeat(12) + "?q=" + "x".repeat(80);
const LETTERS = [
  "长链接测试 " + LONG,
  "Unbroken " + "超长不断行的一串字".repeat(4) + "ABCDEFGHIJKLMNOPQRSTUVWXYZ".repeat(6),
  "代码：\n```\nconst reallyLongVariableName = someFunction(argumentNumberOne, argumentNumberTwo, argumentNumberThree, argumentNumberFour);\n```",
  "| 列一 | 列二 | 列三 | 列四 | 列五 | 列六 |\n|---|---|---|---|---|---|\n| 很长很长的单元格内容一 | 很长很长的单元格内容二 | 很长很长的单元格内容三 | 很长很长的单元格内容四 | 五五五五五五五五 | 六六六六六六六六 |",
  "图 ![wide](https://example.com/" + "w".repeat(120) + ".png) and `inline_code_that_is_extremely_long_without_any_breaks_at_all_whatsoever_" + "z".repeat(40) + "`",
];
const scan = p => p.evaluate(() => {
  const bad = [], seen = new Set();
  const roots = [document.querySelector("#mailbox:not([hidden])"), document.querySelector(".mb-page"), document.querySelector("#main .act-list")].filter(e => e && e.getBoundingClientRect().width);
  const vw = document.documentElement.clientWidth;
  const m = document.querySelector("#main"), doc = { sw: document.documentElement.scrollWidth, vw, bodySw: document.body.scrollWidth, mainSw: m && m.scrollWidth, mainCw: m && m.clientWidth };
  for (const r of roots) {
    const R = r.getBoundingClientRect();
    for (const e of [r, ...r.querySelectorAll("*")]) {
      if (seen.has(e)) continue; seen.add(e);
      const cs = getComputedStyle(e); if (cs.display === "none" || cs.visibility === "hidden") continue;
      if (/absolute|fixed/.test(cs.position) && cs.pointerEvents === "none") continue;   /* decoration (working glow rings) never widens a box */
      const own = e.matches("pre, pre *, table, table *, .tbl-wrap, .tbl-wrap *, code");   /* code and tables may scroll inside themselves */
      const b = e.getBoundingClientRect(); if (!b.width) continue;
      if (b.right > R.right + 1 && !own && !e.closest("pre, .tbl-wrap, table")) bad.push({ what: "past edge", el: e.tagName.toLowerCase() + "." + [...e.classList].join("."), over: Math.round(b.right - R.right) });
      if (e.scrollWidth > e.clientWidth + 1 && /auto|scroll/.test(cs.overflowX) && !own && !e.matches(".seg, .mb-f, .seg *")) bad.push({ what: "scrolls x", el: e.tagName.toLowerCase() + "." + [...e.classList].join("."), sw: e.scrollWidth, cw: e.clientWidth });
    }
  }
  return { roots: roots.map(r => r.id || r.className), doc, bad: bad.slice(0, 12), n: bad.length };
});
module.exports = {
  views: ["desk", "phone"],
  hash: view => (view === "desk" ? "#page=review" : ""),
  async run(c) {
    const p = c.p, errs = [], tag = `${c.engine}-${c.view}-${Date.now().toString(36)}`;
    p.on("pageerror", e => { const m = String(e).split("\n")[0]; if (!/due to access control checks/.test(m)) errs.push(m); });
    const id = `fx-mw-${tag}`;
    c.su("upsert-item", "--id", id, "--title", "信箱宽度测试 " + "很长的卡名".repeat(8) + tag, "--who", "smith", "--stage", "doing", "--draft", "x");
    for (const t of LETTERS) c.su("reply", id, "smith", t);
    await p.evaluate(tx => { localStorage.setItem("rt.lang", JSON.stringify("zh")); if (tx) localStorage.setItem("rt.texture", JSON.stringify(tx)); }, process.env.MW_TEXTURE || "");
    await p.reload({ waitUntil: "load" });
    await p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 20000 });
    await c.sleep(3000);
    if (c.view === "desk") {
      await c.tap('#hdrctrl [data-h="mail"], [data-h="mail"]'); await c.sleep(800);
      const a = await scan(p);
      c.check("drop-down: nothing wider than the panel, no sideways scroll", a.roots.length && !a.n, a);
      await c.shot("desk-dropdown", "#mailbox");
      await p.keyboard.press("Escape"); await p.evaluate(() => App.go("mail")); await c.sleep(1500);
      const b = await scan(p);
      c.check("desk 信箱 page: rows stay inside, no sideways scroll", b.roots.length && !b.n && b.doc.sw <= b.doc.vw + 1 && b.doc.mainSw <= b.doc.mainCw + 1, b);
      await c.shot("desk-page");
    } else {
      await c.tap("#tabbar [data-k=activity]"); await c.sleep(1500);
      const a = await scan(p);
      c.check("phone 动态 / mail list: rows stay inside, page does not scroll sideways", a.roots.length && !a.n && a.doc.sw <= a.doc.vw + 1 && a.doc.mainSw <= a.doc.mainCw + 1, a);
      await c.shot("phone-mail");
      const sx = await p.evaluate(() => { const m = document.querySelector("#main"); m.scrollLeft = 500; window.scrollTo(500, window.scrollY); return { main: m.scrollLeft, win: window.scrollX }; });
      c.check("phone: a sideways scroll attempt moves nothing", !sx.main && !sx.win, sx);
    }
    c.check("no page errors", !errs.length, errs);
  },
};
