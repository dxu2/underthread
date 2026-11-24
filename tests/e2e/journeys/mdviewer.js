/* t-md-viewer: .md and .txt attachments on a card open in the in-app viewer (viewer.js), not as raw text in a new tab.
 * Seeds a card with three attachments in the scratch copy (script.md with a heading, table, link and code; notes.txt with HTML-looking text;
 * big.md over the 200 KB cap) and, in en and zh, opens each one from the card's attachment strip.
 * Checks: viewer opens with the doc (no new tab); .md is rendered (h1, table, clickable link, code block); .txt is preformatted and escaped;
 * the 原文 / Raw chip points at the file; a big file shows the first part plus a truncation note with a raw link; the doc box scrolls;
 * Esc / ✕ closes the viewer and leaves the card open. Desk also shoots the viewer in every look (knit, leather, ink, plain) x (dark, white).
 *   node tests/e2e/drive.js run tests/e2e/journeys/mdviewer.js --out work/t-md-viewer/verify/<run> --engines chromium,webkit
 */
const fs = require("fs"), path = require("path");
const ID = "fx-mdviewer";
const MD = [
  "# 推广短片脚本 · Promo script", "",
  "第一段：开场 3 秒，看板从黑屏亮起。See the [reference](https://example.com/ref) and `work/t-promo-video/notes.md`.", "",
  "## 分镜 · Shots", "",
  "| 镜头 | 时长 | 画面 |", "|---|---|---|", "| 1 | 3 s | 看板亮起，胶囊落下 |", "| 2 | 5 s | 卡片三列排开，问题在卡里直接选 |", "",
  "- 第一条要点", "- Second point, **bold** and *italic*", "",
  "```", "const drop = PillDrop.play(\"in\", G);", "drop.then(() => settle());", "```", "",
  "> 旁白：一句话交给管家。", "",
].join("\n");
const TXT = "纯文本笔记 plain notes\n<b>not html</b> & stays as text\n    indented line keeps its spaces\n";
module.exports = {
  views: ["desk", "phone"],
  hash: () => "",
  async run(c) {
    const p = c.p, errs = [], popups = [];
    p.on("pageerror", e => errs.push(String(e).split("\n")[0]));
    p.context().on("page", pg => popups.push(pg.url()));
    const dir = path.join(c.SCRATCH, "work", ID);
    if (!(await c.state()).items.some(i => i.id === ID)) {   /* seed once per server */
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "script.md"), MD);
      fs.writeFileSync(path.join(dir, "notes.txt"), TXT);
      const line = "## 第 N 段 · Part N\n\n" + "这是一段很长的正文，用来把文件撑过 200 KB 的上限。Filler text to push the file past the cap. ".repeat(6) + "\n\n";
      let big = "# 大文件 · Big file\n\n"; for (let i = 1; big.length < 260 * 1024; i++) big += line.replace(/N/g, i);
      fs.writeFileSync(path.join(dir, "big.md"), big);
      await c.su("upsert-item", "--id", ID, "--title", "md viewer fixture", "--who", "smith", "--owner", "smith", "--category", "side",
        "--kind", "deliverable", "--stage", "review", "--draft", "Fixture card for the md viewer.", "--label", "v1");
      await c.su("reply", ID, "smith", "三个附件 · three attachments", "--attach", `work/${ID}/script.md`, "--attach", `work/${ID}/notes.txt`, "--attach", `work/${ID}/big.md`);
    }
    const doc = () => p.evaluate(() => {
      const lb = document.getElementById("lb"), d = lb && lb.querySelector(".lb-docin"), nw = lb && lb.querySelector(".lb-new"), box = lb && lb.querySelector(".lb-doc");
      return { on: !!lb && lb.classList.contains("on") && lb.classList.contains("is-doc"), wait: !!(d && d.querySelector(".lb-wait")),
        h1: d && d.querySelector("h1") ? d.querySelector("h1").textContent : "", table: !!(d && d.querySelector("table td")),
        link: d && d.querySelector('a[href="https://example.com/ref"]') ? d.querySelector('a[href="https://example.com/ref"]').target : null,
        code: !!(d && d.querySelector("pre.code")), pre: d && d.querySelector("pre.lb-txt") ? d.querySelector("pre.lb-txt").textContent : "",
        bTag: !!(d && d.querySelector("pre.lb-txt b")), cut: d && d.querySelector(".lb-cut") ? d.querySelector(".lb-cut").textContent.trim() : "",
        cutLink: d && d.querySelector(".lb-cut a") ? d.querySelector(".lb-cut a").getAttribute("href") : "", len: d ? d.textContent.length : 0,
        raw: nw ? nw.textContent.trim() : "", rawHref: nw ? nw.getAttribute("href") : "", cnt: (lb && lb.querySelector(".lb-cnt") || {}).textContent || "",
        ta: box ? getComputedStyle(box).touchAction : "", us: box ? getComputedStyle(box).userSelect || getComputedStyle(box).webkitUserSelect : "",
        scroll: box ? box.scrollHeight - box.clientHeight : 0 };
    });
    const openAtt = async name => {
      const sel = `#drawer .atts a[href$="/${name}"]`;
      await p.locator(sel).last().scrollIntoViewIfNeeded();
      await c.tap(sel);
      return c.until(async () => { const d = await doc(); return d.on && !d.wait && d.len > 0 && d; }, 8000);
    };
    const closeLb = async () => {
      if (c.view === "desk") await p.keyboard.press("Escape"); else await c.tap("#lb .lb-x");
      return c.until(() => p.evaluate(() => { const lb = document.getElementById("lb"); return !lb || !lb.classList.contains("on"); }), 3000);
    };
    const drawerOpen = () => p.evaluate(id => { const d = document.querySelector("#drawer"); return !!d && d.getClientRects().length > 0 && (d.textContent || "").includes("md viewer fixture"); }, ID);

    for (const lang of ["en", "zh"]) {
      const zh = lang === "zh";
      await p.evaluate(l => localStorage.setItem("rt.lang", JSON.stringify(l)), lang);
      await p.goto(c.BASE + "/", { waitUntil: "load" });
      await p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 20000 });
      await c.sleep(800);
      await p.evaluate(id => App.openItem(id), ID);
      c.check(`${lang}: card opens`, await c.until(drawerOpen, 8000));
      await c.until(() => p.evaluate(() => document.querySelectorAll('#drawer .atts a[href$=".md"], #drawer .atts a[href$=".txt"]').length >= 3), 8000);
      await c.shot(`${lang}-card`, c.view === "desk" ? "#drawer" : undefined);

      const n0 = popups.length;
      const m = await openAtt("script.md");
      c.check(`${lang} script.md: opens in the viewer, not a new tab`, !!m && popups.length === n0, { popups: popups.slice(n0) });
      c.check(`${lang} script.md: rendered like a card (h1, table, link, code)`, !!m && /Promo script/.test(m.h1) && m.table && m.link === "_blank" && m.code, m);
      c.check(`${lang} script.md: raw chip says ${zh ? "原文" : "Raw"} and points at the file`, !!m && m.raw.includes(zh ? "原文" : "Raw") && /\/work\/fx-mdviewer\/script\.md$/.test(m.rawHref), m && { raw: m.raw, href: m.rawHref });
      c.check(`${lang} script.md: doc box scrolls and selects (touch-action / user-select)`, !!m && /pan-y/.test(m.ta) && m.us === "text", m && { ta: m.ta, us: m.us });
      await c.shot(`${lang}-md`);
      c.check(`${lang} script.md: closes, card stays open`, (await closeLb()) && (await drawerOpen()));

      const t = await openAtt("notes.txt");
      c.check(`${lang} notes.txt: preformatted, HTML stays text`, !!t && t.pre.includes("<b>not html</b>") && !t.bTag && t.pre.includes("    indented"), t && { pre: t.pre, bTag: t.bTag });
      await c.shot(`${lang}-txt`);
      await closeLb();

      const b = await openAtt("big.md");
      c.check(`${lang} big.md: first part + truncation note with a raw link`, !!b && !!b.cut && /\/work\/fx-mdviewer\/big\.md$/.test(b.cutLink) && b.len < 215 * 1024 && b.scroll > 200,
        b && { cut: b.cut, link: b.cutLink, len: b.len, scroll: b.scroll });
      const st = await p.evaluate(() => { const x = document.querySelector("#lb .lb-doc"); x.scrollTop = 1e9; return x.scrollTop; });
      c.check(`${lang} big.md: scrolls to the end`, st > 200, { scrollTop: st });
      await c.sleep(300); await c.shot(`${lang}-big-end`);
      await closeLb();
    }

    if (c.view === "desk") {   /* one shot per look x theme, zh, script.md (visual check, no assertions beyond opening) */
      const R0 = await p.evaluate(() => { const R = document.documentElement; return { theme: R.dataset.theme, texture: R.dataset.texture || null, skin: R.dataset.skin || null }; });
      for (const look of ["knit", "leather", "ink", "plain"]) for (const theme of ["dark", "white"]) {
        await p.evaluate(([look, theme]) => {
          const R = document.documentElement; R.dataset.theme = theme;
          if (look === "knit") R.dataset.texture = "knit1"; else if (look === "leather") R.dataset.texture = "leather1"; else delete R.dataset.texture;
          if (look === "ink") R.dataset.skin = "ink"; else delete R.dataset.skin;
        }, [look, theme]);
        await c.sleep(250);
        const ok = await openAtt("script.md");
        c.check(`look ${look}/${theme}: viewer opens`, !!ok);
        await c.sleep(350); await c.shot(`look-${look}-${theme}`);
        await closeLb();
      }
      await p.evaluate(r => { const R = document.documentElement; R.dataset.theme = r.theme; if (r.texture) R.dataset.texture = r.texture; else delete R.dataset.texture; if (r.skin) R.dataset.skin = r.skin; else delete R.dataset.skin; }, R0);
    }
    c.check("no page errors", !errs.length, errs);
  },
};
