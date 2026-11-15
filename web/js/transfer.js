/* t-ht-build: 调岗 / 退休 (plan work/t-hr-transfer/plan.md). Everything here is prefixed ht-.
   - 设置 · 角色 cards get a row (HT.acts): 调岗 (not for the manager), 退休 (not for the manager / HR / tooling keeper), 返聘 on a soft-retired card.
   - 调岗 = POST /api/interview {op:start, mode:transfer, target} -> an xfer-* card + HR's opening DM (the hr-iv bar in market.js says 调岗).
   - The transfer card's current draft shows HT.diffBlock: before / after per field and section (GET /api/transfer-plan, VDiff), the locked
     Confirmed rules line, the rule proposals, and 撤回调岗 for 10 minutes after 批准调岗.
   - 退休 = the ht-sheet handover (GET /api/retire-plan): each open card to 管家 / a teammate / 搁置, schedules 暂停 / 转管家, then
     POST /api/hire {op:retire, id, handover}; an 8 s undo bar (#ht-undo) calls undo_retire.
   - 返聘 (here or in the market) shows 「拿回 N 张搁置的单子」 when cards were parked. */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const en = () => !!(window.App && App.UI && App.UI.lang === "en");
  const L = (zh, e) => en() ? e : zh;
  const CORE = ["manager", "hr", "smith"];
  const HR = "hr";
  const phone = () => matchMedia("(max-width: 760px)").matches;
  const STAGE = { todo: ["待办", "To do"], doing: ["进行中", "Doing"], review: ["等你看", "Review"], waiting: ["等待", "Waiting"] };

  async function post(url, body) {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Underthread": "1" }, body: JSON.stringify(body) });
    if (r.status === 404) throw new Error(L("看板服务还没重启，这个接口要重启一次才有。", "Restart the dashboard server once to enable this."));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  }
  const hrOn = () => { const a = App.ST && App.ST.agents && App.ST.agents[HR]; return !!(a && a.enabled !== false); };
  function openDm(id) { if (phone() && window.MRoute) MRoute({ dm: id }); else App.setChat(id); }

  /* ---------- role card row ---------- */
  function acts(a) {
    if (!a || a.id === "me") return "";
    if (a.enabled === false) return `<div class="ht-acts"><button type="button" class="ht-b" data-ht-rehire="${esc(a.id)}">${L("返聘", "Rehire")}</button></div>`;
    if (a.id === "manager") return "";
    const working = a.status === "working";
    const xfer = `<button type="button" class="ht-b" data-ht-xfer="${esc(a.id)}"${hrOn() ? "" : ` aria-disabled="true" title="${esc(L("HR 上岗后开放", "Opens once HR is on the team"))}"`}>${L("调岗", "Transfer")}</button>`;
    const ret = CORE.includes(a.id) ? "" : `<button type="button" class="ht-b warn" data-ht-retire="${esc(a.id)}"${working ? ` aria-disabled="true"` : ""}>${L("退休", "Retire")}</button>`;
    const why = working && ret ? `<small class="ht-why">${esc(L(`在做「${a.activity || "手上的事"}」，交回后再退`, "Working; retire after it hands back"))}</small>` : "";
    return `<div class="ht-acts">${xfer}${ret}${why}</div>`;
  }

  /* ---------- 调岗 ---------- */
  async function startXfer(id, b) {
    if (b.getAttribute("aria-disabled") === "true") { App.toast(L("HR 还没上岗", "HR is not on the team"), true); return; }
    b.disabled = true;
    try {
      const j = await post("/api/interview", { op: "start", mode: "transfer", target: id, lang: App.UI.lang });   /* t-i18n-c */
      if (!j.ok) App.toast(j.error || "?", true);
      openDm(HR);
    } catch (x) { App.toast(String(x.message || x), true); }
    b.disabled = false;
  }

  /* ---------- the transfer card's diff (inside the current draft) ---------- */
  const PL = new Map();   // item id -> {k, j}
  const isXfer = it => !!(it && it.hire && it.hire.mode === "transfer");
  function planKey(it) { return [it.id, it.draft_at || "", it.hire.status || "", it.stage].join("|"); }
  function diffBlock(it) {
    if (!isXfer(it) || !it.draft) return "";
    const k = planKey(it), c = PL.get(it.id);
    if (!c || c.k !== k) { PL.set(it.id, { k, j: null }); fetchPlan(it.id, k); }
    const j = (PL.get(it.id) || {}).j;
    return `<div class="ht-diff" data-ht-item="${esc(it.id)}">${j ? diffHTML(it, j) : `<div class="ht-d-load">${L("正在算改前改后…", "Working out before / after…")}</div>`}</div>`;
  }
  async function fetchPlan(id, k) {
    let j;
    try { const r = await fetch("/api/transfer-plan?item=" + encodeURIComponent(id), { cache: "no-store" }); j = r.status === 404 ? { ok: false, error: L("看板服务还没重启", "Server restart needed") } : await r.json(); }
    catch (x) { j = { ok: false, error: String(x.message || x) }; }
    const c = PL.get(id); if (!c || c.k !== k) return;
    c.j = j;
    const it = App.items().find(i => i.id === id);
    document.querySelectorAll(`.ht-diff[data-ht-item="${CSS.escape(id)}"]`).forEach(el => { el.innerHTML = it ? diffHTML(it, j) : ""; });
  }
  function diffHTML(it, j) {
    if (!j.ok) return `<div class="ht-d-err" role="alert">${esc(L("草案过不了：", "Draft refused: ") + (App.srvT ? App.srvT(j.error || "?") : j.error || "?"))}</div>`;
    const zh = !en(), h = it.hire;
    const blocks = (j.changes || []).map(c => {
      const r = window.VDiff ? VDiff.html(c.before || "", c.after || "", zh) : { html: esc(c.after), add: 0, del: 0 };
      return `<div class="ht-d-b"><div class="ht-d-h"><span class="ht-d-f">${esc(c.file)}</span><b>${esc(c.key)}</b>${c.new ? `<i class="ht-d-new">${L("新小节", "new")}</i>` : ""}<span class="vd-n"><i class="a">+${r.add}</i><i class="d">−${r.del}</i></span></div><div class="vd-body">${r.html}</div></div>`;
    }).join("");
    const ag = j.agent ? `<div class="ht-d-b ht-d-row"><span class="ht-d-f">${esc(j.agent.file)}</span>${esc(L(`跟着变，共 ${j.agent.changed_lines} 行（make_agents.py 重新生成）`, `follows, ${j.agent.changed_lines} line(s) (regenerated by make_agents.py)`))}</div>` : "";
    const lock = `<div class="ht-d-b ht-d-row ht-d-lock">${esc(L("Confirmed rules：锁定，不变", "Confirmed rules: locked, unchanged"))}</div>`;
    const ls = (j.lessons || []).length ? `<div class="ht-d-b ht-d-ls"><b>${esc(L("变成规则提议（你在审核页点头才生效）", "Become rule proposals (you approve them on the review page)"))}</b>${j.lessons.map(x => `<div>· ${esc(x)}</div>`).join("")}</div>` : "";
    let undo = "";
    if (h.status === "transferred" && h.at && Date.now() - new Date(h.at) < 600e3) undo = `<button type="button" class="ht-b warn" data-ht-undo-xfer="${esc(it.id)}">${L("撤回调岗", "Undo transfer")}</button>`;
    const st = h.status === "transferred" ? L("已调岗", "Transferred") : h.status === "undone" ? L("已撤回", "Undone") : L("批准后才落地", "Lands when you approve");
    return `<div class="ht-d-top"><b>${esc(L(`调岗：${h.job_name || h.target}`, `Transfer: ${h.job_name || h.target}`))}</b><small>${esc(st)}</small>${undo}</div>${blocks}${ag}${lock}${ls}`;
  }

  /* ---------- 退休 sheet ---------- */
  async function retireSheet(id) {
    let p;
    try { const r = await fetch("/api/retire-plan?id=" + encodeURIComponent(id), { cache: "no-store" }); if (r.status === 404) throw new Error(L("看板服务还没重启", "Server restart needed")); p = await r.json(); }
    catch (x) { App.toast(String(x.message || x), true); return; }
    if (!p.ok) { App.toast(p.error || "?", true); return; }
    if (p.block) { App.toast(p.block, true); return; }
    const opt = (v, t, sel) => `<option value="${esc(v)}"${sel ? " selected" : ""}>${esc(t)}</option>`;
    const who = p.candidates.map(c => opt(c.id, c.id === "manager" ? L(`转给 ${c.name}（管家）`, `${c.name} (manager)`) : L(`转给 ${c.name}`, `To ${c.name}`) + (c.same ? L(" · 同一生产线", " · same line") : ""), c.id === "manager")).join("") + opt("park", L("搁置（返聘时拿回）", "Park (back on rehire)"));
    const rows = p.items.map(i => `<div class="ht-row"><span class="ht-t"><b>${esc(i.title || i.id)}</b><small class="ht-st ${esc(i.stage)}">${esc((STAGE[i.stage] || [i.stage, i.stage])[en() ? 1 : 0])}</small></span><select data-ht-item="${esc(i.id)}" aria-label="${esc(L("交给谁", "Hand to"))}">${who}</select></div>`).join("");
    const srows = p.schedules.map(s => `<div class="ht-row"><span class="ht-t"><b>${esc(s.title)}</b>${s.routine ? `<small class="ht-note">${esc(L("config 里的固定日程，要停就让管家在 config 里关", "a config routine: ask the manager to turn it off in config"))}</small>` : ""}</span><select data-ht-sc="${esc(s.id)}" aria-label="${esc(L("定时怎么办", "Schedule"))}">${opt("pause", L("暂停", "Pause"), true)}${opt("manager", L("转给管家", "To the manager"))}</select></div>`).join("");
    App.openModal(`<h2>${esc(L(`退休：${p.name}`, `Retire ${p.name}`))}</h2>
      <div class="ht-sheet">
        <p class="ht-lead">${esc(L("软退休：文件都留着，返聘就回来。确认后 8 秒内可以撤销。", "Soft retire: files stay, rehire brings them back. 8 s to undo after you confirm."))}</p>
        <div class="ht-sec"><div class="ht-sh">${L("手上的单子", "Open cards")} <b>${p.items.length}</b></div>${rows || `<div class="ht-none">${L("没有没完成的单子", "No open cards")}</div>`}</div>
        ${p.schedules.length ? `<div class="ht-sec"><div class="ht-sh">${L("定时", "Schedules")} <b>${p.schedules.length}</b></div>${srows}</div>` : ""}
        ${p.lessons.length ? `<div class="ht-sec"><div class="ht-sh">${L("待批规则提议", "Pending rule proposals")} <b>${p.lessons.length}</b></div><div class="ht-none">${esc(L("先挂起，审核页不再显示；返聘时放回。", "Parked (hidden on the review page) until a rehire."))}</div></div>` : ""}
        <div class="ht-sec"><div class="ht-sh">${L("留着不动", "Kept")}</div><div class="ht-keep">${p.keep.map(f => `<code>${esc(f)}</code>`).join("")}<span>${esc(L("声音、她的历史单子", "voice, past cards"))}</span></div></div>
      </div>
      <div class="foot"><button class="btn" data-x>${L("取消", "Cancel")}</button><button class="btn primary ht-go" data-ok>${L("确认退休", "Retire")}</button></div>`, m => {
      m.classList.add("ht-mdl");
      $("[data-x]", m).onclick = App.closeModal;
      $("[data-ok]", m).onclick = async e => {
        const b = e.currentTarget; b.disabled = true;
        const items = {}, schedules = {};
        m.querySelectorAll("select[data-ht-item]").forEach(s => { items[s.dataset.htItem] = s.value; });
        m.querySelectorAll("select[data-ht-sc]").forEach(s => { schedules[s.dataset.htSc] = s.value; });
        try {
          const j = await post("/api/hire", { op: "retire", id, handover: { items, schedules } });
          App.closeModal(); mkFresh();
          undoBar(L(`${p.name} · ${j.moved} 张单子已交接`, `${p.name} · ${j.moved} card(s) handed over`), L("已退休", "Retired"), id);
        } catch (x) { App.toast(String(x.message || x), true); b.disabled = false; }
      };
    });
  }
  const mkFresh = () => { if (window.Market) Market.load(true); };   /* the market caches /api/templates for 60 s; its 在岗 / 可返聘 / 归档 buttons follow a retire at once */
  function undoBar(msg, head, rid, kind = "retire") {
    let el = $("#ht-undo"); if (!el) { el = document.createElement("div"); el.id = "ht-undo"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    const btn = kind === "retire" ? `<button type="button" data-ht-undo-ret="${esc(rid)}">${L("撤销", "Undo")}</button>` : `<button type="button" data-ht-unpark="${esc(rid)}">${esc(msg)}</button>`;
    el.innerHTML = `<span class="rv-u-tx"><b>${esc(head)}</b>${kind === "retire" ? esc(msg) : ""}</span>${btn}<i class="rv-u-bar" style="--hold:8000ms"></i>`;
    el.classList.remove("on"); void el.offsetWidth; el.classList.add("on");
    clearTimeout(undoBar.t); undoBar.t = setTimeout(() => el.classList.remove("on"), 8000);
  }
  function afterRehire(j, name) {
    mkFresh();
    const n = (j.parked || []).length, ps = (j.paused || []).length;
    if (n) undoBar(L(`拿回 ${n} 张搁置的单子`, `Take back ${n} parked card(s)`), L(`已返聘 · ${name}`, `Rehired · ${name}`), j.id, "unpark");
    else App.toast(L("已返聘", "Rehired") + (j.lessons ? L(` · ${j.lessons} 条规则提议放回审核页`, ` · ${j.lessons} proposal(s) back`) : ""));
    if (ps) setTimeout(() => App.toast(L(`${ps} 条定时还在暂停，去「定时」页恢复`, `${ps} schedule(s) still paused; resume them on 定时`)), n ? 8200 : 2600);
  }

  document.addEventListener("click", async e => {
    const x = e.target.closest("[data-ht-xfer]"); if (x) { e.preventDefault(); return startXfer(x.dataset.htXfer, x); }
    const r = e.target.closest("[data-ht-retire]");
    if (r) { e.preventDefault(); if (r.getAttribute("aria-disabled") === "true") { App.toast(L("她在干活，交回后再退", "Working; retire after it hands back"), true); return; } return retireSheet(r.dataset.htRetire); }
    const rh = e.target.closest("[data-ht-rehire]");
    if (rh) { e.preventDefault(); rh.disabled = true; const id = rh.dataset.htRehire, a = App.ST.agents[id];
      try { const j = await post("/api/hire", { op: "rehire", id }); if (!j.ok) App.toast(j.err || "?", true); else afterRehire(j, a ? App.aname(a) : id); } catch (y) { App.toast(String(y.message || y), true); }
      rh.disabled = false; return; }
    const u = e.target.closest("[data-ht-undo-ret]");
    if (u) { $("#ht-undo").classList.remove("on");
      try { const j = await post("/api/hire", { op: "undo_retire", id: u.dataset.htUndoRet }); mkFresh(); App.toast(L(`已撤销退休 · 回来 ${j.back} 张单子`, `Retire undone · ${j.back} card(s) back`) + (j.kept ? L(`，${j.kept} 张新主人已经动过`, `, ${j.kept} kept by the new owner`) : "")); } catch (y) { App.toast(String(y.message || y), true); }
      return; }
    const up = e.target.closest("[data-ht-unpark]");
    if (up) { $("#ht-undo").classList.remove("on");
      try { const j = await post("/api/hire", { op: "unpark", id: up.dataset.htUnpark }); App.toast(L(`拿回 ${j.items.length} 张单子`, `${j.items.length} card(s) back`)); } catch (y) { App.toast(String(y.message || y), true); }
      return; }
    const ux = e.target.closest("[data-ht-undo-xfer]");
    if (ux) { ux.disabled = true;
      try { await post("/api/hire", { op: "undo_update", item: ux.dataset.htUndoXfer }); App.toast(L("已撤回调岗", "Transfer undone")); } catch (y) { App.toast(String(y.message || y), true); ux.disabled = false; }
    }
  });

  window.HT = { acts, diffBlock, isXfer, afterRehire, retireSheet, _pl: PL };
})();
