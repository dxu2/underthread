// Dashboard page 首页 / review: review cards, asks and their chips, quick approve with undo, groups, decisions, today / now / ship blocks.
// t-oss-struct S10 (A5): moved out of app.js unchanged; a wire*() function, if any, holds the top-level event wiring and app.js calls it where
// the code used to run, so listeners register in the same order as before.

import { $, LS } from "../../core/util.js";
import { agoH, dayKey, hm, rowLabel, t, when, whenH } from "../../core/i18n.js";
import { ST, UI, byAct, items, onYou, onYouCard, poll, snoozed, waitMs, waitSince } from "../../core/store.js";
import { agent, agents, aname, av, avatarUrl } from "../../core/av.js";
import { api, closeModal, openModal, postAct, toast } from "../../core/ui.js";
import { DW, jumpState, openItem, renderDrawer } from "../drawer.js";
import { mailPv, nrDot, sumPv } from "../mail.js";
import { actRow } from "./common.js";
import { renderPage } from "./index.js";
import { MGR_ON, dcDur, liveItem, mgrOnline, workersOf } from "../../app.js";
function reviewRow(it, fresh) {
  const a = agent(it.owner), th = (it.thread || []).filter(x => x.kind !== "event").length;
  return actRow({ attr: `data-item="${it.id}"`, av: av(a, "", it.id), ws: workersOf(it.id), unread: fresh, name: aname(a), title: it.title, time: agoH(it.activity || it.updated),
    preview: sumPv(it.summary || ""), chip: rowLabel(it), n: th, extra: waitTag(it) });
}
// ===== P5 (t-aes-p5): phone home 待审 = a review card per item: first image on top, owner + time, title, summary, 看详情 / 批准.
// 批准 only where the detail page has it (stage review AND kind plan / deliverable); questions and other kinds get 看详情 only.
// A tap on 批准 is held for RV_HOLD ms behind an undo pill before the same POST /api/action {kind:"approve"} the detail page sends.
const RV = { pending: null, timer: 0 }, RV_HOLD = 4500;
const rvCanApprove = it => !!it && it.stage === "review" && (it.kind === "plan" || it.kind === "deliverable");
function reviewCard(it, fresh) {
  const a = agent(it.owner), zh = UI.lang !== "en";
  const img = (it.draft_attachments && it.draft_attachments.length ? it.draft_attachments : it.attachments || []).find(p => /^(uploads|work)\/.+\.(png|jpe?g|webp|gif)$/i.test(p));
  const kind = it.kind === "plan" ? (zh ? "方案" : "Plan") : it.kind === "question" ? (zh ? "问题" : "Question") : (zh ? "交付" : "Delivery");
  const u = img && "/" + img.split("/").map(encodeURIComponent).join("/");
  const media = img ? `<div class="rv-media"><img src="/api/thumb?p=${encodeURIComponent(img)}&w=780" alt="" loading="lazy" onerror="if(!this.dataset.f){this.dataset.f=1;this.src='${u}'}else{this.parentNode.remove()}"><span class="rv-kind">${kind}</span></div>` : "";
  const ok = rvCanApprove(it);
  return `<div class="rv-card${img ? "" : " no-img"}" data-item="${it.id}">${media}<div class="rv-body">
    <div class="rv-meta">${av(a, "sm", it.id)}<b>${esc(aname(a))}</b>${fresh ? `<i class="rv-dot"></i>` : ""}<span>· ${t(it.category)} · ${agoH(it.activity || it.updated)}</span>${waitTag(it)}${img ? "" : `<span class="rv-kind sm">${kind}</span>`}</div>
    <h3>${nrDot(it.id)}${window.Onboard ? Onboard.exT(it) : esc(it.title)}</h3>${it.summary ? `<p>${esc(mailPv(it.summary))}</p>` : ""}${askRow(it)}
    <div class="rv-acts${ok ? "" : " one"}"><button class="rv-open" data-rv-open="${it.id}">${zh ? "看详情" : "Open"}</button>${ok ? `<button class="rv-ok${openAsks(it).length ? " has-ask" : ""}" data-rv-ok="${it.id}">${okBtnIn(it)}</button>` : ""}</div>
  </div></div>`;
}
// ===== t-imp-p1: 等你拍板 = review items + waiting items whose open draft is a plan or a question (the owner is waiting on the user).
// Shown as compact rows under the review cards; when nothing is waiting on review, the page shows 此刻 (who is working on what) and 今天交付.
const awaitsUser = it => !!it && it.stage === "waiting" && (it.kind === "plan" || it.kind === "question");
// t-wait-days: a card on the user (review, or waiting on a plan / question) for more than 24 h gets an amber 「等了 N 天」 tag (same idea as 暂停).
// The wait starts at the last 提交审核 event in the thread; no such event -> it.updated.
/* r-improve-1119 P1: waitSince now lives in core/store.js (shared with widgets, ticker and the phone hero) */
function waitTag(it) { return snzWas(it) + waitTag0(it); }
const snzWas = it => it && it.snoozed && !snoozed(it) ? `<span class="snz-was" title="${UI.lang === "en" ? "Came back from Later" : "之前点过稍后，到点回来了"}">${UI.lang === "en" ? "Snoozed" : "推迟过"}</span>` : "";   // ri1103-P2
function waitTag0(it) {
  if (!it || !(it.stage === "review" || awaitsUser(it))) return "";
  const h = waitMs(it) / 36e5; if (!(h >= 24)) return "";
  const d = Math.floor(h / 24); return `<span class="wait-d">${UI.lang === "en" ? `Waiting ${d}d` : `等了 ${d} 天`}</span>`;
}
// ===== t-open-questions: it.asks = questions for the user with clickable options (stateutil ask / upsert-item --ask). An older server sends no asks: nothing shows. =====
const liveAsks = it => ((it && it.asks) || []).filter(a => !a.closed);
const openAsks = it => liveAsks(it).filter(a => !a.answer);
// t-btn-names: the approve button is named by what happens after the press (plan -> back to doing, the specialist goes on;
// deliverable -> the card closes; question -> the answer is recorded). Only labels: the action kinds (approve / done) are unchanged.
/* t-hr-build: an HR interview card's draft is approved with 批准入职 (the server runs new_role.py) */
const isHire = it => !!(it && it.hire && it.kind === "deliverable");
/* t-ht-build: a transfer card (hire.mode transfer) says 批准调岗 */
const isXfer = it => isHire(it) && it.hire.mode === "transfer";
const okLabel = (it, en = UI.lang === "en") => isXfer(it) ? (en ? "Approve transfer" : "批准调岗") : isHire(it) ? (en ? "Approve hire" : "批准入职") : it && it.kind === "plan" ? (en ? "Approve & start" : "批准开工") : it && it.kind === "question" ? (en ? "Answer" : "回答") : (en ? "Accept & close" : "验收 · 关单");
const okDone = (it, en = UI.lang === "en") => isXfer(it) ? (en ? "Approved · transferring" : "已批准 · 正在调岗") : isHire(it) ? (en ? "Approved · onboarding" : "已批准 · 正在办入职") : it && it.kind === "plan" ? (en ? "Approved · work begins" : "已批准开工 · 专员接着做") : it && it.kind === "question" ? (en ? "Answered" : "已回答") : (en ? "Accepted · card closed" : "已验收 · 卡已关");
const askLeft = (it, en = UI.lang === "en") => { const n = openAsks(it).length; return !n ? "" : en ? `${n} question${n > 1 ? "s" : ""} unanswered` : `还有 ${n} 个问题没答`; };
// ===== t-ask-rec: the asker's recommended option = ask.rec (written as "B*" in stateutil), else an option whose text says （推荐） (older asks).
// 「全按推荐」 shows when 2+ asks are open and at least one has a recommendation; it answers those after a 4.5 s undo hold, one ordinary answer each.
const REC_TXT = /[（(]\s*推荐/;
const recOf = a => (a && a.rec && a.options.includes(a.rec)) ? a.rec : ((a && a.options) || []).find(o => REC_TXT.test(o)) || null;
// t-opt-star: chat quick-reply chips. "B*" marks the manager's recommendation (same convention as --ask): the * is never shown or sent;
// the starred chip gets the 推荐 outline + badge. An option whose text already says （推荐） gets the outline only.
const optChips = (opts, mid, multi) => { const clean = o => String(o).replace(/\s*[*＊]\s*$/, ""); const star = opts.find(o => /[*＊]\s*$/.test(o)); const rec = star || opts.find(o => REC_TXT.test(o)) || null;
  const sel = multi && mid ? MSEL.get(mid) : null;   // t-hr-multiselect: --multi chips toggle; picks live in MSEL so a poll re-render keeps them lit
  return `<div class="opts${multi ? " opts-multi" : ""}">${opts.map(o => { const c = clean(o), r = o === rec, on = sel && sel.has(c); return `<button class="btn-s${r ? " rec" : ""}${on ? " on" : ""}" ${multi ? `data-mopt` : `data-opt`}="${esc(c)}"${multi ? ` aria-pressed="${on ? "true" : "false"}"` : ""}${mid ? ` data-mid="${esc(mid)}"` : ""}>${esc(c)}${r && !REC_TXT.test(c) ? `<i class="rec-b">${UI.lang === "en" ? "Rec." : "推荐"}</i>` : ""}</button>`; }).join("")}${multi ? msendBtn(mid, sel ? sel.size : 0) : ""}</div>`; };
const MSEL = new Map();   // mid -> Set of picked option texts (client only, until 发送)
const msendBtn = (mid, n) => `<button class="btn-s msend" data-msend="${esc(mid || "")}"${n ? "" : " disabled"}>${UI.lang === "en" ? (n ? `Send (${n})` : "Pick one or more") : (n ? `发送（${n}）` : "可多选")}</button>`;
// r-improve-1102 P2: a card chip wrapped in full-width brackets 「（chip）」 already reads as a bracket; drop the pair so the line does not break three ways
const CHIP_RE = '<span class="idc[^"]*"[^>]*>(?:(?!<\\/span>)[\\s\\S])*<\\/span>';
const chipParens = h => String(h).replace(new RegExp(`（\\s*(${CHIP_RE})\\s*）`, "g"), " $1 ")
  .replace(new RegExp(`(${CHIP_RE})\\s*([。，、；：！？」』]+)`, "g"), '<span class="idc-nw">$1$2</span>');   // punctuation stays on the chip's line
const optDone = (opts, said, at) => {   // r-improve-1102 P1; t-option-quote: at = time of the quoting reply
  const norm = x => String(x || "").replace(/\s*[*＊]\s*$/, "").replace(/\s+/g, " ").trim(), s = norm(said), en = UI.lang === "en";
  const parts = s.split(/\s*[、，,]\s*/), many = opts.map(norm).filter(o => o && parts.includes(o));
  const hit = many.length > 1 ? many.join("、") : opts.map(norm).find(o => o && (s === o || s.startsWith(o)));
  return `<div class="opt-done">${hit ? (en ? `✓ You chose “${esc(hit)}”` : `✓ 你选了「${esc(hit)}」`) : (en ? "Replied" : "已回复")}${hit && at ? ` · ${whenH(at)}` : ""}</div>`;
};
const AR = { pending: null, timer: 0 };   // pending = { id, picks: [{ ask, opt }] }
const arPick = (id, askId) => { const p = AR.pending; return p && p.id === id ? (p.picks.find(x => x.ask === askId) || {}).opt : undefined; };
function arButton(it) {
  const oa = openAsks(it), n = oa.filter(a => recOf(a)).length, zh = UI.lang !== "en";
  if (oa.length < 2 || !n || it.stage === "done" || (AR.pending && AR.pending.id === it.id)) return "";
  return `<button type="button" class="ask-allrec" data-ask-allrec="${esc(it.id)}">${zh ? `全按推荐（${n}）` : `Use recommended (${n})`}</button>`;
}
function arCommit(keepalive) {
  const P = AR.pending; if (!P) return;
  clearTimeout(AR.timer); AR.pending = null; arHide();
  if (keepalive) { P.picks.forEach(x => { try { fetch("/api/action", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "answer", item: P.id, ask: x.ask, opt: x.opt }) }); } catch (e) { } }); return; }
  const zh = UI.lang !== "en";
  P.picks.reduce((q, x) => q.then(() => api("answer", { item: P.id, ask: x.ask, opt: x.opt })), Promise.resolve())
    .then(() => toast(zh ? `已按推荐答了 ${P.picks.length} 题` : `${P.picks.length} answered as recommended`))
    .catch(() => { if (UI.item === P.id) renderDrawer(); });
}
function arHide() { const b = document.getElementById("ar-undo"); if (b && !b.hidden) { b.classList.remove("on"); clearTimeout(b._h); b._h = setTimeout(() => { b.hidden = true; }, 260); } }
function arStart(id) {
  const it = ST.items.find(i => i.id === id); if (!it) return;
  if (AR.pending) arCommit(); if (GRP.pending) grpCommit();   /* t-ri1113-a P3: one hold at a time (they share #ar-undo) */
  const picks = openAsks(it).map(a => ({ ask: a.id, opt: recOf(a) })).filter(x => x.opt); if (!picks.length) return;
  AR.pending = { id, picks }; const zh = UI.lang !== "en";
  if (UI.item === id) renderDrawer();
  let b = document.getElementById("ar-undo");
  if (!b) { b = document.createElement("div"); b.id = "ar-undo"; b.setAttribute("role", "status"); b.hidden = true; document.body.appendChild(b); }
  b.innerHTML = `<span class="rv-u-tx"><b>${zh ? `按推荐答 ${picks.length} 题` : `${picks.length} answered as recommended`}</b>${zh ? "4.5 秒后发出" : "sending in 4.5 s"}</span><button type="button" data-ar-undo>${zh ? "撤销" : "Undo"}</button><i class="rv-u-bar" style="--hold:${RV_HOLD}ms"></i>`;
  clearTimeout(b._h); b.hidden = false; void b.offsetWidth; b.classList.add("on");
  clearTimeout(AR.timer); AR.timer = setTimeout(() => arCommit(), RV_HOLD);
}
function arUndo() { const P = AR.pending; if (!P) return; clearTimeout(AR.timer); AR.pending = null; arHide(); if (UI.item === P.id) renderDrawer(); }
/* ===== t-ri1113-a P3: the card sweep (twice a day) asks one and the same question on many cards. A card that is on you ONLY for one open ask
   (not in review) joins a group with every card whose ask has the very same text and options; GRP_MIN or more are drawn as one group row in
   等你拍板 (widget home + phone home). 「全部 X」 answers each card with the ordinary answer action after the same 4.5 s undo hold as 全按推荐;
   「逐张看」 expands the cards under the group row. Counts stay per card. Exact matches only, no fuzzy grouping. */
const GRP = { open: new Set(), pending: null, timer: 0 }, GRP_MIN = 3;
const grpAsk = it => { if (!it || it.stage === "review") return null; const oa = openAsks(it); return oa.length === 1 ? oa[0] : null; };
const grpId = a => { const k = a.q + "\u241f" + a.options.join("\u241e"); let h = 5381; for (let i = 0; i < k.length; i++) h = (h * 33 + k.charCodeAt(i)) >>> 0; return "g" + h.toString(36); };
function askGroups(list) {   // -> list order kept: { it } per card, or one { g: { id, a, items, open, pend } } where the group's first card was
  const by = new Map(); list.forEach(it => { const a = grpAsk(it); if (a) { const k = grpId(a); if (!by.has(k)) by.set(k, []); by.get(k).push(it); } });
  const out = [], put = new Set();
  list.forEach(it => { const a = grpAsk(it), k = a && grpId(a), m = k && by.get(k);
    if (!m || m.length < GRP_MIN) return out.push({ it });
    if (put.has(k)) return; put.add(k);
    out.push({ g: { id: k, a: grpAsk(m[0]), items: m, open: GRP.open.has(k), pend: GRP.pending && GRP.pending.id === k ? GRP.pending.opt : null } }); });
  return out;
}
function grpHTML(g, cls = "") {   // the group row; the caller adds the member cards under it when g.open
  const zh = UI.lang !== "en", n = g.items.length, a = g.a, rec = recOf(a), by = agent(a.by || g.items[0].owner);
  const opts = rec ? [rec].concat(a.options.filter(o => o !== rec)) : a.options, last = g.items.reduce((t, i) => (i.activity || i.updated) > t ? (i.activity || i.updated) : t, "");
  const acts = g.pend
    ? `<div class="ri13-pend" role="status">${zh ? `4.5 秒后 ${n} 张都答「${esc(g.pend)}」` : `Answering all ${n} “${esc(g.pend)}” in 4.5 s`}</div>`
    : opts.map(o => `<button type="button" class="ri13-o${o === rec ? " rec" : ""}" data-ri13-all="${g.id}" data-ri13-opt="${esc(o)}">${zh ? `全部${esc(o)}` : `All: ${esc(o)}`}${o === rec && !REC_TXT.test(o) ? `<i class="rec-b">${zh ? "推荐" : "Rec."}</i>` : ""}</button>`).join("");
  return `<div class="ri13-grp${cls ? " " + cls : ""}${g.open ? " open" : ""}${g.pend ? " pend" : ""}" data-ri13-g="${g.id}"><div class="ri13-hd"><span class="ri13-n">${n}</span><div class="ri13-t"><b>${esc(a.q)}</b><small>${zh ? `${n} 张卡同一个问题 · ${esc(aname(by))} · ${agoH(last)}` : `Same question on ${n} cards · ${esc(aname(by))} · ${agoH(last)}`}</small></div></div>`
    + `<div class="ri13-acts">${acts}<button type="button" class="ri13-x" data-ri13-open="${g.id}" aria-expanded="${g.open}">${g.open ? (zh ? "收起 ‹" : "Fold ‹") : (zh ? "逐张看 ›" : "One by one ›")}</button></div></div>`;
}
const grpFind = id => askGroups(items().filter(onYouCard)).map(e => e.g).find(g => g && g.id === id);
function grpStart(id, opt) {
  const g = grpFind(id); if (!g || !g.a.options.includes(opt)) return;
  if (AR.pending) arCommit(); if (GRP.pending) grpCommit();
  GRP.pending = { id, opt, picks: g.items.map(it => ({ item: it.id, ask: grpAsk(it).id })) };
  const zh = UI.lang !== "en", n = GRP.pending.picks.length;
  let b = document.getElementById("ar-undo");
  if (!b) { b = document.createElement("div"); b.id = "ar-undo"; b.setAttribute("role", "status"); b.hidden = true; document.body.appendChild(b); }
  b.innerHTML = `<span class="rv-u-tx"><b>${zh ? `${n} 张都答「${esc(opt)}」` : `${n} cards: “${esc(opt)}”`}</b>${zh ? "4.5 秒后发出" : "sending in 4.5 s"}</span><button type="button" data-ri13-undo>${zh ? "撤销" : "Undo"}</button><i class="rv-u-bar" style="--hold:${RV_HOLD}ms"></i>`;
  clearTimeout(b._h); b.hidden = false; void b.offsetWidth; b.classList.add("on");
  clearTimeout(GRP.timer); GRP.timer = setTimeout(() => grpCommit(), RV_HOLD);
  if (UI.page === "review") renderPage();
}
function grpCommit(keepalive) {
  const P = GRP.pending; if (!P) return;
  clearTimeout(GRP.timer); GRP.pending = null; arHide();
  const body = x => ({ kind: "answer", item: x.item, ask: x.ask, opt: P.opt });
  if (keepalive) { P.picks.forEach(x => { try { fetch("/api/action", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body(x)) }); } catch (e) { } }); return; }
  const zh = UI.lang !== "en";
  P.picks.reduce((q, x) => q.then(() => postAct("answer", body(x))), Promise.resolve())
    .then(() => toast(zh ? `已回答 ${P.picks.length} 张 · 都选了「${P.opt}」` : `${P.picks.length} cards answered “${P.opt}”`), e => toast(String(e.message || e), true))
    .then(() => poll(true)).catch(() => { });
}
function grpUndo() { if (!GRP.pending) return; clearTimeout(GRP.timer); GRP.pending = null; arHide(); if (UI.page === "review") renderPage(); }
// t-m-accept-btn: the detail dock's main button. Phones show the short label (the tail after it is hidden) and the open-question count as a badge;
// desktop keeps the full label and the line under it. Before, "Accept & close" + "1 question unanswered" wrapped and pushed out of a 390 px dock.
const okShort = (it, en = UI.lang === "en") => it && it.kind === "plan" ? (en ? "Approve & start" : "批准开工") :   /* t-oss-polish-1121 ④: the phone dock says 开工 too (a bare 批准 hid that nothing starts before it) */
   it && it.kind === "question" ? (en ? "Answer" : "回答") : (en ? "Accept" : "验收");
const okDockIn = (it, full, short) => { const l = askLeft(it), n = openAsks(it).length, tail = short && full.startsWith(short) ? full.slice(short.length) : "";
  return `<b><span class="ok-s">${esc(tail ? short : full)}</span>${tail ? `<span class="ok-x">${esc(tail)}</span>` : ""}</b>${n ? `<i class="ok-n" aria-hidden="true">${n}</i><small class="ok-ask">${l}</small>` : ""}`; };
const okAria = (it, full) => { const l = askLeft(it); return ` aria-label="${esc(full + (l ? (UI.lang === "en" ? ", " : "，") + l : ""))}"`; };
const okBtnIn = it => { const l = askLeft(it); return `<b>${okLabel(it)}</b>${l ? `<small class="ok-ask">${l}</small>` : ""}`; };   // label + the open-question line under it
function askChips(it, a, cls = "") {
  const done = it.stage === "done", zh = UI.lang !== "en";
  const rec = !a.answer && recOf(a), pend = arPick(it.id, a.id);   // t-ask-rec
  return `<div class="ask-opts${cls}">${a.options.map(o => `<button type="button" class="ask-o${(a.answer ? a.answer.opt === o : pend === o) ? " on" : ""}${rec === o ? " rec" : ""}" data-ask-opt="${esc(o)}" data-ask="${esc(a.id)}" data-ask-item="${esc(it.id)}"${done ? " disabled" : ""}>${esc(o)}${rec === o && !REC_TXT.test(o) ? `<i class="rec-b">${zh ? "推荐" : "Rec."}</i>` : ""}</button>`).join("")}${a.other !== false && !done ? `<button type="button" class="ask-o ghost" data-ask-other="${esc(a.id)}" data-ask-item="${esc(it.id)}">${zh ? "其他…" : "Other…"}</button>` : ""}</div>`;
}
function askCard(it, a, n) {
  const zh = UI.lang !== "en", by = aname(agent(a.by || it.owner));
  const ans = a.answer ? `<div class="ask-a">${zh ? `你选了「${esc(a.answer.opt)}」· ${when(a.answer.t)} · 已转给${esc(by)}${it.stage !== "done" ? " · 点别的选项可以改选" : ""}` : `You chose “${esc(a.answer.opt)}” · ${when(a.answer.t)} · sent to ${esc(by)}`}</div>` : "";
  return `<div class="ask${a.answer ? " done" : ""}" data-askq="${esc(a.id)}"><div class="ask-q"><span class="n">${a.answer ? "✓" : n}</span><span>${esc(a.q)}</span></div>${askChips(it, a)}${ans}</div>`;
}
function askBlock(it) {
  const all = liveAsks(it); if (!all.length) return "";
  const n = openAsks(it).length, zh = UI.lang !== "en"; let i = 0;
  const arb = arButton(it);   // t-ask-rec
  const head = `<div class="sec-h ask-h${n ? " on" : ""}"><i></i>${zh ? `要你拿主意 · ${n ? `还剩 ${n} 个` : "都答了"}` : `Your call · ${n ? `${n} open` : "all answered"}`}${arb}</div>${arb ? `<div class="ask-recnote">${zh ? "带「推荐」的是提问人给的建议。点「全按推荐」一次答完，再单独改不同意的几题。" : "Marked options are the asker's recommendation. Use them all at once, then change any you disagree with."}</div>` : ""}`;
  const list = `<div class="ask-list">${all.map(a => askCard(it, a, a.answer ? 0 : ++i)).join("")}</div>`;
  if (n) return head + list;
  // t-ui-next 1: every question answered -> one summary row (tap to expand and change a pick); the open state survives poll re-renders
  const open = DW.askOpen.has(it.id), picks = all.map(a => a.answer.opt).join(" · ");
  return `${head}<button type="button" class="uin-asum${open ? " open" : ""}" data-uin-asks aria-expanded="${open}"><b>${zh ? `${all.length} 个问题都答了` : `${all.length} answered`}</b><span class="p">${esc(picks)}</span><span class="t">${open ? (zh ? "收起 ▴" : "Hide ▴") : (zh ? "展开 ▾" : "Show ▾")}</span></button>${open ? list : ""}`;
}
function askRow(it, dock) {   // list cards: the first open question with its options, answerable in place (dock = the card's own question bar)
  const oa = openAsks(it); if (!oa.length) return "";
  const zh = UI.lang !== "en", a = oa[0], n = oa.length - 1;
  /* t-ri1114-a P4: list cards clamp the question to 2 lines (ri14-clamp) and 「+N」 is a button that opens the card at 「要你拿主意」 */
  const more = !n ? "" : dock ? `<span class="ask-more">+${n}</span>` : `<button type="button" class="ri14-more" data-askjump="${it.id}">${zh ? `还有 ${n} 题` : `${n} more`}<span aria-hidden="true">›</span></button>`;
  return `<div class="ask-row${dock ? "" : " ri14-clamp"}"><div class="ask-rt"><i></i><b>${zh ? `${oa.length} 个问题要你选` : `${oa.length} question${oa.length > 1 ? "s" : ""} for you`}</b><span><span class="ask-sep"> · </span>${esc(a.q)}</span></div>${askChips(it, a, " sm")}${more}</div>`;
}
/* t-ri1114-a P4: 「还有 N 题 ›」 on a list card opens the card scrolled to 「要你拿主意」 (same placing as seekItem) */
function askJump(id) {
  openItem(id); let tries = 0, set = -1;
  const place = () => {
    const sc = $("#drawer .dw-scroll"), h = sc && UI.item === id ? $(".ask-h", sc) : null; if (!h) return false;
    DW.pin = false; DW.jumpT = 0;
    sc.scrollTop = set = Math.max(0, sc.scrollTop + h.getBoundingClientRect().top - sc.getBoundingClientRect().top - 12); jumpState(); return true;
  };
  const go = () => { if (UI.item !== id) return;
    if (place()) [400, 1200].forEach(ms => setTimeout(() => { const sc = $("#drawer .dw-scroll"); if (sc && UI.item === id && Math.abs(sc.scrollTop - set) < 2) place(); }, ms));
    else if (++tries < 20) setTimeout(go, 150); };
  go();
}
// t-m-ask-sheet: the dock's question bar is one line (● n 个问题 · question ⌄) until tapped. A question shown here for the first time opens it;
// after that it stays as the user left it while the card is open (ab._open lives on the bar, which is rebuilt each time a card opens).
const ASK_CV = `<svg class="ask-cv" viewBox="0 0 12 8" width="12" height="8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 1.75 6 6.25l4.5-4.5"/></svg>`;
function askFold(ab, it) {
  const a = openAsks(it)[0]; if (!a) return;
  const seen = LS.get("askSeen", []);
  if (!seen.includes(a.id)) { seen.push(a.id); LS.set("askSeen", seen.slice(-200)); ab._open = true; }
  const open = !!ab._open, rt = $(".ask-rt", ab);
  ab.classList.toggle("fold", !open);
  if (rt) { rt.setAttribute("role", "button"); rt.tabIndex = 0; rt.setAttribute("aria-expanded", String(open)); rt.insertAdjacentHTML("beforeend", ASK_CV); }
}
function askFoldWire(ab) {
  const tg = e => { const rt = e.target.closest(".ask-rt"); if (!rt || (e.type === "keydown" && e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault(); ab._open = ab.classList.contains("fold"); ab.classList.toggle("fold", !ab._open); rt.setAttribute("aria-expanded", String(ab._open)); };
  ab.addEventListener("click", tg); ab.addEventListener("keydown", tg);
}
const AG = { draw: null };
// approve / done while questions are open: a sheet lists them (answerable in place); 跳过 sends skip_asks so the server lets it through and logs what was skipped
function askGuard(id, k, proceed) {
  const it = ST.items.find(i => i.id === id);
  if (!openAsks(it).length) return proceed(false);
  const zh = UI.lang !== "en", verb = k === "approve" ? (zh ? okLabel(it, false) : okLabel(it, true).toLowerCase()) : (zh ? "完成" : "mark done");
  const draw = m => {
    const cur = ST.items.find(i => i.id === id) || it, oa = openAsks(cur); let i = 0;
    m.innerHTML = oa.length
      ? `<h2>${zh ? `还有 ${oa.length} 个问题没回答` : `${oa.length} question${oa.length > 1 ? "s" : ""} still open`}</h2><p class="ask-gp">${zh ? `${esc(aname(agent(cur.owner)))}在这张单子里问了你。可以现在点选；也可以跳过直接${verb}，跳过的问题会记在动态里，管家会转成后续单子。` : `Answer here, or skip and ${verb}: skipped questions are logged and the manager follows up.`}</p>
         <div class="ask-list">${oa.map(a => askCard(cur, a, ++i)).join("")}</div>
         <div class="foot"><button class="btn" data-ag-skip>${zh ? `跳过，直接${verb}` : `Skip, ${verb}`}</button><button class="btn primary" data-ag-first>${zh ? "先回答" : "Answer first"}</button></div>`
      : `<h2>${zh ? "问题都回答了" : "All answered"}</h2><p class="ask-gp">${zh ? `可以${verb}了。` : `Ready to ${verb}.`}</p>
         <div class="foot"><button class="btn" data-ag-x>${zh ? "取消" : "Cancel"}</button><button class="btn primary" data-ag-go>${zh ? verb : "Go"}</button></div>`;
    const q = sel => m.querySelector(sel);
    if (q("[data-ag-skip]")) q("[data-ag-skip]").onclick = () => { closeModal(); proceed(true); };
    if (q("[data-ag-first]")) q("[data-ag-first]").onclick = () => { closeModal(); if (UI.item === id) { const l = $("#drawer .ask-list"); if (l) l.scrollIntoView({ behavior: "smooth", block: "center" }); } else openItem(id); };
    if (q("[data-ag-go]")) q("[data-ag-go]").onclick = () => { closeModal(); proceed(false); };
    if (q("[data-ag-x]")) q("[data-ag-x]").onclick = closeModal;
  };
  openModal("", m => { m.classList.add("ask-guard"); AG.draw = () => draw(m); draw(m); });
}
const decisions = () => items().filter(onYou).filter(awaitsUser).sort(byAct);
function decHead(nRev, dec) {
  const zh = UI.lang !== "en", np = dec.filter(i => i.kind === "plan").length, nq = dec.length - np;
  const parts = zh ? [`审核 ${nRev}`, np && `方案 ${np}`, nq && `问题 ${nq}`] : [`review ${nRev}`, np && `plans ${np}`, nq && `questions ${nq}`];
  return `<div class="dc-h">${zh ? "等你拍板" : "Waiting on you"}<small>${nRev + dec.length}</small><span class="r">${parts.filter(Boolean).join(" · ")}</span></div>`;
}
function decRow(it) {
  const a = agent(it.owner), zh = UI.lang !== "en", plan = it.kind === "plan";
  const what = plan ? (zh ? "方案待批" : "Plan to approve") : (zh ? "问题待答" : "Question for you");
  return `<div class="dc-row" data-item="${it.id}">${av(a, "", it.id)}<div class="dc-main"><div class="dc-t">${nrDot(it.id)}${window.Onboard ? Onboard.exT(it) : esc(it.title)}</div>
    <div class="dc-s">${what} · ${esc(aname(a))} · ${agoH(it.activity || it.updated)}${waitTag(it)}${openAsks(it).length ? ` · <b class="ask-n">${zh ? `${openAsks(it).length} 个问题要你选` : `${openAsks(it).length} to answer`}</b>` : ""}</div></div>
    <button class="dc-btn${plan ? "" : " g"}" data-rv-open="${it.id}">${plan ? (zh ? "看方案" : "Review") : (zh ? "去回答" : "Answer")}</button></div>`;
}
const DC_KIND = { plan: '<path d="M5 4h10l4 4v12H5z"/><path d="M9 12h6M9 16h4"/>', deliverable: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  question: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.4M12 16.8v.2"/>', task: '<rect x="5" y="5" width="14" height="14" rx="3"/><path d="M9 12h6"/>' };
// t-now-always: 此刻 is its own block, shown under the review cards on the phone-like home whether or not anything waits on you;
// 今天交付 still only shows when nothing waits (todayBlock = 此刻 + 今天交付).
function todayBlock() { return nowBlock() + shipBlock(); }
function nowBlock() {
  const zh = UI.lang !== "en";
  const all = agents().filter(a => a.enabled !== false && a.status === "working"), ws = all.filter(a => !mgrOnline(a)), on = all.filter(mgrOnline);
  const now = ws.map(a => {
    const it = liveItem(a);
    return `<div class="dc-row${it ? "" : " plain"}"${it ? ` data-item="${it.id}"` : ""}>${av(a, "", it && it.id)}<div class="dc-main">
      <div class="dc-t">${esc(aname(a))}${it ? ` · ${esc(it.title)}` : ""}</div>
      <div class="dc-s">${esc(a.activity || (zh ? "工作中" : "Working"))}${a.since ? ` · <time class="wk-el" data-fmt="dc" data-since="${esc(a.since)}">${dcDur(a.since)}</time>` : ""}</div>
      <i class="dc-bar" aria-hidden="true"><u style="animation-delay:-${Date.now() % 2400}ms"></u></i></div></div>`;
  }).join("") + (ws.length ? "" : `<div class="dc-quiet">${zh ? "都在休息" : "Everyone is resting"}</div>`) + on.map(a => `<div class="dc-row plain dc-on">${av({ ...a, status: "online" })}<div class="dc-main"><div class="dc-t">${esc(aname(a))}</div><div class="dc-s">${MGR_ON()}</div></div></div>`).join("")
;   // t-now-always: nobody working = one faint line (above the manager's online row, as before), not an empty box
  return `<div class="dc-h">${zh ? "此刻" : "Right now"}<small>${ws.length ? (zh ? `${ws.length} 人在做` : `${ws.length} working`) : ""}</small></div>${now}`;
}
function shipBlock() {
  const zh = UI.lang !== "en", its = items(), today = dayKey(new Date());
  const done = its.filter(i => i.stage === "done" && i.closed && dayKey(new Date(i.closed)) === today).sort((x, y) => (y.closed || "").localeCompare(x.closed || ""));
  // t-home-nopic (option C): a card with an image keeps its cover; a card without one has no cover and is drawn compact (kind icon + label + time + small
  // avatar, then a 2-line title). Pairing walks the newest-first list: two CONSECUTIVE no-image cards share one column (upper = newer); a no-image card whose
  // neighbour has an image stays alone in its own column, top-aligned. So the reading order (column by column, top then bottom) is exactly the time order.
  const ship = [];
  done.forEach(it => {
    const img = (it.draft_attachments && it.draft_attachments.length ? it.draft_attachments : it.attachments || []).find(p => /^(uploads|work)\/.+\.(png|jpe?g|webp|gif)$/i.test(p));
    const a = agent(it.owner);
    if (img) return ship.push(`<div class="dc-sh" data-item="${it.id}"><div class="im" style="background-image:url('/api/thumb?p=${encodeURIComponent(img)}&w=320')"></div><b>${esc(it.title)}</b><span>${esc(aname(a))} · ${hm(it.closed)}</span></div>`);
    const k = DC_KIND[it.kind] ? it.kind : "task";
    const card = `<div class="dc-sh c" data-item="${it.id}"><div class="k" title="${esc(t("k_" + k))} · ${hm(it.closed)}"><svg viewBox="0 0 24 24" aria-hidden="true">${DC_KIND[k]}</svg><span class="kl">${esc(t("k_" + k))}</span><span class="kt">· ${hm(it.closed)}</span>${a ? `<i class="mav" style="background-image:url('${avatarUrl(a)}')" title="${esc(aname(a))}"></i>` : ""}</div><b>${esc(it.title)}</b></div>`;
    const last = ship[ship.length - 1];
    if (last && last.open) { last.push(card); last.open = false; } else { const col = [card]; col.open = true; ship.push(col); }
  });
  const shipHtml = ship.map(c => Array.isArray(c) ? `<div class="dc-col${c.length < 2 ? " one" : ""}">${c.join("")}</div>` : c).join("");
  return `<div class="dc-h">${zh ? "今天交付" : "Shipped today"}<small>${done.length}</small></div>${done.length ? `<div class="dc-ship">${shipHtml}</div>` : `<div class="dc-none">${zh ? "今天还没有交付。" : "Nothing shipped yet today."}</div>`}`;
}
const rvEase = "cubic-bezier(.32, .72, 0, 1)";   // = --m-ease-ios (WAAPI cannot read the CSS variable)
const rvReduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
function rvCollapse(el, done) {   // card folds away: lift + fade, then the height closes so the cards below glide up
  if (!el || rvReduce()) { if (el) el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: "forwards" }).onfinish = done; else done(); return; }
  const h = el.offsetHeight, cs = getComputedStyle(el), mt = cs.marginTop, mb = cs.marginBottom;
  el.style.overflow = "hidden"; el.style.pointerEvents = "none";
  el.animate([{ transform: "none", opacity: 1 }, { transform: "translateY(-6px) scale(.96)", opacity: 0 }], { duration: 260, easing: rvEase, fill: "forwards" });
  el.animate([{ height: h + "px", marginTop: mt, marginBottom: mb }, { height: "0px", marginTop: "0px", marginBottom: "0px" }], { duration: 330, delay: 170, easing: rvEase, fill: "forwards" }).onfinish = done;
}
function rvExpand(el) {   // undo: the card opens back in place
  if (!el) return;
  if (rvReduce()) { el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 }); return; }
  const h = el.offsetHeight, cs = getComputedStyle(el);
  el.style.overflow = "hidden";
  const a = el.animate([{ height: "0px", marginTop: "0px", marginBottom: "0px", opacity: 0, transform: "scale(.96)" },
    { height: h + "px", marginTop: cs.marginTop, marginBottom: cs.marginBottom, opacity: 1, transform: "none" }], { duration: 420, easing: "cubic-bezier(.2, .8, .2, 1)" });
  a.onfinish = () => { el.style.overflow = ""; };
}
function rvUndoBar() {
  let b = document.getElementById("rv-undo");
  if (!b) { b = document.createElement("div"); b.id = "rv-undo"; b.setAttribute("role", "status"); b.hidden = true; document.body.appendChild(b); }
  return b;
}
function rvHideBar() { const b = document.getElementById("rv-undo"); if (b && !b.hidden) { b.classList.remove("on"); clearTimeout(b._h); b._h = setTimeout(() => { b.hidden = true; }, 260); } }
function rvCommit(keepalive) {   // send the held approve; the same server action and payload as the detail page's 批准
  const id = RV.pending; if (!id) return;
  clearTimeout(RV.timer); RV.pending = null; rvHideBar();
  const it = ST.items.find(i => i.id === id), zh = UI.lang !== "en";
  if (!rvCanApprove(it)) { toast(zh ? `这张卡的状态已经变了，没有${okLabel(it, false)}` : "This card changed, nothing was sent", true); renderPage(); return; }
  if (keepalive) {   // page is going away: fire and forget so the approve still lands
    try { fetch("/api/action", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "approve", item: id, skip_asks: RV.skip === id || undefined }) }); } catch (e) { }
    return;
  }
  api("approve", { item: id, skip_asks: RV.skip === id || undefined }).then(() => {
    toast(okDone(it));
  }).catch(() => renderPage());   // failed: the card comes back (api() already showed the error)
}
function rvApprove(id, btn, asked) {
  const it = ST.items.find(i => i.id === id); if (!rvCanApprove(it)) return;
  if (!asked && openAsks(it).length) return askGuard(id, "approve", skip => { RV.skip = skip ? id : null; rvApprove(id, btn && btn.isConnected ? btn : null, true); });   // t-open-questions: asked before the 4.5 s hold starts
  if (RV.pending) rvCommit();   // a second approve while one is held: send the first now
  RV.pending = id;
  const zh = UI.lang !== "en";
  if (window.FX && btn) { const r = btn.getBoundingClientRect(); FX.burst(r.left + r.width / 2, r.top + r.height / 2, { n: 18 }); }
  const card = btn && btn.closest(".rv-card");
  const pb = $("#pagebody"); if (pb) pb._hk = "";   // t-home-flicker: the card is collapsed in place, so the next render must rewrite
  rvCollapse(card, () => { if (RV.pending === id || !RV.pending) renderPage(); });
  const b = rvUndoBar();
  b.innerHTML = `<span class="rv-u-tx"><b>${okDone(it).split(" · ")[0]}</b>${esc(it.title)}</span><button type="button" data-rv-undo>${zh ? "撤销" : "Undo"}</button><i class="rv-u-bar" style="--hold:${RV_HOLD}ms"></i>`;
  clearTimeout(b._h); b.hidden = false; void b.offsetWidth; b.classList.add("on");
  clearTimeout(RV.timer); RV.timer = setTimeout(() => rvCommit(), RV_HOLD);
}
function rvUndo() {
  const id = RV.pending; if (!id) return;
  clearTimeout(RV.timer); RV.pending = null; rvHideBar();
  if (UI.page === "review") { renderPage(); rvExpand(document.querySelector(`#pagebody .rv-card[data-item="${CSS.escape(id)}"]`)); }
}

function wireReview() {
  addEventListener("pagehide", () => grpCommit(true));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") grpCommit(true); });
  document.addEventListener("click", e => {   // capture: a group button must not also open a card or a widget row
    const all = e.target.closest("[data-ri13-all]"), op = !all && e.target.closest("[data-ri13-open]"), un = !all && !op && e.target.closest("[data-ri13-undo]");
    if (!all && !op && !un) return;
    e.stopPropagation(); e.preventDefault();
    if (all) return grpStart(all.dataset.ri13All, all.dataset.ri13Opt);
    if (un) return grpUndo();
    const id = op.dataset.ri13Open; GRP.open.has(id) ? GRP.open.delete(id) : GRP.open.add(id); renderPage();
  }, true);
  document.addEventListener("click", e => {   // capture: a chip inside a card must not also open the card
    const o = e.target.closest("[data-ask-opt]"), x = !o && e.target.closest("[data-ask-other]");
    if (!o && !x) return;
    e.stopPropagation(); e.preventDefault();
    const el = o || x, id = el.dataset.askItem, it = ST.items.find(i => i.id === id); if (!it) return;
    const a = (it.asks || []).find(q => q.id === (o ? o.dataset.ask : x.dataset.askOther)); if (!a) return;
    const zh = UI.lang !== "en";
    if (o) {
      if (AR.pending && AR.pending.id === id) AR.pending.picks = AR.pending.picks.filter(x => x.ask !== a.id);   // t-ask-rec: a hand pick during the hold wins over the recommendation
      if (o.disabled || (a.answer && a.answer.opt === o.dataset.askOpt)) return;
      o.parentElement.querySelectorAll(".ask-o.on").forEach(b => b.classList.remove("on")); o.classList.add("on");   // instant; the poll then redraws from the stored answer
      api("answer", { item: id, ask: a.id, opt: o.dataset.askOpt })
        .then(() => { toast(zh ? `已回答 · 转给${aname(agent(a.by || it.owner))}` : `Answered · sent to ${aname(agent(a.by || it.owner))}`); if (AG.draw && !$("#modal").hidden && $("#modal .ask-guard")) AG.draw(); })
        .catch(() => o.classList.remove("on"));
      return;
    }
    if (!$("#modal").hidden) closeModal();   // 其他…: write it in the detail composer, addressed to whoever asked
    const fill = () => { const ta = $("#drawer .composer textarea"); if (!ta) return; ta.value = `@${aname(agent(a.by || it.owner))} ${zh ? `关于「${a.q}」：` : `re “${a.q}”: `}`; ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); ta.dispatchEvent(new Event("input", { bubbles: true })); };
    if (UI.item !== id) { openItem(id); setTimeout(fill, 450); } else fill();
  }, true);
  document.addEventListener("click", e => {
    const ok = e.target.closest("[data-rv-ok]"); if (ok) { e.stopPropagation(); rvApprove(ok.dataset.rvOk, ok); return; }
    const op = e.target.closest("[data-rv-open]"); if (op) { e.stopPropagation(); openItem(op.dataset.rvOpen); return; }
    if (e.target.closest("[data-rv-undo]")) { e.stopPropagation(); rvUndo(); }
  });
  // leaving the app with an approve on hold still sends it (the user did tap 批准 and did not undo)
  addEventListener("pagehide", () => rvCommit(true));
  addEventListener("pagehide", () => arCommit(true));   // t-ask-rec: a held 全按推荐 still lands when the app goes away
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") arCommit(true); });
  document.addEventListener("click", e => {   // t-ask-rec
    const b = e.target.closest("[data-ask-allrec]"); if (b) { e.stopPropagation(); arStart(b.dataset.askAllrec); return; }
    if (e.target.closest("[data-ar-undo]")) { e.stopPropagation(); arUndo(); }
  });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") rvCommit(true); });
}

export { reviewRow, RV, RV_HOLD, rvCanApprove, reviewCard, awaitsUser, waitSince, waitTag, snzWas, waitTag0, liveAsks, openAsks, isHire, isXfer, okLabel, okDone, askLeft, REC_TXT, recOf, optChips, MSEL, msendBtn, CHIP_RE, chipParens, optDone, AR, arPick, arButton, arCommit, arHide, arStart, arUndo, GRP, GRP_MIN, grpAsk, grpId, askGroups, grpHTML, grpFind, grpStart, grpCommit, grpUndo, okShort, okDockIn, okAria, okBtnIn, askChips, askCard, askBlock, askRow, askJump, ASK_CV, askFold, askFoldWire, AG, askGuard, decisions, decHead, decRow, DC_KIND, todayBlock, nowBlock, shipBlock, rvEase, rvReduce, rvCollapse, rvExpand, rvUndoBar, rvHideBar, rvCommit, rvApprove, rvUndo, wireReview };
