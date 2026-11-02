// t-imp-p2: version diff for the detail page ("这一版改了什么"). Line LCS, unchanged runs folded, paired changed lines get word/char marks.
// No dependencies. VDiff.html(oldText, newText) -> { html, add, del }. Results are cached per text pair.
(function () {
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const lines = s => String(s || "").split("\n").map(l => l.replace(/\*\*|`/g, "").replace(/\s+$/, "")).filter(l => l.trim());   // bold / code markers only add noise to a diff
  function lcs(A, B) {   // returns ops [[" "|"-"|"+", text]]
    const n = A.length, m = B.length;
    if (n * m > 2.5e6) return A.map(x => ["-", x]).concat(B.map(x => ["+", x]));   // too big: plain replace (never freezes the page)
    const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const out = []; let i = 0, j = 0;
    while (i < n && j < m) { if (A[i] === B[j]) { out.push([" ", A[i]]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) out.push(["-", A[i++]]); else out.push(["+", B[j++]]); }
    while (i < n) out.push(["-", A[i++]]); while (j < m) out.push(["+", B[j++]]);
    return out;
  }
  const toks = s => s.match(/[A-Za-z0-9_]+|\s+|./gu) || [];   // CJK = one char per token, latin = whole words
  function marks(a, b) {   // [oldHTML, newHTML] with changed tokens wrapped in <mark>
    const A = toks(a), B = toks(b);
    if (A.length * B.length > 90000) return [esc(a), esc(b)];
    const ops = lcs(A, B), same = ops.filter(o => o[0] === " ").map(o => o[1]).join("").replace(/\s/g, "").length;
    if (same < Math.min(a.length, b.length) * 0.5) return [esc(a), esc(b)];   // mostly rewritten: no confetti
    let o = "", nw = "";
    for (const [k, t] of ops) { if (k === " ") { o += esc(t); nw += esc(t); } else if (k === "-") o += `<mark>${esc(t)}</mark>`; else nw += `<mark>${esc(t)}</mark>`; }
    return [o.replace(/<\/mark><mark>/g, ""), nw.replace(/<\/mark><mark>/g, "")];
  }
  const cache = new Map();
  function html(a, b, zh) {
    const key = a.length + ":" + b.length + ":" + a.slice(0, 40) + b.slice(-40); const hit = cache.get(key); if (hit && hit.a === a && hit.b === b) return hit.r;
    const ops = lcs(lines(a), lines(b)), rows = [];
    let add = 0, del = 0;
    for (let i = 0; i < ops.length;) {
      if (ops[i][0] === " ") {
        let j = i; while (j < ops.length && ops[j][0] === " ") j++;
        const run = ops.slice(i, j), edge = i > 0 && j < ops.length;   // keep one line of context on each side of a change
        if (run.length <= 3) run.forEach(r => rows.push(`<div class="vd-l">${esc(r[1])}</div>`));
        else {
          if (i > 0) rows.push(`<div class="vd-l">${esc(run[0][1])}</div>`);
          const hid = run.length - (i > 0) - (j < ops.length);
          rows.push(`<div class="vd-l vd-gap">${zh ? `… ${hid} 行没变 …` : `… ${hid} unchanged …`}</div>`);
          if (j < ops.length) rows.push(`<div class="vd-l">${esc(run[run.length - 1][1])}</div>`);
        }
        i = j; continue;
      }
      let j = i; while (j < ops.length && ops[j][0] === "-") j++; let k = j; while (k < ops.length && ops[k][0] === "+") k++;
      const D = ops.slice(i, j).map(o => o[1]), P = ops.slice(j, k).map(o => o[1]); del += D.length; add += P.length;
      const pair = D.length === P.length;
      const dm = D.map((x, q) => pair ? marks(x, P[q]) : [esc(x), null]);
      if (pair) { D.forEach((x, q) => rows.push(`<div class="vd-l vd-del">${dm[q][0]}</div>`, `<div class="vd-l vd-add">${dm[q][1]}</div>`)); i = k; continue; }   // edited lines: old right above new
      const cut = D.length > 6;   // a long removed block (usually a rewrite) folds to its first two lines
      D.slice(0, cut ? 2 : D.length).forEach((x, q) => rows.push(`<div class="vd-l vd-del">${dm[q][0]}</div>`));
      if (cut) rows.push(`<div class="vd-l vd-gap">${zh ? `… 另删 ${D.length - 2} 行 …` : `… ${D.length - 2} more removed …`}</div>`);
      P.forEach(x => rows.push(`<div class="vd-l vd-add">${esc(x)}</div>`));
      if (k === i) k = i + 1;   // safety
      i = k;
    }
    const r = { html: rows.join(""), add, del }; cache.set(key, { a, b, r }); if (cache.size > 40) cache.delete(cache.keys().next().value);
    return r;
  }
  window.VDiff = { html };
})();
