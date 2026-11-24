/* t-onboard-tour: the first run of a fresh install. Five centred welcome pages (the 「最顶」 motion the user picked: yarn drawn along its
   path, soft-spring pops, text that sharpens out of a blur, one kitten that pushes its ball from page to page), then the card's stitch line
   shrinks onto the steward's chat field and becomes step 1 of the anchored tour (coach card + soft SVG cutout, one step per target).
   - Opens by itself once per form factor (desk / phone) while meta.onboarding.tour has no entry for it; finishing or skipping records it
     (action onboarding op=tour). Existing installs are marked by core/migrations/0004_tour.py and never see it.
   - Replays: 设置 → 通用 → 上手引导 「再走一遍」 (welcome + tour), the 开工清单 header 「导览 ›」 (tour only).
   - Steps: chat / review / team in core; extensions add theirs with UTExt.tourStep (web/js/ext.js). A step whose target is not on the page
     is skipped. The ring follows its target every frame (polls rebuild the home and the chat).
   - While it is open, lookaway (LookAway.take holds its notices until close) and the board-pulse cue (widgets.js) stay quiet.
   - Reduced motion: pages swap with a 150 ms crossfade, the yarn is already drawn, the kitten sits still, the hand-off is a 200 ms fade.
   Frames: the welcome is a pure function of time (frame()), drawn into persistent nodes with a small attribute morph, so images are never
   recreated. Class prefix: otr-. Design source: work/t-onboard-tour/welcome/overlay.js (mock) and work/t-onboard-tour/mock/ (A). */
(() => {
  const A = () => window.App, $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const en = () => !!(A() && A().UI.lang === "en");
  const L = (zh, e) => en() ? e : zh;
  const phone = () => matchMedia("(max-width: 760px)").matches;
  const form = () => phone() ? "phone" : "desk";
  const RMQ = { get matches() { return matchMedia("(prefers-reduced-motion: reduce)").matches; } };   // asked fresh each time: a kept MediaQueryList can miss a change in WebKit
  const LSK = f => "rt.otr." + f;
  const post = body => fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ kind: "onboarding", op: "tour" }, body)) }).catch(() => { });
  const vis = el => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const pickVis = sels => { for (const s of sels) { const e = [...document.querySelectorAll(s)].find(vis); if (e) return e; } return null; };

  // ---------- roster: names, faces, duties come from the board (the open-source crew differs) ----------
  const AG = () => (A().ST && A().ST.agents) || {};
  const live = () => Object.values(AG()).filter(a => a && a.enabled !== false && !a.retired);
  const mgrA = () => AG().manager || { id: "manager", name: "管家", name_en: "Steward" };
  const nm = a => A().aname(a);
  /* t-onboard-review ⑦: in Chinese copy a Latin name gets a space on its Latin side (先跟 Steward 说), not 先跟Steward说 */
  const zn = s => { s = String(s); if (en()) return s; return (/^[A-Za-z0-9]/.test(s) ? " " : "") + s + (/[A-Za-z0-9]$/.test(s) ? " " : ""); };
  const duty = a => String(A().atitle(a) || "").split(/\s*[·&]\s*|\s+and\s+/)[0] || "";
  const av = a => A().avatarUrl(a);
  function crew() {
    const c = live().filter(a => a.id !== "manager");
    const who = c.find(a => /旅|trip|travel/i.test((a.title || "") + " " + (a.title_en || ""))) || c[0] || mgrA();
    const today = new Date().toLocaleDateString("en-CA");
    const R = ((A().ST.meta || {}).routines || []).filter(r => r && r.time && !r.paused && !r.disabled).sort((a, b) => a.time < b.time ? -1 : 1).slice(0, 3);
    const rt = en() || R.length < 2 ? [["08:00", L("晨报", "Morning paper"), 1], ["21:00", L("日报", "Daily report"), 1], ["22:30", L("睡觉提醒", "Bedtime reminder"), 0]]
      : R.map(r => [r.time, String(A().rtShort ? A().rtShort(r) : r.label || r.id).split(/[：:]/)[0].slice(0, 8), r.last === today ? 1 : 0]);
    return { mgr: mgrA(), c, six: [mgrA(), ...c.slice(0, 5)], three: c.slice(0, 3), more: Math.max(0, c.length - 5), who, rt };
  }

  // ---------- welcome copy (page 1's fine print trimmed: the click-to-publish line lives on page 5) ----------
  /* 看画面 / Watch ships as an extension (local/ext/live); page 4 only mentions and draws it when that extension registered its tour step */
  const hasLive = () => !!(window.UTExt && UTExt.tourSteps && UTExt.tourSteps().some(s => s.id === "live"));
  const COPY = () => {
    const m = nm(mgrA()), lv = hasLive();
    return en() ? [
      { a: "Welcome to", b: "Underthread", sub: "A small team that works for you. Say what you need; the steward hands it to the right teammate, and you sign off on what comes back.", fine: "Everything stays on your own computer." },
      { a: "Meet", b: "your team", sub: `Each one owns one kind of work, with their own face and manner. ${esc(m)}, the steward, keeps an eye on all of them.`, fine: "Hire more in the Market; rename anyone or change a face under Team." },
      { a: "Just tell", b: "the steward", sub: "Say what you want done; the steward opens a card and assigns it. Bigger jobs come back as a plan first, and nothing starts until you press Approve & start.", fine: "Everything waiting on you sits in “Your call” on Home. Nothing breaks if it waits." },
      { a: "Watch", b: "them work", sub: "Every job is a card: To do → In progress → Your review → Done." + (lv ? " When a teammate is using the browser, open Watch to see it live." : ""), fine: "A card only needs you once it reaches Your review; the rest can sit." },
      { a: "The big calls", b: "stay yours", sub: "Spending, ordering, publishing and signing in always stop and wait for your click. Routines like the morning paper, daily report and reminders run on their own.", fine: "Routines live under Schedules; change a time or pause one any day. You can replay these pages from Settings." },
    ] : [
      { a: "欢迎来到", b: "Underthread", sub: "一支替你干活的小团队。你说一句，管家分给合适的队员；他们交上来，你拍板。", fine: "东西都在你自己的电脑上。" },
      { a: "认识一下", b: "你的团队", sub: "每个人管一摊事，有自己的脸和脾气；管家替你盯着大家。", fine: "想加人去「招聘市场」；名字和头像在「团队」里随时能改。" },
      { a: "有事", b: "跟管家说就行", sub: "说一句你想做的事，管家开卡、派人。大一点的活先交方案，你点「批准开工」才动手。", fine: "等你拿主意的都在首页「等你拍板」。不急的先放着，不会坏事。" },
      { a: "看着", b: "他们干活", sub: "每件事是一张卡：待办 → 进行中 → 待你审核 → 完成。" + (lv ? "队员在用浏览器时，点「看画面」能实时看着。" : ""), fine: "只有走到「待你审核」的卡才要你出手；别的时候放着就行。" },
      { a: "大事", b: "你说了算", sub: "花钱、下单、发布、登录，永远停下来等你点头；晨报、日报、提醒这些例行，每天自己跑。", fine: (phone() ? "例行都在「委托 → 定时」里" : "例行都在左边「定时」里") + "，随时能改时间或停掉。这几页以后在「设置」里还能再看。" },
    ];
  };
  const UIW = () => en() ? { skip: "Skip", back: "Back", next: "Next ›", go: "Show me around ›", lab: "Welcome" } : { skip: "跳过", back: "上一页", next: "下一页 ›", go: "带我认一下路 ›", lab: "欢迎" };
  const N = 5;

  // ---------- drawing kit (shapes and curves from the mock) ----------
  const HALO = "#2B1A13", CREAM = "#F4E1C2";
  function kitten(x, y, k, o = {}) {
    const body = `<ellipse cx="0" cy="-6.8" rx="8" ry="6.8"/><path d="M-3.8 -12.2L-3 -16.8L.4 -13.6Z"/><path d="M2.2 -13.6L5.8 -16.4L5.8 -11.8Z"/>`;
    const s = Math.sin(o.tp || 0) * 1.6, tl = `M-7 -2.6Q-11.6 -2.6 ${(-11.4 + s * .3).toFixed(2)} -6.2T${(-11.3 + s).toFixed(2)} -11.2`;
    const eye = ([cx, cy]) => o.blink ? `<path d="M${(cx - .9 + (o.ex || 0)).toFixed(2)} ${cy}q.9 .6 1.8 0" fill="none" stroke="${HALO}" stroke-width=".5" stroke-linecap="round"/>` : `<ellipse cx="${(cx + (o.ex || 0)).toFixed(2)}" cy="${(cy + (o.ey || 0)).toFixed(2)}" rx=".85" ry=".85" fill="${HALO}"/>`;
    return `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${((o.flip ? -1 : 1) * k).toFixed(3)} ${k.toFixed(3)}) rotate(${(o.rot || 0).toFixed(2)} 0 -2) translate(0 ${(o.sq || 0).toFixed(2)})">`
      + `<path d="${tl}" fill="none" stroke="${HALO}" stroke-width="3.6" stroke-linecap="round"/><g fill="${HALO}" stroke="${HALO}" stroke-width="3.2" stroke-linejoin="round">${body}</g>`
      + `<path d="${tl}" fill="none" stroke="${CREAM}" stroke-width="1.7" stroke-dasharray="1.5 1.1"/><g fill="${CREAM}" stroke="${CREAM}" stroke-width=".6" stroke-linejoin="round">${body}</g>${eye([3.1, -8])}${eye([6.1, -8.1])}</g>`;
  }
  const ball = (x, y, r, rot = 0) => `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${rot.toFixed(1)}) scale(${(r / 8).toFixed(3)})"><circle r="8" fill="#EFAF40"/><path d="M-8 -2.6Q0 -7 8.2 -1.8M-8.2 2.6Q0 -1.4 8.2 3.4M-3.4 -8.2Q-7.8 -.2 -3 8.2M3.2 -8.2Q8 -.2 3 8.2" fill="none" stroke="#A2772B" stroke-width="1.1" opacity=".8"/></g>`;
  const waveD = (x0, y0, x1, y1, amp = 3, per = 14) => {
    const Ln = Math.hypot(x1 - x0, y1 - y0), n = Math.max(2, Math.round(Ln / per)), ux = (x1 - x0) / Ln, uy = (y1 - y0) / Ln; let d = `M${x0} ${y0}`;
    for (let i = 0; i < n; i++) { const b = (i + 1) / n, m = (i / n + b) / 2, sg = i % 2 ? 1 : -1;
      d += ` Q${(x0 + (x1 - x0) * m - uy * amp * sg).toFixed(1)} ${(y0 + (y1 - y0) * m + ux * amp * sg).toFixed(1)} ${(x0 + (x1 - x0) * b).toFixed(1)} ${(y0 + (y1 - y0) * b).toFixed(1)}`; }
    return d;
  };
  const yarn = (d, u = 1, op = 1) => `<path d="${d}" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="${(1 - u).toFixed(4)}" opacity="${op.toFixed(3)}" fill="none" class="otr-yarn" stroke-width="1.6" stroke-linecap="round"/>`;
  const lock = sh => `<svg width="14" height="16" viewBox="0 0 14 16" style="flex:none;overflow:visible" aria-hidden="true"><path d="M3.5 ${7 + sh}V5a3.5 3.5 0 0 1 7 0v${2 + sh}" fill="none" stroke="var(--accent)" stroke-width="1.7" transform="translate(0 ${-sh})"/><rect x="1.5" y="7" width="11" height="8" rx="2" fill="var(--accent)"/></svg>`;
  const tick = u => `<svg width="13" height="11" viewBox="0 0 13 11" style="flex:none" aria-hidden="true"><path d="M1.5 6l3.4 3.2L11.5 1.5" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="${(1 - u).toFixed(3)}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const EYE = `<svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true"><path d="M1 6q7-9 14 0q-7 9-14 0z" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="6" r="2.2" fill="currentColor"/></svg>`;
  const cl = x => Math.max(0, Math.min(1, x)), seg = (t, a, b) => cl((t - a) / (b - a)), eo = x => 1 - Math.pow(1 - x, 3), ei = x => x * x * x;
  const io = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2, lerp = (a, b, u) => a + (b - a) * u;
  const spring = x => x <= 0 ? 0 : x > 3 ? 1 : 1 - Math.exp(-9 * x) * Math.cos(11 * x);   // soft spring: peak about +7 %, settles in .6 s
  const KP = [[124, 117], [468, 240], [450, 238], [432, 238], [372, 240]];   // kitten feet per page, illustration coordinates
  const BALL = (x, y, k) => [x + 36 * k, y - 14 * k];

  /* one illustration (512 x 250); τ = seconds since it began entering (99 = settled), t = seconds since the welcome opened */
  function ill(i, D, τ, t) {
    const e = en(), still = W.rm;
    const E = (d, dur = .45) => still ? 1 : eo(seg(τ, d, d + dur));
    const pop = d => still ? "" : `opacity:${cl((τ - d) / .16).toFixed(3)};transform:scale(${(.8 + .2 * spring(τ - d)).toFixed(4)})`;
    const fade = (d, dy = 6) => still ? "" : `opacity:${E(d).toFixed(3)};transform:translateY(${(dy * (1 - E(d))).toFixed(2)}px)`;
    const draw = (d, dur) => still ? 1 : io(seg(τ, d, d + dur));
    const svg = s => `<svg width="512" height="250" class="otr-isvg" aria-hidden="true">${s}</svg>`;
    if (i === 0) {
      const M = [250, 92], sm = [[440, 26], [452, 104], [436, 182]].map((p, k) => [...p, D.three[k]]).filter(p => p[2]);
      const s = yarn(waveD(48, 118, 214, 96), draw(.12, .55)) + sm.map(([x, y], k) => yarn(waveD(M[0] + 36, M[1] + 4, x, y + 22, 2.4, 12), draw(.72 + k * .08, .4))).join("");
      return svg(s) + `<div class="otr-me" style="left:0;top:88px;${pop(0)}">${e ? "You" : "你"}</div>`
        + `<img class="otr-av" alt="" src="${esc(av(D.mgr))}" style="left:${M[0] - 38}px;top:${M[1] - 34}px;width:80px;height:80px;${pop(.55)}">`
        + `<div class="otr-nm" style="left:${M[0] + 2}px;top:${M[1] + 52}px;${fade(.66)}">${esc(nm(D.mgr))}<small>${esc(L("管家", "steward"))}</small></div>`
        + sm.map(([x, y, a], k) => `<img class="otr-av" alt="" src="${esc(av(a))}" style="left:${x - 2}px;top:${y}px;width:44px;height:44px;${pop(1.02 + k * .08)}">`).join("");
    }
    if (i === 1) {
      let h = "";
      D.six.forEach((a, k) => { const c = k % 3, row = (k / 3) | 0, x = 30 + c * 150, y = 8 + row * 116, d = .04 + k * .07;
        h += `<img class="otr-av" alt="" src="${esc(av(a))}" style="left:${x}px;top:${y}px;width:62px;height:62px;${pop(d)}"><div class="otr-nm" style="left:${x + 31}px;top:${y + 70}px;${fade(d + .12, 4)}">${esc(nm(a))}<small>${esc(a.id === "manager" ? L("管家", "steward") : duty(a))}</small></div>`; });
      if (D.more) h += `<div class="otr-nm otr-more" style="left:466px;top:146px;${fade(.5, 4)}">${esc(L(`还有 ${D.more} 位`, `+${D.more} more`))}</div>`;
      return svg(yarn(waveD(30, 236, 420, 236, 2.6, 16), draw(.3, .8))) + h;
    }
    if (i === 2) {
      const typing = !still && τ > .42 && τ < .86, txt = still || τ >= .86, breathe = still ? 0 : .5 + .5 * Math.sin(t * 2.4), on = E(1.2);
      const dots = [0, 1, 2].map(k => `<i class="otr-td" style="opacity:${(.35 + .65 * Math.max(0, Math.sin(t * 7 - k * .9))).toFixed(2)}"></i>`).join("");
      const meS = still ? "" : `opacity:${cl(τ / .2).toFixed(3)};transform:translateY(${(14 * (1 - spring(τ))).toFixed(2)}px)`;
      return `<div class="otr-bub me" style="top:4px;${meS}">${esc(L("帮我规划一下感恩节出去玩", "Plan a Thanksgiving trip for me"))}</div>`
        + `<img class="otr-av" alt="" src="${esc(av(D.mgr))}" style="left:0;top:58px;width:34px;height:34px;${pop(.34)}">`
        + `<div class="otr-bub mg" style="top:56px;${fade(.4)}">${txt ? `<span style="opacity:${E(.86, .3).toFixed(3)}">${esc(L(`好，开了卡，交给${zn(nm(D.who))}先出方案。`, `Card opened; ${nm(D.who)} will draft a plan first.`))}</span>` : typing ? dots : ""}</div>`
        + `<div class="otr-mini" style="top:110px;${pop(.98)}"><div class="r"><img alt="" src="${esc(av(D.who))}">${esc(L("感恩节出去玩", "Thanksgiving trip"))}<span>${esc(L("方案 v1", "plan v1"))}</span></div>`
        + `<div class="d">${esc(L("三条路线 · 预算 · 出发清单", "3 routes · budget · checklist"))}</div>`
        + `<div class="bs"><span class="ap" style="box-shadow:0 0 0 ${(1 + 3 * breathe * on).toFixed(2)}px color-mix(in srgb,var(--accent) ${Math.round(10 + 20 * breathe * on)}%,transparent)">${esc(L("批准开工", "Approve & start"))}</span><span class="ch">${esc(L("改一下", "Revise"))}</span></div></div>`;
    }
    if (i === 3) {
      const cols = e ? ["To do", "In progress", "Your review", "Done"] : ["待办", "进行中", "待你审核", "完成"], n = [3, 2, 1, 6], X = c => c * 130;
      const mv = still ? 1 : io(seg(τ, 1.05, 1.6)), hx = lerp(X(1), X(2), mv) + 7, hy = 30;
      const arrived = still ? 1 : seg(τ, 1.55, 1.75), glow = still ? 0 : .5 + .5 * Math.sin(t * 2.4);
      let h = cols.map((c, k) => { const d = k * .06, hot = k === 2 ? arrived : 0;
        const gh = (k === 0 ? [30, 62] : k === 1 ? [62] : k === 3 ? [30, 62] : []).map((y, j) => `<div class="otr-gh" style="top:${y}px;${fade(d + .12 + j * .05, 4)}"></div>`).join("");
        return `<div class="otr-col" style="left:${X(k)}px;${fade(d, 5)}"><b style="color:${hot ? `color-mix(in srgb,var(--accent) ${Math.round(hot * 100)}%,var(--dim))` : "var(--dim)"}">${c}<small>${n[k]}</small></b><div class="bd" style="${hot ? `box-shadow:inset 0 0 0 ${(1 + .5 * hot).toFixed(2)}px color-mix(in srgb,var(--accent) ${Math.round(18 + 30 * hot)}%,var(--line2))` : ""}"><div class="otr-ghs">${gh}</div></div></div>`; }).join("");
      const trail = still ? "" : yarn(`M${X(1) + 61} ${hy + 20}L${(hx + 54).toFixed(1)} ${hy + 20}`, seg(τ, 1.05, 1.6) > 0 ? 1 : 0, (1 - seg(τ, 1.75, 2.3)) * .9);
      h += `<div class="otr-hero" style="left:${hx.toFixed(1)}px;top:${hy}px;${pop(.45)};box-shadow:0 6px 14px rgba(0,0,0,.35),0 0 0 ${(arrived * (1 + 2.5 * glow)).toFixed(2)}px color-mix(in srgb,var(--accent) ${Math.round(arrived * (12 + 16 * glow))}%,transparent)"><img alt="" src="${esc(av(D.who))}"><span>${esc(L("感恩节出游", "Trip plan"))}</span>`
        + `<i class="otr-badge" style="${still ? "" : `opacity:${cl((τ - 1.7) / .16).toFixed(3)};transform:scale(${(.6 + .4 * spring(τ - 1.7)).toFixed(4)})`}">${esc(L("等你", "you"))}</i></div>`;
      if (!hasLive()) return h + svg(trail);   // no 看画面 on this install: the board alone
      const cx = still ? 128 : 128 + 74 * Math.sin(t * .8), cy = still ? 62 : 62 + 18 * Math.sin(t * 1.35 + .6);
      h += `<div class="otr-win" style="${still ? "" : `opacity:${E(.3, .4).toFixed(3)};transform:translateY(${(12 * (1 - spring(τ - .3))).toFixed(2)}px)`}"><div class="tb"><i></i><i></i><i></i><u></u></div>`
        + `<svg width="252" height="88" class="otr-wsvg" aria-hidden="true"><path d="M0 30H252M0 62H252M70 0V88M170 0V88" stroke="color-mix(in srgb,var(--dim) 14%,transparent)" stroke-width="5"/>`
        + `<path d="M26 86C60 70 72 40 112 48S170 84 214 40" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="${(1 - draw(.6, 1.2)).toFixed(3)}" fill="none" stroke="#D9714E" stroke-width="2.4" stroke-linecap="round" opacity=".85"/>`
        + `<circle cx="26" cy="86" r="4" fill="#D9714E"/><circle cx="214" cy="40" r="4.5" fill="var(--accent)"/></svg>`
        + `<span class="otr-live"><i style="opacity:${still ? 1 : (.55 + .45 * Math.sin(t * 2.2)).toFixed(2)}"></i>LIVE</span>`
        + `<svg width="40" height="30" class="otr-cur" style="left:${cx.toFixed(1)}px;top:${cy.toFixed(1)}px" aria-hidden="true"><path d="M0 0L0 13L3.6 9.6L6.2 15L8.4 14L5.8 8.8L10.4 8.6Z" fill="#F4E1C2" stroke="#2B1A13" stroke-width="1"/></svg>`
        + `<img alt="" src="${esc(av(D.who))}" class="otr-wav" style="left:${(cx + 12).toFixed(1)}px;top:${(cy + 12).toFixed(1)}px"></div>`
        + `<div class="otr-watch" style="${fade(.55)}">${EYE}${esc(L("看画面", "Watch"))}<small>${esc(L(`${nm(D.who)}在浏览器里查路线，你这边实时看着。`, `${nm(D.who)} is checking routes in the browser; you see it live.`))}</small></div>`;
      return h + svg(trail);
    }
    /* page 5: the big calls wait for you; routines run themselves */
    const chips = e ? ["Spend", "Order", "Publish", "Sign in"] : ["花钱", "下单", "发布", "登录"];
    let h = `<div class="otr-hd" style="left:0;top:0;${fade(0, 4)}">${esc(L("等你点头", "Waits for your click"))}</div>`;
    chips.forEach((c, k) => { const x = (k % 2) * 124, y = 24 + ((k / 2) | 0) * 48, d = .08 + k * .08, sh = still ? 0 : 3 * (1 - eo(seg(τ, d + .3, d + .42)));
      h += `<div class="otr-chip" style="left:${x}px;top:${y}px;${pop(d)}">${lock(sh)}${c}</div>`; });
    const you = [119, 168];
    let s = [57, 181].map((x, k) => yarn(waveD(x, 112, you[0] + (k ? 12 : -12), you[1] - 20, 2, 11), draw(.5 + k * .08, .45), .85)).join("");
    h += `<div class="otr-me" style="left:${you[0] - 22}px;top:${you[1] - 22}px;width:44px;height:44px;font-size:14px;${pop(.92)}">${e ? "You" : "你"}</div>`
      + `<div class="otr-hd" style="left:${you[0] + 32}px;top:${you[1] - 8}px;font-weight:400;${fade(1.05, 3)}">${esc(L("你点了才动", "your call"))}</div>`;
    const tx = 312, ty = [36, 88, 140];
    h += `<div class="otr-hd" style="left:${tx - 12}px;top:0;${fade(.1, 4)}">${esc(L("每天自己跑", "Runs on its own, every day"))}</div>`;
    s += yarn(`M${tx} 24L${tx} 182`, draw(.3, 1.0));
    D.rt.forEach(([tm, name, done], k) => { const reach = .3 + 1.0 * ((ty[k] - 24) / 158);
      s += `<circle cx="${tx}" cy="${ty[k]}" r="${(5.5 * (still ? 1 : spring(τ - reach))).toFixed(2)}" fill="${done ? "#EFAF40" : "var(--panel)"}" stroke="#EFAF40" stroke-width="1.6"/>`;
      h += `<div class="otr-rt" style="top:${ty[k] - 10}px;${fade(reach + .04, 4)}"><small>${esc(tm)}</small>${esc(name)}${done ? tick(still ? 1 : eo(seg(τ, reach + .12, reach + .4))) : `<em>${esc(L("今天", "today"))}</em>`}</div>`; });
    return svg(s) + h;
  }

  // ---------- the welcome ----------
  const TIME = { ENTRY: .18, WALK: .95, HAND: 1.6 };
  const W = { el: null, open: false, rm: false, raf: 0, cur: 0, dir: 1, first: true, t0: 0, pStart: 0, out: null, walk: null, hand: null, R: null, D: null, IT: {}, last: 0, k: 1 };
  const now = () => performance.now();
  function wMount() {
    const U = UIW(), el = document.createElement("div");
    el.className = "otr-w"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", U.lab);
    el.innerHTML = `<div class="otr-bd"></div><div class="otr-card"><div class="otr-in"><button type="button" class="otr-skip" data-otr="skip">${esc(U.skip)}</button>`
      + `<div class="otr-pgs" aria-live="polite"></div><svg class="otr-kl" aria-hidden="true"></svg>`
      + `<div class="otr-ft"><span class="otr-dots" aria-hidden="true">${"<i></i>".repeat(N)}</span><button type="button" class="otr-btn otr-back" data-otr="back">${esc(U.back)}</button>`
      + `<button type="button" class="otr-btn otr-next" data-otr="next">${esc(U.next)}</button></div></div></div><div class="otr-m" aria-hidden="true"></div>`;
    document.body.appendChild(el); W.el = el;
    el.addEventListener("click", wClick);
    el.addEventListener("keydown", wKey);
  }
  /* morph: copy b's children onto a's (same shape = attribute / text updates only; images and nodes stay) */
  const TPL = document.createElement("template");
  function sync(a, b) {
    const bn = [...b.childNodes];
    bn.forEach((y, i) => {
      const x = a.childNodes[i];
      if (!x) { a.appendChild(y.cloneNode(true)); return; }
      if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName) { a.replaceChild(y.cloneNode(true), x); return; }
      if (x.nodeType === 3) { if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue; return; }
      if (x.nodeType !== 1) return;
      for (const at of [...x.attributes]) if (!y.hasAttribute(at.name)) x.removeAttribute(at.name);
      for (const at of y.attributes) if (x.getAttribute(at.name) !== at.value) x.setAttribute(at.name, at.value);
      sync(x, y);
    });
    while (a.childNodes.length > bn.length) a.removeChild(a.lastChild);
  }
  function morph(el, html) { if (el._h === html) return; el._h = html; TPL.innerHTML = html; sync(el, TPL.content); }

  /* page block styles: k = 0 title, 1 sub, 2 illustration, 3 fine print; x = seconds since its exit began (null = entering / settled) */
  function blockStyle(k, τ, x, dir) {
    if (W.rm) return "";
    if (x != null) { const u = seg(x, 0, .28); return `opacity:${(1 - eo(u)).toFixed(3)};transform:translateX(${(-22 * dir * ei(u)).toFixed(2)}px);filter:blur(${(5 * u).toFixed(2)}px)`; }
    const D = [0, .09, .17, .3][k], u = eo(seg(τ, D, D + (k === 2 ? .35 : .55))), b = k === 2 ? 0 : 9 * (1 - eo(seg(τ, D, D + .5)));
    return `opacity:${u.toFixed(3)};transform:translateX(${(28 * dir * (1 - u)).toFixed(2)}px)${b > .05 ? `;filter:blur(${b.toFixed(2)}px)` : ""}`;
  }
  function blockHTML(i, τ, x, dir, t) {
    const c = COPY()[i];
    const lb = !W.rm && x == null ? (() => { const u = eo(seg(τ, .07, .62)); return ` style="opacity:${u.toFixed(3)};letter-spacing:${(.06 - .05 * u).toFixed(3)}em"`; })() : "";
    return `<h2 class="otr-h" style="${blockStyle(0, τ, x, dir)}"><span class="a">${c.a}</span><span class="b"${lb}>${c.b}</span></h2>`
      + `<p class="otr-sub" style="${blockStyle(1, τ, x, dir)}">${c.sub}</p>`
      + `<div class="otr-ill" style="${blockStyle(2, τ, x, dir)}"><div class="otr-ilin">${ill(i, W.D, x != null ? 99 : τ - .17, t)}</div></div>`
      + `<div class="otr-fine" style="${blockStyle(3, τ, x, dir)}">${c.fine}</div>`;
  }
  function pageEl(i) {
    const box = $(".otr-pgs", W.el); let el = box.querySelector(`:scope > .otr-pg[data-i="${i}"]`);
    if (!el) { el = document.createElement("div"); el.className = "otr-pg"; el.dataset.i = i; box.appendChild(el); }
    return el;
  }
  function illAt(i) {   // where page i's illustration sits in the card (cached once drawn)
    const pg = $(`.otr-pgs > .otr-pg[data-i="${i}"]`, W.el), il = pg && pg.querySelector(".otr-ill");
    if (il) W.IT[i] = [pg.offsetLeft + il.offsetLeft, pg.offsetTop + il.offsetTop];
    return W.IT[i] || W.IT[W.cur] || [64, 200];
  }
  function frame(ts) {
    if (!W.open) return;
    const T = ts || now(), t = (T - W.t0) / 1000;
    if (W.out && (T - W.out.start) / 1000 > .65) W.out = null;
    if (W.walk && (T - W.walk.start) / 1000 / TIME.WALK >= 1) W.walk = null;
    const h = W.hand != null ? (T - W.hand) / 1000 : 0;
    if (W.hand != null && h > TIME.HAND) { wFinish(); return; }
    const τ = (T - W.pStart) / 1000 - (W.first ? .3 : TIME.ENTRY);
    const settled = !W.out && !W.walk && W.hand == null && τ > 2.6 && t > 2;
    if (!settled || T - W.last > 66) { W.last = T; draw(t, τ, h, T); }   // settled: the idle loops (tail, blink, LIVE, cursor) at ~15 fps
    W.raf = requestAnimationFrame(frame);
  }
  function draw(t, τ, h, T) {
    const el = W.el, k = W.k, keep = new Set([String(W.cur)]);
    if (W.out) { const x = (T - W.out.start) / 1000; if (x < .3) { keep.add(String(W.out.i)); morph(pageEl(W.out.i), blockHTML(W.out.i, 99, x, W.dir, t)); } }
    const cur = pageEl(W.cur); morph(cur, blockHTML(W.cur, τ, null, W.dir, t)); cur.removeAttribute("aria-hidden");
    $(".otr-pgs", el).querySelectorAll(":scope > .otr-pg").forEach(p => { if (!keep.has(p.dataset.i)) p.remove(); else if (p !== cur) p.setAttribute("aria-hidden", "true"); });
    /* footer */
    const pos = W.out ? lerp(W.out.i, W.cur, io(seg((T - W.out.start) / 1000, .05, .6))) : W.cur;
    el.querySelectorAll(".otr-dots i").forEach((d, j) => { const near = Math.max(0, 1 - Math.abs(pos - j)); d.style.width = (8 + 16 * near).toFixed(1) + "px"; d.className = Math.abs(pos - j) < .5 ? "cur" : j < pos - .5 ? "on" : ""; });
    const back = $(".otr-back", el); back.style.opacity = Math.min(1, pos).toFixed(3); back.disabled = W.cur === 0;
    const nx = $(".otr-next", el), lbl = W.cur === N - 1 ? UIW().go : UIW().next; if (nx.textContent !== lbl) nx.textContent = lbl;
    /* the travelling kitten */
    const P = i => { const [x0, y0] = illAt(i); return [x0 + KP[i][0] * k, y0 + KP[i][1] * k]; };
    const kt = { tp: W.rm ? 0 : t * 2.2, blink: !W.rm && (t % 4.3) < .12 };
    let x, y, bx, by, rot = 0, o = { ...kt }, flip = false, zz = "";
    const wk = W.walk && !W.rm ? (T - W.walk.start) / 1000 / TIME.WALK : null;
    if (wk != null && wk < 1) {
      const [x0, y0] = P(W.walk.a), [x1, y1] = P(W.walk.b), e = io(wk);
      x = lerp(x0, x1, e); y = lerp(y0, y1, e) - 22 * k * Math.sin(Math.PI * e) - Math.abs(Math.sin(Math.PI * 3 * e)) * 5 * k * Math.sin(Math.PI * wk);
      flip = x1 < x0; bx = x + 36 * k * (flip ? -1 : 1); by = lerp(y0, y1, e) - 14 * k - 10 * k * Math.sin(Math.PI * e);
      rot = (x1 - x0) * e / (11 * k) * 57.3; o = { ...o, tp: t * 9, ex: .5, blink: false };
    } else {
      const i = W.cur; [x, y] = P(i); [bx, by] = BALL(x, y, k); rot = i === 0 && !W.rm ? t * 20 : 0;
      if (i === 1) o.ex = .4; if (i === 2) Object.assign(o, { rot: -6, ex: -.3, ey: -.6 }); if (i === 3) Object.assign(o, { ex: -.6, ey: -.2 });
      if (i === 4 && !W.rm && τ > .9) { Object.assign(o, { blink: true, sq: .6 * seg(τ, .9, 1.3) });
        if (τ > 1.1) zz = [0, 1].map(j => { const p = (t * .45 + j * .5) % 1; return `<text x="${(x + (6 + p * 10) * k).toFixed(1)}" y="${(y - (34 + p * 18) * k).toFixed(1)}" font-size="${((9 + p * 3) * k).toFixed(1)}" fill="#F4E1C2" opacity="${(Math.sin(p * Math.PI) * .7 * seg(τ, 1.1, 1.6)).toFixed(2)}" font-weight="700">z</text>`; }).join(""); }
    }
    const ko = W.first && !W.rm ? eo(seg(t, .6, 1.1)) : 1;
    const kl = $(".otr-kl", el); kl.style.opacity = ko.toFixed(3);
    kl.innerHTML = ball(bx, by, 11 * k, rot) + kitten(x, y, 2.1 * k, { ...o, flip }) + zz;
    /* card: intro, hand-off */
    const card = $(".otr-card", el), inn = $(".otr-in", el), bd = $(".otr-bd", el), m = $(".otr-m", el);
    if (W.rm) { card.style.opacity = ""; card.style.transform = ""; return; }
    const ci = W.first ? t : 9, sp = spring(ci);
    card.style.opacity = (eo(cl(ci / .7)) * (1 - eo(seg(h, .08, .36)))).toFixed(3);
    card.style.transform = `translateY(${(18 * (1 - sp)).toFixed(2)}px) scale(${(.985 + .015 * sp).toFixed(4)})`;
    bd.style.opacity = (W.hand != null ? 0 : eo(cl(ci / .5))).toFixed(3);
    inn.style.opacity = (1 - eo(seg(h, 0, .3))).toFixed(3); inn.style.filter = h > 0 ? `blur(${(8 * seg(h, 0, .3)).toFixed(2)}px)` : "";
    if (W.hand != null && W.R) {
      const cr = W.cardR, R = W.R, w2 = io(seg(h, .35, 1.15));
      const g = eo(seg(h, .5, 1.15)), dim = `rgba(${Math.round(lerp(12, 43, w2))},${Math.round(lerp(6, 25, w2))},${Math.round(lerp(4, 19, w2))},${lerp(.72, .46, w2).toFixed(3)})`;
      Object.assign(m.style, { display: "block", left: lerp(cr.left, R.x, w2).toFixed(2) + "px", top: lerp(cr.top, R.y, w2).toFixed(2) + "px", width: lerp(cr.width, R.w, w2).toFixed(2) + "px", height: lerp(cr.height, R.h, w2).toFixed(2) + "px",
        borderRadius: lerp(phone() ? 0 : 30, R.rad, w2).toFixed(2) + "px", borderWidth: lerp(1.5, 2, w2).toFixed(2) + "px", opacity: (1 - eo(seg(h, 1.1, 1.55))).toFixed(3),
        borderColor: `color-mix(in srgb,var(--accent) ${Math.round(100 * eo(seg(h, .1, 1.0)))}%,transparent)`,
        boxShadow: `0 0 0 ${(4 * g).toFixed(2)}px color-mix(in srgb,var(--accent) ${Math.round(14 * g)}%,transparent),0 0 ${(22 * g).toFixed(1)}px ${(4 * g).toFixed(1)}px color-mix(in srgb,var(--accent) ${Math.round(22 * g)}%,transparent),0 0 0 4000px ${dim}` });
      Tour._fade(eo(seg(h, 1.05, 1.5)));
    }
  }
  function sizeK() { W.k = phone() ? Math.min(1, Math.max(.5, (innerWidth - 48) / 512)) : 1; W.IT = {}; if (W.el) W.el.style.setProperty("--otr-k", W.k.toFixed(4)); }   // phone: the 512 px illustration scales to the column (24 px sides)
  function go(i, dir) {
    if (!W.open || W.hand != null || i < 0 || i >= N || i === W.cur) return;
    const T = now(), was = W.cur;
    if (W.rm) {
      const old = $(`.otr-pgs > .otr-pg[data-i="${was}"]`, W.el);
      if (old) { old.classList.add("otr-ghost"); old.setAttribute("aria-hidden", "true"); old.dataset.i = "g" + was; old.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: "linear", fill: "forwards" }).finished.then(() => old.remove(), () => old.remove()); }
      W.cur = i; W.dir = dir; draw(0, 99, 0, T);
      const nw = pageEl(i); nw.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: "linear" });
      return focusNext();
    }
    W.out = { i: was, start: T }; W.walk = { a: W.walk ? W.walk.b : was, b: i, start: T };
    W.cur = i; W.dir = dir; W.pStart = T; W.first = false; W.last = 0;
    focusNext();
  }
  const focusNext = () => { const b = W.el && $(".otr-next", W.el); if (b) b.focus({ preventScroll: true }); };
  function wClick(e) {
    const b = e.target.closest && e.target.closest("[data-otr]"); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const k = b.dataset.otr;
    if (k === "skip") return wClose("skip");
    if (k === "back") return go(W.cur - 1, -1);
    if (k === "next") return W.cur < N - 1 ? go(W.cur + 1, 1) : hand();
  }
  function wKey(e) {
    if (e.key === "Escape") { e.preventDefault(); return wClose("skip"); }
    if (e.key === "ArrowRight") { e.preventDefault(); return W.cur < N - 1 ? go(W.cur + 1, 1) : null; }
    if (e.key === "ArrowLeft") { e.preventDefault(); return go(W.cur - 1, -1); }
    if (e.key === "Tab") {   // keep focus inside the card
      const f = [...W.el.querySelectorAll("button:not([disabled])")]; if (!f.length) return;
      const i = f.indexOf(document.activeElement), n = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i + 1) % f.length; e.preventDefault(); f[n].focus();
    }
  }
  /* 「带我认一下路」: the card's stitch line shrinks onto tour step 1 and hands over */
  function hand() {
    if (W.hand != null) return;
    Tour._open({ fadeIn: true, from: "welcome" });
    W.R = Tour._rect(); W.cardR = $(".otr-card", W.el).getBoundingClientRect();
    if (W.rm || !W.R) {   // reduced motion (or no target yet): the card fades in 200 ms and the tour is simply there
      W.hand = 0; cancelAnimationFrame(W.raf); Tour._fade(1);
      W.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: "forwards" }).finished.then(wFinish, wFinish); return;
    }
    W.hand = now(); W.last = 0;
  }
  function wFinish() { if (!W.el) return; wTeardown(); Tour._fade(1); Tour._focus(); }
  function wTeardown() { W.open = false; cancelAnimationFrame(W.raf); if (W.el) W.el.remove(); W.el = null; W.hand = null; W.out = W.walk = null; removeEventListener("resize", sizeK); }
  function wClose(how) { wTeardown(); finish(how); }
  function welcome() {
    if (W.open) return;
    W.rm = RMQ.matches; W.D = crew(); W.cur = 0; W.dir = 1; W.first = true; W.out = W.walk = null; W.hand = null; W.IT = {}; W.last = 0;
    wMount(); W.open = true; sizeK(); addEventListener("resize", sizeK);
    W.t0 = W.pStart = now();
    if (W.rm) { W.el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150 }); draw(1.3, 99, 0, now()); draw(1.3, 99, 0, now()); }   // second pass: the kitten needs the drawn page to measure
    else { draw(0, -.3, 0, W.t0); W.raf = requestAnimationFrame(frame); }
    setOpen(true); focusNext();
  }

  // ---------- the anchored tour (A) ----------
  const mgrN = () => nm(mgrA());
  const rectOf = (el, pad) => { const r = el.getBoundingClientRect(); return { x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 }; };
  const union = (a, b) => { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }; };
  const onHome = () => A().UI.page === "review";
  const toHome = () => { if (phone()) { if (document.body.dataset.mtab !== "page" || !onHome()) A().setTab("page", "review"); } else if (!onHome()) A().go("review"); };
  const CORE = [
    { id: "chat", t: ["先跟{mgr}说一件事", "Tell {mgr} one thing first"],
      b: ["这里是管家的聊天框。说一件你想做的事，比如<em>「帮我查一下 X 的资料」</em>，它会开卡、交给合适的队员。不会打字？点上面的快捷句也行。",
          "This is the steward's chat. Say one thing you want done, like <em>“look up X for me”</em>; it opens a card and hands it to the right teammate. The quick phrases above the field work too."],
      pb: ["底下「对话」里第一个就是{mgr}。说一件你想做的事，比如<em>「帮我查一下 X 的资料」</em>，它会开卡、交给合适的队员。",
           "{mgr} is the first chat under Chats. Say one thing you want done, like <em>“look up X for me”</em>; it opens a card and hands it to the right teammate."],
      prep: () => { if (phone()) return toHome(); const r = $("#right"); if (A().UI.chat !== "manager" || !vis(r)) A().route("#dm=manager"); if (A().UI.chatFold) { const f = $("#right .ch-fold"); if (f) f.click(); } },
      desk: () => { const c = pickVis(["#right .ch-comp"]); if (!c) return null; const q = $("#right > .qg-row"); return q && !q.hidden && vis(q) ? [c, q] : c; },
      phone: () => pickVis(['#tabbar button[data-k="dms"]']), side: "left", rad: 18 },
    { id: "review", t: ["方案来了，你来拍板", "Plans come back; you decide"],
      b: ["队员先交方案，卡就出现在「等你拍板」。看一眼，点<em>批准开工</em>队员就接着做；不行就驳回，写一句原因。示例卡可以随便点。",
          "A teammate hands in a plan first and the card lands in “Your call”. Take a look and press <em>Approve & start</em>, or reject it with one line of why. The sample cards are safe to try."],
      pb: ["队员交上来、等你看的卡数在这里。点开，按<em>批准开工</em>队员就接着做；不行就驳回，写一句原因。",
           "Cards waiting on you are counted here. Open one and press <em>Approve & start</em>, or reject it with one line of why."],
      prep: toHome,
      desk: () => { const w = pickVis(['#wg .wg[data-wg="review"]']); if (w) { const hd = w.querySelector(".wg-eb"), rows = [...w.querySelectorAll(".wg-row")].filter(vis).slice(0, 2); return hd ? [hd, ...rows] : w; }
        return pickVis(['.hd-stat[data-hd-f="review"]', '#nav [data-go="review"]']); },
      phone: () => pickVis(['.hd-stat[data-hd-f="review"]']), side: "bottom", rad: 18 },
    { id: "team", t: ["TEAM：谁在干活一眼看到", "TEAM: who is working, at a glance"],
      b: ["左边是你的团队。正在干活的人名字旁写着<em>执行中</em>，下面一行是他在干什么；他在做哪张卡，看首页「此刻在忙」那一格。点名字就能私信。",
          "Your team is on the left. Whoever is busy says <em>working</em> next to their name, with what they are doing underneath; the card they are on is in “Working now” on Home. Click a name to message them."],
      /* t-onboard-review ⑤ (home V3): idle board = no working rows, so the copy says where they will show up and points at the 「N 人空闲」 stack */
      pb: () => { const sn = $("#officebox .a2-sn"), n = sn ? sn.textContent.replace(/[›\s]+$/, "").trim() : "", busy = !!$("#officebox .a2-rows > *");
        return busy ? ["正在干活的人排在这一格最上面，下面一行是他在做的卡，点一下就打开。" + (n ? `点「${n}」能看到其余队员，点头像就能私信。` : ""), "Whoever is working sits at the top of this card with the card they are on; tap it to open." + (n ? ` Tap “${n}” for the rest of the team, and a face to message them.` : "")]
          : ["有人干活时，他会出现在这一格，带上他在做的卡。现在都空着：" + (n ? `点「${n}」能看到全部队员，` : "") + "点头像就能私信。", "When someone is working they show up here with the card they are on. Everyone is free right now: " + (n ? `tap “${n}” to see the whole team, and ` : "") + "tap a face to message them."]; },
      prep: () => { if (phone()) return toHome(); const t = $("#team"); if (!t) return;
        /* t-onboard-review ①: the rail scrolled to TEAM stayed scrolled after the tour (首页 / 主线 cut off); tClose puts it back */
        for (let p = t.parentElement; p && p !== document.body; p = p.parentElement) if (p.scrollHeight > p.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(p).overflowY)) { if (!TR.sc.some(x => x[0] === p)) TR.sc.push([p, p.scrollTop]); }
        t.scrollIntoView({ block: "nearest" }); },
      desk: () => { const t = $("#team"); if (!vis(t)) return null; const rows = [...t.querySelectorAll(".team-i")].filter(vis).slice(0, 3); return [t.firstElementChild || t, ...rows].filter(Boolean); },
      /* home V3: ring the people part of the card (working rows or 都歇着呢, plus the face stack), not the stats under it */
      phone: () => { const r = $("#officebox .hd-a2"); if (!vis(r)) return pickVis(['#tabbar button[data-k="more"]']);
        const els = [".a2-rows", ".a2-rest", ".a2-stack"].map(s => $(s, r)).filter(e => e && !e.hidden && vis(e)); return els.length ? els : r; }, side: "bottom", rad: 16 },
  ];
  function stepList() {
    const out = CORE.slice();
    const ext = window.UTExt && UTExt.tourSteps ? UTExt.tourSteps() : [];
    ext.forEach(s => { const at = s.after ? out.findIndex(x => x.id === s.after) : -1; out.splice(at >= 0 ? at + 1 : out.length, 0, s); });
    return out;
  }
  const TR = { on: false, i: 0, steps: [], el: null, raf: 0, R: null, key: "", from: "", sc: [] };
  const fill = s => String(s).replace(/\{mgr\}/g, (m, at, str) => { const n = esc(mgrN()); if (en()) return n;   /* ⑦: a space only where a Latin name meets a Chinese character */
    const cjk = c => !!c && /[\u3400-\u9fff]/.test(c); return (cjk(str[at - 1]) && /^[A-Za-z0-9]/.test(n) ? " " : "") + n + (cjk(str[at + m.length]) && /[A-Za-z0-9]$/.test(n) ? " " : ""); });
  function target(st) {
    let el = null; try { el = (phone() ? st.phone : st.desk) ? (phone() ? st.phone : st.desk)() : null; } catch (e) { el = null; }
    if (!el) return null;
    const els = Array.isArray(el) ? el.filter(vis) : vis(el) ? [el] : [];
    if (!els.length) return null;
    let R = rectOf(els[0], 6); els.slice(1).forEach(e => { R = union(R, rectOf(e, 6)); });
    R.y = Math.max(4, R.y); R.h = Math.min(R.h, innerHeight - R.y - 4); R.rad = st.rad || 16;
    return R;
  }
  function tMount() {
    const el = document.createElement("div"); el.className = "otr-t";
    el.innerHTML = `<svg class="otr-dim" aria-hidden="true"><defs><filter id="otr-fb" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="7"/></filter>`
      + `<mask id="otr-mk"><rect width="100%" height="100%" fill="#fff"/><rect class="otr-hole" fill="#000" filter="url(#otr-fb)"/></mask></defs><rect class="otr-fill" width="100%" height="100%" mask="url(#otr-mk)"/></svg>`
      + `<div class="otr-ring" aria-hidden="true"></div><div class="otr-c" role="dialog" aria-modal="false"></div>`;
    document.body.appendChild(el); TR.el = el;
    el.addEventListener("click", tClick);
    el.addEventListener("keydown", e => { if (e.key === "Escape") { e.preventDefault(); tClose("skip"); } else if (e.key === "ArrowRight") show(TR.i + 1, 1); else if (e.key === "ArrowLeft") show(TR.i - 1, -1); });
  }
  function cardHTML() {
    const st = TR.steps[TR.i], n = TR.steps.length, i = TR.i, e = en();
    const body = phone() && st.pb ? (typeof st.pb === "function" ? st.pb() : st.pb) : st.b;
    return `<div class="otr-chd"><img alt="" src="${esc(av(mgrA()))}"><span>${esc(L(`${mgrN()} 带你认认路`, `${mgrN()} shows you around`))}</span><span class="n">${i + 1} / ${n}</span></div>`
      + `<b class="otr-ct" id="otr-ct">${fill(st.t[e ? 1 : 0])}</b><p>${fill(body[e ? 1 : 0])}</p>`
      + `<div class="otr-cdots" aria-hidden="true">${Array.from({ length: n }, (_, k) => `<i class="${k < i ? "on" : k === i ? "cur" : ""}"></i>`).join("")}</div>`
      + `<div class="otr-cft"><button type="button" class="otr-sk" data-otr-t="skip">${esc(L("跳过引导", "Skip tour"))}</button><button type="button" class="otr-pv" data-otr-t="back"${i ? "" : " disabled"}>${esc(L("上一步", "Back"))}</button>`
      + `<button type="button" class="otr-nx" data-otr-t="next">${esc(i === n - 1 ? L("完成 ✓", "Done ✓") : L("下一步 ›", "Next ›"))}</button></div><i class="otr-arrow" aria-hidden="true"></i>`;
  }
  /* a step whose target is missing on this form is skipped in the direction of travel (after up to 0.6 s: prep may route first) */
  function show(i, dir = 1, tries = 0) {
    if (!TR.on || i < 0) return;
    if (i >= TR.steps.length) return tClose("done");
    const st = TR.steps[i];
    if (!tries) { try { if (st.prep) st.prep(); } catch (e) { } }
    if (!target(st)) { if (st.prep && tries < 6) { setTimeout(() => show(i, dir, tries + 1), 100); return; } return show(i + dir, dir, 0); }
    TR.i = i; TR.key = "";
    const c = $(".otr-c", TR.el); c.innerHTML = cardHTML(); c.setAttribute("aria-labelledby", "otr-ct"); c.dataset.step = st.id;
    if (!RMQ.matches && TR.el.style.opacity !== "0") c.animate([{ opacity: 0, translate: "0 6px" }, { opacity: 1, translate: "0 0" }], { duration: 260, easing: "cubic-bezier(.2,.8,.2,1)" });
    place(true); tFocus();
  }
  const tFocus = () => { const b = TR.el && $(".otr-nx", TR.el); if (b) b.focus({ preventScroll: true }); };
  function place(force) {
    const st = TR.steps[TR.i]; if (!st) return;
    const R = target(st);
    const ring = $(".otr-ring", TR.el), hole = $(".otr-hole", TR.el), c = $(".otr-c", TR.el);
    if (!R) { ring.hidden = true; hole.setAttribute("width", 0); return; }
    const key = [R.x, R.y, R.w, R.h, innerWidth, innerHeight].map(v => Math.round(v)).join(",");
    if (!force && key === TR.key) return; TR.key = key; TR.R = R; ring.hidden = false;
    Object.assign(ring.style, { left: R.x + "px", top: R.y + "px", width: R.w + "px", height: R.h + "px", borderRadius: R.rad + "px" });
    ["x", "y"].forEach(k => hole.setAttribute(k, R[k])); hole.setAttribute("width", R.w); hole.setAttribute("height", R.h); hole.setAttribute("rx", R.rad);
    const w = c.offsetWidth, h = c.offsetHeight, g = 18, vw = innerWidth, vh = innerHeight, a = $(".otr-arrow", c);
    let side, x, y;
    if (phone()) {   // a full-width card above or below the target, arrow toward its centre
      side = R.y + R.h / 2 > vh / 2 ? "top" : "bottom";
      x = 12; y = side === "top" ? Math.max(12, R.y - h - g) : Math.min(vh - h - 12, R.y + R.h + g);
    } else {
      const fits = s => s === "left" ? R.x - w - g >= 12 : s === "right" ? R.x + R.w + w + g <= vw - 12 : s === "top" ? R.y - h - g >= 12 : R.y + R.h + h + g <= vh - 12;
      side = [st.side || "right", "right", "left", "bottom", "top"].find(fits) || "over";
      if (side === "right") { x = R.x + R.w + g; y = R.y + R.h / 2 - h / 2; } else if (side === "left") { x = R.x - w - g; y = R.y + R.h / 2 - h / 2; }
      else if (side === "top") { x = R.x + R.w / 2 - w / 2; y = R.y - h - g; } else if (side === "bottom") { x = R.x + R.w / 2 - w / 2; y = R.y + R.h + g; }
      else { x = vw / 2 - w / 2; y = vh - h - 24; }
      x = Math.max(12, Math.min(vw - w - 12, x)); y = Math.max(12, Math.min(vh - h - 12, y));
    }
    c.style.left = x + "px"; c.style.top = y + "px"; c.dataset.side = side;
    a.style.left = a.style.top = "";
    if (side === "left" || side === "right") a.style.top = Math.max(18, Math.min(h - 34, R.y + R.h / 2 - y - 8)) + "px";
    else if (side !== "over") a.style.left = Math.max(18, Math.min(w - 34, R.x + R.w / 2 - x - 8)) + "px";
  }
  function follow() { if (!TR.on) return; place(false); TR.raf = requestAnimationFrame(follow); }
  function tClick(e) {
    const b = e.target.closest && e.target.closest("[data-otr-t]"); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const k = b.dataset.otrT;
    if (k === "skip") return tClose("skip");
    if (k === "back") return show(TR.i - 1, -1);
    if (k === "next") return TR.i >= TR.steps.length - 1 ? tClose("done") : show(TR.i + 1, 1);
  }
  function tOpen(o = {}) {
    if (TR.on) return;
    /* a step that cannot route to its target and has none now (no 看画面 pill on a phone) is left out, so n and 完成 are right */
    TR.sc = []; TR.steps = stepList().filter(s => s.prep || target(s)); TR.on = true; TR.from = o.from || ""; tMount();
    if (o.fadeIn) TR.el.style.opacity = "0";
    setOpen(true); show(0, 1); TR.raf = requestAnimationFrame(follow);
  }
  function tTeardown() { TR.on = false; cancelAnimationFrame(TR.raf); if (TR.el) TR.el.remove(); TR.el = null; }
  function tClose(how) {
    if (!TR.on) return;
    const el = TR.el; TR.on = false; cancelAnimationFrame(TR.raf);
    TR.sc.forEach(([p, y]) => { try { p.scrollTo({ top: y, behavior: RMQ.matches ? "auto" : "smooth" }); } catch (e) { p.scrollTop = y; } }); TR.sc = [];
    const end = () => { if (el) el.remove(); if (TR.el === el) TR.el = null; };
    if (el && !RMQ.matches) el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: "forwards" }).finished.then(end, end); else end();
    finish(how);
  }

  // ---------- open / close, records, quiet cues ----------
  let openN = 0;
  function setOpen(on) { document.documentElement.toggleAttribute("data-otr", on); }
  function finish(how) {
    const f = form();
    if (!W.open && !TR.on) setOpen(false);
    try { localStorage.setItem(LSK(f), JSON.stringify(how)); } catch (e) { }
    post({ form: f, how });
    const m = A().ST.meta; if (m && m.onboarding && typeof m.onboarding === "object") { m.onboarding.tour = Object.assign({}, m.onboarding.tour, { [f]: { at: new Date().toISOString(), how } }); }
    if (window.LookAway && LookAway.release) LookAway.release();   // the notices that arrived while the tour was up
    if (A().UI.page === "settings") A().refreshPage();
  }
  function start(o = {}) {
    if (W.open || TR.on) return;
    openN++;
    if (o.welcome === false) { tOpen({ fadeIn: false, from: o.from || "link" }); return; }
    welcome();
  }
  const isOpen = () => W.open || TR.on;
  /* auto-open: once per form while meta.onboarding.tour has no entry for it (and this browser has not finished / skipped it) */
  function seen(f) {
    const ob = A().ST && A().ST.meta && A().ST.meta.onboarding;
    if (!ob || typeof ob !== "object") return true;   // an older server: no tour
    if (ob.tour && ob.tour[f]) return true;
    try { if (localStorage.getItem(LSK(f))) return true; } catch (e) { }
    return false;
  }
  let autoT = 0;
  function auto() {
    if (openN || autoT || isOpen() || !A() || !A().ST || !A().ST.meta || seen(form())) return;
    autoT = setTimeout(function chk() {
      autoT = 0;
      if (openN || isOpen() || seen(form())) return;
      if (document.getElementById("ut-splash") || $(".hw") || document.hidden || location.hash.includes("item=")) { autoT = setTimeout(chk, 800); return; }
      start({ from: "auto" });
    }, 900);
  }
  if (A() && A().on) A().on(auto); else document.addEventListener("DOMContentLoaded", () => A() && A().on && A().on(auto));

  // ---------- entry points: Settings → 通用 「再走一遍」, the 开工清单 header 「导览 ›」 ----------
  function lastLine(e) {
    const ob = (A().ST.meta || {}).onboarding, r = ob && ob.tour && ob.tour[form()];
    if (!r || !r.at) return e ? "Five welcome pages, then a short walk to the chat, Your call and the team." : "5 页欢迎，再带你认一遍：管家聊天、等你拍板、团队。";
    const d = new Date(r.at), day = e ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : `${d.getMonth() + 1}月${d.getDate()}日`;
    const how = r.how === "upgrade" ? (e ? "came with the update; never shown" : "升级前就在用，没弹过") : r.how === "skip" ? (e ? `skipped ${day}` : `${day}跳过了`) : (e ? `last walked ${day}` : `上次走完：${day}`);
    return (e ? "Five welcome pages and the tour · " : "5 页欢迎 + 认路 · ") + how;
  }
  function settingsSec(e) {
    return `<section class="st-sec"><h4>${e ? "Getting started" : "上手引导"}</h4><button type="button" class="st-row otr-replay" data-otr-replay><span class="st-tx"><b>${e ? "Welcome and tour" : "欢迎页和认路"}</b><small>${esc(lastLine(e))}</small></span><em class="st-act" aria-hidden="true">${e ? "Replay" : "再走一遍"}</em></button></section>`;
  }
  const link = () => `<button type="button" class="ob-lnk otr-link" data-otr-open>${esc(L("导览 ›", "Tour ›"))}</button>`;
  document.addEventListener("click", e => {
    const t = e.target.closest && e.target.closest("[data-otr-replay],[data-otr-open]"); if (!t) return;
    e.preventDefault(); e.stopPropagation();
    if (t.dataset.otrReplay != null) { toHome(); setTimeout(() => start({ from: "settings" }), 250); return; }
    start({ welcome: false, from: "checklist" });
  }, true);

  window.Tour = {
    start, isOpen, settingsSec, link, welcome: () => start({}), tour: () => start({ welcome: false }),
    _open: tOpen, _rect: () => TR.R || (TR.steps[TR.i] && target(TR.steps[TR.i])), _focus: tFocus,
    _fade: u => { if (TR.el) TR.el.style.opacity = u >= 1 ? "" : u.toFixed(3); },
    _S: { W, TR },
  };
})();
