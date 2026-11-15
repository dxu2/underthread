// Minimal, safe markdown → HTML (escapes everything first).
(function () {
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // t-imp29-p5: known card ids become chips. md.ref(id) (set by app.js) returns the chip HTML, or null for an id it does not know (left as text).
  // Only plain text is touched: never inside <a>…</a>, <code>, a tag, a path (work/t-x/…) or a file name (t-x.md); fenced code never reaches inline().
  const ID_RE = /(^|[^\w\/.#?=-])([a-z][a-z0-9]*(?:-[a-z0-9]+)+)(?![\w\/-]|\.\w)/g;
  function refs(s) {
    if (!md.ref || !/[a-z]-[a-z0-9]/.test(s)) return s;
    return s.split(/(<a\b[^>]*>[\s\S]*?<\/a>|<code>[\s\S]*?<\/code>|<[^>]+>)/).map((part, i) => i % 2 ? part :
      part.replace(ID_RE, (m, pre, id) => { const h = md.ref(id); return h ? pre + h : m; })).join("");
  }

  function inline(s) {
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return "\u0000" + (codes.length - 1) + "\u0000"; });
    s = esc(s);
    /* t-md-url-comma: finished <a> tags are parked as \u0001N\u0001 so the bare-URL pass cannot re-link the href of a [text](url)
       link and bold, italic or strike marks cannot reach inside a URL. A bare URL stops at full-width punctuation (，。、；：！？…“”‘’《》 …) and drops
       trailing sentence punctuation (. , ; : ! ? ' * ~ and an escaped quote), so 「见 https://x.com/a，然后」 links only the URL. */
    const links = [], park = h => { links.push(h); return "\u0001" + (links.length - 1) + "\u0001"; };
    const deco = t => t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>").replace(/~~([^~]+)~~/g, "<del>$1</del>");
    s = s.replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/|uploads\/|work\/)[^)\s]+)\)/g,
      (_, t, u) => park(`<a href="${u}" target="_blank" rel="noopener">${deco(t)}</a>`));
    s = s.replace(/(^|[^a-zA-Z0-9\/._%?#=&+-])(https?:\/\/[^\s<)\u0001\u3000-\u303f\uff01-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65\u2010-\u2027]+)/g, (_, p, u) => {
      let tail = "", m;
      while ((m = u.match(/(?:[.,;:!?'*~]|&quot;)$/)) && u.length > 8) { tail = m[0] + tail; u = u.slice(0, -m[0].length); }
      return /^https?:\/\/[^\/]/.test(u) ? `${p}${park(`<a href="${u}" target="_blank" rel="noopener">${u}</a>`)}${tail}` : p + u + tail;
    });
    s = deco(s);
    s = s.replace(/\u0001(\d+)\u0001/g, (_, i) => links[+i]);
    s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
    return refs(s);
  }

  function table(lines) {
    const rows = lines.map(l => l.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim()));
    const head = rows[0], body = rows.slice(2);
    /* t-ui-fix-r7 R7-01: each column gets a width class from its longest cell (CJK counts 2), so auto layout never squeezes a column to
       one character per line: short columns stay on one line (c-n), medium / long ones keep a floor (c-m / c-l, style.css); a table that
       needs more room than the card scrolls inside .tbl. */
    const vw = c => String(c).replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[`*]/g, "").replace(/[\u1100-\uffff]/g, "xx").length;
    const cls = head.map((_, i) => { const m = Math.max(0, ...[head, ...body].map(r => vw(r[i] || ""))); return m <= 12 ? "c-n" : m >= 48 ? "c-l" : "c-m"; });
    return `<div class="tbl"><table><thead><tr>${head.map((c, i) => `<th class="${cls[i]}">${inline(c)}</th>`).join("")}</tr></thead><tbody>` +
      body.map(r => `<tr>${r.map((c, i) => `<td class="${cls[i] || "c-m"}">${inline(c)}</td>`).join("")}</tr>`).join("") + `</tbody></table></div>`;
  }

  function list(lines) {
    // nested by indentation (2+ spaces per level)
    let html = "", stack = [];
    for (const l of lines) {
      const m = l.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
      if (!m) { html += " " + inline(l.trim()); continue; }
      const depth = Math.floor(m[1].replace(/\t/g, "  ").length / 2);
      const tag = /\d/.test(m[2]) ? "ol" : "ul";
      while (stack.length > depth + 1) html += `</li></${stack.pop()}>`;
      if (stack.length === depth + 1) html += "</li>";
      /* t-md-ol-start: a blank line or a link paragraph ends the list, so "2." opens a new <ol>; carry its number */
      const n = tag === "ol" ? parseInt(m[2], 10) : 1;
      while (stack.length < depth + 1) { html += stack.length === depth && n !== 1 && n < 1e6 ? `<ol start="${n}">` : `<${tag}>`; stack.push(tag); }
      let txt = m[3], box = "";
      const cb = txt.match(/^\[( |x)\]\s+(.*)$/i);
      if (cb) { box = `<span class="cb${cb[1] !== " " ? " on" : ""}"></span>`; txt = cb[2]; }
      html += `<li>${box}${inline(txt)}`;
    }
    while (stack.length) html += `</li></${stack.pop()}>`;
    return html;
  }

  function md(src) {
    if (!src) return "";
    const lines = String(src).replace(/\r/g, "").split("\n");
    let out = "", i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (/^```/.test(l)) {
        const lang = l.slice(3).trim(); const buf = []; i++;
        while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
        i++;
        out += `<pre class="code" data-lang="${esc(lang)}"><code>${esc(buf.join("\n"))}</code></pre>`;
        continue;
      }
      if (/^\s*$/.test(l)) { i++; continue; }
      let m;
      if ((m = l.match(/^(#{1,6})\s+(.*)$/))) { out += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`; i++; continue; }
      if (/^\s*(---|\*\*\*|___)\s*$/.test(l)) { out += "<hr>"; i++; continue; }
      if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        const buf = []; while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) buf.push(lines[i++]);
        out += table(buf); continue;
      }
      if (/^\s*>/.test(l)) {
        const buf = []; while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
        out += `<blockquote>${md(buf.join("\n"))}</blockquote>`; continue;
      }
      if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) {
        const buf = [];
        while (i < lines.length && (/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && buf.length))) buf.push(lines[i++]);
        out += list(buf); continue;
      }
      const buf = [];
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6}\s|```|\s*>|\s*([-*+]|\d+[.)])\s+|\s*\|.*\|\s*$)/.test(lines[i])) buf.push(lines[i++]);
      if (!buf.length) buf.push(lines[i++]);
      out += `<p>${buf.map(inline).join("<br>")}</p>`;
    }
    return out;
  }

  window.md = md;
  md.refs = refs;   // t-imp29-p5: for already-escaped plain text (timeline log lines)
  window.esc = esc;

  /* t-ui-fix-r7b: a table wider than its card scrolls inside .tbl (R7-01); mark which sides still have more (more-r / more-l) so style.css
     fades that edge. The mask sits on the scroller's own box, so at either scroll end the fade is gone and never covers cell text.
     New .tbl nodes are picked up by one rAF-throttled MutationObserver; a ResizeObserver per table re-checks on drawer / chat resizes. */
  function tblMark(w) {
    const m = w.scrollWidth - w.clientWidth, x = Math.abs(w.scrollLeft);
    w.classList.toggle("more-r", m > 1 && x < m - 1); w.classList.toggle("more-l", m > 1 && x > 1);
  }
  md.tblMark = tblMark;
  document.addEventListener("scroll", e => { const t = e.target; if (t && t.classList && t.classList.contains("tbl")) tblMark(t); }, true);
  if (window.ResizeObserver && window.MutationObserver) {
    const ro = new ResizeObserver(es => es.forEach(e => tblMark(e.target)));
    let q = 0;
    const scan = () => { q = 0; document.querySelectorAll(".tbl:not([data-tw])").forEach(w => { w.dataset.tw = "1"; ro.observe(w); }); };
    const start = () => { scan(); new MutationObserver(() => { if (!q) q = requestAnimationFrame(scan); }).observe(document.body, { childList: true, subtree: true }); };
    if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
  }
})();
