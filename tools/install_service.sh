#!/usr/bin/env bash
# Install the dashboard as a macOS LaunchAgent: starts at login, restarts if it dies.
#   tools/install_service.sh            install / reinstall
#   tools/install_service.sh remove     uninstall
# Note: macOS may ask to allow python3 to access the Desktop folder the first time.
set -e
if [ "$(uname)" != "Darwin" ]; then
  echo "install_service.sh is for macOS (launchd). On Linux run: nohup bash tools/keepalive.sh >/dev/null 2>&1 &" >&2
  echo "or wrap tools/keepalive.sh in a systemd user unit." >&2
  exit 1
fi
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL=com.underthread.server
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PY="$(command -v python3)"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
if [[ "$1" == "remove" ]]; then rm -f "$PLIST"; echo "removed"; exit 0; fi
mkdir -p "$ROOT/logs" "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$PY</string><string>$ROOT/server.py</string></array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>$ROOT/logs/server.log</string>
  <key>StandardErrorPath</key><string>$ROOT/logs/server.log</string>
</dict></plist>
PL
launchctl bootstrap "gui/$(id -u)" "$PLIST"
sleep 2
PORT="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("port", 8765))' "$ROOT/config.json" 2>/dev/null || echo 8765)"
curl -s -o /dev/null -w "dashboard: %{http_code}\n" "http://127.0.0.1:$PORT/" || echo "not answering yet: see $ROOT/logs/server.log"
