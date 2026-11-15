// Dashboard pages, shared parts: the page head, card tiles, action rows and the phone breakpoint (MOBQ).
// t-oss-struct S10 (A5): moved out of app.js unchanged; a wire*() function, if any, holds the top-level event wiring and app.js calls it where
// the code used to run, so listeners register in the same order as before.


// ---------- pages ----------
// t-visual-ink: date eyebrow above every page title (hidden unless html[data-skin="ink"])
import { EN_SUB, PLAT, rtTag, stageLabel, t, whenH } from "../../core/i18n.js";
import { UI, idleDoing, pauseL } from "../../core/store.js";
import { agent, aname, av } from "../../core/av.js";
import { orn } from "../../core/ui.js";
import { routineOf } from "../drawer.js";
import { STU, stuTabs } from "../left.js";
import { askRow, awaitsUser, waitTag } from "./review.js";
import { mailPv, nrDot, wkAttr, wkFx, wkTag, workersOf } from "../../app.js";
function inkEb(right) { const d = new Date(), en = UI.lang === "en";
  const day = en ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", weekday: "short" }) : `${d.getMonth() + 1}月${d.getDate()}日 · 周${"日一二三四五六"[d.getDay()]}`;
  return `<div class="ink-eb">${day}<i></i>${right}</div>`; }
function pageHead(k, extra = "") {
  if (UI.noHead) return extra;   // t-settings-tab: a page drawn inside a 设置 tab keeps its bars, not its masthead
  if (STU.includes(k)) return `<div class="ph ph-studio ph-${k}">${inkEb("Underthread")}<h1>${t("studio")}</h1>${UI.lang === "zh" ? `<div class="en">${EN_SUB.studio}</div>` : ""}${orn()}</div>${stuTabs(k)}${extra}`;   // t-nav-shoot
  return `<div class="ph ph-${k}">${inkEb("Underthread")}<h1>${t(k)}</h1>${UI.lang === "zh" ? `<div class="en">${EN_SUB[k] || ""}</div>` : ""}${orn()}</div>${extra}`;
}


/* t-card-fn-fix: restored from app.js.bak-hstrim1; t-home-style-trim dropped it, but stageGroups / catPage / the board still draw .card with it */
function card(it) {
  const a = agent(it.owner), ws = workersOf(it.id);
  const kind = it.stage === "review" || awaitsUser(it) ? (it.kind === "task" ? "deliverable" : it.kind) : null;
  return `<div class="card${ws.length ? " wk-on" : ""}" data-item="${it.id}"${wkAttr(ws)}>${wkFx(ws)}
    <div class="meta">${kind ? `<span class="tag ${kind}"><span class="gl" aria-hidden="true">◆</span>${t(kind)}</span>${waitTag(it)}` : `<span class="tag">${rtTag(it) || (idleDoing(it) ? pauseL() : stageLabel(it.stage))}</span>`}
      <span>${t(it.category)}${it.category === "urgent" ? " ⚑" : ""}</span>
      <span>${whenH(it.created)}</span><span class="dim">${UI.lang === "en" ? "act." : "动态"} ${whenH(it.activity)}</span>
      <span>${(it.platforms || []).map(p => `<span class="tag pf">${PLAT[p] || p}</span>`).join(" ")}</span></div>
    <div class="body"><h3>${nrDot(it.id)}${esc(it.title)}</h3><p>${esc(mailPv(it.summary || ""))}</p>${wkTag(ws)}${askRow(it)}</div>
    <div class="owner">${av(a, "sm", it.id)}<span>${esc(aname(a))}</span></div>
    <div class="acts"><button data-arch="${it.id}">${t("archive")}</button>${it.stage !== "done" && !routineOf(it) ? `<button data-quickdone="${it.id}">${t("complete")}</button>` : ""}</div></div>`;
}

// ===== p3 (t-slack-p3): Slack-Activity-style list rows on phones (<=760px). Desktop keeps .card / .mail-i. =====
const MOBQ = matchMedia("(max-width: 760px)");
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
function actRow(o) {   // one shared row: avatar (+unread dot) | name + title ... time | preview ... chips
  const ws = o.ws || [];
  return `<div class="act-row ${o.unread ? "unread" : ""}${ws.length ? " wk-on" : ""}" ${o.attr}${wkAttr(ws)}>${wkFx(ws)}
    <span class="act-av">${o.av}${o.unread ? `<i class="act-dot"></i>` : ""}</span>
    <div class="act-main">
      <div class="act-l1"><b class="act-nm">${esc(o.name)}</b>${o.title ? `<span class="act-ti">${esc(o.title)}</span>` : ""}<time class="act-tm">${o.time}</time></div>
      <div class="act-l2"><span class="act-pv">${esc(o.preview)}</span>${ws.length ? wkTag(ws) : o.chip ? `<span class="act-chip">${esc(o.chip)}</span>` : ""}${o.extra || ""}${o.n > 1 ? `<span class="act-n ${o.unread ? "on" : ""}">${o.n > 99 ? "99+" : o.n}</span>` : ""}</div>
    </div></div>`;
}

export { inkEb, pageHead, card, MOBQ, lsGet, lsSet, actRow };
