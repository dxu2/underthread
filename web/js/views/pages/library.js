// Dashboard page 素材 / assets library: collecting attachments, filters, tiles, paging and peaks.
// t-oss-struct S10 (A5): moved out of app.js unchanged; a wire*() function, if any, holds the top-level event wiring and app.js calls it where
// the code used to run, so listeners register in the same order as before.


// ===== t-imp29-p4: 素材库 (asset library). Every attachment on every card (archived ones too), built from the loaded state; no new API.
// uploads/voices/ is private voice material (仅本机私用): hidden until switched on, then flagged. Only uploads/ and work/ paths show (never tools/).
// Lazy: 60 tiles per batch (an IntersectionObserver on .lib-more adds the next 60), images via /api/thumb + loading=lazy, no video posters
// (a video tile only reads its duration from the file header once it is on screen). A poll keeps the DOM unless the asset list itself changed.
import { $ } from "../../core/util.js";
import { dayKey, pad, whoName } from "../../core/i18n.js";
import { ARCH, REV, ST, UI, archAll } from "../../core/store.js";
import { agent, agents, aname, av, ringOnce } from "../../core/av.js";
import { fmtDur, isAudioAtt, vmBars, vmHTML, vmSync } from "../attach.js";
import { pageHead } from "./common.js";
import { PAGES, renderPage } from "./index.js";
import { hooks } from "../../app.js";
const LIB = { kind: "all", who: "", q: "", priv: false, n: 60, rev: null, list: null, sig: "", dur: {}, io: null, dio: null, pio: null, peaks: {}, pq: [], busy: false, ac: null };
const LIB_BATCH = 60;
const libPriv = p => /^uploads\/voices\//.test(p);
const libKind = p => /\.(png|jpe?g|gif|webp|heic|heif)$/i.test(p) ? "image" : isAudioAtt(p) ? "audio" : /\.(mp4|mov|m4v|webm)$/i.test(p) ? "video" : "other";
const libUrl = p => "/" + p.split("/").map(encodeURIComponent).join("/");
const libName = p => p.split("/").pop().replace(/^\d{8}-\d{6}-[0-9a-f]{4}-/, "");
function libCollect() {
  if (!ARCH.all || ARCH.v !== (ST.meta.archive || {}).v) archAll();   // t-perf A: archived cards' files arrive a moment later ("rt-arch")
  if (LIB.list && LIB.rev === REV && LIB.av === ARCH.v) return LIB.list;
  const m = new Map();
  const add = (p, it, who, ms) => {
    if (typeof p !== "string" || !/^(uploads|work)\//.test(p) || /(^|\/)\.\.(\/|$)/.test(p)) return;
    const st = p.match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-[0-9a-f]{4}-/);   // uploads carry their own timestamp
    if (st) ms = new Date(+st[1], st[2] - 1, +st[3], +st[4], +st[5], +st[6]).getTime();
    const a = m.get(p);
    if (!a) m.set(p, { p, kind: libKind(p), priv: libPriv(p), item: it, who, ms: ms || 0, n: 1 });
    else { a.n++; if (ms > a.ms) { a.ms = ms; a.item = it; a.who = who; } }   // shown under the card that used it last
  };
  const live = new Set((ST.items || []).map(i => i.id));
  for (const it of (ST.items || []).concat((ARCH.all || []).filter(i => !live.has(i.id)))) {
    const subs = (it.thread || []).filter(x => x.kind === "event" && /^提交审核/.test(x.text || "")).map(x => Date.parse(x.t)).filter(isFinite);
    const t0 = subs.length ? subs[0] : Date.parse(it.created) || 0, t1 = subs.length ? subs[subs.length - 1] : Date.parse(it.updated) || t0;
    for (const p of it.attachments || []) add(p, it, it.owner, t0);
    for (const p of it.draft_attachments || []) add(p, it, it.owner, t1);
    for (const x of it.thread || []) for (const p of x.attachments || []) add(p, it, x.who || it.owner, Date.parse(x.t) || t0);
  }
  LIB.list = [...m.values()].sort((a, b) => b.ms - a.ms || a.p.localeCompare(b.p)); LIB.rev = REV; LIB.av = ARCH.v;
  return LIB.list;
}
const libSig = L => L.length + "|" + L.map(a => a.p + ">" + a.item.id).join(",");
function libFilter(L, skip) {
  const q = LIB.q.trim().toLowerCase();
  return L.filter(a => (LIB.priv || !a.priv) && (skip === "kind" || LIB.kind === "all" || a.kind === LIB.kind) && (skip === "who" || !LIB.who || a.who === LIB.who) &&
    (!q || a.p.toLowerCase().includes(q) || (a.item.title || "").toLowerCase().includes(q) || a.item.id.toLowerCase().includes(q)));
}
const libWho = w => w === "me" ? whoName("me") : aname(agent(w));
function libChips(L) {
  const zh = UI.lang !== "en", byK = libFilter(L, "kind"), byW = libFilter(L, "who");
  const K = [["all", zh ? "全部" : "All"], ["image", zh ? "图片" : "Images"], ["video", zh ? "视频" : "Video"], ["audio", zh ? "录音" : "Audio"], ["other", zh ? "其他" : "Other"]];
  const kc = k => k === "all" ? byK.length : byK.filter(a => a.kind === k).length;
  const ids = new Set(byW.map(a => a.who)), ag = agents().map(a => a.id), order = ag.filter(id => ids.has(id)).concat([...ids].filter(w => w && !ag.includes(w)));
  const nPriv = L.filter(a => a.priv).length;
  return `<div class="lib-seg" role="group">${K.map(([k, n]) => `<button type="button" class="${LIB.kind === k ? "on" : ""}" data-libk="${k}">${n} <small>${kc(k)}</small></button>`).join("")}</div>` +
    `<div class="lib-seg lib-who" role="group"><button type="button" class="${LIB.who ? "" : "on"}" data-libw="">${zh ? "所有人" : "Everyone"}</button>${order.map(w => `<button type="button" class="${LIB.who === w ? "on" : ""}" data-libw="${esc(w)}">${esc(libWho(w))}</button>`).join("")}</div>` +
    (nPriv ? `<button type="button" class="lib-pvt${LIB.priv ? " on" : ""}" data-libpriv>${LIB.priv ? (zh ? `已显示私用录音 ${nPriv} 个 · 隐藏` : `Showing ${nPriv} private voice files · hide`) : (zh ? `私用录音 ${nPriv} 个已隐藏 · 显示` : `${nPriv} private voice files hidden · show`)}</button>` : "");
}
function libDay(ms) {
  const zh = UI.lang !== "en", d = new Date(ms), k = dayKey(d), md = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (!ms) return zh ? "日期不明" : "Undated";
  if (k === dayKey(new Date())) return (zh ? "今天 · " : "Today · ") + md;
  if (k === dayKey(new Date(Date.now() - 864e5))) return (zh ? "昨天 · " : "Yesterday · ") + md;
  return (d.getFullYear() !== new Date().getFullYear() ? d.getFullYear() + "-" : "") + md;
}
function libTile(a) {
  const zh = UI.lang !== "en", u = libUrl(a.p), name = esc(libName(a.p)), it = a.item, w = agent(a.who) || agent(it.owner);
  const lb = `data-lb="${u}" data-name="${name}" data-lib-item="${esc(it.id)}" data-lib-title="${esc(it.title || it.id)}"${a.priv ? "" : ` data-lib-path="${esc(a.p)}"`}`;   // t-lib-attach: path for drag / 附到回复 (never for private voice files)
  let face;
  if (a.kind === "image") {
    const th = `/api/thumb?p=${encodeURIComponent(a.p)}&w=360`;
    face = /\.(heic|heif)$/i.test(a.p) ? `<a href="${u}" target="_blank" class="lib-f" ${lb} data-kind="image"><img src="${th}" alt="${name}" loading="lazy" decoding="async" onload="this.classList.add('ld')" onerror="this.style.display='none'"></a>`
      : `<a href="${u}" target="_blank" class="lib-f" ${lb} data-kind="image"><img src="${th}" alt="${name}" loading="lazy" decoding="async" onload="this.classList.add('ld')" onerror="if(!this.dataset.f){this.dataset.f=1;this.src='${u}'}else{this.style.display='none'}"></a>`;
  } else if (a.kind === "video") {
    const d = LIB.dur[a.p];
    face = `<a href="${u}" target="_blank" class="lib-f lib-vid" ${lb} data-kind="video"><i class="lib-play" aria-hidden="true">▶</i><b class="lib-k">${zh ? "视频" : "Video"}<span class="lib-dur" data-libdur="${esc(a.p)}">${d ? " " + fmtDur(d) : ""}</span></b></a>`;
  } else if (a.kind === "audio") {
    face = `<div class="lib-f lib-aud"><b class="lib-k">${zh ? "录音" : "Audio"}</b>${vmHTML(a.p, u, name)}</div>`;
  } else {
    const ext = (a.p.match(/\.([a-z0-9]+)$/i) || [, "file"])[1].toLowerCase();
    face = `<a href="${u}" target="_blank" class="lib-f lib-doc"${a.priv ? "" : ` data-lib-path="${esc(a.p)}"`}><em>.${esc(ext)}</em><small>${name}</small></a>`;
  }
  const cap = `<div class="lib-cap" data-item="${esc(it.id)}" title="${esc((zh ? "去这张卡 · " : "Open card · ") + (it.title || it.id))}">${w ? av(w, "sm") : ""}<span>${esc(it.title || it.id)}</span></div>`;
  return `<div class="lib-t lib-${a.kind}${a.priv ? " lib-pv" : ""}" title="${esc(a.p)}">${face}${a.priv ? `<span class="lib-pvb">${zh ? "仅本机私用" : "Private"}</span>` : ""}${cap}</div>`;
}
// append tiles [from, to) of the filtered list, grouped by day; a batch that starts on the same day continues the last section
function libAppend(grid, F, from, to) {
  const last = grid.lastElementChild; let cur = last ? last.dataset.day : null, open = false, html = "", tail = "";
  if (!from || !LIB.ring) LIB.ring = new Set();   // t-m2-a ⓪: a working uploader rings on its newest tile only
  ringOnce(() => { for (let i = from; i < Math.min(to, F.length); i++) {
    const a = F[i], k = a.ms ? dayKey(new Date(a.ms)) : "-";
    if (k !== cur) { if (open) html += `</div></section>`; html += `<section class="lib-day" data-day="${k}"><h3 class="lib-dh">${libDay(a.ms)}</h3><div class="lib-g">`; open = true; cur = k; }
    if (open) html += libTile(a); else tail += libTile(a);
  } }, LIB.ring);
  if (open) html += `</div></section>`;
  if (tail) last.querySelector(".lib-g").insertAdjacentHTML("beforeend", tail);
  if (html) grid.insertAdjacentHTML("beforeend", html);
}
function libPaint(full) {
  const root = $("#pagebody .lib-root"); if (!root) return;
  const L = libCollect(), F = libFilter(L), grid = $(".lib-grid", root), zh = UI.lang !== "en";
  $(".lib-chips", root).innerHTML = libChips(L);
  $(".lib-sub", root).textContent = zh ? `所有单子里的图、视频、录音 · ${F.length} / ${L.filter(a => LIB.priv || !a.priv).length} 个 · 点开用原来的查看器` : `Images, video and audio from every card · ${F.length} of ${L.filter(a => LIB.priv || !a.priv).length} · opens in the viewer`;
  if (full) { grid.innerHTML = ""; libAppend(grid, F, 0, LIB.n); }
  grid.dataset.shown = Math.min(LIB.n, F.length);
  $(".lib-none", root).hidden = F.length > 0;
  $(".lib-more", root).hidden = LIB.n >= F.length;
  LIB.sig = libSig(L);
  libObserve(root); vmSync();
}
function libMore() {
  const root = $("#pagebody .lib-root"); if (!root) return;
  const F = libFilter(libCollect()), from = Math.min(LIB.n, F.length); if (from >= F.length) return;
  LIB.n += LIB_BATCH; libAppend($(".lib-grid", root), F, from, LIB.n);
  $(".lib-more", root).hidden = LIB.n >= F.length; libObserve(root); vmSync();
}
function libObserve(root) {
  if (!("IntersectionObserver" in window)) return;
  if (!LIB.io) LIB.io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) libMore(); }, { rootMargin: "600px 0px" });
  LIB.io.disconnect(); LIB.io.observe($(".lib-more", root));
  if (!LIB.dio) LIB.dio = new IntersectionObserver(es => es.forEach(e => {   // a video's duration: header only, once it is on screen
    if (!e.isIntersecting) return; const el = e.target, p = el.dataset.libdur; LIB.dio.unobserve(el);
    if (LIB.dur[p]) { el.textContent = " " + fmtDur(LIB.dur[p]); return; }
    const v = document.createElement("video"); v.preload = "metadata"; v.muted = true;
    v.addEventListener("loadedmetadata", () => { if (isFinite(v.duration)) { LIB.dur[p] = v.duration; document.querySelectorAll(`.lib-dur[data-libdur="${CSS.escape(p)}"]`).forEach(x => x.textContent = " " + fmtDur(v.duration)); } v.removeAttribute("src"); v.load(); });
    v.src = libUrl(p);
  }), { rootMargin: "200px 0px" });
  root.querySelectorAll(".lib-dur:empty").forEach(el => LIB.dio.observe(el));
  // audio without a server waveform: decode it once it is on screen (one file at a time, one shared AudioContext; files over 12 MB keep the placeholder)
  if (!LIB.pio) LIB.pio = new IntersectionObserver(es => es.forEach(e => { if (!e.isIntersecting) return; LIB.pio.unobserve(e.target); const w = e.target.closest(".vm-wrap"); if (w) libPeaks(w.dataset.vm); }), { rootMargin: "200px 0px" });
  root.querySelectorAll(".lib-aud .vm-wave.vm-ph").forEach(el => { const p = el.closest(".vm-wrap").dataset.vm; if (LIB.peaks[p]) libPeakPaint(p); else LIB.pio.observe(el); });
}
function libPeakPaint(p) {
  const pk = LIB.peaks[p]; if (!pk || pk === 1) return;
  document.querySelectorAll(`#pagebody .lib-aud .vm-wrap[data-vm="${CSS.escape(p)}"] .vm-wave`).forEach(wv => { wv.querySelectorAll(".vm-b").forEach(b => b.innerHTML = vmBars(pk)); wv.classList.remove("vm-ph"); });
}
function libPeaks(p) {
  if (LIB.peaks[p] || LIB.pq.includes(p)) return;
  LIB.pq.push(p); if (LIB.busy) return;
  const next = () => {
    const q = LIB.pq.shift(); if (!q) { LIB.busy = false; return; }
    LIB.busy = true;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) { LIB.busy = false; return; }
    fetch(libUrl(q)).then(r => +(r.headers.get("content-length") || 0) > 12e6 ? null : r.arrayBuffer())
      .then(buf => buf && new Promise((ok, no) => (LIB.ac = LIB.ac || new AC()).decodeAudioData(buf, ok, no)))
      .then(ab => {
        if (!ab) { LIB.peaks[q] = 1; return; }
        const ch = ab.getChannelData(0), n = 48, step = Math.floor(ch.length / n), rms = [];
        for (let i = 0; i < n; i++) { let s = 0, c = 0; for (let j = i * step; j < (i + 1) * step; j += 64) { s += ch[j] * ch[j]; c++; } rms.push(Math.sqrt(s / (c || 1))); }
        const top = Math.max(...rms) || 1; LIB.peaks[q] = rms.map(v => +Math.max(0.12, Math.pow(v / top, 0.7)).toFixed(2)); libPeakPaint(q);
      }).catch(() => { LIB.peaks[q] = 1; }).then(next);
  };
  next();
}
let libQT = 0;

function wireLibrary() {
  document.addEventListener("rt-arch", () => { if (UI.page === "assets") renderPage(); });
  PAGES.assets = function () {
    const root = $("#pagebody .lib-root");
    if (root && root.dataset.lang === UI.lang) {   // already on the page: keep the DOM (scroll, focus, loaded thumbs); repaint only if the list changed
      if (libSig(libCollect()) !== LIB.sig) libPaint(true);
      return null;
    }
    LIB.n = LIB_BATCH;
    const zh = UI.lang !== "en";
    return pageHead("assets") + `<div class="lib-root" data-lang="${UI.lang}"><div class="lib-sub"></div>
      <div class="lib-bar"><div class="lib-chips"></div><input type="search" class="lib-q" placeholder="${zh ? "搜文件名或单子…" : "Search file or card…"}" value="${esc(LIB.q)}" aria-label="${zh ? "搜索素材" : "Search assets"}"></div>
      <div class="lib-grid"></div><div class="lib-none empty" hidden>${zh ? "没有符合条件的素材" : "Nothing matches"}</div><div class="lib-more" aria-hidden="true"></div></div>`;
  };
  hooks.push(k => { if (k === "page" && UI.page === "assets") { const g = $("#pagebody .lib-grid"); if (g && !g.childElementCount && g.dataset.shown == null) libPaint(true); } });
  document.addEventListener("click", e => {
    const k = e.target.closest("[data-libk]"); if (k) { LIB.kind = k.dataset.libk; LIB.n = LIB_BATCH; libPaint(true); return; }
    const w = e.target.closest("[data-libw]"); if (w) { LIB.who = w.dataset.libw; LIB.n = LIB_BATCH; libPaint(true); return; }
    if (e.target.closest("[data-libpriv]")) { LIB.priv = !LIB.priv; LIB.n = LIB_BATCH; libPaint(true); }
  });
  document.addEventListener("input", e => { if (!e.target.classList || !e.target.classList.contains("lib-q")) return; clearTimeout(libQT); libQT = setTimeout(() => { LIB.q = e.target.value; LIB.n = LIB_BATCH; libPaint(true); }, 160); });
}

export { LIB, LIB_BATCH, libPriv, libKind, libUrl, libName, libCollect, libSig, libFilter, libWho, libChips, libDay, libTile, libAppend, libPaint, libMore, libObserve, libPeakPaint, libPeaks, libQT, wireLibrary };
