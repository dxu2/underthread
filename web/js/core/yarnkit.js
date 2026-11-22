// t-yarn-anim (level 2 yarn kittens, user 11-21): a small knit kitten sits on the bottom-right of a teammate's avatar in the TEAM rail (desk)
// and the phone chat list. It sleeps on its ball while the role is idle, plays along while the role works, holds something up while the role's
// last card waits on your review, and plays a one-off beat at the moment the state changes (start / review / done).
//
// Two kinds of role:
//  - a role with a level-2 script (meta.art[id].yarn, files under art/yarn/<id>/, usually in your local/ layer): its eyes become a moving layer
//    (looks at the kitten, smiles, closes), drawn over eyeless copies of its work strip and idle art. Only under 特典 (html[data-ut]) and only
//    while the role shows its own 特典 avatar (a picked picture has other eyes).
//  - everyone else (and every role in other palettes): the generic kitten layer only (art/yarn/generic/).
//
// Layers (CSS in css/yarnkit.css): .yk wraps the avatar; i.yk-ey = eyes, i.yk-fx = kitten + prop (52/40 of the avatar box, not clipped).
// Each layer is one horizontal sprite stepped with steps(N, jump-none). The loop runs on the same 16 s wall-clock phase (--wp) as the
// 0.8 s work strip, so the kitten pats the star when the bulb lights. A beat is decided only when the state changes while the page is open;
// a reload or a re-render draws the target state (review = its last frame). prefers-reduced-motion: static poses, no beats.
import { ST, items } from "./store.js";

const PH = { start: [16, 1.6], loop: [32, 3.2], review: [16, 1.6], done: [24, 2.4], rest: [1, .1] };
const GEN = "/static/art/yarn/generic/", GV = "1";
const SEEN = {}, BEAT = {}, T0 = performance.now();
let MEM = {};
try { MEM = JSON.parse(localStorage.getItem("rt.yk")) || {}; } catch (_) { MEM = {}; }
const save = () => { try { localStorage.setItem("rt.yk", JSON.stringify(MEM)); } catch (_) { } };
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
/* run = working on a card; review = idle, and the card it last worked on waits in review; rest = anything else */
function target(a, busy) {
  const m = MEM[a.id] || (MEM[a.id] = {});
  if (busy) { if (a.item && m.it !== a.item) { m.it = a.item; save(); } return "run"; }
  if (m.it) {
    const it = items().find(x => x.id === m.it);
    if (it && it.stage === "review") return "review";
    delete m.it; save();
  }
  return "rest";
}
function vars(id, v, ph, wp) {
  const [n, d] = PH[ph], tn = toneNow(), u = f => `url('/static/art/yarn/${encodeURIComponent(id)}/${f}?v=${v}')`, g = f => `url('${GEN}${f}?v=${GV}')`;
  let s = `--wp:${wp.toFixed(3)}s;--yk-n:${n};--yk-d:${d}s;--yk-fx:${v ? u(`fx-${ph}-${tn}.svg`) : g(`fx-${ph}-${tn}.svg`)};--yk-fx0:${v ? u(`fx-rest-${tn}.svg`) : g(`fx-rest-${tn}.svg`)}`;
  if (v) s += `;--yk-ey:${u(`eyes-${ph}.svg`)};--yk-pose:${u("poses.svg")};--yk-idle:${u("idle-160.webp")};--yk-work:${u("work-160.webp")}`;
  return s;
}
/* state -> [class, phase, --wp] at time now */
function look(id, st, now) {
  const b = BEAT[id];
  if (b && b.to === st) {
    const el = now - b.t0;
    if (b.k === "review" || el < PH[b.k][1] * 1000) return [`yk-${b.k} yk-beat`, b.k, -el / 1000];
    delete BEAT[id];
  }
  if (st === "run") return ["yk-run", "loop", -(now % 16000) / 1000];
  if (st === "review") return ["yk-review", "review", -PH.review[1]];   /* finished: held on its last frame */
  return ["yk-rest", "rest", 0];
}
/* html = the avatar from App.av(a); busy = the role is working on a card (not just the steward being online) */
function yk(a, html, busy) {
  if (!a || !a.id || a.id === "me") return html;
  const now = Date.now(), st = target(a, !!busy), from = SEEN[a.id];
  if (from && from !== st) {
    /* the first seconds after a load may still show the boot snapshot (store.js snapBoot): its old state changing is not a real change */
    if (RM.matches || performance.now() - T0 < 4000) delete BEAT[a.id];
    else BEAT[a.id] = { k: st === "run" ? "start" : st === "review" ? "review" : "done", t0: now, to: st };
  }
  SEEN[a.id] = st;
  const v = l2(a), [cls, ph, wp] = look(a.id, st, now);
  return `<span class="yk ${cls}${v ? " yk-l2" : ""}" data-yk="${a.id}" data-ykv="${v || ""}" style="${vars(a.id, v, ph, wp)}">${html}${v ? '<i class="yk-ey" aria-hidden="true"></i>' : ""}<i class="yk-fx" aria-hidden="true"></i></span>`;
}
/* a beat that ends before the next re-render hands over in place: start -> the loop, done -> asleep (review stays on its last frame) */
function wireYk() {
  document.addEventListener("animationend", e => {
    const f = e.target;
    if (!f.classList || !f.classList.contains("yk-fx")) return;
    const w = f.parentElement;
    if (!w || !w.classList.contains("yk-beat")) return;
    const id = w.dataset.yk, b = BEAT[id];
    if (!b || b.k === "review") return;
    const v = +w.dataset.ykv || 0, [cls, ph, wp] = look(id, SEEN[id] || "rest", b.t0 + PH[b.k][1] * 1000 + 1);
    w.className = `yk ${cls}${v ? " yk-l2" : ""}`;
    w.setAttribute("style", vars(id, v, ph, cls === "yk-run" ? -(Date.now() % 16000) / 1000 : wp));
  });
}

export { yk, wireYk, toneNow };
