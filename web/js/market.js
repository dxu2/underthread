/* t-hm-build: 招聘市场 (hiring market). Layout A from t-hiring-market: a grid of job templates, category chips, a 3-personality
   switch per card, 2 example requests, 在岗 / 可返聘 badges, and 「直接雇」 through tools/new_role.py (plan -> confirm sheet -> apply).
   Data: GET /api/templates (templates/roles/<job>/template.json + who is hired from roster.json "template").
   Hire: POST /api/hire {op: plan|apply|retire|rehire} with the X-Underthread header.
   t-hr-build: 面试 is live once the HR role (id hr) is on the team: POST /api/interview {job, variant} makes a hire-* card and her opening
   DM, then her DM opens. The hr-iv bar above that DM (Market.hrBar, called from app.js renderChat) shows progress, 看卡 and 放弃.
   t-oss-gen-s4: no HR yet -> 「先请 HR」 on each card (hire templates/roles/hr as id hr); the 整队预设 bar above the chips runs
   tools/preset.py through GET /api/presets + POST /api/preset (dry run in a sheet, apply on confirm).
   The page keeps its DOM across polls (page() returns null while nothing changed), so a switched personality or a filter survives. */
(function () {
  const MK = { data: null, at: 0, busy: false, err: "", cat: "all", pick: {} };
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const en = () => !!(window.App && App.UI && App.UI.lang === "en");
  const L = (zh, e) => en() ? e : zh;
  const CATS = ["研究", "工程", "创作", "运营", "生活"];
  const CAT_EN = { 研究: "Research", 工程: "Engineering", 创作: "Writing", 运营: "Operations", 生活: "Life" };
  const catL = c => en() ? (CAT_EN[c] || c) : c;
  const avUrl = (t, v) => `/api/tpl-av?job=${encodeURIComponent(t.key)}&v=${encodeURIComponent(v.key)}`;
  const vOf = t => t.variants[Math.min(MK.pick[t.key] || 0, t.variants.length - 1)] || t.variants[0];
  const sample = v => en() && v.sample_en || ((v.habits || []).find(h => /^示例/.test(h)) || "").replace(/^示例[:：]?\s*/, "");
  /* t-i18n-c: template.json carries label_en / style_en / sample_en per personality and starters_en per job; a missing one falls back to Chinese */
  const vLabel = v => en() && v.label_en || v.label;
  const vStyle = v => en() && v.style_en || v.style;
  const starters = t => (t.starters || []).map((s, i) => en() && (t.starters_en || [])[i] || s);

  async function load(force) {
    if (MK.busy) { if (force) MK.again = true; return; }   /* t-oss-gen-s4a-wire: a forced load during another one re-runs after it (hrFirst saw the pre-hire roster) */
    if (!force && MK.data && Date.now() - MK.at < 60e3) return;
    MK.busy = true;
    try {
      const r = await fetch("/api/templates", { cache: "no-store" });
      if (r.status === 404) throw new Error(L("看板服务还没重启：招聘市场的接口要重启一次才有。", "The dashboard server needs one restart before the market works."));
      if (!r.ok) throw new Error("HTTP " + r.status);
      MK.data = await r.json(); MK.err = "";
      try { const rp = await fetch("/api/presets", { cache: "no-store" }); MK.pre = rp.ok ? (await rp.json()).presets || [] : []; } catch (_) { MK.pre = []; }   /* t-oss-gen-s4: 整队预设 bar */
      if (App.tplSeed) App.tplSeed(MK.data);   /* t-i18n-c: English job names for old interview cards */
    } catch (e) { MK.err = String(e.message || e); }
    MK.busy = false; MK.at = Date.now();
    if (MK.again) { MK.again = false; return load(true); }
    if (App.UI.page === "market") App.renderPage();
  }
  async function hireApi(body) {
    const r = await fetch("/api/hire", { method: "POST", headers: { "Content-Type": "application/json", "X-Underthread": "1" }, body: JSON.stringify(body) });
    if (r.status === 404) throw new Error(L("看板服务还没重启，雇人的接口要重启一次才有。", "Restart the dashboard server once to enable hiring."));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  }

  /* ---------- t-hr-build: HR interview ---------- */
  const HR = "hr";
  const hrAgent = () => { const a = App.ST && App.ST.agents && App.ST.agents[HR]; return a && a.enabled !== false ? a : null; };
  const hrName = () => { const a = hrAgent(); return a ? App.aname(a) : L("HR", "HR"); };
  const openIv = () => ((App.ST && App.ST.items) || []).find(i => i.hire && i.stage !== "done" && !["hired", "abandoned"].includes(i.hire.status)) || null;
  const phone = () => matchMedia("(max-width: 760px)").matches;
  function openDm(id) { if (phone() && window.MRoute) MRoute({ dm: id }); else App.setChat(id); }
  function openCard(id) { if (phone() && window.MRoute) MRoute({ item: id }); else App.openItem(id); }
  async function ivApi(body) {
    const r = await fetch("/api/interview", { method: "POST", headers: { "Content-Type": "application/json", "X-Underthread": "1" }, body: JSON.stringify(body) });
    if (r.status === 404) throw new Error(L("看板服务还没重启，面试的接口要重启一次才有。", "Restart the dashboard server once to enable interviews."));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  }
  function hrBar(r) {
    if (!r) return;
    let bar = r.querySelector(".hr-iv");
    const it = App.UI.chat === HR ? openIv() : null;
    if (!it) { if (bar) bar.remove(); return; }
    const h = it.hire, draft = it.kind === "deliverable" && it.stage === "review", busy = h.status === "applying", xf = h.mode === "transfer";   /* t-ht-build: 调岗 uses the same bar */
    const prog = busy ? (xf ? L("正在调岗…", "Transferring…") : L("正在办入职…", "Onboarding…")) : draft ? L("草案好了，去卡上批", "Draft ready on the card")
      : h.status === "failed" ? (xf ? L("调岗没办成，看卡上的原因", "Transfer failed, see the card") : L("入职没办成，看卡上的原因", "Onboarding failed, see the card"))
      : xf ? L(`第 ${h.turns || 0}/${h.max_turns || 5} 轮`, `turn ${h.turns || 0}/${h.max_turns || 5}`)
      : L(`已问清 ${h.filled || 0}/5 · 第 ${h.turns || 0}/8 轮`, `${h.filled || 0}/5 settled · turn ${h.turns || 0}/8`);
    const xe = en() && !xf && App.tplEn ? App.tplEn(h.job, h.variant) : null;   /* t-i18n-c */
    const html = `<span class="hr-iv-t"><b>${xf ? `${L("调岗", "Transfer")}${L("：", ": ")}${esc(h.job_name || h.target)}` : en() ? `Interview: ${esc((xe && xe.job) || h.job_name || h.job)} (${esc((xe && xe.variant) || h.variant_label || h.variant)})` : `面试：${esc(h.job_name || h.job)}（${esc(h.variant_label || h.variant)}）`}</b><small>${esc(prog)}</small></span>`
      + `<button type="button" class="hr-iv-b${draft ? " go" : ""}" data-hr-card="${esc(it.id)}">${draft ? L("去批", "Review") : L("看卡", "Card")}</button>`
      + (busy ? "" : `<button type="button" class="hr-iv-b ghost" data-hr-quit="${esc(it.id)}">${L("放弃", "Drop")}</button>`);
    if (!bar) { bar = document.createElement("div"); bar.className = "hr-iv"; bar.setAttribute("role", "status"); const m = r.querySelector(".ch-msgs"); if (!m) return; m.before(bar); }
    if (h.tint) bar.style.setProperty("--hr-t", h.tint);
    if (bar.dataset.k !== html) { bar.dataset.k = html; bar.innerHTML = html; }
  }
  function quitSheet(id) {
    App.openModal(`<h2>${L("放弃这场面试？", "Drop this interview?")}</h2><p class="hr-q-p">${L("面试卡会关掉，聊过的内容还在私聊里。之后可以重新点「面试」。", "The card closes; the chat stays in the DM. You can start again from the market.")}</p>
      <div class="foot"><button class="btn" data-x>${L("接着聊", "Keep going")}</button><button class="btn primary" data-ok>${L("放弃面试", "Drop")}</button></div>`, m => {
      $("[data-x]", m).onclick = App.closeModal;
      $("[data-ok]", m).onclick = async () => {
        try { await ivApi({ op: "abandon", item: id }); App.closeModal(); App.toast(L("已放弃这场面试", "Interview dropped")); } catch (x) { App.toast(String(x.message || x), true); }
      };
    });
  }
  async function startIv(t, b) {
    b.disabled = true;
    try {
      const j = await ivApi({ op: "start", job: t.key, variant: vOf(t).key, lang: App.UI.lang });   /* t-i18n-c: English opening for an English UI */
      if (!j.ok) App.toast(j.error || "?", true);
      openDm(HR);
    } catch (x) { App.toast(String(x.message || x), true); }
    b.disabled = false;
  }

  const hiredOf = t => ((MK.data && MK.data.hired) || {})[t.key] || [];
  function badge(t) {
    const h = hiredOf(t), on = h.filter(x => x.on);
    if (on.length) return `<span class="mk-st on" title="${esc(on.map(x => x.name).join("、"))}">${L("在岗", "Hired")} · ${esc(on[0].name)}${on.length > 1 ? ` +${on.length - 1}` : ""}</span>`;
    if (h.length) return `<span class="mk-st back">${L("可返聘", "Can rehire")}</span>`;
    return "";
  }
  function sw(t, cls = "") {
    const cur = vOf(t);
    return `<div class="mk-sw ${cls}" role="radiogroup" aria-label="${L("性格", "Personality")}">${t.variants.map((v, i) =>
      `<button type="button" role="radio" aria-checked="${v.key === cur.key}" class="${v.key === cur.key ? "on" : ""}" data-mk-v="${i}" style="--t:${esc(v.tint)}"><i></i><span data-t="${esc(vLabel(v))}">${esc(vLabel(v))}</span></button>`).join("")}</div>`;   /* t-i18n-chips: data-t reserves the bold width in English (style.css) */
  }
  function btns(t) {
    const h = hiredOf(t), on = h.filter(x => x.on), off = h.filter(x => !x.on);
    const ha = hrAgent(), cur = openIv(), mine = cur && cur.hire.job === t.key;
    const iv = !ha ? `<button type="button" class="mk-b ghost hr-first" data-mk-hrfirst title="${L("面试要 HR 来问。先请 HR 入职（不用面试），再回来面试", "Interviews are done by HR. Hire HR first (no interview), then come back")}">${L("先请 HR", "Hire HR first")}</button>`   /* t-oss-gen-s4: was a disabled 面试 */
      : `<button type="button" class="mk-b ghost hr-ivb${mine ? " on" : ""}" data-mk-iv title="${esc(L(`${hrName()}替你问清要什么样的人，再出入职草案`, `${hrName()} asks what you need, then drafts the role`))}">${mine ? L("面试中", "Interviewing") : L("面试", "Interview")}</button>`;   /* t-ri1109-a P3: 「在岗」 moved to the page head (.mk-hrl) */
    if (on.length) return `<div class="mk-btns"><button type="button" class="mk-b ghost" data-mk-chat="${esc(on[0].id)}">${L("去聊天", "Chat")}</button><button type="button" class="mk-b ghost" data-mk-hire>${L("再雇一个", "Hire another")}</button></div>`;
    if (off.length) return `<div class="mk-btns">${iv}<button type="button" class="mk-b" data-mk-rehire="${esc(off[off.length - 1].id)}">${L("返聘", "Rehire")} · ${esc(off[off.length - 1].name)}</button><button type="button" class="mk-b ghost ht-arch" data-mk-arch="${esc(off[off.length - 1].id)}" data-name="${esc(off[off.length - 1].name)}" title="${esc(L("把文件挪进 archive/roles/，要再确认一次", "Move the files to archive/roles/ (asks again)"))}">${L("归档", "Archive")}</button></div>`;   /* t-ht-build: hard archive, template roles only */
    return `<div class="mk-btns">${iv}<button type="button" class="mk-b" data-mk-hire>${L("直接雇", "Hire")}</button></div>`;
  }
  function card(t) {
    const v = vOf(t), on = hiredOf(t).some(x => x.on);
    return `<article class="mk-card${on ? " hired" : ""}" data-mk="${esc(t.key)}" data-cat="${esc(t.cat)}" style="--t:${esc(v.tint)}">
      <div class="mk-top"><img class="mk-av" alt="" src="${avUrl(t, v)}" loading="lazy"><div class="mk-id"><b>${esc(en() ? t.title_en || t.job : t.job)}</b><small>${esc(en() ? t.job : t.title_en)}${t.cat ? " · " + esc(catL(t.cat)) : ""}</small></div>${badge(t)}</div>
      <p class="mk-duty">${esc(en() ? t.duty_en || t.duty : t.duty)}</p>
      ${sw(t)}<p class="mk-style">${esc(vStyle(v))}</p>
      <div class="mk-st-h">${L("派活可以这样说", "Try asking")}</div>${starters(t).slice(0, 2).map(s => `<div class="mk-q" title="${esc(s)}">${en() ? `“${esc(s)}”` : `「${esc(s)}」`}</div>`).join("")}
      ${btns(t)}</article>`;
  }
  function chips() {
    const ts = MK.data.templates, n = c => ts.filter(t => t.cat === c).length;
    const cats = CATS.filter(c => n(c)).concat([...new Set(ts.map(t => t.cat).filter(c => c && !CATS.includes(c)))]);
    const b = (k, label, cnt) => `<button type="button" role="tab" aria-selected="${MK.cat === k}" class="${MK.cat === k ? "on" : ""}" data-mk-cat="${esc(k)}">${esc(label)} <b>${cnt}</b></button>`;
    return `<div class="mk-chips" role="tablist">${b("all", L("全部", "All"), ts.length)}${cats.map(c => b(c, catL(c), n(c))).join("")}</div>`;
  }
  const visible = () => { const ts = MK.data.templates.slice().sort((a, b) => (CATS.indexOf(a.cat) + 1 || 99) - (CATS.indexOf(b.cat) + 1 || 99)); return MK.cat === "all" ? ts : ts.filter(t => t.cat === MK.cat); };
  const gridHTML = () => visible().map(card).join("") || `<div class="mk-empty">${L("这一类还没有模板", "No templates in this category")}</div>`;

  function page(head) {
    const body = $("#pagebody"), cur = body && $(".mk-page", body);
    load();
    const sub = MK.data ? L(`${MK.data.templates.length} 个工种 · 每个 3 种性格 · 雇了马上出现在团队里`, `${MK.data.templates.length} jobs · 3 personalities each · a hire joins the team right away`) : "";
    const iv0 = openIv(), key = [App.UI.lang, MK.err, MK.data ? JSON.stringify(MK.data) : "-", JSON.stringify(MK.pre || []), hrAgent() ? hrName() : "", iv0 ? iv0.id : ""].join("|");   /* t-hr-build: HR on / an interview running redraws the buttons */
    if (cur && cur.dataset.k === key) return null;   /* nothing changed: keep switches, filter and scroll */
    const inner = MK.err ? `<div class="mk-err" role="alert">${esc(MK.err)}</div>`
      : !MK.data ? `<div class="mk-load">${L("正在读模板…", "Loading templates…")}</div>`
      : preBar() + chips() + `<div class="mk-grid">${gridHTML()}</div>`;
    const ha = MK.data && hrAgent(), hrl = ha ? `<p class="mk-hrl">${App.av(ha, "mk-hrl-av")}<span><b>${esc(hrName())}${L("在岗", " is in")}</b> · ${esc(L("点任一张卡的「面试」，她先问清你要什么样的人", "tap Interview on any card and she asks what you need first"))}</span></p>` : "";   /* t-ri1109-a P3 */
    return (head || "") + `<div class="mk-page" data-k="${esc(key)}">${sub ? `<p class="mk-sub">${esc(sub)}</p>` : ""}${hrl}${inner}</div>`;
  }

  /* t-oss-gen-s4: a crew without HR hires her straight from templates/roles/hr (HR cannot interview herself); the steward then
     opens t-hr-avatar as for every hire. The server refuses it when HR is already on the team. */
  async function hrFirst(b) {
    if (b.disabled) return;
    b.disabled = true; const was = b.textContent; b.textContent = L("正在请…", "Hiring…");
    try {
      const off = App.ST.agents && App.ST.agents[HR];   /* an hr in the roster but switched off comes back as herself */
      const j = await hireApi(off ? { op: "rehire", id: HR } : { op: "apply", job: "hr", variant: "thimble", id: HR, name: "Thimble", tint: "#b0465a" });
      if (!j.ok) throw new Error((j.err || j.out || "").trim() || "failed");
      App.toast(L("HR 已入职，现在可以点「面试」了", "HR is in. Interview is open now"));
      await load(true);
    } catch (e) { App.toast(String(e.message || e), true); b.textContent = was; b.disabled = false; }
  }

  /* ---------- t-oss-gen-s4: 整队预设 (whole-team presets). tools/preset.py through POST /api/preset: dry run first, apply on confirm ---------- */
  const PRE_L = { classic: ["经典 7 人", "Classic seven"], "content-zh": ["自媒体 7 人", "Content team (zh)"] };
  const preLabel = p => (PRE_L[p.key] || [p.team, p.team])[en() ? 1 : 0];
  const roleL = r => (en() && r.name_en || r.name) + ((en() ? r.title_en || r.title : r.title) ? ` · ${en() ? r.title_en || r.title : r.title}` : "");
  async function preApi(body) {
    const r = await fetch("/api/preset", { method: "POST", headers: { "Content-Type": "application/json", "X-Underthread": "1" }, body: JSON.stringify(body) });
    if (r.status === 404) throw new Error(L("看板服务还没重启，整队预设的接口要重启一次才有。", "Restart the dashboard server once to enable presets."));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  }
  function preBar() {
    const ps = MK.pre || []; if (!ps.length) return "";
    return `<div class="mk-pre"><span class="mk-pre-l">${L("整队预设", "Team presets")}</span>${ps.map(p => `<button type="button" class="mk-pre-b${p.current ? " on" : ""}" data-mk-pre="${esc(p.key)}"${p.current ? ` aria-current="true" disabled` : ""}>${esc(preLabel(p))}<b>${p.current ? L("当前", "current") : p.roles.length + L(" 人", "")}</b></button>`).join("")}<small>${L("一次换整支队伍，先看预演再确认", "Swap the whole crew; you see a dry run first")}</small></div>`;
  }
  async function preOpen(key) {   /* t-oss-gen-s4a-wire: fresh who-leaves list on open; a hire writes roster.json seconds before /api/hire returns */
    try { const r = await fetch("/api/presets", { cache: "no-store" }); if (r.ok) MK.pre = (await r.json()).presets || []; } catch (_) {}
    const p = (MK.pre || []).find(x => x.key === key); if (p && !p.current) preSheet(p);
  }
  function preSheet(p) {
    const name = id => { const a = (App.ST.agents || {})[id]; return a ? App.aname(a) : id; };
    const chip = (t, cls) => `<span class="mk-pre-r${cls ? " " + cls : ""}">${esc(t)}</span>`;
    App.openModal(`<h2>${L("换成整队预设", "Switch to the preset")} · ${esc(preLabel(p))}</h2>
      <div class="mk-sh mk-pre-sh">
        <p class="mk-note">${esc(p.team)}</p>
        <label>${L("换完的队伍", "The crew after")} · ${p.roles.length}</label><div class="mk-pre-rs">${p.roles.map(r => chip(roleL(r), p.join.includes(r.id) ? "new" : "")).join("")}</div>
        ${p.leave.length ? `<label>${L("会离队", "Leaving")} · ${p.leave.length}</label><div class="mk-pre-rs">${p.leave.map(i => chip(name(i), "out")).join("")}</div>
        <p class="mk-note warn">${L("离队的人规则、记忆、头像文件都留着（不删），只是不在队伍里了", "Their notes, memory and art stay on disk; they just leave the roster")}${p.open_items ? L(`；他们手上 ${p.open_items} 张没做完的卡转回管家`, `; their ${p.open_items} open cards go back to the steward`) : ""}${p.leave.includes(HR) ? L("。HR 也会离队，之后可以在市场里「先请 HR」", ". HR leaves too; use Hire HR first in the market later") : ""}${L("。", ".")}</p>` : ""}
        <label>${L("会做的事（preset.py 预演，还没写任何文件）", "What happens (preset.py dry run, nothing written yet)")}</label>
        <pre class="mk-plan" data-plan aria-live="polite">…</pre>
        <p class="mk-note">${L("每个被替换的文件都先备份，换完会给出撤销命令。换完要重开管家会话，新队伍才能接活。", "Every replaced file is backed up first and you get the undo command. Restart the steward session afterwards.")}</p>
      </div>
      <div class="foot"><button class="btn" data-x>${L("取消", "Cancel")}</button><button class="btn primary" data-ok disabled>${L("换成这支队", "Switch")}</button></div>`, async m => {
      m.classList.add("mk-mdl");
      const ok = $("[data-ok]", m), plan = $("[data-plan]", m), x = $("[data-x]", m);
      x.onclick = App.closeModal;
      try { const j = await preApi({ op: "dry", name: p.key }); plan.textContent = (j.ok ? j.out : j.err || j.out).trim(); plan.classList.toggle("bad", !j.ok); ok.disabled = !j.ok; }
      catch (e) { plan.textContent = String(e.message || e); plan.classList.add("bad"); }
      ok.onclick = async () => {
        ok.disabled = true; ok.textContent = L("正在换…", "Switching…");
        try {
          const j = await preApi({ op: "apply", name: p.key });
          plan.textContent = (j.ok ? j.out : j.err || j.out).trim(); plan.classList.toggle("bad", !j.ok);
          if (!j.ok) { ok.textContent = L("换成这支队", "Switch"); ok.disabled = false; return; }
          ok.hidden = true; ok.style.display = "none"; x.textContent = L("关闭", "Close");   /* .btn sets display, so [hidden] alone shows it */
          App.toast(L(`已换成「${preLabel(p)}」，重开管家会话后生效`, `Switched to ${preLabel(p)}; restart the steward session`));
          load(true);
        } catch (e) { plan.textContent = String(e.message || e); plan.classList.add("bad"); ok.textContent = L("换成这支队", "Switch"); ok.disabled = false; }
      };
    });
  }

  /* ---------- hire sheet ---------- */
  function freeId(base, ids) { const b = String(base).toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 14) || "role"; if (!ids.includes(b)) return b; for (let n = 2; n < 99; n++) if (!ids.includes(b + n)) return b + n; return b + Date.now() % 1000; }
  function freeName(job) { const names = Object.values(App.ST.agents || {}).map(a => a.name); if (!names.includes(job)) return job; for (let n = 2; n < 99; n++) if (!names.includes(job + n)) return job + n; return job; }
  function sheet(t) {
    const st = { vi: Math.min(MK.pick[t.key] || 0, t.variants.length - 1), tintSet: false, seq: 0 };
    const ids = (MK.data.ids || []).concat(Object.keys(App.ST.agents || {}));
    const v0 = t.variants[st.vi];
    App.openModal(`<h2>${L("雇一个", "Hire a")} ${esc(en() ? t.title_en || t.job : t.job)}</h2>
      <div class="mk-sh">
        <div class="mk-sh-top"><img class="mk-av xl" alt="" src="${avUrl(t, v0)}"><div class="mk-sh-pv"><b data-pv-name></b><small>${esc(en() ? t.title_en || t.job : t.job)} · <span data-pv-v></span></small><p class="mk-say" data-pv-say></p></div></div>
        <label>${L("性格", "Personality")}</label><div class="mk-sw big" role="radiogroup">${t.variants.map((v, i) => `<button type="button" role="radio" aria-checked="${i === st.vi}" class="${i === st.vi ? "on" : ""}" data-sh-v="${i}" style="--t:${esc(v.tint)}"><i></i><span data-t="${esc(vLabel(v))}">${esc(vLabel(v))}</span></button>`).join("")}</div>
        <div class="mk-sh-row">
          <div><label for="mk-name">${L("名字", "Name")}</label><input type="text" id="mk-name" maxlength="20" value="${esc(freeName(t.job))}"></div>
          <div><label for="mk-id">id <small>${L("小写字母，雇后不能改", "lowercase, fixed after hiring")}</small></label><input type="text" id="mk-id" maxlength="16" value="${esc(freeId(t.key, ids))}"></div>
          <div class="mk-tint"><label for="mk-tint">${L("颜色", "Colour")}</label><input type="color" id="mk-tint" value="${esc(v0.tint)}"></div>
        </div>
        <label>${L("会做的事（new_role.py 预演，还没写任何文件）", "What happens (new_role.py dry run, nothing written yet)")}</label>
        <pre class="mk-plan" data-plan aria-live="polite">…</pre>
        <p class="mk-note">${L("雇完就出现在左栏 TEAM；管家要重开会话后才能派活给新角色。", "The new role shows in TEAM at once; the manager can dispatch to it after its session restarts.")}</p>
      </div>
      <div class="foot"><button class="btn" data-x>${L("取消", "Cancel")}</button><button class="btn primary" data-ok disabled>${L("确认雇用", "Hire")}</button></div>`, m => {
      m.classList.add("mk-mdl");
      const name = $("#mk-name", m), id = $("#mk-id", m), tint = $("#mk-tint", m), ok = $("[data-ok]", m), plan = $("[data-plan]", m);
      const cur = () => t.variants[st.vi];
      const fill = () => { const v = cur(); $("[data-pv-name]", m).textContent = name.value || t.job; $("[data-pv-v]", m).textContent = vLabel(v); $("[data-pv-say]", m).textContent = sample(v) || vStyle(v);
        if (!st.tintSet) tint.value = v.tint; $(".mk-av", m).src = avUrl(t, v); m.style.setProperty("--t", tint.value); };
      let tm = 0;
      const dry = () => { clearTimeout(tm); ok.disabled = true; plan.classList.remove("bad"); plan.textContent = "…"; const my = ++st.seq;
        tm = setTimeout(async () => {
          try { const j = await hireApi({ op: "plan", job: t.key, variant: cur().key, id: id.value.trim(), name: name.value.trim(), tint: tint.value });
            if (my !== st.seq) return;
            plan.textContent = (j.ok ? j.out : j.err || j.out).trim(); plan.classList.toggle("bad", !j.ok); ok.disabled = !j.ok;
          } catch (e) { if (my === st.seq) { plan.textContent = String(e.message || e); plan.classList.add("bad"); } }
        }, 350); };
      m.addEventListener("click", e => { const b = e.target.closest("[data-sh-v]"); if (!b) return;
        st.vi = +b.dataset.shV; m.querySelectorAll("[data-sh-v]").forEach(x => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-checked", on); }); fill(); dry(); });
      name.addEventListener("input", () => { fill(); dry(); }); id.addEventListener("input", dry);
      tint.addEventListener("input", () => { st.tintSet = true; fill(); dry(); });
      $("[data-x]", m).onclick = App.closeModal;
      ok.onclick = async () => {
        ok.disabled = true; ok.textContent = L("正在雇…", "Hiring…");
        try {
          const j = await hireApi({ op: "apply", job: t.key, variant: cur().key, id: id.value.trim(), name: name.value.trim(), tint: tint.value });
          if (!j.ok) { plan.textContent = (j.err || j.out).trim(); plan.classList.add("bad"); ok.textContent = L("确认雇用", "Hire"); return; }
          App.closeModal(); MK.pick[t.key] = st.vi;
          undoBar(L(`${name.value.trim()} · 已出现在左栏 TEAM`, `${name.value.trim()} · now in TEAM`), id.value.trim());
          await load(true);
        } catch (e) { plan.textContent = String(e.message || e); plan.classList.add("bad"); ok.textContent = L("确认雇用", "Hire"); ok.disabled = false; }
      };
      fill(); dry(); name.focus(); name.select();
    });
  }
  function undoBar(msg, rid) {   /* same look as the 定时 delete undo (#sc-undo); 8 s to take it back */
    let el = $("#mk-undo"); if (!el) { el = document.createElement("div"); el.id = "mk-undo"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    el.innerHTML = `<span class="rv-u-tx"><b>${L("已雇", "Hired")}</b>${esc(msg)}</span><button type="button" data-mk-undo="${esc(rid)}">${L("撤销", "Undo")}</button><i class="rv-u-bar" style="--hold:8000ms"></i>`;
    el.classList.remove("on"); void el.offsetWidth; el.classList.add("on");
    clearTimeout(undoBar.t); undoBar.t = setTimeout(() => el.classList.remove("on"), 8000);
  }

  function archSheet(id, name) {   /* t-ht-build: 归档 = new_role.py retire --hard; the second step is this sheet */
    App.openModal(`<h2>${L("归档", "Archive")} ${esc(name)}？</h2><p class="hr-q-p">${L(`TA 的 roles 文件、记忆、头像、交接单会挪进 archive/roles/（不删）。归档后「返聘」按钮会消失，要回来得用 new_role.py rehire ${esc(id)} --from-archive。`, `Notes, memory, art and the handoff move to archive/roles/ (nothing deleted). Rehire then needs new_role.py rehire ${esc(id)} --from-archive.`)}</p>
      <div class="foot"><button class="btn" data-x>${L("算了", "Cancel")}</button><button class="btn primary" data-ok>${L("确认归档", "Archive")}</button></div>`, m => {
      $("[data-x]", m).onclick = App.closeModal;
      $("[data-ok]", m).onclick = async ev => { ev.currentTarget.disabled = true;
        try { const j = await hireApi({ op: "archive", id, confirm: id }); App.closeModal(); App.toast(j.ok ? L(`已归档 · ${name}`, `Archived · ${name}`) : (j.err || "?"), !j.ok); } catch (x) { App.toast(String(x.message || x), true); }
        load(true); };
    });
  }

  /* ---------- events ---------- */
  document.addEventListener("click", async e => {
    const pg = e.target.closest(".mk-page"), ub = e.target.closest("[data-mk-undo]");
    if (ub) {
      const rid = ub.dataset.mkUndo; $("#mk-undo").classList.remove("on");
      try { const j = await hireApi({ op: "retire", id: rid }); App.toast(j.ok ? L("已撤销：退到可返聘", "Undone: retired, can rehire") : (j.err || "?"), !j.ok); } catch (x) { App.toast(String(x.message || x), true); }
      return load(true);
    }
    if (!pg) return;
    const pb = e.target.closest("[data-mk-pre]");
    if (pb) { preOpen(pb.dataset.mkPre); return; }
    const c = e.target.closest("[data-mk-cat]");
    if (c) { MK.cat = c.dataset.mkCat; pg.querySelectorAll("[data-mk-cat]").forEach(b => { const on = b === c; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
      const g = $(".mk-grid", pg); g.innerHTML = gridHTML(); g.classList.remove("in"); void g.offsetWidth; g.classList.add("in"); return; }
    const cd = e.target.closest("[data-mk]"); if (!cd) return;
    const t = MK.data.templates.find(x => x.key === cd.dataset.mk); if (!t) return;
    const vb = e.target.closest("[data-mk-v]");
    if (vb) {   /* switch in place: avatar, tint, style line follow; the card node stays (its transitions run) */
      MK.pick[t.key] = +vb.dataset.mkV; const v = vOf(t);
      cd.querySelectorAll("[data-mk-v]").forEach(b => { const on = b === vb; b.classList.toggle("on", on); b.setAttribute("aria-checked", on); });
      cd.style.setProperty("--t", v.tint); $(".mk-av", cd).src = avUrl(t, v);
      const st = $(".mk-style", cd); st.classList.remove("in"); st.textContent = vStyle(v); void st.offsetWidth; st.classList.add("in");
      return;
    }
    if (e.target.closest("[data-mk-hrfirst]")) return hrFirst(e.target.closest("[data-mk-hrfirst]"));
    const ivb = e.target.closest("[data-mk-iv]");
    if (ivb) { if (ivb.classList.contains("dis")) return; return startIv(t, ivb); }   /* t-hr-build: disabled until the HR role exists (tooltip says so) */
    const ch = e.target.closest("[data-mk-chat]"); if (ch) { App.setChat(ch.dataset.mkChat); return; }
    if (e.target.closest("[data-mk-hire]")) return sheet(t);
    const rh = e.target.closest("[data-mk-rehire]");
    if (rh) { rh.disabled = true;
      try { const j = await hireApi({ op: "rehire", id: rh.dataset.mkRehire }); if (!j.ok) App.toast(j.err || "?", true); else if (window.HT) HT.afterRehire(j, rh.textContent.split("·").pop().trim()); else App.toast(L("已返聘", "Rehired")); } catch (x) { App.toast(String(x.message || x), true); }
      return load(true); }
    const ar = e.target.closest("[data-mk-arch]");
    if (ar) return archSheet(ar.dataset.mkArch, ar.dataset.name);
  });

  document.addEventListener("click", e => {   /* t-hr-build: the hr-iv bar in the HR DM */
    const c = e.target.closest("[data-hr-card]"); if (c) { openCard(c.dataset.hrCard); return; }
    const q = e.target.closest("[data-hr-quit]"); if (q) quitSheet(q.dataset.hrQuit);
  });

  window.Market = { page, load, hrBar, _mk: MK };
})();
