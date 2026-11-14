/* 定时 page journey (features/schedules.md): toggle off/on, survive a poll, run now, delete+undo, delete.
 * Uses its own throwaway schedule per view, made with stateutil in the scratch copy; the user's schedules are not touched.
 *   node tests/e2e/drive.js run tests/e2e/journeys/schedules.js --out work/<item>/verify/<run>
 */
const made = {};
const row = id => `.sc-live > .sc-row[data-sc="${id}"]`;
module.exports = {
  views: ["desk", "phone"],
  hash: view => (view === "desk" ? "#page=ongoing" : ""),
  async run(c) {
    const out = c.su("schedule", "add", "--title", `verify ${c.view} ${Date.now() % 100000}`, "--kind", "remind", "--rule", "daily 23:59", "--text", "verification fixture", "--who", "smith");
    const id = (out.match(/\bs-[0-9a-z-]+/) || [])[0];
    if (!c.check("fixture schedule created via stateutil", !!id, out.split("\n")[0])) return;
    made[c.engine + c.view] = id;
    const sc = async () => ((await c.state()).schedules || []).find(s => s.id === id);

    await c.go("ongoing");
    await c.p.locator(row(id)).waitFor({ timeout: 8000 });
    c.check("row visible on 定时 page", await c.p.locator(row(id)).isVisible());
    await c.shot("before", row(id));
    const order0 = await c.p.evaluate(() => [...document.querySelectorAll(".sc-live > [data-sc]")].map(e => e.dataset.sc).join(","));

    // toggle off: same switch node, server paused, row dimmed
    await c.p.evaluate(sel => { window.__sw = document.querySelector(sel + " .sc-tg"); }, row(id));
    await c.tap(`${row(id)} .sc-tg`);
    const off = await c.until(async () => (await sc())?.enabled === false);
    c.check("toggle off reaches server (enabled=false)", off);
    c.check("switch node kept, aria-checked=false, row .rs-off", await c.p.evaluate(sel => {
      const n = document.querySelector(sel + " .sc-tg"); return n === window.__sw && n.getAttribute("aria-checked") === "false" && n.closest(".sc-row").classList.contains("rs-off"); }, row(id)));
    await c.shot("off", row(id));
    // renderPage rebuilds non-home pages every poll: wait past two polls, the node must survive and order must hold
    await c.sleep(6000);
    c.check("after 2 polls: same switch node, still off", await c.p.evaluate(sel => { const n = document.querySelector(sel + " .sc-tg"); return n === window.__sw && n.getAttribute("aria-checked") === "false"; }, row(id)));
    c.check("row order unchanged", await c.p.evaluate(() => [...document.querySelectorAll(".sc-live > [data-sc]")].map(e => e.dataset.sc).join(",")) === order0);

    // toggle on
    await c.tap(`${row(id)} .sc-tg`);
    c.check("toggle on reaches server (enabled=true)", await c.until(async () => (await sc())?.enabled === true));
    c.check("switch node kept, aria-checked=true", await c.p.evaluate(sel => { const n = document.querySelector(sel + " .sc-tg"); return n === window.__sw && n.getAttribute("aria-checked") === "true"; }, row(id)));
    await c.shot("on", row(id));

    // run now (… menu)
    const runs0 = ((await sc()).runs || []).length;
    await c.tap(`${row(id)} .sc-more`); await c.sleep(400);
    await c.shot("menu");
    await c.tap("[data-sc-fire]");
    const s1 = await c.until(async () => { const s = await sc(); return s && (s.runs || []).length === runs0 + 1 && s; });
    c.check("run now adds one manual run on server", s1 && s1.runs[s1.runs.length - 1].manual === true, s1 ? s1.runs[s1.runs.length - 1] : null);

    // delete, then undo inside the 5 s hold
    await c.tap(`${row(id)} .sc-more`); await c.sleep(400); await c.tap("[data-sc-del]"); await c.sleep(600);
    c.check("row hidden during hold", await c.p.evaluate(sel => !document.querySelector(sel), row(id)));
    c.check("undo pill visible", await c.p.evaluate(() => { const u = document.getElementById("sc-undo"); return !!u && !u.hidden && u.classList.contains("on"); }));
    await c.shot("undo-pill");
    await c.tap("[data-sc-undo]"); await c.sleep(6000);
    c.check("undo: still on server", !!(await sc()));
    c.check("undo: row back", await c.p.evaluate(sel => !!document.querySelector(sel), row(id)));

    // delete for real
    await c.tap(`${row(id)} .sc-more`); await c.sleep(400); await c.tap("[data-sc-del]");
    c.check("delete reaches server after hold", await c.until(async () => !(await sc()), 9000));
    c.check("row gone after commit", await c.p.evaluate(sel => !document.querySelector(sel), row(id)));
    await c.shot("after-delete");
    delete made[c.engine + c.view];
  },
  async cleanup({ su, engine, view, log }) {
    const id = made[engine + view]; if (!id) return;
    try { su("schedule", "rm", id); log(`cleanup: removed fixture ${id}`); } catch (e) { log(`cleanup: rm ${id} failed: ${e.message.split("\n")[0]}`); }
  },
};
