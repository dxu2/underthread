// Phone layer: the ink skin's home greeting.
// t-oss-struct S10 (A8): moved out of mobile.js unchanged. Its wire*() function holds what used to run at load (listeners, observers, the
// self-contained blocks); mobile.js calls it where the code used to be, so everything runs in the same order as before.


function wirePhHello() {

  /* ===== t-visual-ink: phone home greeting (date eyebrow + 「今天.」) above the D1 strip. Shown only by skin-ink.css (html[data-skin="ink"]),
     only on the home page; one node, refreshed on every render, never rebuilt. ===== */
  (function () {
    const mq = matchMedia("(max-width: 760px)");
    const boot = () => { if (!window.App || !App.on || !App.inkEb) return setTimeout(boot, 50); App.on(sync); sync(); };
    function sync() {
      const ob = document.getElementById("officebox"); if (!ob || !ob.parentNode) return;
      let h = document.getElementById("inkhello");
      if (!h) { h = document.createElement("div"); h.id = "inkhello"; h.className = "ink-hello"; }
      if (h.nextSibling !== ob) ob.parentNode.insertBefore(h, ob);
      const hm = document.documentElement.dataset.home, show = (mq.matches || hm === "widgets") && App.UI.page === "review" && (!ob.hidden || hm === "widgets");   /* t-home-widgets: the widget home greets too (its #officebox stays hidden) */
      if (h.hidden === show) h.hidden = !show;   // t-home-applike: the desktop app-style home greets too. t-settings-tab: this line had been swallowed by the // comment above, so 「今天.」 stayed on every phone page after home
      if (!show) return;
      const en = App.UI.lang === "en", busy = Object.values((App.ST && App.ST.agents) || {}).filter(a => a.status === "working" && !(App.mgrOnline && App.mgrOnline(a))).length;   // t-cal-fold: same count as 此刻 (the online-only manager is not busy)
      /* t-home-clock: the time sits right after the date (filled in place by tick(), so the line's html does not change every minute) */
      const html = App.inkEb(en ? `${busy} busy` : `${busy} 在忙`).replace("<i></i>", '<time class="hc-clk" aria-live="off"></time><i></i>') + `<b>${en ? "Today" : "今天"}</b>`;
      if (h._html !== html) { h.innerHTML = html; h._html = html; hcLast = ""; }
      tick();
    }
    /* ===== t-home-clock (user 11-22): H:MM beside the date, the system's 12 / 24-hour habit (Intl default for this browser's locale),
       tabular figures, no seconds, no blinking colon. Repaints exactly on each minute boundary (setTimeout to the next :00, so it never
       drifts) and sleeps while the tab is hidden. A changed digit rolls up once (transform / opacity); reduced motion: it just changes. ===== */
    let hcT = 0, hcLast = "";
    const RM = matchMedia("(prefers-reduced-motion: reduce)");
    function hcParts(d) {
      const f = new Intl.DateTimeFormat(App.UI.lang === "en" ? "en" : undefined, { hour: "numeric", minute: "2-digit" }), h12 = /h1[12]/.test(f.resolvedOptions().hourCycle || "");
      let hh = d.getHours(); const mm = String(d.getMinutes()).padStart(2, "0");
      const per = h12 ? (f.formatToParts(d).find(x => x.type === "dayPeriod") || {}).value || "" : "";
      if (h12) hh = hh % 12 || 12;
      return { t: `${hh}:${mm}`, per, iso: `${String(d.getHours()).padStart(2, "0")}:${mm}` };
    }
    function tick() {
      clearTimeout(hcT); hcT = 0;
      const el = document.querySelector("#inkhello .hc-clk");
      if (!el || document.hidden) return;
      const d = new Date(), P = hcParts(d), key = P.t + P.per;
      if (key !== hcLast) {
        const old = hcLast ? [...el.querySelectorAll(".hc-d")].map(x => x.textContent) : null, roll = !!old && !RM.matches;
        el.dateTime = P.iso;
        let di = 0; const dg = P.t.replace(":", "");
        el.innerHTML = [...P.t].map(ch => { if (ch === ":") return '<span class="hc-c">:</span>'; const i = di++;
          return `<span class="hc-d${roll && (old.length !== dg.length || old[i] !== ch) ? " hc-roll" : ""}">${ch}</span>`; }).join("")
          + (P.per ? `<span class="hc-p">${P.per}</span>` : "");
        hcLast = key;
      }
      hcT = setTimeout(tick, 60000 - (d.getSeconds() * 1000 + d.getMilliseconds()) + 30);   // the next minute boundary (+30 ms so it lands past it)
    }
    document.addEventListener("visibilitychange", () => { if (document.hidden) { clearTimeout(hcT); hcT = 0; } else tick(); });
    window.__hcTick = tick;   // e2e hook (tests/e2e/journeys/homeclock.js)
    boot();
  })();
}

export { wirePhHello };
