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
  // what opens the viewer: [data-lb] thumbnails, plus PDF links in attachment strips and the asset library,
  // plus .md / .txt attachments (t-md-viewer: read in place, .md through the cards' own md(), .txt as preformatted text)
  const SEL = '[data-lb], .atts a[href$=".pdf" i], a.lib-doc[href$=".pdf" i], .atts a[href$=".md" i], .atts a[href$=".txt" i]';
  const DOCMAX = 200 * 1024;   // a bigger text file shows its first ~200 KB, a note, and a link to the raw file
  let rangeOK = null;   // new server (Range-aware) answers /api/thumb?p=none with 403; the old one has no such route (404)
  function detect() {
    if (rangeOK !== null) return Promise.resolve(rangeOK);
    return fetch("/api/thumb?p=none", { cache: "no-store" }).then(r => (rangeOK = r.status === 403), () => (rangeOK = false));
  }
  const thumbOf = (url, w) => `/api/thumb?p=${encodeURIComponent(url.slice(1).split("/").map(decodeURIComponent).join("/"))}&w=${w}`;

  let items = [], idx = 0, root = null, scrollY0 = 0, pushed = false, chromeOn = true, zoom = null, setZoom = null;
  // t-img-save A: phone 「保存原图」 = system share sheet (存储图像 -> Photos, full size). Safari wants share() called right in the tap,
  // so the original is fetched into a File as soon as an image / video opens. Only the current file is kept; switching or closing drops it.
  /* above BIG: no prefetch, fetch on tap (the share may then be refused -> download fallback) */
  const BIG = 40 * 1024 * 1024;
  /* pre = { url, ctl, file, size, state: "loading" | "ready" | "big" | "fail" } */
  let pre = null;
  const toast = (m, bad) => { if (window.App && App.toast) App.toast(m, bad); };
  const en = () => !!(window.App && App.UI && App.UI.lang === "en");
  const L = (zh, e) => en() ? e : zh;
  /* t-i18n-a: the frame is built once and kept, so its labels are (re)set on every open to follow the UI language */
  function relabel() {
    const set = (sel, txt, aria) => { const el = $(sel, root); if (!el) return; if (txt != null) el.textContent = txt; if (aria != null) el.setAttribute("aria-label", aria); };
    set(".lb-x", null, L("关闭", "Close")); set(".lb-go", L("去这张卡", "Go to card")); set(".lb-att", L("附到回复…", "Attach to reply…"));
    set(".lb-zo", null, L("缩小", "Zoom out")); set(".lb-pct", null, L("还原 100%", "Reset to 100%")); set(".lb-zi", null, L("放大", "Zoom in"));
    set(".lb-new", L("↗ 新标签", "↗ New tab"), L("在新标签打开", "Open in new tab")); set(".lb-dl", null, L("保存", "Save"));
    set(".lb-prev", null, L("上一张", "Previous")); set(".lb-next", null, L("下一张", "Next"));
  }
  const canShareFiles = () => { try { return !!(navigator.share && navigator.canShare && navigator.canShare({ files: [new File([""], "x.png", { type: "image/png" })] })); } catch (_) { return false; } };
  const fmtMB = n => n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";

  function entry(el) {
    const url = el.dataset.lb || el.getAttribute("href") || "";
    const pdf = !el.dataset.lb && /\.pdf$/i.test(url), doc = !el.dataset.lb && /\.(md|txt)$/i.test(url);
    const t = el.closest(".lib-t"), cap = t && $(".lib-cap[data-item]", t);
    let name = el.dataset.name || "";
    if (!name) { const sm = $("small", el); name = (sm ? sm.textContent : el.textContent).replace(/^\s*📎\s*/, "").trim(); }
    return { url, kind: pdf ? "pdf" : doc ? "doc" : el.dataset.kind, name, item: el.dataset.libItem || (pdf && cap ? cap.dataset.item : "") || "", title: el.dataset.libTitle || "", path: el.dataset.libPath || "" };
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
    $(".lb-dl", root).addEventListener("click", saveClick);
    $(".lb-zo", root).onclick = e => { e.stopPropagation(); setZoom && setZoom(zoom.s / 1.25); };
    $(".lb-zi", root).onclick = e => { e.stopPropagation(); setZoom && setZoom(zoom.s * 1.25); };
    $(".lb-pct", root).onclick = e => { e.stopPropagation(); setZoom && setZoom(1); };
    $(".lb-prev", root).onclick = e => { e.stopPropagation(); go(idx - 1); };
    $(".lb-next", root).onclick = e => { e.stopPropagation(); go(idx + 1); };
    gestures($(".lb-stage", root));
  }
  let from = null;   // R4-12: who had focus before the viewer opened; it gets focus back on close
  function open(list, i) {
    if (!root || !root.classList.contains("on")) from = document.activeElement !== document.body ? document.activeElement : null;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    items = list; idx = i; chromeOn = true;
    if (!root) build();
    relabel();
    scrollY0 = window.scrollY;
    document.body.classList.add("lb-open");
    root.classList.remove("out", "hide"); root.classList.add("on");
    const fr = $(".lb-frame", root); fr.style.transform = ""; $(".lb-bg", root).style.opacity = "";
    try { history.pushState({ lb: 1 }, ""); pushed = true; } catch (_) { pushed = false; }
    show();
    try { $(".lb-x", root).focus({ preventScroll: true }); } catch (_) { }   // R4-12: focus moves into the viewer (Tab is trapped below)
  }
  function stopVideo() { const v = root && $("video", root); if (v) { try { v.pause(); } catch (_) { } v.removeAttribute("src"); v.load(); } }
  function pct() { const p = $(".lb-pct", root); if (p) p.textContent = Math.round(zoom.s * 100) + "%"; }
  function show() {
    const it = items[idx], st = $(".lb-stage", root), phone = phoneQ.matches;
    stopVideo(); zoom = { s: 1, x: 0, y: 0 }; pct();
    root.classList.toggle("is-video", it.kind === "video"); root.classList.toggle("is-pdf", it.kind === "pdf");
    root.classList.toggle("is-doc", it.kind === "doc");
    root.classList.toggle("is-img", it.kind !== "video" && !/^(pdf|doc)$/.test(it.kind)); root.classList.toggle("ph", phone);
    cnt();
    const gb = $(".lb-go", root); gb.hidden = !it.item; gb.title = it.title || "";
    $(".lb-att", root).hidden = !(it.path && matchMedia("(max-width: 760px)").matches);   // t-lib-attach: phone only (desktop drags the tile)
    const dl = $(".lb-dl", root); dl.href = it.url; dl.setAttribute("download", it.name || "");
    prefetch(it, phone);
    const nw = $(".lb-new", root); nw.href = it.url;   // t-md-viewer: for a text file this chip is the way to the raw file
    nw.textContent = it.kind === "doc" ? L("原文 ↗", "Raw ↗") : L("↗ 新标签", "↗ New tab");
    nw.setAttribute("aria-label", it.kind === "doc" ? L("在新标签打开原文", "Open the raw file in a new tab") : L("在新标签打开", "Open in new tab"));
    $(".lb-prev", root).hidden = idx <= 0; $(".lb-next", root).hidden = idx >= items.length - 1;
    $(".lb-dots", root).innerHTML = items.length > 1 && items.length <= 12 ? items.map((_, k) => `<i class="${k === idx ? "on" : ""}"></i>`).join("") : "";
    if (it.kind === "video") {
      st.innerHTML = `<video class="lb-media" src="${esc(it.url)}" controls playsinline preload="metadata" poster="${thumbOf(it.url, 720)}"></video>
        <div class="lb-err" hidden>${L("这个格式在手机上播不了", "This format won't play on a phone")} · <a href="${esc(it.url)}" download>${L("下载原文件", "Download the original")}</a></div>`;
      const v = $("video", st);
      v.addEventListener("error", () => { if (!v.isConnected || !v.getAttribute("src")) return; v.hidden = true; $(".lb-err", st).hidden = false; });
    } else if (it.kind === "pdf") {
      if (phone) {   // iOS renders only page 1 of a PDF inside an iframe: show the cover and send the whole file to a new tab
        st.innerHTML = `<div class="lb-pdfc"><img class="lb-cover" src="${thumbOf(it.url, 900)}" alt="${esc(it.name)}" draggable="false" onerror="this.remove()">
          <a class="lb-pdfgo" href="${esc(it.url)}" target="_blank" rel="noopener">${L("新标签打开 PDF", "Open PDF in new tab")}</a></div>`;
      } else st.innerHTML = `<iframe class="lb-media lb-pdf" src="${esc(it.url)}#view=FitH" title="${esc(it.name)}"></iframe>`;
    } else if (it.kind === "doc") {
      st.innerHTML = `<div class="lb-doc" tabindex="0"><div class="lb-docin md"><p class="lb-wait">${L("载入中…", "Loading…")}</p></div></div>`;
      const box = $(".lb-docin", st), raw = `<a href="${esc(it.url)}" target="_blank" rel="noopener">${L("打开原文", "Open the raw file")}</a>`;
      fetch(it.url, { cache: "no-cache" }).then(r => { if (!r.ok) throw new Error(r.status); return r.text(); }).then(t => {
        if (items[idx] !== it || !box.isConnected) return;
        let s = t; const cut = t.length > DOCMAX;
        if (cut) { s = t.slice(0, DOCMAX); const nl = s.lastIndexOf("\n"); if (nl > DOCMAX * .8) s = s.slice(0, nl); }   // end on a whole line
        const kb = n => Math.max(1, Math.round(new Blob([n]).size / 1024));
        box.innerHTML = (/\.md$/i.test(it.url) && window.md ? window.md(s) : `<pre class="lb-txt">${esc(s)}</pre>`)
          + (cut ? `<p class="lb-cut">${L(`文件较大（${kb(t)} KB），这里只显示前 ${kb(s)} KB。`, `Large file (${kb(t)} KB): showing the first ${kb(s)} KB.`)} ${raw}</p>` : "");
        if (!it.size) { it.size = new Blob([t]).size; cnt(); }
      }).catch(() => { if (items[idx] === it && box.isConnected) box.innerHTML = `<p class="lb-cut">${L("读不到这个文件。", "Couldn't read this file.")} ${raw}</p>`; });
    } else {
      const alpha = /\.(png|webp|gif|avif|svg)(\?|$)/i.test(it.url) ? " lb-alpha" : "";   // transparent images sit on a light checkerboard
      st.innerHTML = `<img class="lb-media${alpha}" src="${esc(it.url)}" alt="${esc(it.name)}" draggable="false">`;
      const im0 = $("img", st); im0.addEventListener("load", () => { if (items[idx] === it) { it.wh = im0.naturalWidth + "×" + im0.naturalHeight; cnt(); } });
      if (!reduce) { const im = $("img", st); im.style.opacity = 0; im.style.transform = "scale(.96)"; requestAnimationFrame(() => { im.style.transition = "opacity .24s var(--ease), transform .24s var(--ease)"; im.style.opacity = 1; im.style.transform = ""; }); }
    }
  }
  // title line: "2 / 5 · name · 1456×816 · 2.1 MB" (real pixels + bytes, so a screenshot is never mistaken for the original)
  function cnt() {
    const it = items[idx]; if (!it || !root) return;
    const meta = [it.wh, it.size ? fmtMB(it.size) : ""].filter(Boolean).join(" · ");
    const el = $(".lb-cnt", root);
    el.textContent = `${items.length > 1 ? `${idx + 1} / ${items.length} · ` : ""}${it.name}${meta ? " · " + meta : ""}`;
    el.title = it.name + (meta ? " · " + meta : "");
  }
  function dropPre() { if (pre && pre.ctl) { try { pre.ctl.abort(); } catch (_) { } } pre = null; }
  function dlLabel() {
    const dl = root && $(".lb-dl", root), it = items[idx]; if (!dl || !it) return;
    const share = phoneQ.matches && !/^(pdf|doc)$/.test(it.kind) && canShareFiles();
    dl.textContent = !share ? (phoneQ.matches && it.kind !== "doc" ? L("⤓ 保存原图", "⤓ Save original") : L("⤓ 保存", "⤓ Save")) : pre && pre.state === "loading" ? L("准备中…", "Preparing…") : L("⤓ 保存原图", "⤓ Save original");
    dl.classList.toggle("wait", !!(share && pre && pre.state === "loading"));
  }
  /* fetch the original into a File; resolves to pre (state ready / big / fail) */
  function grab(it, big) {
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const p = pre = { url: it.url, ctl, file: null, size: 0, state: "loading" };
    return fetch(it.url, ctl ? { signal: ctl.signal } : {}).then(r => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      const n = +r.headers.get("content-length") || 0; if (n) { p.size = it.size = n; if (items[idx] === it) cnt(); }
      if (n > BIG && !big) { p.state = "big"; if (ctl) ctl.abort(); return null; }
      return r.blob();
    }).then(b => {
      if (!b || pre !== p) return p;
      const type = b.type || (/\.png$/i.test(it.url) ? "image/png" : /\.(jpe?g)$/i.test(it.url) ? "image/jpeg" : /\.mp4$/i.test(it.url) ? "video/mp4" : "application/octet-stream");
      const nm = (it.name && /\.[a-z0-9]{2,5}$/i.test(it.name) ? it.name : decodeURIComponent(it.url.split("?")[0].split("/").pop() || "image")).replace(/[\\/:*?"<>|]/g, "_");
      p.file = new File([b], nm, { type }); p.size = it.size = b.size; p.state = "ready";
      if (items[idx] === it) cnt();
      return p;
    }).catch(e => { if (pre === p && p.state === "loading") p.state = "fail"; return p; }).then(r => { if (pre === p) dlLabel(); return r; });
  }
  function prefetch(it, phone) {
    dropPre();
    if (!phone || /^(pdf|doc)$/.test(it.kind) || !canShareFiles()) { dlLabel(); return; }
    grab(it, false); dlLabel();
  }
  function fallbackDL(dl) { dl.dataset.nosh = "1"; dl.click(); delete dl.dataset.nosh; toast(L("已存到 文件 → 下载", "Saved to Files → Downloads")); }
  function doShare(dl, file) {
    let pr; try { pr = navigator.share({ files: [file] }); } catch (e) { pr = Promise.reject(e); }
    return Promise.resolve(pr).catch(e => { if (e && e.name === "AbortError") return; /* user cancelled */ fallbackDL(dl); });
  }
  // the 「保存原图」 tap. Desktop and no-share browsers keep the plain <a download>.
  function saveClick(e) {
    const dl = e.currentTarget, it = items[idx];
    if (dl.dataset.nosh || !it || !phoneQ.matches || /^(pdf|doc)$/.test(it.kind) || !canShareFiles()) {
      if (phoneQ.matches && !dl.dataset.nosh && it && !/^(pdf|doc)$/.test(it.kind)) toast(L("已存到 文件 → 下载", "Saved to Files → Downloads"));
      return;
    }
    e.preventDefault(); e.stopPropagation();
    const p = pre && pre.url === it.url ? pre : null;
    if (p && p.state === "ready" && p.file) {
      /* synchronous: still inside the tap */
      if (navigator.canShare({ files: [p.file] })) return void doShare(dl, p.file);
      return fallbackDL(dl);
    }
    if (p && p.state === "loading") { toast(L("原图还在准备，稍等一下再点", "The original is still loading, tap again in a moment")); return; }
    if (p && p.state === "fail") return fallbackDL(dl);
    // big file (or no prefetch): fetch now, then try the share; Safari may refuse it without the tap -> download
    toast(L("文件较大，取完会再弹分享", "Large file: the share sheet opens once it's fetched"));
    grab(it, true).then(q => { if (items[idx] !== it || !root.classList.contains("on")) return; if (q.state === "ready" && q.file && navigator.canShare({ files: [q.file] })) doShare(dl, q.file); else fallbackDL(dl); });
  }
  function go(n) { if (n < 0 || n >= items.length || n === idx) return; idx = n; show(); }
  function close(fromPop) {
    if (!root || !root.classList.contains("on")) return;
    stopVideo(); dropPre();
    const fin = () => { root.classList.remove("on", "out"); $(".lb-stage", root).innerHTML = ""; $(".lb-frame", root).style.transform = ""; $(".lb-bg", root).style.opacity = ""; document.body.classList.remove("lb-open"); window.scrollTo(0, scrollY0);
      const f = from; from = null; if (f && f.isConnected && !root.classList.contains("on")) try { f.focus({ preventScroll: true }); } catch (_) { } };
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
    if (e.key === "Tab") {   // R4-12: Tab / Shift+Tab cycle through the viewer's own visible controls only
      const f = [...root.querySelectorAll("button, a[href], video, iframe, .lb-doc")].filter(x => !x.hidden && x.offsetParent !== null);
      if (f.length) { const k = f.indexOf(document.activeElement), n = k < 0 ? (e.shiftKey ? f.length - 1 : 0) : (k + (e.shiftKey ? -1 : 1) + f.length) % f.length; f[n].focus(); }
      e.preventDefault(); e.stopImmediatePropagation(); return;
    }
    if (e.key === "Escape") close(); else if (e.key === "ArrowLeft") go(idx - 1); else if (e.key === "ArrowRight") go(idx + 1);
    else if ((e.key === "+" || e.key === "=") && setZoom && !e.metaKey && !e.ctrlKey) setZoom(zoom.s * 1.25);
    else if (e.key === "-" && setZoom && !e.metaKey && !e.ctrlKey) setZoom(zoom.s / 1.25);
    else return;
    e.preventDefault(); e.stopImmediatePropagation();
  }, true);

  // ---- gestures (t-img-zoom): pointer events. Tap / click the image = fit <-> 2x at that point; drag pans when zoomed;
  // 2 fingers = pinch around the midpoint; wheel / trackpad pinch (ctrl+wheel) / Safari gesture events zoom at the cursor.
  // Unzoomed touch: horizontal swipe = prev/next, vertical swipe = close. Tap on the empty stage (not the image) closes.
  // Pan is clamped so the image edge never leaves the stage; everything animates unless prefers-reduced-motion.
  function gestures(st) {
    const P = new Map(); let g = null, gs0 = 1;
    const media = () => $(".lb-media", st);
    const isImg = () => { const m = media(); return !!(m && m.tagName === "IMG"); };
    const body = () => (isImg() && media()) || $(".lb-pdfc", st);   // what a swipe moves: the image, or the phone PDF cover (t-media-viewer)
    const frame = () => $(".lb-frame", root);
    const ZMAX = 6, ZTAP = 2;
    // rest centre of the image (it sits centred in the stage's content box; transform-origin is its centre)
    const centre = () => {
      const r = st.getBoundingClientRect(), cs = getComputedStyle(st);
      const pl = parseFloat(cs.paddingLeft) || 0, pr = parseFloat(cs.paddingRight) || 0, pt = parseFloat(cs.paddingTop) || 0, pb = parseFloat(cs.paddingBottom) || 0;
      return { x: r.left + pl + (r.width - pl - pr) / 2, y: r.top + pt + (r.height - pt - pb) / 2, w: r.width, h: r.height };
    };
    const clamp = () => {   // keep the scaled image covering the stage (or centred on an axis where it is smaller)
      const m = media(); if (!m) return; const c = centre();
      const bx = Math.max(0, (m.offsetWidth * zoom.s - c.w) / 2), by = Math.max(0, (m.offsetHeight * zoom.s - c.h) / 2);
      zoom.x = Math.max(-bx, Math.min(bx, zoom.x)); zoom.y = Math.max(-by, Math.min(by, zoom.y));
    };
    // zoom to scale s keeping the screen point (px, py) fixed under the cursor / fingers
    const zoomAt = (s, px, py) => {
      const c = centre(), s0 = zoom.s; s = Math.max(1, Math.min(ZMAX, s));
      const qx = px - c.x, qy = py - c.y;
      zoom.x = qx - (s / s0) * (qx - zoom.x); zoom.y = qy - (s / s0) * (qy - zoom.y); zoom.s = s;
      if (s < 1.02) zoom = { s: 1, x: 0, y: 0 };
    };
    const apply = (anim, dur) => {
      const m = media(); if (!m || m.tagName !== "IMG") return;
      m.style.transition = anim && !reduce ? `transform ${dur || .28}s var(--ease)` : "none";
      m.style.transform = `translate(${zoom.x}px,${zoom.y}px) scale(${zoom.s})`; pct(); root.classList.toggle("zoomed", zoom.s > 1.02);
    };
    setZoom = s => { const m = media(); if (!m || m.tagName !== "IMG") return; const c = centre(); zoomAt(s, c.x, c.y); clamp(); apply(true); };
    const toggleAt = (x, y) => { if (zoom.s > 1.02) zoom = { s: 1, x: 0, y: 0 }; else { zoomAt(ZTAP, x, y); clamp(); } apply(true, .32); };
    const dist = () => { const a = [...P.values()]; return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); };
    const mid = () => { const a = [...P.values()]; return { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 }; };
    st.addEventListener("pointerdown", e => {
      if (!body() || e.target.closest(".lb-pdfgo")) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      st.setPointerCapture(e.pointerId); P.set(e.pointerId, { x: e.clientX, y: e.clientY, t: e.pointerType });
      if (P.size === 2 && isImg()) { const m0 = mid(); g = { mode: "pinch", d0: dist(), s0: zoom.s, x0: zoom.x, y0: zoom.y, mx: m0.x, my: m0.y }; }
      else g = { mode: "one", x0: e.clientX, y0: e.clientY, zx: zoom.x, zy: zoom.y, t0: Date.now(), moved: false, dir: null, touch: e.pointerType !== "mouse",
        onImg: !!e.target.closest("img.lb-media, .lb-pdfc") };
    });
    st.addEventListener("pointermove", e => {
      if (!P.has(e.pointerId) || !g) return;
      P.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (g.mode === "pinch" && P.size >= 2) {   // scale around the starting midpoint, and follow the midpoint as it moves
        const s = Math.max(.7, Math.min(ZMAX, g.s0 * dist() / g.d0)), m1 = mid(), c = centre(), qx = g.mx - c.x, qy = g.my - c.y;
        zoom.x = qx - (s / g.s0) * (qx - g.x0) + (m1.x - g.mx); zoom.y = qy - (s / g.s0) * (qy - g.y0) + (m1.y - g.my); zoom.s = s;
        apply(false); return;
      }
      if (g.mode !== "one") return;
      const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
      if (Math.abs(dx) + Math.abs(dy) > 6) g.moved = true;
      if (zoom.s > 1.02) { if (!g.moved) return; root.classList.add("panning"); zoom.x = g.zx + dx; zoom.y = g.zy + dy; apply(false); return; }
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
      root.classList.remove("panning");
      if (!g) return;
      if (g.mode === "pinch") {
        if (P.size < 2) { if (zoom.s < 1.02) zoom = { s: 1, x: 0, y: 0 }; else clamp(); apply(true); g = null; }
        return;
      }
      const dx = e.clientX - g.x0, dy = e.clientY - g.y0, fast = Date.now() - g.t0 < 300, m = body(), f = frame();
      // t-img-save B: a cancelled pointer (iOS long-press menu / system gesture) or a still touch held >= 450 ms is not a tap:
      // no zoom, no close, so the 存储图像 menu can show over an unmoved image
      const held = g.touch && !g.moved && Date.now() - g.t0 >= 450;
      if (e.type === "pointercancel" || held) {
        if (g.dir === "v") snapBack();
        if (g.moved && zoom.s > 1.02) { clamp(); apply(true, .22); }
        else if (g.moved && m) { if (isImg()) apply(true); else { m.style.transition = "transform .22s var(--ease)"; m.style.transform = ""; } }
        g = null; return;
      }
      const snapBack = () => { $(".lb-bg", root).style.opacity = ""; f.style.transition = "transform .22s var(--ease)"; f.style.transform = ""; };
      if (zoom.s <= 1.02 && g.dir === "h" && (Math.abs(dx) > 70 || (fast && Math.abs(dx) > 30))) { g = null; const n0 = idx; go(idx + (dx < 0 ? 1 : -1)); if (idx === n0 && m) { m.style.transition = "transform .22s var(--ease)"; m.style.transform = ""; } return; }
      if (zoom.s <= 1.02 && g.dir === "v" && (Math.abs(dy) > 120 || (fast && Math.abs(dy) > 50))) { g = null; return close(); }
      if (g.dir === "v") snapBack();
      if (!g.moved) {   // tap / click
        if (isImg() && (g.onImg || zoom.s > 1.02)) toggleAt(e.clientX, e.clientY);
        else if (!g.onImg) { g = null; return close(); }   // empty stage around the image
        /* PDF cover: taps do nothing */
      } else if (zoom.s > 1.02) { clamp(); apply(true, .22); }   // released after a pan: settle back inside the edges
      else if (m) { zoom = { s: 1, x: 0, y: 0 }; if (isImg()) apply(true); else { m.style.transition = "transform .22s var(--ease)"; m.style.transform = ""; } }
      g = null;
    };
    st.addEventListener("pointerup", end); st.addEventListener("pointercancel", end);
    // wheel: a mouse notch (|deltaY| >= 40) zooms in an animated step; trackpad pinch (ctrlKey) and fine scroll follow continuously
    st.addEventListener("wheel", e => {
      if (!isImg()) return; e.preventDefault();
      const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      if (!e.ctrlKey && zoom.s > 1.02 && Math.abs(d) < 40 && (e.deltaX || Math.abs(d) % 1)) {   // trackpad two-finger scroll while zoomed = pan
        zoom.x -= e.deltaX; zoom.y -= d; clamp(); apply(false); return;
      }
      const k = Math.exp(-d * (e.ctrlKey ? .01 : .0025)), step = !e.ctrlKey && Math.abs(d) >= 40;
      zoomAt(zoom.s * Math.max(.5, Math.min(2, k)), e.clientX, e.clientY); clamp();
      apply(step, .2);
    }, { passive: false });
    // Safari on macOS sends trackpad pinch as gesture* events instead of ctrl+wheel
    st.addEventListener("gesturestart", e => { if (!isImg()) return; e.preventDefault(); gs0 = zoom.s; });
    st.addEventListener("gesturechange", e => { if (!isImg() || P.size) return; e.preventDefault(); zoomAt(gs0 * e.scale, e.clientX, e.clientY); clamp(); apply(false); });
    st.addEventListener("gestureend", e => { if (!isImg()) return; e.preventDefault(); if (zoom.s < 1.02) { zoom = { s: 1, x: 0, y: 0 }; apply(true); } });
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
