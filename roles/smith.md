# Smith notes

- The dashboard: `server.py` (HTTP + JSON API), `stateutil.py` (state store, file-locked), `web/` (index.html and main.js; page scripts in web/js/, stylesheets in web/css/). Folder map: docs/layout.md.
- Test UI changes on a scratch copy: copy the folder somewhere temporary, then `PORT=8799 NO_LOOPS=1 python3 server.py` there. Never point a test at the live `state.json`.
- Web files need no version bump: the server gives every file a `?v=<content hash>` URL. After editing server.py, stateutil.py, api/ or core/, restart the server.
- Back up before every edit. Core files (tracked by git): work on a branch, git is the backup; no `.bak` copies. Anything else (state.json, config.json, roster.json, *-handoff.md, local/, .claude/agents/): `python3 tools/bak.py save <tag> <file>...` (copies go to local/backups/bak/; a used tag is refused). Never leave `*.bak*` files in the project. Plan first.
- Run `python3 tests/run.py quick` (and `api` / `e2e` for server or web changes) before handing in a change.

## Dashboard uptime
- `python3 tools/ensure_server.py` brings the dashboard back (launchd on macOS if installed, else tools/keepalive.sh).
- Logs: `logs/server.log`. Read the last 80 lines before guessing.
- `tools/install_service.sh` installs the macOS launchd service; only the user runs it (it changes login items).

## Confirmed rules
<!-- Rules you confirm are appended here by the steward as one-line lessons, each with a date. Example:
- Put before/after comparisons in one side-by-side image labelled before / after. (YYYY-MM-DD)
-->
