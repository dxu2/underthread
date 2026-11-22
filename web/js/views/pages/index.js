// Dashboard pages: the PAGES table (one renderer per page), renderPage() and the widget-home switch, phaseFree(), the rules block and docs.
// t-oss-struct S10 (A5): moved out of app.js unchanged; a wire*() function, if any, holds the top-level event wiring and app.js calls it where
// the code used to run, so listeners register in the same order as before.


import { $, LS } from "../../core/util.js";
import { PLAT, STAGES, ago, dayKey, grpLabel, rowLabel, rtTag, srvT, stageLabel, t, when, whenH, whoName } from "../../core/i18n.js";
import { ST, UI, byAct, byCreated, grpOf, idleDoing, idleL, items, logsFor, mailAll, onYouCard } from "../../core/store.js";
import { aduty, agent, agents, aname, atitle, av, hasArt, ringOnce } from "../../core/av.js";
import { UE_ART, api, toast, utEmpty } from "../../core/ui.js";
import { route } from "../../core/router.js";
import { autoFold, setChat } from "../chat.js";
import { openItem, snzLine } from "../drawer.js";
import { renderHeader, ruCard } from "../header.js";
import { renderLeft } from "../left.js";
import { homeCounts, logRows, logText, mailFiltered, mailGroups, mailPv, mailRep, mailRow, mbGroups, mbRow, newReplies, nrBlock, nrRead, renderMailbox, wkFrom } from "../mail.js";
import { MOBQ, card, lsSet, pageHead } from "./common.js";
import { lookBtns } from "../rolelook.js";
import { catPage, doneOpen, questsPage } from "./quests.js";
import { RV, askGroups, askGuard, decHead, decRow, decisions, grpHTML, nowBlock, reviewCard, reviewRow, todayBlock } from "./review.js";
import { ongoingPage, schedPage } from "./schedule.js";
import { hooks, liveItem, wkAttr, wkFx, wkTag, workersOf } from "../../app.js";
const PAGES = {
  quests() { return questsPage(); },
  market() { return window.Market ? Market.page(pageHead("market")) : pageHead("market"); },
  /* t-hm-build: web/market.js (null = keep its DOM) */
  /* t-roster-rail (11-21, option A): 团队 / Team in the left rail is the roster that used to be 设置 · 角色, cards as they were, plus
     改名 (display name) and 换头像 (one of the role's own pictures), web/js/views/rolelook.js. 设置 · 角色 keeps a row that jumps here.
     (The old t-rb-build 团队 page in web/team.js has had no rail row since t-drop-team-tab; its home widget stays.) */
  crew() { return rosterPage(); },
  ongoing() { return Array.isArray(ST.schedules) ? schedPage() : ongoingPage(); },   /* t-ri1104-p3; t-schedule-ui: 定时 page when the server sends state.schedules */
  review() {
    if (widgetHome()) return window.Widgets ? Widgets.html($("#pagebody"), rulesBlock()) : rulesBlock();   // t-home-widgets: null = keep the current DOM
    const phoneLike = MOBQ.matches;   /* t-home-style-trim: on a desktop the 首页 is always the widget home above, so below here is the phone home */
    const hf = phoneLike ? (UI.hf || "review") : "review", wkc = wkFrom();   /* ri1107-P3: same 7 calendar days as the count */   // hf: set by the phone home strip's stat row
    const list = items().filter(i => i.id !== RV.pending && (hf === "week" ? (i.stage === "done" && i.closed && new Date(i.closed) > wkc) : hf === "review" ? onYouCard(i) : grpOf(i) === hf)).sort(UI.sort === "created" ? byCreated : byAct);
    const dec = hf === "review" ? decisions() : [];   // t-imp-p1
    const decH = dec.length ? decHead(list.length, dec) : "", decR = dec.map(decRow).join(""), today = hf === "review" && !list.length ? todayBlock() : "";
    const bar = (hf === "review" ? nrBlock() : "") + `<div class="ph-bar"><button data-sort="activity" class="${UI.sort === "activity" ? "on" : ""}">${t("by_activity")}</button>
      <button data-sort="created" class="${UI.sort === "created" ? "on" : ""}"><span class="gl" aria-hidden="true">▼ </span>${t("by_created")}</button>
      <span class="count">${hf === "review" ? (UI.lang === "en" ? "On you" : "等你拍板") : hf === "week" ? (UI.lang === "en" ? "Shipped · 7 days" : "近 7 天交付") : stageLabel(hf)} <b>${list.length + dec.length}</b></span></div>`;   // t-home-nobtn: the 切回 button is gone; ⌘K「首页样式」and #home=classic stay as the back door
    const sz = hf === "review" ? snzLine() : "";   // ri1103-P2
    /* t-ri1104-p5: phone (and app-style desktop) home with nothing to approve: one quiet line instead of the big empty block,
       and no sort row (nothing to sort), so 此刻 / 今天交付 move up into the first screen. The sort row comes back with the first card. */
    if (!list.length && phoneLike && hf === "review" && !dec.length) return pageHead("review", nrBlock()) + sz + `<div class="dc-none dc-ok ue" role="status">${UE_ART}<b class="ue-h">${UI.lang !== "en" ? "线头都收好了" : "All threads tied off"}</b><i aria-hidden="true">✓</i><span class="ue-t">${t("empty_ok")}</span></div>` + today;
    if (!list.length) return pageHead("review", bar) + sz + (dec.length ? decH + decR : hf === "review" ? utEmpty(t("empty_review"), "dc-none top") : utEmpty(t("empty_review"))) + today;
    const seen = UI.seen.review || "";
    const fresh = list.filter(i => (i.activity || "") > seen);
    let html = pageHead("review", bar) + sz;
    const mob = phoneLike, rowf = i => reviewRow(i, !!seen && fresh.includes(i)), wrap = h => `<div class="act-list">${h}</div>`;
    if (mob && hf === "review") {   // P5: one flat column of review cards (new first, then by category), no group headers; the category sits in each card's meta line
      const rest = seen ? list.filter(i => !fresh.includes(i)) : list, cats = ["urgent", "main", "side", "daily", "ongoing"];
      const ord = (seen ? fresh : []).concat(cats.flatMap(c => rest.filter(i => i.category === c)), rest.filter(i => !cats.includes(i.category)));
      const rc = i => reviewCard(i, !!seen && fresh.includes(i));   /* t-ri1113-a P3: the same sweep question on 3+ cards = one group card */
      return html + decH + `<div class="rv-list">${askGroups(ord).map(e => e.g ? grpHTML(e.g, "rv") + (e.g.open ? e.g.items.map(rc).join("") : "") : rc(e.it)).join("")}</div>` + decR + nowBlock();   // t-now-always
    }
    if (fresh.length && seen) html += `<div class="grp-h"><b>${UI.lang === "en" ? "New" : "新到待批"}</b> · ${fresh.length}</div>` + wrap(fresh.map(rowf).join(""));
    const rest = seen ? list.filter(i => !fresh.includes(i)) : list;
    for (const c of ["urgent", "main", "side", "daily", "ongoing"]) {
      const g = rest.filter(i => i.category === c); if (!g.length) continue;
      html += `<div class="grp-h"><b>${t(c)}</b> · ${g.length}</div>` + wrap(g.map(rowf).join(""));
    }
    return html + (dec.length ? decH.replace('class="dc-h"', 'class="dc-h after"') + decR : "");
  },
  board() {
    const cutoff = Date.now() - 7 * 864e5;
    const list = items().filter(i => i.stage !== "done" || new Date(i.closed || i.updated) > cutoff);
    return pageHead("board") + `<div class="board">${STAGES.map(s => {
      let g = list.filter(i => grpOf(i) === s).sort(byAct); const total = g.length;
      const more = s === "done" && !UI.boardAll && !MOBQ.matches && total > 12 ? total - 12 : 0; if (more) g = g.slice(0, 12);   // t-web-audit 01: the done column shows the latest 12
      return `<div class="col" data-drop="${s}"><div class="col-h"><span>${grpLabel(s)}</span><span>${total}</span></div>${g.map(i =>
        { const ws = workersOf(i.id); return `<div class="mini${ws.length ? " wk-on" : ""}" draggable="true" data-drag="${i.id}" data-item="${i.id}"${wkAttr(ws)}>${wkFx(ws)}<div class="t">${esc(i.title)}</div>${wkTag(ws)}<div class="m">${av(agent(i.owner), "sm", i.id)}${idleDoing(i) ? `<span class="tag">${rtTag(i) || idleL(i)}</span>` : ""}<span>${t(i.category)}</span><span>${when(i.activity)}</span></div></div>`; }).join("")}${more ? `<button class="col-more" data-board-all>${UI.lang === "en" ? `${more} more · show all` : `还有 ${more} 张 · 展开`}</button>` : ""}</div>`;
    }).join("")}</div>`;
  },
  logs() {
    const ids = ["", ...agents().map(a => a.id), "me"];
    const got = logsFor(UI.logAgent), list = (got || []).slice(-400).reverse();   /* ri1105-P4: logs come from /api/history while this tab is open */
    return pageHead("logs") + `<div class="filters"><div class="seg" data-seg="logs">${ids.map(id => `<button class="seg-i ${UI.logAgent === id ? "on" : ""}" data-logf="${id}">${id ? esc(whoName(id)) : t("all")}</button>`).join("")}</div></div>` +
      (list.length ? logRows(list).map(({ l, hb, n }) => hb ? `<div class="log-i hb"><span class="tm">${whenH(l.t)}</span>${av(agent(l.agent), "sm")}<span>${esc(whoName(l.agent))}</span><span>${UI.lang === "en" ? "Heartbeat" : "在线心跳"}${n > 1 ? ` × ${n}` : ""}</span></div>` : `<div class="log-i"><span class="tm">${whenH(l.t)}</span>${l.agent === "me" ? av("me", "sm") : av(agent(l.agent), "sm")}<span>${esc(whoName(l.agent))}</span>
        <span>${l.item ? `<span class="it" data-item="${l.item}">${esc(l.item)}</span> ` : ""}${esc(logText(l.text))}</span></div>`).join("") : got ? `<div class="empty">${t("empty")}</div>` : `<div class="empty">${UI.lang === "en" ? "Loading…" : "载入中…"}</div>`);
  },
  reports() {
    const list = (ST.reports || []).slice().reverse();
    const open = UI.openRep || (list[0] && list[0].id);
    if (UI.page === "reports" && list.some(r => r.id === open)) {   /* t-ri1114-a P1: reading a report reads its 日报 letter */
      const ids = mailAll().filter(m => !m.read && mailRep(m) === open).map(m => m.id); if (ids.length) nrRead(ids);
    }
    /* r-improve-1119 P3: the report comes by itself at report_time, so no standing 「让管家写日报」 button: before today's report is out the head says
       when it comes with a quiet 「现在就要一份 ›」; once it is out, nothing. */
    const today = dayKey(new Date()), outToday = (ST.meta && ST.meta.last_report_date === today) || list.some(r => r.date === today);
    const bar = outToday ? "" : `<div class="ph-bar rq-next"><span>${t("report_next", { t: (ST.meta && ST.meta.report_time) || "18:00" })}</span><button data-repreq>${t("report_req")} ›</button></div>`;
    return pageHead("reports", bar) +
      (list.length ? list.map(r => {
        /* t-ri1110-a P5: a body that opens with its own 「# 日报 …」 line said the title twice; that line becomes the row title (keeps the weekday) */
        const m = /^#\s+(日报[^\n]*)\n*/.exec(r.body || ""), head = m ? m[1].trim() : `${r.title} · ${r.date}`, body = m ? r.body.slice(m[0].length) : r.body;
        return `<div class="rep"><div class="rep-h" data-rep="${r.id}"><b>${esc(head)}</b><span class="dim">${whenH(r.t)}</span></div>
        ${r.id === open ? `<div class="md" style="margin-top:10px">${md(body)}</div>` : ""}</div>`; }).join("") : `<div class="empty">${t("reports_empty", { t: "18:00" })}</div>`);
  },
  channels() {
    const its = items().filter(i => i.stage !== "done" || new Date(i.closed || i.updated) > Date.now() - 14 * 864e5);
    const col = (key, name, list) => `<div class="plat"><h3>${name}</h3><div class="sub">${list.length}</div>${list.sort(byAct).map(i =>
      { const ws = workersOf(i.id); return `<div class="mini${ws.length ? " wk-on" : ""}" data-item="${i.id}"${wkAttr(ws)}>${wkFx(ws)}<div class="t">${esc(i.title)}</div>${wkTag(ws)}<div class="m"><span class="tag">${rowLabel(i)}</span>${av(agent(i.owner), "sm", i.id)}<span>${t(i.category)}</span></div></div>`; }).join("") || `<div class="dim">—</div>`}</div>`;
    const none = its.filter(i => !(i.platforms || []).length && ["main", "side"].includes(i.category));
    return pageHead("channels") + `<div class="plats">${Object.entries(PLAT).map(([k, n]) => col(k, n, its.filter(i => (i.platforms || []).includes(k)))).join("")}</div>` +
      (none.length ? `<div class="grp-h"><b>${t("ch_none")}</b> · ${none.length}</div>` + none.map(card).join("") : "");
  },
  docs() {
    if (!UI.docs) { fetch("/api/docs").then(r => r.json()).then(d => { UI.docs = d; renderPage(); }); return pageHead("docs"); }
    const groups = {}; for (const d of UI.docs) (groups[d.group] = groups[d.group] || []).push(d);
    /* t-phone-docs: phones stack the panes, so the text landed under the long list. .has-doc hides the list there (mobile.css) and
       .doc-back returns to it; on desk the back button is hidden and both panes stay. */
    const en = UI.lang === "en", back = UI.doc ? `<button type="button" class="doc-back" data-doc-back><svg viewBox="0 0 12 20" width="8" height="14" aria-hidden="true"><path d="M10 2 2 10l8 8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>${en ? "All docs" : "全部文档"}<span>${esc(UI.doc.split("/").pop())}</span></button>` : "";
    return pageHead("docs") + `<div class="docs${UI.doc ? " has-doc" : ""}"><div class="dl">${Object.entries(groups).map(([g, ds]) => `<div class="g">${esc(g)}</div>` +
      ds.map(d => `<button class="${(UI.doc || UI.docLast) === d.path ? "on" : ""}" data-doc="${esc(d.path)}" title="${esc(d.path)}">${esc(d.path.split("/").pop())}</button>`).join("")).join("")}</div>
      <div class="md">${back}${UI.doc ? (UI.docText ? md(UI.docText) : `<div class="empty">${en ? "Loading…" : "加载中…"}</div>`) : `<div class="empty">${t("docs_pick")}</div>`}</div></div>`;
  },
  roles() {   /* t-roster-rail: 设置 · 角色 = one row to the 团队 page */
    const en = UI.lang === "en", n = agents().length;
    return `<section class="st-sec rl-jump"><h4>${en ? "Roster" : "角色"}</h4><button type="button" class="st-row" data-go="crew"><span class="st-tx"><b>${en ? "Team roster" : "团队名册"}</b><small>${en ? `Moved to Team in the left rail: all ${n} roles, their status and cards, rename, avatar, transfer and retire.` : `已移到左栏「团队」：${n} 位队员的状态、手上的单子、改名、换头像、调岗、退休都在那里。`}</small></span><em class="st-go" aria-hidden="true">›</em></button></section>`;
  },
  mail() {
    const f = UI.mailFilter, mob = MOBQ.matches;
    let list = mailFiltered(300);
    const fs = [["all", t("all")], ["unread", t("unread")], ["reply", t("replies")], ["update", t("updates")], ["urgent", t("urgent")]];
    const segs = `<div class="seg" data-seg="mail">${fs.map(([k, n]) => `<button class="seg-i ${f === k ? "on" : ""}" data-mailf="${k}">${n}</button>`).join("")}</div>`;
    const head = mob   // t-mailbox-polish: phone = one row, filters + a small 全部已读 pill (masthead is hidden there)
      ? pageHead("mail") + `<div class="filters mb-row">${segs}<button class="btn-s mb-readall" data-mailall>${t("mark_all")}</button></div>`
      : pageHead("mail", `<div class="ph-bar"><button class="btn-s" data-mailall>${t("mark_all")}</button></div>`) + `<div class="filters">${segs}</div>`;
    if (mob) return head + (list.length ? `<div class="act-list">${ringOnce(() => mailGroups(list).map(mailRow).join(""))}</div>` : utEmpty(t("empty_mail"), "empty calm"));
    return head +
      /* r-improve-1121 P2: the desk page uses the drop-down's rows (name, kind tag, card name, two-line preview; one card + one person folded) */
      (list.length ? `<div class="mb-page">${ringOnce(() => { const ix = new Map(items().map(i => [i.id, i])); return mbGroups(list).map((g, i) => mbRow(g, i, ix)).join(""); })}</div>` : utEmpty(t("empty")));
  },
};
// ===== t-roster-rail: the 团队 / Team page (was 设置 · 角色). Same cards; a lead line counts the team; 改名 / 换头像 per card (rolelook.js) =====
function rosterPage() {
  const ls = ST.lessons || [], en = UI.lang === "en";
  window.RF && RF.ensure(() => { if (UI.page === "crew") renderPage(); });
  const all = agents(), on = all.filter(a => a.enabled !== false), busy = on.filter(a => a.status === "working" && a.id !== "manager").length;
  const lead = `<p class="rl-lead">${en ? `${on.length} on the team · ${busy} busy. Each card is one teammate: status, their cards, message, rename, avatar, transfer, retire.` : `${on.length} 位队员 · ${busy} 位在忙。每张卡是一位队员：状态、手上的单子、私信、改名、换头像、调岗、退休。`}</p>`;
  return pageHead("crew") + lead + `<div class="roster">${all.map(a => {

      const mine = items().filter(i => i.owner === a.id);
      const done = mine.filter(i => i.stage === "done"), first = done.filter(i => !i.rejects).length;
      const adopted = ls.filter(l => l.agent === a.id && l.status === "adopted").length;
      const pend = ls.filter(l => l.agent === a.id && l.status === "pending");
      const cur = liveItem(a);   // t-now-closed: a closed card is not "current"
      return `<div class="rc frame ${a.enabled === false ? "disabled" : ""}">${hasArt(a, "jpg") || !(ST.meta && ST.meta.art) ? `<img class="rc-art" src="/static/art/${esc(a.id)}.jpg?v=1" alt="" width="560" height="840" loading="lazy" decoding="async" onerror="this.remove()">` : ""}<div class="rc-h">${av(a, "lg")}<div><div class="nm">${esc(aname(a))}</div><div class="ti">${esc(atitle(a))} · <span class="mono">${esc(a.agent_name || "main session")}</span></div></div></div>
        <div class="du">${esc(aduty(a))}</div>
        <div class="now">${a.status === "working" ? `<span style="color:var(--accent)">▶ ${t("working")}</span> ${esc(a.activity || "")} ${cur ? `· <a data-item="${cur.id}" href="#">${esc(cur.title)}</a>` : ""}` : `<span class="dim">${t(a.status || "idle")} ${a.last_seen ? "· " + ago(a.last_seen) : ""}</span>`}</div>
        <div class="stats"><div><b>${done.length}</b><small>${t("closed")}</small></div><div><b>${done.length ? Math.round(first / done.length * 100) + "%" : "—"}</b><small>${t("first_pass")}</small></div><div><b>${adopted}</b><small>${t("adopted")}</small></div></div>
        ${rcLinks(a)}
        ${rcTasks(a, mine)}
        ${pend.length ? `<div class="dim" style="font-size:12px;margin-top:6px"><a href="#" data-ui12go="review">${UI.lang === "en" ? `${pend.length} rule proposal(s) → Review page` : `${pend.length} 条规则提议 → 在「审核」页处理`}</a></div>` : ""}
        <div class="rc-bt"><button class="btn-s" data-chat="${a.id}">${t("dm")}</button>${lookBtns(a)}</div>${window.HT ? HT.acts(a) : ""}</div>`;
    }).join("")}</div>`;
}
// ===== t-agent-memory v2: 记忆 / 灵魂 pills on the role card (viewer lives in rolefiles.js; read-only) =====
function rcLinks(a) {
  const c = window.RF && RF.counts, n = c && c !== "old" ? c[a.id] : null;
  const soul = window.RF ? RF.soulFiles(a.id, a.agent_name).length : 0;
  const at = `data-rf-id="${esc(a.id)}" data-rf-agent="${esc(a.agent_name || "")}" data-rf-name="${esc(aname(a))}"`;
  return `<div class="rc-links"><button class="rf-pill" data-rf-open="mem" ${at}>${UI.lang === "en" ? "Memory" : "记忆"}${n != null ? ` <b>${n}</b>` : ""}</button><button class="rf-pill" data-rf-open="soul" ${at}>${UI.lang === "en" ? "Soul" : "灵魂"} <b>${soul}</b></button>${window.VoicePanel ? `<button class="rf-pill" data-vp-open="${esc(a.id)}" data-vp-name="${esc(aname(a))}">${UI.lang === "en" ? "Voice" : "声音"}</button>` : ""}</div>`;
}
function rcTasks(a, mine) {
  const x = UI.rcx[a.id] || {}, zh = UI.lang !== "en";
  const by = s => mine.filter(i => grpOf(i) === s);
  const row = i => `<div class="rt-r" data-item="${esc(i.id)}" role="link" tabindex="0"><span class="rt-t">${esc(i.title)}</span><span class="tag rt-s rt-${grpOf(i)}">${rowLabel(i)}</span></div>`;
  const groups = ["doing", "review", "todo", "waiting"].map(s => [s, by(s)]).filter(g => g[1].length);
  const done = by("done").sort((p, q) => String(q.updated || q.created || "").localeCompare(String(p.updated || p.created || "")));
  const open = groups.map(([s, g]) => `<div class="rt-g"><b>${grpLabel(s)}</b> · ${g.length}</div>` + g.map(row).join("")).join("");
  const nrows = groups.reduce((n, g) => n + g[1].length + 1, 0);
  const doneBlock = done.length ? `<button class="rt-dn" data-rcdone="${esc(a.id)}" aria-expanded="${!!x.done}">${x.done ? "▾" : "▸"} ${stageLabel("done")} · ${done.length}</button>` + (x.done ? done.slice(0, 3).map(row).join("") : "") : "";
  /* t-roster-polish: the Done toggle and its rows sit after the clipped open list (and its 展开全部), never inside it. Inside, a card with a
     short open list plus three done rows overflowed the 168px box without earning 展开全部 (row count ≠ height), so the list was cut off. */
  const body = open || (doneBlock ? "" : `<div class="rt-e">${zh ? "没有单子" : "No items"}</div>`);
  const long = nrows > 6;
  return `<div class="rt ${x.all ? "all" : ""}"><div class="rt-b">${body}</div>${long ? `<button class="rt-more" data-rcall="${esc(a.id)}" aria-expanded="${!!x.all}">${x.all ? (zh ? "收起" : "Less") : (zh ? "展开全部" : "Show all")}</button>` : ""}${doneBlock}</div>`;
}
// ===== ui12 (t-common-rules): 「待确认的规则」block under the review queue. Source: ST.lessons status=pending, newest first.
// agent "common" = team-wide (tag 「全员」). Buttons reuse data-lesson -> api("lesson"). The roster page only shows a count link now (de-dup). =====
function rulesBlock() {
  const en = UI.lang === "en";
  const ls = (ST.lessons || []).filter(l => l.status === "pending").sort((x, y) => (y.t || "").localeCompare(x.t || ""));
  if (!ls.length) return "";
  const rows = ls.map(l => {
    const common = l.agent === "common";
    const it = l.item ? (ST.items || []).find(i => i.id === l.item) : null;
    const who = common ? `<span class="av lg rl-team" title="${en ? "Team-wide" : "全员"}">${en ? "ALL" : "全员"}</span>` : av(agent(l.agent), "lg");
    const nm = common ? (en ? "Everyone" : "全员") : aname(agent(l.agent));
    const link = it ? `<a href="#" class="rl-src" data-item="${esc(it.id)}">${esc(it.title)}</a>` : "";
    const dim = [it ? it.title : "", l.t ? l.t.slice(0, 10) : ""].filter(Boolean).join(" · ");
    return `<div class="rl-row ${common ? "common" : ""}">${who}<div class="rl-main"><div class="rl-top"><span class="rl-tag">${common ? (en ? "Team" : "全员") : (en ? "Rule" : "规则")}</span>${common ? `<span class="rl-tag">${en ? "Rule" : "规则"}</span>` : ""}<b class="rl-nm">${esc(nm)}</b>${link}</div>
      <div class="rl-tx">${esc(srvT(l.text))}</div><div class="rl-dim dim">${esc(dim)}</div></div>
      <div class="rl-bt"><button class="btn-s" data-lesson="${l.id}" data-d="adopt">${t("adopt")}</button><button class="btn-s" data-lesson="${l.id}" data-d="drop">${t("drop")}</button></div></div>`;
  }).join("");
  return `<div class="rl-block"><div class="grp-h"><b>${en ? "Rules awaiting your call" : "待确认的规则"}</b> · ${ls.length}</div>${rows}</div>`;
}

/* t-home-style-trim (11-11, user): the desktop 首页 is the widget home only (web/widgets.js + widgets.css); phones keep their own home */
const widgetHome = () => !MOBQ.matches && UI.page === "review";
const phaseFree = h => h.replace(/--wp:-?[\d.]+s|animation-delay:-\d+ms|--wg-fd:-\d+ms| tl-(?:in|out)/g, "").replace(/(<time class="(?:wk-el|rel)"[^>]*>)[^<]*/g, "$1");   // t-home-flicker
function renderPage(scrollTop) {
  document.documentElement.dataset.home = widgetHome() ? "widgets" : "classic"; delete document.documentElement.dataset.dense;   /* t-home-style-trim: "widgets" on the desktop 首页, "classic" everywhere else (phones, other pages); data-dense is cleared for pages that still carry it */
  autoFold();
  const page = $("#page");
  let body = $("#pagebody", page);
  if (!body) { page.innerHTML = `<div class="office" id="officebox"></div><div id="pagebody"></div>`; body = $("#pagebody", page); }
  const ob = $("#officebox", page);
  if (UI.page === "review" && !widgetHome()) {
    ob.hidden = false;
    if (window.HomeD) {   /* t-office-d1-s12: phones get the D1 / A2 strip (a desktop 首页 is always the widget home, t-home-style-trim) */
      HomeD.render(ob, { agents: agents(), counts: homeCounts() });
    } else { ob.hidden = true; ob.dataset.hv = ""; ob.innerHTML = ""; }
  } else { ob.hidden = true; ob.innerHTML = ""; }
  const html = (PAGES[UI.page] || (() => catPage(UI.page)))();
  if (html != null) {   // t-imp29-p4: a page may return null to keep its DOM (the asset library keeps scroll, focus and loaded thumbs across polls)
    // t-home-flicker (11-03): every state rev (any chat message) re-renders; on the phone / app-style home an unchanged page keeps its DOM, so the
    // spinners, breathing rings and sweeps don't restart. The compare ignores wall-clock phases and the elapsed labels the 20 s ticker keeps fresh.
    const hk = UI.page === "review" && !widgetHome() ? phaseFree(html) : "";
    if (!hk || hk !== body._hk || !body.firstElementChild) body.innerHTML = html;
    body._hk = hk;
  }
  if (scrollTop) page.scrollTop = 0;
  hooks.forEach(f => f("page"));
}

/* t-phone-docs: on a phone the opened text replaces the list, so bring the top of the docs block into view */
const docTop = () => { if (!matchMedia("(max-width: 760px)").matches) return; requestAnimationFrame(() => { const d = document.querySelector(".docs"); if (d) d.scrollIntoView({ block: "start" }); }); };

function wirePages() {
  // ===== ui20 (t-role-tasks): task list inside each roster card. Open work grouped doing > review > todo > waiting; done collapsed (latest 3). Rows reuse data-item -> openItem. =====
  UI.rcx = UI.rcx || {};
  document.addEventListener("click", e => {
    const d = e.target.closest("[data-rcdone]"), m = e.target.closest("[data-rcall]"); if (!d && !m) return;
    const id = (d || m).dataset.rcdone || (d || m).dataset.rcall; const x = UI.rcx[id] = UI.rcx[id] || {};
    if (d) x.done = !x.done; else x.all = !x.all; renderPage();
  });
  document.addEventListener("keydown", e => { const r = e.target.closest && e.target.closest(".rt-r"); if (r && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openItem(r.dataset.item); } });
  { const r0 = PAGES.review; PAGES.review = function () { if (widgetHome()) return r0.call(this); return (window.Onboard ? Onboard.phoneCard() : "") + ruCard() + r0.call(this) + rulesBlock(); };   /* t-onboarding P0: the 开工清单 card under the stat row */ }   /* t-home-usage: ruCard() is "" off phones */   // t-home-widgets: the widget home puts the rules inside #wg itself
}

function wirePages2() {
  MOBQ.addEventListener("change", () => { if (ST) renderHeader(); if (UI.page === "review" || UI.page === "mail") renderPage(); });   // t-stamina-stale: the stamina subtitle differs on phones
  window.addEventListener("beforeunload", () => { if (UI.page === "review") { UI.seen.review = new Date().toISOString(); LS.set("seen", UI.seen); } });
  document.addEventListener("click", e => {
    const s = e.target.closest("[data-sort]"); if (s) { UI.sort = s.dataset.sort; LS.set("sort", UI.sort); renderPage(); }
    const nr = e.target.closest("[data-nr]"); if (nr) { openItem(nr.dataset.nr); return; }   // t-home-newreplies
    if (e.target.closest("[data-nr-all]")) { nrRead(newReplies().flatMap(g => g.ms.map(m => m.id))); renderPage(); renderLeft(); }
    if (e.target.closest("[data-board-all]")) { UI.boardAll = true; renderPage(); }
    const df = e.target.closest("[data-donefold]"); if (df) { lsSet("rt.doneOpen." + df.dataset.donefold, !doneOpen(df.dataset.donefold)); renderPage(); }   // t-done-fold
    const lf = e.target.closest("[data-logf]"); if (lf) { UI.logAgent = lf.dataset.logf; renderPage(); }
    if (e.target.closest("[data-repreq]")) api("report_request").then(() => toast(t("report_asked")));
    const rp = e.target.closest("[data-rep]"); if (rp) { UI.openRep = UI.openRep === rp.dataset.rep ? "-" : rp.dataset.rep; renderPage(); }
    const dc = e.target.closest("[data-doc]"); if (dc) { const path = dc.dataset.doc; UI.doc = path; UI.docText = ""; renderPage(); docTop();   /* t-phone-docs: show 加载中 + jump to the text at once */
      fetch("/api/doc?path=" + encodeURIComponent(path)).then(r => r.json()).then(j => { if (UI.doc !== path) return; UI.docText = j.text || j.error; renderPage(); }); }
    if (e.target.closest("[data-doc-back]")) { const was = UI.doc; UI.docLast = was; UI.doc = null; UI.docText = ""; renderPage();   /* t-phone-docs: back to the list, the doc just read in view */
      requestAnimationFrame(() => { const b = was && [...document.querySelectorAll(".docs [data-doc]")].find(x => x.dataset.doc === was); if (b) b.scrollIntoView({ block: "center" }); }); }
    const ls = e.target.closest("[data-lesson]"); if (ls) api("lesson", { id: ls.dataset.lesson, decision: ls.dataset.d });
    const mf = e.target.closest("[data-mailf]"); if (mf) { UI.mailFilter = mf.dataset.mailf; renderPage(); renderMailbox(); }
    if (e.target.closest("[data-mailall]")) api("mail_read", { all: true });
    const ml = e.target.closest("[data-mail]");
    if (ml) {
      const m = mailAll().find(x => x.id === ml.dataset.mail); if (!m) return;
      api("mail_read", { ids: ml.dataset.mailids ? ml.dataset.mailids.split(",") : [m.id] });
      const rep = mailRep(m);   /* t-ri1114-a P1: a 日报 letter opens that report, not the manager DM */
      if (m.item) openItem(m.item); else if (rep) route(new URLSearchParams("rep=" + rep)); else if (m.agent) setChat(m.agent);
    }
  });
  // board drag & drop
  document.addEventListener("dragstart", e => { const d = e.target.closest("[data-drag]"); if (d) e.dataTransfer.setData("text/item", d.dataset.drag); });
  document.addEventListener("dragover", e => { const c = e.target.closest("[data-drop]"); if (c && e.dataTransfer.types.includes("text/item")) { e.preventDefault(); c.classList.add("over"); } });
  document.addEventListener("dragleave", e => { const c = e.target.closest("[data-drop]"); if (c) c.classList.remove("over"); });
  document.addEventListener("drop", e => {
    const c = e.target.closest("[data-drop]"); if (!c) return; const id = e.dataTransfer.getData("text/item"); if (!id) return;
    e.preventDefault(); c.classList.remove("over"); const to = c.dataset.drop;
    if (to === "done") return askGuard(id, "done", skip => api("set_stage", { item: id, stage: to, skip_asks: skip || undefined }));
    api("set_stage", { item: id, stage: to });
  });
}

export { PAGES, rcLinks, rcTasks, rulesBlock, widgetHome, phaseFree, renderPage, docTop, wirePages, wirePages2 };
