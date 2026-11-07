// Underthread dashboard. Polls /api/state, renders, posts your clicks to /api/action.
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const LS = {
    get(k, d) { try { const v = localStorage.getItem("rt." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("rt." + k, JSON.stringify(v)); } catch { } },
  };

  const UI = {
    page: (p => p === "home" ? "review" : ["roles", "docs", "logs"].includes(p) ? "settings" : p)(LS.get("page", "review")), setTab: (p => ["roles", "docs", "logs"].includes(p) ? p : LS.get("setTab", "general"))(LS.get("page", "review")),   /* t-settings-tab: 角色 / 文档 / 日志 live under 设置 */ item: null, chat: LS.get("chat", "manager"), home: LS.get("home3", "dense"),   // t-home-applike: desktop 首页 style, "app" | "classic"; t-home-widgets: + "widgets" (default since 11-02, new key so every desktop switches once)
    lang: LS.get("lang", "zh"), theme: LS.get("theme", "dark"), sort: LS.get("sort", "activity"),
    logAgent: "", mailFilter: "all", doc: null, docs: null, docText: "", openRep: null, calForm: false, tick: 0,
    seen: LS.get("seen", {}), chatW: LS.get("chatW", 420), chatFold: LS.get("chatFold", false),
  };
  let ST = null, REV = null;
  // t-draft-keep: unsent text in the card reply box ("item:<id>") and the DM box ("dm:<agent>"), one draft each, kept on this device only (rt.drafts).
  // Saved on every input; cleared when the text goes out (comment / reject / approve-with-note / chat send) or when the box is emptied.
  const DRAFT = {
    all() { const d = LS.get("drafts", {}); return d && typeof d === "object" ? d : {}; },
    get(k) { const d = DRAFT.all()[k]; return d && d.t ? d : null; },
    set(k, txt) { if (!k) return; const d = DRAFT.all(), had = !!d[k]; if (txt && txt.trim()) d[k] = { t: txt, at: new Date().toISOString() }; else if (had) delete d[k]; else return; LS.set("drafts", d); },
  };

  // ---------- i18n ----------
  const T = {
    zh: { quests: "委托", all_quests: "全部", search_ph: "搜索条目和对话",
      review: "首页", main: "主线",   // t-nav-home: display name only (the page key stays "review")
      side: "支线", daily: "日常委托", urgent: "紧急活动", ongoing: "常驻活动",
      pipe: "制作线", board: "委托板", logs: "日志", reports: "报告", channels: "频道", studio: "制作", docs: "文档", assets: "素材", roles: "角色", mail: "信箱",
      today: "今日日程", meetings: "个", team: "TEAM", stamina: "体力", updated: "更新于",
      todo: "待办", doing: "进行中", review_s: "待你审核", waiting: "等别人", done: "完成",
      plan: "待拍板", deliverable: "待验收", question: "待回答", task: "任务",
      approve: "批准", reject: "驳回", complete: "完成", reopen: "重开", archive: "归档",
      owner: "负责", category: "分类", stage: "阶段", platforms: "平台", due: "截止",
      draft: "草稿", confidence: "把握度", evidence: "证据", links: "链接", attachments: "附件", thread: "动态", older: "较早版本",
      copy: "复制", copied: "已复制", send_hint: "⌘/Ctrl+Enter 发送，Enter 换行",
      composer_ph: "输入 @ 选择发给谁（默认发给负责人）；驳回时写原因。图片和文件可以直接粘贴或拖进来。",
      chat_ph: "对{n}说……  ⌘/Ctrl+Enter 发送，Enter 换行",
      file: "文件", default_owner: "默认：负责人",
      send_to: "发给", jump_top: "顶部", jump_new: "最新", expand: "展开全文", collapse: "收起", owner_tag: "负责人",
      k_plan: "方案", k_deliverable: "交付", k_question: "提问", k_task: "草稿",
      online: "在线", offline: "离线", working: "执行中", idle: "待机",
      by_activity: "按最新动态", by_created: "最新创建", pending: "待审核",
      empty_review: "没有等你审核的东西。去喝杯水。", empty_ok: "没有等你拍板的 · 去喝杯水", empty: "这里是空的。", empty_mail: "没有新动态", mail_thread: "{n} 条", unread_only: "未读",
      wake: "唤醒管家", refresh_usage: "刷新用量", settings: "设置", write_report: "日报", report_req: "让管家写日报", theme: "主题",
      cancel: "取消",
      reject_t: "驳回", reject_reason: "原因（会被整理成规则提议）",
      lessons: "规则提议", adopt: "采纳", drop: "丢弃", dm: "私信",
      closed: "已完成", first_pass: "一次通过", adopted: "已采纳规则",
      all: "全部", unread: "未读", replies: "回复", updates: "更新", mark_all: "全部已读",
      week_done: "本周交付", in_review: "待审核", in_progress: "进行中", pending_rules: "待采纳规则",
      days7: "7 天前", now: "现在", add: "添加",
      mgr_offline: "管家离线：有 {n} 条指令还没处理。启动 manager session。",
      sleeping: "休眠", sleep_at: "休眠 · {t} 复活", waking: "复活中",
      mgr_sleep: "管家休眠中，{t} 复活。{n} 条指令已排队，醒来自动处理。",
      mgr_waking: "用量已重置，正在唤醒管家；几分钟内没回应就到管家的 session 里说一句话。",
      waiting_long: "「{t}」已经等你审核超过 24 小时",
      no_owner_urgent: "紧急：「{t}」还没有人接",
      next: "NEXT", sync: "SYNC", inbox: "INBOX", comfy_on: "5090 在线", comfy_off: "5090 未连",
      no_next: "没有日程", tomorrow: "明天", today_w: "今天", yesterday: "昨天",
      ago_m: "{n} 分钟前", ago_h: "{n} 小时前", just: "刚刚",
      unacked: "待处理", reports_empty: "还没有日报。每天 {t} 管家会自动写一份。",
      docs_pick: "选一个文档", ch_none: "未标平台",
    },
    en: { quests: "Quests", all_quests: "All", search_ph: "Search items and chats",
      review: "Home", main: "Main quest", side: "Side quest", daily: "Daily", urgent: "Urgent", ongoing: "Ongoing",
      pipe: "Pipeline", board: "Board", logs: "Log", reports: "Reports", channels: "Channels", studio: "Studio", docs: "Docs", assets: "Assets", roles: "Roster", mail: "Mailbox",
      today: "Today", meetings: "", team: "TEAM", stamina: "Stamina", updated: "updated",
      todo: "To do", doing: "In progress", review_s: "Your review", waiting: "Waiting", done: "Done",
      plan: "Decide", deliverable: "Accept", question: "Answer", task: "Task",
      approve: "Approve", reject: "Reject", complete: "Done", reopen: "Reopen", archive: "Archive",
      owner: "Owner", category: "Category", stage: "Stage", platforms: "Platforms", due: "Due",
      draft: "Draft", confidence: "Confidence", evidence: "Evidence", links: "Links", attachments: "Files", thread: "Thread", older: "Older drafts",
      copy: "Copy", copied: "Copied", send_hint: "⌘/Ctrl+Enter to send",
      composer_ph: "Type @ to pick who gets it (default: owner). Give a reason when rejecting. Paste or drop images and files.",
      chat_ph: "Message {n}…  ⌘/Ctrl+Enter to send",
      file: "File", default_owner: "default: owner",
      send_to: "To", jump_top: "Top", jump_new: "Latest", expand: "Show all", collapse: "Collapse", owner_tag: "owner",
      k_plan: "Plan", k_deliverable: "Deliverable", k_question: "Question", k_task: "Draft",
      online: "online", offline: "offline", working: "working", idle: "idle",
      by_activity: "Latest activity", by_created: "Newest", pending: "Pending",
      empty_review: "Nothing waiting on you.", empty_ok: "Nothing waiting on you", empty: "Nothing here.", empty_mail: "Nothing new", mail_thread: "{n}", unread_only: "Unread",
      wake: "Ping manager", refresh_usage: "Refresh usage", settings: "Settings", write_report: "Report", report_req: "Ask for a report", theme: "Theme",
      cancel: "Cancel",
      reject_t: "Reject", reject_reason: "Reason (becomes a rule proposal)",
      lessons: "Rule proposals", adopt: "Adopt", drop: "Drop", dm: "DM",
      closed: "closed", first_pass: "first-pass", adopted: "rules adopted",
      all: "All", unread: "Unread", replies: "Replies", updates: "Updates", mark_all: "Mark all read",
      week_done: "Shipped this week", in_review: "In review", in_progress: "In progress", pending_rules: "Pending rules",
      days7: "7d ago", now: "now", add: "Add",
      mgr_offline: "Manager offline: {n} instructions waiting. Start the manager session.",
      sleeping: "asleep", sleep_at: "asleep · back {t}", waking: "waking",
      mgr_sleep: "Manager asleep until {t}. {n} instructions queued; handled on wake.",
      mgr_waking: "Usage has reset; waking the manager. No reply in a few minutes? Send any message in its session.",
      waiting_long: "\"{t}\" has waited on your review for 24h+",
      no_owner_urgent: "Urgent: \"{t}\" has no owner yet",
      next: "NEXT", sync: "SYNC", inbox: "INBOX", comfy_on: "5090 online", comfy_off: "5090 not linked",
      no_next: "no events", tomorrow: "Tomorrow", today_w: "Today", yesterday: "Yesterday",
      ago_m: "{n}m ago", ago_h: "{n}h ago", just: "just now",
      unacked: "pending", reports_empty: "No reports yet. The manager writes one daily at {t}.",
      docs_pick: "Pick a doc", ch_none: "No platform",
    },
  };
  const t = (k, vars) => { let s = (T[UI.lang] && T[UI.lang][k]) ?? T.zh[k] ?? k; for (const [a, b] of Object.entries(vars || {})) s = s.replace("{" + a + "}", b); return s; };
  const EN_SUB = { settings: "SETTINGS", review: "HOME", main: "MAIN QUEST", side: "SIDE QUEST", daily: "DAILY COMMISSIONS", urgent: "URGENT EVENTS",
    ongoing: "ONGOING EVENTS", studio: "STUDIO", pipe: "PRODUCTION LINE", board: "COMMISSION BOARD", logs: "JOURNAL", reports: "REPORTS", channels: "CHANNELS", docs: "ARCHIVE", assets: "ASSET LIBRARY", roles: "ROSTER", mail: "MAILBOX" };
  const CATS = ["main", "side", "daily", "urgent", "ongoing"];
  const STAGES = ["todo", "doing", "review", "waiting", "done"];
  const PLAT_ZH = { bili: "B站", yt: "YouTube", xhs: "小红书" }, PLAT_EN = { bili: "Bilibili", yt: "YouTube", xhs: "RedNote" };
  const PLAT = new Proxy({}, {  // platform names follow the UI language
    get: (_, k) => (UI.lang === "en" ? PLAT_EN : PLAT_ZH)[k],
    ownKeys: () => Object.keys(PLAT_ZH), getOwnPropertyDescriptor: (_, k) => ({ enumerable: true, configurable: true, value: (UI.lang === "en" ? PLAT_EN : PLAT_ZH)[k] }),
  });
  const stageLabel = s => t(s === "review" ? "review_s" : s);
  // t-web-audit-2 03: a waiting plan/question is on the user, same as the home page (awaitsUser). Lists group it with review and call that group 「等你拍板」.
  // q-1030-29a9: lists show a "doing" card under 进行中 only while an agent is actually working on it; a doing card with nobody on it
  // (standing / ongoing work between runs) is shown under 待办. Display only: the stored stage stays "doing" (the detail's stage pill shows it).
  const idleDoing = i => i.stage === "doing" && !workersOf(i.id).length;
  // t-doing-first: a card someone is working on right now is 进行中 everywhere, even if its stored stage is review / waiting (e.g. the
  // specialist is answering your comment). It leaves 等你拍板 (lists, counts, red dots) until the run ends, then comes back on its own.
  const busy = i => !!i && i.stage !== "done" && workersOf(i.id).length > 0;
  // t-home-newreplies: a card nobody is working on that still has an unanswered ask is on you too, whatever its stage (a comment flips review → doing;
  // the specialist answers + asks again but may not put it back to review). onYouCard = the cards listed as review cards; awaitsUser ones are the decisions list.
  // ri1103-P2: 稍后. it.snooze = {until, wait:"reply"|null, at} from the server; while active the card leaves 等你拍板 everywhere (lists, counts,
  // red dots, the app badge). The server's snooze_loop clears it within ~20 s of the time / the reply; this mirror hides that gap.
  const snzReplied = i => { const at = Date.parse(i.snooze.at) || 0; return (i.thread || []).some(e => e.who !== "me" && e.kind !== "event" && (Date.parse(e.t) || 0) > at) || (Date.parse(i.draft_at) || 0) > at; };
  // 「等回复」 ends after 3 days with no reply too (server sets until = at + 3 d; a snooze made before that change has no until, so count from at)
  const snzEnd = i => i.snooze.until ? Date.parse(i.snooze.until) : i.snooze.wait === "reply" ? (Date.parse(i.snooze.at) || 0) + 3 * 864e5 : Infinity;
  const snoozed = i => !!i && !!i.snooze && i.stage !== "done" && snzEnd(i) > Date.now() && !(i.snooze.wait === "reply" && snzReplied(i));
  const onYouCard = i => !!i && i.stage !== "done" && !busy(i) && !snoozed(i) && (i.stage === "review" || (!awaitsUser(i) && openAsks(i).length > 0));
  const onYou = i => onYouCard(i) || (!!i && awaitsUser(i) && !busy(i) && !snoozed(i));
  // t-agent-queue: a role's queue = its open cards that are to do, or in progress but not the card it is on now. Routine cards (r-…) never count.
  // Badge 「排队 N」 (hidden at 0) in the TEAM list, the chat roster, the DM header and the 此刻在忙 widget; a click lists the cards (App.queueOf / qBadge).
  const queueOf = id => { const a = (ST && ST.agents && ST.agents[id]) || {}; return items().filter(i => i.owner === id && !i.archived && !/^r-/.test(i.id) && (i.stage === "todo" || (i.stage === "doing" && i.id !== a.item)))
    .sort((x, y) => (Date.parse(x.updated || x.created) || 0) - (Date.parse(y.updated || y.created) || 0)); };
  const qBadge = (id, small) => { const n = queueOf(id).length; return !n ? "" : small ? `<i class="aq-n" data-aq="${esc(id)}" title="${UI.lang === "en" ? `${n} queued` : `排队 ${n}`}">${n}</i>` : `<span class="aq" data-aq="${esc(id)}">${UI.lang === "en" ? `Queued ${n}` : `排队 ${n}`}</span>`; };
  const grpOf = i => busy(i) ? "doing" : snoozed(i) ? "todo" : (awaitsUser(i) || onYouCard(i)) ? "review" : idleDoing(i) ? "todo" : i.stage;   // ri1103-P2: a snoozed card waits under 待办
  // t-idle-pause-tag: such a card says 「暂停」 where a row shows its stage, so it stands apart from a real 待办
  const pauseL = () => UI.lang === "en" ? "Paused" : "暂停";
  // t-routine-btn: a routine's main card says 「暂停」 only when the routine is really paused; running, idle between runs, it says 每天 HH:MM
  const rtTag = i => { const r = i && i.stage !== "done" && !busy(i) && routineOf(i); return !r ? null : r.paused ? pauseL() : r.time ? (UI.lang === "en" ? `Daily ${r.time}` : `每天 ${r.time}`) : null; };
  const rowLabel = i => rtTag(i) || (snoozed(i) ? (UI.lang === "en" ? "Later · " : "稍后 · ") + snzText(i) : idleDoing(i) ? pauseL() : grpLabel(grpOf(i)));
  const grpLabel = s => s === "review" ? (UI.lang === "en" ? "On you" : "等你拍板") : stageLabel(s);

  // ---------- helpers ----------
  const D = iso => iso ? new Date(iso) : null;
  const pad = n => String(n).padStart(2, "0");
  const hm = iso => { const d = D(iso); return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : ""; };
  const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  function when(iso) {
    const d = D(iso); if (!d) return "";
    const today = new Date(); const y = new Date(Date.now() - 864e5);
    if (dayKey(d) === dayKey(today)) return `${t("today_w")} ${hm(iso)}`;
    if (dayKey(d) === dayKey(y)) return `${t("yesterday")} ${hm(iso)}`;
    return `${d.getMonth() + 1}/${d.getDate()} ${hm(iso)}`;
  }
  // t-now-ago: relative/day labels in HTML carry data-rel + data-t; the 20 s wk-el interval re-derives them (only writes when the text changes)
  const relH = (k, iso, txt) => iso ? `<time class="rel" data-rel="${k}" data-t="${esc(iso)}">${txt}</time>` : "";
  const agoH = iso => relH("ago", iso, ago(iso)), whenH = iso => relH("when", iso, when(iso));
  function ago(iso) {
    const d = D(iso); if (!d) return "";
    const m = Math.round((Date.now() - d) / 6e4);
    if (m < 1) return t("just"); if (m < 60) return t("ago_m", { n: m }); if (m < 48 * 60) return t("ago_h", { n: Math.round(m / 60) });
    return when(iso);
  }
  const agents = () => Object.values(ST.agents || {}).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  // q-1030-2214: a thread/log "who" that is not a roster id but a role's own name (e.g. its name_en, "steward" for manager) resolves to that role,
  // so the row gets its real avatar and name instead of the pixel fallback.
  const agentAlias = id => { const k = String(id || "").trim().toLowerCase(); return k ? Object.values(ST.agents || {}).find(a => [a.name_en, a.name].some(n => n && String(n).trim().toLowerCase() === k)) : null; };
  const agent = id => (ST.agents || {})[id] || agentAlias(id) || { id, name: id, color: "#888" };
  const aname = a => (UI.lang === "en" ? a.name_en : a.name) || a.name || a.id;
  const atitle = a => (UI.lang === "en" ? a.title_en : a.title) || a.title || "";
  const aduty = a => (UI.lang === "en" ? a.duty_en : a.duty) || a.duty || "";
  function avatarUrl(a) {
    const f = ST.meta.avatars && ST.meta.avatars[a.id];
    return f ? `/avatars/${encodeURIComponent(f)}` : Office.avatar(a);
  }
  // t-m2-a ⓪ (L-1029-a669): while RING1 is a Set, a working agent keeps its ring on ONE avatar only (the first av() call for it); later ones are drawn idle.
  // A list that calls av() per row renders inside ringOnce(), newest row first, so the ring lands on the newest row (DM threads do the same by index).
  let RING1 = null;
  function ringOnce(fn, set) { const prev = RING1; RING1 = set || new Set(); try { return fn(); } finally { RING1 = prev; } }
  function av(a, cls = "", forItem) {
    if (a === "me" || a.id === "me") return `<span class="av ${cls}" style="background:var(--ink2)"></span>`;
    // t-working-avatar: ONE place for the "working" look (CSS in style.css). --wp = minus the wall-clock phase of the 4 s cycle, so a node created by a re-render
    // starts exactly where the one it replaces was: polling never restarts the ring. Static (no animation) under prefers-reduced-motion.
    // t-working-item-highlight: inside a row about item X (forItem), the ring stays off when we KNOW the agent is on another item (agents[].item set and different).
    let w = a.status === "working" && !(forItem && a.item && a.item !== forItem);
    if (w && RING1) { if (RING1.has(a.id)) w = false; else RING1.add(a.id); }
    const tb = toolBadge(a);
    return `<span class="av ${cls} ${w ? "working" : ""}" style="background-image:url('${avatarUrl(a)}')${w ? `;--wp:${(-(Date.now() % 4000) / 1000).toFixed(3)}s` : ""}" title="${esc(aname(a))}"${w ? ` data-working="1"` : ""}>${w && !tb ? `<i class="aw" title="${t("working")}"></i>` : ""}${tb}</span>`;
  }
  /* ===== t-chrome-badge: agents[id].tool = the outside tool an agent is driving right now (stateutil set-agent --tool chrome; "" or idle/offline clears it).
     One badge on every avatar (toolBadge, called by av) + one line 「Chrome 使用中 · 谁 · 在做什么」 (toolLine: desktop header #toolbar, phone home .hd-tool).
     Enter/exit motion plays once: TOOL_T keeps when each agent's tool last changed (client clock); only inside that window does the markup carry tl-in / tl-out
     plus a negative animation-delay, so a poll re-render continues the motion instead of replaying it. First sight after page load = no motion.
     No infinite animation here (fx.js would mark one with data-ip anyway), no blinking dot; prefers-reduced-motion turns the motion off in CSS. ===== */
  const TOOL_IC = {
    chrome: `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><ellipse cx="8" cy="8" rx="2.6" ry="6.2"/><path d="M1.8 8h12.4"/></svg>`,
    computer: `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.8" y="2.5" width="12.4" height="8.6" rx="1.6"/><path d="M5.5 13.8h5M8 11.1v2.7"/></svg>`,
    _: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.4 2.2a3.4 3.4 0 0 0-3.9 4.5L2.2 11a1.3 1.3 0 0 0 1.8 1.8l4.3-4.3a3.4 3.4 0 0 0 4.5-3.9l-2 2-1.7-.5-.5-1.7z"/></svg>`
  };
  const toolName = k => k === "chrome" ? "Chrome" : k === "computer" ? (UI.lang === "en" ? "Computer" : "电脑") : String(k);
  const toolIc = k => TOOL_IC[k] || TOOL_IC._;
  const TOOL_IN = 400, TOOL_OUT = 220, TOOL_STALE = 60 * 60e3, TOOL_T = {};
  function toolFx(a) {   /* -> { k: tool now ("" = none), was: tool just cleared, ph: "in" | "out" | "", ms: elapsed } */
    const k = (a && a.tool) || "", r = TOOL_T[a.id], now = Date.now();
    if (!r) TOOL_T[a.id] = { k, was: "", t: 0 };
    else if (r.k !== k) { TOOL_T[a.id] = { k, was: r.k, t: now }; }
    const x = TOOL_T[a.id], ms = now - x.t;
    return { k, was: x.was, ms, ph: k && ms < TOOL_IN ? "in" : !k && x.was && ms < TOOL_OUT ? "out" : "" };
  }
  const fxStyle = f => f.ph ? ` style="animation-delay:-${Math.round(f.ms)}ms"` : "";
  function toolBadge(a) {
    if (!a || !a.id || a.id === "me") return "";
    const f = toolFx(a), k = f.k || (f.ph === "out" ? f.was : "");
    if (!k) return "";
    return `<i class="tl${f.ph ? " tl-" + f.ph : ""}"${fxStyle(f)} title="${esc(toolName(k))} ${UI.lang === "en" ? "in use" : "使用中"}">${toolIc(k)}</i>`;
  }
  const toolWhat = a => String(a.activity || "").replace(new RegExp("^\\s*" + toolName(a.tool || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*[·:：-]\\s*", "i"), "");
  let TOOL_LAST = "";
  function toolLine(where) {   /* where: "d" = desktop header, "m" = phone home */
    const en = UI.lang === "en", list = agents().filter(a => a.enabled !== false);
    const fx = list.map(a => [a, toolFx(a)]), on = fx.filter(([, f]) => f.k);
    if (!on.length) {
      const out = fx.find(([, f]) => f.ph === "out");
      return out && TOOL_LAST ? TOOL_LAST.replace('class="tool-pill', `style="animation-delay:-${Math.round(out[1].ms)}ms" class="tool-pill tp-out`) : (TOOL_LAST = "", "");
    }
    const byK = {}; on.forEach(([a, f]) => (byK[f.k] = byK[f.k] || []).push([a, f]));
    const html = Object.keys(byK).map(k => {
      const g = byK[k], [a, f] = g[0], nm = toolName(k), ent = g.find(([, x]) => x.ph === "in");
      const cls = "tool-pill" + (ent ? " tp-in" : "") + (g.length > 1 ? " warn" : ""), dl = ent ? ` style="animation-delay:-${Math.round(ent[1].ms)}ms"` : "";
      if (g.length > 1) return `<div class="${cls}"${dl} role="status"><span class="ic">${toolIc(k)}</span><b>${esc(nm)} ${en ? "conflict" : "冲突"}</b><i class="d">·</i><span class="what">${g.map(([x]) => esc(aname(x))).join(en ? ", " : "、")} ${en ? "are all using it" : "同时在用"}</span></div>`;
      const it = liveItem(a), since = a.tool_since, old = since && Date.now() - Date.parse(since) > TOOL_STALE, what = toolWhat(a);
      return `<div class="${cls}${old ? " stale" : ""}"${dl} role="button" tabindex="0" ${it ? `data-item="${esc(it.id)}"` : `data-chat="${esc(a.id)}"`} title="${esc(nm)} ${en ? "in use" : "使用中"} · ${esc(aname(a))}${what ? " · " + esc(what) : ""}">`
        + `<span class="ic">${toolIc(k)}</span><b>${esc(nm)} ${en ? "in use" : "使用中"}</b><i class="d">·</i>`
        + `<span class="who"><i style="background-image:url('${avatarUrl(a)}')"></i>${esc(aname(a))}</span>`
        + (what ? `<i class="d">·</i><span class="what">${esc(what)}</span>` : `<span class="what"></span>`)
        + (since ? `<time class="wk-el" data-since="${esc(since)}">${wkDur(since)}</time>${old ? `<em>${en ? "maybe left on" : "可能忘了清"}</em>` : ""}` : "") + `</div>`;
    }).join("");
    TOOL_LAST = html.replace(/ tp-in| style="animation-delay:-\d+ms"/g, "");
    return html;
  }
  let toolHTML = null;
  function renderTool() { const el = $("#toolbar"); if (!el || !ST) return; const h = toolLine("d"); if (h !== toolHTML) { toolHTML = h; el.innerHTML = h; } }
  // ===== t-m2-a ②: number roll. Runs only when the value really changes: the last value shown is kept in memory per key (NV), not read back from the DOM,
  // so a poll or a rebuilt node with the same value does nothing. Each changed digit gets a one-glyph window: the old one slides out, the new one slides in
  // (up when the number grows, down when it shrinks), transform + opacity only, WAAPI ~420 ms; the spans are replaced by plain text when it ends.
  // First paint, non-integers, a hidden page and prefers-reduced-motion just swap the text.
  const NV = {}, RMQ = matchMedia("(prefers-reduced-motion: reduce)");
  function roll(el, to, key) {
    if (!el) return; to = String(to);
    const from = key ? NV[key] : el.dataset.nv; if (key) NV[key] = to; el.dataset.nv = to;
    const isN = x => /^\d{1,6}$/.test(x);
    if (from === to) { if (!el._nr && el.textContent !== to) el.textContent = to; return; }
    if (el._nr) { const a = el._nr; el._nr = null; a.forEach(x => x.cancel()); }
    if (from == null || !isN(from) || !isN(to) || RMQ.matches || document.hidden || !el.isConnected) { el.textContent = to; return; }
    const n = Math.max(from.length, to.length), A = from.padStart(n, " "), B = to.padStart(n, " "), up = +to > +from;
    el.innerHTML = [...B].map((c, i) => c === A[i] ? c : `<span class="nr"><span class="nr-o">${A[i].trim()}</span><span class="nr-n">${c.trim()}</span></span>`).join("");
    const o = { duration: 420, easing: "cubic-bezier(.2,.8,.2,1)", fill: "both" }, d = up ? 100 : -100, run = [];
    el.querySelectorAll(".nr").forEach(c => {
      run.push(c.firstChild.animate([{ transform: "translateY(0)", opacity: 1 }, { transform: `translateY(${-d}%)`, opacity: 0 }], o));
      run.push(c.lastChild.animate([{ transform: `translateY(${d}%)`, opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], o));
    });
    el._nr = run;
    Promise.all(run.map(x => x.finished)).then(() => { if (el._nr === run) { el._nr = null; el.textContent = to; } }, () => {});
  }
  // ===== t-working-item-highlight: an item is "being worked on" only when state.agents[x].status === "working" AND agents[x].item === its id.
  // Never guessed from owner / stage: no agents[].item, no highlight. Same --wp wall-clock phase as App.av, so poll re-renders never restart the motion.
  // t-now-closed: dashboard-side safety net. A card that is already closed (stage done) never shows as being worked on, whoever still holds it;
  // the manager with no live card is "online · watching the inbox": no timer, no progress bar, not counted as working.
  const liveItem = a => { const it = a && a.item && (ST.items || []).find(i => i.id === a.item); return it && it.stage !== "done" ? it : null; };
  const mgrOnline = a => !!a && a.id === "manager" && a.status === "working" && !liveItem(a);
  // t-typing-fix: the typing dots (desktop renderChat + mobile.js syncTyping). Only while the agent really works on a card (not the manager's
  // online-only heartbeat) and you spoke last, and never more than 10 min after your last message (the minute sweep below drops a stale bubble).
  const TYPING_MAX = 10 * 60e3, lastT = m => Date.parse(m && m.t) || 0;
  const typingOn = (a, last) => !!a && a.status === "working" && !mgrOnline(a) && !!last && last.who === "me" && (!lastT(last) || Date.now() - lastT(last) < TYPING_MAX);
  const typingUntil = last => lastT(last) ? lastT(last) + TYPING_MAX : "";
  const MGR_ON = () => UI.lang === "en" ? "Online · watching the inbox" : "在线 · 看着信箱";
  const MGR_WATCH = () => UI.lang === "en" ? "Watching the inbox" : "看着信箱";   /* t-hdr-trim ②1: the desktop rail already says 在线 after the name */
  const workersOf = id => id ? Object.values(ST.agents || {}).filter(a => a.status === "working" && a.item === id && liveItem(a)).sort((a, b) => (a.order ?? 99) - (b.order ?? 99)) : [];
  const wkP = () => `--wp:${(-(Date.now() % 4000) / 1000).toFixed(3)}s`;
  function wkDur(iso) {
    const m = Math.max(0, Math.floor((Date.now() - new Date(iso)) / 6e4)), en = UI.lang === "en";
    if (m < 60) return en ? `${Math.max(1, m)}m` : `${Math.max(1, m)} 分钟`;
    const h = Math.floor(m / 60), r = String(m % 60).padStart(2, "0");
    return en ? `${h}h ${r}m` : `${h} 时 ${r} 分`;
  }
  function wkTag(ws, cls = "") {   // [ringed avatars] 「名字 处理中 · 12 分钟」 (elapsed only when `since` exists)
    if (!ws.length) return "";
    const since = ws.map(a => a.since).filter(Boolean).sort()[0], nm = ws.map(a => aname(a)).join(UI.lang === "en" ? ", " : "、");
    return `<span class="wk-tag ${cls}" style="${wkP()}"><span class="wk-avs">${ringOnce(() => ws.map(a => av(a, "sm")).join(""))}</span><span class="wk-tx"><b>${esc(nm)}</b> ${UI.lang === "en" ? "on it" : "处理中"}${since ? ` · <time class="wk-el" data-since="${esc(since)}">${wkDur(since)}</time>` : ""}</span></span>`;
  }
  const wkFx = ws => ws.length ? `<i class="wk-fx" aria-hidden="true"><i class="wk-bg"></i></i>` : "";   /* t-edge-glow-off (11-04): the 2px left rail with the flowing highlight (.wk-bar) is gone; the breathing tint and the 处理中 tag stay */
  const wkAttr = ws => ws.length ? ` style="${wkP()}"` : "";
  function dcDur(iso) {   // 此刻 card format: 「12 分钟」/「1 小时 5 分」 (t-now-elapsed: was computed once per render, so it froze between state revs)
    const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 6e4)), zh = UI.lang !== "en";
    return m < 60 ? m + (zh ? " 分钟" : " min") : Math.floor(m / 60) + (zh ? " 小时 " : " h ") + (m % 60) + (zh ? " 分" : " min");
  }
  setInterval(() => { document.querySelectorAll(".wk-el[data-since]").forEach(el => { const v = el.dataset.fmt === "dc" ? dcDur(el.dataset.since) : wkDur(el.dataset.since); if (el.textContent !== v) el.textContent = v; });
    document.querySelectorAll("time.rel[data-t]").forEach(el => { const v = el.dataset.rel === "ago" ? ago(el.dataset.t) : when(el.dataset.t); if (el.textContent !== v) el.textContent = v; });
  }, 20000);   // elapsed ticks between polls (render only runs on a new rev)
  const whoName = w => w === "me" ? (ST.meta.owner && !ST.meta.owner.startsWith("<") ? ST.meta.owner : (UI.lang === "en" ? "You" : "我")) : aname(agent(w));
  const items = () => (ST.items || []).filter(i => !i.archived);
  const byAct = (a, b) => (b.activity || b.updated || "").localeCompare(a.activity || a.updated || "");
  const byCreated = (a, b) => (b.created || "").localeCompare(a.created || "");
  // Ornaments live in fx.js; pathLength=1 lets CSS draw them in.
  function orn(w = 200) { return window.ORN.divider(w); }
  function toast(msg, err) {
    const el = $("#toast"); el.textContent = msg; el.className = err ? "err" : ""; el.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => el.hidden = true, 2600);
  }
  async function postAct(kind, body = {}) {   // t-perf C: the bare POST (no toast, no poll); api() and the optimistic chat send share it
    const r = await fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, ...body }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  }
  async function api(kind, body = {}) {
    try {
      const j = await postAct(kind, body);
      await poll(true);
      return j;
    } catch (e) { toast(String(e.message || e), true); throw e; }
  }
  // Raw bytes straight to disk (no base64), with real progress: big footage from the phone works.
  function upload(file, onProgress) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open("POST", "/api/upload/raw?name=" + encodeURIComponent(file.name || "paste.png"));
      x.setRequestHeader("Content-Type", "application/octet-stream");
      x.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      x.onload = () => {
        let j = {}; try { j = JSON.parse(x.responseText); } catch { }
        if (x.status === 200 && j.path) resolve(j.path); else { toast(j.error || `upload failed (${x.status})`, true); reject(new Error(j.error)); }
      };
      x.onerror = () => { toast(UI.lang === "en" ? "Upload failed: connection lost" : "上传失败：连接中断", true); reject(new Error("network")); };
      x.send(file);
    });
  }
  const fmtSize = b => b > 1 << 30 ? (b / (1 << 30)).toFixed(1) + " GB" : b > 1 << 20 ? Math.round(b / (1 << 20)) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
  // Chips for a composer's attachments: finished files, plus anything still uploading with its percentage.
  function attChips(pending) {
    const done = pending.map(p => `<span class="att-chip">📎 ${esc(p.split("/").pop().replace(/^\d{8}-\d{6}-[0-9a-f]{4}-/, ""))}</span>`);
    const up = Object.values(pending._up || {}).map(u => `<span class="att-chip up" style="--p:${Math.round(u.p * 100)}%">⇡ ${esc(u.name)} <b>${Math.round(u.p * 100)}%</b> <small>${u.size}</small></span>`);
    return done.concat(up).join("");
  }
  const stillUploading = pending => Object.keys(pending._up || {}).length > 0;
  // Attachments on messages and timeline entries: images inline, footage playable, everything else a link.
  // ===== t-voice-memo: voice memos render as a play bar. One shared Audio for the whole page, so a re-render
  // (a new chat message rebuilds the box) never cuts playback: bars are re-bound to it by path (data-vm).
  const AUD_RE = /\.(m4a|mp3|wav|aac|ogg|opus)$/i;
  const media = p => ((ST && ST.media) || {})[p] || null;
  const isAudioAtt = p => AUD_RE.test(p) || (/\.webm$/i.test(p) && (media(p) || {}).kind === "audio");
  const VM = { a: null, cur: null, rate: 1, dur: {}, err: {}, open: new Set(), probe: new Set(), raf: 0, seek: null };
  const vmFmt = s => isFinite(s) && s > 0 ? fmtDur(s) : "--:--";
  const VM_PLAY = `<svg class="i-play" viewBox="0 0 12 14" aria-hidden="true"><path d="M0 0L12 7L0 14Z"/></svg><svg class="i-pause" viewBox="0 0 12 14" aria-hidden="true"><path d="M1 0h3.5v14H1zM7.5 0H11v14H7.5z"/></svg>`;
  const vmBars = (pk, n = 48) => (pk && pk.length ? pk : Array(n).fill(0.3)).map(v => `<i style="--h:${v}"></i>`).join("");
  const vmDur = p => (media(p) || {}).dur || VM.dur[p] || 0;
  const vmSig = p => { const m = media(p) || {}, tx = m.tx || {}; return [m.peaks ? 1 : 0, m.dur || "", tx.status || "", (tx.text || "").length, tx.lang || "", ST && ST.meta && ST.meta.media_v ? 1 : 0, UI.lang].join("|"); };
  function vmTime(p) {
    const zh = UI.lang !== "en", a = VM.a, d = vmDur(p);
    if (VM.err[p]) return VM.err[p] === "codec" ? (zh ? "此设备不能播放" : "Can't play here") : (zh ? "暂时打不开" : "Can't load");
    return VM.cur === p && a && (a.currentTime > 0 || !a.paused) ? vmFmt(a.currentTime) + " / " + vmFmt(d) : vmFmt(d);
  }
  function vmTx(p, m) {
    const zh = UI.lang !== "en", tx = m.tx || {}, srv = ST && ST.meta && ST.meta.media_v;
    if (tx.status === "done") {
      const t = tx.text || "", cjk = !tx.lang || /^(zh|ja|ko)$/.test(tx.lang), n = cjk ? t.length : (t.match(/\S+/g) || []).length;
      let ln = ""; if (tx.lang && tx.lang !== "zh") try { ln = new Intl.DisplayNames([zh ? "zh-CN" : "en"], { type: "language" }).of(tx.lang) + " · "; } catch { ln = tx.lang + " · "; }
      const cnt = zh ? `${n} ${cjk ? "字" : "词"}` : `${n} ${cjk ? "chars" : "words"}`;
      return `<details class="vm-tx"${VM.open.has(p) ? " open" : ""}><summary>${zh ? "机器转写" : "Machine transcript"} · ${ln}${cnt}</summary><p>${t ? esc(t) : (zh ? "（没听到说话）" : "(no speech)")}</p></details>`;
    }
    if (tx.status === "queued" || tx.status === "working")   // negative delay: a poll re-render does not restart the spinner
      return `<div class="vm-busy"><i style="animation-delay:-${Date.now() % 900}ms"></i>${zh ? (tx.status === "queued" ? "排队等本机转写…" : "正在本机转写…") : "Transcribing on this Mac…"}</div>`;
    if (!srv) return "";   // older server: no transcription yet, the bar still plays
    if (tx.status === "failed") return `<div class="vm-busy err">${zh ? "转写失败" : "Transcription failed"} · <button type="button" class="vm-retry" title="${esc(tx.error || "")}">${zh ? "重试" : "Retry"}</button></div>`;
    return `<div class="vm-busy"><button type="button" class="vm-retry">${zh ? "转写这条录音" : "Transcribe"}</button></div>`;
  }
  function vmHTML(p, u, name) {
    const m = media(p) || {}, zh = UI.lang !== "en", on = VM.cur === p && VM.a && !VM.a.paused, d = vmDur(p);
    const prog = VM.cur === p && VM.a && d ? Math.min(1, VM.a.currentTime / d) : 0, bars = vmBars(m.peaks);
    return `<div class="vm-wrap" data-vm="${esc(p)}" data-name="${name}" data-sig="${esc(vmSig(p))}"><div class="vm${on ? " on" : ""}" data-src="${u}" style="--pp:${(prog * 100).toFixed(2)}%">` +
      `<button type="button" class="vm-play" aria-label="${zh ? "播放" : "Play"} ${name}">${VM_PLAY}</button>` +
      `<div class="vm-wave${m.peaks ? "" : " vm-ph"}" role="slider" tabindex="0" aria-label="${zh ? "播放进度" : "Position"}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(prog * 100)}"><div class="vm-b">${bars}</div><div class="vm-b vm-p" aria-hidden="true">${bars}</div></div>` +
      `<b class="vm-t">${vmTime(p)}</b><button type="button" class="vm-rate" aria-label="${zh ? "倍速" : "Speed"}">${VM.rate}×</button></div>${vmTx(p, m)}</div>`;
  }
  const vmEls = p => document.querySelectorAll(`.vm-wrap[data-vm="${CSS.escape(p)}"]`);
  function vmPaint(p = VM.cur) {
    if (!p) return;
    const a = VM.a, d = vmDur(p) || (a && VM.cur === p ? a.duration : 0), mine = VM.cur === p && a;
    const prog = mine && d ? Math.min(1, a.currentTime / d) : 0;
    vmEls(p).forEach(w => {
      const el = w.firstElementChild; if (!el) return;
      el.classList.toggle("on", !!(mine && !a.paused));
      el.style.setProperty("--pp", (prog * 100).toFixed(2) + "%");
      const t = $(".vm-t", el), s = vmTime(p); if (t && t.textContent !== s) t.textContent = s;
      const wv = $(".vm-wave", el); if (wv) wv.setAttribute("aria-valuenow", Math.round(prog * 100));
    });
  }
  function vmTick() { cancelAnimationFrame(VM.raf); const f = () => { vmPaint(); if (VM.a && !VM.a.paused) VM.raf = requestAnimationFrame(f); }; f(); }
  function vmAudio() {
    if (VM.a) return VM.a;
    const a = VM.a = new Audio(); a.preload = "metadata";
    a.addEventListener("play", vmTick); a.addEventListener("pause", () => vmPaint());
    a.addEventListener("ended", () => { a.currentTime = 0; vmPaint(); });
    a.addEventListener("loadedmetadata", () => {
      if (VM.cur && isFinite(a.duration)) VM.dur[VM.cur] = a.duration;
      if (VM.seek != null && isFinite(a.duration)) { a.currentTime = VM.seek * a.duration; VM.seek = null; }
      vmPaint();
    });
    a.addEventListener("error", () => { if (VM.cur && a.error) VM.err[VM.cur] = vmCodec(VM.cur); vmPaint(); });
    return a;
  }
  // a file this browser cannot decode (ogg/opus on iPhone) vs one that failed to load (network, old server)
  const VM_MIME = { m4a: "audio/mp4", aac: "audio/aac", mp3: "audio/mpeg", wav: "audio/wav", ogg: 'audio/ogg; codecs="opus"', opus: 'audio/ogg; codecs="opus"', webm: 'audio/webm; codecs="opus"' };
  const vmCodec = p => { const m = VM_MIME[(p.split(".").pop() || "").toLowerCase()]; return m && !vmAudio().canPlayType(m) ? "codec" : "load"; };
  function vmStart(w, frac) {
    const p = w.dataset.vm, a = vmAudio();
    if (VM.cur !== p) {
      const old = VM.cur; VM.cur = p; if (old) { a.pause(); vmPaint(old); }
      VM.seek = frac != null ? frac : null;
      a.src = w.firstElementChild.dataset.src; a.defaultPlaybackRate = a.playbackRate = VM.rate;
    } else if (frac != null) { const d = vmDur(p) || a.duration; if (d) a.currentTime = frac * d; }
    delete VM.err[p];
    const pr = a.play(); if (pr && pr.catch) pr.catch(e => { if (e && e.name === "NotSupportedError") VM.err[p] = vmCodec(p); vmPaint(p); });
  }
  function vmSync() {   // poll brought a waveform / transcript for a bar already on screen: swap just that bar
    document.querySelectorAll(".vm-wrap[data-vm]").forEach(w => {
      const p = w.dataset.vm;
      if (w.dataset.sig !== vmSig(p)) w.outerHTML = vmHTML(p, w.firstElementChild.dataset.src, w.dataset.name);
      else if (!vmDur(p) && !VM.probe.has(p)) {   // no server-side duration (older memo / older server): read it from the file header once
        VM.probe.add(p); const au = new Audio(); au.preload = "metadata";
        au.addEventListener("loadedmetadata", () => { if (isFinite(au.duration)) { VM.dur[p] = au.duration; vmPaint(p); } au.removeAttribute("src"); });
        au.src = w.firstElementChild.dataset.src;
      }
    });
  }
  const vmFrac = (wv, x) => { const r = wv.getBoundingClientRect(); return Math.max(0, Math.min(1, (x - r.left) / r.width)); };
  document.addEventListener("click", e => {   // capture: these buttons sit inside links/bubbles that have their own click handlers
    const b = e.target.closest && e.target.closest(".vm-play, .vm-rate, .vm-retry"); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const w = b.closest(".vm-wrap"), p = w.dataset.vm;
    if (b.classList.contains("vm-play")) { if (VM.cur === p && VM.a && !VM.a.paused) VM.a.pause(); else vmStart(w); }
    else if (b.classList.contains("vm-rate")) {
      VM.rate = VM.rate === 1 ? 1.5 : VM.rate === 1.5 ? 2 : 1;
      if (VM.a) VM.a.defaultPlaybackRate = VM.a.playbackRate = VM.rate;
      document.querySelectorAll(".vm-rate").forEach(x => { x.textContent = VM.rate + "×"; });
    } else {
      b.disabled = true;
      fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: p }) })
        .then(r => { if (!r.ok) throw new Error(r.status); return poll(true); })
        .catch(() => { b.disabled = false; toast(UI.lang === "en" ? "Could not start transcription" : "没能开始转写", true); });
    }
  }, true);
  document.addEventListener("pointerdown", e => {   // tap or drag the waveform to seek
    const wv = e.target.closest && e.target.closest(".vm-wave"); if (!wv || e.button > 0) return;
    e.stopPropagation(); const w = wv.closest(".vm-wrap");
    vmStart(w, vmFrac(wv, e.clientX));
    const mv = ev => { const a = VM.a, d = vmDur(w.dataset.vm) || (a && a.duration); if (a && d && VM.cur === w.dataset.vm) { a.currentTime = vmFrac(wv, ev.clientX) * d; vmPaint(); } };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); removeEventListener("pointercancel", up); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up); addEventListener("pointercancel", up);
  }, true);
  document.addEventListener("keydown", e => {
    const wv = e.target.closest && e.target.closest(".vm-wave"); if (!wv || !/^Arrow(Left|Right)$|^ $|^Enter$/.test(e.key)) return;
    e.preventDefault(); const w = wv.closest(".vm-wrap"), p = w.dataset.vm, a = VM.a;
    if (e.key === " " || e.key === "Enter") { if (VM.cur === p && a && !a.paused) a.pause(); else vmStart(w); return; }
    if (VM.cur === p && a) { a.currentTime = Math.max(0, a.currentTime + (e.key === "ArrowRight" ? 5 : -5)); vmPaint(); }
  });
  document.addEventListener("toggle", e => { const d = e.target; if (d.classList && d.classList.contains("vm-tx")) { const p = d.closest(".vm-wrap").dataset.vm; d.open ? VM.open.add(p) : VM.open.delete(p); } }, true);
  // composer tile for a pending memo: duration + a 12-bar waveform decoded locally (best effort)
  function vmTileFace(el, it) {
    const src = it.url || (it.path ? "/" + it.path.split("/").map(encodeURIComponent).join("/") : "");
    if (!src) return;
    const au = new Audio(); au.preload = "metadata"; au.src = src;
    au.addEventListener("loadedmetadata", () => { const d = $(".ap-dur2", el); if (d && isFinite(au.duration)) d.textContent = fmtDur(au.duration); });
    if (!it.url || !window.AudioContext) return;
    fetch(it.url).then(r => r.arrayBuffer()).then(buf => buf.byteLength < 30e6 ? new AudioContext().decodeAudioData(buf) : null).then(ab => {
      if (!ab) return;
      const ch = ab.getChannelData(0), n = 12, step = Math.floor(ch.length / n), rms = [];
      for (let i = 0; i < n; i++) { let s = 0, c = 0; for (let j = i * step; j < (i + 1) * step; j += 64) { s += ch[j] * ch[j]; c++; } rms.push(Math.sqrt(s / (c || 1))); }
      const top = Math.max(...rms) || 1, b = $(".vm-b", el);
      if (b) { b.innerHTML = vmBars(rms.map(v => Math.max(0.12, Math.pow(v / top, 0.7)).toFixed(2)), n); $(".vm-wave", el).classList.remove("vm-ph"); }
    }).catch(() => { });
  }
  function attHTML(list) {
    if (!list || !list.length) return "";
    return `<div class="atts">${list.map(p => {
      const u = /^(uploads|work)\//.test(p) ? "/" + p.split("/").map(encodeURIComponent).join("/") : null;
      const name = esc(p.split("/").pop().replace(/^\d{8}-\d{6}-[0-9a-f]{4}-/, ""));
      // ui2-C: thumbnails open the in-app viewer (viewer.js). /api/thumb needs the new server; on the old one the img falls back to the original.
      const th = `/api/thumb?p=${encodeURIComponent(p)}&w=360`, fb = `onerror="if(!this.dataset.f){this.dataset.f=1;this.src='${u}'}else{this.style.display='none'}"`;
      if (u && /\.(png|jpe?g|gif|webp)$/i.test(p)) return `<a href="${u}" target="_blank" class="lb-th" data-lb="${u}" data-kind="image" data-name="${name}"><img src="${th}" alt="${name}" loading="lazy" ${fb}></a>`;
      if (u && isAudioAtt(p)) return vmHTML(p, u, name);
      if (u && /\.(mp4|mov|m4v|webm)$/i.test(p)) return `<a href="${u}" target="_blank" class="lb-th lb-vid" data-lb="${u}" data-kind="video" data-name="${name}"><img src="${th}" alt="${name}" loading="lazy" onerror="this.style.display='none'"><i class="lb-play">▶</i></a>`;
      return u ? `<a href="${u}" target="_blank">📎 ${name}</a>` : `<span class="mono">📎 ${esc(p)}</span>`;
    }).join("")}</div>`;
  }
  // ===== ui19: preview tiles for pending attachments (one renderer for the chat composer and the detail-page reply composer) =====
  // Keyed reconcile instead of innerHTML: an upload tile keeps its DOM node (and the decoded thumbnail) when it turns from "uploading" into "done".
  const fmtDur = s => { s = Math.round(s); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  function attTiles(box, pending, redraw) {
    if (!box) return;
    const items = pending.map(p => {
      const m = (pending._m || {})[p] || {}, name = (m.name || p.split("/").pop().replace(/^\d{8}-\d{6}-[0-9a-f]{4}-/, ""));
      const kind = m.kind || (isAudioAtt(p) ? "audio" : /\.(mp4|mov|m4v|webm)$/i.test(p) ? "video" : /\.(png|jpe?g|gif|webp|heic|heif)$/i.test(p) ? "image" : "file");
      return { k: m.key || p, name, kind, path: p, url: m.url, up: null };
    }).concat(Object.entries(pending._up || {}).map(([k, u]) => ({ k, name: u.name, kind: u.kind, url: u.url, up: u })));
    const have = new Map(Array.from(box.children).map(el => [el.dataset.k, el]));
    items.forEach((it, i) => {
      let el = have.get(it.k); have.delete(it.k);
      if (!el) {
        el = document.createElement("div"); el.className = "ap-tile"; el.dataset.k = it.k;
        const thumb = it.path ? `/api/thumb?p=${encodeURIComponent(it.path)}&w=240` : "";
        let face;
        if (it.kind === "audio") face = `<div class="vm-mini"><div class="vm-wave vm-ph"><div class="vm-b">${vmBars(null, 12)}</div></div><b class="ap-dur2">--:--</b></div>`;
        else if (it.kind === "video" && it.url) face = `<video muted playsinline preload="metadata" src="${esc(it.url)}#t=0.1"></video>`;
        else if (it.kind !== "file" && (thumb || it.url)) face = `<img alt="" draggable="false" src="${esc(it.url || thumb)}">`;
        else face = `<div class="ap-file"><em>📎</em><small>${esc(it.name)}</small></div>`;
        if (it.kind === "video") face += `<i class="ap-play">▶</i><b class="ap-dur"></b>`;
        el.innerHTML = `<div class="ap-face">${face}</div><div class="ap-up"><i></i><b></b></div><button type="button" class="ap-x" aria-label="${UI.lang === "en" ? "Remove" : "移除"}">✕</button>`;
        el.title = it.name;
        el.classList.add(it.kind);
        if (it.kind === "audio") vmTileFace(el, it);
        const v = $("video", el), im = $("img", el);
        if (v) {
          v.addEventListener("loadedmetadata", () => { if (isFinite(v.duration)) { const d = $(".ap-dur", el); d.textContent = fmtDur(v.duration); el.classList.add("has-dur"); } });
          v.addEventListener("error", () => { el.classList.add("noprev"); });
        }
        if (im) im.addEventListener("error", () => el.classList.add("noprev"));
        el.querySelector(".ap-x").addEventListener("click", e => {
          e.stopPropagation();
          const idx = pending.findIndex(p => ((pending._m || {})[p] || {}).key === el.dataset.k || p === el.dataset.k);
          if (idx >= 0) { const m = (pending._m || {})[pending[idx]]; pending.splice(idx, 1); if (m && m.url) try { URL.revokeObjectURL(m.url); } catch { } redraw(); }
        });
      }
      // done: expose the file to the shared lightbox (viewer.js collects every [data-lb] in the strip)
      const face = $(".ap-face", el);
      if (it.path && !it.up) {
        const u = "/" + it.path.split("/").map(encodeURIComponent).join("/");
        if (it.kind === "video" || (it.kind === "image" && /\.(png|jpe?g|gif|webp)$/i.test(it.path))) { face.dataset.lb = u; face.dataset.kind = it.kind; face.dataset.name = it.name; }
        if (!el.dataset.path) { el.dataset.path = it.path; if (it.kind === "image" && !it.url) { /* thumb already set */ } }
      }
      if (it.path && !it.up && el.classList.contains("noprev") && !el.dataset.retry) {   // e.g. a HEIC the browser cannot decode: the server's /api/thumb can
        el.dataset.retry = 1; const im = $("img", el); if (im) { im.src = `/api/thumb?p=${encodeURIComponent(it.path)}&w=240`; el.classList.remove("noprev"); }
      }
      el.classList.toggle("up", !!it.up);
      if (it.up) { const p = Math.round(it.up.p * 100); el.style.setProperty("--p", p + "%"); $(".ap-up b", el).textContent = p + "%"; }
      if (box.children[i] !== el) box.insertBefore(el, box.children[i] || null);
    });
    have.forEach(el => el.remove());
    box.classList.toggle("has", items.length > 0);
  }

  // t-lib-attach: library tiles ([data-lib-path]) drag their existing path; a reply box takes it as an attachment without uploading again
  const LIB_MIME = "application/x-rt-path";
  const attachPath = (pending, p) => { if (p && !pending.includes(p)) pending.push(p); if (pending._show) pending._show(); };
  document.addEventListener("dragstart", e => { const a = e.target && e.target.closest && e.target.closest("[data-lib-path]"); if (a) { e.dataTransfer.setData(LIB_MIME, a.dataset.libPath); e.dataTransfer.effectAllowed = "copy"; } });
  document.addEventListener("dragend", () => document.querySelectorAll("textarea.lib-drop").forEach(t => t.dispatchEvent(new Event("dragleave"))));
  /* t-attach-btn (batch 2, direction A): one attach button everywhere = solid round paperclip; while files are dragged over the composer it turns into an accent ↑. */
  const ATT_IC = '<svg class="ic-clip" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 11.2l-8.3 8.3a5.3 5.3 0 0 1-7.5-7.5l8.4-8.4a3.6 3.6 0 0 1 5.1 5.1l-8.4 8.4a1.8 1.8 0 0 1-2.5-2.5l7.7-7.7"/></svg><svg class="ic-up" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V6M6.5 11.5L12 6l5.5 5.5"/></svg>';
  const attTitle = () => UI.lang === "en" ? "Attach files · or drop / paste them here" : "添加附件 · 也可以拖进来或直接粘贴";
  function wireUploads(ta, pending, onChange) {
    pending._up = pending._up || {};
    const add = files => Promise.all(Array.from(files).map(async f => {
      const key = Math.random().toString(36).slice(2);
      const isA = /^audio\//.test(f.type) || AUD_RE.test(f.name || "");   // t-voice-memo
      const isV = !isA && (/^video\//.test(f.type) || /\.(mp4|mov|m4v|webm)$/i.test(f.name || "")), isI = /^image\//.test(f.type);
      let blob = ""; try { if (isV || isI || isA) blob = URL.createObjectURL(f); } catch { }   // ui19: local preview while uploading
      pending._up[key] = { name: f.name || "paste.png", p: 0, size: fmtSize(f.size), url: blob, kind: isA ? "audio" : isV ? "video" : isI ? "image" : "file" }; onChange();
      try { const path = await upload(f, p => { pending._up[key].p = p; onChange(); }); (pending._m = pending._m || {})[path] = { key, url: blob, kind: pending._up[key].kind, name: pending._up[key].name }; pending.push(path); }
      catch { if (blob) try { URL.revokeObjectURL(blob); } catch { } }
      delete pending._up[key]; onChange();
    }));
    ta.addEventListener("paste", e => { const fs = Array.from(e.clipboardData.files || []); if (fs.length) { e.preventDefault(); add(fs); } });
    pending._show = onChange;   // t-lib-attach: attachTo() refreshes the tiles after adding a library path
    const libDrag = e => Array.from((e.dataTransfer && e.dataTransfer.types) || []).includes(LIB_MIME);
    /* t-attach-btn: the whole composer is the drop zone (was the textarea only). A counter absorbs the dragenter/dragleave pairs between child elements. */
    const zone = ta.closest(".composer, .ch-comp") || ta;
    const dragOk = e => { const ty = Array.from((e.dataTransfer && e.dataTransfer.types) || []); return ty.includes("Files") || ty.includes(LIB_MIME); };
    let depth = 0;
    const hint = on => {
      zone.classList.toggle("drop-on", on); ta.classList.toggle("lib-drop", on);
      if (on && ta.dataset.ph == null) { ta.dataset.ph = ta.placeholder; ta.placeholder = UI.lang === "en" ? "Drop to attach to this reply" : "松手 = 附到这条回复"; }
      else if (!on && ta.dataset.ph != null) { ta.placeholder = ta.dataset.ph; delete ta.dataset.ph; }
    };
    zone.addEventListener("dragenter", e => { if (!dragOk(e)) return; e.preventDefault(); depth++; hint(true); });
    zone.addEventListener("dragover", e => { if (!dragOk(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; hint(true); });
    zone.addEventListener("dragleave", () => { depth = Math.max(0, depth - 1); if (!depth) hint(false); });
    zone.addEventListener("drop", e => { if (!dragOk(e)) return; e.preventDefault(); depth = 0; hint(false); const lp = e.dataTransfer.getData(LIB_MIME); if (lp) { attachPath(pending, lp); return; } add(Array.from(e.dataTransfer.files || [])); });
    return add;
  }

  // ---------- t-mobile-crash-state: slim polling on the phone ----------
  // A slim done/archived card has no draft / versions (it.slim = 1). The drawer asks /api/item for the full card once; FULL keeps those
  // fields and every poll puts them back while the card's `updated` is unchanged (a changed card is fetched again on the next open).
  // An older server ignores ?slim=1 and sends full cards (no it.slim), so nothing here ever runs against it.
  const FULL = {}, FULLP = {};
  function rehydrate() {
    for (const it of ST.items || []) {
      const f = it.slim && FULL[it.id];
      if (!f) continue;
      if (f.updated !== it.updated) { delete FULL[it.id]; continue; }
      it.draft = f.draft; it.versions = f.versions; delete it.slim;
    }
  }
  function fullItem(id) {
    return FULLP[id] || (FULLP[id] = fetch("/api/item?id=" + encodeURIComponent(id)).then(r => r.ok ? r.json() : null)
      .then(f => { if (f) { FULL[id] = { updated: f.updated, draft: f.draft || "", versions: f.versions || [] }; rehydrate(); } return !!f; }, () => false)
      .finally(() => { delete FULLP[id]; }));
  }
  // ---------- t-perf A: archived cards (done for 3+ days) are not in the poll. ST.meta.archive.ix = [[id, title, owner, date]] names them
  // (id chips, title search, deep links). Opening one fetches it (+ its archived family) from /api/item; ARCH.got keeps those and every
  // poll puts them back into ST.items, flagged archived (so no list shows them). Search and 素材库 load the whole archive once
  // (/api/archive, refetched only when meta.archive.v changes) and fire "rt-arch" when it lands. A card you act on moves back on the server.
  const ARCH = { got: {}, pend: {}, miss: {}, all: null, v: null, p: null };
  const archIx = () => (ST && ST.meta && ST.meta.archive && ST.meta.archive.ix) || [];
  const archKnown = id => archIx().some(x => x[0] === id);
  const archTitle = id => { const x = archIx().find(x => x[0] === id); return x ? x[1] : ""; };
  const archFlag = x => Object.assign(x, { archived: true, _arch: 1 });
  function archMerge() {
    const real = new Set(), mine = new Set();
    for (const i of ST.items || []) (i._arch ? mine : real).add(i.id);
    for (const id of Object.keys(ARCH.got)) { if (real.has(id)) { delete ARCH.got[id]; continue; } if (!mine.has(id)) ST.items.push(ARCH.got[id]); }   // back on the server = the server's copy wins
  }
  function archItem(id) {
    if (ARCH.pend[id]) return ARCH.pend[id];
    const keep = list => { list.forEach(x => { ARCH.got[x.id] = archFlag(x); }); archMerge(); return true; };
    if (ARCH.all) { const f = ARCH.all.find(i => i.id === id); if (f) return Promise.resolve(keep([f, ...ARCH.all.filter(i => i.id !== id && ((f.tags || []).includes(i.id) || (i.tags || []).includes(id)))])); }
    return (ARCH.pend[id] = fetch("/api/item?id=" + encodeURIComponent(id)).then(r => r.ok ? r.json() : null)
      .then(f => { if (!f || !f.archived_store) return false; const fam = f.family || []; delete f.family; delete f.archived_store; return keep([f, ...fam]); }, () => false)
      .finally(() => { delete ARCH.pend[id]; }));
  }
  function archAll() {
    const v = ST && ST.meta && ST.meta.archive && ST.meta.archive.n ? ST.meta.archive.v : null;
    if (!v) return Promise.resolve([]);
    if (ARCH.all && ARCH.v === v) return Promise.resolve(ARCH.all);
    return ARCH.p || (ARCH.p = fetch("/api/archive").then(r => r.json()).then(j => {
      const have = new Set((ST.items || []).filter(i => !i._arch).map(i => i.id));
      ARCH.all = (j.items || []).filter(i => !have.has(i.id)).map(archFlag); ARCH.v = v; document.dispatchEvent(new Event("rt-arch")); return ARCH.all;
    }).catch(() => []).finally(() => { ARCH.p = null; }));
  }
  // t-m2-a ③: the cold-start skeleton (index.html #boot-sk, phone only) goes as soon as the first poll answers or fails
  function bootDone() { const b = document.getElementById("boot-sk"); if (b) b.remove(); }
  // ---------- polling ----------
  async function poll(force) {
    try {
      const qs = [REV != null && !force ? `rev=${REV}` : "", MOBQ.matches ? "slim=1" : ""].filter(Boolean).join("&");   // t-mobile-crash-state
      const r = await fetch("/api/state" + (qs ? "?" + qs : ""));
      var j = await r.json();
    } catch (e) {
      bootDone();
      UI.down = true; UI.fail = (UI.fail || 0) + 1;   // t-sync-pill: one miss can be a blip; syncPaint turns the pill red after 2 misses + 10 s
      syncPaint();
      return;
    }
    // a rendering bug must not masquerade as the server being down
    try {
      const back = UI.down; UI.down = false;  // clear the "unreachable" banner as soon as the server answers again
      UI.fail = 0; UI.lastOk = Date.now(); if (j.same && ST && ST.meta) { ST.meta.comfy = j.meta.comfy; ST.meta.inbox_unacked = j.meta.inbox_unacked; syncPaint(); }   // a full state repaints via renderHeader
      if (j.same) { ST.meta.comfy = j.meta.comfy; ST.meta.inbox_unacked = j.meta.inbox_unacked; if (back || ++UI.tick % 12 === 0) renderChrome(); return; }
      ST = j; REV = j.meta.rev; rehydrate(); archMerge(); try { doneMailRead(); } catch (_) { } render(); bootDone();
    } catch (e) {
      console.error("render failed", e);
      if (!poll.warned) { poll.warned = true; toast((UI.lang === "en" ? "Display error: " : "界面出错：") + e.message, true); }
    }
  }

  function render() {
    document.documentElement.dataset.theme = UI.theme;
    document.documentElement.lang = UI.lang === "en" ? "en" : "zh";
    renderChrome(); renderLeft(); renderPage(); if (UI.item && dwSig() !== DW.sig) renderDrawer(); renderChat(); renderMailbox();   // t-perf E: an unchanged open card is not rebuilt
    appBadge();
    hooks.forEach(f => f("all"));
    vmSync();
  }
  // t-app-badge: the installed app's icon badge (iPhone home screen, Mac Dock) = 「等你拍板」 = the nav's 审核 count. server.py pending_count() mirrors it for pushes.
  // Only touched when the number changes; unsupported browsers and a missing permission are ignored.
  function appBadge() {
    if (!("setAppBadge" in navigator)) return;
    const n = counts().review;
    if (n === appBadge.last) return;
    appBadge.last = n;
    (n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => { appBadge.last = undefined; });
  }
  const hooks = [];
  function renderChrome() { renderHeader(); renderTool(); renderTicker(); }

  // ---------- header ----------
  function nextEvent() {
    const now = new Date();
    const ev = (ST.calendar || []).map(c => ({ ...c, d: new Date(`${c.date}T${c.time || "00:00"}`) })).filter(c => c.d > now).sort((a, b) => a.d - b.d)[0];
    if (!ev) return "";   // t-cal-fold: no upcoming event -> the header leaves the NEXT segment out
    const lbl = dayKey(ev.d) === dayKey(now) ? t("today_w") : dayKey(ev.d) === dayKey(new Date(Date.now() + 864e5)) ? t("tomorrow") : `${ev.d.getMonth() + 1}/${ev.d.getDate()}`;
    return `<b>${lbl} ${esc(ev.time || "")} ${esc(ev.title)}</b>`;
  }
  function mgrState() {
    const m = agent("manager");
    const stale = m.last_seen && (Date.now() - new Date(m.last_seen)) > 45 * 6e4 && ST.meta.inbox_unacked > 0;
    if (m.status === "offline" || !m.last_seen) return { on: false, txt: t("offline") };
    // asleep: planned (S sleep --until) or a hard stop (a usage window at ~100% and no heartbeat since)
    const u = ST.meta.usage || {}, quiet = Date.now() - new Date(m.last_seen) > 10 * 6e4;
    const hit = [u.five_hour, u.seven_day].filter(w => w && w.used >= 98 && until(w.resets_at)).map(w => w.resets_at).sort().pop();
    const wake = m.status === "sleeping" ? m.wake_at : quiet && hit;
    if (wake) {
      const back = until(wake);
      return { on: false, sleep: true, wake, back: back && clock(wake), since: m.last_seen,
        txt: back ? t("sleep_at", { t: clock(wake) }) : t("waking") };
    }
    return { on: !stale, txt: stale ? `${t("offline")}?` : t("online"), since: m.last_seen };
  }
  // Plan usage comes from the manager's statusLine (tools/statusline.py): 5-hour window drives the orb,
  // the weekly window is the thin bar under it. Shown as what's LEFT, like a stamina bar.
  function until(iso) {
    const ms = new Date(iso) - Date.now(); if (!(ms > 0)) return null;
    const h = Math.floor(ms / 36e5), m = Math.round(ms % 36e5 / 6e4);
    return h ? `${h}h${pad(m)}m` : `${m}m`;
  }
  // "03:10" today, "明天 03:10" / "周二 19:00" further out; English uses 3:10 AM style like Claude's own card
  function clock(iso) {
    const d = new Date(Math.round(new Date(iso) / 6e4) * 6e4), en = UI.lang === "en", now = new Date();  // 03:09:59 reads as 03:10
    const tm = en ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const days = Math.round((new Date(d.toDateString()) - new Date(now.toDateString())) / 864e5);
    if (days <= 0) return tm;
    if (days === 1) return en ? `tomorrow ${tm}` : `明天 ${tm}`;
    return (en ? d.toLocaleDateString("en-US", { weekday: "short" }) : "周" + "日一二三四五六"[d.getDay()]) + " " + tm;
  }
  // t-imp-p4: usage is shown honestly. The manager's usage tool times out often, so old readings are normal:
  // older than USAGE_STALE minutes = "≈" + "11:11 的数据" + greyed; a window whose reset passed AFTER the reading
  // is unknown (the reading is from before the reset), never "100% 已回满".
  const USAGE_STALE = 20;   // t-stamina-stale: was 30; past this the orb greys out and the subtitle says how old the reading is
  const ageShort = iso => { const d = D(iso); if (!d) return ""; const m = Math.max(0, Math.round((Date.now() - d) / 6e4)), en = UI.lang === "en";
    return m < 60 ? (en ? `${m} min ago` : `${m} 分钟前`) : m < 48 * 60 ? (en ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 60)} 小时前`) : when(iso); };
  function ageTxt(iso) {
    const d = D(iso); if (!d) return "";
    const m = Math.max(0, Math.round((Date.now() - d) / 6e4)), en = UI.lang === "en";
    if (m < 1) return t("just");
    if (m < 60) return en ? `${m} min ago` : `${m} 分钟前`;
    const h = Math.floor(m / 60), r = m % 60;
    if (h < 48) return en ? `${h}h${r ? ` ${r}m` : ""} ago` : `${h} 小时${r ? ` ${r} 分钟` : ""}前`;
    return when(iso);
  }
  function usageSrc(src) {
    const en = UI.lang === "en";
    if (src === "manager") return en ? "read by the manager with the desktop app's get_usage" : "管家用桌面端 get_usage 读取";
    if (src === "statusline") return en ? "written by the terminal statusLine (tools/statusline.py)" : "终端 statusLine 自动写入（tools/statusline.py）";
    return src ? (en ? `source: ${src}` : `来源：${src}`) : (en ? "source unknown" : "来源未记录");
  }
  function usage() {
    const u = ST.meta.usage || {}, en = UI.lang === "en";
    const five = u.five_hour, week = u.seven_day;
    if (!five && !week) return { left: null, week: null, sub: en ? "no usage data" : "未接入用量", stale: true, none: true,
      tip: en ? "Set up tools/statusline.py as the manager's statusLine" : "把 tools/statusline.py 配成管家的 statusLine 后显示 Claude 用量" };
    const at = D(u.at), ageMin = at ? (Date.now() - at) / 6e4 : Infinity;
    const stale = ageMin > USAGE_STALE;
    const gone = w => { const r = w && D(w.resets_at); return !!r && r <= Date.now() && (!at || at < r); };
    const lost5 = gone(five), lostW = gone(week);
    const reset5 = five && until(five.resets_at), resetW = week && until(week.resets_at);
    const at5 = reset5 && clock(five.resets_at), atW = resetW && clock(week.resets_at);
    // t-stamina-stale v2: a window that reset after the reading starts again from 0, so it is shown as an estimated 100% ("估"), not "—".
    // Number = how much is left (估 when estimated), subtitle = the window's state, the desktop pill = why the reading is old and for how long.
    const left = five ? (lost5 ? 100 : Math.round(100 - five.used)) : null;
    const wk = week ? (lostW ? 100 : Math.round(100 - week.used)) : null;
    const approx = (stale || lost5) && left != null, approxW = (stale || lostW) && wk != null;
    const ms = mgrState(), why = ms.sleep ? (en ? "manager asleep" : "管家休眠") : !ms.on ? (en ? "manager offline" : "管家离线") : (en ? "read timed out" : "读取超时");
    const mins = at ? Math.max(0, Math.round(ageMin)) : 0;
    const quiet = mins < 60 ? (en ? `no update for ${mins} min` : `${mins} 分钟没更新`) : mins < 48 * 60 ? (en ? `no update for ${Math.floor(mins / 60)}h` : `${Math.floor(mins / 60)} 小时没更新`) : (en ? `no update since ${when(u.at)}` : `${when(u.at)} 起没更新`);
    const pill = stale && u.at ? `${why} · ${quiet}` : "";
    const sub = lost5 ? (en ? `full since ${clock(five.resets_at)}` : `${clock(five.resets_at)} 已回满`)
      : reset5 ? (en ? `full at ${at5}` : `${at5} 复活`) : "";
    const subPh = stale && u.at ? `${why} · ${ageShort(u.at)}` : sub;   // phones have no pill: the subtitle says why instead
    const age = u.at ? ageTxt(u.at) : "";
    const tip = [five && (lost5 ? (en ? `Session: reset at ${clock(five.resets_at)} after the last reading · estimated near full` : `5 小时窗口：上次读数之后已在 ${clock(five.resets_at)} 重置 · 估计接近回满`)
        : (en ? `Session: ${approx ? "≈" : ""}${left}% left${at5 ? ` · full at ${at5}` : ""}` : `5 小时窗口：剩 ${approx ? "≈" : ""}${left}%${at5 ? ` · ${at5} 回满` : ""}`)),
      week && (lostW ? (en ? "Weekly: reset after the last reading · estimated near full" : "本周：上次读数之后已重置 · 估计接近回满")
        : (en ? `Weekly: ${approxW ? "≈" : ""}${wk}% left${atW ? ` · resets ${atW}` : ""}` : `本周：剩 ${approxW ? "≈" : ""}${wk}%${atW ? ` · ${atW} 重置` : ""}`)),
      u.context != null && (en ? `Manager context: ${u.context}% used` : `管家上下文：已用 ${u.context}%`),
      u.at && (en ? `Read at ${hm(u.at)} (${age})${stale ? ` · ${why}` : ""}` : `${hm(u.at)} 读取（${age}）${stale ? ` · ${why}` : ""}`)].filter(Boolean).join("\n");
    return { left, week: wk, sub, subPh, pill, why, stale, approx, approxW, lost5, lostW, age, tip, reset5, resetW, at5, atW, src: u.source,
      used5: five && Math.round(five.used), usedW: week && Math.round(week.used), context: u.context, at: u.at };
  }
  // ===== t-home-usage (approved 11-04): tokens per role today, from GET /api/usage (server reads the local transcripts, 60 s cache).
  // One builder, three places: the desktop widget (widgets.js), the phone home card, the 系统状态 panel. Quota % stays a small strip under it.
  const UG = { data: null, at: 0, busy: null, key: "", prev: new Map() };
  function loadRoleUsage() {
    if (UG.busy || Date.now() - UG.at < 6e4) return;
    UG.busy = fetch("/api/usage").then(r => r.ok ? r.json() : null).catch(() => null).then(d => {
      UG.at = Date.now(); UG.busy = null; if (!d || !Array.isArray(d.roles)) return;
      const k = JSON.stringify([d.day, d.roles.map(r => [r.id, r.new])]); UG.data = d;
      if (k === UG.key) return; UG.key = k;
      if (UI.page === "review" || (UI.page === "settings" && UI.setTab === "system")) renderPage();
      const m = $("#modal .mdl.sys"); if (m && m._paint) m._paint();
    });
  }
  setInterval(() => { if (!document.hidden && (UI.page === "review" || (UI.page === "settings" && UI.setTab === "system") || $("#modal .mdl.sys"))) loadRoleUsage(); }, 15000);   // a quiet state does not re-render, so poll the counts here
  const fmtTok = n => { n = +n || 0; const en = UI.lang === "en";
    if (n >= 1e8 && !en) return (n / 1e8).toFixed(n >= 1e9 ? 0 : 1) + " 亿";
    return n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n); };
  function roleUsage() {
    loadRoleUsage();
    const d = UG.data; if (!d) return null;
    const rows = d.roles.filter(r => r.new > 0).map(r => ({ ...r, a: r.id === "other" ? null : agent(r.id) }));
    return { ...d, rows };
  }
  function ruName(r) { const en = UI.lang === "en"; return r.id === "other" ? (en ? "Other sessions" : "其他会话") : r.a ? aname(r.a) : r.id; }
  function ruTip(r) { const en = UI.lang === "en", f = fmtTok;
    return en ? `input ${f(r.in)} · output ${f(r.out)} · cache write ${f(r.cw)} · cache read ${f(r.cr)} · ${r.msgs} replies · ${r.sessions} sessions`
      : `输入 ${f(r.in)} · 输出 ${f(r.out)} · 写缓存 ${f(r.cw)} · 读缓存 ${f(r.cr)} · ${r.msgs} 次回复 · ${r.sessions} 个会话`; }
  // quota strip: 5 小时 / 本周 / 管家上下文 (what is LEFT), greyed + 「X 分钟前 · 可能已过期」 past USAGE_STALE (same usage() as the orb)
  function ruQuota(compact) {   // compact (home widget, t-sync-pill batch 2): one line, no manager context, a stale reading = warn dot + age
    const U = usage(), en = UI.lang === "en"; if (U.none) return "";
    const v = (x, est) => x == null ? "—" : `${est ? "≈" : ""}${x}%`;
    const age = U.at ? relH("ago", U.at, ago(U.at)) : "";
    return `<div class="ru-q${U.stale ? " old" : ""}" data-ru-open><span>${en ? "5-hour" : "5 小时"} <b>${v(U.left, U.approx)}</b></span><span>${en ? "Week" : "本周"} <b>${v(U.week, U.approxW)}</b></span>`
      + (U.context != null && !compact ? `<span>${en ? "Manager context" : "管家上下文"} <b>${v(100 - U.context, U.stale)}</b></span>` : "")
      + (compact ? `<span class="ru-age${U.stale ? " old" : ""}" title="${U.stale ? (en ? "may be out of date" : "可能已过期") : ""}">${age}</span></div>`
        : `<span class="ru-age">${U.stale ? `<em>${age} · ${en ? "may be out of date" : "可能已过期"}</em>` : age}</span></div>`);
  }
  // n: rows to list; o.tot: the big total line; o.quota: the strip
  function ruHTML(n, o = {}) {
    const R = roleUsage(), en = UI.lang === "en";
    if (!R) return `<div class="ru-wait">${en ? "Counting…" : "正在统计…"}</div>` + (o.quota ? ruQuota() : "");
    const rows = R.rows, max = rows.length ? rows[0].new : 1, more = rows.length - n;
    const list = rows.length ? rows.slice(0, n).map((r, i) => `<div class="ru-row${r.a ? "" : " nd"}"${r.a ? ` data-chat="${esc(r.id)}"` : ""} title="${esc(ruTip(r))}" style="--ru-i:${i}">`
        + (r.a ? `<img class="ru-av" src="${avatarUrl(r.a)}" alt="">` : `<span class="ru-av"></span>`)
        + `<span class="ru-n"><span class="t">${esc(ruName(r))}</span>${r.a && r.a.status === "working" ? `<i class="ru-on" title="${en ? "working" : "工作中"}"></i>` : ""}</span>`
        + `<i class="ru-bar"><em data-ru="${esc(r.id)}" style="--ru-w:${Math.max(0.02, r.new / max).toFixed(3)}"></em></i><b data-ru-v="${r.new}">${fmtTok(r.new)}</b></div>`).join("")
      : `<div class="ru-wait">${R.error ? (en ? `Could not read the transcripts (${esc(R.error)})` : `读不到会话记录（${esc(R.error)}）`) : (en ? "No tokens used yet today" : "今天还没用过")}</div>`;
    const tot = o.tot ? `<div class="ru-tot" data-ru-open><b data-ru-v="${R.total}" data-ru-k="tot">${fmtTok(R.total)}</b><span>${en ? `new tokens · plus ${fmtTok(R.cache_read)} cache reads` : `新 token · 另读缓存 ${fmtTok(R.cache_read)}`}</span></div>` : "";
    requestAnimationFrame(ruSettle);
    if (o.fit) requestAnimationFrame(ruFit);
    return tot + `<div class="ru-list">${list}${more > 0 && o.more ? `<div class="ru-more" data-ru-open>${en ? `+${more} more ›` : `还有 ${more} 个 ›`}</div>` : ""}</div>` + (o.quota ? ruQuota(o.fit) : "");
  }
  // Motion (11-04 rule): a bar grows from 0 the first time it is shown and glides from its previous length when the data changes;
  // numbers count up. Rebuilt DOM with the same data does nothing. prefers-reduced-motion: no transition (CSS) and no count.
  // t-sync-pill (batch 2): the home widget has a fixed height; rows that do not fit fold away from the bottom (the header's 「全部 N 位 ›」 opens the full list)
  function ruFit() {
    document.querySelectorAll("[data-wg=usage] .ru-list").forEach(list => {
      const rows = [...list.querySelectorAll(".ru-row")]; rows.forEach(r => r.classList.remove("fit-hide"));
      for (let i = rows.length - 1; i > 0 && list.scrollHeight > list.clientHeight + 1; i--) rows[i].classList.add("fit-hide");
    });
  }
  function ruSettle() {
    document.querySelectorAll(".ru-bar em:not([data-s])").forEach(em => {
      em.dataset.s = "1"; const k = em.closest(".ru-list") && em.closest(".ru-list").parentElement ? em.dataset.ru + "|" + (em.closest("[data-wg],.ru-card,.sy-ru") || {}).className : em.dataset.ru;
      const to = getComputedStyle(em).getPropertyValue("--ru-w").trim(), from = UG.prev.has(k) ? UG.prev.get(k) : "0";
      UG.prev.set(k, to); if (from === to || RMQ.matches) return;
      em.style.transition = "none"; em.style.transform = `scaleX(${from})`; em.getBoundingClientRect();
      em.style.transition = ""; em.style.transform = "";
      if (from !== "0") em.style.transitionDelay = "0ms";
    });
    document.querySelectorAll("[data-ru-v]:not([data-s])").forEach(b => {
      b.dataset.s = "1"; const k = "v|" + (b.dataset.ruK || (b.closest(".ru-row") && b.closest(".ru-row").querySelector("[data-ru]") || {}).dataset?.ru) + "|" + (b.closest("[data-wg],.ru-card,.sy-ru") || {}).className;
      const to = +b.dataset.ruV, from = UG.prev.has(k) ? UG.prev.get(k) : 0; UG.prev.set(k, to);
      if (from === to || RMQ.matches || document.hidden) return;
      const t0 = performance.now(), D = 520, ease = x => 1 - Math.pow(1 - x, 3);
      const step = now => { if (!b.isConnected) return; const x = Math.min(1, (now - t0) / D); b.textContent = fmtTok(from + (to - from) * ease(x)); if (x < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }
  // phone home card (under the strip's stat row); the desktop widget lives in widgets.js
  function ruCard() {
    if (!MOBQ.matches) return "";
    const R = roleUsage(), en = UI.lang === "en";
    return `<section class="ru-card" data-ru-open><div class="ru-hd"><b>${en ? "Usage by role" : "各角色用量"}</b><small>${en ? "today · new tokens" : "今天 · 新 token"}</small>${R ? `<span>${en ? "total" : "共"} ${fmtTok(R.total)}</span>` : ""}</div>${ruHTML(4, { quota: true })}</section>`;
  }
  document.addEventListener("click", e => {   // the card / strip opens 系统状态; a role row (data-chat) opens the DM instead
    const o = e.target.closest && e.target.closest("[data-ru-open]"); if (!o || e.target.closest("[data-chat]")) return;
    if (document.querySelector("#wg.edit")) return;
    modalStatus();
  });
  /* t-sync-pill (detail polish batch 2, V1): the top bar shows one pill, 「● 已同步」 = the last poll answered. Two misses in a row (~30 s) turn it red with a
     running 「断线 · N 秒没连上 · 自动重试中」. Hover / focus opens the details (connection, last data change, next event, 5090, team, inbox); a click still opens
     系统状态. The manager's online state lives in the left rail only. Built once and then only text nodes change, so a poll never rebuilds the popover under the mouse.
     Phones hide #sync; there html[data-net="off"] shows #net-off under the header, only while disconnected. */
  function syncPaint() {
    const sy = $("#sync"); if (!sy) return;
    const en = UI.lang === "en", R = document.documentElement;
    // polls run every 2.5 s: red only after 2+ misses in a row AND 10 s without an answer (a blip or one slow reply stays green)
    const down = (UI.fail || 0) >= 2 && (!UI.lastOk || Date.now() - UI.lastOk >= 10000);
    if (!sy.querySelector(".sy-pill")) {
      sy.classList.add("sy1"); sy.tabIndex = 0; sy.setAttribute("role", "button");
      sy.innerHTML = `<span class="sy-pill"><i class="sy-dot" aria-hidden="true"></i><b class="sy-k"></b><small class="sy-s"></small></span>`
        + `<div class="sy-pop" role="tooltip"><span data-l="c"></span><b data-v="c"></b><span data-l="d"></span><b data-v="d"></b><span data-l="n"></span><b data-v="n"></b>`
        + `<span data-l="t"></span><b data-v="t"></b><span>5090</span><b data-v="g"></b><span data-l="i"></span><b data-v="i"></b><div class="ft"></div></div>`;
    }
    const set = (sel, v, html) => { const e = sy.querySelector(sel); if (!e) return; if (html) { if (e._h !== v) { e._h = v; e.innerHTML = v; } } else if (e.textContent !== v) e.textContent = v; };
    const secs = UI.lastOk ? Math.max(0, Math.round((Date.now() - UI.lastOk) / 1000)) : 0;
    const off = en ? `${secs ? secs + " s without an answer · " : ""}retrying` : `${secs ? secs + " 秒没连上 · " : ""}自动重试中`;
    const pill = sy.querySelector(".sy-pill"), wasDown = pill.classList.contains("down");
    pill.classList.toggle("down", down);
    set(".sy-k", down ? (en ? "Offline" : "断线") : (en ? "Synced" : "已同步"));
    set(".sy-s", down ? off : "");
    if (wasDown && !down) { pill.classList.remove("back"); void pill.offsetWidth; pill.classList.add("back"); }
    sy.setAttribute("aria-label", down ? `${en ? "Offline" : "断线"} · ${off}` : (en ? "Synced · details" : "已同步 · 查看详情"));
    const L = en ? { c: "Connection", d: "Last change", n: "Next", t: "Team", i: "Inbox" } : { c: "连接", d: "数据最后变动", n: "下一个", t: "团队", i: "收件箱" };
    for (const k in L) set(`[data-l="${k}"]`, L[k]);
    const okAt = UI.lastOk ? new Date(UI.lastOk).toTimeString().slice(0, 8) : "—";
    set('[data-v="c"]', down ? (en ? `offline · last answer ${okAt}` : `断线 · 最后一次连上 ${okAt}`) : (en ? `live · last checked ${okAt}` : `正常 · 最后确认 ${okAt}`));
    sy.querySelector('[data-v="c"]').className = down ? "bad" : "ok";
    const M = (ST && ST.meta) || {}, c = M.comfy || {}, ag = ST ? agents().filter(a => a.enabled !== false && a.id !== "manager") : [];
    set('[data-v="d"]', M.updated ? `${hm(M.updated)} · ${ago(M.updated)}` : "—");
    set('[data-v="n"]', (ST && nextEvent()) || "—", true);
    set('[data-v="t"]', en ? `${ag.length} · ${ag.filter(a => a.status === "working").length} working` : `${ag.length} 位 · ${ag.filter(a => a.status === "working").length} 位在忙`);
    set('[data-v="g"]', c.online ? (en ? "online" : "在线") : (en ? "not linked" : "未连"));
    set('[data-v="i"]', en ? `${M.inbox_unacked || 0} unhandled` : `${M.inbox_unacked || 0} 条没处理`);
    set(".sy-pop .ft", en ? "Click for System status · the manager's state is in the left rail" : "点一下打开系统状态 · 管家在线看左栏");
    // phone: a strip under the header, only while disconnected
    let nb = document.getElementById("net-off");
    if (down && !nb) { nb = document.createElement("div"); nb.id = "net-off"; nb.setAttribute("role", "status"); nb.innerHTML = `<i aria-hidden="true"></i><span></span>`; document.body.appendChild(nb); }
    if (nb) nb.querySelector("span").textContent = `${en ? "Offline" : "断线"} · ${off}`;
    if (down) R.dataset.net = "off"; else delete R.dataset.net;
    clearTimeout(syncPaint.t); if (down || UI.fail) syncPaint.t = setTimeout(syncPaint, 1000);   // the seconds keep counting while offline
  }
  function renderHeader() {
    const m = mgrState(), ag = agents().filter(a => a.enabled !== false && a.id !== "manager");
    const working = ag.filter(a => a.status === "working").length;
    const c = ST.meta.comfy || {};
    syncPaint();
    const U = usage();
    const sta = $("#stamina");
    sta.className = "stamina" + (U.stale ? " stale" : "") + (U.lost5 ? " lost" : "") + (U.approx ? " est" : "");
    sta.title = U.tip;
    // Build the soul vessel once so its waves keep flowing; later renders only move the level.
    if (!sta.querySelector(".orb")) {
      const wave = "M0 0 Q10 -4 20 0 T40 0 T60 0 T80 0 T100 0 V60 H0 Z";
      sta.innerHTML = `<div class="orb"><svg viewBox="0 0 52 52"><defs><clipPath id="orbclip"><circle cx="26" cy="26" r="20"/></clipPath></defs>
        <circle class="ring2" cx="26" cy="26" r="25"/><circle class="ring" cx="26" cy="26" r="22.5"/><circle class="well" cx="26" cy="26" r="20"/>
        <g clip-path="url(#orbclip)"><g class="liq"><path class="w2" d="${wave}" transform="translate(-6 2)"/><path class="w1" d="${wave}"/></g>
        <ellipse class="shine" cx="19" cy="17" rx="6" ry="3.2" transform="rotate(-28 19 17)"/></g></svg></div>
        <div class="lbl"><b></b><small>STAMINA</small></div><div class="pct"><b></b><small></small></div><div class="focus"><i></i></div><span class="st-age" hidden></span>`;
    }
    const lvl = 46 - (Math.max(0, Math.min(100, U.left ?? 0)) / 100) * 36;  // keep a crest visible when full
    sta.querySelector(".liq").style.transform = `translateY(${lvl}px)`;
    sta.querySelector(".orb").classList.toggle("low", U.left != null && U.left < 20);
    sta.querySelector(".lbl b").textContent = UI.lang === "en" ? "Soul" : "体力";
    {   // t-m2-a ②: the % rolls when it changes (the span is kept, only its digits move)
      const pb = sta.querySelector(".pct b");
      if (U.left == null) { pb.innerHTML = "—"; delete NV.sta; }
      else { if (!pb.querySelector(".nrv")) pb.innerHTML = `<i class="ap"></i><span class="nrv"></span><small>%</small>`;
        const ap = pb.querySelector(".ap"); ap.textContent = U.approx ? (UI.lang === "en" ? "est" : "估") : ""; ap.hidden = !U.approx; roll(pb.querySelector(".nrv"), U.left, "sta"); }
    }
    const sa = sta.querySelector(".st-age");
    sa.hidden = !U.pill;
    sa.textContent = U.pill;
    sta.querySelector(".pct > small").textContent = MOBQ.matches ? U.subPh : U.sub;
    sta.querySelector(".focus").hidden = U.week == null;
    sta.querySelector(".focus i").style.width = (U.week ?? 0) + "%";
    const unread = (ST.mail || []).filter(m => !m.read).length;
    /* t-hdr-trim ①: the top bar keeps only 聊天 (narrow desktop). 舞台 / 主题 and 刷新用量 live in 设置, 报告 is a nav row.
       t-mailbox-top: 信箱 is back as a pill at the right end (desktop only; the rail row is hidden by CSS, the phone keeps it in 更多).
       The SVG is written in its serialized form (explicit closing tags) so the innerHTML compare below stays equal and the pill is not rebuilt every poll. */
    const mlab = UI.lang === "en" ? "Mailbox" : "信箱", mn = unread > 99 ? "99+" : String(unread);
    const hc = `<button data-h="mail" class="hc-mail" aria-label="${mlab}${unread ? " " + mn : ""}"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.8" y="3.2" width="12.4" height="9.6" rx="2"></rect><path d="M2.5 4.5 8 8.6l5.5-4.1"></path></svg><span>${mlab}</span>${unread ? `<span class="n">${mn}</span>` : ""}</button>`
      + `<button data-h="chat" class="hc-chat" aria-expanded="${document.body.classList.contains("chat-pop")}">${UI.lang === "en" ? "Chat" : "聊天"}</button>`;
    if ($("#hdrctrl").innerHTML.trim() !== hc) $("#hdrctrl").innerHTML = hc;
  }
  document.addEventListener("click", e => {
    const h = e.target.closest("[data-h]"); if (!h) return;
    const k = h.dataset.h;
    if (k === "theme") { UI.theme = { dark: "light", light: "white" }[UI.theme] || "dark"; LS.set("theme", UI.theme); render(); }   // D2: legacy cycle; the header picker uses [data-theme-set] (handled in mobile.js, same rt.theme key as the phone menu)
    if (k === "lang") { UI.lang = UI.lang === "zh" ? "en" : "zh"; LS.set("lang", UI.lang); render(); }
    if (k === "mail") { MB.open ? closeMailbox() : openMailbox(); }
    if (k === "chat") chatPop(!document.body.classList.contains("chat-pop"));
    if (k === "report") go("reports");
    if (k === "ping") api("ping", { note: "刷新用量" }).then(() => toast(UI.lang === "en" ? "Asked the manager to refresh usage" : "已让管家刷新用量"));   // t-settings-tab: same ping, with the note; 唤醒管家 moved to 设置 · 系统
    if (k === "wake") api("ping").then(() => toast("ping → inbox"));
  });
  $("#brand").addEventListener("click", () => go("review"));
  $("#stamina").addEventListener("click", () => modalStatus());
  $("#sync").addEventListener("click", e => { if (!e.target.closest("a,button")) modalStatus(); });

  // ---------- ticker ----------
  function tickerItems() {
    const out = [];
    const now = Date.now();
    for (const n of ST.notices || []) if (!n.until || new Date(n.until) > now) out.push({ text: n.text, level: n.level, id: n.id });
    const m = mgrState();
    if (m.sleep) out.unshift({ text: m.back ? t("mgr_sleep", { t: m.back, n: ST.meta.inbox_unacked || 0 }) : t("mgr_waking"), level: "info" });
    else if (!m.on && ST.meta.inbox_unacked) out.unshift({ text: t("mgr_offline", { n: ST.meta.inbox_unacked }), level: "urgent" });
    for (const it of items()) {
      if (it.category === "urgent" && it.stage !== "done" && it.owner === "manager") out.unshift({ text: t("no_owner_urgent", { t: it.title }), level: "urgent", item: it.id });
      if (it.stage === "review" && now - new Date(it.activity) > 864e5) out.push({ text: t("waiting_long", { t: it.title }), item: it.id });
    }
    return out;
  }
  let tickIdx = 0;
  function renderTicker() {
    const list = tickerItems();
    const el = $("#ticker");
    if (!list.length) { el.innerHTML = ""; return; }
    tickIdx %= list.length;
    const n = list[tickIdx];
    const html = `<span class="k">${UI.lang === "en" ? "Notice" : "通知"}</span><span class="msg ${n.level === "urgent" ? "urgent" : ""}" data-ti="${tickIdx}">${esc(n.text)}</span>
      ${n.id ? `<button class="dim" data-dismiss="${n.id}" title="dismiss">✕</button>` : ""}
      <span class="pager">${list.map((_, i) => `<i class="${i === tickIdx ? "on" : ""}"></i>`).join("")}</span>`;
    if (html !== renderTicker.last) { el.innerHTML = html; renderTicker.last = html; }  // re-animate only when the notice changes
    el.onclick = e => {
      const d = e.target.closest("[data-dismiss]"); if (d) return api("notice_dismiss", { id: d.dataset.dismiss });
      if (e.target.closest(".msg") && n.item) openItem(n.item);
    };
  }
  setInterval(() => { if (ST) { tickIdx++; renderTicker(); } }, 6000);

  // ---------- left ----------
  function counts() {
    const c = { review: 0 }; for (const k of CATS) c[k] = 0;
    c.pipe = items().filter(i => i.stage !== "done" && isContent(i)).length;   // t-imp-p3
    c.mail = (ST.mail || []).filter(m => !m.read).length;   /* t-hdr-trim ①: 信箱 row in the rail */
    for (const it of items()) { if (onYou(it)) c.review++; if (it.stage !== "done") c[it.category] = (c[it.category] || 0) + 1; }
    return c;
  }
  function renderLeft() {
    const c = counts();
    const navs = ["review", ...CATS, "sep", "studio", "reports", "mail", "settings"];   /* t-nav-shoot (11-05): 制作线 / 委托板 / 频道 / 素材 are one 制作 row; the pages keep their own ids */   /* t-hdr-trim ①: 信箱 moved here from the top bar (phone: same row in 更多) */   // t-settings-tab: 日志 / 文档 / 角色 moved into 设置
    const selK = STU.includes(UI.page) ? "studio" : UI.page, sew = UI.navSew !== selK; UI.navSew = selK;   /* t-thread-motif ②: the thread sews in only when the selection changes, not on every poll rebuild */
    $("#nav").innerHTML = navs.map(k => k === "sep" ? `<div class="nav-sep"></div>` :
      `<button class="nav-i ${selK === k ? "on" : ""} ${k === "urgent" && c.urgent ? "urgent" : ""}" data-go="${k}"><span>${NAV_IC[k] ? `<i class="nv-ic" aria-hidden="true"><svg viewBox="0 0 24 24">${NAV_IC[k]}</svg></i>` : ""}<span class="nv-t">${t(k)}${selK === k ? `<svg class="nv-ul${sew ? " sew" : ""}" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="M1 3.6C20 2.2 40 4.4 60 3.2S88 2.6 96 3.4"/></svg><i class="nv-knot${sew ? " sew" : ""}" aria-hidden="true"></i>` : ""}</span></span>${k === "mail" ? (c.mail ? `<span class="n mb">${c.mail > 99 ? "99+" : c.mail}</span>` : `<span class="n z"></span>`) : `<span class="n${c[k] === 0 ? " z" : ""}">${c[k] ?? ""}</span>`}</button>`).join("");

    // calendar
    const today = dayKey(new Date()), tmr = dayKey(new Date(Date.now() + 864e5));
    const evs = (ST.calendar || []).filter(e => e.date === today || e.date === tmr);
    // ri1103-P1: the team's fixed daily routines (meta.routines) join the user's own events, sorted by time; paused ones fold into one line.
    // ri1103-P2: meta.report_time comes from config.json report_time (server.py public_state); an older server sends none -> the row shows no time.
    const rts = (ST.meta && ST.meta.routines) || [], nowM = new Date().getHours() * 60 + new Date().getMinutes();
    const rtName = r => String(r.label || r.id).replace(/[（(][^）)]*[）)]/g, "").replace(/^.*?每日\s*(\d+\s*个\s*)?(一条|打磨)?/, "").replace(/^app\s*/i, "").trim() || r.id;
    const rtLeft = hm => { const [h, m] = hm.split(":").map(Number), d = h * 60 + m - nowM; return d > 0 ? `${Math.floor(d / 60)}:${pad(d % 60)}${UI.lang === "en" ? "" : " 后"}` : null; };
    const rtRow = (tm, who, name, done, itemId) => {
      const left = !done && tm && rtLeft(tm), a = who && agent(who);
      const st = done ? `✓ ${done}` : left || (tm ? (UI.lang === "en" ? "due" : "到点") : (UI.lang === "en" ? "tonight" : "今晚"));
      return { k: "0" + (tm || "99"), h: `<div class="cal-i cal-rt ${done ? "past" : ""}"${itemId ? ` data-item="${esc(itemId)}"` : ""}><span class="tm">${esc(tm || "—")}</span>${a ? av(a, "cal-av") : ""}<span class="cal-nm">${esc(name)}</span><span class="cal-st${left ? " soon" : ""}">${esc(st)}</span></div>` };
    };
    const itemOwner = id => { const it = (ST.items || []).find(x => x.id === id); return it && it.owner; };
    const rtLive = rts.filter(r => !r.paused && !r.disabled && r.time), rtOff = rts.filter(r => r.paused || r.disabled);
    const sent = UI.lang === "en" ? "sent" : "已派";
    const rtRows = rtLive.map(r => rtRow(r.time, itemOwner(r.item), rtName(r), r.last === today ? sent : "", r.item));
    if (ST.meta) rtRows.push(rtRow(ST.meta.report_time || "", "manager", UI.lang === "en" ? "Daily report" : "日报", ST.meta.last_report_date === today ? (UI.lang === "en" ? "sent" : "已发") : "", ""));
    const nowHM = `${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`;
    $("#cal").classList.toggle("cal-empty", !evs.length && !rtRows.length && !UI.calForm);   // t-cal-fold: nothing today or tomorrow -> one faint row, "+" still there
    if (!evs.length && !rtRows.length && !UI.calForm) $("#cal").innerHTML = `<div class="side-h"><span>${t("today")} · ${UI.lang === "en" ? "none" : "无"}</span><button data-cal-add>+</button></div>`;
    else $("#cal").innerHTML = `<div class="side-h"><span>${t("today")} <span class="dim" style="font-weight:400">${evs.filter(e => e.date === today).length + rtRows.length} ${t("meetings")}</span></span><button data-cal-add>${UI.calForm ? "−" : "+"}</button></div>
      ${UI.calForm ? `<form class="cal-form" id="calf"><input type="date" name="date" value="${today}"><input type="time" name="time"><input name="title" placeholder="…" required style="flex:1"><button class="btn-s">${t("add")}</button></form>` : ""}
      ${[...evs.map(e => ({ k: (e.date === tmr ? "1" : "0") + (e.time || "99"), h: `<div class="cal-i ${e.date === today && e.time && e.time < nowHM ? "past" : ""}"><span class="tm">${e.date === tmr ? "+1 " : ""}${esc(e.time || "—")}</span><span>${esc(e.title)}</span><button class="x" data-cal-del="${e.id}">✕</button></div>` })), ...rtRows].sort((x, y) => x.k < y.k ? -1 : x.k > y.k ? 1 : 0).map(x => x.h).join("")}
      ${rtOff.length ? `<div class="cal-off" title="${esc(rtOff.map(rtName).join("、"))}">${UI.lang === "en" ? "Paused" : "暂停"} ${rtOff.length}${UI.lang === "en" ? "" : " 项"} · ${esc(rtOff.map(rtName).join("、"))}</div>` : ""}
      <div class="cal-now">${nowHM}</div>`;
    const f = $("#calf");
    if (f) f.onsubmit = e => { e.preventDefault(); const fd = new FormData(f); api("calendar_add", Object.fromEntries(fd)); };

    $("#cal").classList.toggle("noev", !evs.length);   // ri1103-P1: routine rows carry their own countdown, so the clock rail stays for real events only   // t-web-audit 02: no events -> no empty time rail
    // team
    // ui1: rows animate in once (not on every poll re-render); the open chat's row is marked; unread mail shows a dot
    const teamFirst = !UI.teamIn; UI.teamIn = true; $("#team").classList.toggle("team-enter", teamFirst);
    /* t-ri1104-p2: TEAM rows use the same unread count as the chat (was: unread mail from that agent) */
    $("#team").innerHTML = `<div class="side-h"><span class="sc">TEAM</span></div>` + agents().map((a, i) => {
      const ms = a.id === "manager" && mgrState();
      const st = ms ? (ms.on ? "working" : ms.sleep ? "sleeping" : "offline") : a.status || "idle";
      const sub = mgrOnline(a) ? (MOBQ.matches ? MGR_ON() : MGR_WATCH()) : a.status === "working" && a.activity ? `▶ ${esc(a.tool ? toolWhat(a) || a.activity : a.activity)}` : esc(aduty(a));   // t-now-closed
      return `<div class="team-i ${a.status === "working" && a.activity && !mgrOnline(a) ? "busy" : ""} ${a.enabled === false ? "disabled" : ""} ${UI.chat === a.id ? "on" : ""} ${unreadOf(a.id) && UI.chat !== a.id ? "unread" : ""}" style="--i:${Math.min(i, 12)}" data-chat="${a.id}">${av(a)}<div><div class="nm"><span class="nmt">${esc(aname(a))}</span><span class="st ${st}"${ms && ms.sleep ? ` title="${esc(ms.txt)}"` : ""}>${ms ? (ms.on ? t("online") : ms.sleep ? (ms.back ? `☾ ${ms.back}` : ms.txt) : t("offline")) : t(st)}</span>${unreadOf(a.id) && UI.chat !== a.id ? `<i class="tn">${unreadTag(unreadOf(a.id))}</i>` : ""}</div><div class="du">${qBadge(a.id)}${sub}</div></div></div>`;   /* t-hdr-trim ⑩: 排队 chip leads the second line, so name + status + count fit one line in zh and en */
    }).join("");
  }
  document.addEventListener("click", e => {
    const g = e.target.closest("[data-go]"); if (g) { go(g.dataset.go); return; }
    const ch = e.target.closest("[data-chat]"); if (ch) { setChat(ch.dataset.chat); if (NARROWQ.matches && !MOBQ.matches) chatPop(true); return; }
    if (e.target.closest("[data-cal-add]")) { UI.calForm = !UI.calForm; renderLeft(); return; }
    const cd = e.target.closest("[data-cal-del]"); if (cd) { api("calendar_del", { id: cd.dataset.calDel }); return; }
    const oi = e.target.closest("[data-item]"); if (oi && !e.target.closest("button")) { openItem(oi.dataset.item); return; }
  });
  const SET_TABS = ["general", "roles", "docs", "logs", "system"];
  /* t-nav-shoot: the 制作 / Studio group. Each sub page keeps its id (#page=pipe etc. still work, wide layout unchanged); "studio" opens the last one used. */
  const STU = ["pipe", "board", "channels", "assets"];
  const STU_L = { pipe: ["制作线", "Pipeline"], board: ["委托板", "Board"], channels: ["频道", "Channels"], assets: ["素材", "Assets"] };
  /* t-thread-motif: left rail icons (work/t-thread-motif/icons, 24 grid, stroke = currentColor); shown only under 特典 and only on desktop (CSS) */
  const NAV_IC = {
    review: '<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-3.2a2 2 0 0 1 4 0V20"/>',
    main: '<path d="M7 6.5V13a5 5 0 0 0 10 0V6"/><circle cx="17" cy="4.2" r="1.7" fill="currentColor" stroke="none"/><path d="M3.5 13h17"/>',
    side: '<path d="M7 20.5V5.5"/><circle cx="7" cy="3.6" r="1.6" fill="currentColor" stroke="none"/><path d="M7 16c0-4.4 2.8-7 7-7h2.5"/><circle cx="18.6" cy="9" r="1.6" fill="currentColor" stroke="none"/>',
    daily: '<rect x="4" y="5.5" width="16" height="14.5" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/><path d="M10.2 12.6l3.6 3.6M13.8 12.6l-3.6 3.6"/>',
    urgent: '<circle cx="15" cy="9" r="3.6" fill="currentColor"/><path d="M12.4 11.6 4.5 19.5"/>',
    ongoing: '<path d="M12 12c-2-3-3.8-4.5-6-4.5a4.5 4.5 0 0 0 0 9c2.2 0 4-1.5 6-4.5s3.8-4.5 6-4.5a4.5 4.5 0 0 1 0 9c-2.2 0-4-1.5-6-4.5z"/>',
    studio: '<path d="M3 9.8A1.8 1.8 0 0 1 4.8 8h2.4l1.6-2.5h6.4L16.8 8h2.4A1.8 1.8 0 0 1 21 9.8v8.4a1.8 1.8 0 0 1-1.8 1.8H4.8A1.8 1.8 0 0 1 3 18.2z"/><circle cx="12" cy="13.6" r="3.4"/><path d="M12 13.6v.01"/>',
    reports: '<path d="M6 3.5h8l4.5 4.5v12.5H6z"/><path d="M14 3.5V8h4.5"/><path d="M8.6 17l2.4-3 2 1.6 2-2.6"/>',
    mail: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3.8 7.2l8.2 6.3 8.2-6.3"/>',
    settings: '<path d="M3.5 8h3.2M11.3 8h9.2M3.5 16h9.2M17.3 16h3.2"/><circle cx="9" cy="8" r="2.3"/><circle cx="15" cy="16" r="2.3"/>',
  };
  function stuTabs(k) {   /* same segmented control as 设置 */
    const en = UI.lang === "en";
    return `<div class="st-tabs stu-tabs"><div class="seg" data-seg="stutab" role="tablist">${STU.map(x => `<button type="button" class="seg-i ${x === k ? "on" : ""}" role="tab" aria-selected="${x === k}" data-stutab="${x}">${STU_L[x][en ? 1 : 0]}</button>`).join("")}</div></div>`;
  }
  const pageAlias = p => { if (p === "studio") { const l = LS.get("stuTab", "pipe"); return STU.includes(l) ? l : "pipe"; } if (["roles", "docs", "logs"].includes(p)) { UI.setTab = p; LS.set("setTab", p); return "settings"; } return p === "home" ? "review" : p; };   // t-settings-tab: old pages = 设置 tabs   // r-improve-1102 P5: #page=home (the phone 首页 tab's name) = the 首页 page, key "review"
  function go(p) {
    p = pageAlias(p);
    // the "new" group on the review page compares against when you last left it
    if (UI.page === "review" && p !== "review") { UI.seen.review = new Date().toISOString(); LS.set("seen", UI.seen); }
    if (STU.includes(p)) LS.set("stuTab", p);
    UI.page = p; LS.set("page", p); closeItem(true); renderLeft(); renderPage(true);
    window.FX && FX.enter($("#pagebody"));
  }

  // ---------- pages ----------
  // t-visual-ink: date eyebrow above every page title (hidden unless html[data-skin="ink"])
  function inkEb(right) { const d = new Date(), en = UI.lang === "en";
    const day = en ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", weekday: "short" }) : `${d.getMonth() + 1}月${d.getDate()}日 · 周${"日一二三四五六"[d.getDay()]}`;
    return `<div class="ink-eb">${day}<i></i>${right}</div>`; }
  function pageHead(k, extra = "") {
    if (UI.noHead) return extra;   // t-settings-tab: a page drawn inside a 设置 tab keeps its bars, not its masthead
    if (STU.includes(k)) return `<div class="ph ph-studio ph-${k}">${inkEb("Underthread")}<h1>${t("studio")}</h1>${UI.lang === "zh" ? `<div class="en">${EN_SUB.studio}</div>` : ""}${orn()}</div>${stuTabs(k)}${extra}`;   // t-nav-shoot
    return `<div class="ph ph-${k}">${inkEb("Underthread")}<h1>${t(k)}</h1>${UI.lang === "zh" ? `<div class="en">${EN_SUB[k] || ""}</div>` : ""}${orn()}</div>${extra}`;
  }
  function card(it) {
    const a = agent(it.owner), ws = workersOf(it.id);
    const kind = it.stage === "review" || awaitsUser(it) ? (it.kind === "task" ? "deliverable" : it.kind) : null;
    return `<div class="card${ws.length ? " wk-on" : ""}" data-item="${it.id}"${wkAttr(ws)}>${wkFx(ws)}
      <div class="meta">${kind ? `<span class="tag ${kind}"><span class="gl" aria-hidden="true">◆</span>${t(kind)}</span>${waitTag(it)}` : `<span class="tag">${rtTag(it) || (idleDoing(it) ? pauseL() : stageLabel(it.stage))}</span>`}
        <span>${t(it.category)}${it.category === "urgent" ? " ⚑" : ""}</span>
        <span>${whenH(it.created)}</span><span class="dim">${UI.lang === "en" ? "act." : "动态"} ${whenH(it.activity)}</span>
        <span>${(it.platforms || []).map(p => `<span class="tag pf">${PLAT[p] || p}</span>`).join(" ")}</span></div>
      <div class="body"><h3>${nrDot(it.id)}${esc(it.title)}</h3><p>${esc(it.summary || "")}</p>${wkTag(ws)}${askRow(it)}</div>
      <div class="owner">${av(a, "sm", it.id)}<span>${esc(aname(a))}</span></div>
      <div class="acts"><button data-arch="${it.id}">${t("archive")}</button>${it.stage !== "done" && !routineOf(it) ? `<button data-quickdone="${it.id}">${t("complete")}</button>` : ""}</div></div>`;
  }

  // ===== p3 (t-slack-p3): Slack-Activity-style list rows on phones (<=760px). Desktop keeps .card / .mail-i. =====
  const MOBQ = matchMedia("(max-width: 760px)");
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  UI.mailUnread = lsGet("rt.mailUnread", false) === true;
  function actRow(o) {   // one shared row: avatar (+unread dot) | name + title ... time | preview ... chips
    const ws = o.ws || [];
    return `<div class="act-row ${o.unread ? "unread" : ""}${ws.length ? " wk-on" : ""}" ${o.attr}${wkAttr(ws)}>${wkFx(ws)}
      <span class="act-av">${o.av}${o.unread ? `<i class="act-dot"></i>` : ""}</span>
      <div class="act-main">
        <div class="act-l1"><b class="act-nm">${esc(o.name)}</b>${o.title ? `<span class="act-ti">${esc(o.title)}</span>` : ""}<time class="act-tm">${o.time}</time></div>
        <div class="act-l2"><span class="act-pv">${esc(o.preview)}</span>${ws.length ? wkTag(ws) : o.chip ? `<span class="act-chip">${esc(o.chip)}</span>` : ""}${o.extra || ""}${o.n > 1 ? `<span class="act-n ${o.unread ? "on" : ""}">${o.n > 99 ? "99+" : o.n}</span>` : ""}</div>
      </div></div>`;
  }
  function reviewRow(it, fresh) {
    const a = agent(it.owner), th = (it.thread || []).filter(x => x.kind !== "event").length;
    return actRow({ attr: `data-item="${it.id}"`, av: av(a, "", it.id), ws: workersOf(it.id), unread: fresh, name: aname(a), title: it.title, time: agoH(it.activity || it.updated),
      preview: it.summary || "", chip: rowLabel(it), n: th, extra: waitTag(it) });
  }
  // ===== P5 (t-aes-p5): phone home 待审 = a review card per item: first image on top, owner + time, title, summary, 看详情 / 批准.
  // 批准 only where the detail page has it (stage review AND kind plan / deliverable); questions and other kinds get 看详情 only.
  // A tap on 批准 is held for RV_HOLD ms behind an undo pill before the same POST /api/action {kind:"approve"} the detail page sends.
  const RV = { pending: null, timer: 0 }, RV_HOLD = 4500;
  const rvCanApprove = it => !!it && it.stage === "review" && (it.kind === "plan" || it.kind === "deliverable");
  function reviewCard(it, fresh) {
    const a = agent(it.owner), zh = UI.lang !== "en";
    const img = (it.draft_attachments && it.draft_attachments.length ? it.draft_attachments : it.attachments || []).find(p => /^(uploads|work)\/.+\.(png|jpe?g|webp|gif)$/i.test(p));
    const kind = it.kind === "plan" ? (zh ? "方案" : "Plan") : it.kind === "question" ? (zh ? "问题" : "Question") : (zh ? "交付" : "Delivery");
    const u = img && "/" + img.split("/").map(encodeURIComponent).join("/");
    const media = img ? `<div class="rv-media"><img src="/api/thumb?p=${encodeURIComponent(img)}&w=780" alt="" loading="lazy" onerror="if(!this.dataset.f){this.dataset.f=1;this.src='${u}'}else{this.parentNode.remove()}"><span class="rv-kind">${kind}</span></div>` : "";
    const ok = rvCanApprove(it);
    return `<div class="rv-card${img ? "" : " no-img"}" data-item="${it.id}">${media}<div class="rv-body">
      <div class="rv-meta">${av(a, "sm", it.id)}<b>${esc(aname(a))}</b>${fresh ? `<i class="rv-dot"></i>` : ""}<span>· ${t(it.category)} · ${agoH(it.activity || it.updated)}</span>${waitTag(it)}${img ? "" : `<span class="rv-kind sm">${kind}</span>`}</div>
      <h3>${nrDot(it.id)}${esc(it.title)}</h3>${it.summary ? `<p>${esc(it.summary)}</p>` : ""}${askRow(it)}
      <div class="rv-acts${ok ? "" : " one"}"><button class="rv-open" data-rv-open="${it.id}">${zh ? "看详情" : "Open"}</button>${ok ? `<button class="rv-ok${openAsks(it).length ? " has-ask" : ""}" data-rv-ok="${it.id}">${okBtnIn(it)}</button>` : ""}</div>
    </div></div>`;
  }
  // ===== t-imp-p1: 等你拍板 = review items + waiting items whose open draft is a plan or a question (the owner is waiting on the user).
  // Shown as compact rows under the review cards; when nothing is waiting on review, the page shows 此刻 (who is working on what) and 今天交付.
  const awaitsUser = it => !!it && it.stage === "waiting" && (it.kind === "plan" || it.kind === "question");
  // t-wait-days: a card on the user (review, or waiting on a plan / question) for more than 24 h gets an amber 「等了 N 天」 tag (same idea as 暂停).
  // The wait starts at the last 提交审核 event in the thread; no such event -> it.updated.
  const waitSince = it => { const th = it.thread || []; for (let i = th.length - 1; i >= 0; i--) if (th[i].kind === "event" && /^提交审核/.test(th[i].text || "")) return th[i].t; return it.updated; };
  function waitTag(it) { return snzWas(it) + waitTag0(it); }
  const snzWas = it => it && it.snoozed && !snoozed(it) ? `<span class="snz-was" title="${UI.lang === "en" ? "Came back from Later" : "之前点过稍后，到点回来了"}">${UI.lang === "en" ? "Snoozed" : "推迟过"}</span>` : "";   // ri1103-P2
  function waitTag0(it) {
    if (!it || !(it.stage === "review" || awaitsUser(it))) return "";
    const h = (Date.now() - new Date(waitSince(it))) / 36e5; if (!(h >= 24)) return "";
    const d = Math.floor(h / 24); return `<span class="wait-d">${UI.lang === "en" ? `Waiting ${d}d` : `等了 ${d} 天`}</span>`;
  }
  // ===== t-open-questions: it.asks = questions for the user with clickable options (stateutil ask / upsert-item --ask). An older server sends no asks: nothing shows. =====
  const liveAsks = it => ((it && it.asks) || []).filter(a => !a.closed);
  const openAsks = it => liveAsks(it).filter(a => !a.answer);
  // t-btn-names: the approve button is named by what happens after the press (plan -> back to doing, the specialist goes on;
  // deliverable -> the card closes; question -> the answer is recorded). Only labels: the action kinds (approve / done) are unchanged.
  const okLabel = (it, en = UI.lang === "en") => it && it.kind === "plan" ? (en ? "Approve & start" : "批准开工") : it && it.kind === "question" ? (en ? "Answer" : "回答") : (en ? "Accept & close" : "验收 · 关单");
  const okDone = (it, en = UI.lang === "en") => it && it.kind === "plan" ? (en ? "Approved · work begins" : "已批准开工 · 专员接着做") : it && it.kind === "question" ? (en ? "Answered" : "已回答") : (en ? "Accepted · card closed" : "已验收 · 卡已关");
  const askLeft = (it, en = UI.lang === "en") => { const n = openAsks(it).length; return !n ? "" : en ? `${n} question${n > 1 ? "s" : ""} unanswered` : `还有 ${n} 个问题没答`; };
  // ===== t-ask-rec: the asker's recommended option = ask.rec (written as "B*" in stateutil), else an option whose text says （推荐） (older asks).
  // 「全按推荐」 shows when 2+ asks are open and at least one has a recommendation; it answers those after a 4.5 s undo hold, one ordinary answer each.
  const REC_TXT = /[（(]\s*推荐/;
  const recOf = a => (a && a.rec && a.options.includes(a.rec)) ? a.rec : ((a && a.options) || []).find(o => REC_TXT.test(o)) || null;
  // t-opt-star: chat quick-reply chips. "B*" marks the manager's recommendation (same convention as --ask): the * is never shown or sent;
  // the starred chip gets the 推荐 outline + badge. An option whose text already says （推荐） gets the outline only.
  const optChips = (opts, mid) => { const clean = o => String(o).replace(/\s*[*＊]\s*$/, ""); const star = opts.find(o => /[*＊]\s*$/.test(o)); const rec = star || opts.find(o => REC_TXT.test(o)) || null;
    return `<div class="opts">${opts.map(o => { const c = clean(o), r = o === rec; return `<button class="btn-s${r ? " rec" : ""}" data-opt="${esc(c)}"${mid ? ` data-mid="${esc(mid)}"` : ""}>${esc(c)}${r && !REC_TXT.test(c) ? `<i class="rec-b">${UI.lang === "en" ? "Rec." : "推荐"}</i>` : ""}</button>`; }).join("")}</div>`; };
  // r-improve-1102 P2: a card chip wrapped in full-width brackets 「（chip）」 already reads as a bracket; drop the pair so the line does not break three ways
  const CHIP_RE = '<span class="idc[^"]*"[^>]*>(?:(?!<\\/span>)[\\s\\S])*<\\/span>';
  const chipParens = h => String(h).replace(new RegExp(`（\\s*(${CHIP_RE})\\s*）`, "g"), " $1 ")
    .replace(new RegExp(`(${CHIP_RE})\\s*([。，、；：！？」』]+)`, "g"), '<span class="idc-nw">$1$2</span>');   // punctuation stays on the chip's line
  const optDone = (opts, said, at) => {   // r-improve-1102 P1; t-option-quote: at = time of the quoting reply
    const norm = x => String(x || "").replace(/\s*[*＊]\s*$/, "").replace(/\s+/g, " ").trim(), s = norm(said), en = UI.lang === "en";
    const hit = opts.map(norm).find(o => o && (s === o || s.startsWith(o)));
    return `<div class="opt-done">${hit ? (en ? `✓ You chose “${esc(hit)}”` : `✓ 你选了「${esc(hit)}」`) : (en ? "Replied" : "已回复")}${hit && at ? ` · ${whenH(at)}` : ""}</div>`;
  };
  const AR = { pending: null, timer: 0 };   // pending = { id, picks: [{ ask, opt }] }
  const arPick = (id, askId) => { const p = AR.pending; return p && p.id === id ? (p.picks.find(x => x.ask === askId) || {}).opt : undefined; };
  function arButton(it) {
    const oa = openAsks(it), n = oa.filter(a => recOf(a)).length, zh = UI.lang !== "en";
    if (oa.length < 2 || !n || it.stage === "done" || (AR.pending && AR.pending.id === it.id)) return "";
    return `<button type="button" class="ask-allrec" data-ask-allrec="${esc(it.id)}">${zh ? `全按推荐（${n}）` : `Use recommended (${n})`}</button>`;
  }
  function arCommit(keepalive) {
    const P = AR.pending; if (!P) return;
    clearTimeout(AR.timer); AR.pending = null; arHide();
    if (keepalive) { P.picks.forEach(x => { try { fetch("/api/action", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "answer", item: P.id, ask: x.ask, opt: x.opt }) }); } catch (e) { } }); return; }
    const zh = UI.lang !== "en";
    P.picks.reduce((q, x) => q.then(() => api("answer", { item: P.id, ask: x.ask, opt: x.opt })), Promise.resolve())
      .then(() => toast(zh ? `已按推荐答了 ${P.picks.length} 题` : `${P.picks.length} answered as recommended`))
      .catch(() => { if (UI.item === P.id) renderDrawer(); });
  }
  function arHide() { const b = document.getElementById("ar-undo"); if (b && !b.hidden) { b.classList.remove("on"); clearTimeout(b._h); b._h = setTimeout(() => { b.hidden = true; }, 260); } }
  function arStart(id) {
    const it = ST.items.find(i => i.id === id); if (!it) return;
    if (AR.pending) arCommit();
    const picks = openAsks(it).map(a => ({ ask: a.id, opt: recOf(a) })).filter(x => x.opt); if (!picks.length) return;
    AR.pending = { id, picks }; const zh = UI.lang !== "en";
    if (UI.item === id) renderDrawer();
    let b = document.getElementById("ar-undo");
    if (!b) { b = document.createElement("div"); b.id = "ar-undo"; b.setAttribute("role", "status"); b.hidden = true; document.body.appendChild(b); }
    b.innerHTML = `<span class="rv-u-tx"><b>${zh ? `按推荐答 ${picks.length} 题` : `${picks.length} answered as recommended`}</b>${zh ? "4.5 秒后发出" : "sending in 4.5 s"}</span><button type="button" data-ar-undo>${zh ? "撤销" : "Undo"}</button><i class="rv-u-bar" style="--hold:${RV_HOLD}ms"></i>`;
    clearTimeout(b._h); b.hidden = false; void b.offsetWidth; b.classList.add("on");
    clearTimeout(AR.timer); AR.timer = setTimeout(() => arCommit(), RV_HOLD);
  }
  function arUndo() { const P = AR.pending; if (!P) return; clearTimeout(AR.timer); AR.pending = null; arHide(); if (UI.item === P.id) renderDrawer(); }
  const okBtnIn = it => { const l = askLeft(it); return `<b>${okLabel(it)}</b>${l ? `<small class="ok-ask">${l}</small>` : ""}`; };   // label + the open-question line under it
  function askChips(it, a, cls = "") {
    const done = it.stage === "done", zh = UI.lang !== "en";
    const rec = !a.answer && recOf(a), pend = arPick(it.id, a.id);   // t-ask-rec
    return `<div class="ask-opts${cls}">${a.options.map(o => `<button type="button" class="ask-o${(a.answer ? a.answer.opt === o : pend === o) ? " on" : ""}${rec === o ? " rec" : ""}" data-ask-opt="${esc(o)}" data-ask="${esc(a.id)}" data-ask-item="${esc(it.id)}"${done ? " disabled" : ""}>${esc(o)}${rec === o && !REC_TXT.test(o) ? `<i class="rec-b">${zh ? "推荐" : "Rec."}</i>` : ""}</button>`).join("")}${a.other !== false && !done ? `<button type="button" class="ask-o ghost" data-ask-other="${esc(a.id)}" data-ask-item="${esc(it.id)}">${zh ? "其他…" : "Other…"}</button>` : ""}</div>`;
  }
  function askCard(it, a, n) {
    const zh = UI.lang !== "en", by = aname(agent(a.by || it.owner));
    const ans = a.answer ? `<div class="ask-a">${zh ? `你选了「${esc(a.answer.opt)}」· ${when(a.answer.t)} · 已转给${esc(by)}${it.stage !== "done" ? " · 点别的选项可以改选" : ""}` : `You chose “${esc(a.answer.opt)}” · ${when(a.answer.t)} · sent to ${esc(by)}`}</div>` : "";
    return `<div class="ask${a.answer ? " done" : ""}" data-askq="${esc(a.id)}"><div class="ask-q"><span class="n">${a.answer ? "✓" : n}</span><span>${esc(a.q)}</span></div>${askChips(it, a)}${ans}</div>`;
  }
  function askBlock(it) {
    const all = liveAsks(it); if (!all.length) return "";
    const n = openAsks(it).length, zh = UI.lang !== "en"; let i = 0;
    const arb = arButton(it);   // t-ask-rec
    const head = `<div class="sec-h ask-h${n ? " on" : ""}"><i></i>${zh ? `要你拿主意 · ${n ? `还剩 ${n} 个` : "都答了"}` : `Your call · ${n ? `${n} open` : "all answered"}`}${arb}</div>${arb ? `<div class="ask-recnote">${zh ? "带「推荐」的是提问人给的建议。点「全按推荐」一次答完，再单独改不同意的几题。" : "Marked options are the asker's recommendation. Use them all at once, then change any you disagree with."}</div>` : ""}`;
    const list = `<div class="ask-list">${all.map(a => askCard(it, a, a.answer ? 0 : ++i)).join("")}</div>`;
    if (n) return head + list;
    // t-ui-next 1: every question answered -> one summary row (tap to expand and change a pick); the open state survives poll re-renders
    const open = DW.askOpen.has(it.id), picks = all.map(a => a.answer.opt).join(" · ");
    return `${head}<button type="button" class="uin-asum${open ? " open" : ""}" data-uin-asks aria-expanded="${open}"><b>${zh ? `${all.length} 个问题都答了` : `${all.length} answered`}</b><span class="p">${esc(picks)}</span><span class="t">${open ? (zh ? "收起 ▴" : "Hide ▴") : (zh ? "展开 ▾" : "Show ▾")}</span></button>${open ? list : ""}`;
  }
  function askRow(it) {   // list cards: the first open question with its options, answerable in place
    const oa = openAsks(it); if (!oa.length) return "";
    const zh = UI.lang !== "en", a = oa[0];
    return `<div class="ask-row"><div class="ask-rt"><i></i><b>${zh ? `${oa.length} 个问题要你选` : `${oa.length} question${oa.length > 1 ? "s" : ""} for you`}</b><span> · ${esc(a.q)}</span></div>${askChips(it, a, " sm")}${oa.length > 1 ? `<span class="ask-more">+${oa.length - 1}</span>` : ""}</div>`;
  }
  const AG = { draw: null };
  // approve / done while questions are open: a sheet lists them (answerable in place); 跳过 sends skip_asks so the server lets it through and logs what was skipped
  function askGuard(id, k, proceed) {
    const it = ST.items.find(i => i.id === id);
    if (!openAsks(it).length) return proceed(false);
    const zh = UI.lang !== "en", verb = k === "approve" ? (zh ? okLabel(it, false) : okLabel(it, true).toLowerCase()) : (zh ? "完成" : "mark done");
    const draw = m => {
      const cur = ST.items.find(i => i.id === id) || it, oa = openAsks(cur); let i = 0;
      m.innerHTML = oa.length
        ? `<h2>${zh ? `还有 ${oa.length} 个问题没回答` : `${oa.length} question${oa.length > 1 ? "s" : ""} still open`}</h2><p class="ask-gp">${zh ? `${esc(aname(agent(cur.owner)))}在这张单子里问了你。可以现在点选；也可以跳过直接${verb}，跳过的问题会记在动态里，管家会转成后续单子。` : `Answer here, or skip and ${verb}: skipped questions are logged and the manager follows up.`}</p>
           <div class="ask-list">${oa.map(a => askCard(cur, a, ++i)).join("")}</div>
           <div class="foot"><button class="btn" data-ag-skip>${zh ? `跳过，直接${verb}` : `Skip, ${verb}`}</button><button class="btn primary" data-ag-first>${zh ? "先回答" : "Answer first"}</button></div>`
        : `<h2>${zh ? "问题都回答了" : "All answered"}</h2><p class="ask-gp">${zh ? `可以${verb}了。` : `Ready to ${verb}.`}</p>
           <div class="foot"><button class="btn" data-ag-x>${zh ? "取消" : "Cancel"}</button><button class="btn primary" data-ag-go>${zh ? verb : "Go"}</button></div>`;
      const q = sel => m.querySelector(sel);
      if (q("[data-ag-skip]")) q("[data-ag-skip]").onclick = () => { closeModal(); proceed(true); };
      if (q("[data-ag-first]")) q("[data-ag-first]").onclick = () => { closeModal(); if (UI.item === id) { const l = $("#drawer .ask-list"); if (l) l.scrollIntoView({ behavior: "smooth", block: "center" }); } else openItem(id); };
      if (q("[data-ag-go]")) q("[data-ag-go]").onclick = () => { closeModal(); proceed(false); };
      if (q("[data-ag-x]")) q("[data-ag-x]").onclick = closeModal;
    };
    openModal("", m => { m.classList.add("ask-guard"); AG.draw = () => draw(m); draw(m); });
  }
  document.addEventListener("click", e => {   // capture: a chip inside a card must not also open the card
    const o = e.target.closest("[data-ask-opt]"), x = !o && e.target.closest("[data-ask-other]");
    if (!o && !x) return;
    e.stopPropagation(); e.preventDefault();
    const el = o || x, id = el.dataset.askItem, it = ST.items.find(i => i.id === id); if (!it) return;
    const a = (it.asks || []).find(q => q.id === (o ? o.dataset.ask : x.dataset.askOther)); if (!a) return;
    const zh = UI.lang !== "en";
    if (o) {
      if (AR.pending && AR.pending.id === id) AR.pending.picks = AR.pending.picks.filter(x => x.ask !== a.id);   // t-ask-rec: a hand pick during the hold wins over the recommendation
      if (o.disabled || (a.answer && a.answer.opt === o.dataset.askOpt)) return;
      o.parentElement.querySelectorAll(".ask-o.on").forEach(b => b.classList.remove("on")); o.classList.add("on");   // instant; the poll then redraws from the stored answer
      api("answer", { item: id, ask: a.id, opt: o.dataset.askOpt })
        .then(() => { toast(zh ? `已回答 · 转给${aname(agent(a.by || it.owner))}` : `Answered · sent to ${aname(agent(a.by || it.owner))}`); if (AG.draw && !$("#modal").hidden && $("#modal .ask-guard")) AG.draw(); })
        .catch(() => o.classList.remove("on"));
      return;
    }
    if (!$("#modal").hidden) closeModal();   // 其他…: write it in the detail composer, addressed to whoever asked
    const fill = () => { const ta = $("#drawer .composer textarea"); if (!ta) return; ta.value = `@${aname(agent(a.by || it.owner))} ${zh ? `关于「${a.q}」：` : `re “${a.q}”: `}`; ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); ta.dispatchEvent(new Event("input", { bubbles: true })); };
    if (UI.item !== id) { openItem(id); setTimeout(fill, 450); } else fill();
  }, true);
  const decisions = () => items().filter(onYou).filter(awaitsUser).sort(byAct);
  function decHead(nRev, dec) {
    const zh = UI.lang !== "en", np = dec.filter(i => i.kind === "plan").length, nq = dec.length - np;
    const parts = zh ? [`审核 ${nRev}`, np && `方案 ${np}`, nq && `问题 ${nq}`] : [`review ${nRev}`, np && `plans ${np}`, nq && `questions ${nq}`];
    return `<div class="dc-h">${zh ? "等你拍板" : "Waiting on you"}<small>${nRev + dec.length}</small><span class="r">${parts.filter(Boolean).join(" · ")}</span></div>`;
  }
  function decRow(it) {
    const a = agent(it.owner), zh = UI.lang !== "en", plan = it.kind === "plan";
    const what = plan ? (zh ? "方案待批" : "Plan to approve") : (zh ? "问题待答" : "Question for you");
    return `<div class="dc-row" data-item="${it.id}">${av(a, "", it.id)}<div class="dc-main"><div class="dc-t">${esc(it.title)}</div>
      <div class="dc-s">${what} · ${esc(aname(a))} · ${agoH(it.activity || it.updated)}${waitTag(it)}${openAsks(it).length ? ` · <b class="ask-n">${zh ? `${openAsks(it).length} 个问题要你选` : `${openAsks(it).length} to answer`}</b>` : ""}</div></div>
      <button class="dc-btn${plan ? "" : " g"}" data-rv-open="${it.id}">${plan ? (zh ? "看方案" : "Review") : (zh ? "去回答" : "Answer")}</button></div>`;
  }
  const DC_KIND = { plan: '<path d="M5 4h10l4 4v12H5z"/><path d="M9 12h6M9 16h4"/>', deliverable: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    question: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.4M12 16.8v.2"/>', task: '<rect x="5" y="5" width="14" height="14" rx="3"/><path d="M9 12h6"/>' };
  // t-now-always: 此刻 is its own block, shown under the review cards on the phone-like home whether or not anything waits on you;
  // 今天交付 still only shows when nothing waits (todayBlock = 此刻 + 今天交付).
  function todayBlock() { return nowBlock() + shipBlock(); }
  function nowBlock() {
    const zh = UI.lang !== "en";
    const all = agents().filter(a => a.enabled !== false && a.status === "working"), ws = all.filter(a => !mgrOnline(a)), on = all.filter(mgrOnline);
    const now = ws.map(a => {
      const it = liveItem(a);
      return `<div class="dc-row${it ? "" : " plain"}"${it ? ` data-item="${it.id}"` : ""}>${av(a, "", it && it.id)}<div class="dc-main">
        <div class="dc-t">${esc(aname(a))}${it ? ` · ${esc(it.title)}` : ""}</div>
        <div class="dc-s">${esc(a.activity || (zh ? "工作中" : "Working"))}${a.since ? ` · <time class="wk-el" data-fmt="dc" data-since="${esc(a.since)}">${dcDur(a.since)}</time>` : ""}</div>
        <i class="dc-bar" aria-hidden="true"><u style="animation-delay:-${Date.now() % 2400}ms"></u></i></div></div>`;
    }).join("") + (ws.length ? "" : `<div class="dc-quiet">${zh ? "都在休息" : "Everyone is resting"}</div>`) + on.map(a => `<div class="dc-row plain dc-on">${av({ ...a, status: "online" })}<div class="dc-main"><div class="dc-t">${esc(aname(a))}</div><div class="dc-s">${MGR_ON()}</div></div></div>`).join("")
;   // t-now-always: nobody working = one faint line (above the manager's online row, as before), not an empty box
    return `<div class="dc-h">${zh ? "此刻" : "Right now"}<small>${ws.length ? (zh ? `${ws.length} 人在做` : `${ws.length} working`) : ""}</small></div>${now}`;
  }
  function shipBlock() {
    const zh = UI.lang !== "en", its = items(), today = dayKey(new Date());
    const done = its.filter(i => i.stage === "done" && i.closed && dayKey(new Date(i.closed)) === today).sort((x, y) => (y.closed || "").localeCompare(x.closed || ""));
    // t-home-nopic (option C): a card with an image keeps its cover; a card without one has no cover and is drawn compact (kind icon + label + time + small
    // avatar, then a 2-line title). Pairing walks the newest-first list: two CONSECUTIVE no-image cards share one column (upper = newer); a no-image card whose
    // neighbour has an image stays alone in its own column, top-aligned. So the reading order (column by column, top then bottom) is exactly the time order.
    const ship = [];
    done.forEach(it => {
      const img = (it.draft_attachments && it.draft_attachments.length ? it.draft_attachments : it.attachments || []).find(p => /^(uploads|work)\/.+\.(png|jpe?g|webp|gif)$/i.test(p));
      const a = agent(it.owner);
      if (img) return ship.push(`<div class="dc-sh" data-item="${it.id}"><div class="im" style="background-image:url('/api/thumb?p=${encodeURIComponent(img)}&w=320')"></div><b>${esc(it.title)}</b><span>${esc(aname(a))} · ${hm(it.closed)}</span></div>`);
      const k = DC_KIND[it.kind] ? it.kind : "task";
      const card = `<div class="dc-sh c" data-item="${it.id}"><div class="k"><svg viewBox="0 0 24 24" aria-hidden="true">${DC_KIND[k]}</svg>${esc(t("k_" + k))} · ${hm(it.closed)}${a ? `<i class="mav" style="background-image:url('${avatarUrl(a)}')" title="${esc(aname(a))}"></i>` : ""}</div><b>${esc(it.title)}</b></div>`;
      const last = ship[ship.length - 1];
      if (last && last.open) { last.push(card); last.open = false; } else { const col = [card]; col.open = true; ship.push(col); }
    });
    const shipHtml = ship.map(c => Array.isArray(c) ? `<div class="dc-col${c.length < 2 ? " one" : ""}">${c.join("")}</div>` : c).join("");
    return `<div class="dc-h">${zh ? "今天交付" : "Shipped today"}<small>${done.length}</small></div>${done.length ? `<div class="dc-ship">${shipHtml}</div>` : `<div class="dc-none">${zh ? "今天还没有交付。" : "Nothing shipped yet today."}</div>`}`;
  }
  const rvEase = "cubic-bezier(.32, .72, 0, 1)";   // = --m-ease-ios (WAAPI cannot read the CSS variable)
  const rvReduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  function rvCollapse(el, done) {   // card folds away: lift + fade, then the height closes so the cards below glide up
    if (!el || rvReduce()) { if (el) el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: "forwards" }).onfinish = done; else done(); return; }
    const h = el.offsetHeight, cs = getComputedStyle(el), mt = cs.marginTop, mb = cs.marginBottom;
    el.style.overflow = "hidden"; el.style.pointerEvents = "none";
    el.animate([{ transform: "none", opacity: 1 }, { transform: "translateY(-6px) scale(.96)", opacity: 0 }], { duration: 260, easing: rvEase, fill: "forwards" });
    el.animate([{ height: h + "px", marginTop: mt, marginBottom: mb }, { height: "0px", marginTop: "0px", marginBottom: "0px" }], { duration: 330, delay: 170, easing: rvEase, fill: "forwards" }).onfinish = done;
  }
  function rvExpand(el) {   // undo: the card opens back in place
    if (!el) return;
    if (rvReduce()) { el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 }); return; }
    const h = el.offsetHeight, cs = getComputedStyle(el);
    el.style.overflow = "hidden";
    const a = el.animate([{ height: "0px", marginTop: "0px", marginBottom: "0px", opacity: 0, transform: "scale(.96)" },
      { height: h + "px", marginTop: cs.marginTop, marginBottom: cs.marginBottom, opacity: 1, transform: "none" }], { duration: 420, easing: "cubic-bezier(.2, .8, .2, 1)" });
    a.onfinish = () => { el.style.overflow = ""; };
  }
  function rvUndoBar() {
    let b = document.getElementById("rv-undo");
    if (!b) { b = document.createElement("div"); b.id = "rv-undo"; b.setAttribute("role", "status"); b.hidden = true; document.body.appendChild(b); }
    return b;
  }
  function rvHideBar() { const b = document.getElementById("rv-undo"); if (b && !b.hidden) { b.classList.remove("on"); clearTimeout(b._h); b._h = setTimeout(() => { b.hidden = true; }, 260); } }
  function rvCommit(keepalive) {   // send the held approve; the same server action and payload as the detail page's 批准
    const id = RV.pending; if (!id) return;
    clearTimeout(RV.timer); RV.pending = null; rvHideBar();
    const it = ST.items.find(i => i.id === id), zh = UI.lang !== "en";
    if (!rvCanApprove(it)) { toast(zh ? `这张卡的状态已经变了，没有${okLabel(it, false)}` : "This card changed, nothing was sent", true); renderPage(); return; }
    if (keepalive) {   // page is going away: fire and forget so the approve still lands
      try { fetch("/api/action", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "approve", item: id, skip_asks: RV.skip === id || undefined }) }); } catch (e) { }
      return;
    }
    api("approve", { item: id, skip_asks: RV.skip === id || undefined }).then(() => {
      toast(okDone(it));
    }).catch(() => renderPage());   // failed: the card comes back (api() already showed the error)
  }
  function rvApprove(id, btn, asked) {
    const it = ST.items.find(i => i.id === id); if (!rvCanApprove(it)) return;
    if (!asked && openAsks(it).length) return askGuard(id, "approve", skip => { RV.skip = skip ? id : null; rvApprove(id, btn && btn.isConnected ? btn : null, true); });   // t-open-questions: asked before the 4.5 s hold starts
    if (RV.pending) rvCommit();   // a second approve while one is held: send the first now
    RV.pending = id;
    const zh = UI.lang !== "en";
    if (window.FX && btn) { const r = btn.getBoundingClientRect(); FX.burst(r.left + r.width / 2, r.top + r.height / 2, { n: 18 }); }
    const card = btn && btn.closest(".rv-card");
    const pb = $("#pagebody"); if (pb) pb._hk = "";   // t-home-flicker: the card is collapsed in place, so the next render must rewrite
    rvCollapse(card, () => { if (RV.pending === id || !RV.pending) renderPage(); });
    const b = rvUndoBar();
    b.innerHTML = `<span class="rv-u-tx"><b>${okDone(it).split(" · ")[0]}</b>${esc(it.title)}</span><button type="button" data-rv-undo>${zh ? "撤销" : "Undo"}</button><i class="rv-u-bar" style="--hold:${RV_HOLD}ms"></i>`;
    clearTimeout(b._h); b.hidden = false; void b.offsetWidth; b.classList.add("on");
    clearTimeout(RV.timer); RV.timer = setTimeout(() => rvCommit(), RV_HOLD);
  }
  function rvUndo() {
    const id = RV.pending; if (!id) return;
    clearTimeout(RV.timer); RV.pending = null; rvHideBar();
    if (UI.page === "review") { renderPage(); rvExpand(document.querySelector(`#pagebody .rv-card[data-item="${CSS.escape(id)}"]`)); }
  }
  document.addEventListener("click", e => {
    const ok = e.target.closest("[data-rv-ok]"); if (ok) { e.stopPropagation(); rvApprove(ok.dataset.rvOk, ok); return; }
    const op = e.target.closest("[data-rv-open]"); if (op) { e.stopPropagation(); openItem(op.dataset.rvOpen); return; }
    if (e.target.closest("[data-rv-undo]")) { e.stopPropagation(); rvUndo(); }
  });
  // leaving the app with an approve on hold still sends it (the user did tap 批准 and did not undo)
  addEventListener("pagehide", () => rvCommit(true));
  addEventListener("pagehide", () => arCommit(true));   // t-ask-rec: a held 全按推荐 still lands when the app goes away
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") arCommit(true); });
  document.addEventListener("click", e => {   // t-ask-rec
    const b = e.target.closest("[data-ask-allrec]"); if (b) { e.stopPropagation(); arStart(b.dataset.askAllrec); return; }
    if (e.target.closest("[data-ar-undo]")) { e.stopPropagation(); arUndo(); }
  });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") rvCommit(true); });
  function mailGroups(list) {   // newest first in, newest first out; entries of one item (or one agent's direct replies) fold into one row
    const gs = [], by = {};
    for (const m of list) {
      const k = m.item ? "i:" + m.item : "a:" + (m.agent || "");
      if (!by[k]) { by[k] = { last: m, ms: [] }; gs.push(by[k]); }
      by[k].ms.push(m);
    }
    return gs;
  }
  // t-web-audit 07: previews are plain text: no markdown marks, no "管家:" prefix (the sender is already on the row)
  // t-chat-table: in a one-line preview a Markdown table becomes 「〔表格〕a b · c d …」 (the header row and |---| line are dropped)
  function tablePv(s) {
    const L = String(s || "").split("\n"), out = []; let i = 0;
    const isRow = l => /^\s*\|.*\|?\s*$/.test(l) && (l.match(/\|/g) || []).length >= 2, isSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
    while (i < L.length) {
      if (isRow(L[i]) && i + 1 < L.length && isSep(L[i + 1])) {
        const rows = []; i += 2;
        while (i < L.length && isRow(L[i])) { rows.push(L[i].trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim()).filter(Boolean).join(" ")); i++; }
        out.push((UI.lang === "en" ? "[table] " : "〔表格〕") + rows.join(" · "));
      } else out.push(L[i++]);
    }
    return out.join("\n");
  }
  function mailPv(s, a) {   // t-chat-table: phones use it too now (mail rows + 动态 rows)
    s = tablePv(s).replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1").replace(/`([^`]+)`/g, "$1")
      .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+)/gm, "").replace(/\s+/g, " ").trim();
    for (const n of ["管家", "manager", a && aname(a), a && a.id].filter(Boolean)) {
      const re = new RegExp("^" + n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*[:：]\\s*");
      if (re.test(s)) { s = s.replace(re, ""); break; }
    }
    return s;
  }
  // t-web-audit 11: runs of manager heartbeats fold into one dim row; bare "agent <id>" lines are hidden
  function logRows(list) {
    if (MOBQ.matches) return list.map(l => ({ l }));   // desktop only for now
    const HB = /^(Online: watching the inbox|在线：盯收件箱)/, AID = /^agent [0-9a-f]{12,}$/, out = [];
    for (const l of list) {
      const x = l.text || ""; if (AID.test(x)) continue;
      if (HB.test(x)) { const p = out[out.length - 1]; if (p && p.hb && p.l.agent === l.agent) { p.n++; continue; } out.push({ l, hb: true, n: 1 }); }
      else out.push({ l });
    }
    return out;
  }
  /* t-ri1104-p4: a 「待审核: <title>」 mail only repeats line 1 (the title) and goes stale once the card moves on.
     Phone 动态 rows of such mail show the card's latest thread line instead (who said it + text, max 60 chars).
     Generic 验收 / 完成 stamps and stage events are skipped; with no line left: 已关单 / 等你验收 / the stage label. Display only. */
  const REV_MAIL = /^待审核\s*[:：]/;
  function cardLine(it) {
    const en = UI.lang === "en", th = (it.thread || []).filter(x => x.kind !== "event" && x.kind !== "approve" && x.kind !== "done" && String(x.text || "").trim());
    const x = th[th.length - 1];
    if (!x) return it.stage === "done" ? (en ? "Closed" : "已关单") : it.stage === "review" ? (en ? "Waiting for your review" : "等你验收") : stageLabel(it.stage);
    const who = x.who === "me" ? (en ? "You" : "你") : x.who ? aname(agent(x.who)) : "";
    let s = mailPv(x.text, x.who && x.who !== "me" ? agent(x.who) : null);
    if ([...s].length > 60) s = [...s].slice(0, 60).join("") + "…";
    return who ? who + (en ? ": " : "：") + s : s;
  }
  function mailRow(g) {
    const m = g.last, it = m.item ? ST.items.find(i => i.id === m.item) : null, a = m.agent ? agent(m.agent) : null;
    const unread = g.ms.some(x => !x.read);
    return actRow({ attr: `data-mail="${m.id}" data-mailids="${g.ms.map(x => x.id).join(",")}"`, av: a ? av(a, "", m.item) : av("me"), ws: it ? workersOf(it.id) : [], unread,
      name: a ? aname(a) : whoName("me"), title: it ? it.title : archTitle(m.item), time: agoH(m.t), preview: REV_MAIL.test(m.text || "") && it ? cardLine(it) : mailPv(m.text, a),
      chip: it ? rowLabel(it) : (m.kind === "reply" ? t("replies") : t("updates")), n: g.ms.length });
  }
  document.addEventListener("click", e => {
    const a = e.target.closest("[data-arch]"); if (a) { e.stopPropagation(); api("archive", { item: a.dataset.arch }); }
    const d = e.target.closest("[data-quickdone]"); if (d) { e.stopPropagation(); const qid = d.dataset.quickdone; askGuard(qid, "done", skip => api("done", { item: qid, skip_asks: skip || undefined })); }
  });

  const PAGES = {
    quests() { return questsPage(); },
    ongoing() { return ongoingPage(); },   /* t-ri1104-p3 */
    review() {
      if (widgetHome()) return window.Widgets ? Widgets.html($("#pagebody"), rulesBlock()) : rulesBlock();   // t-home-widgets: null = keep the current DOM
      const phoneLike = MOBQ.matches || appHome();   // t-home-applike: the desktop app-style home renders the phone home
      const hf = phoneLike ? (UI.hf || "review") : "review", wkc = Date.now() - 7 * 864e5;   // hf: set by the phone home strip's stat row
      const list = items().filter(i => i.id !== RV.pending && (hf === "week" ? (i.stage === "done" && i.closed && new Date(i.closed) > wkc) : hf === "review" ? onYouCard(i) : grpOf(i) === hf)).sort(UI.sort === "created" ? byCreated : byAct);
      const dec = hf === "review" ? decisions() : [];   // t-imp-p1
      const decH = dec.length ? decHead(list.length, dec) : "", decR = dec.map(decRow).join(""), today = hf === "review" && !list.length ? todayBlock() : "";
      const bar = (phoneLike && hf === "review" ? nrBlock() : "") + `<div class="ph-bar"><button data-sort="activity" class="${UI.sort === "activity" ? "on" : ""}">${t("by_activity")}</button>
        <button data-sort="created" class="${UI.sort === "created" ? "on" : ""}"><span class="gl" aria-hidden="true">▼ </span>${t("by_created")}</button>
        <span class="count">${hf === "review" ? (UI.lang === "en" ? "On you" : "等你拍板") : hf === "week" ? "本周交付" : stageLabel(hf)} <b>${list.length + dec.length}</b></span></div>`;   // t-home-nobtn: the 切回 button is gone; ⌘K「首页样式」and #home=classic stay as the back door
      const sz = hf === "review" ? snzLine() : "";   // ri1103-P2
      /* t-ri1104-p5: phone (and app-style desktop) home with nothing to approve: one quiet line instead of the big empty block,
         and no sort row (nothing to sort), so 此刻 / 今天交付 move up into the first screen. The sort row comes back with the first card. */
      if (!list.length && phoneLike && hf === "review" && !dec.length) return pageHead("review", nrBlock()) + sz + `<div class="dc-none dc-ok" role="status"><i aria-hidden="true">✓</i><span>${t("empty_ok")}</span></div>` + today;
      if (!list.length) return pageHead("review", bar) + sz + (dec.length ? decH + decR : hf === "review" ? `<div class="dc-none top">${t("empty_review")}</div>` : `<div class="empty">${t("empty_review")}</div>`) + today;
      const seen = UI.seen.review || "";
      const fresh = list.filter(i => (i.activity || "") > seen);
      let html = pageHead("review", bar) + sz;
      const mob = phoneLike, rowf = i => mob ? reviewRow(i, !!seen && fresh.includes(i)) : card(i), wrap = h => mob ? `<div class="act-list">${h}</div>` : h;
      if (mob && hf === "review") {   // P5: one flat column of review cards (new first, then by category), no group headers; the category sits in each card's meta line
        const rest = seen ? list.filter(i => !fresh.includes(i)) : list, cats = ["urgent", "main", "side", "daily", "ongoing"];
        const ord = (seen ? fresh : []).concat(cats.flatMap(c => rest.filter(i => i.category === c)), rest.filter(i => !cats.includes(i.category)));
        return html + decH + `<div class="rv-list">${ord.map(i => reviewCard(i, !!seen && fresh.includes(i))).join("")}</div>` + decR + nowBlock();   // t-now-always
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
          { const ws = workersOf(i.id); return `<div class="mini${ws.length ? " wk-on" : ""}" draggable="true" data-drag="${i.id}" data-item="${i.id}"${wkAttr(ws)}>${wkFx(ws)}<div class="t">${esc(i.title)}</div>${wkTag(ws)}<div class="m">${av(agent(i.owner), "sm", i.id)}${idleDoing(i) ? `<span class="tag">${pauseL()}</span>` : ""}<span>${t(i.category)}</span><span>${when(i.activity)}</span></div></div>`; }).join("")}${more ? `<button class="col-more" data-board-all>${UI.lang === "en" ? `${more} more · show all` : `还有 ${more} 张 · 展开`}</button>` : ""}</div>`;
      }).join("")}</div>`;
    },
    logs() {
      const ids = ["", ...agents().map(a => a.id), "me"];
      const list = (ST.logs || []).filter(l => !UI.logAgent || l.agent === UI.logAgent).slice(-400).reverse();
      return pageHead("logs") + `<div class="filters"><div class="seg" data-seg="logs">${ids.map(id => `<button class="seg-i ${UI.logAgent === id ? "on" : ""}" data-logf="${id}">${id ? esc(whoName(id)) : t("all")}</button>`).join("")}</div></div>` +
        (list.length ? logRows(list).map(({ l, hb, n }) => hb ? `<div class="log-i hb"><span class="tm">${whenH(l.t)}</span>${av(agent(l.agent), "sm")}<span>${esc(whoName(l.agent))}</span><span>${UI.lang === "en" ? "Heartbeat" : "在线心跳"}${n > 1 ? ` × ${n}` : ""}</span></div>` : `<div class="log-i"><span class="tm">${whenH(l.t)}</span>${l.agent === "me" ? av("me", "sm") : av(agent(l.agent), "sm")}<span>${esc(whoName(l.agent))}</span>
          <span>${l.item ? `<span class="it" data-item="${l.item}">${esc(l.item)}</span> ` : ""}${esc(l.text)}</span></div>`).join("") : `<div class="empty">${t("empty")}</div>`);
    },
    reports() {
      const list = (ST.reports || []).slice().reverse();
      const open = UI.openRep || (list[0] && list[0].id);
      return pageHead("reports", `<div class="ph-bar"><button class="btn-s" data-repreq>${t("report_req")}</button></div>`) +
        (list.length ? list.map(r => `<div class="rep"><div class="rep-h" data-rep="${r.id}"><b>${esc(r.title)} · ${esc(r.date)}</b><span class="dim">${whenH(r.t)}</span></div>
          ${r.id === open ? `<div class="md" style="margin-top:10px">${md(r.body)}</div>` : ""}</div>`).join("") : `<div class="empty">${t("reports_empty", { t: "18:00" })}</div>`);
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
      return pageHead("docs") + `<div class="docs"><div class="dl">${Object.entries(groups).map(([g, ds]) => `<div class="g">${esc(g)}</div>` +
        ds.map(d => `<button class="${UI.doc === d.path ? "on" : ""}" data-doc="${esc(d.path)}" title="${esc(d.path)}">${esc(d.path.split("/").pop())}</button>`).join("")).join("")}</div>
        <div class="md">${UI.doc ? md(UI.docText) : `<div class="empty">${t("docs_pick")}</div>`}</div></div>`;
    },
    roles() {
      const ls = ST.lessons || [];
      window.RF && RF.ensure(() => { if (UI.page === "settings" && UI.setTab === "roles") renderPage(); });
      return pageHead("roles") + `<div class="roster">${agents().map(a => {
        const mine = items().filter(i => i.owner === a.id);
        const done = mine.filter(i => i.stage === "done"), first = done.filter(i => !i.rejects).length;
        const adopted = ls.filter(l => l.agent === a.id && l.status === "adopted").length;
        const pend = ls.filter(l => l.agent === a.id && l.status === "pending");
        const cur = liveItem(a);   // t-now-closed: a closed card is not "current"
        return `<div class="rc frame ${a.enabled === false ? "disabled" : ""}"><img class="rc-art" src="/static/art/${esc(a.id)}.jpg?v=1" alt="" width="560" height="840" loading="lazy" decoding="async" onerror="this.remove()"><div class="rc-h">${av(a, "lg")}<div><div class="nm">${esc(aname(a))}</div><div class="ti">${esc(atitle(a))} · <span class="mono">${esc(a.agent_name || "main session")}</span></div></div></div>
          <div class="du">${esc(aduty(a))}</div>
          <div class="now">${a.status === "working" ? `<span style="color:var(--accent)">▶ ${t("working")}</span> ${esc(a.activity || "")} ${cur ? `· <a data-item="${cur.id}" href="#">${esc(cur.title)}</a>` : ""}` : `<span class="dim">${t(a.status || "idle")} ${a.last_seen ? "· " + ago(a.last_seen) : ""}</span>`}</div>
          <div class="stats"><div><b>${done.length}</b><small>${t("closed")}</small></div><div><b>${done.length ? Math.round(first / done.length * 100) + "%" : "—"}</b><small>${t("first_pass")}</small></div><div><b>${adopted}</b><small>${t("adopted")}</small></div></div>
          ${rcLinks(a)}
          ${rcTasks(a, mine)}
          ${pend.length ? `<div class="dim" style="font-size:12px;margin-top:6px"><a href="#" data-ui12go="review">${UI.lang === "en" ? `${pend.length} rule proposal(s) → Review page` : `${pend.length} 条规则提议 → 在「审核」页处理`}</a></div>` : ""}
          <div style="display:flex;gap:8px;margin-top:10px">${a.id !== "manager" ? `<button class="btn-s" data-chat="${a.id}">${t("dm")}</button>` : `<button class="btn-s" data-chat="manager">${t("dm")}</button>`}</div></div>`;
      }).join("")}</div>`;
    },
    mail() {
      const f = UI.mailFilter, mob = MOBQ.matches;
      let list = mailFiltered(300);
      if (mob && UI.mailUnread) list = list.filter(m => !m.read);
      const fs = [["all", t("all")], ["unread", t("unread")], ["reply", t("replies")], ["update", t("updates")], ["urgent", t("urgent")]];
      const segs = `<div class="seg" data-seg="mail">${fs.map(([k, n]) => `<button class="seg-i ${f === k ? "on" : ""}" data-mailf="${k}">${n}</button>`).join("")}</div>`;
      const head = mob   // t-mailbox-polish: phone = one row, filters + a small 全部已读 pill (masthead is hidden there)
        ? pageHead("mail") + `<div class="filters mb-row">${segs}<button class="btn-s mb-readall" data-mailall>${t("mark_all")}</button></div>`
        : pageHead("mail", `<div class="ph-bar"><button class="btn-s" data-mailall>${t("mark_all")}</button></div>`) + `<div class="filters">${segs}</div>`;
      if (mob) return head + (list.length ? `<div class="act-list">${ringOnce(() => mailGroups(list).map(mailRow).join(""))}</div>` : `<div class="empty calm">${t("empty_mail")}</div>`) +
        `<div class="act-foot"><button class="act-tog ${UI.mailUnread ? "on" : ""}" data-mailunread aria-pressed="${UI.mailUnread}">${t("unread_only")}</button></div>`;
      return head +
        (list.length ? ringOnce(() => list.map(m => `<div class="mail-i ${m.read ? "" : "unread"}" data-mail="${m.id}"><span class="u"></span><span class="tm">${whenH(m.t)}</span>${m.agent ? av(agent(m.agent), "sm") : "<span></span>"}<span class="tx">${esc(mailPv(m.text, m.agent && agent(m.agent)))}</span></div>`).join("")) : `<div class="empty">${t("empty")}</div>`);
    },
  };
  // ===== t-agent-memory v2: 记忆 / 灵魂 pills on the role card (viewer lives in rolefiles.js; read-only) =====
  function rcLinks(a) {
    const c = window.RF && RF.counts, n = c && c !== "old" ? c[a.id] : null;
    const soul = window.RF ? RF.soulFiles(a.id, a.agent_name).length : 0;
    const at = `data-rf-id="${esc(a.id)}" data-rf-agent="${esc(a.agent_name || "")}" data-rf-name="${esc(aname(a))}"`;
    return `<div class="rc-links"><button class="rf-pill" data-rf-open="mem" ${at}>${UI.lang === "en" ? "Memory" : "记忆"}${n != null ? ` <b>${n}</b>` : ""}</button><button class="rf-pill" data-rf-open="soul" ${at}>${UI.lang === "en" ? "Soul" : "灵魂"} <b>${soul}</b></button>${window.VoicePanel ? `<button class="rf-pill" data-vp-open="${esc(a.id)}" data-vp-name="${esc(aname(a))}">${UI.lang === "en" ? "Voice" : "声音"}</button>` : ""}</div>`;
  }
  // ===== ui20 (t-role-tasks): task list inside each roster card. Open work grouped doing > review > todo > waiting; done collapsed (latest 3). Rows reuse data-item -> openItem. =====
  UI.rcx = UI.rcx || {};
  function rcTasks(a, mine) {
    const x = UI.rcx[a.id] || {}, zh = UI.lang !== "en";
    const by = s => mine.filter(i => grpOf(i) === s);
    const row = i => `<div class="rt-r" data-item="${esc(i.id)}" role="link" tabindex="0"><span class="rt-t">${esc(i.title)}</span><span class="tag rt-s rt-${grpOf(i)}">${rowLabel(i)}</span></div>`;
    const groups = ["doing", "review", "todo", "waiting"].map(s => [s, by(s)]).filter(g => g[1].length);
    const done = by("done").sort((p, q) => String(q.updated || q.created || "").localeCompare(String(p.updated || p.created || "")));
    const open = groups.map(([s, g]) => `<div class="rt-g"><b>${grpLabel(s)}</b> · ${g.length}</div>` + g.map(row).join("")).join("");
    const nrows = groups.reduce((n, g) => n + g[1].length + 1, 0);
    const doneBlock = done.length ? `<button class="rt-dn" data-rcdone="${esc(a.id)}" aria-expanded="${!!x.done}">${x.done ? "▾" : "▸"} ${stageLabel("done")} · ${done.length}</button>` + (x.done ? done.slice(0, 3).map(row).join("") : "") : "";
    const body = open || doneBlock ? open + doneBlock : `<div class="rt-e">${zh ? "没有单子" : "No items"}</div>`;
    const long = nrows + (x.done ? Math.min(3, done.length) : 0) > 6;
    return `<div class="rt ${x.all ? "all" : ""}"><div class="rt-b">${body}</div>${long ? `<button class="rt-more" data-rcall="${esc(a.id)}" aria-expanded="${!!x.all}">${x.all ? (zh ? "收起" : "Less") : (zh ? "展开全部" : "Show all")}</button>` : ""}</div>`;
  }
  document.addEventListener("click", e => {
    const d = e.target.closest("[data-rcdone]"), m = e.target.closest("[data-rcall]"); if (!d && !m) return;
    const id = (d || m).dataset.rcdone || (d || m).dataset.rcall; const x = UI.rcx[id] = UI.rcx[id] || {};
    if (d) x.done = !x.done; else x.all = !x.all; renderPage();
  });
  document.addEventListener("keydown", e => { const r = e.target.closest && e.target.closest(".rt-r"); if (r && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openItem(r.dataset.item); } });
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
        <div class="rl-tx">${esc(l.text)}</div><div class="rl-dim dim">${esc(dim)}</div></div>
        <div class="rl-bt"><button class="btn-s" data-lesson="${l.id}" data-d="adopt">${t("adopt")}</button><button class="btn-s" data-lesson="${l.id}" data-d="drop">${t("drop")}</button></div></div>`;
    }).join("");
    return `<div class="rl-block"><div class="grp-h"><b>${en ? "Rules awaiting your call" : "待确认的规则"}</b> · ${ls.length}</div>${rows}</div>`;
  }
  { const r0 = PAGES.review; PAGES.review = function () { if (widgetHome()) return r0.call(this); return ruCard() + r0.call(this) + rulesBlock(); }; }   /* t-home-usage: ruCard() is "" off phones */   // t-home-widgets: the widget home puts the rules inside #wg itself
  // ===== t-imp-p3: 制作线 (production line), READ-ONLY. Main/side content items grouped by production stage + this week's publish slots.
  // Stage = tag "pipe:<key>" when present, else guessed from the owner's role (marked "推断" on the card). No new state fields, no server change.
  // Moving a card never writes state: dropping it on another column sends the manager a chat message asking to retag it (the manager applies it).
  const PIPE = [
    { k: "topic", zh: "选题", en: "Topic", who: ["scout"], d: "选题论证 + 调研", de: "Pitch + research" },
    { k: "script", zh: "脚本", en: "Script", who: ["writer"], d: "立项文档 + 脚本 + 事实核查", de: "Production doc, script, fact-check" },
    { k: "board", zh: "分镜·素材", en: "Boards · art", who: ["director", "artist"], d: "分镜 + 封面 / 概念图", de: "Storyboard, cover, concept art" },
    { k: "shoot", zh: "拍摄", en: "Shoot", who: ["me"], d: "你来拍", de: "You shoot" },
    { k: "edit", zh: "剪辑", en: "Edit", who: ["director"], d: "粗剪方案 / 粗剪", de: "Edit plan, rough cut" },
    { k: "pack", zh: "包装·排期", en: "Package", who: ["ops"], d: "三平台包装 + 排期", de: "Per-platform copy + slot" },
    { k: "ready", zh: "待发布", en: "Ready", who: ["me"], d: "你来发布", de: "You publish" },
  ];
  const PIPE_ALIAS = { "选题": "topic", "调研": "topic", "脚本": "script", "核查": "script", "分镜": "board", "素材": "board", "封面": "board", "拍摄": "shoot", "剪辑": "edit", "粗剪": "edit", "包装": "pack", "排期": "pack", "待发布": "ready", "发布": "ready" };
  const BY_OWNER = { scout: "topic", writer: "script", artist: "board", director: "board", ops: "pack" };
  const CONTENT_ROLES = new Set(["scout", "writer", "director", "artist", "ops"]);
  function pipeTag(it) {
    for (const g of it.tags || []) { const m = /^pipe[:：](.+)$/i.exec(String(g).trim()); if (m) { const v = m[1].trim().toLowerCase(); return PIPE.some(p => p.k === v) ? v : PIPE_ALIAS[m[1].trim()] || null; } }
    return null;
  }
  const isContent = it => ["main", "side"].includes(it.category) && (pipeTag(it) || (it.platforms || []).length || CONTENT_ROLES.has(it.owner));
  function pipeOf(it) { const k = pipeTag(it); return k ? { k, guess: false } : { k: BY_OWNER[it.owner] || "topic", guess: true }; }
  const pipeName = p => UI.lang === "en" ? p.en : p.zh;
  function weekDays() {   // Monday-first, this week
    const n = new Date(), mon = new Date(n.getFullYear(), n.getMonth(), n.getDate() - ((n.getDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i));
  }
  const platOf = s => { s = String(s || ""); return /B站|bili/i.test(s) ? "bili" : /youtube|油管|\byt\b/i.test(s) ? "yt" : /小红书|xhs|rednote/i.test(s) ? "xhs" : ""; };
  function pipeWeek(content) {
    const en = UI.lang === "en", wd = en ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] : ["周一", "周二", "周三", "周四", "周五", "周六", "周日"], today = dayKey(new Date());
    const days = weekDays(), keys = days.map(dayKey);
    const cal = (ST.calendar || []).filter(e => keys.includes(e.date)), dues = content.filter(i => i.due && keys.includes(String(i.due).slice(0, 10)));
    const cells = days.map((d, i) => {
      const k = keys[i], evs = cal.filter(e => e.date === k), ds = dues.filter(it => String(it.due).slice(0, 10) === k);
      const slot = e => `<div class="pl-slot${platOf(e.title) ? " pf-" + platOf(e.title) : ""}"${e.item ? ` data-item="${esc(e.item)}"` : ""}>${e.time ? `<span class="tm">${esc(e.time)}</span>` : ""}${esc(e.title)}</div>`;
      const due = it => `<div class="pl-slot due" data-item="${esc(it.id)}"><b>${en ? "Due" : "截止"}</b> · ${esc(it.title)}</div>`;
      const body = evs.map(slot).join("") + ds.map(due).join("");
      return `<div class="pl-day${k === today ? " today" : ""}${k < today ? " past" : ""}"><div class="pl-dh">${wd[i]} <span>${d.getMonth() + 1}/${d.getDate()}</span></div>${body || (k < today ? "" : `<button class="pl-add" data-pl-add="${k}">${en ? "+ add" : "+ 排一个"}</button>`)}</div>`;
    }).join("");
    const used = keys.filter(k => cal.some(e => e.date === k) || dues.some(it => String(it.due).slice(0, 10) === k)).length;
    return { html: `<div class="pl-week">${cells}</div>`, used };
  }
  function pipeCard(it, guess) {
    const en = UI.lang === "en", ws = workersOf(it.id), plats = (it.platforms || []).map(p => PLAT[p] || p).join(" · ");
    const flag = busy(it) ? "" : it.stage === "review" ? (en ? `${it.draft_label || "draft"} · your review` : `${esc(it.draft_label || "新稿")} 待你看`) : awaitsUser(it) ? (en ? "needs your call" : "待你拍板") : it.stage === "waiting" ? (en ? "waiting" : "等别人") : "";
    return `<div class="mini pl-card${ws.length ? " wk-on" : ""}" draggable="true" data-pdrag="${it.id}" data-item="${it.id}"${wkAttr(ws)}>${wkFx(ws)}<div class="t">${esc(it.title)}</div>${wkTag(ws)}
      ${flag ? `<span class="pl-flag${it.stage === "review" || awaitsUser(it) ? " you" : ""}">${flag}</span>` : ""}
      <div class="m">${av(agent(it.owner), "sm", it.id)}<span>${t(it.category)}</span>${plats ? `<span>${esc(plats)}</span>` : ""}${guess ? `<span class="pl-guess" title="${en ? "No pipe:<stage> tag; guessed from the owner" : "没有 pipe:阶段 标签，按负责人推断"}">${en ? "guessed" : "推断"}</span>` : ""}</div></div>`;
  }
  // ===== t-settings-tab (approved 11-04, plan v1.1): one 设置 page. Tabs 通用 / 角色 / 文档 / 日志 / 系统; the old 角色 / 文档 / 日志 pages are drawn
  // inside their tab (UI.noHead drops their masthead). 通用 gathers the phone 更多 settings + theme mode; 系统 = status, role usage, GitHub token, 唤醒管家.
  // Theme mode (rt.themeMode auto | manual) is decided before first paint in index.html and kept live in mobile.js ui13.
  const themeMode = () => LS.get("themeMode", "manual") === "auto" ? "auto" : "manual";
  const RMQ_S = matchMedia("(prefers-reduced-motion: reduce)");
  const ST_L = { general: ["通用", "General"], roles: ["角色", "Roster"], docs: ["文档", "Docs"], logs: ["日志", "Log"], system: ["系统", "System"] };
  function setTab(k, dir) {
    if (!SET_TABS.includes(k)) return;
    const was = UI.setTab; UI.setTab = k; LS.set("setTab", k);
    if (UI.page !== "settings") { go("settings"); return; }
    const pane = $("#pagebody .st-pane");
    const draw = () => { UI.stDir = dir || (SET_TABS.indexOf(k) >= SET_TABS.indexOf(was) ? "r" : "l"); renderPage(); UI.stDir = ""; };
    if (pane && !RMQ_S.matches && was !== k) { pane.classList.add("st-out"); setTimeout(draw, 90); } else draw();   // fade out, then slide the new pane in from the side you moved to
  }
  document.addEventListener("click", e => { const b = e.target.closest("[data-settab]"); if (b) setTab(b.dataset.settab); });
  /* t-nav-shoot: 制作 sub tabs. Fade the page out (90 ms), switch, slide the new page in from the side you moved to; reduced motion = just switch. */
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-stutab]"); if (!b) return;
    const k = b.dataset.stutab, was = UI.page; if (!STU.includes(k) || k === was) return;
    const body = $("#pagebody"), dir = STU.indexOf(k) >= STU.indexOf(was) ? "r" : "l";
    const draw = () => { go(k); if (RMQ_S.matches) return; body.classList.remove("stu-out"); body.classList.add("stu-in-" + dir); setTimeout(() => body.classList.remove("stu-in-r", "stu-in-l"), 260); };
    if (body && !RMQ_S.matches) { body.classList.add("stu-out"); setTimeout(draw, 90); } else draw();
  });
  const stRow = (b, sm, right, attrs = "", tag = "button") => `<${tag} ${tag === "button" ? 'type="button" ' : ""}class="st-row" ${attrs}><span class="st-tx"><b>${b}</b>${sm ? `<small>${sm}</small>` : ""}</span>${right}</${tag}>`;
  const stSeg = (key, list, on, attr) => `<div class="seg st-seg" data-seg="${key}" role="radiogroup">${list.map(([v, zh, en]) => `<button type="button" class="seg-i ${v === on ? "on" : ""}" role="radio" aria-checked="${v === on}" ${attr}="${v}">${UI.lang === "en" ? en : zh}</button>`).join("")}</div>`;
  const stSw = on => `<span class="sw ${on ? "on" : ""}" aria-hidden="true"><i></i></span>`;
  const stSec = (h, rows) => `<section class="st-sec"><h4>${h}</h4>${rows}</section>`;
  function stGeneral() {
    const en = UI.lang === "en", R = document.documentElement, mode = themeMode(), cur = R.dataset.theme === "white" ? "white" : "dark";
    const sys = matchMedia("(prefers-color-scheme: dark)").matches ? (en ? "system is dark" : "系统是深色") : matchMedia("(prefers-color-scheme: light)").matches ? (en ? "system is light" : "系统是浅色") : (en ? "by clock, 07–19 day" : "按时间：07–19 点用昼");
    const now = `<span class="st-now">${en ? "Now" : "现在"} <b>${cur === "white" ? (en ? "Day" : "昼") : (en ? "Night" : "夜")}</b>${mode === "auto" ? ` · ${sys}` : ""}</span>`;
    const look = stRow(en ? "Theme" : "主题", (mode === "auto" ? (en ? "Auto follows your system light / dark setting." : "自动：跟着系统的深浅色走（Mac 和 iPhone 选「自动」外观时，会按日出日落切换）") : (en ? "Fixed on this device." : "手动：固定用选好的这一套，只在这台设备生效")) + now,
        stSeg("tmode", [["auto", "自动", "Auto"], ["dark", "夜", "Night"], ["white", "昼", "Day"]], mode === "auto" ? "auto" : cur, "data-tmode"), "", "div")
      + stRow(en ? "Stage background" : "舞台背景", en ? "Your terrace office behind everything; night / day follow the theme" : "你画的露台办公室做背景，夜 / 昼跟着上面的主题", stSw(!!R.dataset.stage), `data-stage-tog aria-pressed="${!!R.dataset.stage}"`)
      + stRow(en ? "Power saving" : "省电模式", psSub(psNow()), stSw(psNow()), `data-power-tog aria-pressed="${psNow()}"`)
      + spRow(en)
      + (MOBQ.matches ? "" : stRow(en ? "Home style" : "首页样式", en ? "This computer only" : "只在这台电脑生效", stSeg("homestyle", [["dense", "紧凑", "Dense"], ["widgets", "小组件", "Widgets"], ["app", "app 式", "App"], ["classic", "原来的", "Classic"]], UI.home, "data-home-set"), "", "div"))
      + stRow(en ? "Language" : "界面语言", "", stSeg("lang", [["zh", "中文", "中文"], ["en", "English", "English"]], UI.lang, "data-lang-set"), "", "div");
    const P = window.Push ? Push.status() : null;
    const push = P ? stRow(en ? "Notifications" : "推送通知", esc(P.label) + (P.diag ? `<span class="st-diag">${esc(P.diag)}</span>` : ""), stSw(P.on), `data-set="push" aria-pressed="${!!P.on}"`)
      + (P.on && App.pushPrefs ? `<div class="st-sub">${App.pushPrefs()}</div>` : "")
      + (P.on ? stRow(en ? "Send a test" : "发一条测试通知", "", `<em class="st-go">›</em>`, `data-set="pushtest"`) : "") : "";
    const mic = stRow(en ? "Microphone test" : "麦克风测试", en ? "Check before voice calls" : "语音通话前的真机检查", `<em class="st-go">›</em>`, `data-set="mictest"`);
    return stSec(en ? "Appearance" : "外观", look) + stSec(en ? "Notifications" : "通知", push + mic);
  }
  function stSystem() {
    const en = UI.lang === "en";
    loadHealth(60000); const SY = statusSummary(statusRows());
    loadRoleUsage();
    const rows = stRow(en ? "System status" : "系统状态", `<span class="sy-sum-t ${SY.lv}">${esc(SY.txt)}</span>`, `<em class="st-go">›</em>`, `data-set="status"`)
      + (typeof ghOpen === "function" ? stRow(en ? "GitHub push token" : "GitHub 推送令牌", esc(ghLabel()), `<em class="st-go">›</em>`, `data-set="ghtok"`) : "")
      + stRow(en ? "Wake the manager" : "唤醒管家", en ? "Drops a ping in the inbox; use it when the manager is asleep or offline" : "往收件箱发一条 ping，管家休眠或离线时用", `<em class="st-go">›</em>`, `data-h="wake"`);
    return stSec(en ? "System" : "系统", rows) + `<section class="st-sec st-ru"><h4>${en ? "Usage by role · today" : "各角色用量 · 今天"}</h4>${ruHTML(99, { tot: true, quota: true })}</section>`;
  }
  /* t-power-toggle: 省电模式 (rt.powerSave, kept by fx.js). The click flips the switch in place (no re-render) so the knob slide and the caption fade are seen. */
  const psNow = () => !(window.FX && FX.power) || FX.power.isOn();
  const psSub = on => UI.lang === "en"
    ? (on ? "After 20 s without input, or when you switch away, looping animations pause; working avatars do not breathe" : "Looping animations always play, even when idle; working avatars breathe. Uses more power")
    : (on ? "20 秒不操作或切到别的窗口，循环动画就暂停；工作中的头像不做呼吸缩放" : "循环动画一直播，闲置也不停，头像恢复呼吸缩放；更耗电");
  document.addEventListener("click", e => {
    const p = e.target.closest && e.target.closest("[data-power-tog]"); if (!p || !window.FX || !FX.power) return;
    const on = !FX.power.isOn(); FX.power.set(on);
    p.setAttribute("aria-pressed", String(on));
    const sw = p.querySelector(".sw"); if (sw) sw.classList.toggle("on", on);
    const sm = p.querySelector(".st-tx small");
    if (sm) { sm.classList.remove("st-swap"); void sm.offsetWidth; sm.textContent = psSub(on); sm.classList.add("st-swap"); }
  });
  /* t-splash: 开屏动画 (rt.splash.mode "session" | "off", read by the inline guard in index.html). A div row with two real buttons: the switch flips in place
     (no re-render, like 省电模式) and 预览 plays the opening on this page now (UTSplash.play, does not touch rt.splash). */
  const spOn = () => { try { return JSON.parse(localStorage.getItem("rt.splash.mode")) !== "off"; } catch { return true; } };
  const spSub = on => UI.lang === "en" ? (on ? "Plays once each time you open the dashboard; tap or press any key to skip" : "Off: the dashboard opens straight away")
    : (on ? "每次打开看板播一次，点一下或按任意键跳过" : "已关：打开看板直接进");
  function spRow(en) {
    const on = spOn();
    return `<div class="st-row st-sp"><span class="st-tx"><b>${en ? "Opening animation" : "开屏动画"}</b><small>${spSub(on)}</small></span>`
      + `<button type="button" class="st-prev" data-splash-prev aria-label="${en ? "Preview the opening" : "预览开屏动画"}"><i aria-hidden="true">▶</i>${en ? "Preview" : "预览"}</button>`
      + `<button type="button" class="st-swb" data-splash-tog role="switch" aria-checked="${on}" aria-label="${en ? "Opening animation" : "开屏动画"}">${stSw(on)}</button></div>`;
  }
  function spPaint(on) {
    document.querySelectorAll("[data-splash-tog]").forEach(b => {
      b.setAttribute("aria-checked", String(on)); const sw = b.querySelector(".sw"); if (sw) sw.classList.toggle("on", on);
      const sm = b.closest(".st-row") && b.closest(".st-row").querySelector(".st-tx small");
      if (sm && sm.textContent !== spSub(on)) { sm.classList.remove("st-swap"); void sm.offsetWidth; sm.textContent = spSub(on); sm.classList.add("st-swap"); }
    });
  }
  document.addEventListener("click", e => {
    const t = e.target.closest && e.target.closest("[data-splash-tog],[data-splash-prev]"); if (!t) return;
    if (t.hasAttribute("data-splash-prev")) { if (window.UTSplash) UTSplash.play({ force: true }); return; }
    const on = !spOn(); try { localStorage.setItem("rt.splash.mode", JSON.stringify(on ? "session" : "off")); } catch { }
    spPaint(on);
  });
  addEventListener("storage", e => { if (e.key === "rt.splash.mode") spPaint(spOn()); });   // another tab flipped it
  PAGES.settings = function () {
    const k = SET_TABS.includes(UI.setTab) ? UI.setTab : "general", en = UI.lang === "en";
    const tabs = `<div class="st-tabs"><div class="seg" data-seg="settab" role="tablist">${SET_TABS.map(x => `<button type="button" class="seg-i ${x === k ? "on" : ""}" role="tab" aria-selected="${x === k}" data-settab="${x}">${ST_L[x][en ? 1 : 0]}</button>`).join("")}</div></div>`;
    let body;
    UI.noHead = true;
    try { body = k === "general" ? stGeneral() : k === "system" ? stSystem() : PAGES[k](); } finally { UI.noHead = false; }
    return pageHead("settings") + tabs + `<div class="st-pane st-p-${k}${UI.stDir ? " st-in-" + UI.stDir : ""}" role="tabpanel">${body || ""}</div>`;
  };
  document.addEventListener("click", e => {
    const l = e.target.closest("[data-lang-set]"); if (l && l.dataset.langSet !== UI.lang) { UI.lang = l.dataset.langSet; LS.set("lang", UI.lang); render(); }
  });
  PAGES.pipe = function () {
    const en = UI.lang === "en", all = items().filter(i => i.stage !== "done" && ["main", "side"].includes(i.category));
    const content = all.filter(isContent), skipped = all.filter(i => !isContent(i));
    const wk = pipeWeek(content);
    const bar = `<div class="ph-bar"><span class="count">${en ? "Days booked this week" : "本周已排"} <b>${wk.used}</b>${en ? "" : " 天"}</span><span class="count">${en ? "In production" : "在制作"} <b>${content.length}</b></span></div>`;
    const empty = !content.length ? `<div class="pl-empty"><b>${en ? "No content items yet." : "还没有内容单子。"}</b>
      ${en ? "Main / side quests with a platform, a <code>pipe:&lt;stage&gt;</code> tag, or a content owner (scout, writer, director, artist, ops) show up here, one column per production stage. Calendar entries for this week fill the slots above."
        : "主线 / 支线里，标了平台、带 <code>pipe:阶段</code> 标签、或者负责人是内容组（" + ["scout", "writer", "director", "artist", "ops"].map(id => aname(agent(id))).join("、") + "）的卡，会按制作阶段出现在下面七列。上面的发布位读的是日程里本周的条目。"}</div>` : "";
    const cols = PIPE.map(p => {
      const g = content.map(i => ({ i, p: pipeOf(i) })).filter(x => x.p.k === p.k).sort((a, b) => byAct(a.i, b.i));
      const who = p.who.map(w => w === "me" ? `<span class="pl-me">${en ? "You" : "你"}</span>` : av(agent(w), "sm")).join("");
      return `<div class="pl-col${g.length ? "" : " none"}" data-pdrop="${p.k}"><div class="col-h"><span>${pipeName(p)}</span><span class="pl-who">${who}<i>${g.length}</i></span></div>
        <div class="pl-d">${esc(en ? p.de : p.d)}</div>${g.map(x => pipeCard(x.i, x.p.guess)).join("")}</div>`;
    }).join("");
    const skip = skipped.length ? `<div class="pl-skip">${en ? `${skipped.length} main/side item(s) don't look like content (no platform, no pipe tag, not a content owner), so they are not shown:` : `另有 ${skipped.length} 张主线/支线卡不像内容（没平台、没 pipe 标签、负责人不在内容组），没放进来：`} ${skipped.map(i => `<a href="#" data-item="${i.id}">${esc(i.title)}</a>`).join("、")}</div>` : "";
    return pageHead("pipe", bar) + wk.html + empty + `<div class="pl-board">${cols}</div>` + skip;
  };
  const plFade = el => el.classList.toggle("more", el.scrollWidth - el.clientWidth - el.scrollLeft > 4);   // fade the right edge while columns hide past it
  const plSL = {};   // polls re-render the page; keep each sideways row where you left it (phones open the week strip at today)
  hooks.push(k => {
    if (k !== "page" || UI.page !== "pipe") return;
    document.querySelectorAll(".pl-week, .pl-board").forEach(el => {
      const c = el.classList[0];
      if (plSL[c] != null) el.scrollLeft = plSL[c];
      else if (c === "pl-week" && MOBQ.matches) requestAnimationFrame(() => { const td = el.querySelector(".today"); if (td && plSL[c] == null) el.scrollLeft += td.getBoundingClientRect().left - el.getBoundingClientRect().left; });
      plFade(el);
    });
  });
  document.addEventListener("scroll", e => { const el = e.target; if (el.classList && (el.classList.contains("pl-board") || el.classList.contains("pl-week"))) { plSL[el.classList[0]] = el.scrollLeft; plFade(el); } }, true);
  window.addEventListener("resize", () => { if (UI.page === "pipe") document.querySelectorAll(".pl-week, .pl-board").forEach(plFade); });
  document.addEventListener("click", e => {
    const a = e.target.closest("[data-pl-add]"); if (!a) return;
    UI.calForm = true; renderLeft();
    const f = $("#calf"); if (f) { f.date.value = a.dataset.plAdd; f.title.focus(); if (!f.title.placeholder || f.title.placeholder === "…") f.title.placeholder = UI.lang === "en" ? "e.g. Bilibili · EP1" : "例：B站 · EP1"; }
  });
  document.addEventListener("dragstart", e => { const d = e.target.closest("[data-pdrag]"); if (d) e.dataTransfer.setData("text/pipe", d.dataset.pdrag); });
  document.addEventListener("dragover", e => { const c = e.target.closest("[data-pdrop]"); if (c && e.dataTransfer.types.includes("text/pipe")) { e.preventDefault(); c.classList.add("over"); } });
  document.addEventListener("dragleave", e => { const c = e.target.closest("[data-pdrop]"); if (c && !c.contains(e.relatedTarget)) c.classList.remove("over"); });
  document.addEventListener("drop", e => {
    const c = e.target.closest("[data-pdrop]"); if (!c) return; const id = e.dataTransfer.getData("text/pipe"); c.classList.remove("over"); if (!id) return;
    e.preventDefault();
    const it = items().find(i => i.id === id), p = PIPE.find(x => x.k === c.dataset.pdrop); if (!it || !p) return;
    const cur = pipeOf(it); if (cur.k === p.k && !cur.guess) return;
    if (!confirm(UI.lang === "en" ? `Ask the manager to move "${it.title}" to ${p.en}?` : `请管家把「${it.title}」挪到「${p.zh}」？\n（发给管家确认，看板不直接改）`)) return;
    const tags = (it.tags || []).filter(g => !/^pipe[:：]/i.test(g)).concat("pipe:" + p.k);
    api("chat", { text: `【制作线】请把「${it.title}」（${it.id}）的制作阶段改到「${p.zh}」。\n设成：python3 stateutil.py upsert-item --id ${it.id} --who manager ${tags.map(g => `--tag "${g}"`).join(" ")}\n（--tag 会整组替换 tags，上面已带上原有标签）` })
      .then(() => toast(UI.lang === "en" ? "Sent to the manager" : "已发给管家，确认后会挪过去"));
  });

  document.addEventListener("click", e => { const g = e.target.closest("[data-ui12go]"); if (g) { e.preventDefault(); go(g.dataset.ui12go); } });
  // ---------- ui1-C: mailbox = drop-down panel under the header (the full page stays reachable via "view all") ----------
  function mailFiltered(n) {
    const f = UI.mailFilter;
    return (ST.mail || []).filter(m => f === "all" || (f === "unread" ? !m.read : f === "urgent" ? (m.item && (ST.items.find(i => i.id === m.item) || {}).category === "urgent") : m.kind === f)).slice(-n).reverse();
  }
  const MB = { ct: null, open: false };
  function mailboxEls() {
    let box = $("#mailbox"), sc = $("#mailscrim");
    if (!box) {
      sc = document.createElement("div"); sc.id = "mailscrim"; sc.hidden = true; sc.addEventListener("click", () => closeMailbox());
      box = document.createElement("div"); box.id = "mailbox"; box.hidden = true; box.setAttribute("role", "dialog");
      document.body.append(sc, box);
    }
    return { box, sc };
  }
  function renderMailbox(enter) {
    if (!MB.open) return;
    const { box } = mailboxEls(), f = UI.mailFilter;
    const unread = (ST.mail || []).filter(m => !m.read).length;
    const fs = [["all", t("all")], ["unread", t("unread")], ["reply", t("replies")], ["update", t("updates")], ["urgent", t("urgent")]];
    const kindName = { reply: t("replies"), update: t("updates") };
    const list = mailFiltered(40);
    const keep = $(".mb-list", box) ? $(".mb-list", box).scrollTop : 0;
    box.innerHTML = `<div class="mb-h"><div class="mb-t"><b>${t("mail")}</b><span>${UI.lang === "en" ? `${unread} unread` : `${unread} 条未读`}</span></div><button class="btn-s" data-mailall>${t("mark_all")}</button></div>
      <div class="mb-f"><div class="seg" data-seg="mailbox">${fs.map(([k, n]) => `<button class="seg-i ${f === k ? "on" : ""}" data-mailf="${k}">${n}</button>`).join("")}</div></div>
      <div class="mb-list ${enter ? "mb-enter" : ""}">${list.length ? list.map((m, i) => `<div class="mb-i ${m.read ? "" : "unread"}" data-mail="${m.id}" style="--i:${Math.min(i, 8)}">
        ${m.agent ? av(agent(m.agent), "sm") : "<span class=\"av sm\"></span>"}<div class="mb-b"><div class="mb-m"><b>${m.agent ? esc(aname(agent(m.agent))) : ""}</b>${kindName[m.kind] ? `<i>${esc(kindName[m.kind])}</i>` : ""}<span>${whenH(m.t)}</span></div><div class="mb-x">${esc(mailPv(m.text, m.agent && agent(m.agent)))}</div></div><span class="u"></span></div>`).join("") : `<div class="empty">${t("empty")}</div>`}</div>
      <button class="mb-all" data-mbfull>${UI.lang === "en" ? "View all" : "查看全部"} →</button>`;
    $(".mb-list", box).scrollTop = keep;
    if (enter) setTimeout(() => { const l = $(".mb-list", box); l && l.classList.remove("mb-enter"); }, 700);
  }
  function openMailbox() {
    const { box, sc } = mailboxEls(); clearTimeout(MB.ct);
    const b = $('[data-h="mail"]'), r = b ? b.getBoundingClientRect() : { bottom: 56 };
    const hb = $("#top").getBoundingClientRect().bottom;
    document.documentElement.style.setProperty("--mb-top", Math.round(Math.max(hb, 0)) + "px");
    MB.open = true; box.hidden = false; sc.hidden = false; renderMailbox(true);
    void box.offsetWidth; box.classList.add("open"); sc.classList.add("open"); document.body.classList.add("mailopen");
  }
  function closeMailbox() {
    if (!MB.open) return; MB.open = false;
    const { box, sc } = mailboxEls(); box.classList.remove("open"); sc.classList.remove("open"); document.body.classList.remove("mailopen");
    clearTimeout(MB.ct); MB.ct = setTimeout(() => { if (MB.open) return; box.hidden = true; sc.hidden = true; box.innerHTML = ""; }, 200);
  }
  document.addEventListener("click", e => {
    if (e.target.closest("[data-mbfull]")) { closeMailbox(); go("mail"); return; }
    if (MB.open && e.target.closest("#mailbox [data-mail]")) setTimeout(closeMailbox, 0);
  });
  // t-vis-b2: the phone 委托 tab's 「全部」 page: every live item across categories, grouped by stage like a category page
  function questsPage() {
    const list = items();
    let html = pageHead("quests");
    if (!list.length) return html + `<div class="empty">${t("empty")}</div>`;
    return html + stageGroups(list, "quests");
  }
  // t-done-fold (2026-11-02): on the list pages (全部 / 主线 / 支线 / 日常 …) finished cards fold into one row at the bottom,
  // 「已完成 · N 张 ▸」; open / closed is remembered per page in this browser (rt.doneOpen.<page>). A page with nothing but finished
  // cards says so in one faint line above that row instead of a blank page. Open, the row shows the latest 12 as before.
  const doneOpen = pg => lsGet("rt.doneOpen." + pg, false) === true;
  function stageGroups(list, pg, quiet) {   /* quiet: no 「这里的活都做完了」 line (常驻活动 puts the fold under its own schedule) */
    let html = "", live = 0;
    for (const s of ["review", "doing", "todo", "waiting"]) {
      const g = list.filter(i => grpOf(i) === s).sort(byAct); if (!g.length) continue;
      live += g.length; html += `<div class="grp-h"><b>${grpLabel(s)}</b> · ${g.length}</div>` + g.map(card).join("");
    }
    const done = list.filter(i => grpOf(i) === "done").sort(byAct); if (!done.length) return html;
    const en = UI.lang === "en", open = doneOpen(pg), shown = done.slice(0, 12);
    if (!live && !quiet) html += `<div class="df-empty">${en ? "All done here." : "这里的活都做完了"}</div>`;
    html += `<button type="button" class="df-row${live ? "" : " solo"}" data-donefold="${esc(pg)}" aria-expanded="${open}"><span>${en ? `Done · ${done.length}` : `已完成 · ${done.length} 张`}</span><i aria-hidden="true">▸</i></button>`;
    if (open) html += `<div class="df-list">${shown.map(card).join("")}${done.length > shown.length ? `<div class="df-note">${en ? `Latest ${shown.length} shown · the rest are on the board` : `只列出最近 ${shown.length} 张，更早的在看板里`}</div>` : ""}</div>`;
    return html;
  }
  /* t-ri1104-p3: 常驻活动 as a schedule. meta.routines (server) gives time / paused / last / next and (newer server) runs =
     the logged fire dates with the run card of that day, which drive the 7-day row. Without runs (older server) it is what the
     front end can know: a run card (child r-* card of the routine) that day -> ✓ or … ; r.last that day -> ✓ ; paused since -> ⏸ ;
     today before the run -> its time ; anything else "·" (no record kept). Other ongoing cards: 按需常驻 rows, finished ones fold. */
  function ongoingPage() {
    const rs = (ST.meta && ST.meta.routines) || [];
    if (!Array.isArray(ST.meta && ST.meta.routines) || !rs.length) return catPage("ongoing");
    const en = UI.lang === "en", all = items().filter(i => i.category === "ongoing"), rIds = new Set(rs.map(r => r.item));
    const days = Array.from({ length: 7 }, (_, i) => new Date(Date.now() - (6 - i) * 864e5)), today = dayKey(new Date());
    const WK = en ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] : ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    const runsOf = r => { const p = (ST.items || []).find(i => i.id === r.item); return p ? childrenOf(p).filter(k => /^r-/.test(k.id)) : []; };
    const nameOf = (r, a) => { const n = String(r.label || r.id).replace(/[（(][^）)]*[）)]/g, "").trim(), o = a ? aname(a) : ""; return (o && n.startsWith(o) ? n.slice(o.length).trim() : n) || n; };
    const nextTxt = r => {
      if (r.paused) return en ? "Paused" : "已暂停";
      const nd = r.next && new Date(r.next); if (!nd || isNaN(nd)) return "—";
      const m = Math.round((nd - Date.now()) / 6e4);
      if (m <= 0) return en ? "due now" : "到点";
      if (m < 24 * 60) return en ? `in ${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 60) ? Math.floor(m / 60) + " 小时 " : ""}${m % 60} 分后`;
      return dayKey(nd) === dayKey(new Date(Date.now() + 864e5)) ? `${en ? "tomorrow" : "明天"} ${hm(r.next)}` : when(r.next);
    };
    const cell = (r, runs, d) => {
      const k = dayKey(d);
      if (Array.isArray(r.runs)) {   /* t-ri1104-p3 server log: every fired date, with the run card made that day */
        const x = r.runs.find(y => y.date === k);
        if (x) return x.item && x.stage !== "done" ? ["…", "run", x.item] : ["✓", "ok", x.item || ""];
        if (r.paused && k >= dayKey(new Date(r.paused))) return ["⏸", "off", ""];
        if (k === today && !r.paused && r.next && dayKey(new Date(r.next)) === today) return [r.time || "·", "next", ""];
        return ["·", "na", ""];
      }
      const run = runs.filter(x => x.created && dayKey(new Date(x.created)) === k).pop();
      if (run) return run.stage === "done" ? ["✓", "ok", run.id] : ["…", "run", run.id];
      if (r.last === k) return ["✓", "ok", ""];
      if (r.paused && k >= dayKey(new Date(r.paused))) return ["⏸", "off", ""];
      if (k === today && !r.paused && r.next && dayKey(new Date(r.next)) === today) return [r.time || "·", "next", ""];
      return ["·", "na", ""];
    };
    const row = r => {
      const it = (ST.items || []).find(i => i.id === r.item), a = it && agent(it.owner), runs = runsOf(r), last = runs[runs.length - 1];
      const dots = days.map((d, i) => { const [x, c, id] = cell(r, runs, d); return `<span class="rs-d"${id ? ` data-item="${esc(id)}"` : ""}><b class="${c}">${esc(x)}</b><small>${i === 6 ? (en ? "Today" : "今天") : WK[d.getDay()]}</small></span>`; }).join("");
      const lastL = r.paused ? `${when(r.paused)} ${en ? "paused" : "起暂停"}`
        : last ? `${en ? "Latest" : "最近一期"} <u data-item="${esc(last.id)}">${esc(last.id)}</u> · ${esc(rowLabel(last))}`
        : r.last ? `${en ? "Last run" : "最近一次"} ${esc(r.last.slice(5))}` : (en ? "No run yet" : "还没跑过");
      return `<div class="rs-row${r.paused ? " rs-off" : ""}" data-item="${esc(r.item)}">
        <div class="rs-t">${esc(r.time || "—")}</div>
        <div class="rs-m"><div class="rs-n">${a ? av(a, "rs-av", r.item) : ""}<b>${esc(nameOf(r, a))}</b></div><div class="rs-s">${a ? esc(aname(a)) + " · " : ""}${en ? "daily" : "每天"}</div></div>
        <div class="rs-r"><button type="button" class="rs-tg" data-rtq="${esc(r.id)}" role="switch" aria-checked="${!r.paused}" aria-label="${r.paused ? (en ? "Turn on" : "开启") : (en ? "Pause" : "暂停")}"><i></i></button><span class="rs-nx">${esc(nextTxt(r))}</span></div>
        <div class="rs-dots">${dots}</div>
        <div class="rs-last">${lastL}</div></div>`;
    };
    const sorted = [...rs].sort((x, y) => (!!x.paused - !!y.paused) || String(x.time || "").localeCompare(String(y.time || "")));
    const live = rs.filter(r => !r.paused && !r.disabled).length;
    const runIds = new Set(rs.flatMap(r => runsOf(r).map(k => k.id)));
    const rest = all.filter(i => !rIds.has(i.id) && !runIds.has(i.id)), od = rest.filter(i => grpOf(i) !== "done"), done = rest.filter(i => grpOf(i) === "done");
    const odRow = i => { const a = agent(i.owner); return `<div class="rs-row od" data-item="${esc(i.id)}"><div class="rs-m"><div class="rs-n">${a ? av(a, "rs-av", i.id) : ""}<b>${esc(i.title)}</b></div><div class="rs-s">${en ? "Runs when the manager starts it" : "管家说开工才跑"} · ${en ? "last" : "上次"} ${esc(when(i.activity || i.updated))}</div></div><span class="rs-nx dim">${i.paused && i.stage === "doing" ? (en ? "Paused" : "已暂停") : (en ? "On call" : "等管家叫")}</span></div>`; };   /* t-routine-detect: it.paused */
    return pageHead("ongoing") +
      `<div class="rs-h"><b>${en ? "Daily rhythm" : "每天的固定节奏"}</b><span>${en ? `${rs.length} · ${live} running · last 7 days` : `${rs.length} 项 · ${live} 项在跑 · 最近 7 天`}</span></div>` +
      ringOnce(() => `<div class="rs-list">${sorted.map(row).join("")}</div>` +
      (od.length ? `<div class="rs-h"><b>${en ? "On demand" : "按需常驻"}</b><span>${en ? "no fixed time" : "没有固定时间"}</span></div><div class="rs-list">${od.map(odRow).join("")}</div>` : "")) +
      (done.length ? stageGroups(done, "ongoing", true) : "");
  }
  function catPage(c) {
    const list = items().filter(i => i.category === c);
    let html = pageHead(c);
    if (!list.length) return html + `<div class="empty">${t("empty")}</div>`;
    return html + stageGroups(list, c);
  }

  let officeMounted = false;
  function officeStats() {
    const its = items(), c = counts();
    const days = Array.from({ length: 7 }, (_, i) => dayKey(new Date(Date.now() - (6 - i) * 864e5)));
    const spark = days.map(d => its.filter(i => i.stage === "done" && i.closed && dayKey(new Date(i.closed)) === d).length);
    const week = spark.reduce((a, b) => a + b, 0), doing = its.filter(i => grpOf(i) === "doing").length;
    const en = UI.lang === "en";
    return { spark, s1: en ? `On you ${c.review}` : `待拍板 ${c.review}`, s2: en ? `Doing ${doing}` : `进行中 ${doing} · 待办 ${its.filter(i => grpOf(i) === "todo").length}`,
      n1: en ? `Shipped ${week}` : `本周交付 ${week}` };
  }
  // ===== t-imp29-p4: 素材库 (asset library). Every attachment on every card (archived ones too), built from the loaded state; no new API.
  // uploads/voices/ is private voice material (仅本机私用): hidden until switched on, then flagged. Only uploads/ and work/ paths show (never tools/).
  // Lazy: 60 tiles per batch (an IntersectionObserver on .lib-more adds the next 60), images via /api/thumb + loading=lazy, no video posters
  // (a video tile only reads its duration from the file header once it is on screen). A poll keeps the DOM unless the asset list itself changed.
  const LIB = { kind: "all", who: "", q: "", priv: false, n: 60, rev: null, list: null, sig: "", dur: {}, io: null, dio: null, pio: null, peaks: {}, pq: [], busy: false, ac: null };
  const LIB_BATCH = 60;
  const libPriv = p => /^uploads\/voices\//.test(p);
  const libKind = p => /\.(png|jpe?g|gif|webp|heic|heif)$/i.test(p) ? "image" : isAudioAtt(p) ? "audio" : /\.(mp4|mov|m4v|webm)$/i.test(p) ? "video" : "other";
  const libUrl = p => "/" + p.split("/").map(encodeURIComponent).join("/");
  const libName = p => p.split("/").pop().replace(/^\d{8}-\d{6}-[0-9a-f]{4}-/, "");
  function libCollect() {
    if (!ARCH.all || ARCH.v !== (ST.meta.archive || {}).v) archAll();   // t-perf A: archived cards' files arrive a moment later ("rt-arch")
    if (LIB.list && LIB.rev === REV && LIB.av === ARCH.v) return LIB.list;
    const m = new Map();
    const add = (p, it, who, ms) => {
      if (typeof p !== "string" || !/^(uploads|work)\//.test(p) || /(^|\/)\.\.(\/|$)/.test(p)) return;
      const st = p.match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-[0-9a-f]{4}-/);   // uploads carry their own timestamp
      if (st) ms = new Date(+st[1], st[2] - 1, +st[3], +st[4], +st[5], +st[6]).getTime();
      const a = m.get(p);
      if (!a) m.set(p, { p, kind: libKind(p), priv: libPriv(p), item: it, who, ms: ms || 0, n: 1 });
      else { a.n++; if (ms > a.ms) { a.ms = ms; a.item = it; a.who = who; } }   // shown under the card that used it last
    };
    const live = new Set((ST.items || []).map(i => i.id));
    for (const it of (ST.items || []).concat((ARCH.all || []).filter(i => !live.has(i.id)))) {
      const subs = (it.thread || []).filter(x => x.kind === "event" && /^提交审核/.test(x.text || "")).map(x => Date.parse(x.t)).filter(isFinite);
      const t0 = subs.length ? subs[0] : Date.parse(it.created) || 0, t1 = subs.length ? subs[subs.length - 1] : Date.parse(it.updated) || t0;
      for (const p of it.attachments || []) add(p, it, it.owner, t0);
      for (const p of it.draft_attachments || []) add(p, it, it.owner, t1);
      for (const x of it.thread || []) for (const p of x.attachments || []) add(p, it, x.who || it.owner, Date.parse(x.t) || t0);
    }
    LIB.list = [...m.values()].sort((a, b) => b.ms - a.ms || a.p.localeCompare(b.p)); LIB.rev = REV; LIB.av = ARCH.v;
    return LIB.list;
  }
  document.addEventListener("rt-arch", () => { if (UI.page === "assets") renderPage(); });
  const libSig = L => L.length + "|" + L.map(a => a.p + ">" + a.item.id).join(",");
  function libFilter(L, skip) {
    const q = LIB.q.trim().toLowerCase();
    return L.filter(a => (LIB.priv || !a.priv) && (skip === "kind" || LIB.kind === "all" || a.kind === LIB.kind) && (skip === "who" || !LIB.who || a.who === LIB.who) &&
      (!q || a.p.toLowerCase().includes(q) || (a.item.title || "").toLowerCase().includes(q) || a.item.id.toLowerCase().includes(q)));
  }
  const libWho = w => w === "me" ? whoName("me") : aname(agent(w));
  function libChips(L) {
    const zh = UI.lang !== "en", byK = libFilter(L, "kind"), byW = libFilter(L, "who");
    const K = [["all", zh ? "全部" : "All"], ["image", zh ? "图片" : "Images"], ["video", zh ? "视频" : "Video"], ["audio", zh ? "录音" : "Audio"], ["other", zh ? "其他" : "Other"]];
    const kc = k => k === "all" ? byK.length : byK.filter(a => a.kind === k).length;
    const ids = new Set(byW.map(a => a.who)), ag = agents().map(a => a.id), order = ag.filter(id => ids.has(id)).concat([...ids].filter(w => w && !ag.includes(w)));
    const nPriv = L.filter(a => a.priv).length;
    return `<div class="lib-seg" role="group">${K.map(([k, n]) => `<button type="button" class="${LIB.kind === k ? "on" : ""}" data-libk="${k}">${n} <small>${kc(k)}</small></button>`).join("")}</div>` +
      `<div class="lib-seg lib-who" role="group"><button type="button" class="${LIB.who ? "" : "on"}" data-libw="">${zh ? "所有人" : "Everyone"}</button>${order.map(w => `<button type="button" class="${LIB.who === w ? "on" : ""}" data-libw="${esc(w)}">${esc(libWho(w))}</button>`).join("")}</div>` +
      (nPriv ? `<button type="button" class="lib-pvt${LIB.priv ? " on" : ""}" data-libpriv>${LIB.priv ? (zh ? `已显示私用录音 ${nPriv} 个 · 隐藏` : `Showing ${nPriv} private voice files · hide`) : (zh ? `私用录音 ${nPriv} 个已隐藏 · 显示` : `${nPriv} private voice files hidden · show`)}</button>` : "");
  }
  function libDay(ms) {
    const zh = UI.lang !== "en", d = new Date(ms), k = dayKey(d), md = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    if (!ms) return zh ? "日期不明" : "Undated";
    if (k === dayKey(new Date())) return (zh ? "今天 · " : "Today · ") + md;
    if (k === dayKey(new Date(Date.now() - 864e5))) return (zh ? "昨天 · " : "Yesterday · ") + md;
    return (d.getFullYear() !== new Date().getFullYear() ? d.getFullYear() + "-" : "") + md;
  }
  function libTile(a) {
    const zh = UI.lang !== "en", u = libUrl(a.p), name = esc(libName(a.p)), it = a.item, w = agent(a.who) || agent(it.owner);
    const lb = `data-lb="${u}" data-name="${name}" data-lib-item="${esc(it.id)}" data-lib-title="${esc(it.title || it.id)}"${a.priv ? "" : ` data-lib-path="${esc(a.p)}"`}`;   // t-lib-attach: path for drag / 附到回复 (never for private voice files)
    let face;
    if (a.kind === "image") {
      const th = `/api/thumb?p=${encodeURIComponent(a.p)}&w=360`;
      face = /\.(heic|heif)$/i.test(a.p) ? `<a href="${u}" target="_blank" class="lib-f" ${lb} data-kind="image"><img src="${th}" alt="${name}" loading="lazy" decoding="async" onload="this.classList.add('ld')" onerror="this.style.display='none'"></a>`
        : `<a href="${u}" target="_blank" class="lib-f" ${lb} data-kind="image"><img src="${th}" alt="${name}" loading="lazy" decoding="async" onload="this.classList.add('ld')" onerror="if(!this.dataset.f){this.dataset.f=1;this.src='${u}'}else{this.style.display='none'}"></a>`;
    } else if (a.kind === "video") {
      const d = LIB.dur[a.p];
      face = `<a href="${u}" target="_blank" class="lib-f lib-vid" ${lb} data-kind="video"><i class="lib-play" aria-hidden="true">▶</i><b class="lib-k">${zh ? "视频" : "Video"}<span class="lib-dur" data-libdur="${esc(a.p)}">${d ? " " + fmtDur(d) : ""}</span></b></a>`;
    } else if (a.kind === "audio") {
      face = `<div class="lib-f lib-aud"><b class="lib-k">${zh ? "录音" : "Audio"}</b>${vmHTML(a.p, u, name)}</div>`;
    } else {
      const ext = (a.p.match(/\.([a-z0-9]+)$/i) || [, "file"])[1].toLowerCase();
      face = `<a href="${u}" target="_blank" class="lib-f lib-doc"${a.priv ? "" : ` data-lib-path="${esc(a.p)}"`}><em>.${esc(ext)}</em><small>${name}</small></a>`;
    }
    const cap = `<div class="lib-cap" data-item="${esc(it.id)}" title="${esc((zh ? "去这张卡 · " : "Open card · ") + (it.title || it.id))}">${w ? av(w, "sm") : ""}<span>${esc(it.title || it.id)}</span></div>`;
    return `<div class="lib-t lib-${a.kind}${a.priv ? " lib-pv" : ""}" title="${esc(a.p)}">${face}${a.priv ? `<span class="lib-pvb">${zh ? "仅本机私用" : "Private"}</span>` : ""}${cap}</div>`;
  }
  // append tiles [from, to) of the filtered list, grouped by day; a batch that starts on the same day continues the last section
  function libAppend(grid, F, from, to) {
    const last = grid.lastElementChild; let cur = last ? last.dataset.day : null, open = false, html = "", tail = "";
    if (!from || !LIB.ring) LIB.ring = new Set();   // t-m2-a ⓪: a working uploader rings on its newest tile only
    ringOnce(() => { for (let i = from; i < Math.min(to, F.length); i++) {
      const a = F[i], k = a.ms ? dayKey(new Date(a.ms)) : "-";
      if (k !== cur) { if (open) html += `</div></section>`; html += `<section class="lib-day" data-day="${k}"><h3 class="lib-dh">${libDay(a.ms)}</h3><div class="lib-g">`; open = true; cur = k; }
      if (open) html += libTile(a); else tail += libTile(a);
    } }, LIB.ring);
    if (open) html += `</div></section>`;
    if (tail) last.querySelector(".lib-g").insertAdjacentHTML("beforeend", tail);
    if (html) grid.insertAdjacentHTML("beforeend", html);
  }
  function libPaint(full) {
    const root = $("#pagebody .lib-root"); if (!root) return;
    const L = libCollect(), F = libFilter(L), grid = $(".lib-grid", root), zh = UI.lang !== "en";
    $(".lib-chips", root).innerHTML = libChips(L);
    $(".lib-sub", root).textContent = zh ? `所有单子里的图、视频、录音 · ${F.length} / ${L.filter(a => LIB.priv || !a.priv).length} 个 · 点开用原来的查看器` : `Images, video and audio from every card · ${F.length} of ${L.filter(a => LIB.priv || !a.priv).length} · opens in the viewer`;
    if (full) { grid.innerHTML = ""; libAppend(grid, F, 0, LIB.n); }
    grid.dataset.shown = Math.min(LIB.n, F.length);
    $(".lib-none", root).hidden = F.length > 0;
    $(".lib-more", root).hidden = LIB.n >= F.length;
    LIB.sig = libSig(L);
    libObserve(root); vmSync();
  }
  function libMore() {
    const root = $("#pagebody .lib-root"); if (!root) return;
    const F = libFilter(libCollect()), from = Math.min(LIB.n, F.length); if (from >= F.length) return;
    LIB.n += LIB_BATCH; libAppend($(".lib-grid", root), F, from, LIB.n);
    $(".lib-more", root).hidden = LIB.n >= F.length; libObserve(root); vmSync();
  }
  function libObserve(root) {
    if (!("IntersectionObserver" in window)) return;
    if (!LIB.io) LIB.io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) libMore(); }, { rootMargin: "600px 0px" });
    LIB.io.disconnect(); LIB.io.observe($(".lib-more", root));
    if (!LIB.dio) LIB.dio = new IntersectionObserver(es => es.forEach(e => {   // a video's duration: header only, once it is on screen
      if (!e.isIntersecting) return; const el = e.target, p = el.dataset.libdur; LIB.dio.unobserve(el);
      if (LIB.dur[p]) { el.textContent = " " + fmtDur(LIB.dur[p]); return; }
      const v = document.createElement("video"); v.preload = "metadata"; v.muted = true;
      v.addEventListener("loadedmetadata", () => { if (isFinite(v.duration)) { LIB.dur[p] = v.duration; document.querySelectorAll(`.lib-dur[data-libdur="${CSS.escape(p)}"]`).forEach(x => x.textContent = " " + fmtDur(v.duration)); } v.removeAttribute("src"); v.load(); });
      v.src = libUrl(p);
    }), { rootMargin: "200px 0px" });
    root.querySelectorAll(".lib-dur:empty").forEach(el => LIB.dio.observe(el));
    // audio without a server waveform: decode it once it is on screen (one file at a time, one shared AudioContext; files over 12 MB keep the placeholder)
    if (!LIB.pio) LIB.pio = new IntersectionObserver(es => es.forEach(e => { if (!e.isIntersecting) return; LIB.pio.unobserve(e.target); const w = e.target.closest(".vm-wrap"); if (w) libPeaks(w.dataset.vm); }), { rootMargin: "200px 0px" });
    root.querySelectorAll(".lib-aud .vm-wave.vm-ph").forEach(el => { const p = el.closest(".vm-wrap").dataset.vm; if (LIB.peaks[p]) libPeakPaint(p); else LIB.pio.observe(el); });
  }
  function libPeakPaint(p) {
    const pk = LIB.peaks[p]; if (!pk || pk === 1) return;
    document.querySelectorAll(`#pagebody .lib-aud .vm-wrap[data-vm="${CSS.escape(p)}"] .vm-wave`).forEach(wv => { wv.querySelectorAll(".vm-b").forEach(b => b.innerHTML = vmBars(pk)); wv.classList.remove("vm-ph"); });
  }
  function libPeaks(p) {
    if (LIB.peaks[p] || LIB.pq.includes(p)) return;
    LIB.pq.push(p); if (LIB.busy) return;
    const next = () => {
      const q = LIB.pq.shift(); if (!q) { LIB.busy = false; return; }
      LIB.busy = true;
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) { LIB.busy = false; return; }
      fetch(libUrl(q)).then(r => +(r.headers.get("content-length") || 0) > 12e6 ? null : r.arrayBuffer())
        .then(buf => buf && new Promise((ok, no) => (LIB.ac = LIB.ac || new AC()).decodeAudioData(buf, ok, no)))
        .then(ab => {
          if (!ab) { LIB.peaks[q] = 1; return; }
          const ch = ab.getChannelData(0), n = 48, step = Math.floor(ch.length / n), rms = [];
          for (let i = 0; i < n; i++) { let s = 0, c = 0; for (let j = i * step; j < (i + 1) * step; j += 64) { s += ch[j] * ch[j]; c++; } rms.push(Math.sqrt(s / (c || 1))); }
          const top = Math.max(...rms) || 1; LIB.peaks[q] = rms.map(v => +Math.max(0.12, Math.pow(v / top, 0.7)).toFixed(2)); libPeakPaint(q);
        }).catch(() => { LIB.peaks[q] = 1; }).then(next);
    };
    next();
  }
  PAGES.assets = function () {
    const root = $("#pagebody .lib-root");
    if (root && root.dataset.lang === UI.lang) {   // already on the page: keep the DOM (scroll, focus, loaded thumbs); repaint only if the list changed
      if (libSig(libCollect()) !== LIB.sig) libPaint(true);
      return null;
    }
    LIB.n = LIB_BATCH;
    const zh = UI.lang !== "en";
    return pageHead("assets") + `<div class="lib-root" data-lang="${UI.lang}"><div class="lib-sub"></div>
      <div class="lib-bar"><div class="lib-chips"></div><input type="search" class="lib-q" placeholder="${zh ? "搜文件名或单子…" : "Search file or card…"}" value="${esc(LIB.q)}" aria-label="${zh ? "搜索素材" : "Search assets"}"></div>
      <div class="lib-grid"></div><div class="lib-none empty" hidden>${zh ? "没有符合条件的素材" : "Nothing matches"}</div><div class="lib-more" aria-hidden="true"></div></div>`;
  };
  hooks.push(k => { if (k === "page" && UI.page === "assets") { const g = $("#pagebody .lib-grid"); if (g && !g.childElementCount && g.dataset.shown == null) libPaint(true); } });
  document.addEventListener("click", e => {
    const k = e.target.closest("[data-libk]"); if (k) { LIB.kind = k.dataset.libk; LIB.n = LIB_BATCH; libPaint(true); return; }
    const w = e.target.closest("[data-libw]"); if (w) { LIB.who = w.dataset.libw; LIB.n = LIB_BATCH; libPaint(true); return; }
    if (e.target.closest("[data-libpriv]")) { LIB.priv = !LIB.priv; LIB.n = LIB_BATCH; libPaint(true); }
  });
  let libQT = 0;
  document.addEventListener("input", e => { if (!e.target.classList || !e.target.classList.contains("lib-q")) return; clearTimeout(libQT); libQT = setTimeout(() => { LIB.q = e.target.value; LIB.n = LIB_BATCH; libPaint(true); }, 160); });

  // ===== t-imp29-p5: card ids in messages / drafts render as chips (md.js calls md.ref), and a # card picker in the chat and detail composers.
  // Chips are deterministic HTML (no time-based styles), so a poll re-render of the chat produces the same markup. What gets sent is still the plain id.
  const idcMap = () => { if (!idcMap.m || idcMap.rev !== REV) { idcMap.m = new Map(((ST && ST.items) || []).map(i => [i.id, i]));
    for (const [id, title, owner] of archIx()) if (!idcMap.m.has(id)) idcMap.m.set(id, { id, title, owner, stage: "done", archived: true });   // t-perf A
    idcMap.rev = REV; } return idcMap.m; };
  md.ref = id => {
    if (!ST) return null; const it = idcMap().get(id); if (!it) return null;
    const a = it.owner && agent(it.owner), st = it.archived ? (UI.lang === "en" ? "archived" : "已归档") : rowLabel(it);
    return `<span class="idc st-${esc(it.archived ? "archived" : grpOf(it))}" data-idc="${esc(id)}" role="link" tabindex="0" title="${esc(id + " · " + (it.title || "") + " · " + st)}">${a ? `<i class="idc-av" style="background-image:url('${avatarUrl(a)}')"></i>` : ""}<b>${esc(it.title || id)}</b><small>${esc(st)}</small></span>`;
  };
  const idcGo = c => { const id = c.dataset.idc; if (c.closest("#drawer") && UI.item) { if (id !== UI.item) navItem(id); } else openItem(id); };
  document.addEventListener("click", e => {   // capture: a chip can sit inside rows / bubbles that have their own click handlers
    const c = e.target.closest && e.target.closest("[data-idc]"); if (!c) return;
    e.preventDefault(); e.stopPropagation(); idcGo(c);
  }, true);
  document.addEventListener("keydown", e => { const c = e.target.closest && e.target.closest("[data-idc]"); if (c && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); idcGo(c); } });

  const HP = { el: null, ta: null, rows: [], sel: 0, at: -1, q: "" };
  const HP_TA = "#right .ch-comp textarea, #drawer .composer textarea";
  function hpEl() {
    if (HP.el) return HP.el;
    const el = HP.el = document.createElement("div"); el.className = "hp-pop"; el.hidden = true; el.setAttribute("role", "listbox");
    document.body.appendChild(el);
    el.addEventListener("mousedown", e => e.preventDefault());   // keep the caret in the textarea
    el.addEventListener("click", e => { const r = e.target.closest("[data-hp]"); if (r) hpPick(+r.dataset.hp); });
    return el;
  }
  function hpClose() { if (HP.el) HP.el.hidden = true; HP.rows = []; HP.ta = null; }
  function hpScan(ta) {
    const c = ta.selectionStart; if (c !== ta.selectionEnd) return hpClose();
    const m = ta.value.slice(0, c).match(/(^|[\s，。、；：,;:（(“"'])#([^\s#]{0,24})$/); if (!m) return hpClose();
    const q = m[2].toLowerCase();
    HP.ta = ta; HP.at = c - m[2].length - 1; HP.q = m[2];
    HP.rows = window.Pal ? Pal.find(q, { items: 6, recent: 6 }).items.slice(0, 6) : items().filter(i => !q || (i.title + " " + i.id).toLowerCase().includes(q)).sort(byAct).slice(0, 6);
    HP.sel = 0; hpDraw();
  }
  function hpDraw() {
    const el = hpEl(), zh = UI.lang !== "en";
    if (!HP.ta) return hpClose();
    el.innerHTML = `<div class="hp-h">${zh ? "引用一张卡" : "Link a card"} · #${esc(HP.q)}</div>` +
      (HP.rows.length ? HP.rows.map((it, i) => { const a = agent(it.owner); return `<div class="hp-r${i === HP.sel ? " on" : ""}" data-hp="${i}" role="option" aria-selected="${i === HP.sel}">${a ? `<i class="idc-av" style="background-image:url('${avatarUrl(a)}')"></i>` : ""}<b>${esc(it.title || it.id)}</b><small>${esc(grpLabel(grpOf(it)))}</small></div>`; }).join("")
        : `<div class="hp-none">${zh ? "没有对得上的卡" : "No matching card"}</div>`) +
      `<div class="hp-f">${zh ? "↑↓ 选 · ↵ 插入 · 发出去后对方收到的是卡片 id" : "↑↓ move · ↵ insert · the message carries the card id"}</div>`;
    el.hidden = false; hpPlace();
  }
  function hpPlace() {
    if (!HP.ta || !HP.el || HP.el.hidden) return;
    const box = (HP.ta.closest(".ch-comp, .composer") || HP.ta).getBoundingClientRect(), el = HP.el, vv = window.visualViewport;
    const w = Math.min(box.width, 460, innerWidth - 16), left = Math.max(8, Math.min(box.left, innerWidth - w - 8));
    el.style.width = w + "px"; el.style.left = left + "px";
    const h = el.offsetHeight, vTop = vv ? vv.offsetTop : 0;
    el.style.top = Math.max(vTop + 8, box.top - h - 8) + "px";
  }
  function hpPick(i) {
    const it = HP.rows[i], ta = HP.ta; if (!it || !ta) return hpClose();
    const v = ta.value, end = ta.selectionStart, ins = it.id + " ";
    ta.value = v.slice(0, HP.at) + ins + v.slice(end);
    const p = HP.at + ins.length; hpClose(); ta.focus(); ta.setSelectionRange(p, p);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
  document.addEventListener("input", e => { if (e.target.matches && e.target.matches(HP_TA) && !e.isComposing) hpScan(e.target); });
  document.addEventListener("compositionend", e => { if (e.target.matches && e.target.matches(HP_TA)) hpScan(e.target); });
  document.addEventListener("focusout", e => { if (HP.ta && e.target === HP.ta) setTimeout(() => { if (HP.ta && document.activeElement !== HP.ta) hpClose(); }, 200); });
  document.addEventListener("keydown", e => {   // capture: runs before the composer's own keys (send, the @ picker)
    if (!HP.ta || e.target !== HP.ta || !HP.el || HP.el.hidden || e.isComposing || e.keyCode === 229) return;
    const k = e.key, n = HP.rows.length;
    if ((k === "ArrowDown" || k === "ArrowUp") && n) { HP.sel = (HP.sel + (k === "ArrowDown" ? 1 : -1) + n) % n; hpDraw(); }
    else if ((k === "Enter" || k === "Tab") && n && !(e.metaKey || e.ctrlKey || e.shiftKey)) hpPick(HP.sel);
    else if (k === "Escape") hpClose();
    else return;
    e.preventDefault(); e.stopImmediatePropagation();
  }, true);
  document.addEventListener("keyup", e => { if (HP.ta && e.target === HP.ta && /^Arrow(Left|Right)$|^Home$|^End$/.test(e.key)) hpScan(HP.ta); });
  addEventListener("resize", () => hpPlace());
  if (window.visualViewport) visualViewport.addEventListener("resize", () => hpPlace());

  // t-office-d1-s12: the four numbers of the home strip (they also drive the list filter UI.hf on phones)
  function homeCounts() {   // t-imp-p1: review = 等你拍板 (review items + plans / questions parked in waiting)
    const its = items(), wk = Date.now() - 7 * 864e5, rev = its.filter(i => onYouCard(i) && i.id !== RV.pending);
    return { review: rev.length + its.filter(i => awaitsUser(i) && !busy(i) && !snoozed(i)).length, doing: its.filter(i => grpOf(i) === "doing").length, todo: its.filter(i => grpOf(i) === "todo").length,
      week: its.filter(i => i.stage === "done" && i.closed && new Date(i.closed) > wk).length, oldest: rev.length ? Math.min(...rev.map(i => new Date(i.activity || i.updated))) : null };
  }
  // t-visual-stage: pins on the terrace office (positions are fractions of the hero image; a new role without a seat is skipped)
  const STG_SEAT = { manager: [.40, .56], smith: [.66, .70], writer: [.16, .30], director: [.30, .27], artist: [.80, .52], scout: [.53, .40], ops: [.90, .72] };
  function stageHero(ob) {
    if (ob.dataset.hv !== "stage") { ob.dataset.hv = "stage"; ob.innerHTML = ""; ob._stg = ""; }
    const en = UI.lang === "en", A = agents(), busy = A.filter(a => a.status === "working" && !mgrOnline(a)), c = homeCounts();
    const capHTML = `<span><i class="${c.review ? "" : "z"}"></i>${c.review} ${en ? "on you" : "等你拍板"}</span><span>${busy.length} ${en ? "busy" : "在忙"} · ${A.length - busy.length} ${en ? "idle" : "待机"}</span>`;
    if (window.Office && Office.hero) {   // t-office-v3: the terrace pixel people (office3.js, same picture as hero.jpg) instead of avatar pins
      if (!ob.querySelector(".o3-hero")) Office.hero(ob, pixelOpen);
      Office.heroUpdate(A, a => aname(a));
      let cap = ob.querySelector(".stg-cap"); if (!cap) { cap = document.createElement("div"); cap.className = "stg-cap"; ob.appendChild(cap); }
      if (cap._h !== capHTML) { cap.innerHTML = capHTML; cap._h = capHTML; }
      return;
    }
    const pins = A.filter(a => STG_SEAT[a.id]).map(a => { const [x, y] = STG_SEAT[a.id], w = a.status === "working" && !mgrOnline(a), it = w ? liveItem(a) : null;
      const pos = `left:${x * 100}%;top:${y * 100}%`;
      return `<span role="button" tabindex="0" class="stg-pin${w ? " w" : ""}" style="${pos};background-image:url('${avatarUrl(a)}')"${it ? ` data-item="${it.id}"` : ""} title="${esc(aname(a))}${it ? " · " + esc(it.title) : ""}" aria-label="${esc(aname(a))}"></span>`
        + (it ? `<span class="stg-tag" style="${pos}">${esc(aname(a))} · ${esc(it.title)}</span>` : ""); }).join("");
    const html = pins + `<div class="stg-cap"><span><i class="${c.review ? "" : "z"}"></i>${c.review} ${en ? "on you" : "等你拍板"}</span><span>${busy.length} ${en ? "busy" : "在忙"} · ${A.length - busy.length} ${en ? "idle" : "待机"}</span></div>`;
    if (ob._stg !== html) { ob.innerHTML = html; ob._stg = html; const d = `-${(Date.now() % 2000) / 1000}s`; ob.querySelectorAll(".stg-pin.w").forEach(p => p.style.setProperty("--d", d)); }
  }
  // ===== t-home-newreplies: 「新回复」 = the server's reply mail (kind "reply", written for every msg / reply an agent posts on a card; log lines and events
  // are not mailed) that is still unread, from the last 3 days, grouped by card. Read flags live on the server (mail_read), so phone and desktop agree.
  // Opening a card marks its replies read; the first unread reply is where the detail opens.
  const NR_MS = 3 * 864e5;
  const nrMail = id => (ST.mail || []).filter(m => m.kind === "reply" && !m.read && m.item && m.item !== "None" && (!id || m.item === id) && Date.now() - Date.parse(m.t) < NR_MS);
  function newReplies() {
    const by = {}; nrMail().forEach(m => { const it = (ST.items || []).find(i => i.id === m.item); if (it) (by[m.item] = by[m.item] || { it, ms: [] }).ms.push(m); });
    return Object.values(by).map(g => (g.ms.sort((a, b) => a.t.localeCompare(b.t)), g)).sort((a, b) => b.ms[b.ms.length - 1].t.localeCompare(a.ms[a.ms.length - 1].t));
  }
  const nrDot = id => nrMail(id).length ? `<i class="nr-dot" title="${UI.lang === "en" ? "New reply" : "有新回复"}"></i>` : "";
  const nrFirst = t => (String(t || "").replace(/^[^:：\n]{1,8}[:：]\s*/, "").split(/(?<=[。！？!?])|\n/)[0] || "").trim();
  function nrBlock() {
    const g = newReplies(); if (!g.length) return "";
    const zh = UI.lang !== "en", n = g.reduce((s, x) => s + x.ms.length, 0), shown = g.slice(0, 4);
    return `<div class="nr"><div class="nr-h"><b>${zh ? "新回复" : "New replies"}</b><small>${n}</small><span class="sp"></span><button class="nr-all" data-nr-all>${zh ? "全部标为已读" : "Mark all read"}</button></div>` +
      shown.map(({ it, ms }) => { const m = ms[ms.length - 1], a = agent(m.agent);
        return `<div class="nr-r" role="link" tabindex="0" data-nr="${esc(it.id)}">${av(a)}${ms.length > 1 ? `<span class="nr-n">${ms.length}</span>` : ""}<b>${esc(aname(a))} <i>· ${esc(it.title)}</i></b><time>${agoH(m.t)}</time><p>${esc(nrFirst(m.text))}</p><i class="nr-dot"></i></div>`; }).join("") +
      (g.length > shown.length ? `<button class="nr-more" data-h="mail">${zh ? `还有 ${g.length - shown.length} 张卡有新回复 · 去信箱` : `${g.length - shown.length} more cards · open mailbox`}</button>` : "") + `</div>`;
  }
  // r-improve-1102 P3: read marks shared through the server. A chat / DM message is mirrored into the mailbox (kind reply, no card); reading the thread
  // on any device marks those mails read, and a thread counts as read up to the newest mirrored mail that is read. Opening a card reads all of its
  // mail, and mail of a closed card is read once seen here (only mail_read, which already existed: no server change).
  const chatMail = id => (ST.mail || []).filter(m => m.kind === "reply" && (!m.item || m.item === "None") && m.agent === id);
  const srvSeen = id => chatMail(id).reduce((t, m) => m.read && m.t > t ? m.t : t, "");
  const seenOf = id => { const a = (UI.seen || {})["chat." + id] || "", b = srvSeen(id); return a > b ? a : b; };
  /* t-ri1104-p2: the one unread rule for every dot and number (chat roster, TEAM rows, phone list + tab bar, office): messages from them newer than what you have read, server read marks included */
  const unreadOf = id => { const s = seenOf(id); return chatList(id).filter(m => m.who !== "me" && m.t > s).length; };
  const unreadTag = n => n > 99 ? "99+" : String(n);
  function chatMailRead(id, upto) { const ids = chatMail(id).filter(m => !m.read && m.t <= upto).map(m => m.id); if (ids.length) nrRead(ids); }
  function itemMailRead(id) { const ids = (ST.mail || []).filter(m => !m.read && m.item === id).map(m => m.id); if (ids.length) nrRead(ids); }
  function doneMailRead() {
    const done = new Set((ST.items || []).filter(i => i.stage === "done" || i.archived).map(i => i.id)); archIx().forEach(x => done.add(x[0]));   // t-perf A
    const ids = (ST.mail || []).filter(m => !m.read && m.item && done.has(m.item)).map(m => m.id); if (ids.length) nrRead(ids);
  }
  function nrRead(ids) { if (!ids.length) return; (ST.mail || []).forEach(m => { if (ids.includes(m.id)) m.read = true; }); api("mail_read", { ids }).catch(() => { }); }

  // t-home-applike: the desktop 首页 (review page) in the phone app's shape, switchable back to the classic stage home (stored per device).
  const appHome = () => !MOBQ.matches && UI.home === "app" && UI.page === "review";
  const widgetHome = () => !MOBQ.matches && (UI.home === "widgets" || UI.home === "dense") && UI.page === "review";   // t-home-widgets (web/widgets.js + widgets.css)
  const homeSwitch = () => MOBQ.matches ? "" : `<button class="home-sw" data-home-set="${UI.home === "classic" ? "app" : "classic"}">${UI.lang === "en" ? (UI.home === "classic" ? "App-style home" : "Classic home") : (UI.home === "classic" ? "换成 app 式首页" : "切回原来的首页")}</button>`;
  function setHome(v) { UI.home = ["classic", "app", "widgets"].includes(v) ? v : "dense"; LS.set("home3", UI.home); UI.hf = "review"; renderPage(true); }
  const phaseFree = h => h.replace(/--wp:-?[\d.]+s|animation-delay:-\d+ms|--wg-fd:-\d+ms| tl-(?:in|out)/g, "").replace(/(<time class="(?:wk-el|rel)"[^>]*>)[^<]*/g, "$1");   // t-home-flicker
  function renderPage(scrollTop) {
    document.documentElement.dataset.home = appHome() ? "app" : widgetHome() ? "widgets" : "classic"; if (widgetHome() && UI.home === "dense") document.documentElement.dataset.dense = "1"; else delete document.documentElement.dataset.dense;   // t-home-applike: scopes home-app.css
    autoFold();
    const page = $("#page");
    let body = $("#pagebody", page);
    if (!body) { page.innerHTML = `<div class="office" id="officebox"></div><div id="pagebody"></div>`; body = $("#pagebody", page); officeMounted = false; }
    const ob = $("#officebox", page);
    if (UI.page === "review" && !widgetHome()) {
      ob.hidden = false;
      if ((MOBQ.matches || appHome()) && window.HomeD && HomeD.enabled()) {   // t-home-applike: the desktop app-style home uses the same strip   // t-office-d1-s12: phones get the D1 character strip; the pixel office folds out behind its pill
        officeMounted = false; HomeD.render(ob, { agents: agents(), stats: officeStats(), counts: homeCounts() });
      } else if (!MOBQ.matches && document.documentElement.dataset.stage) {   // t-visual-stage: desktop 舞台 theme shows the terrace office with avatar pins
        officeMounted = false; stageHero(ob);
      } else {
        if (ob.dataset.hv) { ob.dataset.hv = ""; ob.innerHTML = ""; officeMounted = false; }
        if (!officeMounted) { Office.mount(ob, pixelOpen); officeMounted = true; }
        Office.update(agents(), a => aname(a), officeStats());
      }
    } else { ob.hidden = true; officeMounted = false; ob.innerHTML = ""; }
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
  MOBQ.addEventListener("change", () => { if (ST) renderHeader(); if (UI.page === "review" || UI.page === "mail") renderPage(); });   // t-stamina-stale: the stamina subtitle differs on phones
  window.addEventListener("beforeunload", () => { if (UI.page === "review") { UI.seen.review = new Date().toISOString(); LS.set("seen", UI.seen); } });

  document.addEventListener("click", e => {
    const s = e.target.closest("[data-sort]"); if (s) { UI.sort = s.dataset.sort; LS.set("sort", UI.sort); renderPage(); }
    const hs = e.target.closest("[data-home-set]"); if (hs) setHome(hs.dataset.homeSet);   // t-home-applike
    const nr = e.target.closest("[data-nr]"); if (nr) { openItem(nr.dataset.nr); return; }   // t-home-newreplies
    if (e.target.closest("[data-nr-all]")) { nrRead(newReplies().flatMap(g => g.ms.map(m => m.id))); renderPage(); renderLeft(); }
    if (e.target.closest("[data-board-all]")) { UI.boardAll = true; renderPage(); }
    const df = e.target.closest("[data-donefold]"); if (df) { lsSet("rt.doneOpen." + df.dataset.donefold, !doneOpen(df.dataset.donefold)); renderPage(); }   // t-done-fold
    const lf = e.target.closest("[data-logf]"); if (lf) { UI.logAgent = lf.dataset.logf; renderPage(); }
    if (e.target.closest("[data-repreq]")) api("report_request").then(() => toast("→ inbox"));
    const rp = e.target.closest("[data-rep]"); if (rp) { UI.openRep = UI.openRep === rp.dataset.rep ? "-" : rp.dataset.rep; renderPage(); }
    const dc = e.target.closest("[data-doc]"); if (dc) { UI.doc = dc.dataset.doc; fetch("/api/doc?path=" + encodeURIComponent(UI.doc)).then(r => r.json()).then(j => { UI.docText = j.text || j.error; renderPage(); }); }
    const ls = e.target.closest("[data-lesson]"); if (ls) api("lesson", { id: ls.dataset.lesson, decision: ls.dataset.d });
    const mf = e.target.closest("[data-mailf]"); if (mf) { UI.mailFilter = mf.dataset.mailf; renderPage(); renderMailbox(); }
    if (e.target.closest("[data-mailall]")) api("mail_read", { all: true });
    if (e.target.closest("[data-mailunread]")) { UI.mailUnread = !UI.mailUnread; lsSet("rt.mailUnread", UI.mailUnread); renderPage(); }
    const ml = e.target.closest("[data-mail]");
    if (ml) {
      const m = ST.mail.find(x => x.id === ml.dataset.mail);
      api("mail_read", { ids: ml.dataset.mailids ? ml.dataset.mailids.split(",") : [m.id] });
      if (m.item) openItem(m.item); else if (m.agent) setChat(m.agent);
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

  // ---------- drawer ----------
  // The thread reads like a chat: agent replies are cards, logs/events are centred lines, your messages are right bubbles,
  // and each draft version is a card at the time it was submitted.
  const drawerAtt = [];
  const DW = { to: null, pop: [], sel: 0, open: new Set(), n: 0, fresh: false, stampPre: null, askOpen: new Set(), sumOpen: new Set() };   // askOpen / sumOpen: item ids (t-ui-next 1, 4)
  const PHONE = matchMedia("(max-width: 760px)");
  /* t-hdr-trim ⑨: desktop detail / DM box grows with its text up to max px, then scrolls (scrollbar hidden in style.css). Empty = CSS height.
     Measured with transition:none at height 0 (min-height clamps), and only when the text or width changed, because the drawer polls it every 300 ms. */
  function deskFit(ta, max) {
    if (!ta || PHONE.matches) return;
    const v = ta.value, w = ta.clientWidth;
    if (v === ta._fv && w === ta._fw && ta.style.height === ta._fh) return; ta._fv = v; ta._fw = w;
    if (!v) { ta.style.height = ""; ta._fh = ""; return; }
    const st = ta.scrollTop, tr = ta.style.transition;
    ta.style.transition = "none"; ta.style.height = "0px";
    const h = Math.min(max, ta.scrollHeight + ta.offsetHeight - ta.clientHeight);
    ta.style.height = h + "px"; ta._fh = ta.style.height; void ta.offsetHeight; ta.style.transition = tr; ta.scrollTop = st;
  }
  const NR_HIT = 4500;   // t-detail-jump-fix: how long the 新回复 box stays (CSS nrHitFade fades it in the last part)
  const nearEnd = sc => sc.scrollHeight - sc.scrollTop - sc.clientHeight < 60;
  const dwPinned = () => DW.pin && Date.now() < DW.pinUntil;   // t-detail-jump
  function dwPinEnd() { const sc = $("#drawer .dw-scroll"); if (!sc || !dwPinned()) return; sc.scrollTop = sc.scrollHeight; jumpState(); }
  function dwPinWatch(sc) {   // re-armed on every render while pinned: any block that changes height (late images, folded drafts, previews) re-pins
    try { DW.cro && DW.cro.disconnect(); if (!dwPinned()) return; DW.cro = new ResizeObserver(dwPinEnd); [...sc.children].forEach(c => DW.cro.observe(c)); setTimeout(() => DW.cro && !dwPinned() && DW.cro.disconnect(), DW.pinUntil - Date.now() + 50); } catch { }
  }
  // t-parent-links: item -> item navigation (parent <-> child) keeps a small back stack, so back (button / swipe) returns to the card you came from.
  // Any other way of opening or closing a card clears it.
  let dwStack = [], dwNavDir = 0;
  function navItem(id) { if (UI.item && UI.item !== id) dwStack.push(UI.item); dwNavDir = 1; openItem(id, true); }
  function backItem() { if (!dwStack.length) return closeItem(); dwNavDir = -1; openItem(dwStack.pop(), true); }
  // a card's parent = the first tag that is another item's id (child cards carry the parent id in tags, e.g. stateutil --tag t-ios-visual-audit)
  const parentOf = it => { for (const x of it.tags || []) { if (x !== it.id) { const p = (ST.items || []).find(i => i.id === x); if (p) return p; } } return null; };
  const childrenOf = it => (ST.items || []).filter(i => i.id !== it.id && parentOf(i) && parentOf(i).id === it.id).sort((a, b) => (a.created || "").localeCompare(b.created || ""));
  // ===== t-m2-b ①: shared-element push (phone only). A tapped card grows into the detail page and the back button shrinks it back, via the
  // View Transitions API (Safari 18+ / Chrome 111+). view-transition-name sits on ONE element at a time and only for the ~0.36 s of the transition
  // (card -> #drawer on open, #drawer -> card on close), then it is removed. Anything else keeps the old slide: no API, reduced motion, card -> card
  // inside the drawer, deep links / pushes (no tapped card), the finger back-swipe (it already moved the page) and iOS's own edge swipe (popstate).
  const VT = { src: null, at: 0, back: false, cur: null };
  // t-m2b-revert (2026-10-29): the user preferred the old slide (the cross-fade ghosted), so ① is switched OFF here. With VT_ON false, vtOK() is
  // always false and openItem / closeItem take their old slide paths; the capture listener records nothing. The code stays dormant: flip to true to retry.
  const VT_ON = false;
  const vtOK = () => VT_ON && typeof document.startViewTransition === "function" && MOBQ.matches && !RMQ.matches && !document.hidden;
  document.addEventListener("click", e => {   // capture: remember which card was tapped before any handler opens it
    if (!VT_ON) return;
    const c = e.target.closest("[data-item]"); if (c && !c.closest("#drawer, #modal")) { VT.src = c; VT.at = performance.now(); }
    VT.back = !!e.target.closest("#drawer .dw-back[data-close]");
  }, true);
  const vtSeen = el => { if (!el || !el.isConnected) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; };
  function vtRun(update, from, to) {   // from: element named in the old state; to: element (or fn returning it) named in the new state
    if (VT.cur) { try { VT.cur.skipTransition(); } catch (e) {} }
    const de = document.documentElement, N = "m2-card";
    from.style.viewTransitionName = N; de.classList.add("vt-run");
    let vt;
    try {
      vt = document.startViewTransition(() => { from.style.viewTransitionName = ""; update(); const t = typeof to === "function" ? to() : to; if (t) t.style.viewTransitionName = N; VT.end = t; });
    } catch (e) { from.style.viewTransitionName = ""; de.classList.remove("vt-run"); update(); return; }
    VT.cur = vt;
    const done = () => { if (VT.cur === vt) VT.cur = null; if (VT.end) { VT.end.style.viewTransitionName = ""; VT.end = null; } from.style.viewTransitionName = ""; if (!VT.cur) de.classList.remove("vt-run"); };
    vt.ready.catch(() => {}); vt.updateCallbackDone.catch(() => {}); vt.finished.then(done, done);
  }
  function openItem(id, nav) {
    const src = !nav && VT.src && VT.src.dataset.item === id && performance.now() - VT.at < 800 && vtSeen(VT.src) ? VT.src : null; VT.src = null;
    const d = $("#drawer");
    if (src && vtOK() && (d.hidden || !d.classList.contains("open"))) return vtRun(() => openItemNow(id, nav), src, d);
    return openItemNow(id, nav);
  }
  function openItemNow(id, nav) {
    if (!nav) dwStack = [];
    UI.item = id; drawerAtt.length = 0; ATT.lastCard = id;   // t-lib-attach: 「刚才看的卡」
    { const un = nrMail(id).sort((x, y) => x.t.localeCompare(y.t)); DW.hitT = ""; DW.jumpT = un.length ? Date.parse(un[0].t) - 3000 : 0; if (un.length) { nrRead(un.map(m => m.id)); setTimeout(() => { if (UI.page === "review") renderPage(); }, 0); } }   // t-home-newreplies
    DW.to = null; DW.pop = []; DW.open = new Set(); DW.n = 0; DW.fresh = false;
    itemMailRead(id);   // r-improve-1102 P3: opening a card reads all of its mailbox entries, not only the new replies
    const dw = $("#drawer"); clearTimeout(DW.ct); const wasOpen = !dw.hidden && dw.classList.contains("open"); dw.hidden = false;
    dw.innerHTML = `<div class="dw-top"></div><div class="dw-scroll"></div><nav class="dw-toc" hidden></nav>
      <div class="dw-dock"><div class="dw-askbar" hidden></div><div class="composer"><div class="at-pop" hidden></div><textarea placeholder="${esc(t("composer_ph"))}"></textarea><div class="pending-att"></div>
        <div class="cm-row"><button type="button" class="dw-file att" title="${attTitle()}" aria-label="${UI.lang === "en" ? "Attach" : "添加附件"}">${ATT_IC}</button><input type="file" multiple hidden>
        <span class="cm-to"></span><span class="dim dw-def">${t("default_owner")}</span><span style="flex:1"></span><span class="dim">${t("send_hint")}</span></div></div>
      <div class="dw-acts"></div></div>`;
    const ta = $(".composer textarea", dw), fi = $("input[type=file]", dw), pop = $(".at-pop", dw);
    const dk = "item:" + id, dSaved = DRAFT.get(dk);   // t-draft-keep
    const dTag = () => { const old = $(".dr-tag", dw); if (old) old.remove(); };
    if (dSaved) {
      ta.value = dSaved.t;
      $(".dw-dock", dw).insertAdjacentHTML("afterbegin", `<div class="dr-tag"><b>${UI.lang === "en" ? "Draft" : "草稿"}</b><span>${UI.lang === "en" ? "not sent yet" : "上次没发出"} · ${whenH(dSaved.at)}</span><button type="button">${UI.lang === "en" ? "Clear" : "清空"}</button></div>`);
      $(".dr-tag button", dw).onclick = () => { ta.value = ""; DRAFT.set(dk, ""); dTag(); ta.dispatchEvent(new Event("input", { bubbles: true })); ta.focus(); };
    }
    ta.addEventListener("input", () => { if (UI.item !== id) return; DRAFT.set(dk, ta.value); if (!ta.value.trim()) dTag(); });
    const showAtt = () => { attTiles($(".pending-att", dw), drawerAtt, showAtt); fit(); };   // ui19
    // t-detail-bottom (phone only): the field grows with its text (max 120px; works with IME composition, only the height is touched) and
    // .composer.has mirrors "text or attachment present" for CSS (send button lit, composer expanded). Polled like the chat composer, because send/approve clear the value without an input event.
    const fit = () => {
      const cm = $(".composer", dw); if (!cm) return; if (!PHONE.matches) return deskFit(ta, 200);
      if (ta.value) { ta.style.height = "auto"; ta.style.height = Math.min(120, Math.max(40, ta.scrollHeight)) + "px"; } else ta.style.height = "";
      cm.classList.toggle("has", !!ta.value.trim() || drawerAtt.length > 0 || Object.keys(drawerAtt._up || {}).length > 0 || annList().length > 0);   // t-imp29-p2: notes alone can be sent
    };
    ta.addEventListener("input", fit); clearInterval(DW.fi); DW.fi = setInterval(fit, 300);
    const add = wireUploads(ta, drawerAtt, showAtt);
    $(".dw-file", dw).onclick = () => fi.click();
    fi.onchange = () => { add(Array.from(fi.files)); fi.value = ""; };
    const closePop = () => { pop.hidden = true; DW.pop = []; };
    const drawPop = () => {
      pop.innerHTML = DW.pop.map((a, i) => `<div data-pick-to="${a.id}" class="${i === DW.sel ? "on" : ""}">${av(a, "sm")}${esc(aname(a))} <small>${esc(atitle(a))}${a.id === curItem().owner ? " · " + t("owner_tag") : ""}</small></div>`).join("");
      pop.hidden = !DW.pop.length;
    };
    const pick = id => {
      const a = agent(id), pos = ta.selectionStart, before = ta.value.slice(0, pos).replace(/@[^\s@]*$/, "@" + aname(a) + " ");
      ta.value = before + ta.value.slice(pos); ta.setSelectionRange(before.length, before.length);
      DW.to = id; closePop(); drawTo(); ta.focus();
    };
    pop.addEventListener("mousedown", e => { const d = e.target.closest("[data-pick-to]"); if (d) { e.preventDefault(); pick(d.dataset.pickTo); } });
    { // t-sendto-chip: clicking the 「发给」 chip = typing "@" at the caret (opens the same picker); mousedown keeps the textarea focus
      const toBox = $(".cm-to", dw);
      toBox.addEventListener("mousedown", e => { if (!e.target.closest("[data-to-reset]")) e.preventDefault(); });
      toBox.addEventListener("click", e => {
        if (e.target.closest("[data-to-reset]")) return;
        const go = () => {
          const a0 = ta.selectionStart ?? ta.value.length, a1 = ta.selectionEnd ?? a0, pre = ta.value.slice(0, a0);
          ta.focus(); ta.setRangeText((pre && !/\s$/.test(pre) ? " " : "") + "@", a0, a1, "end"); ta.dispatchEvent(new Event("input"));
        };
        if (document.activeElement === ta) go(); else { ta.focus(); setTimeout(go, 170); }   // after the blur timer (150ms) that closes the picker
      });
    }
    ta.addEventListener("input", () => {
      const m = ta.value.slice(0, ta.selectionStart).match(/(^|\s)@([^\s@]*)$/);
      if (!m) return closePop();
      const q = m[2].toLowerCase(), own = curItem().owner;
      DW.pop = agents().filter(a => a.enabled !== false && (!q || [aname(a), a.name, a.name_en, a.id].some(n => n && String(n).toLowerCase().startsWith(q))))
        .sort((a, b) => (b.id === own) - (a.id === own)).slice(0, 8);
      DW.sel = 0; drawPop();
    });
    ta.addEventListener("blur", () => setTimeout(closePop, 150));
    ta.addEventListener("keydown", async e => {
      if (e.isComposing || e.keyCode === 229) return;  // IME is still composing (pinyin): Enter / arrows belong to the IME
      if (DW.pop.length && !pop.hidden && !(e.metaKey || e.ctrlKey)) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); DW.sel = (DW.sel + (e.key === "ArrowDown" ? 1 : -1) + DW.pop.length) % DW.pop.length; return drawPop(); }
        if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); return pick(DW.pop[DW.sel].id); }
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); return closePop(); }
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault(); const text = annWrap(ta.value.trim()); if (!text && !drawerAtt.length) return;   // t-imp29-p2: notes go out in front
        if (stillUploading(drawerAtt)) return toast(UI.lang === "en" ? "Still uploading…" : "文件还在上传……");
        const to = DW.to || curItem().owner, aid = UI.item;
        await api("comment", { item: UI.item, text, to, attachments: drawerAtt.slice() });
        annClear(aid); DRAFT.set("item:" + aid, ""); dTag();
        ta.value = ""; drawerAtt.length = 0; showAtt(); DW.to = null; drawTo(); closePop();
        const sc = $(".dw-scroll", dw); sc.scrollTop = sc.scrollHeight; jumpState();
      }
    });
    $(".dw-scroll", dw).addEventListener("scroll", jumpState, { passive: true });
    TOC.key = ""; TOC.item = null; $(".dw-scroll", dw).addEventListener("scroll", () => { if (!TOC.raf) TOC.raf = requestAnimationFrame(() => { TOC.raf = 0; tocSync(); }); }, { passive: true });   // t-ri1103-p4
    { // t-detail-jump: a card opens at its newest message and stays pinned there for the first few seconds while images / files / drafts
      // finish loading (load events + a ResizeObserver, see dwPinWatch). Any touch, wheel or key in the scroller unpins it at once, so a
      // user reading further up is never pulled down; after that the old rule applies (follow new messages only when already at the end).
      const sc = $(".dw-scroll", dw); DW.pin = true; DW.pinUntil = Date.now() + 4000;
      const unpin = () => { DW.pin = false; }; ["wheel", "touchstart", "keydown", "mousedown"].forEach(k => sc.addEventListener(k, unpin, { passive: true }));
      sc.addEventListener("load", dwPinEnd, true); }
    renderDrawer(true);
    try { DW.ro && DW.ro.disconnect(); const dk = $(".dw-dock", dw); DW.ro = new ResizeObserver(() => { dw.style.setProperty("--dock-h", dk.offsetHeight + "px"); dwPinEnd(); }); /* t-ask-bottom: the dock can grow (question bar) while the card is pinned to its newest message */ DW.ro.observe(dk); } catch { }   // phone CSS pads the scroller by the dock height
    if (!matchMedia("(max-width: 760px)").matches) ta.focus({ preventScroll: true });  // phones: don't pop the keyboard
    slideIn(dw, wasOpen);
    dw.classList.toggle("dw-has-back", dwStack.length > 0);   // desktop shows the back button only when there is a card to go back to
    if (wasOpen && dwNavDir) {   // t-parent-links: card -> card inside the open drawer: the new content slides in from the side you are heading (translate + opacity, --m-move)
      const d = dwNavDir, rm = matchMedia("(prefers-reduced-motion: reduce)").matches, cs = getComputedStyle(document.documentElement);
      const dur = rm ? 140 : (parseFloat(cs.getPropertyValue("--m-move")) || 330), ease = cs.getPropertyValue("--m-ease-std").trim() || "ease-out";
      try { $(".dw-scroll", dw).animate(rm ? [{ opacity: 0 }, { opacity: 1 }] : [{ transform: `translateX(${d * 28}px)`, opacity: 0 }, { transform: "none", opacity: 1 }], { duration: dur, easing: ease }); } catch { }
    }
    dwNavDir = 0;
    hooks.forEach(f => f("drawer"));
  }
  const curItem = () => (ST.items || []).find(i => i.id === UI.item) || {};
  function drawTo() {
    const dw = $("#drawer"), boxes = $$(".cm-to", dw); if (!boxes.length) return;
    const a = agent(DW.to || curItem().owner || "manager");
    const chip = `${t("send_to")} ${av(a, "sm")}<b>@${esc(aname(a))}</b>${DW.to ? `<button data-to-reset title="${t("default_owner")}">✕</button>` : ""}`;
    boxes.forEach(b => { b.innerHTML = chip; });   // every chip together
    const cm = $(".composer", dw); if (cm) cm.classList.toggle("to-set", !!DW.to);
    const d = $(".dw-def", dw); if (d) d.hidden = !!DW.to;
  }
  function jumpState() {
    const sc = $("#drawer .dw-scroll"); if (!sc) return;
    const top = $("#drawer [data-jump=top]"), end = $("#drawer [data-jump=end]");
    if (nearEnd(sc)) DW.fresh = false;
    if (top) top.hidden = sc.scrollTop < 200;
    if (end) { end.hidden = nearEnd(sc); const dot = $(".new", end); if (dot) dot.hidden = !DW.fresh; }
  }
  // ===== t-ri1103-p4 (2026-11-03): 长草稿目录. When the current draft has 4+ h1/h2 headings, a floating list sits under the category button:
  // a tap scrolls to that heading, the section being read is lit, and the bar shows how far through the draft you are (bottom of the view vs the draft).
  // Desktop: open by default when the detail is at least 680px wide; 收起 / 展开 is remembered (localStorage rt.toc). Phone (mobile.css): a small
  // 「目录」 pill above the reply box, a tap opens the same list as a bottom sheet. The nav lives outside .dw-scroll, so a poll re-render only rebuilds
  // its list when the headings change. It only scrolls on a tap, so it never fights the open-at-newest pin (t-detail-jump).
  const TOC = { hs: [], card: null, key: "", item: null, open: false, cur: null, raf: 0 };
  const tocOff = sc => PHONE.matches ? (parseFloat(getComputedStyle(sc).paddingTop) || 0) : 0;
  function tocMode() {
    const nav = $("#drawer .dw-toc"); if (!nav) return;
    const apply = () => { nav.classList.toggle("open", !!TOC.open); const b = $("[data-toc-tg]", nav); if (b) b.setAttribute("aria-expanded", String(!!TOC.open)); };
    if (!TOC.open && nav.classList.contains("open") && window.Glass) return Glass.out(nav, apply);   /* t-toc-glass: close animation first (glass.js) */
    apply();
  }
  function tocBuild() {
    const dw = $("#drawer"), nav = dw && $(".dw-toc", dw), sc = dw && $(".dw-scroll", dw); if (!nav || !sc) return;
    const card = $('.cs-card.draftc[data-vkey="cur"]', sc), hs = card ? $$(".md h1, .md h2", card) : [];
    TOC.hs = hs; TOC.card = card;
    if (hs.length < 4) { if (!nav.hidden) { nav.hidden = true; nav.innerHTML = ""; } TOC.key = ""; return; }
    const zh = UI.lang !== "en", key = UI.item + "|" + UI.lang + "|" + hs.map(h => h.tagName + h.textContent).join("\n");
    if (TOC.item !== UI.item) { TOC.item = UI.item; let pref = ""; try { pref = localStorage.getItem("rt.toc") || ""; } catch { } TOC.open = PHONE.matches ? false : pref ? pref === "open" : dw.clientWidth >= 680; }
    if (key !== TOC.key) {
      TOC.key = key; TOC.cur = null;
      nav.setAttribute("aria-label", zh ? "目录" : "Contents");
      nav.innerHTML = `<div class="toc-scrim" data-toc-close></div><div class="toc-box"><button type="button" class="toc-h" data-toc-tg aria-expanded="false"><span class="k">${zh ? "目录" : "Contents"}</span><span class="n">· ${hs.length}</span><span class="sp"></span><span class="pc"></span><svg class="chev" viewBox="0 0 10 6" width="10" height="6" aria-hidden="true"><path d="M1 5l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`
        + `<ol class="toc-l">${hs.map((h, i) => `<li><button type="button" class="${h.tagName === "H1" ? "l1" : "l2"}" data-toc="${i}" title="${esc(h.textContent)}">${esc(h.textContent)}</button></li>`).join("")}</ol><div class="toc-bar"><i></i></div></div>`;
    }
    nav.hidden = false; tocMode();
    const top = $(".dw-top", dw); if (top) nav.style.setProperty("--toc-top", (top.offsetTop + top.offsetHeight + 6) + "px");
    tocSync();
  }
  function tocSync() {
    const nav = $("#drawer .dw-toc"), sc = $("#drawer .dw-scroll"); if (!nav || nav.hidden || !sc || !TOC.hs.length) return;
    const m = TOC.card && $(".md", TOC.card); if (!m || !m.isConnected) return;
    const sr = sc.getBoundingClientRect(), mr = m.getBoundingClientRect(), line = sr.top + tocOff(sc) + 40;
    let cur = -1; TOC.hs.forEach((h, i) => { if (h.getBoundingClientRect().top <= line) cur = i; });
    const pc = mr.height ? Math.round(Math.max(0, Math.min(1, (sr.bottom - mr.top) / mr.height)) * 100) : 0;
    if (TOC.cur !== cur) {
      TOC.cur = cur; $$("[data-toc]", nav).forEach((b, i) => b.classList.toggle("on", i === cur));
      if (window.Glass) Glass.toc(nav);   /* t-toc-glass: slide the indicator to the lit line */
      const l = $(".toc-l", nav), b = cur >= 0 && $(`[data-toc="${cur}"]`, nav);   // keep the lit line inside the list's own scroll
      if (l && b && l.clientHeight && (b.offsetTop < l.scrollTop || b.offsetTop + b.offsetHeight > l.scrollTop + l.clientHeight)) l.scrollTop = b.offsetTop - l.clientHeight / 2;
    }
    const bar = $(".toc-bar i", nav), t0 = $(".pc", nav);
    if (bar) bar.style.width = pc + "%";
    if (t0) t0.textContent = (UI.lang === "en" ? "" : "读到 ") + pc + "%";
  }
  function tocGo(i) {
    const sc = $("#drawer .dw-scroll"); if (!sc) return;
    DW.pin = false;   // t-detail-jump: a tap on the list is a deliberate move, never pulled back to the newest message
    if (TOC.card && TOC.card.classList.contains("folded")) { DW.open.delete("xcur"); renderDrawer(); DW.pin = false; }   // folded current draft: unfold first (the re-render re-pins when the view was at the end)
    if (PHONE.matches) { TOC.open = false; tocMode(); }
    const h = TOC.hs[i]; if (!h || !h.isConnected) return;
    sc.scrollTop = Math.max(0, h.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - tocOff(sc) - 14);
    tocSync(); jumpState();
  }
  // ===== t-ri1103-p5 (2026-11-03): ⌘K hits on drafts / card talk open the card AT that sentence. sp = { vkey, q, nth } (a draft version,
  // unfolded if needed) or { ti, q, nth } (thread entry index, data-ti). The words get a short flash (mark.seek-hit, removed after 2.6 s; a poll
  // re-render drops it too). Unpins t-detail-jump; re-aligns twice while late images settle unless you scrolled in between.
  function seekRange(root, q, nth) {
    if (!q) return null;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n, k = 0, first = null;
    while ((n = w.nextNode())) { const s = n.nodeValue.toLowerCase(); let i = s.indexOf(q);
      while (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + q.length); if (!first) first = r; if (k++ === nth) return r; i = s.indexOf(q, i + q.length); } }
    return first;
  }
  function seekItem(id, sp) {
    openItem(id);
    let tries = 0, set = -1;
    const find = () => {
      const sc = $("#drawer .dw-scroll"); if (!sc || UI.item !== id) return null;
      if (sp.vkey) {
        const key = sp.vkey === "cur" ? "xcur" : sp.vkey, folded = sp.vkey === "cur" ? DW.open.has(key) : !DW.open.has(key);
        if (folded && $(`.cs-card.draftc[data-vkey="${sp.vkey}"]`, sc)) { sp.vkey === "cur" ? DW.open.delete(key) : DW.open.add(key); renderDrawer(); }
        return $(`.cs-card.draftc[data-vkey="${sp.vkey}"] .md`, sc);
      }
      return $(`[data-ti="${sp.ti}"]`, sc);
    };
    const place = (flash) => {
      const sc = $("#drawer .dw-scroll"), blk = find(); if (!sc || !blk) return false;
      DW.pin = false; DW.jumpT = 0;
      if (flash && TOC.open) { TOC.open = false; tocMode(); }   // t-ri1103-p4's floating list would sit on the sentence: fold it for this visit (not remembered)
      const old = $("mark.seek-hit", sc); if (old && flash) old.replaceWith(...old.childNodes);
      let r = seekRange(blk, sp.q, sp.nth || 0), mk = null;
      if (r && flash) { try { mk = document.createElement("mark"); mk.className = "seek-hit"; r.surroundContents(mk); } catch { mk = null; } }
      const box = (mk || (r && r.getBoundingClientRect().height ? r : null) || blk).getBoundingClientRect();
      sc.scrollTop = set = Math.max(0, sc.scrollTop + box.top - sc.getBoundingClientRect().top - Math.min(160, sc.clientHeight * 0.3));
      jumpState();
      if (flash) { const card = blk.closest(".cs-card, .cs-me, .cs-line") || blk; card.classList.remove("seek-blk"); void card.offsetWidth; card.classList.add("seek-blk");
        setTimeout(() => { card.classList.remove("seek-blk"); if (mk && mk.isConnected) mk.replaceWith(...mk.childNodes); }, 2600); }
      return true;
    };
    const go = () => { if (UI.item !== id) return;
      const it = (ST.items || []).find(i => i.id === id); if (it && it.slim && ++tries < 20) return setTimeout(go, 150);   // slim (phone, done card): wait for /api/item, its re-render jumps to the end
      if (place(true)) { [400, 1200].forEach(ms => setTimeout(() => { const sc = $("#drawer .dw-scroll"); if (sc && UI.item === id && Math.abs(sc.scrollTop - set) < 2) place(false); }, ms)); }
      else if (++tries < 20) setTimeout(go, 150); };   // a slim (done) card's drafts arrive a moment later from /api/item
    go();
  }
  // ⌘K hit in a chat: once the conversation is drawn, scroll to that message and flash it (only if it is among the rendered ones)
  function seekChat(t0, q) {
    let tries = 0;
    const go = () => {
      const box = $("#right .ch-msgs"), m = box && box.querySelector(`.msg[data-t="${CSS.escape(t0)}"]`);
      if (!m) { if (++tries < 10) setTimeout(go, 120); return; }
      const mb = $(".mb", m) || m, r = seekRange(mb, q, 0); let mk = null;
      if (r) { try { mk = document.createElement("mark"); mk.className = "seek-hit"; r.surroundContents(mk); } catch { mk = null; } }
      box.scrollTop = Math.max(0, box.scrollTop + m.getBoundingClientRect().top - box.getBoundingClientRect().top - Math.min(140, box.clientHeight * 0.3));
      m.classList.add("seek-blk"); setTimeout(() => { m.classList.remove("seek-blk"); if (mk && mk.isConnected) mk.replaceWith(...mk.childNodes); }, 2600);
      if (redo < 3) setTimeout(() => { if (!m.isConnected) { redo++; tries = 0; go(); } }, 350);   // the chat column re-drew right after opening: place it again
    };
    let redo = 0; setTimeout(go, 60);
  }
  // one stream: thread entries + every draft version, by time; a "submitted for review" event next to a draft folds into its card
  function streamOf(it) {
    const ms = x => Date.parse(x) || 0;
    const th = (it.thread || []).map((e, i) => ({ ...e, _i: i }));
    const drafts = (it.versions || []).map((v, i) => ({ kind: "draft", t: v.t, text: v.draft, label: v.label, vkey: "v" + i, old: true, atts: v.attachments }));
    if (it.draft) drafts.push({ kind: "draft", t: it.draft_at || it.updated, text: it.draft, label: it.draft_label, vkey: "cur", old: false, dkind: it.kind, atts: it.draft_attachments }); // ui6
    const used = new Set();
    for (const d of drafts) {
      const sub = th.filter(e => e.kind === "event" && /submitted for review/.test(e.text) && !used.has(e._i) && Math.abs(ms(e.t) - ms(d.t)) < 10 * 60e3)
        .sort((a, b) => Math.abs(ms(a.t) - ms(d.t)) - Math.abs(ms(b.t) - ms(d.t)))[0];
      if (sub) { used.add(sub._i); d.who = sub.who; d.t = sub.t > d.t ? sub.t : d.t; } else d.who = it.owner;
    }
    return th.filter(e => !used.has(e._i)).concat(drafts).sort((a, b) => ms(a.t) - ms(b.t));
  }
  // ui6: files bound to a version render in that version's card; the top list only keeps unbound ones (collapsed once any are bound)
  function topFiles(it) {
    const all = it.attachments || [];
    if (!all.length) return "";
    const bound = new Set((it.versions || []).concat([{ attachments: it.draft_attachments }]).flatMap(v => v.attachments || []));
    if (!bound.size) return `<div class="sec-h">${t("attachments")}</div>${attHTML(all)}`;
    const rest = all.filter(x => !bound.has(x));
    if (!rest.length) return "";
    return `<details class="topfiles"><summary>${t("attachments")} · ${rest.length}</summary>${attHTML(rest)}</details>`;
  }
  // ===== t-imp-p2: 这一版改了什么 — the current draft diffed against an older version (default: the one right before it).
  // Lives inside the current draft card, above the text. Open by default while the item waits for review; the base version is picked with a native select.
  function vdBlock(it) {
    const vs = it.versions || []; if (!vs.length || !it.draft || !window.VDiff) return "";
    const zh = UI.lang !== "en";
    if (!DW.vd || DW.vd.id !== it.id) DW.vd = { id: it.id, base: vs.length - 1, open: it.stage === "review" };
    const st = DW.vd, bi = Math.min(st.base, vs.length - 1), base = vs[bi], r = VDiff.html(base.draft || "", it.draft, zh);
    const sel = `<select class="vd-base" data-vd-base aria-label="${zh ? "对比哪一版" : "Compare with"}">${vs.map((v, i) => `<option value="${i}" ${i === bi ? "selected" : ""}>${esc((`v${i + 1}` + (v.label ? " · " + v.label : "")).slice(0, 42))}</option>`).join("")}</select>`;
    const t0 = base.t || "", t1 = it.draft_at || it.updated || "";   // what the user said between the two drafts (usually the reject reason): the newest one
    const said = (it.thread || []).filter(x => x.who === "me" && x.kind !== "event" && x.t > t0 && x.t <= t1).pop();
    return `<div class="vd${st.open ? " open" : ""}"><button type="button" class="vd-h" data-vd-toggle aria-expanded="${st.open}"><b>${zh ? "这一版改了什么" : "What changed"}</b><span class="vd-n"><i class="a">+${r.add}</i><i class="d">−${r.del}</i></span><span class="sp"></span><span class="vd-tg">${st.open ? (zh ? "收起" : "Hide") : (zh ? "看改动" : "Show")}</span></button>
      ${st.open ? `<div class="vd-sub">${zh ? "对比" : "Base"} ${sel}<span>→ ${zh ? "当前这一版" : "current"}</span></div>${said ? `<div class="vd-said"><span>${zh ? "你说过" : "You said"}</span>${esc(String(said.text || "").slice(0, 160))}</div>` : ""}
      <div class="vd-body">${r.add + r.del ? r.html : `<div class="vd-l vd-gap">${zh ? "和这一版内容一样" : "Same text"}</div>`}</div>` : ""}</div>`;
  }
  function entryHTML(e, it) {
    const acc = e.who && e.who !== "me" ? (agent(e.who).color || "") : "";
    if (e.kind === "draft") {
      const open = e.old ? DW.open.has(e.vkey) : !DW.open.has("x" + e.vkey);
      const dk = e.dkind && e.dkind !== "task" ? t("k_" + e.dkind) : (e.old ? "" : t("k_task"));
      const conf = !e.old && it.confidence ? `<div class="conf">${t("confidence")} <b>${esc(it.confidence)}</b>${it.confidence_note ? ": " + esc(it.confidence_note) : ""}</div>` : "";
      return `<div class="cs-card draftc ${e.dkind === "deliverable" ? "deliverable" : ""} ${e.old ? "old" : ""} ${open ? "" : "folded"}" data-vkey="${e.vkey}">
        <div class="cs-h">${av(agent(e.who), "sm")}<span class="nm">${esc(whoName(e.who))}</span><span class="at">@${esc(whoName("me"))}</span><span class="tm">· ${hm(e.t)}</span>
          ${dk ? `<span class="dtag">${esc(dk)}</span>` : ""}${e.label ? `<span class="dlabel">${esc(e.label)}</span>` : ""}<span class="sp"></span><button data-copy-v="${e.vkey}">${t("copy")}</button></div>
        ${conf}${e.vkey === "cur" ? vdBlock(it) : ""}<div class="md">${md(e.text)}</div>${(e.atts || []).length ? `<div class="vatt">${attHTML(e.atts)}</div>` : ""}<button class="cs-more" data-fold="${e.vkey}">${open ? t("collapse") + " ▴" : t("expand") + " ▾"}</button></div>`;
    }
    if (e.kind === "msg" && e.who === "me") {
      const to = e.to || "manager";
      const aq = /^(回答|改选) · ([\s\S]+) → ([^\n]+)$/.exec(e.text || ""), aid = String(e.reply_to || "").startsWith("ask:") ? e.reply_to.slice(4) : "";   // t-option-quote (old answers: display only)
      const tg = aid ? "button" : "div", body = aq ? `<${tg}${aid ? ` type="button" data-rq-ask="${esc(aid)}"` : ""} class="rq rq-ask" title="${esc(aq[2])}"><i aria-hidden="true">↩</i><b>${esc(whoName(to))}</b><span>${UI.lang === "en" ? "Q: " : "问："}${esc(aq[2])}</span></${tg}><div class="md">${aq[1] === "改选" ? (UI.lang === "en" ? "Changed to: " : "改选：") : ""}${esc(aq[3])}</div>` : `<div class="md">${md(e.text)}</div>`;
      return `<div class="cs-me" data-ti="${e._i}"><div class="cs-h"><span class="nm">${esc(whoName("me"))}</span><span class="at">@${esc(whoName(to))}</span><span class="tm">· ${hm(e.t)}</span></div>
        ${body}${attHTML(e.attachments)}</div>`;
    }
    if (e.kind === "msg") {
      return `<div class="cs-card" data-t="${esc(e.t)}" data-ti="${e._i}" style="--acc:${esc(acc)}"><div class="cs-h">${av(agent(e.who), "sm")}<span class="nm">${esc(whoName(e.who))}</span><span class="at">@${esc(whoName(e.to || "me"))}</span><span class="tm">· ${hm(e.t)}</span></div>
        <div class="md">${md(e.text)}</div>${attHTML(e.attachments)}</div>`;
    }
    return `<div class="cs-line ${esc(e.kind || "")}" data-ti="${e._i}"><div class="in"><span class="tm">${hm(e.t)}</span>${e.who === "me" ? av("me", "sm") : av(agent(e.who), "sm")}<span class="nm">${esc(whoName(e.who))}</span><span class="tx">${md.refs(esc(e.kind === "event" ? evText(e.text) : e.text))}${attHTML(e.attachments)}</span></div></div>`;
  }
  // t-event-zh: system lines in a card's 动态 read in Chinese (display only; state keeps the original text).
  // "stage todo → doing" -> 「开工 · 待办 → 进行中」 (verb by the target stage), "created · X" -> 「建卡 · X」. English UI keeps the original.
  const EV_VERB = { doing: "开工", done: "关单", todo: "放回待办", review: "交审", waiting: "转为等别人" };
  function evText(x) {
    x = String(x || ""); if (UI.lang === "en") return x;
    let m = x.match(/^stage (\S+) → (\S+)(.*)$/s);
    if (m) return `${m[1] === "done" && m[2] !== "done" ? "重开" : EV_VERB[m[2]] || "改阶段"} · ${stageLabel(m[1])} → ${stageLabel(m[2])}${m[3]}`;
    m = x.match(/^created( · .*)?$/s); if (m) return "建卡" + (m[1] || "");
    return x;
  }
  // ui1-B: the detail is a slide-over. open = add .open (transform transition); close = remove it, then hide after the exit animation.
  // The list behind is never re-rendered on close, so its scroll position stays put.
  function scrim() {
    let sc = $("#scrim");
    if (!sc) { sc = document.createElement("div"); sc.id = "scrim"; sc.hidden = true; $("#main").insertBefore(sc, $("#drawer")); sc.addEventListener("click", () => closeItem()); }
    return sc;
  }
  // ui1b: drag the drawer's left edge to resize (desktop). Width lives in --dw-w on #drawer (class .sized); saved in localStorage.
  const DW_MIN = 520, DW_KEY = "dwWidth";
  function dwMax() { const m = $("#main"); return Math.max(DW_MIN, (m ? m.clientWidth : 1200) - 80); }
  function dwApply(dw, w) { if (w == null) { dw.classList.remove("sized"); dw.style.removeProperty("--dw-w"); return; } dw.style.setProperty("--dw-w", Math.round(Math.min(dwMax(), Math.max(DW_MIN, w))) + "px"); dw.classList.add("sized"); }
  function dwSaved() { try { const v = parseFloat(localStorage.getItem(DW_KEY)); return v > 0 ? v : null; } catch (e) { return null; } }
  function dwSave(w) { try { if (w == null) localStorage.removeItem(DW_KEY); else localStorage.setItem(DW_KEY, String(Math.round(w))); } catch (e) {} }
  function dwGrip(dw) {
    let g = $("#dw-grip", dw);
    if (g) return g;
    g = document.createElement("div"); g.id = "dw-grip"; g.title = "拖动调宽 · 双击恢复默认"; dw.appendChild(g);
    let sx = 0, sw = 0, id = null;
    g.addEventListener("pointerdown", e => {
      if (e.button != null && e.button > 0) return;
      id = e.pointerId; sx = e.clientX; sw = dw.getBoundingClientRect().width;
      try { g.setPointerCapture(id); } catch (_) {}
      g.classList.add("drag"); dw.classList.add("resizing"); document.body.classList.add("dw-resizing"); e.preventDefault();
    });
    g.addEventListener("pointermove", e => { if (id !== e.pointerId) return; dwApply(dw, sw + (sx - e.clientX)); });
    const end = e => {
      if (id !== e.pointerId) return; id = null;
      g.classList.remove("drag"); dw.classList.remove("resizing"); document.body.classList.remove("dw-resizing");
      const w = dw.getBoundingClientRect().width; if (dw.classList.contains("sized")) dwSave(w);
    };
    g.addEventListener("pointerup", end); g.addEventListener("pointercancel", end);
    g.addEventListener("dblclick", () => { dwApply(dw, null); dwSave(null); });
    return g;
  }
  window.addEventListener("resize", () => { const dw = $("#drawer"); if (dw && dw.classList.contains("sized")) { const w = dwSaved(); if (w) dwApply(dw, w); } });
  PHONE.addEventListener && PHONE.addEventListener("change", () => { const dw = $("#drawer"); if (UI.item && dw && !dw.hidden) renderDrawer(); });
  function slideIn(dw, wasOpen) {
    const sc = scrim(); sc.hidden = false;
    dwGrip(dw); { const w = dwSaved(); if (w) dwApply(dw, w); else dwApply(dw, null); }
    if (!wasOpen) { void dw.offsetWidth; void sc.offsetWidth; }
    dw.classList.add("open"); sc.classList.add("open");
  }
  function closeItem(silent) {
    const back = VT.back; VT.back = false;   // t-m2-b ①: only the back button shrinks the page into its card
    const d0 = $("#drawer"), id0 = UI.item;
    if (back && id0 && !d0.hidden && vtOK()) {
      const card = [...document.querySelectorAll(`#page [data-item="${CSS.escape(id0)}"]`)].find(vtSeen);
      if (card) return vtRun(() => { closeItemNow(silent); clearTimeout(DW.ct); d0.hidden = true; d0.innerHTML = ""; scrim().hidden = true; }, d0, card);
    }
    return closeItemNow(silent);
  }
  function closeItemNow(silent) {
    UI.item = null; dwStack = []; $("#drawer").classList.remove("dw-has-back");
    const dw = $("#drawer"), sc = scrim();
    if (dw.hidden) return;
    dw.classList.remove("open"); sc.classList.remove("open");
    clearTimeout(DW.ct);
    DW.ct = setTimeout(() => { if (UI.item) return; dw.hidden = true; dw.innerHTML = ""; sc.hidden = true; }, 260);
  }
  // P1 / D4 review desk: owner / stage are pills; the native select sits invisibly on top of the pill, so tapping still opens the system picker and the change handler is untouched
  const dwChev = `<svg class="chev" viewBox="0 0 10 6" width="9" height="6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const dwPill = (k, face, sel) => `<label class="dw-pill"><span class="k">${k}</span>${face}${dwChev}${sel}</label>`;
  // ===== t-imp29-p2: 草稿批注. Select text in a draft -> 批注 / 引用回复 / 复制. Notes are kept per item on this device (rt.anno) until they go out
  // with the next 回复 / 驳回 / 批准, as "> 原句" + note, so the agent sees exactly which sentence is meant. No server change: it is an ordinary comment.
  const ANN = { all: LS.get("anno", {}), cand: null, hideT: 0, showT: 0, deferred: false };
  const annList = id => ANN.all[id || UI.item] || [];
  const annSave = () => { for (const k of Object.keys(ANN.all)) if (!ANN.all[k].length) delete ANN.all[k]; LS.set("anno", ANN.all); };
  const annSquash = s => String(s || "").replace(/\s+/g, " ").trim();
  function annWrap(text) {   // the notes block that goes in front of what you typed
    const L = annList(); if (!L.length) return text;
    const zh = UI.lang !== "en";
    const block = L.map(n => `> ${n.q}\n\n${n.t}`).join("\n\n");
    return `**${zh ? `批注 · ${L.length} 条` : `${L.length} note${L.length > 1 ? "s" : ""}`}**\n\n${block}` + (text ? `\n\n${text}` : "");
  }
  function annClear(id) { delete ANN.all[id]; annSave(); if (id === UI.item) annPaint(); }
  function annSelInDraft() {   // the current selection, if it sits inside one draft card's text in the open drawer
    const s = getSelection(); if (!s || s.isCollapsed || !s.rangeCount) return null;
    const md = n => n && (n.nodeType === 1 ? n : n.parentElement)?.closest("#drawer .cs-card.draftc .md");
    const a = md(s.anchorNode), b = md(s.focusNode); if (!a || a !== b) return null;
    const q = annSquash(s.toString()); if (q.length < 2) return null;
    return { q: q.slice(0, 240), rect: s.getRangeAt(0).getBoundingClientRect() };
  }
  function annPop() {
    let p = $("#an-pop"); if (p) return p;
    const zh = UI.lang !== "en";
    document.body.insertAdjacentHTML("beforeend", `<div id="an-pop" role="toolbar" hidden><button data-an="note">${zh ? "批注" : "Note"}</button><button data-an="quote">${zh ? "引用回复" : "Quote"}</button><button data-an="copy">${zh ? "复制" : "Copy"}</button></div>`);
    p = $("#an-pop");
    p.addEventListener("pointerdown", e => e.preventDefault());   // keep the text selected while tapping the menu
    p.addEventListener("click", e => {
      const b = e.target.closest("[data-an]"), c = ANN.cand; if (!b || !c) return;
      const k = b.dataset.an; annHide(true);
      if (k === "copy") { (navigator.clipboard ? navigator.clipboard.writeText(c.q) : Promise.reject()).then(() => toast(UI.lang === "en" ? "Copied" : "已复制"), () => { }); }
      if (k === "quote") { const ta = $("#drawer .composer textarea"); if (ta) { ta.value = `> ${c.q}\n\n` + ta.value; ta.dispatchEvent(new Event("input", { bubbles: true })); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }
      if (k === "note") annEdit(c.q);
      try { getSelection().removeAllRanges(); } catch { }
    });
    return p;
  }
  function annShow(c) {
    ANN.cand = c; const p = annPop(), touch = matchMedia("(pointer: coarse)").matches;
    p.hidden = false; const w = p.offsetWidth, h = p.offsetHeight, dock = $("#drawer .dw-dock"), lim = (dock ? dock.getBoundingClientRect().top : innerHeight) - 8;
    // phones: iOS draws its own callout ABOVE the selection, so ours goes below it (flipped up if the dock is in the way); desktop: above
    let top = touch ? c.rect.bottom + 12 : c.rect.top - h - 10;
    if (touch && top + h > lim) top = c.rect.top - h - 56;
    if (!touch && top < 8) top = c.rect.bottom + 10;
    p.style.left = Math.round(Math.min(innerWidth - w - 8, Math.max(8, c.rect.left + c.rect.width / 2 - w / 2))) + "px";
    p.style.top = Math.round(Math.max(8, top)) + "px";
    requestAnimationFrame(() => p.classList.add("on"));
  }
  function annHide(now) {
    const p = $("#an-pop"); if (!p || p.hidden) return;
    p.classList.remove("on"); clearTimeout(ANN.hideT);
    ANN.hideT = setTimeout(() => { p.hidden = true; }, now ? 0 : 160);
  }
  document.addEventListener("selectionchange", () => {
    clearTimeout(ANN.showT);
    const c = annSelInDraft();
    if (!c) {   // selection gone: hide shortly (a tap on the menu itself keeps the selection), then catch up a drawer render we held back
      ANN.showT = setTimeout(() => { if (annSelInDraft()) return; annHide(); ANN.cand = null; if (ANN.deferred) { ANN.deferred = false; if (UI.item) renderDrawer(); } }, 250);
      return;
    }
    annHide(true);
    ANN.showT = setTimeout(() => { const c2 = annSelInDraft(); if (c2) annShow(c2); }, 320);   // wait until the handles stop moving
  });
  addEventListener("scroll", () => annHide(true), { capture: true, passive: true });
  function annEdit(q, idx) {   // new note (idx undefined) or edit / delete an existing one
    const zh = UI.lang !== "en", L = annList(), cur = idx != null ? L[idx] : null;
    openModal(`<h2>${zh ? (cur ? "改批注" : "写批注") : (cur ? "Edit note" : "Add a note")}</h2><div class="an-q">${esc(q)}</div>
      <textarea placeholder="${zh ? "这一句哪里要改？" : "What should change here?"}">${cur ? esc(cur.t) : ""}</textarea>
      <div class="foot">${cur ? `<button class="btn danger" data-del>${zh ? "删除" : "Delete"}</button><span style="flex:1"></span>` : ""}<button class="btn" data-x>${t("cancel")}</button><button class="btn primary" data-ok>${zh ? "保存" : "Save"}</button></div>`, m => {
      const ta = $("textarea", m), id = UI.item;
      const ok = () => { const v = ta.value.trim(); if (!v) return ta.focus(); const L2 = ANN.all[id] = annList(id).slice();
        if (cur) L2[idx] = Object.assign({}, cur, { t: v }); else L2.push({ id: Math.random().toString(36).slice(2, 8), q, t: v, at: new Date().toISOString() });
        annSave(); closeModal(); annPaint(); };
      $("[data-ok]", m).onclick = ok; $("[data-x]", m).onclick = closeModal;
      const del = $("[data-del]", m); if (del) del.onclick = () => { ANN.all[id] = annList(id).filter((_, i) => i !== idx); annSave(); closeModal(); annPaint(); };
      ta.addEventListener("keydown", e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); ok(); } });
      ta.focus();
    });
  }
  function annMark(md, q, cls) {   // wrap the first match of q (whitespace-insensitive, may cross inline tags) in <mark>; returns the last mark
    const want = q.replace(/\s+/g, ""); if (!want) return null;
    const walk = document.createTreeWalker(md, NodeFilter.SHOW_TEXT), map = []; let flat = "";
    for (let n; (n = walk.nextNode());) { if (n.parentElement.closest("mark.an-hl, .an-note")) continue; const s = n.nodeValue; for (let i = 0; i < s.length; i++) if (!/\s/.test(s[i])) { map.push([n, i]); flat += s[i]; } }
    const at = flat.indexOf(want); if (at < 0) return null;
    const segs = new Map();
    for (let k = at; k < at + want.length; k++) { const [n, i] = map[k]; const g = segs.get(n); if (g) g[1] = i + 1; else segs.set(n, [i, i + 1]); }
    let last = null;
    for (const [n, [a, b]] of segs) { const r = document.createRange(); r.setStart(n, a); r.setEnd(n, b); const m = document.createElement("mark"); m.className = cls; r.surroundContents(m); last = m; }
    return last;
  }
  function annPaint() {   // highlights + inline notes in the draft, and the 「N 条批注」 tray in the dock. Runs after every drawer render.
    const dw = $("#drawer"); if (!dw || dw.hidden || !UI.item) return;
    const zh = UI.lang !== "en", L = annList();
    $$(".an-note", dw).forEach(x => x.remove());
    $$("mark.an-hl", dw).forEach(m => m.replaceWith(...m.childNodes));
    const cards = [...$$('.cs-card.draftc[data-vkey="cur"] .md', dw), ...$$(".cs-card.draftc .md", dw)];
    L.forEach((n, i) => {
      let m = null; for (const md of cards) { m = annMark(md, n.q, "an-hl"); if (m) break; }
      n.lost = !m;
      if (m) { const blk = m.closest("p, li, blockquote, h1, h2, h3, h4, pre, tr") || m; blk.insertAdjacentHTML("afterend", `<button type="button" class="an-note" data-an-edit="${i}"><small>${zh ? "我的批注" : "My note"} · ${i + 1}</small>${esc(n.t)}</button>`);
        const c = m.closest(".cs-card.draftc.folded"); if (c) c.classList.remove("folded"); }
    });
    const dock = $(".dw-dock", dw); if (!dock) return;
    let tr = $(".an-tray", dock);
    if (!L.length) { if (tr) tr.remove(); return; }
    if (!tr) { dock.insertAdjacentHTML("afterbegin", `<div class="an-tray"></div>`); tr = $(".an-tray", dock); }
    const open = tr.classList.contains("open"), lost = L.filter(n => n.lost).length;
    tr.innerHTML = `<button type="button" class="an-head" data-an-tray><span class="n">${L.length}</span><span class="tx"><b>${zh ? `${L.length} 条批注` : `${L.length} note${L.length > 1 ? "s" : ""}`}</b><small>${zh ? `点「回复」或「驳回」时一起发给${esc(aname(agent((ST.items.find(x => x.id === UI.item) || {}).owner)))}，带原句` : "Sent with your next reply or reject, with the quoted lines"}${lost ? (zh ? ` · ${lost} 条原句在新版里找不到了` : ` · ${lost} not in this version`) : ""}</small></span><em aria-hidden="true">${open ? "⌄" : "›"}</em></button>
      <div class="an-list">${L.map((n, i) => `<div class="an-li"><button type="button" data-an-edit="${i}"><q>${esc(n.q.slice(0, 60))}</q><span>${esc(n.t)}</span></button><button type="button" class="x" data-an-del="${i}" aria-label="${zh ? "删除" : "Delete"}">✕</button></div>`).join("")}</div>`;
  }
  document.addEventListener("click", e => {
    if (!e.target.closest("#drawer, #modal")) return;
    const ed = e.target.closest("[data-an-edit]"); if (ed) { const n = annList()[+ed.dataset.anEdit]; if (n) annEdit(n.q, +ed.dataset.anEdit); return; }
    const dl = e.target.closest("[data-an-del]"); if (dl) { ANN.all[UI.item] = annList().filter((_, i) => i !== +dl.dataset.anDel); annSave(); annPaint(); return; }
    if (e.target.closest("[data-an-tray]")) { const tr = e.target.closest(".an-tray"); tr.classList.toggle("open"); annPaint(); }
  });

  // t-m2-a ③: skeleton while a slim card's drafts load (/api/item). CSS keeps it invisible for the first 150 ms (a LAN answer never shows it);
  // ONE sweep for the whole block (.sk::after), gone with the block when the full card renders.
  const skDraft = () => `<div class="sk sk-dw" data-sk aria-busy="true" aria-label="${UI.lang === "en" ? "Loading drafts" : "草稿加载中"}"><div class="sk-c"><i style="width:34%"></i><i></i><i style="width:92%"></i><i style="width:78%"></i><i style="width:56%"></i></div><div class="sk-c"><i style="width:28%"></i><i style="width:86%"></i><i style="width:64%"></i></div></div>`;
  // t-perf E: everything a poll can change that the open detail draws: the card, its parent / sub-cards, the team (rings, names, tool badges),
  // routines, owner name / avatars, language. A poll whose signature matches skips renderDrawer, so the DOM (scroll, selection, running
  // animations such as the 新回复 ring) stays as it is. Every direct renderDrawer() call (your clicks, opening, folding) still rebuilds.
  const DW_SKIP = { last_seen: 1, activity: 1 };
  function dwSig() {
    const it = (ST.items || []).find(i => i.id === UI.item); if (!it) return "gone";
    const par = parentOf(it), kids = childrenOf(it), ags = ST.agents || {};
    return JSON.stringify([UI.item, UI.lang, MOBQ.matches, it, par && [par.id, par.title, par.stage, par.kind, par.updated, par.snooze],
      kids.map(k => [k.id, k.title, k.stage, k.kind, k.owner, k.updated, k.activity, k.asks, k.snooze]),
      Object.keys(ags).map(k => JSON.stringify(ags[k], (key, v) => DW_SKIP[key] ? undefined : v)), routineOf(it), ST.meta.owner, ST.meta.avatars]);
  }
  function renderDrawer(first) {
    if (!first && annSelInDraft()) { ANN.deferred = true; return; }   // t-imp29-p2: a poll must not wipe the text you are selecting
    const it = (ST.items || []).find(i => i.id === UI.item);
    const dw = $("#drawer");
    if (!it && UI.item && archKnown(UI.item) && !ARCH.miss[UI.item]) {   // t-perf A: an archived card, fetched on open
      const id = UI.item, sc0 = $(".dw-scroll", dw); if (sc0 && !sc0.querySelector("[data-sk]")) sc0.innerHTML = skDraft();
      archItem(id).then(ok => { if (UI.item !== id) return; if (ok) renderDrawer(true); else { ARCH.miss[id] = 1; closeItem(true); toast(UI.lang === "en" ? "Could not load this archived card" : "这张归档卡没加载出来", true); } });
      return;
    }
    if (!it) { closeItem(true); return; }
    if (it.slim) { fullItem(it.id).then(ok => { const n = (ST.items || []).find(i => i.id === it.id); if (ok && UI.item === it.id && n && !n.slim) renderDrawer(first);
      else if (!ok && UI.item === it.id) { const s = $("#drawer .dw-scroll [data-sk]"); if (s) s.outerHTML = `<div class="sk-fail">${UI.lang === "en" ? "Drafts did not load · close and reopen the card to retry" : "草稿没加载出来 · 关掉再打开这张卡重试"}</div>`; } }); if (!first) return; }   // t-mobile-crash-state: draft + versions arrive a moment later
    const opts = (list, cur) => list.map(([v, n]) => `<option value="${v}" ${v === cur ? "selected" : ""}>${esc(n)}</option>`).join("");
    const ownerOpts = opts(agents().map(a => [a.id, `${aname(a)} · ${atitle(a)}`]), it.owner);
    $(".dw-top", dw).innerHTML = `<div class="dw-lead"><button class="dw-back" data-close aria-label="${UI.lang === "en" ? "Back" : "返回"}"><svg viewBox="0 0 12 20" width="12" height="20" aria-hidden="true"><path d="M10 2 2 10l8 8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${UI.lang === "en" ? "Back" : "返回"}</span></button><span class="tag ${it.stage === "review" || awaitsUser(it) ? it.kind : ""}"><span class="gl" aria-hidden="true">◆</span>${it.stage === "review" || awaitsUser(it) ? t(it.kind === "task" ? "deliverable" : it.kind) : stageLabel(it.stage)}</span> <button type="button" class="mono dim dw-id" data-copy-id="${esc(it.id)}" title="${UI.lang === "en" ? "Copy card id" : "复制卡号"}"><span>${esc(it.id)}</span><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><rect x="5" y="5" width="8.5" height="8.5" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 3.2V3a1.5 1.5 0 0 0-1.5-1.5H3A1.5 1.5 0 0 0 1.5 3v6A1.5 1.5 0 0 0 3 10.5h.2" fill="none" stroke="currentColor" stroke-width="1.4"/></svg></button>${wkTag(workersOf(it.id), "dw-wk")}</div>
      <div class="r"><select data-f="category">${opts(CATS.map(c => [c, t(c)]), it.category)}</select><button data-close title="close">✕</button></div>`;
    const sc = $(".dw-scroll", dw); const keep = sc.scrollTop;
    let lastDay = "";
    const stream = streamOf(it);
    const eh = ringOnce(() => stream.slice().reverse().map(e => entryHTML(e, it))).reverse();   // t-m2-a ⓪: built newest first so only the newest line keeps a ring
    const tl = stream.map((e, i) => {
      const d = dayKey(new Date(e.t)); const sep = d !== lastDay ? `<div class="cs-day">${when(e.t).split(" ")[0]}</div>` : ""; lastDay = d;
      return sep + eh[i];
    }).join("");
    const wasEnd = !first && nearEnd(sc), grew = !first && stream.length > DW.n; DW.n = stream.length;
    { // t-ask-bottom: the first unanswered question sits right above the reply box (same chips as the list cards: recommended one marked, a tap answers;
      // with more than one, they come one after another and the bar says how many are left). The full list stays in the card above as before.
      const ab = $(".dw-askbar", dw); if (ab) { const h = it.stage === "done" ? "" : askRow(it); if (ab._h !== h) { ab.innerHTML = ab._h = h; ab.hidden = !h; } } }
    const wsD = workersOf(it.id);   // t-working-item-highlight: phone shows this row under the glass header (desktop keeps the tag in .dw-top)
    const par = parentOf(it), kids = childrenOf(it), en = UI.lang === "en";
    const parHTML = par ? `<button class="dw-parent" data-dw-nav="${esc(par.id)}"><span class="k">${en ? "Part of" : "属于"}</span><b>${esc(par.title)}</b><span class="st">${esc(rowLabel(par))}</span><svg viewBox="0 0 8 14" width="7" height="12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 1.5 6.5 7l-5 5.5"/></svg></button>` : "";
    const kidsHTML = kids.length ? `<div class="sec-h">${en ? "Sub-items" : "子单"} · ${kids.length}</div><div class="dw-kids">${kids.map(k => `<button class="dw-kid${k.stage === "done" ? " done" : ""}" data-dw-nav="${esc(k.id)}">${av(agent(k.owner), "sm")}<span class="t">${esc(k.title)}</span><span class="st s-${esc(grpOf(k))}">${esc(rowLabel(k))}</span><svg viewBox="0 0 8 14" width="7" height="12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 1.5 6.5 7l-5 5.5"/></svg></button>`).join("")}</div>` : "";
    const dwTags = [...(it.platforms || []).map(p => `<span class="tag pf">${PLAT[p] || p}</span>`), ...(it.due ? [`<span class="tag">${t("due")} ${esc(it.due)}</span>`] : []),
      ...(it.tags || []).filter(x => !par || x !== par.id).map(x => `<span class="tag">#${esc(x)}</span>`)].join("");
    sc.innerHTML = `${wsD.length ? `<div class="dw-wkrow">${wkTag(wsD, "dw-wk2")}</div>` : ""}${parHTML}<div class="dw-title">${esc(it.title)}</div>${it.summary ? `<div class="dw-sum${DW.sumOpen.has(it.id) ? "" : " uin-clamp"}">${esc(it.summary)}</div><button type="button" class="uin-more" data-uin-sum hidden>${DW.sumOpen.has(it.id) ? (UI.lang === "en" ? "Show less ▴" : "收起 ▴") : (UI.lang === "en" ? "Show all ▾" : "展开全文 ▾")}</button>` : ""}
      <div class="dw-meta">${dwPill(t("owner"), `${av(agent(it.owner), "sm", it.id)}<b>${esc(aname(agent(it.owner)))}<i> · ${esc(atitle(agent(it.owner)))}</i></b>`, `<select data-f="owner" aria-label="${t("owner")}">${ownerOpts}</select>`)}
        ${dwPill(t("stage"), `<b>${esc(stageLabel(it.stage))}</b>`, `<select data-f="stage" aria-label="${t("stage")}">${opts(STAGES.map(s => [s, stageLabel(s)]), it.stage)}</select>`)}</div>
      ${dwTags ? `<div class="dw-tags">${dwTags}</div>` : ""}${askBlock(it)}
      ${rtLine(it)}${kidsHTML}
      ${(it.evidence || []).length ? `<div class="sec-h">${t("evidence")}</div><ul class="ev md">${it.evidence.map(e => `<li>${md(e).replace(/^<p>|<\/p>$/g, "")}</li>`).join("")}</ul>` : ""}
      ${(it.links || []).length ? `<div class="sec-h">${t("links")}</div><ul class="ev md">${it.links.map(l => `<li>${md(l).replace(/^<p>|<\/p>$/g, "")}</li>`).join("")}</ul>` : ""}
      ${topFiles(it)}
      <div class="sec-h">${t("thread")}</div>${it.slim ? skDraft() : ""}<div class="cs">${tl}</div>
      <div class="cs-jump"><div class="wrap"><button data-jump="top" hidden><span class="ic">↑</span><span class="lb">${t("jump_top")}<small>TOP</small></span></button><button data-jump="end" hidden><span class="ic">↓</span><span class="lb">${t("jump_new")}<small>LATEST</small></span><i class="new" hidden></i></button></div></div>`;
    { const sm = $(".dw-sum", sc), sb = $("[data-uin-sum]", sc);   // t-ui-next 4: the toggle only shows when the 3-line clamp actually cuts text (or it is open)
      if (sm && sb) sb.hidden = !DW.sumOpen.has(it.id) && sm.scrollHeight <= sm.clientHeight + 2; }
    // folded cards only need the toggle when they actually overflow
    $$(".cs-card.draftc", sc).forEach(c => { const m = $(".md", c), b = $(".cs-more", c); if (!c.classList.contains("folded")) { c.classList.add("folded"); const long = m.scrollHeight > m.clientHeight + 4; c.classList.remove("folded"); b.hidden = !long; } else b.hidden = m.scrollHeight <= m.clientHeight + 4; });
    const jumpEl = first && DW.jumpT ? [...sc.querySelectorAll(".cs-card[data-t]")].find(x => Date.parse(x.dataset.t) >= DW.jumpT) : null;   // t-home-newreplies
    if (jumpEl) { DW.pin = false; DW.jumpT = 0; DW.hitT = jumpEl.dataset.t; DW.hitAt = Date.now(); }
    // t-detail-jump-fix: the 新回复 mark is only a mark. It used to head the else-if chain below, so after a jump no re-render ever pinned,
    // followed new messages or kept the reading position again while the card stayed open. It now fades out (NR_HIT ms, poll-safe delay).
    const hitAge = DW.hitT ? Date.now() - (DW.hitAt || 0) : NR_HIT;
    const hitEl = hitAge < NR_HIT ? sc.querySelector(`.cs-card[data-t="${CSS.escape(DW.hitT)}"]`) : null;
    if (hitEl) { hitEl.classList.add("nr-hit"); hitEl.style.animationDelay = -hitAge + "ms"; } else DW.hitT = "";
    if (first && hitEl) sc.scrollTop = Math.max(0, hitEl.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 24);   // opened from 新回复: start at the first unread reply
    else if (first || dwPinned()) { sc.scrollTop = sc.scrollHeight; dwPinWatch(sc); }   // t-detail-jump: open at the newest message (was: review cards at the current draft, others at the top)
    else if (wasEnd) { DW.pin = true; DW.pinUntil = Math.max(DW.pinUntil || 0, Date.now() + 1500); sc.scrollTop = sc.scrollHeight; dwPinWatch(sc); }   // t-detail-jump: already at the end → stay there while the re-rendered images settle
    else { sc.scrollTop = keep; if (grew) DW.fresh = true; }
    jumpState(); drawTo(); tocBuild();   // t-ri1103-p4
    const done = it.stage === "done";
    const acts = $(".dw-acts", dw);
    {   // D4: desktop now uses the phone's dock (same state logic, same two pills); before it always showed 批准 / 驳回 / 完成 with ornaments
      // phone: the actions follow the state. review plan / deliverable = 驳回 + 批准; any other review, or not in review yet = a single 完成; done = stamp + 重开.
      // data-act names are unchanged (the completion splash and the stamp key off them).
      const zh = UI.lang !== "en", st = done ? "done" : it.stage === "review" && (it.kind === "plan" || it.kind === "deliverable") ? it.kind : "solo";
      acts.dataset.st = st;
      const rt = !done && routineOf(it);   // t-routine-close: a routine's card is never "done"; it is stopped / resumed instead
      if (rt) {   // t-routine-btn: one 暂停 / 开启 switch in place of 完成委托 (a routine is never "done"); running shows the next run
        const nd = rt.next && new Date(rt.next), nx = !nd || isNaN(nd) ? "" : dayKey(nd) === dayKey(new Date()) ? `${zh ? "今天" : "today"} ${hm(rt.next)}` : dayKey(nd) === dayKey(new Date(Date.now() + 864e5)) ? `${zh ? "明天" : "tomorrow"} ${hm(rt.next)}` : when(rt.next);
        acts.dataset.st = rt.paused ? "rt-off" : "rt"; acts.innerHTML = rt.paused
        ? `<span class="rt-off"><i class="rt-dot"></i>${zh ? "暂停" : "Paused"}</span><button class="ab ok rt-sw" data-rt="resume" role="switch" aria-checked="false"><b>${zh ? "开启" : "Turn on"}</b></button>`
        : `<span class="rt-on"><i class="rt-dot"></i>${rt.unknown || rt.ondemand ? (zh ? "开启中" : "On") : `${zh ? "开启中 · 下次 " : "On · next "}${esc(nx || "—")}`}</span><button class="ab no rt-sw" data-rt="pause" role="switch" aria-checked="true">${zh ? "暂停" : "Pause"}</button>`; }
      else acts.innerHTML = st === "done" ? `<button class="ab re" data-act="reopen"><span aria-hidden="true">↺</span>${t("reopen")}</button>${stampHTML(it)}`
        : closeBtn() + (st === "solo" ? snzBtn(it) + `<button class="ab ok solo${openAsks(it).length ? " has-ask" : ""}" data-act="done"><b>${zh ? "完成委托" : "Mark done"}</b>${askLeft(it) ? `<small class="ok-ask">${askLeft(it)}</small>` : ""}</button>`
        : `<button class="ab no" data-act="reject">${t("reject")}</button>${snzBtn(it)}<button class="ab ok${openAsks(it).length ? " has-ask" : ""}" data-act="approve">${okBtnIn(it)}</button>`);   // ri1103-P2: 稍后 between 驳回 and 验收
      // t-btn-names: open questions show as a line under the button label (desktop and phone); before it was a .dock-note to the left, desktop only
    }
    annPaint();   // t-imp29-p2
    if (window.Preview) Preview.decorate($('.cs-card.draftc[data-vkey="cur"]', sc), it);   // t-imp29-p3: 文稿 / 平台预览 on the current draft
    DW.sig = dwSig();   // t-perf E
  }
  // ===== ri1103-P2: 稍后 ▾ = push a card to 今晚 20:00 / 明早 09:00 / 下周一 09:00 / the specialist's next reply / a picked time.
  // The server keeps it (it.snooze), so desktop and phone agree. Desktop: a small menu over the button; phone: a bottom sheet.
  const SNZ_IC = `<svg class="snz-ic" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><circle cx="8" cy="8.6" r="5.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 5.6v3.2l2 1.3M3 2.6 1.6 4M13 2.6 14.4 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
  function snzWhen(iso) {
    const d = new Date(iso), en = UI.lang === "en", h = d.getHours(), t0 = hm(iso); if (isNaN(d)) return "—";
    const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(new Date().setHours(0, 0, 0, 0))) / 864e5);
    if (days === 0) return en ? `today ${t0}` : `${h >= 17 ? "今晚" : "今天"} ${t0}`;
    if (days === 1) return en ? `tomorrow ${t0}` : `${h < 12 ? "明早" : "明天"} ${t0}`;
    if (days > 1 && days < 7) return en ? `${"Sun Mon Tue Wed Thu Fri Sat".split(" ")[d.getDay()]} ${t0}` : `周${"日一二三四五六"[d.getDay()]} ${t0}`;
    return `${d.getMonth() + 1}/${d.getDate()} ${t0}`;
  }
  const snzText = it => !it || !it.snooze ? "" : it.snooze.wait === "reply" ? (UI.lang === "en" ? `until ${aname(agent(it.owner))} replies` : `等${aname(agent(it.owner))}回复`) : snzWhen(it.snooze.until);
  const snzCan = it => !!it && it.stage !== "done" && !routineOf(it) && (it.stage === "review" || awaitsUser(it) || openAsks(it).length > 0);
  const snzBtn = it => !snzCan(it) ? "" : snoozed(it)
    ? `<button class="ab sz on" data-snz-btn title="${UI.lang === "en" ? "Snoozed · change or cancel" : "已推迟 · 点一下改时间或取消"}">${SNZ_IC}<span>${esc(snzText(it))}</span></button>`
    : `<button class="ab sz" data-snz-btn title="${UI.lang === "en" ? "Take it off your list until later" : "先从等你拍板拿掉，到点再回来"}">${SNZ_IC}<span>${UI.lang === "en" ? "Later" : "稍后"}</span><svg class="snz-car" viewBox="0 0 10 6" width="9" height="6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
  const snzSort = (a, b) => (a.snooze.wait === "reply") - (b.snooze.wait === "reply") || snzEnd(a) - snzEnd(b);   /* timed ones first: the home line names the next fixed return */
  function snzLine() {
    const L = items().filter(snoozed).sort(snzSort); if (!L.length) return "";
    const en = UI.lang === "en", f = L[0], back = f.snooze.wait === "reply" ? snzText(f) : (en ? `back ${snzText(f)}` : `${snzText(f)} 回来`);
    return `<button type="button" class="snz-line" data-snz-list>${SNZ_IC}<span>${en ? `${L.length} snoozed · ${esc(back)}` : `推迟了 ${L.length} 张 · ${esc(back)}`}</span><i aria-hidden="true">›</i></button>`;
  }
  const SNZ = { el: null, done: null };
  function snzClose(ok) {
    const el = SNZ.el, d = SNZ.done; SNZ.el = SNZ.done = null;
    if (el) { el.classList.add("out"); setTimeout(() => el.remove(), 160); }
    if (d) d(!!ok);
  }
  function snzOpen(html, anchor, done) {
    snzClose(false);
    const el = document.createElement("div"), sheet = MOBQ.matches || !anchor;
    el.className = "snz-wrap" + (sheet ? " sheet" : "");
    el.innerHTML = `<div class="snz-pop" role="menu">${html}</div>`;
    document.body.appendChild(el); SNZ.el = el; SNZ.done = done || null;
    const pop = el.firstElementChild;
    if (!sheet) {
      const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
      const left = Math.max(12, Math.min(innerWidth - w - 12, r.left + r.width / 2 - w / 2)), top = r.top - h - 10 >= 8 ? r.top - h - 10 : r.bottom + 10;
      Object.assign(pop.style, { left: left + "px", top: top + "px" });
    }
    el.addEventListener("click", e => { if (e.target === el) snzClose(false); });
    return pop;
  }
  function snzMenu(id, anchor, done) {
    const it = items().find(i => i.id === id); if (!it) return done && done(false);
    const en = UI.lang === "en", now = new Date(), nm = aname(agent(it.owner)), on = snoozed(it);
    const opt = (p, a, b, extra) => `<button type="button" class="snz-o" data-snz-p="${p}" role="menuitem"><b>${a}</b><span>${b}</span>${extra || ""}</button>`;
    const html = `<div class="snz-h"><b>${en ? "Later" : "稍后再看"}</b><small>${on ? (en ? `Snoozed · ${esc(snzText(it))}` : `已推迟 · ${esc(snzText(it))}`) : (en ? "Off your list until then; it comes back by itself" : "先从等你拍板拿掉，到时候自己回来")}</small></div>
      ${now.getHours() * 60 + now.getMinutes() < 19 * 60 + 30 ? opt("tonight", en ? "Tonight" : "今晚", "20:00") : ""}
      ${opt("morning", en ? (now.getHours() < 5 ? "This morning" : "Tomorrow morning") : (now.getHours() < 5 ? "早上" : "明早"), "09:00")}
      ${opt("monday", en ? "Next Monday" : "下周一", "09:00")}
      ${opt("reply", en ? `Until ${esc(nm)} replies` : `等${esc(nm)}下条回复`, en ? "or a new draft · 3 days max" : "有回复或新稿就回来，最多等 3 天")}
      <button type="button" class="snz-o" data-snz-pick role="menuitem"><b>${en ? "Pick a time…" : "自己选时间…"}</b><span></span></button>
      <form class="snz-cus" hidden><input type="datetime-local" name="t" required><button class="btn-s">${en ? "OK" : "确定"}</button></form>
      ${on ? `<button type="button" class="snz-o un" data-snz-un role="menuitem"><b>${en ? "Cancel snooze" : "取消推迟"}</b><span>${en ? "back on your list now" : "现在就回到等你拍板"}</span></button>` : ""}`;
    const pop = snzOpen(html, anchor, done);
    const send = (preset, until) => {
      const lbl = until ? snzWhen(until) : preset === "reply" ? (en ? `until ${nm} replies` : `等${nm}下条回复`) : [...$(`[data-snz-p="${preset}"]`, pop).children].map(x => x.textContent).join(" ").trim();
      pop.classList.add("busy");
      api("snooze", { item: id, preset, until, label: lbl }).then(() => {
        toast(en ? `Snoozed · ${lbl}` : `已推迟 · ${preset === "reply" ? lbl : lbl + " 回来"}`);
        if (UI.item === id && !MOBQ.matches) closeItem(); else if (UI.item === id) backItem();
        snzClose(true);
      }).catch(() => { pop.classList.remove("busy"); });
    };
    pop.addEventListener("click", e => {
      const p = e.target.closest("[data-snz-p]"); if (p) return send(p.dataset.snzP);
      if (e.target.closest("[data-snz-pick]")) { const f = $(".snz-cus", pop); f.hidden = false; const d = new Date(Date.now() + 3 * 36e5); d.setMinutes(0, 0, 0);
        const loc = x => new Date(x - x.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); f.t.min = loc(new Date()); f.t.value = loc(d); f.t.focus(); return; }
      if (e.target.closest("[data-snz-un]")) { pop.classList.add("busy"); api("unsnooze", { item: id }).then(() => { toast(en ? "Back on your list" : "已取消推迟 · 回到等你拍板"); snzClose(false); }).catch(() => pop.classList.remove("busy")); }
    });
    $(".snz-cus", pop).addEventListener("submit", e => { e.preventDefault(); const v = e.target.t.value, d = new Date(v); if (!v || isNaN(d)) return; send("custom", d.toISOString()); });
  }
  function snzListMenu(anchor) {
    const L = items().filter(snoozed).sort(snzSort), en = UI.lang === "en"; if (!L.length) return;
    const pop = snzOpen(`<div class="snz-h"><b>${en ? "Snoozed" : "推迟中的卡"}</b><small>${en ? "Tap one to open it" : "点一张打开；到点或有新回复会自己回来"}</small></div>` +
      L.map(i => `<div class="snz-r"><button type="button" class="snz-o" data-snz-open="${esc(i.id)}"><b>${esc(i.title)}</b><span>${esc(aname(agent(i.owner)))} · ${esc(snzText(i))}${i.snooze.wait === "reply" && i.snooze.until ? ` · ${en ? "latest" : "最晚"} ${esc(snzWhen(i.snooze.until))}` : ""}</span></button><button type="button" class="snz-x" data-snz-un1="${esc(i.id)}">${en ? "Back now" : "取消推迟"}</button></div>`).join(""), anchor);
    pop.addEventListener("click", e => {
      const o = e.target.closest("[data-snz-open]"); if (o) { snzClose(false); openItem(o.dataset.snzOpen); return; }
      const u = e.target.closest("[data-snz-un1]"); if (u) { u.disabled = true; api("unsnooze", { item: u.dataset.snzUn1 }).then(() => { toast(en ? "Back on your list" : "已取消推迟 · 回到等你拍板"); snzClose(false); }).catch(() => { u.disabled = false; }); }
    });
  }
  document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-snz-list]"); if (b) { e.preventDefault(); snzListMenu(b); } });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && SNZ.el) { e.stopPropagation(); snzClose(false); } }, true);
  $("#drawer").addEventListener("click", e => { const b = e.target.closest("[data-snz-btn]"); if (b) snzMenu(UI.item, b); });
  // ===== t-routine-close: routine cards (config.routines -> meta.routines[].item). Before the server restart meta.routines is missing:
  // then an ongoing "r-*" card with no parent is treated as a routine with an unknown schedule, and the buttons say a restart is needed.
  function routineOf(it) {
    if (!it) return null;
    const rs = ST.meta && ST.meta.routines;
    const own = Array.isArray(rs) ? rs.find(r => r.item === it.id) : null;
    if (own) return own;
    /* t-routine-detect: an ongoing card in doing that is not a child card is a standing card too (按需常驻: no server timer, the manager runs it, e.g. t-oss-sync).
       id null = never send its id as a config routine; pause / resume go by item (server.py keeps it.paused). Before t-routine-detect only r-* without meta.routines counted. */
    if (it.category === "ongoing" && it.stage === "doing" && !parentOf(it)) return { id: null, item: it.id, ondemand: true, paused: (it.paused && it.paused.at) || null };
    if (Array.isArray(rs)) return null;
    return it.category === "ongoing" && /^r-/.test(it.id) && !parentOf(it) ? { id: it.id.slice(2), item: it.id, unknown: true } : null;
  }
  function rtLine(it) {
    const r = routineOf(it); if (!r) return "";
    const en = UI.lang === "en";
    if (r.ondemand) return r.paused   /* t-routine-detect */
      ? `<div class="dw-rt off"><b>${en ? "Paused" : "暂停"}</b><span>${en ? `since ${when(r.paused)} · the manager skips this card` : `${when(r.paused)} 暂停的 · 管家不再做这张卡`}</span></div>`
      : `<div class="dw-rt"><b>${en ? "On demand" : "按需常驻"}</b><span>${en ? "No fixed time · runs when the manager starts it" : "没有固定时间 · 管家说开工才跑"}</span></div>`;
    if (r.unknown) return `<div class="dw-rt"><b>${en ? "Routine" : "常驻任务"}</b><span>${en ? "Schedule shows after the dashboard restarts" : "看板重启后显示定时和下次时间"}</span></div>`;
    if (r.paused) return `<div class="dw-rt off"><b>${en ? "Paused" : "暂停"}</b><span>${en ? `since ${when(r.paused)} · no new runs` : `${when(r.paused)} 暂停的 · 不再开新的子卡`}</span></div>`;
    const nd = r.next && new Date(r.next), tmr = dayKey(new Date(Date.now() + 864e5));
    const nx = !nd ? "—" : dayKey(nd) === tmr ? `${en ? "tomorrow" : "明天"} ${hm(r.next)}` : when(r.next);
    return `<div class="dw-rt"><b>${en ? `Daily ${r.time}` : `每天 ${esc(r.time)}`}</b><span>${en ? "next" : "下次"} ${esc(nx)}</span></div>`;
  }
  $("#drawer").addEventListener("click", e => {
    const b = e.target.closest("[data-rt]"); if (!b) return;
    const it = curItem(), r = routineOf(it); if (!r) return;
    rtToggle(it, r, b.dataset.rt === "pause");
  });
  /* t-ri1104-p3: the one pause / resume path, used by the card dock above and by the 常驻活动 schedule page. */
  function rtToggle(it, r, pause) {
    const zh = UI.lang !== "en";
    if (r.unknown) return toast(zh ? "这个按钮要等看板重启后才能用" : "Needs a dashboard restart first", true);
    if (r.ondemand) {   /* t-routine-detect: by item only, never a made-up routine id */
      if (pause && !confirm(zh ? `暂停常驻「${it.title}」？\n暂停以后管家不再做这张卡，随时可以再开启。` : `Pause "${it.title}"? The manager skips it until you turn it back on.`)) return;
      api(pause ? "routine_pause" : "routine_resume", { item: it.id })
        .then(() => toast(pause ? (zh ? "已暂停 · 管家不再做这张卡" : "Paused") : (zh ? "已开启" : "Turned on")))
        .catch(e => { if (/no routine/.test(String(e && e.message))) toast(zh ? "这个按钮要等看板重启后才能用" : "Needs a dashboard restart first", true); });
      return;
    }
    if (pause && !confirm(zh ? `暂停常驻任务「${it.title}」？\n暂停以后每天 ${r.time} 不再自动开子卡；已有的子卡不受影响。随时可以再开启。` : `Stop "${it.title}"? No new daily runs until you resume.`)) return;
    api(pause ? "routine_pause" : "routine_resume", { routine: r.id, item: it.id })
      .then(() => toast(pause ? (zh ? "已暂停 · 不会再定时触发" : "Paused") : (zh ? "已开启 · 每天 " + r.time : "Turned on"))).catch(() => { });   /* api() already toasts the error */
  }
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-rtq]"); if (!b) return;
    const r = ((ST.meta && ST.meta.routines) || []).find(x => x.id === b.dataset.rtq), it = r && (ST.items || []).find(i => i.id === r.item);
    if (r && it) rtToggle(it, r, !r.paused);
  });
  // persistent done marker: owner avatar + 委托完成 + when (replaces the faint "✦ 完成 · time" line). .pre = hidden until the splash ends, then it stamps in once.
  /* t-ri1104-p4: some old done cards never got a closed time (22 on 11-04). Fall back to the last "→ done" stage event, then updated. Display only, state untouched. */
  function closedAt(it) {
    if (!it) return "";
    if (it.closed) return it.closed;
    const ev = (it.thread || []).filter(x => x.kind === "event" && /→\s*done\b/.test(x.text || "")).pop();
    return (ev && ev.t) || it.updated || "";
  }
  function stampHTML(it) {
    const own = agent(it.owner);
    return `<div class="dw-stamp${DW.stampPre === it.id ? " pre" : ""}"><span class="st-av">${av(own)}</span><span class="st-tx"><b>${UI.lang === "en" ? "Mission Complete" : "委托完成"}</b><i>${esc(aname(own))}${closedAt(it) ? " · " + when(closedAt(it)) : ""}</i></span></div>`;
  }
  $("#drawer").addEventListener("change", e => {
    if (e.target.matches && e.target.matches("[data-vd-base]")) { if (DW.vd) DW.vd.base = +e.target.value; renderDrawer(); return; }   // t-imp-p2
    const f = e.target.dataset && e.target.dataset.f; if (!f) return;
    const v = e.target.value;
    if (f === "owner") api("reassign", { item: UI.item, owner: v });
    if (f === "category") api("set_category", { item: UI.item, category: v });
    if (f === "stage") {
      const sid = UI.item, cur = ST.items.find(i => i.id === sid);
      if (v === "done" && openAsks(cur).length) { e.target.value = cur.stage; return askGuard(sid, "done", skip => api("set_stage", { item: sid, stage: v, skip_asks: skip || undefined })); }
      api("set_stage", { item: sid, stage: v });
    }
  });
  $("#drawer").addEventListener("click", e => {
    if (e.target.closest(".dw-back[data-close]")) return backItem();
    { // t-ri1103-p4: 目录
      if (e.target.closest("[data-toc-tg]")) { TOC.open = !TOC.open; if (!PHONE.matches) try { localStorage.setItem("rt.toc", TOC.open ? "open" : "min"); } catch { } tocMode(); TOC.cur = null; tocSync(); return; }   // cur reset: the opened list scrolls its lit line into view
      if (e.target.closest("[data-toc-close]")) { TOC.open = false; tocMode(); return; }
      const tc = e.target.closest("[data-toc]"); if (tc) { tocGo(+tc.dataset.toc); return; } }   // t-parent-links: back = previous card if you came from one, else close
    if (e.target.closest("[data-close]")) return closeItem();
    const nv = e.target.closest("[data-dw-nav]"); if (nv) { navItem(nv.dataset.dwNav); return; }
    const ci = e.target.closest("[data-copy-id]");   // t-id-copy: tap the card id to copy it
    if (ci) { const id = ci.dataset.copyId; copyText(id).then(ok => toast(ok ? (UI.lang === "en" ? `Copied ${id}` : `已复制 ${id}`) : (UI.lang === "en" ? "Copy failed" : "复制失败"), !ok)); return; }
    const cp = e.target.closest("[data-copy-v]");
    if (cp) { const it = curItem(), k = cp.dataset.copyV; const txt = k === "cur" ? it.draft : ((it.versions || [])[+k.slice(1)] || {}).draft; navigator.clipboard.writeText(txt || "").then(() => toast(t("copied"))); return; }
    if (e.target.closest("[data-vd-toggle]")) { if (DW.vd) DW.vd.open = !DW.vd.open; renderDrawer(); return; }   // t-imp-p2
    if (e.target.closest("[data-uin-asks]")) { const id = UI.item; DW.askOpen.has(id) ? DW.askOpen.delete(id) : DW.askOpen.add(id); renderDrawer(); return; }   // t-ui-next 1
    if (e.target.closest("[data-uin-sum]")) { const id = UI.item; DW.sumOpen.has(id) ? DW.sumOpen.delete(id) : DW.sumOpen.add(id); renderDrawer(); return; }   // t-ui-next 4
    const fo = e.target.closest("[data-fold]");
    if (fo) { const k = fo.dataset.fold, key = k === "cur" ? "x" + k : k; DW.open.has(key) ? DW.open.delete(key) : DW.open.add(key); renderDrawer(); return; }
    const jp = e.target.closest("[data-jump]");
    if (jp) { const sc = $("#drawer .dw-scroll"); sc.scrollTo({ top: jp.dataset.jump === "top" ? 0 : sc.scrollHeight, behavior: "smooth" }); return; }
    if (e.target.closest("[data-to-reset]")) { DW.to = null; drawTo(); return; }
    const a = e.target.closest("[data-act]"); if (!a) return;
    const k = a.dataset.act;
    if (k === "close") return modalClose();   // t-close-bottom
    if (k === "reject") {
      const reason = annWrap($(".composer textarea").value.trim()), aid = UI.item;   // t-imp29-p2: notes alone are a reason
      if (!reason) return modalReject();
      return api("reject", { item: UI.item, reason }).then(() => { annClear(aid); DRAFT.set("item:" + aid, ""); $(".dr-tag") && $(".dr-tag").remove(); $(".composer textarea").value = ""; toast(UI.lang === "en" ? "Rejected · reason sent" : "已驳回 · 原因已发出"); });
    }
    if ((k === "approve" || k === "done") && openAsks(ST.items.find(i => i.id === UI.item)).length) return askGuard(UI.item, k, skip => drawerAct(k, a, skip));
    drawerAct(k, a, false);
  });
  function drawerAct(k, a, skip) {
    if (!a.isConnected) a = $(`#drawer [data-act="${k}"]`) || a;   // the dock may have been redrawn while the sheet was open
    const typed = $(".composer textarea").value.trim(), note = k === "approve" ? annWrap(typed) : typed;   // t-imp29-p2: notes ride along with 批准 too
    const it = ST.items.find(i => i.id === UI.item), wasPlan = it && it.kind === "plan";
    const b = a.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    // a fresh completion = this click moves a not-yet-done item to done (never for an item that was already done, never on page load / state refresh)
    const id = UI.item, fresh = !!it && it.stage !== "done" && (k === "done" || (k === "approve" && !wasPlan));
    const clearPre = () => { if (DW.stampPre === id) { DW.stampPre = null; const s = $("#drawer .dw-stamp"); if (s) s.classList.remove("pre"); } };
    if (fresh && window.FX) { DW.stampPre = id; setTimeout(clearPre, 3800); }
    api(k, { item: id, note: note || undefined, skip_asks: skip || undefined }).then(() => {
      if (note && k === "approve") { $(".composer textarea").value = ""; annClear(id); DRAFT.set("item:" + id, ""); $(".dr-tag") && $(".dr-tag").remove(); }
      if (!window.FX) return;
      if (fresh) {
        FX.burst(cx, cy, { n: 46, spread: 180 });
        FX.missionComplete({ key: id + "|" + (it.updated || ""), owner: it.owner, title: it.title, time: when(new Date().toISOString()),
          onEnd: () => { const s = $("#drawer .dw-stamp"); DW.stampPre = null; if (s) { s.classList.remove("pre"); if (!FX.reduce) s.classList.add("fresh"); } } });
      }
      else if (k === "approve") { FX.burst(cx, cy, { n: 28 }); toast(okDone(it)); }
      else if (k === "reopen") toast(UI.lang === "en" ? "Reopened" : "已重开");
    }).catch(clearPre);
  }
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") { if (!$("#modal").hidden) closeModal(); else if (document.body.classList.contains("chat-pop")) chatPop(false); else if (MB.open) closeMailbox(); else if (UI.item) closeItem(); }
  });

  // ---------- chat (right) ----------
  const chatAtt = [];
  let chatBuilt = false, chatRenderedFor = null, chatCount = 0;
  const CHN = { for: null, t: "", on: false };   // r-improve-1102 P4: 「以下 N 条是新消息」 — where you had read up to when this thread was opened
  // t-mobile-crash B: a thread renders only from chatFrom on (the newest CHAT_N when it opens; 「加载更早的消息」 moves it back by CHAT_N).
  // chatFrom stays put while new messages arrive (so the phone still sees the count grow and plays m-new); it re-anchors on a chat switch or past CHAT_N + 60.
  const CHAT_N = 20; let chatFrom = 0, chatHold = false, chatBottom = false, chatMore = false;   // chatBottom: you just sent, so the next render lands on the newest message (t-perf C)   // chatHold: a ↩ quote jumped far back (t-option-quote); keep that range until the thread changes
  // ui10 (t-pixel-click): a click on a pixel character opens the detail of the item they are on now.
  // Before: it opened that character's DM chat (setChat). The DM is still one tap away via the chat-head avatar row, the Team page 私信 button, and Shift/Alt-click on the sprite.
  function pixelOpen(id, e) {
    if (e && (e.shiftKey || e.altKey)) return setChat(id);
    const a = agent(id), its = items();
    let it = a.item && its.find(i => i.id === a.item && i.stage !== "done");
    if (!it) it = its.filter(i => i.owner === id && (i.stage === "doing" || i.stage === "review")).sort((x, y) => (y.updated || "").localeCompare(x.updated || ""))[0];
    if (it) return openItem(it.id);
    toast(UI.lang === "en" ? `${aname(a)} has nothing in progress` : `${aname(a)} 现在没有在办的单子`);
  }
  function setChat(id) { UI.chat = id; LS.set("chat", id); chatRenderedFor = null; CHN.for = null; renderLeft(); renderChat(); chatDraftLoad(); $("#right textarea") && $("#right textarea").focus(); }
  function chatDraftLoad() {   // t-draft-keep: the DM box shows this partner's own draft (never the previous partner's text)
    const ta = $("#right .ch-comp textarea"); if (!ta) return; const d = DRAFT.get("dm:" + UI.chat), v = d ? d.t : "";
    if (ta.value === v) return; ta.value = v; ta.style.height = ""; ta._dmLoad = true; ta.dispatchEvent(new Event("input", { bubbles: true })); ta._dmLoad = false;
  }
  function chatList(id) { return id === "manager" ? (ST.chat || []) : ((ST.dms || {})[id] || []); }
  function buildChat() {
    const r = $("#right");
    r.innerHTML = `<div class="ch-grip" title="${UI.lang === "en" ? "Drag to resize" : "拖动调整宽度"}"></div>
      <button class="ch-fold" title="${UI.lang === "en" ? "Collapse" : "收起 / 展开"}"><span></span></button>
      <div class="ch-head"><div class="ch-who"></div>${orn(160)}<div class="ch-roster"></div></div><div class="ch-msgs"></div>
      <div class="pending-att" style="padding:0 16px"></div>
      <div class="ch-comp"><button type="button" class="att" title="${attTitle()}" aria-label="${UI.lang === "en" ? "Attach" : "添加附件"}">${ATT_IC}</button><input type="file" multiple hidden><textarea rows="1"></textarea><span class="ch-kb" aria-hidden="true">${UI.lang === "en" ? "⌘/Ctrl ↵ send · ↵ new line" : "⌘/Ctrl ↵ 发送 · ↵ 换行"}</span></div>`;
    const ta = $("textarea", r), fi = $("input[type=file]", r);
    const showAtt = () => attTiles($(".pending-att", r), chatAtt, showAtt);   // ui19
    const add = wireUploads(ta, chatAtt, showAtt);
    ta.addEventListener("input", () => { if (!ta._dmLoad) DRAFT.set("dm:" + UI.chat, ta.value); });   // t-draft-keep
    $(".ch-comp button", r).onclick = () => fi.click();
    fi.onchange = () => { add(Array.from(fi.files)); fi.value = ""; };
    ta.addEventListener("input", () => deskFit(ta, 200));   /* t-hdr-trim ⑨ (was height:auto, which jumped to two rows on the first letter) */   // jit: on the phone mobile.js fit() is the only owner of this height (a second measure here flushed height:auto = 62px and re-animated it on every keystroke)
    ta.addEventListener("keydown", async e => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault(); const text = ta.value.trim(); if (!text && !chatAtt.length) return;
        if (stillUploading(chatAtt)) return toast(UI.lang === "en" ? "Still uploading…" : "文件还在上传……");
        const dmTo = UI.chat, att = chatAtt.slice(); DRAFT.set("dm:" + dmTo, ""); ta.value = ""; ta.style.height = ""; chatAtt.length = 0; showAtt();   // t-perf C: clear first, the bubble is already up
        sendChat(text || "📎", att);
      }
    });
    // t-rail-tip: folded rail (one column of avatars) → our own name tip, to the LEFT of the avatar and vertically centred, on <body> with position:fixed
    // so the rail's overflow never clips it. The native title tooltip (OS-placed, landed on the next avatar) is dropped from the rail on hover.
    let rtip = null;
    const railTip = btn => {
      if (!btn || !document.body.classList.contains("chat-folded") || MOBQ.matches) return railHide();
      btn.querySelectorAll("[title]").forEach(x => { x.dataset.t = x.getAttribute("title"); x.removeAttribute("title"); });
      const a = $(".av", btn) || btn, q = a.getBoundingClientRect(), nm = ($("span:not(.av)", btn) || {}).textContent || "";
      if (!rtip) { rtip = document.createElement("div"); rtip.id = "rail-tip"; rtip.setAttribute("role", "tooltip"); document.body.appendChild(rtip); }
      rtip.textContent = nm; rtip.classList.add("on");
      rtip.style.top = Math.round(q.top + q.height / 2) + "px"; rtip.style.left = Math.round(q.left - 10) + "px";
    };
    const railHide = () => { if (rtip) rtip.classList.remove("on"); };
    r.addEventListener("mouseover", e => { const b = e.target.closest(".ch-roster [data-pick]"); if (b) railTip(b); else railHide(); });
    r.addEventListener("mouseleave", railHide);
    r.addEventListener("focusin", e => { const b = e.target.closest(".ch-roster [data-pick]"); if (b && b.matches(":focus-visible")) railTip(b); });
    r.addEventListener("focusout", railHide);
    addEventListener("scroll", railHide, true);
    r.addEventListener("click", e => {
      const o = e.target.closest("[data-opt]"); if (o) { RQ.fresh = o.dataset.mid || ""; sendChat(o.dataset.opt, [], o.dataset.mid); }
      const q = e.target.closest(".rq[data-rq]"); if (q) { rqSeek(q.dataset.rq); return; }
      const pr = e.target.closest("[data-pend-retry]"), pd = e.target.closest("[data-pend-drop]");   // t-perf C: a failed bubble
      if (pr || pd) { const p = PEND.list.find(x => x.pend === (pr || pd).dataset[pr ? "pendRetry" : "pendDrop"]); if (p) { if (pd) { PEND.list.splice(PEND.list.indexOf(p), 1); chatCount = -1; renderChat(); hooks.forEach(f => f("all")); } else { pendPost(p); pendPaint(p); } } return; }
      railHide();
      const p = e.target.closest("[data-pick]"); if (p) { if (UI.chatFold) foldChat(false); setChat(p.dataset.pick); }
      if (e.target.closest("[data-more]")) { moreChat($(".ch-msgs", r)); return; }
      if (e.target.closest(".ch-fold")) { if (document.body.classList.contains("chat-pop")) chatPop(false); else foldChat(!UI.chatFold); }
    });
    const grip = $(".ch-grip", r);
    grip.addEventListener("pointerdown", e => {
      if (UI.chatFold) return;
      e.preventDefault(); grip.setPointerCapture(e.pointerId); document.body.classList.add("resizing");
      const move = ev => { UI.chatW = Math.max(300, Math.min(760, window.innerWidth - ev.clientX)); applyChatW(); };
      const up = () => { grip.removeEventListener("pointermove", move); document.body.classList.remove("resizing"); LS.set("chatW", UI.chatW); dispatchEvent(new Event("resize")); };
      grip.addEventListener("pointermove", move); grip.addEventListener("pointerup", up, { once: true });
    });
    grip.addEventListener("dblclick", () => { UI.chatW = 420; LS.set("chatW", 420); applyChatW(); });
    applyChatW();
    chatBuilt = true;
  }
  // t-web-audit 01: the board and the production line fold the chat on their own while #main is under 900px (not saved; unfolds when you leave)
  function autoFold() {
    if (MOBQ.matches || NARROWQ.matches) return;   // at <=1180px the chat is a pop-over, nothing to fold
    const wide = UI.page === "board" || UI.page === "pipe", main = $("#main");
    if (wide && !UI.chatFold && !UI.autoFold && !LS.get("wideChat", false) && main && main.clientWidth < 900) { UI.autoFold = true; UI.chatFold = true; applyChatW(); setTimeout(() => dispatchEvent(new Event("resize")), 520); }
    else if (!wide && UI.autoFold) { UI.autoFold = false; UI.chatFold = false; applyChatW(); setTimeout(() => dispatchEvent(new Event("resize")), 520); }
  }
  // t-web-audit 06: under 900px the detail drawer covers the whole middle column
  try { const mn = $("#main"); new ResizeObserver(() => document.body.classList.toggle("main-narrow", mn.clientWidth < 900)).observe(mn); } catch { }
  // t-web-audit-2 05: at 761-1180px the chat column is hidden; the top bar's 聊天 button (or a teammate row) slides it in over the page
  const NARROWQ = matchMedia("(max-width: 1180px)");
  function chatPop(on) {
    document.body.classList.toggle("chat-pop", on);
    if (on && UI.chatFold) { UI.popUnfold = true; UI.chatFold = false; applyChatW(); }   // the pop-over always shows the full chat; the saved fold is untouched
    if (!on && UI.popUnfold) { UI.popUnfold = false; UI.chatFold = LS.get("chatFold", false); applyChatW(); }
    const b = $("#hdrctrl .hc-chat"); if (b) b.setAttribute("aria-expanded", on);
    if (on) setTimeout(() => { const ta = $("#right textarea"); if (ta) ta.focus({ preventScroll: true }); }, 60);
  }
  document.addEventListener("click", e => {   // a click outside the pop-over closes it (dialogs and the viewer opened from it do not)
    if (!document.body.classList.contains("chat-pop")) return;
    if (e.target.closest("#right, #modal, #lb, #toast, .hc-chat, [data-chat]")) return;
    chatPop(false);
  }, true);
  NARROWQ.addEventListener("change", () => { if (!NARROWQ.matches) chatPop(false); });
  function applyChatW() {
    document.documentElement.style.setProperty("--chat-w", UI.chatFold ? "80px" : UI.chatW + "px");   // t-rail-width: 64 -> 80, so avatars get ~14px either side and the unread badge / online dot sit inside
    document.body.classList.toggle("chat-folded", UI.chatFold);
  }
  function foldChat(on) {
    const wide = UI.page === "board" || UI.page === "pipe";
    if (UI.autoFold) { UI.autoFold = false; if (!on) LS.set("wideChat", true); }   // opened it again on the board: remember, stop folding there
    else if (on && wide) LS.set("wideChat", false);
    UI.chatFold = on; LS.set("chatFold", on); applyChatW();
    setTimeout(() => dispatchEvent(new Event("resize")), 520);  // let the office canvas refit after the slide
  }
  // t-perf C (was t-send-lag): the bubble goes up the moment you send, gray while the POST is out (st "sending"), normal once the server said ok ("ok"),
  // red with 重试 / 删除 if it failed ("fail"). It stays a local bubble until a poll brings the server's copy (matched by text after the last
  // message that was there when you sent), then the real message replaces it. No forced full re-download any more: one ordinary rev poll.
  const PEND = { n: 0, list: [] };
  const isoNow = () => { const d = new Date(), o = -d.getTimezoneOffset(), p = n => String(Math.floor(Math.abs(n))).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${o >= 0 ? "+" : "-"}${p(o / 60)}:${p(o % 60)}`; };
  function sendChat(text, attachments, replyTo) {
    const chat = UI.chat, L = chatList(chat), src = replyTo && L.find(x => x.id === replyTo);
    const p = { pend: "p" + (++PEND.n), chat, who: "me", text, att: attachments || [], t: isoNow(), st: "sending", after: L.length ? L[L.length - 1].id : null,
      attachments: (attachments || []).map(a => typeof a === "string" ? a : a && a.path).filter(Boolean) };
    if (replyTo) { p.reply_to = replyTo; if (src) p.rq = { who: src.who, text: String(src.text || "").replace(/\s+/g, " ").slice(0, 80) }; }
    PEND.list.push(p); chatBottom = true;
    if (UI.chat === chat) { renderChat(); hooks.forEach(f => f("all")); }
    return pendPost(p);
  }
  function pendPost(p) {
    p.st = "sending"; p.okAt = 0;
    const b = { text: p.text, attachments: p.att }; if (p.reply_to) b.reply_to = p.reply_to;   // t-option-quote: the server snapshots the quoted message
    return postAct(p.chat === "manager" ? "chat" : "dm", p.chat === "manager" ? b : Object.assign({ agent: p.chat }, b))
      .then(j => { p.st = "ok"; p.okAt = Date.now(); pendPaint(p); poll(); return j; },
        e => { p.st = "fail"; pendPaint(p); toast((UI.lang === "en" ? "Not sent: " : "没发出去：") + String(e.message || e), true); });
  }
  function pendPaint(p) { if (PEND.list.includes(p) && UI.chat === p.chat && ST) { chatCount = -1; renderChat(); hooks.forEach(f => f("all")); } }
  function pendSync() {   // drop the local bubbles whose server copy has arrived
    if (!PEND.list.length) return;
    const claimed = new Set();
    PEND.list = PEND.list.filter(p => {
      const L = chatList(p.chat); let from = 0;
      if (p.after) { let i = L.length - 1; while (i >= 0 && L[i].id !== p.after) i--; from = i >= 0 ? i + 1 : Math.max(0, L.length - 50); }
      for (let k = from; k < L.length; k++) { const m = L[k], key = p.chat + ":" + (m.id || k); if (m.who === "me" && m.text === p.text && !claimed.has(key)) { claimed.add(key); return false; } }
      return !(p.st === "ok" && Date.now() - p.okAt > 60e3);   // safety net: the server has had it for a minute
    });
  }
  const pendOf = id => PEND.list.filter(p => p.chat === id);
  // ===== t-option-quote: a reply that quotes an earlier message (a quick-option click) draws ↩ who · first line above its bubble.
  // Tapping it scrolls back to the original (loading earlier pages, at most 5) and rings it; a trimmed original gets a toast, the snapshot stays.
  const RQ = { fresh: "", seen: new Set(), for: null };
  document.addEventListener("click", e => {   // card thread: ↩ on an answer scrolls to that question in 「要你拿主意」 and rings it
    const b = e.target.closest && e.target.closest("[data-rq-ask]"); if (b) askSeek(b.dataset.rqAsk);
  });
  function askSeek(id, n = 0) {
    const q = document.querySelector(`.ask[data-askq="${CSS.escape(id)}"]`), sum = !q && document.querySelector('[data-uin-asks][aria-expanded="false"]');
    if (sum && !n) { sum.click(); setTimeout(() => askSeek(id, 1), 150); return; }   // all answered: the questions sit folded behind one summary row
    if (!q) { toast(UI.lang === "en" ? "That question is no longer on the card" : "这个问题已经不在卡上了"); return; }
    q.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    q.classList.remove("rq-hit"); void q.offsetWidth; q.classList.add("rq-hit"); setTimeout(() => q.classList.remove("rq-hit"), 1300);
  }
  function rqLine(m) {
    if (!m.reply_to || !m.rq) return "";
    const w = m.rq.who, nm = w === "me" ? (UI.lang === "en" ? "You" : "你") : aname(agent(w)), tx = String(m.rq.text || "");
    const nw = m.who === "me" && RQ.fresh === m.reply_to && !RQ.seen.has(m.id); RQ.seen.add(m.id); if (nw) RQ.fresh = "";
    return `<button type="button" class="rq${nw ? " rq-new" : ""}" data-rq="${esc(m.reply_to)}" title="${esc(tx)}"><i aria-hidden="true">↩</i><b>${esc(nm)}</b><span>${esc(tx)}</span></button>`;
  }
  function rqSeek(mid, n = 0) {
    const box = $("#right .ch-msgs"); if (!box) return;
    const m = box.querySelector(`.msg[data-mid="${CSS.escape(mid)}"]`);
    if (m) {
      const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
      box.scrollTo({ top: Math.max(0, box.scrollTop + m.getBoundingClientRect().top - box.getBoundingClientRect().top - Math.min(140, box.clientHeight * 0.3)), behavior: RM ? "auto" : "smooth" });
      m.classList.remove("rq-hit"); void m.offsetWidth; m.classList.add("rq-hit"); setTimeout(() => m.classList.remove("rq-hit"), 1300);
      return;
    }
    const list = chatList(UI.chat), at = list.findIndex(x => x.id === mid);
    if (at < 0 || n >= 2 || at >= chatFrom) { toast(UI.lang === "en" ? "That message is too old; it is no longer in the record" : "原消息太早，已不在记录里"); return; }
    chatHold = true; chatFrom = Math.max(0, at - 3); box._n = 1e9; chatCount = -1; renderChat(); hooks.forEach(f => f("all"));   // render from just above the original
    setTimeout(() => rqSeek(mid, n + 1), 120);
  }
  // ===== t-web-dm: the desktop chat panel (and its <=1180px pop-over) gets the phone thread's major design (P3): a stamp only after a 5-minute gap,
  // one avatar per run of messages, my avatar on the right, a typing bubble, and the exact time on hover. Same class names as mobile.js decorateThread(),
  // styled only under @media (min-width: 761px). It must never run on a phone: decorateThread() skips any thread that already has a .m-tsep.
  function deskStamp(iso) {
    const d = new Date(iso), p2 = n => String(n).padStart(2, "0"), hm = `${p2(d.getHours())}:${p2(d.getMinutes())}`, en = UI.lang === "en";
    const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()), diff = Math.round((day(new Date()) - day(d)) / 864e5);
    if (diff === 0) return hm;
    if (diff === 1) return (en ? "Yesterday " : "昨天 ") + hm;
    if (diff < 7) return (en ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] : ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"])[d.getDay()] + " " + hm;
    return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
  }
  function deskMeAv() {
    const f = (ST.meta.avatars || {}).me;
    if (f) return `<span class="av m-meav" style="background-image:url('/avatars/${encodeURIComponent(f)}')"></span>`;
    const o = ST.meta.owner, ch = o && !o.startsWith("<") ? [...o.trim()][0] : (UI.lang === "en" ? "Me" : "我");
    return `<span class="av m-meav ph"><b>${esc(ch)}</b></span>`;
  }
  function decorateDesk(box, list) {
    if (MOBQ.matches || !box) return;
    const msgs = [...box.querySelectorAll(".msg[data-t]")];
    if (msgs.length && !box.querySelector(".m-tsep")) {   // renderChat rebuilt the box: decorate once
      const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
      let prev = null, pw = null;
      msgs.forEach(m => {
        const t0 = m.dataset.t, w = m.classList.contains("me") ? "\u0001me" : (m.dataset.who || "");
        if (!prev || new Date(t0) - new Date(prev) > 5 * 60e3) m.insertAdjacentHTML("beforebegin", `<div class="m-tsep">${esc(deskStamp(t0))}</div>`);
        const pe = m.previousElementSibling; m.classList.toggle("m-cont", !!pe && pe.classList.contains("msg") && w === pw);
        prev = t0; pw = w;
        m.title = new Date(t0).toLocaleString(UI.lang === "en" ? "en-US" : "zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
        if (m.classList.contains("me")) m.insertAdjacentHTML("beforeend", deskMeAv());
        else if (m.dataset.who && m.dataset.who !== UI.chat) { const mb = m.querySelector(".mb"); if (mb) mb.insertAdjacentHTML("beforebegin", `<div class="m-nm">${esc(aname(agent(m.dataset.who)))}</div>`); }
      });
      if (atBottom) box.scrollTop = box.scrollHeight;
    }
    // typing: the agent is working and you spoke last. The dots get a negative animation-delay from the clock, so a rebuilt bubble keeps its phase.
    const a = agent(UI.chat), last = list && list[list.length - 1], on = typingOn(a, last);   // t-typing-fix
    let tb = box.querySelector(".m-typing");
    if (on && !tb) {
      const ph = Date.now() % 1200;
      box.insertAdjacentHTML("beforeend", `<div class="m-typing" data-until="${typingUntil(last)}">${av(a)}<div class="mb"><span class="m-dots">${[0, 1, 2].map(i => `<i style="animation-delay:${i * 160 - ph}ms"></i>`).join("")}</span></div></div>`);
      if (box.scrollHeight - box.scrollTop - box.clientHeight < 120) box.scrollTop = box.scrollHeight;
    } else if (!on && tb) tb.remove();
  }
  MOBQ.addEventListener("change", () => { chatRenderedFor = null; if (ST) renderChat(); });   // crossing 760px: rebuild so the other layout decorates from scratch
  // t-mobile-crash B: 「加载更早的消息」. Keeps the message that was on top where it was: re-aligned after the render, the phone's stamps (hooks)
  // and every frame for ~1.5 s while thumbnails above it load. The browser's own scroll anchoring is off meanwhile (Chromium's picks another node and fights us;
  // iOS Safari may have none). Stops at the user's first touch / wheel. _n huge = no m-new pop for the older messages.
  function moreChat(box) {
    const top = box.querySelector(".msg[data-t]"); if (!top) return;
    const key = top.dataset.t, off = top.getBoundingClientRect().top - box.getBoundingClientRect().top;
    box.style.overflowAnchor = "none";
    chatFrom = Math.max(0, chatFrom - CHAT_N); box._n = 1e9; chatCount = -1; chatMore = true; renderChat(); hooks.forEach(f => f("all"));   // chatMore: this render is the page you asked for, never clamp it (t-perf D)
    let live = true;
    const align = () => { if (!live) return; const el = box.querySelector(`.msg[data-t="${CSS.escape(key)}"]`); if (el) box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - off; };
    const stop = () => { if (!live) return; live = false; box.style.overflowAnchor = ""; box.removeEventListener("touchstart", stop); box.removeEventListener("wheel", stop); };
    const loop = () => { if (live) { align(); requestAnimationFrame(loop); } };   // one rect read per frame for 1.5 s: covers stamps, thumbnails and a poll re-render alike
    align(); requestAnimationFrame(loop);
    box.addEventListener("touchstart", stop, { passive: true }); box.addEventListener("wheel", stop, { passive: true }); setTimeout(stop, 1500);
  }
  function renderChat() {
    const firstBuild = !chatBuilt; if (!chatBuilt) buildChat();
    const r = $("#right");
    if (!ST.agents[UI.chat]) UI.chat = "manager";
    if (firstBuild) chatDraftLoad();   // t-draft-keep: restore this partner's unsent text after a reload
    const a = agent(UI.chat);
    const ms = mgrState();
    const st = a.id === "manager" ? (ms.on ? `<span class="on">▶ ${t("online")}</span>` : ms.sleep ? `<span class="zz">☾ ${esc(ms.txt)}</span>` : `<span class="off">● ${t("offline")}</span>`)
      : a.status === "working" ? `<span class="on">▶ ${t("working")}</span>` : `<span class="idle">${t(a.status || "idle")}</span>`;
    $(".ch-who", r).innerHTML = `${av(a, "lg")}<span class="nm">${esc(aname(a))}</span><span class="ti">${esc(atitle(a))}</span>${qBadge(a.id)}${st}<span class="sp"></span>`;
    $(".ch-roster", r).innerHTML = agents().filter(x => x.enabled !== false).map(x => {
      const un = x.id !== UI.chat ? unreadOf(x.id) : 0;   /* t-ri1104-p2: a count from unreadOf (was: a dot when the last message was theirs) */
      return `<button data-pick="${x.id}" class="${x.id === UI.chat ? "on" : ""}">${av(x)}<span>${esc(aname(x))}</span>${un ? `<i class="unread n">${unreadTag(un)}</i>` : ""}${qBadge(x.id, true)}</button>`;
    }).join("").replace(UI.chatFold && !MOBQ.matches ? / title="[^"]*"/g : /$^/, "");   // t-rail-tip: folded rail shows #rail-tip, never the OS tooltip
    $("textarea", r).placeholder = MOBQ.matches ? t("chat_ph", { n: aname(a) }) : (UI.lang === "en" ? `Message ${aname(a)}…` : `对${aname(a)}说……`);   // t-web-dm: desktop moves the shortcut hint below the field
    pendSync();
    const real = chatList(UI.chat), pl = pendOf(UI.chat), list = pl.length ? real.concat(pl) : real;   // t-perf C: local bubbles ride at the end
    const sig = list.length + (pl.length ? "|" + pl.map(p => p.pend + p.st).join(",") : "");
    const box = $(".ch-msgs", r);
    if (chatRenderedFor === UI.chat && chatCount === sig) { decorateDesk(box, list); return; }
    if (chatRenderedFor !== UI.chat) chatHold = false;
    const nearBottom = chatBottom || box.scrollHeight - box.scrollTop - box.clientHeight < 80 || chatRenderedFor !== UI.chat; chatBottom = false;
    // t-perf D: the window only shrinks back to the newest CHAT_N while you sit at the bottom; paging back with 加载更早 keeps every page you loaded
    // (before: past CHAT_N + 60 the next render snapped to the newest 20, so the 4th 加载更早 jumped back down)
    if (chatRenderedFor !== UI.chat || chatFrom > list.length || (!chatHold && !chatMore && nearBottom && list.length - chatFrom > CHAT_N + 60)) chatFrom = Math.max(0, list.length - CHAT_N);
    chatMore = false;
    const view = list.slice(chatFrom);
    // t-mobile-crash A: the manager is "working" whenever it is online, and each ring is 3 infinite animations (= composited layers on iOS).
    // One ring per thread: only the newest message from someone else keeps it, older avatars are drawn idle.
    let ringAt = -1; for (let i = view.length - 1; i >= 0; i--) if (view[i].who !== "me") { ringAt = i; break; }
    const mav = (m, i) => { const x = agent(m.who); return av(i === ringAt ? x : Object.assign({}, x, { status: "idle" }), "sm"); };
    const more = chatFrom > 0 ? `<button class="ch-more" data-more>${UI.lang === "en" ? `Load earlier messages (${chatFrom})` : `加载更早的消息（还有 ${chatFrom} 条）`}</button>` : "";
    // r-improve-1102 P1: quick options on a message you have already answered (you wrote anything after it) fold to one quiet line
    const nextMe = []; { let nx = null; for (let k = list.length - 1; k >= 0; k--) { nextMe[k] = nx; if (list[k].who === "me") nx = list[k]; } }
    if (list.length && CHN.for !== UI.chat) { CHN.for = UI.chat; CHN.t = seenOf(UI.chat); CHN.on = !!CHN.t; CHN.fresh = true; }   // P4: captured on the first render with messages, before it marks the thread read
    let newAt = -1, newN = 0;
    if (CHN.on && CHN.for === UI.chat) {   // new = after both your read mark and your own last message (a reply sent from another device counts as read)
      const lastMe = list.reduce((t, m) => m.who === "me" && m.t > t ? m.t : t, ""), from = lastMe > CHN.t ? lastMe : CHN.t;
      newAt = view.findIndex(m => m.who !== "me" && m.t > from); if (newAt >= 0) newN = view.length - newAt; }
    const sepHTML = i => i !== newAt ? "" : `<div class="new-sep" data-newsep>${UI.lang === "en" ? `${newN} new message${newN > 1 ? "s" : ""} below · you last read ${whenH(CHN.t)}` : `以下 ${newN} 条是新消息 · 你上次看到 ${whenH(CHN.t)}`}</div>`;
    // t-option-quote: a reply that quotes this message folds it to 「你选了 X · time」; the plain "next message of yours" rule only applies when that
    // next message quotes nothing (one that quotes another message leaves these options open). Old messages have no reply_to: unchanged.
    const quoted = {}; for (const x of list) if (x.who === "me" && x.reply_to && !quoted[x.reply_to]) quoted[x.reply_to] = x;
    if (RQ.for !== UI.chat) { RQ.for = UI.chat; list.forEach(x => RQ.seen.add(x.id)); }
    const optsOf = (m, i) => { if (!m.options) return ""; const q = m.id && quoted[m.id]; if (q) return optDone(m.options, q.text, q.t);
      const r = nextMe[chatFrom + i]; if (!r || r.reply_to) return optChips(m.options, m.id); return optDone(m.options, r.text); };
    const pendSt = m => m.st === "fail" ? `<span class="pend-x">${UI.lang === "en" ? "Not sent" : "没发出去"}</span><button type="button" class="pend-b" data-pend-retry="${m.pend}">${UI.lang === "en" ? "Retry" : "重试"}</button><button type="button" class="pend-b" data-pend-drop="${m.pend}">${UI.lang === "en" ? "Delete" : "删除"}</button>`
      : m.st === "ok" ? whenH(m.t) : (UI.lang === "en" ? "Sending…" : "发送中…");
    box.innerHTML = list.length ? more + view.map((m, i) => sepHTML(i) + (m.pend
      ? `<div class="msg me pend${m.st === "ok" ? " pend-ok" : m.st === "fail" ? " pend-fail" : ""}" data-t="${esc(m.t)}" data-pend="${m.pend}">${rqLine(m)}<div class="mb">${md(m.text)}${attHTML(m.attachments)}</div><div class="mt">${pendSt(m)}</div></div>`
      : m.who === "me"
      ? `<div class="msg me" data-t="${esc(m.t)}"${m.id ? ` data-mid="${esc(m.id)}"` : ""}>${rqLine(m)}<div class="mb">${md(m.text)}${attHTML(m.attachments)}</div><div class="mt">${whenH(m.t)}</div></div>`
      : `<div class="msg" data-t="${esc(m.t)}"${m.id ? ` data-mid="${esc(m.id)}"` : ""} data-who="${esc(m.who)}"><div class="mh">${mav(m, i)}${esc(aname(agent(m.who)))} <small>${whenH(m.t)}</small></div><div class="mb md">${chipParens(md(m.text))}</div>${attHTML(m.attachments)}
         ${optsOf(m, i)}</div>`)).join("")
      : `<div class="empty">${UI.chat === "manager" ? (UI.lang === "en" ? "Tell the manager what you want done." : "跟管家说你想做什么。") : (UI.lang === "en" ? "DM goes through the manager to this agent." : "私信会由管家转给这个角色。")}</div>`;
    if (nearBottom) box.scrollTop = box.scrollHeight;
    const opened = !!CHN.fresh; CHN.fresh = false;
    chatRenderedFor = UI.chat; chatCount = sig;
    decorateDesk(box, list);
    newSepPlace(box, opened);
    if (real.length && (!document.body.dataset.mtab || (document.body.dataset.mtab === "chat" && document.body.dataset.cv === "thread"))) { UI.seen["chat." + UI.chat] = real[real.length - 1].t; LS.set("seen", UI.seen); chatMailRead(UI.chat, real[real.length - 1].t); }   /* t-perf C: read marks only from server messages */  // phones: only an open thread counts as read; P3: and the mailbox copies
  }

  // r-improve-1102 P4: on the desktop, opening a thread with more than a screen of new messages lands on the divider (the phone keeps
  // t-dm-scroll: a thread always opens on the newest message; it only shows the divider). Reaching the bottom or sending clears it.
  function newSepPlace(box, opened) {
    const r = $("#right"), sep = $("[data-newsep]", box); let pill = r && $(".new-pill", r);
    if (!sep) { if (pill) pill.remove(); return; }
    if (!box._nsep) { box._nsep = 1; box.addEventListener("scroll", () => { if (box._nsepArm && box.scrollHeight - box.scrollTop - box.clientHeight < 40 && CHN.on) { box._nsepArm = 0; CHN.on = false; const s = $("[data-newsep]", box); if (s) s.remove(); const p = $("#right .new-pill"); if (p) p.remove(); } }, { passive: true }); }
    if (!opened || MOBQ.matches) return;
    const below = box.getBoundingClientRect().bottom - sep.getBoundingClientRect().top + (box.scrollHeight - box.scrollTop - box.clientHeight);
    if (below <= box.clientHeight + 40) return;   // fits on one screen: stay at the bottom as before
    box.scrollTop += sep.getBoundingClientRect().top - box.getBoundingClientRect().top - 12;
    setTimeout(() => { box._nsepArm = 1; }, 300);   // only a scroll by you back down to the bottom clears it
    if (!pill && r) { r.insertAdjacentHTML("beforeend", `<button type="button" class="new-pill">${UI.lang === "en" ? "↓ Latest" : "↓ 回到最新"}</button>`); pill = $(".new-pill", r);
      pill.addEventListener("click", () => { box.scrollTo({ top: box.scrollHeight, behavior: "smooth" }); }); }
  }

  // t-agent-queue: the list behind a 「排队 N」 badge. Capture phase, so the row / avatar under the badge does not also open the chat.
  const aqWait = (iso, en) => { const m = Math.max(1, Math.round((Date.now() - (Date.parse(iso) || Date.now())) / 6e4)), v = m < 60 ? [m, "分钟", "min"] : m < 1440 ? [Math.round(m / 60), "小时", "h"] : [Math.round(m / 1440), "天", "d"];
    return en ? `waiting ${v[0]} ${v[2]}` : `等了 ${v[0]} ${v[1]}`; };
  function aqClose() { const p = $(".aq-pop"); if (p) p.remove(); }
  document.addEventListener("click", e => {
    const t = e.target.closest && e.target.closest("[data-aq]"), inPop = e.target.closest && e.target.closest(".aq-pop");
    if (inPop) { const r = e.target.closest("[data-aq-item]"); if (r) { e.preventDefault(); e.stopPropagation(); aqClose(); openItem(r.dataset.aqItem); } return; }
    aqClose(); if (!t) return;
    e.preventDefault(); e.stopPropagation();
    const id = t.dataset.aq, L = queueOf(id), en = UI.lang === "en", b = t.getBoundingClientRect(), p = document.createElement("div");
    p.className = "aq-pop"; p.setAttribute("role", "dialog");
    p.innerHTML = `<h4>${esc(aname(agent(id)))} · ${en ? `queued ${L.length}` : `排队 ${L.length}`}</h4>` + (L.map(i => `<button type="button" data-aq-item="${esc(i.id)}"><span>${esc(i.title)}</span><time>${aqWait(i.updated || i.created, en)}</time></button>`).join("") || `<p>${en ? "Nothing queued" : "没有排队的卡"}</p>`);
    document.body.appendChild(p);
    const w = p.offsetWidth, h = p.offsetHeight; p.style.left = Math.max(8, Math.min(b.left, innerWidth - w - 8)) + "px"; p.style.top = (b.bottom + h + 8 > innerHeight ? Math.max(8, b.top - h - 6) : b.bottom + 6) + "px";
  }, true);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && $(".aq-pop")) { e.stopPropagation(); aqClose(); } }, true);
  window.addEventListener("scroll", aqClose, { capture: true, passive: true });

  // ---------- modals ----------
  function openModal(html, onMount) { const m = $("#modal"); m.innerHTML = `<div class="mdl frame">${html}</div>`; m.hidden = false; onMount && onMount($(".mdl", m)); }
  function closeModal() { $("#modal").hidden = true; $("#modal").innerHTML = ""; }
  $("#modal").addEventListener("mousedown", e => { if (e.target.id === "modal") closeModal(); });
  // t-close-bottom: 关单 from the detail's bottom bar, any kind / stage. One confirm; the optional reason goes into the card's thread as your message
  // (so the owner sees it), then the card is closed. Open questions do not block it (they are listed and closed with the card).
  const closeBtn = () => `<button class="ab cl" data-act="close" title="${UI.lang === "en" ? "Close this card" : "关掉这张卡"}">${UI.lang === "en" ? "Close" : "关单"}</button>`;
  function modalClose() {
    const it = ST.items.find(i => i.id === UI.item); if (!it) return;
    const zh = UI.lang !== "en", oa = openAsks(it), id = it.id;
    openModal(`<h2>${zh ? "关单" : "Close card"}</h2><p class="cl-t">${esc(it.title)}</p>${oa.length ? `<p class="cl-w">${zh ? `还有 ${oa.length} 个问题没答，会随卡一起关掉。` : `${oa.length} open question${oa.length > 1 ? "s" : ""} will close with it.`}</p>` : ""}
      <label>${zh ? "原因（可不填，会记进卡的动态）" : "Reason (optional, goes into the card's thread)"}</label><textarea></textarea>
      <div class="foot"><button class="btn" data-x>${t("cancel")}</button><button class="btn primary" data-ok>${zh ? "关单" : "Close"}</button></div>`, m => {
      const ta = $("textarea", m);
      const submit = async () => { const reason = ta.value.trim(); closeModal();
        if (reason) await api("comment", { item: id, text: (zh ? "关单原因：" : "Closed because: ") + reason });
        await api("done", { item: id, skip_asks: oa.length ? true : undefined });
        toast(zh ? "已关单" : "Closed"); };
      $("[data-ok]", m).onclick = submit; $("[data-x]", m).onclick = closeModal;
      ta.addEventListener("keydown", e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } });
      ta.focus();
    });
  }
  function modalReject() {
    const pre = $(".composer textarea") ? $(".composer textarea").value.trim() : "";
    openModal(`<h2>${t("reject_t")}</h2><label>${t("reject_reason")}</label><textarea>${esc(pre)}</textarea>
      <div class="foot"><button class="btn" data-x>${t("cancel")}</button><button class="btn primary danger" data-ok>${t("reject")}</button></div>`, m => {
      const ta = $("textarea", m);
      const submit = async () => { const reason = annWrap(ta.value.trim()), aid = UI.item; if (!reason) return ta.focus(); await api("reject", { item: UI.item, reason }); annClear(aid); DRAFT.set("item:" + aid, ""); closeModal(); if ($(".composer textarea")) $(".composer textarea").value = ""; if ($(".dr-tag")) $(".dr-tag").remove(); };
      $("[data-ok]", m).onclick = submit; $("[data-x]", m).onclick = closeModal;
      ta.addEventListener("keydown", e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } });
      ta.focus();
    });
  }
  // ---------- t-imp-p4: 系统状态 panel (replaces the old 体力 modal; desktop orb / SYNC row, phone orb / 菜单 row) ----------
  // Server-side facts come from /api/health (cached, not in /api/state). Before the server restart that adds it,
  // those rows are hidden and a one-line note says why.
  const HL = { data: null, at: 0, missing: false, busy: null };
  function loadHealth(maxAge = 0) {
    if (HL.busy) return HL.busy;
    if (maxAge && Date.now() - HL.at < maxAge) return null;   // fresh enough: nothing fetched (callers must not re-render then)
    HL.busy = fetch("/api/health").then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => { HL.data = d; HL.missing = false; }, () => { HL.data = null; HL.missing = true; })
      .finally(() => { HL.at = Date.now(); HL.busy = null; });
    return HL.busy;
  }
  const gb = n => n >= 1e12 ? (n / 1e12).toFixed(1) + " TB" : n >= 1e9 ? Math.round(n / 1e9) + " GB" : Math.round(n / 1e6) + " MB";
  function upTxt(sec) {
    const en = UI.lang === "en", d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
    if (en) return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
    return d ? `${d} 天 ${h} 小时` : h ? `${h} 小时 ${m} 分` : `${m} 分钟`;
  }
  // one row per system: {k, lv: ok|warn|bad|unk, t, s, act?}
  function statusRows() {
    const en = UI.lang === "en", U = usage(), H = HL.data, rows = [];
    // 1. usage data (the bars are drawn above the rows)
    rows.push({ k: "usage", t: en ? "Usage data" : "用量数据",
      lv: U.none ? "unk" : U.stale || U.lost5 ? "warn" : "ok",
      s: U.none ? (en ? "Not connected yet" : "还没接入")
        : (en ? `${hm(U.at)} · ${U.age}${U.stale ? " · may be out of date" : ""}` : `${hm(U.at)} 读取 · ${U.age}${U.stale ? " · 可能已过期" : ""}`) + ` · ${usageSrc(U.src)}`,
      act: U.none ? null : { k: "usage", l: en ? "Ask to refresh" : "叫管家刷新" } });
    // 2. manager heartbeat
    const m = mgrState(), ma = agent("manager");
    rows.push({ k: "mgr", t: en ? "Manager heartbeat" : "管家心跳", lv: m.on ? "ok" : m.sleep ? "warn" : "bad",
      s: (m.since ? `${m.txt} · ${en ? "last seen" : "最后心跳"} ${hm(m.since)}（${ageTxt(m.since)}）` : m.txt)
        + ` · ${en ? "inbox" : "信箱待处理"} ${ST.meta.inbox_unacked || 0}` + (ma.activity && m.on ? ` · ${ma.activity}` : "") });
    // 3. dashboard server (needs /api/health)
    if (H) {
      const sv = H.server;
      rows.push({ k: "srv", t: en ? "Dashboard server" : "看板服务器", lv: sv.loops ? "ok" : "warn",
        s: (en ? `up ${upTxt(sv.uptime)} · started ${hm(sv.started)}` : `已运行 ${upTxt(sv.uptime)} · ${hm(sv.started)} 启动`) + ` · rev ${sv.rev}` + (sv.loops ? "" : (en ? " · background loops off" : " · 后台循环未开（测试模式）")) });
    }
    // 4. ComfyUI tunnel (already in /api/state)
    const c = (H && H.comfy) || ST.meta.comfy || {};
    rows.push({ k: "comfy", t: "5090 · ComfyUI", lv: c.online ? "ok" : c.online === false ? "warn" : "unk",
      s: (c.online ? (en ? "Tunnel up" : "隧道已连") : c.online === false ? (en ? "Tunnel down · image jobs will wait" : "隧道未连 · 出图会排队") : (en ? "Not probed yet" : "还没探测"))
        + (c.at ? ` · ${en ? "checked" : "探测于"} ${ageTxt(c.at)}` : "") });
    // 5. push (needs /api/health; this device's own state comes from push.js)
    if (H) {
      const p = H.push, me = window.Push ? Push.status() : null, ok = p.last_code >= 200 && p.last_code < 300;
      rows.push({ k: "push", t: en ? "Push" : "推送",
        lv: !p.devices ? "warn" : p.failing ? "bad" : "ok",
        s: (p.devices ? (en ? `${p.devices} device${p.devices > 1 ? "s" : ""} subscribed` : `${p.devices} 台设备已订阅`) : (en ? "No device subscribed" : "没有设备订阅"))
          + (p.last_at ? ` · ${en ? "last send" : "上次发送"} ${hm(p.last_at)}（${ok ? (en ? "delivered" : "已送达推送服务") : `HTTP ${p.last_code}`}）` : "")
          + (p.failing ? (en ? ` · ${p.failing} failing` : ` · ${p.failing} 台失败`) : "")
          + (me && matchMedia("(max-width: 760px)").matches ? ` · ${en ? "this phone" : "本机"}：${me.label}` : "") });
    }
    // 6. daily report
    const today = dayKey(new Date()), rt = (H && H.report && H.report.time) || "18:00", last = ST.meta.last_report_date;
    const due = new Date(`${today}T${rt}`) <= new Date();
    rows.push({ k: "report", t: en ? "Daily report" : "日报",
      lv: last === today ? "ok" : due ? "warn" : "ok",
      s: last === today ? (en ? "Today's report is in" : "今天的已写好")
        : (en ? `Last: ${last || "never"} · today's ${due ? "is late (due " + rt + ")" : "due " + rt}` : `最近一份 ${last || "没有"} · 今天 ${rt} ${due ? "已到点，还没写" : "待写"}`) });
    // 7. disk (needs /api/health)
    if (H && H.disk) {
      const d = H.disk, pct = d.free / d.total;
      rows.push({ k: "disk", t: en ? "Disk" : "磁盘", lv: d.free < 10e9 || pct < .05 ? "bad" : d.free < 30e9 || pct < .1 ? "warn" : "ok",
        s: (en ? `${gb(d.free)} free of ${gb(d.total)}` : `剩 ${gb(d.free)} / 共 ${gb(d.total)}`) + (d.work != null ? ` · work/ ${gb(d.work)}` : "") });
    }
    return rows;
  }
  function statusSummary(rows) {
    const en = UI.lang === "en", w = rows.filter(r => r.lv === "warn").length, b = rows.filter(r => r.lv === "bad").length;
    if (!w && !b) return { lv: "ok", txt: en ? "All good" : "一切正常" };
    return { lv: b ? "bad" : "warn", txt: [w && (en ? `${w} to watch` : `${w} 项要留意`), b && (en ? `${b} down` : `${b} 项断开`)].filter(Boolean).join(" · ") };
  }
  function statusHTML() {
    const en = UI.lang === "en", U = usage(), rows = statusRows(), sm = statusSummary(rows);
    const bar = (label, v, sub, est) => `<div class="sy-u${v == null ? " nil" : ""}"><span>${label}</span><b>${v == null ? "—" : `${est ? `<i class="sy-est">${en ? "est" : "估"}</i>` : U.stale ? "≈" : ""}${v}<small>%</small>`}</b><div class="sy-bar"><i style="width:${v ?? 0}%"></i></div><em>${sub || ""}</em></div>`;
    const bars = U.none
      ? `<div class="sy-setup md"><p>${en ? "No usage yet. Make <code>tools/statusline.py</code> the manager's statusLine:" : "还没有用量数据。把 <code>tools/statusline.py</code> 配成管家 session 的 statusLine："}</p>
         <pre class="code"><code>{"statusLine": {"type": "command", "command": "python3 tools/statusline.py"}}</code></pre></div>`
      : `<div class="sy-use${U.stale ? " old" : ""}">`
        + bar(en ? "5-hour window" : "5 小时窗口", U.left, U.lost5 ? (en ? "Reset after the last reading · estimated near full until new data" : "上次读数之后已重置 · 估计接近回满，等新数据")
            : U.reset5 ? (en ? `used ${U.used5}% · full at ${U.at5}` : `已用 ${U.used5}% · ${U.at5} 复活`) : "", U.approx)
        + bar(en ? "This week" : "本周", U.week, U.lostW ? (en ? "Reset after the last reading · estimated near full" : "上次读数之后已重置 · 估计接近回满")
            : U.resetW ? (en ? `used ${U.usedW}% · resets ${U.atW}` : `已用 ${U.usedW}% · ${U.atW} 重置`) : "", U.approxW)
        + (U.context != null ? bar(en ? "Manager context" : "管家上下文", 100 - U.context, en ? "left before compaction" : "剩余上下文") : "")
        + (U.stale ? `<div class="sy-stale">${en ? `As of ${hm(U.at)} · ${U.age} · ${U.why}` : `${hm(U.at)} 的数据 · ${U.age} · ${U.why}`}</div>` : "")
        + `</div>`;
    const list = rows.map(r => `<div class="sy-row ${r.lv}"><i class="sy-dot"></i><div class="sy-m"><b>${esc(r.t)}</b><span>${esc(r.s)}</span></div>${r.act ? `<button type="button" class="sy-btn" data-sy="${r.act.k}">${esc(r.act.l)}</button>` : ""}</div>`).join("");
    const note = HL.missing ? `<p class="sy-note">${en ? "Server, push and disk rows appear after the dashboard server restarts (new /api/health)." : "看板服务器、推送、磁盘这几行，要等看板重启（新接口 /api/health）后才显示。"}</p>` : "";
    return `<div class="sy-hd"><h3>${en ? "System status" : "系统状态"}</h3><span class="sy-sum ${sm.lv}">${sm.txt}</span><button type="button" class="sy-x" data-x aria-label="${en ? "Close" : "关闭"}">${en ? "Done" : "完成"}</button></div>`
      + bars + `<div class="sy-ru"><h4>${en ? "Usage by role · today" : "各角色用量 · 今天"}</h4>${ruHTML(99, { tot: true })}</div>` + `<div class="gt" id="gt"></div>` + `<div class="sy-list">${list}</div>` + note;   // t-dash-token: #gt is filled by ghPaint() and survives repaints
  }
  function modalStatus() {
    openModal(statusHTML(), m => {
      m.classList.remove("frame"); m.classList.add("sys");
      const paint = () => { if (!m.isConnected) return; const h = statusHTML(); if (m._html === h) return; const st = m.scrollTop, g = $("#gt", m); m.innerHTML = m._html = h; if (g) $("#gt", m).replaceWith(g); m.scrollTop = st; };   // t-dash-token: keep the #gt node (a half-typed token)
      m.addEventListener("click", e => {
        if (e.target.closest("[data-x]")) return closeModal();
        const b = e.target.closest("[data-sy]"); if (!b) return;
        if (b.dataset.sy === "usage") { b.disabled = true; api("ping", { note: UI.lang === "en" ? "refresh usage" : "刷新用量" }).then(() => toast(UI.lang === "en" ? "Asked the manager to refresh usage" : "已请管家刷新用量")); }
      });
      loadHealth().then(paint);
      ghPaint(); ghLoad().then(ghPaint);
      const tick = setInterval(() => { if (!m.isConnected) return clearInterval(tick); loadHealth().then(paint); }, 15000);
      m._paint = paint;
    });
  }
  hooks.push(k => { if (k !== "all") return; const m = $("#modal .mdl.sys"); if (m && m._paint) m._paint(); });

  // ===== t-dash-token: GitHub push token block in 系统状态 (desktop; the phone opens it from 设置 and ⌘K too).
  // The page sends the token once (POST /api/secret/github, own header X-Underthread) and never gets it back: the API returns status only.
  // The block is a node of its own (#gt) that modalStatus's 15 s repaint keeps, so a half-typed token is never wiped. =====
  const GT = { st: null, old: false, busy: false, msg: "", lv: "", replace: false, confirmFile: false, loading: null };
  async function ghLoad() {
    if (GT.loading) return GT.loading;
    GT.loading = (async () => {
      try { const r = await fetch("/api/secret/github", { cache: "no-store" }); if (r.status === 404) GT.old = true; else if (r.ok) { GT.st = await r.json(); GT.old = false; } } catch (_) { }
      GT.loading = null;
    })();
    return GT.loading;
  }
  async function ghApi(op, extra) {
    try {
      const r = await fetch("/api/secret/github", { method: "POST", headers: { "Content-Type": "application/json", "X-Underthread": "1" }, body: JSON.stringify({ op, ...(extra || {}) }) });
      if (r.status === 404) { GT.old = true; return { ok: false, j: {} }; }
      let j = {}; try { j = await r.json(); } catch (_) { }
      if (j.status) GT.st = j.status;
      return { ok: r.ok && j.ok !== false, j };
    } catch (_) { return { ok: false, j: { error: UI.lang === "en" ? "Dashboard server unreachable" : "连不上看板服务器" } }; }
  }
  const ghWhen = s => { if (!s) return ""; const d = new Date(String(s).replace(" UTC", "Z").replace(" ", "T")); return isNaN(d) ? "" : `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const ghWhenT = s => { if (!s) return ""; const d = new Date(s); return isNaN(d) ? "" : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  function ghSoon(S) { if (!S || !S.expires) return false; const d = new Date(String(S.expires).replace(" UTC", "Z").replace(" ", "T")); return !isNaN(d) && d - Date.now() < 7 * 864e5; }
  function ghLabel() {
    const en = UI.lang === "en", S = GT.st;
    if (!S && !GT.old) { ghLoad().then(() => document.dispatchEvent(new Event("gh:status"))); return "…"; }
    if (GT.old) return en ? "Needs a dashboard restart" : "看板重启后可用";
    if (!S.configured) return en ? "Not set" : "未配置";
    return (S.ok === false ? (en ? "Set · not working" : "已配置 · 失效") : ghSoon(S) ? (en ? "Set · expires soon" : "已配置 · 快到期") : (en ? "Set" : "已配置")) + (S.method === "file" ? (en ? " · local file" : " · 本机文件") : "");
  }
  function ghProbeLine(pr) {
    if (!pr) return "";
    const t = ghWhenT(pr.at), code = pr.code ? `（${pr.code}）` : "";
    if (pr.verdict === "ok") return `<p class="gt-pr ok">● 钥匙串可用：看板服务器能写、能读、能删（${t} 检测）</p>`;
    if (pr.verdict === "locked") return `<p class="gt-pr bad">● 钥匙串锁着${code}：看板服务器在后台，存不进去。办法：在 Mac 上打开「钥匙串访问」，把「登录」钥匙串的密码改成和开机密码一样，再点一次检测；或者改用本机文件。（${t} 检测）</p>`;
    if (pr.verdict === "nohelper") return `<p class="gt-pr bad">● 找不到 git 的钥匙串助手（git-credential-osxkeychain）（${t} 检测）</p>`;
    return `<p class="gt-pr bad">● 钥匙串测试没通过${code}：写 ${pr.write ? "✓" : "✗"} · 读 ${pr.read ? "✓" : "✗"} · 删 ${pr.erase ? "✓" : "✗"}（${t} 检测）</p>`;
  }
  function ghHTML() {
    const en = UI.lang === "en", S = GT.st, B = (k, l, c) => `<button type="button" class="gt-b ${c || ""}" data-gt="${k}"${GT.busy ? " disabled" : ""}>${l}</button>`;
    const head = (tag, cls) => `<h4>${en ? "GitHub push token" : "GitHub 推送令牌"} <em class="${cls || ""}">${tag}</em></h4>`;
    if (GT.old) return head("要重启", "warn") + `<p>看板服务器重启以后才能用（新接口还没加载）。</p>`;
    if (!S) return head("…") + `<p>读取中…</p>`;
    const file = S.method === "file", repo = esc(S.repo || "owner/underthread"), pr = S.probe;
    const msg = GT.msg ? `<p class="gt-msg ${GT.lv}">${esc(GT.msg)}</p>` : "";
    const where = file ? "本机文件（明文，600）" : "钥匙串";
    if (GT.confirmFile) return head("改用本机文件？", "warn")
      + `<p>令牌会明文存在 <code>~/.config/underthread/git-credentials</code>，权限 600，只有你的账号能读；但以你的身份运行的任何程序也都能读到。只对 github.com 生效，git 的全局配置里会加两行。</p>`
      + `<div class="gt-r">${B("file_yes", "确定改用本机文件", "pri")}${B("file_no", "算了")}</div>`;
    if (!S.configured || GT.replace) {
      const offer = pr && pr.verdict !== "ok" && !file ? B("file", "改用本机文件…") : "";
      return head(S.configured ? "换一个" : "未配置")
        + `<p>配好以后，管家推送 ${repo} 不用你再输令牌。令牌只存在这台 Mac 上（${file ? "本机文件" : "钥匙串"}），看板和手机都拿不回来。</p>`
        + (file ? "" : ghProbeLine(pr))
        + `<div class="gt-r"><input type="password" class="gt-in" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="粘贴 github_pat_…（只用一次）" aria-label="GitHub 令牌"${GT.busy ? " disabled" : ""}>${B("set", GT.busy ? "验证中…" : "保存并验证", "pri")}</div>`
        + `<div class="gt-r">${file ? B("keychain", "改回钥匙串") : B("probe", pr ? "再检测一次" : "检测钥匙串")}${offer}${GT.replace ? B("cancel", "取消") : ""}</div>`
        + msg + `<small>建议：细粒度令牌，只勾 ${repo} 的 Contents 读写，90 天到期</small>`;
    }
    const st = S.ok === true ? `<span class="ok">● 可用</span>` : S.ok === false ? `<span class="bad">● 失效${S.note ? "：" + esc(S.note) : ""}</span>` : `<span class="warn">● 没验证${S.note ? "：" + esc(S.note) : ""}</span>`;
    const bits = [st, S.user ? `账号 ${esc(S.user)}` : "", `存在${where}`, S.set_at ? `${ghWhenT(S.set_at)} 配置` : "", S.expires ? `${ghWhen(S.expires)} 到期` : ""].filter(Boolean).join(" · ");
    return head("已配置", S.ok === false ? "bad" : ghSoon(S) ? "warn" : "ok") + `<p>${bits}</p>` + (file ? "" : ghProbeLine(pr))
      + `<div class="gt-r">${B("replace", "换一个")}${B("test", "测试推送权限")}${file ? B("keychain", "改回钥匙串") : B("probe", "检测钥匙串")}${B("erase", "删除", "dn")}</div>` + msg;
  }
  function ghPaint() { const el = $("#modal #gt"); if (el) el.innerHTML = ghHTML(); document.dispatchEvent(new Event("gh:status")); }   // the phone 设置 row re-reads its label
  async function ghDo(k, el) {
    const say = (m, lv) => { GT.msg = m || ""; GT.lv = lv || ""; };
    if (k === "cancel") { GT.replace = false; say(""); return ghPaint(); }
    if (k === "replace") { GT.replace = true; say(""); ghPaint(); const i = $("#modal #gt .gt-in"); if (i) i.focus(); return; }
    if (k === "file") { GT.confirmFile = true; return ghPaint(); }
    if (k === "file_no") { GT.confirmFile = false; return ghPaint(); }
    if (k === "erase" && !confirm("删除存好的 GitHub 令牌？之后推送又要你输令牌。")) return;
    let tok = null;
    if (k === "set") {
      const i = el.closest("#gt").querySelector(".gt-in"); tok = i ? i.value.trim() : ""; if (i) i.value = "";
      if (!tok) { say("先把令牌粘贴进框里", "bad"); return ghPaint(); }
    }
    GT.busy = true; say(""); ghPaint();
    const op = k === "file_yes" ? "use_file" : k === "keychain" ? "use_keychain" : k;
    const r = await ghApi(op, k === "set" ? { token: tok } : k === "file_yes" ? { confirm: true } : null);
    tok = null; GT.busy = false;
    if (k === "file_yes") GT.confirmFile = false;
    if (r.ok) {
      if (k === "set") { GT.replace = false; say(GT.st && GT.st.ok === false ? "存好了，但 GitHub 说：" + (GT.st.note || "不能推送") : "存好了，管家以后推送不用你再输令牌", GT.st && GT.st.ok === false ? "bad" : "ok"); }
      else if (k === "probe") say("");
      else if (k === "test") say(GT.st && GT.st.ok ? "能推送 ✓" : "不能推送：" + ((GT.st && GT.st.note) || ""), GT.st && GT.st.ok ? "ok" : "bad");
      else if (k === "erase") say("删掉了", "ok");
      else if (k === "file_yes") say("改用本机文件了，把令牌粘贴进来保存", "");
      else if (k === "keychain") say("改回钥匙串了，本机文件已删除；把令牌重新粘贴进来", "");
    } else say((r.j && r.j.error) || "没成功", "bad");
    if (!r.j || !r.j.status) await ghLoad();
    ghPaint();
  }
  document.addEventListener("click", e => { const b = e.target.closest("#modal #gt [data-gt]"); if (b && !b.disabled) { e.preventDefault(); ghDo(b.dataset.gt, b); } });
  document.addEventListener("keydown", e => { if (e.key === "Enter" && !e.isComposing && e.target.closest && e.target.closest("#modal #gt .gt-in")) { e.preventDefault(); const b = $("#modal #gt [data-gt=set]"); if (b && !b.disabled) ghDo("set", b); } });
  function ghOpen() { modalStatus(); setTimeout(() => { const g = $("#modal #gt"); if (g) g.scrollIntoView({ block: "center", behavior: "smooth" }); }, 250); }


  // ===== t-new-ver: the page keeps running the JS/CSS it loaded; after a web/ release (?v bump in index.html) it says so with a pill.
  // Checks when the page comes back to the foreground and every 5 min while visible; never reloads on its own (drafts survive anyway). =====
  const VER = { mine: "", t: 0, shown: false };
  const verSig = html => (String(html).match(/\/static\/[\w.-]+\.(?:js|css)\?v=[\w.]+/g) || []).sort().join(" ");
  const verMine = () => VER.mine || (VER.mine = verSig([...document.querySelectorAll("script[src],link[rel=stylesheet][href]")].map(e => e.getAttribute("src") || e.getAttribute("href")).join(" ")));   // read after load: the scripts below app.js are not parsed yet when it runs
  async function verCheck(force) {
    if (document.readyState !== "complete") return;
    if (VER.shown || !verMine() || document.visibilityState !== "visible" || (!force && Date.now() - VER.t < 60e3)) return;
    VER.t = Date.now();
    try { const r = await fetch("/", { cache: "no-store" }); if (!r.ok) return; const sig = verSig(await r.text()); if (sig && sig !== VER.mine) verShow(); } catch (_) { }
  }
  function verShow() {
    if (VER.shown) return; VER.shown = true; const en = UI.lang === "en";
    const b = document.createElement("button"); b.type = "button"; b.id = "newver";
    b.innerHTML = `<i aria-hidden="true"></i>${en ? "Dashboard updated" : "看板更新了"}<b>${en ? "Tap to reload" : "点一下刷新"}</b>`;
    b.addEventListener("click", () => location.reload()); document.body.appendChild(b);
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") verCheck(); });
  setInterval(() => verCheck(true), 5 * 60e3);

  // t-id-copy: clipboard API where the page is a secure context (127.0.0.1); the phone over plain-http Tailscale has no navigator.clipboard,
  // so fall back to a hidden textarea + execCommand("copy"), which iOS allows inside a tap.
  function copyText(s) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(s).then(() => true, () => copyOld(s));
    return Promise.resolve(copyOld(s));
  }
  function copyOld(s) {
    const ta = document.createElement("textarea"); ta.value = s; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px";
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, s.length); let ok = false; try { ok = document.execCommand("copy"); } catch (_) { } ta.remove(); return ok;
  }

  // ===== t-lib-attach: 「附到回复…」 from the phone viewer. The sheet offers the current DM partner, the last card opened, and the other team members;
  // picking one opens that thread / card and puts the file in its pending attachments (the same path, nothing uploaded). =====
  const ATT = { lastCard: null };
  function attachTo(dest, p) {
    if (dest.dm) { route("#dm=" + encodeURIComponent(dest.dm)); attachPath(chatAtt, p); return; }
    route("#item=" + encodeURIComponent(dest.item));
    let n = 0; const put = () => { if (UI.item === dest.item && $("#drawer .composer textarea")) attachPath(drawerAtt, p); else if (++n < 20) setTimeout(put, 150); };   // the drawer may load the full card first
    setTimeout(put, 120);
  }
  function attachPick(p) {
    const en = UI.lang === "en", old = $("#att-pick"); if (old) old.remove();
    const me = agent(UI.chat) || agent("manager"), card = ATT.lastCard && (ST.items || []).find(i => i.id === ATT.lastCard);
    const rest = agents().filter(a => a.enabled !== false && a.id !== (me && me.id));
    const row = (k, v, lead, txt, sub) => `<button type="button" class="ap-row" data-ap-${k}="${esc(v)}"><small>${lead}</small><span>${esc(txt)}</span>${sub ? `<em>${sub}</em>` : ""}</button>`;
    const el = document.createElement("div"); el.id = "att-pick";
    el.innerHTML = `<div class="ap-scrim" data-ap-x></div><div class="ap-sheet" role="dialog" aria-label="${en ? "Attach to" : "附到哪里"}"><b class="ap-h">${en ? "Attach to" : "附到哪里"}</b>
      ${me ? row("dm", me.id, en ? "Chat" : "对话", (en ? "To " : "对") + aname(me) + (en ? "" : "说"), en ? "current chat" : "最近的对话") : ""}
      ${card ? row("item", card.id, en ? "Card" : "卡片", card.title || card.id, en ? "last opened" : "刚才看的卡") : ""}
      <button type="button" class="ap-row ap-more" data-ap-more><span>${en ? "Someone else…" : "发给别人…"}</span></button>
      <div class="ap-others" hidden>${rest.map(a => row("dm", a.id, en ? "Chat" : "对话", aname(a))).join("")}</div>
      <button type="button" class="ap-row ap-cancel" data-ap-x><span>${en ? "Cancel" : "取消"}</span></button></div>`;
    document.body.appendChild(el);
    el.addEventListener("click", e => {
      if (e.target.closest("[data-ap-more]")) { $(".ap-others", el).hidden = false; $(".ap-more", el).hidden = true; return; }
      const d = e.target.closest("[data-ap-dm]"), c = e.target.closest("[data-ap-item]");
      if (d || c || e.target.closest("[data-ap-x]")) el.remove();
      if (d) attachTo({ dm: d.dataset.apDm }, p); else if (c) attachTo({ item: c.dataset.apItem }, p);
    });
  }

  // ---------- API for the mobile layer (mobile.js) ----------
  window.App = {
    okLabel, okDone, askLeft, openAsks: it => openAsks(it),   // t-btn-names
    rvApprove: id => rvApprove(id, null), rvCanApprove: it => rvCanApprove(it), awaitsUser: it => awaitsUser(it), busy: it => busy(it), onYou: it => onYou(it), onYouCard: it => onYouCard(it), grpOf: it => grpOf(it), newReplies: () => newReplies(), decisions: () => decisions(),   // t-imp-p5 (palette)
    /* t-chrome-badge (home.js .hd-tool) */
    toolLine: w => toolLine(w), toolBadge: a => toolBadge(a), toolWhat: a => toolWhat(a),
    UI, get ST() { return ST; }, roll, modalStatus: () => modalStatus(), ghOpen: () => ghOpen(), ghLabel: () => ghLabel(), statusSummary: () => statusSummary(statusRows()), loadHealth: a => loadHealth(a), refreshPage: () => renderPage(), phaseFree, pixelOpen, avatarUrl, t, items, agent, aname, atitle, av, when, whenH, agoH, ago, byAct, PLAT, stageLabel,
    refresh: async () => { await poll(true); return !UI.down; },   // t-m2-c ④ pull-to-refresh: a forced full fetch; false = the server did not answer
    tablePv: s => tablePv(s),   // t-chat-table (mobile.js chat list preview)
    verCheck: () => verCheck(true), attachPick: p => attachPick(p),   // t-lib-attach (viewer.js)   // t-new-ver (tests)
    setHome: v => setHome(v), homeStyle: () => UI.home, queueOf: id => queueOf(id), qBadge: (id, small) => qBadge(id, small),   /* t-agent-queue */ seenOf: id => seenOf(id), unreadOf: id => unreadOf(id),   /* t-ri1104-p2 */ chatMailRead: (id, t) => chatMailRead(id, t),   /* r-improve-1102 P3 (was swallowed by a // comment until 11-04) */   /* t-home-applike (palette) */
    draft: k => DRAFT.get(k), liveItem: a => liveItem(a), mgrOnline: a => mgrOnline(a), typingOn: (a, l) => typingOn(a, l), typingUntil: l => typingUntil(l),   // t-now-closed (home.js hero, office.js bubble)   // t-draft-keep (mobile.js chat list marks [草稿])
    go: p => go(p), openItem: id => openItem(id), seekItem: (id, sp) => seekItem(id, sp), seekChat: (t, q) => seekChat(t, q),   /* t-ri1103-p5 */ closeItem: () => closeItem(), backItem: () => backItem(), setChat: id => setChat(id), api: (k, b) => api(k, b), toast: (m, e) => toast(m, e),
    rejectItem(id) { openItem(id); modalReject(); }, on: fn => hooks.push(fn), inkEb, route: (P, via) => route(P, via),
    snoozed: it => snoozed(it), snzMenu: (id, anchor, done) => snzMenu(id, anchor, done), snzLine: () => snzLine(), snzText: it => snzText(it),   /* ri1103-P2 */
    usage: () => usage(), roleUsage: () => roleUsage(), ruHTML: (n, o) => ruHTML(n, o), fmtTok,   /* t-home-usage */
    themeMode: () => themeMode(), setTab: k => setTab(k),   /* t-settings-tab */
    archAll: () => archAll(), archList: () => ARCH.all, archIx: () => archIx(),   /* t-perf A (palette.js search) */
  };

  // ---------- t-push-deeplink: one router for "go to this target" (cold-start hash, or a tapped notification while the app is open) ----------
  // P: URLSearchParams with item= | dm=<agent> | rep=<report id> | page=<page>, plus mail=<ids> (mark read) and push=<id> (a notification tap: route once, then drop the hash).
  const routed = new Set();
  function route(P, via) {
    if (typeof P === "string") P = new URLSearchParams(P.replace(/^[^#]*#?/, ""));
    const pid = P.get("push");
    if (pid) {
      if (routed.has(pid)) return "dup";
      routed.add(pid);
      if (/[#&](push|mail)=/.test(location.hash)) { try { history.replaceState(history.state, "", location.pathname + location.search); } catch (_) { } }
      if (P.get("mail")) api("mail_read", { ids: P.get("mail").split(",") }).catch(() => { });
    }
    const item = P.get("item"), dm = P.get("dm"), rep = P.get("rep"), page = P.get("page");
    const kind = item ? "item" : dm ? "dm" : rep ? "rep" : page ? "page" : "";
    if (!kind) return "none";
    if (dm && !(ST && ST.agents && ST.agents[dm])) return "no-agent";
    if (item && !(ST.items || []).some(i => i.id === item) && !archKnown(item)) return "no-item";   // t-perf A: an archived card opens via /api/item
    if (MB.open) closeMailbox();
    if (rep) UI.openRep = rep;
    if (PHONE.matches && window.MRoute) { MRoute({ item, dm, page: rep ? "reports" : pid ? page : null }); return kind; }
    if ($("#modal") && !$("#modal").hidden) closeModal();
    if (dm) { closeItem(true); setChat(dm); }
    else if (rep || (page && pid)) go(rep ? "reports" : page);   // a plain #page= is already applied at boot; only a push re-applies it
    if (item) openItem(item);
    return kind;
  }

  // ---------- boot ----------
  // deep links: #page=board  #item=<id>  #theme=light  #lang=en
  const H = new URLSearchParams(location.hash.slice(1));
  if (H.get("page")) UI.page = pageAlias(H.get("page"));
  if (H.get("tab") && SET_TABS.includes(H.get("tab"))) UI.setTab = H.get("tab");   // t-settings-tab: #page=settings&tab=system
  if (H.get("theme")) UI.theme = H.get("theme");
  if (H.get("home")) UI.home = ["classic", "app", "widgets"].includes(H.get("home")) ? H.get("home") : "dense";   // t-home-applike: #home=classic / #home=app, this load only
  if (H.get("lang")) UI.lang = H.get("lang");
  if (H.get("fold")) UI.chatFold = H.get("fold") === "1";
  document.documentElement.dataset.theme = UI.theme;
  // t-visual-ink: empty-state line art slot (--es-<key> + html.es-art). The open-source build ships no art, so the empty states stay typographic.
  poll(true).then(() => {
    window.FX && FX.enter($("#pagebody"));
    if (H.get("item") || H.get("dm") || H.get("rep") || H.get("push")) { const r = route(H, "cold"); document.dispatchEvent(new CustomEvent("rt:routed", { detail: { via: "cold", result: r, push: H.get("push") } })); }
  });
  /* t-power-save: a hidden tab polls every 30 s instead of 2.5 s, and refreshes once the moment it is visible again */
  let pollAt = Date.now();
  setInterval(() => { if (document.hidden && Date.now() - pollAt < 30000) return; pollAt = Date.now(); poll(); }, 2500);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { pollAt = Date.now(); poll(); } });
  setInterval(() => { if (ST) { renderLeft(); renderTool(); } document.querySelectorAll(".m-typing[data-until]").forEach(b => { if (b.dataset.until && Date.now() > +b.dataset.until) b.remove(); }); }, 60000);   // t-typing-fix: stale typing dots go even without a poll change
})();

/* ===== ui4: segmented switch (.seg) — sliding indicator for filters. Pure presentation: finds .seg containers after any render,
   measures the .on item and slides an <i.seg-ind> from where the previous render left it. No filtering logic touched. ===== */
(() => {
  const POS = {}, reduce = matchMedia("(prefers-reduced-motion: reduce)");
  function sync(seg, force) {
    const on = seg.querySelector(".seg-i.on"), key = seg.dataset.seg || "";
    let ind = seg.querySelector(".seg-ind");
    if (!ind) { ind = document.createElement("i"); ind.className = "seg-ind"; ind.setAttribute("aria-hidden", "true"); seg.prepend(ind); }
    if (!on || !on.offsetWidth) { ind.style.opacity = 0; return false; }
    const x = on.offsetLeft, w = on.offsetWidth, prev = POS[key];
    const set = (px, pw) => { ind.style.width = pw + "px"; ind.style.transform = `translateX(${px}px)`; };
    ind.style.opacity = 1;
    if (prev && !force && !reduce.matches && (prev.x !== x || prev.w !== w)) {
      ind.style.transition = "none"; set(prev.x, prev.w); void ind.offsetWidth; ind.style.transition = ""; set(x, w);
    } else { ind.style.transition = "none"; set(x, w); void ind.offsetWidth; ind.style.transition = ""; }
    POS[key] = { x, w };
    // keep the selected item in view when the track scrolls (phone / narrow dropdown)
    if (seg.scrollWidth > seg.clientWidth + 1) {
      const target = Math.max(0, x + w / 2 - seg.clientWidth / 2);
      seg.scrollTo({ left: target, behavior: prev && !reduce.matches ? "smooth" : "auto" });
    }
    return true;
  }
  let q = 0;
  function run(force) { cancelAnimationFrame(q); q = requestAnimationFrame(() => document.querySelectorAll(".seg").forEach(s => { if (force || !s._ui4 || s._ui4 !== s.querySelector(".seg-i.on")) { if (sync(s, force)) s._ui4 = s.querySelector(".seg-i.on"); } })); }
  new MutationObserver(() => run(false)).observe(document.body, { childList: true, subtree: true });
  addEventListener("resize", () => run(true));
  document.fonts && document.fonts.ready.then(() => run(true));
  run(false);
})();
