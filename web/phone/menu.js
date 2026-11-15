// Phone layer: leading icons for the 菜单 rows.
// t-oss-struct S10 (A8): moved out of mobile.js unchanged. Its wire*() function holds what used to run at load (listeners, observers, the
// self-contained blocks); mobile.js calls it where the code used to be, so everything runs in the same order as before.


function wirePhMenu() {

  /* ===== ui16 (t-slack-p2 v2): leading icons for the 菜单 rows. Decorates after app.js / menuExtras render, never touches their markup logic. ===== */
  (function () {
    const I = {
      main: '<path d="M6 21V4"/><path d="M6 5h11l-2.5 3.5L17 12H6"/>',
      side: '<circle cx="6.5" cy="5.5" r="2"/><circle cx="6.5" cy="18.5" r="2"/><circle cx="17.5" cy="9" r="2"/><path d="M6.5 7.5v9M17.5 11c0 3.5-4 3-9.5 6"/>',
      daily: '<path d="M9.5 6.5H20M9.5 12H20M9.5 17.5H20"/><path d="M4 6.5h.01M4 12h.01M4 17.5h.01" stroke-width="2.6"/>',
      urgent: '<path d="M12 4 L21 19.5 H3 Z"/><path d="M12 10v4.2M12 16.8h.01"/>',
      ongoing: '<circle cx="12" cy="12.5" r="8"/><path d="M12 8.2v4.5l3 1.8"/><path d="M5 4.2 3 6.2M19 4.2l2 2"/>',   /* t-schedule-ui: 定时 = clock */
      board: '<rect x="4" y="4.5" width="16" height="15" rx="2"/><path d="M9.5 4.5v15M14.8 4.5v15"/><path d="M6.7 8h.01M12 8h.01M17.3 8h.01" stroke-width="2.4"/>',
      pipe: '<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 12h3M14 12h3"/>',   // t-imp-p3
      crew: '<circle cx="8.5" cy="8.5" r="2.8"/><circle cx="16.5" cy="9.5" r="2.3"/><path d="M3.5 19c.6-3.2 2.6-5 5-5s4.4 1.8 5 5"/><path d="M14.2 14.4c.7-.5 1.5-.8 2.3-.8 2 0 3.5 1.5 4 4.4"/>',   /* t-rb-build */
      market: '<rect x="4" y="7" width="16" height="12.5" rx="2"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7"/><path d="M4 12.5h16"/><path d="M11 12.5v1.6h2v-1.6"/>',   /* t-hm-build */
      studio: '<path d="M3.5 9.8A1.8 1.8 0 0 1 5.3 8h2.2l1.6-2.5h5.8L16.5 8h2.2a1.8 1.8 0 0 1 1.8 1.8v8.4a1.8 1.8 0 0 1-1.8 1.8H5.3a1.8 1.8 0 0 1-1.8-1.8z"/><circle cx="12" cy="13.6" r="3.3"/>',   /* t-nav-shoot: 制作 row */
      logs: '<path d="M6 4h12v13.5a2.5 2.5 0 0 1-2.5 2.5H6.5A2.5 2.5 0 0 1 4 17.5V17h3V6.5A2.5 2.5 0 0 0 4.5 4"/><path d="M10 9h5M10 12.5h5"/>',
      reports: '<path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9.5A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z"/><path d="M14 3.5V8h4M8.5 12.5h7M8.5 15.5h5"/>',
      channels: '<path d="M9.5 4 8 20M16 4l-1.5 16M4.5 9h15.5M4 15h15.5"/>',
      docs: '<path d="M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M5.5 4.5h13L20 8H4z"/><path d="M10 12.5h4"/>',
      assets: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17.5l5-4.5 3.5 3 3-2.5 4.5 4"/>',   // t-imp29-p4
      push: '<path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z"/><path d="M10 21h4"/>',
      status: '<path d="M3.5 12.5h4l2.2-5.5 4 11 2.4-5.5h4.4"/>',
      pushtest: '<path d="M20.5 4 3.5 11l6.5 2.5L12.5 20z"/><path d="M10 13.5 20.5 4"/>',
      theme: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor"/>',
      mictest: '<rect x="9" y="3.5" width="6" height="10.5" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v3"/>',
      mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7l8 6 8-6"/>',   // t-hdr-trim ①: 信箱 row (was the top-bar envelope)
      settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3 5.5 5.5"/><circle cx="12" cy="12" r="6.6"/>',   // t-settings-tab
      lang: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c-3 3.2-3 13.8 0 17M12 3.5c3 3.2 3 13.8 0 17"/>',
    };
    const ICONS_BORROW = { review: 'review', roles: 'team' };
    function pic(k) {
      const body = I[k] || (window.__ui16Base && window.__ui16Base[ICONS_BORROW[k] || k]);
      return body ? `<i class="m-ic" aria-hidden="true"><svg viewBox="0 0 24 24">${body}</svg></i>` : "";
    }
    // borrowed (review diamond / team) paths are the same as the tab bar's; duplicated here because ICON is closure-private
    window.__ui16Base = {
      review: '<path d="M12 3 L20 12 L12 21 L4 12 Z"/><path d="M12 8 L15.5 12 L12 16 L8.5 12 Z"/>',
      team: '<circle cx="9" cy="8" r="3"/><circle cx="16.5" cy="9.5" r="2.3"/><path d="M3.5 19c.6-3.4 2.8-5 5.5-5s4.9 1.6 5.5 5"/><path d="M14.8 14.6c2.6-.4 4.8 1 5.4 4.4"/>',
    };
    function decorate() {
      const left = document.getElementById("left"); if (!left) return;
      left.querySelectorAll("#nav .nav-i[data-go]").forEach(b => { if (!b.querySelector(".m-ic")) b.insertAdjacentHTML("beforeend", pic(b.dataset.go)); });
      left.querySelectorAll(".m-settings .m-set").forEach(b => {
        if (b.querySelector(":scope > .m-ic")) return;
        const k = b.dataset.set || (b.classList.contains("m-theme") ? "theme" : "");
        b.insertAdjacentHTML("beforeend", pic(k));
      });
    }
    let q = 0;
    const later = () => { if (!q) q = requestAnimationFrame(() => { q = 0; decorate(); }); };
    function boot() {
      const left = document.getElementById("left"); if (!left) return setTimeout(boot, 200);
      new MutationObserver(later).observe(left, { childList: true, subtree: true });
      decorate();
    }
    boot();
  })();
}

export { wirePhMenu };
