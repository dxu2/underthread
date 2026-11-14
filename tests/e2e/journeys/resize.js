/* t-ui-fix-p1 P1-6: resize sweep. The user's report (11-11 23:46): at a narrow chat column the DM header pushed the call button past the edge.
 * Every resizable pane at its minimum, its maximum and widths in between, in en and zh, at a 1440 and a 1100 window:
 *   - right chat column: dragged by its real grip (.ch-grip) to 300 (min), 360, 420 (default), 560, 760 (max), on the home page and a DM;
 *   - item drawer (#drawer): dragged by #dw-grip to its 520 minimum and to its maximum;
 *   - left nav: fixed width, checked at both window widths.
 * Check: every visible control (button, a, input, textarea, select, [role=button], [data-go], [data-aq]) in the top bar, the left nav, the chat
 * header and composer and the drawer's top bar is fully inside its pane AND inside the viewport (1 px tolerance). Controls inside a sideways
 * scroller are exempt on that axis only (avatar strip sideways, the left nav up-down): scrolling to them is the design.
 *   node tests/e2e/drive.js run tests/e2e/journeys/resize.js --out work/<item>/verify/<run> --engines chromium,webkit
 * Read-only: no fixtures, no writes. It changes rt.chatW / dwWidth in the test browser's own localStorage only.
 */
module.exports = {
  views: ["desk"],
  async run(c) {
    const p = c.p;
    const AREAS = { "#top": "#top", "#left": "#left", "#right .ch-head": "#right", "#right .ch-comp": "#right", "#drawer .dw-top": "#drawer" };
    const audit = async (label) => {
      const bad = await p.evaluate(AREAS => {
        const out = [], vw = innerWidth, vh = innerHeight;
        const vis = e => { const s = getComputedStyle(e); if (s.display === "none" || s.visibility === "hidden" || +s.opacity === 0) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        /* which axes a sideways / up-down scroller between the control and its pane (pane included) already handles */
        const scrollAxes = (e, pane) => { const ax = { x: false, y: false }; for (let a = e.parentElement; a; a = a.parentElement) { const s = getComputedStyle(a);
          if (/auto|scroll/.test(s.overflowX) && a.scrollWidth > a.clientWidth + 1) ax.x = true; if (/auto|scroll/.test(s.overflowY) && a.scrollHeight > a.clientHeight + 1) ax.y = true; if (a === pane) break; } return ax; };
        for (const [sel, paneSel] of Object.entries(AREAS)) {
          const area = document.querySelector(sel), pane = document.querySelector(paneSel); if (!area || !pane || !vis(area)) continue;
          const P = pane.getBoundingClientRect(); if (P.width < 50) continue;   /* a closed pane (the 1100 chat pop-over) has nothing to check */
          for (const e of area.querySelectorAll("button, a, input, textarea, select, [role=button], [data-go], [data-aq]")) {
            if (!vis(e)) continue;
            const ax = scrollAxes(e, pane), r = e.getBoundingClientRect(), L = Math.max(P.left, 0) - 1, R = Math.min(P.right, vw) + 1, T = Math.max(P.top, 0) - 1, B = Math.min(P.bottom, vh) + 1;
            if ((!ax.x && (r.left < L || r.right > R)) || (!ax.y && (r.top < T || r.bottom > B)))
              out.push(`${sel} ${(e.className || e.tagName).toString().split(" ")[0]}「${(e.textContent || e.title || e.getAttribute("aria-label") || "").trim().slice(0, 18)}」 ${Math.round(r.left)}-${Math.round(r.right)} pane ${Math.round(P.left)}-${Math.round(P.right)}`);
          }
        }
        return out;
      }, AREAS);
      c.check(`${label}: every header / toolbar control inside its pane`, !bad.length, bad.slice(0, 8));
    };
    /* drag a grip by mouse to the x that gives the wanted width */
    const drag = async (grip, x) => { const g = p.locator(grip).first(); await g.waitFor({ state: "visible", timeout: 6000 }); const b = await g.boundingBox();
      await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down(); await p.mouse.move(x, b.y + b.height / 2, { steps: 6 }); await p.mouse.up(); await c.sleep(700); };
    for (const vw of [1440, 1100]) {
      await p.setViewportSize({ width: vw, height: 900 });
      for (const lang of ["en", "zh"]) {
        await p.evaluate(l => { localStorage.setItem("rt.lang", JSON.stringify(l)); localStorage.setItem("rt.chatFold", "false"); localStorage.removeItem("rt.dwWidth"); localStorage.removeItem("dwWidth"); }, lang);
        await p.goto(c.BASE + "/", { waitUntil: "load" });
        await p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 20000 });
        await c.sleep(800);
        await audit(`${vw} ${lang} home, default widths`);
        const chatShown = await p.evaluate(() => { const r = document.querySelector("#right"); return !!r && r.getBoundingClientRect().width > 200; });
        if (chatShown) {
          for (const w of [300, 360, 420, 560, 760]) {
            await drag("#right .ch-grip", vw - w);
            const got = await p.evaluate(() => Math.round(document.querySelector("#right").getBoundingClientRect().width));
            await audit(`${vw} ${lang} chat ${w} (got ${got}) · manager`);
            if (w === 300 || w === 420) {
              await p.evaluate(() => { const b = document.querySelector('#team [data-chat="smith"]'); if (b) b.click(); }); await c.sleep(1200);
              await audit(`${vw} ${lang} chat ${w} · smith DM`);
              if (w === 300) await c.shot(`${vw}-${lang}-chat-min`);
              await p.evaluate(() => { const b = document.querySelector('#team [data-chat="manager"]'); if (b) b.click(); }); await c.sleep(800);
            }
          }
          await p.evaluate(() => { const g = document.querySelector("#right .ch-grip"); if (g) g.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); }); await c.sleep(600);   /* back to 420 */
        } else c.check(`${vw} ${lang} chat column is a pop-over at this width (no grip to drag)`, true);
        /* the item drawer: first card on the side-quest page */
        await p.evaluate(() => App.go("side")); await c.sleep(1500);
        const opened = await p.evaluate(() => { const e = document.querySelector("#pagebody [data-item]"); if (!e) return false; e.click(); return true; });
        if (opened) {
          await c.sleep(1500);
          await audit(`${vw} ${lang} drawer default`);
          await drag("#dw-grip", vw - 200);   /* far right: clamps to the 520 minimum */
          await audit(`${vw} ${lang} drawer min`);
          await drag("#dw-grip", 10);         /* far left: clamps to its maximum */
          await audit(`${vw} ${lang} drawer max`);
          if (lang === "en") await c.shot(`${vw}-drawer-max`);
          await p.evaluate(() => { const g = document.querySelector("#dw-grip"); if (g) g.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
          await p.keyboard.press("Escape"); await c.sleep(600);
        } else c.check(`${vw} ${lang} drawer: a card to open`, false, "no [data-item] on the side page");
      }
    }
  },
};
