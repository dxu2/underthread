// t-agent-memory v2: read-only 记忆 / 灵魂 viewer for the role cards. Delegated clicks, uses #modal.
// 灵魂 reads through the existing /api/doc whitelist (works on the old server). 记忆 needs /api/memory (new server);
// on the old one it degrades to a "restart the dashboard" notice.
(() => {
  "use strict";
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const zh = () => document.documentElement.lang !== "en";
  /* core / local split: each core file is followed by its local/ counterpart (your own layer, read after core; missing ones are skipped) */
  const withLocal = l => l.flatMap(p => p.startsWith(".claude/") ? [p] : [p, "local/" + p]);
  const soulFiles = (id, agentName) => id === "manager"
    ? withLocal(["manager.md", "roles/manager.md", "team.md", "policy.md", "roles/common.md"]).concat(["local/dispatch.md"])
    : withLocal([".claude/agents/" + agentName + ".md", "roles/" + id + ".md"]);
  window.RF = { soulFiles, counts: null, at: 0, loading: false };

  function loadCounts(cb) {
    if (RF.loading || Date.now() - RF.at < 20000) return;
    RF.loading = true;
    fetch("/api/memory", { cache: "no-store" }).then(r => r.ok ? r.json() : Promise.reject()).then(j => { RF.counts = j.counts; }, () => { RF.counts = "old"; })
      .finally(() => { RF.loading = false; RF.at = Date.now(); cb && cb(); });
  }
  RF.ensure = cb => { if (RF.counts === null || Date.now() - RF.at > 20000) loadCounts(cb); };

  function show(title, sub, files, notice) {
    const m = document.getElementById("modal"); if (!m) return;
    let cur = 0, raw = false;
    const paint = () => {
      const f = files[cur];
      m.innerHTML = `<div class="mdl frame rf-mdl"><h2>${esc(title)}</h2><div class="rf-sub">${esc(sub)}</div>
        ${notice ? `<div class="empty">${esc(notice)}</div>` : files.length ? `<div class="rf-bar"><div class="rf-tabs">${files.map((x, i) => `<button class="rf-pill ${i === cur ? "on" : ""}" data-rf-tab="${i}" title="${esc(x.path || x.name)}">${esc(x.name)}</button>`).join("")}</div>
        <div class="seg"><button class="seg-i ${raw ? "" : "on"}" data-rf-raw="0">${zh() ? "格式" : "Rendered"}</button><button class="seg-i ${raw ? "on" : ""}" data-rf-raw="1">Raw</button></div></div>
        <div class="rf-body ${raw ? "" : "md"}">${raw ? `<pre>${esc(f.text)}</pre>` : window.md(f.text)}</div>` : `<div class="empty">${zh() ? "还没有记忆" : "No memory yet"}</div>`}
        <div class="rf-foot dim">${zh() ? "只读，不能在这里编辑" : "Read-only"}</div></div>`;
      m.hidden = false;
      m.querySelectorAll("[data-rf-tab]").forEach(b => b.onclick = () => { cur = +b.dataset.rfTab; paint(); });
      m.querySelectorAll("[data-rf-raw]").forEach(b => b.onclick = () => { raw = b.dataset.rfRaw === "1"; paint(); });
    };
    paint();
  }

  async function openSoul(id, an, nm) {
    const out = [];
    for (const p of soulFiles(id, an)) {
      try { const j = await (await fetch("/api/doc?path=" + encodeURIComponent(p))).json(); if (j.text != null) out.push({ name: (p.startsWith("local/") ? "local · " : "") + p.split("/").pop(), path: p, text: j.text }); } catch (e) { }
    }
    show((zh() ? "灵魂 · " : "Soul · ") + nm, zh() ? "人设 · 声音 · 硬规则 · 已采纳规则" : "persona · voice · rules", out);
  }
  async function openMem(id, nm) {
    try {
      const r = await fetch("/api/memory?id=" + encodeURIComponent(id), { cache: "no-store" });
      if (!r.ok) throw 0;
      const j = await r.json();
      show((zh() ? "记忆 · " : "Memory · ") + nm, (j.external ? (zh() ? "目录在项目外（只读白名单）：" : "outside project (read-only whitelist): ") : "") + j.dir, j.files);
    } catch (e) {
      show((zh() ? "记忆 · " : "Memory · ") + nm, "", [], zh() ? "需要重启看板服务（server.py 有更新，旧服务还没有记忆接口）" : "Restart the dashboard server to enable memory.");
    }
  }
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-rf-open]"); if (!b) return;
    e.preventDefault();
    const [kind, id, an, nm] = [b.dataset.rfOpen, b.dataset.rfId, b.dataset.rfAgent || "", b.dataset.rfName || ""];
    kind === "soul" ? openSoul(id, an, nm) : openMem(id, nm);
  });
})();
