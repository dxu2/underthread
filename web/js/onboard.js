/* t-onboarding P0 (plan v4 section 五): the first ten minutes of a fresh install.
   - 开工清单: the desktop widget "setup" (full row, first on a new board) and a phone card under the stat row. Steps are ticked by the server
     from what really happened (api/routes/setup.py, ST.meta.setup; absent = retired, so nothing here draws). Once steps 1-6 are ticked the
     page records done_at (action onboarding op=done); the next day the checklist retires; 「添加小组件」 brings it back (op=show).
   - Steward offline card at the top of the steward chat (desk and phone share #right): what the steward is, the one command, how many of
     your lines are queued; it turns into 「上线了」 until you have said something.
   - 快捷指南 ①②③ (data: web/js/core/quickguide.js): chips above the chat field (only in the steward chat, only while the field is empty;
     after 20 of your messages they fold into one 💡 button; 设置 → 外观 turns them off), three examples in an empty steward chat, and the
     bubble of step 4. A click only fills the field and selects the X; nothing is sent.
   - 点亮 (steps 3 and 4): a ring + bubble that follow their target every frame (the chat and the home are rebuilt by polls), no scrim, so the
     page stays usable; Esc / 知道了 / the step getting ticked closes it. Never opens by itself. */
(() => {
  const A = () => window.App, $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const en = () => A() && A().UI.lang === "en";
  const L = (zh, e) => en() ? e : zh;
  const phone = () => matchMedia("(max-width: 760px)").matches;
  const SU = () => { const a = A(); return a && a.ST && a.ST.meta && a.ST.meta.setup || null; };
  const QD = () => window.QGDATA || { zh: [], en: [], chips: [], answer: { zh: [], en: [] } };
  const groups = () => QD()[en() ? "en" : "zh"] || [];
  const mgr = () => A().agent("manager") || { id: "manager" };
  const mgrName = () => A().aname(mgr()) || L("管家", "Steward");
  const LSG = (k, d) => { try { const v = JSON.parse(localStorage.getItem("rt." + k)); return v == null ? d : v; } catch (e) { return d; } };
  const LSS = (k, v) => { try { localStorage.setItem("rt." + k, JSON.stringify(v)); } catch (e) { } };
  const post = body => fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ kind: "onboarding" }, body)) }).catch(() => { });

  // ---------- steps ----------
  const NAME = { board: ["看板跑起来了", "Board is up"], team: ["团队就位", "Team in place"], wake: ["叫醒管家", "Wake the steward"], say: ["说第一句话", "Say your first line"],
    card: ["派出第一张卡", "First card goes out"], decide: ["拍一次板", "Make one call"], about: ["让管家认识你", "Let the steward know you"] };
  const teamN = () => Object.values((A().ST && A().ST.agents) || {}).filter(a => a.enabled !== false).length;
  const short = (k, done) => {
    if (k === "team" && done) return L(`${teamN()} 人`, `${teamN()} people`);
    if (done) return "";
    return { team: L("生成 agent 文件", "make the agent files"), wake: L("在终端跑一行", "one line in a terminal"), say: L("点快捷句也行", "a quick phrase works"),
      card: L(`${mgrName()} 派单`, `${mgrName()} hands it out`), decide: L("示例卡也算", "samples count"), about: L("可选 · 下一版", "optional · next release") }[k] || "";
  };
  const hint = k => ({
    board: "",
    team: L("在终端运行 python3 make_agents.py，给每位队员生成 agent 文件，然后重开管家。", "Run python3 make_agents.py in a terminal to write each teammate's agent file, then restart the steward."),
    wake: L(`在电脑终端里跑一行命令，${mgrName()} 就上线了。你现在说的话会先排队。`, `Run one line in a terminal on the computer and ${mgrName()} comes online. Anything you say now waits in the queue.`),
    say: L(`跟 ${mgrName()} 说一件你想做的事，点输入框上面的快捷句也行。`, `Tell ${mgrName()} one thing you want done; the quick phrases above the field work too.`),
    card: L(`${mgrName()} 会把你的话变成卡，交给合适的队员；左边「TEAM」里亮起来的就是在做的人。`, `${mgrName()} turns what you said into a card and hands it to a teammate; whoever lights up under TEAM is on it.`),
    decide: L("打开一张「等你拍板」的卡（示例卡也算）：批准、驳回写原因，或者回答一个问题。", "Open a card that waits on you (the samples count): approve it, reject it with a reason, or answer a question."),
    about: "",
  }[k] || "");
  const act = k => k === "wake" ? L("点亮 ›", "Show me ›") : k === "say" ? L("点亮 ›", "Show me ›") : k === "team" ? L("复制命令", "Copy command") : "";
  const stepBtn = (s, i, cur) => `<button type="button" class="ob-st${s.done ? " done" : ""}${cur ? " cur" : ""}${s.optional ? " opt" : ""}" data-ob-step="${s.id}"${s.done ? ' aria-disabled="true"' : ""}${short(s.id, s.done) ? ` title="${esc(short(s.id, s.done))}"` : ""}>`
    + `<i aria-hidden="true">${s.done ? "✓" : i + 1}</i><b>${esc(L(...NAME[s.id]))}</b>${short(s.id, s.done) ? `<small>· ${esc(short(s.id, s.done))}</small>` : ""}</button>`;
  const bar = d => `<div class="ob-bar" aria-hidden="true">${d.steps.filter(s => !s.optional).map(s => `<span class="${s.done ? "on" : ""}"></span>`).join("")}</div>`;
  const hintLine = d => { const k = d.next; if (!k) return ""; const a = act(k);
    return `<div class="ob-hint"><span>${esc(hint(k))}</span>${a ? `<button type="button" class="ob-go" data-ob-step="${k}">${esc(a)}</button>` : ""}</div>`; };
  const doneLine = () => `<div class="ob-done"><b>✓ ${esc(L("全部完成", "All set"))}</b><span>${esc(phone() ? L("明天起这张卡会自己退下。", "This card steps aside tomorrow.") : L("明天起这一格会自己退下；想再看，在「编辑小组件」里加回。", "This tile steps aside tomorrow; add it back from Edit widgets any time."))}</span></div>`;
  const count = d => `${d.n} / ${d.of}`;

  /* desktop widget: one full row, all seven steps in a line, the current step's hint under it */
  function widget(s, D, kit) {
    const d = SU(); if (!d) return kit.eb("setup");
    const cur = d.next;
    return `<div class="wg-eb"><b>${esc(L("开工清单", "Getting started"))}</b><span class="n">${esc(count(d))}</span></div>` + bar(d)
      + `<div class="ob-steps">${d.steps.map((x, i) => stepBtn(x, i, x.id === cur)).join("")}</div>` + (d.all ? doneLine() : hintLine(d));
  }
  /* phone card under the stat row: the current step only; 全部 › opens the list */
  const PH = { all: false };
  function phoneCard() {
    const d = SU(); if (!d || !phone()) return "";
    const cur = d.next, list = d.all ? [] : PH.all ? d.steps : d.steps.filter(x => x.id === cur);   // all done: the bar and one line
    return `<section class="ob-card${d.all ? " is-done" : ""}" data-ob-card><div class="ob-hd"><b>${esc(L("开工清单", "Getting started"))}</b><span class="n">${esc(count(d))}</span>`
      + (d.all ? `<button type="button" class="ob-lnk" data-ob-hide>${esc(L("现在收起", "Hide now"))}</button>` : `<button type="button" class="ob-lnk" data-ob-all aria-expanded="${PH.all}">${esc(PH.all ? L("收起", "Less") : L("全部 ›", "All ›"))}</button>`)
      + `</div>${bar(d)}${list.length ? `<div class="ob-steps">${list.map(x => stepBtn(x, d.steps.indexOf(x), x.id === cur)).join("")}</div>` : ""}${d.all ? doneLine() : hintLine(d)}</section>`;
  }

  // ---------- steward chat: offline card, examples, chips ----------
  const mgrOff = () => { const m = mgr(); return !m.last_seen || m.status === "offline"; };
  const queued = () => (A().ST.meta && A().ST.meta.inbox_unacked) || 0;
  const cmdLine = d => `cd "${d.root}" && ${d.cmd}`;
  const canCopy = () => !!(navigator.clipboard && window.isSecureContext);
  function chatTop() {
    const d = SU(); if (!d || A().UI.chat !== "manager") return "";
    if (mgrOff()) return `<div class="ob-off" data-ob-off><b class="ob-t"><i class="ob-dot" aria-hidden="true"></i>${esc(L(`${mgrName()} 还没上线`, `${mgrName()} is not online yet`))}</b>`
      + `<p>${esc(L(`${mgrName()} 是一直开着的 Claude Code 会话：读你在这里说的话，开卡，交给队员。你的话会先排队，它一上线就先处理（已排队 ${queued()} 条）。在这个文件夹里另开一个终端，运行：`,
        `${mgrName()} is a Claude Code session that stays open: it reads what you say here, opens cards and hands them out. What you say waits in a queue and is read first when it comes online (${queued()} queued). Open another terminal in this folder and run:`))}</p>`
      + `<div class="ob-cmd"><code>${esc(d.cmd)}</code><button type="button" class="ob-copy" data-ob-copy="cmd">${esc(phone() ? L("在电脑上跑", "Run on the computer") : L("复制", "Copy"))}</button></div>`
      + `<small>${esc(L(`文件夹：${d.root}。第一次会让你登录 Claude、确认信任这个文件夹。上线后这里会变成 ▶ 在线。`, `Folder: ${d.root}. The first time, Claude asks you to sign in and to trust this folder. When it is up, this turns into ▶ online.`))}</small></div>`;
    const said = (d.steps.find(x => x.id === "say") || {}).done;
    if (!said) return `<div class="ob-off on"><b class="ob-t"><i class="ob-dot" aria-hidden="true"></i>${esc(L(`${mgrName()} 上线了`, `${mgrName()} is online`))}</b><p>${esc(L("说第一句话吧：点下面的例句，或者直接打字。", "Say your first line: tap an example below, or just type."))}</p></div>`;
    return "";
  }
  const whoOf = g => { const ag = A().ST.agents || {}, id = (g.to || []).find(x => ag[x] && ag[x].enabled !== false);
    if (id) return { nm: A().aname(ag[id]) };
    if (g.hire) return { nm: g.fall && ag[g.fall] ? A().aname(ag[g.fall]) : "", hire: g.hire };
    return { nm: g.fall && ag[g.fall] ? A().aname(ag[g.fall]) : mgrName() }; };
  const whoHTML = g => { const w = whoOf(g); return (w.nm ? esc(w.nm) : "") + (w.hire ? `${w.nm ? " · " : ""}<span class="qg-hire" data-ob-hire role="link" tabindex="0">${esc(L(`招 ${w.hire} ›`, `hire ${w.hire} ›`))}</span>` : ""); };
  const exBtn = (g, cls) => `<button type="button" class="${cls}" data-qg="${esc(g.ex[0])}"><span>${esc(g.ex[0])}</span><small>${whoHTML(g)} · ${esc(g.see)}</small></button>`;
  const pick3 = () => { const G = groups(); return QD().chips.slice(0, 3).map(k => G.find(g => g.k === k)).filter(Boolean); };
  /* ② the empty steward chat: three examples with who gets it and what comes back */
  function chatEmpty() {
    return `<div class="qg-ex"><h5>${esc(L("可以这样说 · 点一下填进输入框", "Try saying · tap to fill the field"))}</h5>${pick3().map(g => exBtn(g, "qg-exb")).join("")}</div>`;
  }
  /* ① the chip row above the field */
  const QG = { open: false, pop: false };
  const qgOn = () => LSG("qg", true) !== false;
  const mine = () => { try { return A().chatList("manager").filter(m => m.who === "me").length; } catch (e) { return 0; } };
  function rowHTML() {
    const G = groups(), chips = QD().chips.map(k => G.find(g => g.k === k)).filter(Boolean);
    if (mine() >= 20 && !QG.open) return `<button type="button" class="qg-bulb" data-qg-open aria-label="${esc(L("快捷句", "Quick phrases"))}" title="${esc(L("快捷句", "Quick phrases"))}">💡</button>`;
    return chips.map(g => `<button type="button" class="qg-c" data-qg="${esc(g.ex[0])}">${esc(g.chip)}</button>`).join("")
      + `<button type="button" class="qg-c qg-all" data-qg-all aria-expanded="${QG.pop}">${esc(L("全部说法 ›", "All phrases ›"))}</button>`;
  }
  function popHTML() {
    const G = groups(), ans = QD().answer[en() ? "en" : "zh"] || [];
    return `<div class="qg-pop" role="dialog" aria-label="${esc(L("跟管家怎么说", "What to say"))}"><div class="qg-ph"><b>${esc(L(`跟 ${mgrName()} 怎么说`, `What to say to ${mgrName()}`))}</b><button type="button" class="qg-x" data-qg-close aria-label="${esc(L("关闭", "Close"))}">×</button></div>`
      + G.map(g => `<section><h6>${esc(g.g)}<small>${whoHTML(g)}</small></h6>${g.ex.map(x => `<button type="button" class="qg-pe" data-qg="${esc(x)}">${esc(x)}</button>`).join("")}<p>${esc(g.see)}</p></section>`).join("")
      + `<section class="qg-ans"><h6>${esc(L("卡来了怎么回", "When a card comes back"))}</h6>${ans.map(x => `<p>${esc(x)}</p>`).join("")}</section></div>`;
  }
  function row(r) {
    if (!r) return;
    const comp = $(".ch-comp", r); if (!comp) return;
    let el = $(":scope > .qg-row", r);
    if (!el) { el = document.createElement("div"); el.className = "qg-row"; el.setAttribute("role", "toolbar"); el.setAttribute("aria-label", L("快捷句", "Quick phrases")); comp.before(el); }
    const ta = $("textarea", comp);
    if (ta && !ta._qg) { ta._qg = 1; ta.addEventListener("input", () => paintRow(r)); }
    const h = rowHTML() + (QG.pop ? popHTML() : "");
    if (el._h !== h) { el.innerHTML = h; el._h = h; }
    paintRow(r);
  }
  function paintRow(r) {
    const el = r && $(":scope > .qg-row", r), ta = r && $(".ch-comp textarea", r); if (!el) return;
    const show = qgOn() && A().UI.chat === "manager" && (!ta || !ta.value.trim() || QG.pop);
    el.hidden = !show;
  }

  /* fill the steward's field: never sends. "X" (or the X inside 「」 / “”) is selected so the next keystroke replaces it */
  function fill(text) {
    const go = () => {
      const ta = $("#right .ch-comp textarea"); if (!ta) return false;
      ta.value = text; ta.dispatchEvent(new Event("input", { bubbles: true }));
      ta.focus({ preventScroll: true });
      const i = text.indexOf("X"); if (i >= 0) ta.setSelectionRange(i, i + 1); else ta.setSelectionRange(text.length, text.length);
      return true;
    };
    QG.pop = false; unlight();
    if (A().UI.chat !== "manager" || (phone() && document.body.dataset.cv !== "thread")) { A().route("#dm=manager"); setTimeout(go, 120); } else go();
    unfold();
  }
  const unfold = () => { if (!phone() && A().UI.chatFold) { const f = $("#right .ch-fold"); if (f) f.click(); } };

  async function copyCmd(btn) {
    const d = SU(); if (!d) return;
    const txt = btn.dataset.obCopy === "agents" ? `cd "${d.root}" && ${d.agents_cmd}` : cmdLine(d);
    if (canCopy()) { try { await navigator.clipboard.writeText(txt); A().toast(L("已复制，粘到终端里回车", "Copied: paste it into a terminal")); return; } catch (e) { } }
    const code = btn.closest(".ob-cmd") && btn.closest(".ob-cmd").querySelector("code");   // phone over http: no clipboard, select the line instead
    if (code) { const rg = document.createRange(); rg.selectNodeContents(code); const s = getSelection(); s.removeAllRanges(); s.addRange(rg); }
    A().toast(phone() ? L("这行要在电脑终端里跑，已选中，可长按复制", "Run this on the computer; it is selected, long-press to copy") : L("已选中，按 ⌘C 复制", "Selected: press ⌘C to copy"));
  }

  // ---------- 点亮 (steps 3 and 4) ----------
  const LT = { k: null, ring: null, bub: null, raf: 0 };
  const target = k => k === "wake" ? $("#right .ob-off") : $("#right .ch-comp textarea");
  function light(k) {
    unlight(); LT.k = k;
    if (A().UI.chat !== "manager" || (phone() && document.body.dataset.cv !== "thread") || (!phone() && getComputedStyle($("#right")).display === "none")) A().route("#dm=manager");
    unfold();
    LT.ring = document.createElement("div"); LT.ring.className = "ob-ring"; LT.ring.setAttribute("aria-hidden", "true");
    LT.bub = document.createElement("div"); LT.bub.className = "ob-bub"; LT.bub.setAttribute("role", "dialog");
    const d = SU() || {};
    LT.bub.innerHTML = k === "wake"
      ? `<b>${esc(L("叫醒管家", "Wake the steward"))}</b><p>${esc(L(`在电脑终端里跑上面这一行，${mgrName()} 就上线了。上线后这一步会自己打勾。`, `Run the line above in a terminal on the computer and ${mgrName()} comes online. This step ticks itself.`))}</p>`
        + `<div class="ob-bb">${d.cmd ? `<button type="button" class="ob-go" data-ob-copy="cmd">${esc(phone() ? L("在电脑上跑", "Run on the computer") : L("复制命令", "Copy command"))}</button>` : ""}<button type="button" class="ob-lnk" data-ob-unlight>${esc(L("知道了", "Got it"))}</button></div>`
      : `<b>${esc(L("说第一句话", "Say your first line"))}</b><p>${esc(L("点一句填进输入框，改一改再发：", "Tap one to fill the field, edit it, then send:"))}</p>`
        + `<div class="ob-bq">${pick3().map(g => `<button type="button" class="qg-c" data-qg="${esc(g.ex[0])}">${esc(g.ex[0])}</button>`).join("")}</div><div class="ob-bb"><button type="button" class="ob-lnk" data-ob-unlight>${esc(L("知道了", "Got it"))}</button></div>`;
    LT.bub.setAttribute("aria-label", L(...NAME[k]));
    document.body.append(LT.ring, LT.bub);
    // the offline card sits at the top of the steward chat, which opens pinned to the bottom: bring the card's top into view (under the floating phone header too)
    // the offline card sits at the top of the steward chat, which opens pinned to the bottom: bring the card's top into view (under the floating phone header too).
    // Twice: the first 200 ms composer tick (phone/composer.js sync, which also runs on the desk) can re-pin a list that is within 90 px of its end.
    const reveal = () => {
      const el = LT.k === "wake" && target("wake"), sc = el && el.closest(".ch-msgs"); if (!sc) return;
      const d = el.getBoundingClientRect().top - sc.getBoundingClientRect().top - (parseFloat(getComputedStyle(sc).paddingTop) || 0);
      if (d >= -2) return;
      sc.dispatchEvent(new WheelEvent("wheel"));   // ends the desk's 1.5 s settle pin (views/chat.js chatPinWatch stops on a wheel in the list)
      sc.scrollBy({ top: d - 4, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    };
    if (k === "wake") { setTimeout(reveal, 80); setTimeout(reveal, 450); }
    const step = () => {
      if (!LT.k) return;
      const s = SU(), st = s && s.steps.find(x => x.id === LT.k);
      if (!s || (st && st.done)) { unlight(); return; }
      const el = target(LT.k), r = el && el.getBoundingClientRect();
      const vis = r && r.width > 0 && r.height > 0;
      LT.ring.hidden = LT.bub.hidden = !vis;
      if (vis) {
        const pad = 6; Object.assign(LT.ring.style, { left: r.left - pad + "px", top: r.top - pad + "px", width: r.width + pad * 2 + "px", height: r.height + pad * 2 + "px" });
        const bw = LT.bub.offsetWidth, bh = LT.bub.offsetHeight, vw = innerWidth, vh = innerHeight, gap = 14;
        const below = r.bottom + gap + bh < vh - 8 && r.top < vh / 2;
        const top = below ? r.bottom + gap : Math.max(8, r.top - gap - bh);
        const left = Math.min(vw - bw - 8, Math.max(8, r.left + r.width / 2 - bw / 2));
        LT.bub.style.left = left + "px"; LT.bub.style.top = top + "px"; LT.bub.dataset.side = below ? "below" : "above";
      }
      LT.raf = requestAnimationFrame(step);
    };
    LT.raf = requestAnimationFrame(step);
  }
  function unlight() { LT.k = null; cancelAnimationFrame(LT.raf); if (LT.ring) LT.ring.remove(); if (LT.bub) LT.bub.remove(); LT.ring = LT.bub = null; }

  // ---------- clicks ----------
  document.addEventListener("click", e => {
    const t = e.target.closest && e.target.closest("[data-qg],[data-qg-all],[data-qg-close],[data-qg-open],[data-ob-step],[data-ob-copy],[data-ob-unlight],[data-ob-all],[data-ob-hide],[data-ob-hire],[data-qg-tog]");
    if (!t) { if (QG.pop && !(e.target.closest && e.target.closest(".qg-pop"))) { QG.pop = false; row($("#right")); } return; }
    if (t.dataset.qgTog != null) return;   // the settings switch has its own listener below
    e.preventDefault(); e.stopPropagation();
    if (t.dataset.obHire != null) { QG.pop = false; unlight(); A().go("market"); return; }
    if (t.dataset.qg != null) return fill(t.dataset.qg);
    if (t.dataset.qgAll != null) { QG.pop = !QG.pop; row($("#right")); return; }
    if (t.dataset.qgClose != null) { QG.pop = false; row($("#right")); return; }
    if (t.dataset.qgOpen != null) { QG.open = true; row($("#right")); return; }
    if (t.dataset.obCopy) return copyCmd(t);
    if (t.dataset.obUnlight != null) return unlight();
    if (t.dataset.obAll != null) { PH.all = !PH.all; A().refreshPage(); return; }
    if (t.dataset.obHide != null) { post({ op: "hide" }); const c = t.closest(".ob-card"); if (c) c.remove(); return; }
    const k = t.dataset.obStep, s = SU(), st = s && s.steps.find(x => x.id === k);
    if (!st || st.done) return;
    if (k === "wake" || k === "say") return light(k);
    if (k === "team") { const b = document.createElement("button"); b.dataset.obCopy = "agents"; return copyCmd(b); }
  }, true);
  document.addEventListener("keydown", e => { if (e.key !== "Escape") return; if (LT.k) unlight(); if (QG.pop) { QG.pop = false; row($("#right")); } });

  // ---------- settings: 外观 → 快捷句 ----------
  const sub = on => on ? L("在管家聊天的输入框上方显示例句，点一下填进输入框", "Example lines above the steward's chat field; a tap fills the field") : L("已关闭", "Off");
  function settingsRow(en_) {
    const on = qgOn();
    return `<button type="button" class="st-row" data-qg-tog aria-pressed="${on}"><span class="st-tx"><b>${en_ ? "Quick phrases" : "快捷句"}</b><small>${esc(sub(on))}</small></span><span class="sw${on ? " on" : ""}" aria-hidden="true"><i></i></span></button>`;
  }
  document.addEventListener("click", e => {
    const b = e.target.closest && e.target.closest("[data-qg-tog]"); if (!b) return;
    const on = !qgOn(); LSS("qg", on);
    b.setAttribute("aria-pressed", String(on)); const sw = b.querySelector(".sw"); if (sw) sw.classList.toggle("on", on);
    const sm = b.querySelector(".st-tx small"); if (sm) sm.textContent = sub(on);
    paintRow($("#right"));
  });

  // ---------- done_at: recorded once, the first time this page sees steps 1-6 ticked ----------
  let sentDone = false;
  const tick = () => { const d = SU(); if (d && d.all && !d.done_at && !sentDone) { sentDone = true; post({ op: "done" }); } };
  if (A() && A().on) A().on(tick); else document.addEventListener("DOMContentLoaded", () => A() && A().on && A().on(tick));
  // step 2 (team) is a file in .claude/agents/, which does not move the state revision the long poll waits on: while it is the next step, ask /api/setup
  setInterval(() => {
    const d = SU(); if (!d || d.next !== "team" || document.hidden) return;
    fetch("/api/setup", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(n => {
      const cur = SU(); if (!n || !cur || n.n === cur.n) return;
      A().ST.meta.setup = n; A().refreshPage();
    }).catch(() => { });
  }, 6000);

  if (window.UTExt) UTExt.widget({ id: "setup", name: ["开工清单", "Getting started"], sizes: ["w"], size: "w", first: true, core: true, html: widget,
    gone: () => !SU(), revive: () => post({ op: "show" }) });
  window.Onboard = { chatTop, chatEmpty, row, phoneCard, settingsRow, light, unlight, fill };
})();
