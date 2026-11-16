/* t-avatar-live-refresh: a swapped avatar shows without reloading the page. The journey replaces one role's picture in the scratch copy,
 * runs tools/avatar_sizes.py (as a user or new_role.py does), and checks that the open page redraws that role's avatars with the new
 * manifest ETag: no reload (a window marker survives), the picture really changes, both sets (特典 avatars/ut and the plain avatars/).
 * Chromium also covers pull to refresh (App.refresh) with meta.avv hidden, i.e. without the poll's help.
 *   node tests/e2e/drive.js run tests/e2e/journeys/avrefresh.js --out work/<item>/verify/<run> --engines chromium,webkit
 * Fixture-safe: picks the role and a donor picture from whatever the board has; cleanup puts the original files back. */
const fs = require("fs"), path = require("path"), cp = require("child_process");
const SAVE = [];   // [file, copy] restored in cleanup
function sizes(S) { cp.execFileSync("python3", ["tools/avatar_sizes.py"], { cwd: S, encoding: "utf8" }); }
function swap(S, dir, id) {   // copy another role's picture over <id>'s (a different size, so the ETag moves) and regenerate the small copies
  const d = path.join(S, "avatars", dir), f = fs.readdirSync(d).find(n => n.startsWith(id + ".") && /\.(png|jpe?g|webp)$/i.test(n));
  if (!f) return null;
  const me = path.join(d, f), sz = fs.statSync(me).size;
  const donor = fs.readdirSync(d).filter(n => /\.png$/i.test(n) && !n.startsWith(id + ".") && !n.startsWith(".")).map(n => path.join(d, n)).find(p => fs.statSync(p).size !== sz);
  if (!donor) return null;
  if (!SAVE.some(s => s[0] === me)) { const keep = path.join(S, ".avr-" + dir.replace(/\W/g, "_") + "-" + f); fs.copyFileSync(me, keep); SAVE.push([me, keep]); }
  fs.copyFileSync(donor, me); sizes(S);
  return path.basename(donor);
}
/* the role's avatar nodes on screen: their manifest query and the biggest visible one (its box, padded, for the element shot) */
const look = (p, id, ut) => p.evaluate(([id, ut]) => {
  const key = `/avatars/${ut ? "ut/" : ""}_s/${encodeURIComponent(id)}-`, qs = new Set(); let best = null, ba = 0;
  document.querySelectorAll("img, [style*='/avatars/']").forEach(e => {
    const u = e.tagName === "IMG" ? e.getAttribute("src") || "" : e.style.backgroundImage || "";
    const i = u.indexOf(key); if (i < 0) return;
    qs.add((u.slice(i).split("?")[1] || "").replace(/["')].*$/, ""));
    const r = e.getBoundingClientRect(), a = r.width * r.height;
    if (a > ba && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && r.width > 8 && getComputedStyle(e).visibility !== "hidden") { ba = a; best = e; }
  });
  let box = null;
  if (best) { const r = best.getBoundingClientRect(), P = 18, L = Math.max(0, r.left - P), T = Math.max(0, r.top - P);   // the avatar plus a margin
    box = { x: L, y: T, width: Math.min(innerWidth, r.right + P) - L, height: Math.min(innerHeight, r.bottom + P + 14) - T }; }
  return { qs: [...qs], n: qs.size, shown: !!best, box, avv: App.ST.meta.avv, mark: window.__avr === 1 };
}, [id, ut]);
async function elShot(c, name, id, ut) {
  const f = await c.shot(name), l = await look(c.p, id, ut), g = f.replace(/\.png$/, "-el.png");
  let ok = false;
  if (l.box) try { await c.p.screenshot({ path: g, clip: l.box, timeout: 8000 }); ok = true; } catch (e) { c.note(`element clip failed (${String(e).slice(0, 80)}), full shot kept`); }
  if (!ok) fs.copyFileSync(f, g);
  return g;
}
async function pickRole(p, ut) {   // a role with a manifest entry whose avatar is on screen now
  const ids = await p.evaluate(() => Object.keys(App.ST.agents || {}).filter(k => App.ST.agents[k].status !== "working"));   // a working role shows its work sprite over the avatar
  const pref = ["buyer", ...ids];
  for (const id of pref) { if (!ids.includes(id)) continue; const l = await look(p, id, ut); if (l.shown) return id; }
  return null;
}
async function setUt(c, on) {
  await c.p.evaluate(u => { if (u) localStorage.setItem("rt.ut", JSON.stringify("ut")); else localStorage.setItem("rt.ut", JSON.stringify("ink")); }, on);
  await c.p.reload({ waitUntil: "load" });
  await c.p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 15000 }); await c.sleep(2500);
}
async function phase(c, ut, viaRefresh) {
  const p = c.p, tag = (ut ? "ut" : "plain") + (viaRefresh ? "-pull" : "");
  if (!ut && !(await p.evaluate(() => Object.keys(App.ST.meta.avatars || {}).some(k => App.ST.agents[k])))) { c.note("plain: this board has no avatars/<id> pictures (clean install), skipped"); return; }
  const id = await pickRole(p, ut);
  if (!c.check(`${tag}: some role's avatar from the ${ut ? "avatars/ut" : "avatars"} manifest is on screen`, id, id)) return;
  await p.evaluate(() => { window.__avr = 1; });
  const a = await look(p, id, ut);
  const shotA = await elShot(c, `${tag}-${id}-before`, id, ut), bufA = fs.readFileSync(shotA);
  if (viaRefresh) await p.route("**/api/state*", async r => { try { const res = await r.fetch(); let j; try { j = await res.json(); } catch (_) { return await r.fulfill({ response: res }); } if (j.meta) delete j.meta.avv; await r.fulfill({ response: res, json: j }); } catch (_) { }   /* the page closed mid long poll */ });
  if (viaRefresh) { await p.evaluate(() => App.refresh()); await c.sleep(800); }   // restart the waiting long poll so it goes through the route
  const donor = swap(c.SCRATCH, ut ? "ut" : ".", id);
  if (!c.check(`${tag}: swapped ${id}'s picture in the scratch copy`, donor, donor)) return;
  if (viaRefresh) {
    await c.sleep(5000);
    const mid = await look(p, id, ut);
    c.check(`${tag}: with meta.avv hidden the poll alone does not pick it up (control)`, mid.qs.join() === a.qs.join(), mid);
    const ok = await p.evaluate(() => App.refresh());   // what the phone's pull-to-refresh calls on release
    c.check(`${tag}: App.refresh() (pull to refresh) answered`, ok === true, ok);
  }
  const b = await c.until(async () => { const l = await look(p, id, ut); return l.n && l.qs.every(q => !a.qs.includes(q)) ? l : null; }, viaRefresh ? 4000 : 30000, 300);
  c.check(`${tag}: ${id}'s avatars switched to the new manifest ETag without a reload`, b && b.mark, { before: a, after: b || await look(p, id, ut) });
  await c.sleep(1200);   // let the new webp decode
  const shotB = await elShot(c, `${tag}-${id}-after`, id, ut);
  c.check(`${tag}: the picture on screen changed`, !fs.readFileSync(shotB).equals(bufA), { before: path.basename(shotA), after: path.basename(shotB) });
  if (!viaRefresh) c.check(`${tag}: meta.avv moved`, b && b.avv && b.avv !== a.avv, { before: a.avv, after: b && b.avv });
  if (viaRefresh) await p.unrouteAll({ behavior: "ignoreErrors" });
}
module.exports = {
  views: ["desk", "phone"],
  hash: () => "#page=review",
  async run(c) {
    await setUt(c, true);
    await c.shot("ut-page-before");
    await phase(c, true, false);
    await setUt(c, false);
    await phase(c, false, false);
    if (c.engine === "chromium") { await setUt(c, true); await phase(c, true, true); }   // WebKit's page.route misses fetch()
  },
  async cleanup(o) {   // put every swapped picture back and regenerate the small copies
    if (!SAVE.length) return;
    for (const [f, keep] of SAVE.splice(0)) { fs.copyFileSync(keep, f); fs.unlinkSync(keep); }
    sizes(o.SCRATCH);
  },
};
