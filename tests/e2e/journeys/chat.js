/* Chat with the steward on the fixture board: send from the composer, receive a line written server-side, without a reload.
 *   node tests/e2e/drive.js run tests/e2e/journeys/chat.js --out <dir> [--views desk,phone] [--engines chromium,webkit]
 * desk: right panel composer (Control+Enter sends). phone: 私信 tab -> manager conversation -> send button.
 * Scratch has no steward session, so nothing answers; the receive half writes with stateutil say-mgr. */
const RUN = Date.now().toString(36);
module.exports = {
  views: ["desk", "phone"],
  hash: view => (view === "desk" ? "#dm=manager" : ""),
  async run(c) {
    const p = c.p, mine = `e2e hello ${RUN} ${c.view}`, theirs = `e2e reply ${RUN} ${c.view}`;
    if (c.view === "phone") {
      await c.tap("#tabbar button[data-k=dms]"); await c.sleep(800);
      await c.tap('[data-conv="manager"] .cl-p'); await c.sleep(900);
    }
    const ta = "#right .ch-comp textarea";
    c.check("composer visible", await c.until(() => p.evaluate(s => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0; }, ta), 8000));
    await c.shot("thread");
    await p.fill(ta, mine);
    if (c.view === "phone") await c.tap("#right .ch-comp .m-send"); else await p.press(ta, "Control+Enter");
    const bubble = await c.until(() => p.evaluate(t => [...document.querySelectorAll("#right .ch-msgs .me")].some(e => (e.textContent || "").includes(t)), mine), 8000);
    c.check("my message shows as my bubble", bubble);
    const srv = await c.until(async () => (await c.state()).chat.some(m => m.text === mine), 8000);
    c.check("server: my message in chat", srv);
    c.su("say-mgr", theirs);
    const got = await c.until(() => p.evaluate(t => (document.querySelector("#right .ch-msgs").textContent || "").includes(t), theirs), 10000);
    c.check("steward line arrives by long poll, no reload", got);
    await c.shot("after", "#right");
  },
};
