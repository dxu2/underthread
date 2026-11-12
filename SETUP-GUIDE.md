# Underthread setup guide

The long version of the README's [Try it in 5 minutes](README.md#try-it-in-5-minutes). Read that first; come here when you want to change something or something needs explaining.

Words used here:
- **Steward**: the long-running Claude Code session that runs the team. Its id in files and commands is `manager`.
- **Teammate**: a Claude Code subagent generated from one entry in `roster.json`.
- **Card**: one piece of work on the dashboard (called an *item* in `state.json` and `stateutil.py`).
- `S` below is short for `python3 stateutil.py`.

How the pieces fit together is in [docs/architecture.md](docs/architecture.md). Problems: [docs/troubleshooting.md](docs/troubleshooting.md).

---

## 1. Prerequisites

| Need | Check |
|---|---|
| macOS or Linux | Windows is untested |
| Python 3.10 or newer (standard library only) | `python3 --version` |
| Claude Code, signed in to a paid Claude plan | `claude --version` |
| A Claude Code version that has the **Monitor** tool (the steward watches its inbox with it) | Ask Claude Code "do you have the Monitor tool?" |
| A browser | Any recent one; Safari on iPhone for the phone app |
| Optional: ffmpeg, if a teammate works on audio or video | `ffmpeg -version` |
| Optional: SSH access to a machine running ComfyUI, for images | `ssh <host> nvidia-smi` |
| Optional: whisper.cpp, for voice memo transcription | see `tools/transcribe.py` |
| Optional: Tailscale, to use the dashboard from your phone | `tailscale status` |

**What it costs.** Underthread itself is free. All the work runs in Claude Code and uses your Claude plan. The steward stays online and every card a teammate works on spends usage. See [section 7](#7-usage-and-the-brakes) for how the steward slows down near your limit.

---

## 2. Your config files

On first start, `server.py` copies each template to its live name if the live file is missing. The live files are ignored by git; never commit them.

| Template | Live file | What to fill in |
|---|---|---|
| `config.example.json` | `config.json` | See the table below |
| `roster.example.json` | `roster.json` | Your teammates. See [docs/custom-crew.md](docs/custom-crew.md) |
| `state.example.json` | `state.json` | Nothing. It seeds four example cards you can archive |

`config.json` keys (`config.example.json` holds only the first four; add the others when you need them):

| Key | Default | What it does |
|---|---|---|
| `owner.display_name` | `<your name>` | How the dashboard and the steward refer to you |
| `port` | `8765` | Dashboard port. The `PORT` environment variable overrides it |
| `report_time` | `18:00` | When the server asks the steward for the daily report |
| `routines` | `[]` | **Read once.** On first start any routine listed here is imported into Schedules; after that, edit schedules on the Schedules page or with `S schedule`, not here |
| `platforms` | not set | Your channels' names and home links, shown on cards. Only the content-zh preset adds it (B站 / YouTube / 小红书, [section 8](#presets)) |
| `comfy` (optional): `ssh_host`, `remote_port`, `local_port`, `default_workflow` | not set | Only for image generation through ComfyUI ([section 9](#9-comfyui-optional)). Without it the dashboard shows no ComfyUI status at all |
| `allowed_hosts` | not set | Extra host names the dashboard accepts, besides `localhost`, this machine's names and any `*.ts.net` (Tailscale) name |

Environment variables for `server.py`: `PORT` (default 8765), `NO_LOOPS=1` (no timers, for test copies), `VERBOSE=1` (log every request).

---

## 3. Permissions for Claude Code

`.claude/settings.json` ships with the repository; there is no example file to copy over it. It does two things:
- lets the steward and teammates run `stateutil.py`, `tools/comfy.py`, `tools/ensure_server.py`, `ffmpeg`, `ffprobe` and the inbox `tail` without asking you each time;
- sets `tools/statusline.py` as Claude Code's status line, which feeds your plan usage to the dashboard.

Leave it as it is. Put your own extra permissions in `.claude/settings.local.json`: git ignores it and Claude Code applies it on top of `settings.json`.

---

## 4. Create the agents

```bash
python3 make_agents.py
```

**Required before the first start of the steward**, and again after any change to `roster.json`. It:
- writes `.claude/agents/<agent_name>.md` for every enabled role, combining the roster entry, the shared hard rules and the role notes in `roles/<id>.md`;
- removes agent files for roles that were disabled or deleted;
- refreshes the dispatch table in `manager.md` (between the `DISPATCH:BEGIN` / `DISPATCH:END` markers).

Expected output: `from roster.json: wrote N agents → …` and `restart the manager session to pick them up`, plus `updated dispatch table in manager.md` when the table changed. Then restart the steward so it sees the new agents.

---

## 5. Start the dashboard

```bash
python3 server.py
```

Open <http://127.0.0.1:8765>. If the port is taken, the server says so in one line and exits; pick another with `PORT=8766 python3 server.py` or `port` in `config.json`.

Keep it in its own terminal tab, or let it run in the background:

| Tool | What it does |
|---|---|
| `bash tools/keepalive.sh` | Runs the dashboard and restarts it if it exits. Works on macOS and Linux; on Linux this is the way to keep it running |
| `bash tools/install_service.sh` | **macOS only.** Installs the dashboard as a LaunchAgent (starts at login). It changes your login items, so run it yourself. On Linux it stops and points you to `keepalive.sh` |
| `python3 tools/ensure_server.py` | Starts the dashboard if it isn't answering (through launchd when the LaunchAgent is installed, otherwise `keepalive.sh`). The steward runs it at startup |

The server log is `logs/server.log`.

**Just looking?** `python3 server.py --demo` (same as `python3 tools/demo.py`) shows the dashboard with a crew at work, without Claude Code. It runs in a separate `.demo/` folder that is rebuilt on every start and never touches your `state.json`, `inbox.jsonl`, `work/` or `uploads/`. `PORT=8766` picks another port, `--lang zh|en` sets the language of the steward's chat lines (default: from `$LANG`), Ctrl-C stops it.

**Testing a change to the dashboard?** Copy the folder and run `PORT=8799 NO_LOOPS=1 python3 server.py` in the copy, so your real `state.json` is never touched. See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## 6. Start the steward

From the project folder:

```bash
claude "Start the manager per manager.md"
```

On startup the steward (all of this is `manager.md` section 1):
1. makes sure the dashboard is up (`tools/ensure_server.py`);
2. picks up the usage feed and decides how much work it may start ([section 7](#7-usage-and-the-brakes));
3. reads `team.md`, `policy.md`, `roles/common.md`, `roles/manager.md` and, if it exists, `manager-handoff.md`;
4. marks itself online (`S set-agent manager --status working`);
5. starts a Monitor on `tail -n0 -F inbox.jsonl` **before** reading the backlog, so nothing slips through;
6. works through `S inbox-pending`, acking each entry;
7. says hello in the dashboard chat.

The steward's status in the header turns to online once step 4 runs. Leave this terminal open; you talk to the steward through the dashboard, not here.

**Monitors expire** after about 30 minutes; the steward re-arms them. If the header shows the steward offline while you have unread requests, see [troubleshooting](docs/troubleshooting.md).

---

## 7. Usage and the brakes

The dashboard's usage widget shows how much of your Claude plan is left in the 5-hour and weekly windows. It gets the numbers one of two ways (`manager.md` section 1, step 2):

| Where the steward runs | How usage arrives |
|---|---|
| Claude Code in a terminal | `.claude/settings.json` runs `tools/statusline.py` as the status line. Claude Code passes it the plan's rate limits (Pro and Max plans) and it stores them. Nothing to do |
| The Claude desktop app | The steward calls the app's usage tool after each inbox entry (at most every 10 minutes) and writes it with `S set-usage` |

The steward reads the higher of the two windows (`manager.md` section 1, step 3):
- **below 85%**: normal;
- **85% or more**: keeps answering you, but queues new work instead of dispatching it (urgent cards still go out);
- **95% or more**: writes its handoff (`manager.md` section 7), sleeps until the window resets (`S sleep`), and the server wakes it about a minute after the reset.

With no usage feed at all, the widget says "no usage data" and these brakes cannot work.

---

## 8. Phone, push, schedules, archive

### Phone and push
The dashboard works as a home-screen app on iPhone and Android, with push notifications. That needs https, which the easiest way to get is Tailscale Serve. Step by step: [docs/phone-and-push.md](docs/phone-and-push.md).

### Schedules
Tell the steward in one sentence: "remind me tomorrow at 9 to call the bank", "every weekday at 9, ask Scout for trends". It checks the parse with a dry run, confirms recurring ones with you, and creates the schedule. The **Schedules** page lists every schedule with on/off switches, the next runs and a week of history. A reminder pushes a notification; a task schedule opens a card for the right teammate.

From the command line: `S schedule add|list|show|pause|resume|rm|fire|edit` (run `S schedule add -h` for the options). A server restart never fires a schedule twice.

### Archive
Finished cards that haven't moved for 3 days are moved from `state.json` to `archive.json` once an hour, so every poll stays small. Search still finds them. `S archive list` shows them; `S archive unarchive-all` puts everything back. Environment variables: `ARCHIVE_DAYS` (default 3), `ARCHIVE_OFF=1` to stop archiving.

### Hiring market, transfer, retire
See [docs/custom-crew.md](docs/custom-crew.md).

### Presets
A preset swaps in a whole team. `presets/content-zh/` is a Chinese content-creator team (B站 / YouTube / 小红书).

```bash
python3 tools/preset.py list
python3 tools/preset.py apply content-zh --dry   # optional: show what would change
python3 tools/preset.py apply content-zh
python3 make_agents.py
```

Then restart the steward. `apply` replaces `roster.json`, `team.md`, `policy.md` and `roles/*.md`, and adds `platforms` and a placeholder `comfy` block to `config.json` (your port, owner and times stay). Every file it replaces is first copied to `<file>.bak-preset-<time>`; to undo, copy those back and run `make_agents.py` again.

---

## 9. ComfyUI (optional)

For a teammate that makes images on your own GPU machine:

1. Add a `comfy` block to `config.json`: `ssh_host` (for example `you@gpu-box`), `remote_port`, `local_port` (both usually `8188`) and `default_workflow`. Restart `server.py`; the ComfyUI line in the status popover and in System status only appears once this block exists.
2. `python3 tools/comfy.py tunnel`, then `python3 tools/comfy.py ping`. Within a minute ComfyUI shows as online.
3. In ComfyUI, export each workflow with **Save (API)** into `tools/workflows/`. `python3 tools/comfy.py nodes <wf>.json` lists the node inputs a teammate can change with `--set`.

---

## 10. Other tools

| Tool | What it does |
|---|---|
| `tools/new_role.py` | Hire, retire, re-hire or update a teammate from the command line |
| `tools/avatar_sizes.py` | Makes the small avatar copies the lists use (needs `cwebp`) |
| `tools/statusline.py` | Claude Code status line that feeds plan usage to the dashboard |
| `tools/webpush.py` | Standard-library Web Push. `python3 tools/webpush.py selftest` checks signing (needs `openssl`) |
| `tools/transcribe.py` | Optional voice memo transcription with whisper.cpp |
| `tools/ghcred.py` | Optional: store a GitHub push token once (mode 600) |
| `usage_roll.py` | Tokens per role per day, read from Claude Code's local transcripts |

`S` itself: run `python3 stateutil.py` with no arguments for the full command list (cards, chat, questions, lessons, reports, schedules, archive, usage, handoffs).

---

## 11. What to restart after a change

| You changed | Needed |
|---|---|
| Files in `web/` | Bump the `?v=N` on that file's tag in `web/index.html`, then reload the tab |
| `server.py`, `stateutil.py`, `schedules.py` | Restart `server.py` (the server imports `stateutil.py`) |
| `roster.json` | The dashboard updates by itself. Run `python3 make_agents.py`, then restart the steward |
| `manager.md` | Restart the steward |
| `policy.md`, `roles/*.md`, `team.md` | Nothing. They are read on every triage or dispatch |

**Before restarting the steward**, make sure it has written `manager-handoff.md` (30 lines or fewer: priorities, open questions, which teammates are running; see `manager.md` section 7). Ask it to in chat if in doubt. The next session reads it on startup.

---

## 12. Sharing your setup

If you share a copy, share code and templates only. Never share `state.json`, `archive.json`, `inbox.jsonl`, `uploads/`, `work/`, `logs/`, `config.json`, `vapid.json`, `push_subs.json`, `manager-handoff.md`, `.claude/agent-memory/` or role notes that hold personal rules. `.gitignore` already keeps all of them out of git.

---

## 13. Known gotchas

- Teammates don't remember between jobs on their own. Context lives in the card thread, `work/<card-id>/`, their role notes and their memory folder. That's why every teammate starts with `S show <card>`.
- If the steward dies, your clicks still queue in `inbox.jsonl`. The dashboard warns you, and the next steward session handles the backlog.
- `S inbox-ack` is what stops the steward handling an entry twice after a restart.
- Approving a **plan** moves the card to in progress. Approving a **deliverable** closes it.
- More in [docs/troubleshooting.md](docs/troubleshooting.md).
