// Phone layer: the theme switch (深色 / 浅色 / 白, auto mode) and theme-color meta.
// t-oss-struct S10 (A8): moved out of mobile.js unchanged. Its wire*() function holds what used to run at load (listeners, observers, the
// self-contained blocks); mobile.js calls it where the code used to be, so everything runs in the same order as before.


function wirePhTheme() {

  /* ===== ui13 (t-slack-ios P1): three-way theme switch (深色 / 浅色 / 白), remembered in localStorage, <meta theme-color> kept in step.
     Default stays dark. localStorage access is wrapped: private windows / blocked storage just mean the choice is not remembered. ===== */
  (function () {
    const COLORS = { dark: "#040404", light: "#e8e0cc", white: "#ffffff" };
    const meta = () => document.querySelector('meta[name="theme-color"]');
    const R = document.documentElement, inkPaper = () => R.dataset.skin === "ink" && R.dataset.inkLight !== "0";   // t-visual-ink: neutral paper replaces the warm light background
    // t-theme-ut: 配色 (rt.ut "ink" | "ut"). On ut, data-ut follows the theme (dark -> dark-warm, white -> light-warm) and the stage is paused (attribute only, rt.stage kept).
    const utOn = () => { try { return JSON.parse(localStorage.getItem("rt.ut")) !== "ink"; } catch (err) { return true; } };   /* open-source build: 特典 is the default */
    const UTC = { "dark-warm": "#1F110D", "light-warm": "#F7ECDA" };
    const utSync = () => {
      const t = R.dataset.theme, w = utOn() ? (t === "white" || t === "light" ? "light-warm" : "dark-warm") : null;
      if (w) { if (R.dataset.ut !== w) R.dataset.ut = w; if (R.dataset.stage) delete R.dataset.stage; } else if (R.dataset.ut) delete R.dataset.ut;
    };
    const sync = () => { utSync(); const m = meta(), t = R.dataset.theme, c = R.dataset.ut ? UTC[R.dataset.ut] : R.dataset.stage && (t === "dark" || t === "white") ? (t === "dark" ? "#15110f" : "#f3eee9") : t === "light" && inkPaper() ? "#f4f3f0" : COLORS[t]; if (m && c && m.content !== c) m.content = c; };
    new MutationObserver(sync).observe(R, { attributes: true, attributeFilter: ["data-skin", "data-ink-light", "data-stage", "data-theme"] });
    // t-visual-stage: 舞台 switches. night = dark theme + stage, day = white theme + stage, off = stage removed (theme kept). Remembered in rt.stage / rt.theme.
    function stageMarks() {
      const on = k => k === "off" ? !R.dataset.stage : !!R.dataset.stage && R.dataset.theme === (k === "night" ? "dark" : "white");
      document.querySelectorAll("[data-stage-set]").forEach(x => { const o = on(x.dataset.stageSet); x.classList.toggle("on", o); x.setAttribute("aria-checked", o); });
      document.querySelectorAll("[data-theme-set]").forEach(x => { const o = !R.dataset.stage && x.dataset.themeSet === R.dataset.theme; x.classList.toggle("on", o); x.setAttribute("aria-checked", o); });
    }
    // ===== t-settings-tab / t-theme-auto: theme mode. rt.themeMode = "auto" | "manual" per device (index.html decides it before first paint:
    // a device with no saved theme starts on auto, one that already picked stays manual). Auto = the system light / dark setting
    // (dark -> 夜 "dark", light -> 昼 "white"); a browser that answers neither falls back to the clock, 07:00–19:00 = 昼. The stage stays as it is.
    const DKQ = matchMedia("(prefers-color-scheme: dark)"), LTQ = matchMedia("(prefers-color-scheme: light)"), RMQ = matchMedia("(prefers-reduced-motion: reduce)");
    const tmode = () => { try { return JSON.parse(localStorage.getItem("rt.themeMode")) === "auto" ? "auto" : "manual"; } catch (err) { return "manual"; } };
    const setMode = m => { try { localStorage.setItem("rt.themeMode", JSON.stringify(m)); } catch (err) { } };
    const autoTheme = () => DKQ.matches ? "dark" : LTQ.matches ? "white" : (h => h >= 7 && h < 19 ? "white" : "dark")(new Date().getHours());
    function toManual() {
      if (tmode() !== "auto") return;
      setMode("manual");
      if (window.App && App.toast) App.toast(App.UI.lang === "en" ? "Switched to manual · change it back in Settings" : "已改成手动 · 设置里可改回自动");
    }
    // whole-page crossfade, 0.4 s: a View Transition where the browser has one, else a fading sheet of the old background. Reduced motion: instant.
    function fadeSwap(fn) {
      if (RMQ.matches || document.hidden) return fn();
      if (typeof document.startViewTransition === "function") {
        R.classList.add("th-vt");
        const vt = document.startViewTransition(fn);
        vt.ready.catch(() => { }); vt.updateCallbackDone.catch(() => { });   // a second switch mid-fade skips the first: not an error
        vt.finished.catch(() => { }).finally(() => R.classList.remove("th-vt"));
        return;
      }
      const bg = getComputedStyle(document.body).backgroundColor, sh = document.createElement("div");
      sh.className = "th-fade"; sh.style.background = bg; document.body.appendChild(sh);
      fn();
      requestAnimationFrame(() => requestAnimationFrame(() => { sh.style.opacity = "0"; }));
      setTimeout(() => sh.remove(), 480);
    }
    function applyTheme(t) {
      if (!window.App || !App.UI || R.dataset.theme === t) return;
      fadeSwap(() => {
        App.UI.theme = t; try { localStorage.setItem("rt.theme", JSON.stringify(t)); } catch (err) { }
        R.dataset.theme = t; sync(); stageMarks();
        if (App.refreshPage) App.refreshPage();
        document.dispatchEvent(new Event("theme:change"));
      });
    }
    // t-theme-ut: the 配色 row flips in place (no page re-render); leaving 特典 brings the stage back if rt.stage is on.
    function utPaint() {
      const on = utOn() ? "ut" : "ink", en = App.UI && App.UI.lang === "en";
      document.querySelectorAll("[data-ut-set]").forEach(x => { const o = x.dataset.utSet === on; x.classList.toggle("on", o); x.setAttribute("aria-checked", o); });
      document.querySelectorAll(".seg[data-seg=ut]").forEach(s => s.append(document.createTextNode("")));
      document.querySelectorAll("[data-stage-tog]").forEach(x => {
        const dis = on === "ut"; x.classList.toggle("st-dis", dis); x.setAttribute("aria-disabled", dis);
        x.style.display = dis ? "none" : "";   /* r-improve-1120 P4: the stage only works under 墨刊, so under 特典 the row is not shown at all (rt.stage is kept) */
        const sm = x.querySelector("small"); if (sm && App.stageSub) sm.textContent = App.stageSub(en, dis);
        const sw = x.querySelector(".sw"), st = !!R.dataset.stage || (dis && (() => { try { return JSON.parse(localStorage.getItem("rt.stage")) === true; } catch (err) { return false; } })());
        if (sw) sw.classList.toggle("on", st); x.setAttribute("aria-pressed", st);
      });
    }
    function utSet(v, quiet) {
      const go = () => {
        if (!quiet) { try { localStorage.setItem("rt.ut", JSON.stringify(v === "ut" ? "ut" : "ink")); } catch (err) { } }
        if (!utOn()) { let st = false; try { st = JSON.parse(localStorage.getItem("rt.stage")) === true; } catch (err) { } if (st && !R.dataset.stage) R.dataset.stage = "1"; }
        sync(); utPaint();
        document.dispatchEvent(new Event("theme:change"));
      };
      if (quiet) go(); else fadeSwap(go);
    }
    window.addEventListener("storage", e => { if (e.key === "rt.ut" && window.App) utSet(null, true); });
    // t-theme-knit: 质感 (rt.texture). Sets html[data-texture] (off = no attribute) and flips the segmented row in place, no page re-render.
    function texPaint() {
      const on = R.dataset.texture || "off";
      document.querySelectorAll("[data-tex-set]").forEach(x => { const o = x.dataset.texSet === on; x.classList.toggle("on", o); x.setAttribute("aria-checked", o); });
      document.querySelectorAll(".seg[data-seg=texture]").forEach(s => s.append(document.createTextNode("")));
    }
    function texSet(v, quiet) {
      v = { knit2: "knit1", leather2: "leather1" }[v] || v;   // t-tex-trim: an old tab may still write a removed texture
      const ok = (App.textures ? App.textures() : ["off"]).includes(v) ? v : "off";
      const go = () => {
        if (!quiet) { try { localStorage.setItem("rt.texture", JSON.stringify(ok)); } catch (err) { } }
        if (ok === "off") delete R.dataset.texture; else R.dataset.texture = ok;
        texPaint();
      };
      if (quiet) go(); else fadeSwap(go);
    }
    window.addEventListener("storage", e => { if (e.key === "rt.texture" && window.App) { let v = null; try { v = JSON.parse(e.newValue); } catch (err) { } texSet(v, true); } });
    sync();
    const autoTick = () => { if (tmode() === "auto") applyTheme(autoTheme()); };
    DKQ.addEventListener("change", autoTick); LTQ.addEventListener("change", autoTick);
    setInterval(autoTick, 60000);   // only matters for the clock fallback
    document.addEventListener("visibilitychange", () => { if (!document.hidden) autoTick(); });
    document.addEventListener("click", e => {
      const m = e.target.closest && e.target.closest("[data-tmode]");
      if (m && window.App) {
        const v = m.dataset.tmode;
        if (v === "auto") { setMode("auto"); if (autoTheme() === R.dataset.theme) App.refreshPage(); else applyTheme(autoTheme()); }
        else { setMode("manual"); if (v === R.dataset.theme) App.refreshPage(); else applyTheme(v); }
        return;
      }
      const u = e.target.closest && e.target.closest("[data-ut-set]");
      if (u && window.App) { utSet(u.dataset.utSet); return; }
      const tx = e.target.closest && e.target.closest("[data-tex-set]");
      if (tx && window.App) { texSet(tx.dataset.texSet); return; }
      const s = e.target.closest && e.target.closest("[data-stage-tog]");
      if (s && R.dataset.ut) return;   // t-theme-ut: the stage is paused under 特典
      if (s && window.App) {
        const on = !R.dataset.stage;
        fadeSwap(() => {
          if (on) R.dataset.stage = "1"; else delete R.dataset.stage;
          try { localStorage.setItem("rt.stage", JSON.stringify(on)); } catch (err) { }
          sync(); stageMarks(); if (App.refreshPage) App.refreshPage();
          document.dispatchEvent(new Event("theme:change"));
        });
      }
    });
    document.addEventListener("click", e => {
      const b = e.target.closest && e.target.closest("[data-stage-set]"); if (!b || !window.App) return;
      const k = b.dataset.stageSet, ls = (a, v) => { try { localStorage.setItem(a, JSON.stringify(v)); } catch (err) { } };
      if (k !== "off" && (k === "night" ? "dark" : "white") !== R.dataset.theme) toManual();   // t-settings-tab: picking night / day by hand leaves auto
      fadeSwap(() => {
      if (k === "off") { delete R.dataset.stage; ls("rt.stage", false); }
      else { const t = k === "night" ? "dark" : "white"; App.UI.theme = t; ls("rt.theme", t); R.dataset.theme = t; R.dataset.stage = "1"; ls("rt.stage", true); }
      sync(); stageMarks();
      document.querySelectorAll(".seg[data-seg=mtheme], .seg[data-seg=mstage]").forEach(s => s.append(document.createTextNode("")));
      if (App.refreshPage) App.refreshPage();
      document.dispatchEvent(new Event("theme:change"));
      });
    });
    // t-visual-ink switches: 墨刊 on/off (rt.skin) and light-theme paper (rt.inkLight); both remembered on this device, applied without a reload
    const lsw = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (err) { } };
    document.addEventListener("click", e => {
      const s = e.target.closest && e.target.closest("[data-skin-set], [data-inklight-set]"); if (!s) return;
      if (s.hasAttribute("data-skin-set")) { const on = R.dataset.skin !== "ink"; if (on) R.dataset.skin = "ink"; else delete R.dataset.skin; lsw("rt.skin", on ? "ink" : "classic"); }
      else { const on = R.dataset.inkLight === "0"; if (on) delete R.dataset.inkLight; else R.dataset.inkLight = "0"; lsw("rt.inkLight", on); }
      document.querySelectorAll("[data-skin-set]").forEach(x => { const on = R.dataset.skin === "ink"; x.classList.toggle("on", on); x.setAttribute("aria-pressed", on); const w = x.querySelector(".sw"); if (w) w.classList.toggle("on", on); });
      document.querySelectorAll("[data-inklight-set] .sw").forEach(w => w.classList.toggle("on", R.dataset.inkLight !== "0"));
      sync(); if (window.App && App.refreshPage) App.refreshPage();
      document.dispatchEvent(new Event("theme:change"));
    });
    new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    sync();
    document.addEventListener("click", e => {
      const b = e.target.closest && e.target.closest("[data-theme-set]"); if (!b) return;
      const t = b.dataset.themeSet; if (!COLORS[t] || !window.App) return;
      if (t !== R.dataset.theme) toManual();   // t-settings-tab
      const stg = R.dataset.stage; if (stg) { delete R.dataset.stage; try { localStorage.setItem("rt.stage", "false"); } catch (err) { } }   // t-visual-stage: picking a plain theme leaves the stage
      App.UI.theme = t;
      try { localStorage.setItem("rt.theme", JSON.stringify(t)); } catch (err) { }
      document.documentElement.dataset.theme = t; sync();
      document.querySelectorAll("[data-theme-set]").forEach(x => { const on = x.dataset.themeSet === t; x.classList.toggle("on", on); x.setAttribute("aria-checked", on); });
      if (stg) { stageMarks(); if (App.refreshPage) App.refreshPage(); }
      const sg = b.closest(".seg"); if (sg) sg.append(document.createTextNode(""));   // childList mutation nudges the ui4 sliding indicator
      document.dispatchEvent(new Event("theme:change"));
    });
  })();
}

export { wirePhTheme };
