// t-feed-inbox: 设置 → 连接 / Connections. One row per feed source (core/feeds on the server): status, on/off, interval, fetch now,
// disconnect; "Connect…" opens a dialog for the address and the app password. The password goes to the server once (POST /api/feeds,
// header X-Underthread) and never comes back: every answer is status only. The dialog lives in #modal, so a poll that redraws the
// settings page never wipes a half-typed password; the rows are drawn from FC.st, and switches flip in place before the answer.
import { $ } from "../../core/util.js";
import { UI } from "../../core/store.js";
import { closeModal, openModal, toast } from "../../core/ui.js";
import { renderPage } from "./index.js";

const FC = { st: null, t: 0, old: false, loading: null, busy: {}, msg: {}, m: { busy: false, msg: "", lv: "", file: false } };
const L = (zh, en) => UI.lang === "en" ? en : zh;
const P = a => Array.isArray(a) ? (UI.lang === "en" ? a[1] || a[0] : a[0]) : (a || "");
const RMQ = matchMedia("(prefers-reduced-motion: reduce)");

async function fcLoad(force) {
  if (FC.loading && !force) return FC.loading;
  FC.loading = (async () => {
    try { const r = await fetch("/api/feeds", { cache: "no-store" }); if (r.status === 404) FC.old = true; else if (r.ok) { FC.st = await r.json(); FC.old = false; } } catch (_) { }
    FC.t = Date.now(); FC.loading = null;
  })();
  return FC.loading;
}
async function fcApi(op, extra) {
  try {
    const r = await fetch("/api/feeds", { method: "POST", headers: { "Content-Type": "application/json", "X-Underthread": "1" }, body: JSON.stringify({ op, ...(extra || {}) }) });
    if (r.status === 404) { FC.old = true; return { ok: false, j: {} }; }
    let j = {}; try { j = await r.json(); } catch (_) { }
    if (j.status) FC.st = j.status;
    return { ok: r.ok && j.ok !== false, j };
  } catch (_) { return { ok: false, j: { error: L("连不上看板服务器", "Dashboard server unreachable") } }; }
}
const errTxt = j => (UI.lang === "en" ? j.error_en || j.error : j.error) || L("没成功", "Didn't work");
function rel(s) {
  const t = Date.parse(s || ""); if (isNaN(t)) return "";
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return L("刚刚", "just now");
  if (m < 60) return L(`${m} 分钟前`, `${m} min ago`);
  const h = Math.round(m / 60); return h < 24 ? L(`${h} 小时前`, `${h} h ago`) : L(`${Math.round(h / 24)} 天前`, `${Math.round(h / 24)} d ago`);
}
const ICON = {
  gmail: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3.8 7l8.2 6 8.2-6"/></svg>`,
  slack: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4L8 20M16 4l-2 16M5 9h15M4 15h15"/></svg>`,
};

function statusLine(s) {
  if (!s.available) return `<span class="fc-st soon">${L("即将支持", "Coming soon")}</span>`;
  if (!s.connected) return `<span class="fc-st">${L("未连接", "Not connected")}</span>`;
  if (s.last_error) {
    const why = s.error_text ? P(s.error_text) : s.last_error;
    return `<span class="fc-st bad">● ${s.paused ? L("已暂停：", "Paused: ") : L("出错：", "Error: ")}${esc(why)}</span>`;
  }
  const bits = [`<span class="fc-st ${s.enabled ? "ok" : ""}">● ${s.enabled ? L("收集中", "Collecting") : L("已关", "Off")}</span>`, esc(s.account || "")];
  if (s.last_ok) bits.push(L(`${rel(s.last_ok)}拉取`, `fetched ${rel(s.last_ok)}`));
  bits.push(L(`今天 ${s.today || 0} 封`, `${s.today || 0} today`));
  return bits.join(" · ");
}
function rowHTML(s) {
  const en = UI.lang === "en", busy = !!FC.busy[s.id], ic = ICON[s.id] || ICON.gmail;
  const head = `<span class="fc-ic" aria-hidden="true">${ic}</span><span class="st-tx"><b>${esc(P(s.label))}</b><small>${statusLine(s)}</small></span>`;
  if (!s.available) return `<div class="st-row fc-row fc-off" data-fc-row="${s.id}">${head}</div>`;
  if (!s.connected) return `<div class="st-row fc-row" data-fc-row="${s.id}">${head}<button type="button" class="st-act fc-go" data-fc="open" data-src="${s.id}"${busy ? " disabled" : ""}>${L("连接…", "Connect…")}</button></div>`;
  const on = !!s.enabled, iv = s.interval_min || 5, ivs = (FC.st && FC.st.intervals) || [1, 5, 15, 30, 60];
  const seg = `<div class="seg st-seg fc-iv" role="radiogroup" aria-label="${L("多久拉一次", "How often")}">${ivs.map(v => `<button type="button" class="seg-i ${v === iv ? "on" : ""}" role="radio" aria-checked="${v === iv}" data-fc="iv" data-src="${s.id}" data-v="${v}">${v < 60 ? (en ? `${v} min` : `${v} 分钟`) : (en ? "1 h" : "1 小时")}</button>`).join("")}</div>`;
  const msg = FC.msg[s.id] ? `<p class="fc-msg ${FC.msg[s.id].lv || ""}">${esc(FC.msg[s.id].t)}</p>` : "";
  return `<div class="fc-blk" data-fc-row="${s.id}"><button type="button" class="st-row fc-row" data-fc="toggle" data-src="${s.id}" aria-pressed="${on}"${busy ? " disabled" : ""}>${head}<span class="sw ${on ? "on" : ""}" aria-hidden="true"><i></i></span></button>
    <div class="fc-sub"><span class="fc-l">${L("多久拉一次", "Check every")}</span>${seg}
      <div class="fc-acts"><button type="button" class="gt-b" data-fc="poll" data-src="${s.id}"${busy ? " disabled" : ""}>${busy === "poll" ? L("拉取中…", "Fetching…") : L("立即拉取", "Fetch now")}</button><button type="button" class="gt-b" data-fc="open" data-src="${s.id}"${busy ? " disabled" : ""}>${L("换密码", "New password")}</button><button type="button" class="gt-b dn" data-fc="disconnect" data-src="${s.id}"${busy ? " disabled" : ""}>${L("断开", "Disconnect")}</button></div>${msg}</div></div>`;
}
function stConnections() {
  const en = UI.lang === "en";
  if ((!FC.st && !FC.old) || Date.now() - FC.t > 20000) { if (!FC.loading) fcLoad().then(() => { if (UI.page === "settings" && UI.setTab === "connections") renderPage(); }); }
  const intro = `<p class="fc-intro">${L("连上以后，看板每隔几分钟看一眼有没有新消息，把「谁发的、标题、一两句摘要」合成一条交给管家。只读：不会标已读、不会删、不会回。默认关闭。",
    "Once connected, the dashboard checks for new messages every few minutes and hands the steward one summary: who sent it, the subject, a line or two. Read-only: nothing is marked read, deleted or answered. Off until you connect.")}</p>`;
  if (FC.old) return intro + `<section class="st-sec"><p class="fc-intro">${L("看板服务器重启以后才能用（新接口还没加载）。", "Works after the dashboard server restarts (the new API isn't loaded yet).")}</p></section>`;
  if (!FC.st) return intro + `<section class="st-sec"><h4>${L("信息流来源", "Feed sources")}</h4><p class="fc-intro">${L("读取中…", "Loading…")}</p></section>`;
  const rows = FC.st.sources.map(rowHTML).join("");
  const cls = FC.st.classifier === "claude" ? L("新邮件先过一个没有任何工具的分类器（claude -p），分成「要你处理 / 可以起草 / 知道就行」；管家只看到标题、发件人和分类结论。", "New mail first goes through a classifier with no tools at all (claude -p): needs you / can draft / FYI. The steward sees only the subject, sender and verdict.")
    : L("没找到 claude 命令，所以不做分类：管家只看到标题、发件人和摘要。", "No claude command found, so no sorting: the steward sees only the subject, sender and snippet.");
  const where = FC.st.method === "file" ? L("密码存在本机文件 ~/.config/underthread/feeds-credentials.json（权限 600）。", "Passwords are kept in ~/.config/underthread/feeds-credentials.json (mode 600).")
    : L("密码存在这台 Mac 的钥匙串里，看板和手机都拿不回来，也不进日志、卡片或管家的收件箱。", "Passwords stay in this Mac's keychain; neither the page nor the phone can read them back, and they never reach logs, cards or the steward's inbox.");
  const safe = `<section class="st-sec fc-safe"><h4>${L("安全", "Safety")}</h4><ul><li>${esc(where)}</li><li>${esc(cls)}</li><li>${L("邮件内容一律当外人写的文字：里面的指令不执行；管家只起草，不替你发送、删除或归档。", "Mail is treated as text from strangers: instructions in it are never followed; the steward only drafts, never sends, deletes or archives for you.")}</li></ul></section>`;
  return intro + `<section class="st-sec"><h4>${L("信息流来源", "Feed sources")}</h4>${rows}</section>` + safe;
}

// ---------------- the connect dialog ----------------
function probeLine(pr) {
  if (!pr) return "";
  if (pr.verdict === "ok") return `<p class="fc-pr ok">● ${L("钥匙串可用", "The keychain works")}</p>`;
  if (pr.verdict === "nohelper") return `<p class="fc-pr bad">● ${L("这台机器没有钥匙串助手（Linux 或没装 git）：只能存本机文件。", "No keychain helper on this machine (Linux, or git missing): only a local file works.")}</p>`;
  if (pr.verdict === "locked") return `<p class="fc-pr bad">● ${L(`钥匙串锁着（${pr.code}）：看板服务器在后台，存不进去。办法：在 Mac 上打开「钥匙串访问」，把「登录」钥匙串的密码改成和开机密码一样，再检测一次；或者改用本机文件。`, `The keychain is locked (${pr.code}): the dashboard server runs in the background and can't store into it. Fix: open Keychain Access, set the "login" keychain password to your login password, then check again; or use a local file.`)}</p>`;
  return `<p class="fc-pr bad">● ${L("钥匙串测试没通过", "Keychain test failed")}${pr.code ? ` (${pr.code})` : ""}</p>`;
}
function dlgBody(s) {
  const M = FC.m, st = FC.st || {}, B = (k, l, c) => `<button type="button" class="gt-b ${c || ""}" data-fcm="${k}"${M.busy ? " disabled" : ""}>${l}</button>`;
  if (M.file) return `<p class="fc-p">${L("密码会明文存在 <code>~/.config/underthread/feeds-credentials.json</code>，权限 600，只有你的账号能读；但以你的身份运行的任何程序也都能读到。", "The password will be stored in plain text in <code>~/.config/underthread/feeds-credentials.json</code>, mode 600, readable only by your account; but any program running as you can read it too.")}</p>
    <div class="gt-r">${B("file_yes", L("确定改用本机文件", "Yes, use a local file"), "pri")}${B("file_no", L("算了", "Never mind"))}</div>`;
  const offer = st.probe && st.probe.verdict !== "ok" && st.method !== "file" ? B("file", L("改用本机文件…", "Use a local file…")) : "";
  return `<p class="fc-p">${esc(P(s.help))}${s.help_url ? ` <a href="${esc(s.help_url)}" target="_blank" rel="noopener noreferrer">${L("去生成应用专用密码 ↗", "Create an app password ↗")}</a>` : ""}</p>
    <label for="fc-acct">${L("地址", "Address")}</label><input type="email" id="fc-acct" class="gt-in" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${esc(P(s.account_hint))}" value="${esc(M.acct || s.account || "")}"${M.busy ? " disabled" : ""}>
    <label for="fc-pw">${esc(P(s.secret_label))}</label><input type="password" id="fc-pw" class="gt-in" autocomplete="new-password" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="xxxx xxxx xxxx xxxx"${M.busy ? " disabled" : ""}>
    <p class="fc-where">${st.method === "file" ? L("保存到本机文件（600）", "Saved to a local file (600)") : L("保存到这台 Mac 的钥匙串", "Saved to this Mac's keychain")} · ${L("先登录测一下，测通才保存并开始收集；之前的旧邮件不会补发给管家。", "We log in first; only a working login is saved and starts collecting. Older mail is not replayed to the steward.")}</p>
    ${st.method === "file" ? "" : probeLine(st.probe)}
    ${M.msg ? `<p class="fc-msg ${M.lv}">${esc(M.msg)}</p>` : ""}
    <div class="gt-r fc-more">${st.method === "file" ? B("keychain", L("改回钥匙串", "Back to keychain")) : B("probe", st.probe ? L("再检测一次钥匙串", "Check the keychain again") : L("检测钥匙串", "Check the keychain"))}${offer}</div>`;
}
function dlgPaint() { const b = $("#modal .fc-mdl .fc-body"); if (!b) return; const a = $("#fc-acct"); if (a) FC.m.acct = a.value; b.innerHTML = dlgBody(FC.m.s); const f = $("#modal .fc-mdl [data-fcm=ok]"); if (f) { f.disabled = FC.m.busy; f.textContent = FC.m.busy ? L("连接中…", "Connecting…") : L("测试并连接", "Test & connect"); } }
function dlgOpen(id) {
  const s = FC.st && FC.st.sources.find(x => x.id === id); if (!s || !s.available) return;
  FC.m = { s, busy: false, msg: "", lv: "", file: false, acct: s.account || "" };
  openModal(`<h2>${L("连接", "Connect")} ${esc(P(s.label))}</h2><div class="fc-body">${dlgBody(s)}</div>
    <div class="foot"><button class="btn" data-fcm="x">${L("取消", "Cancel")}</button><button class="btn primary" data-fcm="ok">${L("测试并连接", "Test & connect")}</button></div>`, m => {
    m.classList.add("fc-mdl");
    m.addEventListener("click", e => { const b = e.target.closest("[data-fcm]"); if (b && !b.disabled) { e.preventDefault(); dlgDo(b.dataset.fcm); } });
    m.addEventListener("keydown", e => { if (e.key === "Enter" && !e.isComposing && e.target.matches("#fc-pw, #fc-acct")) { e.preventDefault(); dlgDo("ok"); } });
    setTimeout(() => { const a = $("#fc-acct"); if (a && !a.value) a.focus(); else { const p = $("#fc-pw"); if (p) p.focus(); } }, 30);
  });
}
async function dlgDo(k) {
  const M = FC.m, say = (t, lv) => { M.msg = t || ""; M.lv = lv || ""; };
  if (k === "x") return closeModal();
  if (k === "file") { M.file = true; return dlgPaint(); }
  if (k === "file_no") { M.file = false; return dlgPaint(); }
  if (k === "ok") {
    const a = $("#fc-acct"), p = $("#fc-pw"); const acct = a ? a.value.trim() : ""; let pw = p ? p.value : "";
    if (!acct || !pw.trim()) { say(L("地址和密码都要填", "Fill in both the address and the password"), "bad"); return dlgPaint(); }
    M.acct = acct; M.busy = true; say(""); dlgPaint();
    const r = await fcApi("connect", { source: M.s.id, account: acct, secret: pw });
    pw = ""; M.busy = false;
    if (r.ok) { closeModal(); toast(L(`${P(M.s.label)} 连上了，开始收集新消息`, `${P(M.s.label)} connected; collecting new messages`)); paint(); return; }
    say(errTxt(r.j), "bad"); dlgPaint();
    if (r.j && r.j.can_file && !(FC.st && FC.st.probe)) { await fcApi("probe"); dlgPaint(); }
    return;
  }
  M.busy = true; dlgPaint();
  const r = k === "probe" ? await fcApi("probe") : k === "file_yes" ? await fcApi("use_file", { confirm: true }) : await fcApi("use_keychain");
  M.busy = false; if (k === "file_yes") M.file = false;
  say(r.ok ? (k === "file_yes" ? L("改用本机文件了，再点「测试并连接」", "Switched to a local file; press Test & connect again") : "") : errTxt(r.j), r.ok ? "" : "bad");
  dlgPaint(); paint();
}

// ---------------- rows: in-place switches, then a quiet repaint ----------------
function paint() { if (UI.page === "settings" && UI.setTab === "connections") renderPage(); }
async function rowDo(k, b) {
  const id = b.dataset.src, en = UI.lang === "en";
  if (k === "open") return dlgOpen(id);
  if (k === "toggle") {
    const on = b.getAttribute("aria-pressed") !== "true";
    b.setAttribute("aria-pressed", String(on)); const sw = b.querySelector(".sw"); if (sw) sw.classList.toggle("on", on);   // flip first, so the knob slides
    const r = await fcApi("set", { source: id, enabled: on });
    if (!r.ok) { toast(errTxt(r.j), true); }
    setTimeout(paint, RMQ.matches ? 0 : 260); return;
  }
  if (k === "iv") {
    const v = +b.dataset.v; b.parentElement.querySelectorAll(".seg-i").forEach(x => { const o = x === b; x.classList.toggle("on", o); x.setAttribute("aria-checked", String(o)); });
    const r = await fcApi("set", { source: id, interval: v }); if (!r.ok) toast(errTxt(r.j), true);
    setTimeout(paint, RMQ.matches ? 0 : 260); return;
  }
  if (k === "disconnect" && !(await UI.confirm({ title: L("断开这个连接？", "Disconnect?"), text: L("断开后不再收集，存好的密码会删掉，之后要重新输入。", "Stops collecting and deletes the stored password. You'll need to enter it again later."), ok: L("断开", "Disconnect"), danger: true }))) return;
  FC.busy[id] = k; delete FC.msg[id]; paint();
  const r = await fcApi(k === "poll" ? "poll" : "disconnect", { source: id });
  delete FC.busy[id];
  if (k === "poll") FC.msg[id] = r.ok ? { t: r.j.new ? L(`拉到 ${r.j.new} 封新邮件，已交给管家`, `${r.j.new} new, handed to the steward`) : L("没有新邮件", "Nothing new"), lv: "ok" } : { t: errTxt(r.j), lv: "bad" };
  else if (r.ok) toast(L("已断开，密码已删除", "Disconnected; password deleted") + (r.j.warn ? (en ? " (keychain item could not be removed)" : "（钥匙串条目没删掉）") : ""));
  else toast(errTxt(r.j), true);
  paint();
}
function wireConnections() {
  document.addEventListener("click", e => { const b = e.target.closest("#pagebody [data-fc]"); if (b && !b.disabled) { e.preventDefault(); rowDo(b.dataset.fc, b); } });
  // the status line ages ("3 min ago") and the server polls on its own: refresh while the tab is open
  setInterval(() => { if (UI.page === "settings" && UI.setTab === "connections" && document.visibilityState === "visible" && !Object.keys(FC.busy).length) fcLoad(true).then(paint); }, 30000);
}

export { FC, fcLoad, fcApi, stConnections, wireConnections };
