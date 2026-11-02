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
    s = s.replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/|uploads\/|work\/)[^)\s]+)\)/g,
      (_, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`);
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, p, u) => `${p}<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
    s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
    return refs(s);
  }

  function table(lines) {
    const rows = lines.map(l => l.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim()));
    const head = rows[0], body = rows.slice(2);
    return `<div class="tbl"><table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>` +
      body.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join("")}</tr>`).join("") + `</tbody></table></div>`;
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
      while (stack.length < depth + 1) { html += `<${tag}>`; stack.push(tag); }
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
})();
