/* t-hire-celebration (user 13:04, direction C+): the welcome animation for a new teammate, about 4.8 s, once per hire per browser.
   A lanyard in the role's main colour (roster tint) lowers a white cloth badge; a needle sews a ring round the avatar (the 委托完成 sti-ring
   keyframes from theme-ut.css); name and title are stitched in and knotted; the most recently active teammates hop up from the bottom
   (8 on desk, 6 on a phone), wave while cross-stitch × in the main colour and gold scatter, then all hop toward the badge while the new
   member plays one loop of their work strip (特典 only, avatars/ut/_s/<id>-work-512.webp). Tap / Esc skips. prefers-reduced-motion: the
   finished frame for ~2.4 s, nothing moves. Every theme plays it; outside 特典 the badge shows the role's normal avatar and no work strip.
   Trigger: the server lists recent hires as meta.hires [{id, at, t}] (api/routes/state.py hire_welcomes, from logs/new_role.jsonl).
   localStorage rt.welcome remembers which ones this browser has played (key id@at). The first time a browser sees this feature it plays
   only the newest hire and marks the rest as seen. It waits while the tab is hidden, the opening splash or a 委托完成 splash is up, or the
   market's 撤销 bar for a fresh hire is still showing. CSS: web/css/welcome.css. Test hook: window.HW. */
(function () {
  const KEY = "rt.welcome", SW = "http://www.w3.org/2000/svg";
  let MEM = null, playing = null;
  const load = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || "null"); return v && typeof v === "object" && v.seen ? v : MEM; } catch (_) { return MEM; } };
  const save = m => { MEM = m; try { localStorage.setItem(KEY, JSON.stringify(m)); } catch (_) { } };
  const kOf = h => `${h.id}@${h.at || h.t}`;
  const esc = x => String(x == null ? "" : x).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const phone = () => matchMedia("(max-width: 760px)").matches;
  const rm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  function hires() {
    const A = window.App, ag = (A && A.ST && A.ST.agents) || {};
    return ((A && A.ST && A.ST.meta && A.ST.meta.hires) || []).filter(h => h && h.id && ag[h.id] && ag[h.id].enabled !== false);
  }
  function blocked() {
    return document.visibilityState !== "visible" || document.getElementById("ut-splash") || document.documentElement.dataset.splash
      || document.querySelector(".mc, .hw, [data-mk-undo]");
  }
  function check() {
    const A = window.App; if (!A || !A.ST || !A.ST.meta || playing) return;
    if (!Array.isArray(A.ST.meta.hires)) return;   // an older server: nothing to go on (and nothing to seed)
    const hs = hires();
    let m = load();
    if (!m) { m = { v: 1, seen: {} }; hs.slice(0, -1).forEach(h => { m.seen[kOf(h)] = 1; }); save(m); }   // first time here: only the newest one
    const next = hs.find(h => !m.seen[kOf(h)]);
    if (!next || blocked()) return;
    const a = A.agent(next.id);
    /* 特典: wait (up to 2 min after it was ready) for the avatar manifest to list the new face, so the badge never shows the placeholder */
    if (document.documentElement.dataset.ut && A.avatarUrl && !/\/avatars\/ut\//.test(A.avatarUrl(a, 1)) && Date.now() - Date.parse(next.t) < 120000) return;
    m.seen[kOf(next)] = Date.now();
    const keep = new Set(hs.map(kOf)); Object.keys(m.seen).forEach(k => { if (!keep.has(k) && m.seen[k] !== 1 && Date.now() - m.seen[k] > 30 * 864e5) delete m.seen[k]; });
    save(m);
    play(next.id);
  }

  /* the most recently active teammates: working first, then by last_seen */
  function crewOf(id, n) {
    const A = window.App, ag = Object.values((A.ST && A.ST.agents) || {}).filter(a => a.id !== id && a.enabled !== false);
    const ts = a => Date.parse(a.last_seen || a.since || "") || 0;
    return ag.sort((x, y) => (y.status === "working") - (x.status === "working") || ts(y) - ts(x) || (x.order ?? 99) - (y.order ?? 99)).slice(0, n);
  }

  const NDL = `<svg class="sti-ndl" viewBox="0 0 70 20" aria-hidden="true"><path d="M4 10 L64 10"></path><ellipse cx="56" cy="10" rx="5" ry="1.8"></ellipse></svg>`;
  /* cross-stitch × positions in % of the viewport, [left, top, gold?] */
  const XD = [[5, 52, 0], [23, 64, 1], [74, 60, 0], [91, 52, 1], [13, 18, 1], [83, 18, 0], [22, 38, 0], [76, 36, 1], [8, 84, 0], [92, 82, 1]];
  const XP = [[8, 56, 0], [87, 57, 1], [15, 71, 1], [82, 72, 0], [10, 18, 0], [85, 17, 1], [50, 78, 1], [30, 86, 0]];

  function play(id, o = {}) {
    const A = window.App; if (!A) return null;
    const old = document.querySelector(".hw"); if (old) old.remove();
    const a = A.agent(id), ut = !!document.documentElement.dataset.ut, zh = (A.UI && A.UI.lang || "zh") !== "en", ph = phone();
    const crew = crewOf(id, ph ? 6 : 8);
    const sheet = ut && A.hasArt && A.hasArt(a, "sheet") ? `/avatars/ut/_s/${encodeURIComponent(a.id)}-work-512.webp?v=${encodeURIComponent((A.ST.meta && A.ST.meta.avv) || 1)}` : "";
    const nm = A.aname(a), tt = A.atitle ? A.atitle(a) : (a.title || "");
    const el = document.createElement("div");
    el.className = "hw" + (rm() || o.reduce ? " hw-rm" : "") + (ph ? " hw-ph" : "");
    el.dataset.id = id;
    el.setAttribute("role", "status");
    el.setAttribute("aria-label", (zh ? "新同伴入职：" : "New teammate: ") + nm + (tt ? " · " + tt : ""));
    el.style.setProperty("--main", A.tintOf ? A.tintOf(a) : (a.tint || a.color || "#7aa6b8"));
    el.style.setProperty("--n", crew.length);
    const xs = (ph ? XP : XD).map(([x, y, g], i) => `<i class="hw-x${g ? " g" : ""}" style="left:${x}%;top:${y}%;--k:${i}">×</i>`).join("");
    el.innerHTML = `<div class="hw-dim"></div>
      <div class="hw-hang"><div class="hw-swing"><i class="hw-lan"></i>
        <div class="hw-badge"><i class="hw-slot"></i>
          <div class="hw-av"><img class="hw-img" alt="" src="${esc(A.avatarUrl(a, 1))}" decoding="async">${sheet ? `<i class="hw-sheet" style="background-image:url('${esc(sheet)}')"></i>` : ""}
            <svg class="hw-ring" viewBox="-50 -50 100 100" aria-hidden="true"><circle r="46"></circle></svg>
            <div class="hw-orb sti-orb">${NDL}</div></div>
          <b class="hw-nm">${esc(nm)}</b><span class="hw-tt">${esc(tt)}</span><i class="hw-knot"></i>
        </div></div></div>
      <div class="hw-crew">${crew.map((c, i) => `<div class="hw-m" style="--i:${i};--o:${(crew.length - 1) / 2 - i}" data-id="${esc(c.id)}"><i class="hw-sh"></i><div class="hw-w"><div class="hw-l"><img alt="" src="${esc(A.avatarUrl(c))}" decoding="async"></div></div></div>`).join("")}</div>
      ${xs}<div class="hw-skip">${zh ? "点任意处跳过" : "Tap anywhere to skip"}</div>`;
    let ended = false;
    const finish = () => { if (ended) return; ended = true; clearTimeout(guard); removeEventListener("keydown", key); el.remove(); playing = null; try { o.onEnd && o.onEnd(); } catch (_) { } setTimeout(check, 400); };
    const skip = () => { if (el.classList.contains("bye")) return; el.classList.add("bye"); setTimeout(finish, 260); };
    const key = e => { if (e.key === "Escape") skip(); };
    /* animationend can be skipped (hidden tab): never leave the overlay behind. A paused timeline (tests seeking frames) is left alone. */
    const late = () => { const a = el.getAnimations ? el.getAnimations().find(x => /^hw-life/.test(x.animationName)) : null; if (a && a.playState === "paused") guard = setTimeout(late, 1000); else finish(); };
    let guard = setTimeout(late, el.classList.contains("hw-rm") ? 3000 : 5400);
    el.addEventListener("click", e => { e.stopPropagation(); skip(); });
    el.addEventListener("animationend", e => { if (e.target === el && /^hw-life/.test(e.animationName)) finish(); });
    addEventListener("keydown", key);
    document.body.appendChild(el);
    playing = el;
    return el;
  }

  function wire() {
    const A = window.App;
    if (!A || !A.on) return setTimeout(wire, 300);
    A.on(() => setTimeout(check, 0));
    setInterval(check, 3000);
    document.addEventListener("visibilitychange", check);
  }
  wire();
  window.HW = { play, check, crewOf, reset: () => { MEM = null; try { localStorage.removeItem(KEY); } catch (_) { } }, get playing() { return playing; } };
})();
