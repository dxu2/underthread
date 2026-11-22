// t-yarn-anim (level 2 yarn kittens, user 11-21): a small knit kitten sits on the bottom-right of a teammate's avatar in the TEAM rail (desk)
// and the phone chat list, only while that teammate is working on a card right now (user 11-22: "只在 working now 的卡片上显示";
// status working and --item set). It wakes with a one-off start beat, plays along while the role works, and when the role stops it curls up
// (done beat) and fades out. Idle avatars carry no kitten and no moving eyes.
//
// Two kinds of role:
//  - a role with a level-2 script (meta.art[id].yarn, files under art/yarn/<id>/, usually in your local/ layer): while it works its eyes become
//    a moving layer (looks at the kitten, smiles, closes), drawn over eyeless copies of its work strip. Only under 特典 (html[data-ut]) and only
//    while the role shows its own 特典 avatar (a picked picture has other eyes).
//  - everyone else (and every role in other palettes): the generic kitten layer only (art/yarn/generic/).
//
// Layers (CSS in css/yarnkit.css): .yk wraps the avatar (always, so the row never shifts); i.yk-ey = eyes, i.yk-fx = kitten + prop (130% of
// the avatar box, not clipped). Each layer is one horizontal sprite stepped with steps(N, jump-none). The loop runs on the same 16 s
// wall-clock phase (--wp) as the 0.8 s work strip, so the kitten pats the star when the bulb lights. A beat is decided only when the state
// changes while the page is open; a reload or a re-render draws the target state. prefers-reduced-motion: a static kitten, no beats.
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
  if (v) s += `;--yk-ey:${u(`eyes-${ph}.svg`)};--yk-pose:${u("poses.svg")};--yk-idle:${u("idle-160.webp")};--yk-work:${u("work-160.webp")}`;
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
  const now = Date.now(), st = target(a, !!busy), from = SEEN[a.id];
  if (from && from !== st) {
    /* the first seconds after a load may still show the boot snapshot (store.js snapBoot): its old state changing is not a real change */
    if (RM.matches || performance.now() - T0 < 4000) delete BEAT[a.id];
    else BEAT[a.id] = { k: st === "run" ? "start" : "done", t0: now, to: st };
  }
  SEEN[a.id] = st;
  return wrap(a.id, l2(a), look(a.id, st, now), html);
}
/* the wrapper: no layers when off; the level-2 eyes only while the kitten is awake (start / loop / done) */
function wrap(id, v, [cls, ph, wp], html) {
  const off = /yk-off/.test(cls), out = /yk-out/.test(cls), e = v && !off;
  return `<span class="yk ${cls}${e ? " yk-l2" : ""}" data-yk="${id}" data-ykv="${v || ""}" style="${vars(id, e ? v : 0, ph, wp)}">${html}${e ? '<i class="yk-ey" aria-hidden="true"></i>' : ""}${off && !out ? "" : '<i class="yk-fx" aria-hidden="true"></i>'}</span>`;
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
    if (e.animationName === "yk-fade") { if (w.classList.contains("yk-out")) { f.remove(); w.classList.remove("yk-out"); } return; }
    const b = BEAT[id];
    if (e.animationName !== "yk-x" || !w.classList.contains("yk-beat") || !b) return;
    const [cls, ph, wp] = look(id, SEEN[id] || "off", b.t0 + PH[b.k][1] * 1000 + 1), on = cls === "yk-run";
    w.className = `yk ${cls}${on && v ? " yk-l2" : ""}`;
    if (!on) { const ey = w.querySelector(".yk-ey"); if (ey) ey.remove(); }
    w.setAttribute("style", vars(id, on ? v : 0, ph, on ? -(Date.now() % 16000) / 1000 : 0));
  });
}

export { yk, wireYk, toneNow };
