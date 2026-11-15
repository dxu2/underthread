// Dashboard view: the 系统状态 panel (health rows, GitHub sync, version check).
// t-oss-struct S10 (A6): moved out of app.js unchanged; a wire*() function, if any, holds the top-level event wiring and app.js calls it where
// the code used to run, so listeners register in the same order as before.

// ---------- t-imp-p4: 系统状态 panel (replaces the old 体力 modal; desktop orb / SYNC row, phone orb / 菜单 row) ----------
// Server-side facts come from /api/health (cached, not in /api/state). Before the server restart that adds it,
// those rows are hidden and a one-line note says why.
import { $ } from "../core/util.js";
import { dayKey, hm, pad, srvT } from "../core/i18n.js";
import { ST, UI } from "../core/store.js";
import { agent } from "../core/av.js";
import { FOCUSABLE, api, closeModal, openModal, refSel, toast } from "../core/ui.js";
import { ageTxt, mgrState, ruHTML, usage, usageSrc } from "./header.js";
import { hooks } from "../app.js";
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
    const sv = H.server, sc = H.schema, ahead = !!(sc && sc.ahead && sc.ahead.length);   /* t-oss-struct E1: data schema; ahead = data from a newer version (after a rollback) */
    rows.push({ k: "srv", t: en ? "Dashboard server" : "看板服务器", lv: sv.loops && !ahead ? "ok" : "warn",
      s: (en ? `up ${upTxt(sv.uptime)} · started ${hm(sv.started)}` : `已运行 ${upTxt(sv.uptime)} · ${hm(sv.started)} 启动`) + ` · rev ${sv.rev}` + (sv.loops ? "" : (en ? " · background loops off" : " · 后台循环未开（测试模式）"))
        + (sc ? (ahead ? (en ? ` · data from a newer version (schema ${sc.state}, this code ${sc.code})` : ` · 数据来自较新版本（数据 v${sc.state}，代码 v${sc.code}）`) : ` · ${en ? "data" : "数据"} v${sc.state}`) : "") });
  }
  // 4. ComfyUI tunnel (already in /api/state)
  const c = (H && H.comfy) || ST.meta.comfy || {};
  if (c.configured !== false) rows.push({ k: "comfy", t: "ComfyUI", lv: c.online ? "ok" : c.online === false ? "warn" : "unk",
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
  // 8. extensions (t-oss-struct S8, needs /api/health): only when one is skipped, broken or on the old (pre-manifest) way, plus rows an extension adds
  if (H && H.ext && H.ext.extensions) {
    const X = H.ext.extensions, bad = X.filter(e => e.skipped || e.error), old = X.filter(e => e.legacy && !e.skipped && !e.error);
    if (bad.length || old.length) rows.push({ k: "ext", t: en ? "Extensions" : "扩展", lv: bad.length ? "warn" : "ok",
      s: [bad.length && (en ? `not loaded: ${bad.map(e => e.name).join(", ")}` : `没有加载：${bad.map(e => e.name).join("、")}`),
        old.length && (en ? `old style (no ext.json, works until 0.3.0): ${old.map(e => e.name).join(", ")}` : `旧写法（没有 ext.json，0.3.0 前还能用）：${old.map(e => e.name).join("、")}`)].filter(Boolean).join(" · ") });
  }
  if (window.UTExt) UTExt.statusRows(en).forEach((r, i) => rows.push({ k: "x" + i, t: r.t, s: r.s || "", lv: ["ok", "warn", "bad"].includes(r.lv) ? r.lv : "ok" }));
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
    const paint = () => { if (!m.isConnected) return; const h = statusHTML(); if (m._html === h) return;
      const st = m.scrollTop, g = $("#gt", m), a = document.activeElement, had = m === a || m.contains(a), key = had && a !== m ? refSel(a) : "";
      m.innerHTML = m._html = h; if (g) $("#gt", m).replaceWith(g); m.scrollTop = st;
      /* t-ui-fix-r6 R6-05: the swap dropped focus to BODY (right after open, and every 15 s); put it back on the same control, else the first one */
      if (had && !m.contains(document.activeElement)) { const t = (a && m.contains(a) && a) || (key && $(key, m)) || m.querySelector(FOCUSABLE); try { if (t) t.focus({ preventScroll: true }); else { m.tabIndex = -1; m.focus({ preventScroll: true }); } } catch (_) { } } };   // t-dash-token: keep the #gt node (a half-typed token)
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

// ===== t-dash-token: GitHub push token block in 系统状态 (desktop; the phone opens it from 设置 and ⌘K too).
// The page sends the token once (POST /api/secret/github, own header X-Underthread) and never gets it back: the API returns status only.
// The block is a node of its own (#gt) that modalStatus's 15 s repaint keeps, so a half-typed token is never wiped. =====
const GT = { st: null, old: false, busy: false, msg: "", lv: "", replace: false, confirmFile: false, loading: null };
const gz = (zh, e) => UI.lang === "en" ? e : zh;   /* t-i18n-a: zh text unchanged */
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
  if (UI.lang === "en") {
    const c = pr.code ? ` (${pr.code})` : "";
    if (pr.verdict === "ok") return `<p class="gt-pr ok">● Keychain works: the dashboard server can write, read and delete (checked ${t})</p>`;
    if (pr.verdict === "locked") return `<p class="gt-pr bad">● Keychain is locked${c}: the dashboard server runs in the background and can't store into it. Fix: on the Mac open Keychain Access, set the "login" keychain password to your login password, then check again; or use a local file instead. (checked ${t})</p>`;
    if (pr.verdict === "nohelper") return `<p class="gt-pr bad">● git's keychain helper (git-credential-osxkeychain) is missing (checked ${t})</p>`;
    return `<p class="gt-pr bad">● Keychain test failed${c}: write ${pr.write ? "✓" : "✗"} · read ${pr.read ? "✓" : "✗"} · delete ${pr.erase ? "✓" : "✗"} (checked ${t})</p>`;
  }
  if (pr.verdict === "ok") return `<p class="gt-pr ok">● 钥匙串可用：看板服务器能写、能读、能删（${t} 检测）</p>`;
  if (pr.verdict === "locked") return `<p class="gt-pr bad">● 钥匙串锁着${code}：看板服务器在后台，存不进去。办法：在 Mac 上打开「钥匙串访问」，把「登录」钥匙串的密码改成和开机密码一样，再点一次检测；或者改用本机文件。（${t} 检测）</p>`;
  if (pr.verdict === "nohelper") return `<p class="gt-pr bad">● 找不到 git 的钥匙串助手（git-credential-osxkeychain）（${t} 检测）</p>`;
  return `<p class="gt-pr bad">● 钥匙串测试没通过${code}：写 ${pr.write ? "✓" : "✗"} · 读 ${pr.read ? "✓" : "✗"} · 删 ${pr.erase ? "✓" : "✗"}（${t} 检测）</p>`;
}
function ghHTML() {
  const en = UI.lang === "en", S = GT.st, B = (k, l, c) => `<button type="button" class="gt-b ${c || ""}" data-gt="${k}"${GT.busy ? " disabled" : ""}>${l}</button>`;
  const head = (tag, cls) => `<h4>${en ? "GitHub push token" : "GitHub 推送令牌"} <em class="${cls || ""}">${tag}</em></h4>`;
  if (GT.old) return head(gz("要重启", "Restart needed"), "warn") + `<p>${gz("看板服务器重启以后才能用（新接口还没加载）。", "Works after the dashboard server restarts (the new API isn't loaded yet).")}</p>`;
  if (!S) return head("…") + `<p>${gz("读取中…", "Loading…")}</p>`;
  const file = S.method === "file", repo = esc(S.repo || "owner/underthread"), pr = S.probe;
  const msg = GT.msg ? `<p class="gt-msg ${GT.lv}">${esc(GT.msg)}</p>` : "";
  const where = file ? gz("本机文件（明文，600）", "a local file (plain text, 600)") : gz("钥匙串", "the keychain");
  if (GT.confirmFile) return head(gz("改用本机文件？", "Use a local file?"), "warn")
    + (en ? `<p>The token will be stored in plain text in <code>~/.config/underthread/git-credentials</code>, mode 600, readable only by your account; but any program running as you can read it too. It applies to github.com only, and adds two lines to git's global config.</p>` : `<p>令牌会明文存在 <code>~/.config/underthread/git-credentials</code>，权限 600，只有你的账号能读；但以你的身份运行的任何程序也都能读到。只对 github.com 生效，git 的全局配置里会加两行。</p>`)
    + `<div class="gt-r">${B("file_yes", gz("确定改用本机文件", "Yes, use a local file"), "pri")}${B("file_no", gz("算了", "Never mind"))}</div>`;
  if (!S.configured || GT.replace) {
    const offer = pr && pr.verdict !== "ok" && !file ? B("file", gz("改用本机文件…", "Use a local file…")) : "";
    return head(S.configured ? gz("换一个", "Replace") : gz("未配置", "Not set"))
      + (en ? `<p>Once set, the manager can push ${repo} without asking you for a token. The token stays on this Mac only (${file ? "local file" : "keychain"}); neither the dashboard nor the phone can read it back.</p>` : `<p>配好以后，管家推送 ${repo} 不用你再输令牌。令牌只存在这台 Mac 上（${file ? "本机文件" : "钥匙串"}），看板和手机都拿不回来。</p>`)
      + (file ? "" : ghProbeLine(pr))
      + `<div class="gt-r"><input type="password" class="gt-in" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="${gz("粘贴 github_pat_…（只用一次）", "Paste github_pat_… (used once)")}" aria-label="${gz("GitHub 令牌", "GitHub token")}"${GT.busy ? " disabled" : ""}>${B("set", GT.busy ? gz("验证中…", "Checking…") : gz("保存并验证", "Save and verify"), "pri")}</div>`
      + `<div class="gt-r">${file ? B("keychain", gz("改回钥匙串", "Back to keychain")) : B("probe", pr ? gz("再检测一次", "Check again") : gz("检测钥匙串", "Check keychain"))}${offer}${GT.replace ? B("cancel", gz("取消", "Cancel")) : ""}</div>`
      + msg + `<small>${en ? `Tip: a fine-grained token with only Contents read/write on ${repo}, expiring in 90 days` : `建议：细粒度令牌，只勾 ${repo} 的 Contents 读写，90 天到期`}</small>`;
  }
  const nt = S.note ? gz("：", ": ") + esc(S.note) : "";
  const st = S.ok === true ? `<span class="ok">● ${gz("可用", "Working")}</span>` : S.ok === false ? `<span class="bad">● ${gz("失效", "Not working")}${nt}</span>` : `<span class="warn">● ${gz("没验证", "Not verified")}${nt}</span>`;
  const bits = (en ? [st, S.user ? `account ${esc(S.user)}` : "", `stored in ${where}`, S.set_at ? `set ${ghWhenT(S.set_at)}` : "", S.expires ? `expires ${ghWhen(S.expires)}` : ""]
    : [st, S.user ? `账号 ${esc(S.user)}` : "", `存在${where}`, S.set_at ? `${ghWhenT(S.set_at)} 配置` : "", S.expires ? `${ghWhen(S.expires)} 到期` : ""]).filter(Boolean).join(" · ");
  return head(gz("已配置", "Set"), S.ok === false ? "bad" : ghSoon(S) ? "warn" : "ok") + `<p>${bits}</p>` + (file ? "" : ghProbeLine(pr))
    + `<div class="gt-r">${B("replace", gz("换一个", "Replace"))}${B("test", gz("测试推送权限", "Test push access"))}${file ? B("keychain", gz("改回钥匙串", "Back to keychain")) : B("probe", gz("检测钥匙串", "Check keychain"))}${B("erase", gz("删除", "Delete"), "dn")}</div>` + msg;
}
function ghPaint() { const el = $("#modal #gt"); if (el) el.innerHTML = ghHTML(); document.dispatchEvent(new Event("gh:status")); }   // the phone 设置 row re-reads its label
async function ghDo(k, el) {
  const say = (m, lv) => { GT.msg = m || ""; GT.lv = lv || ""; };
  if (k === "cancel") { GT.replace = false; say(""); return ghPaint(); }
  if (k === "replace") { GT.replace = true; say(""); ghPaint(); const i = $("#modal #gt .gt-in"); if (i) i.focus(); return; }
  if (k === "file") { GT.confirmFile = true; return ghPaint(); }
  if (k === "file_no") { GT.confirmFile = false; return ghPaint(); }
  if (k === "erase" && !confirm(gz("删除存好的 GitHub 令牌？之后推送又要你输令牌。", "Delete the stored GitHub token? Pushes will ask you for a token again."))) return;
  let tok = null;
  if (k === "set") {
    const i = el.closest("#gt").querySelector(".gt-in"); tok = i ? i.value.trim() : ""; if (i) i.value = "";
    if (!tok) { say(gz("先把令牌粘贴进框里", "Paste the token into the box first"), "bad"); return ghPaint(); }
  }
  GT.busy = true; say(""); ghPaint();
  const op = k === "file_yes" ? "use_file" : k === "keychain" ? "use_keychain" : k;
  const r = await ghApi(op, k === "set" ? { token: tok } : k === "file_yes" ? { confirm: true } : null);
  tok = null; GT.busy = false;
  if (k === "file_yes") GT.confirmFile = false;
  if (r.ok) {
    if (k === "set") { GT.replace = false; say(GT.st && GT.st.ok === false ? gz("存好了，但 GitHub 说：", "Saved, but GitHub says: ") + (GT.st.note || gz("不能推送", "can't push")) : gz("存好了，管家以后推送不用你再输令牌", "Saved. The manager can push without asking you for a token now"), GT.st && GT.st.ok === false ? "bad" : "ok"); }
    else if (k === "probe") say("");
    else if (k === "test") say(GT.st && GT.st.ok ? gz("能推送 ✓", "Can push ✓") : gz("不能推送：", "Can't push: ") + ((GT.st && GT.st.note) || ""), GT.st && GT.st.ok ? "ok" : "bad");
    else if (k === "erase") say(gz("删掉了", "Deleted"), "ok");
    else if (k === "file_yes") say(gz("改用本机文件了，把令牌粘贴进来保存", "Switched to a local file; paste the token to save it"), "");
    else if (k === "keychain") say(gz("改回钥匙串了，本机文件已删除；把令牌重新粘贴进来", "Back to the keychain, local file deleted; paste the token again"), "");
  } else say(srvT((r.j && r.j.error) || gz("没成功", "Didn't work")), "bad");
  if (!r.j || !r.j.status) await ghLoad();
  ghPaint();
}
function ghOpen() { modalStatus(); setTimeout(() => { const g = $("#modal #gt"); if (g) g.scrollIntoView({ block: "center", behavior: "smooth" }); }, 250); }


// ===== t-new-ver: the page keeps running the JS/CSS it loaded; after a web/ release (?v bump in index.html) it says so with a pill.
// Checks when the page comes back to the foreground and every 5 min while visible; never reloads on its own (drafts survive anyway). =====
const VER = { mine: "", t: 0, shown: false };
/* S9: the server stamps <meta name="ut-build"> (a hash of the whole page: every file's ?v= and the import map); an older server has none,
   so fall back to the list of ?v= script / stylesheet URLs */
const verSig = html => { const b = /<meta name="ut-build" content="(\w+)"/.exec(String(html)); return b ? "b:" + b[1] : (String(html).match(/\/static\/[\w.-]+\.(?:js|css)\?v=[\w.]+/g) || []).sort().join(" "); };
const verMine = () => VER.mine || (VER.mine = (m => m ? "b:" + m.content : verSig([...document.querySelectorAll("script[src],link[rel=stylesheet][href]")].map(e => e.getAttribute("src") || e.getAttribute("href")).join(" ")))(document.querySelector('meta[name="ut-build"]')));   // read after load: the scripts below app.js are not parsed yet when it runs
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

function wireStatus() {
  hooks.push(k => { if (k !== "all") return; const m = $("#modal .mdl.sys"); if (m && m._paint) m._paint(); });
  document.addEventListener("click", e => { const b = e.target.closest("#modal #gt [data-gt]"); if (b && !b.disabled) { e.preventDefault(); ghDo(b.dataset.gt, b); } });
  document.addEventListener("keydown", e => { if (e.key === "Enter" && !e.isComposing && e.target.closest && e.target.closest("#modal #gt .gt-in")) { e.preventDefault(); const b = $("#modal #gt [data-gt=set]"); if (b && !b.disabled) ghDo("set", b); } });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") verCheck(); });
  setInterval(() => verCheck(true), 5 * 60e3);
}

export { HL, loadHealth, gb, upTxt, statusRows, statusSummary, statusHTML, modalStatus, GT, gz, ghLoad, ghApi, ghWhen, ghWhenT, ghSoon, ghLabel, ghProbeLine, ghHTML, ghPaint, ghDo, ghOpen, VER, verSig, verMine, verCheck, verShow, wireStatus };
