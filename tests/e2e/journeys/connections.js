/* t-feed-inbox: 设置 → 连接 / Connections. On the fixture board nothing is connected: the tab lists Gmail ("not connected", a Connect…
 * button) and Slack ("coming soon", no button); Connect… opens a dialog with an address field, a password field (type=password,
 * never prefilled), Google's app-password link, and Cancel closes it. An empty Test & connect is refused on the page, without a
 * request. Also: no sideways scroll at phone width, and /api/feeds still says not connected afterwards (nothing was stored).
 *   node tests/e2e/drive.js run tests/e2e/journeys/connections.js --out work/<item>/verify/<run> --engines chromium,webkit
 */
async function seed(c, lang) {
  await c.p.evaluate(l => { const s = (k, v) => localStorage.setItem("rt." + k, JSON.stringify(v)); s("ut", "ut"); s("texture", "leather1"); s("home3", "widgets"); s("lang", l); s("setTab", "connections"); }, lang);
  await c.p.reload({ waitUntil: "load" });
  await c.p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 15000 });
  await c.sleep(1200);
}
async function openTab(c) {
  if (c.view === "desk") { await c.tap("#nav [data-go=settings]"); await c.sleep(900); }
  else { await c.tap("#tabbar button[data-k=more]"); await c.sleep(700); await c.tap('[data-go="settings"]'); await c.sleep(900); }
  await c.tap('[data-settab="connections"]'); await c.sleep(900);
  await c.p.waitForSelector('[data-fc-row="gmail"]', { timeout: 8000 });
}
module.exports = {
  views: ["desk", "phone"],
  hash: view => (view === "desk" ? "#page=review" : ""),
  async run(c) {
    const p = c.p;
    for (const lang of ["zh", "en"]) {
      await seed(c, lang);
      await openTab(c);
      const rows = await p.evaluate(() => [...document.querySelectorAll("[data-fc-row]")].map(r => ({ id: r.dataset.fcRow, text: r.textContent.replace(/\s+/g, " ").trim(), btn: !!r.querySelector('[data-fc="open"]') })));
      const tab = await p.evaluate(() => { const b = document.querySelector('[data-settab="connections"]'); return { on: b.classList.contains("on"), text: b.textContent }; });
      c.check(`${lang}: Connections tab is selected`, tab.on && tab.text === (lang === "en" ? "Connections" : "连接"), tab);
      const g = rows.find(r => r.id === "gmail"), s = rows.find(r => r.id === "slack");
      c.check(`${lang}: Gmail row says not connected and offers Connect`, g && g.btn && g.text.includes(lang === "en" ? "Not connected" : "未连接"), g);
      c.check(`${lang}: Slack row says coming soon, no Connect`, s && !s.btn && s.text.includes(lang === "en" ? "Coming soon" : "即将支持"), s);
      const ov = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      c.check(`${lang}: no sideways scroll`, ov <= 0, ov);
      await c.shot(`tab-${lang}`);
      await c.tap('[data-fc="open"][data-src="gmail"]'); await c.sleep(500);
      const dlg = await p.evaluate(() => { const m = document.querySelector("#modal .fc-mdl"); if (!m) return null; const pw = m.querySelector("#fc-pw"), a = m.querySelector('a[href*="apppasswords"]');
        return { pw: pw && pw.type, val: pw && pw.value, acct: !!m.querySelector("#fc-acct"), link: !!a, rel: a && a.rel }; });
      c.check(`${lang}: dialog has address + password (type=password, empty) + app-password link`, dlg && dlg.pw === "password" && dlg.val === "" && dlg.acct && dlg.link && /noopener/.test(dlg.rel), dlg);
      await c.shot(`dialog-${lang}`, "#modal .mdl");
      let posts = 0; const onReq = r => { if (r.url().includes("/api/feeds") && r.method() === "POST") posts++; }; p.on("request", onReq);
      await c.tap('#modal [data-fcm="ok"]'); await c.sleep(400);
      const msg = await p.evaluate(() => (document.querySelector("#modal .fc-msg") || {}).textContent || "");
      p.off("request", onReq);
      c.check(`${lang}: empty Test & connect is refused on the page, no request`, msg && posts === 0, { msg, posts });
      await c.tap('#modal [data-fcm="x"]'); await c.sleep(400);
      c.check(`${lang}: Cancel closes the dialog`, await p.evaluate(() => document.getElementById("modal").hidden), null);
    }
    const st = await p.evaluate(() => fetch("/api/feeds").then(r => r.json()));
    c.check("server: still not connected", st.sources.every(s => !s.connected), st.sources.map(s => [s.id, s.connected]));
  },
};
