/* t-oss-live: 看画面 / Watch (built-in ext/live). The fixture scout holds the Chrome tool flag; the journey pushes one frame with
 * `stateutil live-frame` in the scratch copy, then:
 *   - desk: the Chrome tool pill has 看画面 / Watch; phone: scout's row on the home team card has the 看画面 › link
 *   - tapping it opens the viewer and the frame shows; Close closes it
 *   - Settings -> Connections -> Watch switches it off: config off on the server, the entry is gone, /api/live answers 404 "off";
 *     switching it back on brings the entry back without a reload
 *   - the agent lets go of the browser (--tool "") -> the viewer says it ended and closes itself
 *   - zh and en labels; no sideways scroll at phone width
 *   node tests/e2e/drive.js run tests/e2e/journeys/live.js --out work/<item>/verify/<run> --engines chromium,webkit
 */
const path = require("path");
const { execFileSync } = require("child_process");
const S = process.env.VERIFY_SCRATCH || `/tmp/rt-verify-${process.env.VERIFY_PORT || 8799}`;
const su = (...a) => execFileSync("python3", ["stateutil.py", ...a], { cwd: S }).toString().trim();
const FRAME = path.join(S, "web", "brand", "wordmark-on-light@2x.png");
const ENTRY = view => view === "desk" ? "#toolbar .tool-pill .tp-live" : '.a2-lk[data-live="scout"]';
const visible = (p, sel) => p.evaluate(sel => { const e = document.querySelector(sel); if (!e || e.hidden) return false; const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
  return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden"; }, sel);

async function seed(c, lang) {
  await c.p.evaluate(l => { const s = (k, v) => localStorage.setItem("rt." + k, JSON.stringify(v)); s("ut", "ut"); s("texture", "knit"); s("home3", "widgets"); s("lang", l); s("setTab", "connections"); }, lang);
  await c.p.reload({ waitUntil: "load" });
  await c.p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 15000 });
  await c.sleep(1500);
}
async function home(c) {
  if (c.view === "phone") await c.tap("#tabbar button[data-k=home]");   /* desk: the tool pill is in the header on every page */
  await c.sleep(1200);
}
async function settings(c) {
  if (c.view === "desk") { await c.tap("#nav [data-go=settings]"); await c.sleep(900); }
  else { await c.tap("#tabbar button[data-k=more]"); await c.sleep(700); await c.tap('[data-go="settings"]'); await c.sleep(900); }
  await c.tap('[data-settab="connections"]'); await c.sleep(900);
}
module.exports = {
  views: ["desk", "phone"],
  hash: () => "",
  async run(c) {
    const p = c.p;
    su("set-agent", "scout", "--status", "working", "--tool", "chrome");
    su("live-frame", "scout", FRAME);
    for (const lang of ["zh", "en"]) {
      await seed(c, lang);
      if (c.view === "phone") await home(c);
      const sel = ENTRY(c.view);
      await p.waitForFunction(sel => !!document.querySelector(sel), sel, { timeout: 8000 }).catch(() => {});
      const on = await visible(p, sel);
      const label = on ? (await p.evaluate(sel => document.querySelector(sel).textContent.replace(/[›\s]+/g, " ").trim(), sel)) : "";
      c.check(`${lang}: ${c.view} shows the Watch entry for scout`, on && label === (lang === "en" ? "Watch" : "看画面"), { on, label });
      await c.shot(`entry-${lang}`);
      if (!on) continue;
      await c.tap(sel);
      const shown = await p.waitForFunction(() => { const l = document.getElementById("live"); return l && !l.hidden && document.querySelector("#live .lv-img.on"); }, null, { timeout: 8000 }).then(() => true, () => false);
      const hd = await p.evaluate(() => (document.querySelector("#live .lv-nm") || {}).textContent || "");
      c.check(`${lang}: the viewer opens with the frame`, shown && hd.includes("Scout") && hd.includes(lang === "en" ? "last screenshot" : "最近一张截图"), { shown, hd });
      await c.sleep(400);
      await c.shot(`viewer-${lang}`);
      await c.tap("#live .lv-x"); await c.sleep(500);
      c.check(`${lang}: Close closes it`, await p.evaluate(() => document.getElementById("live").hidden), null);
      if (c.view === "phone") {
        const ov = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        c.check(`${lang}: no sideways scroll`, ov <= 0, ov);
      }
    }
    // the switch (en from the loop above)
    await settings(c);
    const row = await p.evaluate(() => { const b = document.querySelector("[data-live-tog]"); return b && { pressed: b.getAttribute("aria-pressed"), text: b.textContent.replace(/\s+/g, " ").trim() }; });
    c.check("Settings -> Connections has the Watch switch, on", row && row.pressed === "true" && /Watch/.test(row.text) && /never uploaded/.test(row.text), row);
    await c.shot("switch-on", "[data-live-tog]");
    await c.tap("[data-live-tog]"); await c.sleep(1500);
    const srv = await p.evaluate(async () => { const r = await fetch("/api/live/scout.jpg"); return { exts: (await fetch("/api/state").then(r => r.json())).meta.exts, frame: r.status, why: r.headers.get("X-Live-Err") }; });
    c.check("off: the server says off and /api/live serves no frame (204 off)", srv.exts && srv.exts.live === false && srv.frame === 204 && srv.why === "off", srv);
    await c.shot("switch-off", "[data-live-tog]");
    await home(c);
    c.check("off: no Watch entry", !(await visible(p, ENTRY(c.view))), null);
    await settings(c);
    await c.tap("[data-live-tog]"); await c.sleep(1500);
    su("live-frame", "scout", FRAME);
    await home(c); await c.sleep(1500);
    c.check("on again: the entry is back without a reload", await visible(p, ENTRY(c.view)), null);
    // the agent lets go of the browser while the viewer is open
    await c.tap(ENTRY(c.view));
    await p.waitForFunction(() => document.querySelector("#live .lv-img.on"), null, { timeout: 8000 }).catch(() => {});
    su("set-agent", "scout", "--tool", "");
    const ended = await p.waitForFunction(() => /Ended/.test((document.querySelector("#live .lv-msg") || {}).textContent || ""), null, { timeout: 8000 }).then(() => true, () => false);
    c.check("tool flag cleared: the viewer says it ended", ended, null);
    if (ended) await c.shot("ended");
    const closed = await p.waitForFunction(() => document.getElementById("live").hidden, null, { timeout: 6000 }).then(() => true, () => false);
    c.check("and closes itself", closed, null);
  },
  async cleanup(o) {
    try { o.su("set-agent", "scout", "--status", "working", "--tool", "chrome"); } catch (_) {}
    try {
      const f = path.join(o.SCRATCH, "config.json"), fs = require("fs");
      const j = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {};
      if (j.extensions && j.extensions.live === false) { j.extensions.live = true; fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n"); }
    } catch (_) {}
  },
};
