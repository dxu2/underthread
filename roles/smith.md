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

## Dashboard pitfalls
- Stop a test server only by PID or exact port, never `pkill -f` (a wide match has killed the live dashboard).
- A bug only a phone shows: measure on the device first (a diagnostics switch), and hand in with "waiting for a device check". In Chromium, turn off scroll anchoring (`overflow-anchor: none`) to mimic iOS Safari and run it dozens of times, not once.
- The dashboard long-polls: in Playwright wait for `load` plus an element, never `networkidle`; wait for the splash layer to leave before clicking.
- Before writing a CSS rule, check in the rendered page that the selector really matches.
- Pages re-render on every poll: give animations a negative `animation-delay` computed from `Date.now()`, and patch pages with in-place switches row by row instead of redrawing the whole page.
- An infinite animation in a list goes on the newest item only; long lists draw the last N plus "load earlier". Too many layers crash iPhone Safari.
- Every button and tab gets a transition (hover, press or switch), and honours `prefers-reduced-motion`.
- In JS, never put a `//` comment in the middle of a line of code (one swallowed the rest of an export block and broke a whole page).
- After a plan is approved, ask before adding a change the plan did not mention.
- Start `claude -p` subprocesses with stdin from /dev/null, or they hang waiting for input.
- Endpoints that serve video or large files support HTTP Range (206 / 416); iOS cannot play or seek without it.

## Confirmed rules
<!-- Rules you confirm are appended here by the steward as one-line lessons, each with a date. Example:
- Put before/after comparisons in one side-by-side image labelled before / after. (YYYY-MM-DD)
-->
