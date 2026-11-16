"""Team changes: the 招聘市场 templates, hiring (tools/new_role.py plan / apply / retire / rehire), the HR interview and 调岗 DMs,
退休 with a handover sheet and its undo, 返聘, 归档. Routes /api/templates, /api/tpl-av, /api/retire-plan, /api/transfer-plan,
POST /api/hire and /api/interview, GET /api/presets + POST /api/preset (整队预设). 批准入职 / 批准调岗 is the approve action (api/routes/actions.py), which calls _hire_apply."""
import datetime as dt
import json
import os
import re
import subprocess
import sys

from api.ctx import S, C, ROOT, load_json, rname
from api.router import route
from api.routes.state import sync_roster


# ===== t-hm-build: 招聘市场. Templates from templates/roles/<job>/template.json, hiring through tools/new_role.py (plan / apply / retire / rehire).
TPL_DIR = os.path.join(ROOT, "templates", "roles")
TPL_AV_CACHE = os.path.join(ROOT, "logs", "tpl-av")   # recoloured default avatars, rebuilt on demand (logs/ is not synced or published)
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
_RID = re.compile(r"^[a-z][a-z0-9-]{1,15}$")


HR_TPL = "hr"   # t-oss-gen-s4: HR's own template is not a market card (HR does the interviews); the market's 先请 HR applies it


def _tpl_list(market=True):
    out = []
    for job in sorted(os.listdir(TPL_DIR)) if os.path.isdir(TPL_DIR) else []:
        p = os.path.join(TPL_DIR, job, "template.json")
        if job.startswith(("_", ".")) or not os.path.isfile(p) or (market and job == HR_TPL):
            continue
        try:
            t = json.load(open(p, encoding="utf-8"))
        except ValueError:
            continue
        vs = [{"key": v.get("key"), "label": v.get("label") or v.get("key"), "label_en": v.get("label_en") or "", "tint": v.get("tint") or "#6f7f8f",
               "style": (v.get("voice") or {}).get("style", ""), "habits": (v.get("voice") or {}).get("habits", []),
               "style_en": v.get("style_en") or "", "sample_en": v.get("sample_en") or ""}   # t-i18n-c
              for v in t.get("variants") or [] if v.get("key")]
        out.append({"key": job, "cat": t.get("cat") or "", "job": t.get("job") or t.get("title") or job, "title": t.get("title") or "",
                    "title_en": t.get("title_en") or "", "duty": t.get("duty") or "", "duty_en": t.get("duty_en") or "",
                    "model": t.get("model") or "", "starters": (t.get("starters") or [])[:3], "starters_en": (t.get("starters_en") or [])[:3], "variants": vs,
                    "avatar": os.path.isfile(os.path.join(TPL_DIR, job, "avatar.png"))})
    return out


def templates_payload():
    roster = C.roster(ROOT).get("roles", [])
    hired = {}
    for r in roster:
        if r.get("template"):
            hired.setdefault(r["template"], []).append({"id": r["id"], "name": r.get("name") or r["id"], "variant": r.get("variant"),
                                                        "on": r.get("enabled", True) is not False})
    return {"templates": _tpl_list(), "hired": hired, "ids": [r["id"] for r in roster]}


def tpl_avatar(job, key):
    """Per-variant art, else the job's own avatar.png, else the bundled default recoloured to the variant tint (same ffmpeg as new_role.py)."""
    if not re.match(r"^[a-z0-9-]{1,32}$", job or "") or not re.match(r"^[a-z0-9_-]{0,32}$", key or ""):
        return None
    d = os.path.join(TPL_DIR, job)
    for p in (os.path.join(d, "art", key, "avatar.png"), os.path.join(d, "avatar.png")):
        if key is not None and os.path.isfile(p):
            return p
    t = next((x for x in _tpl_list() if x["key"] == job), None)
    v = t and next((x for x in t["variants"] if x["key"] == key), None)
    tint = (v or {}).get("tint", "#6f7f8f")
    if not _HEX.match(tint):
        return None
    out = os.path.join(TPL_AV_CACHE, tint.lstrip("#").lower() + ".png")
    if not os.path.isfile(out):
        os.makedirs(TPL_AV_CACHE, exist_ok=True)
        sys.path.insert(0, os.path.join(ROOT, "tools"))
        import new_role   # noqa: E402
        tmp = out + ".tmp.png"
        new_role.recolour(tint, tmp)
        os.replace(tmp, out)
    return out


def hire(body):
    """t-ht-build: retire with a handover / rehire get their own paths; everything else is hire_legacy."""
    op = body.get("op")
    if op == "retire" and "handover" in body:
        return retire_role(body)
    if op == "rehire":
        return rehire_role(body)
    return hire_legacy(body)


def hire_legacy(body):
    """One new_role.py call. Every argument is checked here and passed as an argv list (no shell)."""
    op = body.get("op")
    if op in HT_OPS:   # t-ht-build: 退休交接单 / 撤销 / 返聘 / 归档 / 撤回调岗
        return HT_OPS[op](body)
    if op in ("retire", "rehire"):   # market undo-after-hire (no handover): plain soft retire
        rid = str(body.get("id") or "")
        if not _RID.match(rid):
            raise ValueError("bad id")
        r = _role(rid)
        if not r:
            raise ValueError("no such role")
        if op == "retire" and rid in CORE_IDS:
            raise ValueError(f"管家、{rname('hr', 'HR')}、{rname('smith', '工具管家')}不能退休")
        args = [op, rid]
    elif op in ("plan", "apply"):
        t = next((x for x in _tpl_list(market=False) if x["key"] == body.get("job")), None)
        if not t:
            raise ValueError("no such template")
        if t["key"] == HR_TPL and (body.get("id") != HR_ID or _hr_on()):   # 先请 HR: only as the one hr, only when there is none
            raise ValueError("HR 只能有一个，id 必须是 hr")
        v = next((x for x in t["variants"] if x["key"] == body.get("variant")), None)
        if not v:
            raise ValueError("no such personality")
        rid, name, tint = str(body.get("id") or ""), str(body.get("name") or "").strip(), str(body.get("tint") or v["tint"])
        if not _RID.match(rid):
            raise ValueError("id 要小写字母开头，只用 a-z 0-9 -，2–16 个字")
        if not name or len(name) > 20 or re.search(r"[\x00-\x1f<>]", name):
            raise ValueError("名字 1–20 个字")
        if not _HEX.match(tint):
            raise ValueError("颜色要 #rrggbb")
        args = [op, "--template", t["key"], "--variant", v["key"], "--id", rid, "--name", name, "--tint", tint, "--color", tint]
    else:
        raise ValueError("unknown op")
    r = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "new_role.py"), *args], cwd=ROOT, capture_output=True, text=True,
                       timeout=180, stdin=subprocess.DEVNULL)
    log_line = f"hire {op} {' '.join(args[1:3])} -> {r.returncode}"
    print(log_line, flush=True)
    return {"ok": r.returncode == 0, "op": op, "out": r.stdout[-4000:], "err": r.stderr[-2000:].replace("✗ ", "")}


# ===== t-hr-build: HR interview. 面试 on a market card -> a hire-* card + her opening DM (no agent wait); every DM you send her
# while it runs is stamped with the card id and lights her typing dots; 批准入职 on the card runs new_role.py apply --from-item.
HR_ID = "hr"
HR_Q = os.path.join(ROOT, "templates", "hr", "interview.json")


def _hr_on():
    r = next((x for x in C.roster(ROOT).get("roles", []) if x["id"] == HR_ID), None)
    return bool(r) and r.get("enabled", True) is not False


def interview(body):
    op = body.get("op") or "start"
    if op == "abandon":
        with S.mutate() as st:
            it = S.find_item(st, str(body.get("item") or ""))
            if not it or not isinstance(it.get("hire"), dict):
                raise ValueError("不是面试卡")
            if it["hire"].get("status") in ("hired", "abandoned") or it.get("stage") == "done":
                return {"ok": True, "item": it["id"], "already": True}
            it["hire"]["status"] = "abandoned"
            it["stage"] = "done"
            it["closed"] = it["updated"] = S.now()
            S.add_thread(it, "me", "放弃面试", "done")
            a = st["agents"].get(HR_ID)
            if a and a.get("item") == it["id"]:
                S.set_agent(st, HR_ID, status="idle")
            S.add_log(st, "me", f"abandon {it['id']}", it["id"])
        S.inbox_append({"kind": "done", "item": it["id"], "hire": "abandoned"})
        return {"ok": True, "item": it["id"]}
    if op != "start":
        raise ValueError("unknown op")
    if body.get("mode") == "transfer":   # t-ht-build: 调岗 from 设置 · 角色
        return transfer_start(body)
    if not _hr_on():
        raise ValueError("HR 还没上岗")
    t = next((x for x in _tpl_list() if x["key"] == body.get("job")), None)
    if not t:
        raise ValueError("no such template")
    v = next((x for x in t["variants"] if x["key"] == body.get("variant")), None)
    if not v:
        raise ValueError("no such personality")
    q = load_json(os.path.relpath(HR_Q, ROOT), {})
    en = body.get("lang") == "en" and bool(q.get("opening_en"))   # t-i18n-c: the browser sends its UI language; English lines from interview.json
    if en:
        fill = lambda x: str(x).replace("{job}", t.get("title_en") or t["job"]).replace("{variant}", v.get("label_en") or v["label"]).replace("{duty}", t.get("duty_en") or t["duty"])
        opening = fill(q["opening_en"])
        opts = [fill(o) for o in (q.get("first_options_en") or ["{duty}"]) if fill(o).strip()][:3]
    else:
        fill = lambda x: str(x).replace("{job}", t["job"]).replace("{variant}", v["label"]).replace("{duty}", t["duty"])
        opening = fill(q.get("opening") or "这位{job}（{variant}）我先替你把把关。第一件事：你招 TA 主要替你干什么？")
        opts = [fill(o) for o in (q.get("first_options") or ["{duty}"]) if fill(o).strip()][:3]
    with S.mutate() as st:
        busy = S.open_interview(st)
        if busy:
            return {"ok": False, "busy": busy["id"], "title": busy.get("title", ""), "error": _busy_msg(busy)}
        base = f"hire-{t['key']}-{dt.datetime.now().strftime('%m%d-%H%M')}"
        cid, n = base, 2
        while S.find_item(st, cid, restore=False) or S.archive_find(cid):
            cid, n = f"{base}-{n}", n + 1
        it = S.upsert_item(st, {"id": cid, "title": f"面试：{t['job']}（{v['label']}）",
                                "title_en": f"Interview: {t.get('title_en') or t['job']} ({v.get('label_en') or v['label']})",   # t-i18n-b
                                "summary": f"{rname('hr', 'HR')}在私聊里和你一问一答，问清五件事后出入职草案。模板 {t['key']} · 性格 {v['key']}。",
                                "category": "side", "owner": HR_ID, "stage": "doing", "kind": "task"}, who="me")
        it["hire"] = {"job": t["key"], "variant": v["key"], "job_name": t["job"], "variant_label": v["label"], "tint": v["tint"],
                      "status": "asking", "turns": 0, "filled": 0}
        lst = st["dms"].setdefault(HR_ID, [])
        lst.append(S._chat_entry(HR_ID, opening, "|".join(o.replace("|", "/") for o in opts) or None))
        S.add_thread(it, HR_ID, "开场白已发到私聊：" + opening, "event")
        S.add_log(st, "me", f"interview {cid}", cid)
    wd = os.path.join(ROOT, "work", cid)
    os.makedirs(wd, exist_ok=True)
    slots = q.get("slots") or []
    with open(os.path.join(wd, "interview.json"), "w", encoding="utf-8") as f:
        json.dump({"item": cid, "job": t["key"], "job_name": t["job"], "variant": v["key"], "variant_label": v["label"],
                   "duty": t["duty"], "starters": t.get("starters", []), "style": v.get("style", ""),
                   "slots": {x["key"]: None for x in slots if x.get("key")}, "turns": 0, "max_turns": q.get("max_turns", 8),
                   "opening": opening, **({"lang": "en", "lang_note": q.get("lang_note_en") or "", "job_name_en": t.get("title_en") or "",
                                           "variant_label_en": v.get("label_en") or "", "duty_en": t.get("duty_en") or "",
                                           "starters_en": t.get("starters_en", []), "style_en": v.get("style_en") or "",
                                           "asks_en": {x["key"]: x.get("ask_en") or x.get("ask") for x in slots if x.get("key")}} if en else {})},
                  f, ensure_ascii=False, indent=2)
    return {"ok": True, "item": cid}


def _hire_apply(cid):
    """批准入职 / 批准调岗: new_role.py apply|update --from-item, outside the state lock (it nudges the poll through stateutil.mutate itself)."""
    h0 = (S.find_item(S.read(), cid) or {}).get("hire") or {}
    xfer = h0.get("mode") == "transfer"   # t-ht-build
    args = ["update", str(h0.get("target") or ""), "--from-item", cid, "--json"] if xfer else ["apply", "--from-item", cid, "--json"]
    r = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "new_role.py"), *args], cwd=ROOT,
                       capture_output=True, text=True, timeout=180, stdin=subprocess.DEVNULL)
    try:
        j = json.loads((r.stdout.strip().splitlines() or ["{}"])[-1])
    except ValueError:
        j = {}
    ok = r.returncode == 0 and j.get("ok") is True
    print(f"hire {'update' if xfer else 'apply'}_item {cid} -> {r.returncode}", flush=True)
    err = None if ok else (j.get("error") or (r.stderr or "").replace("✗ ", "").strip()[-600:] or f"exit {r.returncode}")
    if ok and xfer:   # what the card's ht-diff shows once the files have moved on
        try:
            with open(os.path.join(ROOT, "work", cid, "applied.json"), "w", encoding="utf-8") as f:
                json.dump(j, f, ensure_ascii=False, indent=1)
        except OSError:
            pass
    with S.mutate() as st:
        it = S.find_item(st, cid)
        h = it["hire"]
        if ok and xfer:
            h.update(status="transferred", at=S.now(), backup_tag=j.get("backup_tag"))
            it["stage"], it["closed"] = "done", S.now()
            keys = "、".join(c["key"] for c in j.get("changes") or []) or "无"
            S.add_thread(it, "me", f"已调岗 · {j.get('name') or h.get('target')}：改了 {keys}。备份 newrole-{j.get('backup_tag')}（tools/bak.py list）；10 分钟内可在卡上「撤回调岗」", "done")
            for x in j.get("lessons") or []:
                _ht_lesson(st, h.get("target"), x, cid)
            if j.get("lessons"):
                S.add_thread(it, "me", f"{len(j['lessons'])} 条新红线变成了规则提议，在「审核」页点头才生效", "event")
            a = st["agents"].get(HR_ID)
            if a and a.get("item") == cid:
                S.set_agent(st, HR_ID, status="idle")
        elif ok:
            h.update(status="hired", hired_id=j.get("id"))
            it["stage"], it["closed"] = "done", S.now()
            S.add_thread(it, "me", f"已入职 · {j.get('name')}（{j.get('id')}）出现在团队里", "done")
            a = st["agents"].get(HR_ID)
            if a and a.get("item") == cid:
                S.set_agent(st, HR_ID, status="idle")
        else:
            h["status"] = "failed"
            it["stage"] = "review"
            S.add_thread(it, "me", ("调岗没办成：" if xfer else "入职没办成：") + err, "event", to=HR_ID)
        it["updated"] = S.now()
    if not ok:   # t-ht-build (t-hr-build leftover): HR hears about it like any comment addressed to her, not only via the approve entry
        S.inbox_append({"kind": "comment", "item": cid, "to": HR_ID, "auto": "hire_failed", "mode": "transfer" if xfer else "hire",
                        "text": ("批准调岗" if xfer else "批准入职") + f"失败：{err}。请按原因改 work/{cid}/" + ("transfer.json" if xfer else "role.json")
                                + "，重新交审（upsert-item --stage review），并在私聊里跟用户说一句。"})
    if ok and xfer:
        S.inbox_append({"kind": "role_changed", "id": h0.get("target"), "item": cid, "backup_tag": j.get("backup_tag"),
                        "lessons": len(j.get("lessons") or [])})
    return {"ok": ok, "id": j.get("id"), "name": j.get("name"), "mode": "transfer" if xfer else "hire", "error": err}


# ===== t-ht-build: 调岗 / 退休 from 设置 · 角色 (plan work/t-hr-transfer/plan.md). 调岗 = an HR DM like the interview (xfer-* card,
# work/<card>/transfer.json, new_role.py update on 批准调岗); 退休 = a handover sheet (GET /api/retire-plan, POST /api/hire retire + handover),
# a record card retire-<id>-<MMDD>, 8 s undo. CORE roles never retire, the manager is never transferred, founding roles soft-retire only.
CORE_IDS = {"manager", "hr", "smith"}
XFER_MAX = 5
NR = os.path.join(ROOT, "tools", "new_role.py")


def _role(rid):
    return next((x for x in C.roster(ROOT).get("roles", []) if x["id"] == rid), None)


def _nr_mod():
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    import new_role   # noqa: E402
    return new_role


def _nr(*args, timeout=180):
    r = subprocess.run([sys.executable, NR, *args], cwd=ROOT, capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)
    print(f"ht new_role {' '.join(args[:3])} -> {r.returncode}", flush=True)
    return r, (r.stderr or "").replace("✗ ", "").strip()[-800:]


def _busy_msg(it):
    h = it.get("hire") or {}
    return (f"{rname('hr', 'HR')} 正在给「{h.get('job_name', '')}」调岗" if h.get("mode") == "transfer" else f"{rname('hr', 'HR')} 正在面试「{h.get('job_name', '')}」") + "，先聊完或放弃"


def _ht_lesson(st, agent, text, item):
    """A rule proposal without add_lesson's 2-per-card cap (a transfer can carry several red lines)."""
    st["lessons"].append({"id": S.new_id("L"), "t": S.now(), "agent": agent, "text": text, "item": item, "status": "pending", "via": "transfer"})
    S.push_mail(st, "update", f"新规则提议 · {agent}: {text}", item, agent)


def _uniq_id(st, base):
    cid, n = base, 2
    while S.find_item(st, cid, restore=False) or S.archive_find(cid):
        cid, n = f"{base}-{n}", n + 1
    return cid


def transfer_start(body):
    rid = str(body.get("target") or "")
    if not _RID.match(rid):
        raise ValueError("bad id")
    if rid == "manager":
        raise ValueError("管家不能调岗（manager.md 归她自己，改它走规则提议）")
    if not _hr_on():
        raise ValueError("HR 还没上岗")
    r = _role(rid)
    if not r or r.get("enabled") is False:
        raise ValueError("这个角色不在岗")
    q0 = load_json(os.path.relpath(HR_Q, ROOT), {}) or {}
    q = q0.get("transfer") or {}
    name = r.get("name") or rid
    en = body.get("lang") == "en" and bool(q.get("opening_en"))   # t-i18n-c
    if en:
        opening = str(q["opening_en"]).replace("{name}", r.get("name_en") or name)
        opts = [str(o).replace("{name}", r.get("name_en") or name) for o in (q.get("options_en") or q.get("options") or [])][:5]
    else:
        opening = str(q.get("opening") or "{name} 想改哪块？可以多选，也可以直接说想怎么改。").replace("{name}", name)
        opts = [str(o).replace("{name}", name) for o in (q.get("options") or ["职责", "说话味道", "名字称呼", "工具", "加一条红线"])][:5]
    with S.mutate() as st:
        busy = S.open_interview(st)
        if busy:
            return {"ok": False, "busy": busy["id"], "title": busy.get("title", ""), "error": _busy_msg(busy)}
        cid = _uniq_id(st, f"xfer-{rid}-{dt.datetime.now().strftime('%m%d-%H%M')}")
        it = S.upsert_item(st, {"id": cid, "title": f"调岗：{name}", "title_en": f"Transfer: {r.get('name_en') or name}",   # t-i18n-b
                                "summary": f"{rname('hr', 'HR')}在私聊里问清改哪块、改成什么（≤{XFER_MAX} 轮），出前后对比草案；你点「批准调岗」才落地。"
                                           "Confirmed rules 不动，新红线变成规则提议。",
                                "category": "side", "owner": HR_ID, "stage": "doing", "kind": "task"}, who="me")
        it["hire"] = {"mode": "transfer", "target": rid, "job_name": name, "variant_label": r.get("title") or "",
                      "tint": r.get("tint") or r.get("color"), "status": "asking", "turns": 0, "filled": 0, "max_turns": XFER_MAX}
        st["dms"].setdefault(HR_ID, []).append(S._chat_entry(HR_ID, opening, "|".join(o.replace("|", "/") for o in opts) or None))
        S.add_thread(it, HR_ID, "开场白已发到私聊：" + opening, "event")
        S.add_log(st, "me", f"transfer {cid}", cid)
    NRm = _nr_mod()
    md = read_text_safe(S.role_md(rid))   # core / local split: the local rule file wins
    secs = NRm.md_sections(md)
    locked = set(NRm.md_locked(secs))
    wd = os.path.join(ROOT, "work", cid)
    os.makedirs(wd, exist_ok=True)
    with open(os.path.join(wd, "transfer.json"), "w", encoding="utf-8") as f:
        json.dump({"target": rid, "item": cid, "name": name,
                   "before": {"roster": r, "md_sha": NRm.sha(md),
                              "md_sections": {t: b.strip() for k, (t, b) in enumerate(secs) if t and k not in locked},
                              "locked_sections": [secs[k][0] for k in sorted(locked)]},
                   "after": {"roster": {}, "md_sections": {}, "lessons": []},
                   "fields": list(NRm.XFER_FIELDS), "turns": 0, "max_turns": XFER_MAX, "opening": opening,
                   **({"lang": "en", "lang_note": q0.get("lang_note_en") or ""} if en else {})}, f, ensure_ascii=False, indent=2)
    return {"ok": True, "item": cid}


def read_text_safe(p):
    try:
        return open(p, encoding="utf-8").read()
    except OSError:
        return ""


def transfer_plan(cid):
    """GET /api/transfer-plan?item=: the draft's before/after (new_role.py update --plan), or what was applied."""
    it = S.find_item(S.read(), cid) if re.match(r"^[a-z0-9][a-z0-9-]{1,60}$", cid or "") else None
    h = (it or {}).get("hire") or {}
    if h.get("mode") != "transfer":
        return {"ok": False, "error": "不是调岗卡"}
    ap = os.path.join(ROOT, "work", cid, "applied.json")
    if h.get("status") in ("transferred", "undone") and os.path.isfile(ap):
        j = load_json(os.path.relpath(ap, ROOT), {})
        j.update(applied=True, status=h.get("status"), at=h.get("at"))
        return j
    r, err = _nr("update", str(h.get("target") or ""), "--from-item", cid, "--plan", "--json", timeout=60)
    try:
        j = json.loads((r.stdout.strip().splitlines() or ["{}"])[-1])
    except ValueError:
        j = {"ok": False}
    if r.returncode or not j.get("ok"):
        return {"ok": False, "error": j.get("error") or err or "plan failed"}
    return j


def _owned_schedules(st, rid):
    out = []
    for sc in st.get("schedules") or []:
        if sc.get("deleted"):
            continue
        t = sc.get("task") or {}
        ow = t.get("agent")
        if not ow and t.get("item"):
            ow = (S.find_item(st, t["item"], restore=False) or {}).get("owner")
        if ow == rid:
            out.append(sc)
    return out


def retire_plan(rid):
    """GET /api/retire-plan?id=: what the 退休交接单 lists. Read only."""
    if not _RID.match(rid or ""):
        return {"ok": False, "error": "bad id"}
    sync_roster()   # the role must be in state.agents for note_hand to log the handoffs
    r = _role(rid)
    if not r:
        return {"ok": False, "error": "no such role"}
    st = S.read()
    a = st["agents"].get(rid) or {}
    block = None
    if rid in CORE_IDS:
        block = f"管家、{rname('hr', 'HR')}、{rname('smith', '工具管家')}不能退休"
    elif r.get("enabled") is False:
        block = "已经退休了"
    elif a.get("status") == "working":
        cur = S.find_item(st, a.get("item"), restore=False) if a.get("item") else None
        block = f"她在做「{(cur or {}).get('title') or a.get('activity') or '手上的事'}」，交回后再退"
    else:
        rr, err = _nr("retire", rid, "--dry", timeout=60)
        if rr.returncode:
            block = err
    pipe = r.get("pipe")
    pipes = set([pipe] if isinstance(pipe, str) else pipe or [])
    cands = []
    for x in C.roster(ROOT).get("roles", []):
        if x["id"] in (rid,) or x.get("enabled") is False:
            continue
        xp = x.get("pipe")
        same = bool(pipes & set([xp] if isinstance(xp, str) else xp or []))
        cands.append({"id": x["id"], "name": x.get("name") or x["id"], "same": same})
    cands.sort(key=lambda c: (c["id"] != "manager", not c["same"]))
    items = [{"id": i["id"], "title": i.get("title", ""), "stage": i.get("stage")} for i in st["items"]
             if i.get("owner") == rid and i.get("stage") != "done"]
    scheds = [{"id": sc["id"], "title": sc.get("title") or (sc.get("task") or {}).get("text", ""), "routine": sc.get("routine"),
               "enabled": sc.get("enabled", True)} for sc in _owned_schedules(st, rid)]
    lessons = [{"id": l["id"], "text": l["text"]} for l in st["lessons"] if l.get("agent") == rid and l.get("status") == "pending"]
    agent = r.get("agent_name") or f"underthread-{rid}"
    keep = [f for f in (f"roles/{rid}.md", f"local/roles/{rid}.md", f".claude/agent-memory/{agent}/", f"work/{rid}-handoff.md", f"avatars/{rid}.png")
            if os.path.exists(os.path.join(ROOT, f))]
    return {"ok": True, "id": rid, "name": r.get("name") or rid, "title": r.get("title"), "founding": not r.get("template"),
            "block": block, "items": items, "schedules": scheds, "lessons": lessons, "candidates": cands, "keep": keep}


def retire_role(body):
    """退休 with a handover sheet. Cards / schedules / proposals move first (one mutate), then new_role.py retire runs outside the lock;
    if it refuses, the handover is put back."""
    rid = str(body.get("id") or "")
    if "handover" not in body:
        return hire_legacy(body)
    plan = retire_plan(rid)
    if not plan.get("ok"):
        raise ValueError(plan.get("error"))
    if plan.get("block"):
        raise ValueError(plan["block"])
    ho = body.get("handover") or {}
    ip, sp = ho.get("items") or {}, ho.get("schedules") or {}
    name = plan["name"]
    on = {c["id"] for c in plan["candidates"]}
    with S.mutate() as st:
        rec = {"id": rid, "name": name, "t": S.now(), "items": [], "schedules": [], "lessons": []}
        for sc in _owned_schedules(st, rid):
            act_ = sp.get(sc["id"], "pause")
            t = sc.setdefault("task", {})
            e = {"id": sc["id"], "title": sc.get("title", ""), "action": act_, "agent": t.get("agent"), "enabled": sc.get("enabled", True)}
            if act_ == "manager":
                t["agent"] = "manager"
            elif sc.get("enabled", True):
                S.schedule_pause(st, sc, True, by="me")
            rec["schedules"].append(e)
        lines = []
        for it in st["items"]:
            if it.get("owner") != rid or it.get("stage") == "done":
                continue
            to = ip.get(it["id"], "manager")
            if to != "park" and to not in on:
                to = "manager"
            e = {"id": it["id"], "title": it.get("title", ""), "stage": it.get("stage"), "to": to}
            if to == "park":
                it["owner"], it["stage"], it["parked_from"] = "manager", "todo", rid
                S.add_thread(it, "me", f"搁置 · {name} 退休，返聘时可以一键拿回", "event")
                lines.append(f"- {it.get('title', it['id'])} → 搁置")
            else:
                it["owner"] = to
                S.note_hand(st, it["id"], to, "reassign", frm=rid)
                S.add_thread(it, "me", f"交接自 {name}（退休），接手前先读 work/{rid}-handoff.md", "event", to=to)
                lines.append(f"- {it.get('title', it['id'])} → {(st['agents'].get(to) or {}).get('name') or to}")
            it["updated"] = S.now()
            e["at"] = it["updated"]
            rec["items"].append(e)
        for l in st["lessons"]:
            if l.get("agent") == rid and l.get("status") == "pending":
                l["status"], l["parked"] = "parked", S.now()
                rec["lessons"].append(l["id"])
        rcid = _uniq_id(st, f"retire-{rid}-{dt.datetime.now().strftime('%m%d')}")
        card = S.upsert_item(st, {"id": rcid, "title": f"退休：{name}", "title_en": f"Retired: {(_role(rid) or {}).get('name_en') or name}", "category": "side", "owner": HR_ID if HR_ID in st["agents"] else "manager",
                                  "stage": "done", "kind": "task",
                                  "summary": f"{name}（{rid}）软退休：roles/{rid}.md、记忆、交接单、声音、头像都留着，返聘就回来。"}, who="me")
        card["retire"] = rec
        card["closed"] = S.now()
        sl = "；".join(f"{x['title']} → {'转管家' if x['action'] == 'manager' else '暂停'}" for x in rec["schedules"])
        txt = ["交接清单："] + (lines or ["- 手上没有没完成的单子"]) + ([f"- 定时：{sl}"] if sl else []) + ([f"- 规则提议 {len(rec['lessons'])} 条挂起，返聘时放回"] if rec["lessons"] else [])
        S.add_thread(card, "me", "\n".join(txt), "done")
        S.add_log(st, "me", f"retire {rid}", rcid)
    r, err = _nr("retire", rid)
    if r.returncode:
        _retire_restore(rcid, rid, rehire=False)
        raise ValueError(err or "retire failed")
    S.inbox_append({"kind": "retired", "id": rid, "record": rcid, "items": [{"id": e["id"], "to": e["to"]} for e in rec["items"]],
                    "schedules": [{"id": e["id"], "action": e["action"]} for e in rec["schedules"]]})
    return {"ok": True, "id": rid, "record": rcid, "moved": len(rec["items"])}


def _retire_restore(rcid, rid, rehire=True):
    """Put a retirement back: cards the new owner has not touched since, schedules, parked proposals."""
    back, kept = [], []
    with S.mutate() as st:
        card = S.find_item(st, rcid)
        rec = (card or {}).get("retire") or {}
        if rec.get("id") != rid or rec.get("undone"):
            raise ValueError("没有可撤销的退休记录")
        for e in rec.get("items") or []:
            it = S.find_item(st, e["id"])
            want = "manager" if e["to"] == "park" else e["to"]
            if it and it.get("owner") == want and it.get("updated") == e.get("at"):
                it["owner"], it["stage"] = rid, e.get("stage") or it.get("stage")
                it.pop("parked_from", None)
                if want != "manager" or e["to"] != "park":
                    S.note_hand(st, it["id"], rid, "reassign", frm=want)
                S.add_thread(it, "me", f"撤销退休 · 单子回到 {rec.get('name') or rid}", "event", to=rid)
                it["updated"] = S.now()
                back.append(e["id"])
            else:
                kept.append(e["id"])
        for e in rec.get("schedules") or []:
            sc = next((x for x in st.get("schedules") or [] if x["id"] == e["id"]), None)
            if not sc:
                continue
            sc.setdefault("task", {})["agent"] = e.get("agent")
            if e.get("enabled") and not sc.get("enabled", True):
                try:
                    S.schedule_pause(st, sc, False, by="me")
                except Exception:   # noqa: BLE001  (a once-rule already past stays paused)
                    pass
        for l in st["lessons"]:
            if l["id"] in (rec.get("lessons") or []) and l.get("status") == "parked":
                l["status"] = "pending"
                l.pop("parked", None)
        rec["undone"] = S.now()
        if card:
            S.add_thread(card, "me", f"已撤销退休 · 回来 {len(back)} 张单子" + (f"，{len(kept)} 张新主人已经动过，留在原处" if kept else ""), "event")
    return back, kept


def undo_retire(body):
    rid = str(body.get("id") or "")
    st = S.read()
    recs = [i for i in st["items"] if (i.get("retire") or {}).get("id") == rid and not i["retire"].get("undone")]
    if not recs:
        raise ValueError("没有可撤销的退休记录")
    rcid = recs[-1]["id"]
    r, err = _nr("rehire", rid)
    if r.returncode:
        raise ValueError(err or "rehire failed")
    back, kept = _retire_restore(rcid, rid)
    S.inbox_append({"kind": "retire_undone", "id": rid, "record": rcid, "back": back, "kept": kept})
    return {"ok": True, "id": rid, "back": len(back), "kept": len(kept)}


def rehire_role(body):
    rid = str(body.get("id") or "")
    if not _RID.match(rid):
        raise ValueError("bad id")
    r = _role(rid)
    if not r:
        raise ValueError("不在 roster 里（硬归档的用 new_role.py rehire --from-archive）")
    res, err = _nr("rehire", rid)
    if res.returncode:
        return {"ok": False, "op": "rehire", "err": err}
    with S.mutate() as st:
        n = 0
        for l in st["lessons"]:
            if l.get("agent") == rid and l.get("status") == "parked":
                l["status"] = "pending"
                l.pop("parked", None)
                n += 1
        parked = [i["id"] for i in st["items"] if i.get("parked_from") == rid and i.get("stage") != "done"]
        paused = [sc["id"] for sc in _owned_schedules(st, rid) if not sc.get("enabled", True) and (sc.get("paused") or {}).get("by") == "me"]
        S.add_log(st, "me", f"rehire {rid}")
    S.inbox_append({"kind": "rehired", "id": rid, "lessons": n, "parked": parked, "paused": paused})
    return {"ok": True, "op": "rehire", "id": rid, "lessons": n, "parked": parked, "paused": paused}


def unpark(body):
    rid = str(body.get("id") or "")
    r = _role(rid)
    if not r or r.get("enabled") is False:
        raise ValueError("先返聘")
    with S.mutate() as st:
        got = []
        for it in st["items"]:
            if it.get("parked_from") == rid and it.get("stage") != "done" and it.get("owner") == "manager":
                it["owner"] = rid
                it.pop("parked_from", None)
                S.note_hand(st, it["id"], rid, "reassign", frm="manager")
                S.add_thread(it, "me", f"拿回搁置的单子 · 回到 {r.get('name') or rid}", "event", to=rid)
                it["updated"] = S.now()
                got.append(it["id"])
    if got:
        S.inbox_append({"kind": "unparked", "id": rid, "items": got})
    return {"ok": True, "items": got}


def archive_role(body):
    rid = str(body.get("id") or "")
    r = _role(rid)
    if not r:
        raise ValueError("no such role")
    if not r.get("template"):
        raise ValueError("创始成员只能软退休，不能归档")
    if body.get("confirm") != rid:
        raise ValueError("归档要二次确认")
    if r.get("enabled") is not False:
        raise ValueError("先软退休，再归档")
    res, err = _nr("retire", rid, "--hard")
    return {"ok": res.returncode == 0, "op": "archive", "out": res.stdout[-2000:], "err": err}


def undo_update(body):
    cid = str(body.get("item") or "")
    with S.mutate() as st:
        it = S.find_item(st, cid)
        h = (it or {}).get("hire") or {}
        if h.get("mode") != "transfer" or h.get("status") != "transferred":
            raise ValueError("这张卡没有可撤回的调岗")
        if not h.get("at") or (dt.datetime.now().astimezone() - dt.datetime.fromisoformat(h["at"])).total_seconds() > 600:
            raise ValueError(f"超过 10 分钟了，撤回要找{rname('smith', '工具管家')}按备份手动改回")
    r, err = _nr("update", "--undo", cid, "--json")
    if r.returncode:
        raise ValueError(err or "undo failed")
    with S.mutate() as st:
        it = S.find_item(st, cid)
        it["hire"]["status"] = "undone"
        S.add_thread(it, "me", "已撤回调岗 · roster 和 roles 文件按备份改回", "event")
        for l in st["lessons"]:
            if l.get("item") == cid and l.get("status") == "pending" and l.get("via") == "transfer":
                l["status"], l["decided"] = "dropped", S.now()
        it["updated"] = S.now()
    S.inbox_append({"kind": "role_changed", "id": h.get("target"), "item": cid, "undo": True})
    return {"ok": True, "item": cid}


HT_OPS = {"undo_retire": undo_retire, "unpark": unpark, "archive": archive_role, "undo_update": undo_update}


# ===== t-oss-gen-s4: 整队预设 (whole-team presets) on the market page. tools/preset.py does the work, as from the command line:
# dry = `apply <name> --dry` (nothing written), apply = `apply <name>` (every replaced file is backed up first; it prints the undo),
# then install_seed (preset avatars / notes) and make_agents.py. roster.json is replaced whole, so the preview lists who leaves.
PRESET_DIR = os.path.join(ROOT, "presets")
_PKEY = re.compile(r"^[a-z0-9][a-z0-9-]{0,31}$")


def _iv_busy(st):
    return next((i for i in st.get("items", []) if i.get("hire") and i.get("stage") != "done"
                 and i["hire"].get("status") not in ("hired", "abandoned")), None)


def presets_payload():
    cur_ids = [r["id"] for r in C.roster(ROOT).get("roles", [])]
    items = S.read().get("items", [])
    out = []
    for key in sorted(os.listdir(PRESET_DIR)) if os.path.isdir(PRESET_DIR) else []:
        p = os.path.join(PRESET_DIR, key, "roster.json")
        if not _PKEY.match(key) or not os.path.isfile(p):
            continue
        try:
            ro = json.load(open(p, encoding="utf-8"))
        except (OSError, ValueError):
            continue
        roles = [{"id": r["id"], "name": r.get("name") or r["id"], "name_en": r.get("name_en") or "", "title": r.get("title") or "",
                  "title_en": r.get("title_en") or ""} for r in ro.get("roles", []) if r.get("id")]
        ids = [r["id"] for r in roles]
        leave = [i for i in cur_ids if i not in ids]
        out.append({"key": key, "team": ro.get("team") or key, "roles": roles, "leave": leave, "join": [i for i in ids if i not in cur_ids],
                    "open_items": sum(1 for it in items if it.get("owner") in leave and it.get("stage") != "done"),
                    "config": os.path.isfile(os.path.join(PRESET_DIR, key, "config.json")), "current": sorted(ids) == sorted(cur_ids)})
    return {"presets": out}


def preset_op(body):
    op, key = body.get("op"), str(body.get("name") or "")
    if op not in ("dry", "apply"):
        raise ValueError("unknown op")
    if not _PKEY.match(key) or not os.path.isfile(os.path.join(PRESET_DIR, key, "roster.json")):
        raise ValueError("no such preset")
    if op == "apply":
        busy = _iv_busy(S.read())
        if busy:
            raise ValueError(_busy_msg(busy))
    args = [sys.executable, os.path.join(ROOT, "tools", "preset.py"), "apply", key] + (["--dry"] if op == "dry" else [])
    r = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, timeout=120, stdin=subprocess.DEVNULL)
    out, err = r.stdout, r.stderr
    print(f"preset {op} {key} -> {r.returncode}", flush=True)
    if op == "apply" and r.returncode == 0:
        from core import install_seed
        install_seed.run(ROOT, background=False)   # the preset's own avatars and role notes, never overwriting
        m = subprocess.run([sys.executable, os.path.join(ROOT, "make_agents.py")], cwd=ROOT, capture_output=True, text=True,
                           timeout=120, stdin=subprocess.DEVNULL)
        out += m.stdout[-1500:]
        err += m.stderr[-1500:]
        sync_roster()
    return {"ok": r.returncode == 0, "op": op, "out": out[-4000:], "err": err[-2000:]}


@route("GET", "/api/templates")
def _templates(h, u, q):   # t-hm-build
    return h._send(200, templates_payload())


@route("GET", "/api/presets")
def _presets(h, u, q):   # t-oss-gen-s4
    return h._send(200, presets_payload())


@route("POST", "/api/preset")
def _preset(h, u, body):   # t-oss-gen-s4: same header guard as /api/hire (it replaces roster.json)
    if not h._hdr_ok():
        return h._send(403, {"ok": False, "error": "forbidden"})
    return h._send(200, preset_op(body))


@route("GET", "/api/retire-plan")
def _retire_plan(h, u, q):   # t-ht-build
    return h._send(200, retire_plan(q.get("id", [""])[0]))


@route("GET", "/api/transfer-plan")
def _transfer_plan(h, u, q):   # t-ht-build
    return h._send(200, transfer_plan(q.get("item", [""])[0]))


@route("GET", "/api/tpl-av")
def _tpl_av(h, u, q):   # t-hm-build
    p = tpl_avatar(q.get("job", [""])[0], q.get("v", [""])[0])
    return h._file(p, media=True) if p else h._send(404, {"error": "not found"})


@route("POST", "/api/hire")
def _hire(h, u, body):   # t-hm-build: own header (like /api/secret/github) so a stray cross-site form cannot hire
    if not h._hdr_ok():
        return h._send(403, {"ok": False, "error": "forbidden"})
    return h._send(200, hire(body))


@route("POST", "/api/interview")
def _interview(h, u, body):   # t-hr-build: same header guard as /api/hire
    if not h._hdr_ok():
        return h._send(403, {"ok": False, "error": "forbidden"})
    return h._send(200, interview(body))
