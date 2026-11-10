// Phone home strip "D1 角色选择条" (t-office-d1-s12) at the top of 首页 on phones (<= 760px) and on the desktop app-style home.
// t-rm-pixel-office (11-05): the pixel office and its 「像素办公室」 pill are gone (files in archive/pixel-office-20261105/).
// Seven slanted bust panels: the working / tapped one expands (accordion), the rest are slim slices.
// Everything is patched in place with guarded writes, so a poll never rebuilds or re-animates a panel. All copy follows the UI language (App.UI.lang, zh | en).
(function () {
  const A = () => window.App, $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // t-hr-registry: no id list here; roster order (agents[].order) decides the strip order
  const REPORT = "18:00";
  const S = { act: null, pick: 0, last: null, prev: {} };


  // ---------- copy (zh | en, follows App.UI.lang) ----------
  const COPY = {
    zh: { busy: n => `<b>${n}</b> 在忙`, rest: `都在休息 · ${REPORT} 日报`, rev: n => `${n} 等你`, team: "团队",
      st: ["待你拍板", "进行中", "待办", "近 7 天交付"], wait: n => `${n} 件等你拍板`, oldest: d => `最久 ${d}`,
      m: n => `${n} 分钟`, hm: (h, m) => `${h} 时 ${m} 分`, h: n => `${n} 小时`, d: n => `${n} 天`,
      working: "工作中", resting: "休息中", chat: "点一下，和 TA 聊聊", since: (c, d) => `${c} 起 · ${d}`, mgr: "在线 · 看着信箱", online: "在线", ago: d => `${d}前活动`,
      aria: (nm, w, t, act) => `${nm}，${w}${t ? "：" + t : ""}。${act}`, tapOpen: "点按打开单子", tapChat: "点按打开私信", tapExp: "点按展开",
      open: "打开单子", dm: "私信", dmSub: "打开和 TA 的对话", cancel: "取消", done: "委托完成", sep: " · " },
    en: { busy: n => `<b>${n}</b> working`, rest: `All resting · report at ${REPORT}`, rev: n => `${n} on you`, team: "Team",
      st: ["On you", "Doing", "To do", "7-day shipped"], wait: n => `${n} waiting on you`, oldest: d => `oldest ${d}`,
      m: n => `${n} min`, hm: (h, m) => `${h} h ${m} min`, h: n => `${n} h`, d: n => `${n} d`,
      working: "Working", resting: "Resting", chat: "Tap to chat", since: (c, d) => `since ${c} · ${d}`, mgr: "Online · watching the inbox", online: "Online", ago: d => `active ${d} ago`,
      aria: (nm, w, t, act) => `${nm}, ${w.toLowerCase()}${t ? ": " + t : ""}. ${act}`, tapOpen: "Tap to open the item", tapChat: "Tap to open the chat", tapExp: "Tap to expand",
      open: "Open item", dm: "Message", dmSub: "Open your chat", cancel: "Cancel", done: "Mission done", sep: " · " } };
  const lang = () => (A().UI.lang === "en" ? "en" : "zh"), L = () => COPY[lang()];
  const CHEV = `<svg class="hd-chev" viewBox="0 0 8 14" width="7" height="12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 1.5 6.5 7l-5 5.5"/></svg>`;
  const IC_OPEN = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3h8v8M13 3 4 12"/></svg>`;
  const IC_DM = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 3.5h11v7h-5l-3 2.5v-2.5h-3z"/></svg>`;

  // ---------- data ----------
  function itemFor(a) {
    const its = A().items();
    let it = a.item && its.find(i => i.id === a.item && i.stage !== "done");
    if (!it) it = its.filter(i => i.owner === a.id && (i.stage === "doing" || i.stage === "review")).sort((x, y) => (y.updated || "").localeCompare(x.updated || ""))[0];
    return it || null;
  }
  const isW = a => a.status === "working" && !(A().mgrOnline && A().mgrOnline(a));   // t-now-closed: the manager with no live card is online, not working
  const mins = iso => iso ? Math.max(0, Math.round((Date.now() - new Date(iso)) / 6e4)) : 0;
  const clock = iso => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  const dur = m => m < 60 ? L().m(Math.max(1, m)) : L().hm(Math.floor(m / 60), String(m % 60).padStart(2, "0"));
  const durShort = m => m < 60 ? L().m(Math.max(1, m)) : m < 48 * 60 ? L().h(Math.round(m / 60)) : L().d(Math.round(m / 1440));
  const ordered = ag => ag.slice().sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  function oldest(c) { if (!c.oldest) return ""; const m = mins(new Date(c.oldest).toISOString()); return L().oldest(durShort(m)); }
  const urgent = c => c.review >= 3 || (c.review > 0 && c.oldest && mins(new Date(c.oldest).toISOString()) > 12 * 60);
  const itemStage = id => { const it = (A().ST.items || []).find(i => i.id === id); return it && it.stage; };
  const sumHTML = (ag, c) => { const w = ag.filter(isW).length; return (w ? L().busy(w) : L().rest) + (c.review ? ` · <span class="hd-rd"><i></i>${L().rev(c.review)}</span>` : ""); };

  // guarded writes: never touch the DOM when nothing changed (this is what keeps polls mutation-free)
  const setT = (el, v) => { if (el && el.textContent !== v) el.textContent = v; };
  const setH = (el, v) => { if (el && el.innerHTML !== v) el.innerHTML = v; };
  const setA = (el, n, v) => { if (v == null) { if (el.hasAttribute(n)) el.removeAttribute(n); } else if (el.getAttribute(n) !== String(v)) el.setAttribute(n, v); };

  // ---------- build ----------
  function panel(a, i) {
    const nm = A().aname(a);
    return `<div class="dp" role="button" tabindex="0" data-id="${a.id}" data-hd-pick="${a.id}" style="--i:${i};--tint:var(--tint-ph, var(--accent));--tint-hex:${A().tintOf(a)}">
      <i class="dp-edge"></i><div class="dp-art"><i class="dp-img" style="background-image:${A().hasArt && A().hasArt(a, "panel") ? `url('/static/art/panels/${a.id}.webp'),` : ""}url('${esc(A().avatarUrl(a, 1))}'); --ph:${(i * 0.7).toFixed(1)}s"></i><i class="dp-uti" style="background-image:url('${esc(A().avatarUrl(a, 1))}')">${A().wsheet && A().wsheet(a, 320) ? `<i class="dp-utw" style="${A().wsheet(a, 320).slice(1)}"></i>` : ""}</i></div>
      <span class="dp-vn">${esc(nm)}</span><i class="dp-un"></i><span class="dp-rg"><i></i></span>
      <div class="dp-info"><div class="n"><b>${esc(nm)}</b><span class="hd-st"></span></div><div class="rl">${esc(A().atitle(a))}</div>
        <div class="dp-t"><span></span>${CHEV}</div><div class="dp-m"><em></em><i class="dp-bar"><u></u></i></div></div>
      <div class="dp-btns"><button class="dp-b" data-op aria-label="${L().open}">${IC_OPEN}</button><button class="dp-b" data-chat="${a.id}" aria-label="${L().dm}">${IC_DM}</button></div>
      <div class="dp-fx" aria-hidden="true"></div></div>`;
  }
  function build(ob, d) {
    const as = ordered(d.agents); S.act = null; S.prev = {}; ob.dataset.lang = lang();
    const stats = ["review", "doing", "todo", "week"].map((k, i) => [k, L().st[i]]).map(([k, l], i) => `<div class="hd-stat" role="button" tabindex="0" data-hd-f="${k}" style="--i:${i}"><b data-k="${k}">0</b><i class="hd-rdot"></i><span>${l}</span>${k === "review" ? '<small class="hd-old"></small>' : ""}</div>`).join("");   /* ri1107-P5: 「最久 N」 lives under 待你拍板 (the red 「N 件等你拍板」 bar is gone) */
    ob.innerHTML = `<div class="hd hd-enter">
      <div class="hd-h"><span class="hd-sum"></span><button type="button" class="hd-srch" data-msearch aria-label="${A().UI.lang === "en" ? "Search" : "搜索"}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16 L20.5 20.5"/></svg></button></div>
      <div class="hd-tool"></div>
      <div class="dp-strip" role="group" aria-label="${L().team}">${as.map(panel).join("")}</div>
      <div class="hd-stats">${stats}</div></div>`;
    wire(ob);
    setTimeout(() => { const r = $(".hd-enter", ob); if (r) r.classList.remove("hd-enter"); }, 1000);
  }

  // ---------- gestures: scrub, long-press sheet, keyboard ----------
  function wire(ob) {
    const host = $(".dp-strip", ob); let down = null, lp = null;
    host.addEventListener("pointerdown", e => {
      const p = e.target.closest(".dp"); if (!p) return;
      down = { x: e.clientX, y: e.clientY, moved: false, id: p.dataset.id, edge: e.clientX < 24 || e.clientX > innerWidth - 24 };   // OS edge zone (swipe-back) is left alone
      clearTimeout(lp); lp = setTimeout(() => { if (down && !down.moved) { down.long = true; sheet(down.id); } }, 480);
    });
    host.addEventListener("pointermove", e => {
      if (!down) return; const dx = Math.abs(e.clientX - down.x), dy = Math.abs(e.clientY - down.y);
      if (dx > 8 || dy > 8) clearTimeout(lp);
      if (down.edge || down.long) return;
      if (!down.moved && dx < 10) return; down.moved = true;
      const el = document.elementFromPoint(e.clientX, host.getBoundingClientRect().top + 50), p = el && el.closest(".dp");
      if (p && p.dataset.id !== S.act) pick(ob, p.dataset.id);
    });
    const end = () => { clearTimeout(lp); if (down && (down.moved || down.long)) { host._swallow = true; setTimeout(() => host._swallow = false, 60); } down = null; };
    host.addEventListener("pointerup", end); host.addEventListener("pointercancel", end);
    host.addEventListener("click", e => { if (host._swallow) { e.stopPropagation(); e.preventDefault(); } }, true);
    host.addEventListener("contextmenu", e => e.preventDefault());
    host.addEventListener("keydown", e => {
      const p = e.target.closest(".dp"); if (!p) return;
      const all = [...host.querySelectorAll(".dp")], i = all.indexOf(p);
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); const n = all[(i + (e.key === "ArrowRight" ? 1 : -1) + all.length) % all.length]; n.focus(); pick(ob, n.dataset.id); }
      else if ((e.key === "Enter" || e.key === " ") && e.target === p) { e.preventDefault(); p.click(); }
    });
    ob.addEventListener("keydown", e => { const s = e.target.closest(".hd-stat"); if (s && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); s.click(); } });
  }
  function pick(ob, id) { if (id === S.act) return false; S.act = id; S.pick = Date.now(); apply(ob, S.last, false); return true; }

  // long-press quick sheet: the one blurred layer, only while open. Only 私信 / 打开单子 (派活 no longer exists in the product)
  function sheet(id) {
    const a = A().agent(id), it = itemFor(a); if (!a) return;
    const w = document.createElement("div"); w.className = "dp-sheet-w";
    w.innerHTML = `<div class="dp-scrim"></div><div class="dp-sheet" role="dialog" aria-label="${esc(A().aname(a))}">
      <div class="sh-h"><span class="hd-mini${isW(a) ? " working" : ""}${isW(a) && A().wsheet && A().wsheet(a, 160) ? " wsheet" : ""}" style="background-image:url('${esc(A().avatarUrl(a))}')${isW(a) && A().wsheet ? A().wsheet(a, 160) : ""}"></span><div><b>${esc(A().aname(a))}</b><span>${esc(A().atitle(a))}${L().sep}${isW(a) ? L().working : L().resting}</span></div></div>
      ${it ? `<button class="sh-i" data-sh="open">${IC_OPEN}<span>${L().open}</span><em>${esc(it.title)}</em></button>` : ""}
      <button class="sh-i" data-sh="dm">${IC_DM}<span>${L().dm}</span><em>${L().dmSub}</em></button>
      <button class="sh-i cancel" data-sh="x"><span>${L().cancel}</span></button></div>`;
    document.body.appendChild(w); requestAnimationFrame(() => w.classList.add("in"));
    const close = () => { w.classList.remove("in"); setTimeout(() => w.remove(), 260); };
    w.addEventListener("click", e => {
      const b = e.target.closest("[data-sh]"); if (!b && !e.target.classList.contains("dp-scrim")) return; e.stopPropagation(); close();
      if (!b) return;
      if (b.dataset.sh === "open" && it) A().openItem(it.id);
      if (b.dataset.sh === "dm") { const t = document.createElement("i"); t.setAttribute("data-chat", id); document.body.appendChild(t); t.click(); t.remove(); }   // goes through app.js + mobile.js tab glue
    });
  }

  // ---------- events: just assigned (slice lights up), mission complete (the splash look, cut down to one panel) ----------
  function lit(el) { el.classList.add("lit"); setTimeout(() => el.classList.remove("lit"), 1700); }
  function mission(el) {
    const fx = $(".dp-fx", el); fx.innerHTML = `<i class="s1"></i><i class="s2"></i><i class="fl"></i><b class="pl">COMPLETE<small>${L().done}</small></b>`;
    el.classList.add("mc"); setTimeout(() => { el.classList.remove("mc"); fx.innerHTML = ""; }, 2300);
  }

  // ---------- patch ----------
  function apply(ob, d, events) {
    const root = $(".hd", ob); if (!root || !d) return;
    /* t-chrome-badge: 「Chrome 使用中 · 谁 · 在做什么」 under the summary line; guarded write, the motion state lives in App.toolLine */
    const tl = $(".hd-tool", root); if (tl && A().toolLine) { const h = A().toolLine("m"); setH(tl, h); tl.classList.toggle("on", !!h); }
    const as = ordered(d.agents), waiting = new Set(A().items().filter(i => A().onYouCard ? A().onYouCard(i) : i.stage === "review" && !(A().busy && A().busy(i))).map(i => i.owner));   // t-doing-first
    /* t-office-d1-s3 + t-ri1104-p2: the dot also means "unread messages from TA", same rule as the TEAM list and the chat roster */
    as.forEach(a => { if (A().unreadOf && A().unreadOf(a.id)) waiting.add(a.id); });
    as.forEach(a => {
      const el = $(`.dp[data-id="${a.id}"]`, root); if (!el) return;
      const w = isW(a), it = itemFor(a), on = a.id === S.act, sn = a.since;   // no `since` (old server): the elapsed line falls back to the activity text and the bar hides
      el.classList.toggle("act", on); el.classList.toggle("w", w);
      setA(el, "aria-label", L().aria(A().aname(a), w ? L().working : L().resting, it && it.title, on ? (it ? L().tapOpen : L().tapChat) : L().tapExp));
      setA(el, "aria-expanded", on);
      $(".dp-un", el).classList.toggle("on", waiting.has(a.id));
      // only the active panel carries navigation attributes (app.js listens for [data-chat] globally)
      setA(el, "data-chat", on && !it ? a.id : null); setA(el, "data-hd-open", on && it ? it.id : null);
      const op = $("[data-op]", el); setA(op, "data-hd-open", it ? it.id : null); op.classList.toggle("off", !it);
      setH($(".rl", el), `<span class="rl-t">${esc(A().atitle(a))}</span>` + (A().qBadge ? A().qBadge(a.id) : ""));   // t-agent-queue-mobile: 「排队 N」 on the title line (the name line is full)
      const st = $(".hd-st", el); setH(st, w ? "<i></i>" + L().working : a.id === "manager" && a.status === "working" ? L().online : L().resting); st.classList.toggle("idle", !w);
      setT($(".dp-t span", el), it ? it.title : (w ? a.activity || "" : L().chat)); $(".dp-t", el).classList.toggle("chat", !it);
      setT($(".dp-m em", el), w ? (sn ? L().since(clock(sn), dur(mins(sn))) : (a.activity || L().working)) : (a.id === "manager" ? L().mgr : a.last_seen ? L().ago(durShort(mins(a.last_seen))) : L().resting));
      const bar = $(".dp-bar", el); bar.classList.toggle("off", !(w && sn)); setA($("u", bar), "style", `--p:${w && sn ? Math.min(1, mins(sn) / 60).toFixed(3) : 0}`);
    });
    if (events) as.forEach(a => {   // transitions are inferred from the previous poll
      const el = $(`.dp[data-id="${a.id}"]`, root), p = S.prev[a.id], w = isW(a);
      if (p && el) {
        if (!p.w && w) { lit(el); if (Date.now() - S.pick > 15000) { S.act = a.id; S.pick = 0; apply(ob, d, false); } }
        if (p.w && !w && p.item && itemStage(p.item) === "done") { if (Date.now() - S.pick > 15000) { S.act = a.id; apply(ob, d, false); } mission(el); }
      }
      S.prev[a.id] = { w, item: a.item || (p && p.item) };
    });
  }
  function patch(ob, d) {
    const root = $(".hd", ob), c = d.counts, hf = A().UI.hf || "review", as = ordered(d.agents), w = as.filter(isW), first = !root._ready;
    S.last = d;
    if (!S.act || !as.some(a => a.id === S.act)) S.act = (w[0] || as[0]).id;
    setH($(".hd-sum", root), sumHTML(d.agents, c));
    apply(ob, d, true);
    if (first) as.forEach(a => { S.prev[a.id] = { w: isW(a), item: a.item }; });
    const old = $(".hd-old", root); if (old) { setT(old, c.review ? oldest(c) : ""); old.classList.toggle("hot", !!c.review && !!c.oldest && mins(new Date(c.oldest).toISOString()) > 12 * 60); }   /* ri1107-P5 */
    root.querySelectorAll(".hd-stat").forEach(s => {
      const k = s.dataset.hdF, b = $("b", s), v = String(c[k]);
      s.classList.toggle("on", hf === k); s.classList.toggle("alert", k === "review" && c.review > 0);
      A().roll(b, v, "hd." + k);   // t-m2-a ②: rolls only when the count changes (was: text swap + .bump pop)
    });
    root._ready = true;
  }

  // ---------- A2 (t-m-team-alt, user pick 11-07 20:07): phone-only team card ----------
  // Working members as rows (chibi work sheet under 特典 data-ut while working, static patch elsewhere / reduced motion), full title + 「HH:MM 起 · N 分钟」,
  // 看画面 as a text link (data-live, same capture handler as the Chrome pill). Idle members fold into a grey avatar stack on the last line; a tap
  // expands names (tap a face to DM). No header line. 0 working: 「都歇着呢。」 + the latest delivery. Stats row unchanged (same .hd-stat markup + patch).
  // The desktop app-style home keeps the D1 strip (render() picks by width).
  const C2 = { zh: { idle: n => `${n} 人空闲`, exp: "空闲 · 点头像私信", fold: "收起", rest: "都歇着呢。", last: (nm, t, ti) => `最近一单：${nm} ${t} 交了「${ti}」`,
      since: (c, d) => `${c} 起 · ${d}`, q: n => `还排着 ${n} 个`, live: "看画面", none: "还没有交付" },
    en: { idle: n => `${n} idle`, exp: "Idle · tap a face to message", fold: "Hide", rest: "Everyone's resting.", last: (nm, t, ti) => `Last shipped: ${nm} · ${t} · ${ti}`,
      since: (c, d) => `since ${c} · ${d}`, q: n => `${n} queued`, live: "Watch", none: "Nothing shipped yet" } };
  const L2 = () => C2[lang()];
  const PHONE = matchMedia("(max-width: 760px)");
  const S2 = { x: false, prev: null, mc: {} };   // a2restore: prev = last poll per member (dispatch / completion events), mc = rows still playing 委托完成
  const whenShort = iso => { const d = new Date(iso), n = new Date(); return d.toDateString() === n.toDateString() ? clock(iso) : `${d.getMonth() + 1}/${d.getDate()}`; };
  function lastShip() {
    const it = (A().ST.items || []).filter(i => i.stage === "done" && i.updated).sort((x, y) => (y.updated || "").localeCompare(x.updated || ""))[0];
    if (!it) return { t: L2().none, id: null };
    const ow = it.owner && A().agent(it.owner);
    return { t: L2().last(ow ? A().aname(ow) : "", whenShort(it.updated), it.title || it.id), id: it.id };
  }
  function a2Av(a, w) {
    const ws = w && A().wsheet ? A().wsheet(a, 320) : "";
    return `<span class="a2-av hd-mini${w ? " working" : ""}${ws ? " wsheet" : ""}" style="background-image:url('${esc(A().avatarUrl(a))}')${ws}" aria-hidden="true"></span>`;
  }
  // a2restore (t-m-a2-restore): data-lp = long-press opens the D1 quick sheet; .a2-glow wraps the avatar so the dispatch halo never overrides the chibi sheet animation;
  // .a2-tg = the 「Chrome」 tag (agents[id].tool); .a2-fx hosts the 委托完成 streak / plate (same markup as the D1 mission()).
  function a2Row(a) {
    return `<div class="a2-r" role="button" tabindex="0" data-a2="${a.id}" data-lp="${a.id}" style="--tint:var(--tint-ph, var(--accent));--tint-hex:${A().tintOf(a)}"><span class="a2-glow">${a2Av(a, true)}</span><div class="a2-b"><div class="a2-n"><span class="a2-nm">${esc(A().aname(a))}</span><span class="a2-tg" hidden></span></div><div class="a2-t"></div>
      <div class="a2-m"><span class="a2-k"></span><button type="button" class="a2-lk" data-live="${a.id}" hidden>${L2().live} <span aria-hidden="true">›</span></button></div></div><div class="a2-fx" aria-hidden="true"></div></div>`;
  }
  const toolTag = k => k === "chrome" ? "Chrome" : k === "computer" ? (lang() === "en" ? "Computer" : "电脑") : String(k);
  function a2Lit(el) { el.classList.remove("lit"); void el.offsetWidth; el.classList.add("lit"); setTimeout(() => el.classList.remove("lit"), 1700); }
  function a2Mission(el) {
    const fx = $(".a2-fx", el); if (!fx) return;
    fx.innerHTML = `<i class="s1"></i><i class="s2"></i><i class="fl"></i><b class="pl">COMPLETE<small>${L().done}</small></b>`;
    el.classList.add("mc"); setTimeout(() => { el.classList.remove("mc"); fx.innerHTML = ""; }, 2300);
  }
  // long-press on a working row, a stacked idle face or an expanded idle face -> the D1 sheet(); the click that follows the hold is swallowed (capture on #officebox)
  function a2Wire(ob) {
    if (ob._a2lp) return; ob._a2lp = true;
    let down = null, lp = 0;
    ob.addEventListener("pointerdown", e => {
      if (ob.dataset.hv !== "a2") return; const t = e.target.closest("[data-lp]"); if (!t) return;
      down = { x: e.clientX, y: e.clientY, id: t.dataset.lp };
      clearTimeout(lp); lp = setTimeout(() => { if (down) { down.long = true; sheet(down.id); } }, 480);
    });
    ob.addEventListener("pointermove", e => { if (down && (Math.abs(e.clientX - down.x) > 8 || Math.abs(e.clientY - down.y) > 8)) { clearTimeout(lp); down = null; } });
    // the click after the hold is hit-tested at release, i.e. on the sheet's scrim (which would close the sheet at once): swallow it at window capture
    const eat = e => { e.stopPropagation(); e.preventDefault(); removeEventListener("click", eat, true); };
    const end = () => { clearTimeout(lp); if (down && down.long) { addEventListener("click", eat, true); setTimeout(() => removeEventListener("click", eat, true), 400); } down = null; };
    ob.addEventListener("pointerup", end); ob.addEventListener("pointercancel", end);
    ob.addEventListener("contextmenu", e => { if (ob.dataset.hv === "a2" && e.target.closest("[data-lp]")) e.preventDefault(); });
  }
  function a2Build(ob) {
    const stats = ["review", "doing", "todo", "week"].map((k, i) => [k, L().st[i]]).map(([k, l], i) => `<div class="hd-stat" role="button" tabindex="0" data-hd-f="${k}" style="--i:${i}"><b data-k="${k}">0</b><i class="hd-rdot"></i><span>${l}</span>${k === "review" ? `<small class="hd-old"></small>` : ""}</div>`).join("");
    ob.dataset.lang = lang(); ob.dataset.hv = "a2";
    ob.innerHTML = `<div class="hd hd-a2"><button type="button" class="hd-srch a2-srch" data-msearch aria-label="${lang() === "en" ? "Search" : "搜索"}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16 L20.5 20.5"/></svg></button><div class="a2-rows"></div><div class="a2-rest" role="button" tabindex="0" hidden><div class="a2-rest-t">${L2().rest}</div><div class="a2-rest-k"></div></div>
      <button type="button" class="a2-stack" aria-expanded="false"><span class="a2-faces"></span><span class="a2-sn"></span></button>
      <div class="a2-exp" aria-hidden="true"><div class="a2-ex-in"><div class="a2-eh"><span>${L2().exp}</span><button type="button" class="a2-fold">${L2().fold} <span aria-hidden="true">‹</span></button></div><div class="a2-gr"></div></div></div>
      <div class="hd-stats">${stats}</div></div>`;
    if (!ob._a2kd) { ob._a2kd = true; ob.addEventListener("keydown", e => { if (ob.dataset.hv !== "a2") return; const s = e.target.closest(".hd-stat,.a2-r"); if (s && e.target === s && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); s.click(); } }); }
    a2Wire(ob);
  }
  function a2Patch(ob, d) {
    const root = $(".hd-a2", ob); if (!root) return;
    S.last = d;
    const as = ordered(d.agents), w = as.filter(isW), c = d.counts, now = Date.now();
    // a2restore: events inferred from the previous poll, same rule as the D1 apply(): idle -> working = lit, working -> idle with its card done = 委托完成
    // a cold open paints the IndexedDB snapshot first (App.UI.snap): no baseline from it, or whatever changed while the phone was away would light up / play on open
    const snap = !!A().UI.snap, first = !S2.prev, lit = [], fin = [];
    if (first && !snap) S2.prev = {};
    if (!snap) as.forEach(a => {
      const p = S2.prev[a.id], wn = isW(a);
      if (p && !first) { if (!p.w && wn) lit.push(a.id); if (p.w && !wn && p.item && itemStage(p.item) === "done") { S2.mc[a.id] = { t: now, item: p.item }; fin.push(a.id); } }
      S2.prev[a.id] = { w: wn, item: a.item || (p && p.item) };
    });
    Object.keys(S2.mc).forEach(id => { if (now - S2.mc[id].t >= 2300 || w.some(a => a.id === id)) delete S2.mc[id]; });
    const show = as.filter(a => isW(a) || S2.mc[a.id]), idle = as.filter(a => !isW(a) && !S2.mc[a.id]);
    // rows: reconciled per member (a new worker is inserted, a finished one removed), so the other rows' chibi sheets never restart; no DOM writes when nothing changed
    const rows = $(".a2-rows", root), want = show.map(a => a.id), have = {};
    [...rows.children].forEach(el => { if (want.includes(el.dataset.a2)) have[el.dataset.a2] = el; else el.remove(); });
    show.forEach((a, i) => {
      let el = have[a.id];
      if (!el) { const t = document.createElement("div"); t.innerHTML = a2Row(a); el = t.firstElementChild; }
      if (rows.children[i] !== el) rows.insertBefore(el, rows.children[i] || null);
    });
    setA(rows, "data-n", Math.min(show.length, 4));   // avatar size steps with the head count (user 20:14: show the chibi generously)
    show.forEach(a => {
      const el = $(`.a2-r[data-a2="${a.id}"]`, rows); if (!el) return;
      const tg = $(".a2-tg", el), tk = isW(a) ? a.tool || "" : ""; setT(tg, tk ? toolTag(tk) : ""); if (tg.hidden === !!tk) tg.hidden = !tk;
      if (S2.mc[a.id]) {   // finishing: the row stays (static) until the plate has played, then the next patch removes it
        const di = (A().ST.items || []).find(i => i.id === S2.mc[a.id].item); if (di) setT($(".a2-t", el), di.title || di.id);
        setA(el, "data-hd-open", S2.mc[a.id].item); setA(el, "data-chat", null); const lk = $(".a2-lk", el); if (!lk.hidden) lk.hidden = true;
        return;
      }
      const it = itemFor(a), sn = a.since, qn = A().queueOf ? A().queueOf(a.id).length : 0;
      // the chibi sheet var depends on data-ut, which can flip without a rebuild: rewrite the avatar only when its markup would change
      const av = $(".a2-av", el), nav = a2Av(a, true); if (av.outerHTML !== nav) av.outerHTML = nav;
      setT($(".a2-t", el), it ? it.title : (a.activity || L().working));
      setT($(".a2-k", el), [sn ? L2().since(clock(sn), dur(mins(sn))) : (a.activity && it ? a.activity : ""), qn ? L2().q(qn) : ""].filter(Boolean).join(" · "));
      const lk = $(".a2-lk", el), lv = a.tool === "chrome"; if (lk.hidden === lv) lk.hidden = !lv;
      setA(el, "data-hd-open", it ? it.id : null); setA(el, "data-chat", it ? null : a.id);
      setA(el, "aria-label", L().aria(A().aname(a), L().working, it && it.title, it ? L().tapOpen : L().tapChat));
    });
    const rest = $(".a2-rest", root); if (rest.hidden === !show.length) rest.hidden = !!show.length;
    if (!show.length) { const ls = lastShip(); setT($(".a2-rest-k", root), ls.t); setA(rest, "data-hd-open", ls.id); rest.classList.toggle("go", !!ls.id); setA(rest, "role", ls.id ? "button" : null); setA(rest, "tabindex", ls.id ? "0" : null); }   // idletap: 0 working opens the latest delivery
    // idle stack + expanded grid
    const stk = $(".a2-stack", root); if (stk.hidden === !idle.length) stk.hidden = !idle.length;
    const fk = idle.map(a => a.id).join(",");
    if (stk.dataset.k !== fk) {
      stk.dataset.k = fk;
      setH($(".a2-faces", stk), idle.slice(0, 3).map(a => `<i data-lp="${a.id}" style="background-image:url('${esc(A().avatarUrl(a))}')"></i>`).join(""));
      setH($(".a2-gr", root), idle.map((a, i) => `<button type="button" class="a2-g" data-chat="${a.id}" data-lp="${a.id}" style="--gi:${i}"><i style="background-image:url('${esc(A().avatarUrl(a))}')"></i><span>${esc(A().aname(a).split(" ")[0])}</span></button>`).join(""));
    }
    const x = S2.x && idle.length > 0;
    setH($(".a2-sn", stk), `${L2().idle(idle.length)} <span aria-hidden="true">${x ? "‹" : "›"}</span>`);
    setA(stk, "aria-expanded", String(x)); const ex = $(".a2-exp", root); ex.classList.toggle("on", x); setA(ex, "aria-hidden", String(!x)); stk.classList.toggle("on", x);   // idletap: grid-rows 0fr -> 1fr animates the open / close
    lit.forEach(id => { const el = $(`.a2-r[data-a2="${id}"]`, rows); if (el) a2Lit(el); });
    fin.forEach(id => {
      const el = $(`.a2-r[data-a2="${id}"]`, rows); if (el) a2Mission(el);
      setTimeout(() => { const o = document.getElementById("officebox"); if (o && o.dataset.hv === "a2" && S.last) a2Patch(o, S.last); }, 2350);
    });
    const old = $(".hd-old", root); if (old) { setT(old, c.review ? oldest(c) : ""); old.classList.toggle("hot", !!c.review && !!c.oldest && mins(new Date(c.oldest).toISOString()) > 12 * 60); }
    const hf = A().UI.hf || "review";
    root.querySelectorAll(".hd-stat").forEach(s => { const k = s.dataset.hdF; s.classList.toggle("on", hf === k); s.classList.toggle("alert", k === "review" && c.review > 0); A().roll($("b", s), String(c[k]), "hd." + k); });
  }
  document.addEventListener("click", e => {
    const ob = e.target.closest("#officebox"); if (!ob || ob.dataset.hv !== "a2") return;
    if (e.target.closest(".a2-stack, .a2-fold")) { S2.x = !S2.x; if (S.last) a2Patch(ob, S.last); return; }
    if (e.target.closest("[data-chat]")) return;   // app.js handles it (idle faces, a working member with no card)
    const f = e.target.closest("[data-hd-f]");
    if (f) { const k = f.dataset.hdF, U = A().UI; U.hf = (U.hf || "review") === k && k !== "review" ? "review" : k; A().refreshPage(); return; }
    const o = e.target.closest("[data-hd-open]"); if (o) { A().openItem(o.dataset.hdOpen); return; }
  });

  // ---------- entry ----------
  function render(ob, d) {
    d = { ...d, agents: d.agents.filter(a => a.enabled !== false) };
    if (PHONE.matches) {   // t-m-team-alt A2 on phones; the desktop app-style home keeps D1
      if (ob.dataset.hv !== "a2" || !ob.firstElementChild || ob.dataset.lang !== lang()) a2Build(ob);
      a2Patch(ob, d); return;
    }
    const fresh = ob.dataset.hv !== "d1" || !ob.firstElementChild || ob.dataset.lang !== lang();   // a language switch rebuilds (all copy is baked in at build)
    if (fresh) { ob.dataset.hv = "d1"; build(ob, d); }
    patch(ob, d);
  }
  document.addEventListener("click", e => {
    const ob = e.target.closest("#officebox"); if (!ob || ob.dataset.hv !== "d1") return;
    const pk = e.target.closest("[data-hd-pick]");
    // a tap on a slim slice only expands it. pick() puts data-chat on the newly expanded panel (resting, no item) synchronously, and mobile.js's
    // document click listener runs after ours (loaded later), so without stopImmediatePropagation it would jump straight into TA's chat (t-office-d1-s3 fix)
    if (pk && !pk.classList.contains("act")) { e.stopImmediatePropagation(); pick(ob, pk.dataset.hdPick); return; }
    if (e.target.closest("[data-chat]")) return;   // app.js handles it
    const f = e.target.closest("[data-hd-f]");
    if (f) { const k = f.dataset.hdF, U = A().UI; U.hf = (U.hf || "review") === k && k !== "review" ? "review" : k; A().refreshPage(); return; }
    const o = e.target.closest("[data-hd-open]"); if (o) { A().openItem(o.dataset.hdOpen); return; }
  });
  // t-now-elapsed: 「01:57 起 · N 分钟」 and the progress bar were only recomputed on a new state rev; re-apply the last data every 20 s
  setInterval(() => { const ob = document.getElementById("officebox"); if (S.last && ob && ob.dataset.hv === "d1" && $(".hd", ob)) apply(ob, S.last, false); if (S.last && ob && ob.dataset.hv === "a2") a2Patch(ob, S.last); }, 20000);
  window.HomeD = { render };
})();
