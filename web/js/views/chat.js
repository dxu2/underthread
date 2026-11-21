// Dashboard view: the chat column (#right) and the phone DM screen: the message window (chatFrom / chatCount), patching new messages in,
// "load earlier", typing dots, the composer with attachments and voice memos, and the DM pin.
// t-oss-struct S10 (A4): moved out of app.js unchanged. chatCount / chatFrom are assigned elsewhere too, through setChatCount / setChatFrom.
// wireChat() holds the top-level event wiring; app.js calls it where the code used to run.


// ---------- chat (right) ----------
import { $, DRAFT, LS } from "../core/util.js";
import { t, whenH } from "../core/i18n.js";
import { HIST, ST, UI, chatOlder, histAll, olderN, poll, qBadge, queueOf } from "../core/store.js";
import { agent, agents, aname, atitle, av, avatarUrl } from "../core/av.js";
import { orn, postAct, stillUploading, toast } from "../core/ui.js";
import { ATT_IC, attHTML, attTiles, attTitle, wireUploads } from "./attach.js";
import { deskFit, openItem } from "./drawer.js";
import { mgrState } from "./header.js";
import { renderLeft } from "./left.js";
import { chatMailRead, seenOf, unreadOf, unreadTag } from "./mail.js";
import { MOBQ } from "./pages/common.js";
import { MSEL, chipParens, msendBtn, optChips, optDone } from "./pages/review.js";
import { hooks, typingOn, typingUntil } from "../app.js";
const chatAtt = [];
let chatBuilt = false, chatRenderedFor = null, chatCount = 0, chatLang = null;
function setChatCount(v) { return chatCount = v; }   /* S10: other modules assign chatCount through this */
const CHN = { for: null, t: "", on: false };   // r-improve-1102 P4: 「以下 N 条是新消息」 — where you had read up to when this thread was opened
// t-mobile-crash B: a thread renders only from chatFrom on (the newest CHAT_N when it opens; 「加载更早的消息」 moves it back by CHAT_N).
// chatFrom stays put while new messages arrive (so the phone still sees the count grow and plays m-new); it re-anchors on a chat switch or past CHAT_N + 60.
const CP = { ro: null, until: 0 };   /* t-ui-fix-p1: chatPinWatch state (declared up here: applyChatW can run before the function below) */
const CHAT_N = 20; let chatFrom = 0, chatHold = false, chatBottom = false, chatMore = false;   // chatBottom: you just sent, so the next render lands on the newest message (t-perf C)   // chatHold: a ↩ quote jumped far back (t-option-quote); keep that range until the thread changes
function setChatFrom(v) { return chatFrom = v; }   /* S10: other modules assign chatFrom through this */
function setChat(id) { UI.chat = id; LS.set("chat", id); chatRenderedFor = null; CHN.for = null; renderLeft(); renderChat(); chatDraftLoad(); $("#right textarea") && $("#right textarea").focus(); }
function chatDraftLoad() {   // t-draft-keep: the DM box shows this partner's own draft (never the previous partner's text)
  const ta = $("#right .ch-comp textarea"); if (!ta) return; const d = DRAFT.get("dm:" + UI.chat), v = d ? d.t : "";
  if (ta.value === v) return; ta.value = v; ta.style.height = ""; ta._dmLoad = true; ta.dispatchEvent(new Event("input", { bubbles: true })); ta._dmLoad = false;
}
function chatList(id) { return id === "manager" ? (HIST.chat.list.length ? HIST.chat.list.concat(ST.chat || []) : (ST.chat || [])) : ((ST.dms || {})[id] || []); }   /* ri1105-P4: + what slid out of / was fetched before the poll window */
/* t-avatar-strip-scroll: the desktop open-column roster is a horizontal strip (style.css .crs-*). Edge classes drive the fades and arrows;
   a vertical wheel scrolls it sideways with snap switched off while it moves, then we glide to the nearest avatar ourselves (a snap-type flip
   would jump). Phone (MOBQ) and the folded rail are left alone. */
const CRS = { on: null };
const crsLive = () => !MOBQ.matches && !document.body.classList.contains("chat-folded");
function crsEdges(ro) {
  const w = ro && ro.parentNode; if (!w || !w.classList.contains("crs-wrap")) return;
  const max = ro.scrollWidth - ro.clientWidth, live = crsLive() && max > 1;
  w.classList.toggle("crs-l", live && ro.scrollLeft > 2); w.classList.toggle("crs-r", live && ro.scrollLeft < max - 2);
}
function crsStops(ro) { const pad = parseFloat(getComputedStyle(ro).scrollPaddingLeft) || 0, max = ro.scrollWidth - ro.clientWidth; return Array.from(ro.children).map(b => Math.min(max, Math.max(0, b.offsetLeft - pad))).concat([max]); }
function crsGlide(ro, to) {
  ro.classList.add("crs-free"); ro._crsTo = to; ro.scrollTo({ left: to, behavior: "smooth" });
  clearTimeout(ro._crsR); ro._crsR = setTimeout(() => { ro.classList.remove("crs-free"); ro._crsTo = null; }, 520);
}
function crsSnap(ro) { const at = ro._crsTo != null ? ro._crsTo : ro.scrollLeft; let best = at, d = 1e9; crsStops(ro).forEach(x => { if (Math.abs(x - at) < d) { d = Math.abs(x - at); best = x; } }); crsGlide(ro, best); }
function crsShow(ro, smooth) {
  const b = ro.querySelector("button.on"); if (!b || !crsLive() || !ro.clientWidth) return false;
  const m = 36, x = b.offsetLeft, w = b.offsetWidth, max = ro.scrollWidth - ro.clientWidth; let to = ro.scrollLeft;
  if (x - m < to) to = x - m; else if (x + w + m > to + ro.clientWidth) to = x + w + m - ro.clientWidth;
  to = Math.max(0, Math.min(max, to));
  if (Math.abs(to - ro.scrollLeft) > 1) { if (smooth) crsGlide(ro, to); else ro.scrollLeft = to; }
  return true;
}
function crsAfter(ro) { if (!ro) return; if (CRS.on !== UI.chat && crsShow(ro, CRS.on !== null)) CRS.on = UI.chat; crsEdges(ro); }
function crsWire(ro) {
  if (!ro) return; CRS.on = null;
  const w = ro.parentNode;
  ro.addEventListener("scroll", () => { if (!ro._crsF) ro._crsF = requestAnimationFrame(() => { ro._crsF = 0; crsEdges(ro); }); }, { passive: true });
  ro.addEventListener("wheel", e => {
    if (!crsLive() || e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;   // sideways trackpad swipes stay native (and snap natively)
    const max = ro.scrollWidth - ro.clientWidth; if (max <= 1) return;
    const dy = e.deltaY * (e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? ro.clientWidth : 1);
    const base = ro._crsTo != null ? ro._crsTo : ro.scrollLeft, to = Math.max(0, Math.min(max, base + dy));
    if ((dy < 0 && base <= 0) || (dy > 0 && base >= max)) return;   // at the end: let the page scroll on
    e.preventDefault(); clearTimeout(ro._crsT); clearTimeout(ro._crsR); ro.classList.add("crs-free");
    if (e.deltaMode || Math.abs(dy) >= 60) { ro._crsTo = to; ro.scrollTo({ left: to, behavior: "smooth" }); ro._crsT = setTimeout(() => crsSnap(ro), 240); }   // mouse notch: glide
    else { ro._crsTo = null; ro.scrollLeft = to; ro._crsT = setTimeout(() => crsSnap(ro), 140); }   // trackpad: follow the finger
  }, { passive: false });
  w.addEventListener("click", e => {
    const a = e.target.closest(".crs-a"); if (!a) return;
    const dir = a.classList.contains("crs-prev") ? -1 : 1, from = ro._crsTo != null ? ro._crsTo : ro.scrollLeft, aim = from + dir * ro.clientWidth * 0.7;
    const st = crsStops(ro); let best = aim, d = 1e9; st.forEach(x => { if (Math.abs(x - aim) < d) { d = Math.abs(x - aim); best = x; } });
    crsGlide(ro, best);
  });
  if (window.ResizeObserver) new ResizeObserver(() => crsAfter(ro)).observe(ro);
}
function buildChat() {
  const r = $("#right");
  r.innerHTML = `<div class="ch-grip" title="${UI.lang === "en" ? "Drag to resize" : "拖动调整宽度"}"></div>
    <button class="ch-fold" title="${UI.lang === "en" ? "Collapse" : "收起 / 展开"}"><span></span></button>
    <div class="ch-head"><div class="ch-who"></div>${orn(160)}<div class="crs-wrap"><div class="ch-roster"></div><button type="button" class="crs-a crs-prev" tabindex="-1" aria-label="${UI.lang === "en" ? "Scroll left" : "向左"}"><span></span></button><button type="button" class="crs-a crs-next" tabindex="-1" aria-label="${UI.lang === "en" ? "Scroll right" : "向右"}"><span></span></button></div></div><div class="ch-msgs"></div>
    <div class="pending-att" style="padding:0 16px"></div>
    <div class="ch-comp"><button type="button" class="att" title="${attTitle()}" aria-label="${UI.lang === "en" ? "Attach" : "添加附件"}">${ATT_IC}</button><input type="file" multiple hidden><textarea rows="1"></textarea><span class="ch-kb" aria-hidden="true">${UI.lang === "en" ? "⌘/Ctrl ↵ send · ↵ new line" : "⌘/Ctrl ↵ 发送 · ↵ 换行"}</span><button type="button" class="ch-send" aria-label="${UI.lang === "en" ? "Send" : "发送"}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 3.5 3.6 10.4l6.6 2.9 2.9 6.6z"/><path d="m10.2 13.3 4.6-4.6"/></svg></button></div>`;
  const ta = $("textarea", r), fi = $("input[type=file]", r);
  const showAtt = () => attTiles($(".pending-att", r), chatAtt, showAtt);   // ui19
  const add = wireUploads(ta, chatAtt, showAtt);
  ta.addEventListener("input", () => { if (!ta._dmLoad) DRAFT.set("dm:" + UI.chat, ta.value); });   // t-draft-keep
  $(".ch-comp button", r).onclick = () => fi.click();
  fi.onchange = () => { add(Array.from(fi.files)); fi.value = ""; };
  /* t-ui-polish-1115b: the paper plane = the same ⌘↵ path below (empty field + no attachment = no-op; the CSS greys it out then) */
  $(".ch-send", r).onclick = () => { ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, ctrlKey: true, bubbles: true })); ta.focus(); };
  ta.addEventListener("input", () => deskFit(ta, 200));   /* t-hdr-trim ⑨ (was height:auto, which jumped to two rows on the first letter) */   // jit: on the phone mobile.js fit() is the only owner of this height (a second measure here flushed height:auto = 62px and re-animated it on every keystroke)
  ta.addEventListener("keydown", async e => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault(); const text = ta.value.trim(); if (!text && !chatAtt.length) return;
      if (stillUploading(chatAtt)) return toast(UI.lang === "en" ? "Still uploading…" : "文件还在上传……");
      const dmTo = UI.chat, att = chatAtt.slice(); DRAFT.set("dm:" + dmTo, ""); ta.value = ""; ta.style.height = ""; chatAtt.length = 0; showAtt();   // t-perf C: clear first, the bubble is already up
      sendChat(text || "📎", att);
    }
  });
  // t-rail-tip: folded rail (one column of avatars) → our own name tip, to the LEFT of the avatar and vertically centred, on <body> with position:fixed
  // so the rail's overflow never clips it. The native title tooltip (OS-placed, landed on the next avatar) is dropped from the rail on hover.
  crsWire($(".ch-roster", r));
  let rtip = null;
  const railTip = btn => {
    if (!btn || !document.body.classList.contains("chat-folded") || MOBQ.matches) return railHide();
    btn.querySelectorAll("[title]").forEach(x => { x.dataset.t = x.getAttribute("title"); x.removeAttribute("title"); });
    const a = $(".av", btn) || btn, q = a.getBoundingClientRect(), nm = ($("span:not(.av)", btn) || {}).textContent || "";
    if (!rtip) { rtip = document.createElement("div"); rtip.id = "rail-tip"; rtip.setAttribute("role", "tooltip"); document.body.appendChild(rtip); }
    rtip.textContent = nm; rtip.classList.add("on");
    rtip.style.top = Math.round(q.top + q.height / 2) + "px"; rtip.style.left = Math.round(q.left - 10) + "px";
  };
  const railHide = () => { if (rtip) rtip.classList.remove("on"); };
  r.addEventListener("mouseover", e => { const b = e.target.closest(".ch-roster [data-pick]"); if (b) railTip(b); else railHide(); });
  r.addEventListener("mouseleave", railHide);
  r.addEventListener("focusin", e => { const b = e.target.closest(".ch-roster [data-pick]"); if (b && b.matches(":focus-visible")) railTip(b); });
  r.addEventListener("focusout", railHide);
  addEventListener("scroll", railHide, true);
  r.addEventListener("click", e => {
    const o = e.target.closest("[data-opt]"); if (o) { RQ.fresh = o.dataset.mid || ""; sendChat(o.dataset.opt, [], o.dataset.mid); }
    const mo = e.target.closest("[data-mopt]"); if (mo) {   // t-hr-multiselect: toggle only; nothing is sent until 发送（n）
      const mid = mo.dataset.mid || "", v = mo.dataset.mopt, set = MSEL.get(mid) || new Set(); set.has(v) ? set.delete(v) : set.add(v);
      if (set.size) MSEL.set(mid, set); else MSEL.delete(mid);
      mo.classList.toggle("on", set.has(v)); mo.setAttribute("aria-pressed", set.has(v) ? "true" : "false");
      const sb = mo.parentElement && mo.parentElement.querySelector("[data-msend]"); if (sb) sb.outerHTML = msendBtn(mid, set.size);
      return; }
    const ms = e.target.closest("[data-msend]"); if (ms) { const mid = ms.dataset.msend, set = MSEL.get(mid); if (!set || !set.size) return;
      const order = [...ms.parentElement.querySelectorAll("[data-mopt]")].map(b => b.dataset.mopt), picks = order.filter(v => set.has(v));
      MSEL.delete(mid); RQ.fresh = mid; sendChat(picks.join("、"), [], mid || undefined); return; }
    const q = e.target.closest(".rq[data-rq]"); if (q) { rqSeek(q.dataset.rq); return; }
    const pr = e.target.closest("[data-pend-retry]"), pd = e.target.closest("[data-pend-drop]");   // t-perf C: a failed bubble
    if (pr || pd) { const p = PEND.list.find(x => x.pend === (pr || pd).dataset[pr ? "pendRetry" : "pendDrop"]); if (p) { if (pd) { PEND.list.splice(PEND.list.indexOf(p), 1); chatCount = -1; renderChat(); hooks.forEach(f => f("all")); } else { pendPost(p); pendPaint(p); } } return; }
    railHide();
    const p = e.target.closest("[data-pick]"); if (p) { if (UI.chatFold) foldChat(false); setChat(p.dataset.pick); }
    if (e.target.closest("[data-more]")) { moreChat($(".ch-msgs", r)); return; }
    if (e.target.closest(".ch-fold")) { if (document.body.classList.contains("chat-pop")) chatPop(false); else foldChat(!UI.chatFold); }
  });
  const grip = $(".ch-grip", r);
  grip.addEventListener("pointerdown", e => {
    if (UI.chatFold) return;
    e.preventDefault(); grip.setPointerCapture(e.pointerId); document.body.classList.add("resizing");
    const move = ev => { UI.chatW = Math.max(300, Math.min(chatCap(), window.innerWidth - ev.clientX)); applyChatW(); };
    const up = () => { grip.removeEventListener("pointermove", move); document.body.classList.remove("resizing"); LS.set("chatW", UI.chatW); dispatchEvent(new Event("resize")); };
    grip.addEventListener("pointermove", move); grip.addEventListener("pointerup", up, { once: true });
  });
  grip.addEventListener("dblclick", () => { UI.chatW = 420; LS.set("chatW", 420); applyChatW(); });
  applyChatW();
  chatBuilt = true;
}
// t-web-audit 01: the board and the production line fold the chat on their own while #main is under 900px (not saved; unfolds when you leave)
function autoFold() {
  if (MOBQ.matches || NARROWQ.matches) return;   // at <=1180px the chat is a pop-over, nothing to fold
  const wide = UI.page === "board" || UI.page === "pipe", main = $("#main");
  if (wide && !UI.chatFold && !UI.autoFold && !LS.get("wideChat", false) && main && main.clientWidth < 900) { UI.autoFold = true; UI.chatFold = true; applyChatW(); setTimeout(() => dispatchEvent(new Event("resize")), 520); }
  else if (!wide && UI.autoFold) { UI.autoFold = false; UI.chatFold = false; applyChatW(); setTimeout(() => dispatchEvent(new Event("resize")), 520); }
}
// t-web-audit-2 05: at 761-1180px the chat column is hidden; the top bar's 聊天 button (or a teammate row) slides it in over the page
const NARROWQ = matchMedia("(max-width: 1180px)");
function chatPop(on) {
  document.body.classList.toggle("chat-pop", on);
  if (on && UI.chatFold) { UI.popUnfold = true; UI.chatFold = false; applyChatW(); }   // the pop-over always shows the full chat; the saved fold is untouched
  if (!on && UI.popUnfold) { UI.popUnfold = false; UI.chatFold = LS.get("chatFold", false); applyChatW(); }
  const b = $("#hdrctrl .hc-chat"); if (b) b.setAttribute("aria-expanded", on);
  if (on) setTimeout(() => { const ta = $("#right textarea"); if (ta) ta.focus({ preventScroll: true }); }, 60);
}
/* t-ui-fix-r3 R3-01: the chat column never pushes the page wider than the window. #layout is left rail + main (min 460) + chat,
   so the widest chat is the window minus the rail and 460 (at most 760). The saved width is kept; only what is shown is capped. */
function chatCap() {
  const L = $("#layout"), lw = L ? parseFloat(getComputedStyle(L).getPropertyValue("--left-w")) || 250 : 250;
  return Math.max(300, Math.min(760, document.documentElement.clientWidth - lw - 460));
}
function applyChatW() {
  /* t-ui-fix-p1 P1-1: the folded column hides .ch-msgs (display:none), which drops its scroll position in Chromium, so unfolding after 制作
     showed the middle of the thread. Remember whether you were at the bottom when it folded; unfolding puts you back there. */
  const box = $("#right .ch-msgs"), was = document.body.classList.contains("chat-folded");
  if (box && !was && UI.chatFold && box.clientHeight) UI.foldGap = box.scrollHeight - box.scrollTop - box.clientHeight;
  if (box && was && !UI.chatFold) { const g = UI.foldGap; UI.foldGap = null; if (g == null || g < 80) requestAnimationFrame(() => chatPinWatch(box)); }
  document.documentElement.style.setProperty("--chat-w", UI.chatFold ? "80px" : Math.min(UI.chatW, chatCap()) + "px");   // t-rail-width: 64 -> 80, so avatars get ~14px either side and the unread badge / online dot sit inside
  document.body.classList.toggle("chat-folded", UI.chatFold);
}
function foldChat(on) {
  const wide = UI.page === "board" || UI.page === "pipe";
  if (UI.autoFold) { UI.autoFold = false; if (!on) LS.set("wideChat", true); }   // opened it again on the board: remember, stop folding there
  else if (on && wide) LS.set("wideChat", false);
  UI.chatFold = on; LS.set("chatFold", on); applyChatW();
  setTimeout(() => dispatchEvent(new Event("resize")), 520);  // let the layout refit after the slide
}
// t-perf C (was t-send-lag): the bubble goes up the moment you send, gray while the POST is out (st "sending"), normal once the server said ok ("ok"),
// red with 重试 / 删除 if it failed ("fail"). It stays a local bubble until a poll brings the server's copy (matched by text after the last
// message that was there when you sent), then the real message replaces it. No forced full re-download any more: one ordinary rev poll.
const PEND = { n: 0, list: [] };
const isoNow = () => { const d = new Date(), o = -d.getTimezoneOffset(), p = n => String(Math.floor(Math.abs(n))).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${o >= 0 ? "+" : "-"}${p(o / 60)}:${p(o % 60)}`; };
function sendChat(text, attachments, replyTo) {
  const chat = UI.chat, L = chatList(chat), src = replyTo && L.find(x => x.id === replyTo);
  const p = { pend: "p" + (++PEND.n), chat, who: "me", text, att: attachments || [], t: isoNow(), st: "sending", after: L.length ? L[L.length - 1].id : null,
    attachments: (attachments || []).map(a => typeof a === "string" ? a : a && a.path).filter(Boolean) };
  if (replyTo) { p.reply_to = replyTo; if (src) p.rq = { who: src.who, text: String(src.text || "").replace(/\s+/g, " ").slice(0, 80) }; }
  PEND.list.push(p); chatBottom = true;
  if (UI.chat === chat) { renderChat(); hooks.forEach(f => f("all")); }
  return pendPost(p);
}
function pendPost(p) {
  p.st = "sending"; p.okAt = 0;
  const b = { text: p.text, attachments: p.att }; if (p.reply_to) b.reply_to = p.reply_to;   // t-option-quote: the server snapshots the quoted message
  return postAct(p.chat === "manager" ? "chat" : "dm", p.chat === "manager" ? b : Object.assign({ agent: p.chat }, b))
    .then(j => { p.st = "ok"; p.okAt = Date.now(); pendPaint(p); poll(); return j; },
      e => { p.st = "fail"; pendPaint(p); toast((UI.lang === "en" ? "Not sent: " : "没发出去：") + String(e.message || e), true); });
}
function pendPaint(p) { if (PEND.list.includes(p) && UI.chat === p.chat && ST) { chatCount = -1; renderChat(); hooks.forEach(f => f("all")); } }
function pendSync() {   // drop the local bubbles whose server copy has arrived
  if (!PEND.list.length) return;
  const claimed = new Set();
  PEND.list = PEND.list.filter(p => {
    const L = chatList(p.chat); let from = 0;
    if (p.after) { let i = L.length - 1; while (i >= 0 && L[i].id !== p.after) i--; from = i >= 0 ? i + 1 : Math.max(0, L.length - 50); }
    for (let k = from; k < L.length; k++) { const m = L[k], key = p.chat + ":" + (m.id || k); if (m.who === "me" && m.text === p.text && !claimed.has(key)) { claimed.add(key); return false; } }
    return !(p.st === "ok" && Date.now() - p.okAt > 60e3);   // safety net: the server has had it for a minute
  });
}
const pendOf = id => PEND.list.filter(p => p.chat === id);
// ===== t-option-quote: a reply that quotes an earlier message (a quick-option click) draws ↩ who · first line above its bubble.
// Tapping it scrolls back to the original (loading earlier pages, at most 5) and rings it; a trimmed original gets a toast, the snapshot stays.
const RQ = { fresh: "", seen: new Set(), for: null };
function askSeek(id, n = 0) {
  const q = document.querySelector(`.ask[data-askq="${CSS.escape(id)}"]`), sum = !q && document.querySelector('[data-uin-asks][aria-expanded="false"]');
  if (sum && !n) { sum.click(); setTimeout(() => askSeek(id, 1), 150); return; }   // all answered: the questions sit folded behind one summary row
  if (!q) { toast(UI.lang === "en" ? "That question is no longer on the card" : "这个问题已经不在卡上了"); return; }
  q.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  q.classList.remove("rq-hit"); void q.offsetWidth; q.classList.add("rq-hit"); setTimeout(() => q.classList.remove("rq-hit"), 1300);
}
function rqLine(m) {
  if (!m.reply_to || !m.rq) return "";
  const w = m.rq.who, nm = w === "me" ? (UI.lang === "en" ? "You" : "你") : aname(agent(w)), tx = String(m.rq.text || "");
  const nw = m.who === "me" && RQ.fresh === m.reply_to && !RQ.seen.has(m.id); RQ.seen.add(m.id); if (nw) RQ.fresh = "";
  return `<button type="button" class="rq${nw ? " rq-new" : ""}" data-rq="${esc(m.reply_to)}" title="${esc(tx)}"><i aria-hidden="true">↩</i><b>${esc(nm)}</b><span>${esc(tx)}</span></button>`;
}
function rqSeek(mid, n = 0) {
  const box = $("#right .ch-msgs"); if (!box) return;
  const m = box.querySelector(`.msg[data-mid="${CSS.escape(mid)}"]`);
  if (m) {
    const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
    box.scrollTo({ top: Math.max(0, box.scrollTop + m.getBoundingClientRect().top - box.getBoundingClientRect().top - Math.min(140, box.clientHeight * 0.3)), behavior: RM ? "auto" : "smooth" });
    m.classList.remove("rq-hit"); void m.offsetWidth; m.classList.add("rq-hit"); setTimeout(() => m.classList.remove("rq-hit"), 1300);
    return;
  }
  const list = chatList(UI.chat), at = list.findIndex(x => x.id === mid);
  if (at < 0 && olderN(UI.chat) && !HIST.allFail) { histAll().then(() => rqSeek(mid, n)); return; }   /* ri1105-P4: before the poll window: fetch the older chat once */
  if (at < 0 || n >= 2 || at >= chatFrom) { toast(UI.lang === "en" ? "That message is too old; it is no longer in the record" : "原消息太早，已不在记录里"); return; }
  chatHold = true; chatFrom = Math.max(0, at - 3); box._n = 1e9; chatCount = -1; renderChat(); hooks.forEach(f => f("all"));   // render from just above the original
  setTimeout(() => rqSeek(mid, n + 1), 120);
}
// ===== t-web-dm: the desktop chat panel (and its <=1180px pop-over) gets the phone thread's major design (P3): a stamp only after a 5-minute gap,
// one avatar per run of messages, my avatar on the right, a typing bubble, and the exact time on hover. Same class names as mobile.js decorateThread(),
// styled only under @media (min-width: 761px). It must never run on a phone: decorateThread() skips any thread that already has a .m-tsep.
function deskStamp(iso) {
  const d = new Date(iso), p2 = n => String(n).padStart(2, "0"), hm = `${p2(d.getHours())}:${p2(d.getMinutes())}`, en = UI.lang === "en";
  const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()), diff = Math.round((day(new Date()) - day(d)) / 864e5);
  if (diff === 0) return hm;
  if (diff === 1) return (en ? "Yesterday " : "昨天 ") + hm;
  if (diff < 7) return (en ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] : ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"])[d.getDay()] + " " + hm;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}
function deskMeAv() {
  const f = (ST.meta.avatars || {}).me;
  if (f) return `<span class="av m-meav" style="background-image:url('${avatarUrl({ id: "me" })}')"></span>`;
  const o = ST.meta.owner, ch = o && !o.startsWith("<") ? [...o.trim()][0] : (UI.lang === "en" ? "Me" : "我");
  return `<span class="av m-meav ph"><b>${esc(ch)}</b></span>`;
}
function deskMeName() { const o = ST.meta.owner; return o && !o.startsWith("<") ? o.trim() : (UI.lang === "en" ? "Me" : "我"); }
function decorateDesk(box, list) {
  if (MOBQ.matches || !box) return;
  const msgs = [...box.querySelectorAll(".msg[data-t]")];
  if (msgs.length && !box.querySelector(".m-tsep")) {   // renderChat rebuilt the box: decorate once
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    let prev = null, pw = null;
    msgs.forEach(m => {
      const t0 = m.dataset.t, w = m.classList.contains("me") ? "\u0001me" : (m.dataset.who || "");
      if (!prev || new Date(t0) - new Date(prev) > 5 * 60e3) m.insertAdjacentHTML("beforebegin", `<div class="m-tsep">${esc(deskStamp(t0))}</div>`);
      const pe = m.previousElementSibling; m.classList.toggle("m-cont", !!pe && pe.classList.contains("msg") && w === pw);
      prev = t0; pw = w;
      if (m.dataset.dd) { prev = t0; pw = w; return; }   // t-send-flicker: kept bubbles are already decorated
      m.dataset.dd = "1";
      m.title = new Date(t0).toLocaleString(UI.lang === "en" ? "en-US" : "zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
      /* t-chat-avatar-row-desk (option B, same as the phone): my avatar + name row goes ABOVE the bubble (.m-hd, right-aligned by CSS).
         Agents already have it in .mh, which now shows their name too, so the group-style .m-nm is gone. */
      if (m.classList.contains("me") && !m.querySelector(":scope > .m-hd")) m.insertAdjacentHTML("afterbegin", `<div class="m-hd">${deskMeAv()}<span class="m-hn">${esc(deskMeName())}</span></div>`);
    });
    if (atBottom) box.scrollTop = box.scrollHeight;
  }
  // typing: the agent is working and you spoke last. The dots get a negative animation-delay from the clock, so a rebuilt bubble keeps its phase.
  const a = agent(UI.chat), last = list && list[list.length - 1], on = typingOn(a, last);   // t-typing-fix
  let tb = box.querySelector(".m-typing");
  if (on && !tb) {
    const ph = Date.now() % 1200;
    box.insertAdjacentHTML("beforeend", `<div class="m-typing" data-until="${typingUntil(last)}">${av(a)}<div class="mb"><span class="m-dots">${[0, 1, 2].map(i => `<i style="animation-delay:${i * 160 - ph}ms"></i>`).join("")}</span></div></div>`);
    if (box.scrollHeight - box.scrollTop - box.clientHeight < 120) box.scrollTop = box.scrollHeight;
  } else if (!on && tb) tb.remove();
}
// t-mobile-crash B: 「加载更早的消息」. Keeps the message that was on top where it was: re-aligned after the render, the phone's stamps (hooks)
// and every frame for ~1.5 s while thumbnails above it load. The browser's own scroll anchoring is off meanwhile (Chromium's picks another node and fights us;
// iOS Safari may have none). Stops at the user's first touch / wheel. _n huge = no m-new pop for the older messages.
function moreChat(box, fetched) {
  if (!fetched && chatFrom < CHAT_N && olderN(UI.chat)) {   /* ri1105-P4: the page holds no more: fetch the 200 before it first */
    if (moreChat.busy) return; moreChat.busy = true;
    chatOlder(200).catch(() => 0).finally(() => { moreChat.busy = false; moreChat(box, true); });
    return;
  }
  const top = box.querySelector(".msg[data-t]"); if (!top) return;
  const key = top.dataset.t, off = top.getBoundingClientRect().top - box.getBoundingClientRect().top;
  box.style.overflowAnchor = "none";
  chatFrom = Math.max(0, chatFrom - CHAT_N); box._n = 1e9; chatCount = -1; chatMore = true; renderChat(); hooks.forEach(f => f("all"));   // chatMore: this render is the page you asked for, never clamp it (t-perf D)
  let live = true;
  const align = () => { if (!live) return; const el = box.querySelector(`.msg[data-t="${CSS.escape(key)}"]`); if (el) box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - off; };
  const stop = () => { if (!live) return; live = false; box.style.overflowAnchor = ""; box.removeEventListener("touchstart", stop); box.removeEventListener("wheel", stop); };
  const loop = () => { if (live) { align(); requestAnimationFrame(loop); } };   // one rect read per frame for 1.5 s: covers stamps, thumbnails and a poll re-render alike
  align(); requestAnimationFrame(loop);
  box.addEventListener("touchstart", stop, { passive: true }); box.addEventListener("wheel", stop, { passive: true }); setTimeout(stop, 1500);
}
/* t-send-flicker (11-07): sending a message re-rendered the whole thread 3 times (local bubble, POST ok, server copy), plus the header and the
   roster, so every avatar ring restarted and the images re-decoded: a visible flash. Now each message block keeps its DOM when its HTML is
   unchanged; only new / changed blocks are swapped in. Kept nodes are never detached (that would restart their animations too). */
function phz(h) { return h.replace(/--wp:-?[\d.]+s/g, ""); }   // avatar rings carry a wall-clock phase; ignore it when comparing
function setSrc(el, h) { if (el && (el._src !== phz(h) || !el.firstChild)) { el.innerHTML = h; el._src = phz(h); } }   // hoisted: renderLeft runs before this line
const deco = n => n.nodeType === 1 && (n.classList.contains("m-tsep") || n.classList.contains("m-typing"));   // added by decorateDesk, not ours
function chatPatch(box, parts) {
  parts = parts.filter(Boolean);
  const old = box._parts, total = old ? old.reduce((n, e) => n + e.nodes.length, 0) : -1;
  if (!old || total !== [...box.childNodes].filter(n => !deco(n)).length || old.some(e => e.nodes.some(n => n.parentNode !== box))) {   // first render, or someone else rebuilt the box
    box.innerHTML = parts.join(""); box._parts = null;
    const t = document.createElement("template"), nodes = [...box.childNodes]; let k = 0;
    const ps = parts.map(p => { t.innerHTML = p; const n = t.content.childNodes.length; return { src: phz(p), nodes: nodes.slice(k, k += n) }; });
    box._parts = k === nodes.length ? ps : null;
    return;
  }
  const pool = new Map(); old.forEach(e => { const a = pool.get(e.src); a ? a.push(e) : pool.set(e.src, [e]); });
  const next = parts.map(p => { const k = phz(p), a = pool.get(k), e = a && a.shift(); return e ? { e } : { src: k, html: p }; });
  const used = new Set(next.filter(x => x.e).map(x => x.e)); let changed = false;
  old.forEach(e => { if (!used.has(e)) { changed = true; e.nodes.forEach(n => n.remove()); } });
  let cur = box.firstChild; const t = document.createElement("template");
  const skip = () => { while (cur && cur.nodeType === 1 && cur.classList.contains("m-tsep")) cur = cur.nextSibling; };
  box._parts = next.map(x => {
    skip();
    if (x.e) { if (x.e.nodes[0] !== cur) { changed = true; x.e.nodes.forEach(n => box.insertBefore(n, cur)); } else cur = x.e.nodes[x.e.nodes.length - 1].nextSibling; return x.e; }
    changed = true; t.innerHTML = x.html; const nodes = [...t.content.childNodes]; nodes.forEach(n => box.insertBefore(n, cur)); return { src: x.src, nodes };
  });
  if (changed) box.querySelectorAll(":scope > .m-tsep").forEach(n => n.remove());   // decorateDesk redraws the time stamps (plain text)
}
function renderChat() {
  const firstBuild = !chatBuilt; if (!chatBuilt) buildChat();
  const r = $("#right");
  /* t-ui-fix-r2 B04: switching 界面语言 without a reload left sender names and the ⌘/Ctrl hint in the old language (the message cache kept the old HTML) */
  if (chatLang !== UI.lang) { if (chatLang) { chatRenderedFor = null; const kb = $(".ch-kb", r); if (kb) kb.textContent = UI.lang === "en" ? "⌘/Ctrl ↵ send · ↵ new line" : "⌘/Ctrl ↵ 发送 · ↵ 换行";
    const at = $(".ch-comp .att", r); if (at) { at.title = attTitle(); at.setAttribute("aria-label", UI.lang === "en" ? "Attach" : "添加附件"); }
    const sd = $(".ch-comp .ch-send", r); if (sd) sd.setAttribute("aria-label", UI.lang === "en" ? "Send" : "发送"); } chatLang = UI.lang; }
  if (!ST.agents[UI.chat]) UI.chat = "manager";
  if (firstBuild) chatDraftLoad();   // t-draft-keep: restore this partner's unsent text after a reload
  const a = agent(UI.chat);
  const ms = mgrState();
  const st = a.id === "manager" ? (ms.on ? `<span class="on">▶ ${t("online")}</span>` : ms.sleep ? `<span class="zz">☾ ${esc(ms.txt)}</span>` : `<span class="off">● ${t("offline")}</span>`)
    : a.status === "working" ? `<span class="on">▶ ${t("working")}</span>` : `<span class="idle">${t(a.status || "idle")}</span>`;
  if (window.Market && Market.hrBar) Market.hrBar(r);   /* t-hr-build: the 面试中 bar above the HR DM */
  setSrc($(".ch-who", r), `${av(a, "lg")}<span class="nm">${esc(aname(a))}</span><span class="ti">${esc(atitle(a))}</span>${qBadge(a.id)}${st}<span class="sp"></span>`);
  setSrc($(".ch-roster", r), agents().filter(x => x.enabled !== false).map(x => {
    const un = x.id !== UI.chat ? unreadOf(x.id) : 0;   /* t-ri1104-p2: a count from unreadOf (was: a dot when the last message was theirs) */
    return `<button data-pick="${x.id}" class="${x.id === UI.chat ? "on" : ""}">${av(x)}<span>${esc(aname(x))}</span>${un ? `<i class="unread n">${unreadTag(un)}</i>` : ""}${qBadge(x.id, true)}</button>`;
  }).join("").replace(UI.chatFold && !MOBQ.matches ? / title="[^"]*"/g : /$^/, ""));   // t-rail-tip: folded rail shows #rail-tip, never the OS tooltip
  crsAfter($(".ch-roster", r));   /* t-avatar-strip-scroll: keep the open chat's avatar in view + refresh the edge fades */
  $("textarea", r).placeholder = UI.lang === "en" ? `Message ${aname(a)}…` : `对${aname(a)}说……`;   // t-web-dm: desktop moves the shortcut hint below the field; t-ui-fix-r2 audit P2-12: a phone has no ⌘ key, so no hint there at all
  pendSync();
  const real = chatList(UI.chat), pl = pendOf(UI.chat), list = pl.length ? real.concat(pl) : real;   // t-perf C: local bubbles ride at the end
  const obTop = UI.chat === "manager" && window.Onboard ? Onboard.chatTop() : "";   /* t-onboarding P0: steward offline / online card (onboard.js); part of sig so it follows the heartbeat */
  if (window.Onboard) Onboard.row(r);   /* t-onboarding P0 ①: quick-phrase chips above the field */
  const sig = olderN(UI.chat) + "/" + list.length + (pl.length ? "|" + pl.map(p => p.pend + p.st).join(",") : "") + (obTop ? "|" + obTop : "");
  const box = $(".ch-msgs", r);
  if (chatRenderedFor === UI.chat && chatCount === sig) { decorateDesk(box, list); return; }
  if (chatRenderedFor !== UI.chat) chatHold = false;
  const nearBottom = chatBottom || box.scrollHeight - box.scrollTop - box.clientHeight < 80 || chatRenderedFor !== UI.chat; chatBottom = false;
  // t-perf D: the window only shrinks back to the newest CHAT_N while you sit at the bottom; paging back with 加载更早 keeps every page you loaded
  // (before: past CHAT_N + 60 the next render snapped to the newest 20, so the 4th 加载更早 jumped back down)
  if (chatRenderedFor !== UI.chat || chatFrom > list.length || (!chatHold && !chatMore && nearBottom && list.length - chatFrom > CHAT_N + 60)) chatFrom = Math.max(0, list.length - CHAT_N);
  chatMore = false;
  const view = list.slice(chatFrom);
  // t-mobile-crash A: the manager is "working" whenever it is online, and each ring is 3 infinite animations (= composited layers on iOS).
  // One ring per thread: only the newest message from someone else keeps it, older avatars are drawn idle.
  let ringAt = -1; for (let i = view.length - 1; i >= 0; i--) if (view[i].who !== "me") { ringAt = i; break; }
  const mav = (m, i) => { const x = agent(m.who); return av(i === ringAt ? x : Object.assign({}, x, { status: "idle" }), "sm"); };
  const moreN = chatFrom + olderN(UI.chat);   /* ri1105-P4: + messages still on the server */
  const more = moreN > 0 ? `<button class="ch-more" data-more>${UI.lang === "en" ? `Load earlier messages (${moreN})` : `加载更早的消息（还有 ${moreN} 条）`}</button>` : "";
  // r-improve-1102 P1: quick options on a message you have already answered (you wrote anything after it) fold to one quiet line
  const nextMe = []; { let nx = null; for (let k = list.length - 1; k >= 0; k--) { nextMe[k] = nx; if (list[k].who === "me") nx = list[k]; } }
  if (list.length && CHN.for !== UI.chat) { CHN.for = UI.chat; CHN.t = seenOf(UI.chat); CHN.on = !!CHN.t; CHN.fresh = true; }   // P4: captured on the first render with messages, before it marks the thread read
  let newAt = -1, newN = 0;
  if (CHN.on && CHN.for === UI.chat) {   // new = after both your read mark and your own last message (a reply sent from another device counts as read)
    const lastMe = list.reduce((t, m) => m.who === "me" && m.t > t ? m.t : t, ""), from = lastMe > CHN.t ? lastMe : CHN.t;
    newAt = view.findIndex(m => m.who !== "me" && m.t > from); if (newAt >= 0) newN = view.length - newAt; }
  const sepHTML = i => i !== newAt ? "" : `<div class="new-sep" data-newsep>${UI.lang === "en" ? `${newN} new message${newN > 1 ? "s" : ""} below · you last read ${whenH(CHN.t)}` : `以下 ${newN} 条是新消息 · 你上次看到 ${whenH(CHN.t)}`}</div>`;
  // t-option-quote: a reply that quotes this message folds it to 「你选了 X · time」; the plain "next message of yours" rule only applies when that
  // next message quotes nothing (one that quotes another message leaves these options open). Old messages have no reply_to: unchanged.
  const quoted = {}; for (const x of list) if (x.who === "me" && x.reply_to && !quoted[x.reply_to]) quoted[x.reply_to] = x;
  if (RQ.for !== UI.chat) { RQ.for = UI.chat; list.forEach(x => RQ.seen.add(x.id)); }
  const optsOf = (m, i) => { if (!m.options) return ""; const q = m.id && quoted[m.id]; if (q) return optDone(m.options, q.text, q.t);
    const r = nextMe[chatFrom + i]; if (!r || r.reply_to) return optChips(m.options, m.id, m.multi); return optDone(m.options, r.text); };
  const pendSt = m => m.st === "fail" ? `<span class="pend-x">${UI.lang === "en" ? "Not sent" : "没发出去"}</span><button type="button" class="pend-b" data-pend-retry="${m.pend}">${UI.lang === "en" ? "Retry" : "重试"}</button><button type="button" class="pend-b" data-pend-drop="${m.pend}">${UI.lang === "en" ? "Delete" : "删除"}</button>`
    : m.st === "ok" ? whenH(m.t) : (UI.lang === "en" ? "Sending…" : "发送中…");
  chatPatch(box, list.length ? [obTop, more].concat(view.map((m, i) => sepHTML(i) + (m.pend
    ? `<div class="msg me pend${m.st === "ok" ? " pend-ok" : m.st === "fail" ? " pend-fail" : ""}" data-t="${esc(m.t)}" data-pend="${m.pend}">${rqLine(m)}<div class="mb">${md(m.text)}${attHTML(m.attachments)}</div><div class="mt">${pendSt(m)}</div></div>`
    : m.who === "me"
    ? `<div class="msg me" data-t="${esc(m.t)}"${m.id ? ` data-mid="${esc(m.id)}"` : ""}>${rqLine(m)}<div class="mb">${md(m.text)}${attHTML(m.attachments)}</div><div class="mt">${whenH(m.t)}</div></div>`
    : `<div class="msg" data-t="${esc(m.t)}"${m.id ? ` data-mid="${esc(m.id)}"` : ""} data-who="${esc(m.who)}"><div class="mh">${mav(m, i)}${esc(aname(agent(m.who)))} <small>${whenH(m.t)}</small></div><div class="mb md">${chipParens(md(m.text))}${m.ask === "name" ? askName() : ""}</div>${attHTML(m.attachments)}
       ${optsOf(m, i)}</div>`)))
    : UI.chat === "manager" && window.Onboard ? [obTop, Onboard.chatEmpty()]   /* t-onboarding P0 ②: three examples instead of one line */
    : [`<div class="empty">${UI.chat === "manager" ? (UI.lang === "en" ? "Tell the manager what you want done." : "跟管家说你想做什么。") : (UI.lang === "en" ? "DM goes through the manager to this agent." : "私信会由管家转给这个角色。")}</div>`]);
  if (nearBottom) box.scrollTop = box.scrollHeight;
  const opened = !!CHN.fresh; CHN.fresh = false;
  chatRenderedFor = UI.chat; chatCount = sig;
  decorateDesk(box, list);
  newSepPlace(box, opened);
  if (nearBottom && !(opened && $("[data-newsep]", box) && box.scrollHeight - box.scrollTop - box.clientHeight > 80)) chatPinWatch(box);   /* t-ui-fix-p1 P2-6: late thumbnails / chips no longer leave a just-opened thread short of the bottom */
  if (real.length && (!document.body.dataset.mtab || (document.body.dataset.mtab === "chat" && document.body.dataset.cv === "thread"))) { UI.seen["chat." + UI.chat] = real[real.length - 1].t; LS.set("seen", UI.seen); chatMailRead(UI.chat, real[real.length - 1].t); }   /* t-perf C: read marks only from server messages */  // phones: only an open thread counts as read; P3: and the mailbox copies
}

// r-improve-1102 P4: on the desktop, opening a thread with more than a screen of new messages lands on the divider (the phone keeps
// t-dm-scroll: a thread always opens on the newest message; it only shows the divider). Reaching the bottom or sending clears it.
/* t-ui-fix-p1 (P1-1 + P2-6): keep the desktop thread on its newest message while it settles. Opening a DM pinned it, then a late thumbnail
   grew a message and left it ~48 px (up to ~220 px) short. Same idea as dwPinWatch: for 1.5 s any message that changes height re-pins, until you
   scroll, click or type in the list yourself. The phone keeps its own pin (mobile.js, user-scroll-only unpin). */
function chatPinWatch(box) {
  try {
    if (CP.ro) CP.ro.disconnect(); CP.ro = null;
    if (MOBQ.matches || !box || !box.isConnected || !box.clientHeight) return;
    CP.until = Date.now() + 1500; box.scrollTop = box.scrollHeight;
    if (!box._cpu) { box._cpu = 1; const stop = () => { CP.until = 0; }; ["wheel", "touchstart", "mousedown", "keydown"].forEach(t => box.addEventListener(t, stop, { passive: true })); }
    const ro = CP.ro = new ResizeObserver(() => { if (Date.now() > CP.until) { ro.disconnect(); return; } box.scrollTop = box.scrollHeight; });
    ro.observe(box); [...box.children].forEach(c => ro.observe(c));
    setTimeout(() => { if (Date.now() >= CP.until) ro.disconnect(); }, 1600);
  } catch { }
}
function newSepPlace(box, opened) {
  const r = $("#right"), sep = $("[data-newsep]", box); let pill = r && $(".new-pill", r);
  if (!sep) { if (pill) pill.remove(); return; }
  if (!box._nsep) { box._nsep = 1; box.addEventListener("scroll", () => { if (box._nsepArm && box.scrollHeight - box.scrollTop - box.clientHeight < 40 && CHN.on) { box._nsepArm = 0; CHN.on = false; const s = $("[data-newsep]", box); if (s) s.remove(); const p = $("#right .new-pill"); if (p) p.remove(); } }, { passive: true }); }
  if (!opened || MOBQ.matches) return;
  const below = box.getBoundingClientRect().bottom - sep.getBoundingClientRect().top + (box.scrollHeight - box.scrollTop - box.clientHeight);
  if (below <= box.clientHeight + 40) return;   // fits on one screen: stay at the bottom as before
  box.scrollTop += sep.getBoundingClientRect().top - box.getBoundingClientRect().top - 12; CP.until = 0;
  setTimeout(() => { box._nsepArm = 1; }, 300);   // only a scroll by you back down to the bottom clears it
  if (!pill && r) { r.insertAdjacentHTML("beforeend", `<button type="button" class="new-pill">${UI.lang === "en" ? "↓ Latest" : "↓ 回到最新"}</button>`); pill = $(".new-pill", r);
    pill.addEventListener("click", () => { box.scrollTo({ top: box.scrollHeight, behavior: "smooth" }); }); }
}

// t-agent-queue: the list behind a 「排队 N」 badge. Capture phase, so the row / avatar under the badge does not also open the chat.
const aqWait = (iso, en) => { const m = Math.max(1, Math.round((Date.now() - (Date.parse(iso) || Date.now())) / 6e4)), v = m < 60 ? [m, "分钟", "min"] : m < 1440 ? [Math.round(m / 60), "小时", "h"] : [Math.round(m / 1440), "天", "d"];
  return en ? `waiting ${v[0]} ${v[2]}` : `等了 ${v[0]} ${v[1]}`; };
function aqClose() { const p = $(".aq-pop"); if (p) p.remove(); }

/* t-onboard-name: the steward's first message after coming online asks what to call you (stateutil say-mgr --ask-name). Under that
   message: a name field, 「就叫这个」 and 「叫我『你』就行」. The answer goes to config.json owner.display_name (action owner_name); once
   a real name is set, or you chose 你, the row folds to one quiet line. A name already set (not empty, not <your name>) never shows the field. */
const ownerReal = () => { const n = String((ST.meta && ST.meta.owner) || "").trim(); return n && !n.startsWith("<") ? n : ""; };
function askName() {
  const en = UI.lang === "en", n = ownerReal(), sk = ST.meta && ST.meta.owner_ask === "skip";
  if (n) return `<div class="ask-nm done">✓ ${escN(en ? `I'll call you ${n}` : `以后叫你 ${n}`)}<small>${en ? " · saved in config.json; tell me to change it" : " · 存在 config.json，想改跟我说"}</small></div>`;
  if (sk) return `<div class="ask-nm done">✓ ${en ? "“You” it is" : "就叫你「你」"}<small>${en ? " · tell me a name any time" : " · 想换随时跟我说"}</small></div>`;
  return `<form class="ask-nm" data-ask-name><div class="ask-nm-r"><input type="text" name="nm" maxlength="40" autocomplete="nickname" enterkeyhint="done" aria-label="${en ? "Your name or nickname" : "你的名字或昵称"}" placeholder="${en ? "Your name or nickname" : "你的名字或昵称"}">`
    + `<button type="submit" class="ask-nm-go">${en ? "Use this" : "就叫这个"}</button></div>`
    + `<div class="ask-nm-r2"><button type="button" class="ask-nm-skip" data-ask-name-skip>${en ? "Just “you” is fine" : "叫我「你」就行"}</button><small>${en ? "Saved to config.json on this computer" : "存进这台电脑的 config.json"}</small></div></form>`;
}
async function askNameSend(form, body) {
  if (form.dataset.busy) return; form.dataset.busy = "1";
  try {
    await postAct("owner_name", body);   // locked actions answer {ok, inbox} only; the server trims the name the same way
    if (body.skip) ST.meta.owner_ask = "skip"; else { ST.meta.owner = body.name.split(/\s+/).filter(Boolean).join(" "); ST.meta.owner_ask = "done"; }
    document.querySelectorAll("[data-ask-name]").forEach(f => { f.outerHTML = askName(); });   // the desk column and the phone thread each have one
  } catch (e) { delete form.dataset.busy; toast((UI.lang === "en" ? "Not saved: " : "没存上：") + String(e.message || e), true); }
}
const escN = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function wireChat() {
  document.addEventListener("submit", e => {   // t-onboard-name
    const f = e.target.closest && e.target.closest("[data-ask-name]"); if (!f) return;
    e.preventDefault(); const v = (f.elements.nm.value || "").trim(); if (!v) { f.elements.nm.focus(); return; }
    askNameSend(f, { name: v });
  });
  document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-ask-name-skip]"); if (b) askNameSend(b.closest("[data-ask-name]"), { skip: true }); });
  // t-web-audit 06: under 900px the detail drawer covers the whole middle column
  try { const mn = $("#main"); new ResizeObserver(() => document.body.classList.toggle("main-narrow", mn.clientWidth < 900)).observe(mn); } catch { }
  document.addEventListener("click", e => {   // a click outside the pop-over closes it (dialogs and the viewer opened from it do not)
    if (!document.body.classList.contains("chat-pop")) return;
    if (e.target.closest("#right, #modal, #lb, #toast, .hc-chat, [data-chat]")) return;
    chatPop(false);
  }, true);
  NARROWQ.addEventListener("change", () => { if (!NARROWQ.matches) chatPop(false); });
  addEventListener("resize", () => { if (chatBuilt && !UI.chatFold) applyChatW(); });
  document.addEventListener("click", e => {   // card thread: ↩ on an answer scrolls to that question in 「要你拿主意」 and rings it
    const b = e.target.closest && e.target.closest("[data-rq-ask]"); if (b) askSeek(b.dataset.rqAsk);
  });
  MOBQ.addEventListener("change", () => { chatRenderedFor = null; if (ST) renderChat(); });   // crossing 760px: rebuild so the other layout decorates from scratch
  document.addEventListener("click", e => {
    const t = e.target.closest && e.target.closest("[data-aq]"), inPop = e.target.closest && e.target.closest(".aq-pop");
    if (inPop) { const r = e.target.closest("[data-aq-item]"); if (r) { e.preventDefault(); e.stopPropagation(); aqClose(); openItem(r.dataset.aqItem); } return; }
    aqClose(); if (!t) return;
    e.preventDefault(); e.stopPropagation();
    const id = t.dataset.aq, L = queueOf(id), en = UI.lang === "en", b = t.getBoundingClientRect(), p = document.createElement("div");
    p.className = "aq-pop"; p.setAttribute("role", "dialog");
    p.innerHTML = `<h4>${esc(aname(agent(id)))} · ${en ? `queued ${L.length}` : `排队 ${L.length}`}</h4>` + (L.map(i => `<button type="button" data-aq-item="${esc(i.id)}"><span>${esc(i.title)}</span><time>${aqWait(i.updated || i.created, en)}</time></button>`).join("") || `<p>${en ? "Nothing queued" : "没有排队的卡"}</p>`);
    document.body.appendChild(p);
    const w = p.offsetWidth, h = p.offsetHeight; p.style.left = Math.max(8, Math.min(b.left, innerWidth - w - 8)) + "px"; p.style.top = (b.bottom + h + 8 > innerHeight ? Math.max(8, b.top - h - 6) : b.bottom + 6) + "px";
  }, true);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && $(".aq-pop")) { e.stopPropagation(); aqClose(); } }, true);
  window.addEventListener("scroll", aqClose, { capture: true, passive: true });
}

export { chatAtt, chatBuilt, chatRenderedFor, chatCount, chatLang, setChatCount, CHN, CP, CHAT_N, chatFrom, chatHold, chatBottom, chatMore, setChatFrom, setChat, chatDraftLoad, chatList, CRS, crsLive, crsEdges, crsStops, crsGlide, crsSnap, crsShow, crsAfter, crsWire, buildChat, autoFold, NARROWQ, chatPop, chatCap, applyChatW, foldChat, PEND, isoNow, sendChat, pendPost, pendPaint, pendSync, pendOf, RQ, askSeek, rqLine, rqSeek, deskStamp, deskMeAv, deskMeName, decorateDesk, moreChat, phz, setSrc, deco, chatPatch, renderChat, chatPinWatch, newSepPlace, aqWait, aqClose, wireChat };
