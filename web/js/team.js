/* t-rb-build: 团队交接. The 「团队交接」 home widget (S / M / L, drawn for widgets.js) and the 团队 page (left rail): the handoff
   graph (yarn = handoffs between two roles in the last 24 h, thicker = more, colour = who passed it on, needle = the live one),
   a replay bar over the last 24 h, and each role's queue. Phone: a plain list.
   Data: GET /api/handoffs?since=<24 h ago> (server.py; the log in state.handoffs plus, for the time before the log began,
   handoffs inferred from card threads). A poll carries meta.ho = {n, last, t}; a new `last` triggers a refetch, and every
   5 minutes the window slides anyway. Old server (404): the graph has no lines and says the server needs a restart.
   The page keeps its DOM across polls (page() returns null while nothing changed, and always while the replay plays or is dragged). */
(function () {
  const A = () => window.App;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const en = () => !!(A() && A().UI && A().UI.lang === "en");
  const L = (zh, e) => en() ? e : zh;
  const ms = x => Date.parse(x) || 0;
  const pad = n => String(n).padStart(2, "0");
  const hm = t => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const ago = t => { const m = Math.max(1, Math.round((Date.now() - ms(t)) / 6e4)); return m < 60 ? L(`${m} 分钟`, `${m} min`) : m < 1440 ? L(`${Math.round(m / 60)} 小时`, `${Math.round(m / 60)} h`) : L(`${Math.round(m / 1440)} 天`, `${Math.round(m / 1440)} d`); };
  const RMQ = matchMedia("(prefers-reduced-motion: reduce)");
  const MOBQ = matchMedia("(max-width: 760px)");
  const DAY = 864e5;
  const SPEEDS = { 1: 240e3, 8: 30e3, 60: 4e3 };   // how long one replay of the 24 h takes
  const T = { list: [], key: null, at: 0, busy: false, err: "", ready: false, cursor: null, playing: false, speed: 8, timer: 0, drag: false, pageKey: "", shown: -1 };

  // ---------- data ----------
  function sync(force) {
    const app = A(); if (!app || !app.ST || T.busy) return;
    const m = app.ST.meta && app.ST.meta.ho, k = m ? `${m.last}|${m.n}` : "none";
    if (!force && k === T.key && Date.now() - T.at < 300e3) return;
    T.busy = true; T.key = k;
    fetch(`/api/handoffs?since=${encodeURIComponent(new Date(Date.now() - DAY).toISOString())}`, { cache: "no-store" })
      .then(r => { if (r.status === 404) throw new Error("old"); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(j => { T.list = Array.isArray(j.list) ? j.list : []; T.err = ""; })
      .catch(e => { T.err = e && e.message === "old" ? "old" : String((e && e.message) || e); })
      .finally(() => { T.busy = false; T.at = Date.now(); T.ready = true; const p = A().UI.page; if (p === "review") A().refreshPage(); });
  }
  const order = (a, b) => (a.order ?? 99) - (b.order ?? 99);
  const isW = a => a.id !== "manager" && a.status === "working";   // graph layout only (the manager keeps its own spot)
  /* t-ui-fix-r6 R6-08: counts use the shared App.isBusy (home header, 此刻在忙), so the manager on a live card counts here too */
  const isB = a => A().isBusy ? A().isBusy(a) : isW(a);
  function model(upTo) {
    const app = A(), ST = app.ST;
    const ags = Object.values(ST.agents || {}).filter(a => a.enabled !== false).sort(order), by = Object.fromEntries(ags.map(a => [a.id, a]));
    const t0 = Date.now() - DAY;
    const evs = T.list.filter(e => by[e.f] && by[e.to]).map(e => Object.assign({}, e, { ms: ms(e.t) })).filter(e => e.ms > t0).sort((a, b) => a.ms - b.ms);
    const vis = upTo == null ? evs : evs.filter(e => e.ms <= upTo);
    const map = new Map(), edge = (f, to) => { const k = f + ">" + to; let x = map.get(k); if (!x) { x = { f, to, n: 0, last: null, live: false }; map.set(k, x); } return x; };
    vis.forEach(e => { const x = edge(e.f, e.to); x.n++; x.last = e; });
    let lit, cur = null;
    if (upTo == null) {
      lit = new Set(ags.filter(isB).map(a => a.id));   // t-ui-fix-r6: the manager on a live card is lit too
      ags.filter(isW).forEach(a => {   // the live strand: the latest handoff into a working role on the card it is working on now
        const e = [...evs].reverse().find(x => x.to === a.id && (!a.item || x.item === a.item));
        const x = edge(e ? e.f : "manager", a.id); x.live = true; lit.add(x.f);
      });
    } else {
      cur = vis[vis.length - 1] || null; lit = new Set(cur ? [cur.f, cur.to] : []);
      if (cur) edge(cur.f, cur.to).live = true;
    }
    const edges = [...map.values()].filter(x => by[x.f] && by[x.to]);
    edges.forEach(x => x.kind = x.f === "manager" ? "disp" : x.to === "manager" ? "back" : "relay");
    return { ags, by, evs, vis, edges, lit, cur, work: ags.filter(isW), busy: ags.filter(isB), idle: ags.filter(a => !isB(a) && a.id !== "manager") };
  }

  // ---------- the yarn graph (same drawing as work/t-desk-role-board/graph) ----------
  // pos: {id: [x, y]} as fractions of W x H. Avatars and yarn are SVG (they scale together); names / pills are HTML on top, placed in %.
  const tint = a => (A().tintOf ? A().tintOf(a) : a.color) || "var(--accent)";
  function graph(M, o) {
    const { W, H, pos, R } = o, ids = Object.keys(pos).filter(id => M.by[id]), uid = o.uid, k = o.k || 1;
    const xy = id => [pos[id][0] * W, pos[id][1] * H];
    const rOf = id => (id === "manager" ? 1.15 : 1) * R;
    const geo = e => {
      const [x1, y1] = xy(e.f), [x2, y2] = xy(e.to), dx = x2 - x1, dy = y2 - y1, Ln = Math.hypot(dx, dy) || 1;
      const b = (e.kind === "relay" ? 60 : 24) * k, cx = (x1 + x2) / 2 - dy / Ln * b, cy = (y1 + y2) / 2 + dx / Ln * b;
      const at = t => [(1 - t) ** 2 * x1 + 2 * (1 - t) * t * cx + t * t * x2, (1 - t) ** 2 * y1 + 2 * (1 - t) * t * cy + t * t * y2];
      const r0 = rOf(e.f) * 1.02 / Ln, r1 = rOf(e.to) * 1.08 / Ln, [sx, sy] = at(r0), [ex, ey] = at(1 - r1);
      return { d: `M${sx.toFixed(1)},${sy.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`, at };
    };
    const yarn = e => {
      if (!pos[e.f] || !pos[e.to]) return "";
      const g = geo(e), c = tint(M.by[e.f]), w = (3 + Math.sqrt(Math.max(1, e.n)) * 3.2) * k, q = Math.max(k, .75);
      const da = `${(w * .55).toFixed(1)} ${(w * .7).toFixed(1)}`;
      let s = `<g class="tb-y ${e.kind}${e.live ? " live" : ""}${e.n ? "" : " syn"}">
        <path d="${g.d}" class="tb-yg" style="stroke:${c};stroke-width:${(w + 5 * k).toFixed(1)}px" filter="url(#tbf${uid})"/>
        <path d="${g.d}" class="tb-yb" style="stroke:${c};stroke-width:${w.toFixed(1)}px"/>
        <path d="${g.d}" class="tb-yd" style="stroke-width:${w.toFixed(1)}px;stroke-dasharray:${da}"/>
        <path d="${g.d}" class="tb-yl" style="stroke-width:${(w * .35).toFixed(1)}px;stroke-dasharray:${da};stroke-dashoffset:${(w * .3).toFixed(1)}"${e.live ? ' data-ip="s"' : ""}/>`;
      if (e.n) { let [lx, ly] = g.at(.5);
        /* t-ri1110-a P4: a pair of opposite strands put both counts 16px apart at the same spot (read as 「5|2」); push each out along the normal */
        if (M.edges.some(x => x.f === e.to && x.to === e.f && x.n && pos[x.f] && pos[x.to])) { const [x1, y1] = xy(e.f), [x2, y2] = xy(e.to), L = Math.hypot(x2 - x1, y2 - y1) || 1; lx -= (y2 - y1) / L * 16 * k; ly += (x2 - x1) / L * 16 * k; } s += `<g transform="translate(${lx.toFixed(1)},${ly.toFixed(1)}) scale(${q.toFixed(2)})"><rect class="tb-bd" x="-12" y="-9" width="24" height="18" rx="4"/><text class="tb-bt" text-anchor="middle" dy="4">${e.n}</text></g>`; }
      if (e.live) { const [nx, ny] = g.at(.72), [px, py] = g.at(.74), ang = Math.atan2(py - ny, px - nx) * 180 / Math.PI;
        s += `<g class="tb-needle" transform="translate(${nx.toFixed(1)},${ny.toFixed(1)}) rotate(${ang.toFixed(0)}) scale(${Math.max(k, .6).toFixed(2)})"><circle r="16" style="fill:${c}" opacity=".25"/><path d="M-26,-2 L18,-1 L26,0 L18,1 L-26,2 Z"/><ellipse cx="-20" cy="0" rx="4.5" ry="1"/></g>`; }
      return s + "</g>";
    };
    const ball = id => { const a = M.by[id], [x, y] = xy(id), r = rOf(id), on = M.lit.has(id) || id === "manager";
      return `<g class="tb-ball${on ? " on" : ""}">${[0, 30, 60, 95, 130, 160].map(d => `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(r * 1.5).toFixed(1)}" ry="${(r * .62).toFixed(1)}" transform="rotate(${d} ${x.toFixed(1)} ${y.toFixed(1)})" style="stroke:${tint(a)};stroke-width:${Math.max(1.5, 4 * k).toFixed(1)}px"/>`).join("")}</g>`; };
    const node = id => { const a = M.by[id], [x, y] = xy(id), r = rOf(id) * .92, on = M.lit.has(id);
      return `<g class="tb-n${on ? " on" : ""}" data-id="${esc(id)}">${on ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * 1.25).toFixed(1)}" style="fill:${tint(a)}" class="tb-glow" filter="url(#tbf${uid})"/>` : ""}
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r + 1.5).toFixed(1)}" class="tb-rim"${on ? ` style="stroke:${tint(a)}"` : ""}/>
        <image href="${esc(A().avatarUrl(a))}" x="${(x - r).toFixed(1)}" y="${(y - r).toFixed(1)}" width="${(2 * r).toFixed(1)}" height="${(2 * r).toFixed(1)}" clip-path="url(#tbc${uid})" preserveAspectRatio="xMidYMid slice"/></g>`; };
    const lab = id => { if (!o.labels) return ""; const a = M.by[id], [x, y] = xy(id), on = M.lit.has(id), top = ((y + rOf(id) * 1.05) / H * 100).toFixed(2);
      const sub = o.sub ? o.sub(a) : "";
      return `<div class="tb-lab${on ? " on" : ""}" style="left:${(x / W * 100).toFixed(2)}%;top:${top}%"><b data-chat="${esc(id)}">${esc(A().aname(a))}</b>${sub}</div>`; };
    const edges = M.edges.filter(e => pos[e.f] && pos[e.to]).sort((a, b) => (a.live - b.live) || (a.n - b.n));   // live strands on top
    return `<div class="tb-gr" style="aspect-ratio:${W}/${H}"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs><filter id="tbf${uid}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${(2.6 * k + 1).toFixed(1)}"/></filter><clipPath id="tbc${uid}" clipPathUnits="objectBoundingBox"><circle cx=".5" cy=".5" r=".5"/></clipPath></defs>
      ${ids.map(ball).join("")}${edges.map(yarn).join("")}${ids.map(node).join("")}</svg>${ids.map(lab).join("")}</div>`;
  }
  // full-team layout: manager in the middle, everyone else on an ellipse in roster order, starting at the top
  function ring(M, rx, ry) {
    const others = M.ags.filter(a => a.id !== "manager"), pos = {};
    if (M.by.manager) pos.manager = [.5, .5];
    others.forEach((a, i) => { const t = -Math.PI / 2 - Math.PI / Math.max(4, others.length) + i * 2 * Math.PI / Math.max(1, others.length); pos[a.id] = [.5 + rx * Math.cos(t), .5 + ry * Math.sin(t)]; });
    return pos;
  }

  // ---------- widget (called by widgets.js W.team) ----------
  const eb = n => `<div class="wg-eb"><span class="wg-dot"></span><b>${L("团队交接", "Team handoffs")}</b>${n != null ? (window.WgNum ? WgNum(n) : `<span class="n">${n}</span>`) : ""}</div>`;
  const oldNote = () => T.err === "old" ? `<div class="tb-note">${L("看板服务重启后才有交接记录", "Handoffs appear after a server restart")}</div>` : "";
  const W = {
    s(M) {   // busy count in the middle, everyone on a ring; working ones lit
      const R = 46, c = 60, ring = M.ags.filter(a => a.id !== "manager").concat(M.by.manager ? [M.by.manager] : []);
      const ps = ring.map((a, i) => { const t = -Math.PI / 2 + i * 2 * Math.PI / ring.length, x = c + R * Math.cos(t), y = c + R * Math.sin(t), on = isB(a), r = on ? 13 : 10.5;
        return `<g class="tb-rp${on ? " on" : ""}">${on ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r + 2}" style="stroke:${tint(a)}" class="tb-rr"/>` : ""}<image href="${esc(A().avatarUrl(a))}" x="${(x - r).toFixed(1)}" y="${(y - r).toFixed(1)}" width="${2 * r}" height="${2 * r}" clip-path="url(#tbcS)" preserveAspectRatio="xMidYMid slice"/></g>`; }).join("");
      return eb() + `<div class="tb-s"><svg viewBox="-6 -6 132 132" aria-hidden="true"><defs><clipPath id="tbcS" clipPathUnits="objectBoundingBox"><circle cx=".5" cy=".5" r=".5"/></clipPath></defs><circle cx="60" cy="60" r="46" class="tb-sr"/>${ps}</svg><div class="tb-c"><b>${M.busy.length}</b><small>${L("在忙", "busy")}</small></div></div>`;
    },
    m(M) {   // mini graph: manager + working roles + live strands; who does what on the right; idle faces under it
      const n = M.work.length, pos = {}, src = [...new Set(M.edges.filter(e => e.live && e.f !== "manager" && !isW(M.by[e.f])).map(e => e.f))];
      if (M.by.manager) pos.manager = [.2, src.length ? .3 : .5];
      src.slice(0, 2).forEach((id, i) => pos[id] = [.2, .72 + i * .2]);
      M.work.slice(0, 3).forEach((a, i) => pos[a.id] = [.8, n === 1 ? .5 : .2 + .6 * i / (Math.min(n, 3) - 1)]);
      const sub = { edges: M.edges.filter(e => e.live && pos[e.f] && pos[e.to]), by: M.by, lit: M.lit, ags: M.ags };
      const g = graph(sub, { W: 300, H: 210, pos, R: 34, k: .9, uid: "M" });
      const nb = M.busy.length, bl = M.work.length ? M.work : M.busy;   // t-ui-fix-r6 R6-08: text counts = shared busy count; the label prefers a role
      const lab = bl.slice(0, 1).map(a => { const it = A().liveItem(a);
        return `<div class="tb-ml" style="--c:${tint(a)}"${it ? ` data-item="${esc(it.id)}"` : ""}><b><span>${esc(A().aname(a))}</span><i>${a.since ? ago(a.since) : ""}</i></b><small>${esc((it && it.title) || a.activity || "")}</small></div>`; }).join("");
      const idle = M.idle.slice(0, 8).map(a => `<img class="tb-ia" src="${esc(A().avatarUrl(a))}" alt="" title="${esc(A().aname(a))}">`).join("");
      return eb(L(`${nb} 在忙`, `${nb} busy`)) + `<div class="tb-m"><div class="tb-mg">${g}</div><div class="tb-mr">${nb ? lab : `<div class="tb-calm">${L("大家都空闲", "Everyone is idle")}</div>`}<div class="tb-idle">${idle}${nb > 1 ? `<em>${L(`+${nb - 1} 人在忙`, `+${nb - 1} busy`)}</em>` : ""}</div></div></div>`
        + (oldNote() || `<div class="wg-more"><span>${L(`近 24 小时交接 ${M.evs.length} 次`, `${M.evs.length} handoffs in 24 h`)}</span></div>`)   /* t-drop-team-tab: no 团队 page to open any more */;
    },
    l(M) {   // the whole graph + the last 3 handoffs
      const g = graph(M, { W: 600, H: 280, pos: ring(M, .4, .37), R: 22, k: .58, uid: "L" });
      const last = M.evs.slice(-3).reverse().map(e => `<div class="wg-row tight tb-hr" data-item="${esc(e.item)}"><span class="tb-pr"><img src="${esc(A().avatarUrl(M.by[e.f]))}" alt=""><i>→</i><img src="${esc(A().avatarUrl(M.by[e.to]))}" alt=""></span><div class="t">${esc(e.title || e.item)}<small>${esc(A().aname(M.by[e.f]))} → ${esc(A().aname(M.by[e.to]))}</small></div><time>${hm(e.ms)}</time></div>`).join("");
      return eb(L(`24 小时 ${M.evs.length} 次`, `${M.evs.length} in 24 h`)) + `<div class="tb-lg">${g}</div>` + (oldNote() || `<div class="tb-last">${last || `<div class="tb-calm">${L("近 24 小时还没有交接", "No handoffs in the last 24 h")}</div>`}</div>`);
    },
  };
  function widget(s) { sync(); const M = model(null); return (W[s] || W.m)(M); }

  // ---------- the 团队 page ----------
  const stTxt = a => a.status === "working" ? L("在忙", "busy") : a.status === "sleeping" ? L("休眠", "asleep") : a.status === "offline" ? L("离线", "offline") : L("空闲", "idle");
  function qCard(a) {
    const app = A(), it = isB(a) ? app.liveItem(a) : null, q = app.queueOf ? app.queueOf(a.id) : [];   // t-ui-fix-r6 R6-08
    return `<div class="tb-qc${isB(a) ? " on" : ""}" style="--c:${tint(a)}"><div class="tb-qh" data-chat="${esc(a.id)}"><img src="${esc(app.avatarUrl(a))}" alt=""><b>${esc(app.aname(a))}</b><span class="tb-st ${esc(a.status || "idle")}">${stTxt(a)}${isB(a) && a.since ? ` · ${ago(a.since)}` : ""}</span></div>
      ${it ? `<div class="tb-qi now" data-item="${esc(it.id)}">▶ ${esc(it.title)}</div>` : ""}
      <div class="tb-qn">${L("排队", "Queued")} ${q.length}</div>
      ${q.length ? q.slice(0, 3).map(i => `<div class="tb-qi" data-item="${esc(i.id)}">· ${esc(i.title)}</div>`).join("") + (q.length > 3 ? `<div class="tb-qi more" data-aq="${esc(a.id)}">${L(`还有 ${q.length - 3} 张 ›`, `${q.length - 3} more ›`)}</div>` : "") : `<div class="tb-qi none">· ${L("空", "empty")}</div>`}</div>`;
  }
  const xPct = t => Math.max(0, Math.min(100, (t - (Date.now() - DAY)) / DAY * 100));
  function bar(M) {
    const t0 = Date.now() - DAY, hrs = [];
    for (let h = Math.ceil(t0 / 36e5) * 36e5; h <= Date.now(); h += 36e5) if (new Date(h).getHours() % 4 === 0) hrs.push(`<span style="left:${xPct(h).toFixed(2)}%">${hm(h)}</span>`);
    const cx = T.cursor == null ? 100 : xPct(T.cursor);
    const ticks = M.evs.map((e, i) => `<i class="${T.cursor == null || e.ms <= T.cursor ? "on" : ""}${e.inf ? " inf" : ""}" style="left:${xPct(e.ms).toFixed(2)}%;--c:${tint(M.by[e.f])}" title="${esc(`${hm(e.ms)} ${A().aname(M.by[e.f])} → ${A().aname(M.by[e.to])} · ${e.title || e.item}`)}" data-i="${i}"></i>`).join("");
    return `<div class="tb-rp"><button type="button" class="tb-play${T.playing ? " on" : ""}" data-tb-play aria-label="${T.playing ? L("暂停", "Pause") : L("回放", "Replay")}">${T.playing ? '<svg viewBox="0 0 24 24"><path d="M8 6v12M16 6v12"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z"/></svg>'}</button>
      <div class="tb-rt"><b>${L("回放", "Replay")}</b><small>${L(`近 24 小时 · ${M.evs.length} 次交接`, `last 24 h · ${M.evs.length} handoffs`)}</small></div>
      <div class="tb-bar" data-tb-bar tabindex="0" role="slider" aria-label="${L("回放进度", "Replay position")}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${cx.toFixed(0)}" aria-valuetext="${T.cursor == null ? L("现在", "now") : hm(T.cursor)}"><div class="tb-tk">${ticks}</div><div class="tb-cur" style="left:${cx.toFixed(2)}%"><u>${T.cursor == null ? L("现在", "now") : hm(T.cursor)}</u></div><div class="tb-hrs">${hrs.join("")}</div></div>
      <div class="tb-sp" role="radiogroup" aria-label="${L("回放速度", "Replay speed")}">${Object.keys(SPEEDS).map(v => `<button type="button" role="radio" aria-checked="${+v === T.speed}" class="${+v === T.speed ? "on" : ""}" data-tb-speed="${v}">${v}×</button>`).join("")}</div>
      <button type="button" class="tb-now${T.cursor == null ? " off" : ""}" data-tb-now>${L("回到现在", "Live")}</button></div>`;
  }
  const subOf = a => isW(a) ? (() => { const it = A().liveItem(a); return `<small>${a.since ? ago(a.since) : ""}</small>${it ? `<span class="tb-pill" data-item="${esc(it.id)}" style="--c:${tint(a)}">▶ ${esc(it.title)}</span>` : ""}`; })() : `<small>${a.id === "manager" ? L("管家", "manager") : stTxt(a)}</small>`;
  /* t-ui-fix-r3 R3-14: in a narrow page (wide chat) the 1000x580 graph scaled down while the HTML labels kept their size, so names sat on
     each other's avatars; under 640px the graph gets a taller frame (1000x900) so the ring spreads out vertically */
  const tallG = () => { const b = document.getElementById("pagebody"); return !!b && b.clientWidth > 0 && b.clientWidth < 640; };
  let tallWas = null;
  function graphBox(M) {
    tallWas = tallG();
    const live = T.cursor == null, cur = M.cur;
    return `<div class="tb-gh"><span>${L("线越粗 = 交接越多 · 颜色 = 谁递出去的 · 针 = 正在跑的那股", "thicker = more handoffs · colour = who passed it on · needle = the live one")}</span>${live ? "" : `<b class="tb-at">${L("回放", "Replay")} ${hm(T.cursor)}${cur ? ` · ${esc(A().aname(M.by[cur.f]))} → ${esc(A().aname(M.by[cur.to]))}：${esc(cur.title || cur.item)}` : ""}</b>`}</div>`
      + graph(M, { W: 1000, H: tallG() ? 900 : 580, pos: ring(M, .38, .38), R: 38, k: 1, uid: "P", labels: true, sub: live ? subOf : (a => `<small>${M.lit.has(a.id) ? "●" : ""}</small>`) });
  }
  function deskPage(head) {
    const M = model(T.cursor), all = model(null);
    const sum = `<div class="tb-sum"><b>${all.busy.length}</b> ${L("在忙", "busy")} · ${all.idle.length} ${L("空闲", "idle")} · ${L(`近 24 小时交接 <b>${all.evs.length}</b> 次`, `<b>${all.evs.length}</b> handoffs in 24 h`)}${T.err === "old" ? ` · <span class="tb-warn">${L("看板服务重启后才有交接记录", "restart the server to see handoffs")}</span>` : ""}</div>`;
    return `${head}<div class="tb-page">${sum}<div class="tb-gbox" data-tb-g>${graphBox(M)}</div>${bar(all)}<div class="tb-q">${all.ags.map(qCard).join("")}</div></div>`;
  }
  function phonePage(head) {
    const M = model(null);
    const rows = M.evs.slice(-15).reverse().map(e => `<div class="tb-pr-row" data-item="${esc(e.item)}"><span class="tb-pr"><img src="${esc(A().avatarUrl(M.by[e.f]))}" alt=""><i>→</i><img src="${esc(A().avatarUrl(M.by[e.to]))}" alt=""></span><div class="t">${esc(e.title || e.item)}<small>${esc(A().aname(M.by[e.f]))} → ${esc(A().aname(M.by[e.to]))}</small></div><time>${hm(e.ms)}</time></div>`).join("");
    return `${head}<div class="tb-page tb-ph"><div class="tb-sum"><b>${M.busy.length}</b> ${L("在忙", "busy")} · ${M.idle.length} ${L("空闲", "idle")} · ${L(`近 24 小时交接 <b>${M.evs.length}</b> 次`, `<b>${M.evs.length}</b> handoffs in 24 h`)}</div>
      <h3>${L("最近交接", "Recent handoffs")}</h3><div class="tb-list">${rows || `<div class="tb-calm">${T.err === "old" ? L("看板服务重启后才有交接记录", "Restart the server to see handoffs") : L("近 24 小时还没有交接", "No handoffs in the last 24 h")}</div>`}</div>
      <h3>${L("各人排队", "Queues")}</h3><div class="tb-q">${M.ags.map(qCard).join("")}</div></div>`;
  }
  function page(head) {
    sync();
    const body = document.getElementById("pagebody"), mine = body && body.querySelector(":scope > .tb-page");
    if (mine && (T.playing || T.drag)) return null;   // the replay paints in place
    const html = MOBQ.matches ? phonePage(head) : deskPage(head);
    const key = A().phaseFree ? A().phaseFree(html) : html;
    if (mine && key === T.pageKey && mine.classList.contains("tb-ph") === MOBQ.matches) return null;
    T.pageKey = key; T.shown = -1;
    requestAnimationFrame(fitBox);
    return html;
  }
  /* t-ri1111-a P3: a working node at the bottom hangs name + time + ▶ pill below the graph (26px past the frame onto the replay bar).
     Grow the frame's bottom padding just enough (+10px); written only when it changes, so polls do not jiggle it. */
  function fitBox() {
    const box = document.querySelector("#pagebody .tb-page [data-tb-g]"), gr = box && box.querySelector(".tb-gr"); if (!gr) return;
    const gb = gr.getBoundingClientRect().bottom; let low = gb;
    box.querySelectorAll(".tb-lab").forEach(l => { const b = l.getBoundingClientRect().bottom; if (b > low) low = b; });
    const pb = Math.max(18, Math.ceil(low - gb + 10)) + "px";
    if (box.style.getPropertyValue("--tb-pb") !== pb) box.style.setProperty("--tb-pb", pb);
  }
  addEventListener("resize", () => requestAnimationFrame(() => {
    const box = document.querySelector("#pagebody .tb-page [data-tb-g]");
    if (box && tallWas !== null && tallG() !== tallWas && !T.playing && !T.drag) { box.innerHTML = graphBox(model(T.cursor)); T.pageKey = null; }   /* R3-14: re-frame after a chat drag */
    fitBox();
  }));

  // ---------- replay ----------
  function paint() {   // in place: graph only when the visible step changed, cursor + ticks + labels always
    const box = document.querySelector("#pagebody .tb-page [data-tb-g]"), rp = document.querySelector("#pagebody .tb-page .tb-rp");
    if (!box || !rp) return;
    const M = model(T.cursor), step = T.cursor == null ? -2 : M.vis.length;
    if (step !== T.shown) { box.innerHTML = graphBox(M); T.shown = step; fitBox(); }
    const all = model(null), nb = document.createElement("div"); nb.innerHTML = bar(all);
    const fresh = nb.firstElementChild;
    const cur = rp.querySelector(".tb-cur"), fc = fresh.querySelector(".tb-cur");
    cur.style.left = fc.style.left; cur.innerHTML = fc.innerHTML;
    rp.querySelectorAll(".tb-tk i").forEach((el, i) => { const f = fresh.querySelectorAll(".tb-tk i")[i]; if (f) el.className = f.className; });
    const b = rp.querySelector("[data-tb-bar]"); ["aria-valuenow", "aria-valuetext"].forEach(k => b.setAttribute(k, fresh.querySelector("[data-tb-bar]").getAttribute(k)));
    const pl = rp.querySelector("[data-tb-play]"), fp = fresh.querySelector("[data-tb-play]"); pl.innerHTML = fp.innerHTML; pl.className = fp.className; pl.setAttribute("aria-label", fp.getAttribute("aria-label"));
    rp.querySelector("[data-tb-now]").classList.toggle("off", T.cursor == null);
    rp.querySelectorAll("[data-tb-speed]").forEach(x => { const on = +x.dataset.tbSpeed === T.speed; x.classList.toggle("on", on); x.setAttribute("aria-checked", on); });
  }
  function stop() { T.playing = false; clearInterval(T.timer); T.timer = 0; }
  function play() {
    if (T.playing) { stop(); paint(); return; }
    const t0 = Date.now() - DAY;
    if (T.cursor == null || T.cursor >= Date.now() - 1000) T.cursor = t0;
    T.playing = true;
    let last = performance.now();
    const step = RMQ.matches ? 1000 : 100;   // reduced motion: the cursor jumps once a second instead of gliding
    T.timer = setInterval(() => {
      const now = performance.now(), dt = now - last; last = now;
      if (!document.querySelector("#pagebody .tb-page")) { stop(); return; }
      T.cursor += dt * DAY / SPEEDS[T.speed];
      if (T.cursor >= Date.now()) { stop(); T.cursor = null; }
      paint();
    }, step);
    paint();
  }
  const fromX = (bar, x) => { const r = bar.getBoundingClientRect(); return Date.now() - DAY + Math.max(0, Math.min(1, (x - r.left) / r.width)) * DAY; };
  function seek(t) { T.cursor = t == null || t >= Date.now() - 6e4 ? null : t; paint(); }
  document.addEventListener("click", e => {
    const t = e.target.closest && e.target.closest("[data-tb-play],[data-tb-speed],[data-tb-now]");
    if (!t || !t.closest(".tb-page")) return;
    if (t.dataset.tbSpeed) { T.speed = +t.dataset.tbSpeed; paint(); }
    else if (t.hasAttribute("data-tb-play")) play();
    else { stop(); seek(null); }
  });
  document.addEventListener("pointerdown", e => {
    const b = e.target.closest && e.target.closest(".tb-page [data-tb-bar]"); if (!b || e.button > 0) return;
    stop(); T.drag = true; try { b.setPointerCapture(e.pointerId); } catch (_) { }
    seek(fromX(b, e.clientX));
    const mv = ev => seek(fromX(b, ev.clientX));
    const up = () => { T.drag = false; b.removeEventListener("pointermove", mv); b.removeEventListener("pointerup", up); b.removeEventListener("pointercancel", up); };
    b.addEventListener("pointermove", mv); b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up);
  });
  document.addEventListener("keydown", e => {
    const b = e.target.closest && e.target.closest(".tb-page [data-tb-bar]"); if (!b) return;
    const evs = model(null).evs; if (!evs.length && e.key !== "Escape" && e.key !== "End") return;
    const cur = T.cursor == null ? Infinity : T.cursor;
    let t;
    if (e.key === "ArrowLeft") { const p = [...evs].reverse().find(x => x.ms < cur - 1); t = p ? p.ms : evs[0].ms; }
    else if (e.key === "ArrowRight") { const n = evs.find(x => x.ms > cur + 1); t = n ? n.ms : null; }
    else if (e.key === "Home") t = evs[0].ms;
    else if (e.key === "End" || e.key === "Escape") t = null;
    else return;
    e.preventDefault(); stop(); seek(t);
  });

  if (A() && A().on) A().on(k => { if (k === "page") try { const p = A().UI.page; if (p === "review") sync(); if (T.playing) stop(); } catch (_) { } });
  window.Team = { widget, page, sync, _t: T, model };
})();
