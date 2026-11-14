#!/usr/bin/env python3
"""Demo mode: see the dashboard with a crew at work, without Claude Code and without touching your own data.

    python3 server.py --demo          # same as: python3 tools/demo.py
    PORT=8766 python3 tools/demo.py   # another port
    python3 tools/demo.py --fast      # shorter pauses (used by the smoke test)
    python3 tools/demo.py --lang zh   # the steward's chat lines in Chinese (default: from $LANG)

What it does:
  1. Builds a separate runtime folder, .demo/ (git-ignored): the Python files are copied, web/, avatars/, templates/ and
     tools/ are linked, and roster / config / state start from the example files. Your state.json, inbox.jsonl, work/
     and uploads/ are never read or written. .demo/ is rebuilt on every start; delete it any time.
  2. Starts server.py in .demo/ with the background loops off (no reports, no push, no schedules).
  3. Plays a script through stateutil.py, the same commands real teammates use: the steward picks up a request, a
     teammate lights up, logs progress and hands in a draft for review, the steward says so in chat. It loops forever.
  4. Answers what you do on the page with canned lines: approve, reject, comment, chat, a new card. In the real app a
     Claude Code session (the steward) and its subagents do this part.

Stop with Ctrl-C.
"""
import json
import os
import random
import shutil
import signal
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEMO = os.path.join(ROOT, ".demo")
PORT = int(os.environ.get("PORT") or 8765)
FAST = "--fast" in sys.argv
PY = sys.executable
PAUSE = (0.6, 1.2) if FAST else (3.0, 6.0)
_la = sys.argv[sys.argv.index("--lang") + 1] if "--lang" in sys.argv[:-1] else (os.environ.get("LC_ALL") or os.environ.get("LANG") or "")
ZH = _la.lower().startswith("zh")


def L(zh, en):
    """The real steward answers in the user's language; the demo guesses it from --lang or the locale."""
    return zh if ZH else en


def who(rid):
    try:
        with open(os.path.join(ROOT, "roster.example.json"), encoding="utf-8") as f:
            return next((a.get("name") or rid for a in json.load(f).get("roles", []) if a.get("id") == rid), rid)
    except (OSError, ValueError, AttributeError):
        return rid

COPY = ["server.py", "stateutil.py", "schedules.py", "usage_roll.py", "make_agents.py", "team.md", "policy.md", "manager.md"]
LINK = ["web", "avatars", "templates", "tools"]

# Jobs the script cycles through: (owner, kind, category, title zh, title en, summary en, log lines, draft)
JOBS = [
    ("scout", "deliverable", "daily", "比较三款降噪耳机", "Compare three noise-cancelling headphones",
     "Which pair to buy for flights and the office.",
     ["Reading three long reviews", "Building the comparison table"],
     "**Pick: model B.** Best noise cancelling for the price; model A is lighter but weaker on low hum.\n\n"
     "| | A | B | C |\n|---|---|---|---|\n| Price | $$ | $$ | $$$ |\n| Noise cancelling | ok | strong | strong |\n"
     "| Battery | 30 h | 30 h | 24 h |\n| Weight | light | medium | heavy |\n\nSources are listed under evidence. Prices not checked today."),
    ("writer", "deliverable", "side", "周报邮件草稿", "Draft of the weekly update email",
     "A short update for the team, ready to copy.",
     ["Collecting what closed this week", "Tightening the opening"],
     "**Subject:** Week 46: shipped the importer, two open questions\n\nHi all,\n\nThis week we shipped the importer and "
     "fixed the slow export. Two things need a decision by Friday: …\n\n(Draft only. You send it.)"),
    ("director", "plan", "main", "搬家计划", "Plan for the move",
     "Steps, owners and dates for moving at the end of next month.",
     ["Listing the steps", "Checking the dates against your calendar"],
     "## Plan\n\n| Step | Owner | Done when | Date |\n|---|---|---|---|\n| Get three quotes | Scout | table in the card | Mon |\n"
     "| Change of address list | Signal | list ticked off | Wed |\n| Packing checklist | Lens | checklist in the card | Fri |\n\n"
     "First step today: ask Scout for the quotes."),
    ("artist", "deliverable", "side", "活动海报三版", "Three poster options for the meetup",
     "A4 poster, three directions.",
     ["Sketching layouts", "Exporting three options"],
     "Three directions: **1. Bold type** (recommended, reads from across the room), 2. Photo-led, 3. Illustrated.\n\n"
     "Fonts are OFL. No stock photos used."),
    ("ops", "deliverable", "daily", "下周日程整理", "Next week's calendar, cleaned up",
     "Two clashes found and fixed.",
     ["Reading the calendar", "Moving the clashing call"],
     "- Tuesday: the dentist and the design review overlapped; moved the review to 15:00 (draft message to the team below).\n"
     "- Thursday: nothing booked after 14:00, kept free for focus work.\n\n> Hi, could we move the design review to 15:00 Tuesday?"),
    ("smith", "task", "daily", "整理下载文件夹", "Tidy the downloads folder",
     "A small script that sorts files by type into dated folders.",
     ["Writing sort_downloads.py", "Dry run: 412 files, nothing moved yet"],
     "`work/sort_downloads.py` is ready. A dry run would move 412 files into 6 folders. Nothing was moved; "
     "approve and I will run it for real."),
    ("scout", "question", "daily", "要比较哪些城市？", "Which cities should the rent comparison cover?",
     "Scout needs one answer before starting.",
     ["Waiting for your answer"],
     "Which cities do you want in the rent comparison?"),
]

CHAT = {
    "en": "(Demo) In the real app the steward, a Claude Code session, answers here and turns requests into cards.",
    "zh": "（演示）真实版里，这里由管家（一个 Claude Code 会话）回答，并把你的需求变成卡片。",
}


def say(*a):
    print("[demo]", *a, flush=True)


def S(*args, draft=None):
    """Run .demo/stateutil.py with these arguments; draft goes in on stdin."""
    r = subprocess.run([PY, os.path.join(DEMO, "stateutil.py"), *args], cwd=DEMO, input=draft, capture_output=True, text=True)
    if r.returncode:
        say("stateutil", args[0], "failed:", (r.stderr or r.stdout).strip()[-300:])
    return r.stdout


def build():
    if os.path.islink(DEMO) or (os.path.exists(DEMO) and not os.path.isdir(DEMO)):
        sys.exit(f"{DEMO} is not a folder; move it away first")
    if os.path.isdir(DEMO):
        shutil.rmtree(DEMO)
    os.makedirs(DEMO)
    for f in COPY:
        if os.path.exists(os.path.join(ROOT, f)):
            shutil.copy(os.path.join(ROOT, f), os.path.join(DEMO, f))
    for d in LINK:
        os.symlink(os.path.join(ROOT, d), os.path.join(DEMO, d))
    shutil.copytree(os.path.join(ROOT, "roles"), os.path.join(DEMO, "roles"))
    shutil.copytree(os.path.join(ROOT, "core"), os.path.join(DEMO, "core"), ignore=shutil.ignore_patterns("__pycache__"))   # t-oss-struct S3
    shutil.copy(os.path.join(ROOT, "roster.example.json"), os.path.join(DEMO, "roster.json"))
    with open(os.path.join(DEMO, "config.json"), "w", encoding="utf-8") as f:
        json.dump({"owner": {"display_name": "You"}, "port": PORT, "report_time": "18:00", "routines": []}, f, indent=2)
    with open(os.path.join(ROOT, "state.example.json"), encoding="utf-8") as f:
        st = json.load(f)
    st["items"] = []   # the script fills the board
    st["notices"] = [{"id": "n-demo", "t": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "level": "info", "until": None,
                      "text": "演示模式：示例数据，不连接 Claude Code，你的数据不会被读写。Ctrl-C 结束。",
                      "text_en": "Demo mode: sample data, no Claude Code involved, your own data is untouched. Ctrl-C to stop."}]
    with open(os.path.join(DEMO, "state.json"), "w", encoding="utf-8") as f:
        json.dump(st, f, ensure_ascii=False)
    for d in ("work", "uploads", "logs"):
        os.makedirs(os.path.join(DEMO, d), exist_ok=True)


def up(timeout=15):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/health", timeout=1) as r:
                if r.status == 200:
                    return True
        except Exception:  # noqa: BLE001
            time.sleep(0.3)
    return False


def nap(k=1.0):
    time.sleep(random.uniform(*PAUSE) * k)


class Player:
    def __init__(self):
        self.n = 0
        self.inbox_pos = 0

    def card(self, job, cid):
        owner, kind, cat, zh, en, summary, steps, draft = job
        S("upsert-item", "--id", cid, "--who", "manager", "--title", zh, "--summary", summary, "--category", cat,
          "--stage", "todo", "--kind", kind, "--owner", owner, "--json", json.dumps({"title_en": en, "summary_en": summary}))
        S("say-mgr", L(f"新卡片 {cid}，交给 {who(owner)}。", f"New card {cid}. Sending it to {who(owner)}."))
        return owner, kind, steps, draft

    def run_job(self, job, cid):
        owner, kind, steps, draft = self.card(job, cid)
        self.inbox()
        nap(0.6)
        S("set-agent", owner, "--status", "working", "--item", cid, "--activity", steps[0])
        S("upsert-item", "--id", cid, "--who", "manager", "--stage", "doing")
        for s in steps:
            nap()
            S("set-agent", owner, "--status", "working", "--item", cid, "--activity", s)
            S("log", cid, owner, s)
            self.inbox()
        nap()
        args = ["upsert-item", "--id", cid, "--who", owner, "--kind", kind, "--stage", "review", "--draft", "-",
                "--label", "v1", "--confidence", random.choice(["high", "med"])]
        if kind == "question":
            args += ["--ask", f"{job[4]} :: Paris, Berlin, Lisbon* | Tokyo, Seoul | Let me type my own"]
        S(*args, draft=draft)
        S("set-agent", owner, "--status", "idle")
        S("say-mgr", L(f"{cid} 等你拍板。", f"{cid} is waiting on you.") if kind != "question"
          else L(f"{who(owner)} 在 {cid} 上有个问题想问你。", f"{who(owner)} has a question on {cid}."))

    def inbox(self):
        """Answer what the user did on the page since the last look."""
        out = S("inbox-pending")
        try:
            entries = [json.loads(x) for x in out.splitlines() if x.strip().startswith("{")]
        except ValueError:
            entries = []
        if not entries:
            try:
                entries = json.loads(out)
            except ValueError:
                entries = []
        done = []
        for e in entries if isinstance(entries, list) else []:
            k, it = e.get("kind"), e.get("item")
            if k == "manager":
                lang = "zh" if any("一" <= ch <= "鿿" for ch in str(e.get("text", ""))) else "en"
                S("say-mgr", CHAT[lang])
            elif k == "approve":
                S("say-mgr", L(f"已批准 {it}。（演示）真实的管家这时会收尾，或者按批准的方案开工。",
                               f"Approved {it}. (Demo) The steward would now close it out or start the approved plan."))
            elif k == "reject":
                S("reply", it, "manager", L("（演示）收到理由。真实的队员会改稿，管家会把你的理由提成以后的规则。",
                                            "(Demo) Got the reason. A real teammate would revise the draft and the steward would "
                                            "offer your reason as a rule for next time."))
            elif k == "comment":
                S("reply", it, e.get("to") or "manager", L("（演示）记下了。真实的队员会在这里回复你的评论。", "(Demo) Noted. A real teammate would answer your comment here."))
            elif k == "answer":
                S("reply", it, e.get("to") or "manager", L(f"（演示）好的，按「{e.get('opt', '')}」来。", f"(Demo) Thanks, going with: {e.get('opt', '')}."))
            elif k == "new_task":
                S("reply", it, "manager", L("（演示）真实的管家会给这张卡分类，派给合适的队员。",
                                            "(Demo) The steward would triage this card and dispatch it to the right teammate."))
            elif k == "dm":
                S("dm", e.get("agent") or "scout", L("（演示）真实的队员会在这里回你。", "(Demo) A real teammate would answer your message here."))
            elif k == "ping":
                S("say-mgr", L("（演示）在。", "(Demo) Here."))
            if e.get("id"):
                done.append(e["id"])
        if done:
            S("inbox-ack", *done)

    def loop(self):
        S("set-agent", "manager", "--status", "working", "--activity", L("在线：盯着收件箱", "Online: watching the inbox"))
        S("say-mgr", L("演示模式已开。卡片会自己推进；批准、驳回或评论，看看整个流程。",
                       "Demo mode is on. Cards will move on their own; approve, reject or comment to see the loop."))
        order = list(range(len(JOBS)))
        while True:
            for i in order:
                cid = f"demo-{self.n % 9 + 1}"
                self.n += 1
                S("set-agent", "manager", "--status", "working", "--activity", L("派单 ", "Dispatching ") + cid)
                self.run_job(JOBS[i], cid)
                S("set-agent", "manager", "--status", "working", "--activity", L("在线：盯着收件箱", "Online: watching the inbox"))
                for _ in range(2):
                    nap()
                    self.inbox()
            random.shuffle(order)


def main():
    if "-h" in sys.argv or "--help" in sys.argv:
        print(__doc__.strip())
        return
    build()
    env = dict(os.environ, PORT=str(PORT), NO_LOOPS="1")
    srv = subprocess.Popen([PY, os.path.join(DEMO, "server.py")], cwd=DEMO, env=env)

    def stop(*_):
        srv.terminate()
        try:
            srv.wait(5)
        except subprocess.TimeoutExpired:
            srv.kill()
        sys.exit(0)
    signal.signal(signal.SIGTERM, stop)
    if not up():
        srv.terminate()
        sys.exit(f"demo: the server did not come up on port {PORT} (taken? try PORT=8766 python3 tools/demo.py)")
    say(f"open http://127.0.0.1:{PORT}  (demo data lives in .demo/; Ctrl-C to stop)")
    try:
        Player().loop()
    except KeyboardInterrupt:
        stop()


if __name__ == "__main__":
    main()
