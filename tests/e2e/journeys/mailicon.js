/* t-mailbox-icon: the desk top-bar Mailbox is an icon-only round button (>= 36 px), word in title + aria-label, unread count as a corner badge,
 * stitched envelope under Underthread (dashed rect + cross-stitched flap). Click opens the mailbox drop-down. Ink skin: plain envelope, same shape.
 *   node tests/e2e/drive.js run tests/e2e/journeys/mailicon.js --out work/<item>/verify/<run> --views desk --engines chromium,webkit
 */
const info = p => p.evaluate(() => { const b = document.querySelector("#hdrctrl .hc-mail"); if (!b) return null; const r = b.getBoundingClientRect(), n = b.querySelector(".n");
  const nr = n && n.getBoundingClientRect(); const rect = b.querySelector("svg rect");
  return { w: Math.round(r.width), h: Math.round(r.height), text: [...b.childNodes].filter(x => x.nodeType === 3 || (x.tagName === "SPAN" && !x.classList.contains("n"))).map(x => x.textContent.trim()).join(""),
    title: b.title, aria: b.getAttribute("aria-label"), n: n ? n.textContent.trim() : null, nPos: nr ? [Math.round(nr.left - r.left), Math.round(nr.top - r.top), Math.round(nr.width)] : null,
    dash: rect ? getComputedStyle(rect).strokeDasharray : null, x: getComputedStyle(b.querySelector(".ums-x")).display }; });
module.exports = {
  views: ["desk"],
  hash: () => "#page=review",
  async run(c) {
    const p = c.p;
    for (const ut of [true, false]) {
      await p.evaluate(u => { const s = (k, v) => localStorage.setItem("rt." + k, JSON.stringify(v)); if (u) s("ut", "ut"); else localStorage.removeItem("rt.ut"); s("texture", "leather1"); s("home3", "widgets"); s("lang", "en"); }, ut);
      await p.reload({ waitUntil: "load" }); await p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 15000 }); await c.sleep(1500);
      const i = await info(p); const tag = ut ? "ut" : "ink";
      c.check(`${tag}: icon only, >= 36 px, title + aria say Mailbox`, i && i.w >= 36 && i.h >= 36 && i.text === "" && i.title === "Mailbox" && /^Mailbox/.test(i.aria), i);
      c.check(`${tag}: unread badge sits on the top-right corner`, i && (i.n === null || (i.nPos[0] > i.w / 2 && i.nPos[1] < 0)), i);
      if (ut) c.check("ut: stitched envelope (dashed body + cross-stitched flap)", i && i.dash !== "none" && i.x !== "none", i);
      await p.mouse.move(5, 500);
      await c.shot(`${tag}-topbar`, "#hdrctrl");
      await p.hover("#hdrctrl .hc-mail"); await c.sleep(300); await c.shot(`${tag}-hover`, "#hdrctrl");
    }
    await p.click("#hdrctrl .hc-mail"); await c.sleep(800);
    const open = await p.evaluate(() => { const m = document.getElementById("mailbox") || document.querySelector(".mailbox, #mbox"); return !!m && !m.hidden && m.getBoundingClientRect().height > 50; });
    c.check("click opens the mailbox drop-down", open, open);
    await c.shot("open");
  },
};
