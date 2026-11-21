# 工匠 · Smith notes

- The dashboard: `server.py` (HTTP + JSON API), `stateutil.py` (state store, file-locked), `web/` (index.html and main.js; page scripts in web/js/, stylesheets in web/css/). Folder map: docs/layout.md.
- Test UI changes on a scratch copy: copy the folder to /tmp, then `PORT=8799 NO_LOOPS=1 python3 server.py` there. Never point a test at the live `state.json`.
- Web files need no version bump: the server gives every file a `?v=<content hash>` URL. After editing server.py, stateutil.py, api/ or core/, restart the server (the steward or the user).
- Back up before every edit. Core files (tracked by git): work on a branch, git is the backup; no `.bak` copies. Anything else (state.json, config.json, roster.json, *-handoff.md, local/, .claude/agents/): `python3 tools/bak.py save <tag> <file>...` (copies go to local/backups/bak/; a used tag is refused). Never leave `*.bak*` files in the project. Plan first.

## Dashboard uptime
- `python3 tools/ensure_server.py` brings the dashboard back (launchd kickstart if installed, else tools/keepalive.sh).
- Logs: `logs/server.log`. Read the last 80 lines before guessing.
- `tools/install_service.sh` installs the launchd service; only the user runs it (it changes login items).

## 看板踩过的坑
- 关测试服务只按 PID 或精确端口，不用 `pkill -f`（宽匹配误杀过线上看板）。
- 只有手机能复现的问题：先在设备上量（诊断开关），交付时写「待真机确认」。在 Chromium 里先关 scroll anchoring（`overflow-anchor: none`）模拟 iOS Safari，跑几十次，不是一次。
- 看板是长轮询：Playwright 等 `load` 加具体元素，不等 `networkidle`；点之前先等开屏层消失。
- 写 CSS 规则前，先在渲染后的页面里确认选择器真的命中。
- 页面每次轮询都会重画：动画用 `Date.now()` 算出负的 `animation-delay`；带原地开关的页面按行打补丁，不整页重画。
- 列表里的无限动画只给最新一项；长列表只画最近 N 条 +「加载更早」。图层太多 iPhone Safari 会崩。
- 每个按钮和 tab 都要有过渡（悬停、按下或切换），并且尊重 `prefers-reduced-motion`。
- JS 里不要在一行代码中间写 `//` 注释（吞掉过一整块导出，整页点不开）。
- 方案批准后，方案里没写的改动先问再加。
- 起 `claude -p` 子进程时 stdin 接 /dev/null，否则会挂住等输入。
- 提供视频或大文件的接口要支持 HTTP Range（206 / 416），否则 iOS 不能播放和拖进度。

## Confirmed rules
<!-- 你确认过的长期规则会由管家以 lesson 的形式追加在这里，每条一行，带日期。例：
- 前后对比只放一张并排图，标注 before / after。 (YYYY-MM-DD)
-->
