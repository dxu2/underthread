/* t-roster-rail: 团队 / Team is a left-rail page again, and it is the roster (moved out of 设置 · 角色, which keeps a row that jumps here).
 * Each card can 改名 (display name only) and 换头像 (one of the role's own pictures). Replaces nocrew.js (t-drop-team-tab).
 * Checks: rail / 更多 row, TEAM 名册 › link, 设置 · 角色 jump row, old #page=roles / team / crew links and a stored rt.page, rename + reset
 * (server roster.json + state, card and rail text), avatar pick + default (server avpick, rail avatar URL), the 团队交接 widget still draws.
 *   node tests/e2e/drive.js run tests/e2e/journeys/crew.js --out work/<item>/verify/<run> --views desk,phone --engines chromium,webkit
 */
const fs = require("fs"), path = require("path");
const ready = async c => { await c.p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 15000 }); await c.sleep(1200); };
const used = new Set();
const roster = S => { try { return JSON.parse(fs.readFileSync(path.join(S, "roster.json"), "utf8")).roles || []; } catch (_) { return []; } };
module.exports = {
  views: ["desk", "phone"],
  hash: () => "#page=review",
  async run(c) {
    const p = c.p, S = c.SCRATCH;
    /* the user's everyday look: 特典 palette + knit texture */
    await p.evaluate(() => { localStorage.setItem("rt.ut", JSON.stringify("ut")); localStorage.setItem("rt.texture", JSON.stringify("knit")); });
    await p.reload({ waitUntil: "load" }); await ready(c);
    const st0 = await c.state(), ags = Object.values(st0.agents || {});
    /* a role nobody else is testing in this run, not working, not the manager */
    const pick = ags.filter(a => a.id !== "manager" && a.enabled !== false && !used.has(a.id)).sort((a, b) => (a.status === "working") - (b.status === "working"))[0];
    if (!c.check("a role to rename", !!pick, ags.map(a => a.id))) return;
    const id = pick.id; used.add(id);
    const name0 = pick.name, nm = `验证${c.view === "desk" ? "甲" : "乙"}`;

    // ---- reach the page ----
    if (c.view === "desk") {
      const rail = await p.evaluate(() => [...document.querySelectorAll("#nav [data-go]")].map(e => e.dataset.go));
      c.check("desk rail: 团队 row right before 招聘市场", rail.indexOf("crew") >= 0 && rail.indexOf("crew") === rail.indexOf("market") - 1, rail);
      const w = await p.evaluate(() => { const t = document.querySelector(".wg-team"); return t ? !!t.querySelector("svg") : null; });
      if (w !== null) c.check("团队交接 widget still draws on the home", w);
      await c.tap('#nav [data-go="crew"]'); await c.sleep(900);
    } else {
      await c.tap("#tabbar button[data-k=more]"); await c.sleep(800);
      const more = await p.evaluate(() => [...document.querySelectorAll("[data-go]")].filter(e => e.getBoundingClientRect().width).map(e => e.dataset.go));
      c.check("phone 更多 has the 团队 row", more.includes("crew") && more.includes("market"), more);
      await c.shot("more");
      await c.tap('[data-go="crew"]'); await c.sleep(1000);
    }
    c.check("page = crew", await p.evaluate(() => App.UI.page) === "crew");
    const cards = await p.evaluate(() => document.querySelectorAll("#pagebody .roster .rc").length);
    c.check("one roster card per role", cards === ags.length, { cards, roles: ags.length });
    c.check("every card has 私信 / 改名 / 换头像", await p.evaluate(() => [...document.querySelectorAll("#pagebody .rc")].every(r => r.querySelector("[data-chat]") && r.querySelector("[data-rk-name]") && r.querySelector("[data-rk-av]"))));
    c.check("lead line counts the team", await p.evaluate(() => /\d/.test((document.querySelector(".rl-lead") || {}).textContent || "")));
    await c.shot("page");

    // ---- rename ----
    await c.tap(`[data-rk-name="${id}"]`); await c.sleep(500);
    c.check("rename sheet open, prefilled", await p.evaluate(n => { const i = document.querySelector("#modal #rk-n"); return !!i && i.value === n; }, name0));
    await c.shot("rename-sheet", "#modal .mdl");
    await p.fill("#modal #rk-n", nm);
    await c.tap("#modal [data-ok]");
    const r1 = await c.until(async () => { const a = (await c.state()).agents[id]; return a && a.name === nm && a; });
    c.check("server: display name set, original kept", r1 && r1.name_orig === name0, r1 && { name: r1.name, orig: r1.name_orig });
    const ro = roster(S).find(r => r.id === id) || {};
    c.check("roster.json: display_name written, name untouched", ro.display_name === nm && ro.name === name0, { display_name: ro.display_name, name: ro.name });
    await c.sleep(1200);
    c.check("card shows the new name", await p.evaluate(([i, n]) => [...document.querySelectorAll("#pagebody .rc")].some(r => r.querySelector(`[data-rk-name="${i}"]`) && r.querySelector(".nm").textContent === n), [id, nm]));
    if (c.view === "desk") c.check("rail TEAM row shows the new name", await p.evaluate(([i, n]) => (document.querySelector(`#team [data-chat="${i}"] .nmt`) || {}).textContent === n, [id, nm]));
    await c.shot("renamed", `.rc:has([data-rk-name="${id}"])`);
    await c.tap(`[data-rk-name="${id}"]`); await c.sleep(500);
    await c.tap("#modal [data-rk-reset]");
    c.check("恢复原名: original back on server", !!(await c.until(async () => { const a = (await c.state()).agents[id]; return a && a.name === name0 && !a.name_orig; })));
    c.check("roster.json: display_name gone", !("display_name" in (roster(S).find(r => r.id === id) || {})));

    // ---- avatar ----
    const ut = path.join(S, "avatars", "ut", `${id}.png`), dir = path.join(S, "avatars", "choices", id);
    if (fs.existsSync(ut)) { fs.mkdirSync(dir, { recursive: true }); fs.copyFileSync(ut, path.join(dir, `verify-${c.view}.png`)); }
    await c.tap(`[data-rk-av="${id}"]`); await c.sleep(900);
    const tiles = await p.evaluate(() => [...document.querySelectorAll("#modal .rk-t")].map(t => t.dataset.rkSrc));
    c.check("avatar sheet: default tile first, then the role's pictures", tiles[0] === "" && tiles.length >= 2, tiles);
    await c.shot("avatar-sheet", "#modal .mdl");
    const want = tiles.find(s => s.startsWith("choices/")) || tiles[1];
    if (want) {
      await c.tap(`#modal .rk-t[data-rk-src="${want}"]`); await c.sleep(200);
      c.check("tile marks as chosen", await p.evaluate(w => document.querySelector(`#modal .rk-t[data-rk-src="${w}"]`).getAttribute("aria-checked") === "true", want));
      await c.tap("#modal [data-ok]");
      const a2 = await c.until(async () => { const a = (await c.state()).agents[id]; return a && a.avpick && a.avpick.src === want && a; });
      c.check("server: avpick set", !!a2, a2 && a2.avpick);
      await c.sleep(1500);
      const sel = c.view === "desk" ? `#team [data-chat="${id}"] .av` : `#pagebody .rc:has([data-rk-av="${id}"]) .rc-h .av`;
      const bg = await p.evaluate(s => { const e = document.querySelector(s); return e ? e.style.backgroundImage : ""; }, sel);
      c.check("avatar on the page uses the pick", a2 && (a2.avpick.s ? bg.includes(`/avatars/_pick/${id}-`) : bg.includes(a2.avpick.src.split("/").pop())), bg.slice(0, 120));
      await c.shot("picked", `.rc:has([data-rk-av="${id}"])`);
      await c.tap(`[data-rk-av="${id}"]`); await c.sleep(900);
      await c.tap('#modal .rk-t[data-rk-src=""]'); await c.tap("#modal [data-ok]");
      c.check("default again: avpick gone", !!(await c.until(async () => { const a = (await c.state()).agents[id]; return a && !a.avpick; })));
    }

    // ---- links in ----
    if (c.view === "desk") {
      await c.go("review"); await c.sleep(600);
      await c.tap("#team .rk-all"); await c.sleep(800);
      c.check("TEAM 名册 › opens 团队", await p.evaluate(() => App.UI.page) === "crew");
      await c.tap('#nav [data-go="settings"]'); await c.sleep(800);
      await c.tap('[data-settab="roles"]'); await c.sleep(700);
      c.check("设置 · 角色 shows the jump row only", await p.evaluate(() => !!document.querySelector('.st-pane [data-go="crew"]') && !document.querySelector(".st-pane .roster")));
      await c.shot("settings-roles");
      await c.tap('.st-pane [data-go="crew"]'); await c.sleep(800);
      c.check("jump row opens 团队", await p.evaluate(() => App.UI.page) === "crew");
    }
    if (c.view !== "desk") return;   /* a phone always opens on its home tab (phone/search.js), so old #page= links are a desk matter */
    for (const h of ["roles", "team", "crew"]) {
      await p.goto(c.BASE + "/#page=" + h, { waitUntil: "load" }); await p.reload({ waitUntil: "load" }); await ready(c);
      const pg = await p.evaluate(() => App.UI.page);
      c.check(`#page=${h} lands on 团队`, pg === "crew", pg);
    }
    await p.evaluate(() => localStorage.setItem("rt.page", JSON.stringify("roles"))); await p.goto(c.BASE + "/", { waitUntil: "load" }); await ready(c);
    c.check("stored rt.page = roles lands on 团队", await p.evaluate(() => App.UI.page) === "crew");
  },
  async cleanup(o) {
    for (const id of used) {
      try {
        await fetch(`${o.BASE || "http://127.0.0.1:" + (process.env.VERIFY_PORT || 8799)}/api/action`, { method: "POST", headers: { "Content-Type": "application/json", "X-Underthread": "1" }, body: JSON.stringify({ kind: "role_look", id, name: "", name_en: "", avatar: "" }) });
      } catch (e) { o.log(`cleanup ${id}: ${e}`); }
      fs.rmSync(path.join(o.SCRATCH, "avatars", "choices", id), { recursive: true, force: true });
    }
    used.clear();
  },
};
