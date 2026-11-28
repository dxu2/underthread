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
      /* begin = where the animation's time 0 sits on the document timeline (startTime + delay), read from the animation itself: the event's
         dispatch time lags behind the frame the animation started in, by a whole slow frame on a CI runner */
      box.addEventListener("animationstart", e => { if (!mineEl(e.target)) return;
        const a = e.target.getAnimations().find(x => x.animationName === e.animationName), d = a && a.effect.getTiming().delay;
        __sf.an.push({ n: e.animationName, cls: e.target.className, el: +e.elapsedTime.toFixed(3), at: Math.round(performance.now()),
          delay: a ? Math.round(d) : null, begin: a && a.startTime != null ? Math.round(a.startTime + d) : null }); }, true);
      /* every frame: my bubble's opacity and blur; a second entry shows up as opacity dropping back / blur coming back */
      __sf.op = []; const t0 = performance.now();
      const tick = () => { const e = [...box.querySelectorAll(".msg.me")].find(mineEl); if (e) { const cs = getComputedStyle(e), b = /blur\(([\d.]+)px\)/.exec(cs.filter); __sf.op.push([Math.round(performance.now() - t0), +(+cs.opacity).toFixed(2), b ? +(+b[1]).toFixed(2) : 0]); }
        if (performance.now() - t0 < 3000) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      new MutationObserver(rs => rs.forEach(r => r.addedNodes.forEach(n => { if (mineEl(n)) { __sf.ins++; if (__sf.first == null) __sf.first = Math.round(document.timeline.currentTime); } }))).observe(box, { childList: true });
    }, mine);
    await p.fill(ta, mine);
    if (c.view === "phone") await c.tap("#right .ch-comp .m-send"); else await p.press(ta, "Control+Enter");
    const srv = await c.until(async () => (await c.state()).chat.some(m => m.text === mine), 8000);
    c.check("server has my message", srv);
    await c.until(() => p.evaluate(() => !document.querySelector("#right .ch-msgs .msg.pend")), 10000); await c.sleep(1500);
    const sf = await p.evaluate(() => window.__sf);
    /* each start's begin on the document timeline (startTime + delay; at - elapsed only if the animation is gone): a redraw that carries on lands on the first begin; a restart begins later.
       When the server answers within a frame (fixture board) the first node is replaced before it starts, so the first event may be a redraw. */
    const entry = sf.an.filter(a => /^(rise|bub-in)$/.test(a.n)), begins = entry.map(a => a.begin != null ? a.begin : a.at - a.el * 1000);
    /* fresh = starts from 0 (no negative delay): only the very first draw may do that, every redraw carries on (.m-ago). The begins
       agree within a frame or two (the carried delay is counted from when the first draw was made, the animation starts a frame later). */
    /* the carried delay is fixed when the redraw is built and the animation starts on the next frame: a slow frame there (CI WebKit, ~120 ms)
       lands the begin that much later; a restart shows as fresh > 1 and as opacity dropping back (next check), so allow the longest frame seen */
    const spread = Math.max(...begins) - Math.min(...begins), late = Math.min(...begins) - sf.first, fresh = entry.filter(a => a.delay === 0).length;
    let gap = 0; for (let i = 1; i < sf.op.length; i++) gap = Math.max(gap, sf.op[i][0] - sf.op[i - 1][0]);
    c.check("my bubble's entry animation begins once (a redraw only carries on)", entry.length >= 1 && fresh <= 1 && spread < Math.max(60, gap + 30) && late < 150, { fresh, spread, gap, late, first: sf.first, an: sf.an });
    let back = 0; for (let i = 1; i < sf.op.length; i++) back = Math.max(back, sf.op[i - 1][1] - sf.op[i][1], sf.op[i][2] - sf.op[i - 1][2]);
    c.check("opacity never drops back and blur never returns (per frame)", back < 0.05, { back, frames: sf.op.length, op: sf.op.filter((x, i) => i % 3 === 0).slice(0, 30) });
    c.check("server copy is on screen, no pending bubble left", await p.evaluate(t => [...document.querySelectorAll("#right .ch-msgs .msg.me:not(.pend)")].some(e => e.textContent.includes(t)), mine));
    await c.shot("after", "#right .ch-msgs");
  },
};
