#!/bin/zsh
# Run the dashboard and bring it straight back if it ever exits.
#   tools/keepalive.sh            (Ctrl-C twice to stop)
cd "$(dirname "$0")/.." || exit 1
mkdir -p logs
while true; do
  echo "[$(date '+%F %T')] starting server" | tee -a logs/server.log
  python3 server.py 2>&1 | tee -a logs/server.log
  echo "[$(date '+%F %T')] server exited ($?), restarting in 2s" | tee -a logs/server.log
  sleep 2
done
