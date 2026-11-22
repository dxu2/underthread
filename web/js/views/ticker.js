// Dashboard view: the ticker line under the header.
// t-oss-struct S10 (A6): moved out of app.js unchanged; a wire*() function, if any, holds the top-level event wiring and app.js calls it where
// the code used to run, so listeners register in the same order as before.


// ---------- ticker ----------
import { $ } from "../core/util.js";
import { t } from "../core/i18n.js";
import { ST, UI, items, waitMs } from "../core/store.js";
import { api } from "../core/ui.js";
import { openItem } from "./drawer.js";
import { mgrState } from "./header.js";
function tickerItems() {
  const out = [];
  const now = Date.now();
  for (const n of ST.notices || []) if (!n.until || new Date(n.until) > now) out.push({ text: UI.lang === "en" && n.text_en || n.text, level: n.level, id: n.id });   /* t-i18n-c: text_en */
  const m = mgrState();
  if (m.sleep) out.unshift({ text: m.back ? t("mgr_sleep", { t: m.back, n: ST.meta.inbox_unacked || 0 }) : t("mgr_waking"), level: "info" });
  else if (!m.on && ST.meta.inbox_unacked) out.unshift({ text: t("mgr_offline", { n: ST.meta.inbox_unacked }), level: "urgent" });
  for (const it of items()) {
    if (it.category === "urgent" && it.stage !== "done" && it.owner === "manager") out.unshift({ text: t("no_owner_urgent", { t: it.title }), level: "urgent", item: it.id });
    if (it.stage === "review" && waitMs(it) > 864e5)   /* r-improve-1119 P1: same clock as the card tag */ out.push({ text: t("waiting_long", { t: it.title }), item: it.id });
  }
  return out;
}
let tickIdx = 0;
const NTY_BALL = '<svg class="nty-ball" viewBox="0 0 20 20" aria-hidden="true"><circle class="b0" cx="10" cy="10" r="9"/><path class="bw" d="M2 7.4Q10 3 18.2 8.2M1.8 12.6Q10 8.6 18.2 13.4M6.6 1.8Q2.2 9.8 7 18.2M13.2 1.8Q18 9.8 13 18.2"/></svg>';
const NTY_THR = `<span class="nty-thr" aria-hidden="true"><svg viewBox="0 0 220 12" preserveAspectRatio="none"><path d="M0 6 ${Array.from({ length: 14 }, (_, i) => `Q${i * 16 + 8} ${i % 2 ? 10 : 2} ${i * 16 + 16} 6`).join(" ")}"/></svg></span>`;
/* t-yarn-anim: the Notice kitten (the generic 9e, 22 x 19 px, feet on the line). Two poses; every motion is CSS transform / opacity. */
const NYK_BODY = '<ellipse cx="0" cy="-6.8" rx="8" ry="6.8"/><path d="M-3.8 -12.2L-3 -16.8L.4 -13.6Z"/>', NYK_EAR = '<path class="er" d="M2.2 -13.6L5.8 -16.4L5.8 -11.8Z"/>';
const NYK_TAIL = d => `<path class="th" d="${d}"/><path class="tc" d="${d}"/>`;
const NYK_SIT = `<svg class="nyk-sit" viewBox="-13 -18 22 19">${NYK_TAIL("M-7 -2.6Q-11.6 -2.6 -11.4 -6.2T-11.3 -11.2")}<g class="bd"><g class="h">${NYK_BODY}${NYK_EAR}</g><g class="c">${NYK_BODY}${NYK_EAR}</g><g class="ey"><ellipse class="e" cx="3.1" cy="-8" rx=".85" ry=".85"/><ellipse class="e" cx="6.1" cy="-8.1" rx=".85" ry=".85"/></g></g></svg>`;
const NYK_NAP = `<svg class="nyk-nap" viewBox="-13 -18 22 19"><g class="bd"><g class="h">${NYK_BODY}${NYK_EAR}</g><g class="c">${NYK_BODY}${NYK_EAR}</g><path class="el" d="M2.1 -8.2Q3.1 -7.1 4.1 -8.2"/><path class="el sl" d="M5.1 -8.3Q6.1 -7.2 7.1 -8.3"/><ellipse class="e pk" cx="6.1" cy="-8.1" rx=".85" ry=".85" opacity="0"/></g>${NYK_TAIL("M6.4 -3.4C7.6 -10 15 -17 19 -15.4C23 -13.8 23.6 -9.2 22.4 -6.8")}<text class="z" x="-6" y="-13">z</text></svg>`;
/* 22:30-08:00 the kitten only naps */
const quietNight = (d = new Date()) => { const m = d.getHours() * 60 + d.getMinutes(); return m >= 1350 || m < 480; };
const NYK_SEEN = new Set();
let nykSw = 0;
const nykKey = n => n.id ? "n:" + n.id : n.item ? "i:" + n.item + ":" + (n.level || "") : "x:" + (n.level || "");
function renderTicker() {
  const list = tickerItems();
  const el = $("#ticker");
  if (!list.length) { el.innerHTML = ""; return; }
  /* t-yarn-anim: a notice we have not seen in this page before jumps to the front of the rotation and gets kitten A */
  const keys = list.map(nykKey), ut0 = !!document.documentElement.dataset.ut;
  const fi = renderTicker.slid ? keys.findIndex(k => !NYK_SEEN.has(k)) : -1;
  keys.forEach(k => NYK_SEEN.add(k));
  if (ut0 && fi >= 0) tickIdx = fi;
  const fresh = ut0 && fi >= 0;
  tickIdx %= list.length;
  const n = list[tickIdx];
  /* t-notice-yarn: under Underthread a thread is drawn in from the left and a yarn ball rolls along it to the message; the pager dots
     become knots on a thread. Other looks keep the plain line. CSS: theme-ut.css (nty-). */
  const ut = !!document.documentElement.dataset.ut;
  const html = `<span class="k">${UI.lang === "en" ? "Notice" : "通知"}</span>${ut ? NTY_THR + "\u0000" + NTY_BALL : ""}<span class="msg ${n.level === "urgent" ? "urgent" : ""}" data-ti="${tickIdx}">${esc(n.text)}</span>${ut ? '<span class="nyk-run" aria-hidden="true"></span><span class="nty-tail" aria-hidden="true"></span>' : ""}
    ${n.id ? `<button class="dim" data-dismiss="${n.id}" title="dismiss">✕</button>` : ""}
    <span class="pager${ut ? " nty-knots" : ""}">${list.map((_, i) => `<i class="${i === tickIdx ? "on" : ""}"></i>`).join("")}</span>`;
  if (html !== renderTicker.last) {  // re-animate only when the notice changes
    /* the thread slides in from the left only the first time a notice shows; after that a switch keeps the thread still and the
       ball rolls once in place while the text changes (.nty-first gates the slide in theme-ut.css). */
    const first = ut && !renderTicker.slid;
    el.classList.toggle("nty-first", first);
    /* t-yarn-anim: the kitten between the thread and the ball. A = a new notice arrived (nudges the ball), C = now and then on a switch
       (tugs the thread), B = every other switch, the first show and all night (naps). CSS: css/yarnkit.css (nyk-). */
    let v = !ut ? "" : first || quietNight() || !renderTicker.slid ? "b" : fresh ? "a" : (++nykSw % 5 === 0 ? "c" : "b");
    if (v === "b" && window.__nykNext === "c" && !first && !quietNight()) v = "c";   /* test hook (tests/e2e/journeys/yarnkit.js): the next switch tugs */
    window.__nykNext = null;
    el.classList.remove("nyk-a", "nyk-b", "nyk-c");
    if (v) el.classList.add("nyk-" + v);
    el.innerHTML = html.replace("\u0000", v ? `<span class="nyk" aria-hidden="true">${v === "b" ? NYK_NAP : NYK_SIT}</span>` : ""); renderTicker.last = html;
    if (ut) renderTicker.slid = true;
    const thr = ut && el.querySelector(".nty-thr"), ball = thr && el.querySelector(".nty-ball");
    if (ball) ball.style.setProperty("--run", thr.getBoundingClientRect().width + "px");   // the ball starts at the thread's left end
    const msg = v === "a" && el.querySelector(".msg"), run = msg && el.querySelector(".nyk-run");
    if (run) run.style.setProperty("--mw", Math.round(msg.getBoundingClientRect().width) + "px");   // A: the thread runs out under the new text
  }
  el.onclick = e => {
    const d = e.target.closest("[data-dismiss]"); if (d) return api("notice_dismiss", { id: d.dataset.dismiss });
    if (e.target.closest(".msg") && n.item) openItem(n.item);
  };
}

function wireTicker() {
  setInterval(() => { if (ST) { tickIdx++; renderTicker(); } }, 6000);
}

export { tickerItems, tickIdx, renderTicker, wireTicker };
