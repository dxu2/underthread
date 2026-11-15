/* t-web-toast (user 11-11 00:30): desktop in-app notice. A small card slides in at the top right when something new reaches you:
 *   - a reply on a card or a chat / DM message (mail kind "reply"), a card handed in for review or a rule proposal (mail "待审核" / "新规则提议"),
 *     a reminder you set (mail kind "remind")  — the same classes server.py push_class() pushes to the phone
 *   - a new open question on a card (it.asks; asks are not mailed)
 * Avatar + who + one line + card title; click = open that card (or that chat); auto-hide after 5 s, paused while hovered; at most 3 stacked (oldest drops);
 * nothing for the card that is open or the chat that is on screen; reduced motion = fade only. Desktop only: the phone already gets OS pushes.
 * Reuse check: the phone "banner" is the OS notification from sw.js (web push), not page UI, so only its classification is reused here. */
(function () {
  if (!window.App) return;
  const PHONE = matchMedia("(max-width: 760px)"), RM = matchMedia("(prefers-reduced-motion: reduce)");
  const HOLD = 5000, MAX = 3, FRESH = 10 * 6e4;   // a mail older than 10 min is history (reconnect after sleep), not news
  const T = { seen: null, asks: null, box: null };
  const en = () => App.UI.lang === "en";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const itemOf = id => id && id !== "None" ? App.items().find(i => i.id === id) : null;
  const chatVisible = id => App.UI.chat === id && !App.UI.chatFold && !!document.querySelector("#right .ch-msgs");
  const cardOpen = id => !!id && App.UI.item === id;

  function mailCls(m) {
    const t = m.text || "";
    if (m.kind === "remind") return "remind";
    if (/^(待审核|新规则提议)/.test(t)) return "decide";
    if (m.kind === "reply") return "reply";
    return null;
  }
  function allAsks() {
    const out = [];
    App.items().forEach(it => (App.openAsks ? App.openAsks(it) : []).forEach(a => out.push({ it, a })));
    return out;
  }
  function box() {
    if (T.box && T.box.isConnected) return T.box;
    T.box = document.createElement("div"); T.box.id = "wtoasts"; T.box.setAttribute("role", "status"); T.box.setAttribute("aria-live", "polite");
    document.body.appendChild(T.box);
    return T.box;
  }
  function check() {
    if (!App.ST || !App.ST.meta) return;
    const mail = App.mailAll ? App.mailAll() : (App.ST.mail || []), asks = allAsks();
    if (!T.seen) {   // first state after load: everything already there is old news
      T.seen = new Set(mail.map(m => m.id)); T.asks = new Set(asks.map(x => x.a.id)); return;
    }
    const now = Date.now(), fresh = [];
    mail.forEach(m => {
      if (T.seen.has(m.id)) return; T.seen.add(m.id);
      const cls = mailCls(m); if (!cls || m.read === true || now - new Date(m.t) > FRESH) return;
      const it = itemOf(m.item);
      if (it ? cardOpen(it.id) : chatVisible(m.agent)) return;
      fresh.push({ t: m.t, cls, agent: m.agent, it, text: m.text, chat: it ? null : m.agent });
    });
    asks.forEach(({ it, a }) => {
      if (T.asks.has(a.id)) return; T.asks.add(a.id);
      if (cardOpen(it.id)) return;
      fresh.push({ t: a.t || new Date().toISOString(), cls: "ask", agent: a.who || it.owner, it, text: a.q });
    });
    if (PHONE.matches || !fresh.length) return;
    fresh.sort((x, y) => String(x.t).localeCompare(String(y.t))).slice(-MAX).forEach(show);
  }
  function line(n) {
    const a = App.agent(n.agent);
    if (n.cls === "decide") return /^新规则提议/.test(n.text) ? (en() ? "Proposed a new rule" : "提了一条新规则") : (en() ? "Handed in for your review" : "交给你审核");
    if (n.cls === "ask") return (en() ? "Asks: " : "问你：") + n.text;
    return App.mailPv ? App.mailPv(n.text || "", a) : n.text;
  }
  function show(n) {
    const a = App.agent(n.agent), b = box();
    const sub = n.it ? n.it.title : (en() ? "Chat" : "私信");
    const tag = { reply: en() ? "Reply" : "回复", decide: en() ? "Review" : "待审核", ask: en() ? "Question" : "提问", remind: en() ? "Reminder" : "提醒" }[n.cls];
    const el = document.createElement("div");
    el.className = `wt wt-${n.cls}`; el.tabIndex = 0; el.setAttribute("role", "link");
    el.innerHTML = `<img class="wt-av" src="${esc(a ? App.avatarUrl(a) : "")}" alt=""><div class="wt-b"><div class="wt-h"><b>${esc(a ? App.aname(a) : n.agent || "")}</b><em>${tag}</em></div>`
      + `<p>${esc(line(n))}</p><small>${esc(sub)}</small></div><button class="wt-x" type="button" aria-label="${en() ? "Dismiss" : "关闭"}">×</button>`;
    el._n = n;
    b.prepend(el);
    while (b.children.length > MAX) out(b.lastElementChild, true);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("in")));
    arm(el);
  }
  function arm(el) { clearTimeout(el._t); el._left = el._left || HOLD; el._t0 = Date.now(); el._t = setTimeout(() => out(el), el._left); }
  function pause(el) { if (!el._t) return; clearTimeout(el._t); el._t = null; el._left = Math.max(800, el._left - (Date.now() - el._t0)); }
  function out(el, now) {
    if (!el || el._gone) return; el._gone = true; clearTimeout(el._t);
    if (now || RM.matches && !el.classList.contains("in")) return el.remove();
    el.classList.remove("in"); el.classList.add("out");
    const done = () => el.remove(); el.addEventListener("transitionend", done, { once: true }); setTimeout(done, 400);
  }
  function go(el) {
    const n = el._n; out(el);
    if (n.it) App.route("#item=" + encodeURIComponent(n.it.id));
    else if (n.chat) { App.route("#dm=" + encodeURIComponent(n.chat)); if (App.UI.chatFold) { const f = document.querySelector("#right .ch-fold"); f && f.click(); } }
  }
  document.addEventListener("click", e => {
    const el = e.target.closest && e.target.closest("#wtoasts .wt"); if (!el) return;
    if (e.target.closest(".wt-x")) out(el); else go(el);
  });
  document.addEventListener("keydown", e => {
    const el = e.target.closest && e.target.closest("#wtoasts .wt"); if (!el || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault(); go(el);
  });
  document.addEventListener("mouseover", e => { const el = e.target.closest && e.target.closest("#wtoasts .wt"); if (el) pause(el); });
  document.addEventListener("mouseout", e => { const el = e.target.closest && e.target.closest("#wtoasts .wt"); if (el && !el.contains(e.relatedTarget)) arm(el); });
  document.addEventListener("focusin", e => { const el = e.target.closest && e.target.closest("#wtoasts .wt"); if (el) pause(el); });
  document.addEventListener("focusout", e => { const el = e.target.closest && e.target.closest("#wtoasts .wt"); if (el && !el.contains(e.relatedTarget)) arm(el); });
  document.addEventListener("visibilitychange", () => (T.box ? [...T.box.children] : []).forEach(el => document.hidden ? pause(el) : arm(el)));   // nothing times out unseen in a background tab
  App.on(k => { if (k === "all") check(); });
  window.WebToast = { check, show, _T: T };   // test hook (journeys/wtoast.js)
})();
