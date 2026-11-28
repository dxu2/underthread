/* t-oss-secreview (v0.3.1 security fixes): the hardening keeps every feature it touches working.
 *   node tests/e2e/drive.js run tests/e2e/journeys/secfix.js --out <dir> [--views desk,phone] [--engines chromium,webkit]
 * - a crafted #page= link runs no script and lands on 首页; every real #page= key still opens its page (desk)
 * - an image attachment still shows (thumbnail, or the full file when the thumbnail fails) after the inline onerror went away
 * - an HTML file under work/ still opens and runs its script, but sandboxed (it cannot read /api/state)
 * - pages carry the anti-framing headers; stateutil refuses ids that could break out of an HTML attribute */
const fs = require("fs"), path = require("path");
const RUN = Date.now().toString(36);
const PNG = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAHklEQVR42mP4z8DwnwJMHYDSDKMGjBowasCoAZQCAOCFP8Fq2ZMCAAAAAElFTkSuQmCC";
const PAGES = [["review", "review"], ["home", "review"], ["daily", "daily"], ["main", "main"], ["side", "side"], ["urgent", "urgent"], ["ongoing", "ongoing"],
  ["quests", "quests"], ["board", "board"], ["pipe", "pipe"], ["channels", "channels"], ["assets", "assets"], ["reports", "reports"], ["mail", "mail"],
  ["crew", "crew"], ["team", "crew"], ["market", "market"], ["settings", "settings"], ["logs", "settings"], ["docs", "settings"]];
module.exports = {
  views: ["desk", "phone"],
  hash: () => `#page=x"><img src=x onerror="window.__p0=1">`,
  async run(c) {
    const p = c.p, base = c.BASE;
    await c.sleep(1500);
    c.check("crafted #page= runs no script", await p.evaluate(() => window.__p0 === undefined));
    c.check("crafted #page= lands on 首页", await p.evaluate(() => App.UI.page === "review"));
    if (c.view === "desk") {
      const bad = [];
      for (const [k, want] of PAGES) {
        await p.goto(`${base}/#page=${k}`); await p.reload({ waitUntil: "load" });
        const ok = await c.until(() => p.evaluate(w => App.UI.page === w && !!document.querySelector("#pagebody") && document.querySelector("#pagebody").innerHTML.length > 0, want), 6000);
        if (!ok) bad.push(k + "->" + await p.evaluate(() => App.UI.page));
      }
      c.check(`every #page= key opens its page (${PAGES.length})`, !bad.length, bad);
    }
    // an image attachment (the thumbnail may fail on a box without sips: the full file is the fallback)
    const dir = path.join(c.SCRATCH, "work", "e2e-sec"); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${RUN}.png`), Buffer.from(PNG, "base64"));
    fs.writeFileSync(path.join(dir, "probe.html"), `<!doctype html><title>start</title><p id=t>html deliverable</p><script>document.title="ran";fetch("/api/state").then(r=>r.json()).then(()=>document.title="ran-read",()=>document.title="ran-blocked")</script>`);
    const id = `e2e-sec-${RUN}-${c.engine}-${c.view}`;
    c.su("upsert-item", "--id", id, "--title", "安全修复 e2e", "--category", "daily", "--stage", "review", "--kind", "deliverable", "--who", "smith", "--attach", `work/e2e-sec/${RUN}.png`);
    await p.goto(`${base}/#item=${id}`); await p.reload({ waitUntil: "load" });
    const shown = await c.until(() => p.evaluate(() => [...document.querySelectorAll(".atts img")].some(i => i.complete && i.naturalWidth > 0 && i.style.display !== "none")), 10000);
    c.check("image attachment shows (thumb or full-file fallback)", shown);
    c.check("no attachment img carries a path inside inline JS", await p.evaluate(() => [...document.querySelectorAll(".atts img")].every(i => !/src=/.test(i.getAttribute("onerror") || ""))));
    await c.shot("attachment", ".atts");
    // HTML under work/: opens, runs, sandboxed
    const h = await p.evaluate(async u => { const r = await fetch(u); return { csp: r.headers.get("content-security-policy") || "", ct: r.headers.get("content-type") || "" }; }, `${base}/work/e2e-sec/probe.html`);
    c.check("work/*.html is served sandboxed", /sandbox/.test(h.csp) && /text\/html/.test(h.ct), h);
    const q = await p.context().newPage(); await q.goto(`${base}/work/e2e-sec/probe.html`, { waitUntil: "load" });
    await c.until(() => q.evaluate(() => document.title !== "start" && document.title !== "ran"), 6000);
    const tt = await q.evaluate(() => document.title + "|" + (document.getElementById("t") || {}).textContent);
    c.check("HTML deliverable still renders and runs its script", /^ran/.test(tt) && tt.includes("html deliverable"), tt);
    c.check("sandboxed HTML cannot read the board", tt.startsWith("ran-blocked"), tt);
    await q.close();
    const fh = await p.evaluate(async () => { const r = await fetch("/"); return [r.headers.get("x-frame-options"), r.headers.get("content-security-policy"), r.headers.get("x-content-type-options")]; });
    c.check("board pages refuse cross-site framing", fh[0] === "SAMEORIGIN" && /frame-ancestors 'self'/.test(fh[1] || "") && fh[2] === "nosniff", fh);
    let refused = false; try { c.su("upsert-item", "--id", 'e2e"><b>', "--title", "x"); } catch (_) { refused = true; }
    c.check("stateutil refuses a card id with quotes / brackets", refused);
  },
};
