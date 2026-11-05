// t-glass-system: motion for the glass surfaces (tokens + styles live in glass.css).
// 1. t-left-glass: ONE .nav-pill slides to the selected #nav item. renderLeft() rebuilds #nav on every poll, so a MutationObserver
//    re-inserts the pill at its LAST position and only animates when the selected item actually moved. Desktop only.
// 2. t-toc-glass: window.Glass.toc(nav) moves the contents indicator; Glass.out(nav, done) plays the close animation first.
// 3. t-motion-all: tab content entry. A click on a tab / segment / filter chip / desktop nav item stamps the time and remembers the control's
//    group; the next re-render of #page within 700 ms plays ONE entry (6px rise + fade, --m-base, 20 ms stagger) on what sits after that group.
//    Poll re-renders are never stamped, so they never replay it. Skipped: the settings tabs (own crossfade), setting radios, the phone tab bar
//    and the phone quests segments (own entry), reduced motion.
// 4. t-motion-all: press. pointerdown on a control without its own press (no :active rule that sets transform / scale, on it or on a child)
//    scales it with WAAPI on the separate `scale` property: .97 for buttons / tabs, --m-press-row (.98) for rows; the release springs back (--m-spring).
//    Pointer events, so it also works on iOS where :active needs a touch listener. Reduced motion: no press.
// Off when <html data-glass="0">; prefers-reduced-motion makes every move instant (glass.css zeroes the duration tokens).
(() => {
  "use strict";
  const desk = matchMedia("(min-width: 761px)");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const off = () => document.documentElement.dataset.glass === "0";
  const place = (el, r) => { el.style.transform = `translate(${r.x}px,${r.y}px)`; el.style.width = r.w + "px"; el.style.height = r.h + "px"; };
  const same = (a, b) => a && b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
  const fresh = (el, r) => { el.style.transition = "none"; place(el, r); void el.offsetWidth; el.style.transition = ""; el.dataset.set = "1"; };

  // ---- nav pill ----
  let navLast = null, navRaf = 0;
  function navPill() {
    navRaf = 0;
    const nav = document.getElementById("nav"); if (!nav) return;
    let pill = nav.querySelector(":scope > .nav-pill");
    if (!desk.matches || off()) { if (pill) pill.remove(); navLast = null; return; }
    const on = nav.querySelector(".nav-i.on");
    if (!pill) { pill = document.createElement("i"); pill.className = "nav-pill"; pill.setAttribute("aria-hidden", "true"); nav.prepend(pill); }
    if (!on || !on.offsetWidth) { pill.style.opacity = "0"; navLast = null; return; }
    const r = { x: on.offsetLeft, y: on.offsetTop, w: on.offsetWidth, h: on.offsetHeight };
    if (!pill.dataset.set) fresh(pill, navLast || r);
    if (!same(r, navLast) || pill.style.opacity !== "1") { place(pill, r); pill.style.opacity = "1"; }
    navLast = r;
  }
  const navSoon = () => { if (!navRaf) navRaf = requestAnimationFrame(navPill); };
  function watchNav() {
    const nav = document.getElementById("nav"); if (!nav) return setTimeout(watchNav, 300);
    new MutationObserver(navSoon).observe(nav, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    addEventListener("resize", () => { navLast = null; const p = nav.querySelector(".nav-pill"); if (p) delete p.dataset.set; navSoon(); });
    desk.addEventListener("change", navSoon);
    navSoon();
  }

  // ---- TOC indicator + close animation ----
  const tocLast = new WeakMap();
  function toc(nav) {
    if (!nav || off()) return;
    const l = nav.querySelector(".toc-l"); if (!l) return;
    let ind = l.querySelector(":scope > .toc-ind");
    if (!ind) { ind = document.createElement("i"); ind.className = "toc-ind"; ind.setAttribute("aria-hidden", "true"); l.prepend(ind); }
    const b = l.querySelector("button.on");
    if (!b || !b.offsetWidth) { ind.style.opacity = "0"; return; }
    const li = b.parentElement, r = { x: 0, y: li.offsetTop, w: li.offsetWidth, h: li.offsetHeight }, last = tocLast.get(l);
    if (!ind.dataset.set) fresh(ind, last || r);
    if (!same(r, last) || ind.style.opacity !== "1") { place(ind, r); ind.style.opacity = "1"; }
    tocLast.set(l, r);
  }
  function out(nav, done) {   // play the close animation, then let app.js drop .open
    if (!nav || off() || reduce.matches || nav.classList.contains("g-out")) { if (nav) nav.classList.remove("g-out"); return done(); }
    nav.classList.add("g-out");
    setTimeout(() => { nav.classList.remove("g-out"); done(); }, 170);
  }

  // ---- tab content entry ----
  const TABSEL = '[role=tab], .seg-i, [data-libk], [data-libw], [data-libpriv], #nav .nav-i[data-go]';
  const SKIP = '.seg[data-seg=settab], .st-seg, .seg[data-seg=mseg], .seg[data-seg=mtheme], .seg[data-seg=mstage], #tabbar';
  let tab = null, tabRaf = 0;
  document.addEventListener("click", e => {
    const t = e.target.closest && e.target.closest(TABSEL);
    if (!t || t.closest(SKIP) || t.classList.contains("on") || off() || reduce.matches) return;
    const seg = t.closest(".seg[data-seg]"), nav = t.closest("#nav");
    if (nav && !desk.matches) return;   // phone: the more page opens the page with its own push
    tab = { t: performance.now(), grp: nav ? null : seg ? `.seg[data-seg="${seg.dataset.seg}"]` : t.closest(".lib-chips") ? ".lib-chips" : null };
  }, true);
  const vis = el => { if (!el.offsetParent && getComputedStyle(el).position !== "fixed") return false; const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.height > 0; };
  function tabIn() {
    tabRaf = 0; const s = tab; tab = null;
    const pb = document.getElementById("pagebody"); if (!s || !pb) return;
    let els = [];
    if (!s.grp) els = [...pb.children].filter(c => !c.matches(".ph"));
    else {   // everything after the control's group, walking up to #pagebody
      const g = pb.querySelector(s.grp); if (!g) return;
      for (let n = g.closest(".filters, .mb-f, .lib-bar") || g; n && n !== pb; n = n.parentElement)
        for (let x = n.nextElementSibling; x; x = x.nextElementSibling) els.push(x);
    }
    // a block that already plays its own one-shot entry (rise / title-in / wg-in) is left alone; endless loops (working rings) don't count
    const own = el => el.getAnimations({ subtree: true }).some(x => x.effect && x.effect.getTiming().iterations !== Infinity && !(x instanceof CSSTransition));
    els.filter(el => !el.matches("input, textarea, .seg, .filters") && vis(el) && !own(el)).slice(0, 12).forEach((el, i) =>
      el.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }],
        { duration: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--m-base")) * 1000 || 240, delay: Math.min(i, 5) * 20,
          easing: "cubic-bezier(.22, .8, .24, 1)", fill: "backwards" }));
  }
  function watchPage() {
    const pg = document.getElementById("page") || document.getElementById("pagebody"); if (!pg) return setTimeout(watchPage, 300);
    new MutationObserver(() => { if (!tab) return; if (performance.now() - tab.t > 700) { tab = null; return; } if (!tabRaf) tabRaf = requestAnimationFrame(tabIn); })
      .observe(pg, { childList: true, subtree: true });
  }

  // ---- press ----
  const CTRL = 'button, [role=button], [role=tab], summary, a[href], [data-go], [data-item], [data-chat], [data-conv], [data-lb], [data-rep], [data-ru-open], [data-more], [data-fold], ' +
    '[data-copy-v], [data-copy-id], [data-aq], [data-hd-pick], [data-msearch], [data-libk], [data-libw], [data-vp-open], [data-snz-open], [data-rf-open], [data-pl], .sync, .cal-i, .brand, .stamina, [data-nv]';
  const NOPRESS = '#tabbar *, .dk-btns *, [data-nomo], :disabled, input, textarea, select, canvas, .idc, .lb-media, #lb .lb-stage';
  let own = null;
  const ownPress = () => {   // selectors whose :active already moves the element (or a child of it): built once from the loaded sheets
    if (own) return own; own = [];
    const walk = rules => { for (const r of rules) {
      if (r.media && !r.selectorText) { if (matchMedia(r.media.mediaText).matches) walk(r.cssRules); continue; }
      if (r.cssRules && !r.selectorText) { walk(r.cssRules); continue; }
      if (!r.selectorText || !/:active/.test(r.selectorText) || !/transform|scale|translate/.test(r.style.cssText)) continue;
      for (const sel of r.selectorText.split(/,(?![^(]*\))/)) { const m = sel.match(/^(.*?:active[^\s>+~]*)/); if (m) own.push(m[1].replace(/:active/g, "").trim() || "*"); }
    } };
    for (const sh of document.styleSheets) { try { walk(sh.cssRules); } catch (e) {} }
    return own;
  };
  const hasOwn = el => ownPress().some(sel => { try { return el.matches(sel); } catch (e) { return false; } });
  const pressable = el => !!el && !el.matches(NOPRESS) && !el.closest("#tabbar, .dk-btns, [data-nomo]") && !hasOwn(el) &&
    (st => st.display !== "inline" && st.scale === "none")(getComputedStyle(el));   // scale does nothing on inline boxes; never fight a set scale
  let held = null;
  const css = k => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
  function release() {
    const h = held; held = null; if (!h) return;
    const from = getComputedStyle(h.el).scale; h.a.cancel();
    let ease = css("--m-spring") || "ease-out";
    try { h.el.animate([{ scale: from }, { scale: "1" }], { duration: (parseFloat(css("--m-base")) || .24) * 1000, easing: ease }); }
    catch (e) { h.el.animate([{ scale: from }, { scale: "1" }], { duration: 240, easing: "cubic-bezier(.34, 1.4, .64, 1)" }); }
  }
  document.addEventListener("pointerdown", e => {
    if (e.button || off() || reduce.matches) return;
    const el = e.target.closest && e.target.closest(CTRL); if (!pressable(el)) return;
    const row = !el.matches("button, [role=button], [role=tab], summary") || el.offsetWidth > 280;
    const to = row ? (parseFloat(css("--m-press-row")) || .98) : (parseFloat(css("--m-press")) || .97);
    release();
    held = { el, a: el.animate([{ scale: "1" }, { scale: String(to) }], { duration: (parseFloat(css("--m-fast")) || .14) * 1000, easing: "ease-out", fill: "forwards" }) };
  }, true);
  for (const t of ["pointerup", "pointercancel", "dragstart", "blur"]) addEventListener(t, release, true);
  document.addEventListener("pointermove", e => { if (held && e.buttons === 0) release(); }, true);

  window.Glass = { toc, out, nav: navSoon, pressable: el => pressable(el && el.closest && el.closest(CTRL)) };
  const boot = () => { watchNav(); watchPage(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
