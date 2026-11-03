# Underthread

**A personal AI agent team that works 24/7.**

[中文简介](#中文简介)

You talk to one **manager**. It takes your messages, breaks them into tasks, hands them to a team of **specialist agents**, and keeps you in sync on a local **dashboard** you can also use from your phone. The agents do the work and hand back drafts. Your part is to approve, reject or comment.

> Status: early version. The framework runs end to end on one machine. Voice calls and some optional artwork are not part of this repository.

![Dashboard home (example data)](docs/screenshot-desktop.jpg)

## What it is

- A **long-running manager session** in [Claude Code](https://docs.claude.com/en/docs/claude-code). It watches your inbox, sorts each request, dispatches it and follows up.
- A **team of specialists**: Claude Code subagents, each with its own role notes, rules and memory. You decide what roles you need.
- A **local dashboard** (`server.py` + `web/`): cards, a review queue, chat with the manager and each agent, notifications, and a phone layout.
- **One state file** behind it (`state.json`, written only through `stateutil.py`, with file locking). Nothing leaves your machine unless an agent is asked to call an outside tool.

## Core concepts

| Concept | What it means |
|---|---|
| **Manager** | Your single point of contact. Turns a message into one or more cards, picks the right specialist, dispatches, checks the result and writes a daily report. |
| **Specialists** | Configurable agents (for example a researcher, a writer, a designer, a tooling keeper). Each gets a role file in `roles/` and a subagent file generated from `roster.json`. |
| **Cards** | Every piece of work is a card with a stage (to do → doing → review → done), an owner, a thread and versioned drafts. |
| **Review** | Agents deliver drafts or plans to *review*. You approve, reject with a reason, or answer the clickable questions they attach. Big jobs go through a plan first. |
| **Rules that grow** | When you reject something, the manager turns your reason into a rule proposal. Once you confirm it, it lands in that role's `## Confirmed rules`. |
| **Dashboard** | Desktop home made of widgets (waiting on you, working now, new replies, shipped today, this week, recent media), card detail with diffs, chat, mailbox, ⌘K palette. |
| **Phone** | The same dashboard as a home-screen web app: tab bar, chat list, pull to refresh, optional Web Push notifications. |

<img src="docs/screenshot-phone.jpg" alt="Phone layout (example data)" width="300">

## Getting started

Requirements: macOS or Linux, Python 3.10+ (standard library only) and Claude Code.

```bash
git clone https://github.com/dxu2/underthread.git && cd underthread

# 1. The first start copies config.json / roster.json / state.json from the *.example.json files
python3 server.py              # open http://127.0.0.1:8765

# 2. Edit roster.json (names, duties, tone), then generate the agent files
python3 make_agents.py         # writes .claude/agents/ and refreshes the dispatch table in manager.md

# 3. Optional: let the team run stateutil and friends without a prompt each time
cp claude-settings.example.json .claude/settings.json

# 4. In another terminal, start the manager
claude "Start the manager per manager.md"
```

Then write to the manager from the dashboard's chat. See [SETUP-GUIDE.md](SETUP-GUIDE.md) for the full walkthrough (architecture, roles, restarts, optional tools).

To try changes to the UI, run a copy first: `PORT=8799 NO_LOOPS=1 python3 server.py`, never against your real `state.json`.

### Optional tools

- `tools/comfy.py`: image generation through your own ComfyUI box (SSH tunnel).
- `tools/transcribe.py`: voice memo transcription with whisper.cpp.
- `tools/ghcred.py`: store a GitHub push token once from the dashboard (keychain or a 0600 file); set `UNDERTHREAD_GH_REPO=owner/name` for the push check.

## Example roles

`roster.example.json` ships neutral placeholder roles (a manager plus six specialists). Rename them, change their duties and tone, add or remove roles, then run `make_agents.py` again. This repository contains no characters from any game or anime; please don't commit other people's characters or artwork.

## Privacy

- **Your data stays local.** Cards, chat, logs, uploads and agent memory live in files in the project folder (`state.json`, `uploads/`, `work/`, `logs/`, `.claude/agent-memory/`) and are all in `.gitignore`.
- The dashboard listens on `127.0.0.1` only. To use it from your phone you have to expose it yourself, for example through a private network such as Tailscale Serve (push notifications need https).
- Secrets are generated or stored locally with mode 600 (`vapid.json` for push, the optional GitHub token) and never sent back to the page.
- The only outside calls are the ones you configure: Claude Code itself, and any optional tool you enable.

## Ground rules the agents follow

- **Drafts only.** Agents never publish, post, upload or send anything to an outside service on your behalf.
- **Plan first** for big or risky changes; work starts after you approve.
- **Backups** before edits (`name.bak-<tag>`, ignored by git).

## Not included

| Not included | Notes |
|---|---|
| Your data | `config.json`, `roster.json`, `state.json`, `inbox.jsonl`, `uploads/`, `work/`, `logs/`, `avatars/` |
| Keys | `vapid.json` and tokens are created on your machine; never commit them |
| Models | No whisper, ComfyUI or other model weights; follow each model's own license |
| Voice | No voice samples or voice features in this release |
| Artwork | No character art; the UI falls back to text and avatars |

## License

Code is [MIT](LICENSE). It covers this repository's code only; models, fonts, voices and images you plug in keep their own licenses.

---

## 中文简介

**Underthread（暗线）：一支 24 小时在线的个人 AI agent 团队。**

你只跟一个「管家」说话。管家接你的消息，拆成任务卡，派给各个专员 agent，并在本地看板上跟你同步。电脑和手机都能用。专员做事、交草稿，你只负责拍板：批准、驳回或评论。

- 核心概念：管家、可配置的专员、卡片与审核、看板（小组件首页、详情、聊天、信箱）、手机端。
- 上手：照上面 Getting started 的四步做。详细说明见 [SETUP-GUIDE.md](SETUP-GUIDE.md)。
- 隐私：所有数据都存在本机的项目目录里，并且已经写进 `.gitignore`。看板默认只监听 `127.0.0.1`。
