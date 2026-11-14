# Contributing to Underthread

Thanks for wanting to help. Underthread is a small project run by one person, so short, focused changes land fastest.

## Before you start

- **Bug?** Open an issue with the bug template. Include your OS, `python3 --version`, `claude --version` and the last 80 lines of `logs/server.log` (remove anything private).
- **Bigger idea or new feature?** Open an issue first and say what problem it solves. That saves you writing code that doesn't fit.
- **Security problem?** Don't open a public issue. See [SECURITY.md](SECURITY.md).

## Set up a safe copy

Never develop against your real cards. Work in a copy with timers off:

```bash
git clone https://github.com/<you>/underthread.git underthread-dev && cd underthread-dev
PORT=8799 NO_LOOPS=1 python3 server.py      # http://127.0.0.1:8799
```

`NO_LOOPS=1` turns off the daily report, schedules, archive sweep and other timers, so a test copy never pings your steward or fires your schedules. If you need a steward in the copy, start Claude Code from that folder.

## How the code is laid out

Read [docs/architecture.md](docs/architecture.md) first. In short:

| Where | What |
|---|---|
| `server.py` | HTTP server, JSON API, timers. Standard library only |
| `stateutil.py` | The only writer of `state.json` (file lock). Also the CLI the agents use |
| `schedules.py` | Schedule parsing and next-run maths |
| `make_agents.py` | `roster.json` → `.claude/agents/*.md` |
| `web/` | Plain HTML, CSS and JavaScript. No framework, no build step |
| `tools/` | Helper scripts |
| `manager.md`, `policy.md`, `roles/`, `team.md` | Prompts and notes for the steward and teammates |

## Ground rules for code

- **Python standard library only.** No `pip install` for the core. An optional tool may need an external program (ffmpeg, cwebp, whisper.cpp); say so at the top of the file and fail with a clear message when it's missing.
- **No build step** for `web/`. When you change a file in `web/`, bump its `?v=N` in `web/index.html` so browsers fetch the new copy.
- **All state goes through `stateutil.py`.** Never write `state.json` directly, and never rewrite or truncate `inbox.jsonl`.
- **Both languages.** Every user-facing string needs English and Chinese (look for the `en() ? "…" : "…"` pattern and the string tables in `web/app.js`).
- **Desktop and phone.** Check a UI change at desktop width and at about 390px wide, in light and dark.
- **Local only.** Don't add anything that binds to `0.0.0.0`, calls out to a third-party service by default, or sends data off the machine.
- Keep comments about *why*, not *what*.

## Changing the data or the config

Updates must never need a manual step from the user, so every change to the shape of `state.json`, `config.json` or `roster.json` ships with its own upgrade:

- **New key with a sensible default:** nothing else to do. Missing top-level state keys are filled by `stateutil._shape`; missing config keys come from `DEFAULTS` in `core/config.py` (defaults are never written into the user's `config.json`; regenerate the example with `python3 -m core.config example --write`).
- **Anything else** (rename, move, backfill, new meaning): add the next numbered step in `core/migrations/` (`NNNN_<name>.py` with `TARGETS` and `up(data, ctx)`). It runs once, in order, on the first read after the update, after the old file is saved under `local/backups/migrate/` (`.backups/migrate/` without a `local/` folder). A step must be idempotent and, within a minor version, add-only: leave the old key in place so a rollback to the previous code still works.
- **Browser storage** (`rt.*` keys in localStorage): add a step at the end of `STEPS` in `web/lsmigrate.js`; never edit or reorder a shipped one.
- `python3 stateutil.py schema` shows the numbers and the migration log; `python3 stateutil.py config show` shows each effective config value and whether it is a default.

## Changing prompts

`manager.md`, `policy.md`, `roles/*.md` and the hard rules in `make_agents.py` are instructions that real agents follow. Keep them generic (no personal names, private card ids or dates), in the second person, and test them by running a steward against a copy for a few cards.

## Tests

Standard library only, and none of them needs Claude Code:

```bash
python3 tests/run.py quick      # seconds: leak scan, fixture check, unit tests
python3 tests/run.py all        # scan + smoke + unit + api + e2e (browser) + upgrade
python3 tests/smoke.py          # about 15 seconds
python3 tests/scan.py           # leak scan of tracked files; --staged checks only what you are about to commit
```

- `tests/smoke.py` runs in a temporary copy of your checkout, so your own cards are safe. It checks that Python compiles and `web/*.js` parses (with `node`, if installed), the JSON files parse, `make_agents.py` and the content-zh preset work, a fresh server serves the page and its assets, the request guard holds, `stateutil.py` writes reach the API, demo mode runs, and `keepalive.sh` is valid bash.
- `tests/scan.py` flags home-folder paths, private and tailnet addresses, token-looking strings and real-looking email addresses. Put your own words to catch (your name, your machine's name) in `tests/scan-words.txt`, one per line; git ignores that file.
- The browser journeys (`tests/run.py e2e`) need Node 18+; the first run installs Playwright into `tests/e2e/node_modules`.

CI (`.github/workflows/ci.yml`) runs them on Ubuntu and macOS with Python 3.10 and 3.12.

## Versions and the compatibility promise

Underthread uses semantic versioning (`VERSION`, tags `vX.Y.Z`). Within one major version, updating is one step with nothing to do by hand. To keep that true:

- **`stateutil.py` subcommands and options are only added, never removed or renamed.** Every role's notes call them, and agents follow notes written for older versions.
- **An `/api/...` endpoint that changes keeps its old behaviour for at least one minor version.** A page left open on a phone still runs the old JavaScript until it reloads (the "Dashboard updated · Tap to reload" banner asks it to).
- **Data changes are add-only** (see "Changing the data or the config" above): new keys get defaults, everything else is a numbered migration that leaves the old key in place, so going back one version only swaps the code.
- **The extension API** (`local/ext/`, `local/web/`, `local/ext.json`, see `docs/local.md`) keeps working within a major version; a change is written in the release's upgrade notes.
- **Breaking any of these waits for the next major version**, and its CHANGELOG upgrade notes say exactly what changes.

## Releases (maintainers)

1. Rename `## Unreleased` in `CHANGELOG.md` to `## [X.Y.Z] - YYYY-MM-DD` and fill in all four parts (Added, Changed, Fixed, Upgrade notes; the format is at the top of the changelog). Commit it.
2. Run `python3 tools/release.py X.Y.Z` on a clean tree. It refuses unless the tree is clean, the version is higher than the last tag, the migration numbers in `core/migrations/` run 0001.. with no gaps, the changelog section is complete and its upgrade notes name every new migration and every new config default, and `tests/run.py all` passes. Then it writes `VERSION`, regenerates `core.manifest.json`, commits "Release vX.Y.Z" and makes an annotated tag. `--dry-run` runs the checks and writes nothing.
3. It never pushes. Push the branch and the tag yourself (`git push origin <branch> vX.Y.Z`).

## Pull requests

1. Fork, branch from `main`, keep one topic per PR.
2. Fill in the PR template: what changed, why, how you tested it, screenshots for UI changes.
3. Run `python3 tests/run.py quick` and `python3 tests/smoke.py`; both must pass.
4. Add a line under **Unreleased** in [CHANGELOG.md](CHANGELOG.md) for anything a user would notice, in the right part (Added, Changed, Fixed). A new migration or config key also goes into that section's **Upgrade notes**.
5. Make sure no personal data slipped in: no `state.json`, `config.json`, `roster.json`, `work/`, `uploads/`, logs, keys or tokens.


By contributing you agree that your contribution is licensed under the [MIT License](LICENSE), and you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
