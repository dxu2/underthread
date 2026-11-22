/* t-detail-close B: the detail's two "close"s no longer look alike.
 *  - top right: 「收起 ›」 words (desk), not a ✕; it only hides the panel, the card keeps its stage
 *  - bottom left: a quiet 「结束」 text button (End round, 11-21: no ⋯ menu), which opens the unchanged reason dialog directly;
 *    submitting ends the card (stage done) and writes the reason into the thread
 *  - 复制链接 is a link icon next to the card id in the header
 *   node tests/e2e/drive.js run tests/e2e/journeys/detailclose.js --out work/t-detail-close/verify/<run> --engines chromium,webkit
 */
module.exports = {
  views: ["desk", "phone"],
  async run(c) {
    const p = c.p, errs = [], tag = `${c.engine}-${c.view}-${Date.now().toString(36)}`;
    p.on("pageerror", e => { const m = String(e).split("\n")[0]; if (!/due to access control checks/.test(m)) errs.push(m); });   /* WebKit reports the long poll that open()'s reload aborts as a page error */
    const A = `fx-dc-a-${tag}`, R = `fx-dc-r-${tag}`;
    c.su("upsert-item", "--id", A, "--title", "详情关闭测试 " + tag, "--who", "smith", "--stage", "doing", "--draft", "测试卡");
    c.su("upsert-item", "--id", R, "--title", "详情关闭测试（交审）" + tag, "--who", "smith", "--kind", "deliverable", "--stage", "review", "--draft", "交审测试卡");
    await p.evaluate(() => { localStorage.setItem("rt.lang", JSON.stringify("zh")); localStorage.setItem("rt.ut", '"ut"'); localStorage.setItem("rt.texture", '"knit2"'); });   /* knit = the signature look */
    const open = async id => {
      await p.goto(c.BASE + "/#item=" + id, { waitUntil: "load" }); await p.reload({ waitUntil: "load" });   /* a hash-only goto does not reload, so the deep link would not be read */
      await p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 20000 });
      await c.until(() => p.evaluate(() => !!document.querySelector("#drawer .dw-acts .dce-end")), 8000);
      await c.sleep(700);
    };
    await open(A);
    const top = await p.evaluate(() => {
      const v = e => !!e && e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== "hidden";
      const h = document.querySelector("#drawer .dw-top .dw-hide"), x = [...document.querySelectorAll("#drawer .dw-top button")].filter(b => v(b) && b.textContent.trim() === "✕");
      const acts = [...document.querySelectorAll("#drawer .dw-acts > *")].filter(v).map(b => b.dataset.act || (b.classList.contains("dce-end") ? "end" : b.dataset.snzBtn != null ? "snz" : b.className));
      const e = document.querySelector("#drawer .dw-acts .dce-end"), cs = e && getComputedStyle(e), lk = document.querySelector("#drawer .dw-top [data-copy-link]");
      return { hide: v(h) ? h.textContent.trim() : null, hideTitle: h && h.title, x: x.length, menu: !!document.querySelector("#drawer [data-more]"), acts,
        end: e && e.textContent.trim(), endColor: cs && cs.color, endBg: cs && cs.backgroundColor, link: v(lk) };
    });
    if (c.view === "desk") c.check("top right reads 收起 (no ✕)", top.hide === "收起" && !top.x, top);
    else c.check("phone: no ✕ in the top bar (back ‹ stays)", !top.x, top);
    c.check("bottom row: 结束 then 完成委托, no ⋯ menu", !top.menu && top.acts[0] === "close" && top.end === "结束" && top.acts.includes("done"), top);
    c.check("结束 is quiet: no red ink, no filled background", !/rgb\((1[5-9]\d|2\d\d), ([0-9]|[1-7]\d), /.test(top.endColor) && /rgba\(0, 0, 0, 0\)|transparent/.test(top.endBg), { color: top.endColor, bg: top.endBg });
    c.check("复制链接 sits in the header", top.link, top.link);
    await c.shot("detail", "#drawer");
    if (c.view === "desk") {
      await c.tap("#drawer .dw-top .dw-hide"); await c.sleep(900);
      const h = await p.evaluate(id => ({ item: App.UI.item, stage: (App.ST.items.find(i => i.id === id) || {}).stage }), A);
      c.check("收起 hides the panel and keeps the card", !h.item && h.stage === "doing", h);
      await open(A);
    }
    await c.tap("#drawer .dw-acts .dce-end"); await c.sleep(500);
    const md = await p.evaluate(() => { const m = document.querySelector("#modal"); return { open: !!m && !m.hidden, h: m && m.querySelector("h2") && m.querySelector("h2").textContent, ok: m && m.querySelector("[data-ok]") && m.querySelector("[data-ok]").textContent }; });
    c.check("结束 opens the reason dialog directly", md.open && /结束这张卡/.test(md.h) && md.ok === "结束这张卡", md);
    await c.shot("dialog");
    await p.fill("#modal textarea", "测试：不做了"); await c.tap("#modal [data-ok]");
    const st = await c.until(async () => { const s = await c.state(); const it = s.items.find(i => i.id === A); return it && it.stage === "done" ? it : null; }, 8000);
    c.check("submit ends the card", !!st, st && st.stage);
    const full = await (await fetch(c.BASE + "/api/item?id=" + A)).json().catch(() => null);
    const th = (full && (full.item || full).thread) || [];
    c.check("reason lands in the thread", th.some(e => /测试：不做了/.test(e.text || "")), th.slice(-3).map(e => e.text));
    await open(R);
    const rr = await p.evaluate(() => [...document.querySelectorAll("#drawer .dw-acts > *")].filter(b => b.getBoundingClientRect().width > 0).map(b => b.dataset.act || (b.classList.contains("dce-end") ? "end" : b.dataset.snzBtn != null ? "snz" : b.className)));
    c.check("review card row: 结束 驳回 稍后 验收", rr.join() === "close,reject,snz,approve", rr);
    await c.shot("review-row", "#drawer .dw-acts");
    c.check("no page errors", !errs.length, errs);
  },
};
