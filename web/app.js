// Underthread dashboard. Polls /api/state, renders, posts your clicks to /api/action.
import { $, DRAFT, LS } from "./core/util.js";
import { PLAT, ago, agoH, rowLabel, srvT, stageLabel, t, titleEn, tplEn, tplSeed, when, whenH, whoName } from "./core/i18n.js";
import { ARCH, LP, REV, ST, UI, archAll, archIx, archTitle, busy, byAct, grpOf, histAll, items, lpAbort, lpLoop, mailAll, mailOlder, mailUnread, onYou, onYouCard, poll, qBadge, queueOf, snapBoot, snoozed } from "./core/store.js";
import { agent, agents, aname, atitle, av, avatarUrl, hasArt, ringOnce, tintOf, wireAv, wsheet } from "./core/av.js";
import { api, closeModal, fmtSize, modalReject, openModal, postAct, toast, upload, utEmpty } from "./core/ui.js";
import { go, pageAlias, route } from "./core/router.js";
import { wireCardRef } from "./views/cardref.js";
import { chatAtt, chatList, renderChat, setChat } from "./views/chat.js";
import { DW, backItem, closeItem, drawerAtt, dwSig, openItem, renderDrawer, seekChat, seekItem, snzLine, snzMenu, snzText } from "./views/drawer.js";
import { TOOL_EXTRA, fmtTok, renderHeader, renderTool, roleUsage, ruHTML, soulHTML, toolBadge, toolLine, toolWhat, usage, wireHeader } from "./views/header.js";
import { SET_TABS, counts, renderLeft, rtFull, rtShort, schToday, wireLeft } from "./views/left.js";
import { MOBQ, actRow, inkEb } from "./views/pages/common.js";
import { phaseFree, renderPage, wirePages, wirePages2 } from "./views/pages/index.js";
import { wireLibrary } from "./views/pages/library.js";
import { RV, askGroups, askGuard, askLeft, awaitsUser, decisions, grpHTML, okDone, okLabel, openAsks, rvApprove, rvCanApprove } from "./views/pages/review.js";
import { wireSchedule } from "./views/pages/schedule.js";
import { TEXTURES, setTab, stageSub, themeMode, wireSettings } from "./views/pages/settings.js";
import { ghLabel, ghOpen, loadHealth, modalStatus, statusRows, statusSummary, verCheck, wireStatus } from "./views/status.js";
import { renderTicker, wireTicker } from "./views/ticker.js";
wireAv();
// ===== t-m2-a ②: number roll. Runs only when the value really changes: the last value shown is kept in memory per key (NV), not read back from the DOM,
// so a poll or a rebuilt node with the same value does nothing. Each changed digit gets a one-glyph window: the old one slides out, the new one slides in
// (up when the number grows, down when it shrinks), transform + opacity only, WAAPI ~420 ms; the spans are replaced by plain text when it ends.
// First paint, non-integers, a hidden page and prefers-reduced-motion just swap the text.
const NV = {}, RMQ = matchMedia("(prefers-reduced-motion: reduce)");
function roll(el, to, key) {
  if (!el) return; to = String(to);
  const from = key ? NV[key] : el.dataset.nv; if (key) NV[key] = to; el.dataset.nv = to;
  const isN = x => /^\d{1,6}$/.test(x);
  if (from === to) { if (!el._nr && el.textContent !== to) el.textContent = to; return; }
  if (el._nr) { const a = el._nr; el._nr = null; a.forEach(x => x.cancel()); }
  if (from == null || !isN(from) || !isN(to) || RMQ.matches || document.hidden || !el.isConnected) { el.textContent = to; return; }
  const n = Math.max(from.length, to.length), A = from.padStart(n, " "), B = to.padStart(n, " "), up = +to > +from;
  el.innerHTML = [...B].map((c, i) => c === A[i] ? c : `<span class="nr"><span class="nr-o">${A[i].trim()}</span><span class="nr-n">${c.trim()}</span></span>`).join("");
  const o = { duration: 420, easing: "cubic-bezier(.2,.8,.2,1)", fill: "both" }, d = up ? 100 : -100, run = [];
  el.querySelectorAll(".nr").forEach(c => {
    run.push(c.firstChild.animate([{ transform: "translateY(0)", opacity: 1 }, { transform: `translateY(${-d}%)`, opacity: 0 }], o));
    run.push(c.lastChild.animate([{ transform: `translateY(${d}%)`, opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], o));
  });
  el._nr = run;
  Promise.all(run.map(x => x.finished)).then(() => { if (el._nr === run) { el._nr = null; el.textContent = to; } }, () => {});
}
// ===== t-working-item-highlight: an item is "being worked on" only when state.agents[x].status === "working" AND agents[x].item === its id.
// Never guessed from owner / stage: no agents[].item, no highlight. Same --wp wall-clock phase as App.av, so poll re-renders never restart the motion.
// t-now-closed: dashboard-side safety net. A card that is already closed (stage done) never shows as being worked on, whoever still holds it;
// the manager with no live card is "online · watching the inbox": no timer, no progress bar, not counted as working.
const liveItem = a => { const it = a && a.item && (ST.items || []).find(i => i.id === a.item); return it && it.stage !== "done" ? it : null; };
const mgrOnline = a => !!a && a.id === "manager" && a.status === "working" && !liveItem(a);
/* t-ui-fix-r6 R6-08: the one 「在忙」 rule for every count (home header, 此刻在忙, 团队交接, 团队 page, sync pop):
   working, and not the manager merely online (the manager on a live card counts) */
const isBusy = a => !!a && a.enabled !== false && a.status === "working" && !mgrOnline(a);
// t-typing-fix: the typing dots (desktop renderChat + mobile.js syncTyping). Only while the agent really works on a card (not the manager's
// online-only heartbeat) and you spoke last, and never more than 10 min after your last message (the minute sweep below drops a stale bubble).
const TYPING_MAX = 10 * 60e3, lastT = m => Date.parse(m && m.t) || 0;
const typingOn = (a, last) => !!a && a.status === "working" && !mgrOnline(a) && !!last && last.who === "me" && (!lastT(last) || Date.now() - lastT(last) < TYPING_MAX);
const typingUntil = last => lastT(last) ? lastT(last) + TYPING_MAX : "";
const MGR_ON = () => UI.lang === "en" ? "Online · watching the inbox" : "在线 · 看着信箱";
const MGR_WATCH = () => UI.lang === "en" ? "Watching the inbox" : "看着信箱";   /* t-hdr-trim ②1: the desktop rail already says 在线 after the name */
const workersOf = id => id ? Object.values(ST.agents || {}).filter(a => a.status === "working" && a.item === id && liveItem(a)).sort((a, b) => (a.order ?? 99) - (b.order ?? 99)) : [];
const wkP = () => `--wp:${(-(Date.now() % 4000) / 1000).toFixed(3)}s`;
function wkDur(iso) {
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso)) / 6e4)), en = UI.lang === "en";
  if (m < 60) return en ? `${Math.max(1, m)}m` : `${Math.max(1, m)} 分钟`;
  const h = Math.floor(m / 60), r = String(m % 60).padStart(2, "0");
  return en ? `${h}h ${r}m` : `${h} 时 ${r} 分`;
}
function wkTag(ws, cls = "") {   // [ringed avatars] 「名字 处理中 · 12 分钟」 (elapsed only when `since` exists)
  if (!ws.length) return "";
  const since = ws.map(a => a.since).filter(Boolean).sort()[0], nm = ws.map(a => aname(a)).join(UI.lang === "en" ? ", " : "、");
  return `<span class="wk-tag ${cls}" style="${wkP()}"><span class="wk-avs">${ringOnce(() => ws.map(a => av(a, "sm")).join(""))}</span><span class="wk-tx"><b>${esc(nm)}</b> ${UI.lang === "en" ? "on it" : "处理中"}${since ? ` · <time class="wk-el" data-since="${esc(since)}">${wkDur(since)}</time>` : ""}</span></span>`;
}
const wkFx = ws => ws.length ? `<i class="wk-fx" aria-hidden="true"><i class="wk-bg"></i></i>` : "";   /* t-edge-glow-off (11-04): the 2px left rail with the flowing highlight (.wk-bar) is gone; the breathing tint and the 处理中 tag stay */
const wkAttr = ws => ws.length ? ` style="${wkP()}"` : "";
function dcDur(iso) {   // 此刻 card format: 「12 分钟」/「1 小时 5 分」 (t-now-elapsed: was computed once per render, so it froze between state revs)
  const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 6e4)), zh = UI.lang !== "en";
  return m < 60 ? m + (zh ? " 分钟" : " min") : Math.floor(m / 60) + (zh ? " 小时 " : " h ") + (m % 60) + (zh ? " 分" : " min");
}
setInterval(() => { document.querySelectorAll(".wk-el[data-since]").forEach(el => { const v = el.dataset.fmt === "dc" ? dcDur(el.dataset.since) : wkDur(el.dataset.since); if (el.textContent !== v) el.textContent = v; });
  document.querySelectorAll("time.rel[data-t]").forEach(el => { const v = el.dataset.rel === "ago" ? ago(el.dataset.t) : when(el.dataset.t); if (el.textContent !== v) el.textContent = v; });
}, 20000);   // elapsed ticks between polls (render only runs on a new rev)
// Attachments on messages and timeline entries: images inline, footage playable, everything else a link.
// ===== t-voice-memo: voice memos render as a play bar. One shared Audio for the whole page, so a re-render
// (a new chat message rebuilds the box) never cuts playback: bars are re-bound to it by path (data-vm).
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
document.addEventListener("dragstart", e => { const a = e.target && e.target.closest && e.target.closest("[data-lib-path]"); if (a) { e.dataTransfer.setData(LIB_MIME, a.dataset.libPath); e.dataTransfer.effectAllowed = "copy"; } });
document.addEventListener("dragend", () => document.querySelectorAll("textarea.lib-drop").forEach(t => t.dispatchEvent(new Event("dragleave"))));
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

function render() {
  document.documentElement.dataset.theme = UI.theme;
  document.documentElement.lang = UI.lang === "en" ? "en" : "zh";
  renderChrome(); renderLeft(); renderPage(); if (UI.item && dwSig() !== DW.sig) renderDrawer(); renderChat(); renderMailbox();   // t-perf E: an unchanged open card is not rebuilt
  appBadge();
  hooks.forEach(f => f("all"));
  vmSync();
}
// t-app-badge: the installed app's icon badge (iPhone home screen, Mac Dock) = 「等你拍板」 = the nav's 审核 count. server.py pending_count() mirrors it for pushes.
// Only touched when the number changes; unsupported browsers and a missing permission are ignored.
function appBadge() {
  if (!("setAppBadge" in navigator)) return;
  const n = counts().review;
  if (n === appBadge.last) return;
  appBadge.last = n;
  (n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => { appBadge.last = undefined; });
}
const hooks = [];
function renderChrome() { renderHeader(); renderTool(); renderTicker(); }
wireHeader();
wireTicker();
wireLeft();
function mailGroups(list) {   // newest first in, newest first out; entries of one item (or one agent's direct replies) fold into one row
  const gs = [], by = {};
  for (const m of list) {
    const k = m.item ? "i:" + m.item : "a:" + (m.agent || "");
    if (!by[k]) { by[k] = { last: m, ms: [] }; gs.push(by[k]); }
    by[k].ms.push(m);
  }
  return gs;
}
// t-web-audit 07: previews are plain text: no markdown marks, no "管家:" prefix (the sender is already on the row)
// t-chat-table: in a one-line preview a Markdown table becomes 「〔表格〕a b · c d …」 (the header row and |---| line are dropped)
function tablePv(s) {
  const L = String(s || "").split("\n"), out = []; let i = 0;
  const isRow = l => /^\s*\|.*\|?\s*$/.test(l) && (l.match(/\|/g) || []).length >= 2, isSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  while (i < L.length) {
    if (isRow(L[i]) && i + 1 < L.length && isSep(L[i + 1])) {
      const rows = []; i += 2;
      while (i < L.length && isRow(L[i])) { rows.push(L[i].trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim()).filter(Boolean).join(" ")); i++; }
      out.push((UI.lang === "en" ? "[table] " : "〔表格〕") + rows.join(" · "));
    } else out.push(L[i++]);
  }
  return out.join("\n");
}
function mailPv(s, a) {   // t-chat-table: phones use it too now (mail rows + 动态 rows)
  s = tablePv(srvT(s)).replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1").replace(/`([^`]+)`/g, "$1")
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+)/gm, "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();   /* t-ri1108-a P1: a cut-off bold leaves a lone ** */
  for (const n of ["管家", "manager", a && aname(a), a && a.id].filter(Boolean)) {
    const re = new RegExp("^" + n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*[:：]\\s*");
    if (re.test(s)) { s = s.replace(re, ""); break; }
  }
  return s;
}
// t-web-audit 11: runs of manager heartbeats fold into one dim row; bare "agent <id>" lines are hidden
/* t-ui-fix-r2 audit P2-5: the zh log showed raw action words (reply on t-…, upsert t-… [doing] …, mail_read). Display-time only; stored text is unchanged. */
const LOG_ZH = [[/^reply on \S+$/, () => "在卡上回复"], [/^upsert \S+ \[(\w+)\] (.*)$/, m => `更新卡片 · ${stageLabel(m[1])} · ${m[2]}`], [/^mail_read$/, () => "读了信"],
  [/^answer \S+$/, () => "回答了问题"], [/^approve \S+$/, () => "批准"], [/^comment \S+$/, () => "评论"], [/^ask \w+: (.*)$/, m => `提问：${m[1]}`], [/^ask-close \w+$/, () => "问题已关闭"],
  [/^lesson$/, () => "规则提议"], [/^chat$/, () => "发消息"], [/^done \S+$/, () => "关单"], [/^dm$/, () => "私信"]];
function logText(s) { s = String(s ?? ""); if (UI.lang === "en") return srvT(s); for (const [re, fn] of LOG_ZH) { const m = re.exec(s); if (m) return fn(m); } return s; }
function logRows(list) {
  if (!UI.logAgent) list = list.filter(l => l.text !== "mail_read");   /* t-ui-fix-r2 audit P2-5: 全部 hides the ~half of rows that were 「我 · mail_read」; the 我 filter still lists them */
  if (MOBQ.matches) return list.map(l => ({ l }));   // desktop only for now
  const HB = /^(Online: watching the inbox|在线：盯收件箱)/, AID = /^agent [0-9a-f]{12,}$/, out = [];
  for (const l of list) {
    const x = l.text || ""; if (AID.test(x)) continue;
    if (HB.test(x)) { const p = out[out.length - 1]; if (p && p.hb && p.l.agent === l.agent) { p.n++; continue; } out.push({ l, hb: true, n: 1 }); }
    else out.push({ l });
  }
  return out;
}
/* t-ri1104-p4: a 「待审核: <title>」 mail only repeats line 1 (the title) and goes stale once the card moves on.
   Phone 动态 rows of such mail show the card's latest thread line instead (who said it + text, max 60 chars).
   Generic 验收 / 完成 stamps and stage events are skipped; with no line left: 已关单 / 等你验收 / the stage label. Display only. */
const REV_MAIL = /^待审核\s*[:：]/;
function cardLine(it, rowA) {   /* t-ri1108-a P1: rowA = the row's own speaker; no name prefix when it is the same person */
  const en = UI.lang === "en", th = (it.thread || []).filter(x => x.kind !== "event" && x.kind !== "approve" && x.kind !== "done" && String(x.text || "").trim());
  const x = th[th.length - 1];
  if (!x) return it.stage === "done" ? (en ? "Closed" : "已关单") : it.stage === "review" ? (en ? "Waiting for your review" : "等你验收") : stageLabel(it.stage);
  const who = x.who === "me" ? (en ? "You" : "你") : x.who ? aname(agent(x.who)) : "";
  let s = mailPv(x.kind && x.kind !== "msg" ? srvT(x.text, true) : x.text, x.who && x.who !== "me" ? agent(x.who) : null);   /* t-i18n-b: 驳回 · … lines */
  if ([...s].length > 60) s = [...s].slice(0, 60).join("") + "…";
  return who && !(rowA && x.who === rowA.id) ? who + (en ? ": " : "：") + s : s;
}
/* t-ri1114-a P1: a manager 「日报 · <date>」 update names a report; same match as server.py _mail_target (push taps) */
function mailRep(m) {
  if (!m || m.item || m.agent !== "manager" || m.kind !== "update") return null;
  const r = (ST.reports || []).find(x => `${x.title} · ${x.date}` === m.text); return r ? r.id : null;
}
function mailRow(g) {
  const m = g.last, it = m.item ? ST.items.find(i => i.id === m.item) : null, a = m.agent ? agent(m.agent) : null;
  const unread = g.ms.some(x => !x.read);
  return actRow({ attr: `data-mail="${m.id}" data-mailids="${g.ms.map(x => x.id).join(",")}"`, av: a ? av(a, "", m.item) : av("me"), ws: it ? workersOf(it.id) : [], unread,
    name: a ? aname(a) : whoName("me"), title: it ? it.title : archTitle(m.item), time: agoH(m.t), preview: REV_MAIL.test(m.text || "") && it ? cardLine(it, a) : mailPv(m.text, a),
    chip: it ? rowLabel(it) : (m.kind === "reply" ? t("replies") : t("updates")), n: g.ms.length });
}
document.addEventListener("click", e => {
  const a = e.target.closest("[data-arch]"); if (a) { e.stopPropagation(); api("archive", { item: a.dataset.arch }); }
  const d = e.target.closest("[data-quickdone]"); if (d) { e.stopPropagation(); const qid = d.dataset.quickdone; askGuard(qid, "done", skip => api("done", { item: qid, skip_asks: skip || undefined })); }
});
wirePages();
wireSettings();
// ---------- ui1-C: mailbox = drop-down panel under the header (the full page stays reachable via "view all") ----------
function mailFiltered(n) {
  const f = UI.mailFilter;
  const L = mailAll().filter(m => f === "all" || (f === "unread" ? !m.read : f === "urgent" ? (m.item && (ST.items.find(i => i.id === m.item) || {}).category === "urgent") : m.kind === f));
  if (L.length < n && f !== "unread") mailOlder();   /* ri1105-P4: a filter that runs short fetches the older read letters once */
  return L.slice(-n).reverse();
}
const MB = { ct: null, open: false };
function mailboxEls() {
  let box = $("#mailbox"), sc = $("#mailscrim");
  if (!box) {
    sc = document.createElement("div"); sc.id = "mailscrim"; sc.hidden = true; sc.addEventListener("click", () => closeMailbox());
    box = document.createElement("div"); box.id = "mailbox"; box.hidden = true; box.setAttribute("role", "dialog");
    document.body.append(sc, box);
  }
  return { box, sc };
}
/* t-ri1114-a P2: in the drop-down, letters next to each other from one card and one person are one row (newest first).
   A 「待审核: 卡名」 letter only repeats the title: the row is labelled 待审核 and shows the reply text instead. Letters without a card stay one per row. */
function mbGroups(list) {
  const gs = [];
  for (const m of list) {
    const g = gs[gs.length - 1];
    if (g && m.item && g.last.item === m.item && g.last.agent === m.agent) g.ms.push(m); else gs.push({ last: m, ms: [m] });
  }
  for (const g of gs) { g.rv = g.ms.some(x => REV_MAIL.test(x.text || "")); g.body = g.ms.find(x => !REV_MAIL.test(x.text || "")) || g.last; }
  return gs;
}
function renderMailbox(enter) {
  if (!MB.open) return;
  const { box } = mailboxEls(), f = UI.mailFilter;
  const unread = mailUnread();
  const fs = [["all", t("all")], ["unread", t("unread")], ["reply", t("replies")], ["update", t("updates")], ["urgent", t("urgent")]];
  const kindName = { reply: t("replies"), update: t("updates") };
  const list = mbGroups(mailFiltered(40)), en = UI.lang === "en";
  const keep = $(".mb-list", box) ? $(".mb-list", box).scrollTop : 0;
  box.innerHTML = `<div class="mb-h"><div class="mb-t"><b>${t("mail")}</b><span>${UI.lang === "en" ? `${unread} unread` : `${unread} 条未读`}</span></div><button class="btn-s" data-mailall>${t("mark_all")}</button></div>
    <div class="mb-f"><div class="seg" data-seg="mailbox">${fs.map(([k, n]) => `<button class="seg-i ${f === k ? "on" : ""}" data-mailf="${k}">${n}</button>`).join("")}</div></div>
    <div class="mb-list ${enter ? "mb-enter" : ""}">${list.length ? list.map((g, i) => { const m = g.body, rv = g.rv, n = g.ms.length;
      return `<div class="mb-i ${g.ms.some(x => !x.read) ? "unread" : ""}" data-mail="${g.last.id}"${n > 1 ? ` data-mailids="${g.ms.map(x => x.id).join(",")}"` : ""} style="--i:${Math.min(i, 8)}">
      ${m.agent ? av(agent(m.agent), "sm") : "<span class=\"av sm\"></span>"}<div class="mb-b"><div class="mb-m"><b>${m.agent ? esc(aname(agent(m.agent))) : ""}</b>${rv ? `<i class="ri14-rv">${en ? "Review" : "待审核"}</i>` : kindName[m.kind] ? `<i>${esc(kindName[m.kind])}</i>` : ""}<span>${whenH(g.last.t)}${n > 1 ? (en ? ` · ${n}` : ` · ${n} 条`) : ""}</span></div><div class="mb-x">${esc(mailPv(m.text, m.agent && agent(m.agent)))}</div></div><span class="u"></span></div>`; }).join("") : utEmpty(t("empty"))}</div>
    <button class="mb-all" data-mbfull>${UI.lang === "en" ? "View all" : "查看全部"} →</button>`;
  $(".mb-list", box).scrollTop = keep;
  if (enter) setTimeout(() => { const l = $(".mb-list", box); l && l.classList.remove("mb-enter"); }, 700);
}
function openMailbox() {
  const { box, sc } = mailboxEls(); clearTimeout(MB.ct);
  const b = $('[data-h="mail"]'), r = b ? b.getBoundingClientRect() : { bottom: 56 };
  const hb = $("#top").getBoundingClientRect().bottom;
  document.documentElement.style.setProperty("--mb-top", Math.round(Math.max(hb, 0)) + "px");
  MB.open = true; box.hidden = false; sc.hidden = false; renderMailbox(true);
  void box.offsetWidth; box.classList.add("open"); sc.classList.add("open"); document.body.classList.add("mailopen");
}
function closeMailbox() {
  if (!MB.open) return; MB.open = false;
  const { box, sc } = mailboxEls(); box.classList.remove("open"); sc.classList.remove("open"); document.body.classList.remove("mailopen");
  clearTimeout(MB.ct); MB.ct = setTimeout(() => { if (MB.open) return; box.hidden = true; sc.hidden = true; box.innerHTML = ""; }, 200);
}
/* t-ui-fix-r2 B11: any modal (系统状态, 关单, role files, voice…) closes the mailbox drop-down first, so they never stack and one Esc is enough */
{ const mo = document.getElementById("modal"); if (mo) new MutationObserver(() => { if (!mo.hidden && MB.open) closeMailbox(); }).observe(mo, { attributes: true, attributeFilter: ["hidden"] }); }
document.addEventListener("click", e => {
  if (e.target.closest("[data-mbfull]")) { closeMailbox(); go("mail"); return; }
  if (MB.open && e.target.closest("#mailbox [data-mail]")) setTimeout(closeMailbox, 0);
});
wireSchedule();
wireLibrary();
wireCardRef();

// t-office-d1-s12: the four numbers of the home strip (they also drive the list filter UI.hf on phones)
/* ri1107-P3: 近 7 天交付 = done cards closed since 00:00 six days ago (7 calendar days incl. today), the same as the widget home's bar chart */
function wkFrom() { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 6); return d.getTime(); }
function homeCounts() {   // t-imp-p1: review = 等你拍板 (review items + plans / questions parked in waiting)
  const its = items(), wk = wkFrom(), rev = its.filter(i => onYouCard(i) && i.id !== RV.pending);
  return { review: rev.length + its.filter(i => awaitsUser(i) && !busy(i) && !snoozed(i)).length + newReplies().length, doing: its.filter(i => grpOf(i) === "doing").length, todo: its.filter(i => grpOf(i) === "todo").length,
    week: its.filter(i => i.stage === "done" && i.closed && new Date(i.closed) > wk).length, oldest: rev.length ? Math.min(...rev.map(i => new Date(i.activity || i.updated))) : null };
}
// ===== t-home-newreplies: 「新回复」 = the server's reply mail (kind "reply", written for every msg / reply an agent posts on a card; log lines and events
// are not mailed) that is still unread, grouped by card. Read flags live on the server (mail_read), so phone and desktop agree.
// Opening a card marks its replies read; the first unread reply is where the detail opens.
// t-review-unread: no 3-day window any more (a reply counts until it is read), and a card already listed as on you (review row / decision row)
// or done / archived / snoozed / held for approve-undo is left out, so no card shows twice. These cards are added to every 等你拍板 count
// (homeCounts, counts, mobile tab dot, server pending_count): the count and what you can see stay the same.
const nrMail = id => (ST.mail || []).filter(m => m.kind === "reply" && !m.read && m.item && m.item !== "None" && (!id || m.item === id));
const nrCard = it => !!it && !it.archived && it.stage !== "done" && !snoozed(it) && !onYou(it) && it.id !== RV.pending;
function newReplies() {
  const by = {}; nrMail().forEach(m => { const it = (ST.items || []).find(i => i.id === m.item); if (nrCard(it)) (by[m.item] = by[m.item] || { it, ms: [] }).ms.push(m); });
  return Object.values(by).map(g => (g.ms.sort((a, b) => a.t.localeCompare(b.t)), g)).sort((a, b) => b.ms[b.ms.length - 1].t.localeCompare(a.ms[a.ms.length - 1].t));
}
const nrDot = id => nrMail(id).length ? `<i class="nr-dot" title="${UI.lang === "en" ? "New reply" : "有新回复"}"></i>` : "";
/* t-ri1108-a P1: was "drop any 1-8 char prefix before a colon, keep the first sentence": that ate 「我的建议：」-style openings and kept **.
   mailPv strips Markdown and only a real speaker prefix; the row clamps the rest. */
const nrFirst = (t, a) => mailPv(t, a);
function nrBlock() {
  const g = newReplies(); if (!g.length) return "";
  const zh = UI.lang !== "en", n = g.length, shown = g.slice(0, 4);   // t-review-unread: n = cards, the same unit as the badges
  return `<div class="nr"><div class="nr-h"><b>${zh ? "新回复" : "New replies"}</b><small>${n}</small><span class="sp"></span><button class="nr-all" data-nr-all>${zh ? "全部标为已读" : "Mark all read"}</button></div>` +
    shown.map(({ it, ms }) => { const m = ms[ms.length - 1], a = agent(m.agent);
      return `<div class="nr-r" role="link" tabindex="0" data-nr="${esc(it.id)}">${av(a)}${ms.length > 1 ? `<span class="nr-n">${ms.length}</span>` : ""}<b>${esc(aname(a))} <i>· ${esc(it.title)}</i></b><time>${agoH(m.t)}</time><p>${esc(nrFirst(m.text, a))}</p><i class="nr-dot"></i></div>`; }).join("") +
    (g.length > shown.length ? `<button class="nr-more" data-h="mail">${zh ? `还有 ${g.length - shown.length} 张卡有新回复 · 去信箱` : `${g.length - shown.length} more cards · open mailbox`}</button>` : "") + `</div>`;
}
// r-improve-1102 P3: read marks shared through the server. A chat / DM message is mirrored into the mailbox (kind reply, no card); reading the thread
// on any device marks those mails read, and a thread counts as read up to the newest mirrored mail that is read. Opening a card reads all of its
// mail, and mail of a closed card is read once seen here (only mail_read, which already existed: no server change).
const chatMail = id => (ST.mail || []).filter(m => m.kind === "reply" && (!m.item || m.item === "None") && m.agent === id);
/* t-ri1113-a P1: the mailbox copies slide out of the poll window (300 letters) and out of the 1500 kept, so the server also keeps how far each
   chat was read (meta.chat_seen, only ever moves forward). Opening a thread reports it (chatMailRead below); a fresh browser starts from there. */
const chatSeenSrv = id => (((ST.meta || {}).chat_seen) || {})[id] || "";
const srvSeen = id => chatMail(id).reduce((t, m) => m.read && m.t > t ? m.t : t, chatSeenSrv(id));
const seenOf = id => { const a = (UI.seen || {})["chat." + id] || "", b = srvSeen(id); return a > b ? a : b; };
/* t-ri1104-p2: the one unread rule for every dot and number (chat roster, TEAM rows, phone list + tab bar, office): messages from them newer than what you have read, server read marks included */
const unreadOf = id => { const s = seenOf(id); return chatList(id).filter(m => m.who !== "me" && m.t > s).length; };
const unreadTag = n => n > 99 ? "99+" : String(n);
function chatMailRead(id, upto) {
  const ids = chatMail(id).filter(m => !m.read && m.t <= upto).map(m => m.id); if (ids.length) nrRead(ids);
  if (upto && ST.meta && upto > chatSeenSrv(id)) { (ST.meta.chat_seen = ST.meta.chat_seen || {})[id] = upto; postAct("chat_seen", { agent: id, t: upto }).catch(() => { }); }   /* t-ri1113-a P1: local first, the next poll brings the server copy; postAct = no error toast, no extra poll */
}
function itemMailRead(id) { const ids = (ST.mail || []).filter(m => !m.read && m.item === id).map(m => m.id); if (ids.length) nrRead(ids); }
function doneMailRead() {
  const done = new Set((ST.items || []).filter(i => i.stage === "done" || i.archived).map(i => i.id)); archIx().forEach(x => done.add(x[0]));   // t-perf A
  const ids = (ST.mail || []).filter(m => !m.read && m.item && done.has(m.item)).map(m => m.id); if (ids.length) nrRead(ids);
}
function nrRead(ids) { if (!ids.length) return; let k = 0; (ST.mail || []).forEach(m => { if (ids.includes(m.id)) { if (!m.read) k++; m.read = true; } }); if (k && ST.meta && ST.meta.mail_unread != null) ST.meta.mail_unread = Math.max(0, ST.meta.mail_unread - k); api("mail_read", { ids }).catch(() => { }); }   /* ri1105-P4: the pill count drops at once too */
wirePages2();
wireStatus();

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

// ---------- API for the mobile layer (mobile.js) ----------
window.App = {
  okLabel, okDone, askLeft, openAsks: it => openAsks(it),   // t-btn-names
  askGroups: l => askGroups(l), grpHTML: (g, c) => grpHTML(g, c),   /* t-ri1113-a P3 */
  rtShort, rtFull, schToday,   /* t-ri1109-a: routine names, shared with widgets.js; t-ri1110-a P2: schToday */
  utEmpty: (text, cls, h) => utEmpty(text, cls, h),   /* t-thread-motif ④ (widgets.js, palette.js, mobile.js) */
  rvApprove: id => rvApprove(id, null), rvCanApprove: it => rvCanApprove(it), awaitsUser: it => awaitsUser(it), busy: it => busy(it), onYou: it => onYou(it), onYouCard: it => onYouCard(it), grpOf: it => grpOf(it), newReplies: () => newReplies(), nrDot: id => nrDot(id), decisions: () => decisions(),   // t-imp-p5 (palette)
  /* t-chrome-badge (home.js .hd-tool) */
  toolLine: w => toolLine(w), toolBadge: a => toolBadge(a), toolWhat: a => toolWhat(a), addToolExtra: fn => { if (!TOOL_EXTRA.includes(fn)) TOOL_EXTRA.push(fn); }, ext: window.UTExt,   /* S8: App.ext = web/ext.js */
  wsheet: (a, sz) => wsheet(a, sz),   /* t-chibi-anim (home.js .hd-mini / .dp-uti) */
  hasArt: (a, k) => hasArt(a, k), tintOf: a => tintOf(a),   /* t-hr-registry (home.js, widgets.js) */
  UI, get ST() { return ST; }, roll, modalStatus: () => modalStatus(), ghOpen: () => ghOpen(), ghLabel: () => ghLabel(), statusSummary: () => statusSummary(statusRows()), loadHealth: a => loadHealth(a), refreshPage: () => renderPage(), phaseFree, avatarUrl, t, items, agent, aname, atitle, av, when, whenH, agoH, ago, byAct, PLAT, stageLabel,
  refresh: async () => { await poll(true); return !UI.down; },   // t-m2-c ④ pull-to-refresh: a forced full fetch; false = the server did not answer
  tablePv: s => tablePv(s),   // t-chat-table (mobile.js chat list preview)
  mailPv: (s, a) => mailPv(s, a),   /* t-ri1108-a P1 (widgets.js 新回复 rows) */
  srvT: (s, th) => srvT(s, th), titleEn: (s, it) => titleEn(s, it), tplSeed: d => tplSeed(d), tplEn: (j, v) => tplEn(j, v),   /* t-i18n-c (market.js) */   /* t-i18n-b: server-written zh -> en at display (transfer.js, market.js) */
  verCheck: () => verCheck(true), attachPick: p => attachPick(p),   // t-lib-attach (viewer.js)   // t-new-ver (tests)
  queueOf: id => queueOf(id), qBadge: (id, small) => qBadge(id, small),   /* t-agent-queue */ seenOf: id => seenOf(id), unreadOf: id => unreadOf(id),   /* t-ri1104-p2 */ chatMailRead: (id, t) => chatMailRead(id, t),   /* r-improve-1102 P3 (was swallowed by a // comment until 11-04) */   /* t-home-applike (palette) */
  draft: k => DRAFT.get(k), liveItem: a => liveItem(a), mgrOnline: a => mgrOnline(a), isBusy: a => isBusy(a), /* t-ui-fix-r6 R6-08 */ typingOn: (a, l) => typingOn(a, l), typingUntil: l => typingUntil(l),   // t-now-closed (home.js hero, office.js bubble)   // t-draft-keep (mobile.js chat list marks [草稿])
  go: p => go(p), openModal: (h, f) => openModal(h, f), closeModal: () => closeModal(), renderPage: () => renderPage(),   /* t-hm-build */ openItem: id => openItem(id), seekItem: (id, sp) => seekItem(id, sp), seekChat: (t, q) => seekChat(t, q),   /* t-ri1103-p5 */ closeItem: () => closeItem(), backItem: () => backItem(), setChat: id => setChat(id), api: (k, b) => api(k, b), toast: (m, e) => toast(m, e),
  rejectItem(id) { openItem(id); modalReject(); }, on: fn => hooks.push(fn), inkEb, route: (P, via) => route(P, via),
  snoozed: it => snoozed(it), snzMenu: (id, anchor, done) => snzMenu(id, anchor, done), snzLine: () => snzLine(), snzText: it => snzText(it),   /* ri1103-P2 */
  usage: () => usage(), roleUsage: () => roleUsage(), ruHTML: (n, o) => ruHTML(n, o), soulHTML: () => soulHTML(), fmtTok,   /* t-home-usage */
  themeMode: () => themeMode(), setTab: k => setTab(k),   /* t-settings-tab */
  stageSub: (en, ut) => stageSub(en, ut),   /* t-theme-ut */
  textures: () => TEXTURES.map(x => x[0]),   /* t-theme-knit (mobile.js texSet) */
  archAll: () => archAll(), archList: () => ARCH.all, archIx: () => archIx(),   /* t-perf A (palette.js search) */
  chatList: id => chatList(id), histAll: () => histAll(), mailUnread: () => mailUnread(), mailAll: () => mailAll(),   /* ri1105-P4 (palette.js, mobile.js) */
};

// ---------- boot ----------
// deep links: #page=board  #item=<id>  #theme=light  #lang=en
const H = new URLSearchParams(location.hash.slice(1));
if (H.get("page")) UI.page = pageAlias(H.get("page"));
if (H.get("tab") && SET_TABS.includes(H.get("tab"))) UI.setTab = H.get("tab");   // t-settings-tab: #page=settings&tab=system
if (H.get("theme")) UI.theme = H.get("theme");
LS.set("home3", "widgets");   /* t-home-style-trim: old saved dense / app / classic land on widgets; #home= links are ignored */
if (H.get("lang")) UI.lang = H.get("lang");
if (H.get("fold")) UI.chatFold = H.get("fold") === "1";
document.documentElement.dataset.theme = UI.theme;
/* t-ui-fix-r3 R3-07: the t-visual-ink empty-state art probe (/work/t-visual-art/empty-*.png) is gone: the art was never made, so every fresh browser got 4 x 404. Empty states stay typographic; skin-ink.css keeps its unused --es-* slot. */
snapBoot();
poll(true).then(() => {
  if (!poll.entered) window.FX && FX.enter($("#pagebody"));
  if (H.get("item") || H.get("dm") || H.get("rep") || H.get("push")) { const r = route(H, "cold"); document.dispatchEvent(new CustomEvent("rt:routed", { detail: { via: "cold", result: r, push: H.get("push") } })); }
});
/* t-power-save: a hidden tab polls every 30 s instead of 2.5 s, and refreshes once the moment it is visible again */
let pollAt = Date.now();
setInterval(() => { if (LP.run || LP.hold) return; if (!document.hidden && REV != null && !UI.fail) { lpLoop(); return; } if (document.hidden && Date.now() - pollAt < 30000) return; pollAt = Date.now(); poll(); }, 2500);   // ri1105-P5: the timer only runs while long polling is off
document.addEventListener("visibilitychange", () => { if (!document.hidden) { pollAt = Date.now(); poll(); } else lpAbort(); });   // poll() cancels a stale wait and restarts the long poll after it
setInterval(() => { if (ST) { renderLeft(); renderTool(); } document.querySelectorAll(".m-typing[data-until]").forEach(b => { if (b.dataset.until && Date.now() > +b.dataset.until) b.remove(); }); }, 60000);   // t-typing-fix: stale typing dots go even without a poll change

/* ===== ui4: segmented switch (.seg) — sliding indicator for filters. Pure presentation: finds .seg containers after any render,
   measures the .on item and slides an <i.seg-ind> from where the previous render left it. No filtering logic touched. ===== */
(() => {
  const POS = {}, reduce = matchMedia("(prefers-reduced-motion: reduce)");
  function sync(seg, force) {
    const on = seg.querySelector(".seg-i.on"), key = seg.dataset.seg || "";
    let ind = seg.querySelector(".seg-ind");
    if (RO && !seg._ro) { seg._ro = 1; RO.observe(seg); }   /* t-m-ut-white: see RO below */
    if (!ind) { ind = document.createElement("i"); ind.className = "seg-ind"; ind.setAttribute("aria-hidden", "true"); seg.prepend(ind); }
    if (!on || !on.offsetWidth) { ind.style.opacity = 0; return false; }
    const x = on.offsetLeft, w = on.offsetWidth, prev = POS[key];
    const set = (px, pw) => { ind.style.width = pw + "px"; ind.style.transform = `translateX(${px}px)`; };
    ind.style.opacity = 1;
    if (prev && !force && !reduce.matches && (prev.x !== x || prev.w !== w)) {
      ind.style.transition = "none"; set(prev.x, prev.w); void ind.offsetWidth; ind.style.transition = ""; set(x, w);
    } else { ind.style.transition = "none"; set(x, w); void ind.offsetWidth; ind.style.transition = ""; }
    POS[key] = { x, w };
    // keep the selected item in view when the track scrolls (phone / narrow dropdown)
    if (seg.scrollWidth > seg.clientWidth + 1) {
      const target = Math.max(0, x + w / 2 - seg.clientWidth / 2);
      seg.scrollTo({ left: target, behavior: prev && !reduce.matches ? "smooth" : "auto" });
    }
    return true;
  }
  let q = 0;
  function run(force) { cancelAnimationFrame(q); q = requestAnimationFrame(() => document.querySelectorAll(".seg").forEach(s => { if (force || !s._ui4 || s._ui4 !== s.querySelector(".seg-i.on")) { if (sync(s, force)) s._ui4 = s.querySelector(".seg-i.on"); } })); }
  new MutationObserver(() => run(false)).observe(document.body, { childList: true, subtree: true });
  /* t-m-ut-white: a .seg re-rendered while its tab is hidden (offsetWidth 0) left the indicator at opacity 0, and showing the tab is not a DOM mutation,
     so the selected item stayed light text on a light track. Watch each track's size: hidden -> shown fires and re-syncs it. */
  const RO = typeof ResizeObserver === "function" ? new ResizeObserver(() => run(false)) : null;
  addEventListener("resize", () => run(true));
  document.fonts && document.fonts.ready.then(() => run(true));
  run(false);
})();

export { render, workersOf, renderMailbox, renderChrome, doneMailRead, MB, closeMailbox, attTitle, ATT_IC, attTiles, wireUploads, hooks, typingOn, typingUntil, unreadOf, unreadTag, seenOf, attHTML, chatMailRead, RMQ, ATT, nrMail, nrRead, itemMailRead, wkTag, copyText, liveItem, wkDur, isBusy, NV, roll, openMailbox, newReplies, mgrOnline, MGR_ON, MGR_WATCH, wkAttr, wkFx, nrDot, mailPv, wkFrom, nrBlock, logRows, logText, mailRep, mailFiltered, mailGroups, mailRow, homeCounts, isAudioAtt, fmtDur, vmHTML, vmSync, vmBars, dcDur };
