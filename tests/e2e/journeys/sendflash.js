/* t-chat-send-flash: after a send, my bubble's entry animation must play exactly once (optimistic bubble -> ok -> server copy).
 * Counts animationstart on the .msg.me bubble holding the text and samples its opacity / blur every frame.
 *   node tests/e2e/drive.js run tests/e2e/journeys/sendflash.js --out work/<item>/verify/<run> --engines chromium,webkit */
const RUN = Date.now().toString(36);
module.exports = {
  views: ["desk", "phone"],
  hash: view => (view === "desk" ? "#dm=manager" : ""),
  async run(c) {
    const p = c.p, mine = `发送闪测试 ${RUN} ${c.view}`;
    if (c.view === "phone") { await c.tap("#tabbar button[data-k=dms]"); await c.sleep(800); await c.tap('[data-conv="manager"] .cl-p'); await c.sleep(1200); }
    const ta = "#right .ch-comp textarea";
    c.check("composer visible", await c.until(() => p.evaluate(s => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0; }, ta), 8000));
    await p.evaluate(t => {
      const box = document.querySelector("#right .ch-msgs"); window.__sf = { an: [], ins: 0 };
      const mineEl = e => e && e.classList && e.classList.contains("msg") && (e.textContent || "").includes(t);
      box.addEventListener("animationstart", e => { if (mineEl(e.target)) __sf.an.push({ n: e.animationName, cls: e.target.className, el: +e.elapsedTime.toFixed(3), at: Math.round(performance.now()) }); }, true);
      /* every frame: my bubble's opacity and blur; a second entry shows up as opacity dropping back / blur coming back */
      __sf.op = []; const t0 = performance.now();
      const tick = () => { const e = [...box.querySelectorAll(".msg.me")].find(mineEl); if (e) { const cs = getComputedStyle(e), b = /blur\(([\d.]+)px\)/.exec(cs.filter); __sf.op.push([Math.round(performance.now() - t0), +(+cs.opacity).toFixed(2), b ? +(+b[1]).toFixed(2) : 0]); }
        if (performance.now() - t0 < 3000) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      new MutationObserver(rs => rs.forEach(r => r.addedNodes.forEach(n => { if (mineEl(n)) __sf.ins++; }))).observe(box, { childList: true });
    }, mine);
    await p.fill(ta, mine);
    if (c.view === "phone") await c.tap("#right .ch-comp .m-send"); else await p.press(ta, "Control+Enter");
    const srv = await c.until(async () => (await c.state()).chat.some(m => m.text === mine), 8000);
    c.check("server has my message", srv);
    await c.until(() => p.evaluate(() => !document.querySelector("#right .ch-msgs .msg.pend")), 10000); await c.sleep(1500);
    const sf = await p.evaluate(() => window.__sf);
    /* each start's implied begin (at - elapsed): a redraw that carries on lands on the first begin; a restart begins later.
       When the server answers within a frame (fixture board) the first node is replaced before it starts, so the first event may be a redraw. */
    const entry = sf.an.filter(a => /^(rise|bub-in)$/.test(a.n)), begins = entry.map(a => a.at - a.el * 1000);
    c.check("my bubble's entry animation begins once (a redraw only carries on)", entry.length >= 1 && entry[0].el < 0.05 && Math.max(...begins) - Math.min(...begins) < 60, sf.an);
    let back = 0; for (let i = 1; i < sf.op.length; i++) back = Math.max(back, sf.op[i - 1][1] - sf.op[i][1], sf.op[i][2] - sf.op[i - 1][2]);
    c.check("opacity never drops back and blur never returns (per frame)", back < 0.05, { back, frames: sf.op.length, op: sf.op.filter((x, i) => i % 3 === 0).slice(0, 30) });
    c.check("server copy is on screen, no pending bubble left", await p.evaluate(t => [...document.querySelectorAll("#right .ch-msgs .msg.me:not(.pend)")].some(e => e.textContent.includes(t)), mine));
    await c.shot("after", "#right .ch-msgs");
  },
};
