// Ambience and motion: drifting soul motes, fog, pointer glow, page entrances,
// soul bursts and area-title cards. Everything respects prefers-reduced-motion.
(function () {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dark = () => document.documentElement.dataset.theme !== "light";

  // ---------- ornaments (shared with app.js) ----------
  const ORN = {
    divider: (w = 240) => `<svg class="orn orn-draw" width="${w}" height="26" viewBox="0 0 240 26" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round">
      <path class="o-l" d="M104 13 H34"/><path class="o-l" d="M136 13 H206"/>
      <path class="o-c" d="M34 13 C26 13 20 8 23 4 C25 1.5 30 3 29 6.5 C28.4 8.4 26 8.6 25.3 7.2"/>
      <path class="o-c" d="M206 13 C214 13 220 8 217 4 C215 1.5 210 3 211 6.5 C211.6 8.4 214 8.6 214.7 7.2"/>
      <path class="o-c" d="M34 13 C27 13 22 17 24 20.5 C25.5 23 29.5 22 29 19.5"/><path class="o-c" d="M206 13 C213 13 218 17 216 20.5 C214.5 23 210.5 22 211 19.5"/>
      <path class="o-c" d="M110 13 C106 6 98 5.5 95 9 C93 11.5 95.5 14.5 98 13"/><path class="o-c" d="M130 13 C134 6 142 5.5 145 9 C147 11.5 144.5 14.5 142 13"/>
      <path class="o-d" d="M120 2 L127 13 L120 24 L113 13 Z"/><path class="o-f" d="M120 7.5 L123.5 13 L120 18.5 L116.5 13 Z" fill="currentColor"/>
      <circle class="o-f" cx="86" cy="13" r="1.2" fill="currentColor"/><circle class="o-f" cx="154" cy="13" r="1.2" fill="currentColor"/>
      <circle class="o-f" cx="62" cy="13" r=".8" fill="currentColor"/><circle class="o-f" cx="178" cy="13" r=".8" fill="currentColor"/></svg>`,
    small: (w = 120) => `<svg class="orn orn-sm" width="${w}" height="14" viewBox="0 0 120 14" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round">
      <path d="M52 7 H8"/><path d="M68 7 H112"/><path d="M8 7 C4 7 2 4 4 2.5 C5.5 1.5 7 3 6 4.3"/><path d="M112 7 C116 7 118 4 116 2.5 C114.5 1.5 113 3 114 4.3"/>
      <path d="M60 1.5 L64.5 7 L60 12.5 L55.5 7 Z"/><circle cx="60" cy="7" r="1.3" fill="currentColor"/></svg>`,
  };
  // pathLength=1 lets CSS "draw" every stroke with a 0→1 dash animation
  const raw = ORN.divider;
  ORN.divider = w => raw(w).replace(/<(path|circle) /g, '<$1 pathLength="1" ');
  window.ORN = ORN;

  // ---------- ambience: fog + motes ----------
  function ambience() {
    const amb = document.createElement("div");
    amb.id = "ambience";
    amb.innerHTML = `<div class="fog f1"></div><div class="fog f2"></div><div class="shafts"></div><canvas></canvas><div class="grain"></div>`;
    document.body.prepend(amb);
    if (reduce) return;
    const cv = amb.querySelector("canvas"), ctx = cv.getContext("2d");
    let W = 0, H = 0, dpr = Math.min(2, devicePixelRatio || 1);
    const motes = [];
    function resize() { W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + "px"; cv.style.height = H + "px"; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    resize(); addEventListener("resize", resize);
    const N = Math.round(Math.min(70, W * H / 26000));
    for (let i = 0; i < N; i++) motes.push(spawn(true));
    function spawn(any) {
      const big = Math.random() < 0.12;
      return { x: Math.random() * W, y: any ? Math.random() * H : H + 10, r: big ? 1.6 + Math.random() * 1.6 : 0.5 + Math.random() * 1.1,
        vy: -(0.06 + Math.random() * 0.22), ph: Math.random() * 6.28, amp: 0.15 + Math.random() * 0.4, a: 0.25 + Math.random() * 0.6, tw: 0.4 + Math.random() * 1.6 };
    }
    let mx = -999, my = -999;
    addEventListener("pointermove", e => { mx = e.clientX; my = e.clientY; }, { passive: true });
    let last = 0;
    function frame(t) {
      requestAnimationFrame(frame);
      if (document.hidden || t - last < 33) return;
      const dt = Math.min(3, (t - last) / 16.7); last = t;
      ctx.clearRect(0, 0, W, H);
      const isDark = dark();
      for (let i = 0; i < motes.length; i++) {
        const m = motes[i];
        m.y += m.vy * dt; m.x += Math.sin(t / 2400 + m.ph) * m.amp * 0.3 * dt;
        const dx = m.x - mx, dy = m.y - my, d2 = dx * dx + dy * dy;
        if (d2 < 9000) { const f = (1 - d2 / 9000) * 0.6; m.x += dx / 60 * f * dt; m.y += dy / 60 * f * dt; }
        if (m.y < -12) motes[i] = spawn(false);
        const a = m.a * (0.55 + 0.45 * Math.sin(t / 1000 * m.tw + m.ph));
        if (isDark) {
          const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r * 5);
          g.addColorStop(0, `rgba(246,244,238,${a})`); g.addColorStop(0.35, `rgba(220,222,228,${a * 0.3})`); g.addColorStop(1, "rgba(220,222,228,0)");
          ctx.fillStyle = g; ctx.fillRect(m.x - m.r * 5, m.y - m.r * 5, m.r * 10, m.r * 10);
        } else {
          ctx.fillStyle = `rgba(70,55,35,${a * 0.35})`; ctx.beginPath(); ctx.arc(m.x, m.y, m.r * 0.9, 0, 7); ctx.fill();
        }
      }
    }
    requestAnimationFrame(frame);
  }

  // ---------- pointer glow on cards and panels ----------
  function pointerGlow() {
    document.addEventListener("pointermove", e => {
      const el = e.target.closest && e.target.closest(".card, .rc, .mini, .plat, .btn-s, .nav-i, .team-i");
      if (!el) return;
      const b = el.getBoundingClientRect();
      el.style.setProperty("--mx", (e.clientX - b.left) + "px");
      el.style.setProperty("--my", (e.clientY - b.top) + "px");
    }, { passive: true });
  }

  // ---------- page entrance ----------
  const rmMQ = matchMedia("(prefers-reduced-motion: reduce)"), phoneMQ = matchMedia("(max-width: 760px)");
  const tokN = (n, d) => { const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(n)); return isNaN(v) ? d : v; };
  const tokS = (n, d) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d;
  let rowsKey = "", rowsAt = 0;
  // mo1: phone list entrance (.act-row rows + category .card lists + the office card). WAAPI, transform/opacity only, runs on the elements that exist at call time,
  // so a state poll that re-renders the list later never replays it. Only rows already inside the viewport are animated (<= 8, 30ms apart): a synchronous
  // check, because an IntersectionObserver callback would arrive a frame late and let the rows flash in unanimated first. Guarded against double calls
  // (App.go -> enter, then the tab bar's own call) by page+tab key within 400 ms.
  function rows(body) {
    if (!phoneMQ.matches || !body || !body.isConnected || !body.offsetParent || !window.App) return;
    const key = (App.UI.page || "") + "|" + (document.body.dataset.mtab || ""), now = performance.now();
    if (key === rowsKey && now - rowsAt < 400) return;
    rowsKey = key; rowsAt = now;
    const rm = rmMQ.matches, rise = tokN("--m-rise", 10), dur = rm ? 120 : tokN("--m-base", 280), step = rm ? 0 : tokN("--m-stagger", 30), ease = rm ? "linear" : tokS("--m-ease-emph", "cubic-bezier(.2,.8,.2,1)");
    const spring = tokS("--m-spring", ease), vh = innerHeight;
    const from = rm ? { opacity: 0 } : { opacity: 0, transform: `translateY(${rise}px)` }, to = rm ? { opacity: 1 } : { opacity: 1, transform: "none" };
    const of = document.querySelector("#officebox:not([hidden]) .office-frame");
    let base = 0;
    if (of && of.offsetParent) { base = rm ? 0 : 90; of.animate([rm ? { opacity: 0 } : { opacity: 0, transform: "scale(.97)" }, rm ? { opacity: 1 } : { opacity: 1, transform: "none" }], { duration: rm ? 120 : 360, easing: ease, fill: "backwards" }); }
    let n = 0;
    for (const r of body.querySelectorAll(".act-row, .card")) {
      if (n >= 8) break;
      const b = r.getBoundingClientRect(); if (b.bottom <= 0 || b.top >= vh) continue;
      const d = base + n * step; n++;
      r.animate([from, to], { duration: dur, delay: d, easing: ease, fill: "backwards" });
      const dot = !rm && r.querySelector(".act-dot");
      if (dot) dot.animate([{ transform: "scale(.2)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: 300, delay: d + 240, easing: spring, fill: "backwards" });
    }
  }
  function enter(el) {
    if (!el) return;
    if (!reduce) {
      el.classList.remove("enter"); void el.offsetWidth; el.classList.add("enter");
      let i = 0;
      for (const c of el.querySelectorAll(".card, .rc, .mini, .log-i, .mail-i, .rep, .plat, .grp-h, .col, .act-row")) c.style.setProperty("--i", Math.min(i++, 14));
      clearTimeout(el._enterT); el._enterT = setTimeout(() => el.classList.remove("enter"), 1400);
    }
    if (el.id === "pagebody") rows(el);
  }

  // ---------- soul burst ----------
  function burst(x, y, opts = {}) {
    if (reduce) return;
    const n = opts.n || 34, layer = document.createElement("div");
    layer.className = "burst"; layer.style.left = x + "px"; layer.style.top = y + "px";
    for (let i = 0; i < n; i++) {
      const p = document.createElement("i"), ang = Math.random() * Math.PI * 2, dist = 40 + Math.random() * (opts.spread || 140);
      p.style.setProperty("--dx", Math.cos(ang) * dist + "px"); p.style.setProperty("--dy", Math.sin(ang) * dist - 30 + "px");
      p.style.setProperty("--s", (0.4 + Math.random() * 1.2).toFixed(2)); p.style.setProperty("--d", (600 + Math.random() * 700 | 0) + "ms");
      if (opts.color) p.style.setProperty("--c", opts.color);
      layer.appendChild(p);
    }
    const ring = document.createElement("b"); layer.appendChild(ring);
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 1600);
  }

  // ---------- area title card ----------
  function titleCard(main, sub, opts = {}) {
    const el = document.createElement("div");
    el.className = "title-card" + (opts.cls ? " " + opts.cls : "");
    el.innerHTML = `<div class="tc-inner">${sub ? `<div class="tc-sub">${sub}</div>` : ""}${ORN.divider(300)}<div class="tc-main">${main}</div>${ORN.divider(300).replace("orn-draw", "orn-draw flip")}</div>`;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add("out"), opts.hold || 1700);
    setTimeout(() => el.remove(), (opts.hold || 1700) + 1100);
  }


  // ---------- 委托完成 mission-complete splash ----------
  // One master CSS timeline (.mc, 2.6 s, see style.css); no JS timers drive the visuals. The art has a solid backdrop, so no cut-out:
  // its corner colour is sampled into --bgc and painted as a matching light wash, and a CSS mask feathers the art edge into it.
  // o = { key (dedupe id), owner (agent id), title, time, onEnd }. Fires at most once per key while one is showing; removes itself from the DOM; never blocks input afterwards.
  function missionComplete(o = {}) {
    const A = window.App; if (!A) return null;
    const live = document.querySelector(".mc");
    if (live && o.key && live.dataset.key === String(o.key)) return live;   // same completion (double tap / state refresh): do nothing
    if (live) live.remove();
    const own = A.agent(o.owner || "manager"), zh = (A.UI.lang || "zh") !== "en";
    const el = document.createElement("div");
    el.className = "mc"; if (o.key) el.dataset.key = String(o.key);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) el.classList.add("rm");
    el.setAttribute("role", "status");
    const esc = x => String(x == null ? "" : x).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    el.innerHTML = `<div class="mc-dim"></div><div class="mc-glow"></div><div class="mc-st"><i></i><i></i><i></i></div>
      <img class="mc-art" alt="" src="/static/art/${encodeURIComponent(own.id)}.jpg" decoding="async">
      <div class="mc-flash"></div>
      <div class="mc-plate"><span class="mc-k">MISSION COMPLETE</span><b class="mc-main">${zh ? "委托完成" : "Mission Complete"}</b></div>
      <div class="mc-info"><div class="mc-t">${esc(o.title || "")}</div><div class="mc-by">${A.av(own, "sm")}<span>${esc(A.aname(own))}${o.time ? " · " + esc(o.time) : ""}</span></div></div>`;
    const img = el.querySelector(".mc-art");
    img.addEventListener("load", () => {
      try { const c = document.createElement("canvas"); c.width = c.height = 1; const x = c.getContext("2d"); x.drawImage(img, 0, 0, 20, 20, 0, 0, 1, 1); const d = x.getImageData(0, 0, 1, 1).data; el.style.setProperty("--bgc", `rgb(${d[0]},${d[1]},${d[2]})`); } catch { }
    });
    img.addEventListener("error", () => el.classList.add("noart"));
    let ended = false;
    const finish = () => { if (ended) return; ended = true; clearTimeout(guard); el.remove(); try { o.onEnd && o.onEnd(); } catch { } };
    const guard = setTimeout(finish, 3400);   // animationend can be skipped (hidden tab, display:none): never leave the overlay behind
    el.addEventListener("click", () => { if (el.classList.contains("bye")) return; el.classList.add("bye"); setTimeout(finish, 260); });
    el.addEventListener("animationend", e => { if (e.target === el && /^mc-life/.test(e.animationName)) finish(); });
    document.body.appendChild(el);
    return el;
  }

  // ---------- splash (once per browser session) ----------
  function splash() {
    let seen = false;
    try { seen = sessionStorage.getItem("rt.splash") === "1"; sessionStorage.setItem("rt.splash", "1"); } catch { }
    if (seen || reduce) return;
    titleCard("Underthread", "Personal Agent Team", { cls: "splash", hold: 1500 });
  }

  // ---------- count-up for changing numbers ----------
  const lastNum = new WeakMap();
  function countUp(root) {
    if (reduce) return;
    for (const el of root.querySelectorAll("[data-count]")) {
      const to = +el.dataset.count, from = lastNum.has(el) ? lastNum.get(el) : (+el.dataset.from || 0);
      lastNum.set(el, to);
      if (from === to) { el.textContent = to; continue; }
      const t0 = performance.now(), dur = 700;
      const step = t => { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3); el.textContent = Math.round(from + (to - from) * e); if (p < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }
  }

  ambience(); pointerGlow();
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", splash); else splash();
  window.FX = { enter, rows, burst, titleCard, countUp, reduce, missionComplete };
})();
