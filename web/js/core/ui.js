// Dashboard core: toast, api / postAct (POST /api/action), uploads, empty states and the modal (open / close / focus trap / reject).
// t-oss-struct S10 (A2): moved out of app.js unchanged.

// Ornaments live in fx.js; pathLength=1 lets CSS draw them in.
import { $, DRAFT } from "./util.js";
import { srvT, t } from "./i18n.js";
import { ST, UI, poll } from "./store.js";
import { annClear, annWrap } from "../views/drawer.js";
import { openAsks } from "../views/pages/review.js";
function orn(w = 200) { return window.ORN.divider(w); }
/* t-thread-motif ④: empty state with a spool drawing. The art and the headline are hidden by CSS unless html[data-ut] (特典), so other themes render exactly the old text.
   cls = the old class list (kept), h = headline override (search uses its own). */
const UE_ART = '<svg class="ue-art" viewBox="0 0 96 72" aria-hidden="true"><path class="ue-sp" d="M16 13h28M16 59h28M20 13v46M40 13v46"/><path class="ue-wd" d="M20 22l20-6M20 30l20-6M20 38l20-6M20 46l20-6"/><path class="ue-th" d="M40 46c8 2 16 8 26 6s12-12 12-22"/><path class="ue-nd" d="M78 30l3-22"/><ellipse class="ue-nd" cx="81.6" cy="6.4" rx="1.6" ry="2.6" transform="rotate(8 81.6 6.4)"/></svg>';
function utEmpty(text, cls = "empty", h) {
  const zh = UI.lang !== "en";
  return `<div class="${cls} ue">${UE_ART}<b class="ue-h">${h || (zh ? "线头都收好了" : "All threads tied off")}</b><span class="ue-t">${text}</span></div>`;
}
function toast(msg, err) {
  const el = $("#toast"); el.textContent = srvT(msg); el.className = err ? "err" : ""; el.style.translate = el.style.opacity = el.style.transition = ""; el.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => el.hidden = true, 2600);
}
async function postAct(kind, body = {}) {   // t-perf C: the bare POST (no toast, no poll); api() and the optimistic chat send share it
  const r = await fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, ...body }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
async function api(kind, body = {}) {
  try {
    const j = await postAct(kind, body);
    await poll(true);
    return j;
  } catch (e) { toast(String(e.message || e), true); throw e; }
}
// Raw bytes straight to disk (no base64), with real progress: big footage from the phone works.
function upload(file, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", "/api/upload/raw?name=" + encodeURIComponent(file.name || "paste.png"));
    x.setRequestHeader("Content-Type", "application/octet-stream");
    /* t-csrf-live: server.py refuses browser POSTs without X-Underthread */
    x.setRequestHeader("X-Underthread", "1");
    x.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    x.onload = () => {
      let j = {}; try { j = JSON.parse(x.responseText); } catch { }
      if (x.status === 200 && j.path) resolve(j.path); else { toast(j.error || `upload failed (${x.status})`, true); reject(new Error(j.error)); }
    };
    x.onerror = () => { toast(UI.lang === "en" ? "Upload failed: connection lost" : "上传失败：连接中断", true); reject(new Error("network")); };
    x.send(file);
  });
}
const fmtSize = b => b > 1 << 30 ? (b / (1 << 30)).toFixed(1) + " GB" : b > 1 << 20 ? Math.round(b / (1 << 20)) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
// Chips for a composer's attachments: finished files, plus anything still uploading with its percentage.
function attChips(pending) {
  const done = pending.map(p => `<span class="att-chip">📎 ${esc(p.split("/").pop().replace(/^\d{8}-\d{6}-[0-9a-f]{4}-/, ""))}</span>`);
  const up = Object.values(pending._up || {}).map(u => `<span class="att-chip up" style="--p:${Math.round(u.p * 100)}%">⇡ ${esc(u.name)} <b>${Math.round(u.p * 100)}%</b> <small>${u.size}</small></span>`);
  return done.concat(up).join("");
}
const stillUploading = pending => Object.keys(pending._up || {}).length > 0;

// ---------- modals ----------
// R4-11: the modal keeps keyboard focus inside it (Tab / Shift+Tab wrap) and hands it back to whatever opened it on close
const MODAL = { from: null, sel: "" };
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
function focusTrap(box, e) {
  if (e.key !== "Tab") return;
  const f = [...box.querySelectorAll(FOCUSABLE)].filter(x => x.offsetParent !== null || x === document.activeElement);
  if (!f.length) { e.preventDefault(); return; }
  const first = f[0], last = f[f.length - 1], cur = document.activeElement;
  if (!box.contains(cur)) { e.preventDefault(); first.focus(); }
  else if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
}
/* t-ui-fix-r6 R6-05: the opener is also remembered by its first data-* attribute (like R5-03), because the page behind a dialog can
   re-render (设置 → 系统 repaints on loadHealth) and leave the saved node detached; closeModal then finds the new row */
const refSel = el => { const a = el && el.attributes ? [...el.attributes].find(x => x.name.startsWith("data-")) : null; return el && el.id ? "#" + CSS.escape(el.id) : a ? `[${a.name}${a.value ? `="${CSS.escape(a.value)}"` : ""}]` : ""; };
function openModal(html, onMount) { cfDrop(); const m = $("#modal"); if (m.hidden) { MODAL.from = document.activeElement !== document.body ? document.activeElement : null; MODAL.sel = refSel(MODAL.from); }
  m.innerHTML = `<div class="mdl frame" role="dialog" aria-modal="true">${html}</div>`; m.hidden = false; onMount && onMount($(".mdl", m));
  const box = $(".mdl", m); if (box && !box.contains(document.activeElement)) { const f = box.querySelector(FOCUSABLE); if (f) f.focus(); else { box.tabIndex = -1; box.focus(); } } }
function closeModal() { cfDrop(); $("#modal").hidden = true; $("#modal").innerHTML = "";
  let f = MODAL.from; const sel = MODAL.sel; MODAL.from = MODAL.sel = null;
  if ((!f || !f.isConnected) && sel) f = [...document.querySelectorAll(sel)].find(x => x.offsetParent) || null;
  if (f && f.isConnected && typeof f.focus === "function") try { f.focus({ preventScroll: true }); } catch (_) { } }
/* ===== t-native-dialogs (user 11-22): the browser's confirm() is gone. await UI.confirm({ title, text, ok, cancel, danger }) -> true / false.
   One themed dialog in the same #modal as the rest (knit / leather / glass frame on desk, the bottom sheet on phone): a title, one line, Cancel
   and Confirm (danger = the warning colour). Esc = cancel, Enter = confirm (a focused button keeps its own Enter), Tab stays inside, a click
   on the scrim cancels, focus goes back to where it was. A dialog that is already open (the GitHub token one) waits underneath and comes back. */
function cfDrop() { const c = MODAL.cf; MODAL.cf = null; if (c) c(false); }
function confirmDlg(o) {
  if (typeof o === "string") o = { title: o };
  return new Promise(res => {
    cfDrop();
    const m = $("#modal"), zh = UI.lang !== "en", from = document.activeElement, prev = m.hidden ? null : [...m.childNodes];
    if (prev) prev.forEach(n => n.remove());
    else { MODAL.from = from && from !== document.body ? from : null; MODAL.sel = refSel(MODAL.from); }
    m.innerHTML = `<div class="mdl frame ncf${o.danger ? " ncf-danger" : ""}" role="alertdialog" aria-modal="true" aria-labelledby="ncf-h"${o.text ? ' aria-describedby="ncf-p"' : ""}><h2 id="ncf-h">${esc(o.title || "")}</h2>${o.text ? `<p class="ncf-p" id="ncf-p">${esc(o.text)}</p>` : ""}<div class="foot"><button type="button" class="btn" data-ncf="0">${esc(o.cancel || t("cancel"))}</button><button type="button" class="btn primary${o.danger ? " danger" : ""}" data-ncf="1">${esc(o.ok || (zh ? "确定" : "OK"))}</button></div></div>`;
    m.hidden = false;
    const box = m.firstElementChild;
    let open = true;
    const key = e => { if (!open) return m.removeEventListener("keydown", key, true);
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); fin(false); }
      else if (e.key === "Tab") { e.preventDefault(); e.stopPropagation(); const b = [...box.querySelectorAll("[data-ncf]")], i = b.indexOf(document.activeElement); b[(i + (e.shiftKey ? b.length - 1 : 1)) % b.length].focus(); }   // two buttons, wrap (WebKit's Tab skips buttons)
      else if (e.key === "Enter" && !e.isComposing && !(e.target.closest && e.target.closest("[data-ncf]"))) { e.preventDefault(); fin(true); } };
    function fin(v) {   // MODAL.cf: also called (with false) when something else closes or replaces the dialog
      if (!open) return; open = false; m.removeEventListener("keydown", key, true);
      if (MODAL.cf === fin) MODAL.cf = null;
      if (box.isConnected) {
        if (prev) { m.replaceChildren(...prev); const f = from && from.isConnected ? from : m.querySelector(FOCUSABLE); if (f) try { f.focus({ preventScroll: true }); } catch (_) { } }
        else closeModal();
      }
      res(v);
    }
    MODAL.cf = fin;
    m.addEventListener("keydown", key, true);
    box.addEventListener("click", e => { const b = e.target.closest("[data-ncf]"); if (b) fin(b.dataset.ncf === "1"); });
    box.querySelector('[data-ncf="1"]').focus();
  });
}
// t-close-bottom: 关单 from the detail's bottom bar, any kind / stage. One confirm; the optional reason goes into the card's thread as your message
// (so the owner sees it), then the card is closed. Open questions do not block it (they are listed and closed with the card).
const closeBtn = () => `<button class="ab cl" data-act="close" title="${UI.lang === "en" ? "Close this card" : "关掉这张卡"}">${UI.lang === "en" ? "Close" : "关单"}</button>`;
function modalClose() {
  const it = ST.items.find(i => i.id === UI.item); if (!it) return;
  const zh = UI.lang !== "en", oa = openAsks(it), id = it.id;
  openModal(`<h2>${zh ? "关单" : "Close card"}</h2><p class="cl-t">${esc(it.title)}</p>${oa.length ? `<p class="cl-w">${zh ? `还有 ${oa.length} 个问题没答，会随卡一起关掉。` : `${oa.length} open question${oa.length > 1 ? "s" : ""} will close with it.`}</p>` : ""}
    <label>${zh ? "原因（可不填，会记进卡的动态）" : "Reason (optional, goes into the card's thread)"}</label><textarea></textarea>
    <div class="foot"><button class="btn" data-x>${t("cancel")}</button><button class="btn primary" data-ok>${zh ? "关单" : "Close"}</button></div>`, m => {
    const ta = $("textarea", m);
    const submit = async () => { const reason = ta.value.trim(); closeModal();
      if (reason) await api("comment", { item: id, text: (zh ? "关单原因：" : "Closed because: ") + reason });
      await api("done", { item: id, skip_asks: oa.length ? true : undefined });
      toast(zh ? "已关单" : "Closed"); };
    $("[data-ok]", m).onclick = submit; $("[data-x]", m).onclick = closeModal;
    ta.addEventListener("keydown", e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } });
    ta.focus();
  });
}
function modalReject() {
  const pre = $(".composer textarea") ? $(".composer textarea").value.trim() : "";
  openModal(`<h2>${t("reject_t")}</h2><label>${t("reject_reason")}</label><textarea>${esc(pre)}</textarea>
    <div class="foot"><button class="btn" data-x>${t("cancel")}</button><button class="btn primary danger" data-ok>${t("reject")}</button></div>`, m => {
    const ta = $("textarea", m);
    const submit = async () => { const reason = annWrap(ta.value.trim()), aid = UI.item; if (!reason) return ta.focus(); await api("reject", { item: UI.item, reason }); annClear(aid); DRAFT.set("item:" + aid, ""); closeModal(); if ($(".composer textarea")) $(".composer textarea").value = ""; if ($(".dr-tag")) $(".dr-tag").remove(); };
    $("[data-ok]", m).onclick = submit; $("[data-x]", m).onclick = closeModal;
    ta.addEventListener("keydown", e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } });
    ta.focus();
  });
}

function wireUi() {
  UI.confirm = confirmDlg;   /* t-native-dialogs: set here, not at module top (ui.js is evaluated before store.js in the import cycle) */
  $("#modal").addEventListener("keydown", e => { if (!$("#modal").hidden) focusTrap($("#modal"), e); });
  $("#modal").addEventListener("mousedown", e => { if (e.target.id === "modal") { if (MODAL.cf) MODAL.cf(false); else closeModal(); } });   // t-native-dialogs: the scrim cancels a confirm (a dialog under it stays)
}

export { orn, UE_ART, utEmpty, toast, postAct, api, upload, fmtSize, attChips, stillUploading, MODAL, FOCUSABLE, focusTrap, refSel, openModal, closeModal, closeBtn, modalClose, modalReject, confirmDlg, wireUi };
