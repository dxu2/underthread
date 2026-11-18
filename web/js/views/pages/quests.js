// Dashboard page 委托 / quests and the category pages: stage groups, the done fold.
// t-oss-struct S10 (A5): moved out of app.js unchanged; a wire*() function, if any, holds the top-level event wiring and app.js calls it where
// the code used to run, so listeners register in the same order as before.

// t-vis-b2: the phone 委托 tab's 「全部」 page: every live item across categories, grouped by stage like a category page
import { grpLabel, t } from "../../core/i18n.js";
import { UI, byAct, grpOf, items } from "../../core/store.js";
import { card, lsGet, pageHead } from "./common.js";
function questsPage() {
  const list = items();
  let html = pageHead("quests");
  if (!list.length) return html + `<div class="empty">${t("empty")}</div>`;
  return html + stageGroups(list, "quests");
}
// t-done-fold (2026-11-02): on the list pages (全部 / 主线 / 支线 / 日常 …) finished cards fold into one row at the bottom,
// 「已完成 · N 张 ▸」; open / closed is remembered per page in this browser (rt.doneOpen.<page>). A page with nothing but finished
// cards says so in one faint line above that row instead of a blank page. Open, the row shows the latest 12 as before.
const doneOpen = pg => lsGet("rt.doneOpen." + pg, false) === true;
function stageGroups(list, pg, quiet) {   /* quiet: no 「这里的活都做完了」 line (常驻活动 puts the fold under its own schedule) */
  let html = "", live = 0;
  for (const s of ["review", "doing", "todo", "waiting"]) {
    const g = list.filter(i => grpOf(i) === s).sort(byAct); if (!g.length) continue;
    live += g.length; html += `<div class="grp-h"><b>${grpLabel(s)}</b> · ${g.length}</div>` + g.map(i => card(i, { noCat: i.category === pg })).join("");
  }
  const done = list.filter(i => grpOf(i) === "done").sort(byAct); if (!done.length) return html;
  const en = UI.lang === "en", open = doneOpen(pg), shown = done.slice(0, 12);
  if (!live && !quiet) html += `<div class="df-empty">${en ? "All done here." : "这里的活都做完了"}</div>`;
  html += `<button type="button" class="df-row${live ? "" : " solo"}" data-donefold="${esc(pg)}" aria-expanded="${open}"><span>${en ? `Done · ${done.length}` : `已完成 · ${done.length} 张`}</span><i aria-hidden="true">▸</i></button>`;
  if (open) html += `<div class="df-list">${shown.map(i => card(i, { noCat: i.category === pg })).join("")}${done.length > shown.length ? `<div class="df-note">${en ? `Latest ${shown.length} shown · the rest are on the board` : `只列出最近 ${shown.length} 张，更早的在看板里`}</div>` : ""}</div>`;
  return html;
}
function catPage(c) {
  const list = items().filter(i => i.category === c);
  let html = pageHead(c);
  if (!list.length) return html + `<div class="empty">${t("empty")}</div>`;
  return html + stageGroups(list, c);
}

export { questsPage, doneOpen, stageGroups, catPage };
