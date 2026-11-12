#!/usr/bin/env bash
# Run the dashboard and bring it straight back if it ever exits. Works with bash on macOS and Linux.
#   tools/keepalive.sh            (Ctrl-C twice to stop)
# A server that dies within 10 seconds of starting (port taken, broken config) is retried after 15 seconds
# instead of 2, so the log does not fill up.
cd "$(dirname "$0")/.." || exit 1
mkdir -p logs
while true; do
  echo "[$(date '+%F %T')] starting server" | tee -a logs/server.log
  t0=$(date +%s)
  python3 -u server.py 2>&1 | tee -a logs/server.log
  code=${PIPESTATUS[0]}
  wait_s=2
  [ $(( $(date +%s) - t0 )) -lt 10 ] && wait_s=15
  echo "[$(date '+%F %T')] server exited ($code), restarting in ${wait_s}s" | tee -a logs/server.log
  sleep "$wait_s"
done
