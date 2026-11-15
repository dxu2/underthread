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
      const html = App.inkEb(en ? `${busy} busy` : `${busy} 在忙`) + `<b>${en ? "Today" : "今天"}</b>`;
      if (h._html !== html) { h.innerHTML = html; h._html = html; }
    }
    boot();
  })();
}

export { wirePhHello };
