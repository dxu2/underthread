// Phone layer: the 搜索 tab, a search sheet over cards and chats.
// t-oss-struct S10 (A8): moved out of mobile.js unchanged. Its wire*() function holds what used to run at load (listeners, observers, the
// self-contained blocks); mobile.js calls it where the code used to be, so everything runs in the same order as before.


// ===== ui15: 搜索 tab = minimal search sheet over items and chats (nothing existed on the phone besides the chat-list filter) =====
import { catChips, dotPop, menuExtras, moreTitle, renderBar, setTab, strip } from "./nav.js";
import { deck } from "./deck.js";
import { composers, ui2Comp } from "./composer.js";
import { CLEAR, SEARCH, convList, openConv, preview, retFrom } from "./chatlist.js";
import { $, H, HOME, LS, en, mq, mv, ready, setMv, setReady } from "../mobile.js";
let sq = "", sActs = [], sHits = [], sTab = "all", sDeb = 0;   // t-ri1103-p5: sHits = the draft / talk / chat hit rows, sTab = category
const sEl = () => $("#msearch");
function closeSearch() { if (!document.body.classList.contains("msearch")) return; document.body.classList.remove("msearch"); const e = sEl(); if (e) e.hidden = true; const i = e && $("input", e); if (i) i.blur(); }
function openSearch() {
  if (!App.ST) return;
  let el = sEl();
  if (!el) {
    el = document.createElement("div"); el.id = "msearch"; el.hidden = true;
    el.innerHTML = `<div class="ms-bar"><label class="cl-search ms-in">${SEARCH}<input type="search" enterkeyhint="search" autocomplete="off"><button type="button" class="cl-x" aria-label="clear">${CLEAR}</button></label></div><div class="ms-res"></div>`;
    document.body.appendChild(el);
    $("input", el).addEventListener("input", e => { const v = e.target.value.trim().toLowerCase(); e.target.closest(".ms-in").classList.toggle("has-q", !!e.target.value);   // class toggle only: input never re-rendered (IME-safe)
      clearTimeout(sDeb); const go = () => { sq = v; if (!v) sTab = "all"; searchRender(); }; if (!v) go(); else sDeb = setTimeout(go, 150); });   // t-ri1103-p5: 150 ms debounce
    $(".cl-x", el).addEventListener("click", e => { e.preventDefault(); clearTimeout(sDeb); const i = $("input", el); i.value = ""; sq = ""; sTab = "all"; $(".ms-in", el).classList.remove("has-q"); searchRender(); i.focus(); });
    el.addEventListener("click", e => {
      const tb = e.target.closest("[data-stab]"); if (tb) { sTab = tb.dataset.stab; searchRender(); $(".ms-res", el).scrollTop = 0; return; }   // t-ri1103-p5
      const sh = e.target.closest("[data-shit]"); if (sh) { const h = sHits[+sh.dataset.shit]; if (!h) return;
        if (h.chat) { const from = retFrom(); closeSearch(); setTab("chat"); openConv(h.chat, from); if (App.seekChat) App.seekChat(h.t, h.q); } else { closeSearch(); renderBar(); h.run(); } return; }   // close first: the card opens under the sheet otherwise
      const it = e.target.closest("[data-sitem]"), cv = e.target.closest("[data-sconv]"), ac = e.target.closest("[data-sact]");
      if (ac) { const a = sActs[+ac.dataset.sact]; if (!a) return; if (!a.id.startsWith("dm:")) { closeSearch(); renderBar(); } a.run(); return; }   // a DM keeps the sheet as its return point (retFrom)
      if (it) App.openItem(it.dataset.sitem);
      else if (cv) { const id = cv.dataset.sconv; const from = retFrom(); closeSearch(); setTab("chat"); openConv(id, from); }
    });
  }
  document.body.classList.add("msearch"); el.hidden = false;
  $("input", el).placeholder = en() ? "Search items and chats" : "搜索条目和对话";
  searchRender(); renderBar();
  /* t-ui-fix-p1 P1-2: focus inside the same tap, so the keyboard comes up at once (iOS only raises it from a user gesture, never from a timer) */
  try { $("input", el).focus({ preventScroll: true }); } catch (e) { }
}
/* t-thread-motif ④: no-result state; the spool drawing only shows under 特典 */
const msNone = () => App.utEmpty ? App.utEmpty(App.t("empty"), "empty", en() ? "No loose thread here" : "没找到这根线头") : `<div class="empty">${App.t("empty")}</div>`;
function searchRender() {
  const el = sEl(); if (!el || el.hidden && !document.body.classList.contains("msearch")) return;
  const q = sq, kindOf = it => it.kind === "task" ? "deliverable" : it.kind;
  const R = window.Pal.find(q), { items, actions } = R;   // t-imp-p5: the same search as the desktop ⌘K palette (palette.js)
  const tab = q ? sTab : "all", all = tab === "all", TB = ["all", "drafts", "talk", "convs"];
  sActs = all ? actions.slice(0, q ? 10 : 3) : []; sHits = [];
  const h = (t, k, n) => `<div class="ms-h">${t}${k && all && n > 3 ? `<button type="button" class="ms-more" data-stab="${k}">${en() ? `All ${n > 30 ? "30+" : n}` : `全部 ${n > 30 ? "30+" : n} 条`} ›</button>` : ""}</div>`;
  const tabs = q ? `<div class="ms-tabs">${TB.map(k => `<button type="button" class="${k === tab ? "on" : ""}" data-stab="${k}">${window.Pal.tabName(k)}${k === "all" ? "" : ` <i>${R.n[k] > 30 ? "30+" : R.n[k]}</i>`}</button>`).join("")}</div>` : "";
  const hitRows = (k, list) => list.slice(0, all ? 3 : 30).map(x => { const ht = window.Pal.hitText(x, q, k), i = sHits.push({ run: window.Pal.seekOf(x, k, q) }) - 1;
    return `<button class="ms-row ms-hit" data-shit="${i}"><span class="ms-av">${ht.who === "me" ? App.av("me") : App.av(App.agent(ht.who))}</span><span class="ms-m"><b>「${ht.snip}」</b><span>${ht.sub}</span></span></button>`; }).join("");
  const convs = R.convs.slice(0, all ? 3 : 30);
  const hitsHTML = ["drafts", "talk"].filter(k => (all || tab === k) && R[k].length).map(k => h(window.Pal.tabName(k), k, R.n[k]) + hitRows(k, R[k])).join("");
  const acts = sActs.length ? h(en() ? "Actions" : "操作") + sActs.map((a, i) => `<button class="ms-row ms-act" data-sact="${i}"><span class="ms-av ms-ic">${a.id.startsWith("approve:") ? "✓" : a.id.startsWith("dm:") ? "@" : a.id.startsWith("theme:") ? "◐" : a.id === "status" ? "♥" : "→"}</span><span class="ms-m"><b>${esc(a.label)}</b><span>${esc(a.sub || "")}</span></span></button>`).join("") : "";
  const convRow = x => { if (!x.hit) return `<button class="ms-row" data-sconv="${x.a.id}"><span class="ms-av">${App.av(x.a)}</span><span class="ms-m"><b>${esc(App.aname(x.a))}</b><span>${x.m ? esc(preview(x.m)) : esc(App.atitle(x.a))}</span></span></button>`;
    const i = sHits.push({ chat: x.a.id, t: x.m.t, q }) - 1;   // t-ri1103-p5: every chat hit, with the matched words
    return `<button class="ms-row ms-hit" data-shit="${i}"><span class="ms-av">${App.av(x.a)}</span><span class="ms-m"><b>「${window.Pal.hlAll(window.Pal.around(x.m.text, q), q)}」</b><span>${esc(App.aname(x.a))} · ${x.m.who === "me" ? (en() ? "you" : "你说") : esc(App.aname(App.agent(x.m.who) || x.a))} · ${App.whenH(x.m.t)}</span></span></button>`; };
  const html = tabs + acts + hitsHTML + ((all || tab === "convs") && convs.length ? h(en() ? "Chats" : "对话", "convs", R.n.convs) + convs.map(convRow).join("") : "")
    + (all && items.length ? h(q ? (en() ? "Items" : "条目") : (en() ? "Recent" : "最近")) + items.map(it => `<button class="ms-row" data-sitem="${esc(it.id)}"><span class="ms-av">${App.av(App.agent(it.owner))}</span><span class="ms-m"><b>${window.Pal.hlAll(it.title, q)}</b><span><i class="tag ${it.stage === "review" ? kindOf(it) : ""}">${it.stage === "review" ? App.t(kindOf(it)) : esc(App.stageLabel(it.stage))}</i> ${esc(App.aname(App.agent(it.owner)))} · ${App.whenH(it.activity)}</span></span></button>`).join("") : "")
    || msNone();
  const box = $(".ms-res", el);
  if (q && html === tabs) { const e2 = msNone(); if (box._html !== tabs + e2) { box.innerHTML = box._html = tabs + e2; } return; } if (box._html !== html) { box.innerHTML = html; box._html = html; }
}

function setVariant(v) {
  setMv(v); LS.set("mview", v); document.body.dataset.mv = v;
  const b = $("#tabbar .tb-row"); if (b) b._html = null;
  setTab(...HOME[v]);
  if (window.FX) FX.enter($("#pagebody"));
}
function sync() {
  if (!mq.matches || !App.ST) return;
  if (!ready) { setReady(true); document.body.dataset.mv = mv; setTab(...(H.get("mtab") ? [H.get("mtab"), H.get("page")] : HOME[mv])); }
  catChips(); moreTitle(); menuExtras(); composers(); ui2Comp(); convList(); dotPop();
  if (mv === "chat") strip();
  if (mv === "deck" && App.UI.page === "review") deck();
  if (document.body.classList.contains("msearch")) searchRender();
  renderBar();
}
function onMQ() {
  if (mq.matches) { setReady(false); sync(); }
  else { delete document.body.dataset.mtab; delete document.body.dataset.mv; delete document.body.dataset.cv; }
}

function wirePhSearch() {
  document.addEventListener("rt-arch", () => searchRender());
  document.addEventListener("rt-hist", () => searchRender());   /* ri1105-P4: older chat landed */   // t-perf A: archived cards finished loading (App.archAll)
  App.openSearch = () => openSearch();   // t-imp-p5: ⌘K on a phone-width window, and the home search button
  document.addEventListener("click", e => { if (mq.matches && e.target.closest("[data-msearch]")) openSearch(); });
  document.addEventListener("click", e => {   // the page behind the sheet: any in-page navigation closes it
    if (mq.matches && document.body.classList.contains("msearch") && e.target.closest("#left [data-go], #main [data-go]")) { closeSearch(); renderBar(); }
  }, true);
}

export { sq, sActs, sHits, sTab, sDeb, sEl, closeSearch, openSearch, msNone, searchRender, setVariant, sync, onMQ, wirePhSearch };
