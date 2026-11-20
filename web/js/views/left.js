// Dashboard view: the left rail (#left): nav counts, today's schedules, the calendar fold, nav icons and the studio tabs.
// t-oss-struct S10 (A6): moved out of app.js unchanged; a wire*() function, if any, holds the top-level event wiring and app.js calls it where
// the code used to run, so listeners register in the same order as before.


// ---------- left ----------
import { $, LS } from "../core/util.js";
import { CATS, EN_SUB, dayKey, pad, t } from "../core/i18n.js";
import { ST, UI, items, mailUnread, onYou, qBadge } from "../core/store.js";
import { aduty, agent, agents, aname, av } from "../core/av.js";
import { api } from "../core/ui.js";
import { go } from "../core/router.js";
import { NARROWQ, chatPop, setChat, setSrc } from "./chat.js";
import { openItem } from "./drawer.js";
import { YARN, mgrState, runsLeft, toolWhat } from "./header.js";
import { newReplies, unreadOf, unreadTag } from "./mail.js";
import { MOBQ } from "./pages/common.js";
import { isContent } from "./pages/pipe.js";
import { askJump } from "./pages/review.js";
import { MGR_ON, MGR_WATCH, mgrOnline } from "../app.js";
function counts() {
  const c = { review: 0 }; for (const k of CATS) c[k] = 0;
  c.pipe = items().filter(i => i.stage !== "done" && isContent(i)).length;   // t-imp-p3
  c.crew = agents().filter(a => a.id !== "manager" && a.status === "working").length;   /* t-rb-build: 团队 row = roles working now */
  c.mail = mailUnread();   /* t-hdr-trim ①: 信箱 row in the rail; ri1105-P4: server count */
  for (const it of items()) { if (onYou(it)) c.review++; if (it.stage !== "done") c[it.category] = (c[it.category] || 0) + 1; }
  c.review += newReplies().length;   // t-review-unread: cards with unread replies (never one already counted above)
  return c;
}
/* t-ri1109-a (P1+P4): one short routine name for the rail and the home timeline. rtShort drops 「（r-…）」, the 「…每日 N 个」 lead and "app";
   rtFull keeps the whole label minus the item id, for title tooltips. */
function rtShort(r) { return String(r.label || r.id).replace(/[（(][^）)]*[）)]/g, "").replace(/^.*?每日\s*(\d+\s*个\s*)?(一条|打磨)?/, "").replace(/^app\s*/i, "").trim() || r.id; }
function rtFull(r) { return String(r.label || r.id).replace(/[（(][^）)]*[）)]/g, "").trim() || r.id; }
/* t-ri1110-a P2: schedules made on the 定时 page (state.schedules without a `routine`; imported routines already come as meta.routines) that run
   today: it ran today (last) or its next run is today. The 18:00 管家日报 entry is skipped when meta.report_time already gives the 日报 row.
   -> [{ time "HH:MM", label, ran, who, item }] in the meta.routines shape, so the rail and the home timeline treat both alike. */
function schToday() {
  const today = dayKey(new Date()), dk = t => t ? dayKey(new Date(t)) : "", rep = ST.meta && ST.meta.report_time;
  return (ST.schedules || []).filter(s => s && !s.deleted && !s.routine && s.rule).filter(s => {
    const at = String(s.rule.at || ""), tm = at.includes("T") ? at.split("T")[1] : at;
    if (rep && tm === rep && /日报/.test(s.title || "") && (s.task || {}).agent === "manager") return false;
    return dk(s.last) === today || (s.enabled && !s.paused && dk(s.next) === today);
  }).map(s => { const at = String(s.rule.at || ""), t = s.task || {};
    return { id: s.id, time: (at.includes("T") ? at.split("T")[1] : at).slice(0, 5), label: s.title || s.id, ran: dk(s.last) === today, who: t.agent || null, item: t.item || null }; });
}
/* t-ri1113-a P4: the routines already dispatched today fold into one row at the first one's place (「06:00 ●●● 已跑 6 个 ✓ ›」); a click opens
   them (kept in this browser: rt.calPast). Rows still to come, 到点未派 and the user's own events stay one per line. Two or more to fold. */
const CALPF = { at: 0 };
function calFold(rows) {
  const done = rows.filter(r => r.done); if (done.length < 2) return rows.map(r => r.h).join("");
  const open = !!LS.get("calPast", false), zh = UI.lang !== "en", anim = Date.now() - CALPF.at < 600;
  const avs = [...new Map(done.filter(r => r.a).map(r => [r.a.id, r.a])).values()].slice(0, 3);
  const head = `<div class="cal-i cal-rt past cal-pf${open ? " open" : ""}" role="button" tabindex="0" data-cal-pf aria-expanded="${open}" title="${esc(done.map(r => r.tip).join("\n"))}"><span class="tm">${esc(done[0].tm || "—")}</span><span class="cal-avs">${avs.map(a => av(a, "cal-av")).join("")}</span><span class="cal-nm">${zh ? `已跑 ${done.length} 个` : `${done.length} done`}</span><span class="cal-st">✓ <i class="cal-pf-cv" aria-hidden="true">›</i></span></div>`;
  let out = "", put = false;
  for (const r of rows) {
    if (!r.done) { out += r.h; continue; }
    if (!put) { put = true; out += head; }
    if (open) out += anim ? r.h.replace('class="cal-i cal-rt past', 'class="cal-i cal-rt past cal-pf-in') : r.h;
  }
  return out;
}
function renderLeft() {
  const c = counts();
  /* t-ri1113-a P5: the 定时 row counts today's runs not sent yet (the page itself lists schedules, the rail's 今日日程 the runs); other rows still count cards */
  const rl = runsLeft(), rlNext = rl.find(r => r.d > new Date()) || rl[0]; c.ongoing = rl.length;
  const ogTip = !rl.length ? (UI.lang === "en" ? "All of today's runs are done" : "今天的定时都跑完了") : UI.lang === "en" ? `${rl.length} run${rl.length > 1 ? "s" : ""} left today · next ${rlNext.time} ${rlNext.title}` : `今天还有 ${rl.length} 个没跑 · 下一个 ${rlNext.time} ${rlNext.title}`;
  const navs = ["review", ...CATS, "sep", "market",   /* t-drop-team-tab (11-12): 团队 row removed; the 团队交接 widget stays (web/team.js) */ "studio", "reports", "mail", "settings"];   /* t-nav-shoot (11-05): 制作线 / 委托板 / 频道 / 素材 are one 制作 row; the pages keep their own ids */   /* t-hdr-trim ①: 信箱 moved here from the top bar (phone: same row in 更多) */   // t-settings-tab: 日志 / 文档 / 角色 moved into 设置
  const selK = STU.includes(UI.page) ? "studio" : UI.page, sew = UI.navSew !== selK; UI.navSew = selK;   /* t-thread-motif ②: the thread sews in only when the selection changes, not on every poll rebuild */
  $("#nav").innerHTML = navs.map(k => k === "sep" ? `<div class="nav-sep"></div>` :
    `<button class="nav-i ${selK === k ? "on" : ""} ${k === "urgent" && c.urgent ? "urgent" : ""}" data-go="${k}"${k === "ongoing" ? ` title="${esc(ogTip)}"` : ""}><span>${NAV_IC[k] ? `<i class="nv-ic" aria-hidden="true"><svg viewBox="0 0 24 24">${NAV_IC[k]}</svg></i>` : ""}<span class="nv-t">${k === "studio" ? stuName() : t(k)}${selK === k ? `<svg class="nv-ul${sew ? " sew" : ""}" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="M1 3.6C20 2.2 40 4.4 60 3.2S88 2.6 96 3.4"/></svg><i class="nv-knot${sew ? " sew" : ""}" aria-hidden="true"></i>` : ""}</span></span>${k === "mail" ? (c.mail ? `<span class="n mb">${YARN}${c.mail > 99 ? "99+" : c.mail}</span>` : `<span class="n z"></span>`) : `<span class="n${c[k] === 0 ? " z" : ""}">${c[k] ?? ""}</span>`}</button>`).join("");

  // calendar
  const today = dayKey(new Date()), tmr = dayKey(new Date(Date.now() + 864e5));
  const evs = (ST.calendar || []).filter(e => e.date === today || e.date === tmr);
  // ri1103-P1: the team's fixed daily routines (meta.routines) join the user's own events, sorted by time; paused ones fold into one line.
  // ri1103-P2: meta.report_time comes from config.json report_time (server.py public_state); an older server sends none -> the row shows no time.
  const rts = (ST.meta && ST.meta.routines) || [], nowM = new Date().getHours() * 60 + new Date().getMinutes();
  const rtName = rtShort;   /* t-ri1109-a P4: shared with widgets.js (App.rtShort) */
  const rtLeft = hm => { const [h, m] = hm.split(":").map(Number), d = h * 60 + m - nowM; return d > 0 ? `${Math.floor(d / 60)}:${pad(d % 60)}${UI.lang === "en" ? "" : " 后"}` : null; };
  const rtRow = (tm, who, name, done, itemId, full) => {   /* t-ri1109-a P4: a dispatched row says only ✓ (the grey row already reads as done); the title carries time, full name and state */
    const left = !done && tm && rtLeft(tm), a = who && agent(who);
    const st = done ? "✓" : left || (tm ? (UI.lang === "en" ? "due" : "到点") : (UI.lang === "en" ? "tonight" : "今晚"));
    const tip = `${tm ? tm + " " : ""}${full || name} · ${done || st}`;
    return { k: "0" + (tm || "99"), done: !!done, a, tm, tip, h: `<div class="cal-i cal-rt ${done ? "past" : ""}"${itemId ? ` data-item="${esc(itemId)}"` : ""} title="${esc(tip)}"><span class="tm">${esc(tm || "—")}</span>${a ? av(a, "cal-av") : ""}<span class="cal-nm">${esc(name)}</span><span class="cal-st${left ? " soon" : ""}">${esc(st)}</span></div>` };
  };
  const itemOwner = id => { const it = (ST.items || []).find(x => x.id === id); return it && it.owner; };
  const rtLive = rts.filter(r => !r.paused && !r.disabled && r.time), rtOff = rts.filter(r => r.paused || r.disabled);
  const sent = UI.lang === "en" ? "sent" : "已派";
  const rtRows = rtLive.map(r => rtRow(r.time, itemOwner(r.item), rtName(r), r.last === today ? sent : "", r.item, rtFull(r)));
  for (const r of schToday()) rtRows.push(rtRow(r.time, (r.item && itemOwner(r.item)) || r.who, rtName(r), r.ran ? sent : "", r.item, rtFull(r)));   /* t-ri1110-a P2 */
  if (ST.meta) rtRows.push(rtRow(ST.meta.report_time || "", "manager", UI.lang === "en" ? "Daily report" : "日报", ST.meta.last_report_date === today ? (UI.lang === "en" ? "sent" : "已发") : "", ""));
  const nowHM = `${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`;
  $("#cal").classList.toggle("cal-empty", !evs.length && !rtRows.length && !UI.calForm);   // t-cal-fold: nothing today or tomorrow -> one faint row, "+" still there
  if (!evs.length && !rtRows.length && !UI.calForm) $("#cal").innerHTML = `<div class="side-h"><span>${t("today")} · ${UI.lang === "en" ? "none" : "无"}</span><button data-cal-add>+</button></div>`;
  else $("#cal").innerHTML = `<div class="side-h"><span>${t("today")} <span class="dim" style="font-weight:400">${evs.filter(e => e.date === today).length + rtRows.length} ${t("meetings")}</span></span><button data-cal-add>${UI.calForm ? "−" : "+"}</button></div>
    ${UI.calForm ? `<form class="cal-form" id="calf"><input name="title" placeholder="${UI.lang === "en" ? "What…" : "做什么…"}" required><input type="date" name="date" value="${today}"><input type="time" name="time"><button class="btn-s">${t("add")}</button></form>` : ""}
    ${calFold([...evs.map(e => ({ k: (e.date === tmr ? "1" : "0") + (e.time || "99"), h: `<div class="cal-i ${e.date === today && e.time && e.time < nowHM ? "past" : ""}"><span class="tm">${e.date === tmr ? "+1 " : ""}${esc(e.time || "—")}</span><span>${esc(e.title)}</span><button class="x" data-cal-del="${e.id}">✕</button></div>` })), ...rtRows,
      /* t-ri1114-a P5: the 「现在」 line sorts in at the current minute (between what has run and what is still to come), not under the list */
      { k: "0" + nowHM + "~", h: `<div class="cal-now ri14-now"><b>${UI.lang === "en" ? "Now" : "现在"}</b>${nowHM}</div>` }].sort((x, y) => x.k < y.k ? -1 : x.k > y.k ? 1 : 0))}
    ${rtOff.length ? `<div class="cal-off" title="${esc(rtOff.map(rtName).join("、"))}">${UI.lang === "en" ? "Paused" : "暂停"} ${rtOff.length}${UI.lang === "en" ? "" : " 项"} · ${esc(rtOff.map(rtName).join("、"))}</div>` : ""}`;
  const f = $("#calf");
  if (f) f.onsubmit = e => { e.preventDefault(); const fd = new FormData(f); api("calendar_add", Object.fromEntries(fd)); };

  $("#cal").classList.toggle("noev", !evs.length);   // ri1103-P1: routine rows carry their own countdown, so the clock rail stays for real events only   // t-web-audit 02: no events -> no empty time rail
  // team
  // ui1: rows animate in once (not on every poll re-render); the open chat's row is marked; unread mail shows a dot
  const teamFirst = !UI.teamIn; UI.teamIn = true; $("#team").classList.toggle("team-enter", teamFirst);
  /* t-ri1104-p2: TEAM rows use the same unread count as the chat (was: unread mail from that agent) */
  setSrc($("#team"), `<div class="side-h"><span class="sc">TEAM</span></div>` + agents().map((a, i) => {   // t-send-flicker: unchanged rail keeps its avatar rings running
    const ms = a.id === "manager" && mgrState();
    const st = ms ? (ms.on ? "working" : ms.sleep ? "sleeping" : "offline") : a.status || "idle";
    const sub = mgrOnline(a) ? (MOBQ.matches ? MGR_ON() : MGR_WATCH()) : a.status === "working" && a.activity ? `▶ ${esc(a.tool ? toolWhat(a) || a.activity : a.activity)}` : esc(aduty(a));   // t-now-closed
    return `<div class="team-i ${a.status === "working" && a.activity && !mgrOnline(a) ? "busy" : ""} ${a.enabled === false ? "disabled" : ""} ${UI.chat === a.id ? "on" : ""} ${unreadOf(a.id) && UI.chat !== a.id ? "unread" : ""}" style="--i:${Math.min(i, 12)}" data-chat="${a.id}">${av(a)}<div><div class="nm"><span class="nmt">${esc(aname(a))}</span><span class="st ${st}"${ms && ms.sleep ? ` title="${esc(ms.txt)}"` : ""}>${ms ? (ms.on ? t("online") : ms.sleep ? (ms.back ? `☾ ${ms.back}` : ms.txt) : t("offline")) : t(st)}</span>${unreadOf(a.id) && UI.chat !== a.id ? `<i class="tn">${unreadTag(unreadOf(a.id))}</i>` : ""}</div><div class="du">${qBadge(a.id)}${sub}</div></div></div>`;   /* t-hdr-trim ⑩: 排队 chip leads the second line, so name + status + count fit one line in zh and en */
  }).join(""));
}
const SET_TABS = ["general", "connections", "roles", "docs", "logs", "system"];   /* t-feed-inbox: 连接 (views/pages/connections.js) */
/* t-nav-shoot: the 制作 / Studio group. Each sub page keeps its id (#page=pipe etc. still work, wide layout unchanged); "studio" opens the last one used. */
const STU = ["pipe", "board", "channels", "assets"];
const STU_L = { pipe: ["制作线", "Pipeline"], board: ["委托板", "Board"], channels: ["频道", "Channels"], assets: ["素材", "Assets"] };
/* t-oss-gen-s5: content mode. 制作线 / 频道 and the drafts' platform previews belong to a content team: shown when config.json has
   platforms (meta.platforms_set) or a role owns a production-line column (pipe); 设置 → 制作线和频道 (meta.studio) forces on / off.
   Off: the pages still render from a direct #page= link, they just leave the tabs, the palette and the default. */
const contentMode = () => { const m = (ST && ST.meta) || {}; if (m.studio === "on" || m.studio === "off") return m.studio === "on"; return m.platforms_set !== false || agents().some(a => a.pipe && a.enabled !== false); };   /* platforms_set missing = an older server: keep the tabs */
const stuList = () => contentMode() ? STU : STU.filter(x => x !== "pipe" && x !== "channels");
/* t-onb-polish: without content mode the row only holds 委托板 + 素材, so 「制作 / Studio」 says what is there: 委托与素材 / Board & files.
   Content installs (platforms set, a pipe role, or 设置 → 制作线和频道 on) keep 制作 / Studio. */
const stuName = (cap) => contentMode() ? (cap ? EN_SUB.studio : t("studio")) : cap ? "BOARD & FILES" : UI.lang === "en" ? "Board & files" : "委托与素材";
/* t-thread-motif: left rail icons (work/t-thread-motif/icons, 24 grid, stroke = currentColor); shown only under 特典 and only on desktop (CSS) */
const NAV_IC = {
  review: '<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-3.2a2 2 0 0 1 4 0V20"/>',
  main: '<path d="M7 6.5V13a5 5 0 0 0 10 0V6"/><circle cx="17" cy="4.2" r="1.7" fill="currentColor" stroke="none"/><path d="M3.5 13h17"/>',
  side: '<path d="M7 20.5V5.5"/><circle cx="7" cy="3.6" r="1.6" fill="currentColor" stroke="none"/><path d="M7 16c0-4.4 2.8-7 7-7h2.5"/><circle cx="18.6" cy="9" r="1.6" fill="currentColor" stroke="none"/>',
  daily: '<rect x="4" y="5.5" width="16" height="14.5" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/><path d="M10.2 12.6l3.6 3.6M13.8 12.6l-3.6 3.6"/>',
  urgent: '<circle cx="15" cy="9" r="3.6" fill="currentColor"/><path d="M12.4 11.6 4.5 19.5"/>',
  ongoing: '<circle cx="12" cy="12.5" r="8"/><path d="M12 8.2v4.5l3 1.8"/><path d="M5 4.2 3 6.2M19 4.2l2 2"/>',   /* t-schedule-ui: 定时 = clock */
  crew: '<circle cx="8.5" cy="8.5" r="2.8"/><circle cx="16.5" cy="9.5" r="2.3"/><path d="M3.5 19c.6-3.2 2.6-5 5-5s4.4 1.8 5 5"/><path d="M14.2 14.4c.7-.5 1.5-.8 2.3-.8 2 0 3.5 1.5 4 4.4"/>',   /* t-rb-build: 团队 = two people */
  market: '<rect x="4" y="7" width="16" height="12.5" rx="2"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7"/><path d="M4 12.5h16"/><path d="M11 12.5v1.6h2v-1.6"/>',   /* t-hm-build: 招聘市场 = briefcase */
  studio: '<path d="M3 9.8A1.8 1.8 0 0 1 4.8 8h2.4l1.6-2.5h6.4L16.8 8h2.4A1.8 1.8 0 0 1 21 9.8v8.4a1.8 1.8 0 0 1-1.8 1.8H4.8A1.8 1.8 0 0 1 3 18.2z"/><circle cx="12" cy="13.6" r="3.4"/><path d="M12 13.6v.01"/>',
  reports: '<path d="M6 3.5h8l4.5 4.5v12.5H6z"/><path d="M14 3.5V8h4.5"/><path d="M8.6 17l2.4-3 2 1.6 2-2.6"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3.8 7.2l8.2 6.3 8.2-6.3"/>',
  settings: '<path d="M3.5 8h3.2M11.3 8h9.2M3.5 16h9.2M17.3 16h3.2"/><circle cx="9" cy="8" r="2.3"/><circle cx="15" cy="16" r="2.3"/>',
};
function stuTabs(k) {   /* same segmented control as 设置 */
  const en = UI.lang === "en";
  return `<div class="st-tabs stu-tabs"><div class="seg" data-seg="stutab" role="tablist">${stuList().map(x => `<button type="button" class="seg-i ${x === k ? "on" : ""}" role="tab" aria-selected="${x === k}" data-stutab="${x}">${STU_L[x][en ? 1 : 0]}</button>`).join("")}</div></div>`;
}

function wireLeft() {
  document.addEventListener("click", e => { const f = e.target.closest && e.target.closest("[data-cal-pf]"); if (!f) return; LS.set("calPast", !LS.get("calPast", false)); CALPF.at = Date.now(); renderLeft(); });
  document.addEventListener("keydown", e => { const f = (e.key === "Enter" || e.key === " ") && e.target.closest && e.target.closest("[data-cal-pf]"); if (!f) return; e.preventDefault(); f.click(); });
  document.addEventListener("click", e => {
    const g = e.target.closest("[data-go]"); if (g) { go(g.dataset.go); return; }
    const ch = e.target.closest("[data-chat]"); if (ch) { setChat(ch.dataset.chat); if (NARROWQ.matches && !MOBQ.matches) chatPop(true); return; }
    if (e.target.closest("[data-cal-add]")) { UI.calForm = !UI.calForm; renderLeft(); return; }
    const cd = e.target.closest("[data-cal-del]"); if (cd) { api("calendar_del", { id: cd.dataset.calDel }); return; }
    const aj = e.target.closest("[data-askjump]"); if (aj) { askJump(aj.dataset.askjump); return; }   /* t-ri1114-a P4 */
    const oi = e.target.closest("[data-item]"); if (oi && !e.target.closest("button")) { openItem(oi.dataset.item); return; }
  });
}

export { counts, rtShort, rtFull, schToday, CALPF, calFold, renderLeft, SET_TABS, STU, STU_L, NAV_IC, stuTabs, wireLeft, contentMode, stuList, stuName };
