// Dashboard page 设置 / settings: the tabs, general / system rows, theme, texture, stage and skin switches.
// t-oss-struct S10 (A5): moved out of app.js unchanged; a wire*() function, if any, holds the top-level event wiring and app.js calls it where
// the code used to run, so listeners register in the same order as before.

// ===== t-settings-tab (approved 11-04, plan v1.1): one 设置 page. Tabs 通用 / 角色 / 文档 / 日志 / 系统; the old 角色 / 文档 / 日志 pages are drawn
// inside their tab (UI.noHead drops their masthead). 通用 gathers the phone 更多 settings + theme mode; 系统 = status, role usage, GitHub token, 唤醒管家.
// t-feed-inbox: 连接 = feed sources (Gmail, Slack), drawn by ./connections.js.
// Theme mode (rt.themeMode auto | manual) is decided before first paint in index.html and kept live in mobile.js ui13.
import { $, LS } from "../../core/util.js";
import { srvLocal } from "../../core/i18n.js";
import { ST, UI, byAct, items } from "../../core/store.js";
import { agent, aname, av } from "../../core/av.js";
import { api, toast } from "../../core/ui.js";
import { go } from "../../core/router.js";
import { loadRoleUsage, ruHTML } from "../header.js";
import { SET_TABS, STU, contentMode, renderLeft } from "../left.js";
import { MOBQ, pageHead } from "./common.js";
import { PAGES, renderPage } from "./index.js";
import { PIPE, contentRoles, isContent, pipeCard, pipeName, pipeOf, pipeWeek, pipeWho } from "./pipe.js";
import { ghLabel, ghOpen, loadHealth, statusRows, statusSummary } from "../status.js";
import { hooks, render } from "../../app.js";
import { stConnections, wireConnections } from "./connections.js";
const themeMode = () => LS.get("themeMode", "manual") === "auto" ? "auto" : "manual";
const RMQ_S = matchMedia("(prefers-reduced-motion: reduce)");
const ST_L = { general: ["通用", "General"], connections: ["连接", "Connections"], roles: ["角色", "Roster"], docs: ["文档", "Docs"], logs: ["日志", "Log"], system: ["系统", "System"] };
function setTab(k, dir) {
  if (!SET_TABS.includes(k)) return;
  const was = UI.setTab; UI.setTab = k; LS.set("setTab", k);
  if (UI.page !== "settings") { go("settings"); return; }
  const pane = $("#pagebody .st-pane");
  const draw = () => { UI.stDir = dir || (SET_TABS.indexOf(k) >= SET_TABS.indexOf(was) ? "r" : "l"); renderPage(); UI.stDir = ""; };
  if (pane && !RMQ_S.matches && was !== k) { pane.classList.add("st-out"); setTimeout(draw, 90); } else draw();   // fade out, then slide the new pane in from the side you moved to
}
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
    + utRow(en) + texRow(en)
    + (ut => { const st = ut ? stageSaved() : !!R.dataset.stage; return stRow(en ? "Stage background" : "舞台背景", stageSub(en, ut), stSw(st), `data-stage-tog aria-pressed="${st}"` + (ut ? ' aria-disabled="true"' : ""), "button").replace('class="st-row"', `class="st-row${ut ? " st-dis" : ""}"`); })(!!R.dataset.ut)
    + stRow(en ? "Power saving" : "省电模式", psSub(psNow()), stSw(psNow()), `data-power-tog aria-pressed="${psNow()}"`)
    + spRow(en)
    + stRow(en ? "Language" : "界面语言", "", stSeg("lang", [["zh", "中文", "中文"], ["en", "English", "English"]], UI.lang, "data-lang-set"), "", "div");
  const P = window.Push ? Push.status() : null;
  const push = P ? stRow(en ? "Notifications" : "推送通知", esc(P.label) + (P.diag ? `<span class="st-diag">${esc(P.diag)}</span>` : ""), stSw(P.on), `data-set="push" aria-pressed="${!!P.on}"`)
    + (P.on && App.pushPrefs ? `<div class="st-sub">${App.pushPrefs()}</div>` : "")
    + (P.on ? stRow(en ? "Send a test" : "发一条测试通知", "", `<em class="st-go">›</em>`, `data-set="pushtest"`) : "") : "";
  const mic = stRow(en ? "Microphone test" : "麦克风测试", en ? "Check before voice calls" : "语音通话前的真机检查", `<em class="st-go">›</em>`, `data-set="mictest"`);
  return stSec(en ? "Appearance" : "外观", look) + stSec(en ? "Studio" : "制作", studioRow(en)) + stSec(en ? "Notifications" : "通知", push + mic);
}
/* t-oss-gen-s5: 制作线和频道 = content mode (views/left.js contentMode). One key, meta.studio, shared by every browser; unset = auto. */
const studioNow = () => { const m = ST && ST.meta && ST.meta.studio; return m === "on" || m === "off" ? m : "auto"; };
const studioSub = (en, m) => m === "on" ? (en ? "Always shown under Studio, with platform previews on drafts." : "一直显示在「制作」里，草稿带平台预览")
  : m === "off" ? (en ? "Hidden: Studio keeps Board and Assets." : "不显示：「制作」只留委托板和素材")
  : (en ? `Auto: shown when config.json lists platforms or a role owns a pipeline column (now ${contentMode() ? "shown" : "hidden"}).` : `自动：config.json 配了发布平台（platforms）或有角色负责制作线时显示（现在${contentMode() ? "显示" : "不显示"}）`);
function studioRow(en) {
  const m = studioNow();
  return stRow(en ? "Pipeline & Channels" : "制作线和频道", `<span class="st-studio-sub">${studioSub(en, m)}</span>`,
    stSeg("studio", [["auto", "自动", "Auto"], ["on", "开", "On"], ["off", "关", "Off"]], m, "data-studio-set"), "", "div");
}
function stSystem() {
  const en = UI.lang === "en";
  loadHealth(60000); const SY = statusSummary(statusRows());
  loadRoleUsage();
  const rows = stRow(en ? "System status" : "系统状态", `<span class="sy-sum-t ${SY.lv}">${esc(SY.txt)}</span>`, `<em class="st-go">›</em>`, `data-set="status"`)
    + (typeof ghOpen === "function" ? stRow(en ? "GitHub push token" : "GitHub 推送令牌", esc(ghLabel()), `<em class="st-go">›</em>`, `data-set="ghtok"`) : "")
    + stRow(en ? "Wake the manager" : "唤醒管家", en ? "Drops a ping in the inbox; use it when the manager is asleep or offline" : "往收件箱发一条 ping，管家休眠或离线时用", `<em class="st-act" aria-hidden="true">${en ? "Ping" : "叫醒"}</em>`, `data-h="wake"`);   /* t-ui-fix-r6 R6-07: acts at once, so an action pill instead of the 「›」 that the dialog rows use */
  return stSec(en ? "System" : "系统", rows) + stUpdate(en) + `<section class="st-sec st-ru"><h4>${en ? "Usage by role · today" : "各角色用量 · 今天"}</h4>${ruHTML(99, { tot: true, quota: true })}</section>`;
}
/* t-oss-struct S5: 系统 -> 更新. GET /api/update (every 60 s, every 2.5 s while an update runs); the buttons POST /api/update {op}
   and tools/update.py does the work in its own process (the server restarts under it; the "Dashboard updated" pill then reloads the page). */
const UPD = { d: null, t: 0, busy: false, notes: false };
function loadUpdate(age) {
  if (UPD.busy || Date.now() - UPD.t < age) return;
  UPD.busy = true;
  fetch("/api/update").then(r => r.ok ? r.json() : null).then(d => {
    if (!d) return;
    const ch = JSON.stringify(d) !== JSON.stringify(UPD.d); UPD.d = d; UPD.t = Date.now();
    if (ch && UI.page === "settings" && UI.setTab === "system") renderPage();
  }).catch(() => { }).finally(() => { UPD.busy = false; });
}
const updWhy = (b, en) => (b || []).map(x => x.code === "call" ? (en ? "a voice call is on" : "正在语音通话")
  : x.code === "agents" ? (en ? `working now: ${x.text}` : `${x.text} 正在干活`) : x.code === "running" ? (en ? "an update is running" : "正在更新")
  : x.code === "zip" ? (en ? "not a git install" : "不是 git 安装") : x.text).join(en ? "; " : "；");
const updHeads = t => (String(t || "").match(/^- \*\*[^*]+\*\*/gm) || []).map(s => s.slice(4, -2)).slice(0, 12);
function stUpdate(en) {
  const d = UPD.d, run = d && d.run && !d.run.done ? d.run : null;
  loadUpdate(run ? 2500 : 60000);
  if (!d) return "";
  const T = (zh, e) => en ? e : zh, H = s => esc(String(s || ""));
  if (!d.git) return stSec(T("更新", "Updates"), stRow(`${T("当前版本", "Version")} v${H(d.version)}`,
    T("这份不是用 git 装的，不能一键更新；请用 git clone 重新装一份（见 README），再把 local/ 和数据文件拷过去", "This copy was not installed with git, so it cannot update itself. Reinstall with git clone (see README) and copy local/ and your data files over"), "", "", "div"));
  const c = d.check || {}, why = updWhy((d.blockers || []).filter(x => x.code !== "running"), en), dis = why || run ? ' aria-disabled="true"' : "";
  const when = c.at ? c.at.slice(5, 16).replace("T", " ") : "";
  const sub = c.error ? `<span class="upd-err">${T("上次检查没成功：", "Last check failed: ")}${H(c.error)}</span>`
    : c.at ? `${T("上次检查 ", "Checked ")}${when}${d.available ? "" : T(" · 已是最新", " · up to date")}` : T("还没检查过", "Not checked yet");
  let rows = stRow(`${T("当前版本", "Version")} v${H(d.version)}`, `<span class="upd-c">${H(d.commit)}</span> · ${sub}`,
    `<em class="st-act" aria-hidden="true">${T("检查更新", "Check")}</em>`, `data-upd="check"` + (run ? ' aria-disabled="true"' : ""));
  if (run) {
    rows += `<div class="st-row upd-run" role="status"><span class="st-tx"><b>${run.op === "rollback" ? T("正在回退…", "Going back…") : run.op === "restart" ? T("正在重启…", "Restarting…") : T("正在更新…", "Updating…")}</b><small>${H(run.step)}</small></span><span class="upd-spin" aria-hidden="true"></span></div>`;
  } else if (d.available) {
    rows += stRow(`${T("有新版 ", "New version ")}v${H(c.latest)}`, why ? `${T("先等一下：", "Waiting: ")}${H(why)}`
      : T("先在一份副本上试跑，再换到新版；数据、设置和 local/ 都保留，出问题会自己退回", "Tried on a copy first, then switched; your data, settings and local/ stay, and it goes back by itself if anything fails"),
      `<em class="st-act" aria-hidden="true">${T("更新", "Update")}</em>`, `data-upd="apply"` + dis);
    const notes = (d.notes || []).map(n => `<li><b>v${H(n.version)}</b> <span>${H(n.date)}</span>${updHeads(n.text).map(h => `<i>${H(h)}</i>`).join("")}</li>`).join("");
    if (notes) rows += `<div class="upd-notes${UPD.notes ? " open" : ""}"><button type="button" class="upd-nt" data-upd-notes aria-expanded="${UPD.notes}">${T("这次更新了什么", "What's new")} <em aria-hidden="true">›</em></button>${UPD.notes ? `<ul>${notes}</ul>` : ""}</div>`;
  }
  const rs = d.restart || {};   /* t-iter-upgrade: the server's Python changed on disk (a git pull, an edit) since it started */
  if (!run && rs.needed) {
    const rwhy = updWhy((d.blockers || []).filter(x => x.code !== "running" && x.code !== "agents"), en);
    rows += stRow(T("服务端代码已更新，重启后生效", "Server code changed; restart to use it"), rwhy ? `${T("先等一下：", "Waiting: ")}${H(rwhy)}`
      : T(`${rs.count} 个文件变了（${(rs.changed || []).slice(0, 3).join("、")}${rs.count > 3 ? "…" : ""}）。重启几秒钟，正在干活的队友不受影响`, `${rs.count} file${rs.count > 1 ? "s" : ""} changed (${(rs.changed || []).slice(0, 3).join(", ")}${rs.count > 3 ? "…" : ""}). Takes a few seconds; teammates at work are not affected`),
      `<em class="st-act" aria-hidden="true">${T("重启", "Restart")}</em>`, `data-upd="restart"` + (rwhy ? ' aria-disabled="true"' : ""));
  }
  if (!run && d.rollback) rows += stRow(`${T("退回 ", "Go back to ")}v${H(d.rollback.version)}`, why ? `${T("先等一下：", "Waiting: ")}${H(why)}`
    : T("代码回到上一个版本，数据不动", "The code goes back to the previous version; your data stays"), `<em class="st-act" aria-hidden="true">${T("退回", "Go back")}</em>`, `data-upd="rollback"` + dis);
  const r = d.run;
  if (!run && r && r.done && r.message && r.ended && Date.now() - Date.parse(r.ended) < 86400000)
    rows += `<div class="upd-last ${r.ok ? "ok" : "bad"}">${r.ok ? "✓" : "!"} ${H(r.ended.slice(5, 16).replace("T", " "))} · ${H(r.message)}</div>`;
  return stSec(T("更新", "Updates"), rows);
}
function updClick(e) {
  const n = e.target.closest("[data-upd-notes]");
  if (n) { UPD.notes = !UPD.notes; renderPage(); return; }
  const b = e.target.closest("[data-upd]"); if (!b || b.getAttribute("aria-disabled") === "true") return;
  const op = b.dataset.upd, en = UI.lang === "en", d = UPD.d || {};
  if (op === "apply" && !confirm(en ? `Update to v${(d.check || {}).latest}? The dashboard restarts once (a few seconds).` : `更新到 v${(d.check || {}).latest}？看板会重启一次（几秒钟）。`)) return;
  if (op === "rollback" && !confirm(en ? `Go back to v${(d.rollback || {}).version}? The dashboard restarts once.` : `退回到 v${(d.rollback || {}).version}？看板会重启一次。`)) return;
  if (op === "restart" && !confirm(en ? "Restart the dashboard now? It is back in a few seconds." : "现在重启看板？几秒钟就回来。")) return;
  b.setAttribute("aria-disabled", "true");
  fetch("/api/update", { method: "POST", headers: { "Content-Type": "application/json", "X-Underthread": "1" }, body: JSON.stringify({ op }) })
    .then(r => r.json().then(j => ({ ok: r.ok, j })))
    .then(({ ok, j }) => {
      if (!ok) toast((en ? "Not now: " : "现在不行：") + (j.blockers ? updWhy(j.blockers, en) : j.error || ""), true);
      else toast(op === "check" ? (en ? "Checking…" : "正在检查…") : op === "apply" ? (en ? "Updating… the dashboard restarts in a moment" : "开始更新…看板稍后会重启") : op === "restart" ? (en ? "Restarting…" : "正在重启…") : (en ? "Going back…" : "开始退回…"));
    })
    .catch(err => toast(String(err), true))
    .finally(() => { UPD.t = 0; setTimeout(() => loadUpdate(0), 800); });
}
/* t-power-toggle: 省电模式 (rt.powerSave, kept by fx.js). The click flips the switch in place (no re-render) so the knob slide and the caption fade are seen. */
const psNow = () => !(window.FX && FX.power) || FX.power.isOn();
const psSub = on => UI.lang === "en"
  ? (on ? "After 20 s without input, or when you switch away, looping animations pause; working avatars do not breathe" : "Looping animations always play, even when idle; working avatars breathe. Uses more power")
  : (on ? "20 秒不操作或切到别的窗口，循环动画就暂停；工作中的头像不做呼吸缩放" : "循环动画一直播，闲置也不停，头像恢复呼吸缩放；更耗电");
/* t-splash: 开屏动画 (rt.splash.mode "session" | "off", read by the inline guard in index.html). A div row with two real buttons: the switch flips in place
   (no re-render, like 省电模式) and 预览 plays the opening on this page now (UTSplash.play, does not touch rt.splash). */
const spOn = () => { try { return JSON.parse(localStorage.getItem("rt.splash.mode")) !== "off"; } catch { return true; } };
const spSub = on => UI.lang === "en" ? (on ? "Plays once each time you open the dashboard; tap or press any key to skip" : "Off: the dashboard opens straight away")
  : (on ? "每次打开看板播一次，点一下或按任意键跳过" : "已关：打开看板直接进");
// t-theme-ut: 配色 row (墨刊 / Underthread 特典), right under 主题. Flipped in place by mobile.js ui13 (utSet / utPaint).
const utNow = () => { try { return JSON.parse(localStorage.getItem("rt.ut")) === "ink" ? "ink" : "ut"; } catch (err) { return "ut"; } };   /* open-source build: 特典 is the default */
const stageSaved = () => { try { return JSON.parse(localStorage.getItem("rt.stage")) === true; } catch (err) { return false; } };
function stageSub(en, ut) {
  return ut ? (en ? "Not shown with the Underthread palette; comes back when you switch to Ink" : "特典主题下不显示，切回墨刊后恢复")
    : (en ? "Your terrace office behind everything; night / day follow the theme" : "你画的露台办公室做背景，夜 / 昼跟着上面的主题");
}
function utRow(en) {
  return stRow(en ? "Palette" : "配色", en ? "Underthread (the default) is solid coffee / cream with the needle-thread avatars. Ink is black glass. Night / Day still follow the theme above." : "特典（默认）是纯色咖啡 / 奶油，配针线头像；墨刊是黑色毛玻璃。夜 / 昼仍按上面的「主题」走",
    stSeg("ut", [["ink", "墨刊", "Ink"], ["ut", "Underthread 特典", "Underthread"]], utNow(), "data-ut-set"), "", "div");
}
// t-theme-knit: 质感 row, generic (rt.texture = off | knit1 | leather1; a new texture = one more entry here + its css; knit2 / leather2 removed in t-tex-trim, lsmigrate.js step 2 maps them). Flipped in place by mobile.js ui13 (texSet / texPaint).
const TEXTURES = [["off", "关", "Off"], ["knit1", "针脚", "Stitch"], ["leather1", "软皮", "Leather"]];   /* t-theme-leather: leather1 → texture-leather.css */
const texNow = () => { let v = null; try { v = JSON.parse(localStorage.getItem("rt.texture")); } catch (err) { } v = { knit2: "knit1", leather2: "leather1" }[v] || v; return TEXTURES.some(x => x[0] === v) ? v : "off"; };
function texRow(en) {
  return stRow(en ? "Texture" : "质感", en ? "Adds a material look on top of the palette; colours stay the same." : "在配色上叠一层材质，颜色不变",
    stSeg("texture", TEXTURES, texNow(), "data-tex-set"), "", "div");
}
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
const RI8 = { skip: false };
const plFade = el => el.classList.toggle("more", el.scrollWidth - el.clientWidth - el.scrollLeft > 4);   // fade the right edge while columns hide past it
const plSL = {};   // polls re-render the page; keep each sideways row where you left it (phones open the week strip at today)

function wireSettings() {
  wireConnections();   // t-feed-inbox
  document.addEventListener("click", e => { const b = e.target.closest("[data-settab]"); if (b) setTab(b.dataset.settab); });
  document.addEventListener("click", updClick);
  /* t-nav-shoot: 制作 sub tabs. Fade the page out (90 ms), switch, slide the new page in from the side you moved to; reduced motion = just switch. */
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-stutab]"); if (!b) return;
    const k = b.dataset.stutab, was = UI.page; if (!STU.includes(k) || k === was) return;
    const body = $("#pagebody"), dir = STU.indexOf(k) >= STU.indexOf(was) ? "r" : "l";
    const draw = () => { go(k); if (RMQ_S.matches) return; body.classList.remove("stu-out"); body.classList.add("stu-in-" + dir); setTimeout(() => body.classList.remove("stu-in-r", "stu-in-l"), 260); };
    if (body && !RMQ_S.matches) { body.classList.add("stu-out"); setTimeout(draw, 90); } else draw();
  });
  document.addEventListener("click", e => {
    const p = e.target.closest && e.target.closest("[data-power-tog]"); if (!p || !window.FX || !FX.power) return;
    const on = !FX.power.isOn(); FX.power.set(on);
    p.setAttribute("aria-pressed", String(on));
    const sw = p.querySelector(".sw"); if (sw) sw.classList.toggle("on", on);
    const sm = p.querySelector(".st-tx small");
    if (sm) { sm.classList.remove("st-swap"); void sm.offsetWidth; sm.textContent = psSub(on); sm.classList.add("st-swap"); }
  });
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
    try { body = k === "general" ? stGeneral() : k === "system" ? stSystem() : k === "connections" ? stConnections() : PAGES[k](); } finally { UI.noHead = false; }
    return pageHead("settings") + tabs + `<div class="st-pane st-p-${k}${UI.stDir ? " st-in-" + UI.stDir : ""}" role="tabpanel">${body || ""}</div>`;
  };
  document.addEventListener("click", e => {   /* t-oss-gen-s5: switch in place (no page rebuild), then tell the server */
    const b = e.target.closest && e.target.closest("[data-studio-set]"); if (!b) return;
    const m = b.dataset.studioSet; if (m === studioNow()) return;
    if (ST && ST.meta) { if (m === "auto") delete ST.meta.studio; else ST.meta.studio = m; }
    b.closest(".seg").querySelectorAll("[data-studio-set]").forEach(x => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-checked", String(on)); });
    const sm = b.closest(".st-row") && b.closest(".st-row").querySelector(".st-studio-sub");
    if (sm) { sm.classList.remove("st-swap"); void sm.offsetWidth; sm.textContent = studioSub(UI.lang === "en", m); sm.classList.add("st-swap"); }
    api("studio_mode", { mode: m });
  });
  document.addEventListener("click", e => {
    const l = e.target.closest("[data-lang-set]"); if (l && l.dataset.langSet !== UI.lang) { UI.lang = l.dataset.langSet; LS.set("lang", UI.lang); srvLocal(); window.Push && Push.lang && Push.lang(UI.lang); render(); }
  });
  PAGES.pipe = function () {
    const en = UI.lang === "en", all = items().filter(i => i.stage !== "done" && ["main", "side"].includes(i.category));
    const content = all.filter(isContent), skipped = all.filter(i => !isContent(i));
    const wk = pipeWeek(content);
    const bar = `<div class="ph-bar"><span class="count">${en ? "Days booked this week" : "本周已排"} <b>${wk.used}</b>${en ? "" : " 天"}</span><span class="count">${en ? "In production" : "在制作"} <b>${content.length}</b></span></div>`;
    const empty = !content.length ? `<div class="pl-empty"><b>${en ? "No content items yet." : "还没有内容单子。"}</b>
      ${en ? "Main / side quests with a platform, a <code>pipe:&lt;stage&gt;</code> tag, or a content owner (" + contentRoles().map(a => esc(a.id)).join(", ") + ") show up here, one column per production stage. Calendar entries for this week fill the slots above."
        : "主线 / 支线里，标了平台、带 <code>pipe:阶段</code> 标签、或者负责人是内容组（" + contentRoles().map(a => esc(aname(a))).join("、") + "）的卡，会按制作阶段出现在下面七列。上面的发布位读的是日程里本周的条目。"}</div>` : "";
    const cols = PIPE.map(p => {
      const g = content.map(i => ({ i, p: pipeOf(i) })).filter(x => x.p.k === p.k).sort((a, b) => byAct(a.i, b.i));
      const who = pipeWho(p).map(w => w === "me" ? `<span class="pl-me">${en ? "You" : "你"}</span>` : av(agent(w), "sm")).join("");
      return `<div class="pl-col${g.length ? "" : " none"}" data-pdrop="${p.k}"><div class="col-h"><span>${pipeName(p)}</span><span class="pl-who">${who}<i>${g.length}</i></span></div>
        <div class="pl-d">${esc(en ? p.de : p.d)}</div>${g.map(x => pipeCard(x.i, x.p.guess)).join("")}</div>`;
    }).join("");
    /* t-ri1108-a P5: one line + 「展开 ›」; the list opens one card per line. RI8.skip keeps it open across poll rebuilds; the click flips the class in place. */
    const skip = skipped.length ? `<div class="pl-skip${RI8.skip ? " ri8-open" : ""}"><div class="ri8-skip-h"><span>${en ? `${skipped.length} more main/side card(s) are not in the pipeline (no platform, no pipe tag, owner not in the content group)` : `另有 ${skipped.length} 张主线/支线卡没放进制作线（没平台、没 pipe 标签、负责人不在内容组）`}</span><button type="button" class="ri8-skip-t" data-ri8-skip aria-expanded="${RI8.skip}">${RI8.skip ? (en ? "Hide ‹" : "收起 ‹") : (en ? "Show ›" : "展开 ›")}</button></div><div class="ri8-skip-l"><div>${skipped.map(i => `<a href="#" data-item="${i.id}">${esc(i.title)}</a>`).join("")}</div></div></div>` : "";
    /* t-ui-fix-r2 audit P2-10: at 1100 the last columns sit past the edge behind a faint fade only; a line under the board says so (shown only while .more) and scrolls on click */
    return pageHead("pipe", bar) + wk.html + empty + `<div class="pl-board">${cols}</div><button type="button" class="pl-more-h" data-pl-next>${en ? "More stages to the right · scroll →" : "右边还有阶段 · 横向滚动 →"}</button>` + skip;
  };
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-ri8-skip]"); if (!b) return;
    const box = b.closest(".pl-skip"), en = UI.lang === "en"; RI8.skip = !RI8.skip;
    box.classList.toggle("ri8-open", RI8.skip); b.setAttribute("aria-expanded", RI8.skip); b.textContent = RI8.skip ? (en ? "Hide ‹" : "收起 ‹") : (en ? "Show ›" : "展开 ›");
  });
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
  document.addEventListener("click", e => { const b = e.target.closest("[data-pl-next]"), el = b && b.previousElementSibling; if (el && el.classList.contains("pl-board")) el.scrollBy({ left: Math.round(el.clientWidth * .8), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); });
  document.addEventListener("click", e => {
    const a = e.target.closest("[data-pl-add]"); if (!a) return;
    UI.calForm = true; renderLeft();
    const f = $("#calf"); if (f) { f.date.value = a.dataset.plAdd; f.title.focus(); if (!f.title.dataset.ex) f.title.dataset.ex = 1, f.title.placeholder = UI.lang === "en" ? "e.g. Bilibili · EP1" : "例：B站 · EP1"; }
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
}

export { UPD, loadUpdate, stUpdate, themeMode, RMQ_S, ST_L, setTab, stRow, stSeg, stSw, stSec, stGeneral, stSystem, psNow, psSub, spOn, spSub, utNow, stageSaved, stageSub, utRow, TEXTURES, texNow, texRow, spRow, spPaint, RI8, plFade, plSL, wireSettings };
