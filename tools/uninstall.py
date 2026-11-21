#!/usr/bin/env python3
"""Take Underthread off this computer: ./start --uninstall   (./start --uninstall --dry-run only lists what would happen).

Only what belongs to THIS folder is touched:
  1. the login item: ~/Library/LaunchAgents/com.underthread.server.plist, only when its WorkingDirectory is this folder
  2. the dashboard: the tools/keepalive.sh loop and server.py processes whose working folder is this folder
  3. the steward: a `claude` process started with the steward prompt in this folder (a steward in the Claude desktop app
     is not stopped: you are told to close it there)
  4. the icon: ~/Applications/Underthread.app (or ~/.local/share/applications/underthread.desktop) only when it points here
  5. the files ./start wrote in logs/ (steward.command, steward.tty, steward.launch, start.log)
One "go ahead? [y/N]" covers all five. Then two separate questions, both default no (keep):
  - delete this whole folder (your cards, local/, work/, uploads/, config…); a backup zip goes to ~/UnderthreadBackups/
    first unless you say no to it
  - delete Claude Code's session logs for this folder (~/.claude/projects/<this folder>)
Never touched: Claude Code itself, ~/.claude settings and other projects, the Claude desktop app, other Underthread folders.
Needs a terminal (it asks). Standard library only.
"""
import os
import re
import shutil
import signal
import subprocess
import sys
import time
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import start as S   # noqa: E402  same folder: ROOT, T(), steward_process(), proc_cwd(), app_dir(), app_root(), desktop_file()

ROOT = S.ROOT
T = S.T
LABEL = "com.underthread.server"
DRY = "--dry-run" in sys.argv[1:]
# tests point these somewhere harmless
AGENTS_DIR = os.environ.get("UNDERTHREAD_LAUNCHAGENTS") or os.path.expanduser("~/Library/LaunchAgents")
LAUNCHCTL = os.environ.get("UNDERTHREAD_LAUNCHCTL") or "launchctl"
BACKUPS = os.environ.get("UNDERTHREAD_BACKUPS") or os.path.expanduser("~/UnderthreadBackups")
SKIP_ZIP = {".git", "node_modules", "models", "__pycache__", ".demo"}


def same(a, b):
    return bool(a and b) and os.path.realpath(a) == os.path.realpath(b)


# ---------- what is there ----------
def login_item():
    """The LaunchAgent plist when it runs this folder's server, else None."""
    p = os.path.join(AGENTS_DIR, LABEL + ".plist")
    if not os.path.exists(p) or not shutil.which("plutil"):
        return None
    r = subprocess.run(["plutil", "-extract", "WorkingDirectory", "raw", "-o", "-", p], capture_output=True, text=True)
    return p if r.returncode == 0 and same(r.stdout.strip(), ROOT) else None


def board_pids():
    """keepalive.sh loops first, then server.py processes; only those whose working folder is this one."""
    try:
        ps = subprocess.run(["ps", "-axww", "-o", "pid=,command="], capture_output=True, text=True).stdout
    except OSError:
        return []
    loops, servers = [], []
    for line in ps.splitlines():
        pid, _, cmd = line.strip().partition(" ")
        if not pid.isdigit() or int(pid) == os.getpid():
            continue
        if "keepalive.sh" in cmd:
            bucket = loops
        elif re.search(r"(^|[\s/])server\.py(\s|$)", cmd) and "--demo" not in cmd:
            bucket = servers
        else:
            continue
        if same(S.proc_cwd(pid), ROOT):
            bucket.append(int(pid))
    return loops + servers


def icon():
    if sys.platform == "darwin":
        d = S.app_dir()
        return d if os.path.exists(d) and same(S.app_root(d), ROOT) else None
    f = S.desktop_file()
    try:
        with open(f) as fh:
            body = fh.read()
    except OSError:
        return None
    m = re.search(r"^X-Underthread-Root=(.*)$", body, re.M)
    return f if m and same(m.group(1), ROOT) else None


def start_files():
    return [p for p in (os.path.join(ROOT, "logs", n) for n in ("steward.command", "steward.tty", "steward.launch", "start.log"))
            if os.path.exists(p)]


def claude_logs():
    """~/.claude/projects/<this folder with every non-alphanumeric character as '-'> (Claude Code's own naming)."""
    base = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude")
    d = os.path.join(base, "projects", re.sub(r"[^A-Za-z0-9]", "-", os.path.realpath(ROOT)))
    return d if os.path.isdir(d) else None


def size(p):
    n = 0
    for dp, dn, fn in os.walk(p):
        for f in fn:
            try:
                n += os.path.getsize(os.path.join(dp, f))
            except OSError:
                pass
    return n


def human(n):
    for u in ("B", "KB", "MB", "GB"):
        if n < 1024 or u == "GB":
            return f"{n:.0f} {u}" if u == "B" else f"{n:.1f} {u}"
        n /= 1024


# ---------- doing it ----------
def stop(pids, what_zh, what_en):
    for p in pids:
        try:
            os.kill(p, signal.SIGTERM)
        except OSError:
            pass
    end = time.time() + 5
    while time.time() < end and any(alive(p) for p in pids):
        time.sleep(0.2)
    for p in pids:
        if alive(p):
            try:
                os.kill(p, signal.SIGKILL)
            except OSError:
                pass
    print("✓ " + T(f"已停止{what_zh}", f"Stopped {what_en}") + f" ({', '.join(map(str, pids))})")


def alive(pid):
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    try:   # a zombie child still answers kill(0)
        st = subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()
        return bool(st) and not st.startswith("Z")
    except OSError:
        return True


def remove_login_item(p):
    subprocess.run([LAUNCHCTL, "bootout", f"gui/{os.getuid()}/{LABEL}"], capture_output=True)
    os.remove(p)
    print("✓ " + T(f"已去掉开机自启（{p}）", f"Removed the login item ({p})"))


def backup_zip():
    os.makedirs(BACKUPS, exist_ok=True)
    out = os.path.join(BACKUPS, f"{os.path.basename(os.path.realpath(ROOT))}-{time.strftime('%Y%m%d-%H%M%S')}.zip")
    base = os.path.dirname(os.path.realpath(ROOT))
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as z:
        for dp, dn, fn in os.walk(os.path.realpath(ROOT)):
            dn[:] = [d for d in dn if d not in SKIP_ZIP]
            for f in fn:
                full = os.path.join(dp, f)
                if os.path.islink(full) or not os.path.isfile(full):
                    continue
                z.write(full, os.path.relpath(full, base))
    return out


def ask(q, default=False):
    a = S.ask_yes(q, default)
    return default if a is None else a


def main():
    if not DRY and not sys.stdin.isatty():
        print(T("卸载要在终端里跑（会问你几个问题）。只想看看会做什么：./start --uninstall --dry-run",
                "Uninstall runs in a terminal (it asks questions). To only see what it would do: ./start --uninstall --dry-run"),
              file=sys.stderr)
        return 2
    li, board, stew, ic, files, logs = login_item(), board_pids(), S.steward_pids(), icon(), start_files(), claude_logs()
    plan = []
    if li:
        plan.append(T("去掉开机自启：", "remove the login item: ") + li)
    if board:
        plan.append(T("停掉看板（进程 ", "stop the dashboard (pid ") + ", ".join(map(str, board)) + ")")
    if stew:
        plan.append(T("停掉管家（进程 ", "stop the steward (pid ") + ", ".join(map(str, stew)) + ")")
    if ic:
        plan.append(T("删掉图标：", "delete the icon: ") + ic)
    if files:
        plan.append(T("删掉 ./start 写的文件：", "delete the files ./start wrote: ") + ", ".join(os.path.relpath(f, ROOT) for f in files))
    print(T(f"Underthread 卸载（{ROOT}）", f"Uninstall Underthread ({ROOT})"))
    print(T("会做：", "Will do:") if plan else T("没有要停或要删的东西（没有开机自启、没在跑、没有图标）。", "Nothing to stop or remove (no login item, nothing running, no icon)."))
    for p in plan:
        print("  - " + p)
    print(T("会分开问你（默认都留着）：", "Will ask separately (default: keep):"))
    print("  - " + T(f"删掉整个文件夹 {ROOT}（{human(size(ROOT))}，先打备份 zip 到 {BACKUPS}）",
                     f"delete this whole folder {ROOT} ({human(size(ROOT))}; a backup zip goes to {BACKUPS} first)"))
    if logs:
        print("  - " + T(f"删掉 Claude Code 在这个文件夹的会话记录 {logs}（{human(size(logs))}）",
                         f"delete Claude Code's session logs for this folder {logs} ({human(size(logs))})"))
    print(T("不会碰：Claude Code 本身、~/.claude 里的设置和别的项目、Claude 桌面 App、别的 Underthread 文件夹。",
            "Never touched: Claude Code itself, ~/.claude settings and other projects, the Claude desktop app, other Underthread folders."))
    if DRY:
        print(T("（--dry-run：什么都没做）", "(--dry-run: nothing was changed)"))
        return 0
    if plan and not ask(T("确定？", "Go ahead?"), False):
        print(T("好，什么都没动。", "OK, nothing was changed."))
        return 1
    if li:
        remove_login_item(li)
    if board:
        stop(board, "看板", "the dashboard")
    if stew:
        stop(stew, "管家", "the steward")
    if ic:
        (shutil.rmtree if os.path.isdir(ic) else os.remove)(ic)
        print("✓ " + T("已删掉图标：", "Deleted the icon: ") + ic)
    for f in files:
        try:
            os.remove(f)
        except OSError:
            pass
    age = S.heartbeat_age() if not board else None
    if age is not None and age < 30:
        print("! " + T("看起来管家在 Claude 桌面 App 里跑着，去那里把它关掉。", "A steward seems to run in the Claude desktop app: close it there."))
    gone = False
    if ask(T(f"连整个文件夹也删掉吗？（{ROOT}）", f"Delete this whole folder too? ({ROOT})"), False):
        if ask(T(f"删之前先打一个备份 zip 到 {BACKUPS}？", f"Make a backup zip in {BACKUPS} first?"), True):
            print("✓ " + T("备份：", "Backup: ") + backup_zip())
        shutil.rmtree(ROOT)
        gone = True
        print("✓ " + T("已删掉文件夹：", "Deleted the folder: ") + ROOT)
    else:
        print(T("文件夹留着。以后想彻底删：rm -rf ", "Folder kept. To remove it later: rm -rf ") + repr(ROOT))
    if logs and ask(T("删掉 Claude Code 在这个文件夹的会话记录吗？", "Delete Claude Code's session logs for this folder?"), False):
        shutil.rmtree(logs)
        print("✓ " + T("已删掉会话记录：", "Deleted the session logs: ") + logs)
    print(T("手机上要自己做的：删掉装好的网页 App；用过 Tailscale Serve 的话跑 tailscale serve reset。",
            "On your phone: delete the installed web app. If you used Tailscale Serve: tailscale serve reset."))
    if gone:
        print(T("这个终端还在已删掉的文件夹里：cd ~", "This terminal is still in the deleted folder: cd ~"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
