// Underthread dashboard. Polls /api/state, renders, posts your clicks to /api/action.
// t-oss-struct S10: this file is the spine. The code lives in modules (core/: util, i18n, store, av, ui, router; views/: header, ticker, left,
// drawer, chat, mail, attach, status, cardref, pages/*); this file imports them, calls each module's wire*() function in the order the
// listeners used to register, keeps render() / the presence helpers / the window.App facade for the other page scripts, and boots.
// A new top-level name another file needs: add it to that file's export { ... } line and to the importer's import line.
import { $, DRAFT, LS } from "./core/util.js";
import { PLAT, ago, agoH, srvT, stageLabel, stateTag, t, titleEn, tplEn, tplSeed, when, whenH } from "./core/i18n.js";
import { ARCH, LP, REV, ST, UI, archAll, archIx, busy, byAct, grpOf, histAll, items, lpAbort, lpLoop, mailAll, mailUnread, onYou, onYouCard, poll, qBadge, queueOf, snapBoot, snoozed, waitMs } from "./core/store.js";
import { agent, aname, atitle, av, avatarUrl, avLoad, hasArt, ringOnce, tintOf, wireAv, wsheet } from "./core/av.js";
import { wireYk, yk, ykInto, ykSync } from "./core/yarnkit.js";
import { api, closeModal, modalReject, openModal, toast, utEmpty, wireUi } from "./core/ui.js";
import { go, pageAlias, route } from "./core/router.js";
import { attachPick, vmSync, wireAttach } from "./views/attach.js";
import { wireCardRef } from "./views/cardref.js";
import { chatList, renderChat, setChat, wireChat } from "./views/chat.js";
import { DW, backItem, closeItem, dwSig, openItem, renderDrawer, seekChat, seekItem, snzLine, snzMenu, snzText, wireDrawer } from "./views/drawer.js";
import { TOOL_EXTRA, fmtTok, renderHeader, renderTool, roleUsage, ruHTML, soulHTML, toolBadge, toolLine, toolWhat, usage, wireHeader } from "./views/header.js";
import { SET_TABS, contentMode, counts, renderLeft, rtFull, rtShort, schToday, wireLeft } from "./views/left.js";
import { chatMailRead, mailPv, newReplies, nrDot, renderMailbox, seenOf, tablePv, unreadOf, wireMail, wireMail2 } from "./views/mail.js";
import { inkEb } from "./views/pages/common.js";
import { phaseFree, renderPage, wirePages, wirePages2 } from "./views/pages/index.js";
import { wireLibrary } from "./views/pages/library.js";
import { askGroups, askLeft, askWait, askWaitL, awaitsUser, decisions, grpHTML, okDone, okLabel, openAsks, rvApprove, rvCanApprove, wireReview } from "./views/pages/review.js";
import { wireSchedule } from "./views/pages/schedule.js";
import { TEXTURES, setTab, stageSub, themeMode, wireSettings } from "./views/pages/settings.js";
import { ghLabel, ghOpen, loadHealth, modalStatus, statusRows, statusSummary, verCheck, wireStatus } from "./views/status.js";
import { quietNight, renderTicker, wireTicker } from "./views/ticker.js";
wireAv();
wireYk();   /* t-yarn-anim: a kitten beat that ends between re-renders hands over in place */
// ===== t-m2-a ②: number roll. Runs only when the value really changes: the last value shown is kept in memory per key (NV), not read back from the DOM,
// so a poll or a rebuilt node with the same value does nothing. Each changed digit gets a one-glyph window: the old one slides out, the new one slides in
// (up when the number grows, down when it shrinks), transform + opacity only, WAAPI ~420 ms; the spans are replaced by plain text when it ends.
// First paint, non-integers, a hidden page and prefers-reduced-motion just swap the text.
const NV = {}, RMQ = matchMedia("(prefers-reduced-motion: reduce)");
function roll(el, to, key) {
  if (!el) return; to = String(to);
  const from = key ? NV[key] : el.dataset.nv; if (key) NV[key] = to; el.dataset.nv = to;
  const isN = x => /^\d{1,6}$/.test(x);
  if (from === to) { if (!el._nr && el.textContent !== to) el.textContent = to; return; }
  if (el._nr) { const a = el._nr; el._nr = null; a.forEach(x => x.cancel()); }
  if (from == null || !isN(from) || !isN(to) || RMQ.matches || document.hidden || !el.isConnected) { el.textContent = to; return; }
  const n = Math.max(from.length, to.length), A = from.padStart(n, " "), B = to.padStart(n, " "), up = +to > +from;
  el.innerHTML = [...B].map((c, i) => c === A[i] ? c : `<span class="nr"><span class="nr-o">${A[i].trim()}</span><span class="nr-n">${c.trim()}</span></span>`).join("");
  const o = { duration: 420, easing: "cubic-bezier(.2,.8,.2,1)", fill: "both" }, d = up ? 100 : -100, run = [];
  el.querySelectorAll(".nr").forEach(c => {
    run.push(c.firstChild.animate([{ transform: "translateY(0)", opacity: 1 }, { transform: `translateY(${-d}%)`, opacity: 0 }], o));
    run.push(c.lastChild.animate([{ transform: `translateY(${d}%)`, opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], o));
  });
  el._nr = run;
  Promise.all(run.map(x => x.finished)).then(() => { if (el._nr === run) { el._nr = null; el.textContent = to; } }, () => {});
}
// ===== t-working-item-highlight: an item is "being worked on" only when state.agents[x].status === "working" AND agents[x].item === its id.
// Never guessed from owner / stage: no agents[].item, no highlight. Same --wp wall-clock phase as App.av, so poll re-renders never restart the motion.
// t-now-closed: dashboard-side safety net. A card that is already closed (stage done) never shows as being worked on, whoever still holds it;
// the manager with no live card is "online · watching the inbox": no timer, no progress bar, not counted as working.
const liveItem = a => { const it = a && a.item && (ST.items || []).find(i => i.id === a.item); return it && it.stage !== "done" ? it : null; };
const mgrOnline = a => !!a && a.id === "manager" && a.status === "working" && !liveItem(a);
/* t-ui-fix-r6 R6-08: the one 「在忙」 rule for every count (home header, 此刻在忙, 团队交接, 团队 page, sync pop):
   working, and not the manager merely online (the manager on a live card counts) */
const isBusy = a => !!a && a.enabled !== false && a.status === "working" && !mgrOnline(a);
// t-typing-fix: the typing dots (desktop renderChat + mobile.js syncTyping). Only while the agent really works on a card (not the manager's
// online-only heartbeat) and you spoke last, and never more than 10 min after your last message (the minute sweep below drops a stale bubble).
const TYPING_MAX = 10 * 60e3, lastT = m => Date.parse(m && m.t) || 0;
const typingOn = (a, last) => !!a && a.status === "working" && !mgrOnline(a) && !!last && last.who === "me" && (!lastT(last) || Date.now() - lastT(last) < TYPING_MAX);
const typingUntil = last => lastT(last) ? lastT(last) + TYPING_MAX : "";
const MGR_ON = () => UI.lang === "en" ? "Online · watching the inbox" : "在线 · 看着信箱";
const MGR_WATCH = () => UI.lang === "en" ? "Watching the inbox" : "看着信箱";   /* t-hdr-trim ②1: the desktop rail already says 在线 after the name */
const workersOf = id => id ? Object.values(ST.agents || {}).filter(a => a.status === "working" && a.item === id && liveItem(a)).sort((a, b) => (a.order ?? 99) - (b.order ?? 99)) : [];
const wkP = () => `--wp:${(-(Date.now() % 16000) / 1000).toFixed(3)}s`;
function wkDur(iso) {
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso)) / 6e4)), en = UI.lang === "en";
  if (m < 60) return en ? `${Math.max(1, m)}m` : `${Math.max(1, m)} 分钟`;
  const h = Math.floor(m / 60), r = String(m % 60).padStart(2, "0");
  return en ? `${h}h ${r}m` : `${h} 时 ${r} 分`;
}
function wkTag(ws, cls = "") {   // [ringed avatars] 「名字 处理中 · 12 分钟」 (elapsed only when `since` exists)
  if (!ws.length) return "";
  const since = ws.map(a => a.since).filter(Boolean).sort()[0], nm = ws.map(a => aname(a)).join(UI.lang === "en" ? ", " : "、");
  return `<span class="wk-tag ${cls}" style="${wkP()}"><span class="wk-avs">${ringOnce(() => ws.map(a => av(a, "sm")).join(""))}</span><span class="wk-tx"><b>${esc(nm)}</b> ${UI.lang === "en" ? "on it" : "处理中"}${since ? ` · <time class="wk-el" data-since="${esc(since)}">${wkDur(since)}</time>` : ""}</span></span>`;
}
/* t-oss-polish-1121 ②: the detail page's 处理中 band (desk + phone; replaces the small dw-wk tag and the phone dw-wkrow). Stitched edge, a yarn ball rolls
   along the bottom thread (transform only). --wb = minus the wall-clock phase of the 9 s roll, so a re-render lands where the old node was. */
function wkBand(ws) {
  if (!ws.length) return "";
  const en = UI.lang === "en", since = ws.map(a => a.since).filter(Boolean).sort()[0], nm = ws.map(a => aname(a)).join(en ? ", " : "、");
  const act = (ws.find(a => a.activity) || {}).activity;
  const sub = [since ? `${en ? "for " : "已 "}<time class="wk-el" data-since="${esc(since)}">${wkDur(since)}</time>` : "", act ? `${en ? "Latest: " : "最近："}${esc(act)}` : ""].filter(Boolean).join(" · ");
  return `<div class="wkb" role="status" style="${wkP()};--wb:${(-(Date.now() % 9000) / 1000).toFixed(3)}s"><span class="wkb-avs">${ringOnce(() => ws.map(a => av(a)).join(""))}</span>`
    + `<span class="wkb-tx"><b>${esc(nm)} ${en ? "is on it" : "正在做"}</b>${sub ? `<span class="wkb-sub">${sub}</span>` : ""}</span><span class="wkb-st">${en ? "Working" : "处理中"}</span>`
    + `<i class="wkb-thr" aria-hidden="true"></i><i class="wkb-ball" aria-hidden="true"></i></div>`;
}
const wkFx = ws => ws.length ? `<i class="wk-fx" aria-hidden="true"><i class="wk-bg"></i></i>` : "";   /* t-edge-glow-off (11-04): the 2px left rail with the flowing highlight (.wk-bar) is gone; the breathing tint and the 处理中 tag stay */
const wkAttr = ws => ws.length ? ` style="${wkP()}"` : "";
function dcDur(iso) {   // 此刻 card format: 「12 分钟」/「1 小时 5 分」 (t-now-elapsed: was computed once per render, so it froze between state revs)
  const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 6e4)), zh = UI.lang !== "en";
  return m < 60 ? m + (zh ? " 分钟" : " min") : Math.floor(m / 60) + (zh ? " 小时 " : " h ") + (m % 60) + (zh ? " 分" : " min");
}
setInterval(() => { document.querySelectorAll(".wk-el[data-since]").forEach(el => { const v = el.dataset.fmt === "dc" ? dcDur(el.dataset.since) : wkDur(el.dataset.since); if (el.textContent !== v) el.textContent = v; });
  document.querySelectorAll("time.rel[data-t]").forEach(el => { const v = el.dataset.rel === "ago" ? ago(el.dataset.t) : when(el.dataset.t); if (el.textContent !== v) el.textContent = v; });
}, 20000);   // elapsed ticks between polls (render only runs on a new rev)
wireAttach();

function render() {
  document.documentElement.dataset.theme = UI.theme;
  document.documentElement.lang = UI.lang === "en" ? "en" : "zh";
  renderChrome(); renderLeft(); renderPage(); if (UI.item && dwSig() !== DW.sig) renderDrawer(); renderChat(); renderMailbox();   // t-perf E: an unchanged open card is not rebuilt
  appBadge();
  hooks.forEach(f => f("all"));
  vmSync();
}
// t-app-badge: the installed app's icon badge (iPhone home screen, Mac Dock) = 「等你拍板」 = the nav's 审核 count. server.py pending_count() mirrors it for pushes.
// Only touched when the number changes; unsupported browsers and a missing permission are ignored.
function appBadge() {
  if (!("setAppBadge" in navigator)) return;
  const n = counts().review;
  if (n === appBadge.last) return;
  appBadge.last = n;
  (n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => { appBadge.last = undefined; });
}
const hooks = [];
function renderChrome() { renderHeader(); renderTool(); renderTicker(); }
wireHeader();
wireTicker();
wireLeft();
wireReview();
wireMail();
wirePages();
wireSettings();
wireMail2();
wireSchedule();
wireLibrary();
wireCardRef();
wirePages2();
wireDrawer();
wireChat();
wireUi();
wireStatus();

// ---------- API for the mobile layer (mobile.js) ----------
window.App = {
  okLabel, okDone, askLeft, openAsks: it => openAsks(it),   // t-btn-names
  askGroups: l => askGroups(l), grpHTML: (g, c) => grpHTML(g, c),   /* t-ri1113-a P3 */
  rtShort, rtFull, schToday, contentMode,   /* t-oss-gen-s5: contentMode (palette.js) */   /* t-ri1109-a: routine names, shared with widgets.js; t-ri1110-a P2: schToday */
  utEmpty: (text, cls, h) => utEmpty(text, cls, h),   /* t-thread-motif ④ (widgets.js, palette.js, mobile.js) */
  rvApprove: id => rvApprove(id, null), rvCanApprove: it => rvCanApprove(it), awaitsUser: it => awaitsUser(it), askWait: it => askWait(it), askWaitL: () => askWaitL(), busy: it => busy(it), onYou: it => onYou(it), onYouCard: it => onYouCard(it), grpOf: it => grpOf(it), waitMs: it => waitMs(it), newReplies: () => newReplies(), nrDot: id => nrDot(id), decisions: () => decisions(),   // t-imp-p5 (palette)
  /* t-chrome-badge (home.js .hd-tool) */
  toolLine: w => toolLine(w), toolBadge: a => toolBadge(a), toolWhat: a => toolWhat(a), addToolExtra: fn => { if (!TOOL_EXTRA.includes(fn)) TOOL_EXTRA.push(fn); }, ext: window.UTExt,   /* S8: App.ext = web/ext.js */
  wsheet: (a, sz) => wsheet(a, sz),   /* t-chibi-anim (home.js .hd-mini / .dp-uti) */
  yk: (a, h, b) => yk(a, h, b), ykInto: (el, a, h, b) => ykInto(el, a, h, b), ykSync: () => ykSync(),   /* t-yarn-anim: the home 「此刻在忙」 card (widgets.js busy patch, home.js A2 rows) */
  hasArt: (a, k) => hasArt(a, k), tintOf: a => tintOf(a),   /* t-hr-registry (home.js, widgets.js) */
  UI, get ST() { return ST; }, roll, modalStatus: () => modalStatus(), ghOpen: () => ghOpen(), ghLabel: () => ghLabel(), statusSummary: () => statusSummary(statusRows()), loadHealth: a => loadHealth(a), refreshPage: () => renderPage(), phaseFree, avatarUrl, t, items, agent, aname, atitle, av, when, whenH, agoH, ago, byAct, PLAT, stageLabel, stateTag,
  refresh: async () => { await poll(true); if (!UI.down) await avLoad(true); return !UI.down; },   // t-m2-c ④ pull-to-refresh: a forced full fetch; false = the server did not answer; t-avatar-live-refresh: then reread the avatar manifests
  tablePv: s => tablePv(s),   // t-chat-table (mobile.js chat list preview)
  mailPv: (s, a) => mailPv(s, a),   /* t-ri1108-a P1 (widgets.js 新回复 rows) */
  srvT: (s, th) => srvT(s, th), quietNight: d => quietNight(d), titleEn: (s, it) => titleEn(s, it), tplSeed: d => tplSeed(d), tplEn: (j, v) => tplEn(j, v),   /* t-i18n-c (market.js) */   /* t-i18n-b: server-written zh -> en at display (transfer.js, market.js) */
  verCheck: () => verCheck(true), attachPick: p => attachPick(p),   // t-lib-attach (viewer.js)   // t-new-ver (tests)
  queueOf: id => queueOf(id), qBadge: (id, small) => qBadge(id, small),   /* t-agent-queue */ seenOf: id => seenOf(id), unreadOf: id => unreadOf(id),   /* t-ri1104-p2 */ chatMailRead: (id, t) => chatMailRead(id, t),   /* r-improve-1102 P3 (was swallowed by a // comment until 11-04) */   /* t-home-applike (palette) */
  draft: k => DRAFT.get(k), liveItem: a => liveItem(a), mgrOnline: a => mgrOnline(a), isBusy: a => isBusy(a), /* t-ui-fix-r6 R6-08 */ typingOn: (a, l) => typingOn(a, l), typingUntil: l => typingUntil(l),   // t-now-closed (home.js hero, office.js bubble)   // t-draft-keep (mobile.js chat list marks [草稿])
  go: p => go(p), openModal: (h, f) => openModal(h, f), closeModal: () => closeModal(), renderPage: () => renderPage(),   /* t-hm-build */ openItem: id => openItem(id), seekItem: (id, sp) => seekItem(id, sp), seekChat: (t, q) => seekChat(t, q),   /* t-ri1103-p5 */ closeItem: () => closeItem(), backItem: () => backItem(), setChat: id => setChat(id), api: (k, b) => api(k, b), toast: (m, e) => toast(m, e),
  rejectItem(id) { openItem(id); modalReject(); }, on: fn => hooks.push(fn), inkEb, route: (P, via) => route(P, via),
  snoozed: it => snoozed(it), snzMenu: (id, anchor, done) => snzMenu(id, anchor, done), snzLine: () => snzLine(), snzText: it => snzText(it),   /* ri1103-P2 */
  usage: () => usage(), roleUsage: () => roleUsage(), ruHTML: (n, o) => ruHTML(n, o), soulHTML: () => soulHTML(), fmtTok,   /* t-home-usage */
  themeMode: () => themeMode(), setTab: k => setTab(k),   /* t-settings-tab */
  stageSub: (en, ut) => stageSub(en, ut),   /* t-theme-ut */
  textures: () => TEXTURES.map(x => x[0]),   /* t-theme-knit (mobile.js texSet) */
  archAll: () => archAll(), archList: () => ARCH.all, archIx: () => archIx(),   /* t-perf A (palette.js search) */
  chatList: id => chatList(id), histAll: () => histAll(), mailUnread: () => mailUnread(), mailAll: () => mailAll(),   /* ri1105-P4 (palette.js, mobile.js) */
};

// ---------- boot ----------
// deep links: #page=board  #item=<id>  #theme=light  #lang=en
const H = new URLSearchParams(location.hash.slice(1));
if (H.get("page")) { const p = pageAlias(H.get("page")); if (/^[a-z]{1,24}$/.test(p)) UI.page = p; }   // t-oss-secreview P0: only a plain page key; renderPage() drops unknown ones
if (H.get("tab") && SET_TABS.includes(H.get("tab"))) UI.setTab = H.get("tab");   // t-settings-tab: #page=settings&tab=system
if (H.get("theme")) UI.theme = H.get("theme");
LS.set("home3", "widgets");   /* t-home-style-trim: old saved dense / app / classic land on widgets; #home= links are ignored */
if (H.get("lang")) UI.lang = H.get("lang");
if (H.get("fold")) UI.chatFold = H.get("fold") === "1";
document.documentElement.dataset.theme = UI.theme;
/* t-ui-fix-r3 R3-07: the t-visual-ink empty-state art probe (/work/t-visual-art/empty-*.png) is gone: the art was never made, so every fresh browser got 4 x 404. Empty states stay typographic; skin-ink.css keeps its unused --es-* slot. */
snapBoot();
poll(true).then(() => {
  if (!poll.entered) window.FX && FX.enter($("#pagebody"));
  /* t-oss-webkit-e2e: the first poll can end without a state (a fetch cut off by a reload, WebKit); then wait for the next one (up to 10 s)
     instead of routing on a null state (was an unhandled TypeError on ST.items) */
  if (H.get("item") || H.get("dm") || H.get("rep") || H.get("push")) { let n = 0; const cold = () => { if (!ST && ++n < 20) return setTimeout(cold, 500);
    const r = route(H, "cold"); document.dispatchEvent(new CustomEvent("rt:routed", { detail: { via: "cold", result: r, push: H.get("push") } })); }; cold(); }
});
/* t-power-save: a hidden tab polls every 30 s instead of 2.5 s, and refreshes once the moment it is visible again */
let pollAt = Date.now();
setInterval(() => { if (LP.run || LP.hold) return; if (!document.hidden && REV != null && !UI.fail) { lpLoop(); return; } if (document.hidden && Date.now() - pollAt < 30000) return; pollAt = Date.now(); poll(); }, 2500);   // ri1105-P5: the timer only runs while long polling is off
document.addEventListener("visibilitychange", () => { if (!document.hidden) { pollAt = Date.now(); poll(); } else lpAbort(); });   // poll() cancels a stale wait and restarts the long poll after it
setInterval(() => { if (ST) { renderLeft(); renderTool(); } document.querySelectorAll(".m-typing[data-until]").forEach(b => { if (b.dataset.until && Date.now() > +b.dataset.until) b.remove(); }); }, 60000);   // t-typing-fix: stale typing dots go even without a poll change

/* ===== ui4: segmented switch (.seg) — sliding indicator for filters. Pure presentation: finds .seg containers after any render,
   measures the .on item and slides an <i.seg-ind> from where the previous render left it. No filtering logic touched.
   t-phone-filter-row v2 (user 11-22 「点击的时候一下一下的」): the slide is continuous now.
   - The pages rebuild their filter row on every pick (renderPage -> innerHTML), so the indicator node is new each time. Each key remembers its
     last slide (from / to / start / duration) and a new node starts from where the old one IS at this moment (spring evaluated in JS), so a
     rebuild, a second tap mid-flight or a poll never makes it jump.
   - It runs in the MutationObserver callback (a microtask, before paint): no frame shows the new row without its indicator.
   - A tap on a filter row (.filters .seg) moves the pill at once, before the page renders the new list (that render can take a few frames).
   - Motion: the same damped spring as the phone tab bar (--m-spring family, nav.js TBM.spring), WAAPI on transform + width. */
(() => {
  const POS = {}, SL = {}, reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const Z = .72, W = 7.2, WD = W * Math.sqrt(1 - Z * Z);
  const spr = t => t >= 1 ? 1 : t <= 0 ? 0 : 1 - Math.exp(-Z * W * t) * (Math.cos(WD * t) + Z * W / WD * Math.sin(WD * t));
  let LIN = "cubic-bezier(.2,.8,.2,1)";
  try { const pts = []; for (let i = 0; i <= 30; i++) pts.push((i === 30 ? 1 : spr(i / 30)).toFixed(4)); const l = `linear(${pts.join(",")})`; if (CSS.supports("transition-timing-function", l)) LIN = l; } catch (_) { }
  /* where a key's indicator is at time now: [x, w] */
  const at = (P, now) => { const k = P.dur ? spr((now - P.t0) / P.dur) : 1; return [P.fx + (P.x - P.fx) * k, P.fw + (P.w - P.fw) * k]; };
  /* scroll a track only as far as needed to show the picked button clear of the edge fades (was: always centre it). Centring scrolled the
     track under the moving pill, so the pill seemed to step back before sliding on. Shared with phone/nav.js (window.__segInView). */
  function inView(tr, on, smooth) {
    if (!on || tr.scrollWidth <= tr.clientWidth + 1) return;
    const M = 28, cur = tr.scrollLeft, cw = tr.clientWidth, a = on.offsetLeft, b = a + on.offsetWidth;
    let t = a - M < cur ? a - M : b + M > cur + cw ? b + M - cw : cur;
    t = Math.max(0, Math.min(tr.scrollWidth - cw, t));
    if (Math.abs(t - cur) > 1) tr.scrollTo({ left: t, behavior: smooth && !reduce.matches ? "smooth" : "auto" });
  }
  window.__segInView = inView;
  function sync(seg, force) {
    const on = seg.querySelector(".seg-i.on"), key = seg.dataset.seg || "";
    let ind = seg.querySelector(".seg-ind");
    if (RO && !seg._ro) { seg._ro = 1; RO.observe(seg); }   /* t-m-ut-white: see RO below */
    if (!ind) { ind = document.createElement("i"); ind.className = "seg-ind"; ind.setAttribute("aria-hidden", "true"); ind.style.transition = "opacity .2s"; seg.prepend(ind); }
    if (!on || !on.offsetWidth) { ind.style.opacity = 0; return false; }
    const x = on.offsetLeft, w = on.offsetWidth, prev = POS[key], now = performance.now();
    const place = (px, pw) => { ind.style.width = pw + "px"; ind.style.transform = `translateX(${px}px)`; };
    ind.style.opacity = 1;
    if (ind._a) { ind._a.cancel(); ind._a = null; }
    if (ind._w) { ind._w.cancel(); ind._w = null; }
    const [cx, cw] = prev ? at(prev, now) : [x, w];
    place(x, w);
    const moving = prev && !force && !reduce.matches && (Math.abs(cx - x) > .5 || Math.abs(cw - w) > .5);
    if (moving && ind.animate) {
      /* keep the remaining time of a slide already under way to the same place (a rebuild mid-flight), else a fresh one */
      const same = Math.abs(prev.x - x) < .5 && Math.abs(prev.w - w) < .5 && now - prev.t0 < prev.dur;
      const P = same ? prev : { fx: cx, fw: cw, x, w, t0: now, dur: Math.round(380 + Math.min(160, Math.abs(x - cx) * .45)) };
      const el = now - P.t0;
      /* two animations: transform alone runs on the compositor (a long render frame does not stall it); width rides on the main thread */
      const o = { duration: P.dur, delay: -el, easing: LIN };
      ind._a = ind.animate([{ transform: `translateX(${P.fx}px)` }, { transform: `translateX(${P.x}px)` }], o);
      ind._w = Math.abs(P.fw - P.w) > .5 ? ind.animate([{ width: P.fw + "px" }, { width: P.w + "px" }], o) : null;
      ind._a.onfinish = () => { ind._a = null; ind._w = null; };
      /* the picked label turns light as the pill arrives under it, not before (a rebuilt row draws it light at once) */
      const off = [...seg.querySelectorAll(":scope > .seg-i")].find(x => x !== on && !x.getAnimations().some(a => typeof CSSTransition === "function" && a instanceof CSSTransition));   /* not the one just let go (its colour is mid-transition) */
      if (off && on.animate) { if (on._ca) on._ca.cancel(); const c0 = getComputedStyle(off).color, c1 = getComputedStyle(on).color; if (c0 !== c1) on._ca = on.animate([{ color: c0 }, { offset: .35, color: c0 }, { color: c1 }], { duration: Math.max(160, (P.dur - el) * .6), easing: "ease-out" }); }
      POS[key] = P;
    } else POS[key] = { fx: x, fw: w, x, w, t0: now, dur: 0 };
    // keep the selected item in view when the track scrolls (phone / narrow dropdown)
    if (seg.scrollWidth > seg.clientWidth + 1) {
      /* a rebuilt track starts at scrollLeft 0: put it back where the old one was (mid smooth-scroll too), then glide on */
      if (!seg._sl) { seg._sl = 1; if (SL[key] != null && prev) seg.scrollLeft = SL[key]; seg.addEventListener("scroll", () => { SL[key] = seg.scrollLeft; }, { passive: true }); }
      inView(seg, on, !!prev);
    }
    return true;
  }
  /* t-phone-filter-row v2: a page that rebuilds its filter row (renderPage -> innerHTML, e.g. the 通知 row on every pick) gets its old row back
     when the new one has the same buttons: the pill keeps its running slide (no restart after the long render frame), the track keeps its scroll.
     Runs in the observer microtask, before paint. Clicks are delegated on document, so the kept node behaves the same. */
  const ROWS = {};
  const bk = b => b.outerHTML.replace(/\s+style="[^"]*"/, "").replace(/\bseg-i(\s+on)?\s*"/, 'seg-i"');   /* a button minus its pick state */
  const sig = r => r.className.replace(/\s*\b(keep|enter)\b/g, "") + "|" + [...r.querySelectorAll("button")].map(bk).join("");
  function keepRows(muts) {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      const rows = n.matches && n.matches(".filters") ? [n] : n.querySelectorAll ? n.querySelectorAll(".filters") : [];
      for (const r of rows) {
        const s = r.querySelector(":scope > .seg[data-seg]"); if (!s || !r.isConnected) continue;
        const key = s.dataset.seg, old = ROWS[key], g = sig(r);
        if (old && old !== r && !old.isConnected && old._sig === g) {
          const os = old.querySelector(":scope > .seg"), want = s.querySelector(".seg-i.on"), wk = want && bk(want);
          os.querySelectorAll(":scope > .seg-i").forEach(b => b.classList.toggle("on", !!wk && bk(b) === wk));
          r.replaceWith(old);
          if (SL[key] != null) { os.scrollLeft = SL[key]; inView(os, os.querySelector(".seg-i.on"), true); }
          continue;
        }
        r._sig = g; ROWS[key] = r;
      }
    }
  }
  let q = 0;
  const pass = force => document.querySelectorAll(".seg").forEach(s => { if (force || !s._ui4 || s._ui4 !== s.querySelector(".seg-i.on")) { if (sync(s, force)) s._ui4 = s.querySelector(".seg-i.on"); } });
  function run(force) { cancelAnimationFrame(q); q = requestAnimationFrame(() => pass(force)); }
  new MutationObserver(muts => { keepRows(muts); cancelAnimationFrame(q); pass(false); }).observe(document.body, { childList: true, subtree: true });   /* microtask: before the next paint */
  /* a tap on a filter row: the pill leaves at once (the list render that follows rebuilds the row; the new node carries on from here) */
  document.addEventListener("click", e => {
    const b = e.target.closest && e.target.closest(".filters .seg > .seg-i"); if (!b || b.classList.contains("on") || b.disabled) return;
    const s = b.parentElement; s.querySelectorAll(":scope > .seg-i.on").forEach(x => x.classList.remove("on")); b.classList.add("on");
    if (sync(s, false)) s._ui4 = b;
  }, true);
  /* t-m-ut-white: a .seg re-rendered while its tab is hidden (offsetWidth 0) left the indicator at opacity 0, and showing the tab is not a DOM mutation,
     so the selected item stayed light text on a light track. Watch each track's size: hidden -> shown fires and re-syncs it. */
  const RO = typeof ResizeObserver === "function" ? new ResizeObserver(() => run(false)) : null;
  addEventListener("resize", () => run(true));
  document.fonts && document.fonts.ready.then(() => run(true));
  run(false);
})();

export { render, workersOf, renderChrome, hooks, typingOn, typingUntil, RMQ, wkTag, wkBand, liveItem, wkDur, isBusy, NV, roll, mgrOnline, MGR_ON, MGR_WATCH, wkAttr, wkFx, dcDur };
