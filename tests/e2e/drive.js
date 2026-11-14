#!/usr/bin/env node
/* Drive the scratch dashboard like a user and keep evidence.
 *
 *   node drive.js run <journey.js> --out <dir> [--views desk,phone] [--engines chromium,webkit] [--theme dark|white]
 *   node drive.js shot "<hash>" --out <dir> [--views desk,phone] [--engines chromium]
 *   node drive.js sheet <out.png> <label=img.png> <label=img.png> ...     (one side-by-side image, labelled)
 *   node drive.js smoke --out <dir> [--engines chromium,webkit]   (default gate: journeys/navall.js, every page + phone tab, 0 page errors)
 *
 * Every view gets its OWN browser (a second page in one browser lags its long poll).
 * Pages load with waitUntil "load" (long poll: "networkidle" never settles), then wait for #ut-splash to go
 * (it eats taps for ~1.5 s). Phone views inject overflow-anchor:none to behave like iOS Safari.
 * Evidence per view: <out>/<engine>-<view>/NN-<name>.png, plus <out>/results.json and <out>/log.txt.
 * Exit code 1 when any check fails or a page throws; 3 when Playwright is missing.
 * Start the server first with tests/e2e/scratch.sh up (fixtures or a copy of your own state; see tests/e2e/README.md).
 */
const fs = require("fs"), path = require("path"), cp = require("child_process");
/* Playwright: $PW (a path to a playwright package) wins; else the copy npm installed next to this file (cd tests/e2e && npm ci). */
function loadPW() {
  if (process.env.PW) return require(process.env.PW);
  try { return require(require.resolve("playwright", { paths: [__dirname] })); }
  catch (e) { console.error("Playwright not found. Run: cd tests/e2e && npm ci && npx playwright install chromium webkit\n(or set PW=/path/to/node_modules/playwright)"); process.exit(3); }
}
const pw = loadPW();
const PORT = process.env.VERIFY_PORT || "8799";
/* known-issues.json: real page errors tracked elsewhere; logged as "known", they do not fail a run */
const KNOWN = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, "known-issues.json"), "utf8")).issues.map(k => ({ re: new RegExp(k.pattern), why: k.why })); } catch (_) { return []; } })();
const known = e => KNOWN.some(k => k.re.test(e));
if (PORT === "8765") { console.error("refuse: 8765 is the live dashboard"); process.exit(2); }
const BASE = `http://127.0.0.1:${PORT}`;
const SCRATCH = process.env.VERIFY_SCRATCH || `/tmp/rt-verify-${PORT}`;
const VIEWS = { desk: { viewport: { width: 1440, height: 900 } }, phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } };

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function state() { const r = await fetch(BASE + "/api/state"); if (!r.ok) throw new Error("state " + r.status); return r.json(); }
/* stateutil against the SCRATCH copy (cwd = scratch, so ROOT = scratch). Never write state.json by hand. */
function su(...a) { return cp.execFileSync("python3", ["stateutil.py", ...a], { cwd: SCRATCH, encoding: "utf8" }); }
async function until(fn, ms = 6000, step = 250) { const t = Date.now(); let v; while (Date.now() - t < ms) { v = await fn(); if (v) return v; await sleep(step); } return v; }

async function openView(engine, view, hash, theme) {
  const b = await pw[engine].launch();
  const o = { ...VIEWS[view] }; if (engine === "firefox") delete o.isMobile;
  const ctx = await b.newContext(o);
  if (theme) await ctx.addInitScript(t => { try { localStorage.setItem("rt.theme", JSON.stringify(t)); } catch (_) { } }, theme);
  if (view === "phone") await ctx.addInitScript(() => document.addEventListener("DOMContentLoaded", () => {
    const s = document.createElement("style"); s.textContent = "*{overflow-anchor:none!important}"; document.head.appendChild(s);
  }));
  const p = await ctx.newPage(), errs = [];
  p.on("pageerror", e => errs.push(String(e)));
  p.on("console", m => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  /* HTTP errors: /work/ and /uploads/ are not copied into scratch, so their 404s (and /api/thumb?p=work/… for them) are expected noise; anything else counts */
  p.on("response", r => { if (r.status() >= 400) { const u = new URL(r.url()); ((/^\/(work|uploads)\//.test(u.pathname) || (u.pathname === "/api/thumb" && /^(work|uploads)\//.test(u.searchParams.get("p") || ""))) && r.status() === 404 ? (errs.skipped = errs.skipped || []) : errs).push(`http ${r.status()} ${u.pathname}`); } });
  await p.goto(BASE + "/" + (hash || ""), { waitUntil: "load" });
  await p.waitForFunction(() => !document.getElementById("ut-splash"), null, { timeout: 15000 }).catch(() => errs.push("splash still up after 15 s"));
  await p.waitForFunction(() => window.App && App.ST && App.ST.meta, null, { timeout: 15000 }).catch(() => errs.push("App.ST never loaded"));
  await sleep(600);
  return { b, ctx, p, errs };
}
/* finish finite animations so a shot shows the end state, not a frame mid-transition (infinite ones keep running) */
async function settle(p) {
  await p.evaluate(() => document.getAnimations().forEach(a => { try { if (a.effect && a.effect.getComputedTiming().iterations !== Infinity) a.finish(); } catch (_) { } }));
  await sleep(150);
}

function makeCtx(engine, view, dir, h, results, log) {
  let n = 0;
  const tag = `${engine}-${view}`;
  const c = {
    engine, view, p: h.p, BASE, SCRATCH, state, su, until, sleep,
    tap: async sel => { await h.p.locator(sel).first().waitFor({ state: "visible", timeout: 8000 }); return view === "phone" ? h.p.tap(sel) : h.p.click(sel); },
    shot: async (name, sel) => { await settle(h.p); const f = path.join(dir, String(++n).padStart(2, "0") + "-" + name + ".png"); if (sel) { await h.p.locator(sel).first().evaluate(e => e.scrollIntoView({ block: "center" })); await sleep(200); }   /* phone: the floating tab bar covers rows near the bottom edge */
      await (sel ? h.p.locator(sel).first().screenshot({ path: f }) : h.p.screenshot({ path: f })); log(`${tag} shot ${path.relative(process.cwd(), f)}`); return f; },
    check: (name, cond, detail) => { results.push({ view: tag, name, pass: !!cond, detail: detail === undefined ? null : detail }); log(`${tag} ${cond ? "PASS" : "FAIL"} ${name}${detail !== undefined ? "  " + JSON.stringify(detail) : ""}`); return !!cond; },
    note: s => log(`${tag} note ${s}`),
    /* open a page the way a user gets there. desk: rail hash; phone: tab bar + segment */
    go: async page => {
      if (view === "desk") { await h.p.evaluate(pg => { location.hash = "#page=" + pg; }, page); await sleep(800); return; }
      const PH = { ongoing: ["quests", '.m-seg [data-go="ongoing"]'], quests: ["quests", null], review: ["home", null], roles: ["more", '[data-go="roles"]'] };
      const [tab, sub] = PH[page] || ["more", `[data-go="${page}"]`];
      await c.tap(`#tabbar button[data-k=${tab}]`); await sleep(600);
      if (sub) { await c.tap(sub); await sleep(800); }
    },
  };
  return c;
}

async function run(journeyPath) {
  const out = opt("out"); if (!out) throw new Error("--out <dir> required (use work/<item-id>/verify/<run>)");
  fs.mkdirSync(out, { recursive: true });
  const logf = path.join(out, "log.txt"), lines = [];
  const log = s => { const l = `${new Date().toISOString().slice(11, 19)} ${s}`; lines.push(l); console.log(l); fs.writeFileSync(logf, lines.join("\n") + "\n"); };
  const J = require(path.resolve(journeyPath));
  const views = opt("views", (J.views || ["desk", "phone"]).join(",")).split(","), engines = opt("engines", "chromium").split(",");
  const results = [], errors = {};
  log(`journey ${path.basename(journeyPath)} on ${BASE} scratch ${SCRATCH} views ${views} engines ${engines}`);
  for (const engine of engines) for (const view of views) {
    const dir = path.join(out, `${engine}-${view}`); fs.mkdirSync(dir, { recursive: true });
    let h;
    try {
      h = await openView(engine, view, J.hash ? J.hash(view) : "", opt("theme"));
      await J.run(makeCtx(engine, view, dir, h, results, log));
    } catch (e) { results.push({ view: `${engine}-${view}`, name: "journey threw", pass: false, detail: String(e && e.stack || e).split("\n").slice(0, 3).join(" | ") }); log(`${engine}-${view} FAIL journey threw: ${e}`); }
    finally {
      if (h) { const kn = h.errs.filter(known); if (kn.length) log(`${engine}-${view} known issues (known-issues.json): ${[...new Set(kn)].join(" | ")}`);
        h.errs = Object.assign(h.errs.filter(e => !known(e)), { skipped: h.errs.skipped }); errors[`${engine}-${view}`] = h.errs; log(`${engine}-${view} page errors: ${h.errs.join(" | ") || "none"}`); if (h.errs.skipped) log(`${engine}-${view} expected 404s (not in scratch): ${[...new Set(h.errs.skipped)].length} paths`); await h.b.close(); }
      if (J.cleanup) try { await J.cleanup({ su, state, engine, view, log, SCRATCH }); } catch (e) { log(`cleanup error ${e}`); }
    }
  }
  const failed = results.filter(r => !r.pass).length, pageErr = Object.values(errors).reduce((a, e) => a + e.length, 0);
  fs.writeFileSync(path.join(out, "results.json"), JSON.stringify({ journey: path.basename(journeyPath), base: BASE, at: new Date().toISOString(), results, errors }, null, 1));
  log(`summary: ${results.length - failed}/${results.length} checks passed, ${pageErr} page errors`);
  process.exit(failed || pageErr ? 1 : 0);
}

async function shot(hash) {
  const out = opt("out"); if (!out) throw new Error("--out required"); fs.mkdirSync(out, { recursive: true });
  for (const engine of opt("engines", "chromium").split(",")) for (const view of opt("views", "desk,phone").split(",")) {
    const h = await openView(engine, view, hash, opt("theme")); await settle(h.p);
    const f = path.join(out, `${engine}-${view}.png`); await h.p.screenshot({ path: f });
    console.log(f, "errors:", h.errs.join(" | ") || "none"); await h.b.close();
  }
}

async function sheet(outPng, pairs) {
  const b = await pw.chromium.launch(), p = await b.newPage({ viewport: { width: 400, height: 300 } });
  const cells = pairs.map(s => { const i = s.indexOf("="); return [s.slice(0, i), fs.readFileSync(s.slice(i + 1)).toString("base64")]; });
  await p.setContent(`<body style="margin:0;background:#16161a;font:600 22px -apple-system,'PingFang SC',sans-serif;color:#eee">
    <div id="s" style="display:inline-flex;gap:16px;padding:16px;align-items:flex-start">${cells.map(([l, b64]) =>
      `<figure style="margin:0"><figcaption style="padding:0 0 8px">${l.replace(/</g, "&lt;")}</figcaption><img src="data:image/png;base64,${b64}" style="display:block;max-height:900px;border:1px solid #444"></figure>`).join("")}</div></body>`);
  await p.waitForFunction(() => [...document.images].every(i => i.complete));
  await p.locator("#s").screenshot({ path: outPng }); await b.close(); console.log(outPng);
}

(async () => {
  const [cmd, a1, ...rest] = args.filter((x, i) => !x.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
  if (cmd === "run" && a1) return run(a1);
  if (cmd === "smoke") { if (!args.includes("--engines")) args.push("--engines", "chromium,webkit"); return run(path.join(__dirname, "journeys", "navall.js")); }   /* t-ui-audit: the default gate */
  if (cmd === "shot") return shot(a1 || "");
  if (cmd === "sheet" && a1) return sheet(a1, rest);
  console.log(fs.readFileSync(__filename, "utf8").split("*/")[0]); process.exit(2);
})().catch(e => { console.error(e); process.exit(1); });
