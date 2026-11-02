# 工匠 · Smith notes

- The dashboard: `server.py` (HTTP + JSON API), `stateutil.py` (state store, file-locked), `web/` (index.html, app.js, style.css, office.js, md.js).
- Test UI changes on a scratch copy: copy the folder to /tmp, then `PORT=8799 NO_LOOPS=1 python3 server.py` there. Never point a test at the live `state.json`.
- After editing web files, bump `?v=N` in `web/index.html`. After editing server.py or stateutil.py, the user restarts the server.
- `.bak` before every edit to a live file. Plan first.

## Dashboard uptime
- `python3 tools/ensure_server.py` brings the dashboard back (launchd kickstart if installed, else tools/keepalive.sh).
- Logs: `logs/server.log`. Read the last 80 lines before guessing.
- `tools/install_service.sh` installs the launchd service; only the user runs it (it changes login items).

## Confirmed rules
<!-- 你确认过的长期规则会由管家以 lesson 的形式追加在这里，每条一行，带日期。例：
- 前后对比只放一张并排图，标注 before / after。 (YYYY-MM-DD)
-->
