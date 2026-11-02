# Underthread (暗线)

[中文](README.md)

A **local dashboard for a personal AI agent team**, built for a solo content creator (Bilibili / YouTube / Xiaohongshu). A long-running "manager" session in Claude Code takes your requests, turns them into cards and dispatches them to specialists (research, writing, directing, art, distribution, tooling). Specialists only deliver **drafts**; you approve, reject or comment on a local dashboard. You always publish yourself.

> Status: first version, the framework runs end to end. Voice calls / meetings, the pixel terrace office and the stage backgrounds depend on private assets and are not in this repository.

## Screenshots

> (placeholder: dashboard home with example data)
>
> (placeholder: card detail: draft, confidence, timeline, approve / reject)
>
> (placeholder: phone layout)

## What it does

- **Local dashboard** (`server.py` + `web/`): card board, detail view, version diff, calendar, notices, a phone layout you can add to the home screen, Web Push.
- **One way into state** (`stateutil.py`): cards, chat, logs and rule proposals live in a local `state.json` with file locking.
- **Configurable roles** (`roster.json` + `make_agents.py`): rename roles, change duties and tone, then generate the Claude Code subagent files with one command.
- **Rules that grow**: when you reject a draft, the manager turns your reason into a rule proposal; once you confirm it, it lands in `## Confirmed rules` of `roles/*.md`.
- **Optional**: image generation through ComfyUI (`tools/comfy.py`, via an SSH tunnel to your own GPU box); voice memo transcription with whisper.cpp (`tools/transcribe.py`).

## Getting started

Requires macOS or Linux, Python 3.10+ (standard library only) and [Claude Code](https://docs.claude.com/en/docs/claude-code). Install ffmpeg if you use the director role.

```bash
git clone https://github.com/dxu2/underthread.git && cd underthread

# 1. First start copies config.json / roster.json / state.json from the *.example.json files
python3 server.py              # open http://127.0.0.1:8765

# 2. Edit roster.json (names, duties, tone), then generate the agent files
python3 make_agents.py         # writes .claude/agents/ and refreshes the dispatch table in manager.md

# 3. Optional: let the team run stateutil and friends without a prompt each time
cp claude-settings.example.json .claude/settings.json

# 4. In another terminal, start the manager
claude "Start the manager per manager.md"
```

See [SETUP-GUIDE.md](SETUP-GUIDE.md) for details. Try UI changes on a copy first: `PORT=8799 NO_LOOPS=1 python3 server.py`, never against your real `state.json`.

## Example roles

`roster.example.json` ships **neutral placeholder roles** (Steward, Scout, Quill, Lens, Brush, Signal, Smith). Rename them freely. This repository contains **no characters from any commercial game or anime**; please do not commit other people's characters or artwork.

## Not included

| Not included | Notes |
|---|---|
| Your data | `config.json`, `roster.json`, `state.json`, `inbox.jsonl`, `uploads/`, `work/`, `logs/`, `avatars/` are all in `.gitignore` |
| Push keys | `vapid.json` is generated locally (mode 600) the first time push is used. **Never commit it** |
| Models | No whisper, ComfyUI or LoRA models. Download them yourself and follow each model's own license |
| Voices | No voice samples or cloned voices. The voice module will be released separately; only use your own voice or voices you have the rights to |
| Artwork | No character art or pixel office assets. The UI falls back to text and avatars without them |

## Principles

- **Drafts only**: agents never publish, comment or upload on any outside service.
- **Plan first** for big changes; work starts after you approve.
- **Backups**: files get a `.bak-<tag>` copy before edits (ignored via `*.bak*`).

## License

Code is [MIT](LICENSE). MIT covers this repository's code only; models, fonts, voices and images you plug in keep their own licenses.
