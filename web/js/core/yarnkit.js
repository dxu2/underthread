// t-yarn-anim (level 2 yarn kittens, user 11-21): a small knit kitten plays by the avatar of whoever is working right now on the HOME
// 「此刻在忙 / Working now」 card (user 11-22 10:21, screenshot: the Today card) - the phone A2 team card rows (home.js) and the desk busy widget's
// patch (widgets.js, 特典 only: other palettes draw the role's art there, no avatar). Nowhere else (the TEAM rail and the phone chat list lost it).
// It wakes with a one-off start beat, plays along while the role works (status working and --item set), and when the role stops it curls up
// (done beat) and fades out while the finished row is still there. Idle avatars carry no kitten and no moving eyes.
//
// Two kinds of role:
//  - a role with a level-2 script (meta.art[id].yarn, files under art/yarn/<id>/, usually in your local/ layer): while it works its eyes become
//    a moving layer (looks at the kitten, smiles, closes), drawn over eyeless copies of its work strip. Only under 特典 (html[data-ut]) and only
//    while the role shows its own 特典 avatar (a picked picture has other eyes).
//  - everyone else (and every role in other palettes): the generic kitten layer only (art/yarn/generic/).
//
// Layers (CSS in css/yarnkit.css): .yk wraps the avatar; i.yk-ey = eyes, i.yk-fx = kitten + prop (130% of the avatar box, not clipped).
// Each layer is one horizontal sprite stepped with steps(N, jump-none). The loop runs on the same 16 s wall-clock phase (--wp) as the work strip.
// A beat is decided only when the state changes while the home is on screen; a reload or a re-render draws the target state.
// data-ykk = what a re-render must not ignore (role, level-2 version, light/dark art, awake or not): widgets.js norm() compares only that, so
// a poll never swaps the node (beats hand over in place, animationend below). prefers-reduced-motion: a static kitten, no beats.
//
// t-yarn-sleep (user 11-22, ask c2a99c): the kitten is an easter egg, never explained anywhere. It can show only once the role has worked for
// 5 minutes (agents[id].since, set by the server when the status flips to working, so a reload or another device agrees), and then only if
// this stretch of work wins one 1-in-3 draw seeded from id + since (same answer everywhere, no re-roll). At night (local clock 22:30-08:00,
// the same hours as the Notice line's quietNight) it sleeps curled up (pose A, inline SVG: breathing + z's; a level-2 role closes its eyes). A tap on the kitten
// (i.yk-hit) stretches it by day and rolls it over at night (WAAPI, once per 10 s) and never opens the chat or the card. 设置 › 外观 › 小猫彩蛋
// (rt.ykOn, per device, default on) turns every home kitten off. Test hook: window.__yk = { now, draw, since } (tests/e2e/journeys/yarnkit.js).
import { ST } from "./store.js";

const PH = { start: [16, 1.6], loop: [32, 3.2], review: [16, 1.6], done: [24, 2.4], rest: [1, .1], sleep: [1, 4] };
const GEN = "/static/art/yarn/generic/", GV = "1";
const SEEN = {}, BEAT = {}, T0 = performance.now();
const OUT = .4;   /* seconds: the sleeping kitten fades after the done beat */
const IN = .6, GATE = 5 * 60000, NAP = 4000;   /* the night kitten fades in over .6 s; 5 minutes of work first; one breath = 4 s */
const LS_ON = "rt.ykOn";
let onK = (() => { try { return localStorage.getItem(LS_ON) !== "0"; } catch (_) { return true; } })();
window.addEventListener("storage", e => { if (e.key === LS_ON) onK = e.newValue !== "0"; });
const ykOn = () => onK;
const night = d => { const m = d.getHours() * 60 + d.getMinutes(); return m >= 22 * 60 + 30 || m < 8 * 60; };   /* 22:30-08:00, as ticker.js quietNight */
const HK = () => window.__yk || null;   /* test hook only (never set by the app): { now: ms, draw: bool, since: iso | ms } */
const nowMs = () => { const h = HK(); return h && h.now != null ? +h.now : Date.now(); };
/* the draw: one in three work stretches, from the role id + its since (FNV-1a, the same on every device and every reload) */
function lot(id, since) {
  let h = 2166136261; const s = id + "|" + since;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 3 === 0;
}
try { localStorage.removeItem("rt.yk"); } catch (_) { }   /* the old review-pose memory (v1) is not used any more */
const RM = matchMedia("(prefers-reduced-motion: reduce)");

/* light or dark page: the kitten's halo is the page colour (-l #F7ECDA, -d #1F110D) */
let toneK = null, tone = "d";
function lum(c) {
  let m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(c), v;
  if (m) v = [m[1], m[2], m[3]].map(x => +x / 255);
  else if ((m = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(c))) v = [m[1], m[2], m[3]].map(Number);
  else return 0;
  return .2126 * v[0] + .7152 * v[1] + .0722 * v[2];
}
function toneNow() {
  const d = document.documentElement, k = [d.dataset.theme, d.dataset.ut, d.dataset.texture, d.dataset.stage].join("|");
  if (k !== toneK && document.body) {
    const p = document.createElement("i"); p.style.cssText = "position:absolute;width:0;height:0;color:var(--bg)"; document.body.appendChild(p);
    tone = lum(getComputedStyle(p).color) > .5 ? "l" : "d"; p.remove(); toneK = k;
  }
  return tone;
}

/* a level-2 role: script present, 特典 on, its own 特典 avatar showing */
function l2(a) {
  const v = ST && ST.meta && ST.meta.art && (ST.meta.art[a.id] || {}).yarn;
  return v && document.documentElement.dataset.ut && !(a.avpick && a.avpick.src !== `ut/${a.id}.png`) ? v : 0;
}
/* run = working on a card for 5+ minutes and this stretch won the draw (day); sleep = the same at night; off = anything else (no kitten) */
function target(a, busy) {
  if (!busy || !a.item || !onK) return "off";
  const h = HK(), sn = h && h.since != null ? h.since : a.since, t0 = typeof sn === "number" ? sn : Date.parse(sn || ""), now = nowMs();
  if (!(now - t0 >= GATE)) return "off";
  if (!(h && h.draw != null ? !!h.draw : lot(a.id, String(sn)))) return "off";
  return night(new Date(now)) ? "sleep" : "run";
}
/* night pose A (t-yarn-sleep mock): curled loaf, head on the paws, tail thread wrapped in front; halo = the page colour of the sprites */
const NAPC = { l: ["#2B1913", "#F7ECDA", "#8A6A55"], d: ["#F4E1C2", "#1F110D", "#C9AD92"] };
function napSvg() {
  const [ink, halo, zc] = NAPC[toneNow()], sh = '<ellipse cx="35" cy="41" rx="11.5" ry="6.8"/><ellipse cx="24.5" cy="42" rx="6.6" ry="5.4"/><path d="M19.6 38.4L18.8 33.6L23 36.4Z"/><path d="M25.6 36.6L29 33.4L29.2 38Z"/>', th = "M46 42Q49 47.6 39 47.8Q29 48 20.5 47";
  return `<svg class="yk-nap" viewBox="0 0 52 52"><g transform="translate(45 46) scale(.66) translate(-47 -49)"><g class="yk-roll"><g class="bd"><g fill="${halo}" stroke="${halo}" stroke-width="3.2" stroke-linejoin="round">${sh}</g><g fill="${ink}" stroke="${ink}" stroke-width=".6" stroke-linejoin="round">${sh}</g><path d="M21.2 42.2Q22.5 43.6 23.8 42.2" fill="none" stroke="${halo}" stroke-width=".9" stroke-linecap="round"/></g><path d="${th}" fill="none" stroke="${halo}" stroke-width="3.4" stroke-linecap="round"/><path d="${th}" fill="none" stroke="${ink}" stroke-width="1.7" stroke-dasharray="1.6 1.1"/></g><text class="z" x="30" y="31" fill="${zc}">z</text><text class="z z2" x="34" y="26" fill="${zc}">z</text></g></svg>`;
}
function vars(id, v, ph, wp) {
  if (ph === "sleep") {   /* inline SVG kitten (no sprite); a level-2 role gets the closed-eyes pose over its eyeless art */
    const u = f => `url('/static/art/yarn/${encodeURIComponent(id)}/${f}?v=${v}')`;
    let s = `--wp:${wp.toFixed(3)}s;--yk-bp:${(-(Date.now() % NAP) / 1000).toFixed(3)}s;--yk-n:1;--yk-d:4s;--yk-fx:none;--yk-fx0:none`;
    if (v) s += `;--yk-pose:${u("poses.svg")};--yk-idle:${u("idle-512.webp")};--yk-work:${u("work-320.webp")}`;
    return s;
  }
  const [n, d] = PH[ph], tn = toneNow(), u = f => `url('/static/art/yarn/${encodeURIComponent(id)}/${f}?v=${v}')`, g = f => `url('${GEN}${f}?v=${GV}')`;
  let s = `--wp:${wp.toFixed(3)}s;--yk-n:${n};--yk-d:${d}s;--yk-fx:${v ? u(`fx-${ph}-${tn}.svg`) : g(`fx-${ph}-${tn}.svg`)};--yk-fx0:${v ? u(`fx-rest-${tn}.svg`) : g(`fx-rest-${tn}.svg`)}`;
  if (v) s += `;--yk-ey:${u(`eyes-${ph}.svg`)};--yk-pose:${u("poses.svg")};--yk-idle:${u("idle-512.webp")};--yk-work:${u("work-320.webp")}`;
  return s;
}
/* state -> [class, phase, --wp] at time now. A done beat ends in the out fade (yk-out), then the kitten is gone (yk-off). */
function look(id, st, now) {
  const b = BEAT[id];
  if (b && b.to === st) {
    const el = (now - b.t0) / 1000;
    if (b.k === "in") { if (el < IN) return ["yk-sleep yk-in", "sleep", -el]; }   /* night: fades in already asleep */
    else if (b.k === "out") { if (el < OUT) return ["yk-off yk-out", "sleep", -el]; }   /* night: the sleeping kitten just fades */
    else {
      const d = PH[b.k][1];
      if (el < d) return [`yk-${b.k} yk-beat`, b.k, -el];
      if (b.k === "done" && el < d + OUT) return ["yk-off yk-out", "rest", -(el - d)];
    }
    delete BEAT[id];
  }
  if (st === "run") return ["yk-run", "loop", -(now % 16000) / 1000];
  if (st === "sleep") return ["yk-sleep", "sleep", 0];
  return ["yk-off", "rest", 0];
}
/* html = the avatar from App.av(a); busy = the role is working (not just the steward being online) */
function yk(a, html, busy) {
  if (!a || !a.id || a.id === "me") return html;
  const now = Date.now(), st = seen(a, busy, now);
  return wrap(a.id, l2(a), look(a.id, st, now), html);
}
/* remember the role's state; a change while the home is drawn decides a beat */
function seen(a, busy, now) {
  const st = target(a, !!busy), from = SEEN[a.id];
  if (from && from !== st) {
    /* the first seconds after a load may still show the boot snapshot (store.js snapBoot): its old state changing is not a real change */
    /* off -> run = start beat, run -> off = done beat, off <-> sleep = a fade; day <-> night while it works = a plain swap */
    const k = from === "off" ? (st === "run" ? "start" : "in") : st === "off" ? (from === "run" ? "done" : "out") : "";
    if (!k || RM.matches || performance.now() - T0 < 4000) delete BEAT[a.id];
    else BEAT[a.id] = { k, t0: now, to: st };
  }
  SEEN[a.id] = st;
  return st;
}
/* every render of the home card: all roles, also the ones it does not draw (a role that stopped is no longer drawn, and its next start must
   still count as a start) */
function ykSync() {
  const now = Date.now();
  Object.values((ST && ST.agents) || {}).forEach(a => { if (a && a.id && a.id !== "me") seen(a, a.status === "working", now); });
}
/* the re-render key: role | level-2 version shown | light/dark art | r (start or loop: they hand over in place) / d (done beat) / o (fade) / 0 (none) */
const kk = (id, v, cls) => `${id}|${v || 0}|${toneNow()}|${/yk-out/.test(cls) ? "o" : /yk-off/.test(cls) ? 0 : /yk-sleep/.test(cls) ? "s" : /yk-done/.test(cls) ? "d" : "r"}`;
/* the wrapper: no layers when off; the level-2 eyes only while the kitten is awake (start / loop / done) */
function wrap(id, v, [cls, ph, wp], html) {
  const off = /yk-off/.test(cls), out = /yk-out/.test(cls), e = v && !off, nap = ph === "sleep";
  return `<span class="yk ${cls}${e ? " yk-l2" : ""}" data-yk="${esc(id)}" data-ykv="${v || ""}" data-ykk="${kk(id, e ? v : 0, cls)}" style="${vars(id, e ? v : 0, ph, wp)}">${html}${e ? '<i class="yk-ey" aria-hidden="true"></i>' : ""}${off && !out ? "" : `<i class="yk-fx" aria-hidden="true">${nap ? napSvg() : ""}</i>`}${off ? "" : '<i class="yk-hit" aria-hidden="true"></i>'}</span>`;
}
/* a beat that ends before the next re-render hands over in place (the avatar node stays): start -> the loop, done -> the out fade
   (the eyes go, the sleeping kitten fades), fade end -> no layers */
function wireYk() {
  document.addEventListener("animationend", e => {
    const f = e.target;
    if (!f.classList || !f.classList.contains("yk-fx")) return;
    const w = f.parentElement;
    if (!w || !w.classList.contains("yk")) return;
    const id = w.dataset.yk, v = +w.dataset.ykv || 0;
    if (e.animationName === "yk-fade") {
      if (w.classList.contains("yk-out")) { f.remove(); const h = w.querySelector(":scope > .yk-hit"); if (h) h.remove(); w.classList.remove("yk-out"); w.dataset.ykk = kk(id, 0, w.className); }
      else if (w.classList.contains("yk-in")) w.classList.remove("yk-in");
      return;
    }
    const b = BEAT[id];
    if (e.animationName !== "yk-x" || !w.classList.contains("yk-beat") || !b) return;
    const [cls, ph, wp] = look(id, SEEN[id] || "off", b.t0 + PH[b.k][1] * 1000 + 1), on = cls === "yk-run";
    if (ph === "sleep") { kick(); return; }   /* night fell during the beat: a re-render swaps the layers (ykInto / widgets norm see the key) */
    w.className = `yk ${cls}${on && v ? " yk-l2" : ""}`; w.dataset.ykk = kk(id, on ? v : 0, cls);
    if (!on) { const ey = w.querySelector(".yk-ey"); if (ey) ey.remove(); }
    w.setAttribute("style", vars(id, on ? v : 0, ph, on ? -(Date.now() % 16000) / 1000 : 0));
  });
  /* a tap on the kitten: its own one-off move, never the avatar's chat / the row's card (capture on window runs before every document listener) */
  const eat = e => { const h = e.target.closest && e.target.closest(".yk-hit"); if (!h) return null; e.stopImmediatePropagation(); return h; };
  window.addEventListener("pointerdown", eat, true);
  window.addEventListener("click", e => { const h = eat(e); if (h) { e.preventDefault(); poke(h.parentElement); } }, true);
  /* the 5-minute mark, the draw and 22:30 / 08:00 pass without a poll: redraw the home when a drawn role's kitten should change */
  setInterval(() => {
    if (document.hidden || !ST || !ST.agents) return;
    if (Object.values(ST.agents).some(a => a && a.id && SEEN[a.id] && SEEN[a.id] !== target(a, a.status === "working") && document.querySelector(`[data-yk="${CSS.escape(a.id)}"]`))) kick();
  }, 15000);
}
function kick() { const A = window.App; if (A && A.refreshPage) A.refreshPage(); }
/* one-off moves (WAAPI, so the sprite loop keeps its own animation): day = a stretch, night = a roll-over; once per 10 s per kitten */
const POKED = {};
const STRETCH = [{ transform: "none" }, { transform: "scale(1.04, .88)", offset: .2 }, { transform: "translateX(3%) scale(1.24, .8) skewX(-10deg)", offset: .5 }, { transform: "scale(.96, 1.06)", offset: .8 }, { transform: "none" }];
const ROLL = [{ transform: "none" }, { transform: "scale(1.06, .86)", offset: .2 }, { transform: "translateY(-6%) scale(-1, .92)", offset: .5 }, { transform: "scale(-1, 1)", offset: .62 }, { transform: "scale(1.05, .9)", offset: .85 }, { transform: "none" }];
function poke(w) {
  if (!w || !w.classList.contains("yk")) return;
  const id = w.dataset.yk, t = Date.now(), nap = w.classList.contains("yk-sleep");
  if (RM.matches || !(nap || w.classList.contains("yk-run")) || t - (POKED[id] || 0) < 10000) return;
  POKED[id] = t;
  const el = nap ? w.querySelector(".yk-fx .yk-roll") : w.querySelector(":scope > .yk-fx");
  if (el && el.animate) el.animate(nap ? ROLL : STRETCH, { duration: nap ? 1200 : 1000, easing: "cubic-bezier(.3,.7,.3,1)" });
}
/* 设置 › 外观 › 小猫彩蛋 (per device): off = no home kitten at all; the change takes the target state at the next draw, without a beat */
function ykSet(on) {
  onK = !!on;
  try { if (on) localStorage.removeItem(LS_ON); else localStorage.setItem(LS_ON, "0"); } catch (_) { }
  Object.values((ST && ST.agents) || {}).forEach(a => { if (a && a.id && a.id !== "me") { delete BEAT[a.id]; SEEN[a.id] = target(a, a.status === "working"); } });
}

/* in place (phone A2 rows): the avatar node is kept unless its own markup changed (its work strip never restarts); the wrapper only takes the new
   class / vars / layers when its data-ykk key changed, so a poll in the middle of a beat changes nothing */
function ykInto(host, a, html, busy) {
  const t = document.createElement("template"); t.innerHTML = yk(a, html, busy).trim();
  const w1 = t.content.firstElementChild, w0 = host.firstElementChild;
  if (!w1 || !w0 || !w0.classList.contains("yk") || w0.dataset.yk !== w1.dataset.yk) { host.replaceChildren(t.content); return host.firstElementChild; }
  const a0 = w0.firstElementChild, a1 = w1.firstElementChild;
  if (a0 && a1 && a0.outerHTML !== a1.outerHTML) a0.replaceWith(a1);
  if (w0.dataset.ykk === w1.dataset.ykk) return w0;
  w0.className = w1.className; ["data-ykv", "data-ykk", "style"].forEach(k => w0.setAttribute(k, w1.getAttribute(k)));
  [".yk-ey", ".yk-fx", ".yk-hit"].forEach(q => { const o = w0.querySelector(":scope > " + q), n = w1.querySelector(":scope > " + q); if (o && !n) o.remove(); else if (n && !o) w0.append(n); else if (o && n) o.replaceWith(n); });
  return w0;
}

export { yk, ykInto, ykSync, wireYk, toneNow, ykOn, ykSet };
