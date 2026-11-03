"""t-dash-token: the GitHub push token, set once from the dashboard and read by git afterwards.

Where it lives
  A (default) the login keychain, written by git's own helper (git-credential-osxkeychain store) so git reads it later
    without an "allow access" prompt; same item format git uses: internet password, server github.com, protocol https.
  B (opt-in)  ~/.config/underthread/git-credentials (0600, plain text) via `git credential-store`, wired up for github.com only
    in the global git config. Used only after the user picked it on the page (after a probe found the keychain locked).

The token never leaves this module except on stdin to the git helper and in the Authorization header to api.github.com.
It is never printed, logged, written to secrets_meta.json, put on a command line or in an environment variable,
and no function returns it. Errors are fixed strings plus the macOS error code at most.

Env overrides (tests on the scratch copy only): UNDERTHREAD_GH_HOST (default github.com), UNDERTHREAD_GH_API (default
https://api.github.com), UNDERTHREAD_GH_FILE (default ~/.config/underthread/git-credentials). The global git config is the
normal one unless GIT_CONFIG_GLOBAL is set (git honours it).
"""
import datetime as dt
import json
import os
import re
import secrets
import subprocess
import threading
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
META = os.path.join(ROOT, "secrets_meta.json")
HOST = os.environ.get("UNDERTHREAD_GH_HOST") or "github.com"
API = (os.environ.get("UNDERTHREAD_GH_API") or "https://api.github.com").rstrip("/")
FILE = os.path.expanduser(os.environ.get("UNDERTHREAD_GH_FILE") or "~/.config/underthread/git-credentials")
PROBE_HOST = "underthread-probe.invalid"
# open-source build: which repo to check push rights on comes from the environment (no author account baked in)
DEF_USER, DEF_REPO = os.environ.get("UNDERTHREAD_GH_USER") or "", os.environ.get("UNDERTHREAD_GH_REPO") or ""
TOKEN_RE = re.compile(r"^(github_pat_|ghp_)[A-Za-z0-9_]{20,255}$")
GIT = "/usr/bin/git" if os.path.exists("/usr/bin/git") else "git"
_lock = threading.Lock()


def _env():
    e = {k: v for k, v in os.environ.items() if not k.startswith("UNDERTHREAD_GH_")}
    e["GIT_TERMINAL_PROMPT"] = "0"
    return e


def _helper():
    try:
        p = subprocess.run([GIT, "--exec-path"], capture_output=True, text=True, timeout=10, env=_env())
        h = os.path.join(p.stdout.strip(), "git-credential-osxkeychain")
        return h if os.path.exists(h) else None
    except Exception:  # noqa: BLE001
        return None


def _code(err):
    """macOS error code from helper stderr (e.g. -25308), never the raw text."""
    m = re.search(r"-25\d{3}|-34018|-128", err or "")
    return int(m.group(0)) if m else None


def _cred(host, user, password=None):
    s = f"protocol=https\nhost={host}\n"
    if user:
        s += f"username={user}\n"
    if password is not None:
        s += f"password={password}\n"
    return s + "\n"


def _kc(action, host, user, password=None):
    """Run git-credential-osxkeychain <action> with the credential on stdin. Returns (ok, code, stdout)."""
    h = _helper()
    if not h:
        return False, None, ""
    try:
        p = subprocess.run([h, action], input=_cred(host, user, password), capture_output=True, text=True, timeout=20, env=_env())
    except Exception:  # noqa: BLE001
        return False, None, ""
    code = _code(p.stderr)
    return (p.returncode == 0 and code is None), code, p.stdout


def _kc_get(host, user):
    ok, code, out = _kc("get", host, user)
    m = re.search(r"^password=(.*)$", out or "", re.M)
    return (m.group(1) if m else None), code


def _store_file(action, host, user, password=None):
    """git credential-store --file FILE <action>, credential on stdin."""
    d = os.path.dirname(FILE)
    os.makedirs(d, mode=0o700, exist_ok=True)
    try:
        os.chmod(d, 0o700)
    except OSError:
        pass
    old = os.umask(0o077)
    try:
        p = subprocess.run([GIT, "credential-store", "--file", FILE, action], input=_cred(host, user, password),
                           capture_output=True, text=True, timeout=20, env=_env())
    except Exception:  # noqa: BLE001
        return False
    finally:
        os.umask(old)
    if os.path.exists(FILE):
        os.chmod(FILE, 0o600)
    return p.returncode == 0


def _file_get(host):
    try:
        with open(FILE, encoding="utf-8") as f:
            for line in f:
                m = re.match(r"^https://([^:@/]+):([^@]+)@" + re.escape(host) + r"/?\s*$", line.strip())
                if m:
                    return urllib.parse.unquote(m.group(2))
    except OSError:
        pass
    return None


def _gitcfg(*args):
    try:
        return subprocess.run([GIT, "config", "--global", *args], capture_output=True, text=True, timeout=10, env=_env()).returncode == 0
    except Exception:  # noqa: BLE001
        return False


def _wire_file(on):
    """Route B wiring: for https://HOST only, reset the helper list (drops the system osxkeychain) and use the file."""
    key = f"credential.https://{HOST}.helper"
    _gitcfg("--unset-all", key)
    if on:
        return _gitcfg("--add", key, "") and _gitcfg("--add", key, f"store --file {FILE}")
    return True


def _meta():
    try:
        with open(META, encoding="utf-8") as f:
            m = json.load(f)
            return m if isinstance(m, dict) else {}
    except (OSError, ValueError):
        return {}


def _save(m):
    m = {k: v for k, v in m.items() if k in ("method", "configured", "user", "repo", "set_at", "checked_at", "ok", "push", "expires", "note", "probe")}
    tmp = META + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(m, f, ensure_ascii=False, indent=1)
    os.replace(tmp, META)


def _now():
    return dt.datetime.now().astimezone().isoformat(timespec="seconds")


def _check(token, repo):
    """Ask GitHub who the token is and whether it can push to repo. Never raises; returns a dict without the token."""
    out = {"ok": None, "user": None, "push": None, "expires": None, "note": ""}

    def get(path):
        rq = urllib.request.Request(API + path, headers={"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json",
                                                          "User-Agent": "underthread", "X-GitHub-Api-Version": "2022-11-28"})
        with urllib.request.urlopen(rq, timeout=12) as r:
            return json.loads(r.read() or b"{}"), r.headers.get("github-authentication-token-expiration")
    try:
        u, exp = get("/user")
        out["user"] = u.get("login")
        if exp:
            out["expires"] = exp
        if not repo:
            out["note"] = "能登录；没设置要推送的仓库（环境变量 UNDERTHREAD_GH_REPO=owner/name）"
            return out
        try:
            r, _ = get(f"/repos/{repo}")
            out["push"] = bool((r.get("permissions") or {}).get("push"))
            out["ok"] = out["push"]
            if not out["push"]:
                out["note"] = "能登录，但对这个仓库没有推送权限"
        except urllib.error.HTTPError as e:
            out["ok"] = False
            out["note"] = "看不到这个仓库（令牌没勾这个仓库）" if e.code == 404 else f"GitHub 回了 {e.code}"
    except urllib.error.HTTPError as e:
        out["ok"] = False
        out["note"] = "令牌无效或已过期" if e.code == 401 else f"GitHub 回了 {e.code}"
    except Exception:  # noqa: BLE001
        out["note"] = "连不上 GitHub，没验证"
    return out


# ---------------- public API (all return plain dicts, never the token) ----------------

def status():
    m = _meta()
    return {"configured": bool(m.get("configured")), "method": m.get("method") or "keychain", "user": m.get("user"),
            "repo": m.get("repo") or DEF_REPO, "set_at": m.get("set_at"), "checked_at": m.get("checked_at"), "ok": m.get("ok"),
            "push": m.get("push"), "expires": m.get("expires"), "note": m.get("note") or "", "probe": m.get("probe"),
            "helper": bool(_helper())}


def probe():
    """Write, read and erase a throwaway keychain item (underthread-probe.invalid). Never touches the real github.com item."""
    with _lock:
        user, val = "underthread-probe", "probe-" + secrets.token_hex(8)
        r = {"at": _now(), "write": False, "read": False, "erase": False, "code": None}
        if not _helper():
            r["verdict"] = "nohelper"
        else:
            ok, code, _ = _kc("store", PROBE_HOST, user, val)
            r["write"], r["code"] = ok, code
            if ok:
                got, code2 = _kc_get(PROBE_HOST, user)
                r["read"] = got == val
                r["code"] = r["code"] or code2
            ok3, code3, _ = _kc("erase", PROBE_HOST, user)
            r["erase"] = ok3 and _kc_get(PROBE_HOST, user)[0] is None
            r["code"] = r["code"] or (code3 if not ok3 else None)
            r["verdict"] = "ok" if (r["write"] and r["read"] and r["erase"]) else "locked" if r["code"] in (-25308, -25293, -128) else "error"
        m = _meta()
        m["probe"] = r
        _save(m)
        return r


def use_file():
    """Switch to route B. Allowed only after a probe that did NOT find a working keychain (the page asks the user first)."""
    with _lock:
        m = _meta()
        pr = m.get("probe") or {}
        if not pr or pr.get("verdict") == "ok":
            return {"ok": False, "error": "先点「检测」：钥匙串能用的话不需要改用本机文件"}
        m["method"] = "file"
        _save(m)
        return {"ok": True, "status": status()}


def set_token(token):
    """Store the token where the current method says (keychain by default, the file after use_file()). Returns {ok, ...}."""
    if not isinstance(token, str) or not TOKEN_RE.match(token.strip()):
        return {"ok": False, "error": "格式不对：要以 github_pat_ 或 ghp_ 开头"}
    token = token.strip()
    with _lock:
        m = _meta()
        repo = m.get("repo") or DEF_REPO
        method = "file" if m.get("method") == "file" else "keychain"
        chk = _check(token, repo)
        if chk["ok"] is False and chk["note"] == "令牌无效或已过期":
            return {"ok": False, "error": "GitHub 说这个令牌无效或已过期，没有保存"}
        user = chk["user"] or m.get("user") or DEF_USER
        if method == "keychain":
            old = m.get("user") or DEF_USER
            _kc("erase", HOST, old)
            if user != old:
                _kc("erase", HOST, user)
            ok, code, _ = _kc("store", HOST, user, token)
            if ok:
                got, _c = _kc_get(HOST, user)
                ok = got == token
            if not ok:
                msg = "钥匙串锁着，存不进去（-25308）" if code == -25308 else f"钥匙串存不进去（{code}）" if code else "钥匙串存不进去"
                return {"ok": False, "error": msg, "code": code, "can_file": True}
        else:
            old = m.get("user") or DEF_USER
            _store_file("erase", HOST, old)
            if not (_store_file("store", HOST, user, token) and _wire_file(True)):
                return {"ok": False, "error": "本机文件写不进去"}
        m.update({"configured": True, "method": method, "user": user, "repo": repo, "set_at": _now(), "checked_at": _now(),
                  "ok": chk["ok"], "push": chk["push"], "expires": chk["expires"], "note": chk["note"]})
        _save(m)
        return {"ok": True, "status": status()}


def _read_token(m):
    user = m.get("user") or DEF_USER
    if (m.get("method") or "keychain") == "file":
        return _file_get(HOST), None
    return _kc_get(HOST, user)


def test():
    """Read the stored token back the way git would and ask GitHub again."""
    with _lock:
        m = _meta()
        if not m.get("configured"):
            return {"ok": False, "error": "还没配置"}
        tok, code = _read_token(m)
        if not tok:
            m.update({"ok": False, "checked_at": _now(), "note": "读不出存好的令牌" + (f"（{code}）" if code else "")})
            _save(m)
            return {"ok": False, "error": m["note"], "status": status()}
        chk = _check(tok, m.get("repo") or DEF_REPO)
        tok = None
        m.update({"checked_at": _now(), "ok": chk["ok"], "push": chk["push"], "expires": chk["expires"] or m.get("expires"), "note": chk["note"]})
        if chk["user"]:
            m["user"] = chk["user"]
        _save(m)
        return {"ok": True, "status": status()}


def erase():
    with _lock:
        m = _meta()
        user = m.get("user") or DEF_USER
        kc_ok = True
        if (m.get("method") or "keychain") == "keychain":
            kc_ok, code, _ = _kc("erase", HOST, user)
            kc_ok = kc_ok or _kc_get(HOST, user)[0] is None
        _store_file("erase", HOST, user) if os.path.exists(FILE) else None
        if os.path.exists(FILE) and os.path.getsize(FILE) == 0:
            os.remove(FILE)
        _wire_file(False)
        for k in ("configured", "user", "set_at", "checked_at", "ok", "push", "expires", "note"):
            m.pop(k, None)
        m["method"] = "keychain"
        _save(m)
        if not kc_ok:
            return {"ok": False, "error": "钥匙串里的条目删不掉（钥匙串锁着？），看板这边已经不用它了", "status": status()}
        return {"ok": True, "status": status()}


def use_keychain():
    """Back from the file to the keychain: the file copy is erased; the user pastes the token again."""
    r = erase()
    return {"ok": True, "status": r["status"]}
