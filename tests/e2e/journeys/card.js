/* Card basics on the fixture board: open a review card from home, comment from the drawer, approve another (held 4.5 s, then POSTs).
 *   node tests/e2e/drive.js run tests/e2e/journeys/card.js --out <dir> [--views desk,phone] [--engines chromium,webkit]
 * Makes its own cards per view with stateutil in the scratch copy (e2e-c-<view>, e2e-a-<view>), so it also runs on a copy of your own state.
 * Checks: drawer shows the draft; the comment lands in the thread on the server and the stage leaves review; approve moves the card on. */
const RUN = Date.now().toString(36);
module.exports = {
  views: ["desk", "phone"],
  hash: () => "",
  async run(c) {
    const p = c.p, cid = `e2e-c-${c.view}-${RUN}`, aid = `e2e-a-${c.view}-${RUN}`;
    for (const [id, title] of [[cid, "E2E comment card"], [aid, "E2E approve card"]])
      c.su("upsert-item", "--id", id, "--title", title, "--who", "writer", "--owner", "writer", "--category", "side", "--kind", "deliverable",
        "--stage", "review", "--draft", `Draft body: the quick brown fox (${title}).`, "--label", "v1");
    const item = async id => (await c.state()).items.find(i => i.id === id);
    const visible = id => c.until(() => p.evaluate(id => { const e = document.querySelector(`[data-item="${id}"]`); return !!e && e.getClientRects().length > 0; }, id), 12000);
    if (c.view === "phone") { await c.tap("#tabbar button[data-k=home]"); await c.sleep(600); }
    c.check("new review card shows on home", await visible(cid));
    await c.shot("home");

    await c.tap(`[data-item="${cid}"]`);
    const open = await c.until(() => p.evaluate(id => { const d = document.querySelector("#drawer"); return !!d && d.getClientRects().length > 0 && (d.textContent || "").includes("Draft body: the quick brown fox (E2E comment card)"); }, cid), 8000);
    c.check("drawer opens with the draft", open);
    await c.shot("drawer", "#drawer");

    const text = `e2e comment ${RUN} ${c.view}`;
    await p.fill("#drawer .composer textarea", text);
    await p.press("#drawer .composer textarea", "Control+Enter");
    const shown = await c.until(() => p.evaluate(t => (document.querySelector("#drawer").textContent || "").includes(t), text), 8000);
    c.check("comment shows in the drawer thread", shown);
    const srv = await c.until(async () => { const it = await item(cid); return it && it.thread.some(e => e.text === text) && it; }, 8000);
    c.check("server: comment in the thread, stage left review", !!srv && srv.stage !== "review", srv && srv.stage);
    await c.shot("commented", "#drawer");

    await p.keyboard.press("Escape"); await c.sleep(700);
    if (c.view === "phone") { const x = p.locator("#drawer .dw-x, #drawer .dw-back").first(); if (await x.isVisible().catch(() => false)) await x.tap(); await c.sleep(700); await c.tap("#tabbar button[data-k=home]"); await c.sleep(700); }
    c.check("approve card shows on home", await visible(aid));
    await c.tap(`[data-item="${aid}"]`); await c.sleep(900);
    const ok = await c.until(() => p.evaluate(() => { const b = document.querySelector('#drawer .dw-acts .ab.ok[data-act="approve"]'); return !!b && b.getClientRects().length > 0; }), 8000);
    c.check("approve button in the drawer", ok);
    if (ok) {
      await c.tap('#drawer .dw-acts .ab.ok[data-act="approve"]');
      const moved = await c.until(async () => { const it = await item(aid); return it && it.stage !== "review" && it; }, 12000);
      c.check("server: approve moved the card out of review", !!moved, moved && moved.stage);
      await c.shot("approved");
    }
  },
};
