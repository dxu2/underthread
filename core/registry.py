"""Extension registry (t-oss-struct S8): one place where local/ (and anyone running Underthread) adds features without touching core.

An extension is a folder with a manifest:

    local/ext/<name>/
    ├─ ext.json          {"name": "<name>", "api": 1, "requires": ">=0.2", "card_kinds": [...], "web": {"js": [...], "css": [...]}}
    ├─ server_ext.py     def register(R): ...   (the dashboard server)
    ├─ stateutil_ext.py  def register(R): ...   (the stateutil.py command line)
    └─ web/              its own front-end files, served at /static/ext/<name>/<file>

register(R) gets a Reg for that extension. What it can add:

    R.route(method, path, fn, prefix=False)   GET / POST endpoint. GET fn(h, u, q), POST fn(h, u, body); return R.NEXT to pass
    R.action(kind, fn, lock=True)             a new /api/action kind; fn(a) like the core handlers (a.body, a.st, a.it, a.inbox)
    R.card_kind(id, label_zh, label_en, icon) a new card kind (stateutil --kind accepts it, the page gets its label)
    R.job(id, fn, default_rule, label)        a scheduled job: shows on the 定时 page (pause, change the time), fn(ctx) runs when due
    R.cli(fn) R.on_set_agent(fn) R.on_upsert(fn)   the three stateutil hooks (CLI_EXT, SET_AGENT_HOOKS, UPSERT_HOOKS)
    R.health(fn)                              one more line in /api/health (fn() -> dict or text)

R.S is the stateutil module, R.srv the server module (server side only), R.dir the extension folder, R.NEXT the "not mine" value.
Card kinds can also be listed in ext.json ("card_kinds"), which both sides read.

API: an extension declares "api": API. Core changes the API only in a major version (CHANGELOG "Extension API:" line; tools/release.py
checks SURFACE and API against the previous tag). An extension whose api or requires does not match is skipped, with the reason on
/api/health, /api/ext and one card on the board; it never takes the dashboard down.

The old way (no ext.json: register(module) appending to EXT_GET / CLI_EXT / ..., and local/ext.json for web files) still works in
0.2.x and is reported as "legacy"; it goes away in 0.3.0.
"""
import json
import os
import re
import threading
import time

from core.paths import ROOT, local_path

API = 1
# The public surface of Reg. tools/release.py compares this tuple with the previous release: removing or renaming a name needs a
# new API number (major version); adding one must be named on the CHANGELOG "Extension API:" line.
SURFACE = ("route", "action", "card_kind", "job", "cli", "on_set_agent", "on_upsert", "health")
LEGACY_UNTIL = "0.3.0"   # the version that drops register(module) and local/ext.json

EXTS = {}         # name -> {"name", "dir", "manifest", "api", "requires", "legacy", "skipped", "error", "web"}
CARD_KINDS = {}   # id -> {"id", "label": [zh, en], "icon", "ext"}
JOBS = {}         # id -> {"id", "ext", "fn", "rule", "label", "last"}
HEALTH = []       # (ext name, fn)
_LOCK = threading.Lock()
# The server's route / action tables (core never imports api/): api/router.py calls bind() when it loads. Without it (the stateutil
# process) R.route / R.action only check their arguments.
SINK = {"route": None, "action": None, "nolock": None, "next": None}


def bind(route=None, action=None, nolock=None, next=None):
    SINK.update(route=route, action=action, nolock=nolock, next=next)


def _core_kinds():
    for k, zh, en in (("plan", "方案", "Plan"), ("deliverable", "交付", "Delivery"), ("question", "问题", "Question"), ("task", "任务", "Task")):
        CARD_KINDS[k] = {"id": k, "label": [zh, en], "icon": None, "ext": "core"}


_core_kinds()


def version():
    try:
        with open(os.path.join(ROOT, "VERSION"), encoding="utf-8") as f:
            return f.read().strip() or "0.0.0"
    except OSError:
        return "0.0.0"


def _vt(v):
    return tuple(int(x) for x in (re.findall(r"\d+", str(v))[:3] + ["0", "0", "0"])[:3])


def requires_ok(spec, ver=None):
    """'>=0.2', '>=0.2,<1', '==0.2.1' against VERSION. Empty = any."""
    v = _vt(ver or version())
    for part in [p.strip() for p in str(spec or "").split(",") if p.strip()]:
        m = re.fullmatch(r"(>=|<=|==|>|<)?\s*v?([\d.]+)", part)
        if not m:
            return False
        op, want = m.group(1) or ">=", _vt(m.group(2))
        if not {">=": v >= want, "<=": v <= want, "==": v == want, ">": v > want, "<": v < want}[op]:
            return False
    return True


def read_manifest(d):
    """local/ext/<name>/ext.json -> dict, None when there is none. A broken file raises ValueError."""
    p = os.path.join(d, "ext.json")
    if not os.path.isfile(p):
        return None
    with open(p, encoding="utf-8") as f:
        j = json.load(f)
    if not isinstance(j, dict):
        raise ValueError("ext.json is not an object")
    return j


def check(name, man):
    """Why this manifest cannot load here, or None."""
    api = man.get("api")
    if api != API:
        return f"api {api!r} 不匹配（这一版是 api {API}）" if api is not None else f"ext.json 没写 api（这一版是 api {API}）"
    if man.get("requires") and not requires_ok(man["requires"]):
        return f"需要 Underthread {man['requires']}，这里是 {version()}"
    if man.get("name") not in (None, name):
        return f"ext.json 的 name {man.get('name')!r} 和文件夹名 {name!r} 不一致"
    return None


def scan(dirs):
    """Read every extension's manifest once per process: fills EXTS and the manifest card kinds. Returns {name: info}."""
    with _LOCK:
        for d in dirs:
            name = os.path.basename(d)
            if name in EXTS:
                continue
            e = EXTS[name] = {"name": name, "dir": d, "manifest": None, "api": None, "requires": None, "legacy": True,
                              "skipped": None, "error": None, "web": {}}
            try:
                man = read_manifest(d)
            except (OSError, ValueError) as ex:
                e.update(legacy=False, skipped=f"ext.json 读不了：{ex}")
                continue
            if man is None:
                continue
            e.update(manifest=man, api=man.get("api"), requires=man.get("requires"), legacy=False,
                     web=man.get("web") if isinstance(man.get("web"), dict) else {})
            e["skipped"] = check(name, man)
            if e["skipped"]:
                continue
            for ck in man.get("card_kinds") or []:
                try:
                    _card_kind(name, ck.get("id"), *((ck.get("label") or [None, None]) + [None, None])[:2], icon=ck.get("icon"))
                except (AttributeError, TypeError, ValueError) as ex:
                    e["error"] = f"card_kinds: {ex}"
    return EXTS


def _card_kind(ext, kid, label_zh=None, label_en=None, icon=None):
    from core import store
    if not isinstance(kid, str) or not re.fullmatch(r"[a-z][a-z0-9_-]{1,31}", kid):
        raise ValueError(f"card kind id {kid!r}: lowercase letters, digits, - or _")
    have = CARD_KINDS.get(kid)
    if have and have["ext"] != ext:
        raise ValueError(f"card kind {kid} is already registered by {have['ext']}")
    CARD_KINDS[kid] = {"id": kid, "label": [label_zh or kid, label_en or label_zh or kid], "icon": icon, "ext": ext}
    if kid not in store.KINDS:
        store.KINDS.append(kid)   # the same list stateutil's --kind choices and upsert_item check


class Reg:
    """What register(R) gets: one per extension and side ("server" or "stateutil")."""

    def __init__(self, name, side, target):
        self.name, self.side, self.api = name, side, API
        self.dir = (EXTS.get(name) or {}).get("dir")
        self.srv = target if side == "server" else None
        self.S = getattr(target, "S", None) if side == "server" else target
        self.NEXT = SINK["next"]

    def route(self, method, path, fn, prefix=False):
        method = method.upper()
        if method not in ("GET", "POST"):
            raise ValueError(f"route method {method}: GET or POST")
        if not str(path).startswith("/"):
            raise ValueError(f"route path {path!r} must start with /")
        if self.side != "server" or not SINK["route"]:
            return fn
        fn.__ext__ = self.name
        return SINK["route"](method, path, prefix=prefix)(fn)   # an exact path core already has raises: the extension gets an error

    def action(self, kind, fn, lock=True):
        if self.side != "server" or not SINK["action"]:
            return fn
        fn.__ext__ = self.name
        SINK["action"](kind)(fn)
        if not lock:
            SINK["nolock"].add(kind)
        return fn

    def card_kind(self, kid, label_zh=None, label_en=None, icon=None):
        _card_kind(self.name, kid, label_zh, label_en, icon)

    def job(self, jid, fn, default_rule="daily 09:00", label=None):
        if not isinstance(jid, str) or not re.fullmatch(r"[a-z][a-z0-9_.-]{1,47}", jid):
            raise ValueError(f"job id {jid!r}: lowercase letters, digits, . - _")
        from core import schedules as SC
        rule = SC.parse_rule(default_rule) if isinstance(default_rule, str) else SC.check_rule(default_rule)
        have = JOBS.get(jid)
        if have and have["ext"] != self.name:
            raise ValueError(f"job {jid} is already registered by {have['ext']}")
        JOBS[jid] = {"id": jid, "ext": self.name, "fn": fn, "rule": rule, "label": label or jid, "last": None}
        return fn

    def cli(self, fn):
        from core.ext import CLI_EXT
        CLI_EXT.append(fn)
        return fn

    def on_set_agent(self, fn):
        from core.ext import SET_AGENT_HOOKS
        SET_AGENT_HOOKS.append(fn)
        return fn

    def on_upsert(self, fn):
        from core.ext import UPSERT_HOOKS
        UPSERT_HOOKS.append(fn)
        return fn

    def health(self, fn):
        HEALTH.append((self.name, fn))
        return fn


# ---------- scheduled jobs ----------

def jobs_import(st, nowt=None):
    """Once per job id: a registered job gets its schedule entry (kind "job", id s-job-<id>) with the extension's default rule.
    meta.jobs_imported remembers the ids, so a job you delete on the 定时 page stays deleted. Returns the new schedule ids."""
    from core import schedule_store as SS
    done = st["meta"].setdefault("jobs_imported", [])
    added = []
    for jid, j in sorted(JOBS.items()):
        if jid in done:
            continue
        s = SS.schedule_new(st, j["label"], "job", j["rule"], by="ext:" + j["ext"], nowt=nowt, sid="s-job-" + jid)
        s["job"] = jid
        st.setdefault("schedules", []).append(s)
        done.append(jid)
        added.append(s["id"])
    return added


def jobs_pending(st):
    return [s for s in st.get("schedules") or [] if s.get("kind") == "job" and s.get("job_pending") and not s.get("deleted")]


def run_pending(S):
    """Run every job whose schedule fired (schedule_emit sets job_pending; the CLI `schedule fire` does too, so it works from any
    process). Clears the flags in one lock, then each job runs in its own thread. A job that is no longer registered (extension
    removed) only gets a log line. Returns the job ids started."""
    if not jobs_pending(S.read()):
        return []
    todo = []
    with S.mutate() as st:
        for s in jobs_pending(st):
            todo.append((s.get("job"), dict(s), s.pop("job_pending")))
    started = []
    for jid, s, p in todo:
        j = JOBS.get(jid)
        if not j:
            print(f"jobs: {jid} is not registered (extension removed or skipped); run skipped", flush=True)
            continue
        ctx = {"job": jid, "schedule": s["id"], "for": (p or {}).get("for"), "manual": bool((p or {}).get("manual")), "S": S}
        threading.Thread(target=_run_job, args=(j, ctx), daemon=True, name=f"job:{jid}").start()
        started.append(jid)
    return started


def _run_job(j, ctx):
    t0 = time.time()
    try:
        out = j["fn"](ctx)
        j["last"] = {"at": time.strftime("%Y-%m-%dT%H:%M:%S"), "ok": True, "sec": round(time.time() - t0, 2),
                     "out": out if isinstance(out, (str, int, float, bool, type(None))) else str(out)[:200]}
        print(f"jobs: {j['id']} ok ({j['last']['sec']} s)", flush=True)
    except Exception as ex:  # noqa: BLE001  (a job must never take the server down)
        j["last"] = {"at": time.strftime("%Y-%m-%dT%H:%M:%S"), "ok": False, "error": repr(ex)[:300]}
        print(f"jobs: {j['id']} failed: {ex!r}", flush=True)


# ---------- what the page and /api/health see ----------

def health_rows():
    out = []
    for name, fn in HEALTH:
        try:
            r = fn()
        except Exception as ex:  # noqa: BLE001
            r = {"error": repr(ex)[:200]}
        out.append({"ext": name, "value": r if isinstance(r, (dict, str, int, float, bool, type(None))) else str(r)})
    return out


def view():
    """/api/ext and the 系统状态 panel: API number, every extension with its state, card kinds, jobs."""
    from core.ext import EXT, ext_on, is_builtin
    exts = []
    for name, e in sorted(EXTS.items()):
        x = EXT.get(name) or {}
        exts.append({"name": name, "api": e["api"], "requires": e["requires"], "legacy": e["legacy"], "skipped": e["skipped"],
                     "error": e["error"] or x.get("error"), "server": bool(x.get("server")), "stateutil": bool(x.get("stateutil")),
                     "web": bool(e["web"] and not e["skipped"]), "builtin": is_builtin(e["dir"]), "on": ext_on(name)})
    if legacy_web():
        exts.append({"name": "_legacy", "api": None, "requires": None, "legacy": True, "skipped": None, "error": None,
                     "server": False, "stateutil": False, "web": True})
    return {"api": API, "version": version(), "legacy_until": LEGACY_UNTIL, "extensions": exts,
            "card_kinds": [dict(v) for k, v in CARD_KINDS.items()],
            "jobs": [{"id": j["id"], "ext": j["ext"], "label": j["label"], "last": j["last"]} for j in JOBS.values()],
            "health": health_rows()}


# ---------- web files ----------

def legacy_web():
    """local/ext.json (the old way): read as the web block of an extension called _legacy."""
    try:
        with open(local_path("ext.json"), encoding="utf-8") as f:
            j = json.load(f)
        return j if isinstance(j, dict) and any(j.get(k) for k in ("css", "js", "drop")) else {}
    except (OSError, ValueError):
        return {}


def web_blocks():
    """[(name, web block)] in load order: _legacy first, then every loaded extension by name. A manifest's files are relative to
    its web/ folder and come out as ext/<name>/<file> (served at /static/ext/<name>/<file>). The manifest is re-read, so editing
    the web block needs no restart."""
    out = []
    lw = legacy_web()
    if lw:
        out.append(("_legacy", lw))
    from core.ext import ext_on
    for name, e in sorted(EXTS.items()):
        if e["skipped"] or e["legacy"] or not ext_on(name):   # t-oss-live: a built-in extension switched off adds no files to the page
            continue
        try:
            man = read_manifest(e["dir"]) or {}
        except (OSError, ValueError):
            continue
        w = man.get("web") if isinstance(man.get("web"), dict) else {}
        blk = {"drop": w.get("drop") or []}
        for kind, key in (("css", "href"), ("js", "src")):
            rows = []
            for r in w.get(kind) or []:
                r = dict(r) if isinstance(r, dict) else {key: r}
                ref = r.get(key)
                if isinstance(ref, str) and not ref.startswith("/"):
                    r[key] = f"ext/{name}/{ref}"
                rows.append(r)
            blk[kind] = rows
        out.append((name, blk))
    return out


def web_dir(name):
    """<ext dir>/web for /static/ext/<name>/..., only for a loaded (not skipped) extension (built-in ext/<name> or local/ext/<name>)."""
    e = EXTS.get(name)
    if not e or e["skipped"]:
        return None
    d = os.path.join(e["dir"], "web")
    return d if os.path.isdir(d) else None


# ---------- skipped extensions: one card ----------

def notice_skipped(S):
    """One card per skipped extension (t-ext-<name>), so the user sees why a feature is gone. Re-opened only when the reason changes."""
    bad = {n: e["skipped"] for n, e in EXTS.items() if e["skipped"]}
    if not bad:
        return []
    made = []
    with S.mutate() as st:
        for n, why in sorted(bad.items()):
            iid = f"t-ext-{re.sub(r'[^a-z0-9-]', '-', n.lower())}"
            it = S.find_item(st, iid, restore=False)
            if it and it.get("ext_reason") == why:
                continue
            where = os.path.relpath(EXTS[n]["dir"], ROOT)
            text = (f"扩展 {where} 没有加载：{why}。看板照常运行，只是这个扩展加的功能暂时没有。"
                    f"改好 ext.json（api 写 {API}）或更新扩展后重启看板即可；不用了就删掉这个文件夹。")
            it = S.upsert_item(st, {"id": iid, "title": f"扩展 {n} 没加载", "summary": text, "category": "urgent", "stage": "todo",
                                    "kind": "task", "owner": "manager"}, who="manager")
            it["ext_reason"] = why
            S.add_thread(it, "manager", text, "event")
            made.append(iid)
    return made
