// Dashboard core: the roster (agents, agent, aname ...) and avatars (avatar URLs, sizes, the Underthread set, av()).
// t-oss-struct S10 (A2): moved out of app.js unchanged.

import { t } from "./i18n.js";
import { ST, UI } from "./store.js";
import { setChatCount } from "../views/chat.js";
import { toolBadge } from "../views/header.js";
import { render } from "../app.js";
const agents = () => Object.values(ST.agents || {}).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
// q-1030-2214: a thread/log "who" that is not a roster id but a role's own name (e.g. its name_en, "steward" for manager) resolves to that role,
// so the row gets its real avatar and name instead of the pixel fallback.
const agentAlias = id => { const k = String(id || "").trim().toLowerCase(); return k ? Object.values(ST.agents || {}).find(a => [a.name_en, a.name, a.name_orig, a.name_en_orig].some(n => n && String(n).trim().toLowerCase() === k)) : null; };
const agent = id => (ST.agents || {})[id] || agentAlias(id) || { id, name: id, color: "#888" };
const aname = a => (UI.lang === "en" ? a.name_en : a.name) || a.name || a.id;
const atitle = a => (UI.lang === "en" ? a.title_en : a.title) || a.title || "";
const aduty = a => (UI.lang === "en" ? a.duty_en : a.duty) || a.duty || "";
/* ri1105-P1: small WebP copies from tools/avatar_sizes.py (avatars/_s/, 160 px for round avatars, 512 px for big art slots). Used only while
   avatars/_s/index.json names the same file with the same ETag as the original; one HEAD per avatar per session checks that, so a replaced
   avatar falls back to its original until the script runs again. The manifest is kept in localStorage so a cold start picks the small files at once. */
const AVS = { m: (() => { try { return JSON.parse(localStorage.getItem("rt.avs") || "null"); } catch (_) { return null; } })(), bad: new Set(), chk: false };
function avsCheck() {   // once per session: does each original still match the manifest? (HEAD = headers only)
  avuCheck();
  if (AVS.chk || !AVS.m || !ST) return; AVS.chk = true;
  const run = () => Object.entries(ST.meta.avatars || {}).forEach(([id, f]) => { const m = AVS.m[id]; if (!m || m.src !== f) return;
    fetch(`/avatars/${encodeURIComponent(f)}`, { method: "HEAD", cache: "no-cache" }).then(r => { if (r.ok && r.headers.get("ETag") && r.headers.get("ETag") !== m.etag) { AVS.bad.add(id); render(); } }).catch(() => { }); });
  (window.requestIdleCallback || (f => setTimeout(f, 1500)))(run);
}
/* t-avatar-style: the Underthread set (avatars/ut/<id>.png -> avatars/ut/_s/, same script, same manifest format). Shown only while html[data-ut] is set
   (index.html sets it before first paint, so the first render already picks it). A role with no ut file (the user's own "me" has none on purpose) keeps
   its normal avatar. Same ETag check as AVS, one HEAD per file per session. Switching 配色 re-renders and rewrites the /avatars/ URLs left in the DOM. */
const AVU = { m: (() => { try { return JSON.parse(localStorage.getItem("rt.avs.ut") || "null"); } catch (_) { return null; } })(), bad: new Set(), chk: false };
/* open-source build: the shipped set's index.json was written on another machine and a git checkout resets mtimes, so compare only the size half
   of the ETag ("<mtime hex>-<size hex>"); a replaced file almost always changes size. Run tools/avatar_sizes.py after editing avatars/ut/. */
const utSz = e => String(e || "").replace(/"/g, "").split("-").pop();
function avuCheck() {
  if (AVU.chk || !AVU.m) return; AVU.chk = true;
  const run = () => Object.entries(AVU.m).forEach(([id, m]) => { if (!m || !m.src) return;
    fetch(`/avatars/ut/${encodeURIComponent(m.src)}`, { method: "HEAD", cache: "no-cache" }).then(r => { if (!r.ok || (r.headers.get("ETag") && utSz(r.headers.get("ETag")) !== utSz(m.etag))) { AVU.bad.add(id); if (document.documentElement.dataset.ut) { render(); avSweep(); } } }).catch(() => { }); });
  (window.requestIdleCallback || (f => setTimeout(f, 1500)))(run);
}
const AV_RE = /\/avatars\/(?:ut\/)?(?:_s\/)?([^/?'")]+?)(?:-(160|512)\.webp|\.(?:png|jpe?g|webp|gif))(?:\?[^'")]*)?/g;
function avSweep() {   // nodes that do not come back with render() (voice pill / big face cache their src by dataset.id) get the current set's URL
  if (!ST) return;
  const fix = u => u.replace(AV_RE, (all, id, sz) => { try { id = decodeURIComponent(id); } catch (_) { } return ST.agents && ST.agents[id] || id === "me" ? avatarUrl(agent(id), sz === "512") : all; });
  document.querySelectorAll('img[src*="/avatars/"]').forEach(i => { const n = fix(i.getAttribute("src")); if (n !== i.getAttribute("src")) i.setAttribute("src", n); });
  document.querySelectorAll('[style*="/avatars/"]').forEach(e => { const b = e.style.backgroundImage, n = fix(b); if (n !== b) e.style.backgroundImage = n; });
  /* open-source build: with no avatars/<id>.png the Ink avatar is a drawn data: SVG that fix() cannot map back to a role, so the phone strip
     (home.js keeps its panels between renders) is set from its data-id instead */
  document.querySelectorAll(".dp[data-id]").forEach(d => { const a = agent(d.dataset.id); if (!a) return; const n = `url("${avatarUrl(a, true)}")`;
    d.querySelectorAll(".dp-uti, .dp-img").forEach(e => { if (e.style.backgroundImage !== n) e.style.backgroundImage = n; });
    /* t-chibi-anim: the strip keeps its panels between renders, so the work-sheet child follows the manifest / palette here too */
    const u = d.querySelector(".dp-uti"), c = u && u.querySelector(".dp-utw"), ws = wsheet(a, 320);
    if (u && ws && !c) u.insertAdjacentHTML("beforeend", `<i class="dp-utw" style="${esc(ws.slice(1))}"></i>`); else if (c && !ws) c.remove(); });
}
let AVU_ON = !!document.documentElement.dataset.ut;
/* t-rm-pixel-office: a role with no avatars/<id> file gets a colour disc with the first character of its name (was office.js's pixel head) */
const AVSVG = {};
function avatarSvg(a) {
  const ch = ([...String(aname(a) || a.id || "?").trim()][0] || "?").toUpperCase(), c = /^#[0-9a-f]{3,8}$/i.test(a.color || "") ? a.color : "#888", k = c + ch;
  return AVSVG[k] || (AVSVG[k] = "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${c}"/><text x="32" y="34" text-anchor="middle" dominant-baseline="central" font-family="-apple-system,PingFang SC,Hiragino Sans GB,sans-serif" font-size="30" font-weight="600" fill="#fff">${esc(ch)}</text></svg>`));
}
function avatarUrl(a, big) {
  /* t-roster-rail: a picture you picked on the 团队 page (agents[id].avpick, core/rolelook.py) wins in every palette; s = small copies exist */
  const pk = a && a.avpick;
  if (pk && pk.src) return pk.s ? `/avatars/_pick/${encodeURIComponent(a.id)}-${big ? 512 : 160}.webp?${encodeURIComponent(pk.v)}` : `/avatars/${pk.src.split("/").map(encodeURIComponent).join("/")}?${encodeURIComponent(pk.v)}`;
  if (document.documentElement.dataset.ut && AVU.m && !AVU.bad.has(a.id)) { const u = AVU.m[a.id]; if (u && u.etag) return `/avatars/ut/_s/${encodeURIComponent(a.id)}-${big ? 512 : 160}.webp?${encodeURIComponent(u.etag.replace(/"/g, ""))}`; }
  const f = ST.meta.avatars && ST.meta.avatars[a.id];
  if (!f) return avatarSvg(a);
  const m = AVS.m && AVS.m[a.id];
  if (m && m.src === f && !AVS.bad.has(a.id)) return `/avatars/_s/${encodeURIComponent(a.id)}-${big ? 512 : 160}.webp?${encodeURIComponent(m.etag.replace(/"/g, ""))}`;
  return `/avatars/${encodeURIComponent(f)}`;
}
// t-m2-a ⓪ (L-1029-a669): while RING1 is a Set, a working agent keeps its ring on ONE avatar only (the first av() call for it); later ones are drawn idle.
// A list that calls av() per row renders inside ringOnce(), newest row first, so the ring lands on the newest row (DM threads do the same by index).
let RING1 = null;
function ringOnce(fn, set) { const prev = RING1; RING1 = set || new Set(); try { return fn(); } finally { RING1 = prev; } }
/* t-chibi-anim: under 特典 (html[data-ut]) a working agent's needle-thread avatar plays a 4-frame sprite sheet (avatars/ut/_s/<id>-work-<160|320|512>.webp,
   frames side by side, frame 1 = the idle art plus the prop). Returns the inline custom property for the sheet, or "" (other palettes / no sheet). CSS in theme-ut.css. */
/* t-hr-registry: no role id lists in the web. ST.meta.art = {id: {jpg, panel, cut, sheet}} is scanned by the server from web/art/ and avatars/ut/_s/;
   a.tint / a.seat / a.pipe come from roster.json via state.agents. A role with no art falls back to its avatar (or the letter circle). */
const hasArt = (a, k) => !!(a && ST && ST.meta && ST.meta.art && (ST.meta.art[a.id] || {})[k]);
const tintOf = a => [a && a.tint, a && a.color].find(c => /^#[0-9a-f]{3,8}$/i.test(c || "")) || "var(--accent)";
/* t-avatar-live-refresh: the sheet URL carries meta.avv, so a sheet replaced together with a tools/avatar_sizes.py run is fetched again */
function wsheet(a, sz) { return a && document.documentElement.dataset.ut && hasArt(a, "sheet") && !AVU.bad.has(a.id) && !(a.avpick && a.avpick.src !== `ut/${a.id}.png`) ? `;--wsheet:url('/avatars/ut/_s/${encodeURIComponent(a.id)}-work-${sz || 160}.webp?v=${encodeURIComponent(ST.meta.avv || 1)}')` : ""; }
function av(a, cls = "", forItem) {
  if (a === "me" || a.id === "me") {   // R4-17: avatars/me.* if the user added one, else their initial (same rule as the phone chat, mobile.js meAv)
    const m = (ST.meta || {}), o = m.owner;
    if ((m.avatars || {}).me) return `<span class="av av-me img ${cls}" style="background-image:url('${avatarUrl({ id: "me" })}')"></span>`;
    return `<span class="av av-me ${cls}"><b>${esc(o && !o.startsWith("<") ? [...o.trim()][0] : (UI.lang === "en" ? "M" : "我"))}</b></span>`;
  }
  // t-working-avatar: ONE place for the "working" look (CSS in style.css). --wp = minus the wall-clock phase of the 4 s cycle, so a node created by a re-render
  // starts exactly where the one it replaces was: polling never restarts the ring. Static (no animation) under prefers-reduced-motion.
  // t-working-item-highlight: inside a row about item X (forItem), the ring stays off when we KNOW the agent is on another item (agents[].item set and different).
  let w = a.status === "working" && !(forItem && a.item && a.item !== forItem);
  if (w && RING1) { if (RING1.has(a.id)) w = false; else RING1.add(a.id); }
  const tb = toolBadge(a), ws = w ? wsheet(a, 160) : "";
  return `<span class="av ${cls} ${w ? "working" : ""}${ws ? " wsheet" : ""}" style="background-image:url('${avatarUrl(a)}')${w ? `;--wp:${(-(Date.now() % 4000) / 1000).toFixed(3)}s` : ""}${ws}" title="${esc(aname(a))}"${w ? ` data-working="1"` : ""}>${w && !tb ? `<i class="aw" title="${t("working")}"></i>` : ""}${tb}</span>`;
}

/* t-avatar-live-refresh: (re)read both manifests. At load (wireAv), when the server's avatar version meta.avv moves (avvSeen) and on pull to refresh
   (App.refresh), so a swapped avatar or a new role's avatar shows without killing the app. again = a reload: the per-session ETag check runs once more
   and the chat / cached nodes are redrawn even when only the URL query (the new ETag) changed. */
function avLoad(again) {
  const one = (url, o, key, ut) => fetch(url, { cache: "no-cache" }).then(r => r.ok ? r.json() : null).catch(() => null).then(m => {
    const was = JSON.stringify(o.m); o.m = m && typeof m === "object" ? m : null;
    try { if (o.m) localStorage.setItem(key, JSON.stringify(o.m)); else localStorage.removeItem(key); } catch (_) { }
    return JSON.stringify(o.m) !== was && (!ut || !!document.documentElement.dataset.ut);
  });
  AVU.cold = !AVU.m;
  AVS.ready = one("/avatars/_s/index.json", AVS, "rt.avs");
  AVU.ready = one("/avatars/ut/_s/index.json", AVU, "rt.avs.ut", true);
  return Promise.all([AVS.ready, AVU.ready]).then(([s, u]) => {
    if (again) { AVS.bad.clear(); AVU.bad.clear(); AVS.chk = AVU.chk = false; if (ST) avsCheck(); }
    if (ST && (s || u || again)) { setChatCount(-1); render(); avSweep(); }   /* chatCount: the chat skips an unchanged list, and avSweep cannot rewrite the drawn (data:) fallback avatars */
    return s || u;
  });
}
let AVV = null;   // the meta.avv this page last loaded the manifests for (null = not seen yet: the load-time fetch covers it)
function avvSeen(v) {
  if (v == null) return;   // an older server sends no avv: keep the load-time manifests
  if (AVV === null) { AVV = v; return; }
  if (v !== AVV) { AVV = v; avLoad(true); }
}
function wireAv() {
  avLoad(false);
  document.addEventListener("theme:change", () => { const on = !!document.documentElement.dataset.ut; if (on === AVU_ON) return; AVU_ON = on; if (ST) { setChatCount(-1); render(); avSweep(); } });
}

export { agents, agentAlias, agent, aname, atitle, aduty, AVS, avsCheck, AVU, utSz, avuCheck, AV_RE, avSweep, AVU_ON, AVSVG, avatarSvg, avatarUrl, RING1, ringOnce, hasArt, tintOf, wsheet, av, wireAv, avLoad, avvSeen };
