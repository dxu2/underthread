/* t-onboarding P0 (plan v4 section 五): the first ten minutes of a fresh install.
   - 开工清单: the desktop widget "setup" (full row, first on a new board) and a phone card under the stat row. Steps are ticked by the server
     from what really happened (api/routes/setup.py, ST.meta.setup; absent = retired, so nothing here draws). Once steps 1-6 are ticked the
     page records done_at (action onboarding op=done); the next day the checklist retires; 「添加小组件」 brings it back (op=show).
   - Steward offline card at the top of the steward chat (desk and phone share #right): what the steward is, the one command, how many of
     your lines are queued; it turns into 「上线了」 until you have said something.
   - 快捷指南 ①②③ (data: web/js/core/quickguide.js): chips above the chat field (only in the steward chat, only while the field is empty;
     after 20 of your messages they fold into one 「想说点什么？」 button; 设置 → 外观 turns them off), three examples in an empty steward chat, and the
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

  // ---------- sample cards (q-demo-*, from state.example.json) ----------
  /* t-onb-polish: a sample reads as one at a glance. exT(it) = the title without its 「（示例）」 / "(sample)" suffix plus an Example tag;
     exNote(it) = the line in the card detail saying what a click does; the Waiting on you widget's footer and that line offer 清掉示例
     (action onboarding op=clear_samples archives every live sample; archived cards can still be opened from search). */
  const isEx = it => !!it && /^q-demo-/.test(String(it.id || ""));
  const exTag = () => `<span class="ex-tag">${esc(L("示例", "Example"))}</span>`;
  const exT = it => isEx(it) ? esc(String(it.title || "").replace(/\s*[（(](?:示例|sample)[)）]\s*$/i, "")) + exTag() : esc(it && it.title);
  const exLive = () => ((A().ST && A().ST.items) || []).filter(i => isEx(i) && !i.archived);
  const exClear = `<button type="button" class="ex-clr" data-ex-clear>${esc(L("清掉示例", "Clear examples"))}</button>`;
  const exNote = it => isEx(it) ? `<div class="ex-note"><span>${esc(L("这是示例卡：批准、驳回、回答都可以点着试，什么都不会真的发出去或被执行。", "This is an example card: try approve, reject or answer. Nothing is sent or done for real."))}</span>${exClear}</div>` : "";
  const exFoot = () => { const n = exLive().length; return n ? `<div class="wg-more ex-foot"><span>${esc(L(`${n} 张示例卡，点开试试，不会真的执行`, `${n} example card${n > 1 ? "s" : ""}, safe to try`))}</span>${exClear}</div>` : ""; };
  function clearSamples() {
    const n = exLive().length; if (!n) return;
    post({ op: "clear_samples" }).then(() => { A().toast(L(`已归档 ${n} 张示例卡`, `${n} example card${n > 1 ? "s" : ""} archived`)); if (A().refresh) A().refresh(); });
    if (A().UI && A().UI.item && isEx({ id: A().UI.item }) && A().closeItem) A().closeItem();
  }

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
    card: L(`${mgrName()} 会把你的话变成卡，交给合适的队员；左边「团队」里亮起来的就是在做的人。`, `${mgrName()} turns what you said into a card and hands it to a teammate; whoever lights up under TEAM is on it.`),
    decide: L("打开一张「等你拍板」的卡（示例卡也算）。方案卡要点「批准开工」才会开始做；交付卡点「验收」关单；不满意就写原因再驳回；有问题就点一个选项回答。", "Open a card that waits on you (the samples count). A plan only starts when you tap “Approve & start”; a delivery closes with “Accept”; not happy? write why and reject; a question takes one tap on an option."),   /* t-oss-polish-1121 ④ */
    about: "",
  }[k] || "");
  const act = k => k === "wake" ? L("点亮 ›", "Show me ›") : k === "say" ? L("点亮 ›", "Show me ›") : k === "team" ? L("复制命令", "Copy command") : "";
  /* t-onb-polish B: the 针织 checklist. A yarn ball sits on the current step and sways; the thread behind it is taut (solid) over the
     done steps and loose (dashed) ahead; the ball gets a little smaller with every step. Done steps carry a stitched ✓. When a step is
     ticked (the ball sits further on than this device last saw, rt.ob.at) the ball rolls over from the step before, the thread tightens, the new ✓ is
     drawn and the cell pops; all six done ties off into a knitted square with a bow (once, rt.ob.tie). Reduced motion: no roll, sway or pop. */
  const RM = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const CK = `<svg class="ob-ck" viewBox="0 0 20 20" aria-hidden="true"><path d="M4.6 10.4 8.3 14 15.4 6" pathLength="1"/><path class="st" d="M4.6 10.4 8.3 14 15.4 6" pathLength="1"/></svg>`;
  const BALL = `<svg class="ob-yb" viewBox="0 0 44 44" aria-hidden="true"><g class="ob-ybr"><circle class="f" cx="22" cy="22" r="17"/><g class="w"><path d="M8 16c8 4 20 4 28-4"/><path d="M6 24c10 4 22 2 32-8"/><path d="M9 32c9 2 19-1 27-11"/><path d="M15 7c-4 10-3 22 4 32"/><path d="M24 5c-6 10-6 24 1 34"/></g><circle class="o" cx="22" cy="22" r="17"/></g></svg>`;
  const SQ = `<svg class="ob-sq" viewBox="0 0 46 46" aria-hidden="true"><rect class="f" x="3" y="3" width="40" height="40" rx="5"/><g class="w">${[0, 1, 2, 3].map(r => [0, 1, 2, 3].map(c => `<path d="M${8 + c * 9} ${8 + r * 8.5}l3 5 3-5"/>`).join("")).join("")}</g><rect class="o" x="3" y="3" width="40" height="40" rx="5"/></svg>`
    + `<svg class="ob-bow" viewBox="0 0 34 24" aria-hidden="true"><g><path d="M17 12C11 3 3 4 4 11s9 6 13 1"/><path d="M17 12c6-9 14-8 13-1s-9 6-13 1"/><path d="M17 12l-5 10M17 12l4 10"/></g><circle cx="17" cy="12" r="2.6"/></svg>`;
  // the thread: a gentle wave through the six cell centres (x = 50 + 100 i in a 600-wide box, y = 20), split at the current step
  const wave = (a, b) => { let d = `M${50 + a * 100} 20`; for (let i = a + 1; i <= b; i++) d += ` Q${i * 100} ${20 + (i % 2 ? -9 : 9)} ${50 + i * 100} 20`; return d; };
  const thread = ci => `<svg class="ob-th" viewBox="0 0 600 40" preserveAspectRatio="none" aria-hidden="true">${ci < 5 ? `<path class="lo" d="${wave(ci, 5)}"/>` : ""}${ci > 0 ? `<path class="ta" d="${wave(0, ci)}" pathLength="1"/>` : ""}</svg>`;
  const stepCell = (s, i, cur, all) => `<button type="button" class="ob-st${s.done ? " done" : ""}${cur ? " cur" : ""}" data-ob-step="${s.id}" data-i="${i}"${s.done ? ' aria-disabled="true"' : ""}${cur ? ' aria-current="step"' : ""} title="${esc(L(...NAME[s.id]) + (short(s.id, s.done) ? " · " + short(s.id, s.done) : ""))}">`
    + `<i class="ob-k" aria-hidden="true">${all && i === 5 ? SQ : s.done ? CK : cur ? BALL : `<small>${i + 1}</small>`}</i><b>${esc(L(...NAME[s.id]))}</b></button>`;
  const track = d => {
    const ci = d.all ? 5 : Math.max(0, d.steps.findIndex(x => x.id === d.next));
    return `<div class="ob-track${d.all ? " all" : ""}" data-ob-track data-ci="${d.all ? 6 : ci}" style="--yb:${(1 - 0.06 * ci).toFixed(2)}">${thread(ci)}`
      + `<div class="ob-steps">${d.steps.map((x, i) => stepCell(x, i, !d.all && x.id === d.next, d.all)).join("")}</div></div>`;
  };
  const stepBtn = (s, i, cur) => `<button type="button" class="ob-li${s.done ? " done" : ""}${cur ? " cur" : ""}" data-ob-step="${s.id}"${s.done ? ' aria-disabled="true"' : ""}>`
    + `<i aria-hidden="true">${s.done ? "✓" : i + 1}</i><b>${esc(L(...NAME[s.id]))}</b>${short(s.id, s.done) ? `<small>· ${esc(short(s.id, s.done))}</small>` : ""}</button>`;
  const hintLine = d => { const k = d.next; if (!k) return ""; const a = act(k);
    return `<div class="ob-hint"><span>${esc(hint(k))}</span>${a ? `<button type="button" class="ob-go" data-ob-step="${k}">${esc(a)}</button>` : ""}</div>`; };
  const doneLine = () => `<div class="ob-done"><b>✓ ${esc(L("六针都缝好了", "All six stitched"))}</b><span>${esc(phone() ? L("明天起这张卡会自己退下。", "This card steps aside tomorrow.") : L("明天起这一格会自己退下；想再看，在「编辑小组件」里加回。", "This tile steps aside tomorrow; add it back from Edit widgets any time."))}</span></div>`;
  const count = d => `${d.n} / ${d.of}`;

  // ---------- optional steps (never counted): Codex, Claude in Chrome, install as an app, pick your look, use it on your phone ----------
  const OPT = { codex: ["✦", "连接 Codex", "Connect Codex", "Codex"], chrome: ["◎", "Claude in Chrome", "Claude in Chrome", "Chrome"],
    app: ["▣", "装成 app", "Install as an app", "App"], look: ["◐", "换个样子", "Pick your look", L0 => L0("外观", "Look")],
    phone: ["☏", "在手机上用", "Use it on your phone", L0 => L0("手机", "Phone")] };
  const optName = k => L(OPT[k][1], OPT[k][2]);
  const chipName = k => typeof OPT[k][3] === "function" ? OPT[k][3](L) : OPT[k][3];
  const OS = () => (SU() && SU().opt) || { steps: [] };
  const optChip = s => `<button type="button" class="ob-oc${s.done ? " on" : ""}${s.skipped ? " skip" : ""}" data-ob-opt="${s.id}" title="${esc(optName(s.id))}">`
    + `<i aria-hidden="true">${s.done ? "✓" : OPT[s.id][0]}</i><span>${esc(chipName(s.id))}</span>${s.done ? "" : `<b aria-hidden="true">${s.skipped ? esc(L("跳过", "skipped")) : "›"}</b>`}</button>`;
  const optArea = () => { const o = OS(); if (!o.steps.length) return "";
    return `<div class="ob-opt"><h6>${esc(L("可选 · 不计数", "Optional · not counted"))}</h6><div class="ob-chips">${o.steps.map(optChip).join("")}</div></div>`; };

  /* desktop widget: one full row. Left: the six steps on the thread and the current step's hint; right, past a dashed seam: the optional chips */
  function widget(s, D, kit) {
    const d = SU(); if (!d) return kit.eb("setup");
    queueAnim();
    const a = !d.all && act(d.next);   // the current step's button sits in the title row, so the hint below gets the whole column
    return `<div class="ob-row"><div class="ob-main"><div class="wg-eb"><b>${esc(L("开工清单", "Getting started"))}</b><span class="n">${esc(count(d))}</span>${window.Tour ? Tour.link() : ""}${a ? `<button type="button" class="ob-go" data-ob-step="${d.next}">${esc(a)}</button>` : ""}</div>${track(d)}${d.all ? doneLine() : `<div class="ob-hint"><span>${esc(hint(d.next))}</span></div>`}</div>${optArea()}</div>`;
  }
  /* phone card under the stat row: the thread (no labels), the current step's name and hint; 全部 › lists all six; the optional chips below */
  const PH = { all: false };
  function phoneCard() {
    const d = SU(); if (!d || !phone()) return "";
    queueAnim();
    const cur = d.steps.find(x => x.id === d.next), ci = d.steps.indexOf(cur);
    return `<section class="ob-card${d.all ? " is-done" : ""}" data-ob-card><div class="ob-hd"><b>${esc(L("开工清单", "Getting started"))}</b><span class="n">${esc(count(d))}</span>${window.Tour ? Tour.link() : ""}`
      + (d.all ? `<button type="button" class="ob-lnk" data-ob-hide>${esc(L("现在收起", "Hide now"))}</button>` : `<button type="button" class="ob-lnk" data-ob-all aria-expanded="${PH.all}">${esc(PH.all ? L("收起", "Less") : L("全部 ›", "All ›"))}</button>`)
      + `</div>${track(d)}`
      + (PH.all && !d.all ? `<div class="ob-list">${d.steps.map((x, i) => stepBtn(x, i, x === cur)).join("")}</div>` : cur ? `<div class="ob-cur">${ci + 1} · ${esc(L(...NAME[cur.id]))}</div>` : "")
      + `${d.all ? doneLine() : hintLine(d)}${optArea()}</section>`;
  }

  // the roll / tighten / pop when the ball moved on since this device last looked (rt.ob.at = the cell it sat on, 6 = tied off), and the tie-off once
  let animQ = 0;
  function queueAnim() { if (!animQ) animQ = requestAnimationFrame(() => { animQ = 0; document.querySelectorAll("[data-ob-track]").forEach(runAnim); }); }
  function runAnim(tr) {
    const at = +tr.dataset.ci, was = LSG("ob.at", null), all = at === 6;
    if (tr._ran === at || !tr.getBoundingClientRect().width) return;
    tr._ran = at;
    if (was == null || at <= was || RM()) { LSS("ob.at", at); if (all) LSS("ob.tie", 1); return; }
    LSS("ob.at", at);
    const cells = [...tr.querySelectorAll(".ob-st")], cw = cells[1] ? cells[1].getBoundingClientRect().left - cells[0].getBoundingClientRect().left : 0;
    const from = Math.max(0, Math.min(5, was)), to = Math.min(5, at);
    const ease = "cubic-bezier(.45,.05,.25,1)";
    // the cells that just got their ✓: draw it, pop the cell
    cells.slice(from, all ? 6 : to).filter(c => c.classList.contains("done")).forEach((c, j) => {
      const p = c.querySelector(".ob-ck path"); const delay = 520 + j * 90;
      if (p) p.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 380, delay, easing: "cubic-bezier(.3,.7,.3,1)", fill: "backwards" });
      const k = c.querySelector(".ob-k"); if (k) k.animate([{ transform: "scale(1)" }, { transform: "scale(1.22)" }, { transform: "scale(1)" }], { duration: 450, delay: delay - 120, easing: "ease-out" });
    });
    const ta = tr.querySelector(".ob-th .ta");
    if (ta && to > 0) ta.animate([{ strokeDashoffset: 1 - from / to }, { strokeDashoffset: 0 }], { duration: 700, easing: ease, fill: "backwards" });
    const yb = tr.querySelector(".ob-st.cur .ob-yb");
    if (yb && to > from && cw) {
      const dx = (from - to) * cw, roll = dx / 17 * 57.3;
      yb.animate([{ transform: `translate(${dx}px, 0) rotate(${roll}deg)` }, { transform: "translate(0, 0) rotate(0deg)" }], { duration: 700, easing: ease });
    }
    if (all && !LSG("ob.tie", 0)) {
      LSS("ob.tie", 1);
      const sq = tr.querySelector(".ob-sq"), bow = tr.querySelector(".ob-bow"), back = "cubic-bezier(.34,1.56,.64,1)";
      if (sq) sq.animate([{ transform: "scale(0) rotate(-30deg)" }, { transform: "scale(1) rotate(0)" }], { duration: 600, delay: 700, easing: back, fill: "backwards" });
      if (bow) bow.animate([{ transform: "scale(0) rotate(12deg)" }, { transform: "scale(1) rotate(12deg)" }], { duration: 500, delay: 1100, easing: back, fill: "backwards" });
    }
  }
  // ---------- the optional steps' sheet: one at a time, opened from a chip; centred on the desk, a bottom sheet on the phone ----------
  const SH = { k: null, el: null };
  const curLook = () => { const g = k => { try { return JSON.parse(localStorage.getItem("rt." + k)); } catch (e) { return null; } };
    const ut = g("ut") === "ink" ? "ink" : "ut", tx = { knit2: "knit1", leather2: "leather1" }[g("texture")] || g("texture");
    return ut === "ink" ? "ink" : tx === "knit1" ? "knit" : tx === "leather1" ? "leather" : "plain"; };
  const LOOKS = [["knit", "针脚", "Stitch", "ut", "knit1"], ["ink", "墨刊", "Ink", "ink", "off"], ["leather", "软皮", "Leather", "ut", "leather1"], ["plain", "素色", "Plain", "ut", "off"]];
  const seg = (attr, list, on) => `<div class="seg st-seg" role="radiogroup">${list.map(([v, z, e]) => `<button type="button" class="seg-i${v === on ? " on" : ""}" role="radio" aria-checked="${v === on}" ${attr}="${v}">${esc(L(z, e))}</button>`).join("")}</div>`;
  const tmodeNow = () => { try { if (JSON.parse(localStorage.getItem("rt.themeMode")) === "auto") return "auto"; } catch (e) { } return document.documentElement.dataset.theme === "white" ? "white" : "dark"; };
  const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  let BIP = null;   // Chrome / Edge: the install prompt, kept while the checklist is up so 「安装」 can show the browser's own dialog
  window.addEventListener("beforeinstallprompt", e => { if (!SU()) return; e.preventDefault(); BIP = e; if (SH.k === "app") paintSheet(); });
  const ago = iso => { if (!iso) return ""; const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? L("刚刚", "just now") : m < 60 ? L(`${m} 分钟前`, `${m} min ago`) : L(`${Math.round(m / 60)} 小时前`, `${Math.round(m / 60)} h ago`); };
  const cmdBox = (code, id) => `<div class="ob-cmd"><code>${esc(code)}</code><button type="button" class="ob-copy" data-ob-copy="${id}">${esc(phone() ? L("在电脑上跑", "Run on the computer") : L("复制", "Copy"))}</button></div>`;
  const ul = xs => `<ul>${xs.map(x => `<li>${esc(x)}</li>`).join("")}</ul>`;
  const stLine = (ok, yes, no) => `<p class="ob-stl${ok ? " ok" : ""}">${esc(ok ? "✓ " + yes : no)}</p>`;
  function sheetBody(k) {
    const o = OS(), st = o.steps.find(x => x.id === k) || {};
    if (k === "codex") {
      const c = o.codex || {};
      return `<p>${esc(L("你的 ChatGPT 订阅里带 Codex。连上以后，Brush 可以出图，也能给新同事画头像（走订阅额度，不用 API key）。不连也行：新同事会拿到换了颜色的占位头像，别的都不变。", "Your ChatGPT plan includes Codex. Connected, Brush can make pictures and draw avatars for new hires on that plan (no API key). Without it, hires get a recoloured placeholder avatar and nothing else changes."))}</p>`
        + (c.have === false ? `<p>${esc(L("这台电脑上还没找到 codex。先装 Codex CLI 或 ChatGPT 桌面版，再回来这里：", "No codex on this computer yet. Install the Codex CLI or the ChatGPT desktop app first, then come back:"))} <a href="https://github.com/openai/codex" target="_blank" rel="noopener">github.com/openai/codex ↗</a></p>` : "")
        + cmdBox("codex login", "codex")
        + `<p class="ob-sm">${esc(L("在这台电脑的终端里跑，在它打开的浏览器里用 ChatGPT 登录。登录你自己来，Underthread 看不到密码。连上后这一格自己打勾。", "Run it in a terminal on this computer and sign in with ChatGPT in the browser it opens. You sign in yourself; Underthread never sees the password. This ticks itself once Codex answers."))}</p>`
        + stLine(st.done, L("Codex 已连上", "Codex is connected"), L(`还没连上 · ${o.checked ? "检查于 " + ago(o.checked) : "正在检查…"}`, `Not connected · ${o.checked ? "checked " + ago(o.checked) : "checking…"}`))
        + foot(k, st, [`<button type="button" class="ob-b" data-ob-recheck>${esc(L("再查一次", "Check again"))}</button>`]);
    }
    if (k === "chrome") return `<p>${esc(L("在 Chrome 里装上 Claude 扩展，团队就能替你用真网站：", "Install the Claude extension in your Chrome and the team can work on real websites for you:"))}</p>`
      + ul([L("在真实网站上查资料、比价", "research and compare prices on the actual sites"), L("卡上附看得清的截图当证据，不只是链接", "clear screenshots on the card as proof, not just links"),
        L("帮你填表，提交前一定先问你", "fill in forms, and always ask you before pressing submit"), L("用你已经登录的网站（登录永远你自己来，我们从不输入密码）", "use sites where you are already signed in (you always log in yourself; we never type a password)"),
        L("购物、旅行、找优惠这类活", "shopping, travel and deal runs")])
      + `<div class="ob-cmd"><code>${esc(L("Chrome 应用商店 → 搜「Claude」", "Chrome Web Store → “Claude”"))}</code><a class="ob-copy" href="https://chromewebstore.google.com/search/Claude" target="_blank" rel="noopener">${esc(L("打开 ↗", "Open ↗"))}</a></div>`
      + `<p class="ob-sm">${esc(L("装好后固定到工具栏，在扩展里登录 Claude，再重开管家。团队第一次用到浏览器时这一格自己打勾。", "Pin it, sign in to Claude in the extension, then restart the steward. This ticks itself the first time the team uses the browser."))}</p>`
      + stLine(st.done, L("已经用上了", "In use"), L("还没见到团队用浏览器", "The team has not used the browser yet"))
      + foot(k, st, [st.done ? "" : `<button type="button" class="ob-b" data-ob-tick="chrome">${esc(L("我装好了 ✓", "I've done it ✓"))}</button>`]);
    if (k === "app") {
      const ua = navigator.userAgent, ios = /iPhone|iPad|iPod/.test(ua), saf = /Safari/.test(ua) && !/Chrome|Chromium|Edg\//.test(ua);
      const how = ios ? L("在 Safari 里：分享 → 添加到主屏幕。", "In Safari: Share → Add to Home Screen.")
        : saf ? L("Safari：菜单栏 文件 → 添加到程序坞。", "Safari: File → Add to Dock.")
        : L("Chrome / Edge：地址栏右边的安装图标，或 ⋮ → 投放、保存和分享 → 将网页作为应用安装。", "Chrome / Edge: the install icon at the right of the address bar, or ⋮ → Cast, save and share → Install page as app.");
      return `<p>${esc(L("装成 app 以后，看板有自己的图标和窗口，不混在浏览器标签里；手机上从主屏幕打开，像普通 app 一样。", "As an app the board gets its own icon and window instead of a browser tab; on a phone it opens from the Home Screen like any app."))}</p>`
        + (BIP && !st.done ? `<p><button type="button" class="ob-b pri" data-ob-install>${esc(L("安装", "Install"))}</button></p>` : `<p>${esc(how)}</p>`)
        + stLine(st.done, L("已经装好", "Installed"), L("用装好的 app 打开一次，这一格自己打勾", "Open it once from the installed app and this ticks itself"))
        + foot(k, st, [st.done ? "" : `<button type="button" class="ob-b" data-ob-tick="app">${esc(L("装好了 ✓", "Done ✓"))}</button>`]);
    }
    if (k === "look") {
      const now = curLook(), th = document.documentElement.dataset.theme === "white" ? "day" : "night";
      return `<p>${esc(L("同一块看板，四种样子。点一下整块看板立刻换上，随时可以在 设置 → 通用 里改回来。", "Same board, four looks. Tap one and the whole board changes right away; change it again any time in Settings → General."))}</p>`
        + `<div class="ob-looks">${LOOKS.map(([v, z, e]) => `<button type="button" class="ob-lk${v === now ? " on" : ""}" data-ob-look="${v}" aria-pressed="${v === now}"><img src="/static/icons/looks/${v}-${th}.webp" alt="" loading="lazy"><span>${esc(L(z, e))}</span>${v === now ? `<em>${esc(L("现在", "now"))}</em>` : ""}</button>`).join("")}</div>`
        + `<div class="ob-lr"><span>${esc(L("主题", "Theme"))}</span>${seg("data-tmode", [["dark", "夜", "Night"], ["white", "昼", "Day"], ["auto", "自动", "Auto"]], tmodeNow())}</div>`
        + `<div class="ob-lr"><span>${esc(L("语言", "Language"))}</span>${seg("data-lang-set", [["zh", "中文", "中文"], ["en", "English", "English"]], en() ? "en" : "zh")}</div>`
        + foot(k, st, [st.done ? "" : `<button type="button" class="ob-b" data-ob-tick="look">${esc(L("就这样 ✓", "Keep this ✓"))}</button>`]);
    }
    if (k === "phone") {
      const ts = o.ts || {}, port = o.port || 8765, qr = ts.served && ts.url && window.QRLite ? QRLite.qrSvg(ts.url) : "";
      return `<p>${esc(L("把团队装进口袋：", "Your team, in your pocket:"))}</p>`
        + ul([L("看卡，看每个人在做什么", "check cards and see what everyone is doing"), L("一键批方案、回答问题", "approve plans and answer questions with one tap"), L("跟管家打字或语音", "talk to the steward by text or voice"), L("有事等你时，出门在外也会收到提醒", "get a nudge when something waits on you, even when you are out")])
        + `<div class="ob-ph"><ol>`
        + `<li><b>${esc(L("电脑和手机都装 Tailscale，登录同一个账号。", "Install Tailscale on this computer and on your phone, and sign in to the same account on both."))}</b> ${esc(L("登录你自己来，Underthread 看不到。", "You sign in yourself; Underthread never sees it."))} <a href="https://tailscale.com/download" target="_blank" rel="noopener">tailscale.com/download ↗</a>`
        + stLine(ts.on, L("这台电脑在 Tailscale 上了", "This computer is on Tailscale"), ts.have === false ? L("这台电脑上还没找到 Tailscale", "Tailscale not found on this computer") : L("还没连上 Tailscale", "Not connected to Tailscale yet")) + `</li>`
        + `<li><b>${esc(L("只把看板分享给你自己的 tailnet（不上公网）。", "Share the board with your own tailnet only (not the internet)."))}</b> ${esc(L("在这台电脑上跑一次：", "Run this once on this computer:"))}${cmdBox(`tailscale serve --bg ${port}`, "serve")}`
        + stLine(ts.served, L("已发布：", "Shared at ") + (ts.url || ""), L("跑完后这里会自己打勾", "This ticks itself once it is shared")) + `</li>`
        + `<li><b>${esc(L("用手机扫码打开，然后 分享 → 添加到主屏幕。", "Scan the code with your phone, then Share → Add to Home Screen."))}</b></li></ol>`
        + `<div class="ob-qr">${qr ? qr + `<code>${esc(ts.url)}</code><small>${esc(L("只有你 tailnet 里的设备能打开。", "Only devices on your tailnet can open it."))}</small>` : `<div class="ob-qr0">${esc(L("第 2 步做完，二维码出现在这里", "The code shows here after step 2"))}</div>`}</div></div>`
        + `<p class="ob-sm">${esc(L("看板本身仍然只听 127.0.0.1；Tailscale Serve 只把它发布到你的 tailnet，还自带 https（手机推送要用）。手机第一次从这个地址打开看板，这一格自己打勾。", "The board itself still listens on 127.0.0.1 only; Tailscale Serve publishes it to your tailnet alone, with https (which phone push needs). This ticks itself the first time your phone opens the board there."))}</p>`
        + foot(k, st, [`<button type="button" class="ob-b" data-ob-recheck>${esc(L("再查一次", "Check again"))}</button>`, st.done ? "" : `<button type="button" class="ob-b" data-ob-tick="phone">${esc(L("手机上能用了 ✓", "It works on my phone ✓"))}</button>`]);
    }
    return "";
  }
  const foot = (k, st, extra) => `<div class="ob-sf">${st.done ? "" : st.skipped ? `<button type="button" class="ob-b" data-ob-unskip="${k}">${esc(L("不跳过了", "Don't skip"))}</button>` : `<button type="button" class="ob-b" data-ob-skip="${k}">${esc(L("先跳过", "Skip for now"))}</button>`}${extra.join("")}<span class="sp"></span><button type="button" class="ob-b" data-ob-close>${esc(L("关闭", "Close"))}</button></div>`;
  function paintSheet() {
    if (!SH.k || !SH.el) return;
    const st = OS().steps.find(x => x.id === SH.k) || {};
    const h = `<div class="ob-sh-in"><div class="ob-sh-hd"><i aria-hidden="true">${st.done ? "✓" : OPT[SH.k][0]}</i><b>${esc(optName(SH.k))}</b><span class="ob-tag">${esc(st.done ? L("已完成", "done") : L("可选", "optional"))}</span><button type="button" class="ob-x" data-ob-close aria-label="${esc(L("关闭", "Close"))}">×</button></div>${sheetBody(SH.k)}</div>`;
    const box = SH.el.querySelector(".ob-sh");
    if (box._h !== h) { const sc = box.scrollTop; box.innerHTML = h; box._h = h; box.scrollTop = sc; }
  }
  function openSheet(k) {
    closeSheet(); unlight();
    SH.k = k; SH.el = document.createElement("div"); SH.el.className = "ob-sheet"; SH.el.dataset.k = k;
    SH.el.innerHTML = `<div class="ob-scrim" data-ob-close></div><div class="ob-sh" role="dialog" aria-modal="true" aria-label="${esc(optName(k))}"></div>`;
    document.body.append(SH.el); paintSheet();
    const f = SH.el.querySelector(".ob-x"); if (f) f.focus({ preventScroll: true });
    if (k === "codex" || k === "phone") recheck(true);
  }
  function closeSheet() { if (SH.el) SH.el.remove(); SH.el = null; SH.k = null; }
  let rcAt = 0;
  function recheck(quiet) {
    if (quiet && Date.now() - rcAt < 60000) return;
    rcAt = Date.now();
    post({ op: "recheck" }).then(() => setTimeout(() => fetch("/api/setup", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(n => {
      if (!n || !A().ST.meta.setup) return; A().ST.meta.setup = n; paintSheet(); A().refreshPage(); if (!quiet) A().toast(L("查过了", "Checked")); }).catch(() => { }), 2500));
  }
  const fireSet = (attr, v) => { const b = document.createElement("button"); b.setAttribute(attr, v); b.hidden = true; document.body.append(b); b.click(); b.remove(); };
  function pickLook(v) {
    const l = LOOKS.find(x => x[0] === v); if (!l) return;
    fireSet("data-ut-set", l[3]); fireSet("data-tex-set", l[4]);
    setTimeout(paintSheet, 60);
  }
  // auto ticks the page alone can see: opened as an installed app; anything about the look changed (here or in Settings)
  const ticked = k => (OS().steps.find(x => x.id === k) || {}).done;
  const autoTick = k => { if (SU() && OS().steps.length && !ticked(k)) post({ op: "tick", k, auto: true }); };
  document.addEventListener("click", e => {
    if (e.target.closest && e.target.closest("[data-ut-set],[data-tex-set],[data-tmode],[data-lang-set],[data-theme-set],[data-ob-look]")) setTimeout(() => { autoTick("look"); paintSheet(); }, 80);
  }, true);

  // ---------- steward chat: offline card, examples, chips ----------
  const mgrOff = () => { const m = mgr(); return !m.last_seen || m.status === "offline"; };
  const queued = () => (A().ST.meta && A().ST.meta.inbox_unacked) || 0;
  const cmdLine = d => `cd "${d.root}" && ${d.cmd}`;
  const canCopy = () => !!(navigator.clipboard && window.isSecureContext);
  function chatTop() {
    const d = SU(); if (!d || A().UI.chat !== "manager") return "";
    if (mgrOff()) return `<div class="ob-off" data-ob-off><b class="ob-t"><i class="ob-dot" aria-hidden="true"></i>${esc(L(`${mgrName()} 还没上线`, `${mgrName()} is not online yet`))}</b>`
      + `<p>${esc(L(`${mgrName()} 是一直开着的 Claude Code 会话：读你在这里说的话，开卡，交给队员。你的话会先排队，它一上线就先处理（已排队 ${queued()} 条）。点一下 Underthread 图标，或者在这个文件夹的终端里运行：`,
        `${mgrName()} is a Claude Code session that stays open: it reads what you say here, opens cards and hands them out. What you say waits in a queue and is read first when it comes online (${queued()} queued). Click the Underthread icon, or run this in a terminal in this folder:`))}</p>`
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
  // t-qg-bulb (user 11-21, pick A): the quick-phrases button is a yarn ball + 「想说点什么？」 pill with a stitched rim (was a bulb emoji)
  const QG_YARN = '<svg class="nq-yarn" viewBox="0 0 26 20" aria-hidden="true"><circle class="yb" cx="9" cy="10" r="7"/><path class="yw" d="M3.4 7.4q5.6-3.2 11.2 0M2.6 11.6q6.4-3.2 12.8 0M6.2 3.8Q2.8 10 7 16.6M12 3.4q3.6 6.4-.2 13.2"/><path class="yt" d="M15.6 13.2c2.4 1.2 3 4.2 5.6 3.6 2-.5 1.6-3.2.2-3.4"/></svg>';
  const QG = { open: false, pop: false };
  const qgOn = () => LSG("qg", true) !== false;
  const mine = () => { try { return A().chatList("manager").filter(m => m.who === "me").length; } catch (e) { return 0; } };
  function rowHTML() {
    const G = groups(), chips = QD().chips.map(k => G.find(g => g.k === k)).filter(Boolean);
    if (mine() >= 20 && !QG.open) { const sw = !QG.sw; if (sw) { QG.sw = 1; setTimeout(() => { QG.sw = 2; }, 1500); }   // the thread end sways once, the first time the pill shows this session
      return `<button type="button" class="qg-bulb${QG.sw === 1 ? " nq-sw" : ""}" data-qg-open aria-label="${esc(L("快捷句", "Quick phrases"))}" title="${esc(L("快捷句", "Quick phrases"))}"><span class="nq">${QG_YARN}${esc(L("想说点什么？", "What's on your mind?"))}</span></button>`; }
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
    const own = btn.closest(".ob-cmd") && btn.closest(".ob-cmd").querySelector("code");   // the optional steps' lines copy as written
    const txt = btn.dataset.obCopy === "agents" ? `cd "${d.root}" && ${d.agents_cmd}` : btn.dataset.obCopy === "cmd" ? cmdLine(d) : own ? own.textContent : "";
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
    const xc = e.target.closest && e.target.closest("[data-ex-clear]");
    if (xc) { e.preventDefault(); e.stopPropagation(); return clearSamples(); }
    const o = e.target.closest && e.target.closest("[data-ob-opt],[data-ob-close],[data-ob-skip],[data-ob-unskip],[data-ob-tick],[data-ob-recheck],[data-ob-look],[data-ob-install]");
    if (o) {
      e.preventDefault(); e.stopPropagation();
      const ds = o.dataset;
      if (ds.obOpt) return openSheet(ds.obOpt);
      if (ds.obClose != null) return closeSheet();
      if (ds.obLook) return pickLook(ds.obLook);
      if (ds.obRecheck != null) return recheck(false);
      if (ds.obInstall != null) { if (BIP) { BIP.prompt(); BIP.userChoice.then(c => { if (c && c.outcome === "accepted") autoTick("app"); BIP = null; paintSheet(); }).catch(() => { }); } return; }
      const k = ds.obSkip || ds.obUnskip || ds.obTick, op = ds.obSkip ? "skip" : ds.obUnskip ? "unskip" : "tick";
      post({ op, k }).then(() => { if (A().refresh) A().refresh(); });
      if (op === "skip") closeSheet();
      return;
    }
    const t = e.target.closest && e.target.closest("[data-qg],[data-qg-all],[data-qg-close],[data-qg-open],[data-ob-step],[data-ob-copy],[data-ob-unlight],[data-ob-all],[data-ob-hide],[data-ob-hire],[data-qg-tog]");
    if (!t) { if (QG.pop && !(e.target.closest && e.target.closest(".qg-pop"))) { QG.pop = false; row($("#right")); } return; }
    if (t.dataset.qgTog != null) return;   // the settings switch has its own listener below
    e.preventDefault(); e.stopPropagation();
    if (t.dataset.obHire != null) { QG.pop = false; unlight(); A().go("market"); return; }
    if (t.dataset.qg != null) return fill(t.dataset.qg);
    if (t.dataset.qgAll != null) { QG.pop = !QG.pop; row($("#right")); return; }
    if (t.dataset.qgClose != null) { QG.pop = false; row($("#right")); return; }
    if (t.dataset.qgOpen != null) { QG.open = true; unfold(); row($("#right")); return; }   // t-rail-overflow: the folded rail shows only the ball; a tap opens the column too
    if (t.dataset.obCopy) return copyCmd(t);
    if (t.dataset.obUnlight != null) return unlight();
    if (t.dataset.obAll != null) { PH.all = !PH.all; A().refreshPage(); return; }
    if (t.dataset.obHide != null) { post({ op: "hide" }); const c = t.closest(".ob-card"); if (c) c.remove(); return; }
    const k = t.dataset.obStep, s = SU(), st = s && s.steps.find(x => x.id === k);
    if (!st || st.done) return;
    if (k === "wake" || k === "say") return light(k);
    if (k === "team") { const b = document.createElement("button"); b.dataset.obCopy = "agents"; return copyCmd(b); }
  }, true);
  document.addEventListener("keydown", e => { if (e.key !== "Escape") return; if (SH.k) { closeSheet(); return; } if (LT.k) unlight(); if (QG.pop) { QG.pop = false; row($("#right")); } });

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
  let sentApp = false;
  const tick = () => {
    const d = SU(); if (d && d.all && !d.done_at && !sentDone) { sentDone = true; post({ op: "done" }); }
    if (d && standalone() && !sentApp && !ticked("app")) { sentApp = true; autoTick("app"); }
    if (SH.k) { if (!d) closeSheet(); else paintSheet(); }
    queueAnim();
  };
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
  window.Onboard = { chatTop, chatEmpty, row, phoneCard, settingsRow, light, unlight, fill, isEx, exT, exNote, exFoot, openSheet, closeSheet };
})();
