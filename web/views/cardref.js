// Card ids as chips in messages and drafts (md.ref), and the # card picker in the chat and card composers.
// t-oss-struct S10 (A5): moved out of app.js unchanged; a wire*() function, if any, holds the top-level event wiring and app.js calls it where
// the code used to run, so listeners register in the same order as before.


// ===== t-imp29-p5: card ids in messages / drafts render as chips (md.js calls md.ref), and a # card picker in the chat and detail composers.
// Chips are deterministic HTML (no time-based styles), so a poll re-render of the chat produces the same markup. What gets sent is still the plain id.
import { grpLabel, rowLabel } from "../core/i18n.js";
import { REV, ST, UI, archIx, byAct, grpOf, items } from "../core/store.js";
import { agent, avatarUrl } from "../core/av.js";
import { PHONE, navItem, openItem } from "./drawer.js";
const idcMap = () => { if (!idcMap.m || idcMap.rev !== REV) { idcMap.m = new Map(((ST && ST.items) || []).map(i => [i.id, i]));
  for (const [id, title, owner] of archIx()) if (!idcMap.m.has(id)) idcMap.m.set(id, { id, title, owner, stage: "done", archived: true });   // t-perf A
  idcMap.rev = REV; } return idcMap.m; };
const idcGo = c => { const id = c.dataset.idc; if (c.closest("#drawer") && UI.item) { if (id !== UI.item) navItem(id); }
  else if (PHONE.matches && document.body.dataset.mtab === "chat" && window.MRoute) MRoute({ item: id });   /* t-m-idchip-tap: the drawer lives in #main, which the phone chat screen covers; MRoute leaves the chat first (same path as a push tap) */
  else openItem(id); };

const HP = { el: null, ta: null, rows: [], sel: 0, at: -1, q: "" };
const HP_TA = "#right .ch-comp textarea, #drawer .composer textarea";
function hpEl() {
  if (HP.el) return HP.el;
  const el = HP.el = document.createElement("div"); el.className = "hp-pop"; el.hidden = true; el.setAttribute("role", "listbox");
  document.body.appendChild(el);
  el.addEventListener("mousedown", e => e.preventDefault());   // keep the caret in the textarea
  el.addEventListener("click", e => { const r = e.target.closest("[data-hp]"); if (r) hpPick(+r.dataset.hp); });
  return el;
}
function hpClose() { if (HP.el) HP.el.hidden = true; HP.rows = []; HP.ta = null; }
function hpScan(ta) {
  const c = ta.selectionStart; if (c !== ta.selectionEnd) return hpClose();
  const m = ta.value.slice(0, c).match(/(^|[\s，。、；：,;:（(“"'])#([^\s#]{0,24})$/); if (!m) return hpClose();
  const q = m[2].toLowerCase();
  HP.ta = ta; HP.at = c - m[2].length - 1; HP.q = m[2];
  HP.rows = window.Pal ? Pal.find(q, { items: 6, recent: 6, itemsOnly: 1 }).items.slice(0, 6) : items().filter(i => !q || (i.title + " " + i.id).toLowerCase().includes(q)).sort(byAct).slice(0, 6);
  HP.sel = 0; hpDraw();
}
function hpDraw() {
  const el = hpEl(), zh = UI.lang !== "en";
  if (!HP.ta) return hpClose();
  el.innerHTML = `<div class="hp-h">${zh ? "引用一张卡" : "Link a card"} · #${esc(HP.q)}</div>` +
    (HP.rows.length ? HP.rows.map((it, i) => { const a = agent(it.owner); return `<div class="hp-r${i === HP.sel ? " on" : ""}" data-hp="${i}" role="option" aria-selected="${i === HP.sel}">${a ? `<i class="idc-av" style="background-image:url('${avatarUrl(a)}')"></i>` : ""}<b>${esc(it.title || it.id)}</b><small>${esc(grpLabel(grpOf(it)))}</small></div>`; }).join("")
      : `<div class="hp-none">${zh ? "没有对得上的卡" : "No matching card"}</div>`) +
    `<div class="hp-f">${zh ? "↑↓ 选 · ↵ 插入 · 发出去后对方收到的是卡片 id" : "↑↓ move · ↵ insert · the message carries the card id"}</div>`;
  el.hidden = false; hpPlace();
}
function hpPlace() {
  if (!HP.ta || !HP.el || HP.el.hidden) return;
  const box = (HP.ta.closest(".ch-comp, .composer") || HP.ta).getBoundingClientRect(), el = HP.el, vv = window.visualViewport;
  const w = Math.min(box.width, 460, innerWidth - 16), left = Math.max(8, Math.min(box.left, innerWidth - w - 8));
  el.style.width = w + "px"; el.style.left = left + "px";
  const h = el.offsetHeight, vTop = vv ? vv.offsetTop : 0;
  el.style.top = Math.max(vTop + 8, box.top - h - 8) + "px";
}
function hpPick(i) {
  const it = HP.rows[i], ta = HP.ta; if (!it || !ta) return hpClose();
  const v = ta.value, end = ta.selectionStart, ins = it.id + " ";
  ta.value = v.slice(0, HP.at) + ins + v.slice(end);
  const p = HP.at + ins.length; hpClose(); ta.focus(); ta.setSelectionRange(p, p);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

function wireCardRef() {
  md.ref = id => {
    if (!ST) return null; const it = idcMap().get(id); if (!it) return null;
    const a = it.owner && agent(it.owner), st = it.archived ? (UI.lang === "en" ? "archived" : "已归档") : rowLabel(it);
    return `<span class="idc st-${esc(it.archived ? "archived" : grpOf(it))}" data-idc="${esc(id)}" role="link" tabindex="0" title="${esc(id + " · " + (it.title || "") + " · " + st)}">${a ? `<i class="idc-av" style="background-image:url('${avatarUrl(a)}')"></i>` : ""}<b>${esc(it.title || id)}</b><small>${esc(st)}</small></span>`;
  };
  document.addEventListener("click", e => {   // capture: a chip can sit inside rows / bubbles that have their own click handlers
    const c = e.target.closest && e.target.closest("[data-idc]"); if (!c) return;
    e.preventDefault(); e.stopPropagation(); idcGo(c);
  }, true);
  document.addEventListener("keydown", e => { const c = e.target.closest && e.target.closest("[data-idc]"); if (c && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); idcGo(c); } });
  document.addEventListener("input", e => { if (e.target.matches && e.target.matches(HP_TA) && !e.isComposing) hpScan(e.target); });
  document.addEventListener("compositionend", e => { if (e.target.matches && e.target.matches(HP_TA)) hpScan(e.target); });
  document.addEventListener("focusout", e => { if (HP.ta && e.target === HP.ta) setTimeout(() => { if (HP.ta && document.activeElement !== HP.ta) hpClose(); }, 200); });
  document.addEventListener("keydown", e => {   // capture: runs before the composer's own keys (send, the @ picker)
    if (!HP.ta || e.target !== HP.ta || !HP.el || HP.el.hidden || e.isComposing || e.keyCode === 229) return;
    const k = e.key, n = HP.rows.length;
    if ((k === "ArrowDown" || k === "ArrowUp") && n) { HP.sel = (HP.sel + (k === "ArrowDown" ? 1 : -1) + n) % n; hpDraw(); }
    else if ((k === "Enter" || k === "Tab") && n && !(e.metaKey || e.ctrlKey || e.shiftKey)) hpPick(HP.sel);
    else if (k === "Escape") hpClose();
    else return;
    e.preventDefault(); e.stopImmediatePropagation();
  }, true);
  document.addEventListener("keyup", e => { if (HP.ta && e.target === HP.ta && /^Arrow(Left|Right)$|^Home$|^End$/.test(e.key)) hpScan(HP.ta); });
  addEventListener("resize", () => hpPlace());
  if (window.visualViewport) visualViewport.addEventListener("resize", () => hpPlace());
}

export { idcMap, idcGo, HP, HP_TA, hpEl, hpClose, hpScan, hpDraw, hpPlace, hpPick, wireCardRef };
