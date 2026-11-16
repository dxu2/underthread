/* t-oss-gen-s4: the 招聘市场 on a crew with no HR. Every card offers 「先请 HR」 instead of a greyed-out 面试; the 整队预设 bar
 * above the category chips lists presets/ (classic, content-zh); a preset opens a sheet with the crew after, who leaves and the
 * tools/preset.py --dry output, and Cancel changes nothing. Desk only: 先请 HR hires hr from templates/roles/hr (面试 opens), then
 * Switch applies classic (roster = the classic seven, make_agents ran).
 *   node tests/e2e/drive.js run tests/e2e/journeys/market.js --out work/<item>/verify/<run> --engines chromium,webkit
 * Fixture-safe: every view starts from roster.example.json minus hr, written into the scratch copy; cleanup removes roster.json and rebuilds the agent files. */
const fs = require("fs"), path = require("path"), cp = require("child_process");
const RO = S => path.join(S, "roster.json");
function noHr(S) {
  const ex = JSON.parse(fs.readFileSync(path.join(S, "roster.example.json"), "utf8"));
  ex.roles = ex.roles.filter(r => r.id !== "hr");
  fs.writeFileSync(RO(S), JSON.stringify(ex, null, 2) + "\n");
  cp.execFileSync("python3", ["make_agents.py"], { cwd: S, stdio: "ignore" });   /* an older crew's agent files match its roster */
  return ex.roles.map(r => r.id);
}
const ready = async c => { await c.p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 15000 }); await c.sleep(1200); };
const ids = S => JSON.parse(fs.readFileSync(RO(S), "utf8")).roles.map(r => r.id);
module.exports = {
  views: ["desk", "phone"],
  hash: () => "#page=market",
  async run(c) {
    const p = c.p, S = c.SCRATCH;
    const crew = noHr(S);
    await c.until(async () => { const st = await c.state(); return !st.agents.hr; }, 10000);
    await ready(c);   /* no reload: WebKit logs every aborted poll as a page error; the long poll brings the smaller roster */
    await p.waitForFunction(() => !App.ST.agents.hr, null, { timeout: 30000 });
    await c.go("market");
    await p.evaluate(() => Market.load(true));
    await p.waitForSelector(".mk-grid .mk-card [data-mk-hrfirst]", { timeout: 15000 }); await c.sleep(500);
    const pre = await p.evaluate(() => [...document.querySelectorAll(".mk-pre [data-mk-pre]")].map(b => ({ k: b.dataset.mkPre, on: b.classList.contains("on"), t: b.textContent })));
    c.check("整队预设 bar lists classic and content-zh, none current", pre.length === 2 && pre.some(x => x.k === "classic") && pre.some(x => x.k === "content-zh") && !pre.some(x => x.on), pre);
    const bt = await p.evaluate(() => ({ cards: document.querySelectorAll(".mk-card").length, first: document.querySelectorAll("[data-mk-hrfirst]").length, iv: document.querySelectorAll("[data-mk-iv]").length,
      hrCard: !!document.querySelector('[data-mk="hr"]'), over: document.documentElement.scrollWidth > innerWidth }));
    c.check("no HR: every card offers 先请 HR, no 面试 button, HR is not a market card", bt.cards > 0 && bt.first === bt.cards && bt.iv === 0 && !bt.hrCard, bt);
    c.check("no sideways overflow", !bt.over, bt);
    await c.shot("market-no-hr");
    await c.tap('[data-mk-pre="classic"]');
    await p.waitForFunction(() => { const t = document.querySelector("#modal [data-plan]"); return t && t.textContent.trim() !== "…"; }, null, { timeout: 15000 });
    const sh = await p.evaluate(() => { const m = document.querySelector("#modal"); return { plan: m.querySelector("[data-plan]").textContent, ok: !m.querySelector("[data-ok]").disabled,
      roles: m.querySelectorAll(".mk-pre-r:not(.out)").length, out: [...m.querySelectorAll(".mk-pre-r.out")].map(e => e.textContent) }; });
    c.check("preset sheet: dry run shown, Switch enabled, the classic seven listed", /would replace roster\.json/.test(sh.plan) && sh.ok && sh.roles === 7, sh);
    await c.shot("preset-sheet");
    await c.tap("#modal [data-x]"); await c.sleep(600);
    c.check("Cancel leaves roster.json alone", JSON.stringify(ids(S)) === JSON.stringify(crew), ids(S));
    if (c.view !== "desk") return;
    await p.click('.mk-card [data-mk-hrfirst]');
    await c.until(async () => { const st = await c.state(); return st.agents.hr && st.agents.hr.enabled !== false; }, 60000);
    await p.waitForSelector(".mk-card [data-mk-iv]", { timeout: 15000 });
    const after = await p.evaluate(() => ({ first: document.querySelectorAll("[data-mk-hrfirst]").length, iv: document.querySelectorAll("[data-mk-iv]").length, hrl: !!document.querySelector(".mk-hrl") }));
    c.check("先请 HR: hr is on the roster, every card now has 面试 and the HR line", ids(S).includes("hr") && after.first === 0 && after.iv > 0 && after.hrl, after);
    c.check("HR has an agent file", fs.existsSync(path.join(S, ".claude", "agents", "rover-hr.md")) || fs.readdirSync(path.join(S, ".claude", "agents")).some(f => /hr/.test(f)));
    await c.shot("after-hire-hr");
    await c.tap('[data-mk-pre="classic"]');
    await p.waitForFunction(() => { const b = document.querySelector("#modal [data-ok]"); return b && !b.disabled; }, null, { timeout: 15000 });
    const leave = await p.evaluate(() => [...document.querySelectorAll("#modal .mk-pre-r.out")].length);
    c.check("with HR on the team the sheet says HR leaves", leave >= 1, leave);
    await c.tap("#modal [data-ok]");
    await p.waitForFunction(() => { const b = document.querySelector("#modal [data-ok]"); return b && b.hidden; }, null, { timeout: 60000 });
    const res = await p.evaluate(() => document.querySelector("#modal [data-plan]").textContent);
    c.check("Switch applied classic: roster = the seven, undo command shown", JSON.stringify(ids(S).sort()) === JSON.stringify(["artist", "director", "manager", "ops", "scout", "smith", "writer"]) && /undo: python3 tools\/bak\.py restore preset-/.test(res), { ids: ids(S), res: res.slice(-300) });
    await c.until(async () => { const st = await c.state(); return !!st.agents.writer && !st.agents.hr; }, 15000);
    await c.shot("after-classic");
    await c.tap("#modal [data-x]"); await c.sleep(500);
  },
  async cleanup(o) { try { fs.unlinkSync(RO(o.SCRATCH)); cp.execFileSync("python3", ["make_agents.py"], { cwd: o.SCRATCH, stdio: "ignore" }); } catch (_) {} },
};
