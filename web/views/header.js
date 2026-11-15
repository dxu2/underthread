// Dashboard view: the header (#top): next event, clock, manager state, the usage / stamina block, role usage cards, the SYNC row, swatches, and the outside-tool badge and line (toolBadge, toolLine).
// t-oss-struct S10 (A6): moved out of app.js unchanged; a wire*() function, if any, holds the top-level event wiring and app.js calls it where
// the code used to run, so listeners register in the same order as before.

/* ===== t-chrome-badge: agents[id].tool = the outside tool an agent is driving right now (stateutil set-agent --tool chrome; "" or idle/offline clears it).
   One badge on every avatar (toolBadge, called by av) + one line 「Chrome 使用中 · 谁 · 在做什么」 (toolLine: desktop header #toolbar, phone home .hd-tool).
   Enter/exit motion plays once: TOOL_T keeps when each agent's tool last changed (client clock); only inside that window does the markup carry tl-in / tl-out
   plus a negative animation-delay, so a poll re-render continues the motion instead of replaying it. First sight after page load = no motion.
   No infinite animation here (fx.js would mark one with data-ip anyway), no blinking dot; prefers-reduced-motion turns the motion off in CSS. ===== */
import { $, LS } from "../core/util.js";
import { D, ago, dayKey, hm, pad, relH, srvLocal, srvT, t, when } from "../core/i18n.js";
import { ST, UI, mailUnread } from "../core/store.js";
import { agent, agents, aname, avatarUrl } from "../core/av.js";
import { api, toast } from "../core/ui.js";
import { go } from "../core/router.js";
import { chatPop } from "./chat.js";
import { rtShort, schToday } from "./left.js";
import { MOBQ } from "./pages/common.js";
import { renderPage } from "./pages/index.js";
import { modalStatus } from "./status.js";
import { MB, NV, RMQ, closeMailbox, isBusy, liveItem, openMailbox, render, roll, wkDur } from "../app.js";
const TOOL_IC = {
  chrome: `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><ellipse cx="8" cy="8" rx="2.6" ry="6.2"/><path d="M1.8 8h12.4"/></svg>`,
  computer: `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.8" y="2.5" width="12.4" height="8.6" rx="1.6"/><path d="M5.5 13.8h5M8 11.1v2.7"/></svg>`,
  _: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.4 2.2a3.4 3.4 0 0 0-3.9 4.5L2.2 11a1.3 1.3 0 0 0 1.8 1.8l4.3-4.3a3.4 3.4 0 0 0 4.5-3.9l-2 2-1.7-.5-.5-1.7z"/></svg>`
};
const toolName = k => k === "chrome" ? "Chrome" : k === "computer" ? (UI.lang === "en" ? "Computer" : "电脑") : String(k);
const toolIc = k => TOOL_IC[k] || TOOL_IC._;
const TOOL_IN = 400, TOOL_OUT = 220, TOOL_STALE = 60 * 60e3, TOOL_T = {};
function toolFx(a) {   /* -> { k: tool now ("" = none), was: tool just cleared, ph: "in" | "out" | "", ms: elapsed } */
  const k = (a && a.tool) || "", r = TOOL_T[a.id], now = Date.now();
  if (!r) TOOL_T[a.id] = { k, was: "", t: 0 };
  else if (r.k !== k) { TOOL_T[a.id] = { k, was: r.k, t: now }; }
  const x = TOOL_T[a.id], ms = now - x.t;
  return { k, was: x.was, ms, ph: k && ms < TOOL_IN ? "in" : !k && x.was && ms < TOOL_OUT ? "out" : "" };
}
const fxStyle = f => f.ph ? ` style="animation-delay:-${Math.round(f.ms)}ms"` : "";
function toolBadge(a) {
  if (!a || !a.id || a.id === "me") return "";
  const f = toolFx(a), k = f.k || (f.ph === "out" ? f.was : "");
  if (!k) return "";
  return `<i class="tl${f.ph ? " tl-" + f.ph : ""}"${fxStyle(f)} title="${esc(toolName(k))} ${UI.lang === "en" ? "in use" : "使用中"}">${toolIc(k)}</i>`;
}
const toolWhat = a => String(a.activity || "").replace(new RegExp("^\\s*" + toolName(a.tool || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*[·:：-]\\s*", "i"), "");
let TOOL_LAST = "";
/* core / local split: an extension (local/web/*.js) adds a button to a tool pill with App.addToolExtra((agent, toolKey, stale) => html) */
const TOOL_EXTRA = [];
function toolLine(where) {   /* where: "d" = desktop header, "m" = phone home */
  const en = UI.lang === "en", list = agents().filter(a => a.enabled !== false);
  const fx = list.map(a => [a, toolFx(a)]), on = fx.filter(([, f]) => f.k);
  if (!on.length) {
    const out = fx.find(([, f]) => f.ph === "out");
    return out && TOOL_LAST ? TOOL_LAST.replace('class="tool-pill', `style="animation-delay:-${Math.round(out[1].ms)}ms" class="tool-pill tp-out`) : (TOOL_LAST = "", "");
  }
  const byK = {}; on.forEach(([a, f]) => (byK[f.k] = byK[f.k] || []).push([a, f]));
  const html = Object.keys(byK).map(k => {
    const g = byK[k], [a, f] = g[0], nm = toolName(k), ent = g.find(([, x]) => x.ph === "in");
    const cls = "tool-pill" + (ent ? " tp-in" : "") + (g.length > 1 ? " warn" : ""), dl = ent ? ` style="animation-delay:-${Math.round(ent[1].ms)}ms"` : "";
    if (g.length > 1) return `<div class="${cls}"${dl} role="status"><span class="ic">${toolIc(k)}</span><b>${esc(nm)} ${en ? "conflict" : "冲突"}</b><i class="d">·</i><span class="what">${g.map(([x]) => esc(aname(x))).join(en ? ", " : "、")} ${en ? "are all using it" : "同时在用"}</span></div>`;
    const it = liveItem(a), since = a.tool_since, old = since && Date.now() - Date.parse(since) > TOOL_STALE, what = toolWhat(a);
    return `<div class="${cls}${old ? " stale" : ""}"${dl} role="button" tabindex="0" ${it ? `data-item="${esc(it.id)}"` : `data-chat="${esc(a.id)}"`} title="${esc(nm)} ${en ? "in use" : "使用中"} · ${esc(aname(a))}${what ? " · " + esc(what) : ""}">`
      + `<span class="ic">${toolIc(k)}</span><b>${esc(nm)}<span class="iu"> ${en ? "in use" : "使用中"}</span></b><i class="d">·</i>`
      + `<span class="who"><i style="background-image:url('${avatarUrl(a)}')"></i><span class="nm">${esc(aname(a))}</span></span>`
      + (what ? `<i class="d">·</i><span class="what">${esc(what)}</span>` : `<span class="what"></span>`)
      + (since ? `<time class="wk-el" data-since="${esc(since)}">${wkDur(since)}</time>${old ? `<em>${en ? "maybe left on" : "可能忘了清"}</em>` : ""}` : "")
      + TOOL_EXTRA.map(fn => { try { return fn(a, k, !!old) || ""; } catch (e) { return ""; } }).join("") + `</div>`;
  }).join("");
  TOOL_LAST = html.replace(/ tp-in| style="animation-delay:-\d+ms"/g, "");
  return html;
}
let toolHTML = null;
function renderTool() { const el = $("#toolbar"); if (!el || !ST) return; const h = toolLine("d"); if (h !== toolHTML) { toolHTML = h; el.innerHTML = h; } }

// ---------- header ----------
/* today's 定时 runs not sent yet (meta.routines, 定时-page schedules, the 日报), by time; shared by the header's NEXT and the rail's 定时 badge (t-ri1113-a P5) */
function runsLeft(now = new Date()) {
  const today = dayKey(now), at = tm => new Date(`${today}T${tm}`), rep = ST.meta && ST.meta.report_time;
  return [...((ST.meta && ST.meta.routines) || []).filter(r => !r.paused && !r.disabled && r.time && r.last !== today).map(r => ({ time: r.time, title: rtShort(r) })),
    ...schToday().filter(r => !r.ran && r.time).map(r => ({ time: r.time, title: rtShort(r) })),
    ...(rep && ST.meta.last_report_date !== today ? [{ time: rep, title: UI.lang === "en" ? "Daily report" : "日报" }] : [])].map(r => ({ ...r, d: at(r.time) })).sort((a, b) => a.d - b.d);
}
function nextEvent() {
  const now = new Date();
  /* t-ui-fix-r7 R7-04: today's 定时 runs that are still to come (meta.routines, 定时-page schedules, the 日报) count too, like the 今日日程 rail */
  const runs = runsLeft(now);
  /* r-improve-1112 P4: a run whose time has passed but that has not been sent yet is 「到点」 in the 今日日程 rail (rtRow); it goes first here too,
     because those minutes are exactly when the user wants to know what is pending. Earliest due one wins; calendar events are not "due". */
  const due = runs.filter(r => r.d <= now && !isNaN(r.d)).sort((a, b) => a.d - b.d)[0];
  if (due) return `<b class="sy-due">${UI.lang === "en" ? "Due, not sent" : "到点未派"} · ${esc(due.time)} ${esc(due.title)}</b>`;
  const ev = [...(ST.calendar || []).map(c => ({ ...c, d: new Date(`${c.date}T${c.time || "00:00"}`) })), ...runs].filter(c => c.d > now && !isNaN(c.d)).sort((a, b) => a.d - b.d)[0];
  if (!ev) return "";   // t-cal-fold: no upcoming event -> the header leaves the NEXT segment out
  const lbl = dayKey(ev.d) === dayKey(now) ? t("today_w") : dayKey(ev.d) === dayKey(new Date(Date.now() + 864e5)) ? t("tomorrow") : `${ev.d.getMonth() + 1}/${ev.d.getDate()}`;
  return `<b>${lbl} ${esc(ev.time || "")} ${esc(ev.title)}</b>`;
}
function mgrState() {
  const m = agent("manager");
  const stale = m.last_seen && (Date.now() - new Date(m.last_seen)) > 45 * 6e4 && ST.meta.inbox_unacked > 0;
  if (m.status === "offline" || !m.last_seen) return { on: false, txt: t("offline") };
  // asleep: planned (S sleep --until) or a hard stop (a usage window at ~100% and no heartbeat since)
  const u = ST.meta.usage || {}, quiet = Date.now() - new Date(m.last_seen) > 10 * 6e4;
  const hit = [u.five_hour, u.seven_day].filter(w => w && w.used >= 98 && until(w.resets_at)).map(w => w.resets_at).sort().pop();
  const wake = m.status === "sleeping" ? m.wake_at : quiet && hit;
  if (wake) {
    const back = until(wake);
    return { on: false, sleep: true, wake, back: back && clock(wake), since: m.last_seen,
      txt: back ? t("sleep_at", { t: clock(wake) }) : t("waking") };
  }
  return { on: !stale, txt: stale ? `${t("offline")}?` : t("online"), since: m.last_seen };
}
// Plan usage comes from the manager's statusLine (tools/statusline.py): 5-hour window drives the orb,
// the weekly window is the thin bar under it. Shown as what's LEFT, like a stamina bar.
function until(iso) {
  const ms = new Date(iso) - Date.now(); if (!(ms > 0)) return null;
  const h = Math.floor(ms / 36e5), m = Math.round(ms % 36e5 / 6e4);
  return h ? `${h}h${pad(m)}m` : `${m}m`;
}
// "03:10" today, "明天 03:10" / "周二 19:00" further out; English uses 3:10 AM style like Claude's own card
function clock(iso) {
  const d = new Date(Math.round(new Date(iso) / 6e4) * 6e4), en = UI.lang === "en", now = new Date();  // 03:09:59 reads as 03:10
  const tm = en ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const days = Math.round((new Date(d.toDateString()) - new Date(now.toDateString())) / 864e5);
  if (days <= 0) return tm;
  if (days === 1) return en ? `tomorrow ${tm}` : `明天 ${tm}`;
  return (en ? d.toLocaleDateString("en-US", { weekday: "short" }) : "周" + "日一二三四五六"[d.getDay()]) + " " + tm;
}
// t-imp-p4: usage is shown honestly. The manager's usage tool times out often, so old readings are normal:
// older than USAGE_STALE minutes = "≈" + "11:11 的数据" + greyed; a window whose reset passed AFTER the reading
// is unknown (the reading is from before the reset), never "100% 已回满".
const USAGE_STALE = 20;   // t-stamina-stale: was 30; past this the orb greys out and the subtitle says how old the reading is
const ageShort = iso => { const d = D(iso); if (!d) return ""; const m = Math.max(0, Math.round((Date.now() - d) / 6e4)), en = UI.lang === "en";
  return m < 60 ? (en ? `${m} min ago` : `${m} 分钟前`) : m < 48 * 60 ? (en ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 60)} 小时前`) : when(iso); };
function ageTxt(iso) {
  const d = D(iso); if (!d) return "";
  const m = Math.max(0, Math.round((Date.now() - d) / 6e4)), en = UI.lang === "en";
  if (m < 1) return t("just");
  if (m < 60) return en ? `${m} min ago` : `${m} 分钟前`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 48) return en ? `${h}h${r ? ` ${r}m` : ""} ago` : `${h} 小时${r ? ` ${r} 分钟` : ""}前`;
  return when(iso);
}
function usageSrc(src) {
  const en = UI.lang === "en";
  if (src === "manager") return en ? "read by the manager with the desktop app's get_usage" : "管家用桌面端 get_usage 读取";
  if (src === "statusline") return en ? "written by the terminal statusLine (tools/statusline.py)" : "终端 statusLine 自动写入（tools/statusline.py）";
  return src ? (en ? `source: ${src}` : `来源：${src}`) : (en ? "source unknown" : "来源未记录");
}
function usage() {
  const u = ST.meta.usage || {}, en = UI.lang === "en";
  const five = u.five_hour, week = u.seven_day;
  if (!five && !week) return { left: null, week: null, sub: en ? "no usage data" : "未接入用量", stale: true, none: true,
    tip: en ? "Set up tools/statusline.py as the manager's statusLine" : "把 tools/statusline.py 配成管家的 statusLine 后显示 Claude 用量" };
  const at = D(u.at), ageMin = at ? (Date.now() - at) / 6e4 : Infinity;
  const stale = ageMin > USAGE_STALE;
  const gone = w => { const r = w && D(w.resets_at); return !!r && r <= Date.now() && (!at || at < r); };
  const lost5 = gone(five), lostW = gone(week);
  const reset5 = five && until(five.resets_at), resetW = week && until(week.resets_at);
  const at5 = reset5 && clock(five.resets_at), atW = resetW && clock(week.resets_at);
  // t-stamina-stale v2: a window that reset after the reading starts again from 0, so it is shown as an estimated 100% ("估"), not "—".
  // Number = how much is left (估 when estimated), subtitle = the window's state, the desktop pill = why the reading is old and for how long.
  const left = five ? (lost5 ? 100 : Math.round(100 - five.used)) : null;
  const wk = week ? (lostW ? 100 : Math.round(100 - week.used)) : null;
  const approx = (stale || lost5) && left != null, approxW = (stale || lostW) && wk != null;
  const ms = mgrState(), why = ms.sleep ? (en ? "manager asleep" : "管家休眠") : !ms.on ? (en ? "manager offline" : "管家离线") : (en ? "read timed out" : "读取超时");
  const mins = at ? Math.max(0, Math.round(ageMin)) : 0;
  const quiet = mins < 60 ? (en ? `no update for ${mins} min` : `${mins} 分钟没更新`) : mins < 48 * 60 ? (en ? `no update for ${Math.floor(mins / 60)}h` : `${Math.floor(mins / 60)} 小时没更新`) : (en ? `no update since ${when(u.at)}` : `${when(u.at)} 起没更新`);
  const pill = stale && u.at ? `${why} · ${quiet}` : "";
  const sub = lost5 ? (en ? `full since ${clock(five.resets_at)}` : `${clock(five.resets_at)} 已回满`)
    : left === 100 ? (en ? "full" : "满格")   /* t-ri1108-a P3: nothing used yet, so no 「HH:MM 复活」 */
    : reset5 ? (en ? `full at ${at5}` : `${at5} 复活`) : "";
  const subPh = stale && u.at ? `${why} · ${ageShort(u.at)}` : sub;   // phones have no pill: the subtitle says why instead
  const age = u.at ? ageTxt(u.at) : "";
  const tip = [five && (lost5 ? (en ? `Session: reset at ${clock(five.resets_at)} after the last reading · estimated near full` : `5 小时窗口：上次读数之后已在 ${clock(five.resets_at)} 重置 · 估计接近回满`)
      : (en ? `Session: ${approx ? "≈" : ""}${left}% left${at5 ? ` · full at ${at5}` : ""}` : `5 小时窗口：剩 ${approx ? "≈" : ""}${left}%${at5 ? ` · ${at5} 回满` : ""}`)),
    week && (lostW ? (en ? "Weekly: reset after the last reading · estimated near full" : "本周：上次读数之后已重置 · 估计接近回满")
      : (en ? `Weekly: ${approxW ? "≈" : ""}${wk}% left${atW ? ` · resets ${atW}` : ""}` : `本周：剩 ${approxW ? "≈" : ""}${wk}%${atW ? ` · ${atW} 重置` : ""}`)),
    u.context != null && (en ? `Manager context: ${u.context}% used` : `管家上下文：已用 ${u.context}%`),
    u.at && (en ? `Read at ${hm(u.at)} (${age})${stale ? ` · ${why}` : ""}` : `${hm(u.at)} 读取（${age}）${stale ? ` · ${why}` : ""}`)].filter(Boolean).join("\n");
  return { left, week: wk, sub, subPh, pill, why, stale, approx, approxW, lost5, lostW, age, tip, reset5, resetW, at5, atW, src: u.source,
    used5: five && Math.round(five.used), usedW: week && Math.round(week.used), context: u.context, at: u.at };
}
// ===== t-home-usage (approved 11-04): tokens per role today, from GET /api/usage (server reads the local transcripts, 60 s cache).
// One builder, three places: the desktop widget (widgets.js), the phone home card, the 系统状态 panel. Quota % stays a small strip under it.
const UG = { data: null, at: 0, busy: null, key: "", prev: new Map() };
function loadRoleUsage() {
  if (UG.busy || Date.now() - UG.at < 6e4) return;
  UG.busy = fetch("/api/usage").then(r => r.ok ? r.json() : null).catch(() => null).then(d => {
    UG.at = Date.now(); UG.busy = null; if (!d || !Array.isArray(d.roles)) return;
    const k = JSON.stringify([d.day, d.roles.map(r => [r.id, r.new])]); UG.data = d;
    if (k === UG.key) return; UG.key = k;
    if (UI.page === "review" || (UI.page === "settings" && UI.setTab === "system")) renderPage();
    const m = $("#modal .mdl.sys"); if (m && m._paint) m._paint();
  });
}
const fmtTok = n => { n = +n || 0; const en = UI.lang === "en";
  if (n >= 1e8 && !en) return (n / 1e8).toFixed(n >= 1e9 ? 0 : 1) + " 亿";
  return n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n); };
function roleUsage() {
  loadRoleUsage();
  const d = UG.data; if (!d) return null;
  const rows = d.roles.filter(r => r.new > 0).map(r => ({ ...r, a: r.id === "other" ? null : agent(r.id) }));
  return { ...d, rows };
}
function ruName(r) { const en = UI.lang === "en"; return r.id === "other" ? (en ? "Other sessions" : "其他会话") : r.a ? aname(r.a) : r.id; }
function ruTip(r) { const en = UI.lang === "en", f = fmtTok;
  return en ? `input ${f(r.in)} · output ${f(r.out)} · cache write ${f(r.cw)} · cache read ${f(r.cr)} · ${r.msgs} replies · ${r.sessions} sessions`
    : `输入 ${f(r.in)} · 输出 ${f(r.out)} · 写缓存 ${f(r.cw)} · 读缓存 ${f(r.cr)} · ${r.msgs} 次回复 · ${r.sessions} 个会话`; }
// quota strip: 5 小时 / 本周 / 管家上下文 (what is LEFT), greyed + 「X 分钟前 · 可能已过期」 past USAGE_STALE (same usage() as the orb)
function ruQuota(compact) {   // compact (home widget, t-sync-pill batch 2): one line, no manager context, a stale reading = warn dot + age
  const U = usage(), en = UI.lang === "en"; if (U.none) return "";
  const v = (x, est) => x == null ? "—" : `${est ? "≈" : ""}${x}%`;
  const age = U.at ? relH("ago", U.at, ago(U.at)) : "";
  return `<div class="ru-q${U.stale ? " old" : ""}" data-ru-open><span>${en ? "5-hour" : "5 小时"} <b>${v(U.left, U.approx)}</b></span><span>${en ? "Week" : "本周"} <b>${v(U.week, U.approxW)}</b></span>`
    + (U.context != null && !compact ? `<span>${en ? "Manager context" : "管家上下文"} <b>${v(100 - U.context, U.stale)}</b></span>` : "")
    + (compact ? `<span class="ru-age${U.stale ? " old" : ""}" title="${U.stale ? (en ? "may be out of date" : "可能已过期") : ""}">${age}</span></div>`
      : `<span class="ru-age">${U.stale ? `<em>${age} · ${en ? "may be out of date" : "可能已过期"}</em>` : age}</span></div>`);
}
// t-soul-widget (user 11-11 00:43, option B): the desk Usage widget's lower half = 「Soul · quota per model」, one row per model; the top-bar Soul orb is hidden there.
// Claude = the same usage() as the orb (what is LEFT). Codex = meta.codex, the rate_limits snapshot server.py reads from the newest ~/.codex/sessions log
// (weekly window only); it only moves when Codex runs, so the row says when it was read and greys out past 24 h.
function soulSw(left) {   /* 3 x 4 knit V stitches, filled from the bottom = what is left */
  const on = left == null ? 0 : Math.round(Math.max(0, Math.min(100, left)) / 100 * 12); let s = `<svg class="sl-sw" viewBox="0 0 30 36" aria-hidden="true"><rect class="cl" x="1" y="1" width="28" height="34" rx="4"></rect>`, n = 0;
  for (let r = 3; r >= 0; r--) for (let c = 0; c < 3; c++) { const x = 5 + c * 7.2, y = 5 + r * 7.4; s += `<path class="${n++ < on ? "on" : "off"}" d="M${x.toFixed(1)} ${y.toFixed(1)}Q${(x + 1.2).toFixed(1)} ${(y + 4.6).toFixed(1)} ${(x + 3.3).toFixed(1)} ${(y + 5.4).toFixed(1)}Q${(x + 5.4).toFixed(1)} ${(y + 4.6).toFixed(1)} ${(x + 6.6).toFixed(1)} ${y.toFixed(1)}"></path>`; }
  return s + "</svg>"; }
function soulHTML() {
  const en = UI.lang === "en", U = usage(), C = ST.meta.codex;
  const bar = (l, v, est) => `<div class="sl-b"><span>${l}</span><i><em style="--w:${v == null ? 0 : (Math.max(0, Math.min(100, v)) / 100).toFixed(3)}"></em></i><b>${v == null ? "—" : `${est ? "≈" : ""}${v}<small>%</small>`}</b></div>`;
  const cAge = U.at ? relH("ago", U.at, ago(U.at)) : "";
  const cRight = U.none ? (en ? "not connected" : "未接入") : U.stale ? `<em class="sl-old">${cAge}</em>` : U.sub ? (en ? U.sub.replace(/^full at /, "full at <b>") + (/^full at /.test(U.sub) ? "</b>" : "") : U.sub) : "";
  const claude = `<div class="sl-m${U.stale ? " old" : ""}" title="${esc(U.tip)}">${soulSw(U.left)}<div class="sl-mn"><b>Claude</b></div><div class="sl-full">${cRight}</div>`
    + `<div class="sl-bars">${bar(en ? "5-hour" : "5 小时", U.left, U.approx)}${bar(en ? "Week" : "本周", U.week, U.approxW)}</div></div>`;
  let codex;
  if (!C || C.used == null) codex = `<div class="sl-m old">${soulSw(null)}<div class="sl-mn"><b>Codex</b><small>${en ? "not read yet" : "还没读到"}</small></div><div class="sl-full"></div><div class="sl-bars">${bar(en ? "Week" : "本周", null)}</div></div>`;
  else {
    const at = D(C.at), old = !at || Date.now() - at > 864e5, rs = C.resets_at && D(C.resets_at), reset = !!rs && rs <= Date.now();
    const left = reset ? 100 : Math.round(100 - C.used), plan = C.plan ? C.plan[0].toUpperCase() + C.plan.slice(1) : "";
    const read = (en ? "last read · " : "上次读到 · ") + relH("ago", C.at, ago(C.at));
    const right = reset ? (en ? "reset since" : "之后已重置") : rs ? (en ? `resets <b>${clock(C.resets_at)}</b>` : `<b>${clock(C.resets_at)}</b> 重置`) : "";
    const tip = (en ? `Codex ${plan} · weekly ${Math.round(C.used)}% used` : `Codex ${plan} · 本周已用 ${Math.round(C.used)}%`) + (rs ? (en ? ` · resets ${clock(C.resets_at)}` : ` · ${clock(C.resets_at)} 重置`) : "")
      + (en ? `\nRead from the newest Codex session log at ${hm(C.at)}; it only updates when Codex runs` : `\n${hm(C.at)} 从最新的 Codex 会话日志读到；Codex 跑过才会更新`);
    codex = `<div class="sl-m${old ? " old" : ""}" title="${esc(tip)}">${soulSw(left)}<div class="sl-mn"><b>Codex</b>${plan ? `<small>${esc(plan)}</small>` : ""}</div><div class="sl-full">${right}</div>`
      + `<div class="sl-bars">${bar(en ? "Week" : "本周", left, reset)}<span class="sl-rd">${read}</span></div></div>`;
  }
  return `<div class="sl" data-ru-open><div class="sl-sep">${en ? "Soul <span>quota per model</span>" : "体力 <span>· 每个模型的额度</span>"}</div><div class="sl-ms">${claude}${codex}</div></div>`;
}
// n: rows to list; o.tot: the big total line; o.quota: the strip
function ruHTML(n, o = {}) {
  const R = roleUsage(), en = UI.lang === "en";
  if (!R) return `<div class="ru-wait">${en ? "Counting…" : "正在统计…"}</div>` + (o.soul ? soulHTML() : o.quota ? ruQuota() : "");
  const rows = R.rows, max = rows.length ? rows[0].new : 1, more = rows.length - n;
  const list = rows.length ? rows.slice(0, n).map((r, i) => `<div class="ru-row${r.a ? "" : " nd"}"${r.a ? ` data-chat="${esc(r.id)}"` : ""} title="${esc(ruTip(r))}" style="--ru-i:${i}">`
      + (r.a ? `<img class="ru-av" src="${avatarUrl(r.a)}" alt="">` : `<span class="ru-av"></span>`)
      + `<span class="ru-n"><span class="t">${esc(ruName(r))}</span>${r.a && r.a.status === "working" ? `<i class="ru-on" title="${en ? "working" : "工作中"}"></i>` : ""}</span>`
      + `<i class="ru-bar"><em data-ru="${esc(r.id)}" style="--ru-w:${Math.max(0.02, r.new / max).toFixed(3)}"></em></i><b data-ru-v="${r.new}">${fmtTok(r.new)}</b></div>`).join("")
    : `<div class="ru-wait">${R.error ? (en ? `Could not read the transcripts (${esc(srvT(R.error))})` : `读不到会话记录（${esc(R.error)}）`) : (en ? "No tokens used yet today" : "今天还没用过")}</div>`;
  const tot = o.tot ? `<div class="ru-tot" data-ru-open><b data-ru-v="${R.total}" data-ru-k="tot">${fmtTok(R.total)}</b><span>${en ? `new tokens · plus ${fmtTok(R.cache_read)} cache reads` : `新 token · 另读缓存 ${fmtTok(R.cache_read)}`}</span></div>` : "";
  requestAnimationFrame(ruSettle);
  if (o.fit) requestAnimationFrame(ruFit);
  return tot + `<div class="ru-list">${list}${more > 0 && o.more ? `<div class="ru-more" data-ru-open>${en ? `+${more} more ›` : `还有 ${more} 个 ›`}</div>` : ""}</div>` + (o.soul ? soulHTML() : o.quota ? ruQuota(o.fit) : "");
}
// Motion (11-04 rule): a bar grows from 0 the first time it is shown and glides from its previous length when the data changes;
// numbers count up. Rebuilt DOM with the same data does nothing. prefers-reduced-motion: no transition (CSS) and no count.
// t-sync-pill (batch 2): the home widget has a fixed height; rows that do not fit fold away from the bottom (the header's 「全部 N 位 ›」 opens the full list)
function ruFit() {
  document.querySelectorAll("[data-wg=usage] .ru-list").forEach(list => {
    const rows = [...list.querySelectorAll(".ru-row")]; rows.forEach(r => r.classList.remove("fit-hide"));
    for (let i = rows.length - 1; i > 0 && list.scrollHeight > list.clientHeight + 1; i--) rows[i].classList.add("fit-hide");
  });
}
function ruSettle() {
  document.querySelectorAll(".ru-bar em:not([data-s])").forEach(em => {
    em.dataset.s = "1"; const k = em.closest(".ru-list") && em.closest(".ru-list").parentElement ? em.dataset.ru + "|" + (em.closest("[data-wg],.ru-card,.sy-ru") || {}).className : em.dataset.ru;
    const to = getComputedStyle(em).getPropertyValue("--ru-w").trim(), from = UG.prev.has(k) ? UG.prev.get(k) : "0";
    UG.prev.set(k, to); if (from === to || RMQ.matches) return;
    em.style.transition = "none"; em.style.transform = `scaleX(${from})`; em.getBoundingClientRect();
    em.style.transition = ""; em.style.transform = "";
    if (from !== "0") em.style.transitionDelay = "0ms";
  });
  document.querySelectorAll("[data-ru-v]:not([data-s])").forEach(b => {
    b.dataset.s = "1"; const k = "v|" + (b.dataset.ruK || (b.closest(".ru-row") && b.closest(".ru-row").querySelector("[data-ru]") || {}).dataset?.ru) + "|" + (b.closest("[data-wg],.ru-card,.sy-ru") || {}).className;
    const to = +b.dataset.ruV, from = UG.prev.has(k) ? UG.prev.get(k) : 0; UG.prev.set(k, to);
    if (from === to || RMQ.matches || document.hidden) return;
    const t0 = performance.now(), D = 520, ease = x => 1 - Math.pow(1 - x, 3);
    const step = now => { if (!b.isConnected) return; const x = Math.min(1, (now - t0) / D); b.textContent = fmtTok(from + (to - from) * ease(x)); if (x < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}
// phone home card (under the strip's stat row); the desktop widget lives in widgets.js
function ruCard() {
  if (!MOBQ.matches) return "";
  const R = roleUsage(), en = UI.lang === "en";
  return `<section class="ru-card" data-ru-open><div class="ru-hd"><b>${en ? "Usage by role" : "各角色用量"}</b><small>${en ? "today · new tokens" : "今天 · 新 token"}</small>${R ? `<span>${en ? "total" : "共"} ${fmtTok(R.total)}</span>` : ""}</div>${ruHTML(4, { quota: true })}</section>`;
}
/* t-sync-pill (detail polish batch 2, V1): the top bar shows one pill, 「● 已同步」 = the last poll answered. Two misses in a row (~30 s) turn it red with a
   running 「断线 · N 秒没连上 · 自动重试中」. Hover / focus opens the details (connection, last data change, next event, ComfyUI, team, inbox); a click still opens
   系统状态. The manager's online state lives in the left rail only. Built once and then only text nodes change, so a poll never rebuilds the popover under the mouse.
   Phones hide #sync; there html[data-net="off"] shows #net-off under the header, only while disconnected. */
function syncPaint() {
  const sy = $("#sync"); if (!sy) return;
  const en = UI.lang === "en", R = document.documentElement;
  // polls run every 2.5 s: red only after 2+ misses in a row AND 10 s without an answer (a blip or one slow reply stays green)
  const down = (UI.fail || 0) >= 2 && (!UI.lastOk || Date.now() - UI.lastOk >= 10000);
  if (!sy.querySelector(".sy-pill")) {
    sy.classList.add("sy1"); sy.tabIndex = 0; sy.setAttribute("role", "button");
    sy.innerHTML = `<span class="sy-pill"><i class="sy-dot" aria-hidden="true"></i><b class="sy-k"></b><small class="sy-s"></small></span>`
      + `<div class="sy-pop" role="tooltip"><span data-l="c"></span><b data-v="c"></b><span data-l="d"></span><b data-v="d"></b><span data-l="n"></span><b data-v="n"></b>`
      + `<span data-l="t"></span><b data-v="t"></b><span data-l="g">ComfyUI</span><b data-v="g"></b><span data-l="i"></span><b data-v="i"></b><div class="ft"></div></div>`;
  }
  const set = (sel, v, html) => { const e = sy.querySelector(sel); if (!e) return; if (html) { if (e._h !== v) { e._h = v; e.innerHTML = v; } } else if (e.textContent !== v) e.textContent = v; };
  const secs = UI.lastOk ? Math.max(0, Math.round((Date.now() - UI.lastOk) / 1000)) : 0;
  const off = en ? `${secs ? secs + " s without an answer · " : ""}retrying` : `${secs ? secs + " 秒没连上 · " : ""}自动重试中`;
  const pill = sy.querySelector(".sy-pill"), wasDown = pill.classList.contains("down");
  pill.classList.toggle("down", down);
  const snapMin = UI.snap ? Math.max(0, Math.round((Date.now() - UI.snap) / 60000)) : -1;
  const snapTxt = snapMin < 0 ? "" : en ? `last ${snapMin ? snapMin + " min ago" : "just now"}` : `上次 ${snapMin ? snapMin + " 分钟前" : "刚刚"}`;
  pill.classList.toggle("snap", snapMin >= 0 && !down);
  set(".sy-k", down ? (en ? "Offline" : "断线") : snapMin >= 0 ? (en ? "Syncing" : "同步中") : (en ? "Synced" : "已同步"));
  set(".sy-s", down ? off + (snapTxt ? " · " + (en ? "showing " : "显示的是") + snapTxt : "") : snapTxt);
  if (wasDown && !down) { pill.classList.remove("back"); void pill.offsetWidth; pill.classList.add("back"); }
  sy.setAttribute("aria-label", down ? `${en ? "Offline" : "断线"} · ${off}` : (en ? "Synced · details" : "已同步 · 查看详情"));
  const L = en ? { c: "Connection", d: "Last change", n: "Next", t: "Team", i: "Inbox" } : { c: "连接", d: "数据最后变动", n: "下一个", t: "团队", i: "收件箱" };
  for (const k in L) set(`[data-l="${k}"]`, L[k]);
  const okAt = UI.lastOk ? new Date(UI.lastOk).toTimeString().slice(0, 8) : "—";
  set('[data-v="c"]', down ? (en ? `offline · last answer ${okAt}` : `断线 · 最后一次连上 ${okAt}`) : (en ? `live · last checked ${okAt}` : `正常 · 最后确认 ${okAt}`));
  sy.querySelector('[data-v="c"]').className = down ? "bad" : "ok";
  const M = (ST && ST.meta) || {}, c = M.comfy || {}, ag = ST ? agents().filter(a => a.enabled !== false) : [];   /* t-ui-fix-r7 R7-03: the manager counts in the total too, since isBusy counts it when it is on a card */
  set('[data-v="d"]', M.updated ? `${hm(M.updated)} · ${ago(M.updated)}` : "—");
  set('[data-v="n"]', (ST && nextEvent()) || "—", true);
  const nBusy = ag.filter(isBusy).length;   // t-ui-fix-r6 R6-08: same busy count as the home header
  set('[data-v="t"]', en ? `${ag.length} · ${nBusy} working` : `${ag.length} 位 · ${nBusy} 位在忙`);
  set('[data-v="g"]', c.online ? (en ? "online" : "在线") : (en ? "not linked" : "未连"));
  sy.querySelectorAll('[data-l="g"], [data-v="g"]').forEach(x => { x.hidden = c.configured === false; });   /* no comfy block in config.json: no ComfyUI line */
  set('[data-v="i"]', en ? `${M.inbox_unacked || 0} unhandled` : `${M.inbox_unacked || 0} 条没处理`);
  set(".sy-pop .ft", en ? "Click for System status · the manager's state is in the left rail" : "点一下打开系统状态 · 管家在线看左栏");
  // phone: a strip under the header, only while disconnected
  let nb = document.getElementById("net-off");
  if (down && !nb) { nb = document.createElement("div"); nb.id = "net-off"; nb.setAttribute("role", "status"); nb.innerHTML = `<i aria-hidden="true"></i><span></span>`; document.body.appendChild(nb); }
  if (!down && snapMin >= 0 && !nb) { nb = document.createElement("div"); nb.id = "net-off"; nb.setAttribute("role", "status"); nb.innerHTML = `<i aria-hidden="true"></i><span></span>`; document.body.appendChild(nb); }
  if (nb) nb.querySelector("span").textContent = down ? `${en ? "Offline" : "断线"} · ${off}${snapTxt ? " · " + snapTxt : ""}` : snapMin >= 0 ? `${en ? "Syncing" : "同步中"} · ${snapTxt}` : "";
  if (down) R.dataset.net = "off"; else if (snapMin >= 0) R.dataset.net = "snap"; else delete R.dataset.net;
  clearTimeout(syncPaint.t); if (down || UI.fail) syncPaint.t = setTimeout(syncPaint, 1000);   // the seconds keep counting while offline
}
/* t-ums-build (Mailbox C): the flap's cross-stitches and the red yarn ball behind the unread count. Always in the markup (serialized form,
   so the #hdrctrl innerHTML compare stays equal), drawn only under html[data-ut] (theme-ut.css); other themes hide them and look as before. */
const MAIL_X = '<path class="ums-x" d="M3.3 4.8l1.6 1.6M4.9 4.8l-1.6 1.6M5.25 6.3l1.6 1.6M6.85 6.3l-1.6 1.6M7.2 7.75l1.6 1.6M8.8 7.75l-1.6 1.6M9.15 6.3l1.6 1.6M10.75 6.3l-1.6 1.6M11.1 4.8l1.6 1.6M12.7 4.8l-1.6 1.6"></path>';
const YARN = '<svg class="ums-yarn" viewBox="0 0 20 20" preserveAspectRatio="none" aria-hidden="true"><path class="ums-bt" d="M14.6 17.6c1.8 2.6 4.6 3.2 6.8 1.4"></path><circle class="ums-b0" cx="10" cy="10" r="9.6"></circle>'
  + '<path class="ums-bw" d="M1.6 7.2Q10 2.6 18.6 8M1.4 12.6Q10 8.4 18.6 13.6M6.4 1.4Q1.8 9.6 6.8 18.6M13.4 1.4Q18.4 9.6 13.2 18.6"></path></svg>';
/* t-ums-build (Soul C): under Underthread the orb shows a knitting swatch instead of the vessel (both live in .orb; CSS picks one by
   html[data-ut], so a theme switch needs no rebuild). 6 rows x 4 stitches, knitted bottom-up to the % left; a needle lies across the row
   being knitted. Built once; a poll only toggles .on on the stitches and moves the needle, so nothing replays. Decoration only (aria-hidden),
   the % stays the text next to it. Few big stitches on purpose: 40 small ones read as texture at 1x (t-ums-mock). */
const SW = { rows: 6, cols: 4, x: 9, y: 5.5, w: 8.5, h: 7 };
function swatchSvg() {
  const r = n => Math.round(n * 100) / 100;
  let st = "";
  for (let i = 0; i < SW.rows * SW.cols; i++) {
    const row = Math.floor(i / SW.cols), col = i % SW.cols, x = SW.x + col * SW.w, y = SW.y + (SW.rows - 1 - row) * SW.h, m = x + SW.w / 2;
    st += `<g class="ums-k"><rect class="ums-kc" x="${r(x + .35)}" y="${r(y + .35)}" width="${r(SW.w - .7)}" height="${r(SW.h - .7)}" rx="1.2"/>`
      + `<path class="ums-kv" d="M${r(x + 1.4)} ${r(y + 1.3)}Q${r(x + 2.4)} ${r(y + SW.h - 2)} ${r(m)} ${r(y + SW.h - 1.1)}M${r(x + SW.w - 1.4)} ${r(y + 1.3)}Q${r(x + SW.w - 2.4)} ${r(y + SW.h - 2)} ${r(m)} ${r(y + SW.h - 1.1)}"/></g>`;
  }
  return `<svg class="ums-sw" viewBox="0 0 52 52" aria-hidden="true"><rect class="ums-cloth" x="6.5" y="2.5" width="39" height="47" rx="3.5"/>`
    + `<path class="ums-cast" d="M9 48.2H43"/>${st}<g class="ums-nd"><g class="ums-ndi"><path class="ums-needle" d="M2.5 0H48.6"/><circle class="ums-knob" cx="2.6" cy="0" r="2.4"/>`
    + `<path class="ums-knob" d="M48.2 -1.05L51.6 0 48.2 1.05z"/></g></g></svg>`;
}
function swatchSet(sw, left) {
  if (!sw) return;
  const n = SW.rows * SW.cols, done = left == null ? 0 : Math.round(Math.max(0, Math.min(100, left)) / 100 * n);
  if (sw.dataset.done === String(done)) return;
  sw.dataset.done = done;
  sw.querySelectorAll(".ums-k").forEach((g, i) => g.classList.toggle("ums-on", i < done));
  const row = done ? Math.min(SW.rows - 1, Math.floor((done - 1) / SW.cols)) : 0;   /* the row holding the last knitted stitch */
  const nd = sw.querySelector(".ums-nd");
  nd.style.transform = `translateY(${SW.y + (SW.rows - 1 - row) * SW.h}px)`;
  nd.classList.toggle("ums-off", done >= n);   /* full: the needle is put away */
}
function renderHeader() {
  const m = mgrState(), ag = agents().filter(a => a.enabled !== false && a.id !== "manager");
  const working = ag.filter(a => a.status === "working").length;
  const c = ST.meta.comfy || {};
  syncPaint();
  const U = usage();
  const sta = $("#stamina");   /* t-topbar-soul-off: index.html no longer has it; the block below only runs if an old cached page still does */
  if (sta) {
  sta.className = "stamina" + (U.stale ? " stale" : "") + (U.lost5 ? " lost" : "") + (U.approx ? " est" : "");
  sta.title = U.tip;
  // Build the soul vessel once so its waves keep flowing; later renders only move the level.
  if (!sta.querySelector(".orb .ums-sw")) {
    const wave = "M0 0 Q10 -4 20 0 T40 0 T60 0 T80 0 T100 0 V60 H0 Z";
    sta.innerHTML = `<div class="orb"><svg class="ums-vs" viewBox="0 0 52 52" aria-hidden="true"><defs><clipPath id="orbclip"><circle cx="26" cy="26" r="20"/></clipPath></defs>
      <circle class="ring2" cx="26" cy="26" r="25"/><circle class="ring" cx="26" cy="26" r="22.5"/><circle class="well" cx="26" cy="26" r="20"/>
      <g clip-path="url(#orbclip)"><g class="liq"><path class="w2" d="${wave}" transform="translate(-6 2)"/><path class="w1" d="${wave}"/></g>
      <ellipse class="shine" cx="19" cy="17" rx="6" ry="3.2" transform="rotate(-28 19 17)"/></g></svg>${swatchSvg()}</div>
      <div class="lbl"><b></b><small>STAMINA</small></div><div class="pct"><b></b><small></small></div><div class="focus"><i></i></div><span class="st-age" hidden></span>`;
  }
  const lvl = 46 - (Math.max(0, Math.min(100, U.left ?? 0)) / 100) * 36;  // keep a crest visible when full
  sta.querySelector(".liq").style.transform = `translateY(${lvl}px)`;
  sta.querySelector(".orb").classList.toggle("low", U.left != null && U.left < 20);
  swatchSet(sta.querySelector(".orb .ums-sw"), U.left);
  sta.querySelector(".lbl b").textContent = UI.lang === "en" ? "Soul" : "体力";
  {   // t-m2-a ②: the % rolls when it changes (the span is kept, only its digits move)
    const pb = sta.querySelector(".pct b");
    if (U.left == null) { pb.innerHTML = "—"; delete NV.sta; }
    else { if (!pb.querySelector(".nrv")) pb.innerHTML = `<i class="ap"></i><span class="nrv"></span><small>%</small>`;
      const ap = pb.querySelector(".ap"); ap.textContent = U.approx ? (UI.lang === "en" ? "est" : "估") : ""; ap.hidden = !U.approx; roll(pb.querySelector(".nrv"), U.left, "sta"); }
  }
  const sa = sta.querySelector(".st-age");
  sa.hidden = !U.pill;
  sa.textContent = U.pill;
  sta.querySelector(".pct > small").textContent = MOBQ.matches ? U.subPh : U.sub;
  sta.querySelector(".focus").hidden = U.week == null;
  sta.querySelector(".focus i").style.width = (U.week ?? 0) + "%";
  }
  const unread = mailUnread();   /* ri1105-P4: the server's count (a poll no longer carries every letter) */
  /* t-hdr-trim ①: the top bar keeps only 聊天 (narrow desktop). 舞台 / 主题 and 刷新用量 live in 设置, 报告 is a nav row.
     t-mailbox-top: 信箱 is back as a pill at the right end (desktop only; the rail row is hidden by CSS, the phone keeps it in 更多).
     t-mailbox-icon (user 00:26): icon only; the word lives in title (hover tip) + aria-label, the unread count is a corner badge (none at 0).
     The SVG is written in its serialized form (explicit closing tags) so the innerHTML compare below stays equal and the pill is not rebuilt every poll. */
  const mlab = UI.lang === "en" ? "Mailbox" : "信箱", mn = unread > 99 ? "99+" : String(unread);
  const hc = `<button data-h="mail" class="hc-mail" title="${mlab}" aria-label="${mlab}${unread ? " " + mn : ""}"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.8" y="3.2" width="12.4" height="9.6" rx="2"></rect><path class="ums-flap" d="M2.5 4.5 8 8.6l5.5-4.1"></path>${MAIL_X}</svg>${unread ? `<span class="n">${YARN}${mn}</span>` : ""}</button>`
    + `<button data-h="chat" class="hc-chat" aria-expanded="${document.body.classList.contains("chat-pop")}">${UI.lang === "en" ? "Chat" : "聊天"}</button>`;
  if ($("#hdrctrl").innerHTML.trim() !== hc) $("#hdrctrl").innerHTML = hc;
}

function wireHeader() {
  setInterval(() => { if (!document.hidden && (UI.page === "review" || (UI.page === "settings" && UI.setTab === "system") || $("#modal .mdl.sys"))) loadRoleUsage(); }, 15000);   // a quiet state does not re-render, so poll the counts here
  document.addEventListener("click", e => {   // the card / strip opens 系统状态; a role row (data-chat) opens the DM instead
    const o = e.target.closest && e.target.closest("[data-ru-open]"); if (!o || e.target.closest("[data-chat]")) return;
    if (document.querySelector("#wg.edit")) return;
    modalStatus();
  });
  document.addEventListener("click", e => {
    const h = e.target.closest("[data-h]"); if (!h) return;
    const k = h.dataset.h;
    if (k === "theme") { UI.theme = { dark: "light", light: "white" }[UI.theme] || "dark"; LS.set("theme", UI.theme); render(); }   // D2: legacy cycle; the header picker uses [data-theme-set] (handled in mobile.js, same rt.theme key as the phone menu)
    if (k === "lang") { UI.lang = UI.lang === "zh" ? "en" : "zh"; LS.set("lang", UI.lang); srvLocal(); window.Push && Push.lang && Push.lang(UI.lang); render(); }
    if (k === "mail") { MB.open ? closeMailbox() : openMailbox(); }
    if (k === "chat") chatPop(!document.body.classList.contains("chat-pop"));
    if (k === "report") go("reports");
    if (k === "ping") api("ping", { note: "刷新用量" }).then(() => toast(UI.lang === "en" ? "Asked the manager to refresh usage" : "已让管家刷新用量"));   // t-settings-tab: same ping, with the note; 唤醒管家 moved to 设置 · 系统
    if (k === "wake") api("ping").then(() => toast(UI.lang === "en" ? "Manager pinged" : "已叫醒管家"));   // t-ui-fix-r6 R6-07: was the English-only 「ping → inbox」
  });
  $("#brand").addEventListener("click", () => go("review"));
  { const sta = $("#stamina"); if (sta) sta.addEventListener("click", () => modalStatus()); }   /* t-topbar-soul-off: gone from index.html */
  $("#sync").addEventListener("click", e => { if (!e.target.closest("a,button")) modalStatus(); });
  /* t-ui-fix-r6 R6-06: the pill is role=button + tabindex 0, so Enter / Space do what a click does */
  $("#sync").addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target.id === "sync" && !e.repeat) { e.preventDefault(); modalStatus(); } });
}

export { TOOL_IC, toolName, toolIc, TOOL_IN, TOOL_OUT, TOOL_STALE, TOOL_T, toolFx, fxStyle, toolBadge, toolWhat, TOOL_LAST, TOOL_EXTRA, toolLine, toolHTML, renderTool, runsLeft, nextEvent, mgrState, until, clock, USAGE_STALE, ageShort, ageTxt, usageSrc, usage, UG, loadRoleUsage, fmtTok, roleUsage, ruName, ruTip, ruQuota, soulSw, soulHTML, ruHTML, ruFit, ruSettle, ruCard, syncPaint, MAIL_X, YARN, SW, swatchSvg, swatchSet, renderHeader, wireHeader };
