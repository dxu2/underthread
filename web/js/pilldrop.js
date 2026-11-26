/* t-pill-wellness: the droplet morphs of the top pill (#lka-pw, web/js/lookaway.js). User pick 11-23 (ask a1778c): 「a+b 都做（日/夜切换）」.
 *   Look per theme (look()): night = 0 LookAway dark liquid glass; day + knit texture = 1 knit felt; other day = 2 white frosted glass.
 *   Only the moments of change are drawn here: one WebGL canvas (#lka-drop, under the pill) draws a signed distance field = the top edge of the
 *   screen + a drop / the pill (rounded box) + a thread that snaps + the answer bud, joined with a smooth-min so necks form and snap on their own.
 *   Motion = damped springs evaluated as pure functions of time (scene()). At rest the canvas is gone and the CSS pill (backdrop-filter) takes over.
 *   Phases: "in" (drop out of the top edge, thread snaps, spreads into the pill, ripple), "bud" (ask: the 回答 bud splits off the right end),
 *   "out" (the pill folds back into a drop that is swallowed by the top edge).
 *   The page cannot be fed to WebGL, so the canvas never refracts the page: it shades with alpha (tint, rim, glow, rainbow, felt, seam) and the ripple
 *   is a light ring. Desktop Chromium also gets a real refracting rim at rest (lens(): an SVG displacement map in backdrop-filter, Chromium-only).
 *   No WebGL or reduced motion: ok() is false and lookaway.js keeps its plain fade / drop.
 *   Classes / ids: lka-drop, lka-lens-* (prefix of lookaway.js, checked unused). Test hook: window.PillDrop. */
(function () {
  const RM = matchMedia("(prefers-reduced-motion: reduce)"), PHONE = matchMedia("(max-width: 760px)");
  const R = document.documentElement;
  /* 0 dark glass (night), 1 knit felt (knit day), 2 white frosted (other day) */
  function look() {
    const t = R.dataset.theme, day = t === "white" || t === "light";
    if (!day) return 0;
    return /^knit/.test(R.dataset.texture || "") ? 1 : 2;
  }
  // ---------- springs (analytic step response: deterministic for any t) ----------
  function sp(t, t0, w, z) {
    const u = t - t0; if (u <= 0) return 0;
    if (z >= 1) return 1 - Math.exp(-w * u) * (1 + w * u);
    const wd = w * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w * u) * (Math.cos(wd * u) + (z * w / wd) * Math.sin(wd * u));
  }
  const cl = (x, a, b) => Math.max(a, Math.min(b, x));
  const ss = (a, b, x) => { const t = cl((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const lerp = (a, b, k) => a + (b - a) * k;
  const DUR = { in: 1.62, bud: 0.95, out: 0.98, outAsk: 1.12 };

  /* G = { CX: centre of the pill alone, RX: rest centre (= CX, or left of it when the bud is out), Y, HW, HH, BR, GAP, R0, ask }
     returns the shape (pill [cx,y,hw,hh], threads, bud [x,y,r]) and the content values (c = text, bl = bud label) at time t of a phase */
  function scene(ph, t, G) {
    const s = { ta: [0, 0, 0, 0], tb: [0, 0, 0, 0], bud: [0, 0, 0], rip: -1, c: 1, bl: 0, seam: 1, glow: 1, shape: 1 };
    const { CX, Y, HW, HH, BR, GAP, R0 } = G, SH = (GAP + 2 * BR) / 2;
    let cx = G.RX, y = Y, hw = HW, hh = HH;
    if (ph === "in") {
      const FW = 17, FZ = 0.62, top = -R0 - 2;
      const fall = sp(t, 0.04, FW, FZ);
      y = lerp(top, Y, fall);
      const v = (lerp(top, Y, sp(t + 0.008, 0.04, FW, FZ)) - y) / 0.008;
      const st = cl(v / (380 * (Y - top) / 64), -0.28, 0.45);   // stretch while falling, squash on the rebound (scaled to the fall)
      hw = R0 * (1 - st * 0.5); hh = R0 * (1 + st);
      const TB = 0.2;
      if (t < TB) s.ta = [CX, -2, y - hh * 0.5, lerp(5, 1.6, ss(0.06, TB, t))];
      else if (t < TB + 0.22) {
        const k = sp(t, TB, 22, 0.8), cut = lerp(-2, y, 0.4), r = 1.6 + 1.2 * k;
        s.ta = [CX, -2, lerp(cut, -2, k), r * (1 - ss(TB + 0.12, TB + 0.22, t))];
        s.tb = [CX, lerp(cut, y, k), y, r * (1 - ss(TB + 0.1, TB + 0.2, t))];
      }
      const T2 = 0.3, e = sp(t, T2, 16, 0.5), e2 = sp(t, T2 - 0.02, 19, 0.5);
      if (t > T2) { hw = lerp(hw, HW, e); hh = lerp(hh, HH, e2) * (1 - 0.5 * Math.max(0, e - 1)); }
      cx = CX;
      s.c = ss(0.42, 0.8, t); s.glow = ss(0.5, 1.0, t); s.seam = ss(0.62, 1.15, t);
      s.rip = t > 0.4 ? (t - 0.4) / 0.95 : -1;
      s.shape = 1 - ss(0.86, 1.02, t);
    } else if (ph === "bud") {
      const b = sp(t, 0.05, 13.5, 0.5), br = sp(t, 0.03, 17, 0.62);
      cx = CX - SH * b;
      s.bud = [lerp(cx + HW - BR - 4, cx + HW + GAP + BR, b), Y, BR * cl(br, 0, 1.12)];
      s.bl = ss(0.32, 0.6, t);
      s.shape = ss(0, 0.06, t) * (1 - ss(0.74, 0.9, t));
    } else {
      const ask = G.ask, o = ask ? 0.1 : 0;
      s.shape = ss(0, 0.05, t);
      s.c = 1 - ss(0, 0.14, t); s.bl = 1 - ss(0, 0.12, t);
      s.glow = 1 - ss(0, 0.3, t); s.seam = 1 - ss(0, 0.12, t);
      const k = sp(t, o, 14, 0.8);
      hw = lerp(HW, HH, k); cx = lerp(G.RX, CX, k);
      const rr = sp(t, o + 0.26, 12, 0.85);
      hw = lerp(hw, R0, rr); hh = lerp(HH, R0, rr);
      const T5 = o + 0.38, up = sp(t, T5, 11, 0.9);
      y = lerp(Y, -R0 - 12, up);
      const vu = cl((up - sp(t - 0.01, T5, 11, 0.9)) / 0.01 * (Y + R0) / 400, 0, 0.4);
      hh *= 1 + vu; hw *= 1 - vu * 0.4;
      if (ask) {   // the bud melts back into the right end, then is absorbed
        const m = sp(t, -0.05, 16, 0.8);
        let bx = lerp(G.RX + HW + GAP + BR, cx + hw - BR * 0.55, m), r = lerp(BR, Math.min(22, hh * 0.8), m);
        r *= 1 - ss(0.25, 0.42, t);
        s.bud = [bx, y, r];
      }
    }
    s.pill = [cx, y, Math.max(hw, 0.1), Math.max(hh, 0.1)];
    return s;
  }

  // ---------- WebGL (premultiplied alpha over the page) ----------
  const VS = "attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}";
  const FS = `precision highp float;
uniform sampler2D uFelt; uniform float uFeltOk; uniform vec2 uSz; uniform float uS;
uniform vec4 uP; uniform vec4 uTA; uniform vec4 uTB; uniform vec3 uB; uniform float uRip; uniform int uMode; uniform float uSeam; uniform float uGlow; uniform float uShape;
float smin(float a,float b,float k){float h=max(k-abs(a-b),0.)/k;return min(a,b)-h*h*k*.25;}
float sdP(vec2 p,vec4 P){vec2 q=abs(p-P.xy)-P.zw;float r=min(P.z,P.w);q+=r;return length(max(q,0.))+min(max(q.x,q.y),0.)-r;}
float sdSeg(vec2 p,vec4 S){float y=clamp(p.y,min(S.y,S.z),max(S.y,S.z));return length(p-vec2(S.x,y))-S.w;}
float sc(vec2 p){
  float d=sdP(p,uP);
  if(uTA.w>.3) d=smin(d,sdSeg(p,uTA),7.);
  if(uTB.w>.3) d=smin(d,sdSeg(p,uTB),7.);
  if(uB.z>.2) d=smin(d,length(p-uB.xy)-uB.z,14.);
  d=smin(d,p.y+2.,15.);
  return d;}
vec3 hsv(float h){return clamp(abs(mod(h*6.+vec3(0.,4.,2.),6.)-3.)-1.,0.,1.);}
void main(){
  vec2 p=vec2(gl_FragCoord.x,uSz.y*uS-gl_FragCoord.y)/uS;
  float d=sc(p);
  vec4 o=vec4(0.);
  // ---- outside: drop shadow + ripple rings (light ring on the crest, a faint dark trough behind it)
  float dsh=sc(p-vec2(0.,uMode==0?7.:6.));
  float sh=(1.-smoothstep(-7.,uMode==0?22.:16.,dsh))*uShape;
  o=vec4(0.,0.,0.,(uMode==0?.30:uMode==1?.10:.08)*sh);
  if(uMode==1) o.rgb=vec3(.35,.22,.12)*o.a;
  if(uRip>=0.&&uRip<1.4&&d>0.){
    float dp=sdP(p,uP);
    for(int i=0;i<2;i++){float u=uRip-float(i)*.2;if(u<0.||u>1.)continue;
      float Rr=4.+190.*u;float x=(dp-Rr)/(14.+10.*u);
      if(abs(x)<1.){float w=sin(x*3.14159)*pow(1.-u,1.6)*(1.-x*x);
        float lw=max(0.,-w), dw=max(0.,w);
        vec3 lc=uMode==0?vec3(1.,.93,.97):uMode==1?vec3(1.,.97,.9):vec3(1.);
        float la=lw*(uMode==0?.075:uMode==1?.22:.3), da=dw*(uMode==0?.12:uMode==1?.05:.035);
        o=vec4(lc*la,la)+o*(1.-la); o=vec4(o.rgb*(1.-da),o.a+da*(1.-o.a));}}
  }
  // ---- inside
  vec2 e=vec2(.5,0.);
  vec2 g=vec2(sc(p+e.xy)-sc(p-e.xy),sc(p+e.yx)-sc(p-e.yx));
  vec2 n=length(g)>1e-4?normalize(g):vec2(0.,-1.);
  float t=clamp(-d/15.,0.,1.);
  vec2 L=normalize(vec2(-.45,-1.));
  float lit=dot(n,L);
  float rim=smoothstep(-2.6,-.3,d)*(1.-smoothstep(-.3,.8,d));
  float px=(p.x-(uP.x-uP.z))/(2.*uP.z);
  vec3 c; float ca;
  if(uMode==0){
    c=vec3(.062,.052,.072); ca=.86;
    vec2 gq=(p-vec2(uP.x-uP.z*.08,uP.y))/vec2(max(uP.z*.62,8.),max(uP.w*.85,6.));
    c+=vec3(.55,.17,.30)*.34*uGlow*exp(-dot(gq,gq));
    if(uB.z>.2){vec2 bq=(p-uB.xy)/(uB.z*.7);c+=vec3(.5,.2,.3)*.22*uGlow*exp(-dot(bq,bq));}
    c+=vec3(1.)*.10*smoothstep(-12.,-2.,d)*max(0.,-n.y);
    c+=vec3(1.,.97,1.)*rim*(.22+.55*max(0.,lit)+.18*max(0.,n.y));
    float bandIn=smoothstep(-7.,-1.6,d)*(1.-smoothstep(-1.6,.2,d));
    float win=smoothstep(.56,.64,px)*(1.-smoothstep(.70,.80,px));
    c+=hsv(fract(px*5.5+.2))*bandIn*pow(max(0.,n.y),2.)*win*.7*uGlow;
    ca=clamp(ca+rim*.14,0.,1.);
  } else if(uMode==1){
    vec3 base=vec3(.992,.945,.875);
    vec2 tp=mod(p-uP.xy+vec2(640.,560.),vec2(64.,56.))/vec2(64.,56.);
    float f=uFeltOk>.5?texture2D(uFelt,tp).r:.5;
    c=base*mix(vec3(.93,.91,.88),vec3(1.02),f);
    c*=.9+.12*smoothstep(-16.,0.,d)*lit+.06*t;
    c*=1.-.10*smoothstep(-6.,0.,d)*max(0.,n.y);
    c+=vec3(1.,.98,.94)*rim*.35*max(0.,lit);
    c=mix(c,c*vec3(.86,.8,.74),smoothstep(-1.8,0.,d)*.8);
    ca=1.;
    if(uSeam>.001){
      float dpl=sdP(p,uP), db=uB.z>.2?length(p-uB.xy)-uB.z:1e3;
      float s, P, dd;
      if(db<dpl){ float r=uB.z-4.6; float an=atan(p.y-uB.y,p.x-uB.x); s=(an+3.14159)*r; P=6.28318*r; dd=db+4.6; }
      else{ float r=uP.w-5.2; float Lh=max(uP.z-uP.w,0.); vec2 q=p-uP.xy;
        if(abs(q.x)<=Lh) s=q.y<0.?q.x+Lh:2.*Lh+3.14159*r+(Lh-q.x);
        else if(q.x>0.){float an=atan(q.y,q.x-Lh);s=2.*Lh+(an+1.5708)*r;}
        else{float an=atan(-q.y,-(q.x+Lh));s=4.*Lh+3.14159*r+(an+1.5708)*r;}
        P=4.*Lh+6.28318*r; dd=dpl+5.2;}
      float sn=abs(fract((s-(db<dpl?0.:max(uP.z-uP.w,0.)))/P+.5)-.5)*2.;
      float line=1.-smoothstep(.45,1.15,abs(dd));
      float dash=smoothstep(.2,.45,fract(s/8.5))*(1.-smoothstep(.62,.85,fract(s/8.5)));
      float on=1.-smoothstep(uSeam-.04,uSeam,sn);
      c=mix(c,vec3(.494,.376,.29),line*dash*on*.62*step(d,-3.));
    }
  } else {
    c=vec3(.985,.985,.99); ca=.84;
    c+=vec3(1.)*.05*smoothstep(-12.,-2.,d)*max(0.,-n.y);
    c=mix(c,vec3(.78),rim*(.25+.2*max(0.,n.y)));
    ca=clamp(ca+rim*.12,0.,1.);
  }
  float al=clamp(.5-d*uS,0.,1.)*ca*uShape;
  gl_FragColor=vec4(c*al,al)+o*(1.-al);
}`;

  const K = { gl: null, cv: null, U: null, felt: false, run: null, manual: false, mt: 0 };
  function ok() {
    if (RM.matches) return false;
    if (K.gl === false) return false;
    if (K.gl) return !K.gl.isContextLost();
    return !!init();
  }
  function init() {
    try {
      const cv = document.createElement("canvas"); cv.id = "lka-drop"; cv.setAttribute("aria-hidden", "true");
      const gl = cv.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: !!K.manual });   // recordings read the canvas back
      if (!gl) { K.gl = false; return null; }
      const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
      gl.useProgram(pr);
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const al = gl.getAttribLocation(pr, "a"); gl.enableVertexAttribArray(al); gl.vertexAttribPointer(al, 2, gl.FLOAT, false, 0, 0);
      const U = {}; ["uFelt", "uFeltOk", "uSz", "uS", "uP", "uTA", "uTB", "uB", "uRip", "uMode", "uSeam", "uGlow", "uShape"].forEach(k => U[k] = gl.getUniformLocation(pr, k));
      gl.uniform1i(U.uFelt, 0); gl.uniform1f(U.uFeltOk, 0);
      const img = new Image();
      img.onload = () => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t);
        [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(k => gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE));
        [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(k => gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR));
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img); gl.uniform1f(U.uFeltOk, 1); K.felt = true; };
      img.src = "/static/knit/knit-felt.webp";
      cv.addEventListener("webglcontextlost", e => { e.preventDefault(); stop(); });
      K.gl = gl; K.cv = cv; K.U = U;
      return gl;
    } catch (e) { console.warn("pilldrop: no WebGL", e); K.gl = false; return null; }
  }
  function draw(s, mode, H) {
    const { gl, cv, U } = K, dpr = Math.min(2, window.devicePixelRatio || 1), W = innerWidth;
    const w = Math.round(W * dpr), h = Math.round(H * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; cv.style.width = W + "px"; cv.style.height = H + "px"; }
    gl.viewport(0, 0, w, h);
    gl.uniform2f(U.uSz, W, H); gl.uniform1f(U.uS, dpr);
    gl.uniform4f(U.uP, ...s.pill); gl.uniform4f(U.uTA, ...s.ta); gl.uniform4f(U.uTB, ...s.tb); gl.uniform3f(U.uB, ...s.bud);
    gl.uniform1f(U.uRip, s.rip); gl.uniform1i(U.uMode, mode); gl.uniform1f(U.uSeam, s.seam); gl.uniform1f(U.uGlow, s.glow); gl.uniform1f(U.uShape, s.shape);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  function stop() {
    const r = K.run; if (!r) return; K.run = null;
    cancelAnimationFrame(r.raf); clearTimeout(r.to);
    if (K.cv) K.cv.remove();
    r.done && r.done(false);
  }

  /* play(ph, G, apply) -> Promise<bool finished>. apply(s, t) moves the DOM pill (content, clip, bud) each frame; the canvas draws the shape.
     A hidden tab gets no frames: a timer finishes the phase anyway. seek: a fixed t for tests / recordings (no loop). */
  function play(ph, G, apply, o = {}) {
    stop();
    if (!ok()) { return Promise.resolve(false); }
    const mode = o.mode != null ? o.mode : look();
    const dur = ph === "out" ? (G.ask ? DUR.outAsk : DUR.out) : DUR[ph];
    const H = Math.ceil(Math.max(G.Y + G.HH + 170, 120)), cs = K.cv.style;
    cs.position = "fixed"; cs.left = "0"; cs.top = "0"; cs.pointerEvents = "none"; cs.zIndex = "9699";
    document.body.appendChild(K.cv);
    return new Promise(res => {
      const r = K.run = { t0: now(), done: res, dur };
      const frame = T => { const s = scene(ph, T, G); draw(s, mode, H); apply(s, T); };
      r.frame = frame;
      r.finish = () => { if (K.run !== r) return; frame(dur); r.done = null; K.run = null; cancelAnimationFrame(r.raf); clearTimeout(r.to); K.cv.remove(); res(true); };
      frame(0);
      if (K.manual) return;
      const loop = () => { if (K.run !== r) return; const T = now() - r.t0; if (T >= dur) return r.finish(); frame(T); r.raf = requestAnimationFrame(loop); };
      r.raf = requestAnimationFrame(loop);
      r.to = setTimeout(r.finish, dur * 1000 + 400);
    });
  }
  /* recordings / tests: manual(true) stops the clock; tick(sec) moves it and draws the running phase (a phase that ends hands over at once) */
  function now() { return K.manual ? K.mt : performance.now() / 1000; }
  function manual(on) { K.manual = !!on; K.mt = 0; }
  function tick(T) { K.mt = T; const r = K.run; if (!r) return null; const t = T - r.t0; if (t >= r.dur) { r.finish(); return "end"; } r.frame(t); return t; }

  // ---------- desktop Chromium: a refracting rim at rest (backdrop-filter: url(#svg filter); WebKit ignores or breaks on it, so Chromium only) ----------
  const CHROMIUM = !!(navigator.userAgentData && (navigator.userAgentData.brands || []).some(b => /Chromium/.test(b.brand)));
  const LENS = {};
  function lensMap(w, h, r, band) {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d"), im = x.createImageData(w, h), D = im.data;
    const ax = w / 2 - r, ay = h / 2 - r;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const px = i + 0.5 - w / 2, py = j + 0.5 - h / 2, qx = Math.abs(px) - ax, qy = Math.abs(py) - ay;
      const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
      let nx = 0, ny = 0;
      if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy) || 1; nx = qx / l; ny = qy / l; } else if (qx > qy) nx = 1; else ny = 1;
      nx *= Math.sign(px) || 1; ny *= Math.sign(py) || 1;
      const t = cl(-d / band, 0, 1), k = Math.pow(1 - t, 2.2) * (d < 0.5 ? 1 : 0);
      const o = (j * w + i) * 4;
      D[o] = 128 + nx * k * 127; D[o + 1] = 128 + ny * k * 127; D[o + 2] = 128; D[o + 3] = 255;
    }
    x.putImageData(im, 0, 0); return c.toDataURL();
  }
  function lensDefs() {
    let s = document.getElementById("lka-lens-defs");
    if (!s) { s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.id = "lka-lens-defs"; s.setAttribute("aria-hidden", "true");
      s.setAttribute("style", "position:absolute;width:0;height:0;overflow:hidden"); document.body.appendChild(s); }
    return s;
  }
  /* returns the filter id for an element of this size, or "" when lenses are off (not desktop Chromium, reduced motion, phone) */
  function lens(w, h) {
    if (!CHROMIUM || PHONE.matches || RM.matches) return "";
    w = Math.round(w); h = Math.round(h); if (w < 8 || h < 8) return "";
    const key = w + "x" + h; if (LENS[key]) return LENS[key];
    const id = "lka-lens-" + key, url = lensMap(w, h, Math.min(w, h) / 2, 16), NS = "http://www.w3.org/2000/svg";
    const f = document.createElementNS(NS, "filter");
    f.id = id; [["x", 0], ["y", 0], ["width", w], ["height", h], ["filterUnits", "userSpaceOnUse"], ["primitiveUnits", "userSpaceOnUse"], ["color-interpolation-filters", "sRGB"]].forEach(([k, v]) => f.setAttribute(k, v));
    const ch = (sc, mat, res) => `<feDisplacementMap in="SourceGraphic" in2="m" scale="${sc}" xChannelSelector="R" yChannelSelector="G" result="d${res}"/><feColorMatrix in="d${res}" type="matrix" values="${mat}" result="${res}"/>`;
    f.innerHTML = `<feImage href="${url}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="m"/>`
      + ch(36, "1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0", "r") + ch(32, "0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0", "g") + ch(28, "0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0", "b")
      + `<feBlend in="r" in2="g" mode="screen" result="rg"/><feBlend in="rg" in2="b" mode="screen"/>`;
    lensDefs().appendChild(f);
    LENS[key] = id; return id;
  }

  window.PillDrop = { ok, look, play, stop, scene, lens, manual, tick, CHROMIUM, DUR, _K: K };
})();
