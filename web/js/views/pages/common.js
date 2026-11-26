// Dashboard pages, shared parts: the page head, card tiles, action rows and the phone breakpoint (MOBQ).
// t-oss-struct S10 (A5): moved out of app.js unchanged; a wire*() function, if any, holds the top-level event wiring and app.js calls it where
// the code used to run, so listeners register in the same order as before.


// ---------- pages ----------
// t-visual-ink: date eyebrow above every page title (hidden unless html[data-skin="ink"])
import { EN_SUB, PLAT, stateTag, t, whenH } from "../../core/i18n.js";
import { UI, waitSince } from "../../core/store.js";
import { agent, aname, av } from "../../core/av.js";
import { orn } from "../../core/ui.js";
import { routineOf } from "../drawer.js";
import { STU, stuName, stuTabs } from "../left.js";
import { mailPv, nrDot, sumPv } from "../mail.js";
import { askRow, askWait, askWaitL, awaitsUser, cardImg, waitTag } from "./review.js";
import { wkAttr, wkFx, wkTag, workersOf } from "../../app.js";
function inkEb(right) { const d = new Date(), en = UI.lang === "en";
  const day = en ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", weekday: "short" }) : `${d.getMonth() + 1}月${d.getDate()}日 · 周${"日一二三四五六"[d.getDay()]}`;
  return `<div class="ink-eb">${day}<i></i>${right}</div>`; }
function pageHead(k, extra = "") {
  if (UI.noHead) return extra;   // t-settings-tab: a page drawn inside a 设置 tab keeps its bars, not its masthead
  if (STU.includes(k)) return `<div class="ph ph-studio ph-${k}">${inkEb("Underthread")}<h1>${stuName()}</h1>${UI.lang === "zh" ? `<div class="en">${stuName(true)}</div>` : ""}${orn()}</div>${stuTabs(k)}${extra}`;   // t-nav-shoot
  return `<div class="ph ph-${k}">${inkEb("Underthread")}<h1>${t(k)}</h1>${UI.lang === "zh" ? `<div class="en">${EN_SUB[k] || ""}</div>` : ""}${orn()}</div>${extra}`;
}


/* t-card-fn-fix: restored from app.js.bak-hstrim1; t-home-style-trim dropped it, but stageGroups / catPage / the board still draw .card with it */
function card(it, o) {   /* o.noCat (r-improve-1116 P3): on that category's own page the footer drops the category word; map(card) passes an index here, which has no .noCat */
  const a = agent(it.owner), ws = workersOf(it.id);
  const kind = it.stage === "review" || awaitsUser(it) ? (it.kind === "task" ? "deliverable" : it.kind) : null;
  /* t-web-quest-cards: o.cover (lane pages) puts the card's picture on top, same pick and same fallback as the phone review card (review.js):
     thumb first, the full file if the thumb fails, no picture -> no cover. Not drawn on a phone (no hidden 780px thumbs per list card); quest-cards.css also hides it there.
     t-web-quest-cards-p2: the picture stays hidden until qcCvChk (below) has looked at the part the cover shows; a near-blank one (a white page with one needle)
     is dropped, and the verdict is kept per path so the next poll's re-render draws it at once (ok) or not at all (blank). */
  const desk = o && o.cover && !MOBQ.matches, img0 = desk && cardImg(it), img = img0 && QC_CV.get(img0) !== "blank" ? img0 : null, u = img && "/" + img.split("/").map(encodeURIComponent).join("/");
  const cv = img ? `<div class="qc-cv"><img${QC_CV.get(img) === "ok" ? ` class="ok"` : ""} data-qcp="${esc(img)}" src="/api/thumb?p=${encodeURIComponent(img)}&w=780" alt="" loading="lazy" onload="qcCvChk(this)" onerror="if(!this.dataset.f){this.dataset.f=1;this.src='${u}'}else{this.parentNode.closest('.card').classList.remove('has-cv');this.parentNode.remove()}"></div>` : "";
  return `<div class="card${ws.length ? " wk-on" : ""}${img ? " has-cv" : ""}" data-item="${it.id}"${wkAttr(ws)}>${wkFx(ws)}${cv}
    <div class="meta">${kind ? `<span class="tag ${kind}"><span class="gl" aria-hidden="true">◆</span>${t(kind)}</span>${waitTag(it, desk)}` : askWait(it) ? `<span class="tag question"><span class="gl" aria-hidden="true">◆</span>${askWaitL()}</span>` : `<span class="tag">${stateTag(it)}</span>`}
      ${o && o.noCat ? "" : `<span>${t(it.category)}${it.category === "urgent" ? " ⚑" : ""}</span>`}
      ${cardDt(it)}
      <span>${(it.platforms || []).map(p => `<span class="tag pf">${PLAT[p] || p}</span>`).join(" ")}</span></div>
    <div class="body"><h3>${nrDot(it.id)}${window.Onboard ? Onboard.exT(it) : esc(it.title)}</h3><p>${esc(sumPv(it.summary || ""))}</p>${wkTag(ws)}${askRow(it, false, desk)}</div>
    <div class="owner">${av(a, "sm", it.id)}<span>${esc(aname(a))}</span></div>
    <div class="acts"><button data-arch="${it.id}">${t("archive")}</button>${it.stage !== "done" && !routineOf(it) ? `<button data-quickdone="${it.id}">${t("complete")}</button>` : ""}</div></div>`;
}

/* r-improve-1124 P2: the corner date follows the list order. By activity (default): the latest activity; a card waiting on review says
   「交来 / Sent」 + when it was handed in (waitSince = the last 提交审核). Sorted by 最新创建: the created date + the dim 动态 time, as before. */
function cardDt(it) {
  const en = UI.lang === "en";
  if (UI.sort === "created") return `<span class="qc-dt">${whenH(it.created)}</span><span class="dim">${en ? "act." : "动态"} ${whenH(it.activity)}</span>`;
  if (it.stage === "review") return `<span class="qc-dt"><span class="qc-dl">${en ? "Sent" : "交来"}</span> ${whenH(waitSince(it))}</span>`;
  return `<span class="qc-dt">${whenH(it.activity || it.updated || it.created)}</span>`;
}

// ===== p3 (t-slack-p3): Slack-Activity-style list rows on phones (<=760px). Desktop keeps .card / .mail-i. =====
const MOBQ = matchMedia("(max-width: 760px)");
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
/* r-improve-1118 P3: the solid badge counts what is unread (o.un, mail rows); a fully read row keeps the outlined total. Rows without o.un keep the old total. */
function actN(o) {
  const un = o.unread && o.un > 0, n = un ? o.un : o.n;
  return un || n > 1 ? `<span class="act-n ${un || (o.unread && o.un == null) ? "on" : ""}"${un ? ` title="${UI.lang === "en" ? `${n} unread of ${o.n}` : `${o.n} 条里 ${n} 条没读`}"` : ""}>${n > 99 ? "99+" : n}</span>` : "";
}
function actRow(o) {   // one shared row: avatar (+unread dot) | name + title ... time | preview ... chips
  const ws = o.ws || [];
  return `<div class="act-row ${o.unread ? "unread" : ""}${ws.length ? " wk-on" : ""}" ${o.attr}${wkAttr(ws)}>${wkFx(ws)}
    <span class="act-av">${o.av}${o.unread ? `<i class="act-dot"></i>` : ""}</span>
    <div class="act-main">
      <div class="act-l1"><b class="act-nm">${esc(o.name)}</b>${o.title ? `<span class="act-ti">${esc(o.title)}</span>` : ""}<time class="act-tm">${o.time}</time></div>
      <div class="act-l2"><span class="act-pv">${esc(o.preview)}</span>${ws.length ? wkTag(ws) : o.chip ? `<span class="act-chip">${esc(o.chip)}</span>` : ""}${o.extra || ""}${actN(o)}</div>
    </div></div>`;
}

/* t-web-quest-cards-p2: cover check. Samples the part of the picture a 238x140 cover shows (object-fit: cover, top aligned) at 48 px wide; when
   98.5% or more of the samples sit within 24 levels of the most common colour, the cover is blank (a white page with only a needle) and the card
   goes without it. Same-origin thumbs, so the canvas is readable; any failure keeps the picture. Verdicts per path live in QC_CV for this page load. */
const QC_CV = new Map();
function qcCvChk(im) {
  const p = im.dataset.qcp, v = im.parentNode; if (!p || !v) return;
  if (QC_CV.get(p) === "ok") { im.classList.add("ok"); return; }   /* a re-render of a checked picture */
  let blank = false;
  try {
    /* t-perf-smooth: judged on a fixed box, the cover in the narrowest column (QC_MIN 270 minus the card's 32px padding, 140 high), not on the
       box the picture happens to sit in. The verdict is kept per path for the whole page load, and one render while the columns were still being
       dealt (a wide box, e.g. right after a reload at a new width) cropped a picture to its top band and dropped it as blank for good (CI, 1280). */
    const bw = 238, bh = 140, w = im.naturalWidth, h = im.naturalHeight;
    if (w && h) {
      const s = Math.max(bw / w, bh / h), vw = Math.min(w, bw / s), vh = Math.min(h, bh / s), W = 48, H = Math.max(8, Math.round(W * bh / bw));
      const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
      const g = cv.getContext("2d", { willReadFrequently: true }); g.drawImage(im, (w - vw) / 2, 0, vw, vh, 0, 0, W, H);
      const d = g.getImageData(0, 0, W, H).data, n = W * H, bins = new Map();
      for (let i = 0; i < d.length; i += 4) { const k = d[i + 3] < 16 ? -1 : (d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | d[i + 2] >> 4; bins.set(k, (bins.get(k) || 0) + 1); }
      let top = 0, tk = 0; bins.forEach((c, k) => { if (c > top) { top = c; tk = k; } });
      let near = 0;
      if (tk === -1) { for (let i = 3; i < d.length; i += 4) if (d[i] < 16) near++; }
      else { const r = (tk >> 8) * 16 + 8, gg = (tk >> 4 & 15) * 16 + 8, b = (tk & 15) * 16 + 8;
        for (let i = 0; i < d.length; i += 4) if (d[i + 3] >= 16 && Math.abs(d[i] - r) <= 24 && Math.abs(d[i + 1] - gg) <= 24 && Math.abs(d[i + 2] - b) <= 24) near++; }
      im.dataset.qcs = (near / n).toFixed(3); blank = near / n >= .985;
    }
  } catch (e) { blank = false; }
  QC_CV.set(p, blank ? "blank" : "ok");
  if (blank) { const k = v.closest(".card"); if (k) k.classList.remove("has-cv"); v.remove();
    /* the columns were dealt counting this cover; deal again now rather than at the next poll */
    clearTimeout(qcCvChk.t); qcCvChk.t = setTimeout(() => { if (window.App && App.refreshPage && document.querySelector("#pagebody .qc-grid.qc-m")) App.refreshPage(); }, 30);
  } else im.classList.add("ok");
}
window.qcCvChk = qcCvChk;
export { inkEb, pageHead, card, MOBQ, QC_CV, lsGet, lsSet, actRow };
