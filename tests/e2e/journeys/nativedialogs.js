/* t-native-dialogs: no browser confirm() left. await UI.confirm({ title, text, ok, danger }) opens the themed dialog in #modal (the bottom
 * sheet on phone): title, one line, Cancel + Confirm, the warning colour for danger. Enter = confirm, Esc = cancel, Tab stays inside, a click on
 * the scrim cancels, focus goes back. A dialog already open (the GitHub token one) waits underneath and comes back. A real call site
 * (Settings → restart) is driven too, and Playwright fails the run if a native dialog ever opens.
 *   node tests/e2e/drive.js run tests/e2e/journeys/nativedialogs.js --out work/<item>/verify/<run> --engines chromium,webkit
 *   ND_TEXTURE=knit1|leather1 (default knit1) */
module.exports = {
  views: ["desk", "phone"],
  hash: () => "#page=review",
  async run(c) {
    const p = c.p, errs = [], native = [], tex = process.env.ND_TEXTURE || "knit1";
    p.on("pageerror", e => { const m = String(e).split("\n")[0]; if (!/due to access control checks/.test(m)) errs.push(m); });
    p.on("dialog", d => { native.push(d.type() + ": " + d.message()); d.dismiss().catch(() => { }); });
    await p.evaluate(t => { const s = (k, v) => localStorage.setItem("rt." + k, JSON.stringify(v)); s("lang", "zh"); s("ut", "ut"); s("texture", t); s("chatFold", false); }, tex);
    await p.reload({ waitUntil: "load" });
    await p.waitForFunction(() => window.App && App.ST && App.ST.meta && !document.getElementById("ut-splash"), null, { timeout: 20000 });
    await c.sleep(1500);
    const ask = o => p.evaluate(o => { window.__nd = "pending"; App.UI.confirm(o).then(v => { window.__nd = v; }); }, o);
    const res = () => p.evaluate(() => window.__nd);
    const look = () => p.evaluate(() => {
      const m = document.getElementById("modal"), b = m && m.querySelector(".ncf"), ok = b && b.querySelector('[data-ncf="1"]'), R = b && b.getBoundingClientRect();
      return { open: !!m && !m.hidden, ncf: !!b, role: b && b.getAttribute("role"), h: b && (b.querySelector("h2") || {}).textContent, p: b && (b.querySelector(".ncf-p") || {}).textContent,
        btns: b ? [...b.querySelectorAll("[data-ncf]")].map(x => x.textContent) : [], focus: document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.ncf : null,
        inside: !!b && b.contains(document.activeElement), okBg: ok && getComputedStyle(ok).backgroundColor, okCol: ok && getComputedStyle(ok).color,
        urgent: getComputedStyle(document.documentElement).getPropertyValue("--urgent").trim(), bottom: R && Math.round(innerHeight - R.bottom), w: R && Math.round(R.width), vw: innerWidth };
    });
    const from = await p.evaluate(() => { const b = [...document.querySelectorAll("#left button, #tabbar button, button")].find(x => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(x).visibility !== "hidden"; }); b.focus(); return b.outerHTML.slice(0, 60); });

    /* 1. plain confirm: Enter = yes */
    await ask({ title: "测试：要继续吗？", text: "这一行是说明。", ok: "继续" });
    await c.sleep(450);
    const a = await look();
    c.check("themed dialog: title, one line, Cancel + Confirm, alertdialog", a.open && a.ncf && a.role === "alertdialog" && a.h === "测试：要继续吗？" && a.p === "这一行是说明。" && a.btns.length === 2 && a.btns[1] === "继续", a);
    c.check("focus starts on Confirm, inside the dialog", a.focus === "1" && a.inside, a);
    if (c.view === "phone") c.check("phone: a bottom sheet (full width, on the bottom edge)", a.bottom <= 2 && a.w >= a.vw - 2, a);
    await c.shot(`confirm-${tex}`);
    for (let i = 0; i < 5; i++) await p.keyboard.press("Tab");
    const tb = await look();
    c.check("Tab stays inside the dialog", tb.inside, tb);
    await p.evaluate(() => { const b = document.querySelector('#modal [data-ncf="1"]'); b.blur(); document.querySelector("#modal .ncf h2").tabIndex = -1; document.querySelector("#modal .ncf h2").focus(); });
    await p.keyboard.press("Enter");
    await c.sleep(300);
    const a2 = await look();
    c.check("Enter confirms (true) and closes", (await res()) === true && !a2.open, { r: await res(), a2 });
    const back = await p.evaluate(() => document.activeElement && document.activeElement.outerHTML.slice(0, 60));
    c.check("focus goes back to where it was", back === from, { back, from });

    /* 2. Esc = no; 3. the scrim = no; 4. Cancel button = no */
    await ask({ title: "按 Esc", text: "取消" }); await c.sleep(350); await p.keyboard.press("Escape"); await c.sleep(300);
    c.check("Esc cancels (false) and closes", (await res()) === false && !(await look()).open, await res());
    await ask({ title: "点外面", text: "取消" }); await c.sleep(350);
    if (c.view === "desk") { await p.mouse.click(8, 8); await c.sleep(300); c.check("a click on the scrim cancels", (await res()) === false && !(await look()).open, await res()); }
    else { await p.evaluate(() => document.getElementById("modal").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))); await c.sleep(300); c.check("a tap on the scrim cancels", (await res()) === false && !(await look()).open, await res()); }
    await ask({ title: "点取消" }); await c.sleep(350); await c.tap('#modal [data-ncf="0"]'); await c.sleep(300);
    c.check("Cancel button: false", (await res()) === false && !(await look()).open, await res());

    /* 5. danger: the warning colour on Confirm */
    await ask({ title: "删除存好的令牌？", text: "之后要重新输入。", ok: "删除", danger: true }); await c.sleep(450);
    const d = await look();
    const plainBg = a.okBg;
    c.check("danger: Confirm wears the warning colour (differs from the normal Confirm)", d.ncf && d.okBg !== plainBg, { danger: d.okBg, plain: plainBg, urgent: d.urgent });
    await c.shot(`danger-${tex}`);
    await p.keyboard.press("Escape"); await c.sleep(300);

    /* 6. a dialog already open waits underneath and comes back */
    await p.evaluate(() => App.openModal('<h2 id="nd-under">令牌</h2><input class="nd-in"><div class="foot"><button class="btn" data-nd-x>关</button></div>'));
    await c.sleep(300);
    await ask({ title: "叠在上面", ok: "删除", danger: true }); await c.sleep(350);
    const s1 = await p.evaluate(() => ({ under: !!document.getElementById("nd-under"), top: !!document.querySelector("#modal .ncf") }));
    await p.keyboard.press("Escape"); await c.sleep(300);
    const s2 = await p.evaluate(() => ({ under: !!document.getElementById("nd-under"), open: !document.getElementById("modal").hidden, top: !!document.querySelector("#modal .ncf"), inside: document.getElementById("modal").contains(document.activeElement) }));
    c.check("a dialog already open waits underneath and comes back after Cancel", !s1.under && s1.top && s2.under && s2.open && !s2.top && s2.inside, { s1, s2 });
    await p.evaluate(() => App.closeModal());

    /* 7. a real call site: Settings → restart asks first; Cancel does nothing */
    await p.evaluate(() => { const b = document.createElement("button"); b.dataset.upd = "restart"; b.id = "nd-rs"; b.textContent = "restart"; document.body.appendChild(b); b.click(); });
    await c.sleep(450);
    const r = await look();
    c.check("Settings restart asks in the themed dialog", r.ncf && /重启看板/.test(r.h || ""), r);
    await c.tap('#modal [data-ncf="0"]'); await c.sleep(400);
    const r2 = await p.evaluate(() => ({ dis: document.getElementById("nd-rs").getAttribute("aria-disabled"), open: !document.getElementById("modal").hidden }));
    c.check("Cancel: nothing restarts", r2.dis !== "true" && !r2.open, r2);
    await p.evaluate(() => document.getElementById("nd-rs").remove());

    /* reduced motion: still works */
    await p.emulateMedia({ reducedMotion: "reduce" });
    await ask({ title: "减少动态" }); await c.sleep(200); await p.keyboard.press("Escape"); await c.sleep(200);
    c.check("reduced motion: opens and cancels", (await res()) === false, await res());
    await p.emulateMedia({ reducedMotion: "no-preference" });
    c.check("no native dialog opened", !native.length, native);
    c.check("no page errors", !errs.length, errs);
  },
};
