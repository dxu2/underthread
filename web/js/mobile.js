// iPhone layer: one screen at a time, a floating tab bar, and three layouts to choose from.
//   A "tabs"  – review / quests / + / steward / menu
//   B "chat"  – opens on the steward chat; items waiting on you ride along as a strip on top
//   C "deck"  – opens on a Hallownest-style menu; review is a swipeable deck (→ approve, ← reject, ↑ later)
// t-oss-struct S10 (A8): this file is the phone spine: shared state (layout mv, tab, deck index), the phone modules in web/phone/ and their
// wirePh*() calls in the order the code used to run. mv / lastQ / deckIdx / dragging / ready are assigned elsewhere through their set*() functions.
import { wirePhNav, wirePhNav2 } from "./phone/nav.js";
import { wirePhDeck } from "./phone/deck.js";
import { wirePhComposer } from "./phone/composer.js";
import { wirePhChatList } from "./phone/chatlist.js";
import { onMQ, sync, wirePhSearch } from "./phone/search.js";
import { wirePhGestures } from "./phone/gestures.js";
import { wirePhTheme } from "./phone/theme.js";
import { wirePhMenu } from "./phone/menu.js";
import { wirePhPull } from "./phone/pull.js";
import { wirePhHello } from "./phone/hello.js";
const mq = matchMedia("(max-width: 760px)");
const $ = (s, el = document) => el.querySelector(s);
const LS = {
  get(k, d) { try { const v = localStorage.getItem("rt." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("rt." + k, JSON.stringify(v)); } catch { } },
};
const H = new URLSearchParams(location.hash.slice(1));
let mv = H.get("mv") || "tabs";  // A is the chosen phone layout; B/C stay reachable via #mv=chat / #mv=deck
function setMv(v) { return mv = v; }   /* S10: other modules assign mv through this */
let deckIdx = 0, dragging = false, ready = false;
function setReady(v) { return ready = v; }   /* S10: other modules assign ready through this */
function setDragging(v) { return dragging = v; }   /* S10: other modules assign dragging through this */
function setDeckIdx(v) { return deckIdx = v; }   /* S10: other modules assign deckIdx through this */
const HOME = { tabs: ["page", "review"], chat: ["chat"], deck: ["menu"] };
const CATS = ["main", "side", "daily", "urgent", "ongoing", "board"];
const en = () => App.UI.lang === "en";

const ICON = {
  review: '<path d="M12 3 L20 12 L12 21 L4 12 Z"/><path d="M12 8 L15.5 12 L12 16 L8.5 12 Z"/>',
  quests: '<path d="M7 4h10a2 2 0 0 1 2 2v12.5a1.5 1.5 0 0 1-3 0V7H7a1.5 1.5 0 0 1 0-3z"/><path d="M10 10.5h5M10 13.5h5M10 16.5h3"/>',
  chat: '<path d="M4 6.5C4 5 5 4 6.5 4h11C19 4 20 5 20 6.5v7c0 1.5-1 2.5-2.5 2.5H11l-4.5 4v-4C5 16 4 15 4 13.5z"/><path d="M8.5 10h.01M12 10h.01M15.5 10h.01"/>',
  team: '<circle cx="9" cy="8" r="3"/><circle cx="16.5" cy="9.5" r="2.3"/><path d="M3.5 19c.6-3.4 2.8-5 5.5-5s4.9 1.6 5.5 5"/><path d="M14.8 14.6c2.6-.4 4.8 1 5.4 4.4"/>',
  menu: '<path d="M4 7h16M4 12h10M4 17h16"/><path d="M18 10.3 L19.7 12 L18 13.7 L16.3 12 Z"/>',
  home: '<path d="M4 11 L12 4 L20 11 V19 a1 1 0 0 1 -1 1 H5 a1 1 0 0 1 -1 -1 Z"/><path d="M10 20 v-5 h4 v5"/>',
  bell: '<path d="M6 17 V11 a6 6 0 0 1 12 0 V17 l1.5 2 H4.5 Z"/><path d="M10 21 h4"/>',
  more: '<path d="M5.5 12 h.01 M12 12 h.01 M18.5 12 h.01" stroke-width="3.2"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16 L20.5 20.5"/>',
  deck: '<rect x="6" y="5" width="12" height="15" rx="1.5"/><path d="M8.5 3h7"/><path d="M12 9.5 L14 12.5 L12 15.5 L10 12.5Z"/>',
};
const svg = k => `<svg viewBox="0 0 24 24">${ICON[k]}</svg>`;
// ui15: ONE pill bar for every phone layout (the old per-layout sets were dev variants; 5 fixed tabs like Slack)
const BAR5 = [{ k: "home", i: "home", zh: "首页", en: "Home", to: ["page", "review"] }, { k: "dms", i: "chat", zh: "对话", en: "Chats", to: ["chat"] },
  { k: "activity", i: "bell", zh: "动态", en: "Activity", to: ["page", "mail"] }, { k: "more", i: "more", zh: "更多", en: "More", to: ["menu"] },
  { k: "quests", i: "quests", zh: "委托", en: "Quests", to: ["page", "quests"] }];   // t-vis-b2: 委托 replaces 搜索; search lives at the top of the 委托 page
const BARS = {
  tabs: [{ k: "review", i: "review", zh: "首页", en: "Home", to: ["page", "review"] }, { k: "quests", i: "quests", zh: "委托", en: "Quests", to: ["page", "main"] },
    { k: "chat", i: "chat", zh: "管家", en: "Steward", to: ["chat"] }, { k: "menu", i: "menu", zh: "菜单", en: "Menu", to: ["menu"] }],
  chat: [{ k: "chat", i: "chat", zh: "对话", en: "Chat", to: ["chat"] }, { k: "review", i: "review", zh: "首页", en: "Home", to: ["page", "review"] },
    { k: "team", i: "team", zh: "团队", en: "Team", to: ["page", "crew"] }, { k: "menu", i: "menu", zh: "菜单", en: "Menu", to: ["menu"] }],
  deck: [{ k: "menu", i: "menu", zh: "菜单", en: "Menu", to: ["menu"] }, { k: "review", i: "deck", zh: "卡组", en: "Deck", to: ["page", "review"] },
    { k: "chat", i: "chat", zh: "管家", en: "Steward", to: ["chat"] }],
};

const QPAGES = ["quests", "main", "side", "daily", "urgent", "ongoing"];   // t-vis-b2: the pages that live under the 委托 tab
let lastQ = "quests";
function setLastQ(v) { return lastQ = v; }   /* S10: other modules assign lastQ through this */
wirePhNav();
wirePhDeck();
wirePhNav2();
wirePhChatList();
wirePhSearch();
mq.addEventListener("change", onMQ);
const boot = () => { if (!window.App) return setTimeout(boot, 50); App.on(sync); sync(); };
boot();
wirePhGestures();
wirePhComposer();
wirePhTheme();
wirePhMenu();
wirePhPull();
wirePhHello();

export { QPAGES, en, $, BAR5, lastQ, svg, setLastQ, mq, dragging, setDeckIdx, deckIdx, setDragging, LS, HOME, mv, setMv, ready, setReady, H };
