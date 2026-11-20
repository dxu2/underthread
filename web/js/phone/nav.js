// Phone layer: screens and the tab bar (setTab, tab bar motion), per-render additions, small motion helpers and the routing glue.
// t-oss-struct S10 (A8): moved out of mobile.js unchanged. Its wire*() function holds what used to run at load (listeners, observers, the
// self-contained blocks); mobile.js calls it where the code used to be, so everything runs in the same order as before.

// ---------- screens ----------
import { SEARCH, convRows, oofOK, openConv, ret, retFrom, retSet, setCv } from "./chatlist.js";
import { closeSearch, openSearch } from "./search.js";
import { $, BAR5, QPAGES, en, lastQ, mq, setLastQ, svg } from "../mobile.js";
function setTab(tab, page) {
  closeSearch();
  if (document.body.dataset.mtab !== "chat") { const rr = document.getElementById("right"); if (rr) rr.style.animation = ""; }   // oof: give #right its tab-switch m-in back (it is hidden now, so it cannot blink)
  if (tab !== "chat" && ret) retSet(null);   // t-dm-back-nav: left the thread some other way: forget the origin
  document.body.dataset.mtab = tab;
  if (tab === "page" && page && App.UI.page !== page) App.go(page);
  if (tab === "chat") setCv("list");   // the 管家 tab opens on the conversation list
  renderBar();
  moreTitle();   // t-ri1115-a P3: a 更多 row tap renders the page before this switch, so the title row is placed here too
}
function activeKey() {
  let tab = document.body.dataset.mtab, p = App.UI.page;
  if (tab === "chat" && ret) { tab = ret.tab; p = ret.page; }   // t-dm-back-nav: a thread opened from elsewhere keeps the origin's tab lit (the bar slides back in on a swipe)
  if (document.body.classList.contains("msearch")) return "search";
  if (tab === "chat") return "dms";
  if (tab === "menu") return "more";
  if (p === "review") return "home";
  if (QPAGES.includes(p)) return "quests";   // t-vis-b2: categories belong to the 委托 tab now (委托板 / board stays under 更多)
  if (p === "mail") return "activity";
  return "more";
}
function badges() {
  const ST = App.ST; if (!ST) return {};
  const review = App.items().filter(i => App.onYouCard ? App.onYouCard(i) : i.stage === "review" && !(App.busy && App.busy(i))).length + (App.newReplies ? App.newReplies().length : 0);   /* t-doing-first; t-review-unread: + cards with unread replies */
  const chat = convRows().reduce((n, x) => n + x.n, 0);   // unread across every conversation
  const mail = App.mailUnread ? App.mailUnread() : (App.ST.mail || []).filter(m => !m.read).length;   /* ri1105-P4: server count */
  return { home: review, dms: chat, activity: mail };   // ui15: dots, not numbers
}
// ---------- tabbar motion (t-tabbar-motion) ----------
// One sliding selection block (.tb-sel: translateX + a mid-move squash, WAAPI), press scale, icon pop, dot pop/fade, page-in.
// Buttons are built once and patched in place (the old code rewrote innerHTML on every tab change, which killed every transition).
const TBM = { dur: 330, spring: null, rm: window.matchMedia("(prefers-reduced-motion: reduce)") };
const TBM_EASE = "cubic-bezier(.2,.8,.2,1)";
const tbmAnim = (el, kf, o) => { try { return el.animate(kf, o); } catch (e) { return null; } };
function tbmSel(row, idx, animate) {
  const ind = row.querySelector(".tb-sel"); if (!ind) return;
  const btn = idx >= 0 ? row.querySelectorAll("button")[idx] : null;
  if (!btn) { if (ind._anim) ind._anim.cancel(); ind._anim = null; ind.style.opacity = 0; ind._x = null; return; }
  const x = btn.offsetLeft, w = btn.offsetWidth;
  if (!w) return;   // bar not laid out (hidden): the ResizeObserver snaps it later
  if (ind._w !== w) { ind.style.width = w + "px"; ind._w = w; }
  const fresh = ind._x == null;
  let from = x;   // where the block is RIGHT NOW (mid-flight if the user tapped again), so a retarget never jumps
  if (!fresh) { try { from = new DOMMatrix(getComputedStyle(ind).transform).m41; } catch (e) {} }
  if (ind._anim) { ind._anim.cancel(); ind._anim = null; }
  ind.style.opacity = 1; ind.style.transform = `translateX(${x}px)`; ind._x = x;
  if (!animate || (!fresh && Math.abs(from - x) < .5)) return;
  if (fresh || TBM.rm.matches) { ind._anim = tbmAnim(ind, [{ opacity: fresh ? 0 : .35 }, { opacity: 1 }], { duration: fresh ? 160 : 140, easing: "ease-out" }); return; }
  const k = Math.min(.14, .05 + Math.abs(x - from) / w * .025);   // stretch grows a little with distance, capped at 14%
  ind.style.willChange = "transform";
  const a = tbmAnim(ind, [
    { transform: `translateX(${from}px) scale(1,1)` },
    { offset: .42, transform: `translateX(${(from + x) / 2}px) scale(${1 + k},${1 - k * .45})` },
    { transform: `translateX(${x}px) scale(1,1)` }], { duration: TBM.dur, easing: TBM.spring || TBM_EASE });
  ind._anim = a;
  if (!a) { ind.style.willChange = ""; return; }
  const clear = () => { if (ind._anim === a) { ind._anim = null; ind.style.willChange = ""; } };
  a.onfinish = clear; a.oncancel = () => { if (ind._anim === a || !ind._anim) ind.style.willChange = ""; };
}
function tbmPop(btn) {   // the newly selected icon: 1 -> 1.12 -> 1
  if (TBM.rm.matches) return;
  const s = btn.querySelector("svg"); if (!s) return;
  if (s._pop) s._pop.cancel();
  s._pop = tbmAnim(s, [{ transform: "scale(1)" }, { transform: "scale(1.12)", offset: .45 }, { transform: "scale(1)" }], { duration: 280, easing: "cubic-bezier(.3,.9,.4,1)" });   // --m-base
}
function tbmDots(row, bd) {
  row.querySelectorAll("button").forEach(b => {
    let d = b.querySelector(".tb-dot"); const want = !!bd[b.dataset.k];
    if (want && (!d || d.classList.contains("tbm-out"))) {
      if (d) d.remove();
      d = document.createElement("i"); d.className = "tb-dot" + (row._built ? " tbm-in" : ""); b.appendChild(d);
      d.addEventListener("animationend", () => d.classList.remove("tbm-in"), { once: true });
    } else if (!want && d && !d.classList.contains("tbm-out")) {
      if (!row._built) d.remove();
      else { d.classList.remove("tbm-in"); d.classList.add("tbm-out"); d.addEventListener("animationend", () => d.remove(), { once: true }); setTimeout(() => { if (d.isConnected && d.classList.contains("tbm-out")) d.remove(); }, 900); }
    }
  });
}
/* t-m-tabbar-ig (direction B): icon-only bar. The name (plus the unread count) lives in aria-label / title; a long press shows it as a tip above the pill. */
function tbmName(it, n) {
  const t = en() ? it.en : it.zh;
  if (!n) return t;
  return en() ? `${t}, ${n} unread` : (it.k === "home" ? `${t} · ${n} 张待你看` : `${t} · ${n} 条未读`);
}
function tbmNames(row, items, bd, act) {
  row.querySelectorAll("button").forEach(b => {
    const it = items.find(x => x.k === b.dataset.k); if (!it) return;
    const name = tbmName(it, bd[it.k] || 0);
    if (b.getAttribute("aria-label") !== name) { b.setAttribute("aria-label", name); b.title = name; }
    const cur = b.dataset.k === act;
    if (cur !== b.hasAttribute("aria-current")) { if (cur) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); }
  });
}
function tbmTip(bar) {
  let timer = 0, hide = 0, shown = false, tip = null;
  const off = () => { clearTimeout(timer); if (tip) tip.classList.remove("on"); };
  const show = b => {
    if (!tip) { tip = document.createElement("span"); tip.className = "tb-tip"; tip.setAttribute("aria-hidden", "true"); bar.appendChild(tip); }
    const row = bar.querySelector(".tb-row"); if (!row) return;
    tip.textContent = b.getAttribute("aria-label") || "";
    const br = bar.getBoundingClientRect(), r = b.getBoundingClientRect(), rr = row.getBoundingClientRect();
    tip.style.left = (r.left + r.width / 2 - br.left) + "px";
    tip.style.bottom = (br.bottom - rr.top + 8) + "px";
    tip.classList.add("on"); shown = true;
    try { if (navigator.vibrate) navigator.vibrate(8); } catch (e) {}
  };
  bar.addEventListener("pointerdown", e => {
    const b = e.target.closest(".tb-row button"); if (!b) return;
    clearTimeout(hide); off(); shown = false;
    timer = setTimeout(() => show(b), 450);
  });
  const up = () => { clearTimeout(timer); if (shown) { clearTimeout(hide); hide = setTimeout(off, 900); } };
  bar.addEventListener("pointerup", up);
  ["pointercancel", "pointerleave"].forEach(ev => bar.addEventListener(ev, () => { clearTimeout(timer); clearTimeout(hide); hide = setTimeout(off, shown ? 600 : 0); }));
  bar.addEventListener("click", e => { if (shown) { shown = false; e.preventDefault(); e.stopPropagation(); } }, true);
  bar.addEventListener("contextmenu", e => { if (e.target.closest(".tb-row button")) e.preventDefault(); });
  window.addEventListener("blur", off);
}
function tbmPageIn(it) {   // only the container the tab just switched to; one animation, no re-render
  if (it.to[0] === "page") { if (window.FX && FX.rows) FX.rows($("#pagebody")); return; }   // mo1: rows rise in one by one (replaces the whole-container fade; guarded against App.go's own entrance)
  const els = it.to[0] === "menu" ? [$("#left")] : [];
  const rm = TBM.rm.matches;
  els.forEach(el => {
    if (!el || el.hidden) return;
    if (el._tbm) el._tbm.cancel();
    el._tbm = tbmAnim(el, rm ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: rm ? 120 : 190, easing: "cubic-bezier(.2,.8,.2,1)" });
  });
}
function tbmPress(bar) {
  let cur = null, safety = 0;
  const row = () => bar.querySelector(".tb-row");
  const up = () => {
    clearTimeout(safety);
    if (cur) cur.classList.remove("tbm-down");
    const sel = bar.querySelector(".tb-sel"); if (sel) sel.classList.remove("tbm-down");
    cur = null;
  };
  bar.addEventListener("pointerdown", e => {
    const b = e.target.closest(".tb-row button"); if (!b) return;
    up(); cur = b; b.classList.add("tbm-down");
    if (b.classList.contains("on")) { const sel = bar.querySelector(".tb-sel"); if (sel) sel.classList.add("tbm-down"); }
    safety = setTimeout(up, 2500);   // never leave a button stuck pressed
  });
  ["pointerup", "pointercancel", "pointerleave", "lostpointercapture"].forEach(ev => bar.addEventListener(ev, up));
  window.addEventListener("blur", up); document.addEventListener("visibilitychange", up);
}
function renderBar() {
  let bar = $("#tabbar");
  if (!bar) {
    bar = document.createElement("nav"); bar.id = "tabbar"; document.body.appendChild(bar);
    bar.innerHTML = `<i class="tb-orn"></i><span class="tb-ind"><b></b></span><div class="tb-row"><i class="tb-sel" aria-hidden="true"></i></div>`;
    bar.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      const it = BAR5.find(x => x.k === b.dataset.k); if (!it) return;
      if (it.k === "search") return document.body.classList.contains("msearch") ? (closeSearch(), renderBar()) : openSearch();
      const was = activeKey();
      if (it.k === "quests") { setTab("page", was === "quests" ? "quests" : (QPAGES.includes(lastQ) ? lastQ : "quests")); if (was !== it.k) tbmPageIn(it); return; }   // back to the last category you looked at; tapping again = 全部
      setTab(it.to[0], it.to[1]);
      if (was !== it.k) tbmPageIn(it);
    });
    tbmPress(bar);
    tbmTip(bar);
    const rowEl = $(".tb-row", bar);
    if (window.ResizeObserver) new ResizeObserver(() => { const r = $(".tb-row", bar); if (r && r._built) { const i = r._idx; if (r.querySelector(".tb-sel")._anim == null) tbmSel(r, i, false); } }).observe(rowEl);
  }
  const act = activeKey(), bd = badges(), items = BAR5;
  const row = $(".tb-row", bar);
  row.style.gridTemplateColumns = `repeat(${items.length}, 1fr)`;
  const key = (en() ? "en" : "zh");
  if (row._lang !== key || !row._built || row._html === null) {   // structural build: once per language (setVariant resets _html to force a rebuild)
    row.querySelectorAll("button").forEach(b => b.remove());
    row.insertAdjacentHTML("beforeend", items.map(it => { const t = en() ? it.en : it.zh; return `<button data-k="${it.k}" aria-label="${t}" title="${t}">${svg(it.i)}<span class="l" data-t="${t}" aria-hidden="true">${t}</span></button>`; }).join(""));
    row._lang = key; row._html = "built";
  }
  const first = !row._built;
  const idx = items.findIndex(it => it.k === act), prevIdx = row._idx;
  row.querySelectorAll("button").forEach(b => { const on = b.dataset.k === act; if (b.classList.contains("on") !== on) b.classList.toggle("on", on); });
  tbmDots(row, bd);
  tbmNames(row, items, bd, act);
  tbmSel(row, idx, !first);
  if (!first && idx >= 0 && idx !== prevIdx) tbmPop(row.querySelectorAll("button")[idx]);
  row._idx = idx; row._built = true;
  const ind = $(".tb-ind", bar);
  ind.style.left = `${(idx + 0.5) / items.length * 100}%`;
  ind.style.opacity = idx < 0 ? 0 : 1;
}

// ---------- per-render additions ----------
// t-vis-b2 (方案 A): home has no category bar any more (its stats row is its only filter). The 委托 tab = search field + 「全部 / 主线 / 支线 / 日常委托 / 紧急活动 / 常驻活动」 + the list grouped by stage.
function catChips() {
  const body = $("#pagebody"), p = App.UI.page; if (!body || !QPAGES.includes(p) || $(".m-seg", body)) return;
  setLastQ(p);
  const seg = document.createElement("div"); seg.className = "m-seg q";
  seg.innerHTML = `<div class="seg" data-seg="mseg">` + QPAGES.map(c => `<button class="seg-i ${p === c ? "on" : ""}" data-go="${c}">${App.t(c === "quests" ? "all_quests" : c)}</button>`).join("") + `</div>`;
  const sr = document.createElement("button"); sr.type = "button"; sr.className = "q-search";
  sr.innerHTML = `${SEARCH}<span>${App.t("search_ph")}</span>`; sr.addEventListener("click", () => openSearch());
  const ph = $(".ph", body); ph ? ph.after(sr) : body.prepend(sr); sr.after(seg);
  const tr = $(".seg", seg), on = $(".seg-i.on", seg); if (on && on.offsetLeft + on.offsetWidth > tr.clientWidth) tr.scrollLeft = on.offsetLeft - 16;   // keep the picked category in view (t-ri1111-a: the track scrolls, not the wrapper)
  /* t-ri1111-a P5: edge fades say there is more to swipe; .fl / .fr drop off at each end */
  const edge = () => { const m = tr.scrollWidth - tr.clientWidth; tr.classList.toggle("fl", tr.scrollLeft > 2); tr.classList.toggle("fr", tr.scrollLeft < m - 2); };
  tr.addEventListener("scroll", edge, { passive: true }); requestAnimationFrame(edge);
}
function strip() {
  const r = $("#right"), msgs = r && $(".ch-msgs", r); if (!msgs) return;
  let wrap = $(".m-stripwrap", r);
  if (!wrap) { wrap = document.createElement("div"); wrap.className = "m-stripwrap"; r.insertBefore(wrap, msgs); wrap.addEventListener("click", e => { const c = e.target.closest("[data-open]"); if (c) App.openItem(c.dataset.open); }); }
  const list = App.items().filter(i => App.onYouCard ? App.onYouCard(i) : i.stage === "review" && !(App.busy && App.busy(i))).sort(App.byAct);   // t-doing-first, t-home-newreplies
  const html = `<div class="m-strip-h"><span>${en() ? "WAITING ON YOU" : "等你拍板"}</span><b>${list.length}</b></div><div class="m-strip">` + (list.length ? list.map(it => {
    const a = App.agent(it.owner), kind = it.kind === "task" ? "deliverable" : it.kind;
    return `<button class="m-chip" data-open="${it.id}"><span class="tag ${kind}"><span class="gl" aria-hidden="true">◆</span>${App.t(kind)}</span><div class="t">${window.Onboard ? Onboard.exT(it) : esc(it.title)}</div><div class="m">${App.av(a, "sm")}${esc(App.aname(a))} · ${App.t(it.category)} · ${App.whenH(it.activity)}</div></button>`;
  }).join("") : `<div class="m-chip none">${App.t("empty_review")}</div>`) + `</div>`;
  if (wrap._html !== html) { wrap.innerHTML = html; wrap._html = html; }
}
/* t-ri1115-a P3: pages opened from 更多 (招聘市场 / 制作 / 报告 / 设置 …) have no tab or segment bar naming them, and t-home-title hid the
   masthead on phones. A small title row puts back 「‹ 页名」: the round chevron (same look as the card detail's back) returns to 更多.
   The name is read from the page's own (hidden) .ph h1, so studio sub-pages say 制作 like the desk masthead. Inserted per render like
   catChips(); a page that patches itself keeps the row, and its text is refreshed when the page or language changes. */
function moreTitle() {
  const body = $("#pagebody"); if (!body) return;
  const on = document.body.dataset.mtab === "page" && activeKey() === "more";
  let row = $(":scope > .m-subh", body);
  if (!on) { if (row) row.remove(); return; }
  const h1 = $(":scope > .ph h1", body), name = (h1 && h1.textContent.trim()) || App.t(App.UI.page), back = en() ? "Back to More" : "返回更多";
  if (!row) {
    row = document.createElement("div"); row.className = "m-subh";
    row.innerHTML = `<button type="button" class="m-subh-b"><svg viewBox="0 0 12 20" width="12" height="20" aria-hidden="true"><path d="M10 2 2 10l8 8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button><h2></h2>`;
    $(".m-subh-b", row).addEventListener("click", () => { setTab("menu"); const it = BAR5.find(x => x.k === "more"); if (it) tbmPageIn(it); });
    body.prepend(row);
  }
  const b = $(".m-subh-b", row), h2 = $("h2", row);
  if (h2.textContent !== name) h2.textContent = name;
  if (b.getAttribute("aria-label") !== back) b.setAttribute("aria-label", back);
}
const onSettings = () => App.UI.page === "settings" && App.ST;   // t-settings-tab: the settings rows moved from 更多 to the 设置 page
function menuExtras() {
  const left = $("#left"); if (!left) return;
  if (!$(".m-hero", left)) {
    const h = document.createElement("div"); h.className = "m-hero";
    h.innerHTML = `<div class="tc-sub" style="animation:none;font-size:10px">Personal Agent Team</div><div class="brand" style="flex-direction:row;gap:.35em;font-size:22px"><span>Under</span><span>thread</span></div>${window.ORN ? ORN.divider(200) : ""}`;
    left.prepend(h);
  }
  const old = $(".m-settings", left); if (old) old.remove();   // t-settings-tab: these rows live on the 设置 page now (更多 keeps navigation, today and the team)
}

// t-imp29-p1: 推送分级 + 夜间免打扰 + 早报, per device (server row prefs). Shown under 推送通知 only while push is on here.
function pushPrefs() {
  const p = window.Push && Push.prefs && Push.prefs(); if (!p) return "";
  const z = en(), sw = on => `<span class="sw ${on ? "on" : ""}"><i></i></span>`, hh = h => String(h).padStart(2, "0") + ":00";
  const sel = (k, v) => `<select class="pz-time" data-pz="${k}" aria-label="${k}">${Array.from({ length: 24 }, (_, h) => `<option value="${h}"${h === v ? " selected" : ""}>${hh(h)}</option>`).join("")}</select>`;
  const tiers = [["decide", "只推等你拍板", "Decisions only"], ["reply", "拍板 + 私信", "+ Messages"], ["all", "全部动态", "Everything"]];
  const quietAt = h => p.quiet && p.from !== p.to && (p.from < p.to ? h >= p.from && h < p.to : h >= p.from || h < p.to);
  const H = Push.history(); let chart = "";
  if (H && H.counts) {
    const max = Math.max(4, ...H.counts), hrs = H.counts.map((_, i) => (H.start_hour + i) % 24);
    const total = H.counts.reduce((a, b) => a + b, 0), inq = H.counts.reduce((a, n, i) => a + (quietAt(hrs[i]) ? n : 0), 0);
    chart = `<div class="pz-l">${z ? "Last 24 h · pushes to this device" : "过去 24 小时 · 推到这台设备的条数"}</div>
      <div class="pz-ch">${H.counts.map((n, i) => `<i class="${quietAt(hrs[i]) ? "q" : ""}" style="height:${n ? Math.max(3, Math.round(n / max * 52)) : 2}px" title="${hh(hrs[i])} · ${n}"></i>`).join("")}</div>
      <div class="pz-ax">${[0, 4, 8, 12, 16, 20, 23].map(i => `<span>${String(hrs[i]).padStart(2, "0")}</span>`).join("")}</div>
      <div class="pz-cap">${z ? `${total} sent${p.quiet ? ` · ${inq} during quiet hours` : ""}` : `共 ${total} 条${p.quiet ? `，免打扰时段 ${inq} 条` : ""}`}${H.held ? (z ? ` · ${H.held} held` : ` · 攒下 ${H.held} 条`) : ""}</div>`;
  }
  return `<div class="pz">
    <div class="pz-l">${z ? "What to push" : "推送什么"}</div>
    <div class="pz-seg" role="radiogroup">${tiers.map(([k, zh, e]) => `<button type="button" role="radio" aria-checked="${p.tier === k}" class="${p.tier === k ? "on" : ""}" data-set="ptier" data-v="${k}">${z ? e : zh}</button>`).join("")}</div>
    <div class="pz-r"><button type="button" class="pz-tg" data-set="pquiet"><span><b>${z ? "Quiet hours" : "夜间免打扰"}</b><small>${z ? "Urgent items still come through" : "紧急活动照推，其余先攒着"}</small></span>${sw(p.quiet)}</button>
      ${p.quiet ? `<div class="pz-span">${sel("from", p.from)}<span>–</span>${sel("to", p.to)}</div>` : ""}</div>
    ${p.quiet ? `<div class="pz-r"><button type="button" class="pz-tg" data-set="pdigest"><span><b>${z ? "Morning digest" : "早上汇总一条"}</b><small>${z ? `At ${hh(p.to)}, one push for everything held` : `${hh(p.to)} 把攒下的合成一条推送`}</small></span>${sw(p.digest)}</button></div>` : ""}
    ${chart}</div>`;
}
const dotSeen = {};   // page -> Set of unread row keys last time we looked; a key that is new now gets its dot popped (first look just records)
function dotPop() {
  if (!mq.matches || !window.App || TBM.rm.matches) return;
  const rows = [...document.querySelectorAll("#pagebody .act-row.unread")], page = App.UI.page;
  const now = new Set(rows.map(r => r.dataset.item || r.dataset.mail)), prev = dotSeen[page]; dotSeen[page] = now;
  if (!prev) return;
  rows.forEach(r => { if (prev.has(r.dataset.item || r.dataset.mail)) return; const d = r.querySelector(".act-dot"); if (d) tbmAnim(d, [{ transform: "scale(.2)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: 300, easing: TBM.spring || TBM_EASE }); });
}

// item sheet open → body.sheet (the tab bar hides behind it)
const dw = document.getElementById("drawer");
// t-vis-b1: the detail bar turns to frosted glass once content scrolls under it (mobile.css #drawer.dw-scrolled). Scroll events do not bubble, so listen in the capture phase;
// a re-render / another item swaps the scroller, so re-read its position when the drawer's children change.
const dwSync = () => { const s = dw && dw.querySelector(".dw-scroll"), on = !!(s && !dw.hidden && s.scrollTop > 6); if (dw && dw.classList.contains("dw-scrolled") !== on) dw.classList.toggle("dw-scrolled", on); };

// keyboard up → tab bar and action bars step aside
const isField = el => el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !/^(checkbox|radio|button|file)$/.test(el.type)));

// iOS home-screen app: the layout viewport can come up short by the safe areas (black band under the tab bar).
// Measure the real screen height into --app-h; body.vp-fix only when the viewport really is short.
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
function fitViewport() {
  if (!mq.matches || document.body.classList.contains("kb")) return;   // leave it alone while the keyboard is up
  const portrait = innerHeight > innerWidth;
  // t-top-blur fix: stretch to the screen only when the page really runs under the status bar (safe-area top > 0, i.e. a black-translucent install).
  // An install that still carries an opaque status bar (safe top 0) has a viewport short by the bar on purpose; stretching it pushed the tab bar off the bottom.
  const underBar = () => { const d = document.createElement("div"); d.style.cssText = "position:absolute;visibility:hidden;padding-top:env(safe-area-inset-top)"; document.body.appendChild(d); const v = parseFloat(getComputedStyle(d).paddingTop) || 0; d.remove(); return v > 0; };
  const full = standalone && portrait && underBar() ? Math.max(innerHeight, screen.height) : innerHeight;
  document.documentElement.style.setProperty("--app-h", full + "px");
  document.body.classList.toggle("vp-fix", full - innerHeight > 2);
  if (vpBox) vpReport();
}
const refit = () => setTimeout(fitViewport, 60);

// ?vp=1 → a small measurement panel (for diagnosing the viewport on the phone)
let vpBox = null;
function vpReport() {
  const probe = css => { const d = document.createElement("div"); d.style.cssText = "position:absolute;visibility:hidden;left:0;top:0;width:1px;" + css; document.body.appendChild(d); const h = d.getBoundingClientRect().height; d.remove(); return Math.round(h); };
  const inset = side => { const d = document.createElement("div"); d.style.cssText = "position:absolute;visibility:hidden;padding-top:env(safe-area-inset-" + side + ")"; document.body.appendChild(d); const v = parseFloat(getComputedStyle(d).paddingTop) || 0; d.remove(); return v; };
  const vv = window.visualViewport;
  vpBox.textContent = [
    "standalone " + standalone, "innerH " + innerHeight + "  innerW " + innerWidth,
    "screen " + screen.width + "x" + screen.height, "visualVP " + (vv ? Math.round(vv.height) : "-"),
    "docEl.clientH " + document.documentElement.clientHeight,
    "100vh " + probe("height:100vh") + "  100dvh " + probe("height:100dvh") + "  100lvh " + probe("height:100lvh"),
    "safe top " + inset("top") + "  bottom " + inset("bottom"),
    "--app-h " + getComputedStyle(document.documentElement).getPropertyValue("--app-h").trim() + "  vp-fix " + document.body.classList.contains("vp-fix"),
  ].join("\n");
}

// phones have no ⌘+Enter: give both composers a send button and plain-language placeholders
const SEND = '<svg viewBox="0 0 24 24"><path d="M12 3 L20 12 L12 21 L4 12 Z"/><path d="M8.5 12 H15.5 M12.5 9 L15.5 12 L12.5 15"/></svg>';
function sendVia(ta) {
  const box = ta && ta.closest("#right, #drawer");
  if (!ta || (!ta.value.trim() && !(box && box.querySelector(".att-chip, .ap-tile, .an-tray")))) { ta && ta.focus(); return; }
  ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, ctrlKey: true, bubbles: true }));
}

function wirePhNav() {
  (function () {   // damped spring (zeta .72 = ~4% overshoot) sampled into a linear() easing; falls back to a plain ease-out where linear() is unsupported
    try {
      if (!(window.CSS && CSS.supports("transition-timing-function", "linear(0, 1)"))) return;
      const z = .72, w = 7.2, wd = w * Math.sqrt(1 - z * z), pts = [];   // w 5.8 -> 7.2: the old tail ended ~2px short and snapped on the last frame; this one settles within .1px (== --m-spring)
      for (let i = 0; i <= 26; i++) { const t = i / 26, v = 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + z * w / wd * Math.sin(wd * t)); pts.push((i === 26 ? 1 : v).toFixed(4)); }
      TBM.spring = `linear(${pts.join(",")})`;
    } catch (e) {}
  })();
  document.addEventListener("push:change", () => { if (onSettings()) App.refreshPage(); });
  document.addEventListener("gh:status", () => { if (onSettings() && App.UI.setTab === "system") App.refreshPage(); });   // t-dash-token: label of the GitHub row
  document.addEventListener("change", e => {   // t-imp29-p1: quiet-hours start / end
    const t = e.target.closest && e.target.closest(".st-pane select[data-pz]"); if (!t || !window.Push) return;
    Push.setPrefs({ [t.dataset.pz]: +t.value });
  });
  document.addEventListener("click", e => {
    const r = e.target.closest && e.target.closest(".st-pane [data-set]"); if (!r) return;
    const k = r.dataset.set;
    if (k === "push" && window.Push) Push.toggle().then(() => onSettings() && App.refreshPage());
    if (k === "pushtest" && window.Push) Push.test();
    if (window.Push && Push.prefs && Push.prefs()) {   // t-imp29-p1
      const p = Push.prefs();
      if (k === "ptier" && r.dataset.v !== p.tier) Push.setPrefs({ tier: r.dataset.v });
      if (k === "pquiet") Push.setPrefs({ quiet: !p.quiet });
      if (k === "pdigest") Push.setPrefs({ digest: !p.digest });
    }
    if (k === "status") App.modalStatus();
    if (k === "ghtok" && App.ghOpen) App.ghOpen();   // t-dash-token
    if (k === "mictest") location.href = "/static/mictest.html";   // t-vb-1: same-window navigation keeps the home-screen app standalone
  });
  if (window.App) App.pushPrefs = () => pushPrefs();   // t-settings-tab: the 设置 · 通用 tab draws the push options on every screen size
}

function wirePhNav2() {

  // ---------- mo1: small motion helpers ----------
  document.addEventListener("touchstart", () => {}, { passive: true });   // iOS only applies :active (the row / card / pill press states) when a touch listener exists

  // ---------- routing glue ----------
  // anything that navigates to a page or a chat switches to that screen
  document.addEventListener("click", e => {
    if (!mq.matches) return;
    if (e.target.closest("[data-go]") && !e.target.closest("#tabbar")) setTab("page");
    else if (e.target.closest("[data-chat]")) { const c = e.target.closest("[data-chat]").dataset.chat; const from = retFrom(); setTab("chat"); if (oofOK() && c) openConv(c, from); }   // oof v2: 私信 / avatar taps now open that thread (with the push) instead of stopping on the list; #hc=cur keeps the old landing
    else if (e.target.closest("[data-mail]") && oofOK()) {   // t-dm-back-nav: an activity / mailbox row with no item only did setChat (app.js) on phones, so nothing visible happened; open that thread and come back here
      const ml = e.target.closest("[data-mail]"), m = (App.mailAll ? App.mailAll() : (App.ST.mail || [])).find(x => x.id === ml.dataset.mail);
      if (m && !m.item && m.agent) { const from = retFrom(); setTab("chat"); openConv(m.agent, from); }
    }
    // ui1-C: the mailbox is a drop-down over whatever screen you are on, so no tab switch for it
  });
  document.addEventListener("scroll", e => { if (e.target.classList && e.target.classList.contains("dw-scroll")) dwSync(); }, { capture: true, passive: true });
  if (dw) new MutationObserver(dwSync).observe(dw, { childList: true, attributes: true, attributeFilter: ["hidden"] });
  if (dw) new MutationObserver(() => document.body.classList.toggle("sheet", !dw.hidden)).observe(dw, { attributes: true, attributeFilter: ["hidden"] });
  document.addEventListener("focusin", e => { if (mq.matches && isField(e.target)) document.body.classList.add("kb"); });
  document.addEventListener("focusout", () => setTimeout(() => { if (!isField(document.activeElement)) document.body.classList.remove("kb"); }, 60));
  // P3 (t-aes-p3): a chat thread covers the app header (mobile.css lets #layout span the whole grid). The screen it slides over still sits below #top + #ticker,
  // so CSS needs their height as --top-h; neither has a fixed height (safe area, ticker text), hence a ResizeObserver. Hidden (visibility) elements still measure.
  (() => { const tp = $("#top"), tk = $("#ticker"); if (!tp || !window.ResizeObserver) return;
    const set = () => document.body.style.setProperty("--top-h", (tp.offsetHeight + (tk ? tk.offsetHeight : 0)) + "px");
    const ro = new ResizeObserver(set); ro.observe(tp); if (tk) ro.observe(tk); set(); })();
  ["resize", "orientationchange", "pageshow"].forEach(ev => addEventListener(ev, refit));
  if (window.visualViewport) visualViewport.addEventListener("resize", refit);
  document.addEventListener("focusout", () => setTimeout(fitViewport, 120));
  if (new URLSearchParams(location.search).get("vp") === "1") {
    vpBox = document.createElement("pre");
    vpBox.style.cssText = "position:fixed;left:8px;right:8px;top:calc(env(safe-area-inset-top) + 64px);z-index:99;margin:0;padding:10px 12px;font:12px/1.5 ui-monospace,Menlo,monospace;color:#fff;background:rgba(0,0,0,.82);border:1px solid #c33;border-radius:6px;white-space:pre-wrap;pointer-events:none";
    document.body.appendChild(vpBox);
  }
  fitViewport();
}

export { setTab, activeKey, badges, TBM, TBM_EASE, tbmAnim, tbmSel, tbmPop, tbmDots, tbmName, tbmNames, tbmTip, tbmPageIn, tbmPress, renderBar, catChips, moreTitle, strip, onSettings, menuExtras, pushPrefs, dotSeen, dotPop, dw, dwSync, isField, standalone, fitViewport, refit, vpBox, vpReport, SEND, sendVia, wirePhNav, wirePhNav2 };
