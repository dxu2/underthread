/* t-oss-monitor-check: the steward looks online (fresh heartbeat) but your oldest message has waited 10+ minutes, which is
 * what a steward whose Claude Code has no Monitor tool looks like. The ticker says so with the fix (claude update, ./start)
 * and opens the troubleshooting guide on a tap; the rail and the chat header say "not listening?". Acking the entry clears it.
 *   node tests/e2e/drive.js run tests/e2e/journeys/monitorhint.js --out work/<item>/verify/<run> --views desk,phone
 */
const fs = require("fs");
const path = require("path");
const ID = "in-e2e-monitorhint";
const tickerHas = (p, re, ms) => p.waitForFunction(r => { const m = document.querySelector("#ticker .msg"); return !!m && new RegExp(r).test(m.textContent); }, re, { timeout: ms, polling: 500 }).then(() => true, () => false);
module.exports = {
  views: ["desk", "phone"],
  hash: () => "#page=review",
  async run(c) {
    const p = c.p, desk = c.view === "desk";
    c.su("set-agent", "manager", "--status", "working", "--activity", "Watching the inbox");   // online by heartbeat
    const pend = JSON.parse("[" + c.su("inbox-pending").trim().split("\n").filter(Boolean).join(",") + "]");
    if (pend.length) c.su("inbox-ack", ...pend.map(e => e.id));
    const t = new Date(Date.now() - 12 * 60e3).toISOString().replace(/\.\d+Z$/, "+00:00");
    fs.appendFileSync(path.join(c.SCRATCH, "inbox.jsonl"), JSON.stringify({ kind: "manager", text: "hello?", id: ID + "-" + c.view, t }) + "\n");
    await p.evaluate(() => { const s = (k, v) => localStorage.setItem("rt." + k, JSON.stringify(v)); s("lang", "en"); });
    await p.reload({ waitUntil: "load" });
    await p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 15000 });
    const meta = await p.evaluate(() => ({ old: App.ST.meta.inbox_oldest, n: App.ST.meta.inbox_unacked }));
    c.check("meta.inbox_oldest is the 12-minute-old entry", meta.old === t && meta.n === 1, meta);
    const seen = await tickerHas(p, "Unread for 1[2-3] min: steward lacks Monitor\\? Fix: claude update, then \\./start", 30000);
    c.check("ticker: unread 12 min, Monitor, claude update + ./start", seen, await p.textContent("#ticker").catch(() => null));
    if (seen) await c.shot("ticker", "#ticker");
    if (desk) {
      const st = await p.evaluate(() => { const e = document.querySelector('#team .team-i[data-chat="manager"] .st'); return e && e.textContent.trim(); });
      c.check("rail: steward says not listening?", st === "not listening?", st);
      const hd = await p.evaluate(() => { const e = document.querySelector(".ch-who .off"); return e && e.textContent.trim(); });
      c.check("chat header: not listening?", /not listening\?/.test(hd || ""), hd);
      if (seen && await tickerHas(p, "lacks Monitor", 15000)) {
        const pop = p.waitForEvent("popup", { timeout: 5000 }).catch(() => null);
        await p.click("#ticker .msg");
        const w = await pop; const url = w ? w.url() : null; if (w) await w.close().catch(() => { });
        c.check("tap opens the troubleshooting guide", !!url && /troubleshooting\.md#the-steward-is-online-but-never-picks-up-what-you-type/.test(url), url);
      }
      await c.shot("desk");
      await p.evaluate(() => localStorage.setItem("rt.lang", JSON.stringify("zh")));
      await p.reload({ waitUntil: "load" });
      await p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 15000 });
      const zh = await tickerHas(p, "管家 1[2-3] 分钟没接话：可能缺 Monitor 工具。修法：claude update，再跑 \\./start", 30000);
      const zst = await p.evaluate(() => { const e = document.querySelector('#team .team-i[data-chat="manager"] .st'); return e && e.textContent.trim(); });
      c.check("zh: ticker line and rail 没在听？", zh && zst === "没在听？", { zh, zst });
      if (zh) await c.shot("zh-ticker", "#ticker");
    }
    c.su("inbox-ack", ID + "-" + c.view);
    const gone = await p.waitForFunction(() => !(App.ST.meta.inbox_unacked > 0) && !/Monitor/.test((document.querySelector("#ticker") || {}).textContent || ""), null, { timeout: 40000, polling: 500 }).then(() => true, () => false);
    c.check("acked: the hint goes away", gone, await p.evaluate(() => App.ST.meta.inbox_unacked));
  },
};
