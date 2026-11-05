// t-home-widgets (plan v2, 方案 A, approved 11-02): the desktop 首页 as macOS-style widgets in a 4-column grid next to the chat.
// app.js calls Widgets.html(body) from PAGES.review while html[data-home="widgets"] (desktop only; phone home unchanged).
// Widgets: 等你拍板 · 此刻在忙 · 新回复 · 今天交付 · 本周进度 · 常驻活动 · 最近素材. 团队 / 体力 / 日程 were dropped on purpose
// (the TEAM list, the stamina orb and 今日日程 already show them). An empty widget leaves the grid and becomes one quiet line
// above it. Layout (order, size, hidden) is per browser in localStorage rt.widgets; 编辑小组件 = remove / size / move / add back.
(() => {
  const A = () => window.App;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ms = x => Date.parse(x) || 0;
  const hm = t => { const d = new Date(t); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  const en = () => A().UI.lang === "en";
  const ago = t => { const m = Math.max(1, Math.round((Date.now() - ms(t)) / 6e4)); if (en()) return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`; return m < 60 ? `${m} 分钟` : m < 1440 ? `${Math.round(m / 60)} 小时` : `${Math.round(m / 1440)} 天`; };
  const ART = new Set();   // open-source build: no character art ships with the repo; 此刻在忙 uses the avatar (add ids here once web/art/<id>.jpg exists)
  const art = a => ART.has(a.id) ? `/static/art/${a.id}.jpg` : A().avatarUrl(a);
  const fileUrl = p => "/" + String(p).split("/").map(encodeURIComponent).join("/");
  const WD = "日一二三四五六";

  // ---------- layout ----------
  const SIZES = { usage: ["m", "l"], review: ["m", "l"], busy: ["m", "l"], replies: ["m", "l"], today: ["s", "m", "l"], week: ["s", "m"], ongoing: ["s", "m"], media: ["s", "m"] };
  const NAME = { usage: ["各角色用量", "Usage by role"], review: ["等你拍板", "Waiting on you"], busy: ["此刻在忙", "Working now"], replies: ["新回复", "New replies"], today: ["今天交付", "Shipped today"],
    week: ["本周进度", "This week"], ongoing: ["常驻活动", "Routines"], media: ["最近素材", "Recent media"] };
  const DEF = [["usage", "l"], ["review", "l"], ["busy", "l"], ["replies", "l"], ["today", "m"], ["week", "m"], ["ongoing", "m"], ["media", "m"]];
  const KEY = "rt.widgets";
  const load = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || "null"); if (Array.isArray(v) && v.every(x => SIZES[x[0]])) {
      // t-home-usage: a layout saved before the usage widget existed gets it once, first (removing it later sticks)
      if (!v.some(x => x[0] === "usage") && !localStorage.getItem("rt.wgUsage")) { v.unshift(["usage", "l"]); localStorage.setItem("rt.wgUsage", "1"); localStorage.setItem(KEY, JSON.stringify(v)); }
      return v; } } catch { } return DEF.map(x => x.slice()); };
  const save = L => { try { localStorage.setItem(KEY, JSON.stringify(L)); } catch { } };
  const nm = k => NAME[k][en() ? 1 : 0];
  let EDIT = false;

  // ---------- data ----------
  function data() {
    const app = A(), its = app.items(), ST = app.ST;
    const agents = Object.values(ST.agents || {}).filter(a => a.enabled !== false);
    const waiting = its.filter(i => app.onYouCard(i) || (app.onYou(i) && app.awaitsUser(i))).sort((a, b) => ms(a.activity || a.updated) - ms(b.activity || b.updated));   // oldest waiting first
    const busy = agents.map(a => ({ a, it: app.liveItem(a), since: a.since || a.last_seen })).filter(x => x.a.status === "working" && x.it)
      .sort((x, y) => ms(y.since) - ms(x.since));   // newest start takes the big slot
    const nr = app.newReplies(), today = new Date().toDateString();
    const shipped = its.filter(i => i.stage === "done" && i.closed && new Date(i.closed).toDateString() === today).sort((a, b) => ms(b.closed) - ms(a.closed));
    const days = [...Array(7)].map((_, k) => { const d = new Date(Date.now() - (6 - k) * 864e5); return { d, n: its.filter(i => i.stage === "done" && i.closed && new Date(i.closed).toDateString() === d.toDateString()).length }; });
    const live = its.filter(i => i.stage !== "done"), rp = (ST.meta && ST.meta.routines_paused) || {};
    const ongoing = its.filter(i => i.category === "ongoing" && i.stage !== "done").sort((a, b) => ms(b.activity) - ms(a.activity));
    const imgs = []; its.slice().sort((a, b) => ms(b.activity) - ms(a.activity)).forEach(i => [...(i.draft_attachments || []), ...(i.attachments || [])].forEach(p => { if (/\.(png|jpe?g|webp|gif)$/i.test(p) && !imgs.some(x => x.p === p) && imgs.length < 6) imgs.push({ p, it: i }); }));
    return { waiting, busy, nr, shipped, days, doing: live.filter(i => app.grpOf(i) === "doing").length, todo: live.filter(i => app.grpOf(i) === "todo").length, ongoing, rp, imgs };
  }
  const isEmpty = (k, D) => ({ usage: false, review: !D.waiting.length, busy: !D.busy.length, replies: !D.nr.length, today: !D.shipped.length, ongoing: !D.ongoing.length, media: !D.imgs.length, week: false })[k];
  const calmText = k => ({ review: ["没有等你拍板的", "Nothing waiting on you"], busy: ["大家都在待机", "Everyone is idle"], replies: ["没有新回复", "No new replies"], today: ["今天还没有交付", "Nothing shipped today"],
    ongoing: ["没有常驻活动", "No routines"], media: ["还没有素材", "No media yet"] })[k][en() ? 1 : 0];

  // ---------- widgets ----------
  const eb = (k, n, dot) => `<div class="wg-eb">${dot ? '<span class="wg-dot"></span>' : ""}<b>${nm(k)}</b>${n != null ? `<span class="n">${n}</span>` : ""}</div>`;
  const kindL = i => i.kind === "plan" ? (en() ? "Plan" : "方案") : i.kind === "question" || (A().openAsks(i).length && i.stage !== "review") ? (en() ? "Question" : "问题") : (en() ? "Review" : "待验收");
  const rowsFit = (s, big, small) => s === "l" ? big : small;
  // t-home-motion: a medium widget holds two rows and nothing else. Two or fewer: both rows, no footer (each row already says how long);
  // more: one row + 「还有 N 件 ›」 (the footer used to be clipped by ~21px under two rows)
  const fitM = (s, len, big) => s === "l" ? { n: big, foot: true } : len <= 2 ? { n: 2, foot: false } : { n: 1, foot: true };
  const W = {
    usage(s) {   // t-home-usage: tokens per role today + the quota strip; markup shared with the phone card / 系统状态 (App.ruHTML)
      return `<div class="wg-eb" data-ru-open><b>${nm("usage")}</b><span>${en() ? "today" : "今天"}</span><span class="n">token</span></div>` + A().ruHTML(s === "l" ? 7 : 3, { tot: s === "l", quota: true, more: true });
    },
    review(s, D) {
      const L = D.waiting, { n, foot } = fitM(s, L.length, 5);
      return eb("review", L.length, true) + L.slice(0, n).map(i => { const a = A().agent(i.owner);
        return `<div class="wg-row" data-item="${esc(i.id)}"><img class="wg-av" src="${A().avatarUrl(a)}" alt=""><div class="t">${esc(i.title)}<small>${esc(A().aname(a))} · ${en() ? "waiting" : "等了"} ${ago(i.activity || i.updated)}</small></div>${i.snoozed ? `<span class="wg-tg snz">${en() ? "Snoozed" : "推迟过"}</span>` : ""}<span class="wg-tg${i.kind === "plan" ? "" : " hot"}">${kindL(i)}</span></div>`; }).join("") +
        (!foot ? "" : `<div class="wg-more">${L.length > n ? `<span data-go="board">${en() ? `${L.length - n} more ›` : `还有 ${L.length - n} 件 ›`}</span>` : `${en() ? "Oldest waiting" : "最久的已经等了"} ${ago(L[0].activity || L[0].updated)}`}</div>`);
    },
    busy(s, D) {
      const B = D.busy, m = B[0], a = m.a, side = B.slice(1, s === "l" ? 3 : 1), more = B.length - 1 - side.length, multi = B.length > 1;
      const bar = x => Math.min(100, Math.round((Date.now() - ms(x.since)) / 6e4 / 120 * 100));   // elapsed, on a 2-hour scale
      return `<div class="wg-bg" style="background-image:url('${art(a)}')"></div><div class="wg-sh"></div>
        <div class="wg-top">${eb("busy", `${B.length} ${en() ? "" : "人"}`.trim())}</div>
        <div class="wg-in"><h3 data-chat="${esc(a.id)}">${esc(A().aname(a))}<small>${esc(A().atitle(a) || "")}</small>${A().qBadge ? A().qBadge(a.id) : ""}</h3>
        <div class="wg-job" data-item="${esc(m.it.id)}" style="--wg-fd:-${Date.now() % 2400}ms"><span>${esc(m.it.title)}</span><b>${hm(m.since)} ${en() ? "start" : "起"} · ${ago(m.since)} ›</b></div>
        ${side.length || more > 0 ? `<div class="wg-side">${side.map(x => `<div class="wg-sr" data-item="${esc(x.it.id)}"><img src="${A().avatarUrl(x.a)}" alt="" data-chat="${esc(x.a.id)}"><div class="st"><b>${esc(A().aname(x.a))}${A().qBadge ? A().qBadge(x.a.id) : ""}</b><span>${esc(x.it.title)}</span><i><em style="width:${bar(x)}%"></em></i></div><time>${ago(x.since)}</time></div>`).join("")}${more > 0 ? `<div class="wg-sr plus" data-go="board">${en() ? `+${more} more working ›` : `+${more} 人在忙 · 看全部 ›`}</div>` : ""}</div>` : ""}</div>`;
    },
    replies(s, D) {
      const { n } = fitM(s, D.nr.length, 4), N = D.nr.reduce((t, g) => t + g.ms.length, 0);
      return eb("replies", N) + D.nr.slice(0, n).map(g => { const m = g.ms[g.ms.length - 1], a = A().agent(m.agent);
        return `<div class="wg-row" data-item="${esc(g.it.id)}"><img class="wg-av" src="${A().avatarUrl(a)}" alt=""><div class="t">${esc(g.it.title)}<small>${esc(String(m.text || "").replace(/^[^:：\n]{1,8}[:：]\s*/, "").split(/\n/)[0])}</small></div><time>${ago(m.t)}</time></div>`; }).join("") +
        (D.nr.length > n ? `<div class="wg-more"><span data-go="mail">${en() ? `${D.nr.length - n} more cards ›` : `还有 ${D.nr.length - n} 张卡 · 去信箱 ›`}</span></div>` : "");
    },
    today(s, D) {
      const L = D.shipped;
      if (s === "s") return eb("today") + `<div class="wg-big">${L.length}</div><div class="wg-sub">${en() ? "latest" : "最近"} ${hm(L[0].closed)}</div><div class="wg-more clamp2" data-item="${esc(L[0].id)}">${esc(L[0].title)}</div>`;
      const n = rowsFit(s, 6, 2);
      return eb("today", L.length) + L.slice(0, n).map(i => `<div class="wg-row" data-item="${esc(i.id)}"><span class="wg-ck">✓</span><div class="t">${esc(i.title)}</div><time>${hm(i.closed)}</time></div>`).join("") +
        (L.length > n ? `<div class="wg-more">${en() ? `${L.length - n} more` : `还有 ${L.length - n} 件`}</div>` : "");
    },
    week(s, D) {
      const max = Math.max(1, ...D.days.map(x => x.n)), wk = D.days.reduce((t, x) => t + x.n, 0);
      const bars = `<div class="wg-bars">${D.days.map((x, k) => `<span class="${k === 6 ? "on" : ""}" style="height:${Math.max(4, Math.round(x.n / max * 100))}%" title="${x.n}"></span>`).join("")}</div><div class="wg-bl">${D.days.map(x => `<i>${en() ? "SMTWTFS"[x.d.getDay()] : WD[x.d.getDay()]}</i>`).join("")}</div>`;
      if (s === "s") return eb("week", wk) + `<div class="wg-fill" data-go="board">${bars}</div>`;
      return eb("week") + `<div class="wg-wk" data-go="board"><div><div class="wg-big">${wk}</div><div class="wg-sub">${en() ? `7-day shipped · doing ${D.doing} · to do ${D.todo}` : `7 天交付 · 进行中 ${D.doing} · 待办 ${D.todo}`}</div></div><div class="wg-col">${bars}</div></div>`;
    },
    ongoing(s, D) {
      const meta = A().ST.meta || {}, RK = new Set([...Object.keys(meta.routines_fired || {}), ...Object.keys(D.rp)]);
      const isR = i => RK.has(i.id.replace(/^r-/, "")), paused = i => !!D.rp[i.id.replace(/^r-/, "")];
      return eb("ongoing", D.ongoing.length) + D.ongoing.slice(0, s === "s" ? 2 : 3).map(i => `<div class="wg-row tight" data-item="${esc(i.id)}"><div class="t">${esc(i.title)}</div>${isR(i) ? `<span class="wg-tg">${paused(i) ? (en() ? "Paused" : "暂停") : (en() ? "Daily" : "每天")}</span>` : ""}</div>`).join("");
    },
    media(s, D) {
      const n = s === "s" ? 4 : 3;
      return eb("media", D.imgs.length) + `<div class="wg-thumbs" style="--tc:${s === "s" ? 2 : 3}">${D.imgs.slice(0, n).map(x => { const u = fileUrl(x.p), name = esc(x.p.split("/").pop());
        return `<a href="${u}" target="_blank" class="lb-th" data-lb="${u}" data-kind="image" data-name="${name}" style="background-image:url('/api/thumb?p=${encodeURIComponent(x.p)}&w=360')"></a>`; }).join("")}</div>`;
    },
  };
  const sizeBtns = (k, s) => `<span class="wg-sz">${SIZES[k].map(z => `<button type="button" data-wg-size="${k}:${z}" class="${z === s ? "on" : ""}">${z.toUpperCase()}</button>`).join("")}</span>`;
  const editBar = (k, s, i, n) => `<span class="wg-x" data-wg-hide="${k}" title="${en() ? "Remove" : "移除"}">−</span>${sizeBtns(k, s)}<span class="wg-mv">${i > 0 ? `<button type="button" data-wg-move="${k}:-1">←</button>` : ""}${i < n - 1 ? `<button type="button" data-wg-move="${k}:1">→</button>` : ""}</span>`;

  // t-home-flicker (11-03): the HTML carries wall-clock phases (--wg-fd) so a rebuilt node does not restart the sweep; they are not data,
  // so every compare strips them. Same data: keep the DOM. Changed data (C): replace only the tiles / header / tail / tray whose HTML changed,
  // the rest keep their nodes (thumbs, hover highlight, running animations). mvPage is told via MV.dirty so new rows / moved tiles still animate.
  const norm = h => h.replace(/--wg-fd:-\d+ms/g, "").replace(/(<time class="rel"[^>]*>)[^<]*/g, "$1")
    .replace(/--now:[\d.]+%/g, "").replace(/(<span class="(?:wk-el|d-tk)"[^>]*>)[^<]*/g, "$1");   /* t-home-usage: 「X 分钟前」 ticks on its own (app.js 20 s interval). t-home-dense: elapsed time, the now marker and 「N 小时后」 tick on their own */
  let last = "", PREV = null;
  const frag = h => { const t = document.createElement("template"); t.innerHTML = h.trim(); return t.content.firstElementChild; };
  function patch(wg, P) {
    if (!PREV || wg.className.split(/\s+/).includes("edit") !== P.edit) return false;
    mvSnap(wg);   // positions before the change, for the FLIP / ghost diff in mvPage
    wg.classList.toggle("edit", P.edit);
    const swap = (sel, h0, h1, after) => {   // header / tail / tray: one element each, replaced only when its HTML changed
      if (norm(h0) === norm(h1)) return;
      const cur = wg.querySelector(":scope > " + sel), nu = h1 ? frag(h1) : null;
      if (cur && nu) cur.replaceWith(nu); else if (cur) cur.remove(); else if (nu) after.after(nu);
    };
    const grid = wg.querySelector(":scope > .wg-grid"), hd = wg.querySelector(":scope > .wg-hd");
    if (!grid || !hd) return false;
    swap(".wg-hd", PREV.hd, P.hd, hd);
    const old = new Map([...grid.children].map(t => [t.dataset.wg, t])), was = new Map(PREV.tiles), want = P.tiles.map(([k, h]) => {
      const t = old.get(k); if (!t || !was.has(k)) return frag(h);
      if (norm(was.get(k)) === norm(h)) return t;
      // same tile, new content: with the same number of children swap only the children that changed (the hero keeps its background
      // image and the sweep its node when only 「N 分钟」 ticked); otherwise the whole tile
      const n = frag(h), a = frag(was.get(k));
      if (!a || a.children.length !== n.children.length || t.children.length !== n.children.length) return n;
      if (a.className !== n.className) t.className = n.className;
      [...n.children].forEach((c, i) => { if (norm(a.children[i].outerHTML) !== norm(c.outerHTML)) t.children[i].replaceWith(c); });
      return t; });
    [...grid.children].forEach(t => { if (!want.includes(t)) t.remove(); });   // drop first, so unchanged tiles never get moved (a move restarts their animations)
    want.forEach((t, i) => { if (grid.children[i] !== t) grid.insertBefore(t, grid.children[i] || null); });
    swap(".wg-tail", PREV.tail, P.tail, grid);
    swap(".wg-tray", PREV.tray, P.tray, wg.querySelector(":scope > .wg-tail") || grid);
    MV.dirty = true;
    return true;
  }
  function html(body, tail) {
    if (A().homeStyle && A().homeStyle() === "dense") return dense(body, tail);   /* t-home-dense */
    const L = load(), D = data(), calm = [], tiles = [];
    const count = { review: D.waiting.length, replies: D.nr.length, today: D.shipped.length };
    L.forEach(([k, s0], i) => {
      const s = !EDIT && s0 === "l" && count[k] != null && count[k] <= 2 ? "m" : s0;   // a big widget with one or two rows drops to M so the grid stays tight
      if (!EDIT && isEmpty(k, D)) { calm.push(calmText(k)); return; }
      const inner = EDIT && isEmpty(k, D) ? eb(k) + `<div class="wg-calm-in">${calmText(k)}</div>` : W[k](s, D);
      const multi = k === "busy" && D.busy.length > 1 ? " multi" : "";
      tiles.push([k, `<section class="wg wg-${k} sz-${s}${k === "busy" && !isEmpty(k, D) ? " hero" + multi : ""}" data-wg="${k}">${inner}${EDIT ? editBar(k, s0, i, L.length) : ""}</section>`]);
    });
    const hidden = Object.keys(SIZES).filter(k => !L.some(x => x[0] === k));
    const P = { edit: EDIT, tiles,
      hd: `<div class="wg-hd">${calm.length ? `<span class="wg-calm">✓ ${calm.map(esc).join(" · ")}</span>` : ""}${A().snzLine ? A().snzLine() : ""}<span class="sp"></span>${EDIT ? `<button type="button" class="wg-btn" data-wg-reset>${en() ? "Reset" : "恢复默认"}</button>` : ""}<button type="button" class="wg-btn${EDIT ? " on" : ""}" data-wg-edit>${EDIT ? (en() ? "Done" : "完成") : (en() ? "Edit widgets" : "编辑小组件")}</button></div>`,
      tail: tail ? `<div class="wg-tail">${tail}</div>` : "",
      tray: EDIT ? `<div class="wg-tray"><h4>${en() ? "Add widgets" : "添加小组件"}<small>${hidden.length ? (en() ? "click to add back" : "点一下加回去") : (en() ? "all widgets are on the page" : "所有小组件都在页面上了")}</small></h4><div class="wg-chips">${hidden.map(k => `<button type="button" data-wg-add="${k}">+ ${nm(k)}</button>`).join("")}</div></div>` : "" };
    const out = `<div id="wg" class="${EDIT ? "edit" : ""}">${P.hd}
      <div class="wg-grid">${tiles.map(x => x[1]).join("")}</div>
      ${P.tail}
      ${P.tray}</div>`;
    const key = norm(out), wg = body && body.firstElementChild && body.firstElementChild.id === "wg" ? body.firstElementChild : null;
    if (wg && key === last) return null;   // same data: keep the DOM (no flicker, no image reloads)
    const kept = wg && patch(wg, P);
    last = key; PREV = P;
    return kept ? null : out;
  }
  const redraw = () => { last = ""; A() && A().refreshPage(); };   // a layout change goes through patch(): changed tiles only
  document.addEventListener("click", e => {
    const t = e.target.closest && e.target.closest("[data-wg-edit],[data-wg-reset],[data-wg-hide],[data-wg-size],[data-wg-move],[data-wg-add]");
    if (!t) { if (EDIT && e.target.closest && e.target.closest("#wg .wg-grid") ) { e.preventDefault(); e.stopPropagation(); } return; }   // editing: tiles don't navigate
    e.preventDefault(); e.stopPropagation();
    const L = load();
    if (t.dataset.wgEdit != null) EDIT = !EDIT;
    else if (t.dataset.wgReset != null) save(DEF.map(x => x.slice()));
    else if (t.dataset.wgHide) save(L.filter(x => x[0] !== t.dataset.wgHide));
    else if (t.dataset.wgAdd) { L.push([t.dataset.wgAdd, SIZES[t.dataset.wgAdd].includes("m") ? "m" : SIZES[t.dataset.wgAdd][0]]); save(L); }
    else if (t.dataset.wgSize) { const [k, z] = t.dataset.wgSize.split(":"); const x = L.find(y => y[0] === k); if (x) x[1] = z; save(L); }
    else if (t.dataset.wgMove) { const [k, d] = t.dataset.wgMove.split(":"); const i = L.findIndex(y => y[0] === k), j = i + +d; if (i >= 0 && j >= 0 && j < L.length) { [L[i], L[j]] = [L[j], L[i]]; save(L); } }
    redraw();
  }, true);
  document.addEventListener("keydown", e => { if (EDIT && e.key === "Escape" && document.getElementById("wg")) { EDIT = false; redraw(); } });
  // ===== t-home-motion (tier 中, approved 11-02) + the flow sweep (item 8, asked for explicitly) =====
  // Plays only on events: entering the home page (stagger + numbers from 0), a row arriving (drop + glow) or leaving (ghost slides out),
  // tiles moving or resizing (FLIP glide), numbers changing (roll). A poll that returns the same data keeps the same DOM and plays nothing;
  // a poll with new data animates only what changed. prefers-reduced-motion turns all of it off. Desktop widget home only.
  const RMQ = matchMedia("(prefers-reduced-motion: reduce)");
  const MV = { page: null, wg: null, rects: new Map(), rows: new Map(), nums: new Map(), dirty: false };
  // t-home-flicker: tile boxes from layout (offset*), not getBoundingClientRect, which includes a running entry / FLIP transform and made every diff glide all tiles
  const lay = t => ({ left: t.offsetLeft, top: t.offsetTop, width: t.offsetWidth, height: t.offsetHeight });
  const rk = r => r.closest(".wg").dataset.wg + "|" + r.dataset.item;
  function mvSnap(wg) {
    MV.rects = new Map([...wg.querySelectorAll(".wg")].map(t => [t.dataset.wg, lay(t)]));
    MV.rows = new Map([...wg.querySelectorAll(".wg-row[data-item]")].map(r => [rk(r), { r: r.getBoundingClientRect(), html: r.outerHTML }]));
    MV.nums = new Map([...wg.querySelectorAll(".wg-big, .wg-eb .n")].map(n => [n.closest(".wg").dataset.wg + "|" + n.className, n.textContent]));
  }
  function mvRoll(wg, fromZero) {
    wg.querySelectorAll(".wg-big, .wg-eb .n").forEach(n => {
      const to = parseInt(n.textContent, 10); if (isNaN(to)) return;
      const from = fromZero ? 0 : parseInt(MV.nums.get(n.closest(".wg").dataset.wg + "|" + n.className), 10); if (isNaN(from) || from === to) return;
      const suf = n.textContent.replace(/^\d+/, ""), t0 = performance.now(), dur = 600;
      const step = t => { if (!n.isConnected) return; const p = Math.min(1, (t - t0) / dur); n.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3))) + suf; if (p < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }
  function mvPage() {
    const wg = document.getElementById("wg"), page = A().UI.page, entered = page === "review" && MV.page !== "review"; MV.page = page;
    if (!wg) { MV.wg = null; return; }
    const dirty = MV.dirty; MV.dirty = false;
    if (wg === MV.wg && !entered && !dirty) return;   // same DOM (poll with no change): nothing to play; dirty = patch() swapped some tiles in place
    const rm = RMQ.matches;
    [...wg.querySelectorAll(".wg")].forEach((t, i) => t.style.setProperty("--wg-i", i));
    if (entered || !MV.wg) {
      if (!rm) { wg.classList.add("wg-enter"); setTimeout(() => wg.classList.remove("wg-enter"), 1500); mvRoll(wg, true); }
    } else if (!rm) {
      const now = new Set();
      wg.querySelectorAll(".wg-row[data-item]").forEach(r => { const k = rk(r); now.add(k); if (!MV.rows.has(k)) r.classList.add("wg-new"); });
      MV.rows.forEach((v, k) => { if (now.has(k)) return; const g = document.createElement("div"); g.className = "wg-ghost"; g.innerHTML = v.html;
        Object.assign(g.style, { left: v.r.left + "px", top: v.r.top + "px", width: v.r.width + "px" }); if (g.firstElementChild) g.firstElementChild.style.margin = "0";
        document.body.appendChild(g); setTimeout(() => g.remove(), 420); });
      wg.querySelectorAll(".wg").forEach(t => { const o = MV.rects.get(t.dataset.wg); if (!o) return; const n = lay(t); if (!n.width || !n.height) return;
        const dx = o.left - n.left, dy = o.top - n.top, sx = o.width / n.width, sy = o.height / n.height;
        if (Math.abs(dx) + Math.abs(dy) > 1 || Math.abs(sx - 1) + Math.abs(sy - 1) > .01)
          t.animate([{ transformOrigin: "0 0", transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})` }, { transformOrigin: "0 0", transform: "none" }], { duration: 320, easing: "cubic-bezier(.2,.8,.2,1)" }); });
      mvRoll(wg, false);
    }
    MV.wg = wg; mvSnap(wg);
  }
  if (A() && A().on) A().on(k => { if (k === "page") try { mvPage(); } catch (_) { } });
  { // t-hover-glass: the pointer-following highlight. One update per animation frame; desktop mouse only; off with reduced motion and in edit mode.
    let raf = 0, ev = null, cur = null;
    const off = t => { if (t) t.style.setProperty("--hg-o", 0); };
    const apply = () => { raf = 0; if (!ev) return; const t = ev.target.closest && ev.target.closest('html[data-home="widgets"] #wg:not(.edit) .wg');
      if (cur && cur !== t) off(cur); cur = t; if (!t) return;
      const r = t.getBoundingClientRect(); t.style.setProperty("--mx", (ev.clientX - r.left) + "px"); t.style.setProperty("--my", (ev.clientY - r.top) + "px"); t.style.setProperty("--hg-o", 1); };
    document.addEventListener("pointermove", e => { if (e.pointerType !== "mouse" || RMQ.matches) return; ev = e; if (!raf) raf = requestAnimationFrame(apply); }, { passive: true });
    document.addEventListener("pointerout", e => { if (cur && !cur.contains(e.relatedTarget)) { off(cur); cur = null; } }, { passive: true });
  }
  const vis = () => document.documentElement.classList.toggle("wg-paused", document.hidden);   // the flow sweep pauses while the page is hidden
  document.addEventListener("visibilitychange", vis); vis();
  // ===== t-home-dense (approved 11-04 13:52): 紧凑首页 =====
  // Five sections top to bottom: 时间轴 · 等你拍板 (cards in a row) · 今日目标 (ring + list) · 此刻在忙 (+ 待机 avatars) · small cards.
  // Solid cards (no backdrop-filter), no infinite animation; press comes from glass.js, hover is a background change.
  // Same data -> same DOM; changed data -> only the sections whose HTML changed are swapped. Ticking text (elapsed, now marker,
  // 「N 小时后」) is stripped by norm() and updated in place by the 30 s ticker below.
  const dkey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const rtName = r => String(r.label || r.id).replace(/[（(][^）)]*[）)]/g, "").replace(/^.*?每日\s*(\d+\s*个\s*)?(一条|打磨)?/, "").replace(/^app\s*/i, "").trim() || r.id;
  const dayAt = hhmm => { const [h, m] = String(hhmm).split(":").map(Number), d = new Date(); d.setHours(h || 0, m || 0, 0, 0); return d.getTime(); };
  const inH = t => { const h = (t - Date.now()) / 36e5; return en() ? `in ${h < 1 ? Math.max(1, Math.round(h * 60)) + " min" : (Math.round(h * 10) / 10) + " h"}` : h < 1 ? `${Math.max(1, Math.round(h * 60))} 分钟后` : `${Math.round(h * 10) / 10} 小时后`; };
  const TL = { h0: 8, h1: 22 };
  const tlX = t => { const d = new Date(t), h = d.getHours() + d.getMinutes() / 60; return Math.max(0, Math.min(100, (h - TL.h0) / (TL.h1 - TL.h0) * 100)); };
  const pct = x => Math.round(x * 10) / 10 + "%";
  function dData() {
    const app = A(), ST = app.ST, its = app.items(), D = data(), now = Date.now(), td = new Date().toDateString(), tk = dkey(new Date());
    const isT = t => !!t && new Date(t).toDateString() === td;
    const meta = ST.meta || {};
    const rts = (meta.routines || []).filter(r => !r.paused && !r.disabled && r.time).map(r => ({ t: dayAt(r.time), name: rtName(r), ran: r.last === tk, item: r.item }));
    if (meta.report_time) rts.push({ t: dayAt(meta.report_time), name: en() ? "Daily report" : "日报", ran: meta.last_report_date === tk, item: "" });
    rts.sort((a, b) => a.t - b.t);
    const cal = (ST.calendar || []).filter(e => e.date === tk);
    const goals = its.filter(i => !/^r-/.test(i.id) && i.category !== "ongoing" && (i.stage === "done" ? isT(i.closed) : (isT(i.created) || isT(i.activity))));
    const gOpen = goals.filter(i => i.stage !== "done").sort((a, b) => ms(b.activity) - ms(a.activity)), gDone = goals.filter(i => i.stage === "done").sort((a, b) => ms(b.closed) - ms(a.closed));
    const agents = Object.values(ST.agents || {}).filter(a => a.enabled !== false).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    const etaMin = id => {   /* median created -> closed for this owner's cards closed in the last 14 days; fewer than 3 -> no estimate */
      const L = its.filter(i => i.owner === id && i.stage === "done" && i.closed && !/^r-/.test(i.id) && now - ms(i.closed) < 14 * 864e5).map(i => (ms(i.closed) - ms(i.created)) / 6e4).filter(m => m > 3 && m < 600).sort((x, y) => x - y);
      return L.length >= 3 ? L[Math.floor(L.length / 2)] : null; };
    const waiting = D.waiting.slice().sort((a, b) => (b.category === "urgent") - (a.category === "urgent"));
    return { D, now, rts, cal, gOpen, gDone, agents, etaMin, waiting, meta };
  }
  const dSecs = X => {
    const { D, now } = X, zh = !en();
    // 1 timeline
    TL.h0 = Math.min(8, new Date(now).getHours()); TL.h1 = Math.max(22, new Date(now).getHours() + 1);
    const ticks = []; for (let h = TL.h0; h <= TL.h1; h += 2) ticks.push(`<span style="left:${pct((h - TL.h0) / (TL.h1 - TL.h0) * 100)}">${String(h).padStart(2, "0")}:00</span>`);
    const next = X.rts.find(r => r.t > now && !r.ran), evN = X.cal.length;
    const tl = `<section class="d-card d-tl" data-sec="tl"><div class="d-tl-ax">${ticks.join("")}</div>
      <div class="d-tl-bar" style="--now:${pct(tlX(now))}"><i class="past"></i>
      ${D.shipped.map(i => `<b class="dot" style="left:${pct(tlX(i.closed))}" title="${esc(hm(i.closed) + " " + i.title)}" data-item="${esc(i.id)}"></b>`).join("")}
      ${X.cal.filter(e => e.time).map(e => `<b class="ev" style="left:${pct(tlX(dayAt(e.time)))}" title="${esc(e.time + " " + (e.title || ""))}"></b>`).join("")}
      ${X.rts.map(r => `<em class="rt${r.ran ? " ran" : ""}" style="left:${pct(tlX(r.t))}"${r.item ? ` data-item="${esc(r.item)}"` : ""}><u>${hm(r.t)} ${esc(r.name)}</u></em>`).join("")}
      <span class="now"><u><span class="d-tk" data-now="1">${(zh ? "现在 " : "now ") + hm(now)}</span></u></span></div>
      <div class="d-tl-ft">${zh ? `今天交付 <b>${D.shipped.length}</b> 件 · ${evN ? `${evN} 个日程` : "没有会议"}` : `<b>${D.shipped.length}</b> shipped today · ${evN ? `${evN} events` : "no meetings"}`}${next ? ` · ${zh ? "下一个" : "next"}：${hm(next.t)} ${esc(next.name)}（<span class="d-tk" data-at="${next.t}">${inH(next.t)}</span>）` : ""}${D.nr.length ? ` · <button type="button" class="d-link in" data-go="mail">${zh ? `新回复 ${D.nr.reduce((t, g) => t + g.ms.length, 0)} 条 ›` : `${D.nr.reduce((t, g) => t + g.ms.length, 0)} new replies ›`}</button>` : ""}${A().snzLine ? A().snzLine() : ""}</div></section>`;
    // 2 等你拍板
    const W = X.waiting, tag = i => i.category === "urgent" ? `<em class="u">${zh ? "紧急" : "Urgent"}</em>` : `<em>${kindL(i)}</em>`;
    const needs = `<section class="d-needs${W.length ? "" : " d-needs0"}" data-sec="needs"><div class="d-h"><b>${nm("review")}</b>${W.length ? `<span class="n hot">${W.length}</span>` : ""}${W.length ? "" : `<span class="d-ok">✓ ${calmText("review")}</span>`}<span class="sp"></span>${W.length > 2 ? `<button type="button" class="d-link" data-go="board">${zh ? "全部" : "All"} ${W.length} ›</button>` : ""}</div>
      ${W.length ? `<div class="d-nr">${W.slice(0, 3).map(i => { const a = A().agent(i.owner); return `<button type="button" class="d-n${i.category === "urgent" ? " urgent" : ""}" data-item="${esc(i.id)}"><span class="top"><img src="${A().avatarUrl(a)}" alt="">${tag(i)}</span><span class="t">${esc(i.title)}</span><small>${esc(A().aname(a))} · ${zh ? "等了" : "waiting"} <time class="rel" data-t="${esc(i.activity || i.updated)}" data-rel="ago">${ago(i.activity || i.updated)}</time></small></button>`; }).join("")}</div>` : ""}</section>`;
    // 3 今日目标
    const N = X.gOpen.length + X.gDone.length, K = X.gDone.length, R = 46, C = 2 * Math.PI * R;
    const show = [...X.gOpen, ...X.gDone].slice(0, 12), stg = { todo: zh ? "待办" : "to do", doing: zh ? "进行中" : "doing", review: zh ? "等你看" : "with you", waiting: zh ? "等别人" : "waiting" };
    const gRow = i => { const ok = i.stage === "done", a = A().agent(i.owner);
      return `<button type="button" class="d-g${ok ? " ok" : ""}" data-item="${esc(i.id)}"><span class="ck">${ok ? "✓" : ""}</span><span class="t"><span class="tt">${esc(i.title)}</span><small>${ok ? `${hm(i.closed)} ${zh ? "关卡" : "closed"}` : `${esc(A().aname(a))} · ${stg[i.stage] || i.stage}`}</small></span></button>`; };
    const ring = `<svg class="d-ring" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="${R}" class="trk"/>${K ? `<circle cx="60" cy="60" r="${R}" class="val" stroke-dasharray="${(C * K / Math.max(1, N)).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 60 60)"/>` : ""}</svg>`;
    const goals = `<section class="d-card d-goals" data-sec="goals"><div class="d-h" title="${zh ? "今天新建、在做、关掉的卡，关卡自动打勾" : "cards created, worked on or closed today"}"><b>${zh ? "今日目标" : "Today's goals"}</b>${ring}<span class="d-gk"><b>${K}</b>/${N}</span><span class="sp"></span><span class="d-leg"><i class="g"></i>${K} ${zh ? "完成" : "done"}<i></i>${N - K} ${zh ? "剩下" : "left"}</span></div>
      <div class="d-gl">${N ? show.map(gRow).join("") : `<div class="d-calm">${zh ? "今天还没有卡" : "No cards today yet"}</div>`}</div>
      ${[[8, "nw"], [12, "wd"]].map(([c, k]) => N > c ? `<button type="button" class="d-more ${k}" data-go="board">${zh ? `还有 ${N - c} 件 ›` : `${N - c} more ›`}</button>` : "").join("")}</section>`;   /* t-home-tight: 8 rows (nw) or 12 in two columns (wd, #hd2 >= 900px); CSS shows the matching 「还有 N 件」 */
    // 4 此刻在忙 + 待机
    const B = D.busy, busyIds = new Set(B.map(x => x.a.id)), stand = X.agents.filter(a => !busyIds.has(a.id));
    const wRow = ({ a, it, since }) => { const m = X.etaMin(a.id), end = m && since ? ms(since) + m * 6e4 : 0;
      return `<button type="button" class="d-w" data-item="${esc(it.id)}"><img src="${A().avatarUrl(a)}" alt=""><span class="who"><b>${esc(A().aname(a))}</b><small>${esc(A().atitle(a) || "")}</small></span>
        <span class="job">${esc(it.title)}<small>${esc(a.activity || "")}</small></span>
        <span class="tm"><b><span class="wk-el" data-fmt="dc" data-since="${esc(since || "")}">${since ? ago(since) : ""}</span></b><small>${since ? `${hm(since)} ${zh ? "开始" : "start"}` : ""}${end > now ? ` · ${zh ? "预计" : "ETA"} ~${hm(end)}` : ""}</small></span></button>`; };
    const work = `<section class="d-card d-work" data-sec="work"><div class="d-h">${B.length ? '<span class="live"></span>' : ""}<b>${nm("busy")}</b>${B.length ? `<span class="n">${B.length}</span>` : ""}</div>
      ${B.length ? B.map(wRow).join("") : `<div class="d-calm">${calmText("busy")}</div>`}
      ${stand.length ? `<div class="d-sb"><span>${zh ? "待机" : "Standby"} · ${stand.length}</span>${stand.map(a => `<button type="button" data-chat="${esc(a.id)}" title="${esc(A().aname(a))}"><img src="${A().avatarUrl(a)}" alt=""></button>`).join("")}${stand.length > 5 ? `<i class="d-sbn">+${stand.length - 5}</i>` : ""}</div>` : ""}</section>`;   /* t-home-tight: under 640px the strip shows 5 faces + this count (CSS) */
    // 5 small cards
    const mx = Math.max(1, ...D.days.map(x => x.n)), wk = D.days.reduce((t, x) => t + x.n, 0), u = X.meta.usage || {}, rl = (X.meta.routines || []).filter(r => !r.paused && !r.disabled);
    const ran = X.rts.filter(r => r.ran).length;
    const minis = `<section class="d-minis" data-sec="minis"><button type="button" class="d-mini" data-go="board"><small>${zh ? "本周交付" : "Shipped · 7 days"}</small><b>${wk}</b><span class="bars">${D.days.map((x, k) => `<i class="${k === 6 ? "on" : ""}" style="height:${Math.max(8, Math.round(x.n / mx * 100))}%"></i>`).join("")}</span></button>
      <button type="button" class="d-mini" data-go="ongoing"><small>${nm("ongoing")}</small><b>${rl.length}</b><span class="tx">${zh ? `今天已跑 ${ran}` : `${ran} ran today`}${next ? `<br>${zh ? "下个" : "next"} ${hm(next.t)}` : ""}</span></button>
      <button type="button" class="d-mini" data-ru-open><small>${nm("usage")}</small><b>${u.five_hour ? Math.round(u.five_hour.used) + "%" : "—"}</b><span class="tx">${zh ? "5 小时额度" : "5-hour quota"}${u.seven_day ? `<br>${zh ? "本周" : "week"} ${Math.round(u.seven_day.used)}%` : ""}</span></button></section>`;
    return [["tl", tl], ["needs", needs], ["goals", goals], ["side", `<div class="d-side" data-sec="side">${work.replace(' data-sec="work"', "")}${minis.replace(' data-sec="minis"', "")}</div>`]];   /* t-home-tight: work + minis share the right column */
  };
  const DZ = { prev: null };
  function dense(body, tail) {
    const secs = dSecs(dData()), tl = tail ? `<div class="d-tail" data-sec="tail">${tail}</div>` : "";
    if (tl) secs.push(["tail", tl]);
    const box = body && body.firstElementChild && body.firstElementChild.id === "hd2" ? body.firstElementChild : null;
    if (box && DZ.prev) {
      const was = new Map(DZ.prev), cur = new Map([...box.children].map(c => [c.dataset.sec, c]));
      secs.forEach(([k, h], i) => { const el = cur.get(k);
        if (el && was.has(k) && norm(was.get(k)) === norm(h)) { if (box.children[i] !== el) box.insertBefore(el, box.children[i] || null); return; }
        const n = frag(h); if (el) el.replaceWith(n); else box.insertBefore(n, box.children[i] || null); });
      [...box.children].forEach(c => { if (!secs.some(([k]) => k === c.dataset.sec)) c.remove(); });
      DZ.prev = secs; return null;
    }
    DZ.prev = secs;
    const rm = RMQ.matches;
    if (!rm) setTimeout(() => { const b = document.getElementById("hd2"); if (b) b.classList.remove("d-enter"); }, 1200);
    return `<div id="hd2" class="${rm ? "" : "d-enter"}">${secs.map(([, h], i) => h.replace(/^<(section|div) class="/, `<$1 style="--d-i:${i}" class="`)).join("")}</div>`;
  }
  setInterval(() => {   /* 30 s: move the now marker, refresh 「现在 HH:MM」 and 「N 小时后」 in place (they are stripped from the compare) */
    const b = document.getElementById("hd2"); if (!b || document.hidden) return;
    const bar = b.querySelector(".d-tl-bar"); if (bar) bar.style.setProperty("--now", pct(tlX(Date.now())));
    b.querySelectorAll(".d-tk[data-now]").forEach(x => { const v = (en() ? "now " : "现在 ") + hm(Date.now()); if (x.textContent !== v) x.textContent = v; });
    b.querySelectorAll(".d-tk[data-at]").forEach(x => { const v = inH(+x.dataset.at); if (x.textContent !== v) x.textContent = v; });
  }, 30000);
  window.Widgets = { html, editing: () => EDIT };
  if (A() && A().refreshPage && document.documentElement.dataset.home === "widgets") A().refreshPage();   /* app.js rendered before this file parsed */
})();
