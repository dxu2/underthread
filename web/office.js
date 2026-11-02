// Pixel office: one open-plan room. Working agents sit at their desks, idle ones drift to
// the pantry and lounge, long-idle ones nap in the bunk. Everything is drawn in code.
(function () {
  // px2: one coordinate system. The scene is 960x496 scene px, and the room art, DESKS/SPOTS/paths, hit-testing and the
  // DOM overlay all use those same units (the old 480x248 layout grid and its x2 legacy layer are gone).
  const W = 960, H = 496, SW = W, SH = H;

  // ---------- utils ----------
  function hex(c) { c = (c || "#999999").replace("#", ""); if (c.length === 3) c = c.split("").map(x => x + x).join(""); return [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16)); }
  function shade(c, k) { const [r, g, b] = hex(c); const f = v => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k))); return `rgb(${f(r)},${f(g)},${f(b)})`; }
  function mix(a, b, t) { const A = hex(a), B = hex(b); return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join(""); }
  function hsh(n) { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15); return (n >>> 0) / 4294967296; }
  function strHash(s) { let h = 7; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 2654435761); return h >>> 0; }
  const R = (c, x, y, w, h, col) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), w, h); };
  const P = (c, x, y, col) => R(c, x, y, 1, 1, col);
  function mk(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d"); x.imageSmoothingEnabled = false; return [c, x]; }
  // sleep "z": a 5x5 glyph in 1px strokes with a 2px-thick diagonal so it survives the ~1x phone scale
  function pixZ(c, x, y, col) { c.fillStyle = col; x = Math.round(x); y = Math.round(y); c.fillRect(x, y, 5, 1); c.fillRect(x, y + 4, 5, 1); for (let i = 1; i < 4; i++) c.fillRect(x + 3 - i, y + i, 2, 1); }

  // ---------- palette ----------
  const K = {
    wall: "#1a2036", wall2: "#151a2d", wallHi: "#232b47", trim: "#0e1222", wains: "#131829",
    wood1: "#3b3349", wood2: "#352e43", wood3: "#2f293c", seam: "#2a2437",
    tile1: "#46527a", tile2: "#3f4a6f", grout: "#2e3755",
    deskTop: "#4f5677", deskHi: "#626a8f", deskEdge: "#3a4062", deskFront: "#272c45", deskLine: "#1d2135",
    chair: "#2e3459", chairHi: "#40487a", bezel: "#0f121d",
    skin: "#f3d6c1", skinSh: "#e4b9a2", skinLine: "#a8706a", blush: "#ee9fa0", mouth: "#b9545d", white: "#ffffff",
    legs: "#2a2e46", shoes: "#16182a", sole: "#0b0c14",
  };

  // ---------- characters ----------
  // px2: hand-drawn 2x templates, 32 cols x 36 rows (the body is 24 wide in cols 4-27; the 4-col margins hold twin
  // tails, ponytails and headphone cups). One char = one scene pixel. Legend (colours in palette()):
  //   o hair outline  h hair  H hair shine  j hair shadow   s skin  S skin shade  x skin outline
  //   E lash/upper iris  e iris  i lower iris  w eye glint  b blush  m mouth
  //   O outfit outline  c outfit  C outfit shade  T outfit light   l legs  f shoes  d sole/leg outline
  const FRONT = [
    "............oooooooo............", ".........ooohhhhhhhhooo.........",
    ".......oohhhhhhhhhhhhhhoo.......", "......ohhhhhhHHHhhhhhhhhho......",
    ".....ohhhhHHHhhhhhhhhhhhhho.....", ".....ohhhHHhhhhhhhhhhhhhhho.....",
    "....ohhhHhhhhhhhhhhhhhhhhjho....", "....ohhhhhhhhhhhhhhhhhhhhjho....",
    "....ohhhhhhhhhhhhhhhhhhhjjho....", "....ohhhsshhhshhhhshhhsshjho....",
    "....ohhSsssshsssssshssssSjho....", "....ohhSEEEEssssssssEEEESjho....",
    "....ohhSswEEsssssssswEEsShho....", "....ohhSsEeessssssssEeesShho....",
    "....ohhSseeesssssssseeesShho....", "....ohhSsiiissssssssiiisShho....",
    "....ohhSbbssssssssssssbbShho....", "....ohhSsssssssmmsssssssShho....",
    ".....hhxSssssssssssssssSxhh.....", ".....oo.xxssssssssssssxx.oo.....",
    "..........xxxxSssSxxxx..........", "..........OOOcSssScOOO..........",
    "........OOcccccSScccccOO........", ".......OTccccccccccccccTO.......",
    "......OTccccccccccccccccTO......", "......OcCccccccccccccccCcO......",
    "......OcCccccccccccccccCcO......", "......OcCccccccccccccccCcO......",
    ".....xssCccccccccccccccCssx.....", ".....xxsOCCCCCCCCCCCCCCOsxx.....",
    "........OCCCCCCCCCCCCCCO........", ".........OOOOOOOOOOOOOO.........",
    ".........dllld....dllld.........", ".........dllld....dllld.........",
    "........dffffd....dffffd........", "........dddddd....dddddd........",
  ];
  const BACK = [
    "............oooooooo............", ".........ooohhhhhhhhooo.........",
    ".......oohhhhhhhhhhhhhhoo.......", "......ohhhhhhHHHhhhhhhhhho......",
    ".....ohhhhHHHhhhhhhhhhhhhho.....", ".....ohhhHHhhhhhhhhhhhhhhho.....",
    "....ohhhHhhhhhhhhhhhhhhhhjho....", "....ohhhhhhhhhhhhhhhhhhhhjho....",
    "....ohhhhhhhhhhhhhhhhhhhjjho....", "....ohhhhhhhhhhhhhhhhhhhhjho....",
    "....ohhhhhhhhhhhhhhhhhhhhjho....", "....ohhhhhhhhhhhhhhhhhhhhjho....",
    "....ohhhhhhhhhhhhhhhhhhhhhho....", "....ohhhhhhhhhhhhhhhhhhhhhho....",
    "....ohjhhhhhhhhhhhhhhhhhhjho....", "....ohjhhhhhhhhhhhhhhhhhhjho....",
    "....ohjjhhhhhhhhhhhhhhhhjjho....", "....ohjjhhhhhhhhhhhhhhhhjjho....",
    ".....ojjjhhhhhhhhhhhhhhjjjo.....", "......oojjjjhhhhhhhhjjjjoo......",
    "........oooojjjjjjjjoooo........", "..........OOOxSSSSxOOO..........",
    "........OOcccCCCCCCcccOO........", ".......OTccccccccccccccTO.......",
    "......OTccccccccccccccccTO......", "......OcCccccccccccccccCcO......",
    "......OcCccccccccccccccCcO......", "......OcCccccccccccccccCcO......",
    ".....xssCccccccccccccccCssx.....", ".....xxsOCCCCCCCCCCCCCCOsxx.....",
    "........OCCCCCCCCCCCCCCO........", ".........OOOOOOOOOOOOOO.........",
    ".........dllld....dllld.........", ".........dllld....dllld.........",
    "........dffffd....dffffd........", "........dddddd....dddddd........",
  ];
  // Look per roster id; unknown ids get a stable random look. Swap these freely.
  const LOOKS = {
    manager: { hair: "#7a2f2a", style: "long", outfit: "#d9714f", eye: "#8a2b1f", acc: "ribbon" },
    scout: { hair: "#2f2440", style: "bob", outfit: "#3f8f8a", eye: "#5b3c7a", acc: "glasses" },
    writer: { hair: "#c9963e", style: "twin", outfit: "#e3d3a8", eye: "#6b4a1e", acc: "pen" },
    director: { hair: "#2a2733", style: "short", outfit: "#7a5aa8", eye: "#3a2a5a", acc: "headphones" },
    artist: { hair: "#e37aa1", style: "pony", outfit: "#f1eadc", eye: "#9a3a62", acc: "beret" },
    ops: { hair: "#3d8a67", style: "short", outfit: "#2f4a6e", eye: "#1f5a43", acc: "headset" },
    smith: { hair: "#b9c0cc", style: "short", outfit: "#5a6478", eye: "#3a4a6a", acc: "goggles" },
  };
  const HAIRS = ["#2a2733", "#5a3a2a", "#c9963e", "#7a2f2a", "#3d4f8a", "#b9c0cc", "#e37aa1"];
  const STYLES = ["short", "bob", "long", "pony", "twin"];
  function lookFor(a) {
    const base = a.look || LOOKS[a.id];
    if (base) return { outfit: a.color || "#8fb8de", eye: "#333355", style: "short", hair: "#2a2733", ...base };
    const h = strHash(a.id);
    return { hair: HAIRS[h % HAIRS.length], style: STYLES[(h >> 3) % STYLES.length], outfit: a.color || "#8fb8de", eye: "#333355", acc: null };
  }

  function buildGrid(look, view, opt) {
    const g = (view === "back" ? BACK : FRONT).map(r => r.split(""));
    const put = (r, c, ch) => { if (r >= 0 && r < 36 && c >= 0 && c < 32) g[r][c] = ch; };
    const under = (r, c, ch) => { if (r >= 0 && r < 36 && c >= 0 && c < 32 && g[r][c] === ".") g[r][c] = ch; };   // behind the body
    const sym = (r, c, ch, f = put) => { f(r, c, ch); f(r, 31 - c, ch); };                                          // mirrored pair
    const span = (r, c0, c1, ch) => { for (let c = c0; c <= c1; c++) put(r, c, ch); };
    const st = look.style, front = view === "front";
    if (front) {
      if (st === "bob" || st === "long") {
        for (let r = 9; r <= 21; r++) { sym(r, 2, "o"); sym(r, 3, r > 16 ? "j" : "h"); sym(r, 4, "h"); sym(r, 5, "h"); }
        if (st === "bob") { sym(22, 2, "o"); sym(22, 3, "o"); sym(22, 4, "o"); sym(21, 5, "o"); }
      }
      if (st === "long") {
        for (let r = 18; r <= 29; r++) for (let c = 4; c <= 9; c++) sym(r, c, c >= 6 ? "j" : "h", under);   // behind the shoulders
        for (let r = 16; r <= 29; r++) { sym(r, 0, "o", under); sym(r, 1, r > 25 ? "j" : "h", under); sym(r, 2, "h"); sym(r, 3, r > 25 ? "j" : "h"); sym(r, 4, "h", under); sym(r, 5, "h", under); }
        for (const c of [1, 2, 4, 5]) sym(30, c, "o", under); sym(30, 3, "o");
      }
      if (st === "pony") {
        sym(4, 26, "r"); put(5, 26, "r"); put(5, 27, "r"); put(6, 27, "r");
        for (let r = 5; r <= 15; r++) { const w = r >= 7 && r <= 12 ? 3 : r <= 14 ? 2 : 1; for (let k = 0; k < w; k++) under(r, 28 + k, k === 1 && r >= 7 && r <= 9 ? "H" : r >= 12 ? "j" : "h"); under(r, 28 + w, "o"); }
        put(16, 28, "o"); put(4, 28, "o"); put(4, 29, "o");
      }
    } else {
      if (st === "bob") { for (let r = 19; r <= 23; r++) { span(r, 6, 25, r >= 22 ? "j" : "h"); sym(r, 5, "o"); } span(24, 6, 25, "o"); }
      if (st === "long") { for (let r = 19; r <= 29; r++) { span(r, 6, 25, r >= 27 ? "j" : "h"); sym(r, 5, "o"); } span(30, 6, 25, "o"); for (const c of [9, 15, 21]) put(30, c, "j"); }
      if (st === "pony") {
        span(18, 14, 17, "r"); span(19, 14, 17, "r");
        for (let r = 20; r <= 27; r++) { span(r, 14, 17, "h"); put(r, 17, "j"); put(r, 13, "o"); put(r, 18, "o"); }
        put(28, 14, "o"); put(28, 15, "j"); put(28, 16, "j"); put(28, 17, "o"); put(29, 15, "o"); put(29, 16, "o");
      }
    }
    if (st === "twin") {
      for (let r = 6; r <= 25; r++) {
        const w = r < 10 || r > 21 ? 2 : 3;
        for (let k = 0; k < w; k++) sym(r, 3 - k, r > 20 ? "j" : k === 1 && r < 12 ? "H" : "h", under);
        sym(r, 3 - w, "o", under); if (r > 17) sym(r, 4, "o", under);
      }
      sym(26, 2, "o", under); sym(26, 3, "o", under);
      for (const r of [6, 7]) { sym(r, 2, "r"); sym(r, 3, "r"); }
    }
    if (front) {
      if (opt.blink || opt.sleep) for (let r = 11; r <= 15; r++) { span(r, 8, 11, "s"); span(r, 20, 23, "s"); }
      if (opt.blink && !opt.sleep) { span(14, 8, 11, "E"); span(14, 20, 23, "E"); }
      if (opt.sleep) { for (const [c, r] of [[8, 14], [9, 15], [10, 15], [11, 14], [20, 14], [21, 15], [22, 15], [23, 14]]) put(r, c, "E"); put(17, 15, "s"); }
    }
    const acc = look.acc;
    if (acc === "glasses" && front) {
      for (const c0 of [7, 19]) { span(10, c0, c0 + 5, "k"); span(16, c0, c0 + 5, "k"); for (let r = 11; r <= 15; r++) { put(r, c0, "k"); put(r, c0 + 5, "k"); } }
      span(11, 13, 18, "k"); sym(11, 5, "k"); sym(11, 6, "k");
      sym(17, 8, "b"); sym(17, 9, "b");
    }
    if (acc === "headphones" || acc === "headset") {
      if (acc === "headphones") { span(0, 10, 21, "k"); sym(1, 8, "k"); sym(1, 9, "k"); sym(2, 7, "k"); sym(3, 6, "k"); sym(4, 5, "k"); sym(5, 5, "k"); for (let r = 6; r <= 9; r++) sym(r, 4, "k"); span(0, 13, 18, "g"); }
      else { span(2, 8, 23, "k"); span(3, 7, 24, "k"); sym(4, 5, "k"); sym(5, 5, "k"); for (let r = 6; r <= 9; r++) sym(r, 4, "k"); }
      for (let r = 10; r <= 16; r++) for (let c = 2; c <= 5; c++) sym(r, c, (c === 3 && r >= 11 && r <= 13) ? "g" : "k");
      if (acc === "headset" && front) { put(17, 5, "k"); put(18, 6, "k"); put(19, 7, "k"); put(19, 8, "k"); put(19, 9, "g"); put(19, 10, "g"); }
    }
    if (acc === "beret") {
      span(0, 10, 23, "r"); put(0, 9, "R"); put(0, 24, "R");
      span(1, 7, 26, "r"); put(1, 6, "R"); put(1, 27, "R"); span(1, 10, 13, "v");
      span(2, 6, 28, "r"); put(2, 5, "R"); put(2, 29, "R"); span(3, 6, 27, "R"); put(3, 28, "o");
    }
    if (acc === "goggles") {
      span(8, 4, 27, "G"); span(9, 4, 27, "k");
      if (front) for (const c0 of [9, 18]) { span(7, c0, c0 + 4, "G"); span(10, c0, c0 + 4, "G"); for (const r of [8, 9]) { put(r, c0, "G"); put(r, c0 + 4, "G"); span(r, c0 + 1, c0 + 3, "L"); } put(8, c0 + 1, "w"); }
    }
    if (acc === "crown") { span(2, 8, 23, "y"); span(3, 8, 23, "Y"); for (const c of [8, 9, 14, 15, 16, 17, 22, 23]) put(1, c, "y"); for (const c of [8, 15, 16, 23]) put(0, c, "y"); put(2, 15, "r"); put(2, 16, "r"); }
    if (acc === "ribbon") {
      for (const [r, c, ch] of [[2, 22, "y"], [2, 23, "y"], [2, 27, "y"], [2, 28, "y"], [3, 22, "y"], [3, 23, "y"], [3, 24, "y"], [3, 25, "Y"], [3, 26, "y"], [3, 27, "y"], [3, 28, "y"],
        [4, 22, "y"], [4, 23, "y"], [4, 24, "Y"], [4, 25, "Y"], [4, 26, "Y"], [4, 27, "y"], [4, 28, "y"], [5, 23, "Y"], [5, 24, "y"], [5, 25, "Y"], [5, 26, "y"], [5, 27, "Y"], [6, 24, "Y"], [6, 26, "Y"], [7, 23, "Y"], [7, 27, "Y"]]) put(r, c, ch);
    }
    if (acc === "pen" && front) { for (let r = 6; r <= 11; r++) { put(r, 27, "p"); put(r, 28, r === 6 ? "q" : "p"); } put(12, 27, "q"); put(13, 27, "q"); }
    if (opt.legs === "hide") for (let r = 32; r < 36; r++) g[r].fill(".");
    for (const [k, c0] of [["w1", 8], ["w2", 18]]) if (opt.legs === k) {   // lift one foot two scene px
      for (const r of [34, 35]) span(r, c0, c0 + 5, ".");
      put(32, c0, "d"); span(32, c0 + 1, c0 + 4, "f"); put(32, c0 + 5, "d"); span(33, c0, c0 + 5, "d");
    }
    return g;
  }
  function palette(look) {
    const hair = look.hair, out = look.outfit;
    return {
      o: shade(hair, -0.72), h: hair, H: shade(hair, 0.32), j: shade(hair, -0.28),
      s: K.skin, S: K.skinSh, x: K.skinLine, e: look.eye, E: shade(look.eye, -0.6), i: shade(look.eye, 0.38), w: K.white, b: K.blush, m: K.mouth,
      c: out, C: shade(out, -0.3), T: shade(out, 0.22), O: shade(out, -0.7), l: K.legs, f: K.shoes, d: K.sole,
      k: "#1b1b24", g: "#9aa3b5", r: "#c43d52", R: "#8e2a3c", v: "#e0697c", G: "#5d6577", L: "#8fd8ff", y: "#f0cf6a", Y: "#c9a14a", p: "#f3efe5", q: "#3a2a1a",
    };
  }
  // sprite canvas: 36x40 scene px = the 32x36 grid plus a 2px margin for the hover outline (exactly 2x the old 18x20)
  const sprCache = {};
  function sprite(a, view, opt = {}) {
    const look = lookFor(a);
    const key = [a.id, JSON.stringify(look), view, opt.blink ? 1 : 0, opt.sleep ? 1 : 0, opt.legs || "", opt.outline || ""].join("|");
    if (sprCache[key]) return sprCache[key];
    const g = buildGrid(look, view, opt), pal = palette(look);
    const [c, x] = mk(36, 40);
    for (let r = 0; r < 36; r++) for (let col = 0; col < 32; col++) { const ch = g[r][col]; if (ch !== ".") P(x, col + 2, r + 2, pal[ch] || "#f0f"); }
    if (!opt.outline) return (sprCache[key] = c);
    const [o, ox] = mk(36, 40);
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) if ((dx || dy) && Math.abs(dx) + Math.abs(dy) <= 3) ox.drawImage(c, dx, dy);
    ox.globalCompositeOperation = "source-in"; R(ox, 0, 0, 36, 40, opt.outline);
    ox.globalCompositeOperation = "source-over"; ox.drawImage(c, 0, 0);
    return (sprCache[key] = o);
  }
  // Avatar used across the dashboard (only when a role has no avatars/*.png): the sprite's head on a tinted square.
  const avCache = {};
  function avatar(a) {
    const key = a.id + (a.color || "") + JSON.stringify(a.look || "");
    if (avCache[key]) return avCache[key];
    const [c, x] = mk(32, 28);
    R(x, 0, 0, 32, 28, shade(lookFor(a).outfit, -0.62));
    x.drawImage(sprite(a, "front"), 0, 0, 36, 26, -2, 4, 36, 26);
    const [big, b] = mk(64, 56); b.drawImage(c, 0, 0, 64, 56);
    return (avCache[key] = big.toDataURL());
  }

  // ---------- layout ----------
  // all in scene px (960x496)
  const DESKS = {
    manager: { x: 52, y: 160, w: 120, screen: "mail", lamp: true, dual: true },
    scout: { x: 212, y: 160, w: 80, screen: "browser" },
    writer: { x: 296, y: 160, w: 80, screen: "doc", lamp: true },
    ops: { x: 412, y: 160, w: 88, screen: "chart" },
    director: { x: 52, y: 332, w: 88, screen: "timeline", dual: true },
    artist: { x: 224, y: 332, w: 88, screen: "canvas", lamp: true },
    smith: { x: 412, y: 332, w: 88, screen: "code" },
  };
  const ROOMS = [
    { label: "LEAD", x: 52, y: 246 }, { label: "SCRIPTORIUM", x: 212, y: 246 }, { label: "SIGNAL", x: 412, y: 246 },
    { label: "STUDIO", x: 52, y: 418 }, { label: "ATELIER", x: 224, y: 418 }, { label: "FORGE", x: 412, y: 418 },
    { label: "PANTRY", x: 604, y: 252 }, { label: "LOUNGE", x: 608, y: 478 },
  ];
  // idle spots in preference order: x = sprite centre, y = sprite top
  const SPOTS = [
    { x: 686, y: 336, pose: "sofa" }, { x: 766, y: 336, pose: "sofa" }, { x: 624, y: 132, pose: "back" },
    { x: 840, y: 398, pose: "bean" }, { x: 924, y: 444, pose: "back" }, { x: 726, y: 336, pose: "sofa" },
    { x: 834, y: 148, pose: "back" }, { x: 660, y: 180, pose: "front" }, { x: 824, y: 188, pose: "front" }, { x: 896, y: 188, pose: "front" },
  ];
  const NAP = [{ x: 908, y: 344 }, { x: 908, y: 296 }]; // bunk: y = mattress top
  const CORRIDOR_X = 588;
  const SOFA = { x: 644, y: 328 };

  // ---------- static background ----------
  let BG = null;
  function buildBG() {
    const [c, x] = mk(SW, SH);
    shellBG(x);                // px2 stage 2: walls, wainscot, parquet, pantry tiles
    // px2 stage 3: desk area
    bookshelf2(x, 4, 124, 32, 124); whiteboard2(x, 512, 124);
    for (const [id, d] of Object.entries(DESKS)) desk2(x, d, id);
    tripod2(x, 152, 296); softbox2(x, 176, 280); easel2(x, 324, 292); rack2(x, 516, 284); toolbench2(x, 448, 444);
    plant2(x, 184, 200, 1); plant2(x, 384, 200, 0); plant2(x, 4, 432, 2); plant2(x, 552, 432, 2); plant2(x, 384, 372, 1);
    // px2 stage 4: pantry and lounge
    rug2(x, 620, 392, 268, 88);
    counter2(x); barTable2(x, 682, 208); dining2(x, 860, 208);
    sofaBack2(x, SOFA.x, SOFA.y); coffeeTable2(x, 672, 408); floorLamp2(x, 612, 300); beanBag2(x, 816, 424);
    bunk2(x, 888, 340); arcade2(x, 908, 412);
    plant2(x, 600, 436, 2);
    return c;
  }
  // ---------- px2 native 2x: room shell (scene px) ----------
  function disk(c, cx, cy, r, col) { c.fillStyle = col; for (let dy = -r; dy <= r; dy++) { const w = Math.round(Math.sqrt(r * r - dy * dy)); c.fillRect(cx - w, cy + dy, w * 2 + 1, 1); } }
  function line(c, x0, y0, x1, y1, col, w = 1) {   // pixel line (no anti-aliasing)
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let e = dx + dy;
    c.fillStyle = col; const o = w > 1 ? (w - 1) >> 1 : 0;
    for (let i = 0; i < 400; i++) { c.fillRect(x0 - o, y0 - o, w, w); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
  }
  function shellBG(x) {
    // crown moulding 0-7
    R(x, 0, 0, SW, 6, K.trim); for (let i = 0; i < SW; i += 12) R(x, i + 3, 2, 6, 2, "#151a2e");
    R(x, 0, 6, SW, 1, "#2c3556"); R(x, 0, 7, SW, 1, "#0a0d18");
    // wallpaper 8-69: darker toward the ceiling, the old 48px seams, a faint diamond motif between them
    for (let b = 0; b < 4; b++) R(x, 0, 8 + b * 16, SW, b === 3 ? 14 : 16, mix(K.wall, "#0b0f1e", [0.34, 0.2, 0.09, 0][b]));
    for (let i = 0; i < SW; i += 48) {
      R(x, i, 8, 2, 62, K.wall2); R(x, i + 2, 8, 1, 62, K.wallHi);
      for (let y = 16; y < 66; y += 16) { const cx = i + 25, col = "#1f2643"; P(x, cx, y - 1, col); P(x, cx - 1, y, col); P(x, cx + 1, y, col); P(x, cx, y + 1, col); }
    }
    // chair rail 70-75
    R(x, 0, 70, SW, 6, "#0f1324"); R(x, 0, 70, SW, 1, "#2e3758"); R(x, 0, 71, SW, 1, "#1c2238"); R(x, 0, 75, SW, 1, "#080a14");
    // wainscot 76-111: raised panels with a bevel
    R(x, 0, 76, SW, 36, K.wains);
    for (let i = 8; i < SW; i += 40) {
      R(x, i, 80, 32, 26, K.wall2); R(x, i, 80, 32, 1, "#222a45"); R(x, i, 80, 1, 26, "#1d2440"); R(x, i, 105, 32, 1, "#0c0f1c"); R(x, i + 31, 80, 1, 26, "#0e1120");
      R(x, i + 4, 84, 24, 18, "#161b30"); R(x, i + 4, 84, 24, 1, "#1f2640"); R(x, i + 4, 101, 24, 1, "#10142a");
    }
    // baseboard 112-119
    R(x, 0, 112, SW, 2, "#2a3152"); R(x, 0, 114, SW, 6, K.trim); R(x, 0, 114, SW, 1, "#1b2138"); R(x, 0, 119, SW, 1, "#05070f");
    // parquet 120+: same basket weave and plank colours as before (hashed on layout units), now with edges and grain
    for (let by = 120; by < SH; by += 16) for (let bx = 0; bx < SW; bx += 16) {
      const hor = ((bx >> 4) + (by >> 4)) % 2 === 0;
      for (let k = 0; k < 4; k++) {
        const v = hsh((bx >> 1) * 131 + (by >> 1) * 17 + k * 7), col = v < 0.33 ? K.wood1 : v < 0.66 ? K.wood2 : K.wood3;
        const g = hsh(v * 9973 + k), dk = shade(col, -0.14), gr = shade(col, -0.07), hi = mix(col, "#4a4160", 0.35);
        if (hor) { const y = by + k * 4; R(x, bx, y, 16, 4, col); R(x, bx, y, 16, 1, hi); R(x, bx, y + 3, 16, 1, dk); R(x, bx + (g * 10 | 0), y + 1 + (g > 0.5 ? 1 : 0), 5, 1, gr); R(x, bx + (v * 16 | 0), y, 1, 3, K.seam); }
        else { const xx = bx + k * 4; R(x, xx, by, 4, 16, col); R(x, xx, by, 1, 16, hi); R(x, xx + 3, by, 1, 16, dk); R(x, xx + 1 + (g > 0.5 ? 1 : 0), by + (g * 10 | 0), 1, 5, gr); R(x, xx, by + (v * 16 | 0), 3, 1, K.seam); }
      }
    }
    R(x, 0, 120, SW, 2, "rgba(0,0,0,.28)");
    // pantry tiles 596+ x 120-271: glazed, bevelled, a glint per tile
    for (let ty = 120; ty < 272; ty += 16) for (let tx = 596; tx < SW; tx += 16) {
      const col = ((tx + ty) >> 4) % 2 ? K.tile1 : K.tile2;
      R(x, tx, ty, 16, 16, col); R(x, tx + 1, ty + 1, 14, 1, shade(col, 0.1)); R(x, tx + 1, ty + 1, 1, 14, shade(col, 0.05));
      R(x, tx + 1, ty + 15, 15, 1, shade(col, -0.1)); R(x, tx + 15, ty + 1, 1, 15, shade(col, -0.1));
      R(x, tx, ty, 16, 1, K.grout); R(x, tx, ty, 1, 16, K.grout); R(x, tx + 3, ty + 3, 2, 1, "#5f6c98"); P(x, tx + 3, ty + 4, "#55628c");
    }
    R(x, 592, 120, 4, 152, K.grout); R(x, 592, 120, 1, 152, "#3a4468");
    R(x, 592, 272, SW - 592, 4, "#262d47"); R(x, 592, 272, SW - 592, 1, "#3a4366"); R(x, 592, 276, SW - 592, 1, "rgba(0,0,0,.3)");
    for (let i = 0; i < 36; i++) { x.fillStyle = `rgba(5,6,14,${0.009 * i})`; x.fillRect(0, SH - 36 + i, SW, 1); }
  }
  // window: wx/wy/ww/wh in scene px. Skyline is hashed on layout units so it keeps the old silhouette.
  function windowScene2(c, wx, wy, ww, wh, t, seed, moon) {
    const [top, bot, mode] = skyColors(new Date().getHours()), night = mode === "night";
    for (let r = 0; r < wh; r += 6) R(c, wx, wy + r, ww, 6, mix(top, bot, Math.floor(r / wh * 12) / 12));
    if (night) {
      for (let i = 0; i < 40; i++) {
        const sx = wx + (hsh(i * 91 + seed) * ww | 0), sy = wy + (hsh(i * 37 + seed) * (wh - 28) | 0), tw = Math.sin(t / 600 + i * 1.7);
        if (tw < -0.3) continue;
        if (i % 9 === 0 && tw > 0.4) { P(c, sx, sy, "#ffffff"); for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) P(c, sx + a, sy + b, "rgba(159,180,232,.55)"); }
        else P(c, sx, sy, i % 5 ? "#9fb4e8" : "#ffffff");
      }
      if (moon) {
        const mx = wx + 28, my = wy + 18;
        disk(c, mx, my, 15, "rgba(243,238,220,.06)"); disk(c, mx, my, 12, "rgba(243,238,220,.08)");
        disk(c, mx, my, 10, "#f3eedc"); P(c, mx - 5, my + 2, "#ddd5bc"); R(c, mx - 3, my + 5, 2, 2, "#ddd5bc"); P(c, mx - 7, my - 2, "#e6dfc8");
        disk(c, mx + 5, my - 3, 8, mix(top, bot, 3 / 12));
      }
      if (shooting && shooting.seed === seed) {
        const p = (t - shooting.t0) / 900;
        if (p > 1) shooting = null;
        else for (let k = 0; k < 12; k++) P(c, wx + shooting.x + (p * 60 | 0) - k, wy + shooting.y + (p * 20 | 0) - (k / 3 | 0), `rgba(255,255,255,${1 - k / 12})`);
      }
    } else {
      if (moon) { const day = mode === "day", sx = wx + 32, sy = wy + (day ? 18 : 34); disk(c, sx, sy, 14, day ? "rgba(255,246,208,.18)" : "rgba(255,207,138,.18)"); disk(c, sx, sy, 10, day ? "#fff6d0" : "#ffcf8a"); disk(c, sx - 2, sy - 2, 5, day ? "#fffbe8" : "#ffe0b0"); }
      const cc = mode === "day" ? ["rgba(255,255,255,.88)", "rgba(214,226,246,.88)"] : ["rgba(255,210,190,.62)", "rgba(220,160,150,.55)"];
      for (let i = 0; i < 3; i++) {
        const cx = (wx + ((t / 200 + i * 74 + seed * 2) % (ww + 48)) - 24) | 0, cy = wy + 8 + i * 10;
        R(c, cx, cy, 24, 5, cc[0]); R(c, cx + 5, cy - 4, 12, 4, cc[0]); R(c, cx + 2, cy - 2, 4, 2, cc[0]); R(c, cx + 2, cy + 5, 20, 1, cc[1]);
      }
    }
    c.save(); c.beginPath(); c.rect(wx, wy, ww, wh); c.clip();
    const lwx = wx / 2, lww = ww / 2, lwy = wy / 2, lwh = wh / 2, base = night ? "#0d1228" : mode === "day" ? "#5d7398" : "#2a2a4a";
    let lbx = lwx - 2;
    while (lbx < lwx + lww) {
      const v = hsh(lbx * 13 + seed), bw = 6 + (v * 9 | 0), bh = 8 + (hsh(lbx * 7 + seed) * 18 | 0);
      const X = lbx * 2, w = bw * 2, Y = wy + wh - bh * 2, h = bh * 2, col = base;
      R(c, X, Y, w, h, col); R(c, X, Y, w, 1, shade(col, 0.18)); R(c, X, Y + 1, 1, h, shade(col, 0.08)); R(c, X + w - 2, Y + 1, 2, h, shade(col, -0.25));
      if (v > 0.7) { R(c, X + (w >> 1), Y - 8, 1, 8, col); R(c, X + (w >> 1) - 1, Y - 3, 3, 1, col); if (night && Math.floor(t / 700) % 2) { P(c, X + (w >> 1), Y - 9, "#ff5a5a"); P(c, X + (w >> 1) - 1, Y - 9, "rgba(255,90,90,.35)"); P(c, X + (w >> 1) + 1, Y - 9, "rgba(255,90,90,.35)"); } }
      else if (v > 0.45 && v < 0.55) { R(c, X + 3, Y - 5, 7, 4, shade(col, 0.1)); R(c, X + 3, Y - 5, 7, 1, shade(col, 0.22)); R(c, X + 4, Y - 1, 1, 1, col); R(c, X + 8, Y - 1, 1, 1, col); }
      for (let ly = lwy + lwh - bh + 2; ly < lwy + lwh - 1; ly += 3) for (let lx = lbx + 1; lx < lbx + bw - 1; lx += 2) {
        const on = hsh(lx * 3 + ly * 11 + Math.floor(t / 7000 + hsh(lx + ly) * 9)) > (night ? 0.55 : 0.85);
        if (on) R(c, lx * 2, ly * 2, 2, 2, mode === "day" ? "#9fb4d2" : hsh(lx * 5 + ly) > 0.8 ? "#a8d4ff" : "#f3d27a");
        else if (night) R(c, lx * 2, ly * 2, 2, 2, "#141b38");
      }
      lbx += bw + 1;
    }
    c.restore();
    // glass reflection streaks
    for (let k = 0; k < 10; k++) { P(c, wx + 6 + k, wy + wh - 6 - k * 2, "rgba(255,255,255,.07)"); P(c, wx + 12 + k, wy + wh - 6 - k * 2, "rgba(255,255,255,.04)"); }
    // frame, mullions, sill
    R(c, wx - 4, wy - 4, ww + 8, 4, "#0c0f1a"); R(c, wx - 4, wy + wh, ww + 8, 4, "#0c0f1a"); R(c, wx - 4, wy, 4, wh, "#0c0f1a"); R(c, wx + ww, wy, 4, wh, "#0c0f1a");
    R(c, wx - 4, wy - 4, ww + 8, 1, "#1f2438"); R(c, wx - 1, wy, 1, wh, "#171b2c");
    R(c, wx + ww / 2 - 2, wy, 4, wh, "#262b44"); R(c, wx + ww / 2 - 2, wy, 1, wh, "#363c5c");
    const hy = wy + (wh * 0.55 | 0); R(c, wx, hy, ww, 2, "#262b44"); R(c, wx, hy, ww, 1, "#363c5c");
    R(c, wx - 8, wy + wh + 4, ww + 16, 4, "#3a4062"); R(c, wx - 8, wy + wh + 4, ww + 16, 1, "#5a6288"); R(c, wx - 6, wy + wh + 8, ww + 12, 1, "rgba(0,0,0,.35)");
    // curtains: pleats, a tie band, hem
    for (const cx of [wx - 20, wx + ww + 8]) {
      R(c, cx, wy - 8, 12, wh + 16, "#2a2140");
      for (let i = 1; i < 12; i += 3) { R(c, cx + i, wy - 8, 1, wh + 16, "#211a33"); R(c, cx + i + 1, wy - 8, 1, wh + 16, "#31274a"); }
      R(c, cx, wy - 8, 12, 2, "#3a2d55"); R(c, cx, wy + 42, 12, 3, "#3a2d55"); R(c, cx, wy + 42, 12, 1, "#4c3d6c"); R(c, cx, wy + wh + 6, 12, 2, "#1c1530");
    }
    R(c, wx - 22, wy - 10, ww + 44, 2, "#4a4f6a"); R(c, wx - 22, wy - 10, ww + 44, 1, "#6a7090"); R(c, wx - 24, wy - 11, 3, 4, "#6a7090"); R(c, wx + ww + 21, wy - 11, 3, 4, "#6a7090");
  }
  // neon sign, wall display, clock, live chart: the animated wall pieces (scene px)
  function wallPieces(c, t, neonOn) {
    // neon: board on two wires, 2px tube with a bright core
    for (const wxp of [226, 338]) R(c, wxp, 8, 1, 16, "#2a2438");
    R(c, 208, 24, 148, 44, "#120d1c"); R(c, 208, 24, 148, 1, "#22182f"); R(c, 208, 67, 148, 1, "#09060f");
    if (neonOn) { c.fillStyle = "rgba(255,95,162,.22)"; c.fillRect(206, 22, 152, 2); c.fillRect(206, 68, 152, 2); c.fillRect(206, 24, 2, 44); c.fillRect(356, 24, 2, 44); }
    const tube = neonOn ? "#ff5fa2" : "#4a2a3e", core = neonOn ? "#ffc4dd" : "#5a3a4e";
    R(c, 212, 27, 140, 2, tube); R(c, 212, 63, 140, 2, tube); R(c, 211, 28, 2, 36, tube); R(c, 351, 28, 2, 36, tube);
    R(c, 214, 27, 136, 1, core); R(c, 214, 63, 136, 1, core); R(c, 211, 30, 1, 32, core); R(c, 351, 30, 1, 32, core);
    for (const [px, py] of [[210, 26], [353, 26], [210, 64], [353, 64]]) R(c, px, py, 1, 1, "#2a2038");
    // wall display: bezel, screen with soft scanlines, header dots, four side tiles, a sweep line
    R(c, 392, 12, 180, 80, "#0b0e18"); R(c, 392, 12, 180, 1, "#1c2236"); R(c, 392, 91, 180, 1, "#05070d");
    R(c, 396, 16, 172, 72, "#16306a");
    for (let i = 0; i < 6; i++) R(c, 396, 16 + i * 12, 172, 6, i % 2 ? "#1a3878" : "#16306a");
    R(c, 396, 16, 172, 8, "#2a4a9a"); R(c, 396, 23, 172, 1, "#20407f");
    for (const [i, col] of [[0, "#ff7a7a"], [1, "#f0cf6a"], [2, "#8cf0a8"]]) { R(c, 402 + i * 8, 18, 5, 4, col); P(c, 402 + i * 8, 18, "rgba(255,255,255,.5)"); }
    for (const [tx, ty, tw] of [[402, 30, 24], [540, 30, 22], [402, 58, 24], [540, 58, 22]]) { R(c, tx, ty, tw, 20, "#24479a"); R(c, tx, ty, tw, 1, "#3a62b8"); R(c, tx, ty + 19, tw, 1, "#1a3478"); }
    R(c, 406, 34, 16, 2, "#9fc3ff"); R(c, 406, 38, 10, 2, "#9fc3ff"); R(c, 406, 42, 13, 1, "#6f9be0");
    for (let i = 0; i < 4; i++) { const hgt = 4 + (hsh(i * 17 + (t / 4000 | 0)) * 10 | 0); R(c, 544 + i * 5, 46 - hgt, 3, hgt, i === 3 ? "#8cf0a8" : "#7fb2ff"); }
    disk(c, 414, 68, 6, "#7fb2ff"); R(c, 414, 62, 6, 6, "#f0cf6a"); disk(c, 414, 68, 3, "#24479a");
    R(c, 544, 62, 14, 12, "#3a6ad0"); R(c, 544, 62, 14, 1, "#5a8af0");
    for (let y = 25; y < 88; y += 2) R(c, 396, y, 172, 1, "rgba(0,0,0,.07)");
    R(c, 396 + ((t / 15) % 172 | 0), 24, 2, 64, "rgba(160,200,255,.16)");
    P(c, 566, 89, "#5ae0a0");
    R(c, 478, 92, 8, 16, "#1a1e2d"); R(c, 478, 92, 1, 16, "#2a3046");
    // clock
    const cx = 604, cy = 48;
    disk(c, cx, cy + 1, 20, "rgba(0,0,0,.35)"); disk(c, cx, cy, 20, "#0b0d17"); disk(c, cx, cy, 18, "#3a3f55"); disk(c, cx, cy, 16, "#d9d4c7");
    R(c, cx - 9, cy - 17, 12, 1, "#5a6080");
    for (let i = 0; i < 12; i++) { const a = i / 6 * Math.PI, px = cx + Math.round(Math.sin(a) * 13), py = cy - Math.round(Math.cos(a) * 13); if (i % 3) P(c, px, py, "#6a6556"); else R(c, px - 1, py - 1, 2, 2, "#2e2a36"); }
    const d = new Date(), ha = ((d.getHours() % 12) + d.getMinutes() / 60) / 12 * Math.PI * 2, ma = d.getMinutes() / 60 * Math.PI * 2, sa = d.getSeconds() / 60 * Math.PI * 2;
    line(c, cx, cy, cx + Math.sin(ha) * 8, cy - Math.cos(ha) * 8, "#1b1b24", 2);
    line(c, cx, cy, cx + Math.sin(ma) * 12, cy - Math.cos(ma) * 12, "#1b1b24", 2);
    line(c, cx, cy, cx + Math.sin(sa) * 14, cy - Math.cos(sa) * 14, "#c43d52", 1);
    R(c, cx - 1, cy - 1, 3, 3, "#1b1b24"); P(c, cx, cy, "#c43d52");
    for (const [gx, gy] of [[-9, -9], [-10, -7], [-8, -10]]) P(c, cx + gx, cy + gy, "rgba(255,255,255,.55)");
    // live chart: grid, filled area, line, points; the newest point pulses
    R(c, 636, 16, 104, 64, "#0b0e18"); R(c, 636, 16, 104, 1, "#1c2236"); R(c, 640, 20, 96, 56, "#0b1a2a");
    for (let i = 0; i < 4; i++) R(c, 640, 32 + i * 12, 96, 1, "#12283c");
    for (let gx = 656; gx < 736; gx += 16) for (let gy = 22; gy < 74; gy += 4) P(c, gx, gy, "#10223a");
    R(c, 642, 22, 14, 2, "#2a4a5a"); R(c, 642, 25, 8, 1, "#1e3a4a");
    const sp = stats.spark && stats.spark.length > 1 ? stats.spark : [1, 2, 1, 3, 2, 4, 3], mx = Math.max(1, ...sp);
    const pts = sp.map((v, i) => [646 + i * (84 / (sp.length - 1)), 68 - v / mx * 36]);
    for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; for (let xx = Math.round(x0); xx < Math.round(x1); xx++) { const yy = Math.round(y0 + (y1 - y0) * (xx - x0) / (x1 - x0)); R(c, xx, yy, 1, 74 - yy, "rgba(140,240,168,.10)"); } }
    for (let i = 1; i < pts.length; i++) { line(c, pts[i - 1][0], pts[i - 1][1] + 1, pts[i][0], pts[i][1] + 1, "#2f7a52"); line(c, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], "#8cf0a8"); }
    pts.forEach(([px, py], i) => { R(c, Math.round(px) - 1, Math.round(py) - 1, 3, 3, "#d8ffe4"); if (i === pts.length - 1 && Math.floor(t / 600) % 2) R(c, Math.round(px) - 2, Math.round(py) - 2, 5, 5, "rgba(140,240,168,.35)"); });
    R(c, 684, 80, 8, 12, "#1a1e2d"); R(c, 684, 80, 1, 12, "#2a3046");
  }
  // ---------- px2 native 2x: desk area (stage 3, scene px) ----------
  function mug2(x, mx, my, col) { R(x, mx, my, 6, 6, col); R(x, mx, my, 6, 1, shade(col, 0.4)); R(x, mx + 5, my + 1, 1, 5, shade(col, -0.25)); R(x, mx + 6, my + 1, 2, 4, col); P(x, mx + 6, my + 2, shade(col, -0.45)); P(x, mx + 6, my + 3, shade(col, -0.45)); R(x, mx + 1, my + 1, 4, 1, "#2a1a14"); }
  function desk2(x, d, id) {
    const dx = d.x, dy = d.y, w = d.w, cx = dx + w / 2;
    R(x, dx + 2, dy + 46, w, 6, "rgba(0,0,0,.22)"); R(x, dx + 4, dy + 46, w - 4, 3, "rgba(0,0,0,.14)");
    for (const lx of [dx + 2, dx + w - 6]) { R(x, lx, dy + 40, 4, 8, "#151827"); R(x, lx, dy + 40, 1, 8, "#232840"); }
    R(x, dx, dy, w, 24, K.deskTop); R(x, dx, dy, w, 1, K.deskHi); R(x, dx, dy + 1, w, 3, mix(K.deskTop, K.deskHi, 0.35));
    for (let i = 6; i < 22; i += 5) R(x, dx + 2, dy + i, w - 4, 1, mix(K.deskTop, K.deskEdge, 0.18));
    R(x, dx, dy + 22, w, 2, K.deskEdge); R(x, dx, dy + 24, w, 16, K.deskFront); R(x, dx, dy + 24, w, 1, "#323858"); R(x, dx, dy + 38, w, 2, K.deskLine);
    R(x, dx + w - 28, dy + 27, 24, 9, K.deskLine); R(x, dx + w - 27, dy + 28, 22, 7, "#252a42"); R(x, dx + w - 27, dy + 28, 22, 1, "#323858"); R(x, dx + w - 19, dy + 30, 6, 2, "#6b7394"); P(x, dx + w - 19, dy + 30, "#9aa3c4");
    for (const m of monitors(d)) {
      R(x, m.x + m.w / 2 - 2, m.y + m.h + 2, 4, 6, "#1a1e2d"); R(x, m.x + m.w / 2 - 2, m.y + m.h + 2, 1, 6, "#2a3046"); R(x, m.x + m.w / 2 - 7, m.y + m.h + 7, 14, 2, "#1a1e2d"); R(x, m.x + m.w / 2 - 7, m.y + m.h + 7, 14, 1, "#2e3450");
      R(x, m.x - 2, m.y - 2, m.w + 4, m.h + 4, K.bezel); R(x, m.x - 2, m.y - 2, m.w + 4, 1, "#262b40"); R(x, m.x + m.w - 3, m.y + m.h + 1, 2, 1, "#5ae0a0");
    }
    R(x, cx - 12, dy + 14, 24, 6, "#20243a"); R(x, cx - 12, dy + 14, 24, 1, "#33395a");
    for (let r = 0; r < 2; r++) for (let k = 0; k < 10; k++) P(x, cx - 11 + k * 2 + r, dy + 16 + r * 2, "#3a4166");
    R(x, cx + 16, dy + 14, 4, 6, "#20243a"); R(x, cx + 16, dy + 14, 4, 1, "#3a4166"); R(x, cx + 17, dy + 12, 1, 2, "#20243a");
    const px = dx + 6, py = dy + 4;
    if (id === "manager") { R(x, dx + w - 24, dy + 6, 16, 4, "#c9a14a"); R(x, dx + w - 22, dy + 6, 12, 2, "#f0cf6a"); R(x, dx + w - 20, dy + 7, 8, 1, "#8a6a2a"); mug2(x, dx + 16, dy + 9, "#e07a5f"); }
    if (id === "scout") for (const [bx, by, bw, col] of [[px, py + 8, 14, "#d8b56d"], [px, py + 4, 14, "#7fa3d6"], [px + 2, py, 12, "#c0505e"]]) { R(x, bx, by, bw, 4, col); R(x, bx, by, bw, 1, shade(col, 0.3)); R(x, bx + bw - 2, by + 1, 2, 3, "#e8e4d8"); R(x, bx, by + 3, bw, 1, shade(col, -0.3)); }
    if (id === "writer") { R(x, px, py + 2, 16, 12, "#e3e0d6"); R(x, px, py + 2, 16, 1, "#f6f3ea"); for (let i = 0; i < 4; i++) R(x, px + 2, py + 5 + i * 2, i === 3 ? 7 : 12, 1, "#9aa"); R(x, px + 14, py - 2, 2, 10, "#3a2a1a"); P(x, px + 14, py + 8, "#c9a14a"); }
    if (id === "ops") { R(x, px, py + 6, 8, 12, "#1b1d2a"); R(x, px + 2, py + 8, 4, 6, "#6fa8ff"); R(x, px + 2, py + 8, 4, 1, "#a8ccff"); P(x, px + 3, py + 16, "#3a3f55"); mug2(x, dx + w - 14, dy + 9, "#8cc084"); }
    if (id === "director") { const bx = dx + w - 18; R(x, bx, py + 10, 14, 6, "#1b1b24"); R(x, bx, py + 10, 14, 1, "#33333f"); R(x, bx, py + 7, 14, 3, "#1b1b24"); for (let i = 0; i < 14; i += 4) R(x, bx + i, py + 7, 2, 3, "#e8e4d8"); R(x, bx + 2, py + 12, 8, 1, "#5a5a6a"); }
    if (id === "artist") { R(x, px, py + 6, 20, 12, "#20243a"); R(x, px + 2, py + 8, 16, 8, "#2e3555"); R(x, px + 4, py + 10, 6, 2, "#e58fa8"); R(x, px + 9, py + 12, 5, 2, "#8fb8de"); R(x, px + 18, py + 2, 2, 12, "#e3e0d6"); R(x, px + 18, py + 12, 2, 2, "#3a3f55"); }
    if (id === "smith") { R(x, px, py + 8, 16, 8, "#a8443a"); R(x, px, py + 8, 16, 2, "#c95a4c"); R(x, px, py + 11, 16, 1, "#7a2e28"); R(x, px + 6, py + 6, 4, 2, "#555"); R(x, px + 7, py + 13, 2, 2, "#d8b56d"); mug2(x, dx + w - 14, dy + 9, "#9aa5b1"); }
    if (d.lamp) { const lx = d.dual ? d.x + 4 : d.x + d.w - 12; R(x, lx, dy + 16, 8, 4, "#2a2e3f"); R(x, lx, dy + 16, 8, 1, "#3e4460"); R(x, lx + 2, dy + 4, 2, 12, "#3a3f55"); R(x, lx - 1, dy, 10, 4, "#c9a14a"); R(x, lx - 1, dy, 10, 1, "#f0cf6a"); R(x, lx + 1, dy + 4, 6, 1, "#fff0c0"); }
  }
  function bookshelf2(x, bx, by, w, h) {
    R(x, bx, by, w, h, "#2b2233"); R(x, bx, by, w, 2, "#3d3248"); R(x, bx + w - 2, by, 2, h, "#1c1622"); R(x, bx + 2, by + 2, w - 4, h - 4, "#221b2a");
    const cols = ["#7fa3d6", "#c0505e", "#d8b56d", "#7fbf8a", "#a98ad6", "#e3e0d6", "#5b6aa8"];
    for (let sy = by + 6; sy < by + h - 12; sy += 22) {
      R(x, bx + 2, sy + 16, w - 4, 4, "#3d3248"); R(x, bx + 2, sy + 16, w - 4, 1, "#544660"); R(x, bx + 2, sy + 20, w - 4, 1, "#140f19");
      let cx = bx + 4;
      while (cx < bx + w - 7) {
        const v = hsh(cx * 31 + sy * 7), bw = 3 + (v * 3 | 0), bh = 10 + (v * 6 | 0), col = cols[(v * 97 | 0) % cols.length], top = sy + 16 - bh;
        R(x, cx, top, bw, bh, col); R(x, cx, top, bw, 1, shade(col, 0.3)); R(x, cx + bw - 1, top + 1, 1, bh - 1, shade(col, -0.28)); R(x, cx, top + 3, bw, 1, shade(col, -0.32)); if (bh > 13) R(x, cx, top + bh - 4, bw, 1, shade(col, 0.2));
        cx += bw + (v > 0.85 ? 2 : 0);
      }
    }
  }
  function whiteboard2(x, wx, wy) {
    R(x, wx + 8, wy + 52, 2, 28, "#2a2e3f"); R(x, wx + 62, wy + 52, 2, 28, "#2a2e3f"); R(x, wx + 6, wy + 78, 6, 2, "#1d2030"); R(x, wx + 60, wy + 78, 6, 2, "#1d2030");
    R(x, wx, wy, 72, 52, "#1b1f2e"); R(x, wx + 2, wy + 2, 68, 46, "#d9dde8"); R(x, wx + 2, wy + 2, 68, 1, "#eef0f6"); R(x, wx + 2, wy + 46, 68, 2, "#aeb4c4");
    R(x, wx + 16, wy + 48, 40, 4, "#2a2e3f"); R(x, wx + 16, wy + 48, 40, 1, "#3e4460"); R(x, wx + 20, wy + 47, 6, 2, "#c0505e"); R(x, wx + 28, wy + 47, 6, 2, "#5b8ad6");
    const sticky = ["#f0cf6a", "#8fd3a8", "#ee9fa0", "#8fb8de"];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) if (hsh(i * 7 + j * 13) > 0.25) {
      const sx = wx + 8 + i * 16, sy = wy + 8 + j * 12, col = sticky[(i + j) % 4];
      R(x, sx, sy, 10, 8, col); R(x, sx, sy, 10, 1, shade(col, 0.25)); R(x, sx + 2, sy + 3, 6, 1, shade(col, -0.35)); R(x, sx + 2, sy + 5, 4, 1, shade(col, -0.35)); P(x, sx + 9, sy + 7, shade(col, -0.2));
    }
    for (let k = 0; k < 10; k++) P(x, wx + 6 + k * 2, wy + 44 - (k % 3), "#5b8ad6");
  }
  function plant2(x, px, py, kind) {
    const lv = ["#2d5c3a", "#3f7d4f", "#5aa06a", "#77bd7f"];
    if (kind === 2) {
      R(x, px + 6, py + 50, 24, 4, "rgba(0,0,0,.3)");
      for (const [lx, ly, s] of [[14, 0, 3], [4, 6, 2], [22, 4, 2], [8, 16, 1], [20, 14, 1], [12, 10, 0], [0, 18, 2], [26, 18, 1]]) {
        R(x, px + lx + 3, py + ly + 8, 2, Math.max(2, 32 - ly - 8), "#2d5c3a");
        R(x, px + lx + 1, py + ly, 6, 10, lv[s]); R(x, px + lx, py + ly + 2, 8, 6, lv[s]); R(x, px + lx + 2, py + ly + 2, 2, 2, lv[3]); R(x, px + lx + 3, py + ly + 1, 1, 8, shade(lv[s], -0.18)); R(x, px + lx + 6, py + ly + 7, 2, 2, lv[0]);
      }
      R(x, px + 6, py + 32, 24, 20, "#6b4a3a"); R(x, px + 4, py + 32, 28, 4, "#83604c"); R(x, px + 4, py + 32, 28, 1, "#9a7560"); R(x, px + 26, py + 36, 4, 16, "#5a3d30"); R(x, px + 8, py + 38, 2, 12, "#7a5644");
    } else {
      const pot = kind ? "#8a5a44" : "#c9cfdd";
      R(x, px + 10, py, 2, 16, lv[0]);
      for (const [lx, ly, s] of [[4, 4, 2], [12, 2, 1], [2, 10, 1], [12, 8, 2]]) { R(x, px + lx, py + ly, 7, 4, lv[s]); R(x, px + lx + 1, py + ly - 1, 4, 1, lv[s]); P(x, px + lx + 1, py + ly, lv[3]); R(x, px + lx + 2, py + ly + 3, 4, 1, shade(lv[s], -0.2)); }
      R(x, px + 4, py + 16, 14, 12, pot); R(x, px + 3, py + 16, 16, 2, shade(pot, 0.18)); R(x, px + 15, py + 18, 3, 10, shade(pot, -0.18)); R(x, px + 6, py + 16, 10, 1, "#3a2a20");
    }
  }
  function tripod2(x, tx, ty) {
    R(x, tx + 12, ty + 12, 4, 60, "#3a3f55"); R(x, tx + 12, ty + 12, 1, 60, "#4e5470");
    line(x, tx + 13, ty + 66, tx + 4, ty + 84, "#3a3f55", 2); line(x, tx + 14, ty + 66, tx + 23, ty + 84, "#3a3f55", 2); R(x, tx + 12, ty + 72, 4, 12, "#30344a");
    R(x, tx + 6, ty, 16, 12, "#1b1b24"); R(x, tx + 6, ty, 16, 1, "#34343f"); R(x, tx + 8, ty + 2, 6, 6, "#3a4a7a"); R(x, tx + 9, ty + 3, 4, 4, "#22305a"); R(x, tx + 10, ty + 4, 2, 2, "#9fc3ff");
    R(x, tx + 20, ty + 4, 4, 4, "#c43d52"); P(x, tx + 20, ty + 4, "#ff8a9a"); R(x, tx + 10, ty - 2, 6, 2, "#26262f");
  }
  function softbox2(x, sx, sy) {
    R(x, sx + 12, sy + 24, 4, 64, "#3a3f55"); R(x, sx + 12, sy + 24, 1, 64, "#4e5470"); R(x, sx + 4, sy + 84, 20, 4, "#3a3f55"); R(x, sx + 4, sy + 84, 20, 1, "#4e5470");
    R(x, sx, sy, 28, 24, "#1b1e2c"); R(x, sx + 2, sy + 2, 24, 20, "#ece4cf"); R(x, sx + 2, sy + 2, 24, 2, "#fffaf0"); R(x, sx + 2, sy + 18, 24, 4, "#d8cfb8"); R(x, sx + 13, sy + 2, 1, 20, "#ddd4be");
  }
  function easel2(x, ex, ey) {
    for (const lx of [4, 36]) { R(x, ex + lx, ey, 4, 92, "#6b4b33"); R(x, ex + lx, ey, 1, 92, "#8a6648"); }
    R(x, ex + 20, ey + 12, 4, 84, "#5a3e2a");
    R(x, ex, ey + 4, 44, 36, "#f0eadc"); R(x, ex, ey + 4, 44, 2, "#ffffff");
    for (let r = 0; r < 16; r++) R(x, ex + 2, ey + 6 + r, 40, 1, mix("#9fc3e8", "#c8ddf0", r / 16));
    R(x, ex + 2, ey + 22, 40, 16, "#8cc084"); R(x, ex + 2, ey + 22, 40, 2, "#a6d49a"); for (let k = 0; k < 6; k++) P(x, ex + 6 + k * 6, ey + 30 + (k % 2) * 3, "#6a9e64");
    R(x, ex + 12, ey + 14, 16, 10, "#6a87b8"); R(x, ex + 18, ey + 10, 6, 6, "#6a87b8"); R(x, ex + 18, ey + 10, 6, 1, "#e8f0ff"); R(x, ex + 30, ey + 8, 6, 6, "#f0cf6a"); P(x, ex + 31, ey + 9, "#fff6c8");
    R(x, ex, ey + 42, 44, 4, "#6b4b33"); R(x, ex, ey + 42, 44, 1, "#8a6648");
    const bx = ex + 48, by = ey + 76; R(x, bx, by, 16, 12, "#3a2a20"); R(x, bx, by, 16, 1, "#4e3a2c");
    R(x, bx + 2, by + 2, 4, 4, "#c43d52"); R(x, bx + 8, by + 2, 4, 4, "#3f8f8a"); R(x, bx + 2, by + 8, 4, 2, "#f0cf6a"); R(x, bx + 8, by + 8, 5, 2, "#e3e0d6");
  }
  function rack2(x, rx, ry) {
    R(x, rx + 2, ry + 108, 40, 6, "rgba(0,0,0,.3)"); R(x, rx, ry, 40, 112, "#141826"); R(x, rx, ry, 40, 2, "#2c3350"); R(x, rx + 38, ry, 2, 112, "#0b0d17"); R(x, rx, ry, 1, 112, "#1f2438");
    for (let i = 0; i < 9; i++) {
      const y = ry + 6 + i * 12; R(x, rx + 4, y, 32, 8, "#1f2538"); R(x, rx + 4, y, 32, 1, "#2a3150"); R(x, rx + 4, y + 7, 32, 1, "#151a2a");
      for (let k = 0; k < 4; k++) R(x, rx + 6 + k * 3, y + 3, 2, 3, "#0b0d17");
      R(x, rx + 22, y + 2, 14, 4, "#181d2e");
    }
  }
  function toolbench2(x, bx, by) {
    R(x, bx + 2, by + 12, 4, 16, "#3a2e24"); R(x, bx + 54, by + 12, 4, 16, "#3a2e24"); R(x, bx + 4, by + 22, 52, 2, "#3a2e24");
    R(x, bx, by, 60, 12, "#5a4636"); R(x, bx, by, 60, 2, "#6e5744"); R(x, bx, by + 10, 60, 2, "#463628"); for (let i = 8; i < 60; i += 14) R(x, bx + i, by + 3, 1, 7, "#4e3c2e");
    R(x, bx + 6, by - 6, 12, 6, "#9aa5b1"); R(x, bx + 6, by - 6, 12, 1, "#c4ccd6"); R(x, bx + 8, by - 8, 8, 2, "#7a8590");
    R(x, bx + 24, by - 4, 16, 4, "#c95a4c"); R(x, bx + 24, by - 4, 16, 1, "#e07a6c"); R(x, bx + 38, by - 6, 4, 2, "#555");
    R(x, bx + 44, by - 8, 4, 8, "#e3b341"); R(x, bx + 44, by - 8, 4, 1, "#f6d27a"); R(x, bx + 45, by - 10, 2, 2, "#9aa5b1");
  }
  function screen2(c, kind, m, t, on) {
    if (!on) { R(c, m.x, m.y, m.w, m.h, "#10162a"); R(c, m.x + 2, m.y + 2, 6, 1, "#1e2848"); R(c, m.x + 2, m.y + 3, 3, 1, "#1a2340"); return; }
    R(c, m.x, m.y, m.w, m.h, "#1a2c55");
    const f = Math.floor(t / 300);
    if (kind === "code" || kind === "mail") {
      const hl = kind === "code" ? ["#9be3a8", "#f0a6d6", "#7fb2ff"] : ["#f0cf6a", "#7fb2ff", "#c9d6f0"];
      if (kind === "mail") { R(c, m.x, m.y, 5, m.h, "#14244a"); for (let i = 2; i < m.h - 2; i += 3) R(c, m.x + 1, m.y + i, 3, 1, i % 6 ? "#2c4478" : "#f0cf6a"); }
      const x0 = m.x + (kind === "mail" ? 6 : 2);
      for (let i = 2, n = 0; i < m.h - 2; i += 3, n++) { const v = hsh((n + f) * 17 + m.x), ind = (v * 3 | 0) * 2, a = 2 + (v * 5 | 0), b = 2 + (hsh(v * 77) * (m.w - x0 + m.x - a - ind - 5) | 0); R(c, x0 + ind, m.y + i, a, 1, hl[n % 3]); R(c, x0 + ind + a + 1, m.y + i, Math.max(1, b), 1, "#7fb2ff"); }
      if (f % 2) R(c, x0, m.y + m.h - 3, 2, 2, "#e8f0ff");
    } else if (kind === "doc") {
      R(c, m.x + 3, m.y + 2, m.w - 6, m.h - 3, "#e8ecf6"); R(c, m.x + 3, m.y + 2, m.w - 6, 1, "#ffffff");
      R(c, m.x + 5, m.y + 4, (m.w - 10) * 0.6 | 0, 1, "#3a4466");
      for (let i = 7; i < m.h - 3; i += 2) R(c, m.x + 5, m.y + i, (hsh(i * 7 + (f >> 2)) * (m.w - 12) | 0) + 3, 1, "#8a93b0");
      if (f % 2) R(c, m.x + 5 + (f * 3 % (m.w - 12)), m.y + m.h - 5, 1, 3, "#1a2c55");
    } else if (kind === "browser") {
      R(c, m.x, m.y, m.w, 4, "#c9cfdd"); R(c, m.x + 2, m.y + 1, 6, 3, "#e8ecf6"); R(c, m.x + 9, m.y + 1, 6, 3, "#aeb6c8");
      R(c, m.x + 2, m.y + 6, m.w - 4, 2, "#2c4478"); R(c, m.x + 3, m.y + 6, (m.w - 8) * ((f % 8) / 8) | 0, 1, "#7fb2ff");
      R(c, m.x + 2, m.y + 10, 10, 8, "#6a87b8"); R(c, m.x + 3, m.y + 14, 8, 3, "#8cc084"); P(c, m.x + 9, m.y + 11, "#f0cf6a");
      for (let i = 0; i < 4; i++) R(c, m.x + 14, m.y + 10 + i * 2, m.w - 16 - (i % 2) * 5, 1, i ? "#7fb2ff" : "#9fc3ff");
      R(c, m.x + 2, m.y + m.h - 2, m.w - 4, 1, (f % 3) ? "#7fb2ff" : "#f0cf6a");
    } else if (kind === "chart") {
      R(c, m.x, m.y, m.w, m.h, "#0f2038"); for (let gy = m.y + 4; gy < m.y + m.h; gy += 5) R(c, m.x, gy, m.w, 1, "#152a48");
      for (let i = 0; i < 4; i++) { const hgt = 3 + (hsh(i * 9 + (f >> 3)) * (m.h - 8) | 0); R(c, m.x + 3 + i * 7, m.y + m.h - 1 - hgt, 4, hgt, "#1f4a6a"); }
      let py = null; for (let i = 0; i < m.w - 2; i++) { const v = Math.sin((i + f * 2) / 4.4) * 0.4 + 0.5, y = m.y + 2 + ((1 - v) * (m.h - 5) | 0); if (py !== null) line(c, m.x + i, py, m.x + 1 + i, y, "#8cf0a8"); py = y; }
    } else if (kind === "timeline") {
      R(c, m.x, m.y, m.w, m.h - 8, "#2a3a6a"); R(c, m.x + 3, m.y + 2, m.w - 6, m.h - 12, "#5a7ab8");
      R(c, m.x + 3, m.y + m.h - 14, m.w - 6, 4, "#3e5c96"); R(c, m.x + 6, m.y + 4, 6, 4, "#9fc3e8"); R(c, m.x + 3 + ((f * 2) % (m.w - 10)), m.y + m.h - 13, 4, 2, "#e8f0ff");
      R(c, m.x, m.y + m.h - 8, m.w, 8, "#1c2648");
      const cols = ["#b28dd6", "#e58fa8", "#8fb8de", "#8cc084"]; for (let i = 0; i < 4; i++) { R(c, m.x + 2 + i * 6, m.y + m.h - 7, 5, 3, cols[i]); R(c, m.x + 2 + i * 5 + 2, m.y + m.h - 3, 4, 2, cols[(i + 2) % 4]); }
      R(c, m.x + 2 + ((f * 2) % (m.w - 4)), m.y + m.h - 8, 1, 8, "#ffffff");
    } else if (kind === "canvas") {
      R(c, m.x + 2, m.y + 2, m.w - 4, m.h - 4, "#f0eadc"); R(c, m.x, m.y, 2, m.h, "#2c3458"); for (let i = 0; i < 4; i++) R(c, m.x, m.y + 2 + i * 4, 2, 2, ["#e58fa8", "#8fb8de", "#f0cf6a", "#8cc084"][i]);
      const g = ["#e58fa8", "#8fb8de", "#f0cf6a", "#8cc084"];
      for (let i = 0; i < Math.min(10, (f % 30) / 3 | 0); i++) { const sx = m.x + 4 + (hsh(i * 7) * (m.w - 12) | 0), sy = m.y + 4 + (hsh(i * 13) * (m.h - 9) | 0); R(c, sx, sy, 5, 3, g[i % 4]); R(c, sx + 1, sy + 3, 3, 1, shade(g[i % 4], -0.2)); }
    }
    R(c, m.x, m.y, m.w, 1, "rgba(255,255,255,.10)"); R(c, m.x + m.w - 6, m.y + 1, 4, 1, "rgba(255,255,255,.06)");
  }
  function chair2(c, cx, cy) {
    const X = Math.round(cx), Y = Math.round(cy);
    R(c, X - 2, Y + 18, 4, 6, "#1a1e30"); R(c, X - 2, Y + 18, 1, 6, "#2a2f48");
    R(c, X - 10, Y + 24, 20, 2, "#1a1e30"); R(c, X - 10, Y + 24, 20, 1, "#2a2f48");
    for (const wx of [-11, -1, 8]) R(c, X + wx, Y + 26, 3, 2, "#0b0d17");
    R(c, X - 14, Y, 28, 18, K.chair); R(c, X - 13, Y - 1, 26, 1, K.chair); R(c, X - 13, Y, 26, 1, K.chairHi); R(c, X - 12, Y + 2, 2, 14, K.chairHi);
    R(c, X - 14, Y + 16, 28, 2, "#252a4a"); R(c, X + 11, Y + 2, 2, 14, "#272c4d");
    for (let i = 0; i < 4; i++) R(c, X - 7 + i * 5, Y + 6, 2, 1, "#363d68");
  }
  function monitors(d) {
    if (d.dual) return [{ x: d.x + d.w / 2 - 30, y: d.y - 16, w: 28, h: 18 }, { x: d.x + d.w / 2 + 2, y: d.y - 16, w: 28, h: 18 }];
    return [{ x: d.x + d.w / 2 - 16, y: d.y - 16, w: 32, h: 20 }];
  }
  // ---------- px2 native 2x: pantry and lounge (stage 4, scene px) ----------
  function ell(c, cx, cy, rx, ry, col) { c.fillStyle = col; for (let dy = -ry; dy <= ry; dy++) { const w = Math.round(rx * Math.sqrt(1 - (dy * dy) / (ry * ry))); c.fillRect(Math.round(cx) - w, Math.round(cy) + dy, w * 2, 1); } }
  function dia(c, cx, cy, r, col) { for (let k = 0; k <= r; k++) { P(c, cx - r + k, cy - k, col); P(c, cx + r - k, cy - k, col); P(c, cx - r + k, cy + k, col); P(c, cx + r - k, cy + k, col); } }
  function rug2(x, rx, ry, w, h) {
    R(x, rx + 4, ry + h, w - 4, 3, "rgba(0,0,0,.22)");
    R(x, rx, ry, w, h, "#3a2340"); R(x, rx, ry, w, 1, "#4a2c52");
    R(x, rx + 4, ry + 4, w - 8, h - 8, "#4a2c52"); R(x, rx + 4, ry + 4, w - 8, 1, "#5a3662"); R(x, rx + 4, ry + h - 5, w - 8, 1, "#3e2546");
    R(x, rx + 8, ry + 8, w - 16, h - 16, "#3a2340"); R(x, rx + 10, ry + 10, w - 20, h - 20, "#41284a");
    for (let i = rx + 10; i < rx + w - 8; i += 14) { dia(x, i, ry + 2, 1, "#6b3e66"); dia(x, i + 7, ry + h - 3, 1, "#6b3e66"); }
    for (let row = 0, j = ry + 22; j < ry + h - 14; j += 22, row++) for (let i = rx + 24 + (row % 2) * 12; i < rx + w - 16; i += 24) { dia(x, i, j, 4, "#5a3560"); P(x, i, j, "#7a4a74"); }
    for (let i = ry + 2; i < ry + h - 2; i += 4) for (const fx of [rx - 4, rx + w]) { R(x, fx, i, 4, 2, "#8a6a7a"); P(x, fx === rx - 4 ? fx : fx + 3, i, "#a88a98"); }
  }
  function counter2(x) {
    // backsplash
    R(x, 600, 92, 160, 12, "#262d4b"); for (let i = 600; i < 760; i += 10) R(x, i, 92, 1, 12, "#1f2540"); R(x, 600, 97, 160, 1, "#1f2540");
    // worktop, cabinets, kickboard
    R(x, 600, 104, 160, 16, "#8d93ad"); R(x, 600, 104, 160, 2, "#b3b9d0"); R(x, 600, 106, 160, 1, "#a0a6be");
    for (let i = 0; i < 18; i++) P(x, 604 + (hsh(i * 7) * 150 | 0), 108 + (hsh(i * 13) * 6 | 0), "#a3a9c0");
    R(x, 600, 116, 160, 3, "#6b7394"); R(x, 600, 119, 160, 1, "#4a5272");
    R(x, 600, 120, 160, 32, "#2c3250"); R(x, 600, 120, 160, 2, "#1d2135");
    for (let i = 0; i < 4; i++) {
      const dx = 604 + i * 38;
      R(x, dx, 124, 34, 24, "#323a5c"); R(x, dx, 124, 34, 1, "#3e4770"); R(x, dx, 124, 1, 24, "#394268"); R(x, dx, 147, 34, 1, "#232a45"); R(x, dx + 33, 125, 1, 23, "#262d4a");
      R(x, dx + 4, 128, 24, 16, "#2e3556"); R(x, dx + 4, 128, 24, 1, "#272e4c"); R(x, dx + 4, 143, 24, 1, "#38406a");
      R(x, dx + 28, 131, 2, 9, "#8d93ad"); P(x, dx + 28, 131, "#c9cfdd");
    }
    R(x, 600, 150, 160, 4, "#1d2135"); R(x, 600, 153, 160, 1, "#10131f");
    // coffee machine with a cup
    R(x, 610, 78, 26, 26, "#1d2030"); R(x, 610, 76, 26, 4, "#2c3048"); R(x, 611, 76, 24, 1, "#3e4364"); R(x, 634, 78, 2, 26, "#141625");
    R(x, 612, 80, 20, 7, "#2c3048"); R(x, 614, 82, 9, 3, "#0f2a1e"); R(x, 615, 83, 5, 1, "#5ae0a0"); R(x, 628, 82, 2, 2, "#ff5a5a");
    R(x, 619, 88, 8, 3, "#0b0d17"); R(x, 620, 91, 2, 2, "#0b0d17"); R(x, 624, 91, 2, 2, "#0b0d17");
    R(x, 613, 102, 20, 2, "#3a3f55"); R(x, 618, 96, 9, 6, "#e3e0d6"); R(x, 619, 96, 7, 1, "#5a3a2a"); R(x, 625, 97, 2, 5, "#bdb8aa"); R(x, 627, 98, 2, 2, "#e3e0d6");
    // paper towels
    R(x, 640, 90, 8, 14, "#e8e4d8"); R(x, 640, 90, 8, 1, "#ffffff"); R(x, 646, 91, 2, 13, "#c9c4b6"); R(x, 643, 88, 2, 2, "#7a8590");
    // sink and tap
    R(x, 652, 102, 36, 3, "#c9cfdd"); R(x, 655, 103, 30, 2, "#1a1e2e"); R(x, 652, 101, 36, 1, "#e5e9f2");
    R(x, 669, 88, 4, 14, "#9aa5b1"); R(x, 669, 88, 11, 3, "#9aa5b1"); R(x, 669, 88, 11, 1, "#d8dee8"); R(x, 678, 91, 2, 2, "#7a8590"); R(x, 669, 89, 1, 13, "#c4ccd6");
    R(x, 663, 98, 4, 3, "#9aa5b1"); R(x, 675, 98, 4, 3, "#9aa5b1"); P(x, 663, 98, "#5aa0e0"); P(x, 678, 98, "#e05a5a");
    // kettle
    R(x, 700, 92, 12, 12, "#c9cfdd"); R(x, 702, 90, 8, 2, "#c9cfdd"); R(x, 705, 88, 2, 2, "#7a8590"); R(x, 712, 94, 2, 8, "#9aa5b1"); R(x, 697, 95, 3, 3, "#c9cfdd");
    R(x, 702, 94, 2, 7, "#eef0f6"); R(x, 710, 93, 2, 11, "#9aa0b4"); R(x, 700, 103, 12, 1, "#7a8590");
    // microwave
    R(x, 720, 84, 36, 20, "#5a6080"); R(x, 720, 84, 36, 1, "#8a90ac"); R(x, 720, 85, 1, 19, "#6e7494"); R(x, 754, 85, 2, 19, "#40465f"); R(x, 720, 103, 36, 1, "#363b52");
    R(x, 722, 87, 22, 15, "#1a1f33"); R(x, 723, 88, 20, 13, "#222a44"); R(x, 722, 87, 22, 1, "#3a4060"); for (let k = 0; k < 6; k++) P(x, 725 + k, 99 - k * 2, "rgba(255,255,255,.14)");
    R(x, 745, 87, 8, 15, "#4a5070"); R(x, 746, 88, 6, 3, "#0f2a1e"); R(x, 747, 89, 4, 1, "#7cf29c");
    for (let r = 0; r < 3; r++) { P(x, 746, 93 + r * 3, "#2a2e40"); P(x, 749, 93 + r * 3, "#2a2e40"); P(x, 751, 93 + r * 3, "#2a2e40"); }
  }
  function fridge2(x, fx, fy) {
    R(x, fx + 2, fy + 94, 38, 4, "rgba(0,0,0,.3)");
    R(x, fx, fy, 38, 96, "#8f98b3"); R(x, fx, fy, 38, 2, "#b3bbd2"); R(x, fx, fy, 1, 96, "#a3abc4"); R(x, fx + 36, fy, 2, 96, "#6b7390");
    R(x, fx, fy + 34, 38, 2, "#6b7390"); R(x, fx, fy + 36, 38, 1, "#b3bbd2");
    for (const [hy, hh] of [[14, 16], [42, 22]]) { R(x, fx + 4, fy + hy, 2, hh, "#e5e9f2"); R(x, fx + 6, fy + hy + 1, 1, hh - 1, "#6b7390"); }
    R(x, fx + 30, fy + 4, 2, 26, "rgba(255,255,255,.12)"); R(x, fx + 30, fy + 40, 2, 44, "rgba(255,255,255,.12)");
    R(x, fx + 16, fy + 10, 6, 6, "#c43d52"); P(x, fx + 17, fy + 11, "#ff8a9a"); R(x, fx + 26, fy + 18, 6, 4, "#f0cf6a"); R(x, fx + 26, fy + 18, 6, 1, "#fff0b0");
    R(x, fx + 14, fy + 50, 12, 13, "#f3efe5"); R(x, fx + 14, fy + 62, 12, 1, "#cfcabd"); R(x, fx + 16, fy + 54, 8, 1, "#9aa"); R(x, fx + 16, fy + 57, 6, 1, "#9aa"); R(x, fx + 16, fy + 60, 7, 1, "#9aa"); R(x, fx + 19, fy + 48, 2, 3, "#5b8ad6");
    R(x, fx + 18, fy + 68, 8, 8, "#8fd3a8"); R(x, fx + 19, fy + 70, 3, 3, "#f0cf6a"); R(x, fx + 22, fy + 72, 3, 3, "#e58fa8");
    R(x, fx + 4, fy + 86, 28, 6, "#6b7390"); for (let i = 0; i < 7; i++) R(x, fx + 6 + i * 4, fy + 87, 2, 4, "#4f5672");
  }
  function vending2(x, vx, vy) {
    R(x, vx + 2, vy + 106, 46, 4, "rgba(0,0,0,.3)");
    R(x, vx, vy, 46, 108, "#232a48"); R(x, vx, vy, 46, 2, "#3a4370"); R(x, vx, vy + 2, 1, 106, "#2e3660"); R(x, vx + 44, vy, 2, 108, "#141a30");
    R(x, vx + 3, vy + 3, 40, 3, "#1a2040"); for (let i = 0; i < 5; i++) R(x, vx + 6 + i * 7, vy + 4, 4, 1, i % 2 ? "#5aa0e0" : "#e58fa8");
    R(x, vx + 3, vy + 7, 30, 70, "#141a30"); R(x, vx + 4, vy + 8, 28, 68, "#0c1424");
    const vc = ["#e05a5a", "#5ae0a0", "#f0cf6a", "#5aa0e0", "#e58fa8"];
    for (let r = 0; r < 4; r++) {
      const sy = vy + 12 + r * 16;
      for (let k = 0; k < 3; k++) { const col = vc[(r * 3 + k) % 5], cx = vx + 8 + k * 8; R(x, cx, sy, 6, 10, col); R(x, cx, sy, 6, 1, shade(col, 0.4)); R(x, cx, sy + 4, 6, 2, shade(col, -0.3)); P(x, cx + 1, sy + 2, "rgba(255,255,255,.45)"); R(x, cx + 5, sy + 1, 1, 9, shade(col, -0.2)); }
      R(x, vx + 4, sy + 10, 28, 2, "#2a3a6a"); R(x, vx + 4, sy + 10, 28, 1, "#3a4f8a");
    }
    R(x, vx + 4, vy + 8, 28, 68, "rgba(120,220,255,.10)");
    for (let k = 0; k < 10; k++) R(x, vx + 26 - k * 2, vy + 12 + k * 6, 2, 3, "rgba(255,255,255,.06)");
    R(x, vx + 34, vy + 10, 8, 22, "#141a30"); for (let r = 0; r < 4; r++) for (let k = 0; k < 2; k++) R(x, vx + 35 + k * 4, vy + 12 + r * 4, 2, 2, "#3a4370");
    R(x, vx + 36, vy + 34, 2, 2, "#7cf29c"); R(x, vx + 36, vy + 38, 4, 6, "#0b0d17"); R(x, vx + 37, vy + 39, 2, 4, "#2a3150");
    R(x, vx + 34, vy + 50, 8, 24, "#2c4f8a"); for (let i = 0; i < 4; i++) R(x, vx + 35, vy + 53 + i * 5, 6, 2, i % 2 ? "#e58fa8" : "#8fc3ea");
    R(x, vx + 6, vy + 84, 24, 12, "#0b0d17"); R(x, vx + 6, vy + 84, 24, 1, "#2a3150"); R(x, vx + 7, vy + 86, 22, 3, "#1a2040");
    R(x, vx + 2, vy + 104, 4, 4, "#0b0d17"); R(x, vx + 40, vy + 104, 4, 4, "#0b0d17");
  }
  function cooler2(x, cx, cy) {
    R(x, cx + 2, cy + 66, 22, 4, "rgba(0,0,0,.3)");
    R(x, cx, cy + 24, 22, 44, "#c7cde0"); R(x, cx, cy + 24, 22, 2, "#e5e9f2"); R(x, cx, cy + 26, 1, 42, "#d8dded"); R(x, cx + 19, cy + 26, 3, 42, "#a3aac0");
    R(x, cx + 3, cy + 30, 16, 16, "#9aa1b8"); R(x, cx + 3, cy + 30, 16, 1, "#7a8198"); R(x, cx + 4, cy + 43, 14, 2, "#7a8198"); for (let i = 0; i < 4; i++) P(x, cx + 5 + i * 3, cy + 44, "#5a6078");
    R(x, cx + 6, cy + 33, 4, 4, "#5aa0e0"); P(x, cx + 6, cy + 33, "#a8d4ff"); R(x, cx + 12, cy + 33, 4, 4, "#e05a5a"); P(x, cx + 12, cy + 33, "#ff9a9a");
    R(x, cx + 3, cy + 50, 16, 1, "#a3aac0"); for (let i = 0; i < 3; i++) R(x, cx + 6, cy + 56 + i * 3, 10, 1, "#a3aac0");
    R(x, cx + 6, cy - 4, 10, 4, "#3f7fb0"); R(x, cx + 6, cy - 4, 10, 1, "#5f9fd0");
    R(x, cx + 4, cy, 14, 2, "#5f9fd0"); R(x, cx + 2, cy + 2, 18, 22, "#5f9fd0"); R(x, cx + 16, cy + 2, 4, 22, "#4f8fc0");
    for (const ry of [10, 17]) R(x, cx + 2, cy + ry, 18, 1, "#4f8fc0");
    R(x, cx + 4, cy + 3, 3, 19, "#8fc3ea"); P(x, cx + 5, cy + 1, "#bfe0f6");
  }
  function barTable2(x, tx, ty) {
    R(x, tx - 14, ty + 31, 28, 3, "rgba(0,0,0,.25)");
    R(x, tx - 2, ty + 8, 4, 24, "#2a2e3f"); R(x, tx - 2, ty + 8, 1, 24, "#3e4460");
    R(x, tx - 10, ty + 30, 20, 3, "#2a2e3f"); R(x, tx - 10, ty + 30, 20, 1, "#3e4460");
    R(x, tx - 20, ty, 40, 8, "#6b7394"); R(x, tx - 20, ty, 40, 2, "#8d93ad"); R(x, tx - 18, ty, 36, 1, "#a8aec6"); R(x, tx - 20, ty + 7, 40, 1, "#4a5272");
    R(x, tx - 7, ty - 7, 8, 1, "#f6f3ea"); R(x, tx - 6, ty - 6, 6, 6, "#e3e0d6"); R(x, tx - 6, ty - 4, 6, 2, "#a8735a"); R(x, tx - 1, ty - 6, 1, 6, "#bdb8aa");
    mug2(x, tx + 6, ty - 6, "#e07a5f");
  }
  function dining2(x, tx, ty) {
    for (const sx of [tx - 36, tx + 28]) {
      R(x, sx + 2, ty + 12, 2, 12, "#3a2e24"); R(x, sx + 8, ty + 12, 2, 12, "#3a2e24"); R(x, sx + 2, ty + 19, 8, 1, "#3a2e24");
      R(x, sx, ty + 4, 12, 6, "#8d5a44"); R(x, sx, ty + 4, 12, 2, "#a8735a"); R(x, sx, ty + 10, 12, 2, "#6e4434");
    }
    R(x, tx - 24, ty + 24, 52, 4, "rgba(0,0,0,.3)");
    R(x, tx - 2, ty + 12, 4, 13, "#2a2e3f"); R(x, tx - 2, ty + 12, 1, 13, "#3e4460"); R(x, tx - 8, ty + 25, 16, 2, "#2a2e3f");
    ell(x, tx, ty + 6, 24, 9, "#4f5677"); ell(x, tx, ty + 5, 24, 9, "#6b7394"); ell(x, tx, ty + 4, 22, 8, "#8d93ad");
    R(x, tx - 14, ty - 2, 10, 1, "#a8aec6");
    ell(x, tx - 2, ty + 2, 8, 3, "#cfcabd"); ell(x, tx - 2, ty + 1, 7, 2, "#e3e0d6");
    R(x, tx - 7, ty - 1, 3, 2, "#e05a5a"); P(x, tx - 7, ty - 1, "#ff9a8a"); R(x, tx - 3, ty - 1, 3, 2, "#f0cf6a"); R(x, tx + 1, ty, 3, 2, "#8cc084");
    mug2(x, tx + 10, ty - 2, "#7fc8c2");
  }
  function sofaBack2(x, sx, sy) {
    R(x, sx + 4, sy + 66, 160, 6, "rgba(0,0,0,.3)"); R(x, sx + 8, sy + 66, 152, 3, "rgba(0,0,0,.15)");
    R(x, sx, sy, 168, 32, "#4a2f5e"); R(x, sx, sy, 168, 4, "#5f3e78"); R(x, sx + 2, sy, 164, 1, "#76529a");
    for (let i = 0; i < 3; i++) {
      const cx = sx + 16 + i * 46;
      R(x, cx, sy + 6, 42, 24, "#57386f"); R(x, cx, sy + 6, 42, 2, "#6c4a88"); R(x, cx, sy + 8, 1, 20, "#62417c"); R(x, cx + 40, sy + 8, 2, 22, "#4a2f5e"); R(x, cx, sy + 28, 42, 2, "#4a2f5e");
      for (const bx of [10, 30]) { R(x, cx + bx, sy + 16, 2, 2, "#432a56"); P(x, cx + bx, sy + 15, "#6c4a88"); }
    }
    R(x, sx + 16, sy + 30, 136, 16, "#6a4882"); R(x, sx + 16, sy + 30, 136, 2, "#7c5a96"); R(x, sx + 61, sy + 30, 1, 16, "#5a3a72"); R(x, sx + 107, sy + 30, 1, 16, "#5a3a72");
    for (const ax of [sx, sx + 152]) {
      R(x, ax, sy + 4, 16, 60, "#3e2650"); R(x, ax, sy + 4, 16, 6, "#5f3e78"); R(x, ax + 1, sy + 4, 14, 1, "#76529a"); R(x, ax, sy + 10, 16, 1, "#33203f");
      R(x, ax + 2, sy + 12, 2, 50, "#4a2f5e"); R(x, ax + (ax === sx ? 14 : 0), sy + 10, 2, 54, "#2e1c3a");
    }
    for (const fx of [sx + 4, sx + 160]) { R(x, fx, sy + 64, 4, 4, "#2a1a20"); P(x, fx, sy + 64, "#4a3038"); }
    for (const [px, col] of [[sx + 20, "#d8b56d"], [sx + 136, "#7fc8c2"]]) {
      R(x, px, sy + 10, 12, 12, col); R(x, px, sy + 10, 12, 2, shade(col, 0.3)); R(x, px + 10, sy + 12, 2, 10, shade(col, -0.25)); R(x, px, sy + 20, 12, 2, shade(col, -0.25));
      P(x, px - 1, sy + 9, col); P(x, px + 12, sy + 9, col); P(x, px - 1, sy + 22, shade(col, -0.25)); P(x, px + 12, sy + 22, shade(col, -0.25)); R(x, px + 5, sy + 15, 2, 2, shade(col, -0.15));
    }
  }
  function sofaFront2(c, sx, sy) {
    R(c, sx + 16, sy + 44, 136, 20, "#3e2650"); R(c, sx + 16, sy + 44, 136, 2, "#57386f"); R(c, sx + 16, sy + 46, 136, 1, "#4a2f5e"); R(c, sx + 16, sy + 62, 136, 2, "#2e1c3a");
    for (const k of [61, 107]) { R(c, sx + k, sy + 44, 1, 18, "#33203f"); P(c, sx + k + 1, sy + 45, "#57386f"); }
    for (let i = sx + 20; i < sx + 150; i += 6) P(c, i, sy + 59, "#4a2f5e");
  }
  function coffeeTable2(x, tx, ty) {
    R(x, tx + 2, ty + 18, 108, 6, "rgba(0,0,0,.3)");
    R(x, tx + 4, ty + 14, 4, 8, "#3a2e24"); R(x, tx + 100, ty + 14, 4, 8, "#3a2e24"); R(x, tx + 4, ty + 14, 1, 8, "#4e3c2e"); R(x, tx + 100, ty + 14, 1, 8, "#4e3c2e");
    R(x, tx, ty, 108, 10, "#5a4636"); R(x, tx, ty, 108, 2, "#6e5744"); R(x, tx + 1, ty, 106, 1, "#836a54");
    for (const [gx, gy, gw] of [[10, 4, 20], [50, 6, 26], [84, 3, 14], [36, 8, 10]]) R(x, tx + gx, ty + gy, gw, 1, "#4f3d2f");
    R(x, tx, ty + 10, 108, 4, "#463628"); R(x, tx, ty + 13, 108, 1, "#3a2e24");
    R(x, tx + 16, ty + 1, 20, 7, "#c0505e"); R(x, tx + 16, ty + 1, 20, 1, "#e07a80"); R(x, tx + 16, ty + 1, 2, 7, "#8a3440"); R(x, tx + 18, ty + 6, 18, 1, "#e8e4d8");
    R(x, tx + 19, ty - 3, 15, 4, "#5b6aa8"); R(x, tx + 19, ty - 3, 15, 1, "#7f8ccc"); R(x, tx + 19, ty, 15, 1, "#e8e4d8");
    mug2(x, tx + 60, ty - 2, "#e3e0d6");
    R(x, tx + 80, ty + 2, 16, 5, "#3a2a40"); R(x, tx + 81, ty + 2, 14, 1, "#54405e"); R(x, tx + 80, ty + 6, 4, 2, "#3a2a40"); R(x, tx + 92, ty + 6, 4, 2, "#3a2a40");
    P(x, tx + 83, ty + 4, "#8a7a9a"); P(x, tx + 82, ty + 4, "#6a5a7a"); P(x, tx + 84, ty + 4, "#6a5a7a"); P(x, tx + 91, ty + 3, "#e05a5a"); P(x, tx + 93, ty + 4, "#5ae0a0");
  }
  function floorLamp2(x, lx, ly) {
    const cx = lx + 7;
    ell(x, cx, ly + 93, 10, 2, "rgba(0,0,0,.3)");
    R(x, cx - 6, ly + 89, 12, 3, "#3a3f55"); R(x, cx - 5, ly + 89, 10, 1, "#5a6080"); R(x, cx - 7, ly + 91, 14, 1, "#2a2e3f");
    R(x, cx - 1, ly + 16, 2, 74, "#3a3f55"); P(x, cx - 1, ly + 16, "#5a6080"); R(x, cx - 1, ly + 18, 1, 70, "#4e5470");
    for (let r = 0; r < 16; r++) { const w = 16 + Math.round(r * 8 / 15); R(x, cx - w / 2, ly + r, w, 1, mix("#f0dca8", "#d8c08a", r / 15)); P(x, cx - w / 2, ly + r, "#c9ad74"); P(x, cx + w / 2 - 1, ly + r, "#b89a62"); }
    R(x, cx - 8, ly, 16, 1, "#fff0c8"); R(x, cx - 12, ly + 15, 24, 1, "#a8925f"); R(x, cx - 8, ly + 16, 16, 1, "#fff0c0");
    for (let r = 3; r < 13; r += 4) R(x, cx - 4, ly + r, 1, 2, "#fff4d8");
  }
  function beanBag2(x, bx, by) {
    const cx = bx + 24;
    ell(x, cx, by + 36, 22, 3, "rgba(0,0,0,.3)");
    ell(x, cx, by + 24, 24, 11, "#2f5470"); ell(x, cx, by + 22, 23, 11, "#3f6f8f"); ell(x, cx - 2, by + 14, 17, 10, "#3f6f8f");
    ell(x, cx + 3, by + 17, 10, 4, "#3a6886"); ell(x, cx + 3, by + 18, 8, 2, "#36607d"); ell(x, cx - 9, by + 9, 6, 3, "#5a8fb0"); P(x, cx - 11, by + 8, "#7fb0cc");
    line(x, cx - 16, by + 20, cx - 8, by + 31, "#36607d"); line(x, cx + 12, by + 22, cx + 17, by + 30, "#36607d");
    ell(x, cx, by + 31, 20, 2, "#2f5470");
  }
  function blanket(c, y0) { R(c, 908, y0 + 2, 38, 10, "#6a87b8"); R(c, 908, y0 + 2, 38, 2, "#8aa5d2"); R(c, 908, y0 + 10, 38, 2, "#5a77a8"); for (let k = 917; k < 946; k += 9) R(c, k, y0 + 4, 1, 6, "#5a77a8"); R(c, 908, y0 + 2, 1, 10, "#7a97c8"); }
  function bunk2(x, bx, by) {
    R(x, bx + 4, by + 52, 60, 6, "rgba(0,0,0,.25)");
    for (const px of [bx, bx + 60]) { R(x, px, by - 68, 4, 120, "#5a4636"); R(x, px, by - 68, 1, 120, "#6e5744"); R(x, px + 3, by - 68, 1, 120, "#46362a"); R(x, px - 1, by - 70, 6, 3, "#6e5744"); }
    R(x, bx, by - 68, 64, 2, "#6e5744");
    for (const y0 of [by - 44, by + 4]) {
      R(x, bx + 4, y0, 56, 12, "#e5e1d6"); R(x, bx + 4, y0, 56, 1, "#f7f4ec"); R(x, bx + 4, y0 + 10, 56, 2, "#cfcabd");
      R(x, bx + 4, y0 + 12, 56, 6, "#5a4636"); R(x, bx + 4, y0 + 12, 56, 1, "#6e5744"); R(x, bx + 4, y0 + 17, 56, 1, "#46362a");
      R(x, bx + 4, y0, 14, 8, "#f7f4ec"); R(x, bx + 4, y0 + 6, 14, 2, "#d8d3c6"); P(x, bx + 17, y0 + 1, "#d8d3c6");
      blanket(x, y0);
    }
    R(x, bx + 4, by - 26, 56, 2, "rgba(0,0,0,.2)");
    for (const rx of [bx + 64, bx + 70]) { R(x, rx, by - 64, 2, 68, "#5a4636"); R(x, rx, by - 64, 1, 68, "#6e5744"); }
    for (let i = 0; i < 5; i++) { R(x, bx + 64, by - 60 + i * 12, 8, 2, "#6e5744"); R(x, bx + 64, by - 59 + i * 12, 8, 1, "#46362a"); }
  }
  function arcade2(x, ax, ay) {
    R(x, ax, ay, 32, 68, "#2b1f44"); R(x, ax, ay, 32, 2, "#4a3670"); R(x, ax, ay, 2, 68, "#3a2a5a"); R(x, ax + 30, ay, 2, 68, "#1e1530");
    R(x, ax + 2, ay + 2, 28, 3, "#5a2a7a"); for (let i = 0; i < 6; i++) P(x, ax + 5 + i * 4, ay + 3, i % 2 ? "#f0cf6a" : "#e58fa8");
    R(x, ax + 2, ay + 5, 28, 22, "#0b0d17"); R(x, ax + 3, ay + 25, 26, 1, "#1e1530");
    R(x, ax, ay + 28, 32, 8, "#3a2a5a"); R(x, ax, ay + 28, 32, 1, "#5a4680"); R(x, ax, ay + 35, 32, 1, "#241a3a");
    R(x, ax + 7, ay + 26, 2, 4, "#1b1b24"); R(x, ax + 6, ay + 24, 4, 3, "#e05a5a"); P(x, ax + 6, ay + 24, "#ff9a9a");
    R(x, ax + 15, ay + 30, 3, 2, "#5ae0a0"); R(x, ax + 20, ay + 30, 3, 2, "#f0cf6a"); R(x, ax + 25, ay + 31, 3, 2, "#e58fa8");
    R(x, ax + 4, ay + 38, 24, 26, "#231a38"); R(x, ax + 4, ay + 38, 24, 1, "#1a1228");
    R(x, ax + 11, ay + 44, 10, 14, "#1a1228"); R(x, ax + 11, ay + 44, 10, 1, "#33264d"); R(x, ax + 13, ay + 47, 2, 4, "#e05a5a"); R(x, ax + 17, ay + 47, 2, 4, "#e05a5a"); R(x, ax + 13, ay + 53, 6, 1, "#33264d");
    for (let i = 0; i < 5; i++) { P(x, ax + 1, ay + 40 + i * 5, "#e58fa8"); P(x, ax + 30, ay + 42 + i * 5, "#7fb2ff"); }
    R(x, ax, ay + 64, 32, 4, "#1a1228");
  }
  function arcadeScreen(c, t, ax, ay) {
    const X = ax + 4, Y = ay + 6;
    R(c, X, Y, 24, 18, "#120e26");
    const sh = Math.floor(t / 400) % 2;
    for (let i = 0; i < 4; i++) { const ix = X + 2 + i * 5 + sh; R(c, ix, Y + 2, 3, 2, i % 2 ? "#e58fa8" : "#a98ad6"); P(c, ix + (sh ? 0 : 2), Y + 4, i % 2 ? "#e58fa8" : "#a98ad6"); }
    const px = X + 2 + (Math.floor(t / 200) % 8) * 2;
    R(c, px, Y + 14, 5, 2, "#5ae0a0"); P(c, px + 2, Y + 13, "#5ae0a0");
    const b = Math.floor(t / 60) % 10; if (b < 8) R(c, px + 2, Y + 11 - b, 1, 2, "#f0cf6a");
    R(c, X, Y + 17, 24, 1, "#2a2050"); R(c, X + 1, Y, 6, 1, "#f0cf6a");
  }
  // tall pantry pieces stand in front of the right window, so they go on a layer above it
  let FG = null;
  function buildFG() {
    const [c, x] = mk(SW, SH);
    fridge2(x, 768, 68); vending2(x, 812, 64); cooler2(x, 868, 104);
    plant2(x, 904, 116, 2);
    return c;
  }

  // ---------- dynamic layer ----------
  let running = false, inView = true, scale = 1, bufK = 1, gen = 0, cv = null, ctx = null, ov = null, frame = null, agents = [], labelFn = null, onClick = null, stats = {};
  const actors = {}, tags = {};
  let hoverId = null, lastT = 0, cat = null, shooting = null, neonOff = 0;
  // scene px -> backing store (bufK = 1..3 integer multiple of 960, see fit())
  const nat = () => ctx.setTransform(bufK, 0, 0, bufK, 0, 0);
  function blit(img, x, y, sx, sy, sw, sh) { if (sw) ctx.drawImage(img, sx, sy, sw, sh, x, y, sw, sh); else ctx.drawImage(img, x, y); }

  function skyColors(h) {
    if (h >= 7 && h < 17) return ["#6fa6dd", "#b8d8f2", "day"];
    if (h >= 17 && h < 19) return ["#3a3f7a", "#e58a6a", "dusk"];
    if (h >= 5 && h < 7) return ["#4a5a9a", "#f0b088", "dawn"];
    return ["#070b1c", "#1b2550", "night"];
  }
  // ---------- actors ----------
  const isOn = a => a && (a.status === "working" || (a.id === "manager" && a.status !== "offline"));
  function targetFor(a, rank) {
    if (a.status === "offline") return null;
    const d = DESKS[a.id];
    if (isOn(a)) return d ? { x: d.x + d.w / 2, y: d.y + 12, pose: "desk", desk: d } : { x: 548, y: 196, pose: "back" };
    const sleepy = a.last_seen && Date.now() - new Date(a.last_seen) > 40 * 6e4;
    if (sleepy && rank.nap < NAP.length) { const s = NAP[rank.nap++]; return { x: s.x, y: s.y, pose: "nap" }; }
    return { ...SPOTS[rank.spot++ % SPOTS.length], sleepy };
  }
  const aisleY = p => p.x < CORRIDOR_X ? (p.y < 300 ? 264 : 424) : 284;
  function planPath(ac, tgt) {
    const a = aisleY(ac), b = aisleY(tgt), pts = [{ x: ac.x, y: a }];
    if (a !== b) { pts.push({ x: CORRIDOR_X, y: a }); pts.push({ x: CORRIDOR_X, y: b }); }
    pts.push({ x: tgt.x, y: b }, { x: tgt.x, y: tgt.y });
    return pts;
  }
  function syncActors() {
    const rank = { spot: 0, nap: 0 }, seen = new Set();
    for (const a of agents) {
      if (a.enabled === false) continue;
      const tgt = targetFor(a, rank);
      if (!tgt) continue;
      seen.add(a.id);
      const ac = actors[a.id];
      if (!ac) { actors[a.id] = { id: a.id, x: tgt.x, y: tgt.y, tgt, path: [], dir: "front", walk: 0 }; continue; }
      const same = Math.abs(ac.tgt.x - tgt.x) < 2 && Math.abs(ac.tgt.y - tgt.y) < 2;
      ac.tgt = tgt;
      if (!same) ac.path = planPath(ac, tgt);
    }
    for (const id of Object.keys(actors)) if (!seen.has(id)) delete actors[id];
  }
  function stepActors(dt) {
    for (const ac of Object.values(actors)) {
      if (!ac.path.length) { ac.moving = false; continue; }
      const p = ac.path[0], dx = p.x - ac.x, dy = p.y - ac.y, dist = Math.hypot(dx, dy), sp = 80 * dt;
      ac.moving = true; ac.walk += dt * 8;
      if (dist > 1) ac.dir = Math.abs(dy) > Math.abs(dx) && dy < 0 ? "back" : "front";
      if (dist <= sp) { ac.x = p.x; ac.y = p.y; ac.path.shift(); } else { ac.x += dx / dist * sp; ac.y += dy / dist * sp; }
    }
  }

  // ---------- the office cat (scene px; x0/y0 = body centre, feet at y0 + 9) ----------
  const CAT_SPOTS = [[120, 284], [300, 280], [480, 284], [660, 300], [840, 486], [400, 472], [240, 476], [700, 248], [900, 300], [200, 452]];
  const CAT_HOME = [744, 456];
  function stepCat(dt, t) {
    if (!cat) cat = { x: CAT_HOME[0], y: CAT_HOME[1], tx: CAT_HOME[0], ty: CAT_HOME[1], mode: "sleep", until: t + 9000, face: 1, walk: 0 };
    const s = cat;
    if (s.mode !== "walk" && t > s.until) {
      if (Math.random() < 0.35) { s.tx = CAT_HOME[0]; s.ty = CAT_HOME[1]; s.next = "sleep"; }
      else { const p = CAT_SPOTS[Math.random() * CAT_SPOTS.length | 0]; s.tx = p[0]; s.ty = p[1]; s.next = "sit"; }
      s.mode = "walk";
    }
    if (s.mode === "walk") {
      const dx = s.tx - s.x, dy = s.ty - s.y, d = Math.hypot(dx, dy), sp = 44 * dt;
      if (Math.abs(dx) > 1) s.face = dx > 0 ? 1 : -1;
      s.walk += dt * 10;
      if (d <= sp) { s.x = s.tx; s.y = s.ty; s.mode = s.next; s.until = t + 6000 + Math.random() * 12000; }
      else { s.x += dx / d * sp; s.y += dy / d * sp; }
    }
  }
  function drawCat(c, t) {
    const s = cat, x0 = Math.round(s.x), y0 = Math.round(s.y);
    const o = "#d98b3d", st = "#a8642a", hi = "#f0aa5e", dk = "#2a1a10", cr = "#f3e0c8", pk = "#e8a0a0";
    ell(c, x0, y0 + 10, 11, 1, "rgba(0,0,0,.3)");
    if (s.mode === "sleep") {   // curled loaf, tail wrapped round the front
      R(c, x0 - 8, y0 + 2, 16, 8, o); R(c, x0 - 6, y0, 12, 2, o); R(c, x0 - 6, y0, 10, 1, hi); R(c, x0 - 8, y0 + 2, 1, 7, st);
      R(c, x0 - 4, y0 + 1, 2, 5, st); R(c, x0, y0 + 1, 2, 5, st); R(c, x0 - 7, y0 + 4, 2, 3, st);
      R(c, x0 + 4, y0 + 2, 6, 6, o); R(c, x0 + 4, y0, 2, 2, o); R(c, x0 + 8, y0, 2, 2, o); P(c, x0 + 5, y0 + 1, pk);
      R(c, x0 + 5, y0 + 4, 2, 1, dk); R(c, x0 + 8, y0 + 4, 1, 1, dk); R(c, x0 + 6, y0 + 6, 4, 2, cr);
      R(c, x0 - 9, y0 + 8, 15, 2, st); R(c, x0 - 9, y0 + 8, 15, 1, o); P(c, x0 + 6, y0 + 9, dk);
      const p = (t / 1800) % 1; pixZ(c, x0 + 8 + p * 8, y0 - 8 - p * 12, `rgba(230,230,255,${1 - p})`);
      return;
    }
    const f = s.face, r = (dx, dy, w, h, col) => R(c, f > 0 ? x0 + dx : x0 - dx - w + 1, y0 + dy, w, h, col);
    const walk = s.mode === "walk", ph = Math.floor(s.walk) % 2;
    // legs (two pairs, alternating while walking), cream paws
    for (const [lx, pair] of [[-7, 0], [-3, 1], [2, 0], [6, 1]]) { const up = walk && pair === ph; r(lx, 7, 2, up ? 1 : 2, pair ? st : o); r(lx, up ? 8 : 9, 2, 1, cr); }
    // tail
    const tw = Math.sin(t / 300) > 0 ? -2 : 0;
    r(-10, 1, 2, 3, o); r(-12, tw - 1, 2, 5, o); r(-12, tw - 1, 2, 1, st); P(c, f > 0 ? x0 - 11 : x0 + 10, y0 + tw - 2, st);
    // body with stripes
    r(-8, 1, 15, 6, o); r(-7, 1, 13, 1, hi); r(-8, 6, 15, 1, st);
    r(-5, 1, 2, 3, st); r(-1, 1, 2, 3, st); r(3, 1, 2, 2, st); r(-8, 3, 2, 2, st);
    // head, ears, muzzle, eye
    r(4, -3, 8, 7, o); r(4, -3, 7, 1, hi); r(4, -5, 2, 2, o); r(9, -5, 2, 2, o); r(5, -4, 1, 1, pk); r(9, -4, 1, 1, pk);
    r(9, 1, 4, 3, cr); r(12, 0, 1, 1, pk); r(5, 2, 3, 3, cr);
    r(8, -1, 2, 2, dk); r(9, -1, 1, 1, "#c8e870");
  }

  // ---------- frame ----------
  function glow(c, x, y, r, col, a) {
    const gr = c.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, col.replace("A", a)); gr.addColorStop(1, col.replace("A", 0));
    c.fillStyle = gr; c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  function zz(c, x, y, t, id) {
    for (let i = 0; i < 2; i++) { const p = ((t / 1700) + i / 2 + (strHash(id) % 10) / 10) % 1; pixZ(c, x + p * 10 + i * 4, y - p * 20, `rgba(220,225,255,${1 - p})`); }
  }
  // a soft two-step floor shadow under a standing / walking sprite (cx = sprite centre, fy = feet line)
  function footShadow(c, cx, fy) { R(c, cx - 8, fy - 1, 16, 4, "rgba(0,0,0,.18)"); R(c, cx - 10, fy, 20, 2, "rgba(0,0,0,.14)"); }

  function draw(g, ts) {
    if (g !== gen) return;
    if (!cv || !cv.isConnected) { running = false; return; }
    if (!inView || document.hidden) { running = false; return; }   // office-fit: park the loop offscreen / in a hidden tab; kick() restarts it
    requestAnimationFrame(t2 => draw(g, t2));
    if (ts - lastT < 33) return;
    const dt = Math.min(0.1, (ts - lastT) / 1000); lastT = ts;
    const t = ts, c = ctx;
    if (!BG) { BG = buildBG(); FG = buildFG(); }
    stepActors(dt); stepCat(dt, t);
    if (!shooting && Math.random() < 0.002) shooting = { t0: t, seed: Math.random() < 0.5 ? 11 : 29, x: 8 + Math.random() * 60, y: 4 + Math.random() * 16 };
    if (neonOff < t && Math.random() < 0.004) neonOff = t + 120 + Math.random() * 200;
    nat(); c.drawImage(BG, 0, 0);

    // wall: windows, neon sign, wall display, clock, live chart
    windowScene2(c, 28, 16, 156, 72, t, 11, true); windowScene2(c, 760, 16, 156, 72, t, 29, false);
    c.drawImage(FG, 0, 0);
    const neonOn = t > neonOff;
    wallPieces(c, t, neonOn);

    // desk screens + LED strips
    for (const [id, dsk] of Object.entries(DESKS)) {
      const a = agents.find(x => x.id === id), on = isOn(a);
      for (const m of monitors(dsk)) screen2(c, dsk.screen, m, t + m.x * 20, on);
      const led = on ? (a.color || "#6fa8ff") : "#2e3452"; R(c, dsk.x + 4, dsk.y + 24, dsk.w - 8, 1, led); R(c, dsk.x + 4, dsk.y + 25, dsk.w - 8, 1, on ? shade(led, -0.35) : "#262b44");
    }
    for (let i = 0; i < 9; i++) for (let j = 0; j < 3; j++) { const on = Math.sin(t / (180 + j * 70) + i * 2.1 + j) > 0.1; R(c, 542 + j * 4, 293 + i * 12, 2, 2, on ? (j === 2 ? "#f0cf6a" : "#7cf29c") : "#1f3a2a"); }
    // pantry / lounge bits that move: coffee steam, a bubble in the cooler bottle, the arcade attract screen
    for (let i = 0; i < 3; i++) { const p = ((t / 1400) + i / 3) % 1; R(c, 622 + Math.round(Math.sin(p * 6 + i) * 3), Math.round(92 - p * 24), 2, 2, `rgba(220,220,240,${(0.45 * (1 - p)).toFixed(3)})`); }
    { const p = (t / 2600) % 1; if (p < 0.7) R(c, 879 + (Math.sin(t / 220) > 0 ? 1 : 0), Math.round(122 - p / 0.7 * 16), 2, 2, "rgba(225,242,255,.6)"); }
    arcadeScreen(c, t, 908, 412);

    // actors, back to front
    const list = Object.values(actors).sort((a, b) => a.y - b.y);
    const blinkOf = id => Math.floor(t / 120 + strHash(id) % 40) % 40 === 0;
    const naps = [];
    for (const [id, dsk] of Object.entries(DESKS)) { const ac = actors[id]; if (!(ac && ac.tgt.pose === "desk" && !ac.moving)) chair2(c, dsk.x + dsk.w / 2, dsk.y + 36); }
    let sofaDone = false;
    for (const ac of list) {
      const a = agents.find(x => x.id === ac.id); if (!a) continue;
      if (!sofaDone && ac.y > SOFA.y + 12) { sofaFront2(c, SOFA.x, SOFA.y); sofaDone = true; }
      const hov = hoverId === ac.id ? "#ffffff" : "", X = Math.round(ac.x), Y = Math.round(ac.y);
      const X2 = X - 18, Y2 = Y - 2;   // sprite canvas origin (36x40 with a 2px pad)
      if (ac.moving) {
        const fr = Math.floor(ac.walk) % 4, legs = fr === 1 ? "w1" : fr === 3 ? "w2" : "";
        footShadow(c, X, Y + 35);
        blit(sprite(a, ac.dir, { legs, outline: hov, blink: blinkOf(a.id) }), X2, Y2 - 2 * (fr % 2));
        continue;
      }
      const pose = ac.tgt.pose;
      if (pose === "desk") {
        const typing = a.status === "working" && Math.floor(t / 170 + strHash(a.id)) % 2;
        blit(sprite(a, "back", { legs: "hide", outline: hov }), X2, Y2 - (typing ? 1 : 0));
        chair2(c, ac.x, ac.tgt.desk.y + 36);
      } else if (pose === "sofa" || pose === "bean") {
        const sl = ac.tgt.sleepy && Math.floor(t / 5000 + strHash(a.id) % 7) % 3 !== 0;
        blit(sprite(a, "front", { legs: "hide", sleep: sl, blink: !sl && blinkOf(a.id), outline: hov }), X2, Y2 + (Math.floor(t / 900 + strHash(a.id)) % 2));
        if (sl) zz(c, X + 12, Y - 6, t, a.id);
      } else if (pose === "nap") {
        naps.push(ac);
      } else {
        footShadow(c, X, Y + 35);
        blit(sprite(a, pose === "back" ? "back" : "front", { blink: blinkOf(a.id), outline: hov }), X2, Y2 + (Math.floor(t / 1100 + strHash(a.id)) % 2));
      }
    }
    if (!sofaDone) sofaFront2(c, SOFA.x, SOFA.y);
    for (const ac of naps) {
      const a = agents.find(x => x.id === ac.id), y0 = Math.round(ac.y);
      blit(sprite(a, "front", { sleep: true, outline: hoverId === ac.id ? "#ffffff" : "" }), 884, y0 - 14, 0, 0, 36, 22);
      blanket(c, y0);
      zz(c, 908, y0 - 16, t, a.id);
    }
    drawCat(c, t);

    // light (scene px): screens, desk lamps, floor lamp, vending machine, neon, wall display, softbox, arcade, windows
    c.save(); c.globalCompositeOperation = "lighter";
    for (const [id, dsk] of Object.entries(DESKS)) {
      const on = isOn(agents.find(x => x.id === id));
      if (on) for (const m of monitors(dsk)) glow(c, m.x + m.w / 2, m.y + m.h, 52, "rgba(90,140,255,A)", 0.22);
      if (dsk.lamp) glow(c, dsk.dual ? dsk.x + 8 : dsk.x + dsk.w - 8, dsk.y + 4, 40, "rgba(255,190,110,A)", on ? 0.26 : 0.12);
    }
    glow(c, 619, 318, 96, "rgba(255,190,120,A)", 0.22);
    glow(c, 619, 392, 30, "rgba(255,200,130,A)", 0.10);   // the lamp's pool on the floor
    glow(c, 830, 112, 60, "rgba(110,220,255,A)", 0.2);
    if (neonOn) glow(c, 282, 46, 92, "rgba(255,95,162,A)", 0.16);
    glow(c, 482, 52, 112, "rgba(80,130,255,A)", 0.14);
    glow(c, 190, 336, 64, "rgba(255,240,200,A)", 0.15);
    glow(c, 924, 428, 40, "rgba(150,90,255,A)", 0.2);
    const mode = skyColors(new Date().getHours())[2];
    if (mode !== "night") for (const wx of [106, 838]) glow(c, wx, 144, 144, "rgba(200,220,255,A)", mode === "day" ? 0.14 : 0.08);
    else for (const wx of [106, 838]) glow(c, wx, 132, 100, "rgba(120,150,255,A)", 0.06);
    c.restore();
    const vg = c.createRadialGradient(SW / 2, SH / 2, SH * 0.45, SW / 2, SH / 2, SW * 0.62);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(3,4,12,.45)"); c.fillStyle = vg; c.fillRect(0, 0, SW, SH);

    placeTags();
  }

  // ---------- DOM overlay (crisp text) ----------
  const pct = (v, total) => (v / total * 100).toFixed(3) + "%";
  function buildOverlay() {
    ov.innerHTML = ROOMS.map(r => `<div class="room-label" style="left:${pct(r.x, W)};top:${pct(r.y, H)}">${r.label}</div>`).join("") +
      `<div class="ov-screen" style="left:${pct(428, W)};top:${pct(26, H)};width:${pct(108, W)};height:${pct(60, H)}"><b data-k="s1"></b><span data-k="s2"></span></div>
       <div class="ov-neon" style="left:${pct(210, W)};top:${pct(26, H)};width:${pct(144, W)};height:${pct(40, H)}"><span data-k="n1"></span></div>
       <div class="ov-tip" hidden></div>`;
    for (const k of Object.keys(tags)) delete tags[k];
  }
  function tagFor(id) {
    if (tags[id]) return tags[id];
    const n = document.createElement("div"); n.className = "seat-name";
    const b = document.createElement("div"); b.className = "bubble"; b.hidden = true;
    ov.appendChild(n); ov.appendChild(b);
    return (tags[id] = { n, b });
  }
  // office-fit: label/bubble sizes in scene units (measured in css px, cached per text+scale so we do not force layout every frame)
  function measure(el, key) {
    if (el._mk !== key) { el._mk = key; el._mw = el.offsetWidth / scale; el._mh = el.offsetHeight / scale; }
    return [el._mw, el._mh];
  }
  const hits = (r, q) => r.l < q.r && q.l < r.r && r.t < q.b && q.t < r.b;
  function placeTags() {
    const items = [];
    for (const ac of Object.values(actors)) {
      const a = agents.find(x => x.id === ac.id); if (!a) continue;
      const tg = tagFor(ac.id), name = labelFn ? labelFn(a) : a.name || a.id;
      if (tg.n.textContent !== name) tg.n.textContent = name;
      const pose = ac.tgt.pose;
      let nx = ac.x, ny = ac.y + 38;
      if (!ac.moving && pose === "desk") ny = ac.tgt.desk.y + 66;
      if (!ac.moving && pose === "nap") { nx = 924; ny = ac.y + 20; }
      if (!ac.moving && pose === "sofa") ny = 394 + (Math.round(ac.x) === 726 ? 16 : 0);
      if (!ac.moving && pose === "bean") ny = 456;
      items.push({ ac, a, tg, nx, ny });
      tg.n.classList.toggle("hov", hoverId === ac.id);
      tg.n.classList.toggle("on", isOn(a));
      const act = a.status === "working" && a.activity && !ac.moving && pose === "desk";
      tg.b.hidden = !act;
      if (act) {
        const txt = (window.App && App.mgrOnline && App.mgrOnline(a) ? (App.UI.lang === "en" ? "Watching the inbox" : "看着信箱") : String(a.activity)).slice(0, 30); if (tg.b.textContent !== txt) tg.b.textContent = txt;   // t-now-closed: the manager with no live card says 看着信箱
        const [bw, bh] = measure(tg.b, txt + "|" + scale);
        const bx = Math.min(W - bw / 2 - 2, Math.max(bw / 2 + 2, ac.x));      // never clip at the card edge
        tg.b.style.left = pct(bx, W); tg.b.style.top = pct(Math.max(bh + 2, ac.tgt.desk.y - 22), H);
        tg.b.style.setProperty("--tx", Math.max(-bw * scale / 2 + 7, Math.min(bw * scale / 2 - 7, (ac.x - bx) * scale)).toFixed(1) + "px");
      }
    }
    // name labels: clamp inside the scene, then nudge sideways / down until nothing overlaps
    items.sort((p, q) => p.ny - q.ny || p.nx - q.nx);
    const placed = [];
    for (const it of items) {
      const [w, h] = measure(it.tg.n, it.tg.n.textContent + "|" + scale);
      const lo = w / 2 + 2, hi = W - w / 2 - 2;
      let x = Math.min(hi, Math.max(lo, it.nx)), y = Math.min(H - h - 2, it.ny);
      const box = (xx, yy) => ({ l: xx - w / 2, r: xx + w / 2, t: yy, b: yy + h });
      for (let k = 0; k < 6; k++) {
        const r = box(x, y), c = placed.find(q => hits(r, q));
        if (!c) break;
        const tries = [[c.r + 2 + w / 2, y], [c.l - 2 - w / 2, y], [x, c.b + 2]];
        const ok = tries.find(([xx, yy]) => xx >= lo && xx <= hi && yy <= H - h - 2 && !placed.some(q => hits(box(xx, yy), q)));
        const [nx2, ny2] = ok || [x, c.b + 2]; x = nx2; y = Math.min(H - h - 2, ny2);
      }
      placed.push(box(x, y));
      it.tg.n.style.left = pct(x, W); it.tg.n.style.top = pct(y, H);
    }
    for (const [id, tg] of Object.entries(tags)) if (!actors[id]) { tg.n.remove(); tg.b.remove(); delete tags[id]; }
  }
  function updateOverlayText() {
    if (!ov) return;
    for (const k of ["s1", "s2", "n1"]) { const el = ov.querySelector(`[data-k="${k}"]`); const v = stats[k] || ""; if (el && el.textContent !== v) el.textContent = v; }
  }

  // keep the hover/keyboard tooltip inside the card
  function putTip(tip, x, y, b) {
    x = Math.max(4, Math.min(x, b.width - tip.offsetWidth - 4)); y = Math.max(4, Math.min(y, b.height - tip.offsetHeight - 4));
    tip.style.left = x + "px"; tip.style.top = y + "px";
  }
  function hit(e) {
    const b = cv.getBoundingClientRect();
    const x = (e.clientX - b.left) / b.width * W, y = (e.clientY - b.top) / b.height * H;
    let best = null;
    const hitR = Math.max(22, 22 / (b.width / W));   // ui10: >= 22 css px radius so a fingertip lands on a sprite at phone scale
    for (const ac of Object.values(actors)) {
      let ax = ac.x, ay = ac.y + 16;
      if (ac.tgt.pose === "nap" && !ac.moving) { ax = 902; ay = ac.y - 4; }
      const dd = Math.hypot(x - ax, y - ay);
      if (dd < hitR && (!best || dd < best.d)) best = { id: ac.id, d: dd };
    }
    return best && best.id;
  }
  const phoneMQ = window.matchMedia ? window.matchMedia("(max-width: 760px)") : { matches: false };
  function fit() {
    // office-fit: the observer can fire after mount() replaced/detached our nodes (app re-renders the page body)
    if (!frame || !cv || !frame.isConnected || !cv.isConnected) return;
    const par = frame.parentElement; if (!par || !par.isConnected) return;
    const avail = par.clientWidth;
    if (avail <= 0) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    // px2: two ways to put the 960-wide scene on screen.
    //  crisp  - a whole number n of device px per scene px: backing store 960 wide, image-rendering: pixelated (exact).
    //  smooth - fill the width: backing store an integer multiple of 960 at least as wide as the device px,
    //           then one mild smooth step down (no fractional nearest-neighbour, so no uneven 1/2 px columns).
    // Phone always fills the card (smooth unless it happens to land on an integer). Desktop takes crisp when n >= 2,
    // or n = 1 if that costs at most 20% of the width; otherwise smooth.
    let k = 1, cssW, crisp = false;
    if (phoneMQ.matches) {
      cssW = Math.floor(avail) - 2;
      frame.style.width = Math.floor(avail) + "px";
    } else {
      const r = avail * dpr / SW, n = Math.floor(r);
      if (n >= 2 || (n === 1 && n / r >= 0.8)) { cssW = SW * n / dpr; crisp = true; }
      else cssW = Math.floor(avail);
      frame.style.width = cssW + 2 + "px";
    }
    if (!crisp) {
      const dev = cssW * dpr;
      k = Math.min(3, Math.max(1, Math.ceil(dev / SW - 0.01)));
      crisp = Math.abs(dev - SW * k) < 1;
    }
    cv.style.width = cssW + "px";
    cv.style.imageRendering = crisp ? "pixelated" : "auto";
    if (cv.width !== SW * k) { cv.width = SW * k; cv.height = SH * k; }
    bufK = k; ctx.imageSmoothingEnabled = false; nat();
    scale = cssW / W;
  }
  function kick() { if (running || !cv || !cv.isConnected) return; running = true; lastT = performance.now(); const g = gen; requestAnimationFrame(t => draw(g, t)); }

  function mount(el, cb) {
    onClick = cb;
    el.innerHTML = `<div class="office-frame"><canvas width="${SW}" height="${SH}"></canvas><div class="office-ov"></div></div>`;
    frame = el.querySelector(".office-frame"); cv = el.querySelector("canvas"); ov = el.querySelector(".office-ov");
    ctx = cv.getContext("2d"); ctx.imageSmoothingEnabled = false;
    buildOverlay(); fit(); updateOverlayText();
    // refit whenever the container changes size (hidden → shown on phones, chat panel resize, rotation)
    if (mount._ro) mount._ro.disconnect(); if (mount._io) mount._io.disconnect();
    if (window.ResizeObserver) { mount._ro = new ResizeObserver(() => fit()); mount._ro.observe(el); }
    // office-fit: no animation while the scene is scrolled out of view
    if (window.IntersectionObserver) { mount._io = new IntersectionObserver(es => { inView = es[es.length - 1].isIntersecting; if (inView) { fit(); kick(); } }); mount._io.observe(frame); } else inView = true;
    cv.addEventListener("mousemove", e => {
      hoverId = hit(e); cv.style.cursor = hoverId ? "pointer" : "default";
      const tip = ov.querySelector(".ov-tip"), a = hoverId && agents.find(x => x.id === hoverId);
      if (!a) { tip.hidden = true; return; }
      const b = cv.getBoundingClientRect();
      tip.hidden = false; tip.innerHTML = `<b>${esc(labelFn ? labelFn(a) : a.name)}</b> · ${esc(a.title || "")}<br><span>${esc(a.status === "working" ? "▶ " + (a.activity || "working") : (a.status || "idle"))}</span>`;
      putTip(tip, e.clientX - b.left + 14, e.clientY - b.top + 12, b);
    });
    cv.addEventListener("mouseleave", () => { hoverId = null; const tip = ov.querySelector(".ov-tip"); if (tip) tip.hidden = true; });
    cv.addEventListener("click", e => { const id = hit(e); if (id && onClick) onClick(id, e); });
    // ui10 keyboard: the canvas is one tab stop; arrows pick a character (tooltip shows who), Enter/Space opens them
    cv.tabIndex = 0; cv.setAttribute("role", "application"); cv.setAttribute("aria-label", "办公室 · 左右方向键选角色，回车打开 TA 在办的单子");
    cv.addEventListener("keydown", e => {
      const ids = agents.map(a => a.id); if (!ids.length) return;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault(); const i = ids.indexOf(hoverId);
        hoverId = ids[(i + (e.key === "ArrowRight" ? 1 : -1) + ids.length) % ids.length];
        const ac = actors[hoverId], a = agents.find(x => x.id === hoverId), tip = ov.querySelector(".ov-tip"), b = cv.getBoundingClientRect();
        if (ac && a && tip) { tip.hidden = false;
          tip.innerHTML = `<b>${esc(labelFn ? labelFn(a) : a.name)}</b> · ${esc(a.title || "")}<br><span>${esc(a.status === "working" ? "▶ " + (a.activity || "working") : (a.status || "idle"))}</span>`
          putTip(tip, ac.x * scale + 14, ac.y * scale + 12, b); }
      } else if ((e.key === "Enter" || e.key === " ") && hoverId && onClick) { e.preventDefault(); onClick(hoverId, e); }
    });
    cv.addEventListener("blur", () => { hoverId = null; const tip = ov.querySelector(".ov-tip"); if (tip) tip.hidden = true; });
    const g = ++gen; lastT = performance.now(); running = true;
    requestAnimationFrame(t => draw(g, t));
  }
  window.addEventListener("resize", () => fit());
  window.addEventListener("orientationchange", () => setTimeout(fit, 120));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { fit(); kick(); } });
  if (phoneMQ.addEventListener) phoneMQ.addEventListener("change", () => fit());
  // theme switches repaint the page chrome; refit in case the container metrics changed with it
  if (window.MutationObserver) new MutationObserver(() => fit()).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  function update(list, lf, st) { agents = list; labelFn = lf; stats = st || {}; syncActors(); updateOverlayText(); fit(); kick(); }

  window.Office = { mount, update, avatar, sprite };   // sprite: for sprite-sheet previews (pixel-char routine)
})();
