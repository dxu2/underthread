/* t-onboard-tour, upgrade: an install that was already in use before this release never sees the welcome. Migration 0004_tour marks both
 * forms tour.desk / tour.phone how = upgrade on a used board (a real card, a chat line or a manager heartbeat); the page then stays quiet.
 * The migration itself is pinned in tests/unit/test_onboarding.py; this journey checks what the page does with such a board: on a copy of
 * your own (older) state the server's first read runs 0004, and the fixture board carries the same record (tests/e2e/fixtures/build.py).
 * Run it BEFORE tour.js, which overwrites the entries:
 *   node tests/e2e/drive.js run tests/e2e/journeys/tourup.js --out work/<item>/verify/<run> --engines chromium,webkit
 * Settings 通用 still offers 再走一遍 and says the update skipped it. */
module.exports = {
  views: ["desk", "phone"],
  async run(c) {
    const p = c.p, f = c.view, errs = [];
    p.on("pageerror", e => { const m = String(e).split("\n")[0]; if (!/due to access control checks/.test(m)) errs.push(m); });
    await p.evaluate(() => { const s = (k, v) => localStorage.setItem("rt." + k, JSON.stringify(v)); s("lang", "zh"); s("ut", "ut"); localStorage.removeItem("rt.otr.desk"); localStorage.removeItem("rt.otr.phone"); });
    await p.reload({ waitUntil: "load" });
    const s = await c.state(), m = s.meta || {}, t = ((m.onboarding || {}).tour) || {};
    c.check("state is at the latest schema (0004 ran)", (m.schema || 0) >= 4, m.schema);
    c.check("used board: both forms recorded how = upgrade", t.desk && t.desk.how === "upgrade" && t.phone && t.phone.how === "upgrade", t);
    const seen = await p.waitForSelector(".otr-w", { state: "visible", timeout: 5000 }).then(() => true, () => false);
    c.check("no welcome and no tour after the update", !seen && !(await p.evaluate(() => Tour.isOpen())));
    c.check("html[data-otr] never set", !(await p.evaluate(() => document.documentElement.hasAttribute("data-otr"))));
    if (f === "desk") await p.evaluate(() => App.go("settings")); else await c.go("settings");   /* desk: a later #page= hash no longer routes (only at boot), so drive.js go() misses */
    await p.waitForSelector("[data-otr-replay]", { timeout: 6000 }).catch(() => c.note("settings row not found; page " + p.url()));
    const row = await p.$("[data-otr-replay]"), tx = row ? (await row.textContent()).replace(/\s+/g, " ") : "";
    c.check("Settings 通用 offers 再走一遍 and says the update skipped it", /再走一遍/.test(tx) && /升级/.test(tx), tx);
    if (row) await c.shot("settings-upgrade", "[data-otr-replay]");
    c.check("no page errors", !errs.length, errs);
  },
};
