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
  const convMsgs = id => id === "manager" ? (App.ST.chat || []) : ((App.ST.dms || {})[id] || []);
  const clean = s => String(s || "").replace(/```[\s\S]*?```/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`>#]+/g, "").replace(/\s+/g, " ").trim();
  // a window of text around the hit, so you see why it matched
  function around(text, q) {
    const s = clean(text), i = s.toLowerCase().indexOf(q);
    if (i < 0 || s.length <= 60) return s.slice(0, 80);
    const a = Math.max(0, i - 22);
    return (a ? "…" : "") + s.slice(a, a + 70) + (a + 70 < s.length ? "…" : "");
  }
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
    for (const p of ["quests", "main", "side", "daily", "urgent", "ongoing", "board", "logs", "reports", "channels", "docs", "roles"]) {
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
      const cur = App.homeStyle(), L = { widgets: zh ? "小组件" : "widgets", app: zh ? "app 式" : "app-like", classic: zh ? "原来的" : "classic" };
      for (const v of ["widgets", "app", "classic"].filter(v => v !== cur))
        add("home:" + v, zh ? `首页样式：换成${L[v]}` : `Home style: ${L[v]}`, zh ? "只在这台电脑生效" : "This computer only",
          `home 首页 样式 ${v} ${L[v]} 小组件 widget app 经典 classic 原来 sy`, () => { App.setHome(v); App.go ? App.go("review") : fire("data-go", "review"); });
    }
    add("lang", zh ? "Switch to English" : "切换到中文", zh ? "界面语言" : "Language", "lang language english 中文 语言", () => fire("data-h", "lang"));
    if (!q) return out.filter(a => a.id.startsWith("approve:") || a.id === "go:review" || a.id === "status");
    const words = q.split(/\s+/).filter(Boolean);
    return out.filter(a => words.every(w => a.kw.includes(w)));
  }

  // ---------- the shared search ----------
  // q: lower-case trimmed query. Items: title / id / summary / tags / owner (as the phone search always did).
  function find(q, opt = {}) {
    const items = App.items().slice().sort(App.byAct)
      .filter(it => !q || [it.title, it.summary, it.id, (it.tags || []).join(" "), App.aname(App.agent(it.owner))].join(" ").toLowerCase().includes(q))
      .slice(0, q ? (opt.items || 30) : (opt.recent || 8));
    const convs = !q ? [] : Object.values(App.ST.agents || {}).filter(a => a.enabled !== false).map(a => {
      const hit = convMsgs(a.id).slice().reverse().find(m => String(m.text || "").toLowerCase().includes(q));
      const named = (App.aname(a) + " " + App.atitle(a)).toLowerCase().includes(q);
      return named || hit ? { a, m: hit || convMsgs(a.id).slice(-1)[0], hit: !!hit } : null;
    }).filter(Boolean).slice(0, opt.convs || 12);
    return { items, convs, actions: actions(q, q ? items[0] : null) };
  }

  // ---------- desktop palette ----------
  const P = { el: null, q: "", sel: 0, rows: [], last: null };
  const kindTag = it => {
    const k = it.kind === "task" ? "deliverable" : it.kind;
    return it.stage === "review" ? `<i class="tag ${k}">${App.t(k)}</i>` : App.awaitsUser(it) ? `<i class="tag ${k}">${en() ? "waiting on you" : "等你拍板"}</i>` : `<i class="pl-st">${esc(App.stageLabel(it.stage))}</i>`;
  };
  function build() {
    const el = document.createElement("div"); el.id = "pal"; el.hidden = true;
    el.innerHTML = `<div class="pl-box" role="dialog" aria-modal="true"><label class="pl-in"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16 L20.5 20.5"/></svg>
      <input type="text" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="pl-res"><kbd>esc</kbd></label>
      <div class="pl-res" id="pl-res" role="listbox"></div><div class="pl-ft"></div></div>`;
    document.body.appendChild(el);
    const inp = $("input", el);
    inp.addEventListener("input", () => { P.q = inp.value.trim().toLowerCase(); P.sel = 0; render(); });   // input never re-rendered (IME-safe)
    inp.addEventListener("keydown", e => {
      if (e.isComposing) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); move(e.key === "ArrowDown" ? 1 : -1); }
      else if (e.key === "Enter") { e.preventDefault(); run(P.sel); }
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
  function render() {
    const zh = !en(), R = find(P.q, { items: 8, recent: 6, convs: 5 });
    P.rows = []; let html = "";
    const row = (ic, title, sub, run, hint) => { const i = P.rows.push(run) - 1; return `<div class="pl-row" data-pl="${i}" role="option">${ic}<span class="pl-m"><b>${title}</b>${sub ? `<span>${sub}</span>` : ""}</span>${hint ? `<em>${hint}</em>` : ""}</div>`; };
    if (R.items.length) html += `<div class="pl-h">${P.q ? (zh ? "单子" : "Items") : (zh ? "最近" : "Recent")}</div>` + R.items.map(it =>
      row(`<span class="pl-av">${App.av(App.agent(it.owner), "sm")}</span>`, esc(it.title), `${kindTag(it)} ${esc(App.aname(App.agent(it.owner)))} · ${App.t(it.category)} · ${App.when(it.activity)}`, () => App.openItem(it.id), zh ? "↵ 打开" : "↵ open")).join("");
    if (R.convs.length) html += `<div class="pl-h">${zh ? "对话里提到" : "In chats"}</div>` + R.convs.map(x =>
      row(`<span class="pl-av">${App.av(x.a, "sm")}</span>`, x.hit ? `「${hl(around(x.m.text, P.q), P.q)}」` : esc(App.aname(x.a)),
        `${x.m ? (x.m.who === "me" ? (zh ? "你" : "You") : esc(App.aname(App.agent(x.m.who) || x.a))) + " → " + esc(x.m.who === "me" ? App.aname(x.a) : (zh ? "你" : "you")) + " · " + App.when(x.m.t) : esc(App.atitle(x.a))}`,
        () => fire("data-chat", x.a.id))).join("");
    if (R.actions.length) html += `<div class="pl-h">${zh ? "操作" : "Actions"}</div>` + R.actions.slice(0, P.q ? 12 : 4).map(a =>
      row(`<span class="pl-ic">${a.id.startsWith("approve:") ? "✓" : a.id.startsWith("dm:") ? "@" : a.id.startsWith("theme:") ? "◐" : a.id.startsWith("go:") || a.id === "mail" ? "→" : a.id === "status" ? "♥" : "·"}</span>`, esc(a.label), esc(a.sub), a.run)).join("");
    if (!P.rows.length) html = `<div class="pl-none">${zh ? "没有找到。换个词试试，或者输入角色名、页面名。" : "Nothing found. Try a name or a page."}</div>`;
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
    const inp = $("input", P.el); inp.placeholder = en() ? "Search items, chats, or type an action…" : "搜单子、对话，或者输入要做的事…";
    inp.value = ""; P.q = ""; P.sel = 0; render(); inp.focus();
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

  window.Pal = { find, actions, open, close, isOpen, around };
})();
