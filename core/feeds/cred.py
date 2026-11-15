"""Where a feed source's password lives (t-feed-inbox). Same pattern as tools/ghcred.py (the GitHub token).

  keychain (default on macOS)  the login keychain, written and read through git's own helper (git-credential-osxkeychain) with
                               the credential on stdin. Its own item per source: server <source>.feeds.underthread.invalid,
                               protocol https, account = the mail address. It never touches Mail.app's imap.gmail.com item.
  file (opt-in)                ~/.config/underthread/feeds-credentials.json, mode 600, plain text. Only after a keychain check
                               failed and the user confirmed on the page. On Linux (no keychain helper) this is the only way.

The password is never printed, logged, put in feeds.json / config / the inbox / a card, on a command line or in an environment
variable. get() is the only function that returns it, and only the collector calls it, right before logging in.

Test-only overrides: UNDERTHREAD_FEED_CRED_FILE (the file path), UNDERTHREAD_FEED_KEYCHAIN=0 (act as if there is no helper).
"""
import datetime as dt
import json
import os
import re
import secrets
import subprocess
import threading

FILE = os.path.expanduser(os.environ.get("UNDERTHREAD_FEED_CRED_FILE") or "~/.config/underthread/feeds-credentials.json")
PROBE_HOST = "probe.feeds.underthread.invalid"
GIT = "/usr/bin/git" if os.path.exists("/usr/bin/git") else "git"
_lock = threading.Lock()


def host(src):
    return f"{src}.feeds.underthread.invalid"


def _env():
    e = {k: v for k, v in os.environ.items() if not k.startswith("UNDERTHREAD_")}
    e["GIT_TERMINAL_PROMPT"] = "0"
    return e


def helper():
    if os.environ.get("UNDERTHREAD_FEED_KEYCHAIN") == "0":
        return None
    try:
        p = subprocess.run([GIT, "--exec-path"], capture_output=True, text=True, timeout=10, env=_env(), stdin=subprocess.DEVNULL)
        h = os.path.join(p.stdout.strip(), "git-credential-osxkeychain")
        return h if p.returncode == 0 and os.path.exists(h) else None
    except Exception:  # noqa: BLE001
        return None


def _code(err):
    m = re.search(r"-25\d{3}|-34018|-128", err or "")
    return int(m.group(0)) if m else None


def _kc(action, server, user, password=None):
    """git-credential-osxkeychain <action>, credential on stdin. Returns (ok, code, stdout)."""
    h = helper()
    if not h:
        return False, None, ""
    s = f"protocol=https\nhost={server}\nusername={user}\n" + (f"password={password}\n" if password is not None else "") + "\n"
    try:
        p = subprocess.run([h, action], input=s, capture_output=True, text=True, timeout=20, env=_env())
    except Exception:  # noqa: BLE001
        return False, None, ""
    finally:
        s = None
    code = _code(p.stderr)
    return (p.returncode == 0 and code is None), code, p.stdout


def _kc_get(server, user):
    ok, code, out = _kc("get", server, user)
    m = re.search(r"^password=(.*)$", out or "", re.M)
    return (m.group(1) if m else None), code


def _file_read():
    try:
        with open(FILE, encoding="utf-8") as f:
            d = json.load(f)
            return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _file_write(d):
    folder = os.path.dirname(FILE)
    os.makedirs(folder, mode=0o700, exist_ok=True)
    old = os.umask(0o077)
    try:
        if not d:
            if os.path.exists(FILE):
                os.remove(FILE)
            return True
        tmp = FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(d, f)
        os.chmod(tmp, 0o600)
        os.replace(tmp, FILE)
        return True
    except OSError:
        return False
    finally:
        os.umask(old)


def put(src, account, secret, method):
    """Store. Returns (ok, code). code = macOS error number when the keychain refused (-25308 = locked from the background)."""
    with _lock:
        if method == "file":
            d = _file_read()
            d[src] = {"account": account, "secret": secret}
            return _file_write(d), None
        _kc("erase", host(src), account)
        ok, code, _ = _kc("store", host(src), account, secret)
        if ok:
            got, code2 = _kc_get(host(src), account)
            ok, code = got == secret, code or code2
            got = None
        return ok, code


def get(src, account, method):
    """The stored password, or (None, code)."""
    with _lock:
        if method == "file":
            e = _file_read().get(src) or {}
            return (e.get("secret") if e.get("account") == account else None), None
        return _kc_get(host(src), account)


def erase(src, account, method):
    """Remove from wherever it is (both places, so switching methods never leaves a copy behind). Returns ok."""
    with _lock:
        ok = True
        if account and helper():
            k_ok, _, _ = _kc("erase", host(src), account)
            ok = k_ok or _kc_get(host(src), account)[0] is None
        d = _file_read()
        if src in d:
            d.pop(src)
            ok = _file_write(d) and ok
        return ok


def probe():
    """Write, read and erase a throwaway keychain item. Never touches a real one."""
    with _lock:
        user, val = "underthread-probe", "probe-" + secrets.token_hex(8)
        r = {"at": dt.datetime.now().astimezone().isoformat(timespec="seconds"), "write": False, "read": False, "erase": False, "code": None}
        if not helper():
            r["verdict"] = "nohelper"
            return r
        ok, code, _ = _kc("store", PROBE_HOST, user, val)
        r["write"], r["code"] = ok, code
        if ok:
            got, code2 = _kc_get(PROBE_HOST, user)
            r["read"], r["code"] = got == val, r["code"] or code2
        ok3, code3, _ = _kc("erase", PROBE_HOST, user)
        r["erase"] = ok3 and _kc_get(PROBE_HOST, user)[0] is None
        r["code"] = r["code"] or (code3 if not ok3 else None)
        r["verdict"] = "ok" if (r["write"] and r["read"] and r["erase"]) else "locked" if r["code"] in (-25308, -25293, -128) else "error"
        return r
