// t-roster-rail: 改名 / 换头像 on the 团队 / Team page. Both only change how the board shows a role: the display name (its id, agent file and
// notes keep the original name) and which of its own pictures is its avatar. Saved by the server in roster.json (action role_look,
// core/rolelook.py), which updates never replace. Pictures = GET /api/avatar-choices: the stitched patch, your avatars/<id> picture, and
// anything you drop in avatars/choices/<id>/. All classes here are rk-*.
import { ST, UI } from "../core/store.js";
import { aname, avatarUrl } from "../core/av.js";
import { api, closeModal, openModal, toast } from "../core/ui.js";

const L = (z, e) => (UI.lang === "en" ? e : z);
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function lookBtns(a) {
  if (!a || a.id === "me") return "";
  return `<button type="button" class="btn-s rk-b" data-rk-name="${esc(a.id)}">${L("改名", "Rename")}</button>`
    + `<button type="button" class="btn-s rk-b" data-rk-av="${esc(a.id)}">${L("换头像", "Avatar")}</button>`;
}

function nameSheet(id) {
  const a = ST.agents && ST.agents[id]; if (!a) return;
  const orig = a.name_orig || a.name || id, origEn = a.name_en_orig || a.name_en || "";
  const renamed = !!(a.name_orig || a.name_en_orig);
  openModal(`<h2>${L("改名", "Rename")}</h2>
    <p class="rk-lead">${esc(L(`只改看板上显示的名字。id「${id}」、角色设定和它对自己的称呼都不变；原名「${orig}」也还能认出它。`, `Changes the name the board shows. The id "${id}", its notes and how it signs itself stay; its original name "${origEn || orig}" still finds it.`))}</p>
    <label for="rk-n">${L("中文名", "Chinese name")}</label><input id="rk-n" maxlength="24" value="${esc(a.name || "")}" placeholder="${esc(orig)}" autocomplete="off">
    <label for="rk-ne">${L("英文名", "English name")}</label><input id="rk-ne" maxlength="24" value="${esc(a.name_en || "")}" placeholder="${esc(origEn)}" autocomplete="off">
    <div class="foot">${renamed ? `<button class="btn rk-reset" data-rk-reset>${L("恢复原名", "Use original")}</button>` : ""}<button class="btn" data-x>${L("取消", "Cancel")}</button><button class="btn primary" data-ok>${L("保存", "Save")}</button></div>`, m => {
    m.classList.add("rk-mdl");
    const n = m.querySelector("#rk-n"), ne = m.querySelector("#rk-ne");
    const send = async (name, name_en, b) => {
      b.disabled = true;
      try { await api("role_look", { id, name, name_en }); closeModal(); toast(L("已改名", "Renamed")); }
      catch (_) { b.disabled = false; }
    };
    m.querySelector("[data-x]").onclick = closeModal;
    m.querySelector("[data-ok]").onclick = e => {
      const v = n.value.trim(), ve = ne.value.trim();
      send(v === orig ? "" : v, ve === origEn ? "" : ve, e.currentTarget);
    };
    const r = m.querySelector("[data-rk-reset]"); if (r) r.onclick = e => send("", "", e.currentTarget);
    [n, ne].forEach(x => x.addEventListener("keydown", e => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); m.querySelector("[data-ok]").click(); } }));
    n.focus(); n.select();
  });
}

const KIND = { ut: ["针线版", "Stitched"], own: ["原图", "Original"], extra: ["候选", "Option"] };
async function avSheet(id) {
  const a = ST.agents && ST.agents[id]; if (!a) return;
  let j;
  try { const r = await fetch("/api/avatar-choices?id=" + encodeURIComponent(id), { cache: "no-store" }); if (r.status === 404 && !r.headers.get("content-type")?.includes("json")) throw new Error(L("看板服务还没重启", "Restart the dashboard server once")); j = await r.json(); if (!j.ok) throw new Error(j.error || "?"); }
  catch (x) { toast(String(x.message || x), true); return; }
  const def = Object.assign({}, a, { avpick: null });   // what "default" looks like in the current palette
  const tile = (src, url, label, on) => `<button type="button" class="rk-t${on ? " on" : ""}" data-rk-src="${esc(src)}" role="radio" aria-checked="${on}"><span class="rk-im" style="background-image:url('${esc(url)}')"></span><small>${esc(label)}</small></button>`;
  const tiles = [tile("", avatarUrl(def), L("默认（跟随配色）", "Default (follows palette)"), !j.cur)]
    .concat(j.choices.map(c => tile(c.src, `/avatars/${c.src.split("/").map(encodeURIComponent).join("/")}?${encodeURIComponent(c.v)}`, c.kind === "extra" ? c.src.split("/").pop().replace(/\.\w+$/, "") : L(...KIND[c.kind]), c.src === j.cur)));
  openModal(`<h2>${esc(L(`换头像：${aname(a)}`, `Avatar: ${aname(a)}`))}</h2>
    <div class="rk-grid" role="radiogroup" aria-label="${esc(L("头像", "Avatar"))}">${tiles.join("")}</div>
    <p class="rk-hint">${esc(L(`想加别的图：放进 avatars/choices/${id}/（png / jpg / webp，方图最好），再打开这里。`, `More pictures: put them in avatars/choices/${id}/ (png / jpg / webp, square works best), then open this again.`))}</p>
    <div class="foot"><button class="btn" data-x>${L("取消", "Cancel")}</button><button class="btn primary" data-ok>${L("用这张", "Use this")}</button></div>`, m => {
    m.classList.add("rk-mdl", "rk-avm");
    let sel = j.cur;
    m.querySelectorAll(".rk-t").forEach(t => t.onclick = () => {
      sel = t.dataset.rkSrc;
      m.querySelectorAll(".rk-t").forEach(x => { const on = x === t; x.classList.toggle("on", on); x.setAttribute("aria-checked", on); });
    });
    m.querySelector("[data-x]").onclick = closeModal;
    m.querySelector("[data-ok]").onclick = async e => {
      if (sel === j.cur) { closeModal(); return; }
      const b = e.currentTarget; b.disabled = true;
      try { await api("role_look", { id, avatar: sel }); closeModal(); toast(L("头像已换", "Avatar changed")); }
      catch (_) { b.disabled = false; }
    };
  });
}

document.addEventListener("click", e => {
  const n = e.target.closest && e.target.closest("[data-rk-name]"); if (n) { e.preventDefault(); nameSheet(n.dataset.rkName); return; }
  const v = e.target.closest && e.target.closest("[data-rk-av]"); if (v) { e.preventDefault(); avSheet(v.dataset.rkAv); }
});

export { nameSheet, avSheet };
