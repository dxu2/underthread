// Phone layer: the WeChat-style composer (+ panel, send button) and the auto-growing one-row chat field.
// t-oss-struct S10 (A8): moved out of mobile.js unchanged. Its wire*() function holds what used to run at load (listeners, observers, the
// self-contained blocks); mobile.js calls it where the code used to be, so everything runs in the same order as before.


// ===== ui2-A: WeChat-style composer — + opens a panel (相册/拍照/文件/@); 发送 replaces + once there is text or an attachment =====
import { SEND, sendVia } from "./nav.js";
import { $, en, mq } from "../mobile.js";
function ui2Comp() {
  const c = $(".ch-comp"); if (!c || !mq.matches) return;
  const ta = $("textarea", c), fi = $("input[type=file]", c), plus = $(":scope > button:first-child", c), send = $(".m-send", c);
  if (!ta || !fi || !plus || !send) return;
  send.dataset.t = en() ? "Send" : "发送";
  if (c._ui2) return; c._ui2 = true;
  const upd = () => {
    const r = c.closest("#right"), has = !!ta.value.trim() || !!(r && r.querySelector(".pending-att .ap-tile"));
    c.classList.toggle("has-text", has);
  };
  const setPanel = on => { c.classList.toggle("panel-on", on); if (on) ta.blur(); };
  const pick = (accept, capture) => { setPanel(false); fi.accept = accept; if (capture) fi.setAttribute("capture", "environment"); else fi.removeAttribute("capture"); fi.click(); setTimeout(() => { fi.accept = ""; fi.removeAttribute("capture"); }, 1500); };
  const P = document.createElement("div"); P.className = "ui2-panel";
  P.innerHTML = [["拍照", "Camera", "◉"], ["上传媒体", "Upload", "▣"]]
    .map((x, i) => `<button type="button" data-k="${i}"><b>${x[2]}</b>${en() ? x[1] : x[0]}</button>`).join("");
  c.appendChild(P);
  // capture phase: the old + handler (fi.click()) is replaced by the panel on phones
  plus.addEventListener("click", e => { e.stopImmediatePropagation(); e.preventDefault(); setPanel(!c.classList.contains("panel-on")); }, true);
  P.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    const k = +b.dataset.k;
    if (k === 0) pick("image/*", true); else pick("");   // ui8: 拍照 (camera capture) / 上传媒体 (one picker: photos, videos, files)
  });
  ta.addEventListener("input", upd); ta.addEventListener("focus", () => setPanel(false));
  document.addEventListener("pointerdown", e => { if (c.classList.contains("panel-on") && !e.target.closest(".ch-comp")) setPanel(false); }, true);
  /* value cleared by send() and attachment chips change without input events. t-power-save: ticks only while this composer is in the page and visible */
  const updT = setInterval(() => { if (!c.isConnected) { clearInterval(updT); return; } if (!document.hidden && !document.documentElement.dataset.idle) upd(); }, 300);
  upd();
}
function composers() {
  const chat = $(".ch-comp");
  if (chat && !$(".m-send", chat)) {
    const b = document.createElement("button"); b.className = "m-send"; b.setAttribute("aria-label", "send"); b.innerHTML = SEND;
    b.addEventListener("click", () => sendVia($("textarea", chat))); chat.appendChild(b);
  }
  const ta = chat && $("textarea", chat), a = App.agent(App.UI.chat);
  if (ta) ta.placeholder = en() ? `Message ${App.aname(a)}…` : `对${App.aname(a)}说……`;
  const comp = $("#drawer .composer");
  if (comp && !$(".m-send", comp)) {
    const b = document.createElement("button"); b.className = "m-send"; b.setAttribute("aria-label", "send"); b.innerHTML = SEND;
    b.addEventListener("click", () => sendVia($("textarea", comp))); $(".cm-row", comp).appendChild(b);
    $("textarea", comp).placeholder = en() ? "Reply, @someone, or why not…" : "回复，@ 指定谁，写驳回原因";   // t-detail-bottom: one-line pill, keep it short
  }
}

function wirePhComposer() {

  // ===== ui12b (t-composer-oneline) + mp (t-mailbox-polish): auto-grow the phone chat textarea from one row (40px) up to 120px =====
  // mp root-cause fix: the textarea has `transition: height`, and fit() used to read scrollHeight right after setting height = MIN. While a transition is running (after a long
  // message is sent and the value is cleared, or on the 200ms poll) scrollHeight returns the half-animated height, so an EMPTY field was re-pinned at 58 / 120px (seen on iPhone:
  // a 3-row pill with nothing typed). Now: (1) an empty field is always MIN and never measured, (2) the measurement runs with transition:none, (3) a focus heals any stale height.
  // Upload tiles (.pending-att) live INSIDE the pill, above the one-row field, so the pill (and --comp-h) includes them.
  (() => {
    const MIN = 40, MAX = 120, mqp = matchMedia("(max-width: 760px)");
    const find = () => document.querySelector("#right .ch-comp textarea");
    const sync = () => {   // --comp-h = pill height (target, not the eased one) + the 14px it floats above the bottom
      const ta = find(), comp = ta && ta.closest(".ch-comp"), right = document.getElementById("right"); if (!comp || !right) return;
      const h = parseFloat(ta.style.height) || MIN, box = right.querySelector(".ch-msgs");
      const atBottom = !!box && box.scrollHeight - box.scrollTop - box.clientHeight < 90;
      const v = (comp.offsetHeight - ta.offsetHeight + h + 14) + "px";
      if (right.style.getPropertyValue("--comp-h") === v) return;
      right.style.setProperty("--comp-h", v);   // ui23: the composer floats over the list, so the list needs to know how tall it is
      if (atBottom) box.scrollTop = box.scrollHeight;   // keep the last message visible when the pill grows (text wraps / tiles appear)
    };
    const fit = ta => {
      if (!ta || !ta.isConnected) return;
      let h = MIN;
      const cur = ta.getBoundingClientRect().height || MIN;   // jit: what is on screen right now (mid-transition value included)
      if (ta.value) {
        const st = ta.scrollTop;
        ta.style.transition = "none"; ta.style.height = MIN + "px"; h = Math.min(MAX, Math.max(MIN, ta.scrollHeight));
        ta.style.height = cur + "px"; void ta.offsetHeight;   // jit: put the on-screen height back and flush it with transition:none, so the 40px probe is never the start of an animation
        ta.scrollTop = st;
      }
      ta.style.transition = ""; ta.style.height = h + "px";   // jit: one monotonic ease from where the pill is to where it must be (unchanged h = no motion at all)
      sync();
    };
    let ro = null, roFor = null;
    const place = () => {   // move the tiles strip into the pill on the phone (back out on desktop widths); observe the pill so --comp-h follows tiles / wrapping
      const ta = find(); if (!ta) return;
      const comp = ta.closest(".ch-comp"), att = document.querySelector("#right .pending-att"); if (!comp) return;
      if (att) { if (mqp.matches && att.parentNode !== comp) comp.appendChild(att); else if (!mqp.matches && att.parentNode === comp) comp.parentNode.insertBefore(att, comp); }
      /* t-ui-fix-r2 audit P2-14: sync writes --comp-h, which resizes the pill it observes; in the same frame WebKit threw 「ResizeObserver loop completed…」 on every DM open. One frame later is enough. */
      if (window.ResizeObserver && roFor !== comp) { if (ro) ro.disconnect(); roFor = comp; let q = 0; ro = new ResizeObserver(() => { if (!q) q = requestAnimationFrame(() => { q = 0; sync(); }); }); ro.observe(comp); }
    };
    document.addEventListener("input", e => { if (e.target.matches && e.target.matches("#right .ch-comp textarea")) fit(e.target); });
    document.addEventListener("focusin", e => { if (e.target.matches && e.target.matches("#right .ch-comp textarea")) { place(); fit(e.target); } });
    mqp.addEventListener && mqp.addEventListener("change", place);
    let last = null;
    /* value changed without an input event (cleared after send). t-power-save: the 200 ms tick runs only while the chat input exists, the page is visible and not idle;
       it stops when the input goes and restarts on the next focus / input / visibility change */
    let fitT = 0;
    const fitTick = () => { const ta = find(); if (!ta) { clearInterval(fitT); fitT = 0; return; } if (document.hidden || document.documentElement.dataset.idle) return; place(); const v = ta.value; if (v !== last) { last = v; fit(ta); } };
    const fitOn = () => { if (!fitT && find()) fitT = setInterval(fitTick, 200); };
    fitOn();
    document.addEventListener("focusin", fitOn); document.addEventListener("input", fitOn); document.addEventListener("visibilitychange", fitOn); document.addEventListener("pointerdown", fitOn, true);
  })();
}

export { ui2Comp, composers, wirePhComposer };
