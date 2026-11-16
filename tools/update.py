#!/usr/bin/env python3
"""Update this install to a newer version, and go back if you need to (t-oss-struct S5, plan sections E3, E4, E6).

    python3 tools/update.py check                 fetch the release tags and say whether a newer version is out
    python3 tools/update.py status [--json]       version, the last check, what would block an update, the history
    python3 tools/update.py apply [--to REF]      update to the newest release (or to REF: a tag or commit)
    python3 tools/update.py rollback [--data]     go back to the version before the last update
    python3 tools/update.py apply --dry-run [--to REF]   only the trial (step 3): the new version on a copy of your data
    python3 tools/update.py restart [--agents] [--force] restart the dashboard on the code on disk, with the update's checks

Settings -> System -> Updates runs the same commands (the server starts this script in the background); you click,
it does the rest. Git installs only: a folder without .git (a zip download) gets "install with git clone" instead.

apply, in order (nothing on the live install changes until step 4, and any failure after it goes back by itself):
  1. checks: no update already running, no voice call, no crew member working (the steward does not count), enough disk,
     the target is a newer commit on the same line (your install has no commits of its own)
  2. snapshot: state / config / roster / archive / inbox / agent files packed into <backups>/update/<id>.tar.gz, and the
     current commit written to <backups>/update/history.json (<backups> = local/backups, or .backups without local/)
  3. trial: the new version is checked out in a temporary git worktree with a COPY of your data and local/; the
     migrations, make_agents.py and the server run there on a spare port, and your own edits to core files (saved as a
     patch first) must apply on top. Any failure stops here
  4. switch: core edits saved to <backups>/update/<id>/core.patch, the tree moves to the new commit (fast-forward only),
     the patch goes back on, untracked files in the way of new files are moved to <backups>/update/<id>/aside/
  5. migrations (stateutil.py schema), make_agents.py, server restart (keepalive / launchd bring it back), then the
     health check: /api/health and /api/state must answer within 60 s, and the page and every file it loads must answer
     200 (page_check; the trial in step 3 checks the same), or rollback runs by itself
  6. one inbox entry "update_done" for the steward (and "steward_restart": true when manager.md or roles/ changed)

rollback moves the code back to the commit before the last update, puts your core edits back and restarts. Data stays as
it is: minor and patch versions only add to the data, and the old code reads the newer data. --data also puts the data
snapshot back (the current files are kept in the backups folder first); only needed after a major version.

local/ is never touched by either. Options: --remote NAME (default: config update.remote, else the branch's upstream,
else origin, else the only remote), --discard-mine (apply even when your core edits do not fit the new version; the patch
stays in the backups folder), --no-restart, --no-trial (tests only), --json.
"""
import datetime as dt
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
# Standard library only, and no import from core/ at load time: this file must run on top of ANY older version (the
# first updater lands on installs that do not have it, or core/backup.py, yet).

PY = sys.executable
SEMVER = re.compile(r"^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
DATA = ("state.json", "config.json", "roster.json", "archive.json", "inbox.jsonl")
HEALTH_WAIT = int(os.environ.get("UPDATE_HEALTH_WAIT", "60"))


def upd_dir():
    """<backups>/update, where <backups> is the same folder core/backup.py uses: local/backups, else .backups."""
    loc = os.path.abspath(os.environ.get("UNDERTHREAD_LOCAL") or os.path.join(ROOT, "local"))
    base = os.path.join(loc, "backups") if os.path.isdir(loc) else os.path.join(ROOT, ".backups")
    return os.path.join(base, "update")


def upath(*p):
    return os.path.join(upd_dir(), *p)


def now():
    return dt.datetime.now().astimezone().isoformat(timespec="seconds")


def rj(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def wj(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


class Stop(Exception):
    """A clean refusal: nothing was changed (or it was put back). str(e) is shown to the user."""


def git(*args, cwd=None, check=True, timeout=120):
    r = subprocess.run(["git", *args], cwd=cwd or ROOT, capture_output=True, text=True, timeout=timeout,
                       stdin=subprocess.DEVNULL)
    if check and r.returncode:
        raise Stop(f"git {' '.join(args[:3])} failed: {(r.stderr or r.stdout).strip()[:400]}")
    return r.stdout.strip()


def is_git():
    return os.path.isdir(os.path.join(ROOT, ".git")) or os.path.isfile(os.path.join(ROOT, ".git"))


def version_file(cwd=None):
    try:
        with open(os.path.join(cwd or ROOT, "VERSION"), encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


def vt(v):
    m = SEMVER.match(v if v.startswith("v") else "v" + v)
    return tuple(int(x) for x in m.groups()) if m else None


def cfg():
    try:
        from core import config as C
        return C.load(ROOT)
    except Exception:   # older versions without core.config, or a broken config: the file as written
        return rj(os.path.join(ROOT, "config.json"), {}) or {}


def port():
    try:
        return int(cfg().get("port", 8765))
    except (TypeError, ValueError):
        return 8765


def remote(name=None):
    if name:
        return name
    want = ((cfg().get("update") or {}).get("remote") or "").strip()
    if want:
        return want
    have = git("remote").split()
    up = git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}", check=False)
    if up and "/" in up and up.split("/")[0] in have:
        return up.split("/")[0]
    if "origin" in have:
        return "origin"
    if len(have) == 1:
        return have[0]
    raise Stop("no remote to update from: add one (git remote add origin <url>) or set update.remote in config.json")


# ===== progress (read by GET /api/update) =====

class Run:
    """<backups>/update/run.json: what is running now, step by step. The server shows it on the settings page."""

    def __init__(self, op):
        self.d = {"op": op, "pid": os.getpid(), "started": now(), "step": "", "steps": [], "done": False, "ok": None}
        self.save()

    def step(self, s):
        print("·", s, flush=True)
        self.d["step"] = s
        self.d["steps"].append([now()[11:19], s])
        self.save()

    def end(self, ok, msg="", **kw):
        self.d.update(done=True, ok=ok, message=msg, ended=now(), **kw)
        self.save()

    def save(self):
        wj(upath("run.json"), self.d)


def pid_alive(pid):
    try:
        os.kill(int(pid), 0)
        return True
    except (OSError, ValueError, TypeError):
        return False


def running():
    r = rj(upath("run.json"))
    return r if r and not r.get("done") and pid_alive(r.get("pid")) else None


# ===== the server =====

def http_json(path, timeout=4, p=None):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{p or port()}{path}", timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return None


JS_IMPORT = re.compile(r"""(?:^|[\s;])(?:import|export)\b[^'"`;]*?\bfrom\s*["']([^"']+)["']|(?:^|[\s;])import\s*\(?\s*["']([^"']+)["']""", re.M)
STATIC_REF = re.compile(r"""(/static/[\w./@-]+\.\w+(?:\?v=[\w.]+)?)(?=["'\s,)])""")   # a whole URL with an extension (src, href, srcset, import map)


def page_check(p=None, timeout=8):
    """t-iter-upgrade: the page as a browser gets it. GET / and then every /static file it names (scripts, stylesheets, the import
    map, modulepreload, srcset, icons) and every module those scripts import, followed through; [] when all answer 200, else the
    problems. A file missing from a release (a .gitignore that swallowed it) answers 404 here and the update goes back, instead of
    a blank page behind a healthy /api/health."""
    import urllib.parse
    base = f"http://127.0.0.1:{p or port()}"
    try:
        with urllib.request.urlopen(base + "/", timeout=timeout) as r:
            html = r.read().decode("utf-8", "replace")
    except Exception as e:
        return [f"/ did not load: {e}"]
    if "/static/" not in html:
        return ["/ is not the dashboard page"]
    todo, seen, bad = sorted(set(STATIC_REF.findall(html))), set(), []
    while todo and len(bad) < 8:
        ref = todo.pop()
        key = ref.split("?")[0]
        if key in seen:
            continue
        seen.add(key)
        try:
            with urllib.request.urlopen(base + ref, timeout=timeout) as r:
                body = r.read() if key.endswith((".js", ".mjs")) else r.read(1)
        except urllib.error.HTTPError as e:
            bad.append(f"{key} {e.code}")
            continue
        except Exception as e:
            bad.append(f"{key} {type(e).__name__}")
            continue
        if key.endswith((".js", ".mjs")):
            for a, b in JS_IMPORT.findall(body.decode("utf-8", "replace")):
                spec = a or b
                if spec.startswith((".", "/")):
                    u = urllib.parse.urljoin(key, spec)
                    if u.startswith("/static/") and u.split("?")[0] not in seen:
                        todo.append(u)
    return bad


def proc_cwd(pid):
    """The working folder of a process (Linux /proc, else lsof), or None when it cannot be told."""
    try:
        return os.path.realpath(os.readlink(f"/proc/{int(pid)}/cwd"))
    except (OSError, ValueError):
        pass
    if shutil.which("lsof"):
        out = subprocess.run(["lsof", "-a", "-p", str(pid), "-d", "cwd", "-Fn"], capture_output=True, text=True).stdout
        for ln in out.splitlines():
            if ln.startswith("n"):
                return os.path.realpath(ln[1:])
    return None


def server_pid(p=None, ours=True):
    """pid of the server answering on the port; with ours=True only when it runs from this install folder (a config
    port that points at another install's server must never get that server restarted)."""
    h = http_json("/api/health", p=p)
    pid = (h or {}).get("server", {}).get("pid")
    if pid and ours and proc_cwd(pid) != os.path.realpath(ROOT):
        return None
    return pid


def wait_up(old_pid=None, secs=HEALTH_WAIT, p=None, ours=True):
    """The pid when /api/health answers from a process other than old_pid and /api/state answers too, else None."""
    end = time.time() + secs
    while time.time() < end:
        pid = server_pid(p, ours)
        if pid and pid != old_pid and http_json("/api/state?rev=-1", timeout=8, p=p) is not None:
            return pid
        time.sleep(0.5)
    return None


def keepalive_problem(pid):
    """macOS: the keepalive loop that owns the server has a revoked stdin -> a new server dies at start (Errno 9)."""
    if sys.platform != "darwin" or not pid or not shutil.which("lsof"):
        return None
    try:
        pp = subprocess.run(["ps", "-o", "ppid=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()
        cmd = subprocess.run(["ps", "-o", "command=", "-p", pp], capture_output=True, text=True).stdout
        if "keepalive" not in cmd:
            return None
        fd0 = subprocess.run(["lsof", "-a", "-p", pp, "-d", "0"], capture_output=True, text=True).stdout
        if "revoked" in fd0:
            return "the keepalive loop's input is revoked, a restart would fail: restart tools/keepalive.sh first"
    except OSError:
        return None
    return None


def restart(run):
    """Stop the server and wait for the keepalive loop / launchd to bring the new code up; start it ourselves if
    nothing does. Returns the new pid, None when no server was running, raises Stop when it does not come back."""
    pid = server_pid()
    if not pid:
        run.step("no server was running; not starting one")
        return None
    run.step(f"restarting the server (pid {pid})")
    try:
        os.kill(int(pid), signal.SIGTERM)
    except OSError:
        pass
    new = wait_up(pid, secs=10)
    if not new:
        ens = os.path.join(ROOT, "tools", "ensure_server.py")
        if os.path.exists(ens) and not server_pid():
            subprocess.run([PY, ens], cwd=ROOT, capture_output=True, timeout=60, stdin=subprocess.DEVNULL)
        new = wait_up(pid, secs=HEALTH_WAIT)
    if not new:
        raise Stop("the server did not come back healthy")
    run.step(f"server up again (pid {new})")
    return new


# ===== checks =====

def busy_agents():
    try:
        st = rj(os.path.join(ROOT, "state.json"), {}) or {}
        ag = st.get("agents") or {}
        rows = ag.values() if isinstance(ag, dict) else ag
        return sorted(a.get("id") for a in rows if isinstance(a, dict) and a.get("status") == "working"
                      and a.get("id") != "manager")
    except Exception:
        return []


def blockers(p=None):
    """Reasons an update or rollback must wait, as [(code, text)]. Empty = go."""
    out = []
    if not is_git():
        return [("zip", "this install is not a git checkout; updates need a git clone (see README)")]
    r = running()
    if r and r.get("pid") != os.getpid():
        out.append(("running", f"an update is already running ({r.get('op')}, since {r.get('started', '')[11:16]})"))
    vh = http_json("/api/voice/health", timeout=3, p=p)
    if isinstance(vh, dict) and vh.get("calls"):
        out.append(("call", "a voice call is on"))
    ag = busy_agents()
    if ag:
        out.append(("agents", "working now: " + ", ".join(ag)))
    try:
        if shutil.disk_usage(ROOT).free < 300 * 2 ** 20:
            out.append(("disk", "less than 300 MB free"))
    except OSError:
        pass
    kp = keepalive_problem(server_pid(p))
    if kp:
        out.append(("keepalive", kp))
    return out


# ===== check: is there a newer release? =====

def changelog_between(old, ref):
    """The CHANGELOG sections of versions newer than old, up to the one at ref: [{version, date, text}]."""
    try:
        text = git("show", f"{ref}:CHANGELOG.md")
    except Stop:
        return []
    out = []
    for m in re.finditer(r"^## \[(\d+\.\d+\.\d+)\] - (\S+)\n(.*?)(?=^## |\Z)", text, re.S | re.M):
        v = m.group(1)
        if not old or (vt(v) and vt(old) and vt(v) > vt(old)):
            out.append({"version": v, "date": m.group(2), "text": m.group(3).strip()[:6000]})
    return out


def check(rem=None, quiet=False):
    res = {"at": now(), "current": version_file(), "commit": "", "latest": None, "notes": [], "error": None}
    try:
        if not is_git():
            raise Stop("this install is not a git checkout; updates need a git clone (see README)")
        res["commit"] = git("rev-parse", "--short", "HEAD")
        rem = remote(rem)
        res["remote"] = rem
        git("fetch", "--quiet", "--tags", "--force", rem, timeout=90)
        cur = vt(res["current"]) or (0, 0, 0)
        tags = [t for t in git("tag", "--list", "v*").split() if SEMVER.match(t)]
        newer = sorted((t for t in tags if vt(t) > cur), key=vt)
        # only tags on our line: the newest one HEAD can fast-forward to
        newer = [t for t in newer if subprocess.run(["git", "merge-base", "--is-ancestor", "HEAD", t], cwd=ROOT).returncode == 0]
        if newer:
            t = newer[-1]
            res["latest"] = t[1:]
            res["latest_commit"] = git("rev-parse", "--short", t + "^{commit}")
            res["notes"] = changelog_between(res["current"], t)
    except (Stop, subprocess.TimeoutExpired, OSError) as e:
        res["error"] = str(e)[:400]
    wj(upath("check.json"), res)
    if not quiet:
        if res["error"]:
            print("check failed:", res["error"])
        elif res["latest"]:
            print(f"v{res['latest']} is out (you have v{res['current']}).")
            for n in res["notes"]:
                print(f"\n## {n['version']} - {n['date']}\n{n['text'][:1500]}")
            print("\nupdate: python3 tools/update.py apply")
        else:
            print(f"up to date (v{res['current']}, {res['commit']})")
    return res


# ===== apply =====

def snapshot(uid):
    tar = upath(f"{uid}.tar.gz")
    with tarfile.open(tar, "w:gz") as t:
        for f in DATA:
            p = os.path.join(ROOT, f)
            if os.path.exists(p):
                t.add(p, arcname=f)
        ag = os.path.join(ROOT, ".claude", "agents")
        if os.path.isdir(ag):
            t.add(ag, arcname=".claude/agents")
    return tar


def core_patch(uid):
    """Your edits to tracked (core) files as one binary patch, or None when there are none."""
    diff = subprocess.run(["git", "diff", "HEAD", "--binary"], cwd=ROOT, capture_output=True).stdout
    if not diff.strip():
        return None, []
    p = upath(uid, "core.patch")
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "wb") as f:
        f.write(diff)
    files = git("diff", "HEAD", "--name-only").splitlines()
    return p, files


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def trial(target, patch, run):
    """The new version in a temporary worktree with a copy of the data and local/: patch, migrations, make_agents,
    server start. Raises Stop on any failure; the live install is not touched."""
    tmp = tempfile.mkdtemp(prefix="ut-update-")
    wt = os.path.join(tmp, "wt")
    srv = None
    try:
        git("worktree", "add", "--quiet", "--detach", wt, target)
        if patch:
            r = subprocess.run(["git", "apply", "--3way", patch], cwd=wt, capture_output=True, text=True)
            if r.returncode:
                raise Stop("CONFLICT: your edits to core files do not fit the new version (" +
                           (r.stderr or r.stdout).strip().splitlines()[-1][:200] + "). Keep them and stay on this "
                           "version, or run apply --discard-mine (the patch is kept in the backups folder)")
        for f in DATA:
            if os.path.exists(os.path.join(ROOT, f)):
                shutil.copy2(os.path.join(ROOT, f), os.path.join(wt, f))
        loc = os.path.join(ROOT, "local")
        if os.path.isdir(loc):
            shutil.copytree(loc, os.path.join(wt, "local"), symlinks=True,
                            ignore=lambda d, n: ["backups"] if os.path.samefile(d, loc) else [])
        env = {k: v for k, v in os.environ.items() if k not in ("UNDERTHREAD_LOCAL", "PORT")}
        run.step("trial: migrations on a copy of your data")
        r = subprocess.run([PY, "stateutil.py", "schema"], cwd=wt, env=env, capture_output=True, text=True, timeout=120)
        if r.returncode:
            raise Stop("trial: the migrations failed on a copy of your data: " + (r.stderr or r.stdout).strip()[-300:])
        r = subprocess.run([PY, "make_agents.py"], cwd=wt, env=env, capture_output=True, text=True, timeout=120)
        if r.returncode:
            raise Stop("trial: make_agents.py failed: " + (r.stderr or r.stdout).strip()[-300:])
        pt = free_port()
        run.step(f"trial: new server on port {pt}")
        log = open(os.path.join(tmp, "server.log"), "w")
        srv = subprocess.Popen([PY, "server.py"], cwd=wt, env=dict(env, PORT=str(pt), NO_LOOPS="1"), stdout=log,
                               stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)
        if not wait_up(None, secs=45, p=pt, ours=False):
            log.flush()
            with open(os.path.join(tmp, "server.log"), encoding="utf-8", errors="replace") as f:
                tail = f.read()[-600:]
            raise Stop("trial: the new server did not start on a copy of your data: " + tail)
        idx = None
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{pt}/", timeout=8) as r:
                idx = r.status
        except Exception as e:
            raise Stop(f"trial: the new page did not load: {e}")
        if idx != 200:
            raise Stop(f"trial: the new page answered {idx}")
        bad = page_check(pt)
        if bad:
            raise Stop("trial: the new page names files that do not load: " + ", ".join(bad))
    finally:
        if srv:
            srv.terminate()
            try:
                srv.wait(10)
            except subprocess.TimeoutExpired:
                srv.kill()
        git("worktree", "remove", "--force", wt, check=False)
        shutil.rmtree(tmp, ignore_errors=True)
        git("worktree", "prune", check=False)


def move_aside(uid, frm, to):
    """Untracked files where the new version adds a file: moved to <backups>/update/<id>/aside/ (never deleted)."""
    added = git("diff", "--name-only", "--diff-filter=A", frm, to).splitlines()
    moved = []
    for r in added:
        p = os.path.join(ROOT, r)
        if os.path.lexists(p):
            dst = upath(uid, "aside", r)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.move(p, dst)
            moved.append(r)
    return moved


def put_back_aside(uid, moved):
    for r in moved:
        src, dst = upath(uid, "aside", r), os.path.join(ROOT, r)
        if os.path.lexists(src) and not os.path.lexists(dst):
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.move(src, dst)


def move_head(to):
    """Fast-forward the branch (or move a detached HEAD) to `to`. The tree must be clean of tracked edits."""
    if git("symbolic-ref", "-q", "HEAD", check=False):
        git("merge", "--quiet", "--ff-only", to)
    else:
        git("checkout", "--quiet", "--detach", to)


def reset_head(to):
    """Move back to `to` (rollback): the branch pointer, or a detached HEAD."""
    git("reset", "--quiet", "--hard", to)


def after_switch(run):
    run.step("migrations")
    r = subprocess.run([PY, "stateutil.py", "schema"], cwd=ROOT, capture_output=True, text=True, timeout=180)
    if r.returncode:
        raise Stop("migrations failed: " + (r.stderr or r.stdout).strip()[-300:])
    run.step("make_agents.py")
    r = subprocess.run([PY, "make_agents.py"], cwd=ROOT, capture_output=True, text=True, timeout=180)
    if r.returncode:
        raise Stop("make_agents.py failed: " + (r.stderr or r.stdout).strip()[-300:])


def notify(entry):
    code = ("import json,sys; sys.path.insert(0, '.'); import stateutil as S; S.inbox_append(json.loads(sys.argv[1]))"
            "\ntry:\n    with S.mutate() as st: pass\nexcept Exception: pass")
    subprocess.run([PY, "-c", code, json.dumps(entry, ensure_ascii=False)], cwd=ROOT, capture_output=True, timeout=60)


def history():
    return rj(upath("history.json"), []) or []


def add_history(e):
    h = [x for x in history() if x.get("id") != e["id"]] + [e]
    wj(upath("history.json"), h[-50:])


def start_run(op, ignore=()):
    """One update at a time: refuse while another runs, else claim run.json, then check the rest (minus the codes in ignore)."""
    r = running()
    if r:
        raise Stop(f"an update is already running ({r.get('op')}, since {r.get('started', '')[11:16]})")
    run = Run(op)
    b = [x for x in blockers() if x[0] != "running" and x[0] not in ignore]
    if b:
        msg = "not now: " + "; ".join(t for _, t in b)
        run.end(False, msg, blockers=[k for k, _ in b])
        raise Stop(msg)
    return run


def apply(to=None, rem=None, discard_mine=False, restart_server=True, do_trial=True, dry_run=False):
    run = start_run("trial" if dry_run else "apply", ignore=("agents", "call", "keepalive") if dry_run else ())
    uid = time.strftime("%Y%m%d-%H%M%S")
    e = None
    try:
        rem = remote(rem)
        run.step(f"fetching from {rem}")
        git("fetch", "--quiet", "--tags", "--force", rem, timeout=120)
        if not to:
            c = check(rem, quiet=True)
            if c.get("error"):
                raise Stop(c["error"])
            if not c.get("latest"):
                raise Stop(f"already up to date (v{c['current']})")
            to = "v" + c["latest"]
        else:
            r = subprocess.run(["git", "fetch", "--quiet", rem, to], cwd=ROOT, capture_output=True, timeout=120)  # a bare commit or branch
            if r.returncode and subprocess.run(["git", "rev-parse", "--verify", "-q", to + "^{commit}"], cwd=ROOT,
                                               capture_output=True).returncode:
                raise Stop(f"{to}: no such tag or commit on {rem}")
        frm = git("rev-parse", "HEAD")
        tgt = git("rev-parse", to + "^{commit}")
        if tgt == frm:
            raise Stop("already at " + to)
        if subprocess.run(["git", "merge-base", "--is-ancestor", frm, tgt], cwd=ROOT).returncode:
            raise Stop(f"{to} is not ahead of this install (your install has commits of its own, or {to} is older); "
                       "nothing changed")
        if dry_run:   # t-iter-upgrade: steps 1 and 3 only; the live install, its history and its data are not touched
            run.d.update(frm=frm[:7], to=tgt[:7], to_ref=to)
            patch, mine = core_patch("trial-" + uid)
            trial(tgt, patch, run)
            msg = f"trial of {to} ({tgt[:7]}) passed on a copy of your data" + ("; your core edits fit on top" if mine else "")
            run.end(True, msg)
            return {"id": uid, "op": "trial", "from": frm, "to": tgt, "to_ref": to, "status": "ok", "mine": mine, "message": msg}
        e = {"id": uid, "at": now(), "op": "apply", "from": frm, "from_version": version_file(), "to": tgt,
             "to_ref": to, "status": "started"}
        run.d.update(frm=frm[:7], to=tgt[:7], to_ref=to)
        run.step("snapshot of your data")
        e["data"] = os.path.relpath(snapshot(uid), ROOT)
        patch, mine = core_patch(uid)
        e["patch"] = patch and os.path.relpath(patch, ROOT)
        e["mine"] = mine
        add_history(e)
        if do_trial:
            run.step("trial run of the new version on a copy")
            try:
                trial(tgt, patch, run)
            except Stop as x:
                if not (discard_mine and str(x).startswith("CONFLICT")):
                    raise
                run.step("your core edits do not fit; --discard-mine: trying without them")
                trial(tgt, None, run)
                patch = None
        elif patch and discard_mine:
            patch = None
        # ---- from here the live install changes; any failure goes back ----
        run.step("switching the code")
        if e["mine"]:
            git("reset", "--quiet", "--hard", "HEAD")
        moved = move_aside(uid, frm, tgt)
        e["aside"] = moved
        add_history(e)
        try:
            move_head(tgt)
            if patch:
                r = subprocess.run(["git", "apply", "--3way", patch], cwd=ROOT, capture_output=True, text=True)
                if r.returncode:
                    raise Stop("your core edits did not apply: " + (r.stderr or r.stdout).strip()[-200:])
                git("reset", "--quiet")   # --3way stages; leave the edits unstaged like before
            e["dropped_mine"] = bool(e["mine"] and not patch)
            after_switch(run)
            if restart_server and restart(run):
                run.step("checking the page and every file it loads")
                bad = page_check()
                if bad:
                    raise Stop("the new page names files that do not load: " + ", ".join(bad))
        except (Stop, subprocess.TimeoutExpired, OSError) as x:
            run.step(f"failed ({x}); going back")
            _back(frm, e, run, restart_server)
            e["status"] = "failed"
            e["error"] = str(x)[:400]
            add_history(e)
            raise Stop(f"update failed and was undone: {x}")
        e["status"] = "ok"
        e["to_version"] = version_file()
        e["done"] = now()
        add_history(e)
        changed = git("diff", "--name-only", frm, tgt).splitlines()
        steward = any(f == "manager.md" or f.startswith("roles/") for f in changed)
        notify({"kind": "update_done", "from": e["from_version"], "to": e["to_version"], "commit": tgt[:7],
                "steward_restart": steward, "dropped_mine": e["dropped_mine"],
                "text": f"updated to v{e['to_version']} ({tgt[:7]})" + ("; manager.md or roles/ changed: restart the steward session to read them" if steward else "")})
        check(rem, quiet=True)
        run.end(True, f"updated to v{e['to_version']}", to_version=e["to_version"])
        return e
    except Stop as x:
        if e and e.get("status") == "started":
            e["status"] = "stopped"
            e["error"] = str(x)[:400]
            add_history(e)
        run.end(False, str(x))
        raise
    except Exception as x:
        run.end(False, f"{type(x).__name__}: {x}")
        raise


def _back(frm, e, run, restart_server):
    """Code back to frm, your core edits back on, moved-aside files back. Used by a failed apply and by rollback."""
    reset_head(frm)
    put_back_aside(e["id"], e.get("aside") or [])
    if e.get("patch") and os.path.exists(os.path.join(ROOT, e["patch"])):
        r = subprocess.run(["git", "apply", os.path.join(ROOT, e["patch"])], cwd=ROOT, capture_output=True, text=True)
        if r.returncode:
            run.step("could not put your core edits back; the patch is in " + e["patch"])
    subprocess.run([PY, "make_agents.py"], cwd=ROOT, capture_output=True, timeout=180)
    if restart_server:
        restart(run)


def rollback(with_data=False, restart_server=True):
    if not is_git():
        raise Stop("this install is not a git checkout")
    h = [x for x in history() if x.get("op") == "apply" and x.get("status") == "ok"]
    if not h:
        raise Stop("no update to go back from")
    e = h[-1]
    head = git("rev-parse", "HEAD")
    if head != e["to"]:
        raise Stop(f"the code moved since the last update ({head[:7]}, not {e['to'][:7]}); go back by hand with git")
    run = start_run("rollback")
    run.d.update(frm=e["to"][:7], to=e["from"][:7])
    try:
        rid = time.strftime("%Y%m%d-%H%M%S")
        patch, _ = core_patch("rollback-" + rid)
        if patch:
            run.step("your core edits since the update saved to " + os.path.relpath(patch, ROOT))
        run.step(f"code back to {e['from'][:7]} (v{e.get('from_version')})")
        if with_data:
            run.step("data back to the snapshot (current files kept first)")
            keep = upath(f"before-rollback-{rid}.tar.gz")
            with tarfile.open(keep, "w:gz") as t:
                for f in DATA:
                    if os.path.exists(os.path.join(ROOT, f)):
                        t.add(os.path.join(ROOT, f), arcname=f)
            with tarfile.open(os.path.join(ROOT, e["data"])) as t:
                for m in t.getmembers():
                    if m.name in DATA and m.isfile():
                        t.extract(m, ROOT)
        _back(e["from"], e, run, restart_server)
        e["status"] = "rolled_back"
        e["rolled_back"] = now()
        add_history(e)
        notify({"kind": "update_rolled_back", "to": e.get("from_version"), "commit": e["from"][:7],
                "text": f"went back to v{e.get('from_version')} ({e['from'][:7]})"})
        run.end(True, f"back on v{version_file()}")
        return e
    except Stop as x:
        run.end(False, str(x))
        raise


def report_window(minutes=10):
    """True within `minutes` of config report_time (the daily report is written then; a restart there can miss or repeat it)."""
    try:
        hh, mm = (int(x) for x in str(cfg().get("report_time") or "18:00").split(":")[:2])
    except ValueError:
        return False
    n = dt.datetime.now()
    at = n.replace(hour=hh, minute=mm, second=0, microsecond=0)
    return abs((n - at).total_seconds()) <= minutes * 60


def safe_restart(force=False, agents=False):
    """t-iter-upgrade: restart the dashboard so it runs the code on disk (after a git pull, an edit, or an update with --no-restart).
    Waits for the same things an update waits for, except teammates at work (a restart does not stop them), and not within
    10 minutes of the daily report unless force. Runs the migrations first (and make_agents.py with agents=True), then the
    restart and the same checks as an update: /api/health, /api/state, the page and every file it loads, the schedules."""
    if report_window() and not force:
        raise Stop("the daily report is due within 10 minutes; restart after it (or pass --force)")
    run = start_run("restart", ignore=("agents",))
    try:
        before = http_json("/api/state?slim=1", timeout=8) or {}
        n_sched = len(before.get("schedules") or [])
        run.step("migrations")
        r = subprocess.run([PY, "stateutil.py", "schema"], cwd=ROOT, capture_output=True, text=True, timeout=180)
        if r.returncode:
            raise Stop("migrations failed, server left running: " + (r.stderr or r.stdout).strip()[-300:])
        if agents:
            run.step("make_agents.py")
            r = subprocess.run([PY, "make_agents.py"], cwd=ROOT, capture_output=True, text=True, timeout=180)
            if r.returncode:
                raise Stop("make_agents.py failed, server left running: " + (r.stderr or r.stdout).strip()[-300:])
        if not restart(run):
            run.end(True, "no server was running")
            return {"pid": None}
        run.step("checking the page and every file it loads")
        bad = page_check()
        if bad:
            raise Stop("the server is up but the page names files that do not load: " + ", ".join(bad))
        after = http_json("/api/state?slim=1", timeout=8) or {}
        n2 = len(after.get("schedules") or [])
        if n2 < n_sched:
            raise Stop(f"the server is up but lists {n2} schedules, {n_sched} before")
        h = http_json("/api/health", timeout=8) or {}
        pid = (h.get("server") or {}).get("pid")
        run.end(True, f"restarted (pid {pid}); {n2} schedules, page ok")
        return {"pid": pid, "schedules": n2}
    except Stop as x:
        run.end(False, str(x))
        raise


def status():
    c = rj(upath("check.json"), {}) or {}
    h = history()
    last_ok = next((x for x in reversed(h) if x.get("op") == "apply" and x.get("status") == "ok"), None)
    head = git("rev-parse", "HEAD", check=False) if is_git() else ""
    return {"git": is_git(), "version": version_file(), "commit": head[:7], "check": c,
            "available": bool(c.get("latest") and vt(c["latest"]) and vt(c["latest"]) > (vt(version_file()) or (0, 0, 0))),
            "blockers": [{"code": k, "text": t} for k, t in blockers()],
            "run": rj(upath("run.json")), "running": bool(running()),
            "rollback": ({"to": last_ok["from"][:7], "to_version": last_ok.get("from_version"), "at": last_ok.get("done")}
                         if last_ok and head == last_ok.get("to") else None),
            "history": h[-5:]}


def main(argv):
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(__doc__)
        return 0 if argv else 2
    cmd = argv[0]

    def opt(n):
        return argv[argv.index(n) + 1] if n in argv[:-1] else None

    try:
        if cmd == "check":
            r = check(opt("--remote"))
            return 1 if r.get("error") else 0
        if cmd == "status":
            s = status()
            if "--json" in argv:
                print(json.dumps(s, ensure_ascii=False, indent=1))
                return 0
            print(f"v{s['version']} ({s['commit']})" + ("" if s["git"] else "  not a git install"))
            c = s["check"]
            if c:
                print(f"last check {c.get('at', '')[:16]}: " + (c.get("error") or (f"v{c['latest']} is out" if s["available"] else "up to date")))
            for b in s["blockers"]:
                print("waits:", b["text"])
            if s["rollback"]:
                print(f"rollback goes to v{s['rollback']['to_version']} ({s['rollback']['to']})")
            return 0
        if cmd == "apply":
            os.makedirs(upd_dir(), exist_ok=True)
            e = apply(opt("--to"), opt("--remote"), "--discard-mine" in argv, "--no-restart" not in argv,
                      "--no-trial" not in argv, "--dry-run" in argv)
            if e.get("op") == "trial":
                print(e["message"] + "; nothing changed here")
                return 0
            print(f"updated v{e['from_version']} -> v{e['to_version']} ({e['to'][:7]})" +
                  ("; your core edits were dropped (patch kept: " + str(e.get("patch")) + ")" if e.get("dropped_mine") else "") +
                  "\nback: python3 tools/update.py rollback")
            return 0
        if cmd == "restart":
            os.makedirs(upd_dir(), exist_ok=True)
            r = safe_restart("--force" in argv, "--agents" in argv)
            print(f"restarted (pid {r['pid']})" if r.get("pid") else "no server was running; nothing to restart")
            return 0
        if cmd == "rollback":
            os.makedirs(upd_dir(), exist_ok=True)
            e = rollback("--data" in argv, "--no-restart" not in argv)
            print(f"back on v{version_file()} ({e['from'][:7]})")
            return 0
    except Stop as x:
        print("stopped:", x)
        return 1
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
