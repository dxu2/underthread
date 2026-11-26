// t-home-widgets (plan v2, 方案 A, approved 11-02): the desktop 首页 as macOS-style widgets in a 4-column grid next to the chat.
// app.js calls Widgets.html(body) from PAGES.review while html[data-home="widgets"] (the desktop 首页, and a phone that turned on 设置 · 手机首页 = 小组件, t-home-sml P2).
// Widgets: 等你拍板 · 此刻在忙 · 新回复 · 今天交付 · 本周进度 · 常驻活动 · 最近素材. 团队 / 体力 / 日程 were dropped on purpose
// (the TEAM list, the stamina orb and 今日日程 already show them). An empty widget leaves the grid and becomes one quiet line
// above it. Layout (order, size, hidden) is per browser in localStorage rt.widgets; 编辑小组件 = remove / size / move / add back.
(() => {
  const A = () => window.App;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ms = x => Date.parse(x) || 0;
  const hm = t => { const d = new Date(t); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  const en = () => A().UI.lang === "en";
  /* r-improve-1119 P1: how long a card has waited on the user, from App.waitMs (last 提交审核), rounded down like the card tag */
  const waitAgo = i => { const m = Math.max(1, Math.floor((A().waitMs ? A().waitMs(i) : Date.now() - ms(i.activity || i.updated)) / 6e4)); if (en()) return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h` : `${Math.floor(m / 1440)} d`; return m < 60 ? `${m} 分钟` : m < 1440 ? `${Math.floor(m / 60)} 小时` : `${Math.floor(m / 1440)} 天`; };
  const ago = t => { const m = Math.max(1, Math.round((Date.now() - ms(t)) / 6e4)); if (en()) return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`; return m < 60 ? `${m} 分钟` : m < 1440 ? `${Math.round(m / 60)} 小时` : `${Math.round(m / 1440)} 天`; };
  const art = a => A().hasArt(a, "jpg") ? `/static/art/${a.id}.jpg` : A().avatarUrl(a);
  const fileUrl = p => "/" + String(p).split("/").map(encodeURIComponent).join("/");
  const WD = "日一二三四五六";

  // ---------- layout ----------
  /* t-oss-struct S8: every widget, core ones included, is registered with UTExt.widget (web/ext.js; the core nine at the bottom of this file).
     SIZES / nm() read the registry, so an extension's widget sizes, names, edits and drags like a core one. */
  const REG = () => window.UTExt ? UTExt.widgetOf : () => null;
  const SIZES = new Proxy({}, { get: (_, k) => { const w = REG()(k); return w ? w.sizes : undefined; } });
  const allIds = () => window.UTExt ? UTExt.widgets().map(w => w.id) : [];
  /* the default layout: the core nine in this order, then any extension widget at its own size; 恢复默认 shows this */
  /* t-section-titles (user 11-21): 等你拍板 first and full width (pinned there, see html()), 团队交接 gone from the home (its busy count lives in the
     此刻在忙 label now), 最近 = the five cards that moved last, at the bottom */
  const DEF_CORE = [["setup", "w"], ["review", "l"], ["usage", "l"], ["busy", "l"], ["replies", "l"], ["today", "m"], ["week", "m"], ["ongoing", "m"], ["media", "m"]];
  const defL = () => [...DEF_CORE.filter(x => REG()(x[0])), ...(window.UTExt ? UTExt.widgets().filter(w => !w.core) : []).map(w => [w.id, w.size])];
  const DEF = { map: f => defL().map(f) };   // DEF.map(x => x.slice()) as before
  /* t-section-titles (user 11-21 23:50 「recent 这个 panel 有点冗余」): 最近 stays in 添加小组件 but is off by default; a board that already got it
     once loses it once. "recent-off" in meta.widgets.seen (rt.recentOff for a browser-only layout) marks that this was done, so adding it back sticks. */
  const OPTIN = new Set(["recent"]), RC_OFF = "recent-off";
  const KEY = "rt.widgets";
  const loadLocal = () => { try { let v = JSON.parse(localStorage.getItem(KEY) || "null"); if (Array.isArray(v) && v.length && v.every(x => Array.isArray(x) && typeof x[0] === "string")) {
      v = v.filter(x => SIZES[x[0]]);
      if (!localStorage.getItem("rt.recentOff")) { localStorage.setItem("rt.recentOff", "1"); if (v.some(x => x[0] === "recent")) { v = v.filter(x => x[0] !== "recent"); localStorage.setItem(KEY, JSON.stringify(v)); } }   // S8: an id whose widget is not registered (an extension that is gone) drops out
      // t-home-usage / t-rb-build: a browser-only layout from before 用量 / 团队交接 existed gets them once (the server path uses meta.widgets.seen)
      if (!v.some(x => x[0] === "usage") && !localStorage.getItem("rt.wgUsage")) { v.unshift(["usage", "l"]); localStorage.setItem("rt.wgUsage", "1"); localStorage.setItem(KEY, JSON.stringify(v)); }
      if (v.length) return v; } } catch { } return DEF.map(x => x.slice()); };
  const saveLocal = L => { try { localStorage.setItem(KEY, JSON.stringify(L)); } catch { } };
  /* t-widget-drag (11-11, option a): the layout lives on the server (meta.widgets, action widget_layout), so every computer you open it on shows the
     same home. localStorage stays as this browser's cache. meta.widgets missing = never saved: this browser's old layout is uploaded once.
     meta.widgets.layout null = 恢复默认. PEND keeps a just-made change on screen until the poll brings it back (a poll in flight would undo it). */
  let PEND = null;
  const known = v => Array.isArray(v) ? v.map(x => Array.isArray(x) && x[0] === "review" && x[1] === "w" ? ["review", "l"] : x).filter(x => Array.isArray(x) && SIZES[x[0]] && SIZES[x[0]].includes(x[1])) : null;
  const srv = () => { const m = A() && A().ST && A().ST.meta; return m ? m.widgets : undefined; };   // undefined = no state yet, null = never saved
  const seenNow = () => { const w = srv(); return [...new Set([...(w && Array.isArray(w.seen) ? w.seen : []), ...allIds(), RC_OFF])].sort(); };
  /* t-home-sml: meta.widgets.chosen = ids whose size the user picked by hand; a short L tile then stays L (the auto shrink below is only for sizes nobody picked).
     Missing = nothing picked (old boards look exactly as before). LCH = picked in this browser (also the cache for a browser-only layout), cleared by 恢复默认. */
  let LCH = (() => { try { const v = JSON.parse(localStorage.getItem("rt.wgChosen") || "[]"); return new Set(Array.isArray(v) ? v : []); } catch { return new Set(); } })();
  const chosen = () => { const w = srv(); if (PEND && PEND.L === null) return new Set(); return new Set([...(w && Array.isArray(w.chosen) ? w.chosen : []), ...LCH]); };
  const pick = k => { LCH.add(k); try { localStorage.setItem("rt.wgChosen", JSON.stringify([...LCH])); } catch { } };
  const push = L => send(L ? { kind: "widget_layout", layout: L, seen: seenNow(), chosen: [...chosen()].filter(k => L.some(x => x[0] === k)) } : { kind: "widget_layout", reset: true, seen: seenNow() }, L);
  const send = (body, L) => { PEND = { L: L ? JSON.stringify(L) : null, t: Date.now() };
    fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(r => { if (!r.ok) throw new Error(r.status); }).catch(() => { PEND = null; if (A() && A().toast) A().toast(en() ? "Layout not saved on the server" : "布局没存到服务器，只存在了这个浏览器", true); }); };
  const load = () => {
    const w = srv(), now = Date.now();
    /* a cold start paints the offline snapshot first (store.js snapBoot, UI.snap): it can be hours old or older than the server layout, so
       that paint only draws. Uploading from it put this browser's cached rt.widgets over a newer server layout and dropped its chosen sizes. */
    const snap = !!(A() && A().UI && A().UI.snap);
    if (PEND) {
      const got = w && (w.layout ? JSON.stringify(w.layout) : null);
      if (w && got === PEND.L || now - PEND.t > 15000) PEND = null;
      else return PEND.L ? JSON.parse(PEND.L) : DEF.map(x => x.slice());
    }
    if (w && typeof w === "object") { let v = known(w.layout);
      if (v && !snap && !(Array.isArray(w.seen) && w.seen.includes(RC_OFF)) && !rcOff.sent) { rcOff.sent = 1; const had = v.some(x => x[0] === "recent"); v = v.filter(x => x[0] !== "recent");   // once: 最近 out again
        if (v.length) { send({ kind: "widget_layout", layout: v, seen: seenNow() }, v); saveLocal(v); return v; } }
      let L = v && v.length ? v : DEF.map(x => x.slice()); if (snap) return L; L = meet(w, L, !!(v && v.length)); saveLocal(L); return L; }
    const L = loadLocal();
    if (!snap && (w === null || (A() && A().ST && A().ST.meta && !("widgets" in A().ST.meta)))) {   // first load against a server that has no layout yet: upload this browser's once
      let had = null; try { had = localStorage.getItem(KEY); } catch { }
      if (had && !push.once) { push.once = 1; push(L); }
    }
    return L;
  };
  /* S8 (the server path; replaces rt.wgUsage / rt.wgTeam there): meta.widgets.seen lists every widget id this board has met. No list yet = everything
     registered now counts as met (the upgrade inserts nothing). A registered id not on it is new: it goes into a saved layout once
     (first: true = at the front, else at the end) and joins seen; removing it later sticks. A default layout (null) shows it anyway. */
  let MET = ""; const rcOff = {};
  /* S9: the page scripts are modules and extension scripts are deferred after them, so readyState is already "interactive" here while
     extensions are still to come: DOMContentLoaded is the first moment every script has run */
  let BOOTED = document.readyState === "complete";
  document.addEventListener("DOMContentLoaded", () => { BOOTED = true; if (A() && A().ST && document.documentElement.dataset.home === "widgets") A().refreshPage(); });
  function meet(w, L, saved) {
    const ids = allIds();
    if (!ids.length || !BOOTED) return L;   // extension scripts (after this file) have not registered yet
    const seen = Array.isArray(w.seen) ? w.seen : null, fresh = seen ? ids.filter(k => !seen.includes(k) && !OPTIN.has(k)) : [];   // an opt-in widget is only offered in 添加小组件
    if (seen && !fresh.length) return L;
    const all = [...new Set([...(seen || []), ...ids, RC_OFF])].sort(), key = all.join(",");
    if (MET === key) return L;   // sent once already; PEND keeps it on screen until the poll brings it back
    MET = key;
    if (saved && fresh.length) {
      L = L.slice();
      fresh.forEach(k => { if (L.some(x => x[0] === k)) return; const x = REG()(k), e = [k, x.size]; if (x.first) L.unshift(e); else L.push(e); });
      L = L.slice(0, 24);
    }
    send(saved ? { kind: "widget_layout", layout: L, seen: all } : { kind: "widget_layout", reset: true, seen: all }, saved ? L : null);
    return L;
  }
  const save = L => { saveLocal(L); push(L); };
  const reset = () => { try { localStorage.removeItem(KEY); localStorage.removeItem("rt.wgChosen"); } catch { } LCH = new Set(); push(null); };
  const nm = k => { const w = REG()(k), n = w && w.name; return n ? (en() ? n[1] || n[0] : n[0]) : k; };
  let EDIT = false;

  // ---------- data ----------
  function data() {
    const app = A(), its = app.items(), ST = app.ST;
    const agents = Object.values(ST.agents || {}).filter(a => a.enabled !== false);
    const waiting = its.filter(i => app.onYouCard(i) || (app.onYou(i) && app.awaitsUser(i))).sort((a, b) => ms(b.activity || b.updated) - ms(a.activity || a.updated));   // t-waiting-sort (user 11-10): latest response first, same as the phone list (App.byAct)
    const busy = agents.map(a => ({ a, it: app.liveItem(a), since: a.since || a.last_seen })).filter(x => x.a.status === "working" && x.it)
      .sort((x, y) => ms(y.since) - ms(x.since));   // newest start takes the big slot
    const nr = app.newReplies(), today = new Date().toDateString();
    const shipped = its.filter(i => i.stage === "done" && i.closed && new Date(i.closed).toDateString() === today).sort((a, b) => ms(b.closed) - ms(a.closed));
    const days = [...Array(7)].map((_, k) => { const d = new Date(Date.now() - (6 - k) * 864e5); return { d, n: its.filter(i => i.stage === "done" && i.closed && new Date(i.closed).toDateString() === d.toDateString()).length }; });
    const live = its.filter(i => i.stage !== "done"), rp = (ST.meta && ST.meta.routines_paused) || {};
    const ongoing = its.filter(i => i.category === "ongoing" && i.stage !== "done").sort((a, b) => ms(b.activity) - ms(a.activity));
    const imgs = []; its.slice().sort((a, b) => ms(b.activity) - ms(a.activity)).forEach(i => [...(i.draft_attachments || []), ...(i.attachments || [])].forEach(p => { if (/\.(png|jpe?g|webp|gif)$/i.test(p) && !imgs.some(x => x.p === p) && imgs.length < 9) imgs.push({ p, it: i }); }));
    const recent = its.filter(i => !i.archived).sort((a, b) => ms(b.activity || b.updated) - ms(a.activity || a.updated)).slice(0, 5);   /* t-section-titles 最近 */
    return { recent, waiting, busy, nr, shipped, days, doing: live.filter(i => app.grpOf(i) === "doing").length, todo: live.filter(i => app.grpOf(i) === "todo").length, ongoing, rp, imgs };
  }
  /* t-onboarding P0: gone() = the widget is retired (the 开工清单 once setup is done): no tile, no calm line, and 「添加小组件」 offers it,
     whose click calls revive() to bring it back. A layout keeps its entry, so nothing has to be saved when it retires. */
  const isGone = k => { const w = REG()(k); try { return !!(w && w.gone && w.gone()); } catch (e) { return false; } };
  const isEmpty = (k, D) => { const w = REG()(k); try { return !!(w && w.empty && w.empty(D)); } catch (e) { return false; } };
  /* r-improve-1117 P4: ✓ only in front of good news (没有新回复 / 没有等你拍板的); 「今天还没有交付」 etc. (calm[2] === false) follow without a tick, a shade dimmer. Extension widgets keep the ✓. */
  const calmHTML = cs => { const ok = cs.filter(c => c[1]).map(c => c[0]), no = cs.filter(c => !c[1]).map(c => c[0]);
    return cs.length ? `<span class="wg-calm">${ok.length ? "✓ " + ok.map(esc).join(" · ") : ""}${ok.length && no.length ? " · " : ""}${no.length ? `<span class="nc">${no.map(esc).join(" · ")}</span>` : ""}</span>` : ""; };
  const calmText = k => { const c = (REG()(k) || {}).calm || [nm(k), nm(k)]; return en() ? c[1] || c[0] : c[0]; };
  /* html(size, D, kit): kit = the helpers core widgets use (eb = the eyebrow line). A widget that throws draws a quiet line instead of breaking the home. */
  const tileHTML = (k, s, D) => { try { return REG()(k).html(s, D, { eb, esc, ago, hm, en: en() }); } catch (e) { console.warn("widget " + k, e); return eb(k) + `<div class="wg-calm-in">${en() ? "This widget failed to draw" : "这个小组件出错了"}</div>`; } };

  // ---------- widgets ----------
  /* t-widget-num-b: number + unit split so the desk leather tab (widgets.css .wnb-num) wraps only the digits */
  const wnb = n => { const m = /^(\d+)\s*(.*)$/.exec(String(n)); return m ? `<span class="n wnb"><span class="wnb-num">${m[1]}</span>${m[2] ? `<span class="wnb-unit">${m[2]}</span>` : ""}</span>` : `<span class="n">${n}</span>`; };
  window.WgNum = wnb;
  /* t-section-titles: one line under each sewn label saying what the section is (shown under the Underthread skins only, widgets.css) */
  const SUB = { review: ["要你点头、回答或改的卡", "Cards that need your yes, an answer or an edit"], busy: ["此刻谁在做哪张卡", "Who is on a card right now"],
    usage: ["今天各角色用了多少", "Tokens spent today, by teammate"], replies: ["队友回你了", "Teammates answered you"], today: ["今天跑完的和交的", "Today's runs and deliveries"],
    week: ["近 7 天交了多少", "What shipped in the last 7 days"], ongoing: ["常驻的活", "Standing jobs"], media: ["最近出的图和片段", "Pictures and clips made lately"],
    recent: ["最近动过的卡 · 点一下回到那张卡", "Cards that moved lately · click to jump back in"] };
  const sub = k => SUB[k] ? `<span class="sct-sub">${en() ? SUB[k][1] : SUB[k][0]}</span>` : "";
  const eb = (k, n, dot) => `<div class="wg-eb">${dot ? '<span class="wg-dot"></span>' : ""}<b>${nm(k)}</b>${n != null ? wnb(n) : ""}${bplKnot(k)}</div>${sub(k)}`;
  /* t-ri1114-a P3: open asks outrank the card kind (a plan card with unanswered asks read as a grey 「方案」) */
  const askN = i => i.stage !== "review" ? A().openAsks(i).length : 0;
  const isQ = i => i.kind === "question" || askN(i) > 0;
  const kindL = i => isQ(i) ? (en() ? "Question" : "问题") : i.kind === "plan" ? (en() ? "Plan" : "方案") : (en() ? "Review" : "待验收");
  const rowsFit = (s, big, small) => s === "l" ? big : small;
  // t-home-motion: a medium widget holds two rows and nothing else. Two or fewer: both rows, no footer (each row already says how long);
  // more: one row + 「还有 N 件 ›」 (the footer used to be clipped by ~21px under two rows)
  const fitM = (s, len, big) => s === "l" ? { n: big, foot: true } : len <= 2 ? { n: 2, foot: false } : { n: 1, foot: true };
  const W = {
    usage(s) {   // t-home-usage: tokens per role today + the quota strip; markup shared with the phone card / 系统状态 (App.ruHTML)
      if (s === "s") return `<div class="wg-eb" data-ru-open><b>${nm("usage")}</b><span>${en() ? "today" : "今天"}</span></div>` + A().ruHTML(0, { tot: true, quota: true, fit: true, v3: true });   /* t-home-sml S: today's total + the quota line */
      const R = A().roleUsage && A().roleUsage(), all = R && R.rows && R.rows.length;   // t-sync-pill batch 2: 「全部 N 位 ›」 replaces the bottom 「+N more」 line
      return `<div class="wg-eb" data-ru-open><b>${nm("usage")}</b><span>${en() ? "today" : "今天"}</span>${all ? `<span class="n ru-all">${en() ? `all ${all} ›` : `全部 ${all} 位 ›`}</span>` : `<span class="n">token</span>`}</div>${sub("usage")}`
        + A().ruHTML(s === "l" ? 7 : 4, { tot: s === "l", quota: true, soul: true, fit: true, v3: true });   /* t-soul-widget: lower half = Soul rows per model */
    },
    review(s, D) {
      if (s === "s") { const o = D.waiting.reduce((a, b) => (A().waitMs ? A().waitMs(b) > A().waitMs(a) : 0) ? b : a);   /* t-home-sml S: count + the oldest card */
        return eb("review", null, true) + `<div class="wg-big">${D.waiting.length}</div><div class="wg-sub">${en() ? "oldest waiting" : "最久等了"} ${waitAgo(o)}</div><div class="wg-more clamp2" data-item="${esc(o.id)}">${esc(o.title)}</div>`; }
      const W2 = s === "w", L = D.waiting, { n, foot } = W2 ? { n: L.length > 4 ? 10 : 4, foot: true } : fitM(s, L.length, 5);   /* t-section-titles: full width = two columns of up to 4 rows */
      const row = i => { const a = A().agent(i.owner);
        return `<div class="wg-row" data-item="${esc(i.id)}"><img class="wg-av" src="${A().avatarUrl(a)}" alt=""><div class="t">${A().nrDot ? A().nrDot(i.id) : ""}${window.Onboard ? Onboard.exT(i) : esc(i.title)}<small>${esc(A().aname(a))} · ${en() ? "waiting" : "等了"} ${waitAgo(i)}${askN(i) ? (en() ? ` · ${askN(i)} question${askN(i) > 1 ? "s" : ""}` : ` · ${askN(i)} 个问题`) : ""}</small></div>${i.snoozed ? `<span class="wg-tg snz">${en() ? "Snoozed" : "推迟过"}</span>` : ""}<span class="wg-tg${i.kind === "plan" && !isQ(i) ? "" : " hot"}">${kindL(i)}</span></div>`; };
      /* t-ri1113-a P3: the same sweep question on 3+ cards is one group row (2 row slots, its buttons answer them all); 逐张看 lists them under it.
         A medium tile has no room for the buttons: the group is one compact row there and a click opens the board. */
      const E = A().askGroups ? A().askGroups(L) : L.map(it => ({ it }));
      let slots = 0, shown = 0; const out = [];
      for (const e of E) {
        if (e.g) {
          const w = s !== "m" ? 2 : 1; if (out.length && slots + w > n) break;
          out.push(s !== "m" ? A().grpHTML(e.g, "wg") : `<div class="wg-row ri13-c" data-go="board"><span class="ri13-n">${e.g.items.length}</span><div class="t">${esc(e.g.a.q)}<small>${en() ? `same question on ${e.g.items.length} cards` : `${e.g.items.length} 张卡同一个问题`}</small></div><span class="wg-tg hot">${en() ? "Question" : "问题"}</span></div>`);
          slots += w; shown += e.g.open && s !== "m" ? 0 : e.g.items.length;
          if (e.g.open && s !== "m") for (const i of e.g.items) { if (slots + 1 > n) break; out.push(row(i).replace('class="wg-row"', 'class="wg-row ri13-m"')); slots++; shown++; }
        } else { if (slots + 1 > n) break; out.push(row(e.it)); slots++; shown++; }
      }
      return eb("review", L.length, true) + (W2 ? `<div class="sct-rows">${out.join("")}</div>` : out.join("")) +
        (!foot ? "" : L.length <= shown && window.Onboard && Onboard.exFoot() ? Onboard.exFoot() : `<div class="wg-more">${L.length > shown ? `<span data-go="board">${en() ? `${L.length - shown} more ›` : `还有 ${L.length - shown} 件 ›`}</span>` : `${en() ? "Oldest waiting" : "最久的已经等了"} ${waitAgo(L.reduce((a, b) => (A().waitMs ? A().waitMs(b) > A().waitMs(a) : 0) ? b : a))}`}</div>`);
    },
    busy(s, D) {
      if (s === "s") { const B = D.busy, m = B[0], bw = Math.min(100, Math.round((Date.now() - ms(m.since)) / 6e4 / 120 * 100));   /* t-home-sml S: stacked faces + who is on what */
        return eb("busy", en() ? `${B.length} busy` : `${B.length} 人在忙`) + `<div class="sml-stack">${B.slice(0, 4).map(x => `<img class="wg-av" src="${A().avatarUrl(x.a)}" alt="" data-chat="${esc(x.a.id)}">`).join("")}</div>`
          + `<div class="sml-who" data-item="${esc(m.it.id)}"><b>${esc(A().aname(m.a))}</b><span>${esc(m.it.title)}</span></div><i class="sml-bar"><em style="width:${bw}%"></em></i>`; }
      const B = D.busy, m = B[0], a = m.a, side = B.slice(1, s === "l" ? 3 : 1), more = B.length - 1 - side.length, multi = B.length > 1;
      const bar = x => Math.min(100, Math.round((Date.now() - ms(x.since)) / 6e4 / 120 * 100));   // elapsed, on a 2-hour scale
      /* t-ut-avatar-working: under Underthread the card shows the needle-thread patch (avatars/ut/_s, the 4-frame work sheet when the role has one)
         instead of the character art; the section is then .utav (a plain card, so leather dyes it), not .hero. Ink keeps the art.
         data-noidle (fx.js): power saving pauses every loop after 20 s without input or when the window loses focus, which froze this patch while the user
         was just looking at it (11-11 00:18). This one patch keeps moving; everything else still pauses. */
      const ut = !!document.documentElement.dataset.ut, ws = ut && A().wsheet ? A().wsheet(a, 320) : "";
      const utp = `<i class="wg-utp${ws ? " ws" : ""}" data-chat="${esc(a.id)}" title="${esc(A().aname(a))}" style="background-image:url('${A().avatarUrl(a, 1)}')${ws}${ws ? `;--wg-fd:-${Date.now() % 16000}ms` : ""}"></i>`;
      /* t-yarn-anim (user 11-22 10:21): the yarn kitten plays by the working role's patch (core/yarnkit.js; norm() below keys it by data-ykk) */
      return (ut ? `<div class="wg-utav" data-noidle>${A().yk ? A().yk(a, utp, true) : utp}</div>`   /* v4: same phase as App.av (--wp = Date.now() % 16000, t-yarn-anim), so this patch and the Team column show the same frame */
        : `<div class="wg-bg" style="background-image:url('${art(a)}')"></div><div class="wg-sh"></div>`) + `
        <div class="wg-top">${eb("busy", en() ? `${B.length} busy` : `${B.length} 人在忙`)}</div>
        <div class="wg-in"><h3 data-chat="${esc(a.id)}"><span class="wg-hn">${esc(A().aname(a))}</span><small>${esc(A().atitle(a) || "")}</small>${A().qBadge ? A().qBadge(a.id) : ""}</h3>
        <div class="wg-job" data-item="${esc(m.it.id)}" style="--wg-fd:-${Date.now() % 2400}ms"><span>${esc(m.it.title)}</span><b>${hm(m.since)} ${en() ? "start" : "起"} · ${ago(m.since)} ›</b></div>
        ${side.length || more > 0 ? `<div class="wg-side">${side.map(x => `<div class="wg-sr" data-item="${esc(x.it.id)}"><img src="${A().avatarUrl(x.a)}" alt="" data-chat="${esc(x.a.id)}"><div class="st"><b><span class="wg-nm">${esc(A().aname(x.a))}</span>${A().qBadge ? A().qBadge(x.a.id) : ""}</b><span>${esc(x.it.title)}</span><i><em style="width:${bar(x)}%"></em></i></div><time>${ago(x.since)}</time></div>`).join("")}${more > 0 ? `<div class="wg-sr plus" data-go="board">${en() ? `+${more} more working ›` : `+${more} 人在忙 · 看全部 ›`}</div>` : ""}</div>` : ""}</div>`;
    },
    replies(s, D) {
      if (s === "s") { const g = D.nr[0], m = g.ms[g.ms.length - 1], a = A().agent(m.agent);   /* t-home-sml S: unread count + the latest one */
        return eb("replies") + `<div class="wg-big">${D.nr.length}</div><div class="sml-who" data-item="${esc(g.it.id)}"><b>${esc(A().aname(a))}</b><span>${esc(A().mailPv ? A().mailPv(m.text, a) : String(m.text || ""))}</span></div>`; }
      const { n } = fitM(s, D.nr.length, 4);
      return eb("replies", D.nr.length) + D.nr.slice(0, n).map(g => { const m = g.ms[g.ms.length - 1], a = A().agent(m.agent);
        return `<div class="wg-row" data-item="${esc(g.it.id)}"><img class="wg-av" src="${A().avatarUrl(a)}" alt=""><div class="t">${esc(g.it.title)}<small>${esc(A().mailPv ? A().mailPv(m.text, a) : String(m.text || ""))}</small></div><time>${ago(m.t)}</time></div>`; }).join("") +
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
      if (s === "l") { const top = D.days.reduce((a, b) => b.n > a.n ? b : a), dn = x => en() ? "Sun Mon Tue Wed Thu Fri Sat".split(" ")[x.d.getDay()] : "周" + WD[x.d.getDay()];   /* t-home-sml L: three numbers, a big chart with each day's count, the busiest day */
        return eb("week") + `<div class="sml-wk3" data-go="board">${[[wk, en() ? "shipped" : "交付"], [D.doing, en() ? "doing" : "进行中"], [D.todo, en() ? "to do" : "待办"]].map(x => `<div><span class="wg-big">${x[0]}</span><small>${x[1]}</small></div>`).join("")}</div>`
          + `<div class="sml-wkl" data-go="board"><div class="wg-bars">${D.days.map((x, k) => `<span class="${k === 6 ? "on" : ""}" style="height:${Math.max(4, Math.round(x.n / max * 100))}%"><b>${x.n}</b></span>`).join("")}</div><div class="wg-bl">${D.days.map(x => `<i>${en() ? "SMTWTFS"[x.d.getDay()] : WD[x.d.getDay()]}</i>`).join("")}</div></div>`
          + `<div class="wg-more">${top.n ? (en() ? `Busiest ${dn(top)} · ${top.n}` : `最忙 ${dn(top)} · ${top.n} 件`) : (en() ? "Nothing shipped this week" : "这周还没有交付")}</div>`; }
      return eb("week") + `<div class="wg-wk" data-go="board"><div><div class="wg-big">${wk}</div><div class="wg-sub">${en() ? `7-day shipped · doing ${D.doing} · to do ${D.todo}` : `7 天交付 · 进行中 ${D.doing} · 待办 ${D.todo}`}</div></div><div class="wg-col">${bars}</div></div>`;
    },
    ongoing(s, D) {
      const meta = A().ST.meta || {}, RK = new Set([...Object.keys(meta.routines_fired || {}), ...Object.keys(D.rp)]);
      const isR = i => RK.has(i.id.replace(/^r-/, "")), paused = i => !!D.rp[i.id.replace(/^r-/, "")];
      /* t-home-sml L: six rows, each with its next run (a fixed clock time, so the tile does not redraw as time passes) */
      const nx = i => { if (s !== "l") return ""; const t = (A().ST.schedules || []).filter(x => x.enabled && x.next && (x.routine && "r-" + x.routine === i.id || String(x.title || "").includes(i.id))).map(x => x.next).sort((a, b) => ms(a) - ms(b))[0];
        if (!t) return ""; const d = new Date(t), td = new Date().toDateString(), tm = new Date(Date.now() + 864e5).toDateString();
        const day = d.toDateString() === td ? (en() ? "today" : "今天") : d.toDateString() === tm ? (en() ? "tomorrow" : "明天") : (en() ? `${d.getMonth() + 1}/${d.getDate()}` : `${d.getMonth() + 1}月${d.getDate()}日`);
        return `<small>${en() ? `next ${day} ${hm(t)}` : `下次 ${day} ${hm(t)}`}</small>`; };
      return eb("ongoing", D.ongoing.length) + D.ongoing.slice(0, s === "s" ? 2 : s === "l" ? 6 : 3).map(i => `<div class="wg-row tight${s === "l" ? " sml-on" : ""}" data-item="${esc(i.id)}"><div class="t">${esc(i.title)}${nx(i)}</div>${isR(i) ? `<span class="wg-tg">${paused(i) ? (en() ? "Paused" : "暂停") : (en() ? "Daily" : "每天")}</span>` : ""}</div>`).join("");
    },
    recent(s, D) {   /* t-section-titles: the five cards that moved last, as small tiles; a click opens the card */
      return eb("recent") + `<div class="sct-tiles">${D.recent.map(i => { const a = A().agent(i.owner);
        return `<div class="sct-tile" data-item="${esc(i.id)}"><b>${esc(i.title)}</b><div class="sct-meta"><img class="wg-av" src="${A().avatarUrl(a)}" alt=""><span>${esc(A().aname(a))} · ${ago(i.activity || i.updated)}</span></div></div>`; }).join("")}</div>`;
    },
    media(s, D) {
      const n = s === "s" ? 4 : s === "l" ? 9 : 3;   /* t-home-sml L: 3 × 3 */
      return eb("media", D.imgs.length) + `<div class="wg-thumbs${s === "l" ? " sml-g9" : ""}" style="--tc:${s === "s" ? 2 : 3}">${D.imgs.slice(0, n).map(x => { const u = fileUrl(x.p), name = esc(x.p.split("/").pop());
        return `<a href="${u}" target="_blank" class="lb-th" data-lb="${u}" data-kind="image" data-name="${name}" style="background-image:url('/api/thumb?p=${encodeURIComponent(x.p)}&w=360')"></a>`; }).join("")}</div>`;
    },
  };
  const sizeBtns = (k, s) => `<span class="wg-sz">${SIZES[k].map(z => `<button type="button" data-wg-size="${k}:${z}" class="${z === s ? "on" : ""}">${z.toUpperCase()}</button>`).join("")}</span>`;
  const editBar = (k, s, i, n) => k === "review" ? `<i class="wg-eband" aria-hidden="true"></i><button type="button" class="wg-x" data-wg-hide="${k}" title="${en() ? "Remove" : "移除"}" aria-label="${en() ? "Remove widget" : "移除这个小组件"}">−</button>${sizeBtns(k, s)}<span class="sct-pin">${en() ? "Always first · S = small, M = half, L = full width" : "固定在最上面 · S 小方块 · M 半行 · L 占满一行"}</span>` : `<i class="wg-eband" aria-hidden="true"></i><button type="button" class="wg-x" data-wg-hide="${k}" title="${en() ? "Remove" : "移除"}" aria-label="${en() ? "Remove widget" : "移除这个小组件"}">−</button>${sizeBtns(k, s)}<span class="wg-mv">${i > 0 ? `<button type="button" data-wg-move="${k}:-1">←</button>` : ""}${i < n - 1 ? `<button type="button" data-wg-move="${k}:1">→</button>` : ""}</span>`;

  // t-home-flicker (11-03): the HTML carries wall-clock phases (--wg-fd) so a rebuilt node does not restart the sweep; they are not data,
  // so every compare strips them. Same data: keep the DOM. Changed data (C): replace only the tiles / header / tail / tray whose HTML changed,
  // the rest keep their nodes (thumbs, hover highlight, running animations). mvPage is told via MV.dirty so new rows / moved tiles still animate.
  const norm = h => h.replace(/--wg-fd:-\d+ms|animation-delay:-\d+ms| tl-(?:in|out)/g, "")   /* t-chrome-badge: the badge motion state is not a change */
    .replace(/<span class="yk [^"]*"([^>]*?) data-ykk="([^"]*)"[^>]*>/g, '<span ykk="$2">')   /* t-yarn-anim: a kitten beat / its phase is not a change, only data-ykk */
    .replace(/(<time class="rel"[^>]*>)[^<]*/g, "$1")
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
  /* ===== t-board-pulse (user pick A, 11-21): when a home board gets something new, its label is tugged once (a small damped wiggle) and one
     stitch of light runs around the board's border; then a knot stays on the label until you have seen it: 0.8 s hover, a click on the board,
     or 2 s fully on screen while the window has focus. Anti-spam: a board cues at most once every 20 s (changes in between only move the
     numbers and keep the knot; this also merges a burst inside 1.5 s); at most 2 boards cue at once, 150 ms apart, 等你拍板 → 此刻在忙 → the
     rest; quiet hours (ticker quietNight) and a hidden tab show the knot only, a hidden tab replays once on return. Reduced motion: the label
     brightens for 300 ms, nothing moves. Only transform (rotate / translate / scale), opacity and stroke-dashoffset animate. Desk home only. */
  const BPL_K = ["review", "busy", "replies", "today", "ongoing", "media"], BPL_GAP = 20000, BPL_SEEN_HOVER = 800, BPL_SEEN_VIEW = 2000;
  const BPL = { sig: null, last: {}, unseen: new Set(), q: new Set(), pend: new Set(), view: {}, hov: null };
  try { JSON.parse(localStorage.getItem("rt.bpUnseen") || "[]").forEach(k => BPL_K.includes(k) && BPL.unseen.add(k)); } catch (e) { }
  const bplSave = () => { try { localStorage.setItem("rt.bpUnseen", JSON.stringify([...BPL.unseen])); } catch (e) { } };
  const bplSig = D => ({ review: D.waiting.map(i => i.id), busy: D.busy.map(x => x.a.id + ":" + x.it.id), replies: D.nr.map(g => g.it.id + "@" + ((g.ms[g.ms.length - 1] || {}).t || "")),
    today: D.shipped.map(i => i.id), ongoing: D.ongoing.map(i => i.id + "@" + (i.activity || "")), media: D.imgs.map(x => x.p) });
  const bplKnot = k => BPL.unseen.has(k) ? `<i class="bpl-knot" aria-hidden="true" title="${en() ? "New since you last looked" : "有新内容，还没看"}"></i>` : "";
  const bplTile = k => document.querySelector(`html[data-home="widgets"] #wg .wg-grid > .wg[data-wg="${k}"]`);
  const bplDesk = () => matchMedia("(min-width: 761px)").matches && document.documentElement.dataset.home === "widgets";
  function bplScan(D) {   // called from html() with the data it draws: a board whose list gained an entry gets a cue
    const S = bplSig(D), P = BPL.sig; BPL.sig = S;
    if (!P || EDIT || !bplDesk()) return;
    const hit = BPL_K.filter(k => S[k].some(x => !P[k].includes(x)));
    if (!hit.length) return;
    hit.forEach(k => BPL.unseen.add(k)); bplSave();
    BPL.fresh = new Set(hit.flatMap(k => S[k].filter(x => !P[k].includes(x)).map(x => x.split("@")[0].split(":").pop())));   // item ids of the rows that are new
    const quiet = (A() && A().quietNight ? A().quietNight() : false) || !!(window.Tour && Tour.isOpen());   // t-onboard-tour: the knot stays, no pulse over the tour
    if (quiet) return;
    if (document.hidden) { hit.forEach(k => BPL.pend.add(k)); return; }
    const now = Date.now(); hit.forEach(k => { if (!(now - (BPL.last[k] || 0) < BPL_GAP)) BPL.q.add(k); });
    if (BPL.q.size) requestAnimationFrame(() => requestAnimationFrame(bplFlush));   // after the caller has put this render on the page
  }
  function bplFlush() {
    const order = k => k === "review" ? 0 : k === "busy" ? 1 : 2 + BPL_K.indexOf(k);
    const ks = [...BPL.q].sort((a, b) => order(a) - order(b)); BPL.q.clear();
    ks.slice(0, 2).forEach((k, i) => setTimeout(() => bplPlay(k), i * 150));   // the rest keep their knot only
  }
  function bplPlay(k) {
    const el = bplTile(k), eb = el && el.querySelector(".wg-eb"); if (!eb) return;
    BPL.last[k] = Date.now(); el.dataset.bplAt = BPL.last[k];
    const knot = eb.querySelector(".bpl-knot");
    if (RMQ.matches) { eb.animate([{ opacity: 1 }, { opacity: .55 }, { opacity: 1 }], { duration: 300, easing: "ease-in-out" }); return; }
    /* the tug: someone yanks the label's thread once; damped wiggle sampled into keyframes (spring-ish, ~1.2 s) */
    const damp = x => Math.exp(-4.2 * x) * Math.sin(2 * Math.PI * 2.4 * x), N = 18, kf = [];
    for (let i = 0; i <= N; i++) { const w = i === N ? 0 : damp(i / N * 1.5); kf.push({ rotate: `${(-5.5 * w).toFixed(2)}deg`, translate: `${(2 * w).toFixed(2)}px ${(-3 * Math.abs(w)).toFixed(2)}px`, scale: `${(1 + .05 * Math.abs(w)).toFixed(3)}` }); }
    eb.animate(kf, { duration: 1200, delay: 0, easing: "linear" });
    const n = eb.querySelector(".n"); if (n) n.animate([{ translate: "0 45%", opacity: .2 }, { translate: "0 0", opacity: 1 }], { duration: 350, easing: "cubic-bezier(.2,.8,.2,1)" });
    if (knot) knot.animate([{ opacity: 0, scale: ".4" }, { opacity: 0, scale: ".4", offset: .82 }, { opacity: 1, scale: "1" }], { duration: 2200, easing: "ease-out" });
    /* new rows slide in from the left with a pale gold wash that fades (opacity of ::after, CSS) */
    el.querySelectorAll(".wg-row[data-item]").forEach(r => { if (BPL.fresh && BPL.fresh.has(r.dataset.item)) { r.classList.add("bpl-new"); r.animate([{ translate: "-14px 0", opacity: 0 }, { translate: "0 0", opacity: 1 }], { duration: 450, delay: 100, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" }); } });
    /* one stitch of light around the border: a trail that draws in (dashoffset P -> 0) and fades, with a brighter head running ahead */
    const b = el.getBoundingClientRect(), r0 = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 18, ins = 7, w = b.width - 2 * ins, h = b.height - 2 * ins, r = Math.max(4, r0 - ins);
    if (w < 40 || h < 40) return;
    const d = `M${ins + r} ${ins}H${ins + w - r}A${r} ${r} 0 0 1 ${ins + w} ${ins + r}V${ins + h - r}A${r} ${r} 0 0 1 ${ins + w - r} ${ins + h}H${ins + r}A${r} ${r} 0 0 1 ${ins} ${ins + h - r}V${ins + r}A${r} ${r} 0 0 1 ${ins + r} ${ins}Z`;
    el.querySelectorAll(":scope > .bpl-svg").forEach(x => x.remove());
    el.insertAdjacentHTML("beforeend", `<svg class="bpl-svg" aria-hidden="true" viewBox="0 0 ${b.width} ${b.height}" preserveAspectRatio="none"><path class="bpl-tr" d="${d}"/><path class="bpl-hd" d="${d}"/></svg>`);
    const sv = el.lastElementChild, tr = sv.querySelector(".bpl-tr"), hd = sv.querySelector(".bpl-hd"), P = tr.getTotalLength(), H = 60;
    tr.style.strokeDasharray = `${P} ${P}`; hd.style.strokeDasharray = `${H} ${P + H}`;
    const run = { duration: 1400, delay: 250, easing: "cubic-bezier(.45,0,.55,1)", fill: "both" };
    tr.animate([{ strokeDashoffset: P }, { strokeDashoffset: 0 }], run);
    hd.animate([{ strokeDashoffset: H }, { strokeDashoffset: H - P }], run);
    hd.animate([{ opacity: 1 }, { opacity: 1, offset: .9 }, { opacity: 0 }], { duration: 1400, delay: 250, fill: "both" });
    sv.animate([{ opacity: 1 }, { opacity: 1, offset: .62 }, { opacity: 0 }], { duration: 2600, fill: "forwards" }).finished.then(() => sv.remove(), () => sv.remove());
  }
  function bplSeen(k) {
    if (!BPL.unseen.delete(k)) return; bplSave(); delete BPL.view[k];
    document.querySelectorAll(`#wg .wg[data-wg="${k}"] .bpl-knot`).forEach(x => { const a = x.animate([{ opacity: 1 }, { opacity: 0 }], { duration: RMQ.matches ? 0 : 250, fill: "forwards" }); a.finished.then(() => x.remove(), () => x.remove()); });
  }
  document.addEventListener("pointerover", e => {
    const t = e.target.closest && e.target.closest("#wg .wg-grid > .wg[data-wg]"), k = t && t.dataset.wg;
    if (BPL.hov && BPL.hov.k === k) return;
    if (BPL.hov) clearTimeout(BPL.hov.t);
    BPL.hov = k && BPL.unseen.has(k) ? { k, t: setTimeout(() => bplSeen(k), BPL_SEEN_HOVER) } : k ? { k, t: 0 } : null;
  });
  document.addEventListener("click", e => { const t = e.target.closest && e.target.closest("#wg .wg-grid > .wg[data-wg]"); if (t && !EDIT) bplSeen(t.dataset.wg); });
  setInterval(() => {   // 2 s fully on screen with focus (counted after the cue has played)
    if (!BPL.unseen.size || document.hidden || !document.hasFocus() || !bplDesk()) { BPL.view = {}; return; }
    const now = Date.now();
    BPL.unseen.forEach(k => { const el = bplTile(k); if (!el) return;
      const r = el.getBoundingClientRect(), vis = r.width > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth && now - (+el.dataset.bplAt || 0) > 2200;
      if (!vis) { delete BPL.view[k]; return; }
      BPL.view[k] = BPL.view[k] || now; if (now - BPL.view[k] >= BPL_SEEN_VIEW) bplSeen(k); });
  }, 250);
  document.addEventListener("visibilitychange", () => {   // came back to the tab: replay once what arrived while away
    if (document.hidden || !BPL.pend.size) return;
    const now = Date.now(); BPL.pend.forEach(k => { if (BPL.unseen.has(k) && !(now - (BPL.last[k] || 0) < BPL_GAP)) BPL.q.add(k); }); BPL.pend.clear();
    if (BPL.q.size && !(A() && A().quietNight && A().quietNight())) setTimeout(bplFlush, 300);
  });
  window.BoardPulse = { seen: bplSeen, unseen: () => [...BPL.unseen], _play: bplPlay, _last: BPL.last };   // e2e hooks
  function html(body, tail) {
    const L = load(), D = data(), calm = [], tiles = [];
    if (A().ykSync) A().ykSync();   /* t-yarn-anim: roles that stopped since the last draw (no beat is drawn for them, their next start still gets one) */
    bplScan(D);   // t-board-pulse
    const count = { review: D.waiting.length, replies: D.nr.length, today: D.shipped.length }, CH = chosen();
    L.forEach(([k, s0], i) => {
      if (isGone(k)) return;
      /* t-wy-size (user 11-22): 等你拍板 M = half of L (half the width, a normal tall tile with full rows), L = the full row */
      const s = k === "review" ? (s0 === "m" ? "l" : s0 === "s" ? "s" : "w") : !EDIT && s0 === "l" && count[k] != null && count[k] <= 2 && !CH.has(k) ? "m" : s0;   /* t-home-sml: only a size nobody picked */   // a big widget with one or two rows drops to M so the grid stays tight; 等你拍板 is always full width (t-section-titles)
      if (!EDIT && isEmpty(k, D)) { calm.push([calmText(k), ((REG()(k) || {}).calm || [])[2] !== false]); return; }
      const inner = EDIT && isEmpty(k, D) ? eb(k) + `<div class="wg-calm-in">${calmText(k)}</div>` : tileHTML(k, s, D);
      const multi = k === "busy" && D.busy.length > 1 ? " multi" : "";
      tiles[k === "review" ? "unshift" : "push"]([k, `<section class="wg wg-${k} sz-${s}${k === "review" && s === "l" ? " wy-half" : ""}${k === "review" && s === "w" && D.waiting.length > 4 ? " sct-tall" : ""}${k === "busy" && s !== "s" && !isEmpty(k, D) ? (document.documentElement.dataset.ut ? " utav" : " hero") + multi : ""}" data-wg="${k}"${k === "review" ? " data-pin" : ""}>${inner}${EDIT ? editBar(k, s0, i, L.length) : ""}</section>`]);
    });
    const hidden = allIds().filter(k => !L.some(x => x[0] === k) || isGone(k));
    const P = { edit: EDIT, tiles,
      hd: `<div class="wg-hd">${calm.length ? calmHTML(calm) : ""}${A().snzLine ? A().snzLine() : ""}<span class="sp"></span>${EDIT ? `<button type="button" class="wg-btn" data-wg-reset>${en() ? "Reset" : "恢复默认"}</button>` : ""}<button type="button" class="wg-btn${EDIT ? " on" : ""}" data-wg-edit>${EDIT ? (en() ? "Done" : "完成") : (en() ? "Edit widgets" : "编辑小组件")}</button></div>`,
      tail: tail ? `<div class="wg-tail">${tail}</div>` : "",
      tray: EDIT ? `<div class="wg-tray"><h4>${en() ? "Add widgets" : "添加小组件"}<small>${hidden.length ? (en() ? "click to add back" : "点一下加回去") : (en() ? "all widgets are on the page" : "所有小组件都在页面上了")}</small></h4><div class="wg-chips">${hidden.map(k => `<button type="button" data-wg-add="${k}">+ ${nm(k)}</button>`).join("")}</div></div>` : "" };
    const out = `<div id="wg" class="${EDIT ? "edit" : ""}">${P.hd}
      <div class="wg-grid">${tiles.map(x => x[1]).join("")}</div>
      ${P.tail}
      ${P.tray}</div>`;
    const key = norm(out), wg = body && body.firstElementChild && body.firstElementChild.id === "wg" ? body.firstElementChild : null;
    if (wg && DR.d) return null;   // t-widget-drag: a poll while a tile is held keeps the DOM (the drop saves and redraws)
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
    else if (t.dataset.wgReset != null) reset();
    else if (t.dataset.wgHide) { save(L.filter(x => x[0] !== t.dataset.wgHide));   /* t-ui-fix-r5 R5-04: a keyboard remove keeps focus on the next tile's − (or 完成) */
      if (document.activeElement === t) { const i = [...document.querySelectorAll("[data-wg-hide]")].indexOf(t); setTimeout(() => { const H = document.querySelectorAll("[data-wg-hide]"), n = H[Math.min(i, H.length - 1)] || document.querySelector("[data-wg-edit]"); if (n) n.focus({ preventScroll: true }); }, 80); } }
    else if (t.dataset.wgAdd) { const w = REG()(t.dataset.wgAdd); if (isGone(t.dataset.wgAdd) && w.revive) w.revive();   /* t-onboarding P0 */
      if (!L.some(y => y[0] === t.dataset.wgAdd)) { const x = [t.dataset.wgAdd, SIZES[t.dataset.wgAdd].includes("m") ? "m" : SIZES[t.dataset.wgAdd][0]]; if (w.first) L.unshift(x); else L.push(x); save(L); } }   /* t-rb-build: 团队交接 comes back first (first: true) */
    else if (t.dataset.wgSize) { const [k, z] = t.dataset.wgSize.split(":"); const x = L.find(y => y[0] === k); if (x) { x[1] = z; pick(k); } save(L); }
    else if (t.dataset.wgMove) { const [k, d] = t.dataset.wgMove.split(":"); const i = L.findIndex(y => y[0] === k), j = i + +d; if (i >= 0 && j >= 0 && j < L.length) { [L[i], L[j]] = [L[j], L[i]]; save(L); } }
    redraw();
  }, true);
  document.addEventListener("keydown", e => { if (EDIT && e.key === "Escape" && document.getElementById("wg")) { if (DR.d) drop(); EDIT = false; redraw(); } });

  // ===== t-widget-drag (11-11): iOS-style drag to reorder. Hold a tile ~0.45 s (or press one while editing) to pick it up: it lifts and follows the
  // pointer, the others slide out of the way (FLIP, transform only), and on release it settles into its slot. Only the order changes; sizes stay.
  // Pointer Events, so mouse, trackpad and touch all work. Reduced motion: no lift scale, no slide, no settle (tiles just swap). Keyboard: ← → as before.
  const DR = { p: null, d: null, eat: 0 };
  const HOLD = 450;
  const gridOf = () => document.querySelector('html[data-home="widgets"] #wg .wg-grid');
  const tileOf = k => { const g = gridOf(); return g && [...g.children].find(t => t.dataset.wg === k); };
  function lift(k, x, y) {
    const el = tileOf(k), grid = gridOf(); if (!el || !grid) return;
    const sc = scroller(grid);
    DR.d = { k, el, grid, x0: x, y0: y, b0: lay(el), x, y, t: 0, sx: x, sy: y, sc, st0: sc.scrollTop };
    autoScroll();
    el.classList.add("wg-lift"); document.documentElement.classList.add("wg-dragging"); try { getSelection().removeAllRanges(); } catch (_) { }
    if (!RMQ.matches) el.animate([{ scale: "1" }, { scale: "1.04" }], { duration: 160, easing: "cubic-bezier(.2,.8,.2,1)" });
  }
  function follow() {
    const d = DR.d; if (!d) return; const n = lay(d.el);
    d.el.style.translate = `${d.x - d.x0 + d.b0.left - n.left}px ${d.y - d.y0 + d.b0.top - n.top + d.sc.scrollTop - d.st0}px`;
  }
  const scroller = el => { for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) { const o = getComputedStyle(e).overflowY; if ((o === "auto" || o === "scroll") && e.scrollHeight > e.clientHeight) return e; }
    return document.scrollingElement || document.documentElement; };
  function autoScroll() {   // held near the top / bottom edge of the scroll box: scroll, faster the closer to the edge (like iOS)
    const d = DR.d; if (!d) return;
    const r = d.sc === document.scrollingElement || d.sc === document.documentElement ? { top: 0, bottom: innerHeight } : d.sc.getBoundingClientRect(), E = 64;
    const v = d.y < r.top + E ? -Math.ceil((r.top + E - d.y) / 4) : d.y > r.bottom - E ? Math.ceil((d.y - (r.bottom - E)) / 4) : 0;
    if (v) { const b = d.sc.scrollTop; d.sc.scrollTop += Math.max(-18, Math.min(18, v)); if (d.sc.scrollTop !== b) { follow(); d.sy = -1e4; } }   // scrolled: the slot under the pointer counts as new
    retarget(false);   // every frame, so a pointer that stops on a tile during the cool-down still moves it there
    requestAnimationFrame(autoScroll);
  }
  function retarget(now) {   // swap with the tile under the pointer: not twice within 140 ms and not without the pointer moving 6 px (no flip-flop between unequal tiles)
    const d = DR.d; if (!d || (!now && performance.now() - d.t < 140) || Math.hypot(d.x - d.sx, d.y - d.sy) <= 6) return;
    const tg = over(); if (tg) reorder(tg);
  }
  function over() {   // the tile under the pointer (layout boxes, so a sliding tile does not flicker the target)
    const d = DR.d, op = d.el.offsetParent; if (!op) return null;
    const r = op.getBoundingClientRect(), px = d.x - r.left - op.clientLeft + op.scrollLeft, py = d.y - r.top - op.clientTop + op.scrollTop;
    return [...d.grid.children].find(t => { if (t === d.el || !t.dataset.wg || t.hasAttribute("data-pin")) return false; const b = lay(t); return px >= b.left && px < b.left + b.width && py >= b.top && py < b.top + b.height; }) || null;
  }
  function reorder(tgt) {
    const d = DR.d, kids = [...d.grid.children], i = kids.indexOf(d.el), j = kids.indexOf(tgt); if (i < 0 || j < 0) return;
    const before = new Map(kids.filter(t => t !== d.el).map(t => [t, t.getBoundingClientRect()]));   // visual boxes, mid-slide included
    d.grid.insertBefore(d.el, i < j ? tgt.nextSibling : tgt);
    d.t = performance.now(); d.sx = d.x; d.sy = d.y;
    follow();
    if (RMQ.matches) return;
    before.forEach((o, t) => { if (t._wgSlide) t._wgSlide.cancel(); const n = t.getBoundingClientRect(), dx = o.left - n.left, dy = o.top - n.top;
      if (Math.abs(dx) + Math.abs(dy) < 1) return;
      t._wgSlide = t.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: "none" }], { duration: 260, easing: "cubic-bezier(.2,.8,.2,1)" }); });
  }
  function drop() {
    if (!DR.d) return; retarget(true);
    const d = DR.d; DR.d = null; DR.eat = Date.now();
    const tr = d.el.style.translate || "0px 0px";
    d.el.style.translate = ""; d.el.classList.remove("wg-lift"); document.documentElement.classList.remove("wg-dragging");
    if (!RMQ.matches) d.el.animate([{ translate: tr, scale: "1.04" }, { translate: "0px 0px", scale: "1" }], { duration: 300, easing: "cubic-bezier(.3,1.3,.5,1)" });
    const order = [...d.grid.children].map(t => t.dataset.wg).filter(Boolean), L = load();
    const nu = order.map(k => L.find(x => x[0] === k)).filter(Boolean).concat(L.filter(x => !order.includes(x[0])));
    if (JSON.stringify(nu) !== JSON.stringify(L)) save(nu);
    redraw();   // the ← → buttons follow the new order; patch() keeps the tile nodes
  }
  /* the pinned tile tugs a few px toward the pointer and springs back (held by its pin); entering 编辑 by a hold = a small press-in */
  function pinBounce(k, dx, dy) {
    const el = tileOf(k); if (!el || RMQ.matches) return;
    const h = Math.hypot(dx, dy) || 1, mx = dx ? dx / h * 7 : 0, my = dy ? dy / h * 7 : 0;
    el.animate(dx || dy ? [{ translate: "0px 0px" }, { translate: `${mx}px ${my}px`, offset: .3 }, { translate: `${-mx * .35}px ${-my * .35}px`, offset: .62 }, { translate: "0px 0px" }]
      : [{ scale: "1" }, { scale: ".985", offset: .35 }, { scale: "1" }], { duration: 420, easing: "cubic-bezier(.3,.7,.3,1)" });
  }
  const PHQ = matchMedia("(max-width: 760px)");   /* t-home-sml P2: the phone widget home (设置 · 手机首页 = 小组件) */
  const cancelPress = () => { if (DR.p) { clearTimeout(DR.p.tm); DR.p = null; } };
  document.addEventListener("pointerdown", e => {
    if (e.button || !e.isPrimary || DR.d || document.documentElement.dataset.home !== "widgets" || (A() && A().UI.page !== "review")) return;
    if (EDIT && PHQ.matches) return;   /* t-home-sml P2: on a phone 编辑 tiles don't drag (the finger scrolls the page); order is the ← → buttons */
    const t = e.target.closest && e.target.closest("#wg .wg-grid > .wg[data-wg]");
    /* t-wy-size: 等你拍板 is pinned first (t-section-titles). A hold on it still enters 编辑 (resize / remove); dragging it only bounces back */
    const pin = !!(t && t.hasAttribute("data-pin"));
    if (!t || e.target.closest("[data-wg-hide],[data-wg-size],[data-wg-move],input,textarea,select,video,audio")) return;
    cancelPress();
    DR.p = { k: t.dataset.wg, pin, x: e.clientX, y: e.clientY, edit: EDIT, tm: EDIT ? 0 : setTimeout(() => {   // not editing: a hold enters 编辑 and picks the tile up
      const p = DR.p; if (!p) return; DR.p = null; DR.eat = Date.now();
      EDIT = true; redraw(); if (PHQ.matches) return; if (p.pin) pinBounce(p.k, 0, 0); else lift(p.k, p.lx ?? p.x, p.ly ?? p.y); }, HOLD) };   // phone: the hold only opens 编辑
  }, true);
  window.addEventListener("pointermove", e => {
    if (DR.d) { if (!e.isPrimary) return; e.preventDefault(); DR.d.x = e.clientX; DR.d.y = e.clientY; follow();
      retarget(false); return; }
    const p = DR.p; if (!p) return; p.lx = e.clientX; p.ly = e.clientY;
    const m = Math.hypot(e.clientX - p.x, e.clientY - p.y);
    if (p.edit && m > 4 && p.pin) { DR.p = null; DR.eat = Date.now(); pinBounce(p.k, e.clientX - p.x, e.clientY - p.y); }
    else if (p.edit && m > 4) { DR.p = null; lift(p.k, p.x, p.y); DR.d && (DR.d.x = e.clientX, DR.d.y = e.clientY, follow()); }
    else if (!p.edit && m > 8) cancelPress();   // moved before the hold: a normal click / selection, not a drag
  }, { passive: false });
  const end = () => { cancelPress(); if (DR.d) drop(); };
  window.addEventListener("pointerup", end); window.addEventListener("pointercancel", end); window.addEventListener("blur", end);
  document.addEventListener("dragstart", e => { if ((DR.p || DR.d) && e.target.closest && e.target.closest("#wg")) e.preventDefault(); }, true);   // thumbnails: no native image drag
  document.addEventListener("selectstart", e => { if (DR.d) e.preventDefault(); }, true);
  window.addEventListener("click", e => { if (DR.eat && Date.now() - DR.eat < 600) { DR.eat = 0; e.preventDefault(); e.stopPropagation(); } }, true);   // the click after a hold / drop
  // ===== t-home-motion (tier 中, approved 11-02) + the flow sweep (item 8, asked for explicitly) =====
  // Plays only on events: entering the home page (stagger + numbers from 0), a row arriving (drop + glow) or leaving (ghost slides out),
  // tiles moving or resizing (FLIP glide), numbers changing (roll). A poll that returns the same data keeps the same DOM and plays nothing;
  // a poll with new data animates only what changed. prefers-reduced-motion turns all of it off. Desktop widget home only.
  const RMQ = matchMedia("(prefers-reduced-motion: reduce)");
  const MV = { page: null, wg: null, rects: new Map(), rows: new Map(), nums: new Map(), dirty: false };
  // t-home-flicker: tile boxes from layout (offset*), not getBoundingClientRect, which includes a running entry / FLIP transform and made every diff glide all tiles
  const lay = t => ({ left: t.offsetLeft, top: t.offsetTop, width: t.offsetWidth, height: t.offsetHeight });
  const rk = r => r.closest(".wg").dataset.wg + "|" + r.dataset.item;
  /* t-home-sml: a tile can hold several numbers (本周进度 L: 交付 / 进行中 / 待办), so the key carries the index; with one key per class they rolled from each other's value */
  const nk = n => { const t = n.closest(".wg"); return t.dataset.wg + "|" + n.className + "|" + [...t.querySelectorAll(".wg-big, .wg-eb .n")].indexOf(n); };
  function mvSnap(wg) {
    MV.rects = new Map([...wg.querySelectorAll(".wg")].map(t => [t.dataset.wg, lay(t)]));
    MV.rows = new Map([...wg.querySelectorAll(".wg-row[data-item]")].map(r => [rk(r), { r: r.getBoundingClientRect(), html: r.outerHTML }]));
    MV.nums = new Map([...wg.querySelectorAll(".wg-big, .wg-eb .n")].map(n => [nk(n), n.textContent]));
  }
  function mvRoll(wg, fromZero) {
    wg.querySelectorAll(".wg-big, .wg-eb .n").forEach(n0 => {
      const n = n0.querySelector(".wnb-num") || n0;   /* t-widget-num-b: roll only the digits, keep the tab spans */
      const to = parseInt(n.textContent, 10); if (isNaN(to)) return;
      const from = fromZero ? 0 : parseInt(MV.nums.get(nk(n0)), 10); if (isNaN(from) || from === to) return;
      const suf = n.textContent.replace(/^\d+/, ""), t0 = performance.now(), dur = 600;
      const step = t => { if (!n.isConnected) return; const p = Math.min(1, (t - t0) / dur); n.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3))) + suf; if (p < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }
  /* t-home-sml-audit (the S 今天交付 title was cut in half by the bottom stitch): a clamped text block ([data-fit], .clamp2)
     gives up whole lines until it ends above the stitched inner edge (the knit / leather outline-offset, or the padding if that is deeper);
     no line fits = the block hides. Inline styles only, reset on every pass; patch() swaps in fresh nodes, so each draw is fitted again. */
  function wgFit(wg) {
    wg.querySelectorAll(".wg-grid > .wg").forEach(t => {
      /* the subtitle line (Underthread) shrinks first when the rows need the room: squeezed below its own line, it drops whole instead of showing a sliver */
      const sb = t.querySelector(":scope > .sct-sub"); if (sb) { sb.style.removeProperty("display"); if (sb.offsetHeight && sb.scrollHeight > sb.clientHeight + 1) sb.style.setProperty("display", "none"); }
      const F = t.querySelectorAll(".clamp2, [data-fit]"); if (!F.length) return;
      F.forEach(e => { e.style.removeProperty("-webkit-line-clamp"); e.style.removeProperty("display"); });
      const cs = getComputedStyle(t), oo = parseFloat(cs.outlineOffset) || 0, R = t.getBoundingClientRect();
      const lim = R.bottom - Math.max(cs.outlineStyle !== "none" && oo < 0 ? -oo + 3 : 0, parseFloat(cs.paddingBottom) || 0);
      F.forEach(e => { const r = e.getBoundingClientRect(); if (r.bottom <= lim + .5) return;
        const lh = parseFloat(getComputedStyle(e).lineHeight) || r.height / Math.max(1, parseInt(getComputedStyle(e).webkitLineClamp) || 1);
        const n = Math.floor((lim - r.top - (parseFloat(getComputedStyle(e).paddingTop) || 0)) / lh);
        if (n >= 1) e.style.setProperty("-webkit-line-clamp", String(n)); else e.style.setProperty("display", "none"); });
    });
  }
  let FIT_RO = null;
  function mvPage() {
    const wg = document.getElementById("wg"), page = A().UI.page, entered = page === "review" && MV.page !== "review"; MV.page = page;
    if (!wg) { MV.wg = null; return; }
    const dirty = MV.dirty; MV.dirty = false;
    if (wg !== MV.wg || entered || dirty) { try { wgFit(wg); } catch (_) { }
      if (window.ResizeObserver) { if (FIT_RO) FIT_RO.disconnect(); let raf = 0; FIT_RO = new ResizeObserver(() => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (wg.isConnected) try { wgFit(wg); } catch (_) { } }); }); FIT_RO.observe(wg); }
      if (entered || !MV.wg) setTimeout(() => { if (wg.isConnected) try { wgFit(wg); } catch (_) { } }, 1600);   /* after the entry motion (transforms skew the rects) and web fonts */ }
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
  /* S8: the core nine, registered the way an extension registers its own (docs/extensions.md) */
  const CORE = [
    ["usage", ["各角色用量", "Usage by role"], ["s", "m", "l"], "l"],
    ["review", ["等你拍板", "Waiting on you"], ["s", "m", "l"], "l", D => !D.waiting.length, ["没有等你拍板的", "Nothing waiting on you"]],
    ["busy", ["此刻在忙", "Busy now"], ["s", "m", "l"], "l", D => !D.busy.length, ["大家都空闲", "Everyone is idle", false]],
    ["replies", ["新回复", "New replies"], ["s", "m", "l"], "l", D => !D.nr.length, ["没有新回复", "No new replies"]],
    ["today", ["今天交付", "Shipped today"], ["s", "m", "l"], "m", D => !D.shipped.length, ["今天还没有交付", "Nothing shipped today", false]],
    ["week", ["本周进度", "This week"], ["s", "m", "l"], "m"],
    ["ongoing", ["每日", "Dailies"], ["s", "m", "l"], "m", D => !D.ongoing.length, ["没有每日的活", "No dailies", false]],
    ["media", ["最近素材", "Recent media"], ["s", "m", "l"], "m", D => !D.imgs.length, ["还没有素材", "No media yet", false]],
    ["recent", ["最近", "Recent"], ["w"], "w", D => !D.recent.length, ["还没有卡", "No cards yet", false]],
  ];
  if (window.UTExt) CORE.forEach(([id, name, sizes, size, empty, calm, first]) => UTExt.widget({ id, name, sizes, size, html: W[id], empty, calm, first: !!first, core: true }));
  window.Widgets = { html, editing: () => EDIT };
  if (A() && A().refreshPage && document.documentElement.dataset.home === "widgets") A().refreshPage();   /* app.js rendered before this file parsed */
})();
