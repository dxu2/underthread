// Dashboard core: the zh / en strings (T, t), category / stage / platform labels, dates in words (when, ago) and the server-text translators
// (srvT, srvLocal, titleEn ...).
// t-oss-struct S10 (A2): moved out of app.js unchanged.


// ---------- i18n ----------
import { ST, UI, busy, grpOf, idleDoing, idleL, pauseL, snoozed } from "./store.js";
import { agent, aname } from "./av.js";
import { routineOf, snzText } from "../views/drawer.js";
import { render } from "../app.js";
const T = {
  zh: { quests: "委托", all_quests: "全部", search_ph: "搜索条目和对话",
    review: "首页", main: "主线",   // t-nav-home: display name only (the page key stays "review")
    side: "支线", daily: "杂活", urgent: "紧急活动", ongoing: "定时",
    pipe: "制作线", board: "委托板", logs: "日志", reports: "报告", channels: "频道", studio: "制作", market: "招聘市场", crew: "团队", docs: "文档", assets: "素材", roles: "角色", mail: "信箱",
    today: "今日日程", meetings: "个", team: "TEAM", stamina: "体力", updated: "更新于",
    todo: "待办", doing: "进行中", review_s: "待你审核", waiting: "等别人", done: "完成",
    plan: "待拍板", deliverable: "待验收", question: "待回答", task: "任务",
    approve: "批准", reject: "驳回", complete: "完成", reopen: "重开", archive: "归档",
    owner: "负责", category: "分类", stage: "阶段", platforms: "平台", due: "截止",
    draft: "草稿", confidence: "把握度", evidence: "证据", links: "链接", attachments: "附件", thread: "动态", older: "较早版本",
    copy: "复制", copied: "已复制", send_hint: "⌘/Ctrl+Enter 发送，Enter 换行",
    composer_ph: "回复，@ 指定谁，写驳回原因",   /* t-ri1111-a P2: one line (the long hint was cut in the 44px box); drop/paste lives in the attach button title */
    chat_ph: "对{n}说……  ⌘/Ctrl+Enter 发送，Enter 换行",
    file: "文件", default_owner: "默认：负责人",
    send_to: "发给", jump_top: "顶部", jump_new: "最新", expand: "展开全文", collapse: "收起", owner_tag: "负责人",
    k_plan: "方案", k_deliverable: "交付", k_question: "提问", k_task: "草稿",
    online: "在线", offline: "离线", working: "执行中", idle: "待机",
    by_activity: "按最新动态", by_created: "最新创建", pending: "待审核",
    empty_review: "没有等你审核的东西。去喝杯水。", empty_ok: "没有等你拍板的 · 去喝杯水", empty: "这里是空的。", empty_mail: "没有新动态", mail_thread: "{n} 条",
    wake: "唤醒管家", refresh_usage: "刷新用量", settings: "设置", write_report: "日报", report_req: "现在就要一份", report_next: "今天的日报 {t} 自动出", report_asked: "已告诉管家，写好就出现在这页", theme: "主题",
    cancel: "取消",
    reject_t: "驳回", reject_reason: "原因（会被整理成规则提议）",
    lessons: "规则提议", adopt: "采纳", drop: "丢弃", dm: "私信",
    closed: "已完成", first_pass: "一次通过", adopted: "已采纳规则",
    all: "全部", unread: "未读", replies: "回复", updates: "更新", mark_all: "全部已读",
    week_done: "近 7 天交付", in_review: "待审核", in_progress: "进行中", pending_rules: "待采纳规则",
    days7: "7 天前", now: "现在", add: "添加",
    mgr_offline: "管家还没上线：你的 {n} 条话在排队，它一上线就先处理。管家聊天里有启动命令。",
    sleeping: "休眠", sleep_at: "休眠 · {t} 复活", waking: "复活中",
    mgr_sleep: "管家休眠中，{t} 复活。{n} 条指令已排队，醒来自动处理。",
    mgr_waking: "用量已重置，正在唤醒管家；几分钟内没回应就到管家的 session 里说一句话。",
    waiting_long: "「{t}」已经等你审核超过 24 小时",
    no_owner_urgent: "紧急：「{t}」还没有人接",
    next: "NEXT", sync: "SYNC", inbox: "INBOX",
    no_next: "没有日程", tomorrow: "明天", today_w: "今天", yesterday: "昨天",
    ago_m: "{n} 分钟前", ago_h: "{n} 小时前", just: "刚刚",
    unacked: "待处理", reports_empty: "还没有日报。每天 {t} 管家会自动写一份。",
    docs_pick: "选一个文档", ch_none: "未标平台",
  },
  en: { quests: "Quests", all_quests: "All", search_ph: "Search items and chats",
    review: "Home", main: "Main quest", side: "Side quest", daily: "Errands", urgent: "Urgent", ongoing: "Schedules",
    pipe: "Pipeline", board: "Board", logs: "Log", reports: "Reports", channels: "Channels", studio: "Studio", market: "Hiring", crew: "Team", docs: "Docs", assets: "Assets", roles: "Roster", mail: "Mailbox",
    today: "Today", meetings: "", team: "TEAM", stamina: "Stamina", updated: "updated",
    todo: "To do", doing: "In progress", review_s: "Your review", waiting: "Waiting", done: "Done",
    plan: "Decide", deliverable: "To accept", question: "Answer", task: "Task",
    approve: "Approve", reject: "Reject", complete: "Done", reopen: "Reopen", archive: "Archive",
    owner: "Owner", category: "Category", stage: "Stage", platforms: "Platforms", due: "Due",
    draft: "Draft", confidence: "Confidence", evidence: "Evidence", links: "Links", attachments: "Files", thread: "Thread", older: "Older drafts",
    copy: "Copy", copied: "Copied", send_hint: "⌘/Ctrl+Enter to send",
    composer_ph: "Reply, @someone, or why not…",   /* t-ri1111-a P2 */
    chat_ph: "Message {n}…  ⌘/Ctrl+Enter to send",
    file: "File", default_owner: "default: owner",
    send_to: "To", jump_top: "Top", jump_new: "Latest", expand: "Show all", collapse: "Collapse", owner_tag: "owner",
    k_plan: "Plan", k_deliverable: "Deliverable", k_question: "Question", k_task: "Draft",
    online: "online", offline: "offline", working: "working", idle: "idle",
    by_activity: "Latest activity", by_created: "Newest", pending: "Pending",
    empty_review: "Nothing waiting on you.", empty_ok: "Nothing waiting on you", empty: "Nothing here.", empty_mail: "Nothing new", mail_thread: "{n}",
    wake: "Ping manager", refresh_usage: "Refresh usage", settings: "Settings", write_report: "Report", report_req: "Get one now", report_next: "Today's report comes by itself at {t}", report_asked: "Told the manager; it shows up on this page when written", theme: "Theme",
    cancel: "Cancel",
    reject_t: "Reject", reject_reason: "Reason (becomes a rule proposal)",
    lessons: "Rule proposals", adopt: "Adopt", drop: "Drop", dm: "DM",
    closed: "closed", first_pass: "first-pass", adopted: "rules adopted",
    all: "All", unread: "Unread", replies: "Replies", updates: "Updates", mark_all: "Mark all read",
    week_done: "Shipped · 7 days", in_review: "In review", in_progress: "In progress", pending_rules: "Pending rules",
    days7: "7d ago", now: "now", add: "Add",
    mgr_offline: "The steward is not online: {n} of your messages are queued and get read first when it starts. The steward chat has the command.",
    sleeping: "asleep", sleep_at: "asleep · back {t}", waking: "waking",
    mgr_sleep: "Manager asleep until {t}. {n} instructions queued; handled on wake.",
    mgr_waking: "Usage has reset; waking the manager. No reply in a few minutes? Send any message in its session.",
    waiting_long: "\"{t}\" has waited on your review for 24h+",
    no_owner_urgent: "Urgent: \"{t}\" has no owner yet",
    next: "NEXT", sync: "SYNC", inbox: "INBOX",
    no_next: "no events", tomorrow: "Tomorrow", today_w: "Today", yesterday: "Yesterday",
    ago_m: "{n}m ago", ago_h: "{n}h ago", just: "just now",
    unacked: "pending", reports_empty: "No reports yet. The manager writes one daily at {t}.",
    docs_pick: "Pick a doc", ch_none: "No platform",
  },
};
const t = (k, vars) => { let s = (T[UI.lang] && T[UI.lang][k]) ?? T.zh[k] ?? (window.UTExt && UTExt.label(k, UI.lang)) ?? k;   /* S8: a registered card kind (web/ext.js) */ for (const [a, b] of Object.entries(vars || {})) s = s.replace("{" + a + "}", b); return s; };
const EN_SUB = { settings: "SETTINGS", review: "HOME", main: "MAIN QUEST", side: "SIDE QUEST", daily: "DAILY COMMISSIONS", urgent: "URGENT EVENTS",
  ongoing: "SCHEDULES", studio: "STUDIO", market: "HIRING MARKET", crew: "TEAM", pipe: "PRODUCTION LINE", board: "COMMISSION BOARD", logs: "JOURNAL", reports: "REPORTS", channels: "CHANNELS", docs: "ARCHIVE", assets: "ASSET LIBRARY", roles: "ROSTER", mail: "MAILBOX" };
const CATS = ["main", "side", "daily", "urgent", "ongoing"];
const STAGES = ["todo", "doing", "review", "waiting", "done"];
const PLAT_ZH = { bili: "B站", yt: "YouTube", xhs: "小红书" }, PLAT_EN = { bili: "Bilibili", yt: "YouTube", xhs: "RedNote" };
const PLAT = new Proxy({}, {  // platform names follow the UI language
  get: (_, k) => (UI.lang === "en" ? PLAT_EN : PLAT_ZH)[k],
  ownKeys: () => Object.keys(PLAT_ZH), getOwnPropertyDescriptor: (_, k) => ({ enumerable: true, configurable: true, value: (UI.lang === "en" ? PLAT_EN : PLAT_ZH)[k] }),
});
const stageLabel = s => t(s === "review" ? "review_s" : s);
// t-routine-btn: a routine's main card says 「暂停」 only when the routine is really paused; running, idle between runs, it says 每天 HH:MM
const rtTag = i => { const r = i && i.stage !== "done" && !busy(i) && routineOf(i); return !r ? null : r.paused ? pauseL() : r.time ? (UI.lang === "en" ? `Daily ${r.time}` : `每天 ${r.time}`) : null; };
const rowLabel = i => rtTag(i) || (snoozed(i) ? (UI.lang === "en" ? "Later · " : "稍后 · ") + snzText(i) : idleDoing(i) ? idleL(i) : grpLabel(grpOf(i)));
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
const whoName = w => w === "me" ? (ST.meta.owner && !ST.meta.owner.startsWith("<") ? ST.meta.owner : (UI.lang === "en" ? "You" : "我")) : aname(agent(w));
/* t-i18n-b: text the server writes into state in Chinese (card events, mailbox prefixes, HR card titles/summaries, agent
   activity it sets, API errors). The stored text never changes (server.py branches on 待审核 / 新规则提议, and old state is
   already Chinese), so English is made here, at display time, from the known shapes. Anything that does not match (user
   content) passes through untouched; zh returns the input as is. th = a card-thread line (approve / done / event kinds). */
const nmEn = n => { if (n === "管家") return "the manager"; const a = Object.values((ST && ST.agents) || {}).find(x => x.name === n || x.id === n); return a ? aname(a) : n; };
const SNZ_EN = s => String(s).replace(/^今晚/, "Tonight").replace(/^明早/, "Tomorrow morning").replace(/^早上/, "This morning").replace(/^下周一/, "Next Monday")
  .replace(/^等(.+)下条回复$/, (_, n) => `until ${nmEn(n)} replies`);
const SKIP_EN = s => s.replace(/ · 跳过 (\d+) 个未答问题：([\s\S]*)$/, (_, n, q) => ` · skipped ${n} open question${n > 1 ? "s" : ""}: ${q.replace(/；/g, "; ")}`);
const APV_EN = { "批准开工": "Approved · go ahead", "回答": "Answered", "验收 · 关单": "Accepted · closed", "批准调岗": "Transfer approved", "批准入职": "Hire approved",
  "批准交付": "Delivery approved", "批准计划，开始执行": "Plan approved · go ahead" };   /* the last two: labels before t-btn-names, still in old threads */
const SRV_TH = [   /* thread-only shapes (a chat line or mail starting with 回答 must not be touched) */
  [/^(批准开工|回答|验收 · 关单|批准调岗|批准入职|批准交付|批准计划，开始执行)( · [\s\S]*)?$/, m => APV_EN[m[1]] + SKIP_EN(m[2] || "")],
  [/^完成 · mission complete([\s\S]*)$/, m => "Done · mission complete" + SKIP_EN(m[1])],
  [/^驳回 · ([\s\S]*)$/, m => "Rejected · " + m[1]],
  [/^重开 · reopened$/, () => "Reopened"],
  [/^改派给 (\S+)$/, m => "Reassigned to " + whoName(m[1])],
  [/^分类 → (\S+)$/, m => "Category → " + (CATS.includes(m[1]) ? t(m[1]) : m[1])],
  [/^稍后 · ([\s\S]+)$/, m => "Later · " + SNZ_EN(m[1])],
  [/^提问 · ([\s\S]*)$/, m => "Asked · " + m[1].replace(/（推荐）/g, " (recommended)")],   /* question + options are the asker's words */
  [/^撤回问题 · ([\s\S]*)$/, m => "Question withdrawn · " + m[1]],
  [/^提交审核 · submitted for review$/, () => "Submitted for review"],
  [/^通话中建卡，已通知管家派单$/, () => "Card made on a call; the manager was told to dispatch it"],
  [/^角色 (\S+) 已从 roster 移除，转回管家$/, m => `Role ${m[1]} left the roster; back to the manager`],
  [/^(\d+) 天没等到回复 · 回到等你拍板$/, m => `No reply in ${m[1]} days · back on you`],
  [/^稍后到点 · 回到等你拍板$/, () => "Snooze over · back on you"],
  [/^有新回复 · 推迟结束，回到等你拍板$/, () => "New reply · snooze ended, back on you"],
  [/^取消推迟 · 回到等你拍板$/, () => "Snooze cancelled · back on you"],
  [/^暂停常驻 · 管家不再做这张卡$/, () => "Standing card paused · the manager stops working on it"],
  [/^恢复常驻 · 管家照常做这张卡$/, () => "Standing card resumed · the manager works on it again"],
  [/^停止常驻任务 · 定时器已停，不会再开新的子卡$/, () => "Routine stopped · the timer is off; no new child cards"],
  [/^恢复常驻任务 · 每天 (\S+)$/, m => `Routine resumed · daily ${m[1]}`],
  [/^放弃面试$/, () => "Interview dropped"],
  [/^开场白已发到私聊：([\s\S]*)$/, m => "Opening line sent in the DM: " + m[1]],
  [/^已调岗 · ([\s\S]+?)：改了 ([\s\S]+?)。备份 (\S+)；10 分钟内可在卡上「撤回调岗」$/, m => `Transferred · ${nmEn(m[1])}: changed ${m[2] === "无" ? "nothing" : m[2].replace(/、/g, ", ")}. Backup ${m[3]}; undo it on this card within 10 minutes`],
  [/^(\d+) 条新红线变成了规则提议，在「审核」页点头才生效$/, m => `${m[1]} new red line${m[1] > 1 ? "s" : ""} became rule proposals; they apply once you approve them on the Review page`],
  [/^已入职 · ([\s\S]+)（(\S+)）出现在团队里$/, m => `Hired · ${nmEn(m[2]) !== m[2] ? nmEn(m[2]) : m[1]} (${m[2]}) joined the team`],
  [/^(调岗|入职)没办成：([\s\S]*)$/, m => `${m[1] === "调岗" ? "Transfer" : "Hire"} failed: ${srvT(m[2])}`],
  [/^搁置 · (.+) 退休，返聘时可以一键拿回$/, m => `Parked · ${nmEn(m[1])} retired; rehiring brings it back in one tap`],
  [/^交接自 (.+)（退休），接手前先读 (\S+)$/, m => `Handed over from ${nmEn(m[1])} (retired); read ${m[2]} before picking it up`],
  [/^交接清单：\n([\s\S]*)$/, m => "Handover:\n" + m[1].split("\n").map(l => l
    .replace(/^- 手上没有没完成的单子$/, "- No open cards")
    .replace(/^- 定时：(.*)$/, (_, x) => "- Schedules: " + x.replace(/ → 转管家/g, " → to the manager").replace(/ → 暂停/g, " → paused").replace(/；/g, "; "))
    .replace(/^- 规则提议 (\d+) 条挂起，返聘时放回$/, (_, n) => `- ${n} rule proposal${n > 1 ? "s" : ""} parked; they come back on rehire`)
    .replace(/ → 搁置$/, " → parked")).join("\n")],
  [/^撤销退休 · 单子回到 (.+)$/, m => `Retirement undone · card back to ${nmEn(m[1])}`],
  [/^已撤销退休 · 回来 (\d+) 张单子(?:，(\d+) 张新主人已经动过，留在原处)?$/, m => `Retirement undone · ${m[1]} card${m[1] > 1 ? "s" : ""} back` + (m[2] ? `, ${m[2]} already touched by their new owner stay put` : "")],
  [/^拿回搁置的单子 · 回到 (.+)$/, m => `Parked card taken back · back to ${nmEn(m[1])}`],
  [/^已撤回调岗 · roster 和 roles 文件按备份改回$/, () => "Transfer undone · roster and roles files restored from the backup"],
];
const SRV_ANY = [   /* mailbox, logs, agent activity, toasts / errors */
  [/^待审核\s*[:：]\s*([\s\S]*?)(（(?:(\d+) 天没回复|推迟到点)）)?$/, m => "For review: " + titleEn(m[1]) + (m[2] ? (m[3] ? ` (no reply in ${m[3]} days)` : " (snooze over)") : "")],
  [/^日报 · ([\s\S]*)$/, m => "Daily report · " + m[1].replace(/（周([一二三四五六日])）/g, (_, d) => ` (${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]["一二三四五六日".indexOf(d)]})`)],
  [/^新规则提议 · ([^:\s]+): ([\s\S]*)$/, m => `Rule proposal · ${nmEn(m[1])}: ${m[2]}`],
  [/^管家休眠 · (\d\d:\d\d) 复活。([\s\S]*?)；新指令会排队，醒来自动处理。$/, m => `Manager asleep · back at ${m[1]}. ${m[2] === "用量快到上限" ? "Usage is near the limit" : m[2]}; new orders queue up and run on wake.`],
  [/^休眠：([\s\S]*)，(\d\d:\d\d) 复活$/, m => `Asleep: ${m[1] === "用量快到上限" ? "usage is near the limit" : m[1]}, back at ${m[2]}`],
  [/^休眠中 · (\d\d:\d\d) 复活$/, m => `Asleep · back at ${m[1]}`],
  [/^面试中 · 在想$/, () => "Interviewing · thinking"],
  [/^调岗中 · 在想$/, () => "Transfer · thinking"],
  [/^⏰ 提醒：([\s\S]*?)(?:（晚了 (\d+) 分钟，看板刚恢复）)?$/, m => `⏰ Reminder: ${m[1]}` + (m[2] ? ` (${m[2]} min late, the dashboard just came back)` : "")],
  [/^还有 (\d+) 个问题没回答。刷新页面后在单子里点选，或者选择跳过。$/, m => `${m[1]} question${m[1] > 1 ? "s" : ""} still unanswered. Refresh, pick an option on the card, or choose skip.`],
  [/^已经过了今晚 20:00，选明早或自己选时间$/, () => "It's past 20:00 tonight; pick tomorrow morning or your own time"],
  [/^时间格式不对$/, () => "Bad time format"],
  [/^选一个 1 分钟以后、60 天以内的时间$/, () => "Pick a time between 1 minute and 60 days from now"],
  [/^这张卡现在不在等你拍板，不用推迟$/, () => "This card isn't waiting on you; nothing to snooze"],
  [/^这张卡已经处理过了$/, () => "This card was already handled"],
  [/^(.+)不能退休$/, m => { const x = m[1].split("、").map(nmEn).join(", "); return x[0].toUpperCase() + x.slice(1) + " can't retire"; }],
  [/^id 要小写字母开头，只用 a-z 0-9 -，2–16 个字$/, () => "The id starts with a lowercase letter and uses only a-z 0-9 -, 2–16 characters"],
  [/^名字 1–20 个字$/, () => "Name: 1–20 characters"],
  [/^颜色要 #rrggbb$/, () => "Colour must be #rrggbb"],
  [/^不是面试卡$/, () => "Not an interview card"],
  [/^不是调岗卡$/, () => "Not a transfer card"],
  [/^(\S+)还没上岗$/, m => `${nmEn(m[1])} isn't on the team yet`],
  [/^(\S+)正在给「([\s\S]*)」调岗，先聊完或放弃$/, m => `${nmEn(m[1])} is mid-transfer for "${nmEn(m[2])}"; finish or drop that first`],
  [/^(\S+)正在面试「([\s\S]*)」，先聊完或放弃$/, m => `${nmEn(m[1])} is interviewing for "${m[2]}"; finish or drop that first`],
  [/^管家不能调岗（manager\.md 归她自己，改它走规则提议）$/, () => "The manager can't be transferred (manager.md is hers; change it through a rule proposal)"],
  [/^这个角色不在岗$/, () => "This role isn't on the team"],
  [/^已经退休了$/, () => "Already retired"],
  [/^她在做「([\s\S]*)」，交回后再退$/, m => `She's working on "${m[1] === "手上的事" ? "her current task" : m[1]}"; retire her after she hands it in`],
  [/^没有可撤销的退休记录$/, () => "No retirement to undo"],
  [/^不在 roster 里（硬归档的用 new_role\.py rehire --from-archive）$/, () => "Not in the roster (for a hard-archived role use new_role.py rehire --from-archive)"],
  [/^先返聘$/, () => "Rehire first"],
  [/^创始成员只能软退休，不能归档$/, () => "Founding members can only soft-retire, not be archived"],
  [/^归档要二次确认$/, () => "Archiving needs a second confirmation"],
  [/^先软退休，再归档$/, () => "Soft-retire first, then archive"],
  [/^这张卡没有可撤回的调岗$/, () => "This card has no transfer to undo"],
  [/^超过 10 分钟了，撤回要找(\S+)按备份手动改回$/, m => `More than 10 minutes have passed; ask ${nmEn(m[1])} to restore it from the backup by hand`],
  [/^这个问题已经撤回了$/, () => "This question was withdrawn"],
  [/^不是这个问题的选项$/, () => "Not an option for this question"],
  [/^一次性的已经跑过了，不能再开；要再提醒就新建一条$/, () => "A one-off has already run and can't be turned back on; add a new one"],
  [/^读状态失败$/, () => "Couldn't read the state"],
  [/^需要确认$/, () => "Needs confirmation"],
  [/^出错了（细节不显示，避免带出令牌）$/, () => "Something went wrong (details hidden so the token can't leak)"],
  [/^这台设备还没在服务器登记推送$/, () => "This device isn't registered for push on the server yet"],
  [/^没找到会话记录目录$/, () => "transcript folder not found"],
  [/^发送失败：([\s\S]*)$/, m => "Send failed: " + srvT(m[1])],
];
function srvT(s, th) {
  s = String(s ?? "");
  if (UI.lang !== "en" || !/[\u3400-\u9fff]/.test(s)) return s;
  for (const [re, fn] of th ? SRV_TH.concat(SRV_ANY) : SRV_ANY) { const m = re.exec(s); if (m) return fn(m); }
  return s;
}
/* HR-flow card titles / summaries: new cards carry title_en (server.py); older ones get their prefix translated. */
/* t-i18n-c: template English names (title_en / label_en from GET /api/templates, fetched once, English only; market.js seeds it too)
   for interview cards made before title_en existed and for the hr-iv bar. tplEn(job, variant) -> {job, variant} | null; zh names work too. */
const TPLN = { m: null, zh: null, p: null };
function tplSeed(d) {
  const m = {}, zh = {};
  for (const t of (d && d.templates) || []) {
    const vs = {};
    for (const v of t.variants || []) { vs[v.key] = v.label_en || ""; if (v.label && v.label_en) zh[v.label] = v.label_en; }
    m[t.key] = { job: t.title_en || "", v: vs };
    if (t.job && t.title_en) zh[t.job] = t.title_en;
  }
  TPLN.m = m; TPLN.zh = zh;
}
function tplEn(job, variant) {
  if (!TPLN.m) {
    if (!TPLN.p && UI.lang === "en") TPLN.p = fetch("/api/templates").then(r => r.ok ? r.json() : null)
      .then(d => { if (d && !TPLN.m) { tplSeed(d); srvLocal(); render(); } }, () => {});
    return null;
  }
  const t = TPLN.m[job];
  if (t) return { job: t.job, variant: t.v[variant] || "" };
  return job && TPLN.zh[job] ? { job: TPLN.zh[job], variant: TPLN.zh[variant] || "" } : null;
}
function titleEn(s, it) {
  if (it && it.title_en) return it.title_en;
  const h = it && it.hire;
  if (h && h.mode !== "transfer" && h.job) { const x = tplEn(h.job, h.variant); if (x && x.job) return `Interview: ${x.job} (${x.variant || h.variant_label || h.variant})`; }   /* t-i18n-c */
  s = String(s || ""); let m;
  if ((m = /^面试：([\s\S]+?)（([^（）]*)）$/.exec(s))) { const x = tplEn(m[1], m[2]); return `Interview: ${(x && x.job) || m[1]} (${(x && x.variant) || m[2]})`; }   /* t-i18n-c: archived titles have no card */
  if ((m = /^面试：([\s\S]+)$/.exec(s))) return "Interview: " + m[1].replace(/（([^（）]*)）$/, " ($1)");
  if ((m = /^调岗：([\s\S]+)$/.exec(s))) return "Transfer: " + nmEn(m[1]);
  if ((m = /^退休：([\s\S]+)$/.exec(s))) return "Retired: " + nmEn(m[1]);
  return s;
}
function summaryEn(s) {
  s = String(s || ""); let m;
  if ((m = /^(\S+)在私聊里和你一问一答，问清五件事后出入职草案。模板 (\S+) · 性格 (\S+)。$/.exec(s))) return `${nmEn(m[1])} asks you one question at a time in the DM, then drafts the hire once five things are clear. Template ${m[2]} · personality ${m[3]}.`;
  if ((m = /^(\S+)在私聊里问清改哪块、改成什么（≤(\d+) 轮），出前后对比草案；你点「批准调岗」才落地。Confirmed rules 不动，新红线变成规则提议。$/.exec(s))) return `${nmEn(m[1])} asks in the DM what to change and how (≤${m[2]} turns), then drafts a before/after; nothing lands until you click Approve transfer. Confirmed rules stay; new red lines become rule proposals.`;
  if ((m = /^(.+)（(\S+)）软退休：roles\/\S+\.md、记忆、交接单、声音、头像都留着，返聘就回来。$/.exec(s))) return `${nmEn(m[2]) !== m[2] ? nmEn(m[2]) : m[1]} (${m[2]}) soft-retired: roles/${m[2]}.md, memory, handoff, voice and avatar all stay; rehire brings them back.`;
  return s;
}
/* Called after every new ST (poll, snapshot, full-item fetch) and on a language switch: swap the shown title / summary /
   activity in place, keeping the stored text in _tz / _sz / _az so switching back restores it exactly. */
function srvLocal() {
  if (!ST) return;
  const en = UI.lang === "en";
  for (const it of ST.items || []) {
    if (it._tz == null) { it._tz = it.title; it._sz = it.summary; }
    const tt = en ? titleEn(it._tz, it) : it._tz, ss = en && it.summary_en ? it.summary_en : en && it.hire || en && it.retire ? summaryEn(it._sz) : it._sz;
    if (it.title !== tt) it.title = tt;
    if (it.summary !== ss) it.summary = ss;
    /* t-i18n-c: cards that ship English beside the stored Chinese (state.example.json's sample cards): draft until a real version lands */
    for (const k of ["draft", "confidence_note", "evidence", "tags"]) {
      if (it[k + "_en"] == null || (k === "draft" && (it.versions || []).length)) continue;
      if (!("_z_" + k in it)) it["_z_" + k] = it[k];
      it[k] = en ? it[k + "_en"] : it["_z_" + k];
    }
    for (const x of it.thread || []) if (x.text_en) { if (x._xz == null) x._xz = x.text; x.text = en ? x.text_en : x._xz; }
  }
  for (const a of Object.values(ST.agents || {})) {
    if (a._az == null) a._az = a.activity;
    const v = en ? srvT(a._az) : a._az;
    if (a.activity !== v) a.activity = v;
  }
}

export { T, t, EN_SUB, CATS, STAGES, PLAT_ZH, PLAT_EN, PLAT, stageLabel, rtTag, rowLabel, grpLabel, D, pad, hm, dayKey, when, relH, agoH, whenH, ago, whoName, nmEn, SNZ_EN, SKIP_EN, APV_EN, SRV_TH, SRV_ANY, srvT, TPLN, tplSeed, tplEn, titleEn, summaryEn, srvLocal };
