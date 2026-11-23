// Dashboard page 委托 / quests and the category pages: stage groups, the done fold.
// t-oss-struct S10 (A5): moved out of app.js unchanged; a wire*() function, if any, holds the top-level event wiring and app.js calls it where
// the code used to run, so listeners register in the same order as before.

// t-vis-b2: the phone 委托 tab's 「全部」 page: every live item across categories, grouped by stage like a category page
import { grpLabel, t } from "../../core/i18n.js";
import { UI, byAct, grpOf, items } from "../../core/store.js";
import { MOBQ, QC_CV, card, lsGet, pageHead } from "./common.js";
import { cardImg, openAsks } from "./review.js";
function questsPage() {
  const list = items();
  let html = pageHead("quests");
  if (!list.length) return html + `<div class="empty">${t("empty")}</div>`;
  return html + stageGroups(list, "quests");
}
// t-done-fold (2026-11-02): on the list pages (全部 / 主线 / 支线 / 日常 …) finished cards fold into one row at the bottom,
// 「已完成 · N 张 ▸」; open / closed is remembered per page in this browser (rt.doneOpen.<page>). A page with nothing but finished
// cards says so in one faint line above that row instead of a blank page. Open, the row shows the latest 12 as before.
/* t-web-quest-cards (plan B): each stage group's cards sit in one .qc-grid. On a desk (css/quest-cards.css, >760px) it holds up to three phone-style
   cards across, with the ask options kept inside; on a phone the wrapper is a plain block and the list looks as before.
   t-web-quest-cards-p2: masonry. A grid row used to stretch every card to the tallest one and leave holes, so on a desk the cards are dealt into
   N columns (.qc-col, each a plain stack): the first row is the first N cards in order, then each next card goes to the column that is shortest
   by an estimate of its height (cover, ask chips, title length). No measuring after paint, so a poll re-render lays out the same way.
   N follows the page width (same rule as before: at most 3, columns >= 270px); qcWatch re-renders when a resize changes N. */
const QC_MIN = 270, QC_GAP = 14;
const qcCols = () => { const b = document.getElementById("pagebody"); if (!b) return 3;
  const cs = getComputedStyle(b), w = b.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  return Math.max(1, Math.min(3, Math.floor((w + QC_GAP) / (QC_MIN + QC_GAP)))); };
const qcEst = it => { const a = openAsks(it)[0], ol = a ? a.options.reduce((s, o) => s + o.length + 4, 6) : 0;
  return 150 + ((it.title || "").length > 16 ? 22 : 0) + (cardImg(it) && QC_CV.get(cardImg(it)) !== "blank" ? 150 : 0) + (a ? 56 + 32 * Math.ceil(ol / 26) : 0); };
let qcObs = null, qcN = 0;
function qcWatch() {
  if (qcObs || typeof ResizeObserver === "undefined") return;
  const pg = document.getElementById("page"); if (!pg) return;
  qcObs = new ResizeObserver(() => { if (!qcN || MOBQ.matches || !document.querySelector("#pagebody .qc-grid.qc-m")) return; if (qcCols() !== qcN && window.App && App.refreshPage) App.refreshPage(); });
  qcObs.observe(pg);
}
function qcGrid(list, o) {
  const h = it => card(it, o(it));
  if (MOBQ.matches) return `<div class="qc-grid">${list.map(h).join("")}</div>`;
  qcWatch();
  const n = qcN = qcCols(), cols = Array.from({ length: n }, () => ({ h: 0, html: "" }));
  list.forEach((it, i) => { const c = i < n ? cols[i] : cols.reduce((m, x) => x.h < m.h - 8 ? x : m); c.h += qcEst(it) + QC_GAP; c.html += h(it); });
  return `<div class="qc-grid qc-m" data-n="${n}" style="--qc-n:${n}">${cols.map(c => `<div class="qc-col">${c.html}</div>`).join("")}</div>`;
}
const doneOpen = pg => lsGet("rt.doneOpen." + pg, false) === true;
function stageGroups(list, pg, quiet) {   /* quiet: no 「这里的活都做完了」 line (常驻活动 puts the fold under its own schedule) */
  let html = "", live = 0;
  for (const s of ["review", "doing", "todo", "waiting"]) {
    const g = list.filter(i => grpOf(i) === s).sort(byAct); if (!g.length) continue;
    live += g.length; html += `<div class="grp-h"><b>${grpLabel(s)}</b> · ${g.length}</div>` + qcGrid(g, i => ({ noCat: i.category === pg, cover: true }));
  }
  const done = list.filter(i => grpOf(i) === "done").sort(byAct); if (!done.length) return html;
  const en = UI.lang === "en", open = doneOpen(pg), shown = done.slice(0, 12);
  if (!live && !quiet) html += `<div class="df-empty">${en ? "All done here." : "这里的活都做完了"}</div>`;
  html += `<button type="button" class="df-row${live ? "" : " solo"}" data-donefold="${esc(pg)}" aria-expanded="${open}"><span>${en ? `Done · ${done.length}` : `已完成 · ${done.length} 张`}</span><i aria-hidden="true">▸</i></button>`;
  if (open) html += `<div class="df-list">${qcGrid(shown, i => ({ noCat: i.category === pg, cover: true }))}${done.length > shown.length ? `<div class="df-note">${en ? `Latest ${shown.length} shown · the rest are on the board` : `只列出最近 ${shown.length} 张，更早的在看板里`}</div>` : ""}</div>`;
  return html;
}
function catPage(c) {
  const list = items().filter(i => i.category === c);
  let html = pageHead(c);
  if (!list.length) return html + `<div class="empty">${t("empty")}</div>`;
  return html + stageGroups(list, c);
}

export { questsPage, doneOpen, stageGroups, catPage };
