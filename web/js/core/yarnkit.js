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
import { ST } from "./store.js";

const PH = { start: [16, 1.6], loop: [32, 3.2], review: [16, 1.6], done: [24, 2.4], rest: [1, .1] };
const GEN = "/static/art/yarn/generic/", GV = "1";
const SEEN = {}, BEAT = {}, T0 = performance.now();
const OUT = .4;   /* seconds: the sleeping kitten fades after the done beat */
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
/* run = working on a card right now (busy and --item set); off = anything else (no kitten) */
const target = (a, busy) => busy && a.item ? "run" : "off";
function vars(id, v, ph, wp) {
  const [n, d] = PH[ph], tn = toneNow(), u = f => `url('/static/art/yarn/${encodeURIComponent(id)}/${f}?v=${v}')`, g = f => `url('${GEN}${f}?v=${GV}')`;
  let s = `--wp:${wp.toFixed(3)}s;--yk-n:${n};--yk-d:${d}s;--yk-fx:${v ? u(`fx-${ph}-${tn}.svg`) : g(`fx-${ph}-${tn}.svg`)};--yk-fx0:${v ? u(`fx-rest-${tn}.svg`) : g(`fx-rest-${tn}.svg`)}`;
  if (v) s += `;--yk-ey:${u(`eyes-${ph}.svg`)};--yk-pose:${u("poses.svg")};--yk-idle:${u("idle-512.webp")};--yk-work:${u("work-320.webp")}`;
  return s;
}
/* state -> [class, phase, --wp] at time now. A done beat ends in the out fade (yk-out), then the kitten is gone (yk-off). */
function look(id, st, now) {
  const b = BEAT[id];
  if (b && b.to === st) {
    const el = (now - b.t0) / 1000, d = PH[b.k][1];
    if (el < d) return [`yk-${b.k} yk-beat`, b.k, -el];
    if (b.k === "done" && el < d + OUT) return ["yk-off yk-out", "rest", -(el - d)];
    delete BEAT[id];
  }
  if (st === "run") return ["yk-run", "loop", -(now % 16000) / 1000];
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
    if (RM.matches || performance.now() - T0 < 4000) delete BEAT[a.id];
    else BEAT[a.id] = { k: st === "run" ? "start" : "done", t0: now, to: st };
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
const kk = (id, v, cls) => `${id}|${v || 0}|${toneNow()}|${/yk-out/.test(cls) ? "o" : /yk-off/.test(cls) ? 0 : /yk-done/.test(cls) ? "d" : "r"}`;
/* the wrapper: no layers when off; the level-2 eyes only while the kitten is awake (start / loop / done) */
function wrap(id, v, [cls, ph, wp], html) {
  const off = /yk-off/.test(cls), out = /yk-out/.test(cls), e = v && !off;
  return `<span class="yk ${cls}${e ? " yk-l2" : ""}" data-yk="${id}" data-ykv="${v || ""}" data-ykk="${kk(id, e ? v : 0, cls)}" style="${vars(id, e ? v : 0, ph, wp)}">${html}${e ? '<i class="yk-ey" aria-hidden="true"></i>' : ""}${off && !out ? "" : '<i class="yk-fx" aria-hidden="true"></i>'}</span>`;
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
    if (e.animationName === "yk-fade") { if (w.classList.contains("yk-out")) { f.remove(); w.classList.remove("yk-out"); w.dataset.ykk = kk(id, 0, w.className); } return; }
    const b = BEAT[id];
    if (e.animationName !== "yk-x" || !w.classList.contains("yk-beat") || !b) return;
    const [cls, ph, wp] = look(id, SEEN[id] || "off", b.t0 + PH[b.k][1] * 1000 + 1), on = cls === "yk-run";
    w.className = `yk ${cls}${on && v ? " yk-l2" : ""}`; w.dataset.ykk = kk(id, on ? v : 0, cls);
    if (!on) { const ey = w.querySelector(".yk-ey"); if (ey) ey.remove(); }
    w.setAttribute("style", vars(id, on ? v : 0, ph, on ? -(Date.now() % 16000) / 1000 : 0));
  });
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
  [".yk-ey", ".yk-fx"].forEach(q => { const o = w0.querySelector(":scope > " + q), n = w1.querySelector(":scope > " + q); if (o && !n) o.remove(); else if (n && !o) w0.append(n); else if (o && n) o.replaceWith(n); });
  return w0;
}

export { yk, ykInto, ykSync, wireYk, toneNow };
