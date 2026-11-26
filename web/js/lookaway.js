/* t-lookaway-fx: arrival effects after LookAway (user picks 11-21/22).
 *   Full screen "D3 · ink" (3 s): only for a batch of cards handed in for review, and once a day when the daily report lands.
 *     No card: avatar + type float straight on a 48 px backdrop blur that blooms out of the avatar like ink in water and draws back into it.
 *     Rare on purpose: at most one every 20 min (rt.lka.fsAt, shared by tabs), never 22:30-08:30, never while you type, never in a hidden tab,
 *     never under prefers-reduced-motion. Anything that may not go full screen goes to the pill instead.
 *   Split (user 11-22, ask dde091 A): the pill = what waits on you (review hand-ins, rule proposals, questions, reminders, day's end);
 *     on a computer, replies and DMs go to the top-right cards (toast.js WebToast.show) and never to the pill. Phone: everything in the pill.
 *     route() is the one place that decides; each notice reaches exactly one surface.
 *   Pill: every notice that waits on you (ask, reminder, review when full screen is not allowed; replies too on the phone). Since t-pill-notif-style
 *     (user 11-24, ask b369c4 A) a one-line capsule that grows out of the seam under the top bar, with a separate round button; after 5 s (asks 8 s)
 *     it folds into a bead that rises into the header summary capsule #lka-sum (「N 条等你 · 还有 N 条」), which replaced the corner dot. Tap the
 *     summary = the notices come back. A second arrival bumps the pill and grows the +N badge. Click = open; badge = next; swipe up / Esc = dismiss.
 *     Reduced motion = 150 ms fades only.
 *   No setting since t-drop-arrival-fx (user 11-23): always full screen + pill. The old 设置 → 提醒动效 pref (localStorage rt.lka) is ignored and removed at load.
 *   Classes: lka-* (checked unused). Knit theme kills backdrop-filter for * with !important; lookaway.css re-enables it for these two layers only.
 *   Test hook: window.LookAway. */
(function () {
  if (!window.App) return;
  const RM = matchMedia("(prefers-reduced-motion: reduce)"), PHONE = matchMedia("(max-width: 760px)");
  const GAP = 20 * 6e4, HOLD = 5000, MINI = 8000, FS_MS = 3000;
  const S = { q: [], bag: [], pill: null, cd: null, fs: null, wait: [], eod: undefined };
  const en = () => App.UI.lang === "en";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const LS = { get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } } };
  /* t-drop-arrival-fx: the 设置 row is gone; a pref saved by an older build ("pill" / "off") is dropped so every install behaves the same */
  try { localStorage.removeItem("rt.lka"); } catch (e) { }
  const mode = () => "on";
  const ag = id => App.agent(id), nm = a => a ? App.aname(a) : "", av = a => a ? App.avatarUrl(a) : "";
  const hhmm = d => String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const quiet = () => { if (LS.get("rt.lka.quiet", true) === false) return false; const d = new Date(), m = d.getHours() * 60 + d.getMinutes(); return m >= 22 * 60 + 30 || m < 8 * 60 + 30; };
  const typing = () => { const a = document.activeElement; return !!a && (a.isContentEditable || /^(TEXTAREA|INPUT|SELECT)$/.test(a.tagName)) && !!(a.value || a.textContent || "").trim(); };
  /* why full screen may not play now ("" = it may) */
  function fsBlock(o = {}) {
    if (mode() !== "on") return "mode";
    if (RM.matches) return "reduced-motion";
    if (document.hidden) return "hidden";
    if (S.fs) return "busy";
    if (!o.eod && Date.now() - (+LS.get("rt.lka.fsAt", 0) || 0) < GAP) return "gap";
    if (quiet()) return "quiet";
    if (typing()) return "typing";
    return "";
  }

  /* ---------- full screen ---------- */
  function fsData(kind, list) {
    const E = en();
    if (kind === "eod") {
      const t = today(), its = App.items();
      const shut = its.filter(i => i.stage === "done" && String(i.closed || "").slice(0, 10) === t).length, wait = its.filter(i => i.stage === "review").length;
      return { who: ["manager"], cap: E ? "Day's end" : "今日收工", title: E ? "That's a wrap for today" : "今天收工了",
        line: E ? `${shut} closed today · ${wait} waiting for you` : `今天关了 ${shut} 张，等你 ${wait} 张`, go: () => App.route("#page=review") };
    }
    const who = [...new Set(list.map(n => n.agent).filter(Boolean))];
    if (list.length === 1) {
      const n = list[0], a = ag(n.agent);
      return { who, cap: E ? "For your review" : "等你审阅", title: E ? `${nm(a)} handed in` : `${nm(a)}交稿了`, line: n.it ? n.it.title : "",
        go: () => n.it && App.route("#item=" + encodeURIComponent(n.it.id)) };
    }
    return { who, cap: E ? "For your review" : "等你审阅", title: E ? `${list.length} cards for you` : `${list.length} 张等你审`,
      line: who.map(w => nm(ag(w))).join(E ? ", " : "、"), go: () => App.route("#page=review") };
  }
  function fsPlay(kind, list, o = {}) {
    const D = fsData(kind, list), E = en();
    if (!o.preview) LS.set("rt.lka.fsAt", Date.now());
    const el = document.createElement("div");
    el.id = "lka-fs"; el.className = "lka-fs lka-" + kind; el.tabIndex = -1;
    el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite");
    const avs = D.who.slice(0, 3).map(w => `<img src="${esc(av(ag(w)))}" alt="">`).join("");
    el.innerHTML = `<div class="lka-blur" aria-hidden="true"></div><div class="lka-col">`
      + `<div class="lka-avs${D.who.length > 1 ? " lka-many" : ""}">${avs}</div>`
      + `<div class="lka-b lka-cap" style="--k:0">${esc(D.cap)} · ${hhmm(new Date())}</div>`
      + `<div class="lka-b lka-title" style="--k:1">${esc(D.title)}</div>`
      + (D.line ? `<div class="lka-b lka-line" style="--k:2">${esc(D.line)}</div>` : "")
      + `<div class="lka-b lka-cd" style="--k:3" aria-hidden="true"><svg viewBox="0 0 200 4" preserveAspectRatio="none"><path class="lka-cd-bg" d="M0 2H200"/><path class="lka-cd-on" d="M0 2H200"/></svg></div>`
      + `<div class="lka-hint">${E ? "Click anywhere to open · Esc to close" : "点任意处去看看　·　Esc 关闭"}</div></div>`;
    document.body.appendChild(el);
    const a = el.querySelector(".lka-avs"), r = a.getBoundingClientRect();
    el.style.setProperty("--lka-x", Math.round(r.left + r.width / 2) + "px"); el.style.setProperty("--lka-y", Math.round(r.top + r.height / 2) + "px");
    S.fs = { el, D, t: setTimeout(() => fsEnd(), FS_MS + 120) };
    el.addEventListener("animationend", e => { if (e.target.classList.contains("lka-blur") && e.animationName === "lka-ink") fsEnd(); });
    el.addEventListener("click", () => { const go = D.go; fsEnd(true); go && go(); });
    requestAnimationFrame(() => el.classList.add("lka-run"));
    return el;
  }
  function fsEnd(fast) {
    const f = S.fs; if (!f) return; S.fs = null; clearTimeout(f.t);
    const done = () => { f.el.remove(); if (S.wait.length) { const w = S.wait.splice(0); route(w); } };
    if (fast && !RM.matches) { f.el.classList.add("lka-quit"); setTimeout(done, 320); } else done();
  }
  addEventListener("keydown", e => { if (S.fs && (e.key === "Escape" || e.key === " ")) { e.preventDefault(); fsEnd(true); } }, true);

  /* ---------- pill (t-pill-notif-style, user 11-24 ask b369c4 「A 收进汇总胶囊，做进 lookaway（替掉右上角小圆点）」) ----------
     Modelled on a header-droplet notification (a capsule that grows out of the seam, then folds into a summary capsule).
     - A one-line capsule hangs on the seam under the top bar (#top's lower edge crosses it at its upper quarter): avatar, bold name, a coloured chip
       per type, one line of text; a separate round button (the knit icon of t-pill-answer-icon) on its right. Restrained: solid fill + 1 px rim, no glow.
     - In: a small drop clings to the seam (a thin bar melts into it), spreads into the capsule (~230 ms, then a ~700 ms tail), content de-blurs
       at +230..470 ms, the round button drops off the right end at +770 ms, its icon arrives at +1.25 s.
     - Leaving (5 s; asks 8 s, hover / focus / hidden pause it): the button is swallowed, the capsule narrows (the text re-ellipsizes from the right),
       blurs, shrinks into a bead that rises into the header summary capsule (#lka-sum: stacked avatars, 「N 条等你 · 还有 N 条」, a status dot, ›),
       which answers with a ring. The summary replaced the corner dot of t-pill-answer-icon: tap it (Enter) and the notices come back out of it.
       Esc on the summary clears it. Asks still leave only when answered, opened or dismissed; review cards when they leave review; the others
       after 30 min. Click = open, +N badge = next, swipe up / Esc = dismiss (not into the summary).
     - Every move is a pure function of time on one clock (play()); LookAway._clock(t) freezes it for frame-exact recordings.
     - Reduced motion: 150 ms fades, no ring. No WebGL any more (pilldrop.js only supplies look()). */
  const TAG = { reply: ["新回复", "Reply"], decide: ["等你审", "Review"], ask: ["问你", "Question"], remind: ["提醒", "Reminder"], eod: ["收工", "Wrap-up"] };
  const BTN = { reply: ["回复", "Reply"], decide: ["打开", "Open"], ask: ["回答", "Answer"], remind: ["查看", "View"], eod: ["去看", "View"] };
  /* t-pill-answer-icon (user 11-24, ask a8cd44 「A 线团问号」 + e28881 「四个一起换」): the buttons are knit icons; the word stays as aria-label and title.
     ask = a ? drawn as one thread with a small yarn ball for its dot; reply = back arrow whose tail is a running stitch; decide (Open) = chevron;
     remind / eod (View) = an eye with a stitched outline. 24 x 24, currentColor. */
  const ST = 'stroke-dasharray="2.2 1.7"';
  const ICO = {
    ask: `<path d="M8.6 8.4a3.5 3.5 0 1 1 5.2 3.1c-1.2.7-1.8 1.4-1.8 2.7v.6" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/><circle cx="12" cy="18.6" r="2.1" fill="currentColor"/><path d="M10.4 18.1q1.6-.9 3.2.2M10.6 19.5q1.4.6 2.9-.3" stroke="var(--lka-ballline)" stroke-width=".7" fill="none"/>`,
    reply: `<path d="M10 7L5 11.5L10 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.5 11.5H14a5 5 0 0 1 5 5V18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" ${ST}/>`,
    decide: `<path d="M9 5.5L15.5 12L9 18.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
    remind: `<path d="M2.5 12q9.5-11 19 0q-9.5 11-19 0z" fill="none" stroke="currentColor" stroke-width="1.9" ${ST}/><circle cx="12" cy="12" r="3" fill="currentColor"/>`,
  };
  ICO.eod = ICO.remind;
  const ico = k => `<svg class="lka-ico" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">${ICO[k] || ICO.decide}</svg>`;
  const L2 = (p) => p ? p[en() ? 1 : 0] : "";
  const WAITK = c => c === "ask" || c === "decide";
  const BAG_TTL = 30 * 6e4;
  const lookOf = () => window.PillDrop ? PillDrop.look() : (document.documentElement.dataset.theme === "white" ? 2 : 0);
  const GM = () => PHONE.matches ? { H: 36, SH: 26, ring: 10 } : { H: 40, SH: 30, ring: 13 };

  /* ---- math (same curves as the mock) ---- */
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x)), lerp = (a, b, k) => a + (b - a) * k, seg = (t, a, b) => clamp((t - a) / (b - a));
  const eOut = k => 1 - (1 - k) ** 3, eIn = k => k * k * k, eIO = k => k < .5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
  const grow = t => t <= 0 ? 0 : t < .07 ? .03 * eOut(t / .07) : .03 + .97 * (1 - .8 * Math.exp(-(t - .07) / .06) - .2 * Math.exp(-(t - .07) / .3));
  const crit = (t, w) => t <= 0 ? 0 : 1 - (1 + w * t) * Math.exp(-w * t);
  const under = (t, w = 22, z = .6) => { if (t <= 0) return 0; const wd = w * Math.sqrt(1 - z * z); return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + z * w / wd * Math.sin(wd * t)); };

  /* ---- one clock for every move: tracks are pure functions of the time since they started ---- */
  const CK = { man: null }, TR = new Set(); let raf = 0;
  const now = () => CK.man != null ? CK.man : performance.now() / 1000;
  function play(dur, f, tag) {
    if (tag) stop(tag);
    return new Promise(res => { const tr = { t0: now(), dur, f, res, tag }; TR.add(tr); f(0); kick(); });
  }
  function stop(tag) { for (const tr of [...TR]) if (tr.tag === tag) { TR.delete(tr); tr.res(false); } }
  function step() { const n = now(); for (const tr of [...TR]) { if (!TR.has(tr)) continue; const t = n - tr.t0; tr.f(Math.min(Math.max(0, t), tr.dur)); if (t >= tr.dur) { TR.delete(tr); tr.res(true); } } }
  function kick() { if (CK.man == null && !raf && TR.size) raf = requestAnimationFrame(() => { raf = 0; step(); kick(); }); }

  /* ---- geometry ---- */
  function seamY() { const t = document.getElementById("top"), b = t ? t.getBoundingClientRect().bottom : 0; return b > 8 ? b : (PHONE.matches ? 44 : 56); }
  const pillOf = w => w.querySelector(".lka-pill"), budOf = w => w.querySelector(".lka-bud"), seamOf = w => w.querySelector(".lka-seam");
  function place(w) {
    const g = GM(); let top = seamY() - g.H / 4;
    /* t-pill-overlap: never over the 「Chrome 使用中」 chip (#toolbar) on a computer */
    const chip = !PHONE.matches && document.querySelector("#toolbar .tool-pill");
    if (chip) { const c = chip.getBoundingClientRect(), p = pillOf(w).getBoundingClientRect(), b = budOf(w).getBoundingClientRect();
      if (c.width && c.right + 10 > p.left && c.left < b.right + 10 && c.bottom > top && c.top < top + g.H) top = c.bottom + 6; }
    w.style.setProperty("--lka-top", Math.round(top) + "px");
  }
  /* the pill / button at rest */
  function geoRest(w) {
    const r = pillOf(w).getBoundingClientRect(), q = budOf(w).getBoundingClientRect();
    return { W: r.width, H: r.height, ccx: r.left + r.width / 2, ccy: r.top + r.height / 2, gap: q.left - r.right, seam: seamY() };
  }
  function animStart(w) { w._anim = true; w.classList.add("lka-anim"); }
  function animEnd(w) {
    w._anim = false; w.classList.remove("lka-anim");
    [pillOf(w), budOf(w), seamOf(w)].forEach(e => { if (!e) return; ["left", "top", "width", "height", "borderRadius", "visibility", "opacity"].forEach(k => e.style[k] = ""); e.style.removeProperty("--lka-c"); e.style.removeProperty("--lka-bl"); });
  }
  /* o = { on, cx, cy, w, h, op (content), bl (content blur px), al (whole), barW, barT, bOn, bx, br, iop } */
  function applyPill(w, G, o) {
    const p = pillOf(w), b = budOf(w), s = seamOf(w), ps = p.style;
    if (!o.on || o.w < .5) ps.visibility = "hidden";
    else { ps.visibility = ""; ps.left = (o.cx - o.w / 2).toFixed(2) + "px"; ps.top = (o.cy - o.h / 2).toFixed(2) + "px"; ps.width = o.w.toFixed(2) + "px"; ps.height = o.h.toFixed(2) + "px";
      ps.borderRadius = (Math.min(o.w, o.h) / 2).toFixed(2) + "px"; ps.opacity = o.al == null ? "" : o.al.toFixed(3);
      ps.setProperty("--lka-c", o.op.toFixed(3)); ps.setProperty("--lka-bl", o.bl.toFixed(2) + "px"); }
    const bs = b.style;
    if (!o.on || !o.bOn || o.br < .5) bs.visibility = "hidden";
    else { bs.visibility = ""; bs.left = (o.bx - o.br).toFixed(2) + "px"; bs.top = (o.cy - o.br).toFixed(2) + "px"; bs.width = bs.height = (2 * o.br).toFixed(2) + "px"; bs.setProperty("--lka-c", o.iop.toFixed(3)); }
    const ss = s.style;
    if (!o.on || !(o.barT > .2)) ss.visibility = "hidden";
    else { ss.visibility = ""; ss.left = (o.cx - o.barW / 2).toFixed(2) + "px"; ss.top = (G.seam - o.barT / 2).toFixed(2) + "px"; ss.width = o.barW.toFixed(2) + "px"; ss.height = o.barT.toFixed(2) + "px"; ss.borderRadius = (o.barT / 2).toFixed(2) + "px"; }
  }
  const btn = (o, G, bk) => { const re = o.cx + o.w / 2; o.bx = lerp(re - G.H / 2, re + G.gap + G.H / 2, bk); o.br = G.H / 2 * lerp(.5, 1, bk); };
  /* in: out of the seam (or, from = {x, y}, out of the summary capsule: a bead drops to the seam first) */
  const PRE = .24, IN_T = 1.42;
  function enterFrame(G, t, from) {
    const H = G.H, o = { on: true, cx: G.ccx, cy: G.ccy, w: 0, h: 0, op: 0, bl: 6, barW: 0, barT: 0, bOn: false, iop: 0 };
    let u = t;
    if (from) {
      if (t < PRE) { const k = eIO(t / PRE), s = lerp(16, 22, k); o.cx = lerp(from.x, G.ccx, k); o.cy = lerp(from.y, G.seam + 3, k); o.w = o.h = s; btn(o, G, 0); return o; }
      u = t - PRE;
    }
    const w0 = from ? 22 : 20, h0 = from ? 22 : 26;
    o.w = lerp(w0, G.W, grow(u)); o.h = lerp(h0, H, eOut(seg(u, 0, .14)));
    o.cy = lerp(G.seam + 3, G.ccy, eOut(seg(u, 0, .14)));
    if (!from) { o.barT = 3.4 * (1 - seg(u, .02, .14)); o.barW = o.w + 24; }   // the drop's shoulders cling to the seam for ~120 ms
    o.op = eOut(seg(u, .23, .45)); o.bl = 6 * (1 - eOut(seg(u, .26, .47)));
    const bk = crit(u - .77, 13); o.bOn = u > .77; o.iop = eOut(seg(u, 1.25, 1.4)); btn(o, G, bk);
    return o;
  }
  /* fold: into the summary at (tx, ty); the bead lands at e = .55 */
  const FOLD_T = .74, LAND = .55;
  function foldFrame(G, e, tx, ty) {
    const H = G.H, o = { on: true, cx: G.ccx, cy: G.ccy, w: G.W, h: H, op: 1, bl: 0, bOn: e <= .13, iop: 1 - seg(e, 0, .05) };
    const bk = 1 - eIn(seg(e, 0, .13));
    const w1 = lerp(G.W, 80, eIO(seg(e, 0, .2))), h1 = lerp(H, 32, eIO(seg(e, .15, .27)));
    o.w = lerp(w1, 22, eIO(seg(e, .27, .38))); o.h = lerp(h1, 22, eIO(seg(e, .27, .38)));
    o.op = 1 - seg(e, .12, .24); o.bl = 6 * seg(e, .12, .24);
    o.cx += (G.gap + H) / 2 * eIO(seg(e, 0, .22));        // the centre of mass slides right as the button is swallowed
    btn(o, G, bk);
    const k = eIO(seg(e, .40, .60)), x0 = o.cx, y0 = o.cy;
    o.cx = lerp(x0, tx, k); o.cy = lerp(y0, ty, k);
    if (e > .40) { const s = lerp(22, 16, k); o.w = Math.min(o.w, s); o.h = Math.min(o.h, s); }
    if (e > FOLD_T - .02) o.on = false;
    return o;
  }
  /* dismissed: the same shrink, then the bead sinks back into the seam */
  const OUT_T = .46;
  function outFrame(G, e) {
    const H = G.H, o = { on: true, cx: G.ccx, cy: G.ccy, w: G.W, h: H, op: 1 - seg(e, 0, .14), bl: 6 * seg(e, 0, .14), bOn: e <= .13, iop: 1 - seg(e, 0, .05) };
    o.w = lerp(G.W, 22, eIO(seg(e, 0, .26))); o.h = lerp(H, 22, eIO(seg(e, .08, .28)));
    btn(o, G, 1 - eIn(seg(e, 0, .13)));
    o.cy = lerp(G.ccy, G.seam - 6, eIn(seg(e, .26, .44))); o.al = 1 - seg(e, .32, .44);
    return o;
  }

  function pillHTML(n) {
    const a = ag(n.agent), more = S.q.length - 1;
    return `<img class="lka-pav" src="${esc(av(a))}" alt=""><span class="lka-tx"><b>${esc(nm(a) || n.agent || "")}</b><em class="lka-chip">${esc(L2(TAG[n.cls]))}</em><small>${esc(n.sub || "")}</small></span>`
      + `<button type="button" class="lka-more" data-lka-more data-nomo aria-label="${en() ? `${more} more` : `还有 ${more} 条`}"${more > 0 ? "" : " hidden"}><span class="lka-mf">${en() ? `${more} more` : `还有 ${more} 条`}</span><span class="lka-mb" aria-hidden="true">+${more}</span></button>`;
  }
  function pillBox() {
    if (S.pill && S.pill.isConnected && !S.pill._out) return S.pill;
    const w = document.createElement("div"); w.id = "lka-pw"; w.className = "lka-pw"; w.dataset.m = lookOf();
    w.innerHTML = `<div class="lka-pill" role="link" tabindex="0" aria-live="polite"></div><button type="button" class="lka-bud" data-lka-bud data-nomo><span></span></button><i class="lka-seam" aria-hidden="true"></i>`;
    document.body.appendChild(w); S.pill = w; w._anim = false; return w;
  }
  /* a pill that is leaving gives up the id at once, so the next notice can grow while it still folds */
  function retire(w) { w._out = true; w.removeAttribute("id"); w.classList.add("lka-gone"); if (S.pill === w) S.pill = null; }
  function paint(bump) {
    const w = pillBox(), p = pillOf(w), b = budOf(w), n = S.q[0];
    w.dataset.m = lookOf();
    p.className = "lka-pill lka-c-" + n.cls; p.innerHTML = pillHTML(n);
    p.setAttribute("aria-label", `${nm(ag(n.agent))} · ${L2(TAG[n.cls])} · ${n.sub || ""} · ${L2(BTN[n.cls])}`);
    b.className = "lka-bud lka-c-" + n.cls; b.firstElementChild.innerHTML = ico(n.cls);
    b.setAttribute("aria-label", L2(BTN[n.cls])); b.title = L2(BTN[n.cls]);
    if (bump && !RM.matches && !w._anim) p.animate([{ translate: "0 0" }, { translate: "0 3px", offset: .3 }, { translate: "0 -1px", offset: .7 }, { translate: "0 0" }], { duration: 450, easing: "ease-out" });
    if (!w._anim) place(w);
    countdown();
  }
  /* 5 s on screen (asks 8 s), then fold() into the summary. A target-less animation is the timer, so hover / focus / hidden pause it. */
  function countdown() {
    if (S.cd) { S.cd.cancel(); S.cd = null; }
    const n = S.q[0]; if (!n || !S.pill || S.pill._out) return;
    S.cd = new Animation(new KeyframeEffect(null, null, { duration: n.cls === "ask" ? MINI : HOLD })); S.cd.play();
    S.cd.onfinish = () => { S.cd = null; fold(); };
    const w = S.pill;
    if (document.hidden || (S.mouse && (pillOf(w).matches(":hover") || budOf(w).matches(":hover"))) || w.querySelector(":focus-visible")) S.cd.pause();   // touch leaves a sticky :hover and tap focus behind; neither holds it
  }
  function pillAdd(list, o = {}) {
    if (S.fs) { S.wait.push(...list); return; }
    list.forEach(n => { n._at = n._at || Date.now(); });
    const was = S.q.length > 0 && S.pill && S.pill.isConnected && !S.pill._out;
    if (!was) S.q = [];
    S.q.push(...list);
    if (was) { paint(true); return; }
    const w = pillBox(); paint(false); place(w);
    if (RM.matches) { w.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, fill: "backwards" }); return; }
    const G = geoRest(w); animStart(w);
    const from = o.from || null, dur = (from ? PRE : 0) + IN_T;
    play(dur, t => applyPill(w, G, enterFrame(G, t, from)), w).then(ok => { if (ok && !w._out) animEnd(w); });
  }
  /* the head notice and everything queued behind it go into the summary */
  function fold() {
    const w = S.pill; if (!w || w._out || !S.q.length) return;
    if (w._anim) { setTimeout(() => { if (S.pill === w && !S.cd) fold(); }, 300); return; }
    if (w.contains(document.activeElement)) document.activeElement.blur();
    if (S.cd) { S.cd.cancel(); S.cd = null; }
    const items = S.q.splice(0); retire(w);
    S.bag = S.bag.filter(x => !items.includes(x)).concat(items);
    const tgt = sumTarget();
    if (RM.matches) { w.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: "forwards" }).finished.then(() => w.remove(), () => w.remove()); sumLand(); return; }
    const G = geoRest(w); animStart(w); let landed = false;
    play(FOLD_T, e => { applyPill(w, G, foldFrame(G, e, tgt.x, tgt.y)); if (!landed && e >= LAND) { landed = true; sumLand(); } }, w)
      .then(() => { w.remove(); if (!landed) sumLand(); });
  }
  function pillOut(o = {}) {
    const w = S.pill; if (!w || w._out) return;
    S.q = []; if (S.cd) { S.cd.cancel(); S.cd = null; }
    retire(w);
    if (RM.matches) { w.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: "forwards" }).finished.then(() => w.remove(), () => w.remove()); return; }
    if (w._anim) stop(w);
    const G = geoRest(w); animStart(w);
    play(OUT_T, e => applyPill(w, G, outFrame(G, e)), w).then(() => w.remove());
  }
  function next() { S.q.shift(); if (!S.q.length) return pillOut(); paint(false); const p = pillOf(S.pill); if (!RM.matches) p.animate([{ opacity: .3, filter: "blur(3px)" }, { opacity: 1, filter: "blur(0)" }], { duration: 220, easing: "ease-out" }); }

  /* ---------- the header summary capsule (#lka-sum) ---------- */
  function sumBox() {
    let s = document.getElementById("lka-sum"); if (s) return s;
    s = document.createElement("button"); s.type = "button"; s.id = "lka-sum"; s.className = "lka-pw"; s.hidden = true; s.setAttribute("data-nomo", "");
    s.innerHTML = `<span class="lks-in"><span class="lks-avs"></span><span class="lks-tx"><b></b></span><i class="lks-sd" aria-hidden="true"></i><span class="lks-chev" aria-hidden="true">›</span></span><i class="lks-ring" aria-hidden="true"></i>`;
    document.body.appendChild(s); return s;
  }
  function sumText() {
    const B = S.bag, w = B.filter(n => WAITK(n.cls)).length, o = B.length - w, E = en();
    if (w) return E ? `${w} waiting${o ? ` · ${o} more` : ""}` : `${w} 条等你${o ? ` · 还有 ${o} 条` : ""}`;
    const rep = B.every(n => n.cls === "reply");
    return E ? (rep ? `${o} new ${o > 1 ? "replies" : "reply"}` : `${o} ${o > 1 ? "updates" : "update"}`) : (rep ? `${o} 条新回复` : `${o} 条更新`);
  }
  const sumWho = () => [...new Set(S.bag.slice().reverse().map(n => n.agent).filter(Boolean))].slice(0, 3);
  function sumFill(s) {
    const who = sumWho(), txt = sumText(), wait = S.bag.some(n => WAITK(n.cls));
    s.dataset.m = lookOf(); s.classList.toggle("lks-wait", wait);
    s.querySelector(".lks-avs").innerHTML = who.map(id => `<img src="${esc(av(ag(id)))}" alt="" data-a="${esc(id)}">`).join("");
    s.querySelector(".lks-tx b").textContent = txt;
    const lab = txt + (en() ? " · show" : " · 点开"); s.setAttribute("aria-label", lab); s.title = lab;
  }
  /* right-aligned in the top bar, left of the 信箱 / chat buttons (desk) or at the right end (phone); never over the brand, sync chip or Chrome chip */
  function sumPos(s) {
    const g = GM(), t = document.getElementById("top"), brand = document.getElementById("brand");
    const br = brand && brand.getBoundingClientRect(), cy = br && br.height ? br.top + br.height / 2 : (t ? t.getBoundingClientRect().top + g.SH : 28);
    let right = innerWidth - (PHONE.matches ? 10 : 22), left = br ? br.right + 12 : 12;
    if (!PHONE.matches) {
      const hc = [...document.querySelectorAll("#hdrctrl > *")].map(e => e.getBoundingClientRect()).filter(r => r.width && r.height);
      if (hc.length) right = Math.min(...hc.map(r => r.left)) - 14;
      ["#sync", "#toolbar .tool-pill"].forEach(q => { const e = document.querySelector(q), r = e && e.getBoundingClientRect(); if (r && r.width && r.bottom > cy - 14 && r.top < cy + 14) left = Math.max(left, r.right + 12); });
    }
    s.style.setProperty("--lks-r", Math.round(innerWidth - right) + "px"); s.style.setProperty("--lks-cy", Math.round(cy) + "px");
    s.style.setProperty("--lks-max", Math.max(g.SH + 40, Math.round(right - left)) + "px");
  }
  /* where the bead should go: the summary's centre (as it will be when it holds the new notices) */
  function sumTarget() {
    const s = sumBox(); sumPos(s);
    if (!s.hidden && !s._out) { const r = s.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
    const keep = s.innerHTML; sumFill(s); s.style.visibility = "hidden"; s.hidden = false;
    const r = s.getBoundingClientRect(); s.hidden = true; s.style.visibility = ""; s.innerHTML = keep;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  function ring(s, t) {
    const e = s.querySelector(".lks-ring").style, k = seg(t, 0, .47);
    if (k <= 0 || k >= 1) { e.visibility = "hidden"; return; }
    const g = GM().ring * eOut(k); e.visibility = ""; e.inset = `${-g}px`; e.opacity = (.6 * (1 - k)).toFixed(3);
  }
  function sumRest(s) { ["width", "height", "opacity"].forEach(k => s.style[k] = ""); s.style.removeProperty("--lks-c"); s.style.removeProperty("--lks-bl"); s.querySelector(".lks-ring").style.visibility = "hidden";
    s.querySelectorAll(".lks-old").forEach(e => e.remove()); s.querySelectorAll(".lks-tx b, .lks-avs img").forEach(e => { e.style.opacity = ""; e.style.transform = ""; e.style.marginRight = ""; }); }
  /* a bead landed: the summary appears (grows out of the bead) or swaps its words, then rings */
  function sumLand() {
    if (!S.bag.length) return;
    const s = sumBox(), was = !s.hidden && !s._out;
    const r0 = was ? s.getBoundingClientRect() : null, oldTx = s.querySelector(".lks-tx b").textContent, oldWho = [...s.querySelectorAll(".lks-avs img")].map(i => i.dataset.a);
    stop(s); sumRest(s); s._out = false; sumFill(s); sumPos(s); s.hidden = false;
    const r1 = s.getBoundingClientRect(), W1 = r1.width, H1 = r1.height;
    if (RM.matches) { if (!was) s.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, fill: "backwards" }); return; }
    if (!was) {
      play(.8, t => {
        s.style.width = lerp(22, W1, under(t, 15, .8)).toFixed(2) + "px"; s.style.height = lerp(16, H1, eOut(seg(t, 0, .16))).toFixed(2) + "px";
        s.style.setProperty("--lks-c", eOut(seg(t, .12, .26)).toFixed(3)); s.style.setProperty("--lks-bl", (4 * (1 - seg(t, .12, .26))).toFixed(2) + "px");
        ring(s, t - .27);
      }, s).then(ok => { if (ok) sumRest(s); });
      return;
    }
    const b = s.querySelector(".lks-tx b"), old = document.createElement("b"); old.className = "lks-old"; old.textContent = oldTx; old.setAttribute("aria-hidden", "true");
    const swap = oldTx !== b.textContent; if (swap) b.parentNode.appendChild(old);
    const fresh = [...s.querySelectorAll(".lks-avs img")].filter(i => !oldWho.includes(i.dataset.a)), W0 = r0.width;
    play(.8, t => {
      s.style.width = lerp(W0, W1, under(t, 16, .78)).toFixed(2) + "px";
      if (swap) { const xo = seg(t, 0, .1), xi = eOut(seg(t, .08, .22));
        old.style.opacity = (1 - xo).toFixed(3); old.style.transform = `translateY(${(-4 * xo).toFixed(2)}px)`;
        b.style.opacity = xi.toFixed(3); b.style.transform = `translateY(${(4 * (1 - xi)).toFixed(2)}px)`; }
      const ka = eOut(seg(t, 0, .2)); fresh.forEach(i => { i.style.opacity = ka.toFixed(3); i.style.transform = `translateX(${(-8 * (1 - ka)).toFixed(2)}px)`; });
      ring(s, t - .2);
    }, s).then(ok => { if (ok) sumRest(s); });
  }
  function sumHide() {
    const s = document.getElementById("lka-sum"); if (!s || s.hidden || s._out) return;
    s._out = true; stop(s);
    const done = ok => { if (ok !== false && s._out) { s.hidden = true; sumRest(s); } };
    if (RM.matches) { s.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150 }).finished.then(done, () => { }); return; }
    const r = s.getBoundingClientRect();
    play(.28, t => { s.style.width = lerp(r.width, 22, eIO(seg(t, 0, .2))).toFixed(2) + "px"; s.style.height = lerp(r.height, 16, eIO(seg(t, .05, .22))).toFixed(2) + "px";
      s.style.setProperty("--lks-c", (1 - seg(t, 0, .1)).toFixed(3)); s.style.opacity = (1 - seg(t, .18, .28)).toFixed(3); }, s).then(done);
  }
  /* the bag changed without a landing (something was answered / opened / expired): redraw quietly */
  function sumSync() {
    const s = document.getElementById("lka-sum"); if (!s || s.hidden || s._out) return;
    if (!S.bag.length) return sumHide();
    sumFill(s); sumPos(s);
  }
  /* tap the summary: the notices come back out of it (waiting ones first) */
  function expand() {
    if (!S.bag.length) return;
    const s = sumBox(), r = s.getBoundingClientRect(), from = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const rank = n => n.cls === "ask" ? 0 : n.cls === "decide" ? 1 : 2;
    const items = S.bag.splice(0).reverse().sort((a, b) => rank(a) - rank(b));
    sumHide();
    if (S.pill && !S.pill._out && S.q.length) { S.q.push(...items); paint(true); return; }
    pillAdd(items, { from });
  }

  /* an ask answered (or closed) elsewhere, a card that left review, an old reply: out of the queue and the summary */
  function live(n) {
    if (!n.it) return n.cls === "ask" || WAITK(n.cls) || Date.now() - (n._at || 0) < BAG_TTL;
    const it = App.items().find(i => i.id === n.it.id); if (!it) return false;
    if (n.cls === "ask") { const asks = App.openAsks ? App.openAsks(it) : (it.asks || []).filter(a => !a.answer && !a.closed); return asks.some(a => n.ask ? a.id === n.ask : a.q === n.text); }
    if (n.cls === "decide") return it.stage === "review";
    return true;
  }
  function prune() {
    const w = S.pill;
    if (w && !w._out && S.q.length) {
      const keep = S.q.filter(n => n.cls !== "ask" || live(n));
      if (keep.length !== S.q.length) {
        if (!keep.length) pillOut();
        else { const head = keep[0] === S.q[0]; S.q = keep; paint(false); if (!head && !RM.matches) pillOf(w).animate([{ opacity: .3, filter: "blur(3px)" }, { opacity: 1, filter: "blur(0)" }], { duration: 220, easing: "ease-out" }); }
      }
    }
    if (S.bag.length) {
      const keep = S.bag.filter(n => live(n) && (WAITK(n.cls) || Date.now() - (n._at || 0) < BAG_TTL));
      if (keep.length !== S.bag.length) { S.bag = keep; sumSync(); }
    }
  }
  App.on(() => prune());
  setInterval(() => { if (S.bag.length) prune(); }, 60e3);
  /* the look follows day / night and the texture */
  new MutationObserver(() => { document.querySelectorAll(".lka-pw").forEach(e => { e.dataset.m = lookOf(); }); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-texture"] });
  addEventListener("resize", () => { const s = document.getElementById("lka-sum"); if (s && !s.hidden) sumPos(s); if (S.pill && !S.pill._anim) place(S.pill); });
  function open(n) {
    if (n.cls === "eod") return App.route("#page=review");
    if (n.it) App.route("#item=" + encodeURIComponent(n.it.id));
    else if (n.chat) { App.route("#dm=" + encodeURIComponent(n.chat)); if (App.UI.chatFold) { const f = document.querySelector("#right .ch-fold"); f && f.click(); } }
  }
  document.addEventListener("click", e => {
    if (e.target.closest && e.target.closest("#lka-sum")) { expand(); if (e.detail === 0) setTimeout(() => { if (S.pill) pillOf(S.pill).focus(); }, 0); return; }
    const p = e.target.closest && e.target.closest("#lka-pw .lka-pill, #lka-pw .lka-bud"); if (!p || !S.pill || S.pill._out) return;
    if (p._swiped && Date.now() - p._swiped < 400) return;
    if (e.target.closest("[data-lka-more]")) return next();
    const n = S.q[0]; if (n) open(n); next();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && e.target.closest && e.target.closest("#lka-sum")) { S.bag = []; return sumHide(); }
    const p = e.target.closest && e.target.closest("#lka-pw .lka-pill"); if (!p) return;
    if (e.key === "Escape") pillOut();   // t-pill-wellness: also closes an ask without answering it
    else if ((e.key === "Enter" || e.key === " ") && !e.target.closest("[data-lka-more]")) { e.preventDefault(); const n = S.q[0]; if (n) open(n); next(); }
  });
  const hold = on => { if (!S.cd) return; if (on) S.cd.pause(); else if (!document.hidden) S.cd.play(); };
  document.addEventListener("pointerover", e => { if (e.pointerType === "mouse" && e.target.closest && e.target.closest("#lka-pw .lka-pill, #lka-pw .lka-bud")) hold(true); });
  document.addEventListener("pointerout", e => { const p = e.target.closest && e.target.closest("#lka-pw .lka-pill, #lka-pw .lka-bud"); if (p && e.pointerType === "mouse" && !p.contains(e.relatedTarget)) hold(false); });
  addEventListener("pointerdown", e => { S.mouse = e.pointerType === "mouse"; }, true);
  document.addEventListener("focusin", e => { if (e.target.closest && e.target.closest("#lka-pw") && e.target.matches(":focus-visible")) hold(true); });
  document.addEventListener("focusout", e => { if (e.target.closest && e.target.closest("#lka-pw") && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest("#lka-pw"))) hold(false); });
  document.addEventListener("visibilitychange", () => hold(document.hidden));
  /* swipe up to dismiss (finger or mouse drag) */
  const SW = {};
  document.addEventListener("pointerdown", e => { const p = e.target.closest && e.target.closest("#lka-pw .lka-pill"); if (!p || e.button !== 0 || S.pill._anim) return; SW.p = p; SW.id = e.pointerId; SW.y = e.clientY; SW.x = e.clientX; SW.on = false; });
  document.addEventListener("pointermove", e => {
    if (!SW.p || e.pointerId !== SW.id) return;
    const dy = e.clientY - SW.y;
    if (!SW.on) { if (Math.abs(e.clientX - SW.x) > 10 && Math.abs(e.clientX - SW.x) > Math.abs(dy)) { SW.p = null; return; } if (dy > -6) return; SW.on = true; hold(true); try { SW.p.setPointerCapture(e.pointerId); } catch (_) { } }
    SW.p.style.translate = `0 ${Math.min(0, dy)}px`; SW.p.style.opacity = String(Math.max(.2, 1 + dy / 120));
  });
  const swEnd = e => {
    const p = SW.p; if (!p || e.pointerId !== SW.id) return; SW.p = null; if (!SW.on) return;
    p._swiped = Date.now(); const dy = e.clientY - SW.y;
    p.style.translate = ""; p.style.opacity = "";
    if (e.type === "pointerup" && dy < -28) pillOut({ fast: true }); else hold(false);
  };
  document.addEventListener("pointerup", swEnd); document.addEventListener("pointercancel", swEnd);


  /* ---------- intake ---------- */
  /* toast.js hands over its fresh notices ({t, cls, agent, it, text, chat}); line = its one-line text. Returns true when they are ours. */
  function take(fresh, line) {
    if (mode() === "off" || !fresh.length) return false;
    const list = fresh.map(n => ({ ...n, sub: n.it ? (n.cls === "decide" ? n.it.title : (line ? line(n) : n.text) + " · " + n.it.title) : (line ? line(n) : n.text) }));
    if (window.Tour && Tour.isOpen()) { S.held = (S.held || []).concat(list); return true; }   // t-onboard-tour: no cue over the tour; release() turns them into the pill
    const rev = list.filter(n => n.cls === "decide" && n.it && !/^新规则提议/.test(n.text || ""));
    if (rev.length && !fsBlock()) { fsPlay("review", rev); const rest = list.filter(n => !rev.includes(n)); if (rest.length) S.wait.push(...rest); return true; }
    route(list);
    return true;
  }
  /* one surface per notice: on a computer replies / DMs -> top-right cards, the rest -> pill; phone (no cards there) -> pill.
     While the full screen plays everything waits (S.wait) and comes through here when it ends. */
  const toCard = n => n.cls === "reply" && !PHONE.matches && !!(window.WebToast && WebToast.show);
  function route(list) {
    if (S.fs) { S.wait.push(...list); return; }
    const cards = list.filter(toCard), pill = list.filter(n => !toCard(n));
    if (pill.length) pillAdd(pill);
    cards.slice(-3).forEach(n => WebToast.show(n));
  }
  /* end of day: the daily report lands (meta.last_report_date turns to today while the page is open) */
  function eodCheck() {
    const m = App.ST && App.ST.meta; if (!m) return;
    const d = m.last_report_date || "", was = S.eod; S.eod = d;
    if (was === undefined || d === was || d !== today() || mode() === "off") return;
    if (LS.get("rt.lka.eod", "") === d) return; LS.set("rt.lka.eod", d);
    if (!fsBlock({ eod: true })) fsPlay("eod", []);
    else { const D = fsData("eod"); pillAdd([{ cls: "eod", agent: "manager", sub: D.line, t: new Date().toISOString() }]); }
  }
  App.on(k => { if (k === "all") eodCheck(); });

  /* t-onboard-tour: the tour closed; what arrived meanwhile comes in as the quiet top pill (never the full-screen arrival) */
  function release() { const h = S.held || []; S.held = []; if (h.length && mode() !== "off") route(h); }
  /* _clock(t): freeze the pill clock at t seconds and draw that moment (frame-exact recordings); _clock(null) = real time again */
  window.LookAway = { release, take, route, fsPlay, fsEnd, pillAdd, pillOut, fold, mini: fold, expand, mode, fsBlock, eodCheck, _S: S,
    _clock: t => { CK.man = t; if (t == null) kick(); else step(); } };
})();
