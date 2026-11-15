// Dashboard view: the ticker line under the header.
// t-oss-struct S10 (A6): moved out of app.js unchanged; a wire*() function, if any, holds the top-level event wiring and app.js calls it where
// the code used to run, so listeners register in the same order as before.


// ---------- ticker ----------
import { $ } from "../core/util.js";
import { t } from "../core/i18n.js";
import { ST, UI, items } from "../core/store.js";
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
    if (it.stage === "review" && now - new Date(it.activity) > 864e5) out.push({ text: t("waiting_long", { t: it.title }), item: it.id });
  }
  return out;
}
let tickIdx = 0;
function renderTicker() {
  const list = tickerItems();
  const el = $("#ticker");
  if (!list.length) { el.innerHTML = ""; return; }
  tickIdx %= list.length;
  const n = list[tickIdx];
  const html = `<span class="k">${UI.lang === "en" ? "Notice" : "通知"}</span><span class="msg ${n.level === "urgent" ? "urgent" : ""}" data-ti="${tickIdx}">${esc(n.text)}</span>
    ${n.id ? `<button class="dim" data-dismiss="${n.id}" title="dismiss">✕</button>` : ""}
    <span class="pager">${list.map((_, i) => `<i class="${i === tickIdx ? "on" : ""}"></i>`).join("")}</span>`;
  if (html !== renderTicker.last) { el.innerHTML = html; renderTicker.last = html; }  // re-animate only when the notice changes
  el.onclick = e => {
    const d = e.target.closest("[data-dismiss]"); if (d) return api("notice_dismiss", { id: d.dataset.dismiss });
    if (e.target.closest(".msg") && n.item) openItem(n.item);
  };
}

function wireTicker() {
  setInterval(() => { if (ST) { tickIdx++; renderTicker(); } }, 6000);
}

export { tickerItems, tickIdx, renderTicker, wireTicker };
