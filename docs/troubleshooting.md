# Troubleshooting and FAQ

Start with the log: `tail -n 80 logs/server.log`. Most problems show up there first.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `http://127.0.0.1:8765` doesn't load | The server isn't running, or another program holds the port (the server then prints one line saying the port is taken and exits) | `python3 tools/ensure_server.py`. Port taken: `lsof -nP -iTCP:8765 -sTCP:LISTEN` shows who; set another `port` in `config.json` or run with `PORT=8766` |
| The header says the manager is offline and requests are waiting | The steward session isn't running, or its Monitor expired | Check the terminal running `claude`. If it's gone, start it again (`claude "Start the manager per manager.md"`); it picks up the backlog from `inbox.jsonl`. If it's alive, tell it "re-arm your inbox Monitor" |
| You type in chat and nothing happens | Same as above: nobody is watching `inbox.jsonl` | As above. Your messages are not lost; they wait in the inbox |
| The steward says it can't find a teammate / dispatch fails | `make_agents.py` never ran, or ran after the steward started | `python3 make_agents.py`, then restart the steward |
| A teammate keeps asking for permission to run `stateutil.py` | `.claude/settings.json` is missing or was replaced | Restore it from git: `git checkout -- .claude/settings.json` |
| The usage widget says "no usage data" | No usage feed | In a terminal session, `.claude/settings.json` must set `tools/statusline.py` as the status line, and your plan must be Pro or Max. In the desktop app, ask the steward to refresh usage |
| Usage numbers are stale | The steward hasn't refreshed them (desktop app) | Click the usage widget's refresh, or say "refresh usage" in chat |
| A card sits in "in progress" and nobody is working on it | The teammate's run ended without delivering | Comment on the card, or ask the steward "what's happening with <card>?". It re-dispatches or asks you |
| There's no Approve button on a delivery | The card isn't in `review`, or the draft is empty | Ask the steward to check the card; it fixes the state |
| An image on a card doesn't show | The attachment path isn't relative (`work/…` or `uploads/…`) | Ask the teammate to re-attach with a relative path |
| The steward stopped dispatching | Usage passed 85% (it queues) or 95% (it sleeps) | Wait for the window to reset; it wakes by itself. Urgent cards still go out at 85% |
| Changes to `web/` files don't show | The page was opened before the change | Reload (the "Dashboard updated" pill does it). Every file's URL carries its content hash, so there is nothing to bump. Still old: check the browser is Safari 16.4+ / Chrome 89+ (import maps) |
| Changes to `server.py` / `stateutil.py` don't apply | The running server still has the old code | Restart the server. With keepalive: `kill $(lsof -nP -tiTCP:8765 -sTCP:LISTEN)` and it comes back in about 2 seconds. Don't use a broad `pkill -f server.py` |
| The phone can't open the dashboard | The dashboard only listens on `127.0.0.1` | Use Tailscale Serve: [phone-and-push.md](phone-and-push.md) |
| Push notifications don't arrive | Not served over https, or on iPhone not opened from the home screen | [phone-and-push.md](phone-and-push.md#if-push-doesnt-work) |
| ComfyUI shows offline | SSH tunnel down | `python3 tools/comfy.py tunnel`, then `python3 tools/comfy.py ping` |
| No ComfyUI line in the status popover at all | `config.json` has no `comfy` block (that's the default) | Only needed for image generation: [SETUP-GUIDE section 9](setup-guide.md#9-comfyui-optional) |
| The dashboard stops when you close the terminal (Linux) | `tools/install_service.sh` is macOS only | Run `bash tools/keepalive.sh` instead (for example under `nohup`, `tmux` or your own systemd user unit) |
| A finished card disappeared | It was archived after 3 quiet days | Search still finds it. `python3 stateutil.py archive list`; `archive unarchive-all` restores everything |
| `state.json` looks broken | Hand edits, or a crash mid-write elsewhere | Don't edit it by hand. Stop the server and the steward, keep a copy, and open an issue with the server log |

When opening an issue, include your OS, `python3 --version`, `claude --version` and the last 80 lines of `logs/server.log` (remove anything private).

## FAQ

**Does it cost money?**
Underthread is free. The work runs in Claude Code on your Claude plan, so it uses your plan's usage. The steward slows down at 85% and sleeps at 95% of the current window.

**Does it work without Claude Code?**
The dashboard runs on its own, but nothing gets done without the steward and the teammates, which are Claude Code sessions. To see what it looks like first, run `python3 server.py --demo`: a scripted crew works through sample cards in a separate `.demo/` folder, without Claude Code and without touching your own cards.

**Will it post anything for me?**
No. Every teammate is told, in its agent file, never to publish, post, upload, comment or send anything. You take the draft and do that yourself.

**Can I use other models?**
Not today. The steward and teammates are Claude Code sessions and subagents.

**Is my data sent anywhere?**
Cards, chats, uploads and logs stay in the project folder. The work itself goes through Claude Code to Anthropic like any Claude Code session. Push notifications carry no content; the phone fetches the text from your own dashboard.

**Does it run on Windows?**
Untested. macOS and Linux are.

**Why "steward" in the docs but "manager" in the files?**
Same thing. The id in code, commands and `manager.md` is `manager`; the docs call it the steward.

**Can I have more or fewer teammates?**
Yes. Hire from the Hiring market, retire from Settings → Roster, or edit `roster.json` and run `make_agents.py`. See [custom-crew.md](custom-crew.md).

**Can two teammates of the same role run at once?**
The steward keeps one standing instance per role and queues extra work for it. It runs at most three teammates at once and keeps one slot free for urgent work.

**What happens if my computer sleeps or the steward crashes?**
Your clicks keep queuing in `inbox.jsonl`. When the steward starts again it reads `manager-handoff.md` and handles the backlog.

**Is this an Anthropic product?**
No. Underthread is an independent project and is not affiliated with Anthropic.
