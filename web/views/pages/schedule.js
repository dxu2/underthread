// Dashboard page 定时 / schedules: routine rows patched in place, pause / delete with undo, the row menu (and the older ongoing page).
// t-oss-struct S10 (A5): moved out of app.js unchanged; a wire*() function, if any, holds the top-level event wiring and app.js calls it where
// the code used to run, so listeners register in the same order as before.

/* t-ri1104-p3: 常驻活动 as a schedule. meta.routines (server) gives time / paused / last / next and (newer server) runs =
   the logged fire dates with the run card of that day, which drive the 7-day row. Without runs (older server) it is what the
   front end can know: a run card (child r-* card of the routine) that day -> ✓ or … ; r.last that day -> ✓ ; paused since -> ⏸ ;
   today before the run -> its time ; anything else "·" (no record kept). Other ongoing cards: 按需常驻 rows, finished ones fold. */
import { dayKey, hm, rowLabel, when } from "../../core/i18n.js";
import { ST, UI, grpOf, items } from "../../core/store.js";
import { agent, aname, av, ringOnce } from "../../core/av.js";
import { api, toast, utEmpty } from "../../core/ui.js";
import { childrenOf, parentOf, snzClose, snzOpen } from "../drawer.js";
import { pageHead } from "./common.js";
import { renderPage } from "./index.js";
import { catPage, doneOpen, stageGroups } from "./quests.js";
function ongoingPage() {
  const rs = (ST.meta && ST.meta.routines) || [];
  if (!Array.isArray(ST.meta && ST.meta.routines) || !rs.length) return catPage("ongoing");
  const en = UI.lang === "en", all = items().filter(i => i.category === "ongoing"), rIds = new Set(rs.map(r => r.item));
  const days = Array.from({ length: 7 }, (_, i) => new Date(Date.now() - (6 - i) * 864e5)), today = dayKey(new Date());
  const WK = en ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] : ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const runsOf = r => { const p = (ST.items || []).find(i => i.id === r.item); return p ? childrenOf(p).filter(k => /^r-/.test(k.id)) : []; };
  const nameOf = (r, a) => { const n = String(r.label || r.id).replace(/[（(][^）)]*[）)]/g, "").trim(), o = a ? aname(a) : ""; return (o && n.startsWith(o) ? n.slice(o.length).trim() : n) || n; };
  const nextTxt = r => {
    if (r.paused) return en ? "Paused" : "已暂停";
    const nd = r.next && new Date(r.next); if (!nd || isNaN(nd)) return "—";
    const m = Math.round((nd - Date.now()) / 6e4);
    if (m <= 0) return en ? "due now" : "到点";
    if (m < 24 * 60) return en ? `in ${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 60) ? Math.floor(m / 60) + " 小时 " : ""}${m % 60} 分后`;
    return dayKey(nd) === dayKey(new Date(Date.now() + 864e5)) ? `${en ? "tomorrow" : "明天"} ${hm(r.next)}` : when(r.next);
  };
  const cell = (r, runs, d) => {
    const k = dayKey(d);
    if (Array.isArray(r.runs)) {   /* t-ri1104-p3 server log: every fired date, with the run card made that day */
      const x = r.runs.find(y => y.date === k);
      if (x) return x.item && x.stage !== "done" ? ["…", "run", x.item] : ["✓", "ok", x.item || ""];
      if (r.paused && k >= dayKey(new Date(r.paused))) return ["⏸", "off", ""];
      if (k === today && !r.paused && r.next && dayKey(new Date(r.next)) === today) return [r.time || "·", "next", ""];
      return ["·", "na", ""];
    }
    const run = runs.filter(x => x.created && dayKey(new Date(x.created)) === k).pop();
    if (run) return run.stage === "done" ? ["✓", "ok", run.id] : ["…", "run", run.id];
    if (r.last === k) return ["✓", "ok", ""];
    if (r.paused && k >= dayKey(new Date(r.paused))) return ["⏸", "off", ""];
    if (k === today && !r.paused && r.next && dayKey(new Date(r.next)) === today) return [r.time || "·", "next", ""];
    return ["·", "na", ""];
  };
  const row = r => {
    const it = (ST.items || []).find(i => i.id === r.item), a = it && agent(it.owner), runs = runsOf(r), last = runs[runs.length - 1];
    const dots = days.map((d, i) => { const [x, c, id] = cell(r, runs, d); return `<span class="rs-d"${id ? ` data-item="${esc(id)}"` : ""}><b class="${c}">${esc(x)}</b><small>${i === 6 ? (en ? "Today" : "今天") : WK[d.getDay()]}</small></span>`; }).join("");
    const lastL = r.paused ? `${when(r.paused)} ${en ? "paused" : "起暂停"}`
      : last ? `${en ? "Latest" : "最近一期"} <u data-item="${esc(last.id)}">${esc(last.id)}</u> · ${esc(rowLabel(last))}`
      : r.last ? `${en ? "Last run" : "最近一次"} ${esc(r.last.slice(5))}` : (en ? "No run yet" : "还没跑过");
    return `<div class="rs-row${r.paused ? " rs-off" : ""}" data-item="${esc(r.item)}">
      <div class="rs-t">${esc(r.time || "—")}</div>
      <div class="rs-m"><div class="rs-n">${a ? av(a, "rs-av", r.item) : ""}<b>${esc(nameOf(r, a))}</b></div><div class="rs-s">${a ? esc(aname(a)) + " · " : ""}${en ? "daily" : "每天"}</div></div>
      <div class="rs-r"><button type="button" class="rs-tg" data-rtq="${esc(r.id)}" role="switch" aria-checked="${!r.paused}" aria-label="${r.paused ? (en ? "Turn on" : "开启") : (en ? "Pause" : "暂停")}"><i></i></button><span class="rs-nx">${esc(nextTxt(r))}</span></div>
      <div class="rs-dots">${dots}</div>
      <div class="rs-last">${lastL}</div></div>`;
  };
  const sorted = [...rs].sort((x, y) => (!!x.paused - !!y.paused) || String(x.time || "").localeCompare(String(y.time || "")));
  const live = rs.filter(r => !r.paused && !r.disabled).length;
  const runIds = new Set(rs.flatMap(r => runsOf(r).map(k => k.id)));
  const rest = all.filter(i => !rIds.has(i.id) && !runIds.has(i.id)), od = rest.filter(i => grpOf(i) !== "done"), done = rest.filter(i => grpOf(i) === "done");
  const odRow = i => { const a = agent(i.owner); return `<div class="rs-row od" data-item="${esc(i.id)}"><div class="rs-m"><div class="rs-n">${a ? av(a, "rs-av", i.id) : ""}<b>${esc(i.title)}</b></div><div class="rs-s">${en ? "Runs when the manager starts it" : "管家说开工才跑"} · ${en ? "last" : "上次"} ${esc(when(i.activity || i.updated))}</div></div><span class="rs-nx dim">${i.paused && i.stage === "doing" ? (en ? "Paused" : "已暂停") : (en ? "On call" : "等管家叫")}</span></div>`; };   /* t-routine-detect: it.paused */
  return pageHead("ongoing") +
    `<div class="rs-h"><b>${en ? "Daily rhythm" : "每天的固定节奏"}</b><span>${en ? `${rs.length} · ${live} running · last 7 days` : `${rs.length} 项 · ${live} 项在跑 · 最近 7 天`}</span></div>` +
    ringOnce(() => `<div class="rs-list">${sorted.map(row).join("")}</div>` +
    (od.length ? `<div class="rs-h"><b>${en ? "On demand" : "按需常驻"}</b><span>${en ? "no fixed time" : "没有固定时间"}</span></div><div class="rs-list">${od.map(odRow).join("")}</div>` : "")) +
    (done.length ? stageGroups(done, "ongoing", true) : "");
}
/* t-schedule-ui: 定时 page (was 每日). One list of every state.schedules entry (imported routines included): human rule, next run,
   kind, agent, 迟到 tag, an on/off switch that flips in place, a ⋯ menu with 立即运行 / 删除 (held 5 s behind an undo pill, then
   schedule_rm). Polls patch the rows in place (the switch node survives, so its slide plays) and keep the row order frozen while the
   page is open; a new or removed entry redraws the page. 按需常驻 cards and finished one-offs follow the list. */
const SCH = { hold: new Set(), order: null, pend: null, timer: 0 }, SCH_HOLD = 5000;
const schZh = () => UI.lang !== "en";
const schAll = () => (ST.schedules || []).filter(s => s && !s.deleted && !SCH.hold.has(s.id));
const schFin = s => !s.enabled && (!!s.finished || (s.rule && s.rule.type === "once" && !s.next));
function schRule(r) {
  const zh = schZh(); if (!r) return "—";
  const at = String(r.at || "");
  if (r.type === "once") { const [d, t0] = at.split("T"); return `${zh ? "一次性" : "Once"} ${(d || "").slice(5)} ${t0 || ""}`.trim(); }
  if (r.type === "daily") return `${zh ? "每天" : "Daily"} ${at}`;
  if (r.type === "weekly") {
    const ds = (r.days || []).map(d => zh ? "一二三四五六日"[d - 1] : "Mon Tue Wed Thu Fri Sat Sun".split(" ")[d - 1]);
    return zh ? `每周${ds.join("、")} ${at}` : `Weekly ${ds.join(", ")} ${at}`;
  }
  if (r.type === "monthly") return r.mday === -1 ? `${zh ? "每月最后一天" : "Monthly, last day"} ${at}` : `${zh ? `每月 ${r.mday} 号` : `Monthly, day ${r.mday}`} ${at}`;
  return at;
}
const schAt = s => { const a = String((s.rule && s.rule.at) || ""); return a.includes("T") ? a.split("T")[1] : a || "—"; };
function schNext(s) {
  const zh = schZh();
  if (schFin(s)) return zh ? "已完成" : "Done";
  if (!s.enabled) return zh ? "已暂停" : "Paused";
  const nd = s.next && new Date(s.next); if (!nd || isNaN(nd)) return "—";
  const m = Math.round((nd - Date.now()) / 6e4);
  if (m <= 0) return zh ? "到点" : "due now";
  if (m < 60) return zh ? `还有 ${m} 分钟` : `in ${m} min`;
  const days = Math.round((new Date(nd.getFullYear(), nd.getMonth(), nd.getDate()) - new Date(new Date().setHours(0, 0, 0, 0))) / 864e5), t0 = hm(s.next);
  if (days === 0) return zh ? `今天 ${t0}` : `today ${t0}`;
  if (days === 1) return zh ? `明天 ${t0}` : `tomorrow ${t0}`;
  if (days < 7) return zh ? `周${"日一二三四五六"[nd.getDay()]} ${t0}` : `${"Sun Mon Tue Wed Thu Fri Sat".split(" ")[nd.getDay()]} ${t0}`;
  return `${nd.getMonth() + 1}/${nd.getDate()} ${t0}`;
}
const schLastRun = s => { const rs = s.runs || []; return rs[rs.length - 1] || null; };
const schLate = s => { const x = schLastRun(s); return x && x.late > 0 ? x.late : 0; };
const schRt = s => ((ST.meta && ST.meta.routines) || []).find(r => r.schedule === s.id || (s.routine && r.id === s.routine)) || null;
function schWho(s) {
  const tk = s.task || {}, it = tk.item && (ST.items || []).find(i => i.id === tk.item);
  const id = tk.agent || (it && it.owner); return id ? agent(id) : null;
}
function schName(s, a) {
  const n = String(s.title || s.id).replace(/[（(][^）)]*[）)]/g, "").trim(), o = a ? aname(a) : "";
  return (o && n.startsWith(o) ? n.slice(o.length).trim() : n) || n;
}
function schDots(s, r) {
  if (!s.rule || s.rule.type !== "daily") return "";
  const zh = schZh(), today = dayKey(new Date()), WK = zh ? ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const pz = s.paused && s.paused.at, done = new Map();
  (s.runs || []).forEach(x => { const d = x.for && new Date(x.for); if (d && !isNaN(d)) done.set(dayKey(d), x); });
  const cell = d => {
    const k = dayKey(d), x = r && Array.isArray(r.runs) ? r.runs.find(y => y.date === k) : null;
    if (x) return x.item && x.stage !== "done" ? ["…", "run", x.item] : ["✓", "ok", x.item || ""];
    if (done.has(k)) return ["✓", "ok", ""];
    if (!s.enabled && pz && k >= dayKey(new Date(pz))) return ["⏸", "off", ""];
    if (k === today && s.enabled && s.next && dayKey(new Date(s.next)) === today) return [schAt(s), "next", ""];
    return ["·", "na", ""];
  };
  return `<div class="rs-dots">${Array.from({ length: 7 }, (_, i) => new Date(Date.now() - (6 - i) * 864e5)).map((d, i) => { const [x, c, id] = cell(d); return `<span class="rs-d"${id ? ` data-item="${esc(id)}"` : ""}><b class="${c}">${esc(x)}</b><small>${i === 6 ? (zh ? "今天" : "Today") : WK[d.getDay()]}</small></span>`; }).join("")}</div>`;
}
function schLastLine(s, r) {
  const zh = schZh(), bits = [], x = schLastRun(s);
  const rc = r && Array.isArray(r.runs) ? [...r.runs].reverse().find(y => y.item) : null;
  if (schFin(s)) bits.push(`${zh ? "已完成" : "Done"} ${esc(when(s.finished || s.last))}${x && x.late > 0 ? (zh ? ` · 晚了 ${x.late} 分钟` : ` · ${x.late} min late`) : ""}`);
  else if (!s.enabled && s.paused && s.paused.at) bits.push(`${esc(when(s.paused.at))} ${zh ? "起暂停" : "paused"}`);
  if (schFin(s)) { }
  else if (rc) bits.push(`${zh ? "最近一期" : "Latest"} <u data-item="${esc(rc.item)}">${esc(rc.item)}</u>`);
  else if (x && x.at) bits.push(`${zh ? "上次" : "Last"} ${esc(when(x.at))}${x.manual ? (zh ? "（手动）" : " (manual)") : ""}${x.late > 0 ? (zh ? ` · 晚了 ${x.late} 分钟` : ` · ${x.late} min late`) : ""}`);
  else if (s.last) bits.push(`${zh ? "上次" : "Last"} ${esc(/T/.test(s.last) ? when(s.last) : s.last.slice(5))}`);
  else bits.push(zh ? "还没跑过" : "No run yet");
  const tx = s.task && s.task.text && s.task.text !== s.title ? s.task.text : "";
  if (s.said) bits.push(`${zh ? "你说的" : "You said"}「${esc(s.said)}」`);
  else if (tx) bits.push(esc(tx));
  return `<div class="rs-last">${bits.join(" · ")}</div>`;
}
function schRow(s) {
  const zh = schZh(), a = schWho(s), r = schRt(s), fin = schFin(s), late = schLate(s), it = s.task && s.task.item;
  const kind = s.kind === "remind" ? (zh ? "提醒" : "Reminder") : s.kind === "job" ? (zh ? "扩展任务" : "Extension job") : (zh ? "派活" : "Task");   /* S8: kind "job" = an extension's scheduled function (docs/extensions.md) */
  const sw = fin ? "" : `<button type="button" class="rs-tg sc-tg" data-sct="${esc(s.id)}" role="switch" aria-checked="${!!s.enabled}" aria-label="${s.enabled ? (zh ? "暂停" : "Pause") : (zh ? "开启" : "Turn on")}"><i></i></button>`;
  return `<div class="rs-row sc-row${s.enabled ? "" : " rs-off"}${fin ? " sc-fin" : ""}" data-sc="${esc(s.id)}"${it ? ` data-item="${esc(it)}"` : ""}>
      <div class="rs-t">${esc(schAt(s))}</div>
      <div class="rs-m"><div class="rs-n">${a ? av(a, "rs-av", it || undefined) : ""}<b>${esc(schName(s, a))}</b></div><div class="rs-s"><span class="sc-k ${s.kind === "remind" ? "rm" : "tk"}">${kind}</span>${late ? `<span class="sc-late">${zh ? `迟到 ${late} 分` : `late ${late}m`}</span>` : ""}${a ? esc(aname(a)) + " · " : ""}${esc(schRule(s.rule))}</div></div>
      <div class="rs-r"><div class="sc-ctl">${sw}<button type="button" class="sc-more" data-scm="${esc(s.id)}" aria-label="${zh ? "更多操作" : "More"}" aria-haspopup="menu"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="3.5" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="12.5" cy="8" r="1.4"/></svg></button></div><span class="rs-nx">${esc(schNext(s))}</span></div>
      ${fin ? "" : schDots(s, r)}${schLastLine(s, r)}</div>`;
}
function schSort(a, b) {
  const k = s => s.enabled ? 0 : 1, n = s => s.next ? Date.parse(s.next) : Infinity;
  return k(a) - k(b) || n(a) - n(b) || String(a.title).localeCompare(String(b.title));
}
function schedPage() {
  const zh = schZh(), body = document.getElementById("pagebody"), cur = body && body.querySelector(".sc-page");
  const all = schAll(), fin = all.filter(schFin);
  let live = all.filter(s => !schFin(s));
  const ids = live.map(s => s.id).sort().join(",");
  if (cur && SCH.order && [...SCH.order].sort().join(",") === ids) { const pos = new Map(SCH.order.map((id, i) => [id, i])); live.sort((a, b) => pos.get(a.id) - pos.get(b.id)); }
  else live.sort(schSort);
  SCH.order = live.map(s => s.id);
  const linked = new Set(all.map(s => s.task && s.task.item).filter(Boolean));
  const runIds = new Set(((ST.meta && ST.meta.routines) || []).flatMap(r => (r.runs || []).map(x => x.item).filter(Boolean)));
  const rest = items().filter(i => i.category === "ongoing" && !linked.has(i.id) && !runIds.has(i.id) && !(parentOf(i) && linked.has(parentOf(i).id)));
  const od = rest.filter(i => grpOf(i) !== "done"), done = rest.filter(i => grpOf(i) === "done");
  const on = live.filter(s => s.enabled).length;
  const hint = zh ? "跟管家说一句「明天 9 点提醒我…」就能建" : "Tell the manager “remind me tomorrow at 9…” to add one";
  const top = live.length ? `<div class="rs-h"><b>${zh ? "全部定时" : "All schedules"}</b><span>${zh ? `${live.length} 项 · ${on} 项在跑` : `${live.length} · ${on} on`}</span></div>` : "";
  const odRow = i => { const a = agent(i.owner); return `<div class="rs-row od" data-item="${esc(i.id)}"><div class="rs-m"><div class="rs-n">${a ? av(a, "rs-av", i.id) : ""}<b>${esc(i.title)}</b></div><div class="rs-s">${zh ? "管家说开工才跑" : "Runs when the manager starts it"} · ${zh ? "上次" : "last"} ${esc(when(i.activity || i.updated))}</div></div><span class="rs-nx dim">${i.paused && i.stage === "doing" ? (zh ? "已暂停" : "Paused") : (zh ? "等管家叫" : "On call")}</span></div>`; };
  const finOpen = doneOpen("sched-fin");
  const restH = (od.length ? `<div class="rs-h"><b>${zh ? "按需常驻" : "On demand"}</b><span>${zh ? "没有固定时间" : "no fixed time"}</span></div><div class="rs-list">${od.map(odRow).join("")}</div>` : "") +
    (fin.length ? `<button type="button" class="df-row sc-finrow" data-donefold="sched-fin" aria-expanded="${finOpen}"><span>${zh ? `已完成的一次性 · ${fin.length}` : `Finished one-offs · ${fin.length}`}</span><i aria-hidden="true">▸</i></button>${finOpen ? `<div class="rs-list sc-list">${fin.sort((a, b) => String(b.finished || b.last).localeCompare(String(a.finished || a.last))).map(schRow).join("")}</div>` : ""}` : "") +
    (done.length ? stageGroups(done, "ongoing", true) : "") +
    (live.length || od.length || fin.length ? `<div class="sc-hint">${hint}</div>` : "");
  const rows = ringOnce(() => live.map(s => [s.id, schRow(s)]));
  const empty = !live.length && !od.length && !fin.length && !done.length;
  if (cur && cur.dataset.lang === UI.lang && !empty && cur.querySelector(".sc-live") && live.length) {   /* patch in place: same entries, same order */
    const same = [...cur.querySelectorAll(".sc-live > [data-sc]")].map(e => e.dataset.sc).join(",") === live.map(s => s.id).join(",");
    if (same) {
      const tp = cur.querySelector("[data-scp=top]"); if (tp._h !== top) { tp.innerHTML = top; tp._h = top; }
      const rp = cur.querySelector("[data-scp=rest]"); if (rp._h !== restH) { rp.innerHTML = restH; rp._h = restH; }
      rows.forEach(([id, h]) => { const el = cur.querySelector(`.sc-live > [data-sc="${CSS.escape(id)}"]`); if (el && el._h !== h) schPatch(el, h); });
      return null;
    }
  }
  const html = pageHead("ongoing") + `<div class="sc-page" data-lang="${UI.lang}">` + (empty
    ? utEmpty(hint, "empty sc-empty", zh ? "还没有定时" : "No schedules yet")
    : `<div data-scp="top">${top}</div><div class="rs-list sc-live">${rows.map(x => x[1]).join("")}</div><div data-scp="rest">${restH}</div>`) + `</div>`;
  requestAnimationFrame(() => {   /* remember what each part was drawn from, so the next poll can patch */
    const p = document.querySelector("#pagebody .sc-page"); if (!p) return;
    const tp = p.querySelector("[data-scp=top]"), rp = p.querySelector("[data-scp=rest]"); if (tp) tp._h = top; if (rp) rp._h = restH;
    rows.forEach(([id, h]) => { const el = p.querySelector(`.sc-live > [data-sc="${CSS.escape(id)}"]`); if (el) el._h = h; });
  });
  return html;
}
/* swap a row's contents but keep its switch node, so a toggle's slide is never cut by the poll that follows it */
function schPatch(el, h) {
  const tpl = document.createElement("template"); tpl.innerHTML = h.trim(); const nw = tpl.content.firstElementChild; if (!nw) return;
  const oldSw = el.querySelector(".sc-tg"), newSw = nw.querySelector(".sc-tg");
  if (oldSw && newSw) { ["aria-checked", "aria-label"].forEach(k => oldSw.setAttribute(k, newSw.getAttribute(k))); newSw.replaceWith(oldSw); }
  el.className = nw.className; [...nw.attributes].forEach(x => { if (x.name !== "class") el.setAttribute(x.name, x.value); });
  if (!nw.hasAttribute("data-item")) el.removeAttribute("data-item");
  el.replaceChildren(...nw.childNodes); el._h = h;
}
const schById = id => (ST.schedules || []).find(s => s.id === id);
function schToggle(b) {
  const s = schById(b.dataset.sct); if (!s) return;
  const zh = schZh(), on = b.getAttribute("aria-checked") === "true", row = b.closest(".sc-row");
  b.setAttribute("aria-checked", String(!on)); b.disabled = true;
  if (row) { row.classList.toggle("rs-off", on); const nx = row.querySelector(".rs-nx"); if (nx && on) nx.textContent = zh ? "已暂停" : "Paused"; }
  api(on ? "schedule_pause" : "schedule_resume", { schedule: s.id })
    .then(() => { const n = schById(s.id); toast(on ? (zh ? "已暂停 · 到点不会再触发" : "Paused") : (zh ? `已开启 · 下次 ${n ? schNext(n) : ""}` : `On · next ${n ? schNext(n) : ""}`)); })
    .catch(() => { b.setAttribute("aria-checked", String(on)); if (row) row.classList.toggle("rs-off", !on); renderPage(); })
    .finally(() => { b.disabled = false; });
}
function schMenu(b) {
  const s = schById(b.dataset.scm); if (!s) return;
  const zh = schZh(), fin = schFin(s);
  const fireSub = s.kind === "remind" ? (zh ? "现在就发一条提醒" : "Send the reminder now") : s.kind === "job" ? (zh ? "现在就跑一次" : "Run it now") : (zh ? "现在就交给管家派活" : "Hand it to the manager now");
  const pop = snzOpen(`<div class="snz-h"><b>${esc(schName(s, schWho(s)))}</b><small>${esc(schRule(s.rule))}</small></div>` +
    (fin ? "" : `<button type="button" class="snz-o" role="menuitem" data-sc-fire><b>${zh ? "立即运行" : "Run now"}</b><span>${fireSub}</span></button>`) +
    `<button type="button" class="snz-o sc-del" role="menuitem" data-sc-del><b>${zh ? "删除" : "Delete"}</b><span>${zh ? "5 秒内可撤销" : "undo within 5 s"}</span></button>`, b, null, true);
  pop.addEventListener("click", e => {
    if (e.target.closest("[data-sc-fire]")) {
      pop.classList.add("busy");
      api("schedule_fire", { schedule: s.id })
        .then(() => { snzClose(false); toast(s.kind === "remind" ? (zh ? "已发出提醒 · 在信箱里" : "Reminder sent") : s.kind === "job" ? (zh ? "已开始跑 · 在后台" : "Running in the background") : (zh ? "已触发 · 管家会接着派活" : "Fired · the manager takes it from here")); })
        .catch(() => pop.classList.remove("busy"));
    } else if (e.target.closest("[data-sc-del]")) { snzClose(false); schDelStart(s); }
  });
}
function schUndoBar() {
  let u = document.getElementById("sc-undo");
  if (!u) { u = document.createElement("div"); u.id = "sc-undo"; u.setAttribute("role", "status"); u.hidden = true; document.body.appendChild(u); }
  return u;
}
function schUndoHide() { const u = document.getElementById("sc-undo"); if (u && !u.hidden) { u.classList.remove("on"); clearTimeout(u._h); u._h = setTimeout(() => { u.hidden = true; }, 260); } }
function schDelStart(s) {
  if (SCH.pend) schDelCommit();
  const zh = schZh(), row = document.querySelector(`.sc-row[data-sc="${CSS.escape(s.id)}"]`);
  SCH.pend = s.id;
  const go = () => { SCH.hold.add(s.id); if (UI.page === "ongoing") renderPage(); };
  if (row && !matchMedia("(prefers-reduced-motion: reduce)").matches) { row.style.height = row.offsetHeight + "px"; void row.offsetWidth; row.classList.add("sc-out"); setTimeout(go, 220); } else go();
  const u = schUndoBar();
  u.innerHTML = `<span class="rv-u-tx"><b>${zh ? "已删除" : "Deleted"}</b>${esc(schName(s, schWho(s)))}</span><button type="button" data-sc-undo>${zh ? "撤销" : "Undo"}</button><i class="rv-u-bar" style="--hold:${SCH_HOLD}ms"></i>`;
  clearTimeout(u._h); u.hidden = false; void u.offsetWidth; u.classList.add("on");
  clearTimeout(SCH.timer); SCH.timer = setTimeout(() => schDelCommit(), SCH_HOLD);
}
function schDelCommit(keepalive) {
  const id = SCH.pend; if (!id) return;
  clearTimeout(SCH.timer); SCH.pend = null; schUndoHide();
  const body = JSON.stringify({ kind: "schedule_rm", schedule: id });
  if (keepalive) { try { fetch("/api/action", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body }); } catch (e) { } return; }
  api("schedule_rm", { schedule: id }).then(() => { SCH.hold.delete(id); }).catch(() => { SCH.hold.delete(id); if (UI.page === "ongoing") renderPage(); });
}
function schUndo() {
  const id = SCH.pend; if (!id) return;
  clearTimeout(SCH.timer); SCH.pend = null; SCH.hold.delete(id); schUndoHide();
  if (UI.page === "ongoing") renderPage();
  toast(schZh() ? "已撤销删除" : "Restored");
}

function wireSchedule() {
  document.addEventListener("click", e => {
    if (!e.target.closest) return;
    const tg = e.target.closest("[data-sct]"); if (tg) { e.preventDefault(); schToggle(tg); return; }
    const mm = e.target.closest("[data-scm]"); if (mm) { e.preventDefault(); schMenu(mm); return; }
    if (e.target.closest("[data-sc-undo]")) { e.stopPropagation(); schUndo(); }
  });
  addEventListener("pagehide", () => schDelCommit(true));
}

export { ongoingPage, SCH, SCH_HOLD, schZh, schAll, schFin, schRule, schAt, schNext, schLastRun, schLate, schRt, schWho, schName, schDots, schLastLine, schRow, schSort, schedPage, schPatch, schById, schToggle, schMenu, schUndoBar, schUndoHide, schDelStart, schDelCommit, schUndo, wireSchedule };
