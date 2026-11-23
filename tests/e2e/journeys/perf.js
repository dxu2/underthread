/* t-perf-smooth F0: performance gate. Seven scenarios per engine x view, each run PERF_RUNS times (default 3; CI 1), median per metric,
 * compared with tests/e2e/perf-budget.json. A metric more than 15 % over its budget (plus a small absolute slack) fails.
 *   node tests/e2e/drive.js run tests/e2e/journeys/perf.js --out work/<item>/verify/perf --engines chromium,webkit
 * Which engine measures what (headless Chromium's rAF cadence is bimodal, ~10 / ~27 ms, so its frame percentiles are noise):
 *   WebKit   frame p99 and frames over 34 ms (rAF intervals while the scenario runs)
 *   Chromium long tasks (count > 50 ms and the longest), style recalcs per second (CDP Performance), script time; phone runs with 4x CPU throttle
 *   both     open_ms = synchronous time of App.openItem(); first load JS + CSS request count
 * Deterministic checks (also in CI): JS + CSS requests on a cold load, and once the page is idle (html[data-idle]) no infinite animation
 * still runs and Chromium does no style recalc. Machine-dependent budgets are skipped when CI is set (Linux runners differ from a Mac).
 * Budgets only move down. PERF_UPDATE=1 writes measured medians that are LOWER than the stored ones (PERF_UPDATE=force: any).
 * Needs a board with at least one card that has a thread; works on the fixture board and on a copy of your own state. */
const fs = require("fs"), path = require("path");
const BUDGET = path.join(__dirname, "..", "perf-budget.json");
const CI = !!process.env.CI, RUNS = +(process.env.PERF_RUNS || (CI ? 1 : 3));
const med = a => { const s = a.filter(x => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const pct = (a, q) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(1); };
/* slack on top of the 15 %: counts may be off by one, times by 2 ms */
const SLACK = { p99: 2, over33: 1, longtasks: 1, lt_max: 5, style_per_s: 2, script_ms: 5, open_ms: 2, reqs: 0, idle_style_per_s: 0.5, idle_running: 0 };
const PICK = { webkit: ["p99", "over33", "open_ms"], chromium: ["longtasks", "lt_max", "style_per_s", "open_ms"] };

const INIT = () => {
  window.__fr = { on: false, t: [], last: 0 };
  const loop = ts => { const f = window.__fr; if (f.on) { if (f.last) f.t.push(ts - f.last); f.last = ts; } requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  window.__lt = [];
  try { new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push(e.duration))).observe({ type: "longtask", buffered: true }); } catch (_) { }
};

module.exports = {
  views: ["desk", "phone"],
  launch: engine => engine === "chromium" && !CI ? { channel: "chromium" } : undefined,   /* real GPU (the default headless shell is software-rendered) */
  async run(c) {
    const p = c.p, tag = `${c.engine}-${c.view}`, phone = c.view === "phone", chromium = c.engine === "chromium";
    const B = JSON.parse(fs.readFileSync(BUDGET, "utf8")), tol = B.tolerance || 0.15;
    /* 1. cold load: JS + CSS requests (drive.js loaded this page in a fresh context) */
    const reqs = await p.evaluate(() => performance.getEntriesByType("resource").filter(r => /\.(m?js|css)(\?|$)/.test(r.name.split("#")[0])).length);
    /* the user's everyday look: Underthread + leather, Chinese */
    await p.addInitScript(INIT);
    await p.evaluate(() => { const s = (k, v) => localStorage.setItem("rt." + k, JSON.stringify(v)); s("lang", "zh"); s("ut", "ut"); s("texture", "leather1"); });
    await p.reload({ waitUntil: "load" });
    await p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash") && window.__fr, null, { timeout: 30000 });
    await c.sleep(1500);
    let cdp = null;
    if (chromium) { cdp = await p.context().newCDPSession(p); await cdp.send("Performance.enable"); if (phone) await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 }); }
    const met = async () => cdp ? Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(x => [x.name, x.value])) : {};
    /* board-independent picks: the three cards with the longest stream, two DM partners, one agent to poke */
    const pick = await p.evaluate(() => {
      const it = (App.ST.items || []).filter(i => !i.archived).map(i => [i.id, (i.thread || []).length + (i.versions || []).length * 3 + (i.draft ? 3 : 0)]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]);
      const ag = Object.keys(App.ST.agents || {}).filter(k => k !== "manager" && App.ST.agents[k].enabled !== false);
      return { items: it, dms: ag.slice(0, 2), poke: ag[0] || "manager" };
    });
    const st0 = (await c.state()).agents[pick.poke] || {};
    const home = async () => { if (phone) await p.evaluate(() => { const e = document.querySelector("#tabbar button[data-k=home]"); if (e && e.getClientRects().length) e.click(); else App.closeItem(); }); else await p.evaluate(() => App.go("review")); await c.sleep(900); };
    async function scen(fn) {
      await c.sleep(600);
      const a = await met();
      await p.evaluate(() => { window.__fr.on = true; window.__fr.t = []; window.__fr.last = 0; window.__lt.length = 0; window.__open = []; });
      const t0 = Date.now(); await fn(); const dur = (Date.now() - t0) / 1000;
      const f = await p.evaluate(() => { window.__fr.on = false; return { t: window.__fr.t, lt: window.__lt.slice(), open: window.__open || [] }; });
      const z = await met();
      const r = { p99: pct(f.t, .99), over33: f.t.filter(x => x > 34).length, open_ms: f.open.length ? +Math.max(...f.open).toFixed(1) : null };
      if (chromium) Object.assign(r, { longtasks: f.lt.length, lt_max: f.lt.length ? Math.round(Math.max(...f.lt)) : 0,
        style_per_s: +((z.RecalcStyleCount - a.RecalcStyleCount) / dur).toFixed(1), script_ms: Math.round((z.ScriptDuration - a.ScriptDuration) * 1000) });
      return r;
    }
    /* phone: closing through the back button brings the tab bar back (App.closeItem() alone leaves it hidden) */
    const close = () => p.evaluate(() => { const b = [...document.querySelectorAll("#drawer .dw-back")].find(x => x.getClientRects().length); if (b && matchMedia("(max-width: 760px)").matches) b.click(); else App.closeItem(); });
    const openTimed = id => p.evaluate(id => { const t0 = performance.now(); App.openItem(id); (window.__open = window.__open || []).push(performance.now() - t0); }, id);
    const S = {
      home_idle: async () => { await c.sleep(8000); },
      page_transitions: async () => {
        for (let i = 0; i < 3; i++) {
          if (phone) { await c.tap("#tabbar button[data-k=quests]"); await c.sleep(1100); await c.tap("#tabbar button[data-k=home]"); await c.sleep(1100); }
          else { await p.click("#nav [data-go=main]"); await c.sleep(1100); await p.click("#nav [data-go=review]"); await c.sleep(1100); }
        }
      },
      detail_open_close: async () => { for (const id of pick.items) { await openTimed(id); await c.sleep(1300); await close(); await c.sleep(900); } },
      detail_scroll: async () => {
        await openTimed(pick.items[0]); await c.sleep(1200);
        if (phone && cdp) { for (let i = 0; i < 4; i++) await cdp.send("Input.synthesizeScrollGesture", { x: 195, y: 600, yDistance: -500, speed: 1500, gestureSourceType: "touch" }); }
        else if (phone) await p.evaluate(() => new Promise(ok => { const sc = document.querySelector("#drawer .dw-scroll"); let n = 0; const f = () => { if (!sc || ++n > 80) return ok(); sc.scrollTop -= 25; requestAnimationFrame(f); }; requestAnimationFrame(f); }));   /* mobile WebKit has no wheel: 80 frames of 25px */
        else { await p.mouse.move(phone ? 195 : 1100, 450); for (let i = 0; i < 30; i++) { await p.mouse.wheel(0, 120); await c.sleep(30); } }
        await c.sleep(500); await close(); await c.sleep(800);
      },
      chat_dm: async () => {
        if (phone) {
          /* a tap, or a click on the first visible match when something sits over it for a moment */
          const tapV = async sel => { try { await p.locator(sel).first().tap({ timeout: 3000 }); } catch (_) { await p.evaluate(s => { const e = [...document.querySelectorAll(s)].find(x => x.getClientRects().length); if (e) e.click(); }, sel); } };
          for (const r of pick.dms) {
            await tapV("#tabbar button[data-k=dms]"); await c.sleep(900);
            await tapV(`[data-conv="${r}"] .cl-p`); await c.sleep(1300);
            await tapV(".cl-back"); await c.sleep(900);
          }
          await home();
        } else for (const r of [...pick.dms, "manager"]) { await p.evaluate(r => App.setChat(r), r); await c.sleep(1300); }
      },
      poll_home: async () => { for (let i = 0; i < 3; i++) { c.su("set-agent", pick.poke, "--status", i % 2 ? "idle" : "working", "--activity", "perf gate " + i); await c.sleep(3000); } },
      poll_detail: async () => {
        await openTimed(pick.items[0]); await c.sleep(1200); await p.evaluate(() => { window.__open = []; });
        for (let i = 0; i < 3; i++) { c.su("set-agent", pick.poke, "--status", i % 2 ? "idle" : "working", "--activity", "perf gate " + i); await c.sleep(3000); }
        await close(); await c.sleep(800);
      },
    };
    const runs = {};
    try {
      for (let k = 0; k < RUNS; k++) {
        await home();
        for (const [name, fn] of Object.entries(S)) { const r = await scen(fn); (runs[name] = runs[name] || []).push(r); c.note(`run ${k + 1} ${name} ${JSON.stringify(r)}`); }
      }
    } finally {   /* put the poked agent back the way it was */
      try { c.su("set-agent", pick.poke, "--status", st0.status || "idle", ...(st0.item ? ["--item", st0.item] : []), "--activity", st0.activity || ""); } catch (e) { c.note("restore agent failed " + e); }
    }
    /* 2. idle: html[data-idle] must leave no infinite animation running and (Chromium) no style recalc. [data-noidle] parts (the home widget's
       working patch, call rings) keep moving on purpose (user, 11-11): they are left out of the list, and their few steps/s are what the recalc budget allows. */
    await home(); await c.sleep(800);
    await p.evaluate(() => FX.idle.sleep()); await c.sleep(1500);
    /* the recalc count is read with the exempt parts held for those 3 s: one steps() sprite alone restyles every frame in Chromium (~90/s), which
       would hide anything else that keeps restyling. They are listed separately (noidle_running) so their cost stays visible. */
    const noidle = await p.evaluate(() => document.getAnimations().filter(a => { try { return a.playState === "running" && a.effect.target.closest("[data-noidle]"); } catch (_) { return false; } }).length);
    await p.evaluate(() => { const s = document.createElement("style"); s.id = "__perf_hold"; s.textContent = "[data-noidle], [data-noidle] *, [data-noidle] *::before, [data-noidle] *::after { animation-play-state: paused !important }"; document.head.appendChild(s); });
    await c.sleep(300);
    const i0 = await met(); await c.sleep(3000); const i1 = await met();
    await p.evaluate(() => { const s = document.getElementById("__perf_hold"); if (s) s.remove(); });
    const idleLeft = await p.evaluate(() => document.getAnimations().filter(a => { try { const tm = a.effect.getComputedTiming(); return tm.iterations === Infinity && a.playState === "running" && getComputedStyle(a.effect.target, a.effect.pseudoElement).animationPlayState !== "paused" && !(a.animationName || "").startsWith("vc-") && !a.effect.target.closest("[data-noidle]"); } catch (_) { return false; } })
      .map(a => (a.animationName || "waapi") + " " + (a.effect.target.getAttribute("class") || a.effect.target.tagName)));
    await p.evaluate(() => FX.idle.wake());
    const M = {}; for (const [n, rs] of Object.entries(runs)) { M[n] = {}; for (const m of Object.keys(rs[0])) M[n][m] = med(rs.map(r => r[m])); }
    M.load = { reqs }; M.idle = { idle_running: idleLeft.length, noidle_running: noidle, ...(chromium ? { idle_style_per_s: +((i1.RecalcStyleCount - i0.RecalcStyleCount) / 3).toFixed(1) } : {}) };
    c.note("medians " + JSON.stringify(M));
    /* 3. compare */
    const det = B.deterministic || {};
    c.check("idle: no infinite animation left running", idleLeft.length === 0, idleLeft.slice(0, 8));
    if (chromium) c.check("idle: no style recalc while idle", M.idle.idle_style_per_s <= (det.idle_style_per_s || 0) + SLACK.idle_style_per_s, M.idle);
    if (det.reqs != null) c.check(`cold load JS + CSS requests <= ${det.reqs}`, reqs <= Math.ceil(det.reqs * (1 + tol)), { reqs });
    const bud = (B.local || {})[tag] || {}, out = [];
    if (CI) c.note("CI: machine-dependent budgets skipped");
    else for (const [n, ms] of Object.entries(bud)) for (const [m, lim] of Object.entries(ms)) {
      const v = (M[n] || {})[m]; if (v == null || lim == null) continue;
      const max = lim * (1 + tol) + (SLACK[m] || 0), ok = v <= max;
      out.push(`${n}.${m} ${v} / ${lim}${ok ? "" : ` FAIL +${lim ? Math.round((v / lim - 1) * 100) : "∞"}%`}`);
      c.check(`${n}.${m} within budget`, ok, { value: v, budget: lim, max: +max.toFixed(1) });
    }
    if (out.length) c.note("budget " + out.join(" · "));
    if (process.env.PERF_UPDATE && !CI) {   /* only lower (or force) */
      const cur = JSON.parse(fs.readFileSync(BUDGET, "utf8")); cur.local = cur.local || {}; const t = cur.local[tag] = cur.local[tag] || {};
      for (const [n, ms] of Object.entries(M)) { if (n === "load" || n === "idle") continue;
        for (const m of PICK[c.engine]) { const v = ms[m]; if (v == null) continue; t[n] = t[n] || {}; if (process.env.PERF_UPDATE === "force" || t[n][m] == null || v < t[n][m]) t[n][m] = v; } }
      fs.writeFileSync(BUDGET, JSON.stringify(cur, null, 1) + "\n"); c.note("budget updated for " + tag);
    }
    fs.writeFileSync(path.join(path.dirname(await c.shot("end")), "perf.json"), JSON.stringify({ tag, runs, medians: M }, null, 1));
  },
};
