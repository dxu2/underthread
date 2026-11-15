// Dashboard core: DOM shortcuts ($, $$), the localStorage wrapper (LS, keys rt.*) and per-device unsent drafts (DRAFT). Imports nothing,
// so it evaluates first.
// t-oss-struct S10 (A2): moved out of app.js unchanged. The export list at the bottom is a plain ES module line; add a name there when
// another file needs it.

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
