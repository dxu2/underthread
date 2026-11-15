// t-imp29-p3 · 平台预览 + 字数检查. The current draft's per-platform blocks (house style, roles/common.md: one block per platform)
// shown as the feed card each platform would show, next to a checklist (title length, body, tags, cover text, chapters), with copy buttons.
// Pure front end: parses it.draft; app.js calls Preview.decorate(card, item) after every drawer render.
(function () {
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const len = s => [...String(s || "")].length;
  const en = () => window.App && App.UI && App.UI.lang === "en";
  // limits from roles/common.md (house style). YouTube's own hard cap on titles is 100 characters.
  const PL = {
    bili: { zh: "B站", en: "Bilibili", re: /^(b站|bilibili|哔哩哔哩|b 站)$/i, title: 40, ratio: "16 / 9" },
    yt: { zh: "YouTube", en: "YouTube", re: /^(youtube|油管|yt)$/i, title: 100, ratio: "16 / 9" },
    xhs: { zh: "小红书", en: "RedNote", re: /^(小红书|xhs|rednote|红书)$/i, title: 20, ratio: "3 / 4" },
  };
  const FIELDS = [   // field label -> key
    [/^(标题|title)$/i, "title"], [/^(英文标题|english title|en title)$/i, "title_en"],
    [/^(简介|描述|视频简介|description|desc)$/i, "desc"], [/^(正文|内容|body)$/i, "body"],
    [/^(标签|话题|tags?|hashtags?)$/i, "tags"], [/^(置顶评论|置顶|pinned comment|pinned)$/i, "pinned"],
    [/^(封面字|封面文字|封面文案|封面|cover text|cover)$/i, "cover"], [/^(章节|chapters?)$/i, "chapters"],
  ];
  const clean = s => s.replace(/^\s*(#{1,6}\s*|[-*]\s+)/, "").replace(/\*\*|__/g, "").replace(/[：:]\s*$/, "").trim();
  function platOfHead(line) {   // "## B站", "**小红书**", "### YouTube 文案", "【小红书】"
    const m = /^\s*(?:#{1,6}\s*|\*\*|【)?\s*([^*【】#:：]+?)\s*(?:\*\*|】)?\s*(?:[:：]\s*)?$/.exec(line); if (!m) return null;
    const w = m[1].replace(/(文案|版|块|copy|block)$/i, "").trim();
    for (const k of Object.keys(PL)) if (PL[k].re.test(w)) return k;
    return null;
  }
  function fieldOf(line) {   // "**标题**：xxx", "- 标题: xxx", "标题：", "### 标签"
    const m = /^\s*(?:[-*]\s+)?(?:#{1,6}\s*)?(?:\*\*|__)?([^*:：\n]{1,16}?)(?:\*\*|__)?\s*[:：]\s*(.*)$/.exec(line) || /^\s*#{1,6}\s*([^#\n]{1,16})\s*$/.exec(line);
    if (!m) return null;
    const lab = clean(m[1]);
    for (const [re, k] of FIELDS) if (re.test(lab)) return { k, v: (m[2] || "").trim() };
    return null;
  }
  function parse(draft, platforms) {
    const lines = String(draft || "").split("\n"), out = {}, order = [];
    let cur = null, fld = null;
    const start = k => { cur = out[k] = out[k] || { raw: [] }; if (!order.includes(k)) order.push(k); fld = null; };
    for (const ln of lines) {
      const p = platOfHead(ln); if (p) { start(p); continue; }
      if (!cur) {   // no platform heading yet: a single-platform draft (fields at top level) counts if the card is tagged with exactly one platform
        const f0 = fieldOf(ln); if (f0 && (platforms || []).length === 1 && PL[platforms[0]]) start(platforms[0]); else continue;
      }
      cur.raw.push(ln);
      const f = fieldOf(ln);
      if (f) { fld = f.k; cur[fld] = f.v ? [f.v] : []; continue; }
      if (fld) cur[fld].push(ln);
    }
    for (const k of order) { const b = out[k]; for (const f of Object.keys(b)) if (Array.isArray(b[f]) && f !== "raw") b[f] = b[f].join("\n").replace(/^\s*```\w*\n?|\n?```\s*$/g, "").trim(); b.text = b.raw.join("\n").trim(); }
    return order.map(k => Object.assign({ k }, out[k]));
  }
  const tagsOf = s => (String(s || "").match(/#[^\s#，,、]+/g) || []).length || String(s || "").split(/[，,、\s]+/).filter(x => x.trim()).length;
  const placeholder = s => !String(s || "").replace(/[.。…·\s\-—_]|todo|tbd|待补|占位|xx+/gi, "").trim();
  function checks(b) {
    const z = !en(), P = PL[b.k], r = [];
    const row = (name, ok, val) => r.push({ name, ok, val });
    const tl = len(b.title);
    row(z ? "标题" : "Title", !!b.title && tl <= P.title, b.title ? `${tl} / ${P.title}` : (z ? "没写" : "missing"));
    if (b.k === "xhs") {
      row(z ? "正文" : "Body", !placeholder(b.body), placeholder(b.body) ? (b.body ? (z ? "还是占位" : "placeholder") : (z ? "没写" : "missing")) : (z ? `${len(b.body)} 字` : `${len(b.body)} chars`));
      const n = b.tags ? tagsOf(b.tags) : 0;
      row(z ? "话题" : "Hashtags", n >= 5 && n <= 10, z ? `${n} 个（要 5–10）` : `${n} (5–10)`);
      row(z ? "封面字" : "Cover text", !!b.cover && !placeholder(b.cover), b.cover ? `${len(b.cover)} ${z ? "字" : "chars"}` : (z ? "没写" : "missing"));
    } else {
      const d = b.desc || b.body;
      row(z ? "简介" : "Description", !placeholder(d), placeholder(d) ? (d ? (z ? "还是占位" : "placeholder") : (z ? "没写" : "missing")) : (z ? `${len(d)} 字` : `${len(d)} chars`));
      const n = b.tags ? tagsOf(b.tags) : 0;
      row(z ? "标签" : "Tags", n > 0, z ? `${n} 个` : `${n}`);
      if (b.k === "bili") row(z ? "置顶评论" : "Pinned comment", !placeholder(b.pinned), b.pinned && !placeholder(b.pinned) ? (z ? "有" : "yes") : (z ? "没写" : "missing"));
      if (b.k === "yt") { const ch = ((b.chapters || "") + "\n" + (d || "")).match(/^\s*(?:[-*]\s*)?\d{1,2}:\d{2}/gm) || []; row(z ? "章节" : "Chapters", ch.length >= 3 && /^\s*(?:[-*]\s*)?0{1,2}:00/m.test((b.chapters || "") + "\n" + (d || "")), ch.length ? (z ? `${ch.length} 段` : `${ch.length}`) : (z ? "没有（要从 00:00 开始）" : "none (start at 00:00)")); }
    }
    return r;
  }
  function coverOf(it) {
    const L = [...(it.draft_attachments || []), ...(it.attachments || [])].filter(p => /\.(png|jpe?g|webp|gif)$/i.test(p));
    return L[0] ? `/api/thumb?p=${encodeURIComponent(L[0])}&w=480` : "";
  }
  const S = { on: {}, plat: {} };   // per item: preview on? which platform tab
  let last = null;
  function card(b, it) {
    const z = !en(), P = PL[b.k], img = coverOf(it), title = b.title || (z ? "（还没有标题）" : "(no title yet)");
    const cov = b.cover && !placeholder(b.cover) ? `<b class="pv-ct">${esc(b.cover).replace(/\n/g, "<br>")}</b>` : "";
    const meta = b.k === "xhs" ? `<small><i class="pv-av"></i>${z ? "你" : "You"}<span class="sp"></span>♡ 0</small>`
      : b.k === "bili" ? `<small>${z ? "UP 主 · 0 播放" : "Uploader · 0 views"}</small>` : `<small>${z ? "你的频道 · 0 次观看" : "Your channel · 0 views"}</small>`;
    return `<div class="pv-feed pv-${b.k}"><div class="pv-cv" style="aspect-ratio:${P.ratio}${img ? `;background-image:url('${img}')` : ""}"><i class="pv-safe"></i>${cov}${img ? "" : `<span class="pv-none">${z ? "还没有封面图" : "No cover yet"}</span>`}</div>
      <div class="pv-ft"><div class="pv-t">${esc(title)}</div>${meta}</div></div>`;
  }
  function html(blocks, it) {
    const z = !en(), on = !!S.on[it.id], k = blocks.some(b => b.k === S.plat[it.id]) ? S.plat[it.id] : blocks[0].k, b = blocks.find(x => x.k === k);
    const seg = `<div class="pv-seg" role="tablist"><button type="button" data-pv-on="0" class="${on ? "" : "on"}">${z ? "文稿" : "Draft"}</button><button type="button" data-pv-on="1" class="${on ? "on" : ""}">${z ? "平台预览" : "Preview"}</button></div>`;
    if (!on) return seg;
    const C = checks(b), bad = C.filter(c => !c.ok).length;
    const copies = [["all", z ? "复制整块" : "Copy block"], ["title", z ? "标题" : "Title"], [b.k === "xhs" ? "body" : "desc", b.k === "xhs" ? (z ? "正文" : "Body") : (z ? "简介" : "Description")], ["tags", b.k === "xhs" ? (z ? "话题" : "Hashtags") : (z ? "标签" : "Tags")]]
      .concat(b.k === "bili" && b.pinned ? [["pinned", z ? "置顶评论" : "Pinned"]] : []).filter(([f]) => f === "all" || b[f] || (f === "desc" && b.body));
    return seg + `<div class="pv-pl">${blocks.map(x => `<button type="button" data-pv-plat="${x.k}" class="${x.k === k ? "on" : ""}">${z ? PL[x.k].zh : PL[x.k].en}${checks(x).some(c => !c.ok) ? '<i class="pv-dot"></i>' : ""}</button>`).join("")}</div>
      <div class="pv-x pv-x-${k}">${card(b, it)}<div class="pv-ck">${C.map(c => `<div class="${c.ok ? "" : "bad"}"><span>${esc(c.name)}</span><span class="v">${esc(c.val)}</span></div>`).join("")}
        <p class="pv-sum">${bad ? (z ? `${bad} 项要补` : `${bad} to fix`) : (z ? "都符合要求" : "All good")}</p></div></div>
      <div class="pv-cp">${copies.map(([f, l], i) => `<button type="button" class="${i ? "g" : ""}" data-pv-copy="${f}">${esc(l)}</button>`).join("")}</div>`;
  }
  function decorate(cardEl, it) {
    if (!cardEl || !it) return;
    const blocks = parse(it.draft, it.platforms);
    let box = cardEl.querySelector(":scope > .pv"); const md = cardEl.querySelector(":scope > .md");
    if (!blocks.length || !md) { if (box) box.remove(); if (md) md.hidden = false; return; }
    last = { cardEl, it, blocks };
    if (!box) { md.insertAdjacentHTML("beforebegin", `<div class="pv"></div>`); box = cardEl.querySelector(":scope > .pv"); }
    box.innerHTML = html(blocks, it);
    md.hidden = !!S.on[it.id];
    if (S.on[it.id]) cardEl.classList.remove("folded");
    const more = cardEl.querySelector(":scope > .cs-more");   // 展开 / 收起 belongs to the text view only
    if (more) { if (more.dataset.pvh == null) more.dataset.pvh = more.hidden ? "1" : ""; more.hidden = !!S.on[it.id] || more.dataset.pvh === "1"; }
  }
  function copy(txt) {
    const ok = () => window.App && App.toast(en() ? "Copied" : "已复制");
    if (navigator.clipboard && isSecureContext) return navigator.clipboard.writeText(txt).then(ok, () => fallback());
    fallback();
    function fallback() { const ta = document.createElement("textarea"); ta.value = txt; ta.style.cssText = "position:fixed;opacity:0"; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); ok(); } catch (_) { } ta.remove(); }
  }
  document.addEventListener("click", e => {
    if (!last || !e.target.closest("#drawer .pv")) return;
    const { it, blocks } = last, id = it.id;
    const o = e.target.closest("[data-pv-on]"); if (o) { S.on[id] = o.dataset.pvOn === "1"; decorate(last.cardEl, it); return; }
    const p = e.target.closest("[data-pv-plat]"); if (p) { S.plat[id] = p.dataset.pvPlat; decorate(last.cardEl, it); return; }
    const c = e.target.closest("[data-pv-copy]"); if (c) {
      const k = blocks.some(b => b.k === S.plat[id]) ? S.plat[id] : blocks[0].k, b = blocks.find(x => x.k === k), f = c.dataset.pvCopy;
      copy(f === "all" ? b.text : f === "desc" ? (b.desc || b.body || "") : (b[f] || ""));
    }
  });
  window.Preview = { decorate, parse, checks };
})();
