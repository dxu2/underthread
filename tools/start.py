#!/usr/bin/env python3
"""One step from a fresh clone to a working board (t-first-run-simple). Run it through ./start in the project folder.

    ./start                 check, start (or reuse) the dashboard, open it, then turn this terminal into the steward
    ./start --no-steward    everything but the steward (you run it in the Claude desktop app, or elsewhere)
    ./start --no-open       do not open the browser
    ./start --steward       start the steward even if one looks online (a crashed one keeps its heartbeat for 30 min)
    ./start --demo          the demo board (no Claude Code needed); same as python3 server.py --demo
    ./start --app           (re)make the Underthread icon: ~/Applications/Underthread.app on macOS,
                            ~/.local/share/applications/underthread.desktop on Linux
    ./start --uninstall     take it off this computer (asks first; --dry-run only lists): see tools/uninstall.py
    ./start --from-app      what the icon runs: no questions, errors in a dialog, the steward in a minimised Terminal window

Order: Python >= 3.10 → git / claude present (a warning only) → .claude/agents/ (make_agents.py when missing or older than
roster.json) → tools/ensure_server.py (reuses a running server; never installs anything) → browser → steward.
The steward is started only when none is running: a `claude` process started with the steward prompt in this folder, or a
heartbeat (agents.manager.last_seen) newer than 30 minutes while its status is not offline.

Two questions, each asked once, only in a terminal, answers kept in local/start.json:
  icon         "Make an Underthread icon?" (default yes); --app makes it again
  login item   macOS only: "Start the dashboard when you log in?" (default no); yes runs tools/install_service.sh
Nothing here changes how server.py, keepalive.sh or install_service.sh behave; installs that start the old way keep working.
Standard library only.
"""
import json
import os
import platform
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROMPT = "Start the manager per manager.md"
STEWARD_CMD = f'claude "{PROMPT}"'
PREFS = os.path.join(ROOT, "local", "start.json")
APP_NAME = "Underthread"
APP_ID = "com.underthread.start"
MAC = sys.platform == "darwin"
ARGS = sys.argv[1:]
FROM_APP = "--from-app" in ARGS
ZH = (os.environ.get("LC_ALL") or os.environ.get("LANG") or "").lower().startswith("zh")


def T(zh, en):
    return zh if ZH else en


def say(msg):
    if not FROM_APP:
        print(msg, flush=True)
    else:
        log(msg)


def log(msg):
    try:
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "start.log"), "a") as f:
            f.write(time.strftime("[%F %T] ") + msg + "\n")
    except OSError:
        pass


def fail(msg):
    """Stop with one clear sentence: printed in a terminal, a dialog when the icon was clicked."""
    if FROM_APP:
        log("error: " + msg)
        dialog(msg)
    else:
        print("✗ " + msg, file=sys.stderr, flush=True)
    sys.exit(1)


def dialog(msg):
    if MAC and shutil.which("osascript"):
        s = msg.replace("\\", "\\\\").replace('"', '\\"')
        subprocess.run(["osascript", "-e", f'display dialog "{s}" with title "{APP_NAME}" buttons {{"OK"}} default button 1 with icon caution'],
                       capture_output=True)
    elif shutil.which("zenity"):
        subprocess.run(["zenity", "--error", "--title", APP_NAME, "--text", msg], capture_output=True)
    elif shutil.which("notify-send"):
        subprocess.run(["notify-send", APP_NAME, msg], capture_output=True)


def prefs():
    try:
        with open(PREFS) as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def save_prefs(**kw):
    d = prefs()
    d.update(kw)
    os.makedirs(os.path.dirname(PREFS), exist_ok=True)
    tmp = PREFS + ".tmp"
    with open(tmp, "w") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
    os.replace(tmp, PREFS)


def ask_yes(q, default):
    if FROM_APP or not sys.stdin.isatty():
        return None
    hint = "[Y/n]" if default else "[y/N]"
    try:
        a = input(f"? {q} {hint} ").strip().lower()
    except EOFError:
        return None
    return default if not a else a.startswith("y")


# ---------- steps ----------
def check_env():
    if sys.version_info < (3, 10):
        fail(T(f"需要 Python 3.10 或更新（现在是 {platform.python_version()}）。装一个新的 python3，再跑 ./start。",
               f"Underthread needs Python 3.10 or newer (this is {platform.python_version()}). Install a newer python3, then run ./start again."))
    say("✓ " + T(f"Python {platform.python_version()}", f"Python {platform.python_version()}"))
    if not shutil.which("git"):
        say("! " + T("没有 git：看板照样能用，只是以后不能一键更新。", "git not found: the board works, but one-click updates need git."))
    claude = shutil.which("claude")
    if claude:
        say("✓ " + T("找到 Claude Code：", "Claude Code: ") + claude)
    return claude


def agents_stale():
    d = os.path.join(ROOT, ".claude", "agents")
    try:
        newest = max(os.path.getmtime(os.path.join(d, f)) for f in os.listdir(d) if f.endswith(".md"))
    except (OSError, ValueError):
        return True
    # roster.json changed, or an update brought a new make_agents.py (new hard rules reach existing installs: t-oss-polish-1121)
    return any(os.path.exists(r) and os.path.getmtime(r) > newest for r in (os.path.join(ROOT, "roster.json"), os.path.join(ROOT, "make_agents.py")))


def ensure_agents():
    if not agents_stale():
        say("✓ " + T("队员文件已就绪（.claude/agents/）", "Teammates are set up (.claude/agents/)"))
        return
    r = subprocess.run([sys.executable, os.path.join(ROOT, "make_agents.py")], cwd=ROOT, capture_output=True, text=True)
    if r.returncode:
        last = ((r.stderr or r.stdout).strip().splitlines() or [""])[-1]
        fail(T("make_agents.py 出错了：", "make_agents.py failed: ") + last)
    say("✓ " + T("已生成队员文件（make_agents.py）", "Made the teammates (make_agents.py)"))


def port():
    if ROOT not in sys.path:
        sys.path.insert(0, ROOT)
    try:
        from core import config as C
        return int(C.load(ROOT).get("port", 8765))
    except Exception:   # noqa: BLE001 - a broken config is the server's to report; the default port is the best guess here
        return 8765


def ensure_server():
    r = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "ensure_server.py")], cwd=ROOT, capture_output=True, text=True)
    out = (r.stdout or "").strip()
    if r.returncode or "still not answering" in out:
        fail(T("看板没起来，看一下 logs/server.log。", "The dashboard did not come up. See logs/server.log.") + (f" ({out})" if out else ""))
    say("✓ " + (T("看板已经在跑", "The dashboard was already running") if out == "up" else T("看板已在后台启动", "Started the dashboard in the background"))
        + f": http://127.0.0.1:{port()}")


def open_browser(url):
    if MAC:
        subprocess.run(["open", url])
    elif shutil.which("xdg-open") and (os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")):
        subprocess.Popen(["xdg-open", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    else:
        say(T("在浏览器里打开：", "Open in your browser: ") + url)
        return
    say("✓ " + T("已打开浏览器", "Opened the browser"))


# ---------- is a steward already running? ----------
def steward_process():
    """pid of a `claude` process started with the steward prompt whose working folder is this install, else None."""
    p = steward_pids()
    return p[0] if p else None


def steward_pids():
    """Every such process (tools/uninstall.py stops them all)."""
    found = []
    try:
        ps = subprocess.run(["ps", "-axww", "-o", "pid=,command="], capture_output=True, text=True).stdout
    except OSError:
        return found
    for line in ps.splitlines():
        pid, _, cmd = line.strip().partition(" ")
        if PROMPT not in cmd or "claude" not in cmd or "start.py" in cmd or "steward.command" in cmd:
            continue
        t = cmd.split()
        if len(t) > 1 and os.path.basename(t[0]).lstrip("-") in ("sh", "bash", "zsh", "dash", "fish") and t[1] == "-c":
            continue   # a shell running a command line that merely mentions the prompt (scripts, test harnesses)
        if proc_cwd(pid) == os.path.realpath(ROOT):
            found.append(int(pid))
    return found


def proc_cwd(pid):
    if os.path.isdir(f"/proc/{pid}"):
        try:
            return os.path.realpath(os.readlink(f"/proc/{pid}/cwd"))
        except OSError:
            return None
    if shutil.which("lsof"):
        out = subprocess.run(["lsof", "-a", "-p", str(pid), "-d", "cwd", "-Fn"], capture_output=True, text=True).stdout
        for ln in out.splitlines():
            if ln.startswith("n"):
                return os.path.realpath(ln[1:])
    return None


def heartbeat_age():
    """Minutes since the steward's last heartbeat, or None (never seen, offline, or the board did not answer)."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port()}/api/state?slim=1", timeout=5) as r:
            m = (json.load(r).get("agents") or {}).get("manager") or {}
    except (OSError, ValueError):
        return None
    if not m.get("last_seen") or m.get("status") == "offline":
        return None
    try:
        import datetime as dt
        t = dt.datetime.fromisoformat(str(m["last_seen"]))
        return (dt.datetime.now(t.tzinfo) - t).total_seconds() / 60
    except (TypeError, ValueError):
        return None


LAUNCH = os.path.join(ROOT, "logs", "steward.launch")


def steward_online():
    if "--steward" in ARGS:
        return None
    try:
        if time.time() - os.path.getmtime(LAUNCH) < 90:   # a click a moment ago is still starting it (no heartbeat yet)
            return T("管家刚刚叫醒过，正在启动", "The steward was woken a moment ago and is starting")
    except OSError:
        pass
    pid = steward_process()
    if pid:
        return T(f"管家已经在跑（进程 {pid}）", f"The steward is already running (pid {pid})")
    age = heartbeat_age()
    if age is not None and age < 30:
        return T(f"管家 {int(age)} 分钟前还在线（可能在 Claude 桌面 App 里）", f"The steward was online {int(age)} min ago (maybe in the Claude desktop app)")
    return None


TTY_FILE = os.path.join(ROOT, "logs", "steward.tty")


def steward_script(claude):
    """logs/steward.command: what the steward's Terminal window runs. It notes its tty (so start.py can find and minimise
    that one window) and then becomes the steward."""
    p = os.path.join(ROOT, "logs", "steward.command")
    os.makedirs(os.path.dirname(p), exist_ok=True)
    q = shlex.quote
    body = f"""#!/bin/bash
# Written by tools/start.py for the Underthread icon. Safe to delete; the next click writes it again.
cd {q(ROOT)} || exit 1
printf '\\033]0;{APP_NAME} steward\\007'
tty > {q(TTY_FILE)}
echo "{T('这个窗口是管家。关掉它管家就下线；再点一次 Underthread 图标会重新叫醒。', 'This window is the steward. Closing it takes the steward offline; click the Underthread icon to wake it again.')}"
exec {q(claude)} {q(PROMPT)}
"""
    with open(p, "w") as f:
        f.write(body)
    os.chmod(p, 0o755)
    return p


MINIMISE = """on run argv
	tell application "Terminal"
		repeat with w in windows
			try
				if tty of selected tab of w is (item 1 of argv) then set miniaturized of w to true
			end try
		end repeat
	end tell
end run"""


def open_steward_window_mac(claude):
    """A Terminal window for the steward, then minimised. Opening a .command needs no permission. Minimising it is an Apple
    event to Terminal: macOS asks once (\"Underthread wants to control Terminal\"). Refused or unanswered: the window just stays open."""
    try:
        os.remove(TTY_FILE)
    except OSError:
        pass
    open(LAUNCH, "w").close()
    subprocess.run(["open", "-a", "Terminal", steward_script(claude)])
    tty = None
    for _ in range(40):
        time.sleep(0.25)
        try:
            with open(TTY_FILE) as f:
                tty = f.read().strip() or None
        except OSError:
            continue
        if tty:
            break
    if not tty:
        log("steward: Terminal window opened, tty unknown, not minimised")
        return
    try:
        r = subprocess.run(["osascript", "-e", MINIMISE, tty], capture_output=True, text=True, timeout=90)
        log("steward: Terminal window opened and minimised" if r.returncode == 0 else f"steward: window left open ({r.stderr.strip()})")
    except subprocess.TimeoutExpired:
        log("steward: window left open (no answer to the Terminal permission prompt)")


def start_steward(claude):
    if "--no-steward" in ARGS:
        say(T("跳过管家（--no-steward）。在 Claude 桌面 App 里打开这个文件夹，说：", "Skipping the steward (--no-steward). In the Claude desktop app, open this folder and say: ") + PROMPT)
        return
    on = steward_online()
    if on:
        say("✓ " + on + T("，不再开第二个。（确定它已经不在了？./start --steward）", "; not starting a second one. (Sure it is gone? ./start --steward)"))
        return
    if not claude:
        msg = T("没找到 claude 命令。看板已经开好；装好 Claude Code（https://docs.claude.com/en/docs/claude-code）再跑 ./start 叫醒管家。",
                "The claude command was not found. The board is up; install Claude Code (https://docs.claude.com/en/docs/claude-code), then run ./start to wake the steward.")
        if FROM_APP:
            dialog(msg)
        say("! " + msg)
        return
    if FROM_APP:
        if MAC:
            open_steward_window_mac(claude)
        else:
            term = next((t for t in ("x-terminal-emulator", "gnome-terminal", "konsole", "xterm") if shutil.which(t)), None)
            if not term:
                dialog(T("没找到终端程序。在这个文件夹里开一个终端，运行：", "No terminal app found. Open a terminal in this folder and run: ") + STEWARD_CMD)
                return
            argv = [term, "--", claude, PROMPT] if term == "gnome-terminal" else [term, "-e", f"{shlex.quote(claude)} {shlex.quote(PROMPT)}"]
            open(LAUNCH, "w").close()
            subprocess.Popen(argv, cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
            log(f"steward: opened {term}")
        return
    say("→ " + T("叫醒管家：这个终端从现在起就是管家的窗口，别关它。", "Waking the steward: from now on this terminal is the steward's window. Leave it open."))
    sys.stdout.flush()
    os.chdir(ROOT)
    os.execv(claude, [claude, PROMPT])


# ---------- the icon ----------
def app_dir():   # UNDERTHREAD_APPS (tests): another folder for the icon
    return os.path.join(os.environ.get("UNDERTHREAD_APPS") or os.path.join(os.path.expanduser("~"), "Applications"), f"{APP_NAME}.app")


def desktop_file():
    return os.path.join(os.environ.get("UNDERTHREAD_APPS") or os.path.join(os.path.expanduser("~"), ".local", "share", "applications"),
                        "underthread.desktop")


def applescript(root, path_env):
    q = lambda s: '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'   # noqa: E731
    start = os.path.join(root, "start")
    moved = (f"Underthread 不在原来的文件夹了：\n{root}\n\n在新位置的终端里跑一次 ./start，会重新生成这个图标。\n\n"
             f"Underthread is no longer in this folder:\n{root}\n\nRun ./start once in its new folder; it makes this icon again.")
    return f"""on run
	set startPath to {q(start)}
	try
		do shell script "test -x " & quoted form of startPath
	on error
		display dialog {q(moved)} with title "Underthread" buttons {{"OK"}} default button 1 with icon caution
		return
	end try
	do shell script "export PATH=" & quoted form of {q(path_env)} & "; " & quoted form of startPath & " --from-app >/dev/null 2>&1 &"
end run
"""


def make_icns(dst):
    src = os.path.join(ROOT, "tools", "app", "icon-1024.png")
    with tempfile.TemporaryDirectory() as tmp:
        iset = os.path.join(tmp, "AppIcon.iconset")
        os.mkdir(iset)
        for s in (16, 32, 128, 256, 512):
            for k, px in ((f"icon_{s}x{s}.png", s), (f"icon_{s}x{s}@2x.png", s * 2)):
                subprocess.run(["sips", "-z", str(px), str(px), src, "--out", os.path.join(iset, k)], capture_output=True, check=True)
        subprocess.run(["iconutil", "-c", "icns", iset, "-o", dst], capture_output=True, check=True)


def build_mac_app(dst=None):
    """~/Applications/Underthread.app, made here with the system's own tools (osacompile, sips, iconutil, codesign).
    Built on this Mac, so it carries no quarantine flag and Gatekeeper opens it without asking."""
    dst = dst or app_dir()
    for tool in ("osacompile", "sips", "iconutil"):
        if not shutil.which(tool):
            return T(f"缺少系统工具 {tool}，没做图标。", f"{tool} is missing, so no icon was made.")
    path_env = os.environ.get("PATH", "/usr/bin:/bin")
    with tempfile.TemporaryDirectory() as tmp:
        scpt = os.path.join(tmp, "start.applescript")
        with open(scpt, "w") as f:
            f.write(applescript(ROOT, path_env))
        new = os.path.join(tmp, f"{APP_NAME}.app")
        subprocess.run(["osacompile", "-o", new, scpt], capture_output=True, check=True)
        res = os.path.join(new, "Contents", "Resources")
        make_icns(os.path.join(res, "applet.icns"))
        info = os.path.join(new, "Contents", "Info.plist")   # plutil, not plistlib: plistlib needs pyexpat, broken in some Homebrew pythons
        for k, typ, v in (("CFBundleName", "string", APP_NAME), ("CFBundleDisplayName", "string", APP_NAME),
                          ("CFBundleIdentifier", "string", APP_ID), ("CFBundleIconFile", "string", "applet"),
                          ("UnderthreadRoot", "string", ROOT)):
            subprocess.run(["plutil", "-replace", k, "-" + typ, v, info], capture_output=True, check=True)
        if shutil.which("codesign"):   # the plist and icon changed: sign again (ad hoc), or Apple Silicon refuses to run it
            subprocess.run(["codesign", "--force", "--deep", "-s", "-", new], capture_output=True)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if os.path.exists(dst):
            if app_root(dst) is None:
                return T(f"{dst} 已经存在，而且不是这里生成的，没有覆盖。", f"{dst} exists and was not made by ./start, so it was left alone.")
            shutil.rmtree(dst)
        shutil.copytree(new, dst, symlinks=True)
    os.utime(dst, None)   # Finder / the Dock pick up the new icon
    return None


def app_root(dst=None):
    """The folder an Underthread.app made by ./start points at, or None (missing, or not ours)."""
    info = os.path.join(dst or app_dir(), "Contents", "Info.plist")
    if not os.path.exists(info) or not shutil.which("plutil"):
        return None
    r = subprocess.run(["plutil", "-extract", "UnderthreadRoot", "raw", "-o", "-", info], capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 and r.stdout.strip() else None


def build_desktop_file(dst=None):
    dst = dst or desktop_file()
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    q = lambda s: '"' + s.replace("\\", "\\\\").replace('"', '\\"').replace("`", "\\`").replace("$", "\\$") + '"'   # noqa: E731
    with open(dst, "w") as f:
        f.write("[Desktop Entry]\nType=Application\nName=Underthread\n"
                "Comment=Open the Underthread board and wake the steward\n"
                f"Exec={q(os.path.join(ROOT, 'start'))} --from-app\n"
                f"Path={ROOT}\nIcon={os.path.join(ROOT, 'web', 'icons', 'icon-512.png')}\n"
                "Terminal=false\nCategories=Office;Utility;\n"
                f"X-Underthread-Root={ROOT}\n")
    os.chmod(dst, 0o755)
    return None


def offer_icon():
    p = prefs()
    forced = "--app" in ARGS
    if MAC:
        have = app_root()
        if have and os.path.realpath(have) != os.path.realpath(ROOT) and not forced:
            if os.path.exists(os.path.join(have, "start")):
                return   # another install owns the icon; --app moves it here
            forced = True   # the folder it pointed at is gone (moved here): make it again
            say(T("Underthread 文件夹换了位置，重新生成图标。", "The Underthread folder moved; making the icon again."))
        elif have and not forced:
            return
    elif sys.platform.startswith("linux"):
        if os.path.exists(desktop_file()) and not forced:
            return
    else:
        return
    if not forced:
        if p.get("icon") is not None:
            return
        a = ask_yes(T("要在「应用程序」里放一个 Underthread 图标吗？以后点它就能打开看板、叫醒管家。",
                      "Put an Underthread icon in Applications? Clicking it opens the board and wakes the steward.") if MAC else
                    T("要在应用菜单里加一个 Underthread 图标吗？", "Add an Underthread icon to your app menu?"), True)
        if a is None:
            return
        save_prefs(icon=a)
        if not a:
            say(T("好，不放。以后想要就跑 ./start --app。", "OK, no icon. Run ./start --app any time to make one."))
            return
    try:
        err = build_mac_app() if MAC else build_desktop_file()
    except (OSError, subprocess.CalledProcessError) as e:
        err = str(e)
    if err:
        say("! " + err)
        return
    save_prefs(icon=True)
    if MAC:
        say("✓ " + T(f"图标在 {app_dir()}。想放进 Dock 就把它拖过去。第一次点它时，macOS 会问一次能不能打开终端。",
                     f"Icon: {app_dir()}. Drag it to the Dock if you like."))
    else:
        say("✓ " + T(f"图标在应用菜单里（{desktop_file()}）", f"Icon added to your app menu ({desktop_file()})"))


def offer_login_item():
    """macOS only, asked once, default no. Yes runs tools/install_service.sh (a LaunchAgent for the dashboard only)."""
    if not MAC or prefs().get("login_item") is not None:
        return
    plist = os.path.expanduser("~/Library/LaunchAgents/com.underthread.server.plist")
    if os.path.exists(plist):
        save_prefs(login_item=True)
        return
    a = ask_yes(T("要开机自动起看板吗？（会加一个登录项；以后可以用 tools/install_service.sh remove 去掉）",
                  "Start the dashboard when you log in? (adds a login item; tools/install_service.sh remove takes it out)"), False)
    if a is None:
        return
    save_prefs(login_item=a)
    if a:
        subprocess.run(["bash", os.path.join(ROOT, "tools", "install_service.sh")], cwd=ROOT)
    else:
        say(T("好，不开机自启。改主意了就跑 bash tools/install_service.sh。", "OK, not at login. Change your mind with: bash tools/install_service.sh"))


def main():
    if "-h" in ARGS or "--help" in ARGS:
        print(__doc__.strip())
        return
    if "--uninstall" in ARGS:   # tools/uninstall.py: only what belongs to this folder; asks before any data goes
        os.execv(sys.executable, [sys.executable, os.path.join(ROOT, "tools", "uninstall.py")] + [a for a in ARGS if a != "--uninstall"])
    if "--demo" in ARGS:
        rest = [a for a in ARGS if a not in ("--demo", "--no-open", "--no-steward")]
        if "--no-open" not in ARGS:
            url = f"http://127.0.0.1:{os.environ.get('PORT', '8765')}"
            subprocess.Popen([sys.executable, "-c", f"import time,subprocess,sys; time.sleep(2.5); "
                              f"subprocess.run(['open' if sys.platform=='darwin' else 'xdg-open', {url!r}])"],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        os.chdir(ROOT)
        os.execv(sys.executable, [sys.executable, os.path.join(ROOT, "server.py"), "--demo"] + rest)
    if FROM_APP:
        log("clicked " + " ".join(ARGS))
    claude = check_env()
    if ARGS == ["--app"]:
        offer_icon()   # ./start --app alone: just (re)make the icon
        return
    ensure_server()
    ensure_agents()
    if "--no-open" not in ARGS:
        open_browser(f"http://127.0.0.1:{port()}")
    if not FROM_APP:
        offer_icon()
        offer_login_item()
    start_steward(claude)


if __name__ == "__main__":
    main()
