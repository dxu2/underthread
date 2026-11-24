// Phone layer: the conversation list, the thread push (oof v2) and chat bubbles + motion.
// t-oss-struct S10 (A8): moved out of mobile.js unchanged. Its wire*() function holds what used to run at load (listeners, observers, the
// self-contained blocks); mobile.js calls it where the code used to be, so everything runs in the same order as before.


// ---------- chat: WeChat-style conversation list (body[data-cv] = list | thread) ----------
import { renderBar, setTab } from "./nav.js";
import { composers } from "./composer.js";
import { closeSearch } from "./search.js";
import { $, HOME, LS, en, mq, mv } from "../mobile.js";
const BACK = '<svg viewBox="0 0 24 24"><path d="M15 4 L7 12 L15 20"/></svg>';
const CLEAR = '<svg viewBox="0 0 24 24"><path d="M6 6 L18 18 M18 6 L6 18"/></svg>';
const SEARCH = '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M16 16 L20 20"/></svg>';
let convQ = "";
const convMsgs = id => App.chatList ? App.chatList(id) : id === "manager" ? (App.ST.chat || []) : ((App.ST.dms || {})[id] || []);   /* ri1105-P4 */
const convUnread = id => App.unreadOf ? App.unreadOf(id) : (() => { const s = App.seenOf ? App.seenOf(id) : ((App.UI.seen || {})["chat." + id] || ""); return convMsgs(id).filter(m => m.who !== "me" && m.t > s).length; })();   /* r-improve-1102 P3; t-ri1104-p2: App.unreadOf is the shared rule */
const pad2 = n => String(n).padStart(2, "0");
function wtime(iso) {   // 今天 10:40 · 昨天 · 星期二 · 10/19
  if (!iso) return "";
  const d = new Date(iso), day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const diff = Math.round((day(new Date()) - day(d)) / 864e5);
  if (diff <= 0) return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (diff === 1) return en() ? "Yesterday" : "昨天";
  if (diff < 7) return en() ? d.toLocaleDateString("en", { weekday: "short" }) : "星期" + "日一二三四五六"[d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function preview(m) {
  if (!m) return "";
  let s = (App.tablePv ? App.tablePv(m.text || "") : String(m.text || "")).replace(/```[\s\S]*?```/g, en() ? "[code]" : "[代码]").replace(/!\[[^\]]*\]\([^)]*\)/g, en() ? "[image]" : "[图片]")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`>#]+/g, "").replace(/\s+/g, " ").trim();
  const at = (m.attachments || [])[0];
  if ((!s || s === "📎") && at) s = /\.(png|jpe?g|gif|webp|heic)$/i.test(at.name || at.path || String(at)) ? (en() ? "[image]" : "[图片]") : (en() ? "[file]" : "[文件]");
  return (m.who === "me" ? (en() ? "You: " : "我：") : "") + s;
}
function convRows() {
  return Object.values(App.ST.agents || {}).filter(a => a.enabled !== false).map(a => {
    const l = convMsgs(a.id);
    return { a, last: l[l.length - 1], n: convUnread(a.id) };
  }).sort((x, y) => (y.a.id === "manager") - (x.a.id === "manager")
    || (y.last ? y.last.t : "").localeCompare(x.last ? x.last.t : "") || ((x.a.order ?? 99) - (y.a.order ?? 99)));
}
// ---------- oof v2 (t-chat-open-feel): a WeChat-style push. The thread surface (a sheet + header pills + message list + composer) travels in from the right edge,
// the conversation list under it recedes 28% and dims, back = the same in reverse (and the surface follows the finger on a swipe). All of it is `translate` / opacity
// (WAAPI, compositor), no blur is animated. `translate` (not `transform`) so the stagger keyframes in mobile.css still own `transform`. #hc=cur in the URL = the old transition. ---------
const hatch = () => /(^|[#&])hc=cur(&|$)/.test(location.hash);
const oofOK = () => !hatch() && !reduced.matches && mq.matches;
const tokC = {}, tok = n => tokC[n] || (tokC[n] = getComputedStyle(document.documentElement).getPropertyValue(n).trim());   // cached: reading a token forces a style recalc
const RECEDE = .28;
function oofParts(r) {
  let sheet = $(".oof-sheet", r), scrim = $(".oof-scrim", r);
  if (!sheet) { sheet = document.createElement("div"); sheet.className = "oof-sheet"; scrim = document.createElement("div"); scrim.className = "oof-scrim"; r.append(scrim, sheet); }
  return { surf: [sheet, $(".cl-back", r), $(".ch-msgs", r), $(".ch-comp", r)].filter(Boolean), list: ret && ret.el && ret.el.isConnected ? ret.el : $(".cl", r), scrim };   // t-dm-back-nav: the origin recedes, not the list
}
function oofApply(r, p) {   // p: 0 = surface off the right edge, 1 = landed
  const P = oofParts(r), W = r.offsetWidth || innerWidth;
  P.surf.forEach(e => { e.style.translate = `${((1 - p) * W).toFixed(1)}px 0`; });
  if (P.list) P.list.style.translate = `${(-p * W * RECEDE).toFixed(1)}px 0`;
  P.scrim.style.opacity = (.2 * p).toFixed(3);
}
function oofP(r) {   // where the surface visually is right now (also mid-flight), so a grab / reverse starts from there
  const s = $(".oof-sheet", r); if (!s || !r.classList.contains("oof-on")) return 1;
  const v = parseFloat(getComputedStyle(s).translate); return isNaN(v) ? 1 : Math.min(1, Math.max(0, 1 - v / (r.offsetWidth || innerWidth)));
}
function oofClear(r) {
  const o = r._oof; if (o) { (o.anims || []).forEach(a => a.cancel()); o.anims = []; o.leaving = false; o.key = (o.key || 0) + 1; }
  r.classList.remove("oof-on"); document.body.classList.remove("oof-leave");
  [...(r.querySelectorAll(".oof-sheet,.oof-scrim,.cl,.cl-back,.ch-msgs,.ch-comp"))].forEach(e => { if (e.parentElement === r) { e.style.translate = ""; e.style.opacity = ""; } });
  if (ret && ret.el) ret.el.style.translate = "";
}
function oofFly(r, p0, p1, dur, ease, done) {
  const o = r._oof || (r._oof = {}), P = oofParts(r), W = r.offsetWidth || innerWidth, key = o.key = (o.key || 0) + 1;
  r.classList.add("oof-on"); oofApply(r, p0); (o.anims || []).forEach(a => a.cancel()); o.anims = [];
  const opt = { duration: dur, easing: ease, fill: "forwards" }, tx = p => `${((1 - p) * W).toFixed(1)}px 0`;
  P.surf.forEach(e => o.anims.push(e.animate([{ translate: tx(p0) }, { translate: tx(p1) }], opt)));
  if (P.list) o.anims.push(P.list.animate([{ translate: `${(-p0 * W * RECEDE).toFixed(1)}px 0` }, { translate: `${(-p1 * W * RECEDE).toFixed(1)}px 0` }], opt));
  o.anims.push(P.scrim.animate([{ opacity: .2 * p0 }, { opacity: .2 * p1 }], opt));
  o.anims[0].onfinish = () => { if (o.key !== key) return; oofApply(r, p1); o.anims.forEach(a => a.cancel()); o.anims = []; done && done(); };
}
function setCv(v) {
  const was = document.body.dataset.cv;
  document.body.dataset.cv = v;
  const r = $("#right"), go = !!(r && was && was !== v);
  r && r.classList.remove("oof-f");
  if (go && hatch()) {   // #hc=cur: the old transition, untouched. The class stays on until the next switch: removing it would hand #right back to the tab-switch m-in animation and blink
    if (!reduced.matches) { r.classList.remove("cv-push", "cv-pop"); void r.offsetWidth; r.classList.add(v === "thread" ? "cv-push" : "cv-pop"); }
  } else if (go && reduced.matches) { void r.offsetWidth; r.classList.add("oof-f"); }   // reduced motion: a 140ms cross-fade only
  if (v === "thread") { const m = $(".ch-msgs"); if (m) { stick(m, true); m.scrollTop = m.scrollHeight; } }   // t-dm-scroll: opening a thread always lands on (and stays on) the newest message
  if (v === "list") { const ta = $(".ch-comp textarea"); if (ta && document.activeElement === ta) ta.blur(); if (r) oofClear(r); }
  convList();
  if (go && v === "thread" && oofOK()) {
    r.style.animation = "none";   // setTab just switched the screen on: its 450ms m-in fade would fight the push (setTab clears this when you come back from another tab)
    oofFly(r, 0, 1, parseFloat(tok("--m-move")) || 330, tok("--m-ease-std") || "ease-out", () => oofClear(r));
    oofEnter(r);
  }
}
// oof: the shell (#right) slides in via CSS; here only the latest ~6 messages get a stagger index (--i). Class names are transient: a poll re-render replaces the nodes and never replays it.
function oofEnter(r) {
  const box = $(".ch-msgs", r); if (!box) return;
  const got = []; let k = 0;   // walk newest -> oldest; idx 0 = newest message; a time stamp shares the index of the message under it
  for (let i = box.children.length - 1; i >= 0 && k < 6; i--) {
    const el = box.children[i], cl = el.classList;
    if (cl.contains("msg") || cl.contains("m-typing")) got.push([el, k++]);
    else if (cl.contains("m-tsep") && k) got.push([el, k - 1]);
  }
  const tagged = got.map(([el, idx]) => { el.classList.add("oof-i"); el.style.setProperty("--i", Math.max(0, k - 1 - idx)); return el; });   // oldest = 0
  r.classList.add("oof-run"); clearTimeout(r._oofC);
  r._oofC = setTimeout(() => { r.classList.remove("oof-run"); tagged.forEach(e => { e.classList.remove("oof-i"); e.style.removeProperty("--i"); }); }, 700);
}
// t-dm-back-nav: a thread opened from OUTSIDE the chat tab (home strip, avatars, the office, a detail page, activity, search) goes back where it came from.
// The origin screen stays mounted (visibility only, so its scroll position, the D1 strip's open panel and the office fold are untouched) and it is the layer
// that recedes 28% under the thread instead of the conversation list; back / swipe / the browser's own back all land on it. From the chat list nothing changes.
let ret = null;   // { tab, page, el }
function retFrom() {
  const tab = document.body.dataset.mtab;
  if (!tab || tab === "chat" || !oofOK()) return null;
  const dw = $("#drawer"), el = tab === "page" && dw && !dw.hidden ? dw : tab === "menu" ? $("#left") : tab === "page" ? $("#main") : null;
  return el ? { tab, page: App.UI.page, el, search: document.body.classList.contains("msearch") } : null;
}
function retSet(from) {
  if (ret && ret.el) { ret.el.style.translate = ""; }
  ret = from || null;
  if (ret) document.body.dataset.ret = ret.tab === "menu" ? "left" : "main"; else delete document.body.dataset.ret;
}
function retGo() {   // land on the origin: one synchronous swap (no paint in between), the origin was never unmounted so nothing re-animates
  const o = ret; retSet(null);
  setCv("list");
  document.body.dataset.mtab = o.tab;
  if (o.tab === "page" && o.page && App.UI.page !== o.page) App.go(o.page);
  const rr = $("#right"); if (rr) rr.style.animation = "";
  renderBar();
}
function openConv(id, from) {
  retSet(from && document.body.dataset.cv !== "thread" ? from : null);
  App.setChat(id);   // runs while the composer is still hidden, so its focus() doesn't pop the keyboard
  history.pushState({ cv: 1 }, "");
  const l = convMsgs(id);   // renderChat ran while the list was showing, so mark this thread read here
  if (l.length) { App.UI.seen["chat." + id] = l[l.length - 1].t; LS.set("seen", App.UI.seen); if (App.chatMailRead) App.chatMailRead(id, l[l.length - 1].t); }
  setCv("thread"); composers(); renderBar();
}
function oofCommitBack() { if (history.state && history.state.cv) history.back(); else if (ret) retGo(); else setCv("list"); }
function backToList() {
  const r = $("#right");
  if (r && document.body.dataset.cv === "thread" && oofOK()) {
    const o = r._oof || (r._oof = {}); if (o.leaving) return;
    o.leaving = true; document.body.classList.add("oof-leave");   // the tab bar comes back in parallel
    const ta = $(".ch-comp textarea"); if (ta && document.activeElement === ta) ta.blur();
    oofFly(r, oofP(r), 0, parseFloat(tok("--m-release")) || 220, tok("--m-ease-std") || "ease-out", () => { o.leaving = true; oofCommitBack(); });   // history.back -> popstate -> setCv("list") clears the layers
    return;
  }
  oofCommitBack();
}
let swipeAbort = null;   // set by the swipe block below: drops a live finger drag (a popstate means the browser already navigated)
function convList() {
  const r = $("#right"); if (!r || !$(".ch-head", r) || !App.ST) return;
  let el = $(".cl", r);
  if (!el) {
    el = document.createElement("div"); el.className = "cl";
    el.innerHTML = `<div class="cl-h"></div><label class="cl-search">${SEARCH}<input type="search" enterkeyhint="search"><button type="button" class="cl-x" aria-label="clear">${CLEAR}</button></label><div class="cl-rows"></div>`;
    r.prepend(el);
    $("input", el).addEventListener("input", e => { convQ = e.target.value.trim().toLowerCase(); e.target.closest(".cl-search").classList.toggle("has-q", !!e.target.value); convList(); });   // css: only toggles a class, the field itself is never re-rendered (IME-safe)
    $(".cl-x", el).addEventListener("click", e => { e.preventDefault(); const i = $(".cl-search input", el); i.value = ""; convQ = ""; $(".cl-search", el).classList.remove("has-q"); convList(); i.focus(); });
    el.addEventListener("click", e => { const b = e.target.closest("[data-conv]"); if (b) openConv(b.dataset.conv); });
    const bar = document.createElement("div"); bar.className = "cl-back";
    bar.innerHTML = `<button aria-label="${en() ? "Back" : "返回"}">${BACK}<i class="n"></i></button><div class="who"></div>`;
    $(".ch-head", r).before(bar);
    $("button", bar).addEventListener("click", backToList);
  }
  $(".cl-h", el).textContent = en() ? "Chats" : "对话";
  $(".cl-search input", el).placeholder = en() ? "Search" : "搜索";
  const all = convRows();
  const html = all.filter(x => !convQ || (App.aname(x.a) + " " + App.atitle(x.a) + " " + preview(x.last)).toLowerCase().includes(convQ)).map(x => {
    const st = x.a.id !== "manager" && x.a.status === "working" ? `<i class="st">${App.t("working")}</i>` : "";
    const pop = x.n > (prevN[x.a.id] ?? x.n) ? " pop" : ""; prevN[x.a.id] = x.n;
    const dr = App.draft ? App.draft("dm:" + x.a.id) : null;   // t-draft-keep: unsent text shows as [草稿] like WeChat
    return `<button class="cl-row ${x.a.id === "manager" ? "pin" : ""}" data-conv="${x.a.id}">
      <span class="cl-av">${App.av(x.a)}${x.n ? `<b class="cl-n${pop}">${x.n > 99 ? "99+" : x.n}</b>` : ""}</span>
      <span class="cl-m"><span class="cl-t"><span class="nm">${esc(App.aname(x.a))}</span>${App.qBadge ? App.qBadge(x.a.id) : ""}${st}<time>${wtime(x.last && x.last.t)}</time></span>
      <span class="cl-p">${dr ? `<span class="cl-dr">${en() ? "[Draft]" : "[草稿]"}</span> ${esc(dr.t.replace(/\s+/g, " ").trim())}` : x.last ? esc(preview(x.last)) : `<em>${esc(App.atitle(x.a))}</em>`}</span></span></button>`;
  }).join("") || `<div class="empty">${App.t("empty")}</div>`;
  const box = $(".cl-rows", el);
  const hk = App.phaseFree ? App.phaseFree(html) : html;   /* t-yarn-anim: wall-clock phases (--wp) are not a change */
  if (box._html !== hk) { box.innerHTML = html; box._html = hk; }
  const a = App.agent(App.UI.chat), others = all.filter(x => x.a.id !== App.UI.chat).reduce((n, x) => n + x.n, 0);
  $(".cl-back .n", r).textContent = others ? (others > 99 ? "99+" : others) : "";
  $(".cl-back .who", r).innerHTML = `${App.av(a, "sm")}<span class="wt"><span class="nm">${esc(App.aname(a))}${App.qBadge ? App.qBadge(a.id) : ""}</span><span class="ti">${esc(App.atitle(a))}${a.status === "working" ? ` · <i class="st">${App.t("working")}<span class="m-dots"><i></i><i></i><i></i></span></i>` : ""}</span></span>`;
  decorateThread();
}

// ---------- chat bubbles + motion (t-mobile-chat-bubbles) ----------
const prevN = {};
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
function motion(el, cls, ms) {
  if (!el || reduced.matches) return;
  el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
  clearTimeout(el["_t" + cls]); el["_t" + cls] = setTimeout(() => el.classList.remove(cls), ms);
}
function sepTime(iso) {   // WeChat-style centred stamps: 10:40 · 昨天 21:10 · 星期二 21:10 · 10/19 21:10
  const d = new Date(iso), hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`, w = wtime(iso);
  return w === hm ? hm : `${w} ${hm}`;
}
// t-dm-scroll: keep an open thread pinned to the newest message while late content grows it (attachment thumbnails, card chips, stamps, the composer).
// Seen on the iPhone: the thread was pinned once at open, then the last message's screenshot loaded (+220px here) and nothing re-pinned, so it opened mid-thread.
// m._pin = "the user is at the bottom". Only a real scroll changes it (content growth fires no scroll event), so scrolling up turns it off and
// 「加载更早的消息」 keeps its own position (you are at the top then). A ResizeObserver on the messages + a capture load listener re-pin while _pin is on.
function stick(m, on) {
  if (on != null) m._pin = on;
  if (m._pinOn) return; m._pinOn = true;
  const pin = () => { if (m._pin && document.body.dataset.cv === "thread" && m.clientHeight) m.scrollTop = m.scrollHeight; };
  let q = 0; const later = () => { if (!q) q = requestAnimationFrame(() => { q = 0; pin(); }); };
  // t-dm-scroll-2: only a scroll the USER makes may turn _pin off. iOS Safari has no scroll anchoring, so when two thumbnails land a few ms apart the scroll
  // event of our own pin write (dispatched a frame later) already sees the second image's height (>= 80px), set _pin = false, and the thread stuck 120-270px
  // above the bottom. User = a finger on the list, a wheel, or scroll events still streaming within 250ms of one (iOS momentum after the finger lifts).
  let touch = false, lastUser = 0;
  const user = () => touch || performance.now() - lastUser < 250;
  m.addEventListener("touchstart", () => { touch = true; lastUser = performance.now(); }, { passive: true });
  const lift = () => { touch = false; lastUser = performance.now(); };
  m.addEventListener("touchend", lift, { passive: true }); m.addEventListener("touchcancel", lift, { passive: true });
  m.addEventListener("wheel", () => { lastUser = performance.now(); }, { passive: true });
  m.addEventListener("scroll", () => {
    if (user()) lastUser = performance.now();   // momentum keeps counting as the user's scroll while events keep coming
    else if (m._pin) return;   // our own pin, a clamp, a layout shift: never unpins
    m._pin = m.scrollHeight - m.scrollTop - m.clientHeight < 80;
  }, { passive: true });
  const ro = new ResizeObserver(later);
  const watch = () => { for (const c of m.children) if (!c.__pin) { c.__pin = 1; ro.observe(c); } };
  new MutationObserver(() => { watch(); later(); }).observe(m, { childList: true });
  ro.observe(m); watch();
  m.addEventListener("load", later, true);   // <img> inside a bubble: its box may not change size until decode on iOS
}
function decorateThread() {
  const box = $("#right .ch-msgs"); if (!box || document.body.dataset.cv !== "thread") return;
  const msgs = [...box.querySelectorAll(".msg[data-t]")];
  if (!msgs.length || box.querySelector(".m-tsep")) return syncTyping(box);   // renderChat rebuilds the box, so a stamp means "already done"
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;   // renderChat just pinned it; the stamps add height
  let prev = null, pw = null;
  msgs.forEach(m => {
    const t = m.dataset.t, w = m.classList.contains("me") ? "\u0001me" : (m.dataset.who || "");
    if (!prev || new Date(t) - new Date(prev) > 5 * 60e3) m.insertAdjacentHTML("beforebegin", `<div class="m-tsep">${sepTime(t)}</div>`);
    const pe = m.previousElementSibling; m.classList.toggle("m-cont", !!pe && pe.classList.contains("msg") && w === pw);   // P3: same speaker again, no stamp between = one avatar for the run
    prev = t; pw = w;
    /* t-m-chat-avatar-row: avatar + name row above the bubble (agents: their .mh; me: .m-hd, on the right). chatPatch keeps nodes, so only add it once.
       The group-style .m-nm is gone: the .mh row already names whoever speaks. */
    if (m.classList.contains("me") && !m.querySelector(":scope > .m-hd")) m.insertAdjacentHTML("afterbegin", `<div class="m-hd">${meAv()}<span class="m-hn">${esc(meName())}</span></div>`);
  });
  const key = App.UI.chat, n = msgs.length;
  if (box._for === key && n > (box._n || 0)) { const last = msgs[msgs.length - 1]; motion(last, "m-new", 260); if (last.classList.contains("me")) $("#right .ch-comp").classList.remove("sending"); }
  box._for = key; box._n = n;
  syncTyping(box);
  if (atBottom) box.scrollTop = box.scrollHeight;
}
// "me" avatar: avatars/me.(png|jpg|webp|gif) if the user has added one (server lists it in meta.avatars), else a house-style placeholder tile
function meAv() {
  const f = (App.ST.meta.avatars || {}).me;
  if (f) return `<span class="av m-meav" style="background-image:url('${App.avatarUrl({ id: "me" })}')"></span>`;
  const o = App.ST.meta.owner, ch = o && !o.startsWith("<") ? [...o.trim()][0] : (en() ? "Me" : "我");
  return `<span class="av m-meav ph"><b>${esc(ch)}</b></span>`;
}
function meName() { const o = App.ST.meta.owner; return o && !o.startsWith("<") ? o.trim() : (en() ? "Me" : "我"); }
function syncTyping(box) {   // agent busy and you spoke last → a typing bubble at the bottom
  const a = App.agent(App.UI.chat), l = convMsgs(App.UI.chat), last = l[l.length - 1];
  const on = App.typingOn ? App.typingOn(a, last) : a.status === "working" && last && last.who === "me";   // t-typing-fix: same rule as desktop
  let tb = $(".m-typing", box);
  if (on && !tb) { box.insertAdjacentHTML("beforeend", `<div class="m-typing" data-until="${App.typingUntil ? App.typingUntil(last) : ""}">${App.av(a)}<div class="mb"><span class="m-dots"><i></i><i></i><i></i></span></div></div>`); box.scrollTop = box.scrollHeight; }
  else if (!on && tb) tb.remove();
}

function wirePhChatList() {
  // t-push-deeplink: the phone half of App.route (a tapped notification, or the cold-start hash). Same entries as a tap would use, so back behaves the same:
  // a DM opened from another tab returns there (retFrom), from the chat list it returns to the list; a card is the drawer over the current page (back closes it / walks the parent stack).
  window.MRoute = ({ item, dm, page }) => {
    if (document.body.classList.contains("msearch")) { closeSearch(); renderBar(); }
    if (dm) {
      if (App.UI.item) App.closeItem();
      if (document.body.dataset.mtab === "chat" && document.body.dataset.cv === "thread" && App.UI.chat === dm) return;
      const from = retFrom(); setTab("chat"); openConv(dm, from);
      return;
    }
    if (page) setTab("page", page);
    if (item) {
      if (document.body.dataset.mtab === "chat") setTab(...HOME[mv]);   // the drawer lives in #main, which the chat screen covers
      App.openItem(item);
    }
  };
  addEventListener("popstate", () => { if (swipeAbort) swipeAbort(); if (mq.matches && document.body.dataset.cv === "thread" && document.body.dataset.mtab === "chat") { if (ret) retGo(); else { setCv("list"); renderBar(); } } });
  // oof v2.1 (t-chat-open-feel, swipe bug): three fixes on top of v2.
  //  1. iOS Safari / the home-screen app owns a back swipe that starts in the first ~24px: it slides its own page snapshot (the list) and pops the history. If our drag also started there, two animations
  //     of the same gesture ran at once (a doubled list, two tab bars, a gap, then a late popstate). So a touch that starts inside the native zone is left completely alone; popstate then just swaps to the list.
  //  2. touchmove / touchend are bound to the touchstart TARGET as well as document: a poll re-render replaces the message node under the finger, WebKit keeps firing on that detached node and those events
  //     never reach document, so the drag froze half-way and never ended (layers stuck with inline translate, oof-on, tab bar half in). Chromium retargets instead, so both paths are listened to, de-duplicated.
  //  3. If the browser cancels the touch (touchcancel: a system gesture took over) we do not spring back at once, we wait for the popstate that follows a native back; only if none comes do we settle.
  // Starts at x >= 24 in the left zone, or on a clearly horizontal rightward drag; inputs / horizontally scrollable areas (code blocks) are left alone.
  (() => {
    const NATIVE = 24;
    let st = null, wait = 0;
    const hscroll = (el, r) => { for (; el && el !== r && !(el.classList && el.classList.contains("ch-msgs")); el = el.parentElement) {   // .ch-msgs itself is the vertical thread: at 320px a wide .opts row made it 19px "scrollable", which switched the whole swipe off
      if (el.scrollWidth > el.clientWidth + 2 && /(auto|scroll)/.test(getComputedStyle(el).overflowX)) return true; } return false; };
    // events reach us from the target (iOS keeps firing on a node a re-render just detached, and those never bubble to document) AND from document (Chromium retargets to a live node): same event, handled once
    const once = (e, fn) => { if (e.__sw) return; e.__sw = 1; fn(e); };
    const mv = e => once(e, onMove), en_ = e => once(e, onEnd), cn = e => once(e, onCancel);
    const unbind = s => { if (s && s.tg) { s.tg.removeEventListener("touchmove", mv); s.tg.removeEventListener("touchend", en_); s.tg.removeEventListener("touchcancel", cn); s.tg = null; } };
    swipeAbort = () => { clearTimeout(wait); unbind(st); st = null; };
    document.addEventListener("touchstart", e => {
      clearTimeout(wait); unbind(st); st = null; const r = $("#right");
      if (!r || document.body.dataset.cv !== "thread" || !oofOK() || e.touches.length !== 1 || !r.contains(e.target) || document.body.classList.contains("lb-open") || (r._oof && r._oof.leaving)) return;
      if (e.target.closest("input,textarea,select,[contenteditable],video,audio,.ui2-panel")) return;
      const t = e.touches[0]; if (t.clientX < NATIVE) return;   // 1. the browser's own back swipe owns this touch
      st = { x: t.clientX, y: t.clientY, t: performance.now(), mode: "wait", edge: t.clientX < 40, r, tg: e.target };
      if (!st.edge && hscroll(e.target, r)) { st = null; return; }
      st.tg.addEventListener("touchmove", mv, { passive: true }); st.tg.addEventListener("touchend", en_, { passive: true }); st.tg.addEventListener("touchcancel", cn, { passive: true });   // 2.
    }, { passive: true });
    function onMove(e) {
      if (!st || st.mode === "no") return;
      const t = e.touches[0], dx = t.clientX - st.x, dy = t.clientY - st.y, r = st.r;
      if (document.body.dataset.cv !== "thread") { unbind(st); st = null; return; }
      if (st.mode === "wait") {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (dx > 0 && Math.abs(dx) > Math.abs(dy) * (st.edge ? 1 : 1.6)) {
          st.mode = "drag"; st.base = oofP(r); st.W = r.offsetWidth || innerWidth; st.x = t.clientX; st.p = st.base;
          oofParts(r); const o = r._oof || (r._oof = {}); o.key = (o.key || 0) + 1; oofApply(r, st.base); (o.anims || []).forEach(a => a.cancel()); o.anims = [];   // grabbing mid-flight: freeze where it is
          r.classList.add("oof-on"); document.body.classList.add("oof-leave");
          const ta = $(".ch-comp textarea"); if (ta && document.activeElement === ta) ta.blur();
        } else { st.mode = "no"; return; }
      }
      const p = Math.min(1, Math.max(0, st.base - (t.clientX - st.x) / st.W)), now = performance.now();
      st.v = (st.p - p) * st.W / Math.max(1, now - (st.lt || st.t)); st.p = p; st.lt = now;   // px/ms toward the right
      oofApply(r, p);
    }
    const settle = (s, cancel) => {
      const r = s.r, o = r._oof; if (!o || document.body.dataset.cv !== "thread") return;
      const go = !cancel && (s.p < .67 || (s.v > .5 && s.p < .95));
      if (go) { o.leaving = true; oofFly(r, s.p, 0, (parseFloat(tok("--m-release")) || 220) * Math.max(.5, s.p), tok("--m-ease-std") || "ease-out", () => oofCommitBack()); }
      else oofFly(r, s.p, 1, parseFloat(tok("--m-base")) || 280, tok("--m-spring-soft") || "ease-out", () => oofClear(r));   // soft spring back, no overshoot
    };
    document.addEventListener("touchmove", mv, { passive: true }); document.addEventListener("touchend", en_, { passive: true }); document.addEventListener("touchcancel", cn, { passive: true });
    function onEnd() { const s = st; unbind(s); st = null; if (s && s.mode === "drag") settle(s, false); }
    function onCancel() {
      const s = st; unbind(s); st = null; if (!s || s.mode !== "drag") return;
      wait = setTimeout(() => settle(s, true), 420);   // 3. a native back pops the history within its own ~350ms animation (popstate clears everything); if it did not, settle back
    }
  })();
  document.addEventListener("click", e => {
    const b = e.target.closest("#right .ch-comp .m-send"); if (!b || !mq.matches) return;
    const c = b.closest(".ch-comp"); c.classList.add("sending"); clearTimeout(c._st); c._st = setTimeout(() => c.classList.remove("sending"), 4000);
  }, true);
}

export { BACK, CLEAR, SEARCH, convQ, convMsgs, convUnread, pad2, wtime, preview, convRows, hatch, oofOK, tokC, tok, RECEDE, oofParts, oofApply, oofP, oofClear, oofFly, setCv, oofEnter, ret, retFrom, retSet, retGo, openConv, oofCommitBack, backToList, swipeAbort, convList, prevN, reduced, motion, sepTime, stick, decorateThread, meAv, meName, syncTyping, wirePhChatList };
