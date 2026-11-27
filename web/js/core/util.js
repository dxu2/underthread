// Dashboard core: DOM shortcuts ($, $$), the localStorage wrapper (LS, keys rt.*) and per-device unsent drafts (DRAFT). Imports nothing,
// so it evaluates first.
// t-oss-struct S10 (A2): moved out of app.js unchanged. The export list at the bottom is a plain ES module line; add a name there when
// another file needs it.

/* t-oss-secreview P1-2: a thumbnail that fails falls back once to the full file (data-fb), then hides / removes itself. The inline onerror
   used to carry the path inside a JS string ('${u}'), which a crafted attachment name could break out of; now the handler text is fixed
   and the path rides in an escaped attribute. how: "hide" = display none, "rm" = remove the parent, "cv" = drop a card cover. */
window.imgFb = (img, how) => {
  const fb = img.dataset.fb;
  if (fb && !img.dataset.f) { img.dataset.f = 1; img.src = fb; return; }
  if (how === "rm") img.parentNode && img.parentNode.remove();
  else if (how === "cv") { const c = img.parentNode && img.parentNode.closest(".card"); if (c) c.classList.remove("has-cv"); img.parentNode && img.parentNode.remove(); }
  else img.style.display = "none";
};

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const LS = {
  get(k, d) { try { const v = localStorage.getItem("rt." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("rt." + k, JSON.stringify(v)); } catch { } },
};
// t-draft-keep: unsent text in the card reply box ("item:<id>") and the DM box ("dm:<agent>"), one draft each, kept on this device only (rt.drafts).
// Saved on every input; cleared when the text goes out (comment / reject / approve-with-note / chat send) or when the box is emptied.
const DRAFT = {
  all() { const d = LS.get("drafts", {}); return d && typeof d === "object" ? d : {}; },
  get(k) { const d = DRAFT.all()[k]; return d && d.t ? d : null; },
  set(k, txt) { if (!k) return; const d = DRAFT.all(), had = !!d[k]; if (txt && txt.trim()) d[k] = { t: txt, at: new Date().toISOString() }; else if (had) delete d[k]; else return; LS.set("drafts", d); },
};

export { $, $$, LS, DRAFT };
