// t-glass-system: motion for the glass surfaces (tokens + styles live in glass.css).
// 1. t-left-glass: ONE .nav-pill slides to the selected #nav item. renderLeft() rebuilds #nav on every poll, so a MutationObserver
//    re-inserts the pill at its LAST position and only animates when the selected item actually moved. Desktop only.
// 2. t-toc-glass: window.Glass.toc(nav) moves the contents indicator; Glass.out(nav, done) plays the close animation first.
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

  window.Glass = { toc, out, nav: navSoon };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watchNav); else watchNav();
})();
