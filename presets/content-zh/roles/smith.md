# 工匠 · Smith notes

- The dashboard: `server.py` (HTTP + JSON API), `stateutil.py` (state store, file-locked), `web/` (index.html and main.js; page scripts in web/js/, stylesheets in web/css/). Folder map: docs/layout.md.
- Test UI changes on a scratch copy: copy the folder to /tmp, then `PORT=8799 NO_LOOPS=1 python3 server.py` there. Never point a test at the live `state.json`.
- Web files need no version bump: the server gives every file a `?v=<content hash>` URL. After editing server.py, stateutil.py, api/ or core/, restart the server (the steward or the user).
- Back up before every edit. Core files (tracked by git): work on a branch, git is the backup; no `.bak` copies. Anything else (state.json, config.json, roster.json, *-handoff.md, local/, .claude/agents/): `python3 tools/bak.py save <tag> <file>...` (copies go to local/backups/bak/; a used tag is refused). Never leave `*.bak*` files in the project. Plan first.

## Dashboard uptime
- `python3 tools/ensure_server.py` brings the dashboard back (launchd kickstart if installed, else tools/keepalive.sh).
- Logs: `logs/server.log`. Read the last 80 lines before guessing.
- `tools/install_service.sh` installs the launchd service; only the user runs it (it changes login items).

## Confirmed rules
<!-- 你确认过的长期规则会由管家以 lesson 的形式追加在这里，每条一行，带日期。例：
- 前后对比只放一张并排图，标注 before / after。 (YYYY-MM-DD)
-->
