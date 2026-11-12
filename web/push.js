// Push notifications for the home-screen app. iOS only allows web push once the page
// is added to the Home Screen and opened from there (iOS 16.4+), and only over HTTPS.
// Every step reports to /api/push/log so failures show up in logs/server.log.
(function () {
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const capable = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  let reg = null, sub = null, busy = false, key = null, srv = null, lastErr = "";
  const en = () => window.App && App.UI.lang === "en";
  const perm = () => ("Notification" in window ? Notification.permission : "unsupported");
  const toast = (m, bad) => window.App && App.toast(m, bad);

  const post = (u, b) => fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b || {}) })
    .then(async r => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`${u} → HTTP ${r.status}${j.error ? " " + j.error : ""}`);
      return j;
    });
  function log(step, extra) {
    try {
      fetch("/api/push/log", {
        method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
        body: JSON.stringify(Object.assign({ step, perm: perm(), standalone, ios, secure: isSecureContext, has_sub: !!sub }, extra || {})),
      }).catch(() => { });
    } catch (_) { }
  }
  const errInfo = e => ({ name: (e && e.name) || "Error", message: String((e && e.message) || e) });
  const timeout = (p, ms, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what} timed out after ${ms / 1000}s`)), ms))]);
  const b64 = s => { const p = "=".repeat((4 - s.length % 4) % 4), raw = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(raw, c => c.charCodeAt(0)); };
  const lang = () => (window.App && App.UI && App.UI.lang) || (() => { try { return JSON.parse(localStorage.getItem("rt.lang")) || "zh"; } catch (_) { return "zh"; } })();
  const payload = () => ({ subscription: sub.toJSON(), origin: location.origin, ua: navigator.userAgent, lang: lang() });   /* t-i18n-b: push text in this device's UI language */
  const changed = () => { try { document.dispatchEvent(new Event("push:change")); } catch (_) { } };

  async function refresh() {
    try {
      const r = await fetch("/api/push/status" + (sub ? "?endpoint=" + encodeURIComponent(sub.endpoint) : ""), { cache: "no-store" });
      if (r.ok) srv = await r.json();
    } catch (_) { }
    changed();
  }
  async function getKey() {
    if (!key) key = (await (await fetch("/api/push/key", { cache: "no-store" })).json()).key;
    return key;
  }

  async function init() {
    if (!("serviceWorker" in navigator) || !isSecureContext) { if (ios) log("open", { result: "no-sw-or-insecure" }); return; }
    try {
      reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      getKey().catch(() => { });  // prefetch so the tap goes straight from permission to subscribe
      sub = reg.pushManager ? await reg.pushManager.getSubscription() : null;
      if (sub && perm() === "granted") await post("/api/push/subscribe", payload());  // re-register this device every open
    } catch (e) { lastErr = errInfo(e).message; log("init-error", errInfo(e)); }
    await refresh();
    if (standalone) log("open", { server_has_me: !!(srv && srv.mine) });
  }

  function status() {
    if (!isSecureContext) return { on: false, label: en() ? "Needs the https:// Tailscale address" : "需要用 https 的 Tailscale 地址打开" };
    if (ios && !standalone) return { on: false, label: en() ? "Add to Home Screen first, then open it from there" : "先「添加到主屏幕」，再从主屏幕打开" };
    if (!capable) return { on: false, label: en() ? "Not supported in this browser" : "这个浏览器不支持推送" };
    const p = perm(), n = srv ? srv.devices : "?";
    const me = srv && srv.me, code = me && me.last_code;
    const diag = (en() ? `permission ${p} · this device ${sub ? "subscribed" : "not subscribed"} · server ${srv && srv.mine ? "has it" : "doesn't have it"} (${n} total)`
      : `权限 ${p} · 本机${sub ? "已订阅" : "未订阅"} · 服务器${srv && srv.mine ? "已登记" : "未登记"}（共 ${n} 台）`)
      + (code != null ? (en() ? ` · last send ${code}` : ` · 上次发送 ${code}`) : "")
      + (lastErr ? ` · ${lastErr.slice(0, 80)}` : "");
    if (p === "denied") return { on: false, label: en() ? "Blocked in iOS Settings → Notifications" : "已在系统设置 → 通知 中关闭", diag };
    if (sub && p === "granted") return { on: true, label: en() ? "On · reviews and replies reach this device" : "已开启 · 待审核和回复会推到这台设备", diag };
    return { on: false, label: en() ? "Off · tap to turn on" : "未开启 · 点一下开启", diag };
  }

  async function toggle() {
    if (busy) return; busy = true; lastErr = "";
    try {
      if (sub) {
        const endpoint = sub.endpoint; await sub.unsubscribe(); sub = null;
        await post("/api/push/unsubscribe", { endpoint });
        log("off");
        toast(en() ? "Notifications off" : "已关闭推送");
        return;
      }
      if (!capable || (ios && !standalone)) { log("blocked", { result: status().label }); toast(status().label, true); return; }
      let p = perm();
      if (p !== "granted") p = await Notification.requestPermission();  // first await inside the tap
      log("permission", { result: p });
      if (p !== "granted") { toast(status().label, true); return; }
      if (!reg) reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      const k = await getKey();
      const r = reg.active ? reg : await timeout(navigator.serviceWorker.ready, 5000, "serviceWorker.ready");
      sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(k) });
      log("subscribed", { endpoint_host: new URL(sub.endpoint).host });
      await post("/api/push/subscribe", payload());
      await refresh();
      toast(en() ? "Notifications on" : "推送已开启");
      setTimeout(test, 600);
    } catch (e) {
      const i = errInfo(e); lastErr = `${i.name}: ${i.message}`;
      log("error", i);
      toast(lastErr, true);
    } finally { busy = false; changed(); }
  }

  function test() {
    return post("/api/push/test", {}).then(r => {
      toast(en() ? `Sent to ${r.sent}/${r.devices} device(s) · ${(r.codes || []).join(",")}` : `已发送 · ${r.sent}/${r.devices} 台设备 · 返回码 ${(r.codes || []).join(",") || "无"}`, !r.sent);
      setTimeout(refresh, 300);
    }).catch(e => toast(String(e.message || e), true));
  }

  // t-push-deeplink: a tapped notification while the app is already open. sw.js posts {type:"rt-route"} to this page and also keeps it as
  // "pending" for a minute, because iOS can resume a suspended page after the message was sent; so the page asks again when it comes back.
  // Cold starts route from the URL hash in app.js boot (event rt:routed). Every route is reported to logs/server.log.
  function routeTo(url, via) {
    const run = () => {
      if (!window.App || !App.ST) return setTimeout(run, 120);
      let r = "error";
      try { r = App.route(String(url || "/"), via); } catch (e) { log("route", { result: "error", name: via, message: String(e && e.message || e) }); return; }
      if (r !== "dup") log("route", { result: r, name: via, message: String(url).slice(0, 120) });
    };
    run();
  }
  document.addEventListener("rt:routed", e => { const d = e.detail || {}; if (d.result !== "none") log("route", { result: d.result, name: d.via, message: (location.pathname + " push=" + (d.push || "")).slice(0, 120) }); });
  if ("serviceWorker" in navigator) {
    const sw = navigator.serviceWorker, seen = new Set();
    sw.addEventListener("message", e => {
      const d = e.data || {};
      if (d.type !== "rt-route") return;
      try { (e.source || sw.controller) && (e.source || sw.controller).postMessage({ type: "rt-ack", id: d.id }); } catch (_) { }
      if (seen.has(d.id)) return;
      seen.add(d.id); routeTo(d.url, d.via || "msg");
    });
    const ask = () => { try { if (sw.controller) sw.controller.postMessage({ type: "rt-pending" }); } catch (_) { } };
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") ask(); });
    addEventListener("focus", ask);
    ask();
  }

  // t-imp29-p1: this device's tier / quiet hours / digest (stored on its server row), and its last 24 h of sends for the chart
  let hist = null, histAt = 0;
  const prefs = () => (srv && srv.me && srv.me.prefs) || null;
  async function setPrefs(p) {
    if (!sub) return null;
    try {
      const r = await post("/api/push/prefs", { endpoint: sub.endpoint, prefs: p });
      log("prefs", { result: JSON.stringify(r.prefs).slice(0, 110) });
      if (srv && srv.me) srv.me.prefs = r.prefs;
      changed();
      return r.prefs;
    } catch (e) { const i = errInfo(e); lastErr = i.message; log("prefs-error", i); toast(i.message, true); changed(); return null; }
  }
  function history() {
    if (sub && Date.now() - histAt > 60000) {
      histAt = Date.now();
      fetch("/api/push/history?endpoint=" + encodeURIComponent(sub.endpoint), { cache: "no-store" }).then(r => r.ok ? r.json() : null)
        .then(j => { if (j) { hist = j; changed(); } }).catch(() => { });
    }
    return hist;
  }

  // t-i18n-b: a language switch tells the server at once (subscribe also re-sends it on every open)
  function setLang(l) { if (sub) post("/api/push/prefs", { endpoint: sub.endpoint, lang: l }).then(() => log("lang", { result: l }), e => log("lang-error", errInfo(e))); }
  window.Push = { status, toggle, test, refresh, prefs, setPrefs, history, lang: setLang };
  init();
})();
