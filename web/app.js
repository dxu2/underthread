// Underthread dashboard. Polls /api/state, renders, posts your clicks to /api/action.
import { $, DRAFT, LS } from "./core/util.js";
import { CATS, D, PLAT, ago, agoH, dayKey, hm, pad, relH, rowLabel, srvLocal, srvT, stageLabel, t, titleEn, tplEn, tplSeed, when, whenH, whoName } from "./core/i18n.js";
import { ARCH, LP, REV, ST, UI, archAll, archIx, archTitle, busy, byAct, grpOf, histAll, items, lpAbort, lpLoop, mailAll, mailOlder, mailUnread, onYou, onYouCard, poll, qBadge, queueOf, snapBoot, snoozed } from "./core/store.js";
import { aduty, agent, agents, aname, atitle, av, avatarUrl, hasArt, ringOnce, tintOf, wireAv, wsheet } from "./core/av.js";
import { FOCUSABLE, api, closeModal, fmtSize, modalReject, openModal, postAct, refSel, toast, upload, utEmpty } from "./core/ui.js";
import { go, pageAlias, route } from "./core/router.js";
import { wireCardRef } from "./views/cardref.js";
import { NARROWQ, chatAtt, chatList, chatPop, renderChat, setChat, setSrc } from "./views/chat.js";
import { DW, backItem, closeItem, drawerAtt, dwSig, openItem, renderDrawer, seekChat, seekItem, snzLine, snzMenu, snzText } from "./views/drawer.js";
import { MOBQ, actRow, inkEb } from "./views/pages/common.js";
import { phaseFree, renderPage, wirePages, wirePages2 } from "./views/pages/index.js";
import { wireLibrary } from "./views/pages/library.js";
import { isContent } from "./views/pages/pipe.js";
import { RV, askGroups, askGuard, askJump, askLeft, awaitsUser, decisions, grpHTML, okDone, okLabel, openAsks, rvApprove, rvCanApprove, wireReview } from "./views/pages/review.js";
import { wireSchedule } from "./views/pages/schedule.js";
import { TEXTURES, setTab, stageSub, themeMode, wireSettings } from "./views/pages/settings.js";
wireAv();
/* ===== t-chrome-badge: agents[id].tool = the outside tool an agent is driving right now (stateutil set-agent --tool chrome; "" or idle/offline clears it).
   One badge on every avatar (toolBadge, called by av) + one line 「Chrome 使用中 · 谁 · 在做什么」 (toolLine: desktop header #toolbar, phone home .hd-tool).
   Enter/exit motion plays once: TOOL_T keeps when each agent's tool last changed (client clock); only inside that window does the markup carry tl-in / tl-out
   plus a negative animation-delay, so a poll re-render continues the motion instead of replaying it. First sight after page load = no motion.
   No infinite animation here (fx.js would mark one with data-ip anyway), no blinking dot; prefers-reduced-motion turns the motion off in CSS. ===== */
const TOOL_IC = {
  chrome: `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><ellipse cx="8" cy="8" rx="2.6" ry="6.2"/><path d="M1.8 8h12.4"/></svg>`,
  computer: `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.8" y="2.5" width="12.4" height="8.6" rx="1.6"/><path d="M5.5 13.8h5M8 11.1v2.7"/></svg>`,
  _: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.4 2.2a3.4 3.4 0 0 0-3.9 4.5L2.2 11a1.3 1.3 0 0 0 1.8 1.8l4.3-4.3a3.4 3.4 0 0 0 4.5-3.9l-2 2-1.7-.5-.5-1.7z"/></svg>`
};
const toolName = k => k === "chrome" ? "Chrome" : k === "computer" ? (UI.lang === "en" ? "Computer" : "电脑") : String(k);
const toolIc = k => TOOL_IC[k] || TOOL_IC._;
const TOOL_IN = 400, TOOL_OUT = 220, TOOL_STALE = 60 * 60e3, TOOL_T = {};
function toolFx(a) {   /* -> { k: tool now ("" = none), was: tool just cleared, ph: "in" | "out" | "", ms: elapsed } */
  const k = (a && a.tool) || "", r = TOOL_T[a.id], now = Date.now();
  if (!r) TOOL_T[a.id] = { k, was: "", t: 0 };
  else if (r.k !== k) { TOOL_T[a.id] = { k, was: r.k, t: now }; }
  const x = TOOL_T[a.id], ms = now - x.t;
  return { k, was: x.was, ms, ph: k && ms < TOOL_IN ? "in" : !k && x.was && ms < TOOL_OUT ? "out" : "" };
}
const fxStyle = f => f.ph ? ` style="animation-delay:-${Math.round(f.ms)}ms"` : "";
function toolBadge(a) {
  if (!a || !a.id || a.id === "me") return "";
  const f = toolFx(a), k = f.k || (f.ph === "out" ? f.was : "");
  if (!k) return "";
  return `<i class="tl${f.ph ? " tl-" + f.ph : ""}"${fxStyle(f)} title="${esc(toolName(k))} ${UI.lang === "en" ? "in use" : "使用中"}">${toolIc(k)}</i>`;
}
const toolWhat = a => String(a.activity || "").replace(new RegExp("^\\s*" + toolName(a.tool || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*[·:：-]\\s*", "i"), "");
let TOOL_LAST = "";
/* core / local split: an extension (local/web/*.js) adds a button to a tool pill with App.addToolExtra((agent, toolKey, stale) => html) */
const TOOL_EXTRA = [];
function toolLine(where) {   /* where: "d" = desktop header, "m" = phone home */
  const en = UI.lang === "en", list = agents().filter(a => a.enabled !== false);
  const fx = list.map(a => [a, toolFx(a)]), on = fx.filter(([, f]) => f.k);
  if (!on.length) {
    const out = fx.find(([, f]) => f.ph === "out");
    return out && TOOL_LAST ? TOOL_LAST.replace('class="tool-pill', `style="animation-delay:-${Math.round(out[1].ms)}ms" class="tool-pill tp-out`) : (TOOL_LAST = "", "");
  }
  const byK = {}; on.forEach(([a, f]) => (byK[f.k] = byK[f.k] || []).push([a, f]));
  const html = Object.keys(byK).map(k => {
    const g = byK[k], [a, f] = g[0], nm = toolName(k), ent = g.find(([, x]) => x.ph === "in");
    const cls = "tool-pill" + (ent ? " tp-in" : "") + (g.length > 1 ? " warn" : ""), dl = ent ? ` style="animation-delay:-${Math.round(ent[1].ms)}ms"` : "";
    if (g.length > 1) return `<div class="${cls}"${dl} role="status"><span class="ic">${toolIc(k)}</span><b>${esc(nm)} ${en ? "conflict" : "冲突"}</b><i class="d">·</i><span class="what">${g.map(([x]) => esc(aname(x))).join(en ? ", " : "、")} ${en ? "are all using it" : "同时在用"}</span></div>`;
    const it = liveItem(a), since = a.tool_since, old = since && Date.now() - Date.parse(since) > TOOL_STALE, what = toolWhat(a);
    return `<div class="${cls}${old ? " stale" : ""}"${dl} role="button" tabindex="0" ${it ? `data-item="${esc(it.id)}"` : `data-chat="${esc(a.id)}"`} title="${esc(nm)} ${en ? "in use" : "使用中"} · ${esc(aname(a))}${what ? " · " + esc(what) : ""}">`
      + `<span class="ic">${toolIc(k)}</span><b>${esc(nm)}<span class="iu"> ${en ? "in use" : "使用中"}</span></b><i class="d">·</i>`
      + `<span class="who"><i style="background-image:url('${avatarUrl(a)}')"></i><span class="nm">${esc(aname(a))}</span></span>`
      + (what ? `<i class="d">·</i><span class="what">${esc(what)}</span>` : `<span class="what"></span>`)
      + (since ? `<time class="wk-el" data-since="${esc(since)}">${wkDur(since)}</time>${old ? `<em>${en ? "maybe left on" : "可能忘了清"}</em>` : ""}` : "")
      + TOOL_EXTRA.map(fn => { try { return fn(a, k, !!old) || ""; } catch (e) { return ""; } }).join("") + `</div>`;
  }).join("");
  TOOL_LAST = html.replace(/ tp-in| style="animation-delay:-\d+ms"/g, "");
  return html;
}
let toolHTML = null;
function renderTool() { const el = $("#toolbar"); if (!el || !ST) return; const h = toolLine("d"); if (h !== toolHTML) { toolHTML = h; el.innerHTML = h; } }
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

// ---------- header ----------
/* today's 定时 runs not sent yet (meta.routines, 定时-page schedules, the 日报), by time; shared by the header's NEXT and the rail's 定时 badge (t-ri1113-a P5) */
function runsLeft(now = new Date()) {
  const today = dayKey(now), at = tm => new Date(`${today}T${tm}`), rep = ST.meta && ST.meta.report_time;
  return [...((ST.meta && ST.meta.routines) || []).filter(r => !r.paused && !r.disabled && r.time && r.last !== today).map(r => ({ time: r.time, title: rtShort(r) })),
    ...schToday().filter(r => !r.ran && r.time).map(r => ({ time: r.time, title: rtShort(r) })),
    ...(rep && ST.meta.last_report_date !== today ? [{ time: rep, title: UI.lang === "en" ? "Daily report" : "日报" }] : [])].map(r => ({ ...r, d: at(r.time) })).sort((a, b) => a.d - b.d);
}
function nextEvent() {
  const now = new Date();
  /* t-ui-fix-r7 R7-04: today's 定时 runs that are still to come (meta.routines, 定时-page schedules, the 日报) count too, like the 今日日程 rail */
  const runs = runsLeft(now);
  /* r-improve-1112 P4: a run whose time has passed but that has not been sent yet is 「到点」 in the 今日日程 rail (rtRow); it goes first here too,
     because those minutes are exactly when the user wants to know what is pending. Earliest due one wins; calendar events are not "due". */
  const due = runs.filter(r => r.d <= now && !isNaN(r.d)).sort((a, b) => a.d - b.d)[0];
  if (due) return `<b class="sy-due">${UI.lang === "en" ? "Due, not sent" : "到点未派"} · ${esc(due.time)} ${esc(due.title)}</b>`;
  const ev = [...(ST.calendar || []).map(c => ({ ...c, d: new Date(`${c.date}T${c.time || "00:00"}`) })), ...runs].filter(c => c.d > now && !isNaN(c.d)).sort((a, b) => a.d - b.d)[0];
  if (!ev) return "";   // t-cal-fold: no upcoming event -> the header leaves the NEXT segment out
  const lbl = dayKey(ev.d) === dayKey(now) ? t("today_w") : dayKey(ev.d) === dayKey(new Date(Date.now() + 864e5)) ? t("tomorrow") : `${ev.d.getMonth() + 1}/${ev.d.getDate()}`;
  return `<b>${lbl} ${esc(ev.time || "")} ${esc(ev.title)}</b>`;
}
function mgrState() {
  const m = agent("manager");
  const stale = m.last_seen && (Date.now() - new Date(m.last_seen)) > 45 * 6e4 && ST.meta.inbox_unacked > 0;
  if (m.status === "offline" || !m.last_seen) return { on: false, txt: t("offline") };
  // asleep: planned (S sleep --until) or a hard stop (a usage window at ~100% and no heartbeat since)
  const u = ST.meta.usage || {}, quiet = Date.now() - new Date(m.last_seen) > 10 * 6e4;
  const hit = [u.five_hour, u.seven_day].filter(w => w && w.used >= 98 && until(w.resets_at)).map(w => w.resets_at).sort().pop();
  const wake = m.status === "sleeping" ? m.wake_at : quiet && hit;
  if (wake) {
    const back = until(wake);
    return { on: false, sleep: true, wake, back: back && clock(wake), since: m.last_seen,
      txt: back ? t("sleep_at", { t: clock(wake) }) : t("waking") };
  }
  return { on: !stale, txt: stale ? `${t("offline")}?` : t("online"), since: m.last_seen };
}
// Plan usage comes from the manager's statusLine (tools/statusline.py): 5-hour window drives the orb,
// the weekly window is the thin bar under it. Shown as what's LEFT, like a stamina bar.
function until(iso) {
  const ms = new Date(iso) - Date.now(); if (!(ms > 0)) return null;
  const h = Math.floor(ms / 36e5), m = Math.round(ms % 36e5 / 6e4);
  return h ? `${h}h${pad(m)}m` : `${m}m`;
}
// "03:10" today, "明天 03:10" / "周二 19:00" further out; English uses 3:10 AM style like Claude's own card
function clock(iso) {
  const d = new Date(Math.round(new Date(iso) / 6e4) * 6e4), en = UI.lang === "en", now = new Date();  // 03:09:59 reads as 03:10
  const tm = en ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const days = Math.round((new Date(d.toDateString()) - new Date(now.toDateString())) / 864e5);
  if (days <= 0) return tm;
  if (days === 1) return en ? `tomorrow ${tm}` : `明天 ${tm}`;
  return (en ? d.toLocaleDateString("en-US", { weekday: "short" }) : "周" + "日一二三四五六"[d.getDay()]) + " " + tm;
}
// t-imp-p4: usage is shown honestly. The manager's usage tool times out often, so old readings are normal:
// older than USAGE_STALE minutes = "≈" + "11:11 的数据" + greyed; a window whose reset passed AFTER the reading
// is unknown (the reading is from before the reset), never "100% 已回满".
const USAGE_STALE = 20;   // t-stamina-stale: was 30; past this the orb greys out and the subtitle says how old the reading is
const ageShort = iso => { const d = D(iso); if (!d) return ""; const m = Math.max(0, Math.round((Date.now() - d) / 6e4)), en = UI.lang === "en";
  return m < 60 ? (en ? `${m} min ago` : `${m} 分钟前`) : m < 48 * 60 ? (en ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 60)} 小时前`) : when(iso); };
function ageTxt(iso) {
  const d = D(iso); if (!d) return "";
  const m = Math.max(0, Math.round((Date.now() - d) / 6e4)), en = UI.lang === "en";
  if (m < 1) return t("just");
  if (m < 60) return en ? `${m} min ago` : `${m} 分钟前`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 48) return en ? `${h}h${r ? ` ${r}m` : ""} ago` : `${h} 小时${r ? ` ${r} 分钟` : ""}前`;
  return when(iso);
}
function usageSrc(src) {
  const en = UI.lang === "en";
  if (src === "manager") return en ? "read by the manager with the desktop app's get_usage" : "管家用桌面端 get_usage 读取";
  if (src === "statusline") return en ? "written by the terminal statusLine (tools/statusline.py)" : "终端 statusLine 自动写入（tools/statusline.py）";
  return src ? (en ? `source: ${src}` : `来源：${src}`) : (en ? "source unknown" : "来源未记录");
}
function usage() {
  const u = ST.meta.usage || {}, en = UI.lang === "en";
  const five = u.five_hour, week = u.seven_day;
  if (!five && !week) return { left: null, week: null, sub: en ? "no usage data" : "未接入用量", stale: true, none: true,
    tip: en ? "Set up tools/statusline.py as the manager's statusLine" : "把 tools/statusline.py 配成管家的 statusLine 后显示 Claude 用量" };
  const at = D(u.at), ageMin = at ? (Date.now() - at) / 6e4 : Infinity;
  const stale = ageMin > USAGE_STALE;
  const gone = w => { const r = w && D(w.resets_at); return !!r && r <= Date.now() && (!at || at < r); };
  const lost5 = gone(five), lostW = gone(week);
  const reset5 = five && until(five.resets_at), resetW = week && until(week.resets_at);
  const at5 = reset5 && clock(five.resets_at), atW = resetW && clock(week.resets_at);
  // t-stamina-stale v2: a window that reset after the reading starts again from 0, so it is shown as an estimated 100% ("估"), not "—".
  // Number = how much is left (估 when estimated), subtitle = the window's state, the desktop pill = why the reading is old and for how long.
  const left = five ? (lost5 ? 100 : Math.round(100 - five.used)) : null;
  const wk = week ? (lostW ? 100 : Math.round(100 - week.used)) : null;
  const approx = (stale || lost5) && left != null, approxW = (stale || lostW) && wk != null;
  const ms = mgrState(), why = ms.sleep ? (en ? "manager asleep" : "管家休眠") : !ms.on ? (en ? "manager offline" : "管家离线") : (en ? "read timed out" : "读取超时");
  const mins = at ? Math.max(0, Math.round(ageMin)) : 0;
  const quiet = mins < 60 ? (en ? `no update for ${mins} min` : `${mins} 分钟没更新`) : mins < 48 * 60 ? (en ? `no update for ${Math.floor(mins / 60)}h` : `${Math.floor(mins / 60)} 小时没更新`) : (en ? `no update since ${when(u.at)}` : `${when(u.at)} 起没更新`);
  const pill = stale && u.at ? `${why} · ${quiet}` : "";
  const sub = lost5 ? (en ? `full since ${clock(five.resets_at)}` : `${clock(five.resets_at)} 已回满`)
    : left === 100 ? (en ? "full" : "满格")   /* t-ri1108-a P3: nothing used yet, so no 「HH:MM 复活」 */
    : reset5 ? (en ? `full at ${at5}` : `${at5} 复活`) : "";
  const subPh = stale && u.at ? `${why} · ${ageShort(u.at)}` : sub;   // phones have no pill: the subtitle says why instead
  const age = u.at ? ageTxt(u.at) : "";
  const tip = [five && (lost5 ? (en ? `Session: reset at ${clock(five.resets_at)} after the last reading · estimated near full` : `5 小时窗口：上次读数之后已在 ${clock(five.resets_at)} 重置 · 估计接近回满`)
      : (en ? `Session: ${approx ? "≈" : ""}${left}% left${at5 ? ` · full at ${at5}` : ""}` : `5 小时窗口：剩 ${approx ? "≈" : ""}${left}%${at5 ? ` · ${at5} 回满` : ""}`)),
    week && (lostW ? (en ? "Weekly: reset after the last reading · estimated near full" : "本周：上次读数之后已重置 · 估计接近回满")
      : (en ? `Weekly: ${approxW ? "≈" : ""}${wk}% left${atW ? ` · resets ${atW}` : ""}` : `本周：剩 ${approxW ? "≈" : ""}${wk}%${atW ? ` · ${atW} 重置` : ""}`)),
    u.context != null && (en ? `Manager context: ${u.context}% used` : `管家上下文：已用 ${u.context}%`),
    u.at && (en ? `Read at ${hm(u.at)} (${age})${stale ? ` · ${why}` : ""}` : `${hm(u.at)} 读取（${age}）${stale ? ` · ${why}` : ""}`)].filter(Boolean).join("\n");
  return { left, week: wk, sub, subPh, pill, why, stale, approx, approxW, lost5, lostW, age, tip, reset5, resetW, at5, atW, src: u.source,
    used5: five && Math.round(five.used), usedW: week && Math.round(week.used), context: u.context, at: u.at };
}
// ===== t-home-usage (approved 11-04): tokens per role today, from GET /api/usage (server reads the local transcripts, 60 s cache).
// One builder, three places: the desktop widget (widgets.js), the phone home card, the 系统状态 panel. Quota % stays a small strip under it.
const UG = { data: null, at: 0, busy: null, key: "", prev: new Map() };
function loadRoleUsage() {
  if (UG.busy || Date.now() - UG.at < 6e4) return;
  UG.busy = fetch("/api/usage").then(r => r.ok ? r.json() : null).catch(() => null).then(d => {
    UG.at = Date.now(); UG.busy = null; if (!d || !Array.isArray(d.roles)) return;
    const k = JSON.stringify([d.day, d.roles.map(r => [r.id, r.new])]); UG.data = d;
    if (k === UG.key) return; UG.key = k;
    if (UI.page === "review" || (UI.page === "settings" && UI.setTab === "system")) renderPage();
    const m = $("#modal .mdl.sys"); if (m && m._paint) m._paint();
  });
}
setInterval(() => { if (!document.hidden && (UI.page === "review" || (UI.page === "settings" && UI.setTab === "system") || $("#modal .mdl.sys"))) loadRoleUsage(); }, 15000);   // a quiet state does not re-render, so poll the counts here
const fmtTok = n => { n = +n || 0; const en = UI.lang === "en";
  if (n >= 1e8 && !en) return (n / 1e8).toFixed(n >= 1e9 ? 0 : 1) + " 亿";
  return n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n); };
function roleUsage() {
  loadRoleUsage();
  const d = UG.data; if (!d) return null;
  const rows = d.roles.filter(r => r.new > 0).map(r => ({ ...r, a: r.id === "other" ? null : agent(r.id) }));
  return { ...d, rows };
}
function ruName(r) { const en = UI.lang === "en"; return r.id === "other" ? (en ? "Other sessions" : "其他会话") : r.a ? aname(r.a) : r.id; }
function ruTip(r) { const en = UI.lang === "en", f = fmtTok;
  return en ? `input ${f(r.in)} · output ${f(r.out)} · cache write ${f(r.cw)} · cache read ${f(r.cr)} · ${r.msgs} replies · ${r.sessions} sessions`
    : `输入 ${f(r.in)} · 输出 ${f(r.out)} · 写缓存 ${f(r.cw)} · 读缓存 ${f(r.cr)} · ${r.msgs} 次回复 · ${r.sessions} 个会话`; }
// quota strip: 5 小时 / 本周 / 管家上下文 (what is LEFT), greyed + 「X 分钟前 · 可能已过期」 past USAGE_STALE (same usage() as the orb)
function ruQuota(compact) {   // compact (home widget, t-sync-pill batch 2): one line, no manager context, a stale reading = warn dot + age
  const U = usage(), en = UI.lang === "en"; if (U.none) return "";
  const v = (x, est) => x == null ? "—" : `${est ? "≈" : ""}${x}%`;
  const age = U.at ? relH("ago", U.at, ago(U.at)) : "";
  return `<div class="ru-q${U.stale ? " old" : ""}" data-ru-open><span>${en ? "5-hour" : "5 小时"} <b>${v(U.left, U.approx)}</b></span><span>${en ? "Week" : "本周"} <b>${v(U.week, U.approxW)}</b></span>`
    + (U.context != null && !compact ? `<span>${en ? "Manager context" : "管家上下文"} <b>${v(100 - U.context, U.stale)}</b></span>` : "")
    + (compact ? `<span class="ru-age${U.stale ? " old" : ""}" title="${U.stale ? (en ? "may be out of date" : "可能已过期") : ""}">${age}</span></div>`
      : `<span class="ru-age">${U.stale ? `<em>${age} · ${en ? "may be out of date" : "可能已过期"}</em>` : age}</span></div>`);
}
// t-soul-widget (user 11-11 00:43, option B): the desk Usage widget's lower half = 「Soul · quota per model」, one row per model; the top-bar Soul orb is hidden there.
// Claude = the same usage() as the orb (what is LEFT). Codex = meta.codex, the rate_limits snapshot server.py reads from the newest ~/.codex/sessions log
// (weekly window only); it only moves when Codex runs, so the row says when it was read and greys out past 24 h.
function soulSw(left) {   /* 3 x 4 knit V stitches, filled from the bottom = what is left */
  const on = left == null ? 0 : Math.round(Math.max(0, Math.min(100, left)) / 100 * 12); let s = `<svg class="sl-sw" viewBox="0 0 30 36" aria-hidden="true"><rect class="cl" x="1" y="1" width="28" height="34" rx="4"></rect>`, n = 0;
  for (let r = 3; r >= 0; r--) for (let c = 0; c < 3; c++) { const x = 5 + c * 7.2, y = 5 + r * 7.4; s += `<path class="${n++ < on ? "on" : "off"}" d="M${x.toFixed(1)} ${y.toFixed(1)}Q${(x + 1.2).toFixed(1)} ${(y + 4.6).toFixed(1)} ${(x + 3.3).toFixed(1)} ${(y + 5.4).toFixed(1)}Q${(x + 5.4).toFixed(1)} ${(y + 4.6).toFixed(1)} ${(x + 6.6).toFixed(1)} ${y.toFixed(1)}"></path>`; }
  return s + "</svg>"; }
function soulHTML() {
  const en = UI.lang === "en", U = usage(), C = ST.meta.codex;
  const bar = (l, v, est) => `<div class="sl-b"><span>${l}</span><i><em style="--w:${v == null ? 0 : (Math.max(0, Math.min(100, v)) / 100).toFixed(3)}"></em></i><b>${v == null ? "—" : `${est ? "≈" : ""}${v}<small>%</small>`}</b></div>`;
  const cAge = U.at ? relH("ago", U.at, ago(U.at)) : "";
  const cRight = U.none ? (en ? "not connected" : "未接入") : U.stale ? `<em class="sl-old">${cAge}</em>` : U.sub ? (en ? U.sub.replace(/^full at /, "full at <b>") + (/^full at /.test(U.sub) ? "</b>" : "") : U.sub) : "";
  const claude = `<div class="sl-m${U.stale ? " old" : ""}" title="${esc(U.tip)}">${soulSw(U.left)}<div class="sl-mn"><b>Claude</b></div><div class="sl-full">${cRight}</div>`
    + `<div class="sl-bars">${bar(en ? "5-hour" : "5 小时", U.left, U.approx)}${bar(en ? "Week" : "本周", U.week, U.approxW)}</div></div>`;
  let codex;
  if (!C || C.used == null) codex = `<div class="sl-m old">${soulSw(null)}<div class="sl-mn"><b>Codex</b><small>${en ? "not read yet" : "还没读到"}</small></div><div class="sl-full"></div><div class="sl-bars">${bar(en ? "Week" : "本周", null)}</div></div>`;
  else {
    const at = D(C.at), old = !at || Date.now() - at > 864e5, rs = C.resets_at && D(C.resets_at), reset = !!rs && rs <= Date.now();
    const left = reset ? 100 : Math.round(100 - C.used), plan = C.plan ? C.plan[0].toUpperCase() + C.plan.slice(1) : "";
    const read = (en ? "last read · " : "上次读到 · ") + relH("ago", C.at, ago(C.at));
    const right = reset ? (en ? "reset since" : "之后已重置") : rs ? (en ? `resets <b>${clock(C.resets_at)}</b>` : `<b>${clock(C.resets_at)}</b> 重置`) : "";
    const tip = (en ? `Codex ${plan} · weekly ${Math.round(C.used)}% used` : `Codex ${plan} · 本周已用 ${Math.round(C.used)}%`) + (rs ? (en ? ` · resets ${clock(C.resets_at)}` : ` · ${clock(C.resets_at)} 重置`) : "")
      + (en ? `\nRead from the newest Codex session log at ${hm(C.at)}; it only updates when Codex runs` : `\n${hm(C.at)} 从最新的 Codex 会话日志读到；Codex 跑过才会更新`);
    codex = `<div class="sl-m${old ? " old" : ""}" title="${esc(tip)}">${soulSw(left)}<div class="sl-mn"><b>Codex</b>${plan ? `<small>${esc(plan)}</small>` : ""}</div><div class="sl-full">${right}</div>`
      + `<div class="sl-bars">${bar(en ? "Week" : "本周", left, reset)}<span class="sl-rd">${read}</span></div></div>`;
  }
  return `<div class="sl" data-ru-open><div class="sl-sep">${en ? "Soul <span>quota per model</span>" : "体力 <span>· 每个模型的额度</span>"}</div><div class="sl-ms">${claude}${codex}</div></div>`;
}
// n: rows to list; o.tot: the big total line; o.quota: the strip
function ruHTML(n, o = {}) {
  const R = roleUsage(), en = UI.lang === "en";
  if (!R) return `<div class="ru-wait">${en ? "Counting…" : "正在统计…"}</div>` + (o.soul ? soulHTML() : o.quota ? ruQuota() : "");
  const rows = R.rows, max = rows.length ? rows[0].new : 1, more = rows.length - n;
  const list = rows.length ? rows.slice(0, n).map((r, i) => `<div class="ru-row${r.a ? "" : " nd"}"${r.a ? ` data-chat="${esc(r.id)}"` : ""} title="${esc(ruTip(r))}" style="--ru-i:${i}">`
      + (r.a ? `<img class="ru-av" src="${avatarUrl(r.a)}" alt="">` : `<span class="ru-av"></span>`)
      + `<span class="ru-n"><span class="t">${esc(ruName(r))}</span>${r.a && r.a.status === "working" ? `<i class="ru-on" title="${en ? "working" : "工作中"}"></i>` : ""}</span>`
      + `<i class="ru-bar"><em data-ru="${esc(r.id)}" style="--ru-w:${Math.max(0.02, r.new / max).toFixed(3)}"></em></i><b data-ru-v="${r.new}">${fmtTok(r.new)}</b></div>`).join("")
    : `<div class="ru-wait">${R.error ? (en ? `Could not read the transcripts (${esc(srvT(R.error))})` : `读不到会话记录（${esc(R.error)}）`) : (en ? "No tokens used yet today" : "今天还没用过")}</div>`;
  const tot = o.tot ? `<div class="ru-tot" data-ru-open><b data-ru-v="${R.total}" data-ru-k="tot">${fmtTok(R.total)}</b><span>${en ? `new tokens · plus ${fmtTok(R.cache_read)} cache reads` : `新 token · 另读缓存 ${fmtTok(R.cache_read)}`}</span></div>` : "";
  requestAnimationFrame(ruSettle);
  if (o.fit) requestAnimationFrame(ruFit);
  return tot + `<div class="ru-list">${list}${more > 0 && o.more ? `<div class="ru-more" data-ru-open>${en ? `+${more} more ›` : `还有 ${more} 个 ›`}</div>` : ""}</div>` + (o.soul ? soulHTML() : o.quota ? ruQuota(o.fit) : "");
}
// Motion (11-04 rule): a bar grows from 0 the first time it is shown and glides from its previous length when the data changes;
// numbers count up. Rebuilt DOM with the same data does nothing. prefers-reduced-motion: no transition (CSS) and no count.
// t-sync-pill (batch 2): the home widget has a fixed height; rows that do not fit fold away from the bottom (the header's 「全部 N 位 ›」 opens the full list)
function ruFit() {
  document.querySelectorAll("[data-wg=usage] .ru-list").forEach(list => {
    const rows = [...list.querySelectorAll(".ru-row")]; rows.forEach(r => r.classList.remove("fit-hide"));
    for (let i = rows.length - 1; i > 0 && list.scrollHeight > list.clientHeight + 1; i--) rows[i].classList.add("fit-hide");
  });
}
function ruSettle() {
  document.querySelectorAll(".ru-bar em:not([data-s])").forEach(em => {
    em.dataset.s = "1"; const k = em.closest(".ru-list") && em.closest(".ru-list").parentElement ? em.dataset.ru + "|" + (em.closest("[data-wg],.ru-card,.sy-ru") || {}).className : em.dataset.ru;
    const to = getComputedStyle(em).getPropertyValue("--ru-w").trim(), from = UG.prev.has(k) ? UG.prev.get(k) : "0";
    UG.prev.set(k, to); if (from === to || RMQ.matches) return;
    em.style.transition = "none"; em.style.transform = `scaleX(${from})`; em.getBoundingClientRect();
    em.style.transition = ""; em.style.transform = "";
    if (from !== "0") em.style.transitionDelay = "0ms";
  });
  document.querySelectorAll("[data-ru-v]:not([data-s])").forEach(b => {
    b.dataset.s = "1"; const k = "v|" + (b.dataset.ruK || (b.closest(".ru-row") && b.closest(".ru-row").querySelector("[data-ru]") || {}).dataset?.ru) + "|" + (b.closest("[data-wg],.ru-card,.sy-ru") || {}).className;
    const to = +b.dataset.ruV, from = UG.prev.has(k) ? UG.prev.get(k) : 0; UG.prev.set(k, to);
    if (from === to || RMQ.matches || document.hidden) return;
    const t0 = performance.now(), D = 520, ease = x => 1 - Math.pow(1 - x, 3);
    const step = now => { if (!b.isConnected) return; const x = Math.min(1, (now - t0) / D); b.textContent = fmtTok(from + (to - from) * ease(x)); if (x < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}
// phone home card (under the strip's stat row); the desktop widget lives in widgets.js
function ruCard() {
  if (!MOBQ.matches) return "";
  const R = roleUsage(), en = UI.lang === "en";
  return `<section class="ru-card" data-ru-open><div class="ru-hd"><b>${en ? "Usage by role" : "各角色用量"}</b><small>${en ? "today · new tokens" : "今天 · 新 token"}</small>${R ? `<span>${en ? "total" : "共"} ${fmtTok(R.total)}</span>` : ""}</div>${ruHTML(4, { quota: true })}</section>`;
}
document.addEventListener("click", e => {   // the card / strip opens 系统状态; a role row (data-chat) opens the DM instead
  const o = e.target.closest && e.target.closest("[data-ru-open]"); if (!o || e.target.closest("[data-chat]")) return;
  if (document.querySelector("#wg.edit")) return;
  modalStatus();
});
/* t-sync-pill (detail polish batch 2, V1): the top bar shows one pill, 「● 已同步」 = the last poll answered. Two misses in a row (~30 s) turn it red with a
   running 「断线 · N 秒没连上 · 自动重试中」. Hover / focus opens the details (connection, last data change, next event, ComfyUI, team, inbox); a click still opens
   系统状态. The manager's online state lives in the left rail only. Built once and then only text nodes change, so a poll never rebuilds the popover under the mouse.
   Phones hide #sync; there html[data-net="off"] shows #net-off under the header, only while disconnected. */
function syncPaint() {
  const sy = $("#sync"); if (!sy) return;
  const en = UI.lang === "en", R = document.documentElement;
  // polls run every 2.5 s: red only after 2+ misses in a row AND 10 s without an answer (a blip or one slow reply stays green)
  const down = (UI.fail || 0) >= 2 && (!UI.lastOk || Date.now() - UI.lastOk >= 10000);
  if (!sy.querySelector(".sy-pill")) {
    sy.classList.add("sy1"); sy.tabIndex = 0; sy.setAttribute("role", "button");
    sy.innerHTML = `<span class="sy-pill"><i class="sy-dot" aria-hidden="true"></i><b class="sy-k"></b><small class="sy-s"></small></span>`
      + `<div class="sy-pop" role="tooltip"><span data-l="c"></span><b data-v="c"></b><span data-l="d"></span><b data-v="d"></b><span data-l="n"></span><b data-v="n"></b>`
      + `<span data-l="t"></span><b data-v="t"></b><span data-l="g">ComfyUI</span><b data-v="g"></b><span data-l="i"></span><b data-v="i"></b><div class="ft"></div></div>`;
  }
  const set = (sel, v, html) => { const e = sy.querySelector(sel); if (!e) return; if (html) { if (e._h !== v) { e._h = v; e.innerHTML = v; } } else if (e.textContent !== v) e.textContent = v; };
  const secs = UI.lastOk ? Math.max(0, Math.round((Date.now() - UI.lastOk) / 1000)) : 0;
  const off = en ? `${secs ? secs + " s without an answer · " : ""}retrying` : `${secs ? secs + " 秒没连上 · " : ""}自动重试中`;
  const pill = sy.querySelector(".sy-pill"), wasDown = pill.classList.contains("down");
  pill.classList.toggle("down", down);
  const snapMin = UI.snap ? Math.max(0, Math.round((Date.now() - UI.snap) / 60000)) : -1;
  const snapTxt = snapMin < 0 ? "" : en ? `last ${snapMin ? snapMin + " min ago" : "just now"}` : `上次 ${snapMin ? snapMin + " 分钟前" : "刚刚"}`;
  pill.classList.toggle("snap", snapMin >= 0 && !down);
  set(".sy-k", down ? (en ? "Offline" : "断线") : snapMin >= 0 ? (en ? "Syncing" : "同步中") : (en ? "Synced" : "已同步"));
  set(".sy-s", down ? off + (snapTxt ? " · " + (en ? "showing " : "显示的是") + snapTxt : "") : snapTxt);
  if (wasDown && !down) { pill.classList.remove("back"); void pill.offsetWidth; pill.classList.add("back"); }
  sy.setAttribute("aria-label", down ? `${en ? "Offline" : "断线"} · ${off}` : (en ? "Synced · details" : "已同步 · 查看详情"));
  const L = en ? { c: "Connection", d: "Last change", n: "Next", t: "Team", i: "Inbox" } : { c: "连接", d: "数据最后变动", n: "下一个", t: "团队", i: "收件箱" };
  for (const k in L) set(`[data-l="${k}"]`, L[k]);
  const okAt = UI.lastOk ? new Date(UI.lastOk).toTimeString().slice(0, 8) : "—";
  set('[data-v="c"]', down ? (en ? `offline · last answer ${okAt}` : `断线 · 最后一次连上 ${okAt}`) : (en ? `live · last checked ${okAt}` : `正常 · 最后确认 ${okAt}`));
  sy.querySelector('[data-v="c"]').className = down ? "bad" : "ok";
  const M = (ST && ST.meta) || {}, c = M.comfy || {}, ag = ST ? agents().filter(a => a.enabled !== false) : [];   /* t-ui-fix-r7 R7-03: the manager counts in the total too, since isBusy counts it when it is on a card */
  set('[data-v="d"]', M.updated ? `${hm(M.updated)} · ${ago(M.updated)}` : "—");
  set('[data-v="n"]', (ST && nextEvent()) || "—", true);
  const nBusy = ag.filter(isBusy).length;   // t-ui-fix-r6 R6-08: same busy count as the home header
  set('[data-v="t"]', en ? `${ag.length} · ${nBusy} working` : `${ag.length} 位 · ${nBusy} 位在忙`);
  set('[data-v="g"]', c.online ? (en ? "online" : "在线") : (en ? "not linked" : "未连"));
  sy.querySelectorAll('[data-l="g"], [data-v="g"]').forEach(x => { x.hidden = c.configured === false; });   /* no comfy block in config.json: no ComfyUI line */
  set('[data-v="i"]', en ? `${M.inbox_unacked || 0} unhandled` : `${M.inbox_unacked || 0} 条没处理`);
  set(".sy-pop .ft", en ? "Click for System status · the manager's state is in the left rail" : "点一下打开系统状态 · 管家在线看左栏");
  // phone: a strip under the header, only while disconnected
  let nb = document.getElementById("net-off");
  if (down && !nb) { nb = document.createElement("div"); nb.id = "net-off"; nb.setAttribute("role", "status"); nb.innerHTML = `<i aria-hidden="true"></i><span></span>`; document.body.appendChild(nb); }
  if (!down && snapMin >= 0 && !nb) { nb = document.createElement("div"); nb.id = "net-off"; nb.setAttribute("role", "status"); nb.innerHTML = `<i aria-hidden="true"></i><span></span>`; document.body.appendChild(nb); }
  if (nb) nb.querySelector("span").textContent = down ? `${en ? "Offline" : "断线"} · ${off}${snapTxt ? " · " + snapTxt : ""}` : snapMin >= 0 ? `${en ? "Syncing" : "同步中"} · ${snapTxt}` : "";
  if (down) R.dataset.net = "off"; else if (snapMin >= 0) R.dataset.net = "snap"; else delete R.dataset.net;
  clearTimeout(syncPaint.t); if (down || UI.fail) syncPaint.t = setTimeout(syncPaint, 1000);   // the seconds keep counting while offline
}
/* t-ums-build (Mailbox C): the flap's cross-stitches and the red yarn ball behind the unread count. Always in the markup (serialized form,
   so the #hdrctrl innerHTML compare stays equal), drawn only under html[data-ut] (theme-ut.css); other themes hide them and look as before. */
const MAIL_X = '<path class="ums-x" d="M3.3 4.8l1.6 1.6M4.9 4.8l-1.6 1.6M5.25 6.3l1.6 1.6M6.85 6.3l-1.6 1.6M7.2 7.75l1.6 1.6M8.8 7.75l-1.6 1.6M9.15 6.3l1.6 1.6M10.75 6.3l-1.6 1.6M11.1 4.8l1.6 1.6M12.7 4.8l-1.6 1.6"></path>';
const YARN = '<svg class="ums-yarn" viewBox="0 0 20 20" preserveAspectRatio="none" aria-hidden="true"><path class="ums-bt" d="M14.6 17.6c1.8 2.6 4.6 3.2 6.8 1.4"></path><circle class="ums-b0" cx="10" cy="10" r="9.6"></circle>'
  + '<path class="ums-bw" d="M1.6 7.2Q10 2.6 18.6 8M1.4 12.6Q10 8.4 18.6 13.6M6.4 1.4Q1.8 9.6 6.8 18.6M13.4 1.4Q18.4 9.6 13.2 18.6"></path></svg>';
/* t-ums-build (Soul C): under Underthread the orb shows a knitting swatch instead of the vessel (both live in .orb; CSS picks one by
   html[data-ut], so a theme switch needs no rebuild). 6 rows x 4 stitches, knitted bottom-up to the % left; a needle lies across the row
   being knitted. Built once; a poll only toggles .on on the stitches and moves the needle, so nothing replays. Decoration only (aria-hidden),
   the % stays the text next to it. Few big stitches on purpose: 40 small ones read as texture at 1x (t-ums-mock). */
const SW = { rows: 6, cols: 4, x: 9, y: 5.5, w: 8.5, h: 7 };
function swatchSvg() {
  const r = n => Math.round(n * 100) / 100;
  let st = "";
  for (let i = 0; i < SW.rows * SW.cols; i++) {
    const row = Math.floor(i / SW.cols), col = i % SW.cols, x = SW.x + col * SW.w, y = SW.y + (SW.rows - 1 - row) * SW.h, m = x + SW.w / 2;
    st += `<g class="ums-k"><rect class="ums-kc" x="${r(x + .35)}" y="${r(y + .35)}" width="${r(SW.w - .7)}" height="${r(SW.h - .7)}" rx="1.2"/>`
      + `<path class="ums-kv" d="M${r(x + 1.4)} ${r(y + 1.3)}Q${r(x + 2.4)} ${r(y + SW.h - 2)} ${r(m)} ${r(y + SW.h - 1.1)}M${r(x + SW.w - 1.4)} ${r(y + 1.3)}Q${r(x + SW.w - 2.4)} ${r(y + SW.h - 2)} ${r(m)} ${r(y + SW.h - 1.1)}"/></g>`;
  }
  return `<svg class="ums-sw" viewBox="0 0 52 52" aria-hidden="true"><rect class="ums-cloth" x="6.5" y="2.5" width="39" height="47" rx="3.5"/>`
    + `<path class="ums-cast" d="M9 48.2H43"/>${st}<g class="ums-nd"><g class="ums-ndi"><path class="ums-needle" d="M2.5 0H48.6"/><circle class="ums-knob" cx="2.6" cy="0" r="2.4"/>`
    + `<path class="ums-knob" d="M48.2 -1.05L51.6 0 48.2 1.05z"/></g></g></svg>`;
}
function swatchSet(sw, left) {
  if (!sw) return;
  const n = SW.rows * SW.cols, done = left == null ? 0 : Math.round(Math.max(0, Math.min(100, left)) / 100 * n);
  if (sw.dataset.done === String(done)) return;
  sw.dataset.done = done;
  sw.querySelectorAll(".ums-k").forEach((g, i) => g.classList.toggle("ums-on", i < done));
  const row = done ? Math.min(SW.rows - 1, Math.floor((done - 1) / SW.cols)) : 0;   /* the row holding the last knitted stitch */
  const nd = sw.querySelector(".ums-nd");
  nd.style.transform = `translateY(${SW.y + (SW.rows - 1 - row) * SW.h}px)`;
  nd.classList.toggle("ums-off", done >= n);   /* full: the needle is put away */
}
function renderHeader() {
  const m = mgrState(), ag = agents().filter(a => a.enabled !== false && a.id !== "manager");
  const working = ag.filter(a => a.status === "working").length;
  const c = ST.meta.comfy || {};
  syncPaint();
  const U = usage();
  const sta = $("#stamina");   /* t-topbar-soul-off: index.html no longer has it; the block below only runs if an old cached page still does */
  if (sta) {
  sta.className = "stamina" + (U.stale ? " stale" : "") + (U.lost5 ? " lost" : "") + (U.approx ? " est" : "");
  sta.title = U.tip;
  // Build the soul vessel once so its waves keep flowing; later renders only move the level.
  if (!sta.querySelector(".orb .ums-sw")) {
    const wave = "M0 0 Q10 -4 20 0 T40 0 T60 0 T80 0 T100 0 V60 H0 Z";
    sta.innerHTML = `<div class="orb"><svg class="ums-vs" viewBox="0 0 52 52" aria-hidden="true"><defs><clipPath id="orbclip"><circle cx="26" cy="26" r="20"/></clipPath></defs>
      <circle class="ring2" cx="26" cy="26" r="25"/><circle class="ring" cx="26" cy="26" r="22.5"/><circle class="well" cx="26" cy="26" r="20"/>
      <g clip-path="url(#orbclip)"><g class="liq"><path class="w2" d="${wave}" transform="translate(-6 2)"/><path class="w1" d="${wave}"/></g>
      <ellipse class="shine" cx="19" cy="17" rx="6" ry="3.2" transform="rotate(-28 19 17)"/></g></svg>${swatchSvg()}</div>
      <div class="lbl"><b></b><small>STAMINA</small></div><div class="pct"><b></b><small></small></div><div class="focus"><i></i></div><span class="st-age" hidden></span>`;
  }
  const lvl = 46 - (Math.max(0, Math.min(100, U.left ?? 0)) / 100) * 36;  // keep a crest visible when full
  sta.querySelector(".liq").style.transform = `translateY(${lvl}px)`;
  sta.querySelector(".orb").classList.toggle("low", U.left != null && U.left < 20);
  swatchSet(sta.querySelector(".orb .ums-sw"), U.left);
  sta.querySelector(".lbl b").textContent = UI.lang === "en" ? "Soul" : "体力";
  {   // t-m2-a ②: the % rolls when it changes (the span is kept, only its digits move)
    const pb = sta.querySelector(".pct b");
    if (U.left == null) { pb.innerHTML = "—"; delete NV.sta; }
    else { if (!pb.querySelector(".nrv")) pb.innerHTML = `<i class="ap"></i><span class="nrv"></span><small>%</small>`;
      const ap = pb.querySelector(".ap"); ap.textContent = U.approx ? (UI.lang === "en" ? "est" : "估") : ""; ap.hidden = !U.approx; roll(pb.querySelector(".nrv"), U.left, "sta"); }
  }
  const sa = sta.querySelector(".st-age");
  sa.hidden = !U.pill;
  sa.textContent = U.pill;
  sta.querySelector(".pct > small").textContent = MOBQ.matches ? U.subPh : U.sub;
  sta.querySelector(".focus").hidden = U.week == null;
  sta.querySelector(".focus i").style.width = (U.week ?? 0) + "%";
  }
  const unread = mailUnread();   /* ri1105-P4: the server's count (a poll no longer carries every letter) */
  /* t-hdr-trim ①: the top bar keeps only 聊天 (narrow desktop). 舞台 / 主题 and 刷新用量 live in 设置, 报告 is a nav row.
     t-mailbox-top: 信箱 is back as a pill at the right end (desktop only; the rail row is hidden by CSS, the phone keeps it in 更多).
     t-mailbox-icon (user 00:26): icon only; the word lives in title (hover tip) + aria-label, the unread count is a corner badge (none at 0).
     The SVG is written in its serialized form (explicit closing tags) so the innerHTML compare below stays equal and the pill is not rebuilt every poll. */
  const mlab = UI.lang === "en" ? "Mailbox" : "信箱", mn = unread > 99 ? "99+" : String(unread);
  const hc = `<button data-h="mail" class="hc-mail" title="${mlab}" aria-label="${mlab}${unread ? " " + mn : ""}"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.8" y="3.2" width="12.4" height="9.6" rx="2"></rect><path class="ums-flap" d="M2.5 4.5 8 8.6l5.5-4.1"></path>${MAIL_X}</svg>${unread ? `<span class="n">${YARN}${mn}</span>` : ""}</button>`
    + `<button data-h="chat" class="hc-chat" aria-expanded="${document.body.classList.contains("chat-pop")}">${UI.lang === "en" ? "Chat" : "聊天"}</button>`;
  if ($("#hdrctrl").innerHTML.trim() !== hc) $("#hdrctrl").innerHTML = hc;
}
document.addEventListener("click", e => {
  const h = e.target.closest("[data-h]"); if (!h) return;
  const k = h.dataset.h;
  if (k === "theme") { UI.theme = { dark: "light", light: "white" }[UI.theme] || "dark"; LS.set("theme", UI.theme); render(); }   // D2: legacy cycle; the header picker uses [data-theme-set] (handled in mobile.js, same rt.theme key as the phone menu)
  if (k === "lang") { UI.lang = UI.lang === "zh" ? "en" : "zh"; LS.set("lang", UI.lang); srvLocal(); window.Push && Push.lang && Push.lang(UI.lang); render(); }
  if (k === "mail") { MB.open ? closeMailbox() : openMailbox(); }
  if (k === "chat") chatPop(!document.body.classList.contains("chat-pop"));
  if (k === "report") go("reports");
  if (k === "ping") api("ping", { note: "刷新用量" }).then(() => toast(UI.lang === "en" ? "Asked the manager to refresh usage" : "已让管家刷新用量"));   // t-settings-tab: same ping, with the note; 唤醒管家 moved to 设置 · 系统
  if (k === "wake") api("ping").then(() => toast(UI.lang === "en" ? "Manager pinged" : "已叫醒管家"));   // t-ui-fix-r6 R6-07: was the English-only 「ping → inbox」
});
$("#brand").addEventListener("click", () => go("review"));
{ const sta = $("#stamina"); if (sta) sta.addEventListener("click", () => modalStatus()); }   /* t-topbar-soul-off: gone from index.html */
$("#sync").addEventListener("click", e => { if (!e.target.closest("a,button")) modalStatus(); });
/* t-ui-fix-r6 R6-06: the pill is role=button + tabindex 0, so Enter / Space do what a click does */
$("#sync").addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target.id === "sync" && !e.repeat) { e.preventDefault(); modalStatus(); } });

// ---------- ticker ----------
function tickerItems() {
  const out = [];
  const now = Date.now();
  for (const n of ST.notices || []) if (!n.until || new Date(n.until) > now) out.push({ text: UI.lang === "en" && n.text_en || n.text, level: n.level, id: n.id });   /* t-i18n-c: text_en */
  const m = mgrState();
  if (m.sleep) out.unshift({ text: m.back ? t("mgr_sleep", { t: m.back, n: ST.meta.inbox_unacked || 0 }) : t("mgr_waking"), level: "info" });
  else if (!m.on && ST.meta.inbox_unacked) out.unshift({ text: t("mgr_offline", { n: ST.meta.inbox_unacked }), level: "urgent" });
  for (const it of items()) {
    if (it.category === "urgent" && it.stage !== "done" && it.owner === "manager") out.unshift({ text: t("no_owner_urgent", { t: it.title }), level: "urgent", item: it.id });
    if (it.stage === "review" && now - new Date(it.activity) > 864e5) out.push({ text: t("waiting_long", { t: it.title }), item: it.id });
  }
  return out;
}
let tickIdx = 0;
function renderTicker() {
  const list = tickerItems();
  const el = $("#ticker");
  if (!list.length) { el.innerHTML = ""; return; }
  tickIdx %= list.length;
  const n = list[tickIdx];
  const html = `<span class="k">${UI.lang === "en" ? "Notice" : "通知"}</span><span class="msg ${n.level === "urgent" ? "urgent" : ""}" data-ti="${tickIdx}">${esc(n.text)}</span>
    ${n.id ? `<button class="dim" data-dismiss="${n.id}" title="dismiss">✕</button>` : ""}
    <span class="pager">${list.map((_, i) => `<i class="${i === tickIdx ? "on" : ""}"></i>`).join("")}</span>`;
  if (html !== renderTicker.last) { el.innerHTML = html; renderTicker.last = html; }  // re-animate only when the notice changes
  el.onclick = e => {
    const d = e.target.closest("[data-dismiss]"); if (d) return api("notice_dismiss", { id: d.dataset.dismiss });
    if (e.target.closest(".msg") && n.item) openItem(n.item);
  };
}
setInterval(() => { if (ST) { tickIdx++; renderTicker(); } }, 6000);

// ---------- left ----------
function counts() {
  const c = { review: 0 }; for (const k of CATS) c[k] = 0;
  c.pipe = items().filter(i => i.stage !== "done" && isContent(i)).length;   // t-imp-p3
  c.crew = agents().filter(a => a.id !== "manager" && a.status === "working").length;   /* t-rb-build: 团队 row = roles working now */
  c.mail = mailUnread();   /* t-hdr-trim ①: 信箱 row in the rail; ri1105-P4: server count */
  for (const it of items()) { if (onYou(it)) c.review++; if (it.stage !== "done") c[it.category] = (c[it.category] || 0) + 1; }
  c.review += newReplies().length;   // t-review-unread: cards with unread replies (never one already counted above)
  return c;
}
/* t-ri1109-a (P1+P4): one short routine name for the rail and the home timeline. rtShort drops 「（r-…）」, the 「…每日 N 个」 lead and "app";
   rtFull keeps the whole label minus the item id, for title tooltips. */
function rtShort(r) { return String(r.label || r.id).replace(/[（(][^）)]*[）)]/g, "").replace(/^.*?每日\s*(\d+\s*个\s*)?(一条|打磨)?/, "").replace(/^app\s*/i, "").trim() || r.id; }
function rtFull(r) { return String(r.label || r.id).replace(/[（(][^）)]*[）)]/g, "").trim() || r.id; }
/* t-ri1110-a P2: schedules made on the 定时 page (state.schedules without a `routine`; imported routines already come as meta.routines) that run
   today: it ran today (last) or its next run is today. The 18:00 管家日报 entry is skipped when meta.report_time already gives the 日报 row.
   -> [{ time "HH:MM", label, ran, who, item }] in the meta.routines shape, so the rail and the home timeline treat both alike. */
function schToday() {
  const today = dayKey(new Date()), dk = t => t ? dayKey(new Date(t)) : "", rep = ST.meta && ST.meta.report_time;
  return (ST.schedules || []).filter(s => s && !s.deleted && !s.routine && s.rule).filter(s => {
    const at = String(s.rule.at || ""), tm = at.includes("T") ? at.split("T")[1] : at;
    if (rep && tm === rep && /日报/.test(s.title || "") && (s.task || {}).agent === "manager") return false;
    return dk(s.last) === today || (s.enabled && !s.paused && dk(s.next) === today);
  }).map(s => { const at = String(s.rule.at || ""), t = s.task || {};
    return { id: s.id, time: (at.includes("T") ? at.split("T")[1] : at).slice(0, 5), label: s.title || s.id, ran: dk(s.last) === today, who: t.agent || null, item: t.item || null }; });
}
/* t-ri1113-a P4: the routines already dispatched today fold into one row at the first one's place (「06:00 ●●● 已跑 6 个 ✓ ›」); a click opens
   them (kept in this browser: rt.calPast). Rows still to come, 到点未派 and the user's own events stay one per line. Two or more to fold. */
const CALPF = { at: 0 };
function calFold(rows) {
  const done = rows.filter(r => r.done); if (done.length < 2) return rows.map(r => r.h).join("");
  const open = !!LS.get("calPast", false), zh = UI.lang !== "en", anim = Date.now() - CALPF.at < 600;
  const avs = [...new Map(done.filter(r => r.a).map(r => [r.a.id, r.a])).values()].slice(0, 3);
  const head = `<div class="cal-i cal-rt past cal-pf${open ? " open" : ""}" role="button" tabindex="0" data-cal-pf aria-expanded="${open}" title="${esc(done.map(r => r.tip).join("\n"))}"><span class="tm">${esc(done[0].tm || "—")}</span><span class="cal-avs">${avs.map(a => av(a, "cal-av")).join("")}</span><span class="cal-nm">${zh ? `已跑 ${done.length} 个` : `${done.length} done`}</span><span class="cal-st">✓ <i class="cal-pf-cv" aria-hidden="true">›</i></span></div>`;
  let out = "", put = false;
  for (const r of rows) {
    if (!r.done) { out += r.h; continue; }
    if (!put) { put = true; out += head; }
    if (open) out += anim ? r.h.replace('class="cal-i cal-rt past', 'class="cal-i cal-rt past cal-pf-in') : r.h;
  }
  return out;
}
document.addEventListener("click", e => { const f = e.target.closest && e.target.closest("[data-cal-pf]"); if (!f) return; LS.set("calPast", !LS.get("calPast", false)); CALPF.at = Date.now(); renderLeft(); });
document.addEventListener("keydown", e => { const f = (e.key === "Enter" || e.key === " ") && e.target.closest && e.target.closest("[data-cal-pf]"); if (!f) return; e.preventDefault(); f.click(); });
function renderLeft() {
  const c = counts();
  /* t-ri1113-a P5: the 定时 row counts today's runs not sent yet (the page itself lists schedules, the rail's 今日日程 the runs); other rows still count cards */
  const rl = runsLeft(), rlNext = rl.find(r => r.d > new Date()) || rl[0]; c.ongoing = rl.length;
  const ogTip = !rl.length ? (UI.lang === "en" ? "All of today's runs are done" : "今天的定时都跑完了") : UI.lang === "en" ? `${rl.length} run${rl.length > 1 ? "s" : ""} left today · next ${rlNext.time} ${rlNext.title}` : `今天还有 ${rl.length} 个没跑 · 下一个 ${rlNext.time} ${rlNext.title}`;
  const navs = ["review", ...CATS, "sep", "market",   /* t-drop-team-tab (11-12): 团队 row removed; the 团队交接 widget stays (web/team.js) */ "studio", "reports", "mail", "settings"];   /* t-nav-shoot (11-05): 制作线 / 委托板 / 频道 / 素材 are one 制作 row; the pages keep their own ids */   /* t-hdr-trim ①: 信箱 moved here from the top bar (phone: same row in 更多) */   // t-settings-tab: 日志 / 文档 / 角色 moved into 设置
  const selK = STU.includes(UI.page) ? "studio" : UI.page, sew = UI.navSew !== selK; UI.navSew = selK;   /* t-thread-motif ②: the thread sews in only when the selection changes, not on every poll rebuild */
  $("#nav").innerHTML = navs.map(k => k === "sep" ? `<div class="nav-sep"></div>` :
    `<button class="nav-i ${selK === k ? "on" : ""} ${k === "urgent" && c.urgent ? "urgent" : ""}" data-go="${k}"${k === "ongoing" ? ` title="${esc(ogTip)}"` : ""}><span>${NAV_IC[k] ? `<i class="nv-ic" aria-hidden="true"><svg viewBox="0 0 24 24">${NAV_IC[k]}</svg></i>` : ""}<span class="nv-t">${t(k)}${selK === k ? `<svg class="nv-ul${sew ? " sew" : ""}" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="M1 3.6C20 2.2 40 4.4 60 3.2S88 2.6 96 3.4"/></svg><i class="nv-knot${sew ? " sew" : ""}" aria-hidden="true"></i>` : ""}</span></span>${k === "mail" ? (c.mail ? `<span class="n mb">${YARN}${c.mail > 99 ? "99+" : c.mail}</span>` : `<span class="n z"></span>`) : `<span class="n${c[k] === 0 ? " z" : ""}">${c[k] ?? ""}</span>`}</button>`).join("");

  // calendar
  const today = dayKey(new Date()), tmr = dayKey(new Date(Date.now() + 864e5));
  const evs = (ST.calendar || []).filter(e => e.date === today || e.date === tmr);
  // ri1103-P1: the team's fixed daily routines (meta.routines) join the user's own events, sorted by time; paused ones fold into one line.
  // ri1103-P2: meta.report_time comes from config.json report_time (server.py public_state); an older server sends none -> the row shows no time.
  const rts = (ST.meta && ST.meta.routines) || [], nowM = new Date().getHours() * 60 + new Date().getMinutes();
  const rtName = rtShort;   /* t-ri1109-a P4: shared with widgets.js (App.rtShort) */
  const rtLeft = hm => { const [h, m] = hm.split(":").map(Number), d = h * 60 + m - nowM; return d > 0 ? `${Math.floor(d / 60)}:${pad(d % 60)}${UI.lang === "en" ? "" : " 后"}` : null; };
  const rtRow = (tm, who, name, done, itemId, full) => {   /* t-ri1109-a P4: a dispatched row says only ✓ (the grey row already reads as done); the title carries time, full name and state */
    const left = !done && tm && rtLeft(tm), a = who && agent(who);
    const st = done ? "✓" : left || (tm ? (UI.lang === "en" ? "due" : "到点") : (UI.lang === "en" ? "tonight" : "今晚"));
    const tip = `${tm ? tm + " " : ""}${full || name} · ${done || st}`;
    return { k: "0" + (tm || "99"), done: !!done, a, tm, tip, h: `<div class="cal-i cal-rt ${done ? "past" : ""}"${itemId ? ` data-item="${esc(itemId)}"` : ""} title="${esc(tip)}"><span class="tm">${esc(tm || "—")}</span>${a ? av(a, "cal-av") : ""}<span class="cal-nm">${esc(name)}</span><span class="cal-st${left ? " soon" : ""}">${esc(st)}</span></div>` };
  };
  const itemOwner = id => { const it = (ST.items || []).find(x => x.id === id); return it && it.owner; };
  const rtLive = rts.filter(r => !r.paused && !r.disabled && r.time), rtOff = rts.filter(r => r.paused || r.disabled);
  const sent = UI.lang === "en" ? "sent" : "已派";
  const rtRows = rtLive.map(r => rtRow(r.time, itemOwner(r.item), rtName(r), r.last === today ? sent : "", r.item, rtFull(r)));
  for (const r of schToday()) rtRows.push(rtRow(r.time, (r.item && itemOwner(r.item)) || r.who, rtName(r), r.ran ? sent : "", r.item, rtFull(r)));   /* t-ri1110-a P2 */
  if (ST.meta) rtRows.push(rtRow(ST.meta.report_time || "", "manager", UI.lang === "en" ? "Daily report" : "日报", ST.meta.last_report_date === today ? (UI.lang === "en" ? "sent" : "已发") : "", ""));
  const nowHM = `${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`;
  $("#cal").classList.toggle("cal-empty", !evs.length && !rtRows.length && !UI.calForm);   // t-cal-fold: nothing today or tomorrow -> one faint row, "+" still there
  if (!evs.length && !rtRows.length && !UI.calForm) $("#cal").innerHTML = `<div class="side-h"><span>${t("today")} · ${UI.lang === "en" ? "none" : "无"}</span><button data-cal-add>+</button></div>`;
  else $("#cal").innerHTML = `<div class="side-h"><span>${t("today")} <span class="dim" style="font-weight:400">${evs.filter(e => e.date === today).length + rtRows.length} ${t("meetings")}</span></span><button data-cal-add>${UI.calForm ? "−" : "+"}</button></div>
    ${UI.calForm ? `<form class="cal-form" id="calf"><input name="title" placeholder="${UI.lang === "en" ? "What…" : "做什么…"}" required><input type="date" name="date" value="${today}"><input type="time" name="time"><button class="btn-s">${t("add")}</button></form>` : ""}
    ${calFold([...evs.map(e => ({ k: (e.date === tmr ? "1" : "0") + (e.time || "99"), h: `<div class="cal-i ${e.date === today && e.time && e.time < nowHM ? "past" : ""}"><span class="tm">${e.date === tmr ? "+1 " : ""}${esc(e.time || "—")}</span><span>${esc(e.title)}</span><button class="x" data-cal-del="${e.id}">✕</button></div>` })), ...rtRows,
      /* t-ri1114-a P5: the 「现在」 line sorts in at the current minute (between what has run and what is still to come), not under the list */
      { k: "0" + nowHM + "~", h: `<div class="cal-now ri14-now"><b>${UI.lang === "en" ? "Now" : "现在"}</b>${nowHM}</div>` }].sort((x, y) => x.k < y.k ? -1 : x.k > y.k ? 1 : 0))}
    ${rtOff.length ? `<div class="cal-off" title="${esc(rtOff.map(rtName).join("、"))}">${UI.lang === "en" ? "Paused" : "暂停"} ${rtOff.length}${UI.lang === "en" ? "" : " 项"} · ${esc(rtOff.map(rtName).join("、"))}</div>` : ""}`;
  const f = $("#calf");
  if (f) f.onsubmit = e => { e.preventDefault(); const fd = new FormData(f); api("calendar_add", Object.fromEntries(fd)); };

  $("#cal").classList.toggle("noev", !evs.length);   // ri1103-P1: routine rows carry their own countdown, so the clock rail stays for real events only   // t-web-audit 02: no events -> no empty time rail
  // team
  // ui1: rows animate in once (not on every poll re-render); the open chat's row is marked; unread mail shows a dot
  const teamFirst = !UI.teamIn; UI.teamIn = true; $("#team").classList.toggle("team-enter", teamFirst);
  /* t-ri1104-p2: TEAM rows use the same unread count as the chat (was: unread mail from that agent) */
  setSrc($("#team"), `<div class="side-h"><span class="sc">TEAM</span></div>` + agents().map((a, i) => {   // t-send-flicker: unchanged rail keeps its avatar rings running
    const ms = a.id === "manager" && mgrState();
    const st = ms ? (ms.on ? "working" : ms.sleep ? "sleeping" : "offline") : a.status || "idle";
    const sub = mgrOnline(a) ? (MOBQ.matches ? MGR_ON() : MGR_WATCH()) : a.status === "working" && a.activity ? `▶ ${esc(a.tool ? toolWhat(a) || a.activity : a.activity)}` : esc(aduty(a));   // t-now-closed
    return `<div class="team-i ${a.status === "working" && a.activity && !mgrOnline(a) ? "busy" : ""} ${a.enabled === false ? "disabled" : ""} ${UI.chat === a.id ? "on" : ""} ${unreadOf(a.id) && UI.chat !== a.id ? "unread" : ""}" style="--i:${Math.min(i, 12)}" data-chat="${a.id}">${av(a)}<div><div class="nm"><span class="nmt">${esc(aname(a))}</span><span class="st ${st}"${ms && ms.sleep ? ` title="${esc(ms.txt)}"` : ""}>${ms ? (ms.on ? t("online") : ms.sleep ? (ms.back ? `☾ ${ms.back}` : ms.txt) : t("offline")) : t(st)}</span>${unreadOf(a.id) && UI.chat !== a.id ? `<i class="tn">${unreadTag(unreadOf(a.id))}</i>` : ""}</div><div class="du">${qBadge(a.id)}${sub}</div></div></div>`;   /* t-hdr-trim ⑩: 排队 chip leads the second line, so name + status + count fit one line in zh and en */
  }).join(""));
}
document.addEventListener("click", e => {
  const g = e.target.closest("[data-go]"); if (g) { go(g.dataset.go); return; }
  const ch = e.target.closest("[data-chat]"); if (ch) { setChat(ch.dataset.chat); if (NARROWQ.matches && !MOBQ.matches) chatPop(true); return; }
  if (e.target.closest("[data-cal-add]")) { UI.calForm = !UI.calForm; renderLeft(); return; }
  const cd = e.target.closest("[data-cal-del]"); if (cd) { api("calendar_del", { id: cd.dataset.calDel }); return; }
  const aj = e.target.closest("[data-askjump]"); if (aj) { askJump(aj.dataset.askjump); return; }   /* t-ri1114-a P4 */
  const oi = e.target.closest("[data-item]"); if (oi && !e.target.closest("button")) { openItem(oi.dataset.item); return; }
});
const SET_TABS = ["general", "roles", "docs", "logs", "system"];
/* t-nav-shoot: the 制作 / Studio group. Each sub page keeps its id (#page=pipe etc. still work, wide layout unchanged); "studio" opens the last one used. */
const STU = ["pipe", "board", "channels", "assets"];
const STU_L = { pipe: ["制作线", "Pipeline"], board: ["委托板", "Board"], channels: ["频道", "Channels"], assets: ["素材", "Assets"] };
/* t-thread-motif: left rail icons (work/t-thread-motif/icons, 24 grid, stroke = currentColor); shown only under 特典 and only on desktop (CSS) */
const NAV_IC = {
  review: '<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-3.2a2 2 0 0 1 4 0V20"/>',
  main: '<path d="M7 6.5V13a5 5 0 0 0 10 0V6"/><circle cx="17" cy="4.2" r="1.7" fill="currentColor" stroke="none"/><path d="M3.5 13h17"/>',
  side: '<path d="M7 20.5V5.5"/><circle cx="7" cy="3.6" r="1.6" fill="currentColor" stroke="none"/><path d="M7 16c0-4.4 2.8-7 7-7h2.5"/><circle cx="18.6" cy="9" r="1.6" fill="currentColor" stroke="none"/>',
  daily: '<rect x="4" y="5.5" width="16" height="14.5" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/><path d="M10.2 12.6l3.6 3.6M13.8 12.6l-3.6 3.6"/>',
  urgent: '<circle cx="15" cy="9" r="3.6" fill="currentColor"/><path d="M12.4 11.6 4.5 19.5"/>',
  ongoing: '<circle cx="12" cy="12.5" r="8"/><path d="M12 8.2v4.5l3 1.8"/><path d="M5 4.2 3 6.2M19 4.2l2 2"/>',   /* t-schedule-ui: 定时 = clock */
  crew: '<circle cx="8.5" cy="8.5" r="2.8"/><circle cx="16.5" cy="9.5" r="2.3"/><path d="M3.5 19c.6-3.2 2.6-5 5-5s4.4 1.8 5 5"/><path d="M14.2 14.4c.7-.5 1.5-.8 2.3-.8 2 0 3.5 1.5 4 4.4"/>',   /* t-rb-build: 团队 = two people */
  market: '<rect x="4" y="7" width="16" height="12.5" rx="2"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7"/><path d="M4 12.5h16"/><path d="M11 12.5v1.6h2v-1.6"/>',   /* t-hm-build: 招聘市场 = briefcase */
  studio: '<path d="M3 9.8A1.8 1.8 0 0 1 4.8 8h2.4l1.6-2.5h6.4L16.8 8h2.4A1.8 1.8 0 0 1 21 9.8v8.4a1.8 1.8 0 0 1-1.8 1.8H4.8A1.8 1.8 0 0 1 3 18.2z"/><circle cx="12" cy="13.6" r="3.4"/><path d="M12 13.6v.01"/>',
  reports: '<path d="M6 3.5h8l4.5 4.5v12.5H6z"/><path d="M14 3.5V8h4.5"/><path d="M8.6 17l2.4-3 2 1.6 2-2.6"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3.8 7.2l8.2 6.3 8.2-6.3"/>',
  settings: '<path d="M3.5 8h3.2M11.3 8h9.2M3.5 16h9.2M17.3 16h3.2"/><circle cx="9" cy="8" r="2.3"/><circle cx="15" cy="16" r="2.3"/>',
};
function stuTabs(k) {   /* same segmented control as 设置 */
  const en = UI.lang === "en";
  return `<div class="st-tabs stu-tabs"><div class="seg" data-seg="stutab" role="tablist">${STU.map(x => `<button type="button" class="seg-i ${x === k ? "on" : ""}" role="tab" aria-selected="${x === k}" data-stutab="${x}">${STU_L[x][en ? 1 : 0]}</button>`).join("")}</div></div>`;
}
wireReview();
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
// ---------- t-imp-p4: 系统状态 panel (replaces the old 体力 modal; desktop orb / SYNC row, phone orb / 菜单 row) ----------
// Server-side facts come from /api/health (cached, not in /api/state). Before the server restart that adds it,
// those rows are hidden and a one-line note says why.
const HL = { data: null, at: 0, missing: false, busy: null };
function loadHealth(maxAge = 0) {
  if (HL.busy) return HL.busy;
  if (maxAge && Date.now() - HL.at < maxAge) return null;   // fresh enough: nothing fetched (callers must not re-render then)
  HL.busy = fetch("/api/health").then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(d => { HL.data = d; HL.missing = false; }, () => { HL.data = null; HL.missing = true; })
    .finally(() => { HL.at = Date.now(); HL.busy = null; });
  return HL.busy;
}
const gb = n => n >= 1e12 ? (n / 1e12).toFixed(1) + " TB" : n >= 1e9 ? Math.round(n / 1e9) + " GB" : Math.round(n / 1e6) + " MB";
function upTxt(sec) {
  const en = UI.lang === "en", d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
  if (en) return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
  return d ? `${d} 天 ${h} 小时` : h ? `${h} 小时 ${m} 分` : `${m} 分钟`;
}
// one row per system: {k, lv: ok|warn|bad|unk, t, s, act?}
function statusRows() {
  const en = UI.lang === "en", U = usage(), H = HL.data, rows = [];
  // 1. usage data (the bars are drawn above the rows)
  rows.push({ k: "usage", t: en ? "Usage data" : "用量数据",
    lv: U.none ? "unk" : U.stale || U.lost5 ? "warn" : "ok",
    s: U.none ? (en ? "Not connected yet" : "还没接入")
      : (en ? `${hm(U.at)} · ${U.age}${U.stale ? " · may be out of date" : ""}` : `${hm(U.at)} 读取 · ${U.age}${U.stale ? " · 可能已过期" : ""}`) + ` · ${usageSrc(U.src)}`,
    act: U.none ? null : { k: "usage", l: en ? "Ask to refresh" : "叫管家刷新" } });
  // 2. manager heartbeat
  const m = mgrState(), ma = agent("manager");
  rows.push({ k: "mgr", t: en ? "Manager heartbeat" : "管家心跳", lv: m.on ? "ok" : m.sleep ? "warn" : "bad",
    s: (m.since ? `${m.txt} · ${en ? "last seen" : "最后心跳"} ${hm(m.since)}（${ageTxt(m.since)}）` : m.txt)
      + ` · ${en ? "inbox" : "信箱待处理"} ${ST.meta.inbox_unacked || 0}` + (ma.activity && m.on ? ` · ${ma.activity}` : "") });
  // 3. dashboard server (needs /api/health)
  if (H) {
    const sv = H.server, sc = H.schema, ahead = !!(sc && sc.ahead && sc.ahead.length);   /* t-oss-struct E1: data schema; ahead = data from a newer version (after a rollback) */
    rows.push({ k: "srv", t: en ? "Dashboard server" : "看板服务器", lv: sv.loops && !ahead ? "ok" : "warn",
      s: (en ? `up ${upTxt(sv.uptime)} · started ${hm(sv.started)}` : `已运行 ${upTxt(sv.uptime)} · ${hm(sv.started)} 启动`) + ` · rev ${sv.rev}` + (sv.loops ? "" : (en ? " · background loops off" : " · 后台循环未开（测试模式）"))
        + (sc ? (ahead ? (en ? ` · data from a newer version (schema ${sc.state}, this code ${sc.code})` : ` · 数据来自较新版本（数据 v${sc.state}，代码 v${sc.code}）`) : ` · ${en ? "data" : "数据"} v${sc.state}`) : "") });
  }
  // 4. ComfyUI tunnel (already in /api/state)
  const c = (H && H.comfy) || ST.meta.comfy || {};
  if (c.configured !== false) rows.push({ k: "comfy", t: "ComfyUI", lv: c.online ? "ok" : c.online === false ? "warn" : "unk",
    s: (c.online ? (en ? "Tunnel up" : "隧道已连") : c.online === false ? (en ? "Tunnel down · image jobs will wait" : "隧道未连 · 出图会排队") : (en ? "Not probed yet" : "还没探测"))
      + (c.at ? ` · ${en ? "checked" : "探测于"} ${ageTxt(c.at)}` : "") });
  // 5. push (needs /api/health; this device's own state comes from push.js)
  if (H) {
    const p = H.push, me = window.Push ? Push.status() : null, ok = p.last_code >= 200 && p.last_code < 300;
    rows.push({ k: "push", t: en ? "Push" : "推送",
      lv: !p.devices ? "warn" : p.failing ? "bad" : "ok",
      s: (p.devices ? (en ? `${p.devices} device${p.devices > 1 ? "s" : ""} subscribed` : `${p.devices} 台设备已订阅`) : (en ? "No device subscribed" : "没有设备订阅"))
        + (p.last_at ? ` · ${en ? "last send" : "上次发送"} ${hm(p.last_at)}（${ok ? (en ? "delivered" : "已送达推送服务") : `HTTP ${p.last_code}`}）` : "")
        + (p.failing ? (en ? ` · ${p.failing} failing` : ` · ${p.failing} 台失败`) : "")
        + (me && matchMedia("(max-width: 760px)").matches ? ` · ${en ? "this phone" : "本机"}：${me.label}` : "") });
  }
  // 6. daily report
  const today = dayKey(new Date()), rt = (H && H.report && H.report.time) || "18:00", last = ST.meta.last_report_date;
  const due = new Date(`${today}T${rt}`) <= new Date();
  rows.push({ k: "report", t: en ? "Daily report" : "日报",
    lv: last === today ? "ok" : due ? "warn" : "ok",
    s: last === today ? (en ? "Today's report is in" : "今天的已写好")
      : (en ? `Last: ${last || "never"} · today's ${due ? "is late (due " + rt + ")" : "due " + rt}` : `最近一份 ${last || "没有"} · 今天 ${rt} ${due ? "已到点，还没写" : "待写"}`) });
  // 7. disk (needs /api/health)
  if (H && H.disk) {
    const d = H.disk, pct = d.free / d.total;
    rows.push({ k: "disk", t: en ? "Disk" : "磁盘", lv: d.free < 10e9 || pct < .05 ? "bad" : d.free < 30e9 || pct < .1 ? "warn" : "ok",
      s: (en ? `${gb(d.free)} free of ${gb(d.total)}` : `剩 ${gb(d.free)} / 共 ${gb(d.total)}`) + (d.work != null ? ` · work/ ${gb(d.work)}` : "") });
  }
  // 8. extensions (t-oss-struct S8, needs /api/health): only when one is skipped, broken or on the old (pre-manifest) way, plus rows an extension adds
  if (H && H.ext && H.ext.extensions) {
    const X = H.ext.extensions, bad = X.filter(e => e.skipped || e.error), old = X.filter(e => e.legacy && !e.skipped && !e.error);
    if (bad.length || old.length) rows.push({ k: "ext", t: en ? "Extensions" : "扩展", lv: bad.length ? "warn" : "ok",
      s: [bad.length && (en ? `not loaded: ${bad.map(e => e.name).join(", ")}` : `没有加载：${bad.map(e => e.name).join("、")}`),
        old.length && (en ? `old style (no ext.json, works until 0.3.0): ${old.map(e => e.name).join(", ")}` : `旧写法（没有 ext.json，0.3.0 前还能用）：${old.map(e => e.name).join("、")}`)].filter(Boolean).join(" · ") });
  }
  if (window.UTExt) UTExt.statusRows(en).forEach((r, i) => rows.push({ k: "x" + i, t: r.t, s: r.s || "", lv: ["ok", "warn", "bad"].includes(r.lv) ? r.lv : "ok" }));
  return rows;
}
function statusSummary(rows) {
  const en = UI.lang === "en", w = rows.filter(r => r.lv === "warn").length, b = rows.filter(r => r.lv === "bad").length;
  if (!w && !b) return { lv: "ok", txt: en ? "All good" : "一切正常" };
  return { lv: b ? "bad" : "warn", txt: [w && (en ? `${w} to watch` : `${w} 项要留意`), b && (en ? `${b} down` : `${b} 项断开`)].filter(Boolean).join(" · ") };
}
function statusHTML() {
  const en = UI.lang === "en", U = usage(), rows = statusRows(), sm = statusSummary(rows);
  const bar = (label, v, sub, est) => `<div class="sy-u${v == null ? " nil" : ""}"><span>${label}</span><b>${v == null ? "—" : `${est ? `<i class="sy-est">${en ? "est" : "估"}</i>` : U.stale ? "≈" : ""}${v}<small>%</small>`}</b><div class="sy-bar"><i style="width:${v ?? 0}%"></i></div><em>${sub || ""}</em></div>`;
  const bars = U.none
    ? `<div class="sy-setup md"><p>${en ? "No usage yet. Make <code>tools/statusline.py</code> the manager's statusLine:" : "还没有用量数据。把 <code>tools/statusline.py</code> 配成管家 session 的 statusLine："}</p>
       <pre class="code"><code>{"statusLine": {"type": "command", "command": "python3 tools/statusline.py"}}</code></pre></div>`
    : `<div class="sy-use${U.stale ? " old" : ""}">`
      + bar(en ? "5-hour window" : "5 小时窗口", U.left, U.lost5 ? (en ? "Reset after the last reading · estimated near full until new data" : "上次读数之后已重置 · 估计接近回满，等新数据")
          : U.reset5 ? (en ? `used ${U.used5}% · full at ${U.at5}` : `已用 ${U.used5}% · ${U.at5} 复活`) : "", U.approx)
      + bar(en ? "This week" : "本周", U.week, U.lostW ? (en ? "Reset after the last reading · estimated near full" : "上次读数之后已重置 · 估计接近回满")
          : U.resetW ? (en ? `used ${U.usedW}% · resets ${U.atW}` : `已用 ${U.usedW}% · ${U.atW} 重置`) : "", U.approxW)
      + (U.context != null ? bar(en ? "Manager context" : "管家上下文", 100 - U.context, en ? "left before compaction" : "剩余上下文") : "")
      + (U.stale ? `<div class="sy-stale">${en ? `As of ${hm(U.at)} · ${U.age} · ${U.why}` : `${hm(U.at)} 的数据 · ${U.age} · ${U.why}`}</div>` : "")
      + `</div>`;
  const list = rows.map(r => `<div class="sy-row ${r.lv}"><i class="sy-dot"></i><div class="sy-m"><b>${esc(r.t)}</b><span>${esc(r.s)}</span></div>${r.act ? `<button type="button" class="sy-btn" data-sy="${r.act.k}">${esc(r.act.l)}</button>` : ""}</div>`).join("");
  const note = HL.missing ? `<p class="sy-note">${en ? "Server, push and disk rows appear after the dashboard server restarts (new /api/health)." : "看板服务器、推送、磁盘这几行，要等看板重启（新接口 /api/health）后才显示。"}</p>` : "";
  return `<div class="sy-hd"><h3>${en ? "System status" : "系统状态"}</h3><span class="sy-sum ${sm.lv}">${sm.txt}</span><button type="button" class="sy-x" data-x aria-label="${en ? "Close" : "关闭"}">${en ? "Done" : "完成"}</button></div>`
    + bars + `<div class="sy-ru"><h4>${en ? "Usage by role · today" : "各角色用量 · 今天"}</h4>${ruHTML(99, { tot: true })}</div>` + `<div class="gt" id="gt"></div>` + `<div class="sy-list">${list}</div>` + note;   // t-dash-token: #gt is filled by ghPaint() and survives repaints
}
function modalStatus() {
  openModal(statusHTML(), m => {
    m.classList.remove("frame"); m.classList.add("sys");
    const paint = () => { if (!m.isConnected) return; const h = statusHTML(); if (m._html === h) return;
      const st = m.scrollTop, g = $("#gt", m), a = document.activeElement, had = m === a || m.contains(a), key = had && a !== m ? refSel(a) : "";
      m.innerHTML = m._html = h; if (g) $("#gt", m).replaceWith(g); m.scrollTop = st;
      /* t-ui-fix-r6 R6-05: the swap dropped focus to BODY (right after open, and every 15 s); put it back on the same control, else the first one */
      if (had && !m.contains(document.activeElement)) { const t = (a && m.contains(a) && a) || (key && $(key, m)) || m.querySelector(FOCUSABLE); try { if (t) t.focus({ preventScroll: true }); else { m.tabIndex = -1; m.focus({ preventScroll: true }); } } catch (_) { } } };   // t-dash-token: keep the #gt node (a half-typed token)
    m.addEventListener("click", e => {
      if (e.target.closest("[data-x]")) return closeModal();
      const b = e.target.closest("[data-sy]"); if (!b) return;
      if (b.dataset.sy === "usage") { b.disabled = true; api("ping", { note: UI.lang === "en" ? "refresh usage" : "刷新用量" }).then(() => toast(UI.lang === "en" ? "Asked the manager to refresh usage" : "已请管家刷新用量")); }
    });
    loadHealth().then(paint);
    ghPaint(); ghLoad().then(ghPaint);
    const tick = setInterval(() => { if (!m.isConnected) return clearInterval(tick); loadHealth().then(paint); }, 15000);
    m._paint = paint;
  });
}
hooks.push(k => { if (k !== "all") return; const m = $("#modal .mdl.sys"); if (m && m._paint) m._paint(); });

// ===== t-dash-token: GitHub push token block in 系统状态 (desktop; the phone opens it from 设置 and ⌘K too).
// The page sends the token once (POST /api/secret/github, own header X-Underthread) and never gets it back: the API returns status only.
// The block is a node of its own (#gt) that modalStatus's 15 s repaint keeps, so a half-typed token is never wiped. =====
const GT = { st: null, old: false, busy: false, msg: "", lv: "", replace: false, confirmFile: false, loading: null };
const gz = (zh, e) => UI.lang === "en" ? e : zh;   /* t-i18n-a: zh text unchanged */
async function ghLoad() {
  if (GT.loading) return GT.loading;
  GT.loading = (async () => {
    try { const r = await fetch("/api/secret/github", { cache: "no-store" }); if (r.status === 404) GT.old = true; else if (r.ok) { GT.st = await r.json(); GT.old = false; } } catch (_) { }
    GT.loading = null;
  })();
  return GT.loading;
}
async function ghApi(op, extra) {
  try {
    const r = await fetch("/api/secret/github", { method: "POST", headers: { "Content-Type": "application/json", "X-Underthread": "1" }, body: JSON.stringify({ op, ...(extra || {}) }) });
    if (r.status === 404) { GT.old = true; return { ok: false, j: {} }; }
    let j = {}; try { j = await r.json(); } catch (_) { }
    if (j.status) GT.st = j.status;
    return { ok: r.ok && j.ok !== false, j };
  } catch (_) { return { ok: false, j: { error: UI.lang === "en" ? "Dashboard server unreachable" : "连不上看板服务器" } }; }
}
const ghWhen = s => { if (!s) return ""; const d = new Date(String(s).replace(" UTC", "Z").replace(" ", "T")); return isNaN(d) ? "" : `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const ghWhenT = s => { if (!s) return ""; const d = new Date(s); return isNaN(d) ? "" : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
function ghSoon(S) { if (!S || !S.expires) return false; const d = new Date(String(S.expires).replace(" UTC", "Z").replace(" ", "T")); return !isNaN(d) && d - Date.now() < 7 * 864e5; }
function ghLabel() {
  const en = UI.lang === "en", S = GT.st;
  if (!S && !GT.old) { ghLoad().then(() => document.dispatchEvent(new Event("gh:status"))); return "…"; }
  if (GT.old) return en ? "Needs a dashboard restart" : "看板重启后可用";
  if (!S.configured) return en ? "Not set" : "未配置";
  return (S.ok === false ? (en ? "Set · not working" : "已配置 · 失效") : ghSoon(S) ? (en ? "Set · expires soon" : "已配置 · 快到期") : (en ? "Set" : "已配置")) + (S.method === "file" ? (en ? " · local file" : " · 本机文件") : "");
}
function ghProbeLine(pr) {
  if (!pr) return "";
  const t = ghWhenT(pr.at), code = pr.code ? `（${pr.code}）` : "";
  if (UI.lang === "en") {
    const c = pr.code ? ` (${pr.code})` : "";
    if (pr.verdict === "ok") return `<p class="gt-pr ok">● Keychain works: the dashboard server can write, read and delete (checked ${t})</p>`;
    if (pr.verdict === "locked") return `<p class="gt-pr bad">● Keychain is locked${c}: the dashboard server runs in the background and can't store into it. Fix: on the Mac open Keychain Access, set the "login" keychain password to your login password, then check again; or use a local file instead. (checked ${t})</p>`;
    if (pr.verdict === "nohelper") return `<p class="gt-pr bad">● git's keychain helper (git-credential-osxkeychain) is missing (checked ${t})</p>`;
    return `<p class="gt-pr bad">● Keychain test failed${c}: write ${pr.write ? "✓" : "✗"} · read ${pr.read ? "✓" : "✗"} · delete ${pr.erase ? "✓" : "✗"} (checked ${t})</p>`;
  }
  if (pr.verdict === "ok") return `<p class="gt-pr ok">● 钥匙串可用：看板服务器能写、能读、能删（${t} 检测）</p>`;
  if (pr.verdict === "locked") return `<p class="gt-pr bad">● 钥匙串锁着${code}：看板服务器在后台，存不进去。办法：在 Mac 上打开「钥匙串访问」，把「登录」钥匙串的密码改成和开机密码一样，再点一次检测；或者改用本机文件。（${t} 检测）</p>`;
  if (pr.verdict === "nohelper") return `<p class="gt-pr bad">● 找不到 git 的钥匙串助手（git-credential-osxkeychain）（${t} 检测）</p>`;
  return `<p class="gt-pr bad">● 钥匙串测试没通过${code}：写 ${pr.write ? "✓" : "✗"} · 读 ${pr.read ? "✓" : "✗"} · 删 ${pr.erase ? "✓" : "✗"}（${t} 检测）</p>`;
}
function ghHTML() {
  const en = UI.lang === "en", S = GT.st, B = (k, l, c) => `<button type="button" class="gt-b ${c || ""}" data-gt="${k}"${GT.busy ? " disabled" : ""}>${l}</button>`;
  const head = (tag, cls) => `<h4>${en ? "GitHub push token" : "GitHub 推送令牌"} <em class="${cls || ""}">${tag}</em></h4>`;
  if (GT.old) return head(gz("要重启", "Restart needed"), "warn") + `<p>${gz("看板服务器重启以后才能用（新接口还没加载）。", "Works after the dashboard server restarts (the new API isn't loaded yet).")}</p>`;
  if (!S) return head("…") + `<p>${gz("读取中…", "Loading…")}</p>`;
  const file = S.method === "file", repo = esc(S.repo || "owner/underthread"), pr = S.probe;
  const msg = GT.msg ? `<p class="gt-msg ${GT.lv}">${esc(GT.msg)}</p>` : "";
  const where = file ? gz("本机文件（明文，600）", "a local file (plain text, 600)") : gz("钥匙串", "the keychain");
  if (GT.confirmFile) return head(gz("改用本机文件？", "Use a local file?"), "warn")
    + (en ? `<p>The token will be stored in plain text in <code>~/.config/underthread/git-credentials</code>, mode 600, readable only by your account; but any program running as you can read it too. It applies to github.com only, and adds two lines to git's global config.</p>` : `<p>令牌会明文存在 <code>~/.config/underthread/git-credentials</code>，权限 600，只有你的账号能读；但以你的身份运行的任何程序也都能读到。只对 github.com 生效，git 的全局配置里会加两行。</p>`)
    + `<div class="gt-r">${B("file_yes", gz("确定改用本机文件", "Yes, use a local file"), "pri")}${B("file_no", gz("算了", "Never mind"))}</div>`;
  if (!S.configured || GT.replace) {
    const offer = pr && pr.verdict !== "ok" && !file ? B("file", gz("改用本机文件…", "Use a local file…")) : "";
    return head(S.configured ? gz("换一个", "Replace") : gz("未配置", "Not set"))
      + (en ? `<p>Once set, the manager can push ${repo} without asking you for a token. The token stays on this Mac only (${file ? "local file" : "keychain"}); neither the dashboard nor the phone can read it back.</p>` : `<p>配好以后，管家推送 ${repo} 不用你再输令牌。令牌只存在这台 Mac 上（${file ? "本机文件" : "钥匙串"}），看板和手机都拿不回来。</p>`)
      + (file ? "" : ghProbeLine(pr))
      + `<div class="gt-r"><input type="password" class="gt-in" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="${gz("粘贴 github_pat_…（只用一次）", "Paste github_pat_… (used once)")}" aria-label="${gz("GitHub 令牌", "GitHub token")}"${GT.busy ? " disabled" : ""}>${B("set", GT.busy ? gz("验证中…", "Checking…") : gz("保存并验证", "Save and verify"), "pri")}</div>`
      + `<div class="gt-r">${file ? B("keychain", gz("改回钥匙串", "Back to keychain")) : B("probe", pr ? gz("再检测一次", "Check again") : gz("检测钥匙串", "Check keychain"))}${offer}${GT.replace ? B("cancel", gz("取消", "Cancel")) : ""}</div>`
      + msg + `<small>${en ? `Tip: a fine-grained token with only Contents read/write on ${repo}, expiring in 90 days` : `建议：细粒度令牌，只勾 ${repo} 的 Contents 读写，90 天到期`}</small>`;
  }
  const nt = S.note ? gz("：", ": ") + esc(S.note) : "";
  const st = S.ok === true ? `<span class="ok">● ${gz("可用", "Working")}</span>` : S.ok === false ? `<span class="bad">● ${gz("失效", "Not working")}${nt}</span>` : `<span class="warn">● ${gz("没验证", "Not verified")}${nt}</span>`;
  const bits = (en ? [st, S.user ? `account ${esc(S.user)}` : "", `stored in ${where}`, S.set_at ? `set ${ghWhenT(S.set_at)}` : "", S.expires ? `expires ${ghWhen(S.expires)}` : ""]
    : [st, S.user ? `账号 ${esc(S.user)}` : "", `存在${where}`, S.set_at ? `${ghWhenT(S.set_at)} 配置` : "", S.expires ? `${ghWhen(S.expires)} 到期` : ""]).filter(Boolean).join(" · ");
  return head(gz("已配置", "Set"), S.ok === false ? "bad" : ghSoon(S) ? "warn" : "ok") + `<p>${bits}</p>` + (file ? "" : ghProbeLine(pr))
    + `<div class="gt-r">${B("replace", gz("换一个", "Replace"))}${B("test", gz("测试推送权限", "Test push access"))}${file ? B("keychain", gz("改回钥匙串", "Back to keychain")) : B("probe", gz("检测钥匙串", "Check keychain"))}${B("erase", gz("删除", "Delete"), "dn")}</div>` + msg;
}
function ghPaint() { const el = $("#modal #gt"); if (el) el.innerHTML = ghHTML(); document.dispatchEvent(new Event("gh:status")); }   // the phone 设置 row re-reads its label
async function ghDo(k, el) {
  const say = (m, lv) => { GT.msg = m || ""; GT.lv = lv || ""; };
  if (k === "cancel") { GT.replace = false; say(""); return ghPaint(); }
  if (k === "replace") { GT.replace = true; say(""); ghPaint(); const i = $("#modal #gt .gt-in"); if (i) i.focus(); return; }
  if (k === "file") { GT.confirmFile = true; return ghPaint(); }
  if (k === "file_no") { GT.confirmFile = false; return ghPaint(); }
  if (k === "erase" && !confirm(gz("删除存好的 GitHub 令牌？之后推送又要你输令牌。", "Delete the stored GitHub token? Pushes will ask you for a token again."))) return;
  let tok = null;
  if (k === "set") {
    const i = el.closest("#gt").querySelector(".gt-in"); tok = i ? i.value.trim() : ""; if (i) i.value = "";
    if (!tok) { say(gz("先把令牌粘贴进框里", "Paste the token into the box first"), "bad"); return ghPaint(); }
  }
  GT.busy = true; say(""); ghPaint();
  const op = k === "file_yes" ? "use_file" : k === "keychain" ? "use_keychain" : k;
  const r = await ghApi(op, k === "set" ? { token: tok } : k === "file_yes" ? { confirm: true } : null);
  tok = null; GT.busy = false;
  if (k === "file_yes") GT.confirmFile = false;
  if (r.ok) {
    if (k === "set") { GT.replace = false; say(GT.st && GT.st.ok === false ? gz("存好了，但 GitHub 说：", "Saved, but GitHub says: ") + (GT.st.note || gz("不能推送", "can't push")) : gz("存好了，管家以后推送不用你再输令牌", "Saved. The manager can push without asking you for a token now"), GT.st && GT.st.ok === false ? "bad" : "ok"); }
    else if (k === "probe") say("");
    else if (k === "test") say(GT.st && GT.st.ok ? gz("能推送 ✓", "Can push ✓") : gz("不能推送：", "Can't push: ") + ((GT.st && GT.st.note) || ""), GT.st && GT.st.ok ? "ok" : "bad");
    else if (k === "erase") say(gz("删掉了", "Deleted"), "ok");
    else if (k === "file_yes") say(gz("改用本机文件了，把令牌粘贴进来保存", "Switched to a local file; paste the token to save it"), "");
    else if (k === "keychain") say(gz("改回钥匙串了，本机文件已删除；把令牌重新粘贴进来", "Back to the keychain, local file deleted; paste the token again"), "");
  } else say(srvT((r.j && r.j.error) || gz("没成功", "Didn't work")), "bad");
  if (!r.j || !r.j.status) await ghLoad();
  ghPaint();
}
document.addEventListener("click", e => { const b = e.target.closest("#modal #gt [data-gt]"); if (b && !b.disabled) { e.preventDefault(); ghDo(b.dataset.gt, b); } });
document.addEventListener("keydown", e => { if (e.key === "Enter" && !e.isComposing && e.target.closest && e.target.closest("#modal #gt .gt-in")) { e.preventDefault(); const b = $("#modal #gt [data-gt=set]"); if (b && !b.disabled) ghDo("set", b); } });
function ghOpen() { modalStatus(); setTimeout(() => { const g = $("#modal #gt"); if (g) g.scrollIntoView({ block: "center", behavior: "smooth" }); }, 250); }


// ===== t-new-ver: the page keeps running the JS/CSS it loaded; after a web/ release (?v bump in index.html) it says so with a pill.
// Checks when the page comes back to the foreground and every 5 min while visible; never reloads on its own (drafts survive anyway). =====
const VER = { mine: "", t: 0, shown: false };
/* S9: the server stamps <meta name="ut-build"> (a hash of the whole page: every file's ?v= and the import map); an older server has none,
   so fall back to the list of ?v= script / stylesheet URLs */
const verSig = html => { const b = /<meta name="ut-build" content="(\w+)"/.exec(String(html)); return b ? "b:" + b[1] : (String(html).match(/\/static\/[\w.-]+\.(?:js|css)\?v=[\w.]+/g) || []).sort().join(" "); };
const verMine = () => VER.mine || (VER.mine = (m => m ? "b:" + m.content : verSig([...document.querySelectorAll("script[src],link[rel=stylesheet][href]")].map(e => e.getAttribute("src") || e.getAttribute("href")).join(" ")))(document.querySelector('meta[name="ut-build"]')));   // read after load: the scripts below app.js are not parsed yet when it runs
async function verCheck(force) {
  if (document.readyState !== "complete") return;
  if (VER.shown || !verMine() || document.visibilityState !== "visible" || (!force && Date.now() - VER.t < 60e3)) return;
  VER.t = Date.now();
  try { const r = await fetch("/", { cache: "no-store" }); if (!r.ok) return; const sig = verSig(await r.text()); if (sig && sig !== VER.mine) verShow(); } catch (_) { }
}
function verShow() {
  if (VER.shown) return; VER.shown = true; const en = UI.lang === "en";
  const b = document.createElement("button"); b.type = "button"; b.id = "newver";
  b.innerHTML = `<i aria-hidden="true"></i>${en ? "Dashboard updated" : "看板更新了"}<b>${en ? "Tap to reload" : "点一下刷新"}</b>`;
  b.addEventListener("click", () => location.reload()); document.body.appendChild(b);
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") verCheck(); });
setInterval(() => verCheck(true), 5 * 60e3);

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

export { render, workersOf, syncPaint, renderMailbox, renderChrome, doneMailRead, toolBadge, STU, renderLeft, MB, closeMailbox, attTitle, ATT_IC, attTiles, wireUploads, hooks, typingOn, typingUntil, mgrState, unreadOf, unreadTag, seenOf, attHTML, chatMailRead, RMQ, ATT, nrMail, nrRead, itemMailRead, wkTag, copyText, stuTabs, wkAttr, wkFx, nrDot, mailPv, wkFrom, nrBlock, logRows, logText, mailRep, liveItem, mailFiltered, mailGroups, mailRow, homeCounts, ruCard, renderHeader, newReplies, isAudioAtt, fmtDur, vmHTML, vmSync, vmBars, mgrOnline, dcDur, MGR_ON, SET_TABS, loadHealth, statusSummary, statusRows, loadRoleUsage, ghOpen, ghLabel, ruHTML };
