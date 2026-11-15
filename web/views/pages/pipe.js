// Dashboard page 制作线 / pipe: content pipelines per role, the week strip and pipe cards.
// t-oss-struct S10 (A5): moved out of app.js unchanged; a wire*() function, if any, holds the top-level event wiring and app.js calls it where
// the code used to run, so listeners register in the same order as before.

// ===== t-imp-p3: 制作线 (production line), READ-ONLY. Main/side content items grouped by production stage + this week's publish slots.
// Stage = tag "pipe:<key>" when present, else guessed from the owner's role (marked "推断" on the card). No new state fields, no server change.
// Moving a card never writes state: dropping it on another column sends the manager a chat message asking to retag it (the manager applies it).
import { PLAT, dayKey, t } from "../../core/i18n.js";
import { ST, UI, busy } from "../../core/store.js";
import { agent, agents, av } from "../../core/av.js";
import { awaitsUser } from "./review.js";
import { wkAttr, wkFx, wkTag, workersOf } from "../../app.js";
const PIPE = [
  { k: "topic", zh: "选题", en: "Topic", d: "选题论证 + 调研", de: "Pitch + research" },
  { k: "script", zh: "脚本", en: "Script", d: "立项文档 + 脚本 + 事实核查", de: "Production doc, script, fact-check" },
  { k: "board", zh: "分镜·素材", en: "Boards · art", d: "分镜 + 封面 / 概念图", de: "Storyboard, cover, concept art" },
  { k: "shoot", zh: "拍摄", en: "Shoot", who: ["me"], d: "你来拍", de: "You shoot" },
  { k: "edit", zh: "剪辑", en: "Edit", d: "粗剪方案 / 粗剪", de: "Edit plan, rough cut" },
  { k: "pack", zh: "包装·排期", en: "Package", d: "三平台包装 + 排期", de: "Per-platform copy + slot" },
  { k: "ready", zh: "待发布", en: "Ready", who: ["me"], d: "你来发布", de: "You publish" },
];
const PIPE_ALIAS = { "选题": "topic", "调研": "topic", "脚本": "script", "核查": "script", "分镜": "board", "素材": "board", "封面": "board", "拍摄": "shoot", "剪辑": "edit", "粗剪": "edit", "包装": "pack", "排期": "pack", "待发布": "ready", "发布": "ready" };
/* t-hr-registry: a content role = a roster entry with "pipe" (one column or a list); its first column is where its untagged cards land. */
const pipesOf = a => a && a.enabled !== false ? [].concat(a.pipe || []).filter(k => PIPE.some(p => p.k === k)) : [];
const byOwner = id => pipesOf(ST.agents && ST.agents[id])[0];
const contentRoles = () => agents().filter(a => pipesOf(a).length);
const pipeWho = p => p.who || contentRoles().filter(a => pipesOf(a).includes(p.k)).map(a => a.id);
function pipeTag(it) {
  for (const g of it.tags || []) { const m = /^pipe[:：](.+)$/i.exec(String(g).trim()); if (m) { const v = m[1].trim().toLowerCase(); return PIPE.some(p => p.k === v) ? v : PIPE_ALIAS[m[1].trim()] || null; } }
  return null;
}
const isContent = it => ["main", "side"].includes(it.category) && (pipeTag(it) || (it.platforms || []).length || !!byOwner(it.owner));
function pipeOf(it) { const k = pipeTag(it); return k ? { k, guess: false } : { k: byOwner(it.owner) || "topic", guess: true }; }
const pipeName = p => UI.lang === "en" ? p.en : p.zh;
function weekDays() {   // Monday-first, this week
  const n = new Date(), mon = new Date(n.getFullYear(), n.getMonth(), n.getDate() - ((n.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i));
}
const platOf = s => { s = String(s || ""); return /B站|bili/i.test(s) ? "bili" : /youtube|油管|\byt\b/i.test(s) ? "yt" : /小红书|xhs|rednote/i.test(s) ? "xhs" : ""; };
function pipeWeek(content) {
  const en = UI.lang === "en", wd = en ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] : ["周一", "周二", "周三", "周四", "周五", "周六", "周日"], today = dayKey(new Date());
  const days = weekDays(), keys = days.map(dayKey);
  const cal = (ST.calendar || []).filter(e => keys.includes(e.date)), dues = content.filter(i => i.due && keys.includes(String(i.due).slice(0, 10)));
  const cells = days.map((d, i) => {
    const k = keys[i], evs = cal.filter(e => e.date === k), ds = dues.filter(it => String(it.due).slice(0, 10) === k);
    const slot = e => `<div class="pl-slot${platOf(e.title) ? " pf-" + platOf(e.title) : ""}"${e.item ? ` data-item="${esc(e.item)}"` : ""}>${e.time ? `<span class="tm">${esc(e.time)}</span>` : ""}${esc(e.title)}</div>`;
    const due = it => `<div class="pl-slot due" data-item="${esc(it.id)}"><b>${en ? "Due" : "截止"}</b> · ${esc(it.title)}</div>`;
    const body = evs.map(slot).join("") + ds.map(due).join("");
    return `<div class="pl-day${k === today ? " today" : ""}${k < today ? " past" : ""}"><div class="pl-dh">${wd[i]} <span>${d.getMonth() + 1}/${d.getDate()}</span></div>${body || (k < today ? "" : `<button class="pl-add" data-pl-add="${k}">${en ? "+ add" : "+ 排一个"}</button>`)}</div>`;
  }).join("");
  const used = keys.filter(k => cal.some(e => e.date === k) || dues.some(it => String(it.due).slice(0, 10) === k)).length;
  return { html: `<div class="pl-week">${cells}</div>`, used };
}
function pipeCard(it, guess) {
  const en = UI.lang === "en", ws = workersOf(it.id), plats = (it.platforms || []).map(p => PLAT[p] || p).join(" · ");
  const flag = busy(it) ? "" : it.stage === "review" ? (en ? `${it.draft_label || "draft"} · your review` : `${esc(it.draft_label || "新稿")} 待你看`) : awaitsUser(it) ? (en ? "needs your call" : "待你拍板") : it.stage === "waiting" ? (en ? "waiting" : "等别人") : "";
  return `<div class="mini pl-card${ws.length ? " wk-on" : ""}" draggable="true" data-pdrag="${it.id}" data-item="${it.id}"${wkAttr(ws)}>${wkFx(ws)}<div class="t">${esc(it.title)}</div>${wkTag(ws)}
    ${flag ? `<span class="pl-flag${it.stage === "review" || awaitsUser(it) ? " you" : ""}">${flag}</span>` : ""}
    <div class="m">${av(agent(it.owner), "sm", it.id)}<span>${t(it.category)}</span>${plats ? `<span>${esc(plats)}</span>` : ""}${guess ? `<span class="pl-guess" title="${en ? "No pipe:<stage> tag; guessed from the owner" : "没有 pipe:阶段 标签，按负责人推断"}">${en ? "guessed" : "推断"}</span>` : ""}</div></div>`;
}

export { PIPE, PIPE_ALIAS, pipesOf, byOwner, contentRoles, pipeWho, pipeTag, isContent, pipeOf, pipeName, weekDays, platOf, pipeWeek, pipeCard };
