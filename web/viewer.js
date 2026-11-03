// ui2-C: in-app image / video viewer (lightbox). Delegated, so the 5s chat repaint never breaks it.
// t-media-viewer: frosted glass page behind (ONE blur layer: .lb-bg), media in a rounded frame (.lb-frame, no blur of its own),
// PDF support, zoom buttons, open in new tab, click outside the frame closes, Esc closes only this top layer.
// Degrades on an old server: no /api/thumb -> thumbnails fall back to the original; no Range support -> video plays inline natively.
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const phoneQ = matchMedia("(max-width: 760px), (hover: none) and (pointer: coarse)");   // phone UI: no zoom buttons, PDF as cover + 新标签打开 (iOS iframes show page 1 only)
  // what opens the viewer: [data-lb] thumbnails, plus PDF links in attachment strips and the asset library
  const SEL = '[data-lb], .atts a[href$=".pdf" i], a.lib-doc[href$=".pdf" i]';
  let rangeOK = null;   // new server (Range-aware) answers /api/thumb?p=none with 403; the old one has no such route (404)
  function detect() {
    if (rangeOK !== null) return Promise.resolve(rangeOK);
    return fetch("/api/thumb?p=none", { cache: "no-store" }).then(r => (rangeOK = r.status === 403), () => (rangeOK = false));
  }
  const thumbOf = (url, w) => `/api/thumb?p=${encodeURIComponent(url.slice(1).split("/").map(decodeURIComponent).join("/"))}&w=${w}`;

  let items = [], idx = 0, root = null, scrollY0 = 0, pushed = false, chromeOn = true, zoom = null, setZoom = null;

  function entry(el) {
    const url = el.dataset.lb || el.getAttribute("href") || "";
    const pdf = !el.dataset.lb && /\.pdf$/i.test(url);
    const t = el.closest(".lib-t"), cap = t && $(".lib-cap[data-item]", t);
    let name = el.dataset.name || "";
    if (!name) { const sm = $("small", el); name = (sm ? sm.textContent : el.textContent).replace(/^\s*📎\s*/, "").trim(); }
    return { url, kind: pdf ? "pdf" : el.dataset.kind, name, item: el.dataset.libItem || (pdf && cap ? cap.dataset.item : "") || "", title: el.dataset.libTitle || "", path: el.dataset.libPath || "" };
  }
  function collect(a) {
    const box = a.closest(".atts, .pending-att, .lib-g") || a.parentElement;   // .lib-g: one day of the asset library (t-imp29-p4)
    const list = Array.from(box.querySelectorAll(SEL));
    return { list: list.map(entry), i: list.indexOf(a) };
  }
  function build() {
    root = document.createElement("div");
    root.id = "lb"; root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true");
    root.innerHTML = `<div class="lb-bg"></div>
      <div class="lb-frame">
        <div class="lb-top"><button class="lb-x" aria-label="关闭">✕</button><span class="lb-cnt"></span>
          <button class="lb-go" hidden>去这张卡</button><button class="lb-att" hidden>附到回复…</button>
          <span class="lb-zm"><button class="lb-zo" aria-label="缩小">−</button><button class="lb-pct" aria-label="还原 100%">100%</button><button class="lb-zi" aria-label="放大">+</button></span>
          <a class="lb-new" target="_blank" rel="noopener" aria-label="在新标签打开">↗ 新标签</a><a class="lb-dl" download aria-label="保存">⤓ 保存</a></div>
        <div class="lb-stage"></div>
        <button class="lb-nav lb-prev" aria-label="上一张">‹</button><button class="lb-nav lb-next" aria-label="下一张">›</button>
        <div class="lb-dots"></div>
      </div>`;
    document.body.appendChild(root);
    $(".lb-x", root).onclick = () => close();
    $(".lb-bg", root).onclick = () => close();   // click outside the frame
    $(".lb-go", root).onclick = e => {   // asset library: jump to the card this file belongs to (after the history.back() of close() has settled)
      e.stopPropagation(); const id = items[idx] && items[idx].item; close();
      if (id && window.App) setTimeout(() => App.openItem(id), 260);
    };
    $(".lb-att", root).onclick = e => {   // t-lib-attach (phone): pick a DM / card and carry this file's path there
      e.stopPropagation(); const p = items[idx] && items[idx].path; close();
      if (p && window.App && App.attachPick) setTimeout(() => App.attachPick(p), 260);
    };
    $(".lb-zo", root).onclick = e => { e.stopPropagation(); setZoom && setZoom(zoom.s / 1.25); };
    $(".lb-zi", root).onclick = e => { e.stopPropagation(); setZoom && setZoom(zoom.s * 1.25); };
    $(".lb-pct", root).onclick = e => { e.stopPropagation(); setZoom && setZoom(1); };
    $(".lb-prev", root).onclick = e => { e.stopPropagation(); go(idx - 1); };
    $(".lb-next", root).onclick = e => { e.stopPropagation(); go(idx + 1); };
    gestures($(".lb-stage", root));
  }
  function open(list, i) {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    items = list; idx = i; chromeOn = true;
    if (!root) build();
    scrollY0 = window.scrollY;
    document.body.classList.add("lb-open");
    root.classList.remove("out", "hide"); root.classList.add("on");
    const fr = $(".lb-frame", root); fr.style.transform = ""; $(".lb-bg", root).style.opacity = "";
    try { history.pushState({ lb: 1 }, ""); pushed = true; } catch (_) { pushed = false; }
    show();
  }
  function stopVideo() { const v = root && $("video", root); if (v) { try { v.pause(); } catch (_) { } v.removeAttribute("src"); v.load(); } }
  function pct() { const p = $(".lb-pct", root); if (p) p.textContent = Math.round(zoom.s * 100) + "%"; }
  function show() {
    const it = items[idx], st = $(".lb-stage", root), phone = phoneQ.matches;
    stopVideo(); zoom = { s: 1, x: 0, y: 0 }; pct();
    root.classList.toggle("is-video", it.kind === "video"); root.classList.toggle("is-pdf", it.kind === "pdf");
    root.classList.toggle("is-img", it.kind !== "video" && it.kind !== "pdf"); root.classList.toggle("ph", phone);
    $(".lb-cnt", root).textContent = `${items.length > 1 ? `${idx + 1} / ${items.length} · ` : ""}${it.name}`;
    $(".lb-cnt", root).title = it.name;
    const gb = $(".lb-go", root); gb.hidden = !it.item; gb.title = it.title || "";
    $(".lb-att", root).hidden = !(it.path && matchMedia("(max-width: 760px)").matches);   // t-lib-attach: phone only (desktop drags the tile)
    const dl = $(".lb-dl", root); dl.href = it.url; dl.setAttribute("download", it.name || "");
    $(".lb-new", root).href = it.url;
    $(".lb-prev", root).hidden = idx <= 0; $(".lb-next", root).hidden = idx >= items.length - 1;
    $(".lb-dots", root).innerHTML = items.length > 1 && items.length <= 12 ? items.map((_, k) => `<i class="${k === idx ? "on" : ""}"></i>`).join("") : "";
    if (it.kind === "video") {
      st.innerHTML = `<video class="lb-media" src="${esc(it.url)}" controls playsinline preload="metadata" poster="${thumbOf(it.url, 720)}"></video>
        <div class="lb-err" hidden>这个格式在手机上播不了 · <a href="${esc(it.url)}" download>下载原文件</a></div>`;
      const v = $("video", st);
      v.addEventListener("error", () => { if (!v.isConnected || !v.getAttribute("src")) return; v.hidden = true; $(".lb-err", st).hidden = false; });
    } else if (it.kind === "pdf") {
      if (phone) {   // iOS renders only page 1 of a PDF inside an iframe: show the cover and send the whole file to a new tab
        st.innerHTML = `<div class="lb-pdfc"><img class="lb-cover" src="${thumbOf(it.url, 900)}" alt="${esc(it.name)}" draggable="false" onerror="this.remove()">
          <a class="lb-pdfgo" href="${esc(it.url)}" target="_blank" rel="noopener">新标签打开 PDF</a></div>`;
      } else st.innerHTML = `<iframe class="lb-media lb-pdf" src="${esc(it.url)}#view=FitH" title="${esc(it.name)}"></iframe>`;
    } else {
      const alpha = /\.(png|webp|gif|avif|svg)(\?|$)/i.test(it.url) ? " lb-alpha" : "";   // transparent images sit on a light checkerboard
      st.innerHTML = `<img class="lb-media${alpha}" src="${esc(it.url)}" alt="${esc(it.name)}" draggable="false">`;
      if (!reduce) { const im = $("img", st); im.style.opacity = 0; im.style.transform = "scale(.96)"; requestAnimationFrame(() => { im.style.transition = "opacity .24s var(--ease), transform .24s var(--ease)"; im.style.opacity = 1; im.style.transform = ""; }); }
    }
  }
  function go(n) { if (n < 0 || n >= items.length || n === idx) return; idx = n; show(); }
  function close(fromPop) {
    if (!root || !root.classList.contains("on")) return;
    stopVideo();
    const fin = () => { root.classList.remove("on", "out"); $(".lb-stage", root).innerHTML = ""; $(".lb-frame", root).style.transform = ""; $(".lb-bg", root).style.opacity = ""; document.body.classList.remove("lb-open"); window.scrollTo(0, scrollY0); };
    if (reduce) fin(); else { root.classList.add("out"); setTimeout(fin, 180); }
    if (pushed && !fromPop) { pushed = false; ignorePop = true; history.back(); }
    pushed = false;
  }
  let ignorePop = false;
  // back gesture / browser back closes the viewer only. Registered before mobile.js, so we can keep it from also leaving the chat thread.
  addEventListener("popstate", e => {
    if (ignorePop) { ignorePop = false; e.stopImmediatePropagation(); return; }
    if (root && root.classList.contains("on")) { e.stopImmediatePropagation(); close(true); }
  });
  // Esc closes only the top layer (t-media-viewer bug 00:58): capture on window runs before app.js's document handler,
  // which would otherwise also close the detail page / #modal underneath. The ⌘K palette (capture on window, registered
  // earlier) handles its own Esc first and marks it defaultPrevented; it sits above the viewer while both are open.
  addEventListener("keydown", e => {
    if (!root || !root.classList.contains("on") || e.defaultPrevented || e.isComposing) return;
    if (document.body.classList.contains("pal-on")) return;
    if (e.key === "Escape") close(); else if (e.key === "ArrowLeft") go(idx - 1); else if (e.key === "ArrowRight") go(idx + 1);
    else if ((e.key === "+" || e.key === "=") && setZoom && !e.metaKey && !e.ctrlKey) setZoom(zoom.s * 1.25);
    else if (e.key === "-" && setZoom && !e.metaKey && !e.ctrlKey) setZoom(zoom.s / 1.25);
    else return;
    e.preventDefault(); e.stopImmediatePropagation();
  }, true);

  // ---- gestures: pointer events; 1 finger = swipe / drag / pan, 2 fingers = pinch, double tap / double click = zoom ----
  function gestures(st) {
    const P = new Map(); let g = null, lastTap = 0;
    const media = () => $(".lb-media", st);
    const isImg = () => { const m = media(); return !!(m && m.tagName === "IMG"); };
    const body = () => (isImg() && media()) || $(".lb-pdfc", st);   // what a swipe moves: the image, or the phone PDF cover (t-media-viewer)
    const frame = () => $(".lb-frame", root);
    const apply = (anim) => { const m = media(); if (!m || m.tagName !== "IMG") return; m.style.transition = anim ? "transform .22s var(--ease)" : "none"; m.style.transform = `translate(${zoom.x}px,${zoom.y}px) scale(${zoom.s})`; pct(); root.classList.toggle("zoomed", zoom.s > 1.02); };
    setZoom = s => { const m = media(); if (!m || m.tagName !== "IMG") return; zoom.s = Math.max(1, Math.min(5, s)); if (zoom.s < 1.02) zoom = { s: 1, x: 0, y: 0 }; apply(true); };
    const dist = () => { const a = [...P.values()]; return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); };
    st.addEventListener("pointerdown", e => {
      if (!body() || e.target.closest(".lb-pdfgo")) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      st.setPointerCapture(e.pointerId); P.set(e.pointerId, { x: e.clientX, y: e.clientY, t: e.pointerType });
      if (P.size === 2 && isImg()) g = { mode: "pinch", d0: dist(), s0: zoom.s };
      else g = { mode: "one", x0: e.clientX, y0: e.clientY, zx: zoom.x, zy: zoom.y, t0: Date.now(), moved: false, dir: null, touch: e.pointerType !== "mouse" };
    });
    st.addEventListener("pointermove", e => {
      if (!P.has(e.pointerId) || !g) return;
      P.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (g.mode === "pinch" && P.size >= 2) { zoom.s = Math.max(.7, Math.min(5, g.s0 * dist() / g.d0)); apply(false); return; }
      if (g.mode !== "one") return;
      const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
      if (Math.abs(dx) + Math.abs(dy) > 6) g.moved = true;
      if (zoom.s > 1.02) { zoom.x = g.zx + dx; zoom.y = g.zy + dy; apply(false); return; }
      if (!g.touch) return;   // mouse at 100%: nothing to drag (arrows / buttons switch)
      if (!g.dir && g.moved) g.dir = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
      if (g.dir === "h") { body().style.transition = "none"; body().style.transform = `translateX(${dx}px)`; }
      else if (g.dir === "v") {   // swipe down / up: the whole frame follows the finger, the glass fades
        const f = frame(); f.style.transition = "none"; f.style.transform = `translateY(${dy}px) scale(${1 - Math.min(.08, Math.abs(dy) / 2500)})`;
        $(".lb-bg", root).style.opacity = Math.max(.25, 1 - Math.abs(dy) / 500);
      }
    });
    const end = e => {
      if (!P.has(e.pointerId)) return; P.delete(e.pointerId);
      if (!g) return;
      if (g.mode === "pinch") { if (P.size < 2) { if (zoom.s < 1) { zoom = { s: 1, x: 0, y: 0 }; apply(true); } g = null; } return; }
      const dx = e.clientX - g.x0, dy = e.clientY - g.y0, fast = Date.now() - g.t0 < 300, m = body(), f = frame();
      const snapBack = () => { $(".lb-bg", root).style.opacity = ""; f.style.transition = "transform .22s var(--ease)"; f.style.transform = ""; };
      if (zoom.s <= 1.02 && g.dir === "h" && (Math.abs(dx) > 70 || (fast && Math.abs(dx) > 30))) { g = null; const n0 = idx; go(idx + (dx < 0 ? 1 : -1)); if (idx === n0 && m) { m.style.transition = "transform .22s var(--ease)"; m.style.transform = ""; } return; }
      if (zoom.s <= 1.02 && g.dir === "v" && (Math.abs(dy) > 120 || (fast && Math.abs(dy) > 50))) { g = null; return close(); }
      if (g.dir === "v") snapBack();
      if (!g.moved) {   // tap / click
        const now = Date.now();
        if (!isImg()) { /* PDF cover: taps do nothing */ }
        else if (now - lastTap < 300) { zoom = zoom.s > 1.02 ? { s: 1, x: 0, y: 0 } : { s: 2.5, x: 0, y: 0 }; apply(true); lastTap = 0; }
        else if (g.touch) { lastTap = now; setTimeout(() => { if (lastTap === now) { lastTap = 0; chromeOn = !chromeOn; root.classList.toggle("hide", !chromeOn); } }, 300); }
        else lastTap = now;   // mouse: a single click does nothing, a double click zooms
      } else if (m && zoom.s <= 1.02) { zoom = { s: 1, x: 0, y: 0 }; if (isImg()) apply(true); else { m.style.transition = "transform .22s var(--ease)"; m.style.transform = ""; } }
      g = null;
    };
    st.addEventListener("pointerup", end); st.addEventListener("pointercancel", end);
    st.addEventListener("wheel", e => { if (!media() || media().tagName !== "IMG") return; e.preventDefault(); zoom.s = Math.max(1, Math.min(5, zoom.s * (e.deltaY < 0 ? 1.12 : .9))); if (zoom.s === 1) { zoom.x = zoom.y = 0; } apply(false); }, { passive: false });
  }

  // ---- entry: click on any [data-lb] thumbnail or PDF link ----
  document.addEventListener("click", e => {
    const a = e.target.closest(SEL); if (!a) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button > 0) return;   // ⌘-click etc. keeps the browser's own new-tab behaviour
    e.preventDefault();
    if (a.dataset.kind === "video") {
      detect().then(ok => {
        if (!ok) {   // old server: no Range, so keep the original inline native player
          const v = document.createElement("video"); v.src = a.dataset.lb; v.controls = true; v.playsInline = true; v.preload = "metadata";
          a.replaceWith(v); try { v.play(); } catch (_) { } return;
        }
        const c = collect(a); open(c.list, c.i);
      });
      return;
    }
    const c = collect(a); open(c.list, c.i);
  });
})();
