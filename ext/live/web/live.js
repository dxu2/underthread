/* 看画面 / Watch, web side (built-in extension ext/live, t-oss-live).
   「看画面」 on a Chrome tool pill (App.addToolExtra) and on the phone home's team rows (home.js .a2-lk, data-live) opens #live, which shows
   the last screenshot that agent took (tools/live_hook.py pushes it; `stateutil live-frame` by hand). Polls /api/live/<agent>.jpg every
   LIVE_GAP with ?have=<etag>, so it is a 304 until a new frame lands; the next poll goes out only after the last answer. 204 = the tool
   flag cleared or switched off -> "ended" and the viewer closes itself; 202 = no frame yet (404 from an older server). Stops when the page is hidden and after
   LIVE_IDLE without a tap (tap the frame to go on). The click is taken in the capture phase so the pill's own open does not also fire.
   Switch: state meta.exts.live (config.json extensions.live, Settings -> Connections). Off = no button, no entry, no polling. */
(() => {
  "use strict";
  if (!window.App) return;
  const $ = (s, r) => (r || document).querySelector(s);
  const UI = App.UI;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const toolName = k => k === "chrome" ? "Chrome" : k === "computer" ? (UI.lang === "en" ? "Computer" : "电脑") : String(k);
  const agentOf = id => (App.agent && App.agent(id)) || ((App.ST && App.ST.agents) || {})[id] || null;
  const aname = a => (App.aname ? App.aname(a) : (a && (a.name || a.id)) || "");
  const LIVE_K = { chrome: 1 }, LIVE_GAP = 1000, LIVE_IDLE = 10 * 60e3;
  const LV = { id: "", on: false, url: "", tag: "", ft: 0, t0: 0, timer: 0 };
  const liveOn = () => { const x = App.ST && App.ST.meta && App.ST.meta.exts; return !x || x.live !== false; };
  const lvEn = () => UI.lang === "en";
  function liveMsg(txt) { const m = $("#live .lv-msg"); if (m) { m.textContent = txt || ""; m.hidden = !txt; } }
  function liveAge() {
    const tm = $("#live .lv-t"); if (!tm) return;
    if (!LV.ft) { tm.textContent = ""; return; }
    const s = Math.max(0, Math.round((Date.now() - LV.ft) / 1000));
    tm.textContent = lvEn() ? (s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`) : (s < 60 ? `${s} 秒前` : `${Math.round(s / 60)} 分钟前`);
  }
  function liveStop(txt) { LV.on = false; clearTimeout(LV.timer); if (txt != null) liveMsg(txt); }
  async function livePull() {
    if (!LV.on || !LV.id) return;
    if (document.hidden) return liveStop(lvEn() ? "Paused" : "已暂停，点一下继续");
    if (Date.now() - LV.t0 > LIVE_IDLE) return liveStop(lvEn() ? "Paused · tap to go on" : "看了 10 分钟，已暂停，点一下继续");
    const id = LV.id;
    try {
      const r = await fetch(`/api/live/${encodeURIComponent(id)}.jpg?have=${encodeURIComponent(LV.tag)}`, { cache: "no-store" });   /* ?have= not If-None-Match: WebKit drops the header under no-store */
      if (!LV.on || LV.id !== id) return;
      if (r.status === 204) { liveStop(lvEn() ? "Ended: the browser is free" : "已结束：队员不用浏览器了"); setTimeout(() => { if (LV.id === id && !LV.on) liveClose(); }, 2500); return; }
      if (r.status === 202 || r.status === 404) { if (!LV.ft) liveMsg(lvEn() ? "Waiting for the first screenshot…" : "等队员截第一张图…"); }
      else if (r.status === 200) {
        const u = URL.createObjectURL(await r.blob()), img = $("#live .lv-img");
        if (img) { img.src = u; img.classList.add("on"); }
        if (LV.url) URL.revokeObjectURL(LV.url);
        LV.url = u; LV.tag = r.headers.get("ETag") || ""; LV.ft = +(r.headers.get("X-Live-T") || Date.now()); liveMsg("");
      } else if (r.status !== 304) liveMsg((lvEn() ? "No frame: " : "拿不到画面：") + r.status);
    } catch (e) { liveMsg(lvEn() ? "Connection lost, retrying" : "连接断了，正在重试"); }
    liveAge();
    if (LV.on) LV.timer = setTimeout(livePull, LIVE_GAP);
  }
  function liveGo() { LV.t0 = Date.now(); if (!LV.on) { LV.on = true; liveMsg(LV.ft ? "" : (lvEn() ? "Connecting…" : "正在取画面…")); livePull(); } }
  function liveOpen(id) {
    let el = $("#live");
    if (!el) {
      document.body.insertAdjacentHTML("beforeend", `<div id="live" role="dialog" aria-modal="true" hidden><div class="lv-box"><div class="lv-hd"><b class="lv-nm"></b><time class="lv-t"></time><button type="button" class="lv-x" aria-label="${UI.lang === "en" ? "Close" : "关闭"}">${UI.lang === "en" ? "Close" : "关闭"}</button></div><div class="lv-fr"><img class="lv-img" alt=""><p class="lv-msg" hidden></p></div></div></div>`);
      el = $("#live");
      el.addEventListener("click", e => {
        if (e.target.closest(".lv-x") || e.target === el) return liveClose();
        if (e.target.closest(".lv-fr")) liveGo();
      });
      document.addEventListener("visibilitychange", () => { if (!document.hidden && LV.id && !$("#live").hidden && !LV.on) liveGo(); });
      document.addEventListener("keydown", e => { if (e.key === "Escape" && LV.id) liveClose(); });
    }
    const a = agentOf(id);
    $(".lv-nm", el).textContent = (a ? aname(a) + " · " : "") + toolName((a && a.tool) || "chrome") + (lvEn() ? " · last screenshot" : " · 最近一张截图");
    $(".lv-img", el).classList.remove("on"); $(".lv-img", el).removeAttribute("src");
    LV.id = id; LV.tag = ""; LV.ft = 0; el.hidden = false; requestAnimationFrame(() => el.classList.add("in"));
    LV.on = false; liveGo();
  }
  function liveClose() {
    const el = $("#live"); liveStop(); LV.id = "";
    if (LV.url) { URL.revokeObjectURL(LV.url); LV.url = ""; }
    if (!el) return;
    el.classList.remove("in"); setTimeout(() => { if (!LV.id) el.hidden = true; }, 200);
  }
  document.addEventListener("click", e => {
    const b = e.target.closest && e.target.closest("[data-live]"); if (!b || !liveOn()) return;
    e.preventDefault(); e.stopPropagation(); liveOpen(b.dataset.live);
  }, true);
  if (App.addToolExtra) App.addToolExtra((a, k, old) => LIVE_K[k] && !old && liveOn() ? `<button type="button" class="tp-live" data-live="${esc(a.id)}">${UI.lang === "en" ? "Watch" : "看画面"}</button>` : "");
  App.liveOpen = id => liveOpen(id);
  App.liveOn = liveOn;
  App.liveOff = () => liveClose();   /* Settings switched it off while the viewer was open */
})();
