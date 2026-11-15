// Dashboard view: the mailbox (drop-down panel under the header and the full 信箱 page rows), log rows, and the unread / new-reply counts (homeCounts, newReplies, chatMailRead ...).
// t-oss-struct S10 (A7): moved out of app.js unchanged; a wire*() function, if any, holds the top-level event wiring and app.js calls it where
// the code used to run, so listeners register in the same order as before.

import { $ } from "../core/util.js";
import { agoH, rowLabel, srvT, stageLabel, t, whenH, whoName } from "../core/i18n.js";
import { ST, UI, archIx, archTitle, busy, grpOf, items, mailAll, mailOlder, mailUnread, onYou, onYouCard, snoozed } from "../core/store.js";
import { agent, aname, av } from "../core/av.js";
import { api, postAct, utEmpty } from "../core/ui.js";
import { go } from "../core/router.js";
import { chatList } from "./chat.js";
import { MOBQ, actRow } from "./pages/common.js";
import { RV, askGuard, awaitsUser } from "./pages/review.js";
import { workersOf } from "../app.js";
function mailGroups(list) {   // newest first in, newest first out; entries of one item (or one agent's direct replies) fold into one row
  const gs = [], by = {};
  for (const m of list) {
    const k = m.item ? "i:" + m.item : "a:" + (m.agent || "");
    if (!by[k]) { by[k] = { last: m, ms: [] }; gs.push(by[k]); }
    by[k].ms.push(m);
  }
  return gs;
}
// t-web-audit 07: previews are plain text: no markdown marks, no "管家:" prefix (the sender is already on the row)
// t-chat-table: in a one-line preview a Markdown table becomes 「〔表格〕a b · c d …」 (the header row and |---| line are dropped)
function tablePv(s) {
  const L = String(s || "").split("\n"), out = []; let i = 0;
  const isRow = l => /^\s*\|.*\|?\s*$/.test(l) && (l.match(/\|/g) || []).length >= 2, isSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  while (i < L.length) {
    if (isRow(L[i]) && i + 1 < L.length && isSep(L[i + 1])) {
      const rows = []; i += 2;
      while (i < L.length && isRow(L[i])) { rows.push(L[i].trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim()).filter(Boolean).join(" ")); i++; }
      out.push((UI.lang === "en" ? "[table] " : "〔表格〕") + rows.join(" · "));
    } else out.push(L[i++]);
  }
  return out.join("\n");
}
function mailPv(s, a) {   // t-chat-table: phones use it too now (mail rows + 动态 rows)
  s = tablePv(srvT(s)).replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1").replace(/`([^`]+)`/g, "$1")
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+)/gm, "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();   /* t-ri1108-a P1: a cut-off bold leaves a lone ** */
  for (const n of ["管家", "manager", a && aname(a), a && a.id].filter(Boolean)) {
    const re = new RegExp("^" + n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*[:：]\\s*");
    if (re.test(s)) { s = s.replace(re, ""); break; }
  }
  return s;
}
// t-web-audit 11: runs of manager heartbeats fold into one dim row; bare "agent <id>" lines are hidden
/* t-ui-fix-r2 audit P2-5: the zh log showed raw action words (reply on t-…, upsert t-… [doing] …, mail_read). Display-time only; stored text is unchanged. */
const LOG_ZH = [[/^reply on \S+$/, () => "在卡上回复"], [/^upsert \S+ \[(\w+)\] (.*)$/, m => `更新卡片 · ${stageLabel(m[1])} · ${m[2]}`], [/^mail_read$/, () => "读了信"],
  [/^answer \S+$/, () => "回答了问题"], [/^approve \S+$/, () => "批准"], [/^comment \S+$/, () => "评论"], [/^ask \w+: (.*)$/, m => `提问：${m[1]}`], [/^ask-close \w+$/, () => "问题已关闭"],
  [/^lesson$/, () => "规则提议"], [/^chat$/, () => "发消息"], [/^done \S+$/, () => "关单"], [/^dm$/, () => "私信"]];
function logText(s) { s = String(s ?? ""); if (UI.lang === "en") return srvT(s); for (const [re, fn] of LOG_ZH) { const m = re.exec(s); if (m) return fn(m); } return s; }
function logRows(list) {
  if (!UI.logAgent) list = list.filter(l => l.text !== "mail_read");   /* t-ui-fix-r2 audit P2-5: 全部 hides the ~half of rows that were 「我 · mail_read」; the 我 filter still lists them */
  if (MOBQ.matches) return list.map(l => ({ l }));   // desktop only for now
  const HB = /^(Online: watching the inbox|在线：盯收件箱)/, AID = /^agent [0-9a-f]{12,}$/, out = [];
  for (const l of list) {
    const x = l.text || ""; if (AID.test(x)) continue;
    if (HB.test(x)) { const p = out[out.length - 1]; if (p && p.hb && p.l.agent === l.agent) { p.n++; continue; } out.push({ l, hb: true, n: 1 }); }
    else out.push({ l });
  }
  return out;
}
/* t-ri1104-p4: a 「待审核: <title>」 mail only repeats line 1 (the title) and goes stale once the card moves on.
   Phone 动态 rows of such mail show the card's latest thread line instead (who said it + text, max 60 chars).
   Generic 验收 / 完成 stamps and stage events are skipped; with no line left: 已关单 / 等你验收 / the stage label. Display only. */
const REV_MAIL = /^待审核\s*[:：]/;
function cardLine(it, rowA) {   /* t-ri1108-a P1: rowA = the row's own speaker; no name prefix when it is the same person */
  const en = UI.lang === "en", th = (it.thread || []).filter(x => x.kind !== "event" && x.kind !== "approve" && x.kind !== "done" && String(x.text || "").trim());
  const x = th[th.length - 1];
  if (!x) return it.stage === "done" ? (en ? "Closed" : "已关单") : it.stage === "review" ? (en ? "Waiting for your review" : "等你验收") : stageLabel(it.stage);
  const who = x.who === "me" ? (en ? "You" : "你") : x.who ? aname(agent(x.who)) : "";
  let s = mailPv(x.kind && x.kind !== "msg" ? srvT(x.text, true) : x.text, x.who && x.who !== "me" ? agent(x.who) : null);   /* t-i18n-b: 驳回 · … lines */
  if ([...s].length > 60) s = [...s].slice(0, 60).join("") + "…";
  return who && !(rowA && x.who === rowA.id) ? who + (en ? ": " : "：") + s : s;
}
/* t-ri1114-a P1: a manager 「日报 · <date>」 update names a report; same match as server.py _mail_target (push taps) */
function mailRep(m) {
  if (!m || m.item || m.agent !== "manager" || m.kind !== "update") return null;
  const r = (ST.reports || []).find(x => `${x.title} · ${x.date}` === m.text); return r ? r.id : null;
}
function mailRow(g) {
  const m = g.last, it = m.item ? ST.items.find(i => i.id === m.item) : null, a = m.agent ? agent(m.agent) : null;
  const unread = g.ms.some(x => !x.read);
  return actRow({ attr: `data-mail="${m.id}" data-mailids="${g.ms.map(x => x.id).join(",")}"`, av: a ? av(a, "", m.item) : av("me"), ws: it ? workersOf(it.id) : [], unread,
    name: a ? aname(a) : whoName("me"), title: it ? it.title : archTitle(m.item), time: agoH(m.t), preview: REV_MAIL.test(m.text || "") && it ? cardLine(it, a) : mailPv(m.text, a),
    chip: it ? rowLabel(it) : (m.kind === "reply" ? t("replies") : t("updates")), n: g.ms.length });
}
// ---------- ui1-C: mailbox = drop-down panel under the header (the full page stays reachable via "view all") ----------
function mailFiltered(n) {
  const f = UI.mailFilter;
  const L = mailAll().filter(m => f === "all" || (f === "unread" ? !m.read : f === "urgent" ? (m.item && (ST.items.find(i => i.id === m.item) || {}).category === "urgent") : m.kind === f));
  if (L.length < n && f !== "unread") mailOlder();   /* ri1105-P4: a filter that runs short fetches the older read letters once */
  return L.slice(-n).reverse();
}
const MB = { ct: null, open: false };
function mailboxEls() {
  let box = $("#mailbox"), sc = $("#mailscrim");
  if (!box) {
    sc = document.createElement("div"); sc.id = "mailscrim"; sc.hidden = true; sc.addEventListener("click", () => closeMailbox());
    box = document.createElement("div"); box.id = "mailbox"; box.hidden = true; box.setAttribute("role", "dialog");
    document.body.append(sc, box);
  }
  return { box, sc };
}
/* t-ri1114-a P2: in the drop-down, letters next to each other from one card and one person are one row (newest first).
   A 「待审核: 卡名」 letter only repeats the title: the row is labelled 待审核 and shows the reply text instead. Letters without a card stay one per row. */
function mbGroups(list) {
  const gs = [];
  for (const m of list) {
    const g = gs[gs.length - 1];
    if (g && m.item && g.last.item === m.item && g.last.agent === m.agent) g.ms.push(m); else gs.push({ last: m, ms: [m] });
  }
  for (const g of gs) { g.rv = g.ms.some(x => REV_MAIL.test(x.text || "")); g.body = g.ms.find(x => !REV_MAIL.test(x.text || "")) || g.last; }
  return gs;
}
function renderMailbox(enter) {
  if (!MB.open) return;
  const { box } = mailboxEls(), f = UI.mailFilter;
  const unread = mailUnread();
  const fs = [["all", t("all")], ["unread", t("unread")], ["reply", t("replies")], ["update", t("updates")], ["urgent", t("urgent")]];
  const kindName = { reply: t("replies"), update: t("updates") };
  const list = mbGroups(mailFiltered(40)), en = UI.lang === "en";
  const keep = $(".mb-list", box) ? $(".mb-list", box).scrollTop : 0;
  box.innerHTML = `<div class="mb-h"><div class="mb-t"><b>${t("mail")}</b><span>${UI.lang === "en" ? `${unread} unread` : `${unread} 条未读`}</span></div><button class="btn-s" data-mailall>${t("mark_all")}</button></div>
    <div class="mb-f"><div class="seg" data-seg="mailbox">${fs.map(([k, n]) => `<button class="seg-i ${f === k ? "on" : ""}" data-mailf="${k}">${n}</button>`).join("")}</div></div>
    <div class="mb-list ${enter ? "mb-enter" : ""}">${list.length ? list.map((g, i) => { const m = g.body, rv = g.rv, n = g.ms.length;
      return `<div class="mb-i ${g.ms.some(x => !x.read) ? "unread" : ""}" data-mail="${g.last.id}"${n > 1 ? ` data-mailids="${g.ms.map(x => x.id).join(",")}"` : ""} style="--i:${Math.min(i, 8)}">
      ${m.agent ? av(agent(m.agent), "sm") : "<span class=\"av sm\"></span>"}<div class="mb-b"><div class="mb-m"><b>${m.agent ? esc(aname(agent(m.agent))) : ""}</b>${rv ? `<i class="ri14-rv">${en ? "Review" : "待审核"}</i>` : kindName[m.kind] ? `<i>${esc(kindName[m.kind])}</i>` : ""}<span>${whenH(g.last.t)}${n > 1 ? (en ? ` · ${n}` : ` · ${n} 条`) : ""}</span></div><div class="mb-x">${esc(mailPv(m.text, m.agent && agent(m.agent)))}</div></div><span class="u"></span></div>`; }).join("") : utEmpty(t("empty"))}</div>
    <button class="mb-all" data-mbfull>${UI.lang === "en" ? "View all" : "查看全部"} →</button>`;
  $(".mb-list", box).scrollTop = keep;
  if (enter) setTimeout(() => { const l = $(".mb-list", box); l && l.classList.remove("mb-enter"); }, 700);
}
function openMailbox() {
  const { box, sc } = mailboxEls(); clearTimeout(MB.ct);
  const b = $('[data-h="mail"]'), r = b ? b.getBoundingClientRect() : { bottom: 56 };
  const hb = $("#top").getBoundingClientRect().bottom;
  document.documentElement.style.setProperty("--mb-top", Math.round(Math.max(hb, 0)) + "px");
  MB.open = true; box.hidden = false; sc.hidden = false; renderMailbox(true);
  void box.offsetWidth; box.classList.add("open"); sc.classList.add("open"); document.body.classList.add("mailopen");
}
function closeMailbox() {
  if (!MB.open) return; MB.open = false;
  const { box, sc } = mailboxEls(); box.classList.remove("open"); sc.classList.remove("open"); document.body.classList.remove("mailopen");
  clearTimeout(MB.ct); MB.ct = setTimeout(() => { if (MB.open) return; box.hidden = true; sc.hidden = true; box.innerHTML = ""; }, 200);
}

// t-office-d1-s12: the four numbers of the home strip (they also drive the list filter UI.hf on phones)
/* ri1107-P3: 近 7 天交付 = done cards closed since 00:00 six days ago (7 calendar days incl. today), the same as the widget home's bar chart */
function wkFrom() { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 6); return d.getTime(); }
function homeCounts() {   // t-imp-p1: review = 等你拍板 (review items + plans / questions parked in waiting)
  const its = items(), wk = wkFrom(), rev = its.filter(i => onYouCard(i) && i.id !== RV.pending);
  return { review: rev.length + its.filter(i => awaitsUser(i) && !busy(i) && !snoozed(i)).length + newReplies().length, doing: its.filter(i => grpOf(i) === "doing").length, todo: its.filter(i => grpOf(i) === "todo").length,
    week: its.filter(i => i.stage === "done" && i.closed && new Date(i.closed) > wk).length, oldest: rev.length ? Math.min(...rev.map(i => new Date(i.activity || i.updated))) : null };
}
// ===== t-home-newreplies: 「新回复」 = the server's reply mail (kind "reply", written for every msg / reply an agent posts on a card; log lines and events
// are not mailed) that is still unread, grouped by card. Read flags live on the server (mail_read), so phone and desktop agree.
// Opening a card marks its replies read; the first unread reply is where the detail opens.
// t-review-unread: no 3-day window any more (a reply counts until it is read), and a card already listed as on you (review row / decision row)
// or done / archived / snoozed / held for approve-undo is left out, so no card shows twice. These cards are added to every 等你拍板 count
// (homeCounts, counts, mobile tab dot, server pending_count): the count and what you can see stay the same.
const nrMail = id => (ST.mail || []).filter(m => m.kind === "reply" && !m.read && m.item && m.item !== "None" && (!id || m.item === id));
const nrCard = it => !!it && !it.archived && it.stage !== "done" && !snoozed(it) && !onYou(it) && it.id !== RV.pending;
function newReplies() {
  const by = {}; nrMail().forEach(m => { const it = (ST.items || []).find(i => i.id === m.item); if (nrCard(it)) (by[m.item] = by[m.item] || { it, ms: [] }).ms.push(m); });
  return Object.values(by).map(g => (g.ms.sort((a, b) => a.t.localeCompare(b.t)), g)).sort((a, b) => b.ms[b.ms.length - 1].t.localeCompare(a.ms[a.ms.length - 1].t));
}
const nrDot = id => nrMail(id).length ? `<i class="nr-dot" title="${UI.lang === "en" ? "New reply" : "有新回复"}"></i>` : "";
/* t-ri1108-a P1: was "drop any 1-8 char prefix before a colon, keep the first sentence": that ate 「我的建议：」-style openings and kept **.
   mailPv strips Markdown and only a real speaker prefix; the row clamps the rest. */
const nrFirst = (t, a) => mailPv(t, a);
function nrBlock() {
  const g = newReplies(); if (!g.length) return "";
  const zh = UI.lang !== "en", n = g.length, shown = g.slice(0, 4);   // t-review-unread: n = cards, the same unit as the badges
  return `<div class="nr"><div class="nr-h"><b>${zh ? "新回复" : "New replies"}</b><small>${n}</small><span class="sp"></span><button class="nr-all" data-nr-all>${zh ? "全部标为已读" : "Mark all read"}</button></div>` +
    shown.map(({ it, ms }) => { const m = ms[ms.length - 1], a = agent(m.agent);
      return `<div class="nr-r" role="link" tabindex="0" data-nr="${esc(it.id)}">${av(a)}${ms.length > 1 ? `<span class="nr-n">${ms.length}</span>` : ""}<b>${esc(aname(a))} <i>· ${esc(it.title)}</i></b><time>${agoH(m.t)}</time><p>${esc(nrFirst(m.text, a))}</p><i class="nr-dot"></i></div>`; }).join("") +
    (g.length > shown.length ? `<button class="nr-more" data-h="mail">${zh ? `还有 ${g.length - shown.length} 张卡有新回复 · 去信箱` : `${g.length - shown.length} more cards · open mailbox`}</button>` : "") + `</div>`;
}
// r-improve-1102 P3: read marks shared through the server. A chat / DM message is mirrored into the mailbox (kind reply, no card); reading the thread
// on any device marks those mails read, and a thread counts as read up to the newest mirrored mail that is read. Opening a card reads all of its
// mail, and mail of a closed card is read once seen here (only mail_read, which already existed: no server change).
const chatMail = id => (ST.mail || []).filter(m => m.kind === "reply" && (!m.item || m.item === "None") && m.agent === id);
/* t-ri1113-a P1: the mailbox copies slide out of the poll window (300 letters) and out of the 1500 kept, so the server also keeps how far each
   chat was read (meta.chat_seen, only ever moves forward). Opening a thread reports it (chatMailRead below); a fresh browser starts from there. */
const chatSeenSrv = id => (((ST.meta || {}).chat_seen) || {})[id] || "";
const srvSeen = id => chatMail(id).reduce((t, m) => m.read && m.t > t ? m.t : t, chatSeenSrv(id));
const seenOf = id => { const a = (UI.seen || {})["chat." + id] || "", b = srvSeen(id); return a > b ? a : b; };
/* t-ri1104-p2: the one unread rule for every dot and number (chat roster, TEAM rows, phone list + tab bar, office): messages from them newer than what you have read, server read marks included */
const unreadOf = id => { const s = seenOf(id); return chatList(id).filter(m => m.who !== "me" && m.t > s).length; };
const unreadTag = n => n > 99 ? "99+" : String(n);
function chatMailRead(id, upto) {
  const ids = chatMail(id).filter(m => !m.read && m.t <= upto).map(m => m.id); if (ids.length) nrRead(ids);
  if (upto && ST.meta && upto > chatSeenSrv(id)) { (ST.meta.chat_seen = ST.meta.chat_seen || {})[id] = upto; postAct("chat_seen", { agent: id, t: upto }).catch(() => { }); }   /* t-ri1113-a P1: local first, the next poll brings the server copy; postAct = no error toast, no extra poll */
}
function itemMailRead(id) { const ids = (ST.mail || []).filter(m => !m.read && m.item === id).map(m => m.id); if (ids.length) nrRead(ids); }
function doneMailRead() {
  const done = new Set((ST.items || []).filter(i => i.stage === "done" || i.archived).map(i => i.id)); archIx().forEach(x => done.add(x[0]));   // t-perf A
  const ids = (ST.mail || []).filter(m => !m.read && m.item && done.has(m.item)).map(m => m.id); if (ids.length) nrRead(ids);
}
function nrRead(ids) { if (!ids.length) return; let k = 0; (ST.mail || []).forEach(m => { if (ids.includes(m.id)) { if (!m.read) k++; m.read = true; } }); if (k && ST.meta && ST.meta.mail_unread != null) ST.meta.mail_unread = Math.max(0, ST.meta.mail_unread - k); api("mail_read", { ids }).catch(() => { }); }   /* ri1105-P4: the pill count drops at once too */

function wireMail() {
  document.addEventListener("click", e => {
    const a = e.target.closest("[data-arch]"); if (a) { e.stopPropagation(); api("archive", { item: a.dataset.arch }); }
    const d = e.target.closest("[data-quickdone]"); if (d) { e.stopPropagation(); const qid = d.dataset.quickdone; askGuard(qid, "done", skip => api("done", { item: qid, skip_asks: skip || undefined })); }
  });
}

function wireMail2() {
  /* t-ui-fix-r2 B11: any modal (系统状态, 关单, role files, voice…) closes the mailbox drop-down first, so they never stack and one Esc is enough */
  { const mo = document.getElementById("modal"); if (mo) new MutationObserver(() => { if (!mo.hidden && MB.open) closeMailbox(); }).observe(mo, { attributes: true, attributeFilter: ["hidden"] }); }
  document.addEventListener("click", e => {
    if (e.target.closest("[data-mbfull]")) { closeMailbox(); go("mail"); return; }
    if (MB.open && e.target.closest("#mailbox [data-mail]")) setTimeout(closeMailbox, 0);
  });
}

export { mailGroups, tablePv, mailPv, LOG_ZH, logText, logRows, REV_MAIL, cardLine, mailRep, mailRow, mailFiltered, MB, mailboxEls, mbGroups, renderMailbox, openMailbox, closeMailbox, wkFrom, homeCounts, nrMail, nrCard, newReplies, nrDot, nrFirst, nrBlock, chatMail, chatSeenSrv, srvSeen, seenOf, unreadOf, unreadTag, chatMailRead, itemMailRead, doneMailRead, nrRead, wireMail, wireMail2 };
