// sw v7 · Service worker for the home-screen app: shows pushes and opens the right screen when tapped.
// Pushes arrive empty; the text is fetched from the dashboard so nothing needs encrypting.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("push", e => {
  e.waitUntil((async () => {
    // t-i18n-b (sw v6): the fallback line follows this device's UI language. The server sends it as n.lang with every push text;
    // it is kept in Cache Storage for when the dashboard can't be reached (off the tailnet). No saved value: the browser language.
    let lang = "";
    try { const r = await (await caches.open("rt-sw")).match("/__lang"); lang = r ? await r.text() : ""; } catch (_) { }
    if (!lang) lang = /^zh/i.test(self.navigator.language || "") ? "zh" : "en";
    let n = { title: "Underthread", body: lang === "en" ? "New activity" : "有新动态", url: "/" };
    try {
      if (e.data) n = Object.assign(n, e.data.json());
      else {
        // t-imp29-p1 (sw v5): ask for THIS device's notification (tiers and quiet hours make devices differ)
        let ep = ""; try { const sub = await self.registration.pushManager.getSubscription(); ep = sub ? sub.endpoint : ""; } catch (_) { }
        const r = await fetch("/api/push/latest" + (ep ? "?endpoint=" + encodeURIComponent(ep) : ""), { cache: "no-store" });
        if (r.ok) n = Object.assign(n, await r.json());
      }
      if (n.lang && n.lang !== lang) { try { await (await caches.open("rt-sw")).put("/__lang", new Response(n.lang)); } catch (_) { } }
    } catch (_) { /* off the tailnet: show the generic line */ }
    // t-app-badge (sw v4): the icon badge = 「等你拍板」, sent as n.badge by /api/push/latest. An older server sends no badge: leave it alone.
    if (typeof n.badge === "number" && "setAppBadge" in self.navigator) {
      try { await (n.badge > 0 ? self.navigator.setAppBadge(n.badge) : self.navigator.clearAppBadge()); } catch (_) { /* no permission / unsupported */ }
    }
    // iOS revokes the subscription if a push ends without a visible notification, so always show one.
    const tag = String(n.tag || n.id || "underthread-" + Date.now());
    try {
      await self.registration.showNotification(n.title || "Underthread", {
        body: n.body || "", tag, renotify: true,
        icon: "/static/icons/icon-192.png", badge: "/static/icons/icon-192.png", data: { url: n.url || "/" },
      });
    } catch (_) {
      await self.registration.showNotification(n.title || "Underthread", { body: n.body || "", data: { url: n.url || "/" } });
    }
  })());
});

// t-push-deeplink (sw v3): an open app is routed in-page by postMessage (navigate() only changes the hash, which the page never re-read).
// The target is also kept as "pending" for 60s: a page iOS resumes late asks for it (rt-pending) and acks it (rt-ack). No open window: openWindow(url),
// and the page routes from the hash at boot. Each tap is logged to /api/push/log.
let pending = null;   // { id, url, at }
const plog = (b) => fetch("/api/push/log", { method: "POST", headers: { "Content-Type": "application/json", "X-Underthread": "1" }, body: JSON.stringify(Object.assign({ step: "click" }, b)) }).catch(() => { });
const pidOf = url => { const m = /[#&]push=([^&]+)/.exec(url || ""); return m ? m[1] : "c" + Date.now(); };

async function openTarget(url) {   // the whole tap, separate from the event so it can be exercised in tests
  const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const w = wins.find(c => c.visibilityState === "visible") || wins[0];
  if (w) {
    pending = { id: pidOf(url), url, at: Date.now() };
    try { w.postMessage({ type: "rt-route", id: pending.id, url, via: "msg" }); } catch (_) { }
    let focused = "no";
    try { if ("focus" in w) { await w.focus(); focused = "yes"; } } catch (err) { focused = String(err && err.name || err); }
    await plog({ result: "post", name: "wins=" + wins.length + " focus=" + focused, message: url.slice(0, 120) });
    return "post";
  }
  await plog({ result: "open", name: "wins=0", message: url.slice(0, 120) });
  await self.clients.openWindow(url);
  return "open";
}
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(openTarget((e.notification.data && e.notification.data.url) || "/"));
});

self.addEventListener("message", e => {
  const d = e.data || {};
  if (d.type === "rt-ack") { if (pending && pending.id === d.id) pending = null; return; }
  if (d.type === "rt-pending" && pending && e.source) {
    if (Date.now() - pending.at > 60000) { pending = null; return; }
    e.source.postMessage({ type: "rt-route", id: pending.id, url: pending.url, via: "pull" });
  }
});
