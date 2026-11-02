// ui2-C: in-app image / video viewer (lightbox). Delegated, so the 5s chat repaint never breaks it.
// Degrades on an old server: no /api/thumb -> thumbnails fall back to the original; no Range support -> video plays inline natively.
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let rangeOK = null;   // new server (Range-aware) answers /api/thumb?p=none with 403; the old one has no such route (404)
  function detect() {
    if (rangeOK !== null) return Promise.resolve(rangeOK);
    return fetch("/api/thumb?p=none", { cache: "no-store" }).then(r => (rangeOK = r.status === 403), () => (rangeOK = false));
  }

  let items = [], idx = 0, root = null, scrollY0 = 0, pushed = false, chromeOn = true, zoom = null;

  function collect(a) {
    const box = a.closest(".atts, .pending-att, .lib-g") || a.parentElement;   // .lib-g: one day of the asset library (t-imp29-p4)
    const list = Array.from(box.querySelectorAll("[data-lb]"));
    return { list: list.map(el => ({ url: el.dataset.lb, kind: el.dataset.kind, name: el.dataset.name || "", item: el.dataset.libItem || "", title: el.dataset.libTitle || "", path: el.dataset.libPath || "" })), i: list.indexOf(a) };
  }
  function build() {
    root = document.createElement("div");
    root.id = "lb"; root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true");
    root.innerHTML = `<div class="lb-bg"></div>
      <div class="lb-top"><button class="lb-x" aria-label="关闭">✕</button><span class="lb-cnt"></span><button class="lb-go" hidden>去这张卡</button><button class="lb-att" hidden>附到回复…</button><a class="lb-dl" download aria-label="保存">⤓ 保存</a></div>
      <div class="lb-stage"></div>
      <button class="lb-nav lb-prev" aria-label="上一张">‹</button><button class="lb-nav lb-next" aria-label="下一张">›</button>
      <div class="lb-dots"></div>`;
    document.body.appendChild(root);
    $(".lb-x", root).onclick = () => close();
    $(".lb-go", root).onclick = e => {   // asset library: jump to the card this file belongs to (after the history.back() of close() has settled)
      e.stopPropagation(); const id = items[idx] && items[idx].item; close();
      if (id && window.App) setTimeout(() => App.openItem(id), 260);
    };
    $(".lb-att", root).onclick = e => {   // t-lib-attach (phone): pick a DM / card and carry this file's path there
      e.stopPropagation(); const p = items[idx] && items[idx].path; close();
      if (p && window.App && App.attachPick) setTimeout(() => App.attachPick(p), 260);
    };
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
    root.classList.remove("out"); root.classList.add("on");
    root.classList.remove("hide");
    try { history.pushState({ lb: 1 }, ""); pushed = true; } catch (_) { pushed = false; }
    show();
  }
  function stopVideo() { const v = $("video", root); if (v) { try { v.pause(); } catch (_) { } v.removeAttribute("src"); v.load(); } }
  function show() {
    const it = items[idx], st = $(".lb-stage", root);
    stopVideo(); zoom = { s: 1, x: 0, y: 0 }; root.classList.toggle("is-video", it.kind === "video");
    $(".lb-cnt", root).textContent = `${items.length > 1 ? `${idx + 1} / ${items.length} · ` : ""}${it.name}`;
    const gb = $(".lb-go", root); gb.hidden = !it.item; gb.title = it.title || "";
    $(".lb-att", root).hidden = !(it.path && matchMedia("(max-width: 760px)").matches);   // t-lib-attach: phone only (desktop drags the tile)
    const dl = $(".lb-dl", root); dl.href = it.url; dl.setAttribute("download", it.name || "");
    $(".lb-prev", root).hidden = idx <= 0; $(".lb-next", root).hidden = idx >= items.length - 1;
    $(".lb-dots", root).innerHTML = items.length > 1 && items.length <= 12 ? items.map((_, k) => `<i class="${k === idx ? "on" : ""}"></i>`).join("") : "";
    if (it.kind === "video") {
      st.innerHTML = `<video class="lb-media" src="${esc(it.url)}" controls playsinline preload="metadata" poster="/api/thumb?p=${encodeURIComponent(it.url.slice(1).split("/").map(decodeURIComponent).join("/"))}&w=720"></video>
        <div class="lb-err" hidden>这个格式在手机上播不了 · <a href="${esc(it.url)}" download>下载原文件</a></div>`;
      const v = $("video", st);
      v.addEventListener("error", () => { if (!v.isConnected || !v.getAttribute("src")) return; v.hidden = true; $(".lb-err", st).hidden = false; });
    } else {
      st.innerHTML = `<img class="lb-media" src="${esc(it.url)}" alt="${esc(it.name)}" draggable="false">`;
      if (!reduce) { const im = $("img", st); im.style.opacity = 0; im.style.transform = "scale(.96)"; requestAnimationFrame(() => { im.style.transition = "opacity .24s var(--ease), transform .24s var(--ease)"; im.style.opacity = 1; im.style.transform = ""; }); }
    }
  }
  function go(n) { if (n < 0 || n >= items.length || n === idx) return; idx = n; show(); }
  function close(fromPop) {
    if (!root || !root.classList.contains("on")) return;
    stopVideo();
    const fin = () => { root.classList.remove("on", "out"); $(".lb-stage", root).innerHTML = ""; document.body.classList.remove("lb-open"); window.scrollTo(0, scrollY0); };
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
  addEventListener("keydown", e => {
    if (!root || !root.classList.contains("on")) return;
    if (e.key === "Escape") close(); else if (e.key === "ArrowLeft") go(idx - 1); else if (e.key === "ArrowRight") go(idx + 1);
  });

  // ---- gestures: pointer events; 1 finger = swipe / drag / pan, 2 fingers = pinch, double tap = zoom ----
  function gestures(st) {
    const P = new Map(); let g = null, lastTap = 0;
    const media = () => $(".lb-media", st);
    const apply = (anim) => { const m = media(); if (!m || m.tagName !== "IMG") return; m.style.transition = anim ? "transform .22s var(--ease)" : "none"; m.style.transform = `translate(${zoom.x}px,${zoom.y}px) scale(${zoom.s})`; };
    const dist = () => { const a = [...P.values()]; return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); };
    st.addEventListener("pointerdown", e => {
      const m = media(); if (!m || m.tagName !== "IMG") return;
      st.setPointerCapture(e.pointerId); P.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (P.size === 2) g = { mode: "pinch", d0: dist(), s0: zoom.s };
      else g = { mode: "one", x0: e.clientX, y0: e.clientY, zx: zoom.x, zy: zoom.y, t0: Date.now(), moved: false, dir: null };
    });
    st.addEventListener("pointermove", e => {
      if (!P.has(e.pointerId) || !g) return;
      P.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (g.mode === "pinch" && P.size >= 2) { zoom.s = Math.max(.7, Math.min(5, g.s0 * dist() / g.d0)); apply(false); return; }
      if (g.mode !== "one") return;
      const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
      if (Math.abs(dx) + Math.abs(dy) > 6) g.moved = true;
      if (zoom.s > 1.02) { zoom.x = g.zx + dx; zoom.y = g.zy + dy; apply(false); return; }
      if (!g.dir && g.moved) g.dir = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
      if (g.dir === "h") { media().style.transition = "none"; media().style.transform = `translateX(${dx}px)`; }
      else if (g.dir === "v") { media().style.transition = "none"; media().style.transform = `translateY(${dy}px)`; $(".lb-bg", root).style.opacity = Math.max(.2, 1 - Math.abs(dy) / 400); }
    });
    const end = e => {
      if (!P.has(e.pointerId)) return; P.delete(e.pointerId);
      if (!g) return;
      if (g.mode === "pinch") { if (P.size < 2) { if (zoom.s < 1) { zoom = { s: 1, x: 0, y: 0 }; apply(true); } g = null; } return; }
      const dx = e.clientX - g.x0, dy = e.clientY - g.y0, fast = Date.now() - g.t0 < 300, m = media();
      $(".lb-bg", root).style.opacity = "";
      if (zoom.s <= 1.02 && g.dir === "h" && (Math.abs(dx) > 70 || (fast && Math.abs(dx) > 30))) { g = null; return go(idx + (dx < 0 ? 1 : -1)), void (media() && (media().style.transform = "")); }
      if (zoom.s <= 1.02 && g.dir === "v" && (Math.abs(dy) > 120 || (fast && Math.abs(dy) > 50))) { g = null; return close(); }
      if (!g.moved) {   // tap
        const now = Date.now();
        if (now - lastTap < 300) { zoom = zoom.s > 1.02 ? { s: 1, x: 0, y: 0 } : { s: 2.5, x: 0, y: 0 }; apply(true); lastTap = 0; }
        else { lastTap = now; setTimeout(() => { if (lastTap === now) { lastTap = 0; chromeOn = !chromeOn; root.classList.toggle("hide", !chromeOn); } }, 300); }
      } else if (m && zoom.s <= 1.02) { zoom = { s: 1, x: 0, y: 0 }; apply(true); }
      g = null;
    };
    st.addEventListener("pointerup", end); st.addEventListener("pointercancel", end);
    st.addEventListener("wheel", e => { if (!media() || media().tagName !== "IMG") return; e.preventDefault(); zoom.s = Math.max(1, Math.min(5, zoom.s * (e.deltaY < 0 ? 1.12 : .9))); if (zoom.s === 1) { zoom.x = zoom.y = 0; } apply(false); }, { passive: false });
  }

  // ---- entry: click on any [data-lb] thumbnail ----
  document.addEventListener("click", e => {
    const a = e.target.closest("[data-lb]"); if (!a) return;
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
