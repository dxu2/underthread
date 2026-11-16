/* t-hire-celebration: the new-teammate welcome (web/js/welcome.js + web/css/welcome.css, meta.hires from api/routes/state.py).
 * The journey logs a hire the way tools/new_role.py does (an "apply" line in the scratch copy's logs/new_role.jsonl, now), then checks:
 * the page plays it by itself (no reload; the poll brings meta.hires), the beats of the 4.8 s timeline (frames paused at each beat),
 * 8 teammates on desk / 6 on a phone, the work strip only under 特典, once per browser (reload = no replay), tap to skip,
 * reduced motion = finished frame only, and 墨刊 (no 特典) plays with the normal avatar.
 *   node tests/e2e/drive.js run tests/e2e/journeys/welcome.js --out work/<item>/verify/<run> --engines chromium,webkit
 *   HW_FRAMES=1 also writes a frame every 0.1 s (frames/) for a GIF.
 * Fixture-safe: picks buyer if the board has it, else the last role; cleanup puts the log back. */
const fs = require("fs"), path = require("path");
const LOG = S => path.join(S, "logs", "new_role.jsonl");
let SAVED = null, rawN = 0;
const outDir = c => { const i = process.argv.indexOf("--out"); return path.join(path.resolve(process.argv[i + 1]), `${c.engine}-${c.view}`); };
const raw = async (c, name, sub) => { const d = sub ? path.join(outDir(c), sub) : outDir(c); fs.mkdirSync(d, { recursive: true });
  const f = path.join(d, sub ? `${name}.png` : `f${String(++rawN).padStart(2, "0")}-${name}.png`); await c.p.screenshot({ path: f }); return f; };
const seek = (p, t) => p.evaluate(t => { const el = document.querySelector(".hw"); if (!el) return; el.getAnimations({ subtree: true }).forEach(a => { a.pause(); a.currentTime = t * 1000; }); }, t);
const st = p => p.evaluate(() => {
  const el = document.querySelector(".hw"); if (!el) return null;
  const q = s => el.querySelector(s), cs = e => e && getComputedStyle(e), vis = e => !!e && cs(e).visibility === "visible" && cs(e).display !== "none";
  const box = e => { if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
  const ms = [...el.querySelectorAll(".hw-m")];
  return { id: el.dataset.id, cls: el.className, op: +cs(el).opacity, main: el.style.getPropertyValue("--main"), badge: box(q(".hw-badge")), hang: cs(q(".hw-hang")).transform,
    ring: cs(q(".hw-ring")).getPropertyValue("--sti-a"), img: q(".hw-img").getAttribute("src"), orb: vis(q(".hw-orb")), nm: q(".hw-nm").textContent, nmClip: cs(q(".hw-nm")).clipPath,
    tt: +cs(q(".hw-tt")).opacity, knot: cs(q(".hw-knot")).transform, sheet: q(".hw-sheet") ? vis(q(".hw-sheet")) : null, n: ms.length,
    crewIn: ms.filter(m => { const r = m.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }).length,
    crewTop: ms.map(m => Math.round(m.getBoundingClientRect().top)), lean: ms.map(m => cs(m.querySelector(".hw-l")).transform !== "none").filter(Boolean).length,
    x: [...el.querySelectorAll(".hw-x")].filter(x => +cs(x).opacity > .5).length, overflow: document.documentElement.scrollWidth > innerWidth };
});
async function boot(c, o) {
  const p = c.p;
  const url = p.url();
  /* set storage from a same-origin page that runs no app code: neither the old page's 3 s check nor a half-loaded one may play
     (and mark seen) a hire between the reset and the real load */
  await p.goto(new URL(url).origin + "/static/css/welcome.css");
  await p.evaluate(o => { const s = (k, v) => localStorage.setItem("rt." + k, JSON.stringify(v)); s("ut", o.ut ? "ut" : "ink"); s("lang", "zh"); if (o.reset) localStorage.removeItem("rt.welcome"); }, o);
  await p.goto(url, { waitUntil: "load" });
  await p.waitForFunction(() => window.App && App.ST && App.ST.meta && window.HW && !document.getElementById("ut-splash"), null, { timeout: 15000 });
}
/* buyer if the board has it, else the highest-order role with a 特典 avatar (the page waits for one under 特典); plus a second role.
   n = teammates that can show (fixtures have fewer than 8 roles) */
async function pickRoles(c) { return c.p.evaluate(() => { const a = Object.values(App.ST.agents || {}).filter(x => x.enabled !== false && x.id !== "manager").sort((x, y) => (y.order ?? 0) - (x.order ?? 0));
  const ut = a.filter(x => /\/avatars\/ut\//.test(App.avatarUrl(x, 1)));
  const one = (a.find(x => x.id === "buyer") || ut[0] || a[0]).id;
  return [one, (ut.find(x => x.id !== one) || a.find(x => x.id !== one)).id, HW.crewOf(one, 99).length]; }); }
function logHire(S, id, ago = 1) {
  fs.mkdirSync(path.dirname(LOG(S)), { recursive: true });
  if (SAVED === null) SAVED = fs.existsSync(LOG(S)) ? fs.readFileSync(LOG(S)) : false;
  const d = new Date(Date.now() - ago * 1000), z = -d.getTimezoneOffset(), pad = n => String(Math.abs(n)).padStart(2, "0");
  const t = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${z >= 0 ? "+" : "-"}${pad(z / 60 | 0)}:${pad(z % 60)}`;
  fs.appendFileSync(LOG(S), JSON.stringify({ t, op: "apply", id, made: [], from: ["e2e welcome.js"], backup_tag: "e2e", avatar: "given" }) + "\n");
  return t;
}

module.exports = {
  views: ["desk", "phone"],
  hash: () => "#page=review",
  async run(c) {
    const p = c.p, desk = c.view === "desk"; rawN = 0;
    await boot(c, { ut: true, reset: false });
    await p.evaluate(() => { const el = document.querySelector(".hw"); if (el) el.remove(); });   // a hire already on the board may have played at load
    const [id, id2, crewMax] = await pickRoles(c), N = Math.min(desk ? 8 : 6, crewMax);
    /* 0. a browser that never had this feature: two recent hires, only the newest plays, the older one is marked seen */
    logHire(c.SCRATCH, id2, 90); logHire(c.SCRATCH, id, 60);
    await boot(c, { ut: true, reset: true });
    const first = await c.until(() => p.evaluate(() => { const el = document.querySelector(".hw"); return el && el.dataset.id; }), 10000, 100);
    c.check("first visit: plays only the newest recent hire", first === id, { first, newest: id, older: id2, why: first ? undefined : await p.evaluate(() => ({ seen: localStorage.getItem("rt.welcome"), hires: App.ST.meta.hires, vis: document.visibilityState, splash: document.documentElement.dataset.splash || null, block: !!document.querySelector(".mc, [data-mk-undo]"), url: App.avatarUrl(App.agent(App.ST.meta.hires.slice(-1)[0].id), 1) })) });
    await p.evaluate(() => { const el = document.querySelector(".hw"); if (el) el.click(); }); await c.sleep(4500);
    c.check("first visit: the older hire does not follow", !(await p.$(".hw")), await p.evaluate(() => localStorage.getItem("rt.welcome")));
    const at = logHire(c.SCRATCH, id);
    c.note(`logged a hire of ${id} at ${at}`);
    /* 1. the trigger: no reload, the next poll carries meta.hires and the page plays it */
    await p.evaluate(() => { window.__hwMark = 1; App.refresh(); });
    const got = await c.until(() => p.evaluate(() => { const el = document.querySelector(".hw"); if (el) el.getAnimations({ subtree: true }).forEach(a => a.pause()); return el && el.dataset.id; }), 12000, 100);
    c.check("meta.hires lists the new hire", await c.until(async () => ((await c.state()).meta.hires || []).some(h => h.id === id && h.at === at), 4000));
    c.check("the page plays the welcome for it by itself (no reload)", got === id && await p.evaluate(() => window.__hwMark === 1), got);
    c.check("rt.welcome remembers it", await p.evaluate(k => (JSON.parse(localStorage.getItem("rt.welcome") || "{}").seen || {})[k] > 1, `${id}@${at}`));
    /* 2. beats */
    const beats = [[0.3, "drop"], [1.0, "sewing"], [1.7, "name"], [2.35, "crew-in"], [3.2, "wave"], [4.05, "lean"], [4.6, "fade"]], S = {};
    for (const [t, k] of beats) { await seek(p, t); await c.sleep(150); S[k] = await st(p); await raw(c, `ut-${t.toFixed(2)}s-${k}`); }
    c.check("main colour = the role's tint", !!S.drop.main, S.drop.main);
    c.check("0.3 s: badge on its way down, avatar not sewn yet, no teammates yet", S.drop.hang !== "none" && parseFloat(S.drop.ring) === 0 && S.drop.crewIn === 0, { hang: S.drop.hang, ring: S.drop.ring });
    c.check("1.0 s: needle sewing, ring part drawn", S.sewing.orb && parseFloat(S.sewing.ring) > 90 && parseFloat(S.sewing.ring) < 300, { orb: S.sewing.orb, ring: S.sewing.ring });
    c.check("1.7 s: ring closed, needle gone, name being stitched", !S.name.orb && parseFloat(S.name.ring) >= 359 && !/inset\(-40px 0(px)? -40px 0(px)?\)/.test(S.name.nmClip), S.name.nmClip);
    c.check(`2.35 s: ${N} teammates (${desk ? "desk" : "phone"}), some already up`, S["crew-in"].n === N && S["crew-in"].crewIn >= 2, { n: S["crew-in"].n, in: S["crew-in"].crewIn });
    c.check("3.2 s: all teammates on screen, cross-stitch × scattered, title and knot in", S.wave.crewIn === N && S.wave.x >= 4 && S.wave.tt > .95 && /none|matrix\(1, 0, 0, 1, 0, 0\)/.test(S.wave.knot), { in: S.wave.crewIn, x: S.wave.x, tt: S.wave.tt });
    c.check("4.05 s: everyone leans toward the badge", S.lean.lean === N, S.lean.lean);
    c.check("4.05 s: work strip playing when the role has one (特典)", S.lean.sheet === null ? true : S.lean.sheet === true, S.lean.sheet);
    c.check("4.6 s: fading out", S.fade.op < .7, S.fade.op);
    c.check("badge fits the viewport, no horizontal scroll", S.wave.badge[0] >= 0 && S.wave.badge[0] + S.wave.badge[2] <= (desk ? 1440 : 390) && !S.wave.overflow, S.wave.badge);
    c.check("the 特典 avatar is used", /\/avatars\/ut\//.test(S.drop.img), S.drop.img);
    if (process.env.HW_FRAMES) for (let t = 0; t <= 4.7501; t += 0.05) { await seek(p, t); await c.sleep(40); await raw(c, `t${String(Math.round(t * 100)).padStart(3, "0")}`, "frames"); }
    /* 3. ends by itself */
    await p.evaluate(() => document.querySelector(".hw").getAnimations({ subtree: true }).forEach(a => { a.currentTime = 0; a.play(); }));
    const t0 = Date.now(); await p.waitForFunction(() => !document.querySelector(".hw"), null, { timeout: 8000 }).catch(() => { });
    c.check("overlay removes itself (life 4.8 s, 5.4 s guard from the start)", !(await p.$(".hw")), Date.now() - t0);
    /* 4. once per browser */
    await boot(c, { ut: true }); await c.sleep(4000);
    c.check("reload: not played again", !(await p.$(".hw")));
    /* 5. tap skips */
    await p.evaluate(id => HW.play(id), id); await c.sleep(700);
    const tb = Date.now(); if (desk) await p.mouse.click(700, 450); else await p.touchscreen.tap(195, 700);
    await p.waitForFunction(() => !document.querySelector(".hw"), null, { timeout: 3000 }).catch(() => { });
    c.check("tap anywhere skips (gone within ~0.5 s)", !(await p.$(".hw")) && Date.now() - tb < 1500, Date.now() - tb);
    /* 6. reduced motion */
    await p.emulateMedia({ reducedMotion: "reduce" });
    await p.evaluate(id => HW.play(id), id); await c.sleep(600);
    let r = await st(p);
    c.check("reduced motion: finished frame at once (avatar sewn, name in, teammates up), no needle", r && !r.orb && /none/.test(r.nmClip) && r.crewIn === N && r.sheet !== true, r && { orb: r.orb, clip: r.nmClip, in: r.crewIn });
    await raw(c, "ut-reduced");
    await p.waitForFunction(() => !document.querySelector(".hw"), null, { timeout: 4000 }).catch(() => { });
    c.check("reduced motion: gone within ~2.4 s", !(await p.$(".hw")));
    await p.emulateMedia({ reducedMotion: "no-preference" });
    /* 7. 墨刊: plays with the normal avatar, no work strip */
    await boot(c, { ut: false });
    await p.evaluate(id => HW.play(id), id); await c.sleep(60); await seek(p, 3.2); await c.sleep(150);
    r = await st(p);
    c.check("墨刊: same animation, normal avatar, no work strip", r && !/\/avatars\/ut\//.test(r.img) && r.sheet === null && r.n === N, r && { img: r.img, sheet: r.sheet });
    await raw(c, "ink-3.20s");
    await p.evaluate(() => { const el = document.querySelector(".hw"); if (el) el.remove(); });
  },
  async cleanup(o) {
    if (SAVED === null) return;
    if (SAVED === false) fs.rmSync(LOG(o.SCRATCH), { force: true }); else fs.writeFileSync(LOG(o.SCRATCH), SAVED);
    SAVED = null;
  },
};
