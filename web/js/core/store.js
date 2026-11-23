// Dashboard core: page state (UI), the polled board (ST, REV), card predicates (onYou, snoozed, queueOf ...), slim polling, archived cards,
// the offline snapshot, chat / mail history windows and the poll / long-poll loop.
// t-oss-struct S10 (A2): moved out of app.js. ST and REV are live bindings: other modules read them; only this file assigns them.


import { $, LS } from "./util.js";
import { srvLocal, titleEn } from "./i18n.js";
import { AVS, AVU, avsCheck, avvSeen } from "./av.js";
import { toast } from "./ui.js";
import { chatFrom, setChatFrom } from "../views/chat.js";
import { routineOf } from "../views/drawer.js";
import { syncPaint } from "../views/header.js";
import { doneMailRead, renderMailbox } from "../views/mail.js";
import { renderPage } from "../views/pages/index.js";
import { awaitsUser, openAsks } from "../views/pages/review.js";
import { render, renderChrome, workersOf } from "../app.js";
const UI = {
  page: (p => p === "home" ? "review" : p === "team" || p === "roles" ? "crew" :   /* t-roster-rail: 团队 = the roster page */ ["docs", "logs"].includes(p) ? "settings" : p)(LS.get("page", "review")), setTab: (p => ["docs", "logs"].includes(p) ? p : LS.get("setTab", "general"))(LS.get("page", "review")),   /* t-settings-tab: 角色 / 文档 / 日志 live under 设置 */ item: null, chat: LS.get("chat", "manager"), home: "widgets",   /* t-home-style-trim (11-11): the web home is the widget home only; dense / app / classic and their switches are gone. rt.home3 is rewritten to "widgets" below */
  lang: LS.get("lang", /^zh/i.test(navigator.language || "") ? "zh" : "en"),   /* audit SM-03: first visit follows the browser language */ theme: LS.get("theme", "dark"), sort: LS.get("sort", "activity"),
  logAgent: "", mailFilter: "all", doc: null, docs: null, docText: "", openRep: null, calForm: false, tick: 0,
  seen: LS.get("seen", {}), chatW: LS.get("chatW", 420), chatFold: LS.get("chatFold", false),
};
let ST = null, REV = null;
// t-web-audit-2 03: a waiting plan/question is on the user, same as the home page (awaitsUser). Lists group it with review and call that group 「等你拍板」.
// q-1030-29a9: lists show a "doing" card under 进行中 only while an agent is actually working on it; a doing card with nobody on it
// (standing / ongoing work between runs) is shown under 待办. Display only: the stored stage stays "doing" (the detail's stage pill shows it).
const idleDoing = i => i.stage === "doing" && !workersOf(i.id).length;
// t-doing-first: a card someone is working on right now is 进行中 everywhere, even if its stored stage is review / waiting (e.g. the
// specialist is answering your comment). It leaves 等你拍板 (lists, counts, red dots) until the run ends, then comes back on its own.
const busy = i => !!i && i.stage !== "done" && workersOf(i.id).length > 0;
// t-home-newreplies: a card nobody is working on that still has an unanswered ask is on you too, whatever its stage (a comment flips review → doing;
// the specialist answers + asks again but may not put it back to review). onYouCard = the cards listed as review cards; awaitsUser ones are the decisions list.
// ri1103-P2: 稍后. it.snooze = {until, wait:"reply"|null, at} from the server; while active the card leaves 等你拍板 everywhere (lists, counts,
// red dots, the app badge). The server's snooze_loop clears it within ~20 s of the time / the reply; this mirror hides that gap.
const snzReplied = i => { const at = Date.parse(i.snooze.at) || 0; return (i.thread || []).some(e => e.who !== "me" && e.kind !== "event" && (Date.parse(e.t) || 0) > at) || (Date.parse(i.draft_at) || 0) > at; };
// 「等回复」 ends after 3 days with no reply too (server sets until = at + 3 d; a snooze made before that change has no until, so count from at)
const snzEnd = i => i.snooze.until ? Date.parse(i.snooze.until) : i.snooze.wait === "reply" ? (Date.parse(i.snooze.at) || 0) + 3 * 864e5 : Infinity;
const snoozed = i => !!i && !!i.snooze && i.stage !== "done" && snzEnd(i) > Date.now() && !(i.snooze.wait === "reply" && snzReplied(i));
const onYouCard = i => !!i && i.stage !== "done" && !busy(i) && !snoozed(i) && (i.stage === "review" || (!awaitsUser(i) && openAsks(i).length > 0));
const onYou = i => onYouCard(i) || (!!i && awaitsUser(i) && !busy(i) && !snoozed(i));
// t-agent-queue: a role's queue = its open cards that are to do, or in progress but not the card it is on now. Routine cards (r-…) never count (t-queue-count narrows it below).
// Badge 「排队 N」 (hidden at 0) in the TEAM list, the chat roster, the DM header and the 此刻在忙 widget; a click lists the cards (App.queueOf / qBadge).
/* t-queue-count: only cards the role still has to start or continue count. Left out: standing cards (category ongoing, a routine, or the
   target of a live 定时 schedule), cards on the user (open ask / review / snoozed: waiting on you, not on the role), and the manager's own
   todo cards (the manager dispatches; a todo it owns is a parked idea until the user says go). */
const schedItem = id => (ST.schedules || []).some(s => s && !s.deleted && !s.finished && s.enabled !== false && s.task && s.task.item === id);
const standing = i => i.category === "ongoing" || !!routineOf(i) || schedItem(i.id);
const queueOf = id => { const a = (ST && ST.agents && ST.agents[id]) || {}; return items().filter(i => i.owner === id && !i.archived && !/^r-/.test(i.id) && (i.stage === "todo" || (i.stage === "doing" && i.id !== a.item))
    && !standing(i) && !onYou(i) && !snoozed(i) && !(id === "manager" && i.stage === "todo"))
  .sort((x, y) => (Date.parse(x.updated || x.created) || 0) - (Date.parse(y.updated || y.created) || 0)); };
const qBadge = (id, small) => { const n = queueOf(id).length; return !n ? "" : small ? `<i class="aq-n" data-aq="${esc(id)}" title="${UI.lang === "en" ? `${n} queued` : `排队 ${n}`}">${n}</i>` : `<span class="aq" data-aq="${esc(id)}" title="${UI.lang === "en" ? `${n} queued` : `排队 ${n}`}"><span class="aq-w">${UI.lang === "en" ? "Queued" : "排队"}</span>${n}<span class="aq-d" aria-hidden="true"></span></span>`; };   /* t-queued-dots: .aq-d = three floating dots (dot + ::before + ::after) */
const grpOf = i => busy(i) ? "doing" : snoozed(i) ? "todo" : (awaitsUser(i) || onYouCard(i)) ? "review" : idleDoing(i) ? "todo" : i.stage;   // ri1103-P2: a snoozed card waits under 待办
// t-idle-pause-tag: such a card says 「暂停」 where a row shows its stage, so it stands apart from a real 待办
const pauseL = () => UI.lang === "en" ? "Paused" : "暂停";
// t-standing-paused: a standing card (ongoing / routine / target of a live 定时) is idle between runs by design, so it says 「常驻」, not 「暂停」.
// A real pause (routine or 按需常驻 paused) still says 暂停 through rtTag, which every caller checks first.
/* r-improve-1119 P2: an idle in-progress card whose last word (events skipped) is a team message to the user that the user has not
   answered is waiting on the user, not paused: 「等你回 N 天」 (days rounded down; under a day just 「等你回」). A log line or the user's own
   words last = 暂停 as before. Text only: counts, red dots and 等你拍板 do not change. */
const ballOnYou = i => { const th = i.thread || []; for (let k = th.length - 1; k >= 0; k--) { const e = th[k]; if (!e || e.kind === "event") continue; return e.who !== "me" && e.kind === "msg" ? e : null; } return null; };
const youOweL = e => { const d = Math.floor((Date.now() - (Date.parse(e.t) || Date.now())) / 864e5); return UI.lang === "en" ? (d >= 1 ? `Your reply · ${d}d` : "Your reply") : (d >= 1 ? `等你回 ${d} 天` : "等你回"); };
const idleL = i => { if (standing(i)) return UI.lang === "en" ? "Ongoing" : "常驻"; const e = ballOnYou(i); return e ? youOweL(e) : pauseL(); };
const items = () => (ST.items || []).filter(i => !i.archived);
/* r-improve-1119 P1: one 「等了多久」 for every place (card tag, 等你拍板 widget rows + footer, notice line, phone 「最久 N」): the wait starts at the
   last 提交审核 event in the thread (a manager log line or a comment does not reset it); no such event -> it.updated. Always rounded down. */
const waitSince = it => { const th = (it && it.thread) || []; for (let i = th.length - 1; i >= 0; i--) if (th[i].kind === "event" && /^提交审核/.test(th[i].text || "")) return th[i].t; return it.updated || it.activity; };
const waitMs = it => Math.max(0, Date.now() - (Date.parse(waitSince(it)) || Date.now()));
const byAct = (a, b) => (b.activity || b.updated || "").localeCompare(a.activity || a.updated || "");
const byCreated = (a, b) => (b.created || "").localeCompare(a.created || "");

// ---------- t-mobile-crash-state: slim polling (phone; desktop too since ri1107-P2) ----------
// A slim done/archived card has no draft / versions (it.slim = 1). The drawer asks /api/item for the full card once; FULL keeps those
// fields and every poll puts them back while the card's `updated` is unchanged (a changed card is fetched again on the next open).
// An older server ignores ?slim=1 and sends full cards (no it.slim), so nothing here ever runs against it.
const FULL = {}, FULLP = {};
function rehydrate() {
  for (const it of ST.items || []) {
    const f = it.slim && FULL[it.id];
    if (!f) continue;
    if (f.updated !== it.updated) { delete FULL[it.id]; continue; }
    it.draft = f.draft; it.versions = f.versions; delete it.slim;
  }
  srvLocal();   /* t-i18n-b */
}
function fullItem(id) {
  return FULLP[id] || (FULLP[id] = fetch("/api/item?id=" + encodeURIComponent(id)).then(r => r.ok ? r.json() : null)
    .then(f => { if (f) { FULL[id] = { updated: f.updated, draft: f.draft || "", versions: f.versions || [] }; rehydrate(); } return !!f; }, () => false)
    .finally(() => { delete FULLP[id]; }));
}
// ---------- t-perf A: archived cards (done for 3+ days) are not in the poll. ST.meta.archive.ix = [[id, title, owner, date]] names them
// (id chips, title search, deep links). Opening one fetches it (+ its archived family) from /api/item; ARCH.got keeps those and every
// poll puts them back into ST.items, flagged archived (so no list shows them). Search and 素材库 load the whole archive once
// (/api/archive, refetched only when meta.archive.v changes) and fire "rt-arch" when it lands. A card you act on moves back on the server.
const ARCH = { got: {}, pend: {}, miss: {}, all: null, v: null, p: null };
const archIx = () => (ST && ST.meta && ST.meta.archive && ST.meta.archive.ix) || [];
const archKnown = id => archIx().some(x => x[0] === id);
const archTitle = id => { const x = archIx().find(x => x[0] === id); return x ? (UI.lang === "en" ? titleEn(x[1]) : x[1]) : ""; };
const archFlag = x => Object.assign(x, { archived: true, _arch: 1 });
function archMerge() {
  const real = new Set(), mine = new Set();
  for (const i of ST.items || []) (i._arch ? mine : real).add(i.id);
  for (const id of Object.keys(ARCH.got)) { if (real.has(id)) { delete ARCH.got[id]; continue; } if (!mine.has(id)) ST.items.push(ARCH.got[id]); }   // back on the server = the server's copy wins
  srvLocal();   /* t-i18n-b: archived cards pushed back in */
}
function archItem(id) {
  if (ARCH.pend[id]) return ARCH.pend[id];
  const keep = list => { list.forEach(x => { ARCH.got[x.id] = archFlag(x); }); archMerge(); return true; };
  if (ARCH.all) { const f = ARCH.all.find(i => i.id === id); if (f) return Promise.resolve(keep([f, ...ARCH.all.filter(i => i.id !== id && ((f.tags || []).includes(i.id) || (i.tags || []).includes(id)))])); }
  return (ARCH.pend[id] = fetch("/api/item?id=" + encodeURIComponent(id)).then(r => r.ok ? r.json() : null)
    .then(f => { if (!f || !f.archived_store) return false; const fam = f.family || []; delete f.family; delete f.archived_store; return keep([f, ...fam]); }, () => false)
    .finally(() => { delete ARCH.pend[id]; }));
}
function archAll() {
  const v = ST && ST.meta && ST.meta.archive && ST.meta.archive.n ? ST.meta.archive.v : null;
  if (!v) return Promise.resolve([]);
  if (ARCH.all && ARCH.v === v) return Promise.resolve(ARCH.all);
  return ARCH.p || (ARCH.p = fetch("/api/archive").then(r => r.json()).then(j => {
    const have = new Set((ST.items || []).filter(i => !i._arch).map(i => i.id));
    ARCH.all = (j.items || []).filter(i => !have.has(i.id)).map(archFlag); ARCH.v = v; document.dispatchEvent(new Event("rt-arch")); return ARCH.all;
  }).catch(() => []).finally(() => { ARCH.p = null; }));
}
// t-m2-a ③: the cold-start skeleton (index.html #boot-sk, phone only) goes as soon as the first poll answers or fails
function bootDone() { const b = document.getElementById("boot-sk"); if (b) b.remove(); }
/* ri1105-P3: open with content. Every full /api/state answer is kept (raw text, when the page is idle) in IndexedDB rt-snap; a cold start draws
   the last one at once while the first poll runs, and the sync pill says 「同步中 · 上次 N 分钟前」 until it answers. Display only: clicks still go
   to the server as usual, nothing is queued offline. Snapshots older than 24 h are not used. ri1107-P2: every poll is slim, one key (the old desktop "state" key is dropped once). */
const SNAP = { key: () => "state-slim", max: 24 * 3600e3 };   /* ri1107-P2: desktop polls slim too, so one key */
function snapDb() {
  return SNAP.db || (SNAP.db = new Promise((ok, no) => { const q = indexedDB.open("rt-snap", 1); q.onupgradeneeded = () => q.result.createObjectStore("s"); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); }).catch(() => null));
}
function snapSave(txt) {
  if (!window.indexedDB || !txt) return;
  clearTimeout(SNAP.t); SNAP.t = setTimeout(() => (window.requestIdleCallback || (f => setTimeout(f, 50)))(() => snapDb().then(db => { if (!db) return;
    try { const os = db.transaction("s", "readwrite").objectStore("s"); os.put({ t: Date.now(), txt }, SNAP.key()); if (!SNAP.gc) { SNAP.gc = 1; os.delete("state"); } } catch (_) { } })), 3000);
}
function snapLoad() {
  if (!window.indexedDB) return Promise.resolve(null);
  return snapDb().then(db => db && new Promise(ok => { try { const q = db.transaction("s").objectStore("s").get(SNAP.key()); q.onsuccess = () => ok(q.result || null); q.onerror = () => ok(null); } catch (_) { ok(null); } }));
}
async function snapBoot() {
  const v = await Promise.race([snapLoad().catch(() => null), new Promise(ok => setTimeout(() => ok(null), 800))]);
  if (ST || !v || !v.txt || Date.now() - v.t > SNAP.max) return;
  await Promise.race([Promise.all([AVS.ready, AVU.ready]), new Promise(ok => setTimeout(ok, document.documentElement.dataset.ut && AVU.cold ? 400 : 300))]);   /* t-avatar-style: UT with no cached ut manifest waits a little longer */
  if (ST) return;
  try { const j = JSON.parse(v.txt); UI.snap = v.t; poll.entered = 1; histSet(j); ST = j; rehydrate(); archMerge(); render(); bootDone(); syncPaint(); window.FX && FX.enter($("#pagebody")); }
  catch (e) { console.error("snapshot render failed", e); UI.snap = 0; ST = null; }
}
/* ri1105-P4: a poll carries the newest 200 manager-chat messages, the newest 300 letters + every unread one, and no logs (server trim_state;
   meta.trim says what was left out). HIST holds the rest once fetched from /api/history: chat = a contiguous run ending where the poll's window
   starts (messages that slide out of the window are kept here too, so the list only grows during a session and chat indices stay put),
   mail = older read letters (only fetched when a filter runs short), logs = the 日志 tab (fetched per rev while it is open). */
const HIST = { chat: { start: null, list: [] }, mail: null, mailP: null, logs: null, logsP: null, allP: null, allFail: false };
const trimOf = (s, k) => s && s.meta && s.meta.trim ? s.meta.trim[k] : null;
const chatBase = s => (trimOf(s, "chat") || [0])[0];
function histSet(nw) {
  const nb = chatBase(nw), H0 = HIST.chat;
  if (!ST || H0.start == null) { HIST.chat = { start: nb, list: [] }; HIST.allP = null; }
  else {
    const ob = H0.start + H0.list.length, oc = ST.chat || [];
    if (nb > ob && nb - ob <= oc.length) H0.list = H0.list.concat(oc.slice(0, nb - ob));
    else if (nb !== ob) { HIST.chat = { start: nb, list: [] }; HIST.allP = null; }
  }
  if (HIST.mail && ST) {   // letters that left the poll were read (unread ones are always sent)
    const keep = new Set((nw.mail || []).map(m => m.id)), have = new Set(HIST.mail.map(m => m.id));
    (ST.mail || []).forEach(m => { if (!keep.has(m.id) && !have.has(m.id)) HIST.mail.push(Object.assign({}, m, { read: true })); });
  }
}
const olderN = id => id === "manager" ? (HIST.chat.start || 0) : 0;
function chatOlder(n) {   // the n messages before what this page holds
  const end = HIST.chat.start; if (!end) return Promise.resolve(0);
  return fetch(`/api/history?k=chat&end=${end}&n=${n}`).then(r => r.json()).then(j => {
    if (HIST.chat.start !== end || !Array.isArray(j.list) || j.start + j.list.length !== end) return 0;
    HIST.chat = { start: j.start, list: j.list.concat(HIST.chat.list) };
    if (UI.chat === "manager") setChatFrom(chatFrom + (j.list.length));
    IXdirty(); return j.list.length;
  });
}
function histAll() {   // every older chat message (⌘K over old chat, a ↩ jump to a message before the window)
  if (!HIST.chat.start) return Promise.resolve(0);
  return HIST.allP || (HIST.allP = chatOlder(HIST.chat.start).catch(() => { HIST.allFail = true; return 0; }).finally(() => { HIST.allP = null; }));
}
const IXdirty = () => document.dispatchEvent(new Event("rt-hist"));
/* r-improve-1120 P2: a ⏰ reminder letter is never unread (pushed on time, kept in the mailbox, but no bold, dot or count). Mirrors api/routes/state.py mail_unread(). */
const unreadM = m => !!m && !m.read && m.kind !== "remind";
const mailUnread = () => { const M = ST && ST.meta; return M && M.mail_unread != null ? M.mail_unread : ((ST && ST.mail) || []).filter(unreadM).length; };
function mailAll() {
  if (!HIST.mail || !HIST.mail.length) return ST.mail || [];
  const seen = new Set((ST.mail || []).map(m => m.id));
  return HIST.mail.filter(m => !seen.has(m.id)).concat(ST.mail || []).sort((a, b) => String(a.t).localeCompare(String(b.t)));
}
function mailOlder() {
  const tm = trimOf(ST, "mail"); if (HIST.mail || HIST.mailP || !tm || tm[0] <= tm[1]) return;
  HIST.mailP = fetch("/api/history?k=mail").then(r => r.json()).then(j => { HIST.mail = j.list || []; if (UI.page === "mail") renderPage(); renderMailbox(); })
    .catch(() => { }).finally(() => { HIST.mailP = null; });
}
function logsFor(ag) {
  ag = ag || ""; const L = HIST.logs;
  if (ST && ST.logs && !trimOf(ST, "logs")) return ST.logs.filter(l => !ag || l.agent === ag);   // an old snapshot / server still sends logs
  if ((!L || L.rev !== REV || L.ag !== ag) && !HIST.logsP) {
    const rev = REV;
    HIST.logsP = fetch("/api/history?k=logs" + (ag ? "&agent=" + encodeURIComponent(ag) : "")).then(r => r.json()).then(j => {
      HIST.logs = { rev, ag, list: j.list || [] }; if (UI.page === "settings" && UI.setTab === "logs") renderPage();
    }).catch(() => { }).finally(() => { HIST.logsP = null; });
  }
  return L && L.ag === ag ? L.list : null;
}
// ---------- polling ----------
/* ri1105-P5: long polling. A visible page asks /api/state?rev=N&wait=25; the server answers the moment rev (or the inbox count) moves, else
   "same" after 25 s, and the page asks again at once (300 ms after a full answer, so a burst of writes comes as one). Errors, a hidden tab or an
   older server (a "same" back in under 1 s) fall back to the 2.5 s / 30 s timer below. A normal poll (after your own action, pull to refresh)
   cancels the waiting one and restarts it when done. */
const LP = { ctl: null, run: false, hold: 0, t: 0 };
function lpAbort() { if (LP.ctl) { LP.ctl.byUs = true; LP.ctl.abort(); } }
function lpLoop() {
  clearTimeout(LP.t);
  if (LP.run || LP.hold || document.hidden || REV == null || UI.fail) return;
  LP.run = true; const t0 = Date.now();
  poll(false, true).then(res => {
    LP.run = false;
    if (res === "abort" || UI.fail || document.hidden) return;
    const dt = Date.now() - t0;
    LP.t = setTimeout(lpLoop, res === "same" && dt < 1000 ? 2500 : res === "full" ? 300 : 0);
  });
}
async function poll(force, lp) {
  const wait = !!lp && REV != null && !force;
  let ctl = null, tmo = 0;
  if (!lp) { LP.hold++; lpAbort(); }
  if (wait) { ctl = LP.ctl = new AbortController(); tmo = setTimeout(() => ctl.abort(), 32000); }
  try { return await pollOnce(force, wait, ctl); }
  finally { clearTimeout(tmo); if (ctl && LP.ctl === ctl) LP.ctl = null; if (!lp) { LP.hold--; if (!LP.hold) setTimeout(lpLoop, 0); } }
}
/* t-perf-smooth F4a: new data that lands while the detail panel slides or the page changes (a CSS transition or animation on #drawer, #page or
   #pagebody, or a running view transition) is drawn when that motion ends, at most 600 ms later; polls that arrive meanwhile join the same
   render. Only polls wait: your own clicks render at once as before. */
const MOTION = { t: 0, w: false };
function motionNow() {
  if (document.documentElement.classList.contains("vt-run")) return [];
  const out = [];
  for (const id of ["drawer", "page", "pagebody"]) { const el = document.getElementById(id); if (!el) continue;
    try { el.getAnimations().forEach(a => { const tm = a.effect && a.effect.getComputedTiming(); if (a.playState === "running" && tm && tm.iterations !== Infinity && tm.endTime < 2000) out.push(a); }); } catch (_) { } }
  return out;
}
function renderAfterMotion() {
  if (MOTION.w) return;   // a render is already queued: it reads the newest ST
  const busy = document.hidden ? [] : motionNow();
  if (!busy.length && !document.documentElement.classList.contains("vt-run")) return render();
  MOTION.w = true;
  const go = () => { if (!MOTION.w) return; MOTION.w = false; clearTimeout(MOTION.t); try { render(); } catch (e) { console.error("render failed", e); } };
  MOTION.t = setTimeout(go, 600);
  Promise.all(busy.map(a => a.finished.catch(() => { }))).then(() => requestAnimationFrame(go));
}
async function pollOnce(force, wait, ctl) {
  try {
    const qs = [REV != null && !force ? `rev=${REV}` : "", "slim=1", wait ? "wait=25" : ""].filter(Boolean).join("&");   // t-mobile-crash-state
    const r = await fetch("/api/state" + (qs ? "?" + qs : ""), ctl ? { signal: ctl.signal } : undefined);
    var txt = await r.text(), j = JSON.parse(txt);
    if (!ST || UI.snap) await Promise.race([AVS.ready, new Promise(ok => setTimeout(ok, 400))]);   // ri1105-P1: first paint picks the small avatars
  } catch (e) {
    if (ctl && ctl.byUs) return "abort";   // ri1105-P5: cancelled by a normal poll / the page coming back, not a miss
    bootDone();
    UI.down = true; UI.fail = (UI.fail || 0) + 1;   // t-sync-pill: one miss can be a blip; syncPaint turns the pill red after 2 misses + 10 s
    syncPaint();
    return "fail";
  }
  // a rendering bug must not masquerade as the server being down
  try {
    const back = UI.down; UI.down = false;  // clear the "unreachable" banner as soon as the server answers again
    if (back) { try { document.dispatchEvent(new CustomEvent("rt-reconnect")); } catch (_) { } }   /* t-iter-upgrade: the server came back (a restart, an update); status.js checks the page version at once */
    UI.fail = 0; UI.lastOk = Date.now(); if (j.same && ST && ST.meta) { ST.meta.inbox_unacked = j.meta.inbox_unacked; syncPaint(); }   // a full state repaints via renderHeader
    if (j.same) { ST.meta.inbox_unacked = j.meta.inbox_unacked; ST.meta.avv = j.meta.avv; avvSeen(j.meta.avv); if (j.meta.hires) ST.meta.hires = j.meta.hires;   /* t-hire-celebration (welcome.js) */ if (back || wait || ++UI.tick % 12 === 0) renderChrome(); return "same"; }   // ri1105-P5: a long-poll "same" is ~25 s apart, so the chrome refreshes on each
    const wasSnap = UI.snap; UI.snap = 0;
    histSet(j); ST = j; REV = j.meta.rev; rehydrate(); archMerge(); try { doneMailRead(); } catch (_) { } renderAfterMotion(); bootDone(); avsCheck(); avvSeen(j.meta.avv);   // t-avatar-live-refresh
    if (wasSnap) syncPaint();
    snapSave(txt);
    return "full";
  } catch (e) {
    console.error("render failed", e);
    if (!poll.warned) { poll.warned = true; toast((UI.lang === "en" ? "Display error: " : "界面出错：") + e.message, true); }
    return "full";
  }
}

export { UI, ST, REV, idleDoing, busy, snzReplied, snzEnd, snoozed, onYouCard, onYou, schedItem, standing, queueOf, qBadge, grpOf, pauseL, idleL, ballOnYou, items, waitSince, waitMs, byAct, byCreated, FULL, FULLP, rehydrate, fullItem, ARCH, archIx, archKnown, archTitle, archFlag, archMerge, archItem, archAll, bootDone, SNAP, snapDb, snapSave, snapLoad, snapBoot, HIST, trimOf, chatBase, histSet, olderN, chatOlder, histAll, IXdirty, mailUnread, unreadM, mailAll, mailOlder, logsFor, LP, lpAbort, lpLoop, poll, pollOnce };
