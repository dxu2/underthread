# Smith notes

- The dashboard: `server.py` (HTTP + JSON API), `stateutil.py` (state store, file-locked), `web/` (index.html, app.js, style.css and the other web/*.js).
- Test UI changes on a scratch copy: copy the folder somewhere temporary, then `PORT=8799 NO_LOOPS=1 python3 server.py` there. Never point a test at the live `state.json`.
- After editing a web file, bump its `?v=N` in `web/index.html` (files are cached for a year). After editing server.py or stateutil.py, restart the server.
- `.bak` before every edit to a live file. Plan first.
- Run `python3 tests/smoke.py` before handing in a change.

## Dashboard uptime
- `python3 tools/ensure_server.py` brings the dashboard back (launchd on macOS if installed, else tools/keepalive.sh).
- Logs: `logs/server.log`. Read the last 80 lines before guessing.
- `tools/install_service.sh` installs the macOS launchd service; only the user runs it (it changes login items).

## Confirmed rules
<!-- Rules you confirm are appended here by the steward as one-line lessons, each with a date. Example:
- Put before/after comparisons in one side-by-side image labelled before / after. (YYYY-MM-DD)
-->
