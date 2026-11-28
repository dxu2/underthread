// Dashboard core: page switching (pageAlias, go) and the one deep-link router (route) for #item= / #dm= / #rep= / #page= / push taps.
// t-oss-struct S10 (A2): moved out of app.js unchanged.

import { $, LS } from "./util.js";
import { ST, UI, archKnown } from "./store.js";
import { api, closeModal } from "./ui.js";
import { setChat } from "../views/chat.js";
import { PHONE, closeItem, openItem } from "../views/drawer.js";
import { STU, renderLeft, stuList } from "../views/left.js";
import { MB, closeMailbox } from "../views/mail.js";
import { renderPage } from "../views/pages/index.js";
const pageAlias = p => { if (p === "studio") { const l = LS.get("stuTab", "pipe"), sl = stuList(); return sl.includes(l) ? l : sl[0]; }   /* t-oss-gen-s5: no content mode -> 委托板 */ if (["docs", "logs"].includes(p)) { UI.setTab = p; LS.set("setTab", p); return "settings"; } return p === "home" ? "review" : p === "team" || p === "roles" ? "crew" : p; };   /* t-roster-rail: 团队 / Team is a page again (the roster); old #page=roles / team links land there */   /* t-drop-team-tab: old 团队 links land on 首页 */   // t-settings-tab: old pages = 设置 tabs   // r-improve-1102 P5: #page=home (the phone 首页 tab's name) = the 首页 page, key "review"
function go(p) {
  p = pageAlias(p);
  // the "new" group on the review page compares against when you last left it
  if (UI.page === "review" && p !== "review") { UI.seen.review = new Date().toISOString(); LS.set("seen", UI.seen); }
  if (STU.includes(p)) LS.set("stuTab", p);
  UI.page = p; LS.set("page", p); closeItem(true); renderLeft(); renderPage(true);
  { /* r-improve-1125 P5: the header is drawn on the next poll; light / unlight the 信箱 icon now (renderHeader draws the same state) */
    const b = document.querySelector('button.hc-mail[data-h="mail"]'), on = p === "mail" && !matchMedia("(max-width: 760px)").matches;
    if (b) { b.classList.toggle("ri25-on", on); if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); } }
  /* r-improve-1121 P2: a #page= link that opened the board would win on the next reload; keep it in step with the page shown */
  if (/(^#|&)page=/.test(location.hash)) { try { const H = new URLSearchParams(location.hash.slice(1)); H.set("page", p); history.replaceState(history.state, "", "#" + H.toString()); } catch (_) { } }
  window.FX && FX.enter($("#pagebody"));
}

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
    if (P.get("mail")) api("mail_read", { ids: P.get("mail").split(","), push: pid }).catch(() => { });   /* t-oss-secreview P2-3: the server checks pid was its own notification */
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

export { pageAlias, go, routed, route };
