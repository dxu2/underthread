// Phone layer: edge swipe to close the card, swipe right to go back.
// t-oss-struct S10 (A8): moved out of mobile.js unchanged. Its wire*() function holds what used to run at load (listeners, observers, the
// self-contained blocks); mobile.js calls it where the code used to be, so everything runs in the same order as before.


function wirePhGestures() {

  // ===== ui1-B: swipe from the left edge to close the detail (it pushes in from the right) =====
  (() => {
    const dw = document.getElementById("drawer"); if (!dw) return;
    let x0 = null, y0 = 0, dx = 0, live = false;
    dw.addEventListener("touchstart", e => {
      const t = e.touches[0]; x0 = null; /* ui3: superseded by the swipe-back block below */ y0 = t.clientY; dx = 0; live = false;
    }, { passive: true });
    dw.addEventListener("touchmove", e => {
      if (x0 == null) return; const t = e.touches[0]; dx = t.clientX - x0;
      if (!live && Math.abs(t.clientY - y0) > Math.abs(dx)) { x0 = null; return; }
      if (dx > 6) { live = true; dw.style.transition = "none"; dw.style.transform = `translateX(${Math.max(0, dx)}px)`; }
    }, { passive: true });
    const end = () => {
      if (x0 == null) return; const go = live && dx > 90; x0 = null;
      dw.style.transition = ""; dw.style.transform = "";
      if (live && go) App.closeItem();
    };
    dw.addEventListener("touchend", end, { passive: true }); dw.addEventListener("touchcancel", end, { passive: true });
  })();

  // ===== ui3: swipe right to go back (WeChat-style). Starts in a generous left zone, or anywhere on a clearly horizontal drag;
  // the page follows the finger, then springs back or commits. Lightbox / inputs / horizontally scrollable areas are left alone. =====
  (() => {
    const dw = document.getElementById("drawer"); if (!dw) return;
    const mq = matchMedia("(max-width: 760px)"), still = matchMedia("(prefers-reduced-motion: reduce)");
    const EDGE = 40, W = () => dw.clientWidth || innerWidth;
    let st = null, relT = 0;   // { x, y, t, dx, mode: "wait" | "drag" | "no" }
    const hscroll = el => { for (; el && el !== dw; el = el.parentElement) { if (el.scrollWidth > el.clientWidth + 2 && /(auto|scroll)/.test(getComputedStyle(el).overflowX)) return true; } return false; };
    dw.addEventListener("touchstart", e => {
      st = null;
      if (!mq.matches || dw.hidden || e.touches.length !== 1 || document.body.classList.contains("lb-open")) return;
      const t = e.touches[0], el = e.target;
      if (el.closest && el.closest("input,textarea,select,[contenteditable],video,audio")) return;
      st = { x: t.clientX, y: t.clientY, t: performance.now(), dx: 0, mode: "wait", edge: t.clientX < EDGE, hs: hscroll(el) };
      if (st.hs && !st.edge) st = null;
    }, { passive: true });
    dw.addEventListener("touchmove", e => {
      if (!st || st.mode === "no") return;
      const t = e.touches[0], dx = t.clientX - st.x, dy = t.clientY - st.y;
      if (st.mode === "wait") {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        // commit to a back-swipe only if it is rightward and clearly more horizontal than vertical (edge start is more forgiving)
        if (dx > 0 && Math.abs(dx) > Math.abs(dy) * (st.edge ? 1 : 1.6)) {
          st.mode = "drag"; dw.classList.add("swiping");
          // mo1: grabbing the page mid-release must not jump: start from where it visually is, and cancel the pending close/cleanup
          clearTimeout(relT); try { st.base = Math.max(0, new DOMMatrix(getComputedStyle(dw).transform).m41); } catch (e) { st.base = 0; }
          dw.style.transition = "none"; dw.style.transform = `translateX(${st.base}px)`;
        }
        else { st.mode = "no"; return; }
      }
      st.dx = Math.max(0, dx + (st.base || 0)); st.v = (st.dx - (st.lx || 0)) / Math.max(1, performance.now() - (st.lt || st.t)); st.lx = st.dx; st.lt = performance.now();
      dw.style.transform = `translateX(${st.dx}px)`;
    }, { passive: true });
    const end = cancel => {
      const s = st; st = null; if (!s || s.mode !== "drag") return;
      const go = !cancel && (s.dx > W() * 0.33 || (s.v > 0.5 && s.dx > 40));
      dw.classList.remove("swiping");
      const back = () => (App.backItem || App.closeItem)();   // t-parent-links: back to the parent card if you came from one, else close
      if (still.matches) { dw.style.transition = "none"; dw.style.transform = ""; if (go) back(); return; }
      // same motion language as the push-in: ease-out spring to the end state
      clearTimeout(relT);
      if (go) {   // commit: quick emphasized slide out (--m-base / --m-ease-emph)
        dw.style.transition = "transform var(--m-base) var(--m-ease-emph)"; dw.style.transform = "translateX(100%)";
        relT = setTimeout(() => { dw.style.transition = "none"; back(); dw.style.transform = ""; void dw.offsetWidth; dw.style.transition = ""; }, 250);
      } else {    // cancel: soft spring back, no overshoot (--m-slow / --m-spring-soft)
        dw.style.transition = "transform var(--m-slow) var(--m-spring-soft)"; dw.style.transform = "translateX(0)";
        relT = setTimeout(() => { dw.style.transition = ""; dw.style.transform = ""; }, 440);
      }
    };
    dw.addEventListener("touchend", () => end(false), { passive: true });
    dw.addEventListener("touchcancel", () => end(true), { passive: true });
  })();
}

export { wirePhGestures };
