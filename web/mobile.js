// iPhone layer: one screen at a time, a floating tab bar, and three layouts to choose from.
//   A "tabs"  – review / quests / + / steward / menu
//   B "chat"  – opens on the steward chat; items waiting on you ride along as a strip on top
//   C "deck"  – opens on a Hallownest-style menu; review is a swipeable deck (→ approve, ← reject, ↑ later)
(function () {
  const mq = matchMedia("(max-width: 760px)");
  const $ = (s, el = document) => el.querySelector(s);
  const LS = {
    get(k, d) { try { const v = localStorage.getItem("rt." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("rt." + k, JSON.stringify(v)); } catch { } },
  };
  const H = new URLSearchParams(location.hash.slice(1));
  let mv = H.get("mv") || "tabs";  // A is the chosen phone layout; B/C stay reachable via #mv=chat / #mv=deck
  let deckIdx = 0, dragging = false, ready = false;
  const HOME = { tabs: ["page", "review"], chat: ["chat"], deck: ["menu"] };
  const CATS = ["main", "side", "daily", "urgent", "ongoing", "board"];
  const en = () => App.UI.lang === "en";

  const ICON = {
    review: '<path d="M12 3 L20 12 L12 21 L4 12 Z"/><path d="M12 8 L15.5 12 L12 16 L8.5 12 Z"/>',
    quests: '<path d="M7 4h10a2 2 0 0 1 2 2v12.5a1.5 1.5 0 0 1-3 0V7H7a1.5 1.5 0 0 1 0-3z"/><path d="M10 10.5h5M10 13.5h5M10 16.5h3"/>',
    chat: '<path d="M4 6.5C4 5 5 4 6.5 4h11C19 4 20 5 20 6.5v7c0 1.5-1 2.5-2.5 2.5H11l-4.5 4v-4C5 16 4 15 4 13.5z"/><path d="M8.5 10h.01M12 10h.01M15.5 10h.01"/>',
    team: '<circle cx="9" cy="8" r="3"/><circle cx="16.5" cy="9.5" r="2.3"/><path d="M3.5 19c.6-3.4 2.8-5 5.5-5s4.9 1.6 5.5 5"/><path d="M14.8 14.6c2.6-.4 4.8 1 5.4 4.4"/>',
    menu: '<path d="M4 7h16M4 12h10M4 17h16"/><path d="M18 10.3 L19.7 12 L18 13.7 L16.3 12 Z"/>',
    home: '<path d="M4 11 L12 4 L20 11 V19 a1 1 0 0 1 -1 1 H5 a1 1 0 0 1 -1 -1 Z"/><path d="M10 20 v-5 h4 v5"/>',
    bell: '<path d="M6 17 V11 a6 6 0 0 1 12 0 V17 l1.5 2 H4.5 Z"/><path d="M10 21 h4"/>',
    more: '<path d="M5.5 12 h.01 M12 12 h.01 M18.5 12 h.01" stroke-width="3.2"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16 L20.5 20.5"/>',
    deck: '<rect x="6" y="5" width="12" height="15" rx="1.5"/><path d="M8.5 3h7"/><path d="M12 9.5 L14 12.5 L12 15.5 L10 12.5Z"/>',
  };
  const svg = k => `<svg viewBox="0 0 24 24">${ICON[k]}</svg>`;
  // ui15: ONE pill bar for every phone layout (the old per-layout sets were dev variants; 5 fixed tabs like Slack)
  const BAR5 = [{ k: "home", i: "home", zh: "首页", en: "Home", to: ["page", "review"] }, { k: "dms", i: "chat", zh: "对话", en: "Chats", to: ["chat"] },
    { k: "activity", i: "bell", zh: "动态", en: "Activity", to: ["page", "mail"] }, { k: "more", i: "more", zh: "更多", en: "More", to: ["menu"] },
    { k: "quests", i: "quests", zh: "委托", en: "Quests", to: ["page", "quests"] }];   // t-vis-b2: 委托 replaces 搜索; search lives at the top of the 委托 page
  const BARS = {
    tabs: [{ k: "review", i: "review", zh: "首页", en: "Home", to: ["page", "review"] }, { k: "quests", i: "quests", zh: "委托", en: "Quests", to: ["page", "main"] },
      { k: "chat", i: "chat", zh: "管家", en: "Steward", to: ["chat"] }, { k: "menu", i: "menu", zh: "菜单", en: "Menu", to: ["menu"] }],
    chat: [{ k: "chat", i: "chat", zh: "对话", en: "Chat", to: ["chat"] }, { k: "review", i: "review", zh: "首页", en: "Home", to: ["page", "review"] },
      { k: "team", i: "team", zh: "团队", en: "Team", to: ["page", "roles"] }, { k: "menu", i: "menu", zh: "菜单", en: "Menu", to: ["menu"] }],
    deck: [{ k: "menu", i: "menu", zh: "菜单", en: "Menu", to: ["menu"] }, { k: "review", i: "deck", zh: "卡组", en: "Deck", to: ["page", "review"] },
      { k: "chat", i: "chat", zh: "管家", en: "Steward", to: ["chat"] }],
  };

  const QPAGES = ["quests", "main", "side", "daily", "urgent", "ongoing"];   // t-vis-b2: the pages that live under the 委托 tab
  let lastQ = "quests";
  // ---------- screens ----------
  function setTab(tab, page) {
    closeSearch();
    if (document.body.dataset.mtab !== "chat") { const rr = document.getElementById("right"); if (rr) rr.style.animation = ""; }   // oof: give #right its tab-switch m-in back (it is hidden now, so it cannot blink)
    if (tab !== "chat" && ret) retSet(null);   // t-dm-back-nav: left the thread some other way: forget the origin
    document.body.dataset.mtab = tab;
    if (tab === "page" && page && App.UI.page !== page) App.go(page);
    if (tab === "chat") setCv("list");   // the 管家 tab opens on the conversation list
    renderBar();
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
    const review = App.items().filter(i => App.onYouCard ? App.onYouCard(i) : i.stage === "review" && !(App.busy && App.busy(i))).length;   // t-doing-first
    const chat = convRows().reduce((n, x) => n + x.n, 0);   // unread across every conversation
    const mail = App.mailUnread ? App.mailUnread() : (App.ST.mail || []).filter(m => !m.read).length;   /* ri1105-P4: server count */
    return { home: review, dms: chat, activity: mail };   // ui15: dots, not numbers
  }
  // ---------- tabbar motion (t-tabbar-motion) ----------
  // One sliding selection block (.tb-sel: translateX + a mid-move squash, WAAPI), press scale, icon pop, dot pop/fade, page-in.
  // Buttons are built once and patched in place (the old code rewrote innerHTML on every tab change, which killed every transition).
  const TBM = { dur: 330, spring: null, rm: window.matchMedia("(prefers-reduced-motion: reduce)") };
  (function () {   // damped spring (zeta .72 = ~4% overshoot) sampled into a linear() easing; falls back to a plain ease-out where linear() is unsupported
    try {
      if (!(window.CSS && CSS.supports("transition-timing-function", "linear(0, 1)"))) return;
      const z = .72, w = 7.2, wd = w * Math.sqrt(1 - z * z), pts = [];   // w 5.8 -> 7.2: the old tail ended ~2px short and snapped on the last frame; this one settles within .1px (== --m-spring)
      for (let i = 0; i <= 26; i++) { const t = i / 26, v = 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + z * w / wd * Math.sin(wd * t)); pts.push((i === 26 ? 1 : v).toFixed(4)); }
      TBM.spring = `linear(${pts.join(",")})`;
    } catch (e) {}
  })();
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
      const rowEl = $(".tb-row", bar);
      if (window.ResizeObserver) new ResizeObserver(() => { const r = $(".tb-row", bar); if (r && r._built) { const i = r._idx; if (r.querySelector(".tb-sel")._anim == null) tbmSel(r, i, false); } }).observe(rowEl);
    }
    const act = activeKey(), bd = badges(), items = BAR5;
    const row = $(".tb-row", bar);
    row.style.gridTemplateColumns = `repeat(${items.length}, 1fr)`;
    const key = (en() ? "en" : "zh");
    if (row._lang !== key || !row._built || row._html === null) {   // structural build: once per language (setVariant resets _html to force a rebuild)
      row.querySelectorAll("button").forEach(b => b.remove());
      row.insertAdjacentHTML("beforeend", items.map(it => { const t = en() ? it.en : it.zh; return `<button data-k="${it.k}">${svg(it.i)}<span class="l" data-t="${t}">${t}</span></button>`; }).join(""));
      row._lang = key; row._html = "built";
    }
    const first = !row._built;
    const idx = items.findIndex(it => it.k === act), prevIdx = row._idx;
    row.querySelectorAll("button").forEach(b => { const on = b.dataset.k === act; if (b.classList.contains("on") !== on) b.classList.toggle("on", on); });
    tbmDots(row, bd);
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
    lastQ = p;
    const seg = document.createElement("div"); seg.className = "m-seg q";
    seg.innerHTML = `<div class="seg" data-seg="mseg">` + QPAGES.map(c => `<button class="seg-i ${p === c ? "on" : ""}" data-go="${c}">${App.t(c === "quests" ? "all_quests" : c)}</button>`).join("") + `</div>`;
    const sr = document.createElement("button"); sr.type = "button"; sr.className = "q-search";
    sr.innerHTML = `${SEARCH}<span>${App.t("search_ph")}</span>`; sr.addEventListener("click", () => openSearch());
    const ph = $(".ph", body); ph ? ph.after(sr) : body.prepend(sr); sr.after(seg);
    const on = $(".seg-i.on", seg); if (on && on.offsetLeft + on.offsetWidth > seg.clientWidth) seg.scrollLeft = on.offsetLeft - 16;   // keep the picked category in view
  }
  function strip() {
    const r = $("#right"), msgs = r && $(".ch-msgs", r); if (!msgs) return;
    let wrap = $(".m-stripwrap", r);
    if (!wrap) { wrap = document.createElement("div"); wrap.className = "m-stripwrap"; r.insertBefore(wrap, msgs); wrap.addEventListener("click", e => { const c = e.target.closest("[data-open]"); if (c) App.openItem(c.dataset.open); }); }
    const list = App.items().filter(i => App.onYouCard ? App.onYouCard(i) : i.stage === "review" && !(App.busy && App.busy(i))).sort(App.byAct);   // t-doing-first, t-home-newreplies
    const html = `<div class="m-strip-h"><span>${en() ? "WAITING ON YOU" : "等你拍板"}</span><b>${list.length}</b></div><div class="m-strip">` + (list.length ? list.map(it => {
      const a = App.agent(it.owner), kind = it.kind === "task" ? "deliverable" : it.kind;
      return `<button class="m-chip" data-open="${it.id}"><span class="tag ${kind}"><span class="gl" aria-hidden="true">◆</span>${App.t(kind)}</span><div class="t">${esc(it.title)}</div><div class="m">${App.av(a, "sm")}${esc(App.aname(a))} · ${App.t(it.category)} · ${App.whenH(it.activity)}</div></button>`;
    }).join("") : `<div class="m-chip none">${App.t("empty_review")}</div>`) + `</div>`;
    if (wrap._html !== html) { wrap.innerHTML = html; wrap._html = html; }
  }
  const onSettings = () => App.UI.page === "settings" && App.ST;   // t-settings-tab: the settings rows moved from 更多 to the 设置 page
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
  function menuExtras() {
    const left = $("#left"); if (!left) return;
    if (!$(".m-hero", left)) {
      const h = document.createElement("div"); h.className = "m-hero";
      h.innerHTML = `<div class="tc-sub" style="animation:none;font-size:10px">Personal Agent Team</div><div class="brand" style="flex-direction:row;gap:.35em;font-size:22px"><span>Under</span><span>thread</span></div>${window.ORN ? ORN.divider(200) : ""}`;
      left.prepend(h);
    }
    const old = $(".m-settings", left); if (old) old.remove();   // t-settings-tab: these rows live on the 设置 page now (更多 keeps navigation, today and the team)
  }
  if (window.App) App.pushPrefs = () => pushPrefs();   // t-settings-tab: the 设置 · 通用 tab draws the push options on every screen size

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

  // ---------- C: swipe deck ----------
  function deck() {
    const body = $("#pagebody"); if (!body || dragging) return;
    const list = App.items().filter(i => App.onYouCard ? App.onYouCard(i) : i.stage === "review" && !(App.busy && App.busy(i))).sort(App.byAct);   // t-doing-first, t-home-newreplies
    const head = `<div class="ph"><h1>${App.t("review")}</h1>${en() ? "" : '<div class="en">PENDING REVIEW</div>'}</div>`;
    if (!list.length) { body.innerHTML = head + `<div class="empty">${App.t("empty_review")}</div>`; return; }
    deckIdx = ((deckIdx % list.length) + list.length) % list.length;
    const order = [0, 1, 2].map(k => list[(deckIdx + k) % list.length]).filter((x, i, a) => a.indexOf(x) === i);
    const card = (it, cls) => {
      const a = App.agent(it.owner), kind = it.kind === "task" ? "deliverable" : it.kind;
      return `<div class="dk-card ${cls}" data-id="${it.id}">
        <div class="dk-meta"><span class="tag ${kind}"><span class="gl" aria-hidden="true">◆</span>${App.t(kind)}</span><span>${App.t(it.category)}</span><span class="dim">${App.whenH(it.activity)}</span>${(it.platforms || []).map(p => `<span class="tag pf">${App.PLAT[p] || p}</span>`).join("")}</div>
        <h3>${esc(it.title)}</h3><p class="dk-sum">${esc(it.summary || "")}</p>
        <div class="dk-draft md">${it.draft ? md(it.draft) : `<p class="dim">${en() ? "No draft yet." : "还没有草稿。"}</p>`}</div>
        <div class="dk-who">${App.av(a, "sm")}${esc(App.aname(a))} · ${esc(App.atitle(a))}${App.askLeft(it) ? `<b class="ok-ask">${App.askLeft(it)}</b>` : ""}</div>
        <div class="dk-stamp ok">${en() ? (it.kind === "plan" ? "START" : it.kind === "question" ? "ANSWER" : "ACCEPT") : App.okLabel(it, false).replace(" · ", "·")}</div><div class="dk-stamp no">${en() ? "REJECT" : "驳回"}</div><div class="dk-stamp skip">${en() ? "LATER" : "稍后"}</div></div>`;
    };
    const html = head + `<div class="dk-count">${deckIdx + 1} / ${list.length}</div>
      <div class="deck">${order.map((it, i) => card(it, i === 0 ? "top" : i === 1 ? "back" : "back2")).reverse().join("")}</div>
      <div class="dk-btns"><button class="no" data-dk="no" aria-label="reject">✕</button><button class="sk" data-dk="skip" aria-label="later">↑</button><button class="ok" data-dk="ok" aria-label="approve">✓</button></div>
      <div class="dk-hint">${en() ? `→ ${App.okLabel(list[deckIdx], true).toLowerCase()} · ← reject · ↑ later · tap to open` : `右滑${App.okLabel(list[deckIdx], false)} · 左滑驳回 · 上滑稍后 · 轻点看详情`}</div>`;
    const pf = App.phaseFree || (h => h);   // t-home-flicker: the --wp ring phase in App.av is not data
    if (body._deck === pf(html) && $(".deck", body)) return;
    body.innerHTML = html; body._deck = pf(html);
    wireDeck(body);
  }
  function wireDeck(body) {
    const top = $(".dk-card.top", body); if (!top) return;
    const id = top.dataset.id, st = { ok: $(".dk-stamp.ok", top), no: $(".dk-stamp.no", top), skip: $(".dk-stamp.skip", top) };
    let sx = 0, sy = 0, dx = 0, dy = 0;
    const stamps = () => { st.ok.style.opacity = Math.max(0, Math.min(1, dx / 110)); st.no.style.opacity = Math.max(0, Math.min(1, -dx / 110));
      st.skip.style.opacity = Math.abs(dy) > Math.abs(dx) ? Math.max(0, Math.min(1, -dy / 110)) : 0; };
    top.addEventListener("pointerdown", e => { dragging = true; sx = e.clientX; sy = e.clientY; dx = dy = 0; top.setPointerCapture(e.pointerId); top.classList.remove("fly"); });
    top.addEventListener("pointermove", e => {
      if (!dragging) return; dx = e.clientX - sx; dy = e.clientY - sy;
      top.style.transform = `translate(${dx}px, ${dy < 0 ? dy : dy * 0.25}px) rotate(${dx / 18}deg)`; stamps();
    });
    const end = () => {
      if (!dragging) return; dragging = false;
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) { top.style.transform = ""; return App.openItem(id); }
      if (dx > 110) return act("ok", top, id);
      if (dx < -110) return act("no", top, id);
      if (dy < -110 && Math.abs(dy) > Math.abs(dx)) return act("skip", top, id);
      top.classList.add("fly"); top.style.transform = ""; dx = dy = 0; stamps();
    };
    top.addEventListener("pointerup", end); top.addEventListener("pointercancel", end);
  }
  function act(k, top, id) {
    top = top || $(".dk-card.top"); id = id || (top && top.dataset.id); if (!top || !id) return;
    top.classList.add("fly");
    const it = App.items().find(i => i.id === id), wasPlan = it && it.kind === "plan";
    if (k === "ok") {
      top.style.transform = "translate(130vw, -40px) rotate(24deg)"; top.style.opacity = 0;
      const cx = innerWidth / 2, cy = innerHeight / 2;
      App.api("approve", { item: id }).then(() => {
        if (!window.FX) return;
        FX.burst(cx, cy, { n: 40, spread: 160 });
        if (wasPlan) App.toast(App.okDone(it));
        else if (FX.missionComplete) FX.missionComplete({ key: id + "|" + ((it && it.updated) || ""), owner: it && it.owner, title: it && it.title, time: App.when(new Date().toISOString()) });
        else FX.titleCard(en() ? "Mission Complete" : "委托完成", it ? esc(it.title) : "", { cls: en() ? "" : "cjk" });
      }).catch(() => { top.style.transform = ""; top.style.opacity = 1; });
    } else if (k === "no") {
      top.style.transform = "translate(-30px, 0) rotate(-3deg)";
      setTimeout(() => { top.style.transform = ""; App.rejectItem(id); }, 220);
    } else if (App.snzMenu) {   // ri1103-P2: 上滑稍后 = the same 稍后 sheet as the detail page; the card flies off only once a time is picked
      top.style.transform = "translate(0, -48px)";
      App.snzMenu(id, null, ok => {
        if (ok) { top.style.transform = "translate(0, -120vh) rotate(-6deg)"; top.style.opacity = 0; setTimeout(() => { const b = $("#pagebody"); if (b) b._deck = null; deck(); }, 380); }
        else { top.style.transform = ""; const s = $(".dk-stamp.skip", top); if (s) s.style.opacity = 0; }
      });
    } else {
      top.style.transform = "translate(0, -120vh) rotate(-6deg)"; top.style.opacity = 0;
      setTimeout(() => { deckIdx++; const b = $("#pagebody"); if (b) b._deck = null; deck(); }, 380);
    }
  }
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-dk]"); if (b && mq.matches) act(b.dataset.dk);
  });

  // ---------- mo1: small motion helpers ----------
  document.addEventListener("touchstart", () => {}, { passive: true });   // iOS only applies :active (the row / card / pill press states) when a touch listener exists
  const dotSeen = {};   // page -> Set of unread row keys last time we looked; a key that is new now gets its dot popped (first look just records)
  function dotPop() {
    if (!mq.matches || !window.App || TBM.rm.matches) return;
    const rows = [...document.querySelectorAll("#pagebody .act-row.unread")], page = App.UI.page;
    const now = new Set(rows.map(r => r.dataset.item || r.dataset.mail)), prev = dotSeen[page]; dotSeen[page] = now;
    if (!prev) return;
    rows.forEach(r => { if (prev.has(r.dataset.item || r.dataset.mail)) return; const d = r.querySelector(".act-dot"); if (d) tbmAnim(d, [{ transform: "scale(.2)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: 300, easing: TBM.spring || TBM_EASE }); });
  }
  document.addEventListener("click", e => {   // the 未读 toggle re-renders the list synchronously (app.js runs first): fade the new list in, opacity only
    if (!mq.matches || !e.target.closest("[data-mailunread]") || TBM.rm.matches) return;
    const l = $("#pagebody .act-list"); if (l) tbmAnim(l, [{ opacity: .3 }, { opacity: 1 }], { duration: 180, easing: "ease-out" });
  });

  // ---------- routing glue ----------
  // anything that navigates to a page or a chat switches to that screen
  let chatBefore = null;
  document.addEventListener("click", () => { chatBefore = window.App && App.UI.chat; }, true);
  document.addEventListener("click", e => {
    if (!mq.matches) return;
    if (e.target.closest("[data-go]") && !e.target.closest("#tabbar")) setTab("page");
    else if (e.target.closest("[data-chat]")) { const c = e.target.closest("[data-chat]").dataset.chat; const from = retFrom(); setTab("chat"); if (oofOK() && c) openConv(c, from); }   // oof v2: 私信 / avatar taps now open that thread (with the push) instead of stopping on the list; #hc=cur keeps the old landing
    else if (e.target.closest("[data-mail]") && oofOK()) {   // t-dm-back-nav: an activity / mailbox row with no item only did setChat (app.js) on phones, so nothing visible happened; open that thread and come back here
      const ml = e.target.closest("[data-mail]"), m = (App.mailAll ? App.mailAll() : (App.ST.mail || [])).find(x => x.id === ml.dataset.mail);
      if (m && !m.item && m.agent) { const from = retFrom(); setTab("chat"); openConv(m.agent, from); }
    }
    else if (e.target.closest(".office canvas") && App.UI.chat !== chatBefore) { const from = retFrom(); setTab("chat"); if (oofOK()) openConv(App.UI.chat, from); }
    // ui1-C: the mailbox is a drop-down over whatever screen you are on, so no tab switch for it
  });

  // item sheet open → body.sheet (the tab bar hides behind it)
  const dw = document.getElementById("drawer");
  // t-vis-b1: the detail bar turns to frosted glass once content scrolls under it (mobile.css #drawer.dw-scrolled). Scroll events do not bubble, so listen in the capture phase;
  // a re-render / another item swaps the scroller, so re-read its position when the drawer's children change.
  const dwSync = () => { const s = dw && dw.querySelector(".dw-scroll"), on = !!(s && !dw.hidden && s.scrollTop > 6); if (dw && dw.classList.contains("dw-scrolled") !== on) dw.classList.toggle("dw-scrolled", on); };
  document.addEventListener("scroll", e => { if (e.target.classList && e.target.classList.contains("dw-scroll")) dwSync(); }, { capture: true, passive: true });
  if (dw) new MutationObserver(dwSync).observe(dw, { childList: true, attributes: true, attributeFilter: ["hidden"] });
  if (dw) new MutationObserver(() => document.body.classList.toggle("sheet", !dw.hidden)).observe(dw, { attributes: true, attributeFilter: ["hidden"] });

  // keyboard up → tab bar and action bars step aside
  const isField = el => el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !/^(checkbox|radio|button|file)$/.test(el.type)));
  document.addEventListener("focusin", e => { if (mq.matches && isField(e.target)) document.body.classList.add("kb"); });
  document.addEventListener("focusout", () => setTimeout(() => { if (!isField(document.activeElement)) document.body.classList.remove("kb"); }, 60));

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
  // P3 (t-aes-p3): a chat thread covers the app header (mobile.css lets #layout span the whole grid). The screen it slides over still sits below #top + #ticker,
  // so CSS needs their height as --top-h; neither has a fixed height (safe area, ticker text), hence a ResizeObserver. Hidden (visibility) elements still measure.
  (() => { const tp = $("#top"), tk = $("#ticker"); if (!tp || !window.ResizeObserver) return;
    const set = () => document.body.style.setProperty("--top-h", (tp.offsetHeight + (tk ? tk.offsetHeight : 0)) + "px");
    const ro = new ResizeObserver(set); ro.observe(tp); if (tk) ro.observe(tk); set(); })();
  const refit = () => setTimeout(fitViewport, 60);
  ["resize", "orientationchange", "pageshow"].forEach(ev => addEventListener(ev, refit));
  if (window.visualViewport) visualViewport.addEventListener("resize", refit);
  document.addEventListener("focusout", () => setTimeout(fitViewport, 120));

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
  if (new URLSearchParams(location.search).get("vp") === "1") {
    vpBox = document.createElement("pre");
    vpBox.style.cssText = "position:fixed;left:8px;right:8px;top:calc(env(safe-area-inset-top) + 64px);z-index:99;margin:0;padding:10px 12px;font:12px/1.5 ui-monospace,Menlo,monospace;color:#fff;background:rgba(0,0,0,.82);border:1px solid #c33;border-radius:6px;white-space:pre-wrap;pointer-events:none";
    document.body.appendChild(vpBox);
  }
  fitViewport();

  // phones have no ⌘+Enter: give both composers a send button and plain-language placeholders
  const SEND = '<svg viewBox="0 0 24 24"><path d="M12 3 L20 12 L12 21 L4 12 Z"/><path d="M8.5 12 H15.5 M12.5 9 L15.5 12 L12.5 15"/></svg>';
  function sendVia(ta) {
    const box = ta && ta.closest("#right, #drawer");
    if (!ta || (!ta.value.trim() && !(box && box.querySelector(".att-chip, .ap-tile, .an-tray")))) { ta && ta.focus(); return; }
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, ctrlKey: true, bubbles: true }));
  }

  // ===== ui2-A: WeChat-style composer — + opens a panel (相册/拍照/文件/@); 发送 replaces + once there is text or an attachment =====
  function ui2Comp() {
    const c = $(".ch-comp"); if (!c || !mq.matches) return;
    const ta = $("textarea", c), fi = $("input[type=file]", c), plus = $(":scope > button:first-child", c), send = $(".m-send", c);
    if (!ta || !fi || !plus || !send) return;
    send.dataset.t = en() ? "Send" : "发送";
    if (c._ui2) return; c._ui2 = true;
    const upd = () => {
      const r = c.closest("#right"), has = !!ta.value.trim() || !!(r && r.querySelector(".pending-att .ap-tile"));
      c.classList.toggle("has-text", has);
    };
    const setPanel = on => { c.classList.toggle("panel-on", on); if (on) ta.blur(); };
    const pick = (accept, capture) => { setPanel(false); fi.accept = accept; if (capture) fi.setAttribute("capture", "environment"); else fi.removeAttribute("capture"); fi.click(); setTimeout(() => { fi.accept = ""; fi.removeAttribute("capture"); }, 1500); };
    const P = document.createElement("div"); P.className = "ui2-panel";
    P.innerHTML = [["拍照", "Camera", "◉"], ["上传媒体", "Upload", "▣"]]
      .map((x, i) => `<button type="button" data-k="${i}"><b>${x[2]}</b>${en() ? x[1] : x[0]}</button>`).join("");
    c.appendChild(P);
    // capture phase: the old + handler (fi.click()) is replaced by the panel on phones
    plus.addEventListener("click", e => { e.stopImmediatePropagation(); e.preventDefault(); setPanel(!c.classList.contains("panel-on")); }, true);
    P.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      const k = +b.dataset.k;
      if (k === 0) pick("image/*", true); else pick("");   // ui8: 拍照 (camera capture) / 上传媒体 (one picker: photos, videos, files)
    });
    ta.addEventListener("input", upd); ta.addEventListener("focus", () => setPanel(false));
    document.addEventListener("pointerdown", e => { if (c.classList.contains("panel-on") && !e.target.closest(".ch-comp")) setPanel(false); }, true);
    /* value cleared by send() and attachment chips change without input events. t-power-save: ticks only while this composer is in the page and visible */
    const updT = setInterval(() => { if (!c.isConnected) { clearInterval(updT); return; } if (!document.hidden && !document.documentElement.dataset.idle) upd(); }, 300);
    upd();
  }
  function composers() {
    const chat = $(".ch-comp");
    if (chat && !$(".m-send", chat)) {
      const b = document.createElement("button"); b.className = "m-send"; b.setAttribute("aria-label", "send"); b.innerHTML = SEND;
      b.addEventListener("click", () => sendVia($("textarea", chat))); chat.appendChild(b);
    }
    const ta = chat && $("textarea", chat), a = App.agent(App.UI.chat);
    if (ta) ta.placeholder = en() ? `Message ${App.aname(a)}…` : `对${App.aname(a)}说……`;
    const comp = $("#drawer .composer");
    if (comp && !$(".m-send", comp)) {
      const b = document.createElement("button"); b.className = "m-send"; b.setAttribute("aria-label", "send"); b.innerHTML = SEND;
      b.addEventListener("click", () => sendVia($("textarea", comp))); $(".cm-row", comp).appendChild(b);
      $("textarea", comp).placeholder = en() ? "Reply, @someone, or why not…" : "回复，@ 指定谁，写驳回原因";   // t-detail-bottom: one-line pill, keep it short
    }
  }

  // ---------- chat: WeChat-style conversation list (body[data-cv] = list | thread) ----------
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
      bar.innerHTML = `<button aria-label="back">${BACK}<i class="n"></i></button><div class="who"></div>`;
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
    if (box._html !== html) { box.innerHTML = html; box._html = html; }
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
      if (m.classList.contains("me")) m.insertAdjacentHTML("beforeend", meAv());
      if (m.dataset.who && m.dataset.who !== App.UI.chat) {   // someone else speaking in this thread: show their name, like a WeChat group
        const mb = m.querySelector(".mb"); mb && mb.insertAdjacentHTML("beforebegin", `<div class="m-nm">${esc(App.aname(App.agent(m.dataset.who)))}</div>`);
      }
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
  function syncTyping(box) {   // agent busy and you spoke last → a typing bubble at the bottom
    const a = App.agent(App.UI.chat), l = convMsgs(App.UI.chat), last = l[l.length - 1];
    const on = App.typingOn ? App.typingOn(a, last) : a.status === "working" && last && last.who === "me";   // t-typing-fix: same rule as desktop
    let tb = $(".m-typing", box);
    if (on && !tb) { box.insertAdjacentHTML("beforeend", `<div class="m-typing" data-until="${App.typingUntil ? App.typingUntil(last) : ""}">${App.av(a)}<div class="mb"><span class="m-dots"><i></i><i></i><i></i></span></div></div>`); box.scrollTop = box.scrollHeight; }
    else if (!on && tb) tb.remove();
  }
  document.addEventListener("click", e => {
    const b = e.target.closest("#right .ch-comp .m-send"); if (!b || !mq.matches) return;
    const c = b.closest(".ch-comp"); c.classList.add("sending"); clearTimeout(c._st); c._st = setTimeout(() => c.classList.remove("sending"), 4000);
  }, true);

  // ===== ui15: 搜索 tab = minimal search sheet over items and chats (nothing existed on the phone besides the chat-list filter) =====
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
  }
  document.addEventListener("rt-arch", () => searchRender());   // t-perf A: archived cards finished loading (App.archAll)
  document.addEventListener("rt-hist", () => searchRender());   /* ri1105-P4: older chat landed */
  const msNone = () => `<div class="empty">${App.t("empty")}</div>`;
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
      + (all && items.length ? h(q ? (en() ? "Items" : "条目") : (en() ? "Recent" : "最近")) + items.map(it => `<button class="ms-row" data-sitem="${esc(it.id)}"><span class="ms-av">${App.av(App.agent(it.owner))}</span><span class="ms-m"><b>${esc(it.title)}</b><span><i class="tag ${it.stage === "review" ? kindOf(it) : ""}">${it.stage === "review" ? App.t(kindOf(it)) : esc(App.stageLabel(it.stage))}</i> ${esc(App.aname(App.agent(it.owner)))} · ${App.whenH(it.activity)}</span></span></button>`).join("") : "")
      || `<div class="empty">${App.t("empty")}</div>`;
    const box = $(".ms-res", el);
    if (q && html === tabs) { const e2 = `<div class="empty">${App.t("empty")}</div>`; if (box._html !== tabs + e2) { box.innerHTML = box._html = tabs + e2; } return; } if (box._html !== html) { box.innerHTML = html; box._html = html; }
  }
  App.openSearch = () => openSearch();   // t-imp-p5: ⌘K on a phone-width window, and the home search button
  document.addEventListener("click", e => { if (mq.matches && e.target.closest("[data-msearch]")) openSearch(); });
  document.addEventListener("click", e => {   // the page behind the sheet: any in-page navigation closes it
    if (mq.matches && document.body.classList.contains("msearch") && e.target.closest("#left [data-go], #main [data-go]")) { closeSearch(); renderBar(); }
  }, true);

  function setVariant(v) {
    mv = v; LS.set("mview", v); document.body.dataset.mv = v;
    const b = $("#tabbar .tb-row"); if (b) b._html = null;
    setTab(...HOME[v]);
    if (window.FX) FX.enter($("#pagebody"));
  }
  function sync() {
    if (!mq.matches || !App.ST) return;
    if (!ready) { ready = true; document.body.dataset.mv = mv; setTab(...(H.get("mtab") ? [H.get("mtab"), H.get("page")] : HOME[mv])); }
    catChips(); menuExtras(); composers(); ui2Comp(); convList(); dotPop();
    if (mv === "chat") strip();
    if (mv === "deck" && App.UI.page === "review") deck();
    if (document.body.classList.contains("msearch")) searchRender();
    renderBar();
  }
  function onMQ() {
    if (mq.matches) { ready = false; sync(); }
    else { delete document.body.dataset.mtab; delete document.body.dataset.mv; delete document.body.dataset.cv; }
  }
  mq.addEventListener("change", onMQ);
  const boot = () => { if (!window.App) return setTimeout(boot, 50); App.on(sync); sync(); };
  boot();
})();

// ===== ui1-B: swipe from the left edge to close the detail (it pushes in from the right) =====
(() => {
  const dw = document.getElementById("drawer"); if (!dw) return;
  let x0 = null, y0 = 0, dx = 0, live = false;
  dw.addEventListener("touchstart", e => {
    const t = e.touches[0]; x0 = null; /* ui3: superseded by the swipe-back block below */ y0 = t.clientY; dx = 0; live = false;
  }, { passive: true });
  dw.addEventListener("touchmove", e => {
    if (x0 == null) return; const t = e.touches[0]; dx = t.clientX - x0;
    if (!live && Math.abs(t.clientY - y0) > Math.abs(dx)) { x0 = null; return; }
    if (dx > 6) { live = true; dw.style.transition = "none"; dw.style.transform = `translateX(${Math.max(0, dx)}px)`; }
  }, { passive: true });
  const end = () => {
    if (x0 == null) return; const go = live && dx > 90; x0 = null;
    dw.style.transition = ""; dw.style.transform = "";
    if (live && go) App.closeItem();
  };
  dw.addEventListener("touchend", end, { passive: true }); dw.addEventListener("touchcancel", end, { passive: true });
})();

// ===== ui3: swipe right to go back (WeChat-style). Starts in a generous left zone, or anywhere on a clearly horizontal drag;
// the page follows the finger, then springs back or commits. Lightbox / inputs / horizontally scrollable areas are left alone. =====
(() => {
  const dw = document.getElementById("drawer"); if (!dw) return;
  const mq = matchMedia("(max-width: 760px)"), still = matchMedia("(prefers-reduced-motion: reduce)");
  const EDGE = 40, W = () => dw.clientWidth || innerWidth;
  let st = null, relT = 0;   // { x, y, t, dx, mode: "wait" | "drag" | "no" }
  const hscroll = el => { for (; el && el !== dw; el = el.parentElement) { if (el.scrollWidth > el.clientWidth + 2 && /(auto|scroll)/.test(getComputedStyle(el).overflowX)) return true; } return false; };
  dw.addEventListener("touchstart", e => {
    st = null;
    if (!mq.matches || dw.hidden || e.touches.length !== 1 || document.body.classList.contains("lb-open")) return;
    const t = e.touches[0], el = e.target;
    if (el.closest && el.closest("input,textarea,select,[contenteditable],video,audio")) return;
    st = { x: t.clientX, y: t.clientY, t: performance.now(), dx: 0, mode: "wait", edge: t.clientX < EDGE, hs: hscroll(el) };
    if (st.hs && !st.edge) st = null;
  }, { passive: true });
  dw.addEventListener("touchmove", e => {
    if (!st || st.mode === "no") return;
    const t = e.touches[0], dx = t.clientX - st.x, dy = t.clientY - st.y;
    if (st.mode === "wait") {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      // commit to a back-swipe only if it is rightward and clearly more horizontal than vertical (edge start is more forgiving)
      if (dx > 0 && Math.abs(dx) > Math.abs(dy) * (st.edge ? 1 : 1.6)) {
        st.mode = "drag"; dw.classList.add("swiping");
        // mo1: grabbing the page mid-release must not jump: start from where it visually is, and cancel the pending close/cleanup
        clearTimeout(relT); try { st.base = Math.max(0, new DOMMatrix(getComputedStyle(dw).transform).m41); } catch (e) { st.base = 0; }
        dw.style.transition = "none"; dw.style.transform = `translateX(${st.base}px)`;
      }
      else { st.mode = "no"; return; }
    }
    st.dx = Math.max(0, dx + (st.base || 0)); st.v = (st.dx - (st.lx || 0)) / Math.max(1, performance.now() - (st.lt || st.t)); st.lx = st.dx; st.lt = performance.now();
    dw.style.transform = `translateX(${st.dx}px)`;
  }, { passive: true });
  const end = cancel => {
    const s = st; st = null; if (!s || s.mode !== "drag") return;
    const go = !cancel && (s.dx > W() * 0.33 || (s.v > 0.5 && s.dx > 40));
    dw.classList.remove("swiping");
    const back = () => (App.backItem || App.closeItem)();   // t-parent-links: back to the parent card if you came from one, else close
    if (still.matches) { dw.style.transition = "none"; dw.style.transform = ""; if (go) back(); return; }
    // same motion language as the push-in: ease-out spring to the end state
    clearTimeout(relT);
    if (go) {   // commit: quick emphasized slide out (--m-base / --m-ease-emph)
      dw.style.transition = "transform var(--m-base) var(--m-ease-emph)"; dw.style.transform = "translateX(100%)";
      relT = setTimeout(() => { dw.style.transition = "none"; back(); dw.style.transform = ""; void dw.offsetWidth; dw.style.transition = ""; }, 250);
    } else {    // cancel: soft spring back, no overshoot (--m-slow / --m-spring-soft)
      dw.style.transition = "transform var(--m-slow) var(--m-spring-soft)"; dw.style.transform = "translateX(0)";
      relT = setTimeout(() => { dw.style.transition = ""; dw.style.transform = ""; }, 440);
    }
  };
  dw.addEventListener("touchend", () => end(false), { passive: true });
  dw.addEventListener("touchcancel", () => end(true), { passive: true });
})();

// ===== ui12b (t-composer-oneline) + mp (t-mailbox-polish): auto-grow the phone chat textarea from one row (40px) up to 120px =====
// mp root-cause fix: the textarea has `transition: height`, and fit() used to read scrollHeight right after setting height = MIN. While a transition is running (after a long
// message is sent and the value is cleared, or on the 200ms poll) scrollHeight returns the half-animated height, so an EMPTY field was re-pinned at 58 / 120px (seen on iPhone:
// a 3-row pill with nothing typed). Now: (1) an empty field is always MIN and never measured, (2) the measurement runs with transition:none, (3) a focus heals any stale height.
// Upload tiles (.pending-att) live INSIDE the pill, above the one-row field, so the pill (and --comp-h) includes them.
(() => {
  const MIN = 40, MAX = 120, mqp = matchMedia("(max-width: 760px)");
  const find = () => document.querySelector("#right .ch-comp textarea");
  const sync = () => {   // --comp-h = pill height (target, not the eased one) + the 14px it floats above the bottom
    const ta = find(), comp = ta && ta.closest(".ch-comp"), right = document.getElementById("right"); if (!comp || !right) return;
    const h = parseFloat(ta.style.height) || MIN, box = right.querySelector(".ch-msgs");
    const atBottom = !!box && box.scrollHeight - box.scrollTop - box.clientHeight < 90;
    const v = (comp.offsetHeight - ta.offsetHeight + h + 14) + "px";
    if (right.style.getPropertyValue("--comp-h") === v) return;
    right.style.setProperty("--comp-h", v);   // ui23: the composer floats over the list, so the list needs to know how tall it is
    if (atBottom) box.scrollTop = box.scrollHeight;   // keep the last message visible when the pill grows (text wraps / tiles appear)
  };
  const fit = ta => {
    if (!ta || !ta.isConnected) return;
    let h = MIN;
    const cur = ta.getBoundingClientRect().height || MIN;   // jit: what is on screen right now (mid-transition value included)
    if (ta.value) {
      const st = ta.scrollTop;
      ta.style.transition = "none"; ta.style.height = MIN + "px"; h = Math.min(MAX, Math.max(MIN, ta.scrollHeight));
      ta.style.height = cur + "px"; void ta.offsetHeight;   // jit: put the on-screen height back and flush it with transition:none, so the 40px probe is never the start of an animation
      ta.scrollTop = st;
    }
    ta.style.transition = ""; ta.style.height = h + "px";   // jit: one monotonic ease from where the pill is to where it must be (unchanged h = no motion at all)
    sync();
  };
  let ro = null, roFor = null;
  const place = () => {   // move the tiles strip into the pill on the phone (back out on desktop widths); observe the pill so --comp-h follows tiles / wrapping
    const ta = find(); if (!ta) return;
    const comp = ta.closest(".ch-comp"), att = document.querySelector("#right .pending-att"); if (!comp) return;
    if (att) { if (mqp.matches && att.parentNode !== comp) comp.appendChild(att); else if (!mqp.matches && att.parentNode === comp) comp.parentNode.insertBefore(att, comp); }
    if (window.ResizeObserver && roFor !== comp) { if (ro) ro.disconnect(); roFor = comp; ro = new ResizeObserver(sync); ro.observe(comp); }
  };
  document.addEventListener("input", e => { if (e.target.matches && e.target.matches("#right .ch-comp textarea")) fit(e.target); });
  document.addEventListener("focusin", e => { if (e.target.matches && e.target.matches("#right .ch-comp textarea")) { place(); fit(e.target); } });
  mqp.addEventListener && mqp.addEventListener("change", place);
  let last = null;
  /* value changed without an input event (cleared after send). t-power-save: the 200 ms tick runs only while the chat input exists, the page is visible and not idle;
     it stops when the input goes and restarts on the next focus / input / visibility change */
  let fitT = 0;
  const fitTick = () => { const ta = find(); if (!ta) { clearInterval(fitT); fitT = 0; return; } if (document.hidden || document.documentElement.dataset.idle) return; place(); const v = ta.value; if (v !== last) { last = v; fit(ta); } };
  const fitOn = () => { if (!fitT && find()) fitT = setInterval(fitTick, 200); };
  fitOn();
  document.addEventListener("focusin", fitOn); document.addEventListener("input", fitOn); document.addEventListener("visibilitychange", fitOn); document.addEventListener("pointerdown", fitOn, true);
})();

/* ===== ui13 (t-slack-ios P1): three-way theme switch (深色 / 浅色 / 白), remembered in localStorage, <meta theme-color> kept in step.
   Default stays dark. localStorage access is wrapped: private windows / blocked storage just mean the choice is not remembered. ===== */
(function () {
  const COLORS = { dark: "#040404", light: "#e8e0cc", white: "#ffffff" };
  const meta = () => document.querySelector('meta[name="theme-color"]');
  const R = document.documentElement, inkPaper = () => R.dataset.skin === "ink" && R.dataset.inkLight !== "0";   // t-visual-ink: neutral paper replaces the warm light background
  const sync = () => { const m = meta(), t = R.dataset.theme, c = R.dataset.stage && (t === "dark" || t === "white") ? (t === "dark" ? "#15110f" : "#f3eee9") : t === "light" && inkPaper() ? "#f4f3f0" : COLORS[t]; if (m && c && m.content !== c) m.content = c; };
  new MutationObserver(sync).observe(R, { attributes: true, attributeFilter: ["data-skin", "data-ink-light", "data-stage"] });
  // t-visual-stage: 舞台 switches. night = dark theme + stage, day = white theme + stage, off = stage removed (theme kept). Remembered in rt.stage / rt.theme.
  function stageMarks() {
    const on = k => k === "off" ? !R.dataset.stage : !!R.dataset.stage && R.dataset.theme === (k === "night" ? "dark" : "white");
    document.querySelectorAll("[data-stage-set]").forEach(x => { const o = on(x.dataset.stageSet); x.classList.toggle("on", o); x.setAttribute("aria-checked", o); });
    document.querySelectorAll("[data-theme-set]").forEach(x => { const o = !R.dataset.stage && x.dataset.themeSet === R.dataset.theme; x.classList.toggle("on", o); x.setAttribute("aria-checked", o); });
  }
  // ===== t-settings-tab / t-theme-auto: theme mode. rt.themeMode = "auto" | "manual" per device (index.html decides it before first paint:
  // a device with no saved theme starts on auto, one that already picked stays manual). Auto = the system light / dark setting
  // (dark -> 夜 "dark", light -> 昼 "white"); a browser that answers neither falls back to the clock, 07:00–19:00 = 昼. The stage stays as it is.
  const DKQ = matchMedia("(prefers-color-scheme: dark)"), LTQ = matchMedia("(prefers-color-scheme: light)"), RMQ = matchMedia("(prefers-reduced-motion: reduce)");
  const tmode = () => { try { return JSON.parse(localStorage.getItem("rt.themeMode")) === "auto" ? "auto" : "manual"; } catch (err) { return "manual"; } };
  const setMode = m => { try { localStorage.setItem("rt.themeMode", JSON.stringify(m)); } catch (err) { } };
  const autoTheme = () => DKQ.matches ? "dark" : LTQ.matches ? "white" : (h => h >= 7 && h < 19 ? "white" : "dark")(new Date().getHours());
  function toManual() {
    if (tmode() !== "auto") return;
    setMode("manual");
    if (window.App && App.toast) App.toast(App.UI.lang === "en" ? "Switched to manual · change it back in Settings" : "已改成手动 · 设置里可改回自动");
  }
  // whole-page crossfade, 0.4 s: a View Transition where the browser has one, else a fading sheet of the old background. Reduced motion: instant.
  function fadeSwap(fn) {
    if (RMQ.matches || document.hidden) return fn();
    if (typeof document.startViewTransition === "function") {
      R.classList.add("th-vt");
      const vt = document.startViewTransition(fn);
      vt.ready.catch(() => { }); vt.updateCallbackDone.catch(() => { });   // a second switch mid-fade skips the first: not an error
      vt.finished.catch(() => { }).finally(() => R.classList.remove("th-vt"));
      return;
    }
    const bg = getComputedStyle(document.body).backgroundColor, sh = document.createElement("div");
    sh.className = "th-fade"; sh.style.background = bg; document.body.appendChild(sh);
    fn();
    requestAnimationFrame(() => requestAnimationFrame(() => { sh.style.opacity = "0"; }));
    setTimeout(() => sh.remove(), 480);
  }
  function applyTheme(t) {
    if (!window.App || !App.UI || R.dataset.theme === t) return;
    fadeSwap(() => {
      App.UI.theme = t; try { localStorage.setItem("rt.theme", JSON.stringify(t)); } catch (err) { }
      R.dataset.theme = t; sync(); stageMarks();
      if (App.refreshPage) App.refreshPage();
      document.dispatchEvent(new Event("theme:change"));
    });
  }
  const autoTick = () => { if (tmode() === "auto") applyTheme(autoTheme()); };
  DKQ.addEventListener("change", autoTick); LTQ.addEventListener("change", autoTick);
  setInterval(autoTick, 60000);   // only matters for the clock fallback
  document.addEventListener("visibilitychange", () => { if (!document.hidden) autoTick(); });
  document.addEventListener("click", e => {
    const m = e.target.closest && e.target.closest("[data-tmode]");
    if (m && window.App) {
      const v = m.dataset.tmode;
      if (v === "auto") { setMode("auto"); if (autoTheme() === R.dataset.theme) App.refreshPage(); else applyTheme(autoTheme()); }
      else { setMode("manual"); if (v === R.dataset.theme) App.refreshPage(); else applyTheme(v); }
      return;
    }
    const s = e.target.closest && e.target.closest("[data-stage-tog]");
    if (s && window.App) {
      const on = !R.dataset.stage;
      fadeSwap(() => {
        if (on) R.dataset.stage = "1"; else delete R.dataset.stage;
        try { localStorage.setItem("rt.stage", JSON.stringify(on)); } catch (err) { }
        sync(); stageMarks(); if (App.refreshPage) App.refreshPage();
        document.dispatchEvent(new Event("theme:change"));
      });
    }
  });
  document.addEventListener("click", e => {
    const b = e.target.closest && e.target.closest("[data-stage-set]"); if (!b || !window.App) return;
    const k = b.dataset.stageSet, ls = (a, v) => { try { localStorage.setItem(a, JSON.stringify(v)); } catch (err) { } };
    if (k !== "off" && (k === "night" ? "dark" : "white") !== R.dataset.theme) toManual();   // t-settings-tab: picking night / day by hand leaves auto
    fadeSwap(() => {
    if (k === "off") { delete R.dataset.stage; ls("rt.stage", false); }
    else { const t = k === "night" ? "dark" : "white"; App.UI.theme = t; ls("rt.theme", t); R.dataset.theme = t; R.dataset.stage = "1"; ls("rt.stage", true); }
    sync(); stageMarks();
    document.querySelectorAll(".seg[data-seg=mtheme], .seg[data-seg=mstage]").forEach(s => s.append(document.createTextNode("")));
    if (App.refreshPage) App.refreshPage();
    document.dispatchEvent(new Event("theme:change"));
    });
  });
  // t-visual-ink switches: 墨刊 on/off (rt.skin) and light-theme paper (rt.inkLight); both remembered on this device, applied without a reload
  const lsw = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (err) { } };
  document.addEventListener("click", e => {
    const s = e.target.closest && e.target.closest("[data-skin-set], [data-inklight-set]"); if (!s) return;
    if (s.hasAttribute("data-skin-set")) { const on = R.dataset.skin !== "ink"; if (on) R.dataset.skin = "ink"; else delete R.dataset.skin; lsw("rt.skin", on ? "ink" : "classic"); }
    else { const on = R.dataset.inkLight === "0"; if (on) delete R.dataset.inkLight; else R.dataset.inkLight = "0"; lsw("rt.inkLight", on); }
    document.querySelectorAll("[data-skin-set]").forEach(x => { const on = R.dataset.skin === "ink"; x.classList.toggle("on", on); x.setAttribute("aria-pressed", on); const w = x.querySelector(".sw"); if (w) w.classList.toggle("on", on); });
    document.querySelectorAll("[data-inklight-set] .sw").forEach(w => w.classList.toggle("on", R.dataset.inkLight !== "0"));
    sync(); if (window.App && App.refreshPage) App.refreshPage();
    document.dispatchEvent(new Event("theme:change"));
  });
  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  sync();
  document.addEventListener("click", e => {
    const b = e.target.closest && e.target.closest("[data-theme-set]"); if (!b) return;
    const t = b.dataset.themeSet; if (!COLORS[t] || !window.App) return;
    if (t !== R.dataset.theme) toManual();   // t-settings-tab
    const stg = R.dataset.stage; if (stg) { delete R.dataset.stage; try { localStorage.setItem("rt.stage", "false"); } catch (err) { } }   // t-visual-stage: picking a plain theme leaves the stage
    App.UI.theme = t;
    try { localStorage.setItem("rt.theme", JSON.stringify(t)); } catch (err) { }
    document.documentElement.dataset.theme = t; sync();
    document.querySelectorAll("[data-theme-set]").forEach(x => { const on = x.dataset.themeSet === t; x.classList.toggle("on", on); x.setAttribute("aria-checked", on); });
    if (stg) { stageMarks(); if (App.refreshPage) App.refreshPage(); }
    const sg = b.closest(".seg"); if (sg) sg.append(document.createTextNode(""));   // childList mutation nudges the ui4 sliding indicator
    document.dispatchEvent(new Event("theme:change"));
  });
})();

/* ===== ui16 (t-slack-p2 v2): leading icons for the 菜单 rows. Decorates after app.js / menuExtras render, never touches their markup logic. ===== */
(function () {
  const I = {
    main: '<path d="M6 21V4"/><path d="M6 5h11l-2.5 3.5L17 12H6"/>',
    side: '<circle cx="6.5" cy="5.5" r="2"/><circle cx="6.5" cy="18.5" r="2"/><circle cx="17.5" cy="9" r="2"/><path d="M6.5 7.5v9M17.5 11c0 3.5-4 3-9.5 6"/>',
    daily: '<path d="M9.5 6.5H20M9.5 12H20M9.5 17.5H20"/><path d="M4 6.5h.01M4 12h.01M4 17.5h.01" stroke-width="2.6"/>',
    urgent: '<path d="M12 4 L21 19.5 H3 Z"/><path d="M12 10v4.2M12 16.8h.01"/>',
    ongoing: '<path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H18"/><path d="M15.5 3.5 18 6l-2.5 2.5"/><path d="M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H6"/><path d="M8.5 15.5 6 18l2.5 2.5"/>',
    board: '<rect x="4" y="4.5" width="16" height="15" rx="2"/><path d="M9.5 4.5v15M14.8 4.5v15"/><path d="M6.7 8h.01M12 8h.01M17.3 8h.01" stroke-width="2.4"/>',
    pipe: '<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 12h3M14 12h3"/>',   // t-imp-p3
    studio: '<path d="M3.5 9.8A1.8 1.8 0 0 1 5.3 8h2.2l1.6-2.5h5.8L16.5 8h2.2a1.8 1.8 0 0 1 1.8 1.8v8.4a1.8 1.8 0 0 1-1.8 1.8H5.3a1.8 1.8 0 0 1-1.8-1.8z"/><circle cx="12" cy="13.6" r="3.3"/>',   /* t-nav-shoot: 制作 row */
    logs: '<path d="M6 4h12v13.5a2.5 2.5 0 0 1-2.5 2.5H6.5A2.5 2.5 0 0 1 4 17.5V17h3V6.5A2.5 2.5 0 0 0 4.5 4"/><path d="M10 9h5M10 12.5h5"/>',
    reports: '<path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9.5A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z"/><path d="M14 3.5V8h4M8.5 12.5h7M8.5 15.5h5"/>',
    channels: '<path d="M9.5 4 8 20M16 4l-1.5 16M4.5 9h15.5M4 15h15.5"/>',
    docs: '<path d="M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M5.5 4.5h13L20 8H4z"/><path d="M10 12.5h4"/>',
    assets: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17.5l5-4.5 3.5 3 3-2.5 4.5 4"/>',   // t-imp29-p4
    push: '<path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z"/><path d="M10 21h4"/>',
    status: '<path d="M3.5 12.5h4l2.2-5.5 4 11 2.4-5.5h4.4"/>',
    pushtest: '<path d="M20.5 4 3.5 11l6.5 2.5L12.5 20z"/><path d="M10 13.5 20.5 4"/>',
    theme: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor"/>',
    mictest: '<rect x="9" y="3.5" width="6" height="10.5" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v3"/>',
    mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7l8 6 8-6"/>',   // t-hdr-trim ①: 信箱 row (was the top-bar envelope)
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3 5.5 5.5"/><circle cx="12" cy="12" r="6.6"/>',   // t-settings-tab
    lang: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c-3 3.2-3 13.8 0 17M12 3.5c3 3.2 3 13.8 0 17"/>',
  };
  const ICONS_BORROW = { review: 'review', roles: 'team' };
  function pic(k) {
    const body = I[k] || (window.__ui16Base && window.__ui16Base[ICONS_BORROW[k] || k]);
    return body ? `<i class="m-ic" aria-hidden="true"><svg viewBox="0 0 24 24">${body}</svg></i>` : "";
  }
  // borrowed (review diamond / team) paths are the same as the tab bar's; duplicated here because ICON is closure-private
  window.__ui16Base = {
    review: '<path d="M12 3 L20 12 L12 21 L4 12 Z"/><path d="M12 8 L15.5 12 L12 16 L8.5 12 Z"/>',
    team: '<circle cx="9" cy="8" r="3"/><circle cx="16.5" cy="9.5" r="2.3"/><path d="M3.5 19c.6-3.4 2.8-5 5.5-5s4.9 1.6 5.5 5"/><path d="M14.8 14.6c2.6-.4 4.8 1 5.4 4.4"/>',
  };
  function decorate() {
    const left = document.getElementById("left"); if (!left) return;
    left.querySelectorAll("#nav .nav-i[data-go]").forEach(b => { if (!b.querySelector(".m-ic")) b.insertAdjacentHTML("beforeend", pic(b.dataset.go)); });
    left.querySelectorAll(".m-settings .m-set").forEach(b => {
      if (b.querySelector(":scope > .m-ic")) return;
      const k = b.dataset.set || (b.classList.contains("m-theme") ? "theme" : "");
      b.insertAdjacentHTML("beforeend", pic(k));
    });
  }
  let q = 0;
  const later = () => { if (!q) q = requestAnimationFrame(() => { q = 0; decorate(); }); };
  function boot() {
    const left = document.getElementById("left"); if (!left) return setTimeout(boot, 200);
    new MutationObserver(later).observe(left, { childList: true, subtree: true });
    decorate();
  }
  boot();
})();

// ===== t-m2-c ④ pull-to-refresh (phone only). Pull down at the very top of a list (#page / chat list / 更多) and let go past the threshold:
// a forced full /api/state fetch (App.refresh), then a short "已更新" state with the red dot. The board still polls every 2.5s; this is for "I want it NOW".
// Gesture safety: every listener is passive, so native scrolling, the iOS rubber band and the edge back-swipe are never blocked; we only draw a glass pill.
//  - starts only when the scroller is at scrollTop 0, one finger, x >= 24 (iOS edge back-swipe zone), not on inputs / the voice pill, no drawer / modal / lightbox / search open
//  - decides after 10px: clearly vertical and downward (dy > 1.8 * |dx|), else it lets go for good (horizontal swipes, the right-swipe back, the D1 strip scrub)
//  - a press held 450ms before moving is a text-selection / long-press: ignored; a live text selection is ignored too
//  - if the list actually scrolls (scrollTop > 2) the pull is dropped
//  - move/end are bound to the touchstart target as well as document (a 2.5s poll re-render can detach the node under the finger; WebKit keeps firing on it)
// Cost: one fixed pill, display:none when idle (no layer). will-change only during the gesture; the spinner animation exists only while fetching.
(() => {
  const mq = matchMedia("(max-width: 760px)"), still = matchMedia("(prefers-reduced-motion: reduce)");
  const NATIVE = 24, DEC = 10, TH = 64, MAXV = 84, HOLD = 450;   // TH/MAXV are visual px after resistance
  const en = () => window.App && App.UI && App.UI.lang === "en";
  const L = { pull: ["下拉刷新", "Pull to refresh"], ready: ["松开刷新", "Release to refresh"], busy: ["刷新中", "Refreshing"], done: ["已更新", "Updated"], fail: ["没连上 · 会自动重试", "Offline · retrying"] };
  let pill = null, st = null, busy = false, hideT = 0;
  const lab = k => L[k][en() ? 1 : 0];
  function mk() {
    if (pill) return pill;
    pill = document.createElement("div"); pill.id = "ptr"; pill.setAttribute("role", "status"); pill.setAttribute("aria-live", "polite");
    pill.innerHTML = `<i class="ptr-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 5v13M6.5 12.5 12 18l5.5-5.5"/></svg></i><i class="ptr-sp" aria-hidden="true"></i><i class="ptr-dot" aria-hidden="true"></i><span class="ptr-t"></span>`;
    document.body.appendChild(pill); return pill;
  }
  const resist = d => MAXV * (1 - Math.exp(-d / 150));   // rubber-band feel: 64px visual at ~170px of finger travel
  function show(s, v) {
    const p = mk(); clearTimeout(hideT);
    p.dataset.s = s; p.querySelector(".ptr-t").textContent = s === "done" ? `${lab("done")} · ${new Date().toTimeString().slice(0, 5)}` : lab(s);
    if (v != null) { p.style.setProperty("--ptr-y", v.toFixed(1) + "px"); p.style.setProperty("--ptr-o", Math.min(1, v / 36).toFixed(3)); }
    p.hidden = false;
  }
  function hide(after) {
    if (!pill) return; clearTimeout(hideT);
    hideT = setTimeout(() => {
      pill.dataset.s = "out";
      hideT = setTimeout(() => { pill.hidden = true; pill.classList.remove("live"); pill.dataset.s = ""; }, still.matches ? 0 : 260);
    }, after || 0);
  }
  const blocked = () => document.body.classList.contains("lb-open") || document.body.classList.contains("msearch") || document.body.classList.contains("sheet")
    || document.body.classList.contains("oof-leave") || (document.getElementById("drawer") && document.getElementById("drawer").classList.contains("open"))
    || (document.getElementById("modal") && !document.getElementById("modal").hidden);
  const once = (e, fn) => { if (e.__ptr) return; e.__ptr = 1; fn(e); };
  const mv = e => once(e, onMove), en_ = e => once(e, onEnd), cn = e => once(e, onCancel);
  const unbind = s => { if (s && s.tg) { s.tg.removeEventListener("touchmove", mv); s.tg.removeEventListener("touchend", en_); s.tg.removeEventListener("touchcancel", cn); s.tg = null; } };
  document.addEventListener("touchstart", e => {
    unbind(st); st = null;
    if (!mq.matches || busy || e.touches.length !== 1 || blocked()) return;
    const t = e.touches[0], el = e.target; if (t.clientX < NATIVE || !el.closest) return;
    if (el.closest("input,textarea,select,[contenteditable],video,audio,.vc-pill,.vc-full,.vc-menu,#tabbar")) return;
    const sc = el.closest("#page, .cl-rows, #left"); if (!sc || sc.scrollTop > 0) return;
    const sel = getSelection && getSelection(); if (sel && !sel.isCollapsed) return;
    st = { x: t.clientX, y: t.clientY, t: performance.now(), sc, mode: "wait", v: 0, tg: el };
    el.addEventListener("touchmove", mv, { passive: true }); el.addEventListener("touchend", en_, { passive: true }); el.addEventListener("touchcancel", cn, { passive: true });
  }, { passive: true });
  function onMove(e) {
    if (!st || st.mode === "no") return;
    const t = e.touches[0], dx = t.clientX - st.x, dy = t.clientY - st.y;
    if (st.mode === "wait") {
      if (Math.abs(dx) < DEC && Math.abs(dy) < DEC) return;
      if (dy > 0 && dy > Math.abs(dx) * 1.8 && performance.now() - st.t < HOLD && st.sc.scrollTop <= 0 && !blocked()) {
        st.mode = "pull"; st.y = t.clientY - DEC;   // count from the decision point minus the dead zone, so the pill does not jump
        st.top = Math.max(0, st.sc.getBoundingClientRect().top);
        mk().style.setProperty("--ptr-top", st.top + "px"); pill.classList.add("live");   // .live = will-change while the finger is down
      } else { st.mode = "no"; return; }
    }
    if (st.sc.scrollTop > 2) { drop(); return; }   // the list really scrolled: not a pull
    const d = Math.max(0, t.clientY - st.y); st.v = resist(d);
    show(st.v >= TH ? "ready" : "pull", st.v);
  }
  function drop() { const s = st; unbind(s); st = null; if (s && s.mode === "pull") { pill.classList.remove("live"); hide(); } }
  async function onEnd() {
    const s = st; unbind(s); st = null; if (!s || s.mode !== "pull") return;
    if (s.v < TH || busy) { pill.classList.remove("live"); hide(); return; }
    busy = true; show("busy", 52); pill.classList.remove("live");
    const t0 = performance.now(); let ok = false;
    try { ok = await App.refresh(); } catch (_) { ok = false; }
    const left = 450 - (performance.now() - t0); if (left > 0) await new Promise(r => setTimeout(r, left));   // no one-frame spinner flash on the LAN
    show(ok ? "done" : "fail", 52); busy = false;
    hide(ok ? 900 : 1600);
  }
  function onCancel() { drop(); }   // the system took the touch (edge back, notification shade): no refresh
  document.addEventListener("touchmove", mv, { passive: true }); document.addEventListener("touchend", en_, { passive: true }); document.addEventListener("touchcancel", cn, { passive: true });
  window.__ptr = { state: () => ({ st: st && st.mode, busy, s: pill && pill.dataset.s, hidden: !pill || pill.hidden }) };   // test hook (read-only)
})();

/* ===== t-visual-ink: phone home greeting (date eyebrow + 「今天.」) above the D1 strip. Shown only by skin-ink.css (html[data-skin="ink"]),
   only on the home page; one node, refreshed on every render, never rebuilt. ===== */
(function () {
  const mq = matchMedia("(max-width: 760px)");
  const boot = () => { if (!window.App || !App.on || !App.inkEb) return setTimeout(boot, 50); App.on(sync); sync(); };
  function sync() {
    const ob = document.getElementById("officebox"); if (!ob || !ob.parentNode) return;
    let h = document.getElementById("inkhello");
    if (!h) { h = document.createElement("div"); h.id = "inkhello"; h.className = "ink-hello"; }
    if (h.nextSibling !== ob) ob.parentNode.insertBefore(h, ob);
    const hm = document.documentElement.dataset.home, show = (mq.matches || hm === "app" || hm === "widgets") && App.UI.page === "review" && (!ob.hidden || hm === "widgets");   /* t-home-widgets: the widget home greets too (its #officebox stays hidden) */
    if (h.hidden === show) h.hidden = !show;   // t-home-applike: the desktop app-style home greets too. t-settings-tab: this line had been swallowed by the // comment above, so 「今天.」 stayed on every phone page after home
    if (!show) return;
    const en = App.UI.lang === "en", busy = Object.values((App.ST && App.ST.agents) || {}).filter(a => a.status === "working" && !(App.mgrOnline && App.mgrOnline(a))).length;   // t-cal-fold: same count as 此刻 (the online-only manager is not busy)
    const html = App.inkEb(en ? `${busy} busy` : `${busy} 在忙`) + `<b>${en ? "Today" : "今天"}</b>`;
    if (h._html !== html) { h.innerHTML = html; h._html = html; }
  }
  boot();
})();
