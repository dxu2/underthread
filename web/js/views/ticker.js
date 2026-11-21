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
function renderTicker() {
  const list = tickerItems();
  const el = $("#ticker");
  if (!list.length) { el.innerHTML = ""; return; }
  tickIdx %= list.length;
  const n = list[tickIdx];
  /* t-notice-yarn: under Underthread a thread is drawn in from the left and a yarn ball rolls along it to the message; the pager dots
     become knots on a thread. Other looks keep the plain line. CSS: theme-ut.css (nty-). */
  const ut = !!document.documentElement.dataset.ut;
  const html = `<span class="k">${UI.lang === "en" ? "Notice" : "通知"}</span>${ut ? NTY_THR + NTY_BALL : ""}<span class="msg ${n.level === "urgent" ? "urgent" : ""}" data-ti="${tickIdx}">${esc(n.text)}</span>${ut ? '<span class="nty-tail" aria-hidden="true"></span>' : ""}
    ${n.id ? `<button class="dim" data-dismiss="${n.id}" title="dismiss">✕</button>` : ""}
    <span class="pager${ut ? " nty-knots" : ""}">${list.map((_, i) => `<i class="${i === tickIdx ? "on" : ""}"></i>`).join("")}</span>`;
  if (html !== renderTicker.last) {  // re-animate only when the notice changes
    /* the thread slides in from the left only the first time a notice shows; after that a switch keeps the thread still and the
       ball rolls once in place while the text changes (.nty-first gates the slide in theme-ut.css). */
    el.classList.toggle("nty-first", ut && !renderTicker.slid);
    el.innerHTML = html; renderTicker.last = html;
    if (ut) renderTicker.slid = true;
    const thr = ut && el.querySelector(".nty-thr"), ball = thr && el.querySelector(".nty-ball");
    if (ball) ball.style.setProperty("--run", thr.getBoundingClientRect().width + "px");   // the ball starts at the thread's left end
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
