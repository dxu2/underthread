// t-oss-location: 「用我的位置 / Use my location」. Shown under the steward's first message (next to the name field) and in
// Settings → General → You. The browser asks (navigator.geolocation, works on localhost and https); the board keeps only
// lat / lon rounded to 2 decimals (about 1 km) plus the browser's time zone, in config.json owner.location (action owner_location).
// No reverse geocoding, no other service. "Not now" / a denied prompt is recorded and never asked again; Settings can clear it.
import { ST, UI } from "../core/store.js";
import { postAct, toast } from "../core/ui.js";

const L = (z, e) => (UI.lang === "en" ? e : z);
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-6.2-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.3"/></svg>';
export const locNow = () => (ST.meta && ST.meta.owner_loc) || null;
const fmt = v => `${v.lat}, ${v.lon}${v.tz ? " · " + v.tz : ""}`;

// where = "chat" (under the first greeting) | "set" (a Settings row)
export function locHTML(where) {
  const v = locNow(), has = v && v.lat != null, no = v && v.declined;
  if (where === "set") {
    const sub = has ? L(`已记下大概位置（约 1 km）：${fmt(v)}`, `Rough location saved (about 1 km): ${fmt(v)}`)
      : no ? L("你选了不用位置。天气之类会按时区猜。", "You chose not to share it. Weather and the like go by time zone.")
      : L("还没给过。只存到小数点后两位（约 1 km），只存在这台电脑的 config.json。", "Not shared yet. Kept to 2 decimals (about 1 km), only in config.json on this computer.");
    const btns = `<button type="button" class="ask-nm-skip ask-loc-go" data-loc-go>${PIN}${has ? L("重新获取", "Update") : L("用我的位置", "Use my location")}</button>`
      + (v ? `<button type="button" class="ask-nm-skip" data-loc-clear>${L("清除", "Clear")}</button>` : "");
    return `<div class="st-row st-loc" data-ask-loc="set"><span class="st-tx"><b>${L("位置", "Location")}</b><small>${esc(sub)}</small></span><span class="st-loc-b">${btns}</span></div>`;
  }
  if (has) return `<div class="ask-loc done" data-ask-loc="chat">✓ ${L("已记下大概位置（约 1 km）", "Rough location saved (about 1 km)")}<small> · ${esc(fmt(v))}</small></div>`;
  if (no) return `<div class="ask-loc done" data-ask-loc="chat">✓ ${L("不用位置", "No location")}<small>${L(" · 想用随时在 设置 → 通用 里开", " · turn it on any time in Settings → General")}</small></div>`;
  return `<div class="ask-loc" data-ask-loc="chat"><button type="button" class="ask-nm-skip ask-loc-go" data-loc-go>${PIN}${L("用我的位置", "Use my location")}</button>`
    + `<button type="button" class="ask-nm-skip ask-loc-no" data-loc-no>${L("不用", "Not now")}</button>`
    + `<small>${L("天气、日出用；只存约 1 km 精度，在这台电脑上", "For weather and sunrise; kept to about 1 km, on this computer")}</small></div>`;
}

function repaint() { document.querySelectorAll("[data-ask-loc]").forEach(n => { n.outerHTML = locHTML(n.dataset.askLoc); }); }

async function send(body, local) {
  try { await postAct("owner_location", body); ST.meta.owner_loc = local; repaint(); }
  catch (e) { toast(L("没存上：", "Not saved: ") + String(e.message || e), true); }
}

function locate(btn) {
  if (!navigator.geolocation || !window.isSecureContext) { toast(L("这个地址拿不到位置：要用 localhost 或 https 打开", "This address can't read location: open the board on localhost or https"), true); return; }
  if (btn.dataset.busy) return; btn.dataset.busy = "1"; btn.classList.add("busy");
  const done = () => { delete btn.dataset.busy; btn.classList.remove("busy"); };
  navigator.geolocation.getCurrentPosition(p => {
    done();
    const r = x => Math.round(x * 100) / 100, lat = r(p.coords.latitude), lon = r(p.coords.longitude);
    let tz = ""; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { }
    send({ lat, lon, tz }, { lat, lon, tz });
  }, err => {
    done();
    if (err && err.code === 1) send({ declined: true }, { declined: true });   // the browser prompt said no: record it, never ask again
    else toast(L("这次没拿到位置，稍后再试", "Couldn't get a location this time; try again later"), true);
  }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
}

export function wireLoc() {
  document.addEventListener("click", e => {
    const b = e.target.closest && e.target.closest("[data-loc-go],[data-loc-no],[data-loc-clear]"); if (!b) return;
    e.preventDefault();
    if (b.dataset.locGo != null) return locate(b);
    if (b.dataset.locNo != null) return send({ declined: true }, { declined: true });
    if (b.dataset.locClear != null) return send({ clear: true }, null);
  });
}
