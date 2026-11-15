// Phone layer: pull to refresh.
// t-oss-struct S10 (A8): moved out of mobile.js unchanged. Its wire*() function holds what used to run at load (listeners, observers, the
// self-contained blocks); mobile.js calls it where the code used to be, so everything runs in the same order as before.


function wirePhPull() {

  // ===== t-m2-c ④ pull-to-refresh (phone only). Pull down at the very top of a list (#page / chat list / 更多) and let go past the threshold:
  // a forced full /api/state fetch (App.refresh), then a short "已更新" state with the red dot. The board still polls every 2.5s; this is for "I want it NOW".
  // Gesture safety: every listener is passive, so native scrolling, the iOS rubber band and the edge back-swipe are never blocked; we only draw a glass pill.
  //  - starts only when the scroller is at scrollTop 0, one finger, x >= 24 (iOS edge back-swipe zone), not on inputs / the voice pill, no drawer / modal / lightbox / search open
  //  - decides after 10px: clearly vertical and downward (dy > 1.8 * |dx|), else it lets go for good (horizontal swipes, the right-swipe back, the D1 strip scrub)
  //  - a press held 450ms before moving is a text-selection / long-press: ignored; a live text selection is ignored too
  //  - if the list actually scrolls (scrollTop > 2) the pull is dropped
  //  - move/end are bound to the touchstart target as well as document (a 2.5s poll re-render can detach the node under the finger; WebKit keeps firing on it)
  // Cost: one fixed pill, display:none when idle (no layer). will-change only during the gesture; the spinner animation exists only while fetching.
  (() => {
    const mq = matchMedia("(max-width: 760px)"), still = matchMedia("(prefers-reduced-motion: reduce)");
    const NATIVE = 24, DEC = 10, TH = 64, MAXV = 84, HOLD = 450;   // TH/MAXV are visual px after resistance
    const en = () => window.App && App.UI && App.UI.lang === "en";
    const L = { pull: ["下拉刷新", "Pull to refresh"], ready: ["松开刷新", "Release to refresh"], busy: ["刷新中", "Refreshing"], done: ["已更新", "Updated"], fail: ["没连上 · 会自动重试", "Offline · retrying"] };
    let pill = null, st = null, busy = false, hideT = 0;
    const lab = k => L[k][en() ? 1 : 0];
    function mk() {
      if (pill) return pill;
      pill = document.createElement("div"); pill.id = "ptr"; pill.setAttribute("role", "status"); pill.setAttribute("aria-live", "polite");
      pill.innerHTML = `<i class="ptr-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 5v13M6.5 12.5 12 18l5.5-5.5"/></svg></i><i class="ptr-sp" aria-hidden="true"></i><i class="ptr-dot" aria-hidden="true"></i><span class="ptr-t"></span>`;
      document.body.appendChild(pill); return pill;
    }
    const resist = d => MAXV * (1 - Math.exp(-d / 150));   // rubber-band feel: 64px visual at ~170px of finger travel
    function show(s, v) {
      const p = mk(); clearTimeout(hideT);
      p.dataset.s = s; p.querySelector(".ptr-t").textContent = s === "done" ? `${lab("done")} · ${new Date().toTimeString().slice(0, 5)}` : lab(s);
      if (v != null) { p.style.setProperty("--ptr-y", v.toFixed(1) + "px"); p.style.setProperty("--ptr-o", Math.min(1, v / 36).toFixed(3)); }
      p.hidden = false;
    }
    function hide(after) {
      if (!pill) return; clearTimeout(hideT);
      hideT = setTimeout(() => {
        pill.dataset.s = "out";
        hideT = setTimeout(() => { pill.hidden = true; pill.classList.remove("live"); pill.dataset.s = ""; }, still.matches ? 0 : 260);
      }, after || 0);
    }
    const blocked = () => document.body.classList.contains("lb-open") || document.body.classList.contains("msearch") || document.body.classList.contains("sheet")
      || document.body.classList.contains("oof-leave") || (document.getElementById("drawer") && document.getElementById("drawer").classList.contains("open"))
      || (document.getElementById("modal") && !document.getElementById("modal").hidden);
    const once = (e, fn) => { if (e.__ptr) return; e.__ptr = 1; fn(e); };
    const mv = e => once(e, onMove), en_ = e => once(e, onEnd), cn = e => once(e, onCancel);
    const unbind = s => { if (s && s.tg) { s.tg.removeEventListener("touchmove", mv); s.tg.removeEventListener("touchend", en_); s.tg.removeEventListener("touchcancel", cn); s.tg = null; } };
    document.addEventListener("touchstart", e => {
      unbind(st); st = null;
      if (!mq.matches || busy || e.touches.length !== 1 || blocked()) return;
      const t = e.touches[0], el = e.target; if (t.clientX < NATIVE || !el.closest) return;
      if (el.closest("input,textarea,select,[contenteditable],video,audio,.vc-pill,.vc-full,.vc-menu,#tabbar")) return;
      const sc = el.closest("#page, .cl-rows, #left"); if (!sc || sc.scrollTop > 0) return;
      const sel = getSelection && getSelection(); if (sel && !sel.isCollapsed) return;
      st = { x: t.clientX, y: t.clientY, t: performance.now(), sc, mode: "wait", v: 0, tg: el };
      el.addEventListener("touchmove", mv, { passive: true }); el.addEventListener("touchend", en_, { passive: true }); el.addEventListener("touchcancel", cn, { passive: true });
    }, { passive: true });
    function onMove(e) {
      if (!st || st.mode === "no") return;
      const t = e.touches[0], dx = t.clientX - st.x, dy = t.clientY - st.y;
      if (st.mode === "wait") {
        if (Math.abs(dx) < DEC && Math.abs(dy) < DEC) return;
        if (dy > 0 && dy > Math.abs(dx) * 1.8 && performance.now() - st.t < HOLD && st.sc.scrollTop <= 0 && !blocked()) {
          st.mode = "pull"; st.y = t.clientY - DEC;   // count from the decision point minus the dead zone, so the pill does not jump
          st.top = Math.max(0, st.sc.getBoundingClientRect().top);
          mk().style.setProperty("--ptr-top", st.top + "px"); pill.classList.add("live");   // .live = will-change while the finger is down
        } else { st.mode = "no"; return; }
      }
      if (st.sc.scrollTop > 2) { drop(); return; }   // the list really scrolled: not a pull
      const d = Math.max(0, t.clientY - st.y); st.v = resist(d);
      show(st.v >= TH ? "ready" : "pull", st.v);
    }
    function drop() { const s = st; unbind(s); st = null; if (s && s.mode === "pull") { pill.classList.remove("live"); hide(); } }
    async function onEnd() {
      const s = st; unbind(s); st = null; if (!s || s.mode !== "pull") return;
      if (s.v < TH || busy) { pill.classList.remove("live"); hide(); return; }
      busy = true; show("busy", 52); pill.classList.remove("live");
      const t0 = performance.now(); let ok = false;
      try { ok = await App.refresh(); } catch (_) { ok = false; }
      const left = 450 - (performance.now() - t0); if (left > 0) await new Promise(r => setTimeout(r, left));   // no one-frame spinner flash on the LAN
      show(ok ? "done" : "fail", 52); busy = false;
      hide(ok ? 900 : 1600);
    }
    function onCancel() { drop(); }   // the system took the touch (edge back, notification shade): no refresh
    document.addEventListener("touchmove", mv, { passive: true }); document.addEventListener("touchend", en_, { passive: true }); document.addEventListener("touchcancel", cn, { passive: true });
    window.__ptr = { state: () => ({ st: st && st.mode, busy, s: pill && pill.dataset.s, hidden: !pill || pill.hidden }) };   // test hook (read-only)
  })();
}

export { wirePhPull };
