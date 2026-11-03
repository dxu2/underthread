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
  const SIZES = { review: ["m", "l"], busy: ["m", "l"], replies: ["m", "l"], today: ["s", "m", "l"], week: ["s", "m"], ongoing: ["s", "m"], media: ["s", "m"] };
  const NAME = { review: ["等你拍板", "Waiting on you"], busy: ["此刻在忙", "Working now"], replies: ["新回复", "New replies"], today: ["今天交付", "Shipped today"],
    week: ["本周进度", "This week"], ongoing: ["常驻活动", "Routines"], media: ["最近素材", "Recent media"] };
  const DEF = [["review", "l"], ["busy", "l"], ["replies", "l"], ["today", "m"], ["week", "m"], ["ongoing", "m"], ["media", "m"]];
  const KEY = "rt.widgets";
  const load = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || "null"); if (Array.isArray(v) && v.every(x => SIZES[x[0]])) return v; } catch { } return DEF.map(x => x.slice()); };
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
  const isEmpty = (k, D) => ({ review: !D.waiting.length, busy: !D.busy.length, replies: !D.nr.length, today: !D.shipped.length, ongoing: !D.ongoing.length, media: !D.imgs.length, week: false })[k];
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
    review(s, D) {
      const L = D.waiting, { n, foot } = fitM(s, L.length, 5);
      return eb("review", L.length, true) + L.slice(0, n).map(i => { const a = A().agent(i.owner);
        return `<div class="wg-row" data-item="${esc(i.id)}"><img class="wg-av" src="${A().avatarUrl(a)}" alt=""><div class="t">${esc(i.title)}<small>${esc(A().aname(a))} · ${en() ? "waiting" : "等了"} ${ago(i.activity || i.updated)}</small></div><span class="wg-tg${i.kind === "plan" ? "" : " hot"}">${kindL(i)}</span></div>`; }).join("") +
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

  let last = "";
  function html(body, tail) {
    const L = load(), D = data(), calm = [], tiles = [];
    const count = { review: D.waiting.length, replies: D.nr.length, today: D.shipped.length };
    L.forEach(([k, s0], i) => {
      const s = !EDIT && s0 === "l" && count[k] != null && count[k] <= 2 ? "m" : s0;   // a big widget with one or two rows drops to M so the grid stays tight
      if (!EDIT && isEmpty(k, D)) { calm.push(calmText(k)); return; }
      const inner = EDIT && isEmpty(k, D) ? eb(k) + `<div class="wg-calm-in">${calmText(k)}</div>` : W[k](s, D);
      const multi = k === "busy" && D.busy.length > 1 ? " multi" : "";
      tiles.push(`<section class="wg wg-${k} sz-${s}${k === "busy" && !isEmpty(k, D) ? " hero" + multi : ""}" data-wg="${k}">${inner}${EDIT ? editBar(k, s0, i, L.length) : ""}</section>`);
    });
    const hidden = Object.keys(SIZES).filter(k => !L.some(x => x[0] === k));
    const out = `<div id="wg" class="${EDIT ? "edit" : ""}"><div class="wg-hd">${calm.length ? `<span class="wg-calm">✓ ${calm.map(esc).join(" · ")}</span>` : ""}<span class="sp"></span>${EDIT ? `<button type="button" class="wg-btn" data-wg-reset>${en() ? "Reset" : "恢复默认"}</button>` : ""}<button type="button" class="wg-btn${EDIT ? " on" : ""}" data-wg-edit>${EDIT ? (en() ? "Done" : "完成") : (en() ? "Edit widgets" : "编辑小组件")}</button></div>
      <div class="wg-grid">${tiles.join("")}</div>
      ${tail ? `<div class="wg-tail">${tail}</div>` : ""}
      ${EDIT ? `<div class="wg-tray"><h4>${en() ? "Add widgets" : "添加小组件"}<small>${hidden.length ? (en() ? "click to add back" : "点一下加回去") : (en() ? "all widgets are on the page" : "所有小组件都在页面上了")}</small></h4><div class="wg-chips">${hidden.map(k => `<button type="button" data-wg-add="${k}">+ ${nm(k)}</button>`).join("")}</div></div>` : ""}</div>`;
    if (out === last && body && body.firstElementChild && body.firstElementChild.id === "wg") return null;   // same DOM: keep it (no flicker, no image reloads)
    last = out; return out;
  }
  const redraw = () => { last = ""; A() && A().refreshPage(); };
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
  const MV = { page: null, wg: null, rects: new Map(), rows: new Map(), nums: new Map() };
  const rk = r => r.closest(".wg").dataset.wg + "|" + r.dataset.item;
  function mvSnap(wg) {
    MV.rects = new Map([...wg.querySelectorAll(".wg")].map(t => [t.dataset.wg, t.getBoundingClientRect()]));
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
    if (wg === MV.wg && !entered) return;   // same DOM (poll with no change): nothing to play
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
      wg.querySelectorAll(".wg").forEach(t => { const o = MV.rects.get(t.dataset.wg); if (!o) return; const n = t.getBoundingClientRect(); if (!n.width || !n.height) return;
        const dx = o.left - n.left, dy = o.top - n.top, sx = o.width / n.width, sy = o.height / n.height;
        if (Math.abs(dx) + Math.abs(dy) > 1 || Math.abs(sx - 1) + Math.abs(sy - 1) > .01)
          t.animate([{ transformOrigin: "0 0", transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})` }, { transformOrigin: "0 0", transform: "none" }], { duration: 320, easing: "cubic-bezier(.2,.8,.2,1)" }); });
      mvRoll(wg, false);
    }
    MV.wg = wg; mvSnap(wg);
  }
  if (A() && A().on) A().on(k => { if (k === "page") try { mvPage(); } catch (_) { } });
  const vis = () => document.documentElement.classList.toggle("wg-paused", document.hidden);   // the flow sweep pauses while the page is hidden
  document.addEventListener("visibilitychange", vis); vis();
  window.Widgets = { html, editing: () => EDIT };
  if (A() && A().refreshPage && document.documentElement.dataset.home === "widgets") A().refreshPage();   // app.js rendered before this file parsed
})();
