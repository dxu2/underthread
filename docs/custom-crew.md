# Make it your crew

Underthread doesn't care what kind of work you do. The steward, cards, reviews, rules and dashboard work the same for any team. This page shows how to add, change and retire teammates.

A new install starts with five: the steward, HR (Thimble), Scout, Brush and Smith (`roster.example.json`). Everyone else is
hired as you need them.

## Three ways to add a teammate

### 1. Hiring market (easiest)

Open **Hiring market** in the left rail. It lists 29 job templates (analyst, coder, copywriter, designer, editor, translator, travel planner, tutor and more), each with three personalities.

- **Hire** adds the teammate right away: roster entry, role note, agent file and avatar.
- **Interview**: HR asks you five questions in a DM, one at a time, then drafts the new role for you to approve. The script is in `templates/hr/interview.json`. A crew without an `hr` role sees **Hire HR first** instead, which hires HR from `templates/roles/hr/` (no interview).

The steward picks up a new teammate after a restart.

### 2. Command line

```bash
python3 tools/new_role.py plan  --template coder --id dev --name Dev --name-en Dev   # dry run, writes nothing
python3 tools/new_role.py apply --template coder --id dev --name Dev --name-en Dev   # create it
```

`apply` writes the roster entry, `local/roles/<id>.md` (never overwrites one), the agent file (through `make_agents.py`) and an avatar (the default patch recoloured to the role's tint; needs `ffmpeg`, or use `--avatar none`). `--variant <key>` picks one of the template's three personalities (the first one by default). On a fresh clone it first copies `roster.example.json` to `roster.json`. It is idempotent and refuses an id that already exists with different fields. Run `python3 tools/new_role.py apply -h` for every flag.

Other commands:

| Command | What it does |
|---|---|
| `retire <id>` | Soft retire (`"enabled": false`); the history stays |
| `retire <id> --hard` | Also moves the role's files to `archive/roles/` |
| `rehire <id>` | Undo a soft retire |
| `update <id> --from-item <card>` | Apply a transfer prepared on a card |

### 3. By hand

1. Add an entry to `roster.json` (fields below).
2. Write `local/roles/<id>.md`: what this teammate does, formats, tools, and end it with an empty `## Confirmed rules` section.
3. `python3 make_agents.py`
4. Restart the steward.
5. Add a line to `local/policy.md` saying which kind of work goes to the new teammate (it is read after the core `policy.md`).

## Transfer and retire from the dashboard

Settings → Roster lists every teammate. **Transfer** changes a teammate's job with a before/after view and a 10-minute undo. **Retire** turns a teammate off. The steward (`manager`), `hr` and `smith` can't be retired.

## Roster fields

`roster.json` has a `team` line (shown in the header) and a `roles` list. Per role:

| Field | Used by | What it is |
|---|---|---|
| `id` | everything | Short id: card owner, `set-agent <id>`, `roles/<id>.md`. `manager` is the steward |
| `team` | agent file | `"general"` gives the teammate the neutral opening and general hard rules (every role in the default roster and from the Hiring market). Without it the agent file uses the content-team wording (B站 / YouTube / 小红书) of the content-zh preset |
| `name`, `name_en` | dashboard | Display name in Chinese and English UI |
| `title`, `title_en` | dashboard | Job title |
| `duty`, `duty_en` | dashboard | One-line duty under the name |
| `duty_long` | agent file | The paragraph that opens the subagent's prompt |
| `specialties` | agent file | Bullet list of what this teammate is good at |
| `notebooks` | agent file | Role-note files the teammate reads every job, usually `roles/common.md` and `roles/<id>.md` |
| `skills` | agent file | Claude Code skills to mention in the prompt |
| `agent_name` | agent file | File name in `.claude/agents/` and the steward's `subagent_type` |
| `voice` | agent file | `style` and `habits` for how the teammate talks to you in chat (never in drafts) |
| `address` | agent file | Optional: what the teammate calls you, e.g. `{"name": "boss", "open": "welcome back"}` |
| `model`, `effort` | agent file | Optional Claude model and reasoning effort for this teammate |
| `tools` | agent file | Optional tool allow-list |
| `color`, `tint` | dashboard | Accent colour and avatar backdrop colour |
| `pipe` | dashboard | Which column(s) of the production-line board this teammate works in |
| `seat` | dashboard | Position on the team stage: `[x, y]`, or `null` for none |
| `room`, `look` | dashboard | Legacy grouping and generated-face settings; safe to leave as they are |
| `order` | dashboard | Sort order |
| `enabled` | everything | `false` hides the teammate and removes its agent file on the next `make_agents.py` |

Avatars: put a PNG at `avatars/ut/<id>.png` (and optionally `avatars/<id>.png`), then run `python3 tools/avatar_sizes.py` (needs `cwebp`). `avatars/` is yours and git-ignored: the default patches ship in `avatars/seed/ut/` (and `presets/<name>/avatars/ut/`) and are copied in only where a role has no picture, never over yours. Without one, the dashboard shows a coloured circle with an initial.

## Worked example: a solo developer's crew

Say you build a side project. You might want Scout (research), Quill (docs and release notes), a **Dev** teammate (code changes, as plans first) and Smith (tooling), and no Brush, Lens or Signal.

1. In `roster.json`, set `"enabled": false` on `artist`, `director` and `ops`.
2. Hire a coder from the Hiring market, or `python3 tools/new_role.py apply --template coder --id dev --name Dev --name-en Dev`.
3. Edit `roles/writer.md`: add a section for "README sections, changelog entries, release notes; one block per channel (GitHub release, blog)".
4. In `policy.md`, route "bug", "feature", "refactor" to `dev`, and keep "docs", "release notes" on `writer`.
5. `python3 make_agents.py`, then restart the steward.

Your rules accumulate per role from then on: reject a release note once with a reason, adopt the proposed rule, and Quill won't make that mistake again.

## Optional: team presets

A preset swaps in a whole team at once. Two ship with Underthread:

- `classic`: the earlier seven-person general crew (the default five minus HR, plus Quill the writer, Lens the planner and
  Signal the coordinator).
- `content-zh`: a Chinese content-creator team (B站 / YouTube / 小红书) with its own `roster.json`, `config.json`,
  `policy.md`, `team.md` and `roles/`. Its `config.json` adds `platforms`, which turns on the 制作组 page's production-line
  and channel tabs.

In the dashboard: the preset strip at the top of the Hiring market shows the crew after the switch, who leaves, and the
files that change; **Switch** applies it. From the command line:

```bash
python3 tools/preset.py list                    # the presets you have
python3 tools/preset.py apply <name> --dry      # optional: show what would change
python3 tools/preset.py apply <name>
python3 make_agents.py
```

Then restart the steward. `apply` replaces `roster.json`, writes the preset's `team.md`, `policy.md` and `roles/*.md` into
`local/` (core files are never written; Confirmed rules already in `local/roles/<id>.md` are kept), and merges only the keys
the preset lists into `config.json` (your port, owner and times stay). Every replaced file is first backed up under the tag
`preset-<time>`. To undo, run the `python3 tools/bak.py restore preset-<time> …` line `apply` prints, delete the new
`local/` files it lists, then `python3 make_agents.py` again.

A preset is just a folder under `presets/<name>/`, so you can make your own the same way.
