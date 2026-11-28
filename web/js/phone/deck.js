// Phone layer: layout C, the swipeable review deck (right approve, left reject, up later).
// t-oss-struct S10 (A8): moved out of mobile.js unchanged. Its wire*() function holds what used to run at load (listeners, observers, the
// self-contained blocks); mobile.js calls it where the code used to be, so everything runs in the same order as before.


// ---------- C: swipe deck ----------
import { $, deckIdx, dragging, en, mq, setDeckIdx, setDragging } from "../mobile.js";
function deck() {
  const body = $("#pagebody"); if (!body || dragging) return;
  const list = App.items().filter(i => App.onYouCard ? App.onYouCard(i) : i.stage === "review" && !(App.busy && App.busy(i))).sort(App.byAct);   // t-doing-first, t-home-newreplies
  const head = `<div class="ph"><h1>${App.t("review")}</h1>${en() ? "" : '<div class="en">PENDING REVIEW</div>'}</div>`;
  if (!list.length) { body.innerHTML = head + `<div class="empty">${App.t("empty_review")}</div>`; return; }
  setDeckIdx(((deckIdx % list.length) + list.length) % list.length);
  const order = [0, 1, 2].map(k => list[(deckIdx + k) % list.length]).filter((x, i, a) => a.indexOf(x) === i);
  const card = (it, cls) => {
    const a = App.agent(it.owner), kind = it.kind === "task" ? "deliverable" : it.kind;
    return `<div class="dk-card ${cls}" data-id="${esc(it.id)}">
      <div class="dk-meta"><span class="tag ${kind}"><span class="gl" aria-hidden="true">◆</span>${App.t(kind)}</span><span>${App.t(it.category)}</span><span class="dim">${App.whenH(it.activity)}</span>${(it.platforms || []).map(p => `<span class="tag pf">${esc(App.PLAT[p] || p)}</span>`).join("")}</div>
      <h3>${window.Onboard ? Onboard.exT(it) : esc(it.title)}</h3><p class="dk-sum">${esc(it.summary || "")}</p>
      <div class="dk-draft md">${it.draft ? md(it.draft) : `<p class="dim">${en() ? "No draft yet." : "还没有草稿。"}</p>`}</div>
      <div class="dk-who">${App.av(a, "sm")}${esc(App.aname(a))} · ${esc(App.atitle(a))}${App.askLeft(it) ? `<b class="ok-ask">${App.askLeft(it)}</b>` : ""}</div>
      <div class="dk-stamp ok">${en() ? (it.kind === "plan" ? "START" : it.kind === "question" ? "ANSWER" : "ACCEPT") : App.okLabel(it, false).replace(" · ", "·")}</div><div class="dk-stamp no">${en() ? "REJECT" : "驳回"}</div><div class="dk-stamp skip">${en() ? "LATER" : "稍后"}</div></div>`;
  };
  const html = head + `<div class="dk-count">${deckIdx + 1} / ${list.length}</div>
    <div class="deck">${order.map((it, i) => card(it, i === 0 ? "top" : i === 1 ? "back" : "back2")).reverse().join("")}</div>
    <div class="dk-btns"><button class="no" data-dk="no" aria-label="reject">✕</button><button class="sk" data-dk="skip" aria-label="later">↑</button><button class="ok" data-dk="ok" aria-label="approve">✓</button></div>
    <div class="dk-hint">${en() ? `→ ${App.okLabel(list[deckIdx], true).toLowerCase()} · ← reject · ↑ later · tap to open` : `右滑${App.okLabel(list[deckIdx], false)} · 左滑驳回 · 上滑稍后 · 轻点看详情`}</div>`;
  const pf = App.phaseFree || (h => h);   // t-home-flicker: the --wp ring phase in App.av is not data
  if (body._deck === pf(html) && $(".deck", body)) return;
  body.innerHTML = html; body._deck = pf(html);
  wireDeck(body);
}
function wireDeck(body) {
  const top = $(".dk-card.top", body); if (!top) return;
  const id = top.dataset.id, st = { ok: $(".dk-stamp.ok", top), no: $(".dk-stamp.no", top), skip: $(".dk-stamp.skip", top) };
  let sx = 0, sy = 0, dx = 0, dy = 0;
  const stamps = () => { st.ok.style.opacity = Math.max(0, Math.min(1, dx / 110)); st.no.style.opacity = Math.max(0, Math.min(1, -dx / 110));
    st.skip.style.opacity = Math.abs(dy) > Math.abs(dx) ? Math.max(0, Math.min(1, -dy / 110)) : 0; };
  top.addEventListener("pointerdown", e => { setDragging(true); sx = e.clientX; sy = e.clientY; dx = dy = 0; top.setPointerCapture(e.pointerId); top.classList.remove("fly"); });
  top.addEventListener("pointermove", e => {
    if (!dragging) return; dx = e.clientX - sx; dy = e.clientY - sy;
    top.style.transform = `translate(${dx}px, ${dy < 0 ? dy : dy * 0.25}px) rotate(${dx / 18}deg)`; stamps();
  });
  const end = () => {
    if (!dragging) return; setDragging(false);
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) { top.style.transform = ""; return App.openItem(id); }
    if (dx > 110) return act("ok", top, id);
    if (dx < -110) return act("no", top, id);
    if (dy < -110 && Math.abs(dy) > Math.abs(dx)) return act("skip", top, id);
    top.classList.add("fly"); top.style.transform = ""; dx = dy = 0; stamps();
  };
  top.addEventListener("pointerup", end); top.addEventListener("pointercancel", end);
}
function act(k, top, id) {
  top = top || $(".dk-card.top"); id = id || (top && top.dataset.id); if (!top || !id) return;
  top.classList.add("fly");
  const it = App.items().find(i => i.id === id), wasPlan = it && it.kind === "plan";
  if (k === "ok") {
    top.style.transform = "translate(130vw, -40px) rotate(24deg)"; top.style.opacity = 0;
    const cx = innerWidth / 2, cy = innerHeight / 2;
    App.api("approve", { item: id }).then(() => {
      if (!window.FX) return;
      FX.burst(cx, cy, { n: 40, spread: 160 });
      if (wasPlan) App.toast(App.okDone(it));
      else if (FX.missionComplete) FX.missionComplete({ key: id + "|" + ((it && it.updated) || ""), owner: it && it.owner, title: it && it.title, time: App.when(new Date().toISOString()) });
      else FX.titleCard(en() ? "Mission Complete" : "委托完成", it ? esc(it.title) : "", { cls: en() ? "" : "cjk" });
    }).catch(() => { top.style.transform = ""; top.style.opacity = 1; });
  } else if (k === "no") {
    top.style.transform = "translate(-30px, 0) rotate(-3deg)";
    setTimeout(() => { top.style.transform = ""; App.rejectItem(id); }, 220);
  } else if (App.snzMenu) {   // ri1103-P2: 上滑稍后 = the same 稍后 sheet as the detail page; the card flies off only once a time is picked
    top.style.transform = "translate(0, -48px)";
    App.snzMenu(id, null, ok => {
      if (ok) { top.style.transform = "translate(0, -120vh) rotate(-6deg)"; top.style.opacity = 0; setTimeout(() => { const b = $("#pagebody"); if (b) b._deck = null; deck(); }, 380); }
      else { top.style.transform = ""; const s = $(".dk-stamp.skip", top); if (s) s.style.opacity = 0; }
    });
  } else {
    top.style.transform = "translate(0, -120vh) rotate(-6deg)"; top.style.opacity = 0;
    setTimeout(() => { (setDeckIdx(deckIdx + 1) - 1); const b = $("#pagebody"); if (b) b._deck = null; deck(); }, 380);
  }
}

function wirePhDeck() {
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-dk]"); if (b && mq.matches) act(b.dataset.dk);
  });
}

export { deck, wireDeck, act, wirePhDeck };
