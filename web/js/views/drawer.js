// Dashboard view: the card drawer (#drawer): open / close / back stack, the card body, versions, asks, comments, the reply dock, attachments
// and the library picker. Desktop docks it beside the page; the phone shows it full screen.
// t-oss-struct S10 (A3): moved out of app.js unchanged; wireDrawer() holds its top-level event wiring and app.js calls it where the code used to
// run, so listeners register in the same order as before.


// ---------- drawer ----------
// The thread reads like a chat: agent replies are cards, logs/events are centred lines, your messages are right bubbles,
// and each draft version is a card at the time it was submitted.
import { $, $$, DRAFT, LS } from "../core/util.js";
import { CATS, PLAT, STAGES, dayKey, hm, rowLabel, srvT, stageLabel, t, when, whenH, whoName } from "../core/i18n.js";
import { ARCH, ST, UI, archItem, archKnown, fullItem, grpOf, items, snoozed, snzEnd } from "../core/store.js";
import { agent, agents, aname, atitle, av, ringOnce } from "../core/av.js";
import { api, closeBtn, closeModal, modalClose, modalReject, openModal, stillUploading, toast } from "../core/ui.js";
import { ATT, ATT_IC, attHTML, attTiles, attTitle, copyText, wireUploads } from "./attach.js";
import { chatPop } from "./chat.js";
import { contentMode } from "./left.js";
import { MB, closeMailbox, itemMailRead, nrMail, nrRead } from "./mail.js";
import { MOBQ } from "./pages/common.js";
import { renderPage } from "./pages/index.js";
import { askBlock, askFold, askFoldWire, askGuard, askRow, awaitsUser, okAria, okDockIn, okDone, okLabel, okShort, openAsks } from "./pages/review.js";
import { RMQ, hooks, wkBand, workersOf } from "../app.js";
const drawerAtt = [];
const DW = { to: null, pop: [], sel: 0, open: new Set(), n: 0, fresh: false, stampPre: null, askOpen: new Set(), sumOpen: new Set() };   // askOpen / sumOpen: item ids (t-ui-next 1, 4)
const PHONE = matchMedia("(max-width: 760px)");
/* t-hdr-trim ⑨: desktop detail / DM box grows with its text up to max px, then scrolls (scrollbar hidden in style.css). Empty = CSS height.
   Measured with transition:none at height 0 (min-height clamps), and only when the text or width changed, because the drawer polls it every 300 ms. */
function deskFit(ta, max) {
  if (!ta || PHONE.matches) return;
  const v = ta.value, w = ta.clientWidth;
  if (v === ta._fv && w === ta._fw && ta.style.height === ta._fh) return; ta._fv = v; ta._fw = w;
  if (!v) { ta.style.height = ""; ta._fh = ""; return; }
  const st = ta.scrollTop, tr = ta.style.transition;
  ta.style.transition = "none"; ta.style.height = "0px";
  const h = Math.min(max, ta.scrollHeight + ta.offsetHeight - ta.clientHeight);
  ta.style.height = h + "px"; ta._fh = ta.style.height; void ta.offsetHeight; ta.style.transition = tr; ta.scrollTop = st;
}
const NR_HIT = 4500;   // t-detail-jump-fix: how long the 新回复 box stays (CSS nrHitFade fades it in the last part)
const nearEnd = sc => sc.scrollHeight - sc.scrollTop - sc.clientHeight < 60;
const dwPinned = () => DW.pin && Date.now() < DW.pinUntil;   // t-detail-jump
function dwPinEnd() { const sc = $("#drawer .dw-scroll"); if (!sc || !dwPinned()) return; sc.scrollTop = sc.scrollHeight; jumpState(); }
function dwPinWatch(sc) {   // re-armed on every render while pinned: any block that changes height (late images, folded drafts, previews) re-pins
  try { DW.cro && DW.cro.disconnect(); if (!dwPinned()) return; DW.cro = new ResizeObserver(dwPinEnd); [...sc.children].forEach(c => DW.cro.observe(c)); setTimeout(() => DW.cro && !dwPinned() && DW.cro.disconnect(), DW.pinUntil - Date.now() + 50); } catch { }
}
// t-parent-links: item -> item navigation (parent <-> child) keeps a small back stack, so back (button / swipe) returns to the card you came from.
// Any other way of opening or closing a card clears it.
let dwStack = [], dwNavDir = 0;
function navItem(id) { if (UI.item && UI.item !== id) dwStack.push(UI.item); dwNavDir = 1; openItem(id, true); }
function backItem() { if (!dwStack.length) return closeItem(); dwNavDir = -1; openItem(dwStack.pop(), true); }
// a card's parent = the first tag that is another item's id (child cards carry the parent id in tags, e.g. stateutil --tag t-ios-visual-audit)
const parentOf = it => { for (const x of it.tags || []) { if (x !== it.id) { const p = (ST.items || []).find(i => i.id === x); if (p) return p; } } return null; };
const childrenOf = it => (ST.items || []).filter(i => i.id !== it.id && parentOf(i) && parentOf(i).id === it.id).sort((a, b) => (a.created || "").localeCompare(b.created || ""));
// ===== t-m2-b ①: shared-element push (phone only). A tapped card grows into the detail page and the back button shrinks it back, via the
// View Transitions API (Safari 18+ / Chrome 111+). view-transition-name sits on ONE element at a time and only for the ~0.36 s of the transition
// (card -> #drawer on open, #drawer -> card on close), then it is removed. Anything else keeps the old slide: no API, reduced motion, card -> card
// inside the drawer, deep links / pushes (no tapped card), the finger back-swipe (it already moved the page) and iOS's own edge swipe (popstate).
const VT = { src: null, at: 0, back: false, cur: null };
// t-m2b-revert (2026-10-29): the user preferred the old slide (the cross-fade ghosted), so ① is switched OFF here. With VT_ON false, vtOK() is
// always false and openItem / closeItem take their old slide paths; the capture listener records nothing. The code stays dormant: flip to true to retry.
const VT_ON = false;
const vtOK = () => VT_ON && typeof document.startViewTransition === "function" && MOBQ.matches && !RMQ.matches && !document.hidden;
const vtSeen = el => { if (!el || !el.isConnected) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; };
function vtRun(update, from, to) {   // from: element named in the old state; to: element (or fn returning it) named in the new state
  if (VT.cur) { try { VT.cur.skipTransition(); } catch (e) {} }
  const de = document.documentElement, N = "m2-card";
  from.style.viewTransitionName = N; de.classList.add("vt-run");
  let vt;
  try {
    vt = document.startViewTransition(() => { from.style.viewTransitionName = ""; update(); const t = typeof to === "function" ? to() : to; if (t) t.style.viewTransitionName = N; VT.end = t; });
  } catch (e) { from.style.viewTransitionName = ""; de.classList.remove("vt-run"); update(); return; }
  VT.cur = vt;
  const done = () => { if (VT.cur === vt) VT.cur = null; if (VT.end) { VT.end.style.viewTransitionName = ""; VT.end = null; } from.style.viewTransitionName = ""; if (!VT.cur) de.classList.remove("vt-run"); };
  vt.ready.catch(() => {}); vt.updateCallbackDone.catch(() => {}); vt.finished.then(done, done);
}
function openItem(id, nav) {
  const src = !nav && VT.src && VT.src.dataset.item === id && performance.now() - VT.at < 800 && vtSeen(VT.src) ? VT.src : null; VT.src = null;
  const d = $("#drawer");
  if (src && vtOK() && (d.hidden || !d.classList.contains("open"))) return vtRun(() => openItemNow(id, nav), src, d);
  return openItemNow(id, nav);
}
function openItemNow(id, nav) {
  if (!nav) dwStack = [];
  UI.item = id; drawerAtt.length = 0; ATT.lastCard = id;   // t-lib-attach: 「刚才看的卡」
  { const un = nrMail(id).sort((x, y) => x.t.localeCompare(y.t)); DW.hitT = ""; DW.jumpT = un.length ? Date.parse(un[0].t) - 3000 : 0; if (un.length) { nrRead(un.map(m => m.id)); setTimeout(() => { if (UI.page === "review") renderPage(); }, 0); } }   // t-home-newreplies
  DW.to = null; DW.pop = []; DW.open = new Set(); DW.n = 0; DW.fresh = false;
  itemMailRead(id);   // r-improve-1102 P3: opening a card reads all of its mailbox entries, not only the new replies
  const dw = $("#drawer"); clearTimeout(DW.ct); const wasOpen = !dw.hidden && dw.classList.contains("open"); dw.hidden = false;
  dw.innerHTML = `<div class="dw-top"></div><div class="dw-scroll"></div><nav class="dw-toc" hidden></nav>
    <div class="dw-dock"><div class="dw-askbar" hidden></div><div class="composer"><div class="at-pop" hidden></div><div class="cm-field"><textarea placeholder="${esc(t("composer_ph"))}"></textarea><button type="button" class="dw-send" aria-label="${UI.lang === "en" ? "Send" : "发送"}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 3.5 3.6 10.4l6.6 2.9 2.9 6.6z"/><path d="m10.2 13.3 4.6-4.6"/></svg></button></div><div class="pending-att"></div>
      <div class="cm-row"><button type="button" class="dw-file att" title="${attTitle()}" aria-label="${UI.lang === "en" ? "Attach" : "添加附件"}">${ATT_IC}</button><input type="file" multiple hidden>
      <span class="cm-to"></span><span class="dim dw-def">${t("default_owner")}</span><span style="flex:1"></span><span class="dim">${t("send_hint")}</span></div></div>
    <div class="dw-acts"></div></div>`;
  askFoldWire($(".dw-askbar", dw));   // t-m-ask-sheet
  const ta = $(".composer textarea", dw), fi = $("input[type=file]", dw), pop = $(".at-pop", dw);
  const dk = "item:" + id, dSaved = DRAFT.get(dk);   // t-draft-keep
  const dTag = () => { const old = $(".dr-tag", dw); if (old) old.remove(); };
  if (dSaved) {
    ta.value = dSaved.t;
    $(".dw-dock", dw).insertAdjacentHTML("afterbegin", `<div class="dr-tag"><b>${UI.lang === "en" ? "Draft" : "草稿"}</b><span>${UI.lang === "en" ? "not sent yet" : "上次没发出"} · ${whenH(dSaved.at)}</span><button type="button">${UI.lang === "en" ? "Clear" : "清空"}</button></div>`);
    $(".dr-tag button", dw).onclick = () => { ta.value = ""; DRAFT.set(dk, ""); dTag(); ta.dispatchEvent(new Event("input", { bubbles: true })); ta.focus(); };
  }
  ta.addEventListener("input", () => { if (UI.item !== id) return; DRAFT.set(dk, ta.value); if (!ta.value.trim()) dTag(); });
  const showAtt = () => { attTiles($(".pending-att", dw), drawerAtt, showAtt); fit(); };   // ui19
  // t-detail-bottom (phone only): the field grows with its text (max 120px; works with IME composition, only the height is touched) and
  // .composer.has mirrors "text or attachment present" for CSS (send button lit, composer expanded). Polled like the chat composer, because send/approve clear the value without an input event.
  const fit = () => {
    const cm = $(".composer", dw); if (!cm) return;
    cm.classList.toggle("has", !!ta.value.trim() || drawerAtt.length > 0 || Object.keys(drawerAtt._up || {}).length > 0 || annList().length > 0);   // t-imp29-p2: notes alone can be sent; t-detail-send: also greys the desk plane
    if (!PHONE.matches) return deskFit(ta, 200);
    if (ta.value) { ta.style.height = "auto"; ta.style.height = Math.min(120, Math.max(40, ta.scrollHeight)) + "px"; } else ta.style.height = "";
  };
  ta.addEventListener("input", fit); clearInterval(DW.fi); DW.fi = setInterval(fit, 300);
  const add = wireUploads(ta, drawerAtt, showAtt);
  $(".dw-file", dw).onclick = () => fi.click();
  /* t-detail-send: the desk paper plane, as in the right-hand chat = the same ⌘↵ path below (phone keeps its own .m-send) */
  $(".dw-send", dw).onclick = () => { ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, ctrlKey: true, bubbles: true })); ta.focus(); };
  fi.onchange = () => { add(Array.from(fi.files)); fi.value = ""; };
  const closePop = () => { pop.hidden = true; DW.pop = []; };
  const drawPop = () => {
    pop.innerHTML = DW.pop.map((a, i) => `<div data-pick-to="${a.id}" class="${i === DW.sel ? "on" : ""}">${av(a, "sm")}${esc(aname(a))} <small>${esc(atitle(a))}${a.id === curItem().owner ? " · " + t("owner_tag") : ""}</small></div>`).join("");
    pop.hidden = !DW.pop.length;
    const on = $("div.on", pop); if (on) on.scrollIntoView({ block: "nearest" });   // arrow keys can reach rows below the fold
  };
  const pick = id => {
    const a = agent(id), pos = ta.selectionStart, before = ta.value.slice(0, pos).replace(/@[^\s@]*$/, "@" + aname(a) + " ");
    ta.value = before + ta.value.slice(pos); ta.setSelectionRange(before.length, before.length);
    DW.to = id; closePop(); drawTo(); ta.focus();
  };
  pop.addEventListener("mousedown", e => { const d = e.target.closest("[data-pick-to]"); if (d) { e.preventDefault(); pick(d.dataset.pickTo); } });
  { // t-sendto-chip: clicking the 「发给」 chip = typing "@" at the caret (opens the same picker); mousedown keeps the textarea focus
    const toBox = $(".cm-to", dw);
    toBox.addEventListener("mousedown", e => { if (!e.target.closest("[data-to-reset]")) e.preventDefault(); });
    toBox.addEventListener("click", e => {
      if (e.target.closest("[data-to-reset]")) return;
      const go = () => {
        const a0 = ta.selectionStart ?? ta.value.length, a1 = ta.selectionEnd ?? a0, pre = ta.value.slice(0, a0);
        ta.focus(); ta.setRangeText((pre && !/\s$/.test(pre) ? " " : "") + "@", a0, a1, "end"); ta.dispatchEvent(new Event("input"));
      };
      if (document.activeElement === ta) go(); else { ta.focus(); setTimeout(go, 170); }   // after the blur timer (150ms) that closes the picker
    });
  }
  ta.addEventListener("input", () => {
    const m = ta.value.slice(0, ta.selectionStart).match(/(^|\s)@([^\s@]*)$/);
    if (!m) return closePop();
    const q = m[2].toLowerCase(), own = curItem().owner;
    DW.pop = agents().filter(a => a.enabled !== false && (!q || [aname(a), a.name, a.name_en, a.id].some(n => n && String(n).toLowerCase().startsWith(q))))
      .sort((a, b) => (b.id === own) - (a.id === own));   /* t-mention-hires: no cap; a cap of 8 hid every role hired after the first eight (food, buyer, xingzhe). The list scrolls. */
    DW.sel = 0; drawPop();
  });
  ta.addEventListener("blur", () => setTimeout(closePop, 150));
  ta.addEventListener("keydown", async e => {
    if (e.isComposing || e.keyCode === 229) return;  // IME is still composing (pinyin): Enter / arrows belong to the IME
    if (DW.pop.length && !pop.hidden && !(e.metaKey || e.ctrlKey)) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); DW.sel = (DW.sel + (e.key === "ArrowDown" ? 1 : -1) + DW.pop.length) % DW.pop.length; return drawPop(); }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); return pick(DW.pop[DW.sel].id); }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); return closePop(); }
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault(); const text = annWrap(ta.value.trim()); if (!text && !drawerAtt.length) return;   // t-imp29-p2: notes go out in front
      if (stillUploading(drawerAtt)) return toast(UI.lang === "en" ? "Still uploading…" : "文件还在上传……");
      if (DW.sending) return;   // t-detail-send: a second ⌘↵ / plane tap while the first comment is in flight does not post it twice
      const to = DW.to || curItem().owner, aid = UI.item;
      DW.sending = true;
      try { await api("comment", { item: UI.item, text, to, attachments: drawerAtt.slice() }); } finally { DW.sending = false; }
      annClear(aid); DRAFT.set("item:" + aid, ""); dTag();
      ta.value = ""; drawerAtt.length = 0; showAtt(); DW.to = null; drawTo(); closePop();
      const sc = $(".dw-scroll", dw); sc.scrollTop = sc.scrollHeight; jumpState();
    }
  });
  $(".dw-scroll", dw).addEventListener("scroll", jumpState, { passive: true });
  TOC.key = ""; TOC.item = null; $(".dw-scroll", dw).addEventListener("scroll", () => { if (!TOC.raf) TOC.raf = requestAnimationFrame(() => { TOC.raf = 0; tocSync(); }); }, { passive: true });   // t-ri1103-p4
  { // t-detail-jump: a card opens at its newest message and stays pinned there for the first few seconds while images / files / drafts
    // finish loading (load events + a ResizeObserver, see dwPinWatch). Any touch, wheel or key in the scroller unpins it at once, so a
    // user reading further up is never pulled down; after that the old rule applies (follow new messages only when already at the end).
    const sc = $(".dw-scroll", dw); DW.pin = true; DW.pinUntil = Date.now() + 4000;
    const unpin = () => { DW.pin = false; }; ["wheel", "touchstart", "keydown", "mousedown"].forEach(k => sc.addEventListener(k, unpin, { passive: true }));
    sc.addEventListener("load", dwPinEnd, true); }
  renderDrawer(true);
  try { DW.ro && DW.ro.disconnect(); const dk = $(".dw-dock", dw); DW.ro = new ResizeObserver(() => { dw.style.setProperty("--dock-h", dk.offsetHeight + "px"); dwPinEnd(); }); /* t-ask-bottom: the dock can grow (question bar) while the card is pinned to its newest message */ DW.ro.observe(dk); } catch { }   // phone CSS pads the scroller by the dock height
  if (!matchMedia("(max-width: 760px)").matches) ta.focus({ preventScroll: true });  // phones: don't pop the keyboard
  slideIn(dw, wasOpen);
  dw.classList.toggle("dw-has-back", dwStack.length > 0);   // desktop shows the back button only when there is a card to go back to
  if (wasOpen && dwNavDir) {   // t-parent-links: card -> card inside the open drawer: the new content slides in from the side you are heading (translate + opacity, --m-move)
    const d = dwNavDir, rm = matchMedia("(prefers-reduced-motion: reduce)").matches, cs = getComputedStyle(document.documentElement);
    const dur = rm ? 140 : (parseFloat(cs.getPropertyValue("--m-move")) || 330), ease = cs.getPropertyValue("--m-ease-std").trim() || "ease-out";
    try { $(".dw-scroll", dw).animate(rm ? [{ opacity: 0 }, { opacity: 1 }] : [{ transform: `translateX(${d * 28}px)`, opacity: 0 }, { transform: "none", opacity: 1 }], { duration: dur, easing: ease }); } catch { }
  }
  dwNavDir = 0;
  hooks.forEach(f => f("drawer"));
}
const curItem = () => (ST.items || []).find(i => i.id === UI.item) || {};
function drawTo() {
  const dw = $("#drawer"), boxes = $$(".cm-to", dw); if (!boxes.length) return;
  const a = agent(DW.to || curItem().owner || "manager");
  const chip = `${t("send_to")} ${av(a, "sm")}<b>@${esc(aname(a))}</b>${DW.to ? `<button data-to-reset title="${t("default_owner")}">✕</button>` : ""}`;
  boxes.forEach(b => { b.innerHTML = chip; });   // every chip together
  const cm = $(".composer", dw); if (cm) cm.classList.toggle("to-set", !!DW.to);
  const d = $(".dw-def", dw); if (d) d.hidden = !!DW.to;
}
function jumpState() {
  const sc = $("#drawer .dw-scroll"); if (!sc) return;
  const top = $("#drawer [data-jump=top]"), end = $("#drawer [data-jump=end]");
  if (nearEnd(sc)) DW.fresh = false;
  if (top) top.hidden = sc.scrollTop < 200;
  if (end) { end.hidden = nearEnd(sc); const dot = $(".new", end); if (dot) dot.hidden = !DW.fresh; }
}
// ===== t-ri1103-p4 (2026-11-03): 长草稿目录. When the current draft has 4+ h1/h2 headings, a floating list sits under the category button:
// a tap scrolls to that heading, the section being read is lit, and the bar shows how far through the draft you are (bottom of the view vs the draft).
// Desktop: open by default when the detail is at least 680px wide; 收起 / 展开 is remembered (localStorage rt.toc). Phone (mobile.css): a small
// 「目录」 pill above the reply box, a tap opens the same list as a bottom sheet. The nav lives outside .dw-scroll, so a poll re-render only rebuilds
// its list when the headings change. It only scrolls on a tap, so it never fights the open-at-newest pin (t-detail-jump).
const TOC = { hs: [], card: null, key: "", item: null, open: false, cur: null, raf: 0, auto: false, off: null };   /* auto / off: t-ri1110-a P1 */
const tocOff = sc => PHONE.matches ? (parseFloat(getComputedStyle(sc).paddingTop) || 0) : 0;
function tocMode() {
  const nav = $("#drawer .dw-toc"); if (!nav) return;
  const apply = () => { nav.classList.toggle("open", !!TOC.open); const b = $("[data-toc-tg]", nav); if (b) b.setAttribute("aria-expanded", String(!!TOC.open)); };
  if (!TOC.open && nav.classList.contains("open") && window.Glass) return Glass.out(nav, apply);   /* t-toc-glass: close animation first (glass.js) */
  apply();
}
function tocBuild() {
  const dw = $("#drawer"), nav = dw && $(".dw-toc", dw), sc = dw && $(".dw-scroll", dw); if (!nav || !sc) return;
  const card = $('.cs-card.draftc[data-vkey="cur"]', sc), hs = card ? $$(".md h1, .md h2", card) : [];
  TOC.hs = hs; TOC.card = card;
  if (hs.length < 4) { if (!nav.hidden) { nav.hidden = true; nav.innerHTML = ""; } TOC.key = ""; return; }
  const zh = UI.lang !== "en", key = UI.item + "|" + UI.lang + "|" + hs.map(h => h.tagName + h.textContent).join("\n");
  if (TOC.item !== UI.item) { TOC.item = UI.item; TOC.auto = false; TOC.off = null; let pref = ""; try { pref = localStorage.getItem("rt.toc") || ""; } catch { } TOC.open = PHONE.matches ? false : pref ? pref === "open" : dw.clientWidth >= 680; }
  if (key !== TOC.key) {
    TOC.key = key; TOC.cur = null;
    nav.setAttribute("aria-label", zh ? "目录" : "Contents");
    nav.innerHTML = `<div class="toc-scrim" data-toc-close></div><div class="toc-box"><button type="button" class="toc-h" data-toc-tg aria-expanded="false"><span class="k">${zh ? "目录" : "Contents"}</span><span class="n">· ${hs.length}</span><span class="sp"></span><span class="pc"></span><svg class="chev" viewBox="0 0 10 6" width="10" height="6" aria-hidden="true"><path d="M1 5l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`
      + `<ol class="toc-l">${hs.map((h, i) => `<li><button type="button" class="${h.tagName === "H1" ? "l1" : "l2"}" data-toc="${i}" title="${esc(h.textContent)}">${esc(h.textContent)}</button></li>`).join("")}</ol><div class="toc-bar"><i></i></div></div>`;
  }
  nav.hidden = false; tocMode();
  const top = $(".dw-top", dw); if (top) nav.style.setProperty("--toc-top", (top.offsetTop + top.offsetHeight + 6) + "px");
  tocSync();
}
function tocSync() {
  const nav = $("#drawer .dw-toc"), sc = $("#drawer .dw-scroll"); if (!nav || nav.hidden || !sc || !TOC.hs.length) return;
  const m = TOC.card && $(".md", TOC.card); if (!m || !m.isConnected) return;
  const sr = sc.getBoundingClientRect(), mr = m.getBoundingClientRect(), line = sr.top + tocOff(sc) + 40;
  let cur = -1; TOC.hs.forEach((h, i) => { if (h.getBoundingClientRect().top <= line) cur = i; });
  const pc = mr.height ? Math.round(Math.max(0, Math.min(1, (sr.bottom - mr.top) / mr.height)) * 100) : 0;
  /* t-ri1109-a P2 + t-ri1110-a P3: the draft is "off" once its text (.md, or the card when that ends first) is above the view; the 24px
     slack lets the card's own 收起 strip stay peeking under the phone top bar. Phone: the pill fades. t-ri1110-a P1, desk: an open panel
     folds to its header line while the draft is off (it sat on the right-aligned 我 replies) and opens again when the draft comes back,
     unless the user toggled it meanwhile (TOC.auto); the auto fold is not written to rt.toc. */
  const off = Math.min(mr.bottom, TOC.card.getBoundingClientRect().bottom) < sr.top + tocOff(sc) + 24;
  if (!PHONE.matches && off !== TOC.off) {   /* only on a change, so a panel the user opens down in the thread stays open */
    TOC.off = off;
    if (off && TOC.open) { TOC.open = false; TOC.auto = true; tocMode(); }
    else if (!off && TOC.auto) { TOC.auto = false; TOC.open = true; tocMode(); }
  }
  /* t-ri1111-a P4: at the very bottom the pill would sit on the last thread line (scrolling cannot clear it), so it steps aside there too */
  const atEnd = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 8;
  nav.classList.toggle("away", !TOC.open && (off || (PHONE.matches && atEnd)));   /* t-ui-fix-r3 R3-08: desk too: the folded pill sat on the first thread bubble once the draft was read */
  if (TOC.cur !== cur) {
    TOC.cur = cur; $$("[data-toc]", nav).forEach((b, i) => b.classList.toggle("on", i === cur));
    if (window.Glass) Glass.toc(nav);   /* t-toc-glass: slide the indicator to the lit line */
    const l = $(".toc-l", nav), b = cur >= 0 && $(`[data-toc="${cur}"]`, nav);   // keep the lit line inside the list's own scroll
    if (l && b && l.clientHeight && (b.offsetTop < l.scrollTop || b.offsetTop + b.offsetHeight > l.scrollTop + l.clientHeight)) l.scrollTop = b.offsetTop - l.clientHeight / 2;
  }
  const bar = $(".toc-bar i", nav), t0 = $(".pc", nav);
  if (bar) bar.style.width = pc + "%";
  if (t0) t0.textContent = (UI.lang === "en" ? "" : "读到 ") + pc + "%";
}
function tocGo(i) {
  const sc = $("#drawer .dw-scroll"); if (!sc) return;
  DW.pin = false;   // t-detail-jump: a tap on the list is a deliberate move, never pulled back to the newest message
  if (TOC.card && TOC.card.classList.contains("folded")) { DW.open.delete("xcur"); renderDrawer(); DW.pin = false; }   // folded current draft: unfold first (the re-render re-pins when the view was at the end)
  if (PHONE.matches) { TOC.open = false; tocMode(); }
  const h = TOC.hs[i]; if (!h || !h.isConnected) return;
  sc.scrollTop = Math.max(0, h.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - tocOff(sc) - 14);
  tocSync(); jumpState();
}
// ===== t-ri1103-p5 (2026-11-03): ⌘K hits on drafts / card talk open the card AT that sentence. sp = { vkey, q, nth } (a draft version,
// unfolded if needed) or { ti, q, nth } (thread entry index, data-ti). The words get a short flash (mark.seek-hit, removed after 2.6 s; a poll
// re-render drops it too). Unpins t-detail-jump; re-aligns twice while late images settle unless you scrolled in between.
function seekRange(root, q, nth) {
  if (!q) return null;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n, k = 0, first = null;
  while ((n = w.nextNode())) { const s = n.nodeValue.toLowerCase(); let i = s.indexOf(q);
    while (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + q.length); if (!first) first = r; if (k++ === nth) return r; i = s.indexOf(q, i + q.length); } }
  return first;
}
function seekItem(id, sp) {
  openItem(id);
  let tries = 0, set = -1;
  const find = () => {
    const sc = $("#drawer .dw-scroll"); if (!sc || UI.item !== id) return null;
    if (sp.vkey) {
      const key = sp.vkey === "cur" ? "xcur" : sp.vkey, folded = sp.vkey === "cur" ? DW.open.has(key) : !DW.open.has(key);
      if (folded && $(`.cs-card.draftc[data-vkey="${sp.vkey}"]`, sc)) { sp.vkey === "cur" ? DW.open.delete(key) : DW.open.add(key); renderDrawer(); }
      return $(`.cs-card.draftc[data-vkey="${sp.vkey}"] .md`, sc);
    }
    return $(`[data-ti="${sp.ti}"]`, sc);
  };
  const place = (flash) => {
    const sc = $("#drawer .dw-scroll"), blk = find(); if (!sc || !blk) return false;
    DW.pin = false; DW.jumpT = 0;
    if (flash && TOC.open) { TOC.open = false; tocMode(); }   // t-ri1103-p4's floating list would sit on the sentence: fold it for this visit (not remembered)
    const old = $("mark.seek-hit", sc); if (old && flash) old.replaceWith(...old.childNodes);
    let r = seekRange(blk, sp.q, sp.nth || 0), mk = null;
    if (r && flash) { try { mk = document.createElement("mark"); mk.className = "seek-hit"; r.surroundContents(mk); } catch { mk = null; } }
    const box = (mk || (r && r.getBoundingClientRect().height ? r : null) || blk).getBoundingClientRect();
    sc.scrollTop = set = Math.max(0, sc.scrollTop + box.top - sc.getBoundingClientRect().top - Math.min(160, sc.clientHeight * 0.3));
    jumpState();
    if (flash) { const card = blk.closest(".cs-card, .cs-me, .cs-line") || blk; card.classList.remove("seek-blk"); void card.offsetWidth; card.classList.add("seek-blk");
      setTimeout(() => { card.classList.remove("seek-blk"); if (mk && mk.isConnected) mk.replaceWith(...mk.childNodes); }, 2600); }
    return true;
  };
  const go = () => { if (UI.item !== id) return;
    const it = (ST.items || []).find(i => i.id === id); if (it && it.slim && ++tries < 20) return setTimeout(go, 150);   // slim (phone, done card): wait for /api/item, its re-render jumps to the end
    if (place(true)) { [400, 1200].forEach(ms => setTimeout(() => { const sc = $("#drawer .dw-scroll"); if (sc && UI.item === id && Math.abs(sc.scrollTop - set) < 2) place(false); }, ms)); }
    else if (++tries < 20) setTimeout(go, 150); };   // a slim (done) card's drafts arrive a moment later from /api/item
  go();
}
// ⌘K hit in a chat: once the conversation is drawn, scroll to that message and flash it (only if it is among the rendered ones)
function seekChat(t0, q) {
  let tries = 0;
  const go = () => {
    const box = $("#right .ch-msgs"), m = box && box.querySelector(`.msg[data-t="${CSS.escape(t0)}"]`);
    if (!m) { if (++tries < 10) setTimeout(go, 120); return; }
    const mb = $(".mb", m) || m, r = seekRange(mb, q, 0); let mk = null;
    if (r) { try { mk = document.createElement("mark"); mk.className = "seek-hit"; r.surroundContents(mk); } catch { mk = null; } }
    box.scrollTop = Math.max(0, box.scrollTop + m.getBoundingClientRect().top - box.getBoundingClientRect().top - Math.min(140, box.clientHeight * 0.3));
    m.classList.add("seek-blk"); setTimeout(() => { m.classList.remove("seek-blk"); if (mk && mk.isConnected) mk.replaceWith(...mk.childNodes); }, 2600);
    if (redo < 3) setTimeout(() => { if (!m.isConnected) { redo++; tries = 0; go(); } }, 350);   // the chat column re-drew right after opening: place it again
  };
  let redo = 0; setTimeout(go, 60);
}
// one stream: thread entries + every draft version, by time; a "submitted for review" event next to a draft folds into its card
function streamOf(it) {
  const ms = x => Date.parse(x) || 0;
  const th = (it.thread || []).map((e, i) => ({ ...e, _i: i }));
  const drafts = (it.versions || []).map((v, i) => ({ kind: "draft", t: v.t, text: v.draft, label: v.label, vkey: "v" + i, old: true, atts: v.attachments }));
  if (it.draft) drafts.push({ kind: "draft", t: it.draft_at || it.updated, text: it.draft, label: it.draft_label, vkey: "cur", old: false, dkind: it.kind, atts: it.draft_attachments }); // ui6
  const used = new Set();
  for (const d of drafts) {
    const sub = th.filter(e => e.kind === "event" && /submitted for review/.test(e.text) && !used.has(e._i) && Math.abs(ms(e.t) - ms(d.t)) < 10 * 60e3)
      .sort((a, b) => Math.abs(ms(a.t) - ms(d.t)) - Math.abs(ms(b.t) - ms(d.t)))[0];
    if (sub) { used.add(sub._i); d.who = sub.who; d.t = sub.t > d.t ? sub.t : d.t; } else d.who = it.owner;
  }
  return th.filter(e => !used.has(e._i)).concat(drafts).sort((a, b) => ms(a.t) - ms(b.t));
}
// ui6: files bound to a version render in that version's card; the top list only keeps unbound ones (collapsed once any are bound)
function topFiles(it) {
  const all = it.attachments || [];
  if (!all.length) return "";
  const bound = new Set((it.versions || []).concat([{ attachments: it.draft_attachments }]).flatMap(v => v.attachments || []));
  if (!bound.size) return `<div class="sec-h">${t("attachments")}</div>${attHTML(all)}`;
  const rest = all.filter(x => !bound.has(x));
  if (!rest.length) return "";
  return `<details class="topfiles"><summary>${t("attachments")} · ${rest.length}</summary>${attHTML(rest)}</details>`;
}
// ===== t-imp-p2: 这一版改了什么 — the current draft diffed against an older version (default: the one right before it).
// Lives inside the current draft card, above the text. Open by default while the item waits for review; the base version is picked with a native select.
function vdBlock(it) {
  const vs = it.versions || []; if (!vs.length || !it.draft || !window.VDiff) return "";
  const zh = UI.lang !== "en";
  if (!DW.vd || DW.vd.id !== it.id) DW.vd = { id: it.id, base: vs.length - 1, open: it.stage === "review" };
  const st = DW.vd, bi = Math.min(st.base, vs.length - 1), base = vs[bi], r = VDiff.html(base.draft || "", it.draft, zh);
  const sel = `<select class="vd-base" data-vd-base aria-label="${zh ? "对比哪一版" : "Compare with"}">${vs.map((v, i) => `<option value="${i}" ${i === bi ? "selected" : ""}>${esc((`v${i + 1}` + (v.label ? " · " + v.label : "")).slice(0, 42))}</option>`).join("")}</select>`;
  const t0 = base.t || "", t1 = it.draft_at || it.updated || "";   // what the user said between the two drafts (usually the reject reason): the newest one
  const said = (it.thread || []).filter(x => x.who === "me" && x.kind !== "event" && x.t > t0 && x.t <= t1).pop();
  return `<div class="vd${st.open ? " open" : ""}"><button type="button" class="vd-h" data-vd-toggle aria-expanded="${st.open}"><b>${zh ? "这一版改了什么" : "What changed"}</b><span class="vd-n"><i class="a">+${r.add}</i><i class="d">−${r.del}</i></span><span class="sp"></span><span class="vd-tg">${st.open ? (zh ? "收起" : "Hide") : (zh ? "看改动" : "Show")}</span></button>
    ${st.open ? `<div class="vd-sub">${zh ? "对比" : "Base"} ${sel}<span>→ ${zh ? "当前这一版" : "current"}</span></div>${said ? `<div class="vd-said"><span>${zh ? "你说过" : "You said"}</span>${esc(String(srvT(said.text, said.kind !== "msg") || "").slice(0, 160))}</div>` : ""}
    <div class="vd-body">${r.add + r.del ? r.html : `<div class="vd-l vd-gap">${zh ? "和这一版内容一样" : "Same text"}</div>`}</div>` : ""}</div>`;
}
function entryHTML(e, it) {
  const acc = e.who && e.who !== "me" ? (agent(e.who).color || "") : "";
  if (e.kind === "draft") {
    const open = e.old ? DW.open.has(e.vkey) : !DW.open.has("x" + e.vkey);
    const dk = e.dkind && e.dkind !== "task" ? t("k_" + e.dkind) : (e.old ? "" : t("k_task"));
    const conf = !e.old && it.confidence ? `<div class="conf">${t("confidence")} <b>${esc(it.confidence)}</b>${it.confidence_note ? ": " + esc(it.confidence_note) : ""}</div>` : "";
    return `<div class="cs-card draftc ${e.dkind === "deliverable" ? "deliverable" : ""} ${e.old ? "old" : ""} ${open ? "" : "folded"}" data-vkey="${e.vkey}">
      <div class="cs-h">${av(agent(e.who), "sm")}<span class="nm">${esc(whoName(e.who))}</span><span class="at">@${esc(whoName("me"))}</span><span class="tm">· ${hm(e.t)}</span>
        ${e.old ? `<span class="dtag dold">${UI.lang === "en" ? "Older" : "旧版"}</span>` : ""}${dk ? `<span class="dtag">${esc(dk)}</span>` : ""}${e.label ? `<span class="dlabel">${esc(e.label)}</span>` : ""}<span class="sp"></span><button data-copy-v="${e.vkey}">${t("copy")}</button></div>
      ${conf}${e.vkey === "cur" ? vdBlock(it) + (window.HT ? HT.diffBlock(it) : "") : ""}<div class="md">${md(e.text)}</div>${(e.atts || []).length ? `<div class="vatt">${attHTML(e.atts)}</div>` : ""}<button class="cs-more" data-fold="${e.vkey}">${open ? t("collapse") + " ▴" : t("expand") + " ▾"}</button></div>`;
  }
  if (e.kind === "msg" && e.who === "me") {
    const to = e.to || "manager";
    const aq = /^(回答|改选) · ([\s\S]+) → ([^\n]+)$/.exec(e.text || ""), aid = String(e.reply_to || "").startsWith("ask:") ? e.reply_to.slice(4) : "";   // t-option-quote (old answers: display only)
    const tg = aid ? "button" : "div", body = aq ? `<${tg}${aid ? ` type="button" data-rq-ask="${esc(aid)}"` : ""} class="rq rq-ask" title="${esc(aq[2])}"><i aria-hidden="true">↩</i><b>${esc(whoName(to))}</b><span>${UI.lang === "en" ? "Q: " : "问："}${esc(aq[2])}</span></${tg}><div class="md">${aq[1] === "改选" ? (UI.lang === "en" ? "Changed to: " : "改选：") : ""}${esc(aq[3])}</div>` : `<div class="md">${md(e.text)}</div>`;
    return `<div class="cs-me" data-ti="${e._i}"><div class="cs-h"><span class="nm">${esc(whoName("me"))}</span><span class="at">@${esc(whoName(to))}</span><span class="tm">· ${hm(e.t)}</span></div>
      ${body}${attHTML(e.attachments)}</div>`;
  }
  if (e.kind === "msg") {
    return `<div class="cs-card" data-t="${esc(e.t)}" data-ti="${e._i}" style="--acc:${esc(acc)}"><div class="cs-h">${av(agent(e.who), "sm")}<span class="nm">${esc(whoName(e.who))}</span><span class="at">@${esc(whoName(e.to || "me"))}</span><span class="tm">· ${hm(e.t)}</span></div>
      <div class="md">${md(e.text)}</div>${attHTML(e.attachments)}</div>`;
  }
  return `<div class="cs-line ${esc(e.kind || "")}" data-ti="${e._i}"><div class="in"><span class="tm">${hm(e.t)}</span>${e.who === "me" ? av("me", "sm") : av(agent(e.who), "sm")}<span class="nm">${esc(whoName(e.who))}</span><span class="tx">${md.refs(esc(e.kind === "event" ? evText(e.text) : srvT(e.text, true)))}${attHTML(e.attachments)}</span></div></div>`;
}
// t-event-zh: system lines in a card's 动态 read in Chinese (display only; state keeps the original text).
// "stage todo → doing" -> 「开工 · 待办 → 进行中」 (verb by the target stage), "created · X" -> 「建卡 · X」. English UI keeps the original.
const EV_VERB = { doing: "开工", done: "关单", todo: "放回待办", review: "交审", waiting: "转为等别人" };
const EV_VERB_EN = { doing: "Started", done: "Closed", todo: "Back to to-do", review: "Sent for review", waiting: "Now waiting on others" };   /* t-i18n-a */
function evText(x) {
  x = String(x || "");
  if (UI.lang === "en") {
    const e = x.match(/^stage (\S+) → (\S+)(.*)$/s);
    return e ? `${e[1] === "done" && e[2] !== "done" ? "Reopened" : EV_VERB_EN[e[2]] || "Stage changed"} · ${stageLabel(e[1])} → ${stageLabel(e[2])}${e[3]}` : srvT(x, true);   /* t-i18n-b */
  }
  let m = x.match(/^stage (\S+) → (\S+)(.*)$/s);
  if (m) return `${m[1] === "done" && m[2] !== "done" ? "重开" : EV_VERB[m[2]] || "改阶段"} · ${stageLabel(m[1])} → ${stageLabel(m[2])}${m[3]}`;
  m = x.match(/^created( · .*)?$/s); if (m) return "建卡" + (m[1] || "");
  return x;
}
// ui1-B: the detail is a slide-over. open = add .open (transform transition); close = remove it, then hide after the exit animation.
// The list behind is never re-rendered on close, so its scroll position stays put.
function scrim() {
  let sc = $("#scrim");
  if (!sc) { sc = document.createElement("div"); sc.id = "scrim"; sc.hidden = true; $("#main").insertBefore(sc, $("#drawer")); sc.addEventListener("click", () => closeItem()); }
  return sc;
}
// ui1b: drag the drawer's left edge to resize (desktop). Width lives in --dw-w on #drawer (class .sized); saved in localStorage.
const DW_MIN = 520, DW_KEY = "dwWidth";
function dwMax() { const m = $("#main"); return Math.max(DW_MIN, (m ? m.clientWidth : 1200) - 80); }
function dwApply(dw, w) { if (w == null) { dw.classList.remove("sized"); dw.style.removeProperty("--dw-w"); return; } dw.style.setProperty("--dw-w", Math.round(Math.min(dwMax(), Math.max(DW_MIN, w))) + "px"); dw.classList.add("sized"); }
function dwSaved() { try { const v = parseFloat(localStorage.getItem(DW_KEY)); return v > 0 ? v : null; } catch (e) { return null; } }
function dwSave(w) { try { if (w == null) localStorage.removeItem(DW_KEY); else localStorage.setItem(DW_KEY, String(Math.round(w))); } catch (e) {} }
function dwGrip(dw) {
  let g = $("#dw-grip", dw);
  const gt = UI.lang === "en" ? "Drag to resize · double-click to reset" : "拖动调宽 · 双击恢复默认";
  if (g) { g.title = gt; return g; }
  g = document.createElement("div"); g.id = "dw-grip"; g.title = gt; dw.appendChild(g);
  let sx = 0, sw = 0, id = null;
  g.addEventListener("pointerdown", e => {
    if (e.button != null && e.button > 0) return;
    id = e.pointerId; sx = e.clientX; sw = dw.getBoundingClientRect().width;
    try { g.setPointerCapture(id); } catch (_) {}
    g.classList.add("drag"); dw.classList.add("resizing"); document.body.classList.add("dw-resizing"); e.preventDefault();
  });
  g.addEventListener("pointermove", e => { if (id !== e.pointerId) return; dwApply(dw, sw + (sx - e.clientX)); });
  const end = e => {
    if (id !== e.pointerId) return; id = null;
    g.classList.remove("drag"); dw.classList.remove("resizing"); document.body.classList.remove("dw-resizing");
    const w = dw.getBoundingClientRect().width; if (dw.classList.contains("sized")) dwSave(w);
  };
  g.addEventListener("pointerup", end); g.addEventListener("pointercancel", end);
  g.addEventListener("dblclick", () => { dwApply(dw, null); dwSave(null); });
  return g;
}
function slideIn(dw, wasOpen) {
  const sc = scrim(); sc.hidden = false;
  dwGrip(dw); { const w = dwSaved(); if (w) dwApply(dw, w); else dwApply(dw, null); }
  if (!wasOpen) { void dw.offsetWidth; void sc.offsetWidth; }
  dw.classList.add("open"); sc.classList.add("open");
}
function closeItem(silent) {
  const back = VT.back; VT.back = false;   // t-m2-b ①: only the back button shrinks the page into its card
  const d0 = $("#drawer"), id0 = UI.item;
  if (back && id0 && !d0.hidden && vtOK()) {
    const card = [...document.querySelectorAll(`#page [data-item="${CSS.escape(id0)}"]`)].find(vtSeen);
    if (card) return vtRun(() => { closeItemNow(silent); clearTimeout(DW.ct); d0.hidden = true; d0.innerHTML = ""; scrim().hidden = true; }, d0, card);
  }
  return closeItemNow(silent);
}
function closeItemNow(silent) {
  UI.item = null; dwStack = []; $("#drawer").classList.remove("dw-has-back");
  const dw = $("#drawer"), sc = scrim();
  if (dw.hidden) return;
  dw.classList.remove("open"); sc.classList.remove("open");
  clearTimeout(DW.ct);
  DW.ct = setTimeout(() => { if (UI.item) return; dw.hidden = true; dw.innerHTML = ""; sc.hidden = true; }, 260);
}
// P1 / D4 review desk: owner / stage are pills; the native select sits invisibly on top of the pill, so tapping still opens the system picker and the change handler is untouched
const dwChev = `<svg class="chev" viewBox="0 0 10 6" width="9" height="6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const dwPill = (k, face, sel) => `<label class="dw-pill"><span class="k">${k}</span>${face}${dwChev}${sel}</label>`;
// ===== t-imp29-p2: 草稿批注. Select text in a draft -> 批注 / 引用回复 / 复制. Notes are kept per item on this device (rt.anno) until they go out
// with the next 回复 / 驳回 / 批准, as "> 原句" + note, so the agent sees exactly which sentence is meant. No server change: it is an ordinary comment.
const ANN = { all: LS.get("anno", {}), cand: null, hideT: 0, showT: 0, deferred: false };
const annList = id => ANN.all[id || UI.item] || [];
const annSave = () => { for (const k of Object.keys(ANN.all)) if (!ANN.all[k].length) delete ANN.all[k]; LS.set("anno", ANN.all); };
const annSquash = s => String(s || "").replace(/\s+/g, " ").trim();
function annWrap(text) {   // the notes block that goes in front of what you typed
  const L = annList(); if (!L.length) return text;
  const zh = UI.lang !== "en";
  const block = L.map(n => `> ${n.q}\n\n${n.t}`).join("\n\n");
  return `**${zh ? `批注 · ${L.length} 条` : `${L.length} note${L.length > 1 ? "s" : ""}`}**\n\n${block}` + (text ? `\n\n${text}` : "");
}
function annClear(id) { delete ANN.all[id]; annSave(); if (id === UI.item) annPaint(); }
function annSelInDraft() {   // the current selection, if it sits inside one draft card's text in the open drawer
  const s = getSelection(); if (!s || s.isCollapsed || !s.rangeCount) return null;
  const md = n => n && (n.nodeType === 1 ? n : n.parentElement)?.closest("#drawer .cs-card.draftc .md");
  const a = md(s.anchorNode), b = md(s.focusNode); if (!a || a !== b) return null;
  const q = annSquash(s.toString()); if (q.length < 2) return null;
  return { q: q.slice(0, 240), rect: s.getRangeAt(0).getBoundingClientRect() };
}
function annPop() {
  let p = $("#an-pop"); if (p) return p;
  const zh = UI.lang !== "en";
  document.body.insertAdjacentHTML("beforeend", `<div id="an-pop" role="toolbar" hidden><button data-an="note">${zh ? "批注" : "Note"}</button><button data-an="quote">${zh ? "引用回复" : "Quote"}</button><button data-an="copy">${zh ? "复制" : "Copy"}</button></div>`);
  p = $("#an-pop");
  p.addEventListener("pointerdown", e => e.preventDefault());   // keep the text selected while tapping the menu
  p.addEventListener("click", e => {
    const b = e.target.closest("[data-an]"), c = ANN.cand; if (!b || !c) return;
    const k = b.dataset.an; annHide(true);
    if (k === "copy") { (navigator.clipboard ? navigator.clipboard.writeText(c.q) : Promise.reject()).then(() => toast(UI.lang === "en" ? "Copied" : "已复制"), () => { }); }
    if (k === "quote") { const ta = $("#drawer .composer textarea"); if (ta) { ta.value = `> ${c.q}\n\n` + ta.value; ta.dispatchEvent(new Event("input", { bubbles: true })); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }
    if (k === "note") annEdit(c.q);
    try { getSelection().removeAllRanges(); } catch { }
  });
  return p;
}
function annShow(c) {
  ANN.cand = c; const p = annPop(), touch = matchMedia("(pointer: coarse)").matches;
  p.hidden = false; const w = p.offsetWidth, h = p.offsetHeight, dock = $("#drawer .dw-dock"), lim = (dock ? dock.getBoundingClientRect().top : innerHeight) - 8;
  // phones: iOS draws its own callout ABOVE the selection, so ours goes below it (flipped up if the dock is in the way); desktop: above
  let top = touch ? c.rect.bottom + 12 : c.rect.top - h - 10;
  if (touch && top + h > lim) top = c.rect.top - h - 56;
  if (!touch && top < 8) top = c.rect.bottom + 10;
  p.style.left = Math.round(Math.min(innerWidth - w - 8, Math.max(8, c.rect.left + c.rect.width / 2 - w / 2))) + "px";
  p.style.top = Math.round(Math.max(8, top)) + "px";
  requestAnimationFrame(() => p.classList.add("on"));
}
function annHide(now) {
  const p = $("#an-pop"); if (!p || p.hidden) return;
  p.classList.remove("on"); clearTimeout(ANN.hideT);
  ANN.hideT = setTimeout(() => { p.hidden = true; }, now ? 0 : 160);
}
function annEdit(q, idx) {   // new note (idx undefined) or edit / delete an existing one
  const zh = UI.lang !== "en", L = annList(), cur = idx != null ? L[idx] : null;
  openModal(`<h2>${zh ? (cur ? "改批注" : "写批注") : (cur ? "Edit note" : "Add a note")}</h2><div class="an-q">${esc(q)}</div>
    <textarea placeholder="${zh ? "这一句哪里要改？" : "What should change here?"}">${cur ? esc(cur.t) : ""}</textarea>
    <div class="foot">${cur ? `<button class="btn danger" data-del>${zh ? "删除" : "Delete"}</button><span style="flex:1"></span>` : ""}<button class="btn" data-x>${t("cancel")}</button><button class="btn primary" data-ok>${zh ? "保存" : "Save"}</button></div>`, m => {
    const ta = $("textarea", m), id = UI.item;
    const ok = () => { const v = ta.value.trim(); if (!v) return ta.focus(); const L2 = ANN.all[id] = annList(id).slice();
      if (cur) L2[idx] = Object.assign({}, cur, { t: v }); else L2.push({ id: Math.random().toString(36).slice(2, 8), q, t: v, at: new Date().toISOString() });
      annSave(); closeModal(); annPaint(); };
    $("[data-ok]", m).onclick = ok; $("[data-x]", m).onclick = closeModal;
    const del = $("[data-del]", m); if (del) del.onclick = () => { ANN.all[id] = annList(id).filter((_, i) => i !== idx); annSave(); closeModal(); annPaint(); };
    ta.addEventListener("keydown", e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); ok(); } });
    ta.focus();
  });
}
function annMark(md, q, cls) {   // wrap the first match of q (whitespace-insensitive, may cross inline tags) in <mark>; returns the last mark
  const want = q.replace(/\s+/g, ""); if (!want) return null;
  const walk = document.createTreeWalker(md, NodeFilter.SHOW_TEXT), map = []; let flat = "";
  for (let n; (n = walk.nextNode());) { if (n.parentElement.closest("mark.an-hl, .an-note")) continue; const s = n.nodeValue; for (let i = 0; i < s.length; i++) if (!/\s/.test(s[i])) { map.push([n, i]); flat += s[i]; } }
  const at = flat.indexOf(want); if (at < 0) return null;
  const segs = new Map();
  for (let k = at; k < at + want.length; k++) { const [n, i] = map[k]; const g = segs.get(n); if (g) g[1] = i + 1; else segs.set(n, [i, i + 1]); }
  let last = null;
  for (const [n, [a, b]] of segs) { const r = document.createRange(); r.setStart(n, a); r.setEnd(n, b); const m = document.createElement("mark"); m.className = cls; r.surroundContents(m); last = m; }
  return last;
}
function annPaint() {   // highlights + inline notes in the draft, and the 「N 条批注」 tray in the dock. Runs after every drawer render.
  const dw = $("#drawer"); if (!dw || dw.hidden || !UI.item) return;
  const zh = UI.lang !== "en", L = annList();
  $$(".an-note", dw).forEach(x => x.remove());
  $$("mark.an-hl", dw).forEach(m => m.replaceWith(...m.childNodes));
  const cards = [...$$('.cs-card.draftc[data-vkey="cur"] .md', dw), ...$$(".cs-card.draftc .md", dw)];
  L.forEach((n, i) => {
    let m = null; for (const md of cards) { m = annMark(md, n.q, "an-hl"); if (m) break; }
    n.lost = !m;
    if (m) { const blk = m.closest("p, li, blockquote, h1, h2, h3, h4, pre, tr") || m; blk.insertAdjacentHTML("afterend", `<button type="button" class="an-note" data-an-edit="${i}"><small>${zh ? "我的批注" : "My note"} · ${i + 1}</small>${esc(n.t)}</button>`);
      const c = m.closest(".cs-card.draftc.folded"); if (c) c.classList.remove("folded"); }
  });
  const dock = $(".dw-dock", dw); if (!dock) return;
  let tr = $(".an-tray", dock);
  if (!L.length) { if (tr) tr.remove(); return; }
  if (!tr) { dock.insertAdjacentHTML("afterbegin", `<div class="an-tray"></div>`); tr = $(".an-tray", dock); }
  const open = tr.classList.contains("open"), lost = L.filter(n => n.lost).length;
  tr.innerHTML = `<button type="button" class="an-head" data-an-tray><span class="n">${L.length}</span><span class="tx"><b>${zh ? `${L.length} 条批注` : `${L.length} note${L.length > 1 ? "s" : ""}`}</b><small>${zh ? `点「回复」或「驳回」时一起发给${esc(aname(agent((ST.items.find(x => x.id === UI.item) || {}).owner)))}，带原句` : "Sent with your next reply or reject, with the quoted lines"}${lost ? (zh ? ` · ${lost} 条原句在新版里找不到了` : ` · ${lost} not in this version`) : ""}</small></span><em aria-hidden="true">${open ? "⌄" : "›"}</em></button>
    <div class="an-list">${L.map((n, i) => `<div class="an-li"><button type="button" data-an-edit="${i}"><q>${esc(n.q.slice(0, 60))}</q><span>${esc(n.t)}</span></button><button type="button" class="x" data-an-del="${i}" aria-label="${zh ? "删除" : "Delete"}">✕</button></div>`).join("")}</div>`;
}

// t-m2-a ③: skeleton while a slim card's drafts load (/api/item). CSS keeps it invisible for the first 150 ms (a LAN answer never shows it);
// ONE sweep for the whole block (.sk::after), gone with the block when the full card renders.
const skDraft = () => `<div class="sk sk-dw" data-sk aria-busy="true" aria-label="${UI.lang === "en" ? "Loading drafts" : "草稿加载中"}"><div class="sk-c"><i style="width:34%"></i><i></i><i style="width:92%"></i><i style="width:78%"></i><i style="width:56%"></i></div><div class="sk-c"><i style="width:28%"></i><i style="width:86%"></i><i style="width:64%"></i></div></div>`;
// t-perf E: everything a poll can change that the open detail draws: the card, its parent / sub-cards, the team (rings, names, tool badges),
// routines, owner name / avatars, language. A poll whose signature matches skips renderDrawer, so the DOM (scroll, selection, running
// animations such as the 新回复 ring) stays as it is. Every direct renderDrawer() call (your clicks, opening, folding) still rebuilds.
const DW_SKIP = { last_seen: 1, activity: 1 };
function dwSig() {
  const it = (ST.items || []).find(i => i.id === UI.item); if (!it) return "gone";
  const par = parentOf(it), kids = childrenOf(it), ags = ST.agents || {};
  return JSON.stringify([UI.item, UI.lang, MOBQ.matches, it, par && [par.id, par.title, par.stage, par.kind, par.updated, par.snooze],
    kids.map(k => [k.id, k.title, k.stage, k.kind, k.owner, k.updated, k.activity, k.asks, k.snooze]),
    Object.keys(ags).map(k => JSON.stringify(ags[k], (key, v) => DW_SKIP[key] ? undefined : v)), routineOf(it), ST.meta.owner, ST.meta.avatars]);
}
/* t-ri1113-a P2: the dock's question bar (t-ask-bottom) repeats the first open question of the 要你拿主意 block above. While that question is on
   screen the bar folds away (.dup, a height + opacity transition); scrolled out of view it comes back, so long cards keep it and short cards stop
   showing the same question twice. Re-attached on every render (the scroll content is rebuilt). Phone: the glass header and the dock float over
   the scroller, so they are taken off the observed area. */
function askDup(dw, sc, it) {
  if (DW.askIO) { DW.askIO.disconnect(); DW.askIO = null; }
  const ab = $(".dw-askbar", dw), a = openAsks(it)[0], el = a && ab && !ab.hidden && sc.querySelector(`.ask-list .ask[data-askq="${CSS.escape(a.id)}"]`);
  if (!el || !window.IntersectionObserver) { if (ab) ab.classList.remove("dup"); return; }
  const dk = $(".dw-dock", dw), ph = MOBQ.matches, sr = sc.getBoundingClientRect(), tp = $(".dw-top", dw);
  const top = ph && tp ? Math.max(0, tp.getBoundingClientRect().bottom - sr.top) : 0;
  const bot = ph && dk ? Math.max(0, sr.bottom - dk.getBoundingClientRect().top - (ab.classList.contains("dup") ? 0 : ab.offsetHeight)) : 0;
  DW.askIO = new IntersectionObserver(es => es.forEach(e => ab.classList.toggle("dup", e.isIntersecting && (e.intersectionRatio >= .5 || (!!e.rootBounds && e.intersectionRect.height >= e.rootBounds.height * .5)))),   /* half of it, or half the screen when it is taller */ { root: sc, rootMargin: `-${Math.round(top)}px 0px -${Math.round(bot)}px 0px`, threshold: [0, .25, .5, .75, 1] });
  DW.askIO.observe(el);
}
function renderDrawer(first) {
  if (!first && annSelInDraft()) { ANN.deferred = true; return; }   // t-imp29-p2: a poll must not wipe the text you are selecting
  const it = (ST.items || []).find(i => i.id === UI.item);
  const dw = $("#drawer");
  if (!it && UI.item && archKnown(UI.item) && !ARCH.miss[UI.item]) {   // t-perf A: an archived card, fetched on open
    const id = UI.item, sc0 = $(".dw-scroll", dw); if (sc0 && !sc0.querySelector("[data-sk]")) sc0.innerHTML = skDraft();
    archItem(id).then(ok => { if (UI.item !== id) return; if (ok) renderDrawer(true); else { ARCH.miss[id] = 1; closeItem(true); toast(UI.lang === "en" ? "Could not load this archived card" : "这张归档卡没加载出来", true); } });
    return;
  }
  if (!it) { closeItem(true); return; }
  if (it.slim) { fullItem(it.id).then(ok => { const n = (ST.items || []).find(i => i.id === it.id); if (ok && UI.item === it.id && n && !n.slim) renderDrawer(first);
    else if (!ok && UI.item === it.id) { const s = $("#drawer .dw-scroll [data-sk]"); if (s) s.outerHTML = `<div class="sk-fail">${UI.lang === "en" ? "Drafts did not load · close and reopen the card to retry" : "草稿没加载出来 · 关掉再打开这张卡重试"}</div>`; } }); if (!first) return; }   // t-mobile-crash-state: draft + versions arrive a moment later
  const opts = (list, cur) => list.map(([v, n]) => `<option value="${v}" ${v === cur ? "selected" : ""}>${esc(n)}</option>`).join("");
  const ownerOpts = opts(agents().map(a => [a.id, `${aname(a)} · ${atitle(a)}`]), it.owner);
  $(".dw-top", dw).innerHTML = `<div class="dw-lead"><button class="dw-back" data-close aria-label="${UI.lang === "en" ? "Back" : "返回"}"><svg viewBox="0 0 12 20" width="12" height="20" aria-hidden="true"><path d="M10 2 2 10l8 8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${UI.lang === "en" ? "Back" : "返回"}</span></button><span class="tag ${it.stage === "review" || awaitsUser(it) ? it.kind : ""}" title="${esc(it.stage === "review" || awaitsUser(it) ? t(it.kind === "task" ? "deliverable" : it.kind) : stageLabel(it.stage))}"><span class="gl" aria-hidden="true">◆</span>${it.stage === "review" || awaitsUser(it) ? t(it.kind === "task" ? "deliverable" : it.kind) : stageLabel(it.stage)}</span> <button type="button" class="mono dim dw-id" data-copy-id="${esc(it.id)}" title="${UI.lang === "en" ? "Copy card id" : "复制卡号"}"><span>${esc(it.id)}</span><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><rect x="5" y="5" width="8.5" height="8.5" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 3.2V3a1.5 1.5 0 0 0-1.5-1.5H3A1.5 1.5 0 0 0 1.5 3v6A1.5 1.5 0 0 0 3 10.5h.2" fill="none" stroke="currentColor" stroke-width="1.4"/></svg></button><button type="button" class="dw-id dce-lnk" data-copy-link="${esc(it.id)}" title="${UI.lang === "en" ? "Copy link to this card" : "复制这张卡的链接"}" aria-label="${UI.lang === "en" ? "Copy link" : "复制链接"}"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.4-2.4a2.6 2.6 0 0 0-3.7-3.7l-.9.9M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l.9-.9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button></div>
    <div class="r"><select data-f="category">${opts(CATS.map(c => [c, t(c)]), it.category)}</select><button class="dw-hide" data-close title="${UI.lang === "en" ? "Hide the panel · the card stays" : "收起面板 · 卡还在，随时从列表点回来"}"><span>${UI.lang === "en" ? "Hide" : "收起"}</span><svg viewBox="0 0 8 12" width="7" height="11" aria-hidden="true"><path d="M1.5 1.5 6 6l-4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>`;   // t-detail-close B: words, not ✕, so it never reads as ending the card
  const sc = $(".dw-scroll", dw); const keep = sc.scrollTop;
  let lastDay = "";
  const stream = streamOf(it);
  const eh = ringOnce(() => stream.slice().reverse().map(e => entryHTML(e, it))).reverse();   // t-m2-a ⓪: built newest first so only the newest line keeps a ring
  const tl = stream.map((e, i) => {
    const d = dayKey(new Date(e.t)); const sep = d !== lastDay ? `<div class="cs-day">${when(e.t).split(" ")[0]}</div>` : ""; lastDay = d;
    return sep + eh[i];
  }).join("");
  const wasEnd = !first && nearEnd(sc), grew = !first && stream.length > DW.n; DW.n = stream.length;
  { // t-ask-bottom: the first unanswered question sits right above the reply box (same chips as the list cards: recommended one marked, a tap answers;
    // with more than one, they come one after another and the bar says how many are left). The full list stays in the card above as before.
    const ab = $(".dw-askbar", dw); if (ab) { const h = it.stage === "done" ? "" : askRow(it, true); if (ab._h !== h) { ab.innerHTML = ab._h = h; ab.hidden = !h; if (h) askFold(ab, it); } } }
  const wsD = workersOf(it.id);   // t-oss-polish-1121 ②: one 处理中 band above the title on desk and phone (was: tag in .dw-top + phone .dw-wkrow)
  const par = parentOf(it), kids = childrenOf(it), en = UI.lang === "en";
  const parHTML = par ? `<button class="dw-parent" data-dw-nav="${esc(par.id)}"><span class="k">${en ? "Part of" : "属于"}</span><b>${esc(par.title)}</b><span class="st">${esc(rowLabel(par))}</span><svg viewBox="0 0 8 14" width="7" height="12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 1.5 6.5 7l-5 5.5"/></svg></button>` : "";
  const kidsHTML = kids.length ? `<div class="sec-h">${en ? "Sub-items" : "子单"} · ${kids.length}</div><div class="dw-kids">${kids.map(k => `<button class="dw-kid${k.stage === "done" ? " done" : ""}" data-dw-nav="${esc(k.id)}">${av(agent(k.owner), "sm")}<span class="t">${esc(k.title)}</span><span class="st s-${esc(grpOf(k))}">${esc(rowLabel(k))}</span><svg viewBox="0 0 8 14" width="7" height="12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 1.5 6.5 7l-5 5.5"/></svg></button>`).join("")}</div>` : "";
  const dwTags = [...(it.platforms || []).map(p => `<span class="tag pf">${PLAT[p] || p}</span>`), ...(it.due ? [`<span class="tag">${t("due")} ${esc(it.due)}</span>`] : []),
    ...(it.tags || []).filter(x => !par || x !== par.id).map(x => `<span class="tag">#${esc(x)}</span>`)].join("");
  sc.innerHTML = `${wkBand(wsD)}${parHTML}<div class="dw-title">${window.Onboard ? Onboard.exT(it) : esc(it.title)}</div>${window.Onboard ? Onboard.exNote(it) : ""}${it.summary ? `<div class="dw-sum${DW.sumOpen.has(it.id) ? "" : " uin-clamp"}">${esc(it.summary)}</div><button type="button" class="uin-more" data-uin-sum hidden>${DW.sumOpen.has(it.id) ? (UI.lang === "en" ? "Show less ▴" : "收起 ▴") : (UI.lang === "en" ? "Show all ▾" : "展开全文 ▾")}</button>` : ""}
    <div class="dw-meta">${dwPill(t("owner"), `${av(agent(it.owner), "sm", it.id)}<b>${esc(aname(agent(it.owner)))}<i> · ${esc(atitle(agent(it.owner)))}</i></b>`, `<select data-f="owner" aria-label="${t("owner")}">${ownerOpts}</select>`)}
      ${dwPill(t("stage"), `<b>${esc(stageLabel(it.stage))}</b>`, `<select data-f="stage" aria-label="${t("stage")}">${opts(STAGES.map(s => [s, stageLabel(s)]), it.stage)}</select>`)}</div>
    ${dwTags ? `<div class="dw-tags">${dwTags}</div>` : ""}${askBlock(it)}
    ${rtLine(it)}${kidsHTML}
    ${(it.evidence || []).length ? `<div class="sec-h">${t("evidence")}</div><ul class="ev md">${it.evidence.map(e => `<li>${md(e).replace(/^<p>|<\/p>$/g, "")}</li>`).join("")}</ul>` : ""}
    ${(it.links || []).length ? `<div class="sec-h">${t("links")}</div><ul class="ev md">${it.links.map(l => `<li>${md(l).replace(/^<p>|<\/p>$/g, "")}</li>`).join("")}</ul>` : ""}
    ${topFiles(it)}
    <div class="sec-h">${t("thread")}</div>${it.slim ? skDraft() : ""}<div class="cs">${tl}</div>
    <div class="cs-jump"><div class="wrap"><button data-jump="top" hidden><span class="ic">↑</span><span class="lb">${t("jump_top")}<small>TOP</small></span></button><button data-jump="end" hidden><span class="ic">↓</span><span class="lb">${t("jump_new")}<small>LATEST</small></span><i class="new" hidden></i></button></div></div>`;
  { const sm = $(".dw-sum", sc), sb = $("[data-uin-sum]", sc);   // t-ui-next 4: the toggle only shows when the 3-line clamp actually cuts text (or it is open)
    if (sm && sb) sb.hidden = !DW.sumOpen.has(it.id) && sm.scrollHeight <= sm.clientHeight + 2; }
  // folded cards only need the toggle when they actually overflow
  $$(".cs-card.draftc", sc).forEach(c => { const m = $(".md", c), b = $(".cs-more", c); if (!c.classList.contains("folded")) { c.classList.add("folded"); const long = m.scrollHeight > m.clientHeight + 4; c.classList.remove("folded"); b.hidden = !long; } else b.hidden = m.scrollHeight <= m.clientHeight + 4; });
  const jumpEl = first && DW.jumpT ? [...sc.querySelectorAll(".cs-card[data-t]")].find(x => Date.parse(x.dataset.t) >= DW.jumpT) : null;   // t-home-newreplies
  if (jumpEl) { DW.pin = false; DW.jumpT = 0; DW.hitT = jumpEl.dataset.t; DW.hitAt = Date.now(); }
  // t-detail-jump-fix: the 新回复 mark is only a mark. It used to head the else-if chain below, so after a jump no re-render ever pinned,
  // followed new messages or kept the reading position again while the card stayed open. It now fades out (NR_HIT ms, poll-safe delay).
  const hitAge = DW.hitT ? Date.now() - (DW.hitAt || 0) : NR_HIT;
  const hitEl = hitAge < NR_HIT ? sc.querySelector(`.cs-card[data-t="${CSS.escape(DW.hitT)}"]`) : null;
  if (hitEl) { hitEl.classList.add("nr-hit"); hitEl.style.animationDelay = -hitAge + "ms"; } else DW.hitT = "";
  if (first && hitEl) sc.scrollTop = Math.max(0, hitEl.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 24);   // opened from 新回复: start at the first unread reply
  else if (first || dwPinned()) { sc.scrollTop = sc.scrollHeight; dwPinWatch(sc); }   // t-detail-jump: open at the newest message (was: review cards at the current draft, others at the top)
  else if (wasEnd) { DW.pin = true; DW.pinUntil = Math.max(DW.pinUntil || 0, Date.now() + 1500); sc.scrollTop = sc.scrollHeight; dwPinWatch(sc); }   // t-detail-jump: already at the end → stay there while the re-rendered images settle
  else { sc.scrollTop = keep; if (grew) DW.fresh = true; }
  jumpState(); drawTo(); tocBuild();   // t-ri1103-p4
  askDup(dw, sc, it);   /* t-ri1113-a P2 */
  const done = it.stage === "done";
  const acts = $(".dw-acts", dw);
  {   // D4: desktop now uses the phone's dock (same state logic, same two pills); before it always showed 批准 / 驳回 / 完成 with ornaments
    // phone: the actions follow the state. review plan / deliverable = 驳回 + 批准; any other review, or not in review yet = a single 完成; done = stamp + 重开.
    // data-act names are unchanged (the completion splash and the stamp key off them).
    const zh = UI.lang !== "en", st = done ? "done" : it.stage === "review" && (it.kind === "plan" || it.kind === "deliverable") ? it.kind : "solo";
    acts.dataset.st = st;
    const rt = !done && routineOf(it);   // t-routine-close: a routine's card is never "done"; it is stopped / resumed instead
    if (rt) {   // t-routine-btn: one 暂停 / 开启 switch in place of 完成委托 (a routine is never "done"); running shows the next run
      const nd = rt.next && new Date(rt.next), nx = !nd || isNaN(nd) ? "" : dayKey(nd) === dayKey(new Date()) ? `${zh ? "今天" : "today"} ${hm(rt.next)}` : dayKey(nd) === dayKey(new Date(Date.now() + 864e5)) ? `${zh ? "明天" : "tomorrow"} ${hm(rt.next)}` : when(rt.next);
      acts.dataset.st = rt.paused ? "rt-off" : "rt"; acts.innerHTML = rt.paused
      ? `<span class="rt-off"><i class="rt-dot"></i>${zh ? "暂停" : "Paused"}</span><button class="ab ok rt-sw" data-rt="resume" role="switch" aria-checked="false"><b>${zh ? "开启" : "Turn on"}</b></button>`
      : `<span class="rt-on"><i class="rt-dot"></i>${rt.unknown || rt.ondemand ? (zh ? "开启中" : "On") : `${zh ? "开启中 · 下次 " : "On · next "}${esc(nx || "—")}`}</span><button class="ab no rt-sw" data-rt="pause" role="switch" aria-checked="true">${zh ? "暂停" : "Pause"}</button>`; }
    else acts.innerHTML = st === "done" ? `<button class="ab re" data-act="reopen"><span aria-hidden="true">↺</span>${t("reopen")}</button>${stampHTML(it)}`
      : closeBtn() + (st === "solo" ? snzBtn(it) + `<button class="ab ok solo${openAsks(it).length ? " has-ask" : ""}" data-act="done"${okAria(it, zh ? "完成委托" : "Mark done")}>${okDockIn(it, zh ? "完成委托" : "Mark done", "")}</button>`
      : `<button class="ab no" data-act="reject">${t("reject")}</button>${snzBtn(it)}<button class="ab ok${openAsks(it).length ? " has-ask" : ""}" data-act="approve"${okAria(it, okLabel(it))}>${okDockIn(it, okLabel(it), okShort(it))}</button>`);   // ri1103-P2: 稍后 between 驳回 and 验收
    // t-btn-names: open questions show as a line under the button label (desktop and phone); before it was a .dock-note to the left, desktop only
  }
  annPaint();   // t-imp29-p2
  if (window.Preview && contentMode()) Preview.decorate($('.cs-card.draftc[data-vkey="cur"]', sc), it);   // t-imp29-p3: 文稿 / 平台预览 on the current draft
  DW.sig = dwSig();   // t-perf E
  planTip(it);   // t-oss-polish-1121 ④
}
/* t-oss-polish-1121 ④: the first time a plan card waits on you, a bubble over 批准开工 says nothing starts before it. Shown while the server says
   meta.plan_tip (no 批准 / 驳回 / answer from you on any card yet, and not dismissed: meta.onboarding.plan_tip_at), so an install that has
   already decided something never sees it and a dismissal holds on every device. Lives inside #drawer, so it slides and closes with the page. */
const PT = { el: null, id: null };
function planTipOff() {
  document.querySelectorAll("#drawer .ab.ok.ph-lit").forEach(b => b.classList.remove("ph-lit"));
  const e = PT.el; PT.el = PT.id = null; if (!e || !e.isConnected) return;
  e.classList.add("out"); setTimeout(() => e.remove(), 220);
}
function planTipPlace(ok) {
  const dw = $("#drawer"), e = PT.el; if (!e || !dw) return;
  const d = dw.getBoundingClientRect(), r = ok.getBoundingClientRect(), w = e.offsetWidth;
  const right = Math.max(12, Math.min(d.right - r.right, d.width - w - 12));
  e.style.right = right + "px"; e.style.bottom = (d.bottom - r.top + 12) + "px";
  e.style.setProperty("--ph-x", Math.max(14, Math.min(w - 26, (d.right - right) - (r.left + r.width / 2) - 6)) + "px");
}
function planTip(it) {
  const want = !!(ST.meta && ST.meta.plan_tip && it && it.kind === "plan" && it.stage === "review" && UI.item === it.id);
  const ok = want && [...document.querySelectorAll('#drawer .dw-acts .ab.ok[data-act="approve"]')].find(b => b.offsetParent);
  if (!ok) { planTipOff(); return; }
  ok.classList.add("ph-lit");
  if (!PT.el || !PT.el.isConnected) {
    const en = UI.lang === "en", e = document.createElement("div");
    e.className = "ph-tip"; e.setAttribute("role", "note");
    e.innerHTML = en ? `<b>This is a plan</b>Nothing starts until you tap “Approve &amp; start”. Want changes? Write them below and tap Reject.<button type="button" data-ph-ok>Got it</button>`
      : `<b>这是一份方案</b>点「批准开工」后才会开始做；想改就在下面写意见，再点「驳回」。<button type="button" data-ph-ok>知道了</button>`;
    $("#drawer").appendChild(e); PT.el = e;
    e.querySelector("[data-ph-ok]").onclick = ev => { ev.stopPropagation(); if (ST.meta) ST.meta.plan_tip = false; planTipOff(); api("onboarding", { op: "tip", k: "plan" }); };
  }
  PT.id = it.id; planTipPlace(ok);
  requestAnimationFrame(() => planTipPlace(ok)); setTimeout(() => PT.el && ok.isConnected && planTipPlace(ok), 300);   /* the page slides in */
}
addEventListener("resize", () => { const ok = PT.el && $("#drawer .ab.ok.ph-lit"); if (ok) planTipPlace(ok); });
// ===== ri1103-P2: 稍后 ▾ = push a card to 今晚 20:00 / 明早 09:00 / 下周一 09:00 / the specialist's next reply / a picked time.
// The server keeps it (it.snooze), so desktop and phone agree. Desktop: a small menu over the button; phone: a bottom sheet.
const SNZ_IC = `<svg class="snz-ic" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><circle cx="8" cy="8.6" r="5.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 5.6v3.2l2 1.3M3 2.6 1.6 4M13 2.6 14.4 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
function snzWhen(iso) {
  const d = new Date(iso), en = UI.lang === "en", h = d.getHours(), t0 = hm(iso); if (isNaN(d)) return "—";
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(new Date().setHours(0, 0, 0, 0))) / 864e5);
  if (days === 0) return en ? `today ${t0}` : `${h >= 17 ? "今晚" : "今天"} ${t0}`;
  if (days === 1) return en ? `tomorrow ${t0}` : `${h < 12 ? "明早" : "明天"} ${t0}`;
  if (days > 1 && days < 7) return en ? `${"Sun Mon Tue Wed Thu Fri Sat".split(" ")[d.getDay()]} ${t0}` : `周${"日一二三四五六"[d.getDay()]} ${t0}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${t0}`;
}
const snzText = it => !it || !it.snooze ? "" : it.snooze.wait === "reply" ? (UI.lang === "en" ? `until ${aname(agent(it.owner))} replies` : `等${aname(agent(it.owner))}回复`) : snzWhen(it.snooze.until);
const snzCan = it => !!it && it.stage !== "done" && !routineOf(it) && (it.stage === "review" || awaitsUser(it) || openAsks(it).length > 0);
const snzBtn = it => !snzCan(it) ? "" : snoozed(it)
  ? `<button class="ab sz on" data-snz-btn title="${UI.lang === "en" ? "Snoozed · change or cancel" : "已推迟 · 点一下改时间或取消"}">${SNZ_IC}<span>${esc(snzText(it))}</span></button>`
  : `<button class="ab sz" data-snz-btn title="${UI.lang === "en" ? "Take it off your list until later" : "先从等你拍板拿掉，到点再回来"}">${SNZ_IC}<span>${UI.lang === "en" ? "Later" : "稍后"}</span><svg class="snz-car" viewBox="0 0 10 6" width="9" height="6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
const snzSort = (a, b) => (a.snooze.wait === "reply") - (b.snooze.wait === "reply") || snzEnd(a) - snzEnd(b);   /* timed ones first: the home line names the next fixed return */
function snzLine() {
  const L = items().filter(snoozed).sort(snzSort); if (!L.length) return "";
  const en = UI.lang === "en", f = L[0], back = f.snooze.wait === "reply" ? snzText(f) : (en ? `back ${snzText(f)}` : `${snzText(f)} 回来`);
  return `<button type="button" class="snz-line" data-snz-list>${SNZ_IC}<span>${en ? `${L.length} snoozed · ${esc(back)}` : `推迟了 ${L.length} 张 · ${esc(back)}`}</span><i aria-hidden="true">›</i></button>`;
}
const SNZ = { el: null, done: null, ret: null };
/* t-ui-fix-r5 R5-03: keyboard — focus goes into the menu on open, ↑↓/Home/End move between items, Tab stays inside (the 自己选时间 form
   lives there too), Esc / closing returns focus to the trigger (found again by its data-* attribute if a poll rebuilt it) */
const snzItems = pop => [...pop.querySelectorAll("button:not([disabled]), input:not([disabled])")].filter(b => b.offsetParent && !b.closest("[hidden]"));
function snzRet(r) {
  if (!r) return; let b = r.el;
  if (!b || !b.isConnected) b = r.sel ? document.querySelector(r.sel) : null;
  if (b && b.offsetParent) b.focus({ preventScroll: true });
}
function snzClose(ok) {
  const el = SNZ.el, d = SNZ.done, ret = SNZ.ret; SNZ.el = SNZ.done = SNZ.ret = null;
  if (el) { const a = document.activeElement, back = !a || a === document.body || el.contains(a); el.classList.add("out"); setTimeout(() => el.remove(), 160); if (back) snzRet(ret); }
  if (d) d(!!ok);
}
function snzOpen(html, anchor, done, below) {   /* below: open under the anchor when it fits (t-ui-fix-r3 R3-11, 定时 ··· menu) */
  snzClose(false);
  const el = document.createElement("div"), sheet = MOBQ.matches || !anchor;
  el.className = "snz-wrap" + (sheet ? " sheet" : "");
  el.innerHTML = `<div class="snz-pop" role="menu">${html}</div>`;
  document.body.appendChild(el); SNZ.el = el; SNZ.done = done || null;
  const pop = el.firstElementChild;
  if (!sheet) {
    const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    /* t-ui-fix-r3 R3-11: keep the menu inside the anchor's own column (drawer / main / chat) when it is wide enough, so it does not spill over the chat avatars */
    const col = anchor.closest("#drawer, #main, #right, #left"), cr = col && col.getBoundingClientRect();
    const lo = cr && cr.width >= w + 24 ? cr.left + 12 : 12, hi = cr && cr.width >= w + 24 ? cr.right - w - 12 : innerWidth - w - 12;
    const up = r.top - h - 10 >= 8, down = r.bottom + 10 + h <= innerHeight - 8;
    const left = Math.max(lo, Math.min(hi, r.left + r.width / 2 - w / 2)), top = (below ? down || !up : !up) ? r.bottom + 10 : r.top - h - 10;
    Object.assign(pop.style, { left: left + "px", top: top + "px" });
  }
  el.addEventListener("click", e => { if (e.target === el) snzClose(false); });
  if (anchor) { const at = [...anchor.attributes].find(a => a.name.startsWith("data-")); SNZ.ret = { el: anchor, sel: at ? (anchor.closest("#drawer") ? "#drawer " : "") + `[${at.name}${at.value ? `="${CSS.escape(at.value)}"` : ""}]` : "" }; }
  pop.addEventListener("keydown", e => {
    const k = e.key; if (!["ArrowDown", "ArrowUp", "Home", "End", "Tab"].includes(k)) return;
    if (k !== "Tab" && e.target.matches("input")) return;
    const all = snzItems(pop), L = k === "Tab" ? all : all.filter(b => b.matches(".snz-o, .snz-x, [role=menuitem]")); if (!L.length) return;
    const i = L.indexOf(document.activeElement), n = L.length;
    const j = k === "Home" ? 0 : k === "End" ? n - 1 : (k === "ArrowUp" || (k === "Tab" && e.shiftKey)) ? (i <= 0 ? n - 1 : i - 1) : (i + 1) % n;
    e.preventDefault(); L[j].focus();
  });
  const first = snzItems(pop).find(b => b.matches(".snz-o, [role=menuitem]")) || snzItems(pop)[0];
  if (first) first.focus({ preventScroll: true });
  return pop;
}
function snzMenu(id, anchor, done) {
  const it = items().find(i => i.id === id); if (!it) return done && done(false);
  const en = UI.lang === "en", now = new Date(), nm = aname(agent(it.owner)), on = snoozed(it);
  const opt = (p, a, b, extra) => `<button type="button" class="snz-o" data-snz-p="${p}" role="menuitem"><b>${a}</b><span>${b}</span>${extra || ""}</button>`;
  const html = `<div class="snz-h"><b>${en ? "Later" : "稍后再看"}</b><small>${on ? (en ? `Snoozed · ${esc(snzText(it))}` : `已推迟 · ${esc(snzText(it))}`) : (en ? "Off your list until then; it comes back by itself" : "先从等你拍板拿掉，到时候自己回来")}</small></div>
    ${now.getHours() * 60 + now.getMinutes() < 19 * 60 + 30 ? opt("tonight", en ? "Tonight" : "今晚", "20:00") : ""}
    ${opt("morning", en ? (now.getHours() < 5 ? "This morning" : "Tomorrow morning") : (now.getHours() < 5 ? "早上" : "明早"), "09:00")}
    ${opt("monday", en ? "Next Monday" : "下周一", "09:00")}
    ${opt("reply", en ? `Until ${esc(nm)} replies` : `等${esc(nm)}下条回复`, en ? "or a new draft · 3 days max" : "有回复或新稿就回来，最多等 3 天")}
    <button type="button" class="snz-o" data-snz-pick role="menuitem"><b>${en ? "Pick a time…" : "自己选时间…"}</b><span></span></button>
    <form class="snz-cus" hidden><input type="datetime-local" name="t" required><button class="btn-s">${en ? "OK" : "确定"}</button></form>
    ${on ? `<button type="button" class="snz-o un" data-snz-un role="menuitem"><b>${en ? "Cancel snooze" : "取消推迟"}</b><span>${en ? "back on your list now" : "现在就回到等你拍板"}</span></button>` : ""}`;
  const pop = snzOpen(html, anchor, done);
  const send = (preset, until) => {
    const lbl = until ? snzWhen(until) : preset === "reply" ? (en ? `until ${nm} replies` : `等${nm}下条回复`) : [...$(`[data-snz-p="${preset}"]`, pop).children].map(x => x.textContent).join(" ").trim();
    pop.classList.add("busy");
    api("snooze", { item: id, preset, until, label: lbl }).then(() => {
      toast(en ? `Snoozed · ${lbl}` : `已推迟 · ${preset === "reply" ? lbl : lbl + " 回来"}`);
      if (UI.item === id && !MOBQ.matches) closeItem(); else if (UI.item === id) backItem();
      snzClose(true);
    }).catch(() => { pop.classList.remove("busy"); });
  };
  pop.addEventListener("click", e => {
    const p = e.target.closest("[data-snz-p]"); if (p) return send(p.dataset.snzP);
    if (e.target.closest("[data-snz-pick]")) { const f = $(".snz-cus", pop); f.hidden = false; const d = new Date(Date.now() + 3 * 36e5); d.setMinutes(0, 0, 0);
      const loc = x => new Date(x - x.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); f.t.min = loc(new Date()); f.t.value = loc(d); f.t.focus(); return; }
    if (e.target.closest("[data-snz-un]")) { pop.classList.add("busy"); api("unsnooze", { item: id }).then(() => { toast(en ? "Back on your list" : "已取消推迟 · 回到等你拍板"); snzClose(false); }).catch(() => pop.classList.remove("busy")); }
  });
  $(".snz-cus", pop).addEventListener("submit", e => { e.preventDefault(); const v = e.target.t.value, d = new Date(v); if (!v || isNaN(d)) return; send("custom", d.toISOString()); });
}
function snzListMenu(anchor) {
  const L = items().filter(snoozed).sort(snzSort), en = UI.lang === "en"; if (!L.length) return;
  const pop = snzOpen(`<div class="snz-h"><b>${en ? "Snoozed" : "推迟中的卡"}</b><small>${en ? "Tap one to open it" : "点一张打开；到点或有新回复会自己回来"}</small></div>` +
    L.map(i => `<div class="snz-r"><button type="button" class="snz-o" data-snz-open="${esc(i.id)}"><b>${esc(i.title)}</b><span>${esc(aname(agent(i.owner)))} · ${esc(snzText(i))}${i.snooze.wait === "reply" && i.snooze.until ? ` · ${en ? "latest" : "最晚"} ${esc(snzWhen(i.snooze.until))}` : ""}</span></button><button type="button" class="snz-x" data-snz-un1="${esc(i.id)}">${en ? "Back now" : "取消推迟"}</button></div>`).join(""), anchor);
  pop.addEventListener("click", e => {
    const o = e.target.closest("[data-snz-open]"); if (o) { snzClose(false); openItem(o.dataset.snzOpen); return; }
    const u = e.target.closest("[data-snz-un1]"); if (u) { u.disabled = true; api("unsnooze", { item: u.dataset.snzUn1 }).then(() => { toast(en ? "Back on your list" : "已取消推迟 · 回到等你拍板"); snzClose(false); }).catch(() => { u.disabled = false; }); }
  });
}
// ===== t-routine-close: routine cards (config.routines -> meta.routines[].item). Before the server restart meta.routines is missing:
// then an ongoing "r-*" card with no parent is treated as a routine with an unknown schedule, and the buttons say a restart is needed.
function routineOf(it) {
  if (!it) return null;
  const rs = ST.meta && ST.meta.routines;
  const own = Array.isArray(rs) ? rs.find(r => r.item === it.id) : null;
  if (own) return own;
  /* t-routine-detect: an ongoing card in doing that is not a child card is a standing card too (按需常驻: no server timer, the manager runs it, e.g. t-oss-sync).
     id null = never send its id as a config routine; pause / resume go by item (server.py keeps it.paused). Before t-routine-detect only r-* without meta.routines counted. */
  if (it.category === "ongoing" && it.stage === "doing" && !parentOf(it)) return { id: null, item: it.id, ondemand: true, paused: (it.paused && it.paused.at) || null };
  if (Array.isArray(rs)) return null;
  return it.category === "ongoing" && /^r-/.test(it.id) && !parentOf(it) ? { id: it.id.slice(2), item: it.id, unknown: true } : null;
}
function rtLine(it) {
  const r = routineOf(it); if (!r) return "";
  const en = UI.lang === "en";
  if (r.ondemand) return r.paused   /* t-routine-detect */
    ? `<div class="dw-rt off"><b>${en ? "Paused" : "暂停"}</b><span>${en ? `since ${when(r.paused)} · the manager skips this card` : `${when(r.paused)} 暂停的 · 管家不再做这张卡`}</span></div>`
    : `<div class="dw-rt"><b>${en ? "On demand" : "按需常驻"}</b><span>${en ? "No fixed time · runs when the manager starts it" : "没有固定时间 · 管家说开工才跑"}</span></div>`;
  if (r.unknown) return `<div class="dw-rt"><b>${en ? "Routine" : "常驻任务"}</b><span>${en ? "Schedule shows after the dashboard restarts" : "看板重启后显示定时和下次时间"}</span></div>`;
  if (r.paused) return `<div class="dw-rt off"><b>${en ? "Paused" : "暂停"}</b><span>${en ? `since ${when(r.paused)} · no new runs` : `${when(r.paused)} 暂停的 · 不再开新的子卡`}</span></div>`;
  const nd = r.next && new Date(r.next), tmr = dayKey(new Date(Date.now() + 864e5));
  const nx = !nd ? "—" : dayKey(nd) === tmr ? `${en ? "tomorrow" : "明天"} ${hm(r.next)}` : when(r.next);
  return `<div class="dw-rt"><b>${en ? `Daily ${r.time}` : `每天 ${esc(r.time)}`}</b><span>${en ? "next" : "下次"} ${esc(nx)}</span></div>`;
}
/* t-ri1104-p3: the one pause / resume path, used by the card dock above and by the 常驻活动 schedule page. */
async function rtToggle(it, r, pause) {
  const zh = UI.lang !== "en";
  if (r.unknown) return toast(zh ? "这个按钮要等看板重启后才能用" : "Needs a dashboard restart first", true);
  if (r.ondemand) {   /* t-routine-detect: by item only, never a made-up routine id */
    if (pause && !(await UI.confirm(zh ? { title: `暂停常驻「${it.title}」？`, text: "暂停以后管家不再做这张卡，随时可以再开启。", ok: "暂停" } : { title: `Pause "${it.title}"?`, text: "The manager skips it until you turn it back on.", ok: "Pause" }))) return;
    api(pause ? "routine_pause" : "routine_resume", { item: it.id })
      .then(() => toast(pause ? (zh ? "已暂停 · 管家不再做这张卡" : "Paused") : (zh ? "已开启" : "Turned on")))
      .catch(e => { if (/no routine/.test(String(e && e.message))) toast(zh ? "这个按钮要等看板重启后才能用" : "Needs a dashboard restart first", true); });
    return;
  }
  if (pause && !(await UI.confirm(zh ? { title: `暂停常驻任务「${it.title}」？`, text: `暂停以后每天 ${r.time} 不再自动开子卡；已有的子卡不受影响。随时可以再开启。`, ok: "暂停" } : { title: `Stop "${it.title}"?`, text: "No new daily runs until you resume.", ok: "Stop" }))) return;
  api(pause ? "routine_pause" : "routine_resume", { routine: r.id, item: it.id })
    .then(() => toast(pause ? (zh ? "已暂停 · 不会再定时触发" : "Paused") : (zh ? "已开启 · 每天 " + r.time : "Turned on"))).catch(() => { });   /* api() already toasts the error */
}
// persistent done marker: owner avatar + 委托完成 + when (replaces the faint "✦ 完成 · time" line). .pre = hidden until the splash ends, then it stamps in once.
/* t-ri1104-p4: some old done cards never got a closed time (22 on 11-04). Fall back to the last "→ done" stage event, then updated. Display only, state untouched. */
function closedAt(it) {
  if (!it) return "";
  if (it.closed) return it.closed;
  const ev = (it.thread || []).filter(x => x.kind === "event" && /→\s*done\b/.test(x.text || "")).pop();
  return (ev && ev.t) || it.updated || "";
}
function stampHTML(it) {
  const own = agent(it.owner);
  return `<div class="dw-stamp${DW.stampPre === it.id ? " pre" : ""}"><span class="st-av">${av(own)}</span><span class="st-tx"><b>${UI.lang === "en" ? "Mission Complete" : "委托完成"}</b><i>${esc(aname(own))}${closedAt(it) ? " · " + when(closedAt(it)) : ""}</i></span></div>`;
}
function drawerAct(k, a, skip) {
  if (!a.isConnected) a = $(`#drawer [data-act="${k}"]`) || a;   // the dock may have been redrawn while the sheet was open
  const typed = $(".composer textarea").value.trim(), note = k === "approve" ? annWrap(typed) : typed;   // t-imp29-p2: notes ride along with 批准 too
  const it = ST.items.find(i => i.id === UI.item), wasPlan = it && it.kind === "plan";
  const b = a.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2;
  // a fresh completion = this click moves a not-yet-done item to done (never for an item that was already done, never on page load / state refresh)
  const id = UI.item, fresh = !!it && it.stage !== "done" && (k === "done" || (k === "approve" && !wasPlan));
  const clearPre = () => { if (DW.stampPre === id) { DW.stampPre = null; const s = $("#drawer .dw-stamp"); if (s) s.classList.remove("pre"); } };
  if (fresh && window.FX) { DW.stampPre = id; setTimeout(clearPre, 3800); }
  api(k, { item: id, note: note || undefined, skip_asks: skip || undefined }).then(() => {
    if (note && k === "approve") { $(".composer textarea").value = ""; annClear(id); DRAFT.set("item:" + id, ""); $(".dr-tag") && $(".dr-tag").remove(); }
    if (!window.FX) return;
    if (fresh) {
      FX.burst(cx, cy, { n: 46, spread: 180 });
      FX.missionComplete({ key: id + "|" + (it.updated || ""), owner: it.owner, title: it.title, time: when(new Date().toISOString()),
        onEnd: () => { const s = $("#drawer .dw-stamp"); DW.stampPre = null; if (s) { s.classList.remove("pre"); if (!FX.reduce) s.classList.add("fresh"); } } });
    }
    else if (k === "approve") { FX.burst(cx, cy, { n: 28 }); toast(okDone(it)); }
    else if (k === "reopen") toast(UI.lang === "en" ? "Reopened" : "已重开");
  }).catch(clearPre);
}

function wireDrawer() {
  document.addEventListener("click", e => {   // capture: remember which card was tapped before any handler opens it
    if (!VT_ON) return;
    const c = e.target.closest("[data-item]"); if (c && !c.closest("#drawer, #modal")) { VT.src = c; VT.at = performance.now(); }
    VT.back = !!e.target.closest("#drawer .dw-back[data-close]");
  }, true);
  window.addEventListener("resize", () => { const dw = $("#drawer"); if (dw && dw.classList.contains("sized")) { const w = dwSaved(); if (w) dwApply(dw, w); } });
  PHONE.addEventListener && PHONE.addEventListener("change", () => { const dw = $("#drawer"); if (UI.item && dw && !dw.hidden) renderDrawer(); });
  document.addEventListener("selectionchange", () => {
    clearTimeout(ANN.showT);
    const c = annSelInDraft();
    if (!c) {   // selection gone: hide shortly (a tap on the menu itself keeps the selection), then catch up a drawer render we held back
      ANN.showT = setTimeout(() => { if (annSelInDraft()) return; annHide(); ANN.cand = null; if (ANN.deferred) { ANN.deferred = false; if (UI.item) renderDrawer(); } }, 250);
      return;
    }
    annHide(true);
    ANN.showT = setTimeout(() => { const c2 = annSelInDraft(); if (c2) annShow(c2); }, 320);   // wait until the handles stop moving
  });
  addEventListener("scroll", () => annHide(true), { capture: true, passive: true });
  document.addEventListener("click", e => {
    if (!e.target.closest("#drawer, #modal")) return;
    const ed = e.target.closest("[data-an-edit]"); if (ed) { const n = annList()[+ed.dataset.anEdit]; if (n) annEdit(n.q, +ed.dataset.anEdit); return; }
    const dl = e.target.closest("[data-an-del]"); if (dl) { ANN.all[UI.item] = annList().filter((_, i) => i !== +dl.dataset.anDel); annSave(); annPaint(); return; }
    if (e.target.closest("[data-an-tray]")) { const tr = e.target.closest(".an-tray"); tr.classList.toggle("open"); annPaint(); }
  });
  document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-snz-list]"); if (b) { e.preventDefault(); snzListMenu(b); } });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && SNZ.el) { e.stopPropagation(); snzClose(false); } }, true);
  $("#drawer").addEventListener("click", e => { const b = e.target.closest("[data-snz-btn]"); if (b) snzMenu(UI.item, b); });
  $("#drawer").addEventListener("click", e => {
    const b = e.target.closest("[data-rt]"); if (!b) return;
    const it = curItem(), r = routineOf(it); if (!r) return;
    rtToggle(it, r, b.dataset.rt === "pause");
  });
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-rtq]"); if (!b) return;
    const r = ((ST.meta && ST.meta.routines) || []).find(x => x.id === b.dataset.rtq), it = r && (ST.items || []).find(i => i.id === r.item);
    if (r && it) rtToggle(it, r, !r.paused);
  });
  $("#drawer").addEventListener("change", e => {
    if (e.target.matches && e.target.matches("[data-vd-base]")) { if (DW.vd) DW.vd.base = +e.target.value; renderDrawer(); return; }   // t-imp-p2
    const f = e.target.dataset && e.target.dataset.f; if (!f) return;
    const v = e.target.value;
    if (f === "owner") api("reassign", { item: UI.item, owner: v });
    if (f === "category") api("set_category", { item: UI.item, category: v });
    if (f === "stage") {
      const sid = UI.item, cur = ST.items.find(i => i.id === sid);
      if (v === "done" && openAsks(cur).length) { e.target.value = cur.stage; return askGuard(sid, "done", skip => api("set_stage", { item: sid, stage: v, skip_asks: skip || undefined })); }
      api("set_stage", { item: sid, stage: v });
    }
  });
  $("#drawer").addEventListener("click", e => {
    if (e.target.closest(".dw-back[data-close]")) return backItem();
    { // t-ri1103-p4: 目录
      if (e.target.closest("[data-toc-tg]")) { TOC.open = !TOC.open; TOC.auto = false; if (!PHONE.matches) try { localStorage.setItem("rt.toc", TOC.open ? "open" : "min"); } catch { } tocMode(); TOC.cur = null; tocSync(); return; }   // cur reset: the opened list scrolls its lit line into view
      if (e.target.closest("[data-toc-close]")) { TOC.open = false; tocMode(); return; }
      const tc = e.target.closest("[data-toc]"); if (tc) { tocGo(+tc.dataset.toc); return; } }   // t-parent-links: back = previous card if you came from one, else close
    if (e.target.closest("[data-close]")) return closeItem();
    const nv = e.target.closest("[data-dw-nav]"); if (nv) { navItem(nv.dataset.dwNav); return; }
    const ci = e.target.closest("[data-copy-id]");   // t-id-copy: tap the card id to copy it
    const cl = e.target.closest("[data-copy-link]");   // t-detail-close End: 复制链接 lives here now (was in the bottom ⋯ menu)
    if (cl) { const id = cl.dataset.copyLink; copyText(location.origin + location.pathname + "#item=" + id).then(ok => toast(ok ? (UI.lang === "en" ? "Link copied" : "已复制链接") : (UI.lang === "en" ? "Copy failed" : "复制失败"), !ok)); return; }
    if (ci) { const id = ci.dataset.copyId; copyText(id).then(ok => toast(ok ? (UI.lang === "en" ? `Copied ${id}` : `已复制 ${id}`) : (UI.lang === "en" ? "Copy failed" : "复制失败"), !ok)); return; }
    const cp = e.target.closest("[data-copy-v]");
    if (cp) { const it = curItem(), k = cp.dataset.copyV; const txt = k === "cur" ? it.draft : ((it.versions || [])[+k.slice(1)] || {}).draft; navigator.clipboard.writeText(txt || "").then(() => toast(t("copied"))); return; }
    if (e.target.closest("[data-vd-toggle]")) { if (DW.vd) DW.vd.open = !DW.vd.open; renderDrawer(); return; }   // t-imp-p2
    if (e.target.closest("[data-uin-asks]")) { const id = UI.item; DW.askOpen.has(id) ? DW.askOpen.delete(id) : DW.askOpen.add(id); renderDrawer(); return; }   // t-ui-next 1
    if (e.target.closest("[data-uin-sum]")) { const id = UI.item; DW.sumOpen.has(id) ? DW.sumOpen.delete(id) : DW.sumOpen.add(id); renderDrawer(); return; }   // t-ui-next 4
    const fo = e.target.closest("[data-fold]");
    if (fo) { const k = fo.dataset.fold, key = k === "cur" ? "x" + k : k; DW.open.has(key) ? DW.open.delete(key) : DW.open.add(key); renderDrawer(); return; }
    const jp = e.target.closest("[data-jump]");
    if (jp) { const sc = $("#drawer .dw-scroll"); sc.scrollTo({ top: jp.dataset.jump === "top" ? 0 : sc.scrollHeight, behavior: "smooth" }); return; }
    if (e.target.closest("[data-to-reset]")) { DW.to = null; drawTo(); return; }
    const a = e.target.closest("[data-act]"); if (!a) return;
    const k = a.dataset.act;
    if (k === "close") return modalClose();   // t-close-bottom
    if (k === "reject") {
      const reason = annWrap($(".composer textarea").value.trim()), aid = UI.item;   // t-imp29-p2: notes alone are a reason
      if (!reason) return modalReject();
      return api("reject", { item: UI.item, reason }).then(() => { annClear(aid); DRAFT.set("item:" + aid, ""); $(".dr-tag") && $(".dr-tag").remove(); $(".composer textarea").value = ""; toast(UI.lang === "en" ? "Rejected · reason sent" : "已驳回 · 原因已发出"); });
    }
    if ((k === "approve" || k === "done") && openAsks(ST.items.find(i => i.id === UI.item)).length) return askGuard(UI.item, k, skip => drawerAct(k, a, skip));
    drawerAct(k, a, false);
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") { if (!$("#modal").hidden) closeModal(); else if (document.body.classList.contains("chat-pop")) chatPop(false); else if (MB.open) closeMailbox(); else if (UI.item) closeItem(); }
  });
}

export { drawerAtt, DW, PHONE, deskFit, NR_HIT, nearEnd, dwPinned, dwPinEnd, dwPinWatch, dwStack, dwNavDir, navItem, backItem, parentOf, childrenOf, VT, VT_ON, vtOK, vtSeen, vtRun, openItem, openItemNow, curItem, drawTo, jumpState, TOC, tocOff, tocMode, tocBuild, tocSync, tocGo, seekRange, seekItem, seekChat, streamOf, topFiles, vdBlock, entryHTML, EV_VERB, EV_VERB_EN, evText, scrim, DW_MIN, DW_KEY, dwMax, dwApply, dwSaved, dwSave, dwGrip, slideIn, closeItem, closeItemNow, dwChev, dwPill, ANN, annList, annSave, annSquash, annWrap, annClear, annSelInDraft, annPop, annShow, annHide, annEdit, annMark, annPaint, skDraft, DW_SKIP, dwSig, askDup, renderDrawer, SNZ_IC, snzWhen, snzText, snzCan, snzBtn, snzSort, snzLine, SNZ, snzItems, snzRet, snzClose, snzOpen, snzMenu, snzListMenu, routineOf, rtLine, rtToggle, closedAt, stampHTML, drawerAct, wireDrawer };
