// Phone home strip "D1 角色选择条" (t-office-d1-s12) at the top of 首页 on phones (<= 760px) and on the desktop app-style home.
// t-rm-pixel-office (11-05): the pixel office and its 「像素办公室」 pill are gone (files in archive/pixel-office-20261105/).
// Seven slanted bust panels: the working / tapped one expands (accordion), the rest are slim slices.
// Everything is patched in place with guarded writes, so a poll never rebuilds or re-animates a panel. All copy follows the UI language (App.UI.lang, zh | en).
(function () {
  const A = () => window.App, $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ORDER = ["manager", "scout", "writer", "director", "artist", "ops", "smith"];   // same order as the art
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
  const ordered = ag => ORDER.map(id => ag.find(a => a.id === id)).filter(Boolean).concat(ag.filter(a => !ORDER.includes(a.id)));
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
    return `<div class="dp" role="button" tabindex="0" data-id="${a.id}" data-hd-pick="${a.id}" style="--i:${i};--tint:var(--c-${a.id}, var(--accent))">
      <i class="dp-edge"></i><div class="dp-art"><i class="dp-img" style="background-image:url('${esc(A().avatarUrl(a, 1))}'); --ph:${(i * 0.7).toFixed(1)}s"></i><i class="dp-uti" style="background-image:url('${esc(A().avatarUrl(a, 1))}')"></i></div>
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
      <div class="sh-h"><span class="hd-mini${isW(a) ? " working" : ""}" style="background-image:url('${esc(A().avatarUrl(a))}')"></span><div><b>${esc(A().aname(a))}</b><span>${esc(A().atitle(a))}${L().sep}${isW(a) ? L().working : L().resting}</span></div></div>
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

  // ---------- entry ----------
  function render(ob, d) {
    d = { ...d, agents: d.agents.filter(a => a.enabled !== false) };
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
  setInterval(() => { const ob = document.getElementById("officebox"); if (S.last && ob && ob.dataset.hv === "d1" && $(".hd", ob)) apply(ob, S.last, false); }, 20000);
  window.HomeD = { render };
})();
