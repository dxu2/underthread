/* t-lookaway-fx: arrival effects after LookAway (user picks 11-21/22).
 *   Full screen "D3 · ink" (3 s): only for a batch of cards handed in for review, and once a day when the daily report lands.
 *     No card: avatar + type float straight on a 48 px backdrop blur that blooms out of the avatar like ink in water and draws back into it.
 *     Rare on purpose: at most one every 20 min (rt.lka.fsAt, shared by tabs), never 22:30-08:30, never while you type, never in a hidden tab,
 *     never under prefers-reduced-motion. Anything that may not go full screen goes to the pill instead.
 *   Split (user 11-22, ask dde091 A): the pill = what waits on you (review hand-ins, rule proposals, questions, reminders, day's end);
 *     on a computer, replies and DMs go to the top-right cards (toast.js WebToast.show) and never to the pill. Phone: everything in the pill.
 *     route() is the one place that decides; each notice reaches exactly one surface.
 *   Pill: every notice that waits on you (ask, reminder, review when full screen is not allowed; replies too on the phone). One capsule at top centre drops in
 *     from above the screen edge with a 12 px overshoot (cubic-bezier(.22,1.6,.36,1), 600 ms); a second notice bumps it and grows the
 *     「还有 N 条」 chip (no stacked edges); the 5 s stitched countdown restarts on each merge and pauses while hovered or hidden.
 *     Click = open; chip = next notice; swipe up = dismiss. Reduced motion = 150 ms fades only.
 *   No setting since t-drop-arrival-fx (user 11-23): always full screen + pill. The old 设置 → 提醒动效 pref (localStorage rt.lka) is ignored and removed at load.
 *   Classes: lka-* (checked unused). Knit theme kills backdrop-filter for * with !important; lookaway.css re-enables it for these two layers only.
 *   Test hook: window.LookAway. */
(function () {
  if (!window.App) return;
  const RM = matchMedia("(prefers-reduced-motion: reduce)"), PHONE = matchMedia("(max-width: 760px)");
  const GAP = 20 * 6e4, HOLD = 5000, FS_MS = 3000;
  const S = { q: [], pill: null, cd: null, fs: null, wait: [], eod: undefined };
  const en = () => App.UI.lang === "en";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const LS = { get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } } };
  /* t-drop-arrival-fx: the 设置 row is gone; a pref saved by an older build ("pill" / "off") is dropped so every install behaves the same */
  try { localStorage.removeItem("rt.lka"); } catch (e) { }
  const mode = () => "on";
  const ag = id => App.agent(id), nm = a => a ? App.aname(a) : "", av = a => a ? App.avatarUrl(a) : "";
  const hhmm = d => String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const quiet = () => { if (LS.get("rt.lka.quiet", true) === false) return false; const d = new Date(), m = d.getHours() * 60 + d.getMinutes(); return m >= 22 * 60 + 30 || m < 8 * 60 + 30; };
  const typing = () => { const a = document.activeElement; return !!a && (a.isContentEditable || /^(TEXTAREA|INPUT|SELECT)$/.test(a.tagName)) && !!(a.value || a.textContent || "").trim(); };
  /* why full screen may not play now ("" = it may) */
  function fsBlock(o = {}) {
    if (mode() !== "on") return "mode";
    if (RM.matches) return "reduced-motion";
    if (document.hidden) return "hidden";
    if (S.fs) return "busy";
    if (!o.eod && Date.now() - (+LS.get("rt.lka.fsAt", 0) || 0) < GAP) return "gap";
    if (quiet()) return "quiet";
    if (typing()) return "typing";
    return "";
  }

  /* ---------- full screen ---------- */
  function fsData(kind, list) {
    const E = en();
    if (kind === "eod") {
      const t = today(), its = App.items();
      const shut = its.filter(i => i.stage === "done" && String(i.closed || "").slice(0, 10) === t).length, wait = its.filter(i => i.stage === "review").length;
      return { who: ["manager"], cap: E ? "Day's end" : "今日收工", title: E ? "That's a wrap for today" : "今天收工了",
        line: E ? `${shut} closed today · ${wait} waiting for you` : `今天关了 ${shut} 张，等你 ${wait} 张`, go: () => App.route("#page=review") };
    }
    const who = [...new Set(list.map(n => n.agent).filter(Boolean))];
    if (list.length === 1) {
      const n = list[0], a = ag(n.agent);
      return { who, cap: E ? "For your review" : "等你审阅", title: E ? `${nm(a)} handed in` : `${nm(a)}交稿了`, line: n.it ? n.it.title : "",
        go: () => n.it && App.route("#item=" + encodeURIComponent(n.it.id)) };
    }
    return { who, cap: E ? "For your review" : "等你审阅", title: E ? `${list.length} cards for you` : `${list.length} 张等你审`,
      line: who.map(w => nm(ag(w))).join(E ? ", " : "、"), go: () => App.route("#page=review") };
  }
  function fsPlay(kind, list, o = {}) {
    const D = fsData(kind, list), E = en();
    if (!o.preview) LS.set("rt.lka.fsAt", Date.now());
    const el = document.createElement("div");
    el.id = "lka-fs"; el.className = "lka-fs lka-" + kind; el.tabIndex = -1;
    el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite");
    const avs = D.who.slice(0, 3).map(w => `<img src="${esc(av(ag(w)))}" alt="">`).join("");
    el.innerHTML = `<div class="lka-blur" aria-hidden="true"></div><div class="lka-col">`
      + `<div class="lka-avs${D.who.length > 1 ? " lka-many" : ""}">${avs}</div>`
      + `<div class="lka-b lka-cap" style="--k:0">${esc(D.cap)} · ${hhmm(new Date())}</div>`
      + `<div class="lka-b lka-title" style="--k:1">${esc(D.title)}</div>`
      + (D.line ? `<div class="lka-b lka-line" style="--k:2">${esc(D.line)}</div>` : "")
      + `<div class="lka-b lka-cd" style="--k:3" aria-hidden="true"><svg viewBox="0 0 200 4" preserveAspectRatio="none"><path class="lka-cd-bg" d="M0 2H200"/><path class="lka-cd-on" d="M0 2H200"/></svg></div>`
      + `<div class="lka-hint">${E ? "Click anywhere to open · Esc to close" : "点任意处去看看　·　Esc 关闭"}</div></div>`;
    document.body.appendChild(el);
    const a = el.querySelector(".lka-avs"), r = a.getBoundingClientRect();
    el.style.setProperty("--lka-x", Math.round(r.left + r.width / 2) + "px"); el.style.setProperty("--lka-y", Math.round(r.top + r.height / 2) + "px");
    S.fs = { el, D, t: setTimeout(() => fsEnd(), FS_MS + 120) };
    el.addEventListener("animationend", e => { if (e.target.classList.contains("lka-blur") && e.animationName === "lka-ink") fsEnd(); });
    el.addEventListener("click", () => { const go = D.go; fsEnd(true); go && go(); });
    requestAnimationFrame(() => el.classList.add("lka-run"));
    return el;
  }
  function fsEnd(fast) {
    const f = S.fs; if (!f) return; S.fs = null; clearTimeout(f.t);
    const done = () => { f.el.remove(); if (S.wait.length) { const w = S.wait.splice(0); route(w); } };
    if (fast && !RM.matches) { f.el.classList.add("lka-quit"); setTimeout(done, 320); } else done();
  }
  addEventListener("keydown", e => { if (S.fs && (e.key === "Escape" || e.key === " ")) { e.preventDefault(); fsEnd(true); } }, true);

  /* ---------- pill ---------- */
  const TAG = { reply: ["回复", "Reply"], decide: ["交给你审核", "Handed in for review"], ask: ["问你一件事", "Has a question"], remind: ["提醒", "Reminder"], eod: ["今天收工了", "That's a wrap"] };
  const BTN = { reply: ["回复", "Reply"], decide: ["打开", "Open"], ask: ["回答", "Answer"], remind: ["查看", "View"], eod: ["去看", "View"] };
  const L2 = (p) => p ? p[en() ? 1 : 0] : "";
  function pillHTML(n) {
    const a = ag(n.agent), more = S.q.length - 1;
    return `<img class="lka-pav" src="${esc(av(a))}" alt=""><span class="lka-tx"><b>${esc(nm(a) || n.agent || "")}<em> · ${esc(L2(TAG[n.cls]))}</em></b><small>${esc(n.sub || "")}</small></span>`
      + `<button type="button" class="lka-more" data-lka-more aria-label="${en() ? `${more} more` : `还有 ${more} 条`}"${more > 0 ? "" : " hidden"}><span class="lka-mf">${en() ? `${more} more` : `还有 ${more} 条`}</span><span class="lka-mb" aria-hidden="true">+${more}</span></button>`
      + `<span class="lka-go" aria-hidden="true">${esc(L2(BTN[n.cls]))}</span><i class="lka-pcd" aria-hidden="true"><i></i></i>`;
  }
  function pillBox() {
    if (S.pill && S.pill.isConnected) return S.pill;
    const w = document.createElement("div"); w.id = "lka-pw";
    w.innerHTML = `<div class="lka-pill" role="link" tabindex="0" aria-live="polite"></div>`;
    document.body.appendChild(w); S.pill = w; return w;
  }
  function paint(bump) {
    const w = pillBox(), p = w.firstElementChild, n = S.q[0];
    p.className = "lka-pill lka-c-" + n.cls; p.innerHTML = pillHTML(n);
    p.setAttribute("aria-label", `${nm(ag(n.agent))} · ${L2(TAG[n.cls])} · ${n.sub || ""}`);
    if (bump && !RM.matches) p.animate([{ translate: "0 0" }, { translate: "0 3px", offset: .3 }, { translate: "0 -1px", offset: .7 }, { translate: "0 0" }], { duration: 450, easing: "ease-out" });
    countdown();
  }
  function countdown() {
    const bar = S.pill && S.pill.querySelector(".lka-pcd > i"); if (!bar) return;
    if (S.cd) S.cd.cancel();
    S.cd = bar.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], { duration: HOLD, easing: "linear", fill: "forwards" });
    S.cd.onfinish = () => pillOut();
    if (document.hidden || (S.pill && ((S.mouse && S.pill.matches(":hover")) || S.pill.querySelector(":focus-visible") || S.pill.matches(":focus-visible")))) S.cd.pause();   // touch leaves a sticky :hover and tap focus behind; neither holds it
  }
  function pillAdd(list) {
    if (S.fs) { S.wait.push(...list); return; }
    const was = S.q.length > 0 && S.pill && S.pill.isConnected && !S.pill._out;
    if (!was) { if (S.pill) { S.pill.remove(); S.pill = null; } S.q = []; }
    S.q.push(...list);
    if (was) { paint(true); return; }
    const w = pillBox(); paint(false);
    const p = w.firstElementChild;
    if (RM.matches) p.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, fill: "backwards" });
    else {
      p.animate([{ transform: "translateY(-112px)" }, { transform: "none" }], { duration: 600, easing: "cubic-bezier(.22,1.6,.36,1)", fill: "backwards" });
      p.animate([{ filter: "blur(6px)" }, { filter: "blur(0)" }], { duration: 330, easing: "ease-out", fill: "backwards" });
      p.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: "ease-out", fill: "backwards" });
    }
  }
  function pillOut() {
    const w = S.pill; if (!w || w._out) return; w._out = true; S.q = []; if (S.cd) { S.cd.cancel(); S.cd = null; }
    const p = w.firstElementChild;
    const a = RM.matches ? p.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: "forwards" })
      : p.animate([{ transform: "none", opacity: 1, filter: "blur(0)" }, { opacity: 1, filter: "blur(0)", offset: .6 }, { transform: "translateY(-112px)", opacity: 0, filter: "blur(4px)" }],
        { duration: 380, easing: "cubic-bezier(.55,0,.75,.2)", fill: "forwards" });
    a.finished.then(() => { if (w._out) w.remove(); if (S.pill === w) S.pill = null; }, () => { });
  }
  function next() { S.q.shift(); if (!S.q.length) return pillOut(); paint(false); const p = S.pill.firstElementChild; if (!RM.matches) p.animate([{ opacity: .3, filter: "blur(3px)" }, { opacity: 1, filter: "blur(0)" }], { duration: 220, easing: "ease-out" }); }
  function open(n) {
    if (n.cls === "eod") return App.route("#page=review");
    if (n.it) App.route("#item=" + encodeURIComponent(n.it.id));
    else if (n.chat) { App.route("#dm=" + encodeURIComponent(n.chat)); if (App.UI.chatFold) { const f = document.querySelector("#right .ch-fold"); f && f.click(); } }
  }
  document.addEventListener("click", e => {
    const p = e.target.closest && e.target.closest("#lka-pw .lka-pill"); if (!p || !S.pill || S.pill._out) return;
    if (p._swiped && Date.now() - p._swiped < 400) return;
    if (e.target.closest("[data-lka-more]")) return next();
    const n = S.q[0]; if (n) open(n); next();
  });
  document.addEventListener("keydown", e => {
    const p = e.target.closest && e.target.closest("#lka-pw .lka-pill"); if (!p) return;
    if (e.key === "Escape") pillOut();
    else if ((e.key === "Enter" || e.key === " ") && !e.target.closest("[data-lka-more]")) { e.preventDefault(); const n = S.q[0]; if (n) open(n); next(); }
  });
  const hold = on => { if (!S.cd) return; if (on) S.cd.pause(); else if (!document.hidden) S.cd.play(); };
  document.addEventListener("pointerover", e => { if (e.pointerType === "mouse" && e.target.closest && e.target.closest("#lka-pw .lka-pill")) hold(true); });
  document.addEventListener("pointerout", e => { const p = e.target.closest && e.target.closest("#lka-pw .lka-pill"); if (p && e.pointerType === "mouse" && !p.contains(e.relatedTarget)) hold(false); });
  addEventListener("pointerdown", e => { S.mouse = e.pointerType === "mouse"; }, true);
  document.addEventListener("focusin", e => { if (e.target.closest && e.target.closest("#lka-pw") && e.target.matches(":focus-visible")) hold(true); });
  document.addEventListener("focusout", e => { if (e.target.closest && e.target.closest("#lka-pw") && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest("#lka-pw"))) hold(false); });
  document.addEventListener("visibilitychange", () => hold(document.hidden));
  /* swipe up to dismiss (finger or mouse drag) */
  const SW = {};
  document.addEventListener("pointerdown", e => { const p = e.target.closest && e.target.closest("#lka-pw .lka-pill"); if (!p || e.button !== 0) return; SW.p = p; SW.id = e.pointerId; SW.y = e.clientY; SW.x = e.clientX; SW.on = false; });
  document.addEventListener("pointermove", e => {
    if (!SW.p || e.pointerId !== SW.id) return;
    const dy = e.clientY - SW.y;
    if (!SW.on) { if (Math.abs(e.clientX - SW.x) > 10 && Math.abs(e.clientX - SW.x) > Math.abs(dy)) { SW.p = null; return; } if (dy > -6) return; SW.on = true; hold(true); try { SW.p.setPointerCapture(e.pointerId); } catch (_) { } }
    SW.p.style.translate = `0 ${Math.min(0, dy)}px`; SW.p.style.opacity = String(Math.max(.2, 1 + dy / 120));
  });
  const swEnd = e => {
    const p = SW.p; if (!p || e.pointerId !== SW.id) return; SW.p = null; if (!SW.on) return;
    p._swiped = Date.now(); const dy = e.clientY - SW.y;
    p.style.translate = ""; p.style.opacity = "";
    if (e.type === "pointerup" && dy < -28) pillOut(); else hold(false);
  };
  document.addEventListener("pointerup", swEnd); document.addEventListener("pointercancel", swEnd);

  /* ---------- intake ---------- */
  /* toast.js hands over its fresh notices ({t, cls, agent, it, text, chat}); line = its one-line text. Returns true when they are ours. */
  function take(fresh, line) {
    if (mode() === "off" || !fresh.length) return false;
    const list = fresh.map(n => ({ ...n, sub: n.it ? (n.cls === "decide" ? n.it.title : (line ? line(n) : n.text) + " · " + n.it.title) : (line ? line(n) : n.text) }));
    if (window.Tour && Tour.isOpen()) { S.held = (S.held || []).concat(list); return true; }   // t-onboard-tour: no cue over the tour; release() turns them into the pill
    const rev = list.filter(n => n.cls === "decide" && n.it && !/^新规则提议/.test(n.text || ""));
    if (rev.length && !fsBlock()) { fsPlay("review", rev); const rest = list.filter(n => !rev.includes(n)); if (rest.length) S.wait.push(...rest); return true; }
    route(list);
    return true;
  }
  /* one surface per notice: on a computer replies / DMs -> top-right cards, the rest -> pill; phone (no cards there) -> pill.
     While the full screen plays everything waits (S.wait) and comes through here when it ends. */
  const toCard = n => n.cls === "reply" && !PHONE.matches && !!(window.WebToast && WebToast.show);
  function route(list) {
    if (S.fs) { S.wait.push(...list); return; }
    const cards = list.filter(toCard), pill = list.filter(n => !toCard(n));
    if (pill.length) pillAdd(pill);
    cards.slice(-3).forEach(n => WebToast.show(n));
  }
  /* end of day: the daily report lands (meta.last_report_date turns to today while the page is open) */
  function eodCheck() {
    const m = App.ST && App.ST.meta; if (!m) return;
    const d = m.last_report_date || "", was = S.eod; S.eod = d;
    if (was === undefined || d === was || d !== today() || mode() === "off") return;
    if (LS.get("rt.lka.eod", "") === d) return; LS.set("rt.lka.eod", d);
    if (!fsBlock({ eod: true })) fsPlay("eod", []);
    else { const D = fsData("eod"); pillAdd([{ cls: "eod", agent: "manager", sub: D.line, t: new Date().toISOString() }]); }
  }
  App.on(k => { if (k === "all") eodCheck(); });

  /* t-onboard-tour: the tour closed; what arrived meanwhile comes in as the quiet top pill (never the full-screen arrival) */
  function release() { const h = S.held || []; S.held = []; if (h.length && mode() !== "off") route(h); }
  window.LookAway = { release, take, route, fsPlay, fsEnd, pillAdd, pillOut, mode, fsBlock, eodCheck, _S: S };
})();
