// Dashboard view: attachments on messages and timeline entries (tiles, inline images and video), voice memos (one shared Audio, record / play), the upload wiring, copy-to-clipboard and the attach picker.
// t-oss-struct S10 (A7): moved out of app.js unchanged; a wire*() function, if any, holds the top-level event wiring and app.js calls it where
// the code used to run, so listeners register in the same order as before.

// Attachments on messages and timeline entries: images inline, footage playable, everything else a link.
// ===== t-voice-memo: voice memos render as a play bar. One shared Audio for the whole page, so a re-render
// (a new chat message rebuilds the box) never cuts playback: bars are re-bound to it by path (data-vm).
import { $ } from "../core/util.js";
import { ST, UI, poll } from "../core/store.js";
import { agent, agents, aname } from "../core/av.js";
import { fmtSize, toast, upload } from "../core/ui.js";
import { route } from "../core/router.js";
import { chatAtt } from "./chat.js";
import { drawerAtt } from "./drawer.js";
const AUD_RE = /\.(m4a|mp3|wav|aac|ogg|opus)$/i;
const media = p => ((ST && ST.media) || {})[p] || null;
const isAudioAtt = p => AUD_RE.test(p) || (/\.webm$/i.test(p) && (media(p) || {}).kind === "audio");
const VM = { a: null, cur: null, rate: 1, dur: {}, err: {}, open: new Set(), probe: new Set(), raf: 0, seek: null };
const vmFmt = s => isFinite(s) && s > 0 ? fmtDur(s) : "--:--";
const VM_PLAY = `<svg class="i-play" viewBox="0 0 12 14" aria-hidden="true"><path d="M0 0L12 7L0 14Z"/></svg><svg class="i-pause" viewBox="0 0 12 14" aria-hidden="true"><path d="M1 0h3.5v14H1zM7.5 0H11v14H7.5z"/></svg>`;
const vmBars = (pk, n = 48) => (pk && pk.length ? pk : Array(n).fill(0.3)).map(v => `<i style="--h:${v}"></i>`).join("");
const vmDur = p => (media(p) || {}).dur || VM.dur[p] || 0;
const vmSig = p => { const m = media(p) || {}, tx = m.tx || {}; return [m.peaks ? 1 : 0, m.dur || "", tx.status || "", (tx.text || "").length, tx.lang || "", ST && ST.meta && ST.meta.media_v ? 1 : 0, UI.lang].join("|"); };
function vmTime(p) {
  const zh = UI.lang !== "en", a = VM.a, d = vmDur(p);
  if (VM.err[p]) return VM.err[p] === "codec" ? (zh ? "此设备不能播放" : "Can't play here") : (zh ? "暂时打不开" : "Can't load");
  return VM.cur === p && a && (a.currentTime > 0 || !a.paused) ? vmFmt(a.currentTime) + " / " + vmFmt(d) : vmFmt(d);
}
function vmTx(p, m) {
  const zh = UI.lang !== "en", tx = m.tx || {}, srv = ST && ST.meta && ST.meta.media_v;
  if (tx.status === "done") {
    const t = tx.text || "", cjk = !tx.lang || /^(zh|ja|ko)$/.test(tx.lang), n = cjk ? t.length : (t.match(/\S+/g) || []).length;
    let ln = ""; if (tx.lang && tx.lang !== "zh") try { ln = new Intl.DisplayNames([zh ? "zh-CN" : "en"], { type: "language" }).of(tx.lang) + " · "; } catch { ln = tx.lang + " · "; }
    const cnt = zh ? `${n} ${cjk ? "字" : "词"}` : `${n} ${cjk ? "chars" : "words"}`;
    return `<details class="vm-tx"${VM.open.has(p) ? " open" : ""}><summary>${zh ? "机器转写" : "Machine transcript"} · ${ln}${cnt}</summary><p>${t ? esc(t) : (zh ? "（没听到说话）" : "(no speech)")}</p></details>`;
  }
  if (tx.status === "queued" || tx.status === "working")   // negative delay: a poll re-render does not restart the spinner
    return `<div class="vm-busy"><i style="animation-delay:-${Date.now() % 900}ms"></i>${zh ? (tx.status === "queued" ? "排队等本机转写…" : "正在本机转写…") : "Transcribing on this Mac…"}</div>`;
  if (!srv) return "";   // older server: no transcription yet, the bar still plays
  if (tx.status === "failed") return `<div class="vm-busy err">${zh ? "转写失败" : "Transcription failed"} · <button type="button" class="vm-retry" title="${esc(tx.error || "")}">${zh ? "重试" : "Retry"}</button></div>`;
  return `<div class="vm-busy"><button type="button" class="vm-retry">${zh ? "转写这条录音" : "Transcribe"}</button></div>`;
}
function vmHTML(p, u, name) {
  const m = media(p) || {}, zh = UI.lang !== "en", on = VM.cur === p && VM.a && !VM.a.paused, d = vmDur(p);
  const prog = VM.cur === p && VM.a && d ? Math.min(1, VM.a.currentTime / d) : 0, bars = vmBars(m.peaks);
  return `<div class="vm-wrap" data-vm="${esc(p)}" data-name="${name}" data-sig="${esc(vmSig(p))}"><div class="vm${on ? " on" : ""}" data-src="${u}" style="--pp:${(prog * 100).toFixed(2)}%">` +
    `<button type="button" class="vm-play" aria-label="${zh ? "播放" : "Play"} ${name}">${VM_PLAY}</button>` +
    `<div class="vm-wave${m.peaks ? "" : " vm-ph"}" role="slider" tabindex="0" aria-label="${zh ? "播放进度" : "Position"}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(prog * 100)}"><div class="vm-b">${bars}</div><div class="vm-b vm-p" aria-hidden="true">${bars}</div></div>` +
    `<b class="vm-t">${vmTime(p)}</b><button type="button" class="vm-rate" aria-label="${zh ? "倍速" : "Speed"}">${VM.rate}×</button></div>${vmTx(p, m)}</div>`;
}
const vmEls = p => document.querySelectorAll(`.vm-wrap[data-vm="${CSS.escape(p)}"]`);
function vmPaint(p = VM.cur) {
  if (!p) return;
  const a = VM.a, d = vmDur(p) || (a && VM.cur === p ? a.duration : 0), mine = VM.cur === p && a;
  const prog = mine && d ? Math.min(1, a.currentTime / d) : 0;
  vmEls(p).forEach(w => {
    const el = w.firstElementChild; if (!el) return;
    el.classList.toggle("on", !!(mine && !a.paused));
    el.style.setProperty("--pp", (prog * 100).toFixed(2) + "%");
    const t = $(".vm-t", el), s = vmTime(p); if (t && t.textContent !== s) t.textContent = s;
    const wv = $(".vm-wave", el); if (wv) wv.setAttribute("aria-valuenow", Math.round(prog * 100));
  });
}
function vmTick() { cancelAnimationFrame(VM.raf); const f = () => { vmPaint(); if (VM.a && !VM.a.paused) VM.raf = requestAnimationFrame(f); }; f(); }
function vmAudio() {
  if (VM.a) return VM.a;
  const a = VM.a = new Audio(); a.preload = "metadata";
  a.addEventListener("play", vmTick); a.addEventListener("pause", () => vmPaint());
  a.addEventListener("ended", () => { a.currentTime = 0; vmPaint(); });
  a.addEventListener("loadedmetadata", () => {
    if (VM.cur && isFinite(a.duration)) VM.dur[VM.cur] = a.duration;
    if (VM.seek != null && isFinite(a.duration)) { a.currentTime = VM.seek * a.duration; VM.seek = null; }
    vmPaint();
  });
  a.addEventListener("error", () => { if (VM.cur && a.error) VM.err[VM.cur] = vmCodec(VM.cur); vmPaint(); });
  return a;
}
// a file this browser cannot decode (ogg/opus on iPhone) vs one that failed to load (network, old server)
const VM_MIME = { m4a: "audio/mp4", aac: "audio/aac", mp3: "audio/mpeg", wav: "audio/wav", ogg: 'audio/ogg; codecs="opus"', opus: 'audio/ogg; codecs="opus"', webm: 'audio/webm; codecs="opus"' };
const vmCodec = p => { const m = VM_MIME[(p.split(".").pop() || "").toLowerCase()]; return m && !vmAudio().canPlayType(m) ? "codec" : "load"; };
function vmStart(w, frac) {
  const p = w.dataset.vm, a = vmAudio();
  if (VM.cur !== p) {
    const old = VM.cur; VM.cur = p; if (old) { a.pause(); vmPaint(old); }
    VM.seek = frac != null ? frac : null;
    a.src = w.firstElementChild.dataset.src; a.defaultPlaybackRate = a.playbackRate = VM.rate;
  } else if (frac != null) { const d = vmDur(p) || a.duration; if (d) a.currentTime = frac * d; }
  delete VM.err[p];
  const pr = a.play(); if (pr && pr.catch) pr.catch(e => { if (e && e.name === "NotSupportedError") VM.err[p] = vmCodec(p); vmPaint(p); });
}
function vmSync() {   // poll brought a waveform / transcript for a bar already on screen: swap just that bar
  document.querySelectorAll(".vm-wrap[data-vm]").forEach(w => {
    const p = w.dataset.vm;
    if (w.dataset.sig !== vmSig(p)) w.outerHTML = vmHTML(p, w.firstElementChild.dataset.src, w.dataset.name);
    else if (!vmDur(p) && !VM.probe.has(p)) {   // no server-side duration (older memo / older server): read it from the file header once
      VM.probe.add(p); const au = new Audio(); au.preload = "metadata";
      au.addEventListener("loadedmetadata", () => { if (isFinite(au.duration)) { VM.dur[p] = au.duration; vmPaint(p); } au.removeAttribute("src"); });
      au.src = w.firstElementChild.dataset.src;
    }
  });
}
const vmFrac = (wv, x) => { const r = wv.getBoundingClientRect(); return Math.max(0, Math.min(1, (x - r.left) / r.width)); };
// composer tile for a pending memo: duration + a 12-bar waveform decoded locally (best effort)
function vmTileFace(el, it) {
  const src = it.url || (it.path ? "/" + it.path.split("/").map(encodeURIComponent).join("/") : "");
  if (!src) return;
  const au = new Audio(); au.preload = "metadata"; au.src = src;
  au.addEventListener("loadedmetadata", () => { const d = $(".ap-dur2", el); if (d && isFinite(au.duration)) d.textContent = fmtDur(au.duration); });
  if (!it.url || !window.AudioContext) return;
  fetch(it.url).then(r => r.arrayBuffer()).then(buf => buf.byteLength < 30e6 ? new AudioContext().decodeAudioData(buf) : null).then(ab => {
    if (!ab) return;
    const ch = ab.getChannelData(0), n = 12, step = Math.floor(ch.length / n), rms = [];
    for (let i = 0; i < n; i++) { let s = 0, c = 0; for (let j = i * step; j < (i + 1) * step; j += 64) { s += ch[j] * ch[j]; c++; } rms.push(Math.sqrt(s / (c || 1))); }
    const top = Math.max(...rms) || 1, b = $(".vm-b", el);
    if (b) { b.innerHTML = vmBars(rms.map(v => Math.max(0.12, Math.pow(v / top, 0.7)).toFixed(2)), n); $(".vm-wave", el).classList.remove("vm-ph"); }
  }).catch(() => { });
}
function attHTML(list) {
  if (!list || !list.length) return "";
  return `<div class="atts">${list.map(p => {
    const u = /^(uploads|work)\//.test(p) ? "/" + p.split("/").map(encodeURIComponent).join("/") : null;
    const name = esc(p.split("/").pop().replace(/^\d{8}-\d{6}-[0-9a-f]{4}-/, ""));
    // ui2-C: thumbnails open the in-app viewer (viewer.js). /api/thumb needs the new server; on the old one the img falls back to the original.
    const th = `/api/thumb?p=${encodeURIComponent(p)}&w=360`, fb = `onerror="if(!this.dataset.f){this.dataset.f=1;this.src='${u}'}else{this.style.display='none'}"`;
    if (u && /\.(png|jpe?g|gif|webp)$/i.test(p)) return `<a href="${u}" target="_blank" class="lb-th" data-lb="${u}" data-kind="image" data-name="${name}"><img src="${th}" alt="${name}" loading="lazy" ${fb}></a>`;
    if (u && isAudioAtt(p)) return vmHTML(p, u, name);
    if (u && /\.(mp4|mov|m4v|webm)$/i.test(p)) return `<a href="${u}" target="_blank" class="lb-th lb-vid" data-lb="${u}" data-kind="video" data-name="${name}"><img src="${th}" alt="${name}" loading="lazy" onerror="this.style.display='none'"><i class="lb-play">▶</i></a>`;
    return u ? `<a href="${u}" target="_blank">📎 ${name}</a>` : `<span class="mono">📎 ${esc(p)}</span>`;
  }).join("")}</div>`;
}
// ===== ui19: preview tiles for pending attachments (one renderer for the chat composer and the detail-page reply composer) =====
// Keyed reconcile instead of innerHTML: an upload tile keeps its DOM node (and the decoded thumbnail) when it turns from "uploading" into "done".
const fmtDur = s => { s = Math.round(s); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
function attTiles(box, pending, redraw) {
  if (!box) return;
  const items = pending.map(p => {
    const m = (pending._m || {})[p] || {}, name = (m.name || p.split("/").pop().replace(/^\d{8}-\d{6}-[0-9a-f]{4}-/, ""));
    const kind = m.kind || (isAudioAtt(p) ? "audio" : /\.(mp4|mov|m4v|webm)$/i.test(p) ? "video" : /\.(png|jpe?g|gif|webp|heic|heif)$/i.test(p) ? "image" : "file");
    return { k: m.key || p, name, kind, path: p, url: m.url, up: null };
  }).concat(Object.entries(pending._up || {}).map(([k, u]) => ({ k, name: u.name, kind: u.kind, url: u.url, up: u })));
  const have = new Map(Array.from(box.children).map(el => [el.dataset.k, el]));
  items.forEach((it, i) => {
    let el = have.get(it.k); have.delete(it.k);
    if (!el) {
      el = document.createElement("div"); el.className = "ap-tile"; el.dataset.k = it.k;
      const thumb = it.path ? `/api/thumb?p=${encodeURIComponent(it.path)}&w=240` : "";
      let face;
      if (it.kind === "audio") face = `<div class="vm-mini"><div class="vm-wave vm-ph"><div class="vm-b">${vmBars(null, 12)}</div></div><b class="ap-dur2">--:--</b></div>`;
      else if (it.kind === "video" && it.url) face = `<video muted playsinline preload="metadata" src="${esc(it.url)}#t=0.1"></video>`;
      else if (it.kind !== "file" && (thumb || it.url)) face = `<img alt="" draggable="false" src="${esc(it.url || thumb)}">`;
      else face = `<div class="ap-file"><em>📎</em><small>${esc(it.name)}</small></div>`;
      if (it.kind === "video") face += `<i class="ap-play">▶</i><b class="ap-dur"></b>`;
      el.innerHTML = `<div class="ap-face">${face}</div><div class="ap-up"><i></i><b></b></div><button type="button" class="ap-x" aria-label="${UI.lang === "en" ? "Remove" : "移除"}">✕</button>`;
      el.title = it.name;
      el.classList.add(it.kind);
      if (it.kind === "audio") vmTileFace(el, it);
      const v = $("video", el), im = $("img", el);
      if (v) {
        v.addEventListener("loadedmetadata", () => { if (isFinite(v.duration)) { const d = $(".ap-dur", el); d.textContent = fmtDur(v.duration); el.classList.add("has-dur"); } });
        v.addEventListener("error", () => { el.classList.add("noprev"); });
      }
      if (im) im.addEventListener("error", () => el.classList.add("noprev"));
      el.querySelector(".ap-x").addEventListener("click", e => {
        e.stopPropagation();
        const idx = pending.findIndex(p => ((pending._m || {})[p] || {}).key === el.dataset.k || p === el.dataset.k);
        if (idx >= 0) { const m = (pending._m || {})[pending[idx]]; pending.splice(idx, 1); if (m && m.url) try { URL.revokeObjectURL(m.url); } catch { } redraw(); }
      });
    }
    // done: expose the file to the shared lightbox (viewer.js collects every [data-lb] in the strip)
    const face = $(".ap-face", el);
    if (it.path && !it.up) {
      const u = "/" + it.path.split("/").map(encodeURIComponent).join("/");
      if (it.kind === "video" || (it.kind === "image" && /\.(png|jpe?g|gif|webp)$/i.test(it.path))) { face.dataset.lb = u; face.dataset.kind = it.kind; face.dataset.name = it.name; }
      if (!el.dataset.path) { el.dataset.path = it.path; if (it.kind === "image" && !it.url) { /* thumb already set */ } }
    }
    if (it.path && !it.up && el.classList.contains("noprev") && !el.dataset.retry) {   // e.g. a HEIC the browser cannot decode: the server's /api/thumb can
      el.dataset.retry = 1; const im = $("img", el); if (im) { im.src = `/api/thumb?p=${encodeURIComponent(it.path)}&w=240`; el.classList.remove("noprev"); }
    }
    el.classList.toggle("up", !!it.up);
    if (it.up) { const p = Math.round(it.up.p * 100); el.style.setProperty("--p", p + "%"); $(".ap-up b", el).textContent = p + "%"; }
    if (box.children[i] !== el) box.insertBefore(el, box.children[i] || null);
  });
  have.forEach(el => el.remove());
  box.classList.toggle("has", items.length > 0);
}

// t-lib-attach: library tiles ([data-lib-path]) drag their existing path; a reply box takes it as an attachment without uploading again
const LIB_MIME = "application/x-rt-path";
const attachPath = (pending, p) => { if (p && !pending.includes(p)) pending.push(p); if (pending._show) pending._show(); };
/* t-attach-btn (batch 2, direction A): one attach button everywhere = solid round paperclip; while files are dragged over the composer it turns into an accent ↑. */
const ATT_IC = '<svg class="ic-clip" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 11.2l-8.3 8.3a5.3 5.3 0 0 1-7.5-7.5l8.4-8.4a3.6 3.6 0 0 1 5.1 5.1l-8.4 8.4a1.8 1.8 0 0 1-2.5-2.5l7.7-7.7"/></svg><svg class="ic-up" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V6M6.5 11.5L12 6l5.5 5.5"/></svg>';
const attTitle = () => UI.lang === "en" ? "Attach files · or drop / paste them here" : "添加附件 · 也可以拖进来或直接粘贴";
function wireUploads(ta, pending, onChange) {
  pending._up = pending._up || {};
  const add = files => Promise.all(Array.from(files).map(async f => {
    const key = Math.random().toString(36).slice(2);
    const isA = /^audio\//.test(f.type) || AUD_RE.test(f.name || "");   // t-voice-memo
    const isV = !isA && (/^video\//.test(f.type) || /\.(mp4|mov|m4v|webm)$/i.test(f.name || "")), isI = /^image\//.test(f.type);
    let blob = ""; try { if (isV || isI || isA) blob = URL.createObjectURL(f); } catch { }   // ui19: local preview while uploading
    pending._up[key] = { name: f.name || "paste.png", p: 0, size: fmtSize(f.size), url: blob, kind: isA ? "audio" : isV ? "video" : isI ? "image" : "file" }; onChange();
    try { const path = await upload(f, p => { pending._up[key].p = p; onChange(); }); (pending._m = pending._m || {})[path] = { key, url: blob, kind: pending._up[key].kind, name: pending._up[key].name }; pending.push(path); }
    catch { if (blob) try { URL.revokeObjectURL(blob); } catch { } }
    delete pending._up[key]; onChange();
  }));
  ta.addEventListener("paste", e => { const fs = Array.from(e.clipboardData.files || []); if (fs.length) { e.preventDefault(); add(fs); } });
  pending._show = onChange;   // t-lib-attach: attachTo() refreshes the tiles after adding a library path
  const libDrag = e => Array.from((e.dataTransfer && e.dataTransfer.types) || []).includes(LIB_MIME);
  /* t-attach-btn: the whole composer is the drop zone (was the textarea only). A counter absorbs the dragenter/dragleave pairs between child elements. */
  const zone = ta.closest(".composer, .ch-comp") || ta;
  const dragOk = e => { const ty = Array.from((e.dataTransfer && e.dataTransfer.types) || []); return ty.includes("Files") || ty.includes(LIB_MIME); };
  let depth = 0;
  const hint = on => {
    zone.classList.toggle("drop-on", on); ta.classList.toggle("lib-drop", on);
    if (on && ta.dataset.ph == null) { ta.dataset.ph = ta.placeholder; ta.placeholder = UI.lang === "en" ? "Drop to attach to this reply" : "松手 = 附到这条回复"; }
    else if (!on && ta.dataset.ph != null) { ta.placeholder = ta.dataset.ph; delete ta.dataset.ph; }
  };
  zone.addEventListener("dragenter", e => { if (!dragOk(e)) return; e.preventDefault(); depth++; hint(true); });
  zone.addEventListener("dragover", e => { if (!dragOk(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; hint(true); });
  zone.addEventListener("dragleave", () => { depth = Math.max(0, depth - 1); if (!depth) hint(false); });
  zone.addEventListener("drop", e => { if (!dragOk(e)) return; e.preventDefault(); depth = 0; hint(false); const lp = e.dataTransfer.getData(LIB_MIME); if (lp) { attachPath(pending, lp); return; } add(Array.from(e.dataTransfer.files || [])); });
  return add;
}

// t-id-copy: clipboard API where the page is a secure context (127.0.0.1); the phone over plain-http Tailscale has no navigator.clipboard,
// so fall back to a hidden textarea + execCommand("copy"), which iOS allows inside a tap.
function copyText(s) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(s).then(() => true, () => copyOld(s));
  return Promise.resolve(copyOld(s));
}
function copyOld(s) {
  const ta = document.createElement("textarea"); ta.value = s; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px";
  document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, s.length); let ok = false; try { ok = document.execCommand("copy"); } catch (_) { } ta.remove(); return ok;
}

// ===== t-lib-attach: 「附到回复…」 from the phone viewer. The sheet offers the current DM partner, the last card opened, and the other team members;
// picking one opens that thread / card and puts the file in its pending attachments (the same path, nothing uploaded). =====
const ATT = { lastCard: null };
function attachTo(dest, p) {
  if (dest.dm) { route("#dm=" + encodeURIComponent(dest.dm)); attachPath(chatAtt, p); return; }
  route("#item=" + encodeURIComponent(dest.item));
  let n = 0; const put = () => { if (UI.item === dest.item && $("#drawer .composer textarea")) attachPath(drawerAtt, p); else if (++n < 20) setTimeout(put, 150); };   // the drawer may load the full card first
  setTimeout(put, 120);
}
function attachPick(p) {
  const en = UI.lang === "en", old = $("#att-pick"); if (old) old.remove();
  const me = agent(UI.chat) || agent("manager"), card = ATT.lastCard && (ST.items || []).find(i => i.id === ATT.lastCard);
  const rest = agents().filter(a => a.enabled !== false && a.id !== (me && me.id));
  const row = (k, v, lead, txt, sub) => `<button type="button" class="ap-row" data-ap-${k}="${esc(v)}"><small>${lead}</small><span>${esc(txt)}</span>${sub ? `<em>${sub}</em>` : ""}</button>`;
  const el = document.createElement("div"); el.id = "att-pick";
  el.innerHTML = `<div class="ap-scrim" data-ap-x></div><div class="ap-sheet" role="dialog" aria-label="${en ? "Attach to" : "附到哪里"}"><b class="ap-h">${en ? "Attach to" : "附到哪里"}</b>
    ${me ? row("dm", me.id, en ? "Chat" : "对话", (en ? "To " : "对") + aname(me) + (en ? "" : "说"), en ? "current chat" : "最近的对话") : ""}
    ${card ? row("item", card.id, en ? "Card" : "卡片", card.title || card.id, en ? "last opened" : "刚才看的卡") : ""}
    <button type="button" class="ap-row ap-more" data-ap-more><span>${en ? "Someone else…" : "发给别人…"}</span></button>
    <div class="ap-others" hidden>${rest.map(a => row("dm", a.id, en ? "Chat" : "对话", aname(a))).join("")}</div>
    <button type="button" class="ap-row ap-cancel" data-ap-x><span>${en ? "Cancel" : "取消"}</span></button></div>`;
  document.body.appendChild(el);
  el.addEventListener("click", e => {
    if (e.target.closest("[data-ap-more]")) { $(".ap-others", el).hidden = false; $(".ap-more", el).hidden = true; return; }
    const d = e.target.closest("[data-ap-dm]"), c = e.target.closest("[data-ap-item]");
    if (d || c || e.target.closest("[data-ap-x]")) el.remove();
    if (d) attachTo({ dm: d.dataset.apDm }, p); else if (c) attachTo({ item: c.dataset.apItem }, p);
  });
}

function wireAttach() {
  document.addEventListener("click", e => {   // capture: these buttons sit inside links/bubbles that have their own click handlers
    const b = e.target.closest && e.target.closest(".vm-play, .vm-rate, .vm-retry"); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const w = b.closest(".vm-wrap"), p = w.dataset.vm;
    if (b.classList.contains("vm-play")) { if (VM.cur === p && VM.a && !VM.a.paused) VM.a.pause(); else vmStart(w); }
    else if (b.classList.contains("vm-rate")) {
      VM.rate = VM.rate === 1 ? 1.5 : VM.rate === 1.5 ? 2 : 1;
      if (VM.a) VM.a.defaultPlaybackRate = VM.a.playbackRate = VM.rate;
      document.querySelectorAll(".vm-rate").forEach(x => { x.textContent = VM.rate + "×"; });
    } else {
      b.disabled = true;
      fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: p }) })
        .then(r => { if (!r.ok) throw new Error(r.status); return poll(true); })
        .catch(() => { b.disabled = false; toast(UI.lang === "en" ? "Could not start transcription" : "没能开始转写", true); });
    }
  }, true);
  document.addEventListener("pointerdown", e => {   // tap or drag the waveform to seek
    const wv = e.target.closest && e.target.closest(".vm-wave"); if (!wv || e.button > 0) return;
    e.stopPropagation(); const w = wv.closest(".vm-wrap");
    vmStart(w, vmFrac(wv, e.clientX));
    const mv = ev => { const a = VM.a, d = vmDur(w.dataset.vm) || (a && a.duration); if (a && d && VM.cur === w.dataset.vm) { a.currentTime = vmFrac(wv, ev.clientX) * d; vmPaint(); } };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); removeEventListener("pointercancel", up); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up); addEventListener("pointercancel", up);
  }, true);
  document.addEventListener("keydown", e => {
    const wv = e.target.closest && e.target.closest(".vm-wave"); if (!wv || !/^Arrow(Left|Right)$|^ $|^Enter$/.test(e.key)) return;
    e.preventDefault(); const w = wv.closest(".vm-wrap"), p = w.dataset.vm, a = VM.a;
    if (e.key === " " || e.key === "Enter") { if (VM.cur === p && a && !a.paused) a.pause(); else vmStart(w); return; }
    if (VM.cur === p && a) { a.currentTime = Math.max(0, a.currentTime + (e.key === "ArrowRight" ? 5 : -5)); vmPaint(); }
  });
  document.addEventListener("toggle", e => { const d = e.target; if (d.classList && d.classList.contains("vm-tx")) { const p = d.closest(".vm-wrap").dataset.vm; d.open ? VM.open.add(p) : VM.open.delete(p); } }, true);
  document.addEventListener("dragstart", e => { const a = e.target && e.target.closest && e.target.closest("[data-lib-path]"); if (a) { e.dataTransfer.setData(LIB_MIME, a.dataset.libPath); e.dataTransfer.effectAllowed = "copy"; } });
  document.addEventListener("dragend", () => document.querySelectorAll("textarea.lib-drop").forEach(t => t.dispatchEvent(new Event("dragleave"))));
}

export { AUD_RE, media, isAudioAtt, VM, vmFmt, VM_PLAY, vmBars, vmDur, vmSig, vmTime, vmTx, vmHTML, vmEls, vmPaint, vmTick, vmAudio, VM_MIME, vmCodec, vmStart, vmSync, vmFrac, vmTileFace, attHTML, fmtDur, attTiles, LIB_MIME, attachPath, ATT_IC, attTitle, wireUploads, copyText, copyOld, ATT, attachTo, attachPick, wireAttach };
