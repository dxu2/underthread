/* t-imp-p5: ⌘K 万能跳转.
   One search engine (Pal.find) for both layouts: items, what was said in chats, and actions.
   Desktop: ⌘K (anywhere, even in a text box) or "/" (only outside text boxes) opens the palette below.
   Phone: the existing search sheet (mobile.js openSearch) calls Pal.find too and lists the same actions.
   Anything that changes state goes through the app's own paths: 批准 = App.rvApprove (the 4.5 s undo hold). */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const en = () => App.UI.lang === "en";
  const phone = () => matchMedia("(max-width: 760px)").matches;
  const convMsgs = id => App.chatList ? App.chatList(id) : id === "manager" ? (App.ST.chat || []) : ((App.ST.dms || {})[id] || []);   /* ri1105-P4: + older chat once fetched */
  const clean = s => String(s || "").replace(/```[\s\S]*?```/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`>#]+/g, "").replace(/\s+/g, " ").trim();
  // a window of text around the hit, so you see why it matched
  function around(text, q) {
    const s = clean(text), i = s.toLowerCase().indexOf(q);
    if (i < 0 || s.length <= 60) return s.slice(0, 80);
    const a = Math.max(0, i - 22);
    return (a ? "…" : "") + s.slice(a, a + 70) + (a + 70 < s.length ? "…" : "");
  }
  // t-ri1103-p5: a window around the hit at raw offset i (drafts are long: clean only the window, not the whole text)
  function aroundAt(text, i, q) {
    const raw = String(text || ""), a = Math.max(0, i - 70), w = clean(raw.slice(a, i + q.length + 110)), j = w.toLowerCase().indexOf(q);
    if (j < 0) return around(raw.slice(a, i + q.length + 400), q);
    const b = Math.max(0, j - 24);
    return (a || b ? "…" : "") + w.slice(b, b + 74) + (b + 74 < w.length || i + q.length + 110 < raw.length ? "…" : "");
  }
  const hlAll = (s, q) => { if (!q) return esc(s); const lc = s.toLowerCase(); let o = "", k = 0, i; while ((i = lc.indexOf(q, k)) >= 0) { o += esc(s.slice(k, i)) + "<mark>" + esc(s.slice(i, i + q.length)) + "</mark>"; k = i + q.length; } return o + esc(s.slice(k)); };
  const hl = (s, q) => { const i = s.toLowerCase().indexOf(q); return i < 0 || !q ? esc(s) : esc(s.slice(0, i)) + "<mark>" + esc(s.slice(i, i + q.length)) + "</mark>" + esc(s.slice(i + q.length)); };
  // fire a click on a throwaway node, so the app's own click handlers (both layouts) do the work
  function fire(attr, val) {
    const b = document.createElement("button"); b.type = "button"; b.hidden = true; b.setAttribute(attr, val);
    document.body.appendChild(b); b.click(); b.remove();
  }

  // ---------- actions ----------
  function actions(q, topItem) {
    const zh = !en(), out = [], UI = App.UI;
    const add = (id, label, sub, kw, run, key) => out.push({ id, label, sub, kw: (label + " " + kw).toLowerCase(), run, key });
    // approve: the open item, else the top search hit (only where the detail page has 批准)
    const cand = [UI.item && App.ST.items.find(i => i.id === UI.item), topItem].filter(Boolean);
    const seen = new Set();
    for (const it of cand) {
      if (seen.has(it.id) || !App.rvCanApprove(it)) continue; seen.add(it.id);
      add("approve:" + it.id, zh ? `${App.okLabel(it, false)}「${it.title}」` : `${App.okLabel(it, true)} “${it.title}”`,   // t-btn-names
        (App.askLeft(it) ? App.askLeft(it) + " · " : "") + (zh ? "4.5 秒内可撤销" : "Undo within 4.5 s"), "approve 批准 开工 验收 关单 accept pz", () => App.rvApprove(it.id), "");
    }
    const nRev = App.items().filter(i => i.stage === "review").length, nDec = App.decisions().length;
    add("go:review", zh ? `回首页 · 等你拍板 ${nRev + nDec}` : `Home · waiting on you ${nRev + nDec}`, zh ? "首页" : "Home page", "home shouye 首页 sy review shenhe 审核 拍板 sh", () => fire("data-go", "review"));
    for (const p of ["quests", "main", "side", "daily", "urgent", "ongoing", "studio", "pipe", "board", "channels", "assets", "logs", "reports", "docs", "roles"]) {   /* t-nav-shoot: 制作 + its four sub pages */
      if (p === "quests" && !phone()) continue;
      add("go:" + p, (zh ? "跳到「" : "Go to “") + App.t(p) + (zh ? "」" : "”"), zh ? "页面" : "Page", p + " go 跳 页", () => fire("data-go", p));
    }
    add("mail", zh ? "打开信箱" : "Open mailbox", zh ? "动态" : "Activity", "mail inbox 信箱 动态 xx", () => phone() ? fire("data-go", "mail") : fire("data-h", "mail"));
    if (App.ghOpen) add("ghtok", zh ? "GitHub 推送令牌" : "GitHub push token", zh ? "配一次，以后推送不用再输" : "Set once for pushes", "github token git push 令牌 推送 gh", () => App.ghOpen());
    add("status", zh ? "系统状态" : "System status", zh ? "用量、管家心跳、服务器、5090…" : "Usage, heartbeat, server, 5090…", "status system usage 体力 用量 状态 health xt", () => App.modalStatus());
    for (const a of Object.values(App.ST.agents || {}).filter(a => a.enabled !== false).sort((x, y) => (x.order ?? 99) - (y.order ?? 99))) {
      add("dm:" + a.id, a.id === "manager" ? (zh ? `和${App.aname(a)}（管家）对话` : `Chat with ${App.aname(a)}`) : (zh ? `给${App.aname(a)}发私信` : `Message ${App.aname(a)}`),
        App.atitle(a), `dm 私信 chat 对话 ${a.id} ${App.aname(a)} ${a.name_en || ""} ${App.atitle(a)}`, () => fire("data-chat", a.id));
    }
    if (!phone() && App.setHome) {   // t-home-applike / t-home-widgets: one command per other style
      const cur = App.homeStyle(), L = { dense: zh ? "紧凑" : "dense", widgets: zh ? "小组件" : "widgets", app: zh ? "app 式" : "app-like", classic: zh ? "原来的" : "classic" };
      for (const v of ["dense", "widgets", "app", "classic"].filter(v => v !== cur))
        add("home:" + v, zh ? `首页样式：换成${L[v]}` : `Home style: ${L[v]}`, zh ? "只在这台电脑生效" : "This computer only",
          `home 首页 样式 ${v} ${L[v]} 小组件 widget app 经典 classic 原来 紧凑 dense jc sy`, () => { App.setHome(v); App.go ? App.go("review") : fire("data-go", "review"); });
    }
    add("lang", zh ? "Switch to English" : "切换到中文", zh ? "界面语言" : "Language", "lang language english 中文 语言", () => fire("data-lang-set", zh ? "en" : "zh"));   // t-settings-tab: the header EN button is gone
    {   // t-settings-tab: 设置 page + theme mode
      add("go:settings", zh ? "跳到「设置」" : "Go to “Settings”", zh ? "通用 / 角色 / 文档 / 日志 / 系统" : "General / roster / docs / log / system", "settings 设置 sz shezhi page 页 go 跳", () => fire("data-go", "settings"));
      const mode = App.themeMode ? App.themeMode() : "manual", th = document.documentElement.dataset.theme;
      for (const [v, z, e] of [["auto", "自动（跟随系统）", "Auto (follow system)"], ["dark", "夜", "Night"], ["white", "昼", "Day"]]) {
        if (v === "auto" ? mode === "auto" : mode === "manual" && th === v) continue;
        add("tmode:" + v, zh ? `主题：${z}` : `Theme: ${e}`, zh ? "只在这台设备生效" : "This device only", `theme 主题 zt ${v} ${z} ${e} auto 自动 night day dark white 夜 昼 深色 白`, () => fire("data-tmode", v));
      }
    }
    if (!q) return out.filter(a => a.id.startsWith("approve:") || a.id === "go:review" || a.id === "status");
    const words = q.split(/\s+/).filter(Boolean);
    return out.filter(a => words.every(w => a.kw.includes(w)));
  }

  // ---------- the shared search ----------
  // q: lower-case trimmed query. Items: title / id / summary / tags / owner (as the phone search always did).
  // t-ri1103-p5: drafts (current + every older version) and card talk (thread messages / logs, no system events) are searched too.
  // Lower-cased copies are built once per state object (a poll that changes anything swaps App.ST), so a key press only runs indexOf.
  // Phone polls slim: a done card's drafts are not in the state until it is opened, so the phone only searches drafts of open cards.
  // t-perf A: archived cards (App.archList(), loaded once on the first search) are searched too; "rt-arch" re-runs an open search when they land.
  const IX = { st: null, n: -1, drafts: [], talk: [], chats: null, ar: null };
  // real = cards the server sent; archived = the loaded archive, else the archived cards already opened (_arch copies in ST.items)
  const realItems = () => (App.ST.items || []).filter(i => !i._arch);
  const archExtra = () => { const L = App.archList && App.archList(); if (!L) return (App.ST.items || []).filter(i => i._arch); const live = new Set(realItems().map(i => i.id)); return L.filter(i => !live.has(i.id)); };
  function index() {
    const ST = App.ST, ar = App.archList ? App.archList() : null, its = realItems().concat(archExtra()), n = its.reduce((k, it) => k + (it.draft ? 1 : 0) + (it.versions || []).length + (it.thread || []).length, 0);
    if (IX.st === ST && IX.n === n && IX.ar === ar) return IX;
    const ms = x => Date.parse(x) || 0, drafts = [], talk = [];
    for (const it of its) {
      (it.versions || []).forEach((v, i) => v.draft && drafts.push({ it, vkey: "v" + i, vn: i + 1, label: v.label, text: v.draft, lc: v.draft.toLowerCase(), t: v.t, who: it.owner }));
      if (it.draft) drafts.push({ it, vkey: "cur", vn: (it.versions || []).length + 1, label: it.draft_label, text: it.draft, lc: it.draft.toLowerCase(), t: it.draft_at || it.updated, who: it.owner, cur: true });
      (it.thread || []).forEach((m, i) => { if (m.kind !== "event" && m.text) talk.push({ it, ti: i, m, text: String(m.text), lc: String(m.text).toLowerCase(), t: m.t }); });
    }
    drafts.sort((a, b) => ms(b.t) - ms(a.t)); talk.sort((a, b) => ms(b.t) - ms(a.t));
    Object.assign(IX, { st: ST, n, drafts, talk, chats: null, ar });
    return IX;
  }
  function chatIx() {   // every chat message, newest first (built lazily, same lifetime as the index)
    if (IX.chats) return IX.chats;
    const out = [];
    for (const a of Object.values(App.ST.agents || {}).filter(a => a.enabled !== false)) convMsgs(a.id).forEach(m => m && m.text && out.push({ a, m, lc: String(m.text).toLowerCase(), t: m.t }));
    return (IX.chats = out.sort((x, y) => (Date.parse(y.t) || 0) - (Date.parse(x.t) || 0)));
  }
  // every hit, newest first, capped; perDoc limits how many hits one long draft can add
  function hitsIn(list, q, cap, perDoc) {
    const out = []; let total = 0;
    for (const d of list) {
      let i = d.lc.indexOf(q), k = 0, kept = 0, last = -1e9;
      while (i >= 0) { total++; if (out.length < cap && kept < perDoc && i - last > 90) { out.push({ d, at: i, nth: k }); kept++; last = i; } k++; i = d.lc.indexOf(q, i + q.length); }   // hits closer than 90 chars share one snippet
    }
    return { list: out, total };
  }
  function find(q, opt = {}) {
    const hit = it => [it.title, it.summary, it.id, (it.tags || []).join(" "), App.aname(App.agent(it.owner))].join(" ").toLowerCase().includes(q);
    let items = App.items().slice().sort(App.byAct).filter(it => !q || hit(it)).slice(0, q ? (opt.items || 30) : (opt.recent || 8));
    if (q && App.archIx) {   // t-perf A: archived cards after the live ones (full cards once loaded, else the id / title index)
      if (App.archAll) App.archAll();
      if (App.histAll) App.histAll();   /* ri1105-P4: chat before the poll window, loaded once on the first search ("rt-hist" re-runs it) */
      const lim = opt.items || 30, seen = new Set(items.map(i => i.id));
      const arch = App.archList() ? archExtra() : App.archIx().map(([id, title, owner, d]) => ({ id, title, owner, stage: "done", kind: "task", archived: true, updated: d }));
      if (items.length < lim) items = items.concat(arch.filter(it => !seen.has(it.id) && hit(it)).sort((a, b) => String(b.updated || "").localeCompare(String(a.updated || ""))).slice(0, lim - items.length));
    }
    const cap = opt.cap || 30;
    let convs = [], drafts = { list: [], total: 0 }, talk = { list: [], total: 0 }, chatN = 0;
    if (q) {
      const X = index();
      drafts = hitsIn(X.drafts, q, cap, 3); talk = hitsIn(X.talk, q, cap, 1);
      // t-ri1103-p5: chats list every hit (was one per person); a name match with no hit keeps the old one-line row
      const ch = chatIx().filter(x => x.lc.includes(q)); chatN = ch.length;
      const named = Object.values(App.ST.agents || {}).filter(a => a.enabled !== false && (App.aname(a) + " " + App.atitle(a)).toLowerCase().includes(q) && !ch.some(x => x.a.id === a.id))
        .map(a => ({ a, m: convMsgs(a.id).slice(-1)[0], hit: false }));
      convs = named.concat(ch.slice(0, cap).map(x => ({ a: x.a, m: x.m, hit: true }))).slice(0, opt.convs || cap);
    }
    return { items, convs, drafts: drafts.list, talk: talk.list, n: { drafts: drafts.total, talk: talk.total, convs: chatN }, actions: actions(q, q ? items[0] : null) };
  }

  // ---------- desktop palette ----------
  const P = { el: null, q: "", sel: 0, rows: [], last: null, tab: "all", deb: 0 };
  const TABS = ["all", "drafts", "talk", "convs"];
  const tabName = k => en() ? { all: "All", drafts: "Drafts", talk: "Card talk", convs: "Chats" }[k] : { all: "全部", drafts: "草稿", talk: "卡片讨论", convs: "对话" }[k];
  const whoN = w => w === "me" ? (en() ? "You" : "你") : App.aname(App.agent(w));
  // the shared row texts for a draft / talk hit (mobile.js uses them too)
  function hitText(h, q, kind) {
    const zh = !en(), d = h.d, it = d.it;
    if (kind === "drafts") return { who: d.who, snip: hlAll(aroundAt(d.text, h.at, q), q),
      sub: `${esc(zh ? `草稿 v${d.vn}${d.cur ? "" : "（旧版）"}` : `Draft v${d.vn}${d.cur ? "" : " (old)"}`)} · ${esc(it.title)} · ${esc(whoN(d.who))} · ${App.when(d.t)}` };
    const m = d.m;
    return { who: m.who === "me" ? "me" : m.who, snip: hlAll(aroundAt(d.text, h.at, q), q),
      sub: `${esc(it.title)} · ${esc(whoN(m.who))}${m.to ? " → " + esc(whoN(m.to)) : ""} · ${App.when(m.t)}` };
  }
  const seekOf = (h, kind, q) => () => App.seekItem ? App.seekItem(h.d.it.id, kind === "drafts" ? { vkey: h.d.vkey, q, nth: h.nth } : { ti: h.d.ti, q, nth: h.nth }) : App.openItem(h.d.it.id);
  const avOf = w => w === "me" ? App.av("me", "sm") : App.av(App.agent(w), "sm");
  const kindTag = it => {
    const k = it.kind === "task" ? "deliverable" : it.kind;
    return it.stage === "review" ? `<i class="tag ${k}">${App.t(k)}</i>` : App.awaitsUser(it) ? `<i class="tag ${k}">${en() ? "waiting on you" : "等你拍板"}</i>` : `<i class="pl-st">${esc(App.stageLabel(it.stage))}</i>`;
  };
  function build() {
    const el = document.createElement("div"); el.id = "pal"; el.hidden = true;
    el.innerHTML = `<div class="pl-box" role="dialog" aria-modal="true"><label class="pl-in"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16 L20.5 20.5"/></svg>
      <input type="text" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="pl-res"><kbd>esc</kbd></label><div class="pl-tabs" hidden></div>
      <div class="pl-res" id="pl-res" role="listbox"></div><div class="pl-ft"></div></div>`;
    document.body.appendChild(el);
    const inp = $("input", el);
    inp.addEventListener("input", () => {   // input never re-rendered (IME-safe); t-ri1103-p5: 150 ms debounce (drafts are ~0.8 MB of text)
      clearTimeout(P.deb); const v = inp.value.trim().toLowerCase();
      const go = () => { P.q = v; P.sel = 0; if (!v) P.tab = "all"; render(); };
      if (!v) go(); else P.deb = setTimeout(go, 150);
    });
    el.addEventListener("click", e => { const t = e.target.closest("[data-pl-tab]"); if (t) { P.tab = t.dataset.plTab; P.sel = 0; render(); inp.focus(); } });
    inp.addEventListener("keydown", e => {
      if (e.isComposing) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); move(e.key === "ArrowDown" ? 1 : -1); }
      else if (e.key === "Enter") { e.preventDefault(); if (P.deb && inp.value.trim().toLowerCase() !== P.q) { clearTimeout(P.deb); P.q = inp.value.trim().toLowerCase(); render(); } run(P.sel); }
      else if (e.key === "Tab" && P.q) { e.preventDefault(); P.tab = TABS[(TABS.indexOf(P.tab) + (e.shiftKey ? 3 : 1)) % 4]; P.sel = 0; render(); }   // t-ri1103-p5: Tab walks the categories
    });
    el.addEventListener("mousedown", e => { if (e.target === el) { e.preventDefault(); close(); } });
    el.addEventListener("mousemove", e => { const r = e.target.closest("[data-pl]"); if (r && +r.dataset.pl !== P.sel) { P.sel = +r.dataset.pl; mark(); } });
    el.addEventListener("click", e => { const r = e.target.closest("[data-pl]"); if (r) run(+r.dataset.pl); });
    return el;
  }
  function move(d) { if (!P.rows.length) return; P.sel = (P.sel + d + P.rows.length) % P.rows.length; mark(true); }
  function mark(scroll) {
    P.el.querySelectorAll("[data-pl]").forEach(r => { const on = +r.dataset.pl === P.sel; r.classList.toggle("on", on); r.setAttribute("aria-selected", on); if (on && scroll) r.scrollIntoView({ block: "nearest" }); });
  }
  document.addEventListener("rt-arch", () => { if (P.el && !P.el.hidden && P.q) render(); });   // t-perf A
  document.addEventListener("rt-hist", () => { IX.chats = null; if (P.el && !P.el.hidden && P.q) render(); });   /* ri1105-P4 */
  function render() {
    const zh = !en(), R = find(P.q, { items: 8, recent: 6 }), q = P.q, tab = q ? P.tab : "all", all = tab === "all";
    P.rows = []; let html = "";
    const tabsEl = $(".pl-tabs", P.el);
    if (tabsEl) { const cnt = k => k === "all" ? "" : ` <i>${R.n[k] > 30 ? "30+" : R.n[k]}</i>`; const th = q ? TABS.map(k => `<button type="button" class="${k === tab ? "on" : ""}" data-pl-tab="${k}">${tabName(k)}${cnt(k)}</button>`).join("") + `<span class="pl-tk"><kbd>tab</kbd></span>` : ""; if (tabsEl._h !== th) { tabsEl.innerHTML = tabsEl._h = th; } tabsEl.hidden = !q; }
    const row = (ic, title, sub, run, hint) => { const i = P.rows.push(run) - 1; return `<div class="pl-row" data-pl="${i}" role="option">${ic}<span class="pl-m"><b>${title}</b>${sub ? `<span>${sub}</span>` : ""}</span>${hint ? `<em>${hint}</em>` : ""}</div>`; };
    const iCap = q && (R.drafts.length || R.talk.length) ? 4 : 8;   // t-ri1103-p5: leave room for the sentence hits
    if (all && R.items.length) html += `<div class="pl-h">${P.q ? (zh ? "单子" : "Items") : (zh ? "最近" : "Recent")}</div>` + R.items.slice(0, iCap).map(it =>
      row(`<span class="pl-av">${App.av(App.agent(it.owner), "sm")}</span>`, esc(it.title), `${kindTag(it)} ${esc(App.aname(App.agent(it.owner)))} · ${App.t(it.category)} · ${App.when(it.activity)}`, () => App.openItem(it.id), zh ? "↵ 打开" : "↵ open")).join("");
    const more = (k, n) => all && n > shown[k] ? `<button type="button" class="pl-more" data-pl-tab="${k}">${zh ? `全部 ${n > 30 ? "30+" : n} 条 →` : `All ${n > 30 ? "30+" : n} →`}</button>` : "";
    const shown = { drafts: all ? 4 : 30, talk: all ? 4 : 30, convs: all ? 4 : 30 };
    for (const k of ["drafts", "talk"]) {
      if ((all || tab === k) && R[k].length) html += `<div class="pl-h">${tabName(k)}${more(k, R.n[k])}</div>` + R[k].slice(0, shown[k]).map(h => { const x = hitText(h, q, k);
        return row(`<span class="pl-av">${avOf(x.who)}</span>`, `「${x.snip}」`, x.sub, seekOf(h, k, q), zh ? "↵ 跳到原句" : "↵ jump"); }).join("");
    }
    if ((all || tab === "convs") && R.convs.length) html += `<div class="pl-h">${zh ? "对话里提到" : "In chats"}${more("convs", R.n.convs)}</div>` + R.convs.slice(0, shown.convs).map(x =>
      row(`<span class="pl-av">${App.av(x.a, "sm")}</span>`, x.hit ? `「${hlAll(around(x.m.text, P.q), P.q)}」` : esc(App.aname(x.a)),
        `${x.m ? (x.m.who === "me" ? (zh ? "你" : "You") : esc(App.aname(App.agent(x.m.who) || x.a))) + " → " + esc(x.m.who === "me" ? App.aname(x.a) : (zh ? "你" : "you")) + " · " + App.when(x.m.t) : esc(App.atitle(x.a))}`,
        () => { fire("data-chat", x.a.id); if (x.hit && App.seekChat) App.seekChat(x.m.t, q); })).join("");
    if (all && R.actions.length) html += `<div class="pl-h">${zh ? "操作" : "Actions"}</div>` + R.actions.slice(0, P.q ? 12 : 4).map(a =>
      row(`<span class="pl-ic">${a.id.startsWith("approve:") ? "✓" : a.id.startsWith("dm:") ? "@" : a.id.startsWith("theme:") ? "◐" : a.id.startsWith("go:") || a.id === "mail" ? "→" : a.id === "status" ? "♥" : "·"}</span>`, esc(a.label), esc(a.sub), a.run)).join("");
    if (!P.rows.length && !all) html = `<div class="pl-none">${zh ? `「${esc(tabName(tab))}」里没有找到。按 Tab 换一类。` : "Nothing here. Press Tab for another category."}</div>`;
    if (!P.rows.length && all) html = `<div class="pl-none">${zh ? "没有找到。换个词试试，或者输入角色名、页面名。" : "Nothing found. Try a name or a page."}</div>`;
    const box = $(".pl-res", P.el); if (box._h !== html) { box.innerHTML = box._h = html; }
    $(".pl-ft", P.el).innerHTML = `<span><kbd>↑</kbd><kbd>↓</kbd> ${zh ? "选择" : "move"}</span><span><kbd>↵</kbd> ${zh ? "打开 / 执行" : "open / run"}</span><span><kbd>⌘K</kbd> ${zh ? "随时呼出" : "anywhere"}</span><span class="r">${zh ? "手机：首页右上角的搜索" : "Phone: search on home"}</span>`;
    P.sel = Math.min(P.sel, Math.max(0, P.rows.length - 1)); mark();
  }
  function run(i) { const f = P.rows[i]; if (!f) return; close(true); f(); }
  function open() {
    if (!window.App || !App.ST) return;
    if (phone()) { if (App.openSearch) App.openSearch(); return; }
    P.el = P.el || build();
    P.last = document.activeElement;
    P.el.hidden = false; document.body.classList.add("pal-on");
    const inp = $("input", P.el); inp.placeholder = en() ? "Search items, drafts, card talk, chats, or type an action…" : "搜单子、草稿、卡片讨论、对话，或者输入要做的事…";
    clearTimeout(P.deb); inp.value = ""; P.q = ""; P.sel = 0; P.tab = "all"; render(); inp.focus();
  }
  function close(ran) {
    if (!P.el || P.el.hidden) return;
    P.el.hidden = true; document.body.classList.remove("pal-on");
    if (!ran && P.last && P.last.focus && document.contains(P.last)) P.last.focus();
  }
  const isOpen = () => !!(P.el && !P.el.hidden);
  // capture phase: runs before app.js's global keydown (Esc closes the open item there) and the textarea ⌘Enter handlers
  window.addEventListener("keydown", e => {
    if (e.isComposing) return;
    const k = (e.key || "").toLowerCase();
    if (k === "k" && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); isOpen() ? close() : open(); return; }
    if (isOpen()) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } return; }
    if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const t = e.target, typing = t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName));
      if (typing || !$("#modal").hidden || phone()) return;
      e.preventDefault(); open();
    }
  }, true);
  // re-render on state polls while open (new items, counts)
  const hook = () => { if (isOpen()) render(); };
  (function wait() { if (window.App && App.on) App.on(k => { if (k === "all") hook(); }); else setTimeout(wait, 100); })();

  window.Pal = { find, actions, open, close, isOpen, around, hitText, seekOf, hlAll, tabName };
})();
