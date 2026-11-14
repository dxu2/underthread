#!/bin/bash
# Scratch dashboard for verification: a fresh copy of the project on its own port, loops off, push off.
#   scratch.sh up      copy the project to $VERIFY_SCRATCH and start server.py there (PORT=8799 NO_LOOPS=1)
#   scratch.sh down    stop the server this script started (by pid file only; never by name)
#   scratch.sh wipe    down + remove the scratch copy (evidence lives under work/, not here)
#   scratch.sh path    print the scratch dir (cd there to run stateutil against scratch state)
# Env: VERIFY_PORT (default 8799), VERIFY_SCRATCH (default /tmp/rt-verify-$VERIFY_PORT)
#      VERIFY_DATA  fixtures | live | auto (default auto: live when the project has a state.json, else fixtures)
#                   fixtures = tests/e2e/fixtures (fixed sample board, no local/ layer); live = a copy of your own state
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${VERIFY_PORT:-8799}"
S="${VERIFY_SCRATCH:-/tmp/rt-verify-$PORT}"
PIDF="$S/.verify.pid"
DATA="${VERIFY_DATA:-auto}"
[ "$DATA" = auto ] && { [ -f "$ROOT/state.json" ] && DATA=live || DATA=fixtures; }
case "$DATA" in live|fixtures) ;; *) echo "refuse: VERIFY_DATA must be fixtures, live or auto" >&2; exit 2;; esac

[ "$PORT" = "8765" ] && { echo "refuse: 8765 is the live dashboard" >&2; exit 2; }
case "$S/" in "$ROOT"/*|/|/tmp/) echo "refuse: scratch dir $S is inside the project or too broad" >&2; exit 2;; esac
[ -f "$ROOT/server.py" ] || { echo "refuse: $ROOT has no server.py" >&2; exit 2; }

alive() { [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; }

case "${1:-}" in
  up)
    if alive; then echo "already up: pid $(cat "$PIDF") port $PORT dir $S"; exit 0; fi
    if lsof -ti "tcp:$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "refuse: port $PORT is held by pid $(lsof -ti "tcp:$PORT" -sTCP:LISTEN | tr '\n' ' ')- not ours; stop it by that pid or pick VERIFY_PORT" >&2; exit 2
    fi
    mkdir -p "$S"
    # 6.5 GB of voice models, logs, user files, backups and agent config stay behind.
    rsync -a --delete \
      --exclude '/tools/models/' --exclude '/tools/voice/' --exclude '/logs/' --exclude '/uploads/' --exclude '/work/' \
      --exclude '/archive/' --exclude '/rcshots/' --exclude '/.claude/' --exclude '/.live/' --exclude '*.bak*' --exclude '*.tar' \
      --exclude '/.git/' --exclude '/.demo/' --exclude 'node_modules/' --exclude '/tests/e2e/out/' --exclude '/.split-backup/' \
      --exclude '/.state.lock' --exclude '/.inbox.lock' --exclude '/state.json.tmp' --exclude '/.verify.pid' --exclude '/verify-server.log' \
      "$ROOT/" "$S/"
    rm -f "${S:?}/push_subs.json"            # no test message may reach the user's phone
    if [ "$DATA" = fixtures ]; then python3 "$ROOT/tests/e2e/fixtures/load.py" "$S" >/dev/null || exit 1; fi
    mkdir -p "$S/logs"
    ( cd "$S" || exit 1; PORT="$PORT" NO_LOOPS=1 nohup python3 server.py >"$S/verify-server.log" 2>&1 </dev/null & echo $! >"$PIDF" )   # simple command, so $! is the server itself
    for _ in $(seq 1 40); do
      if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
        curl -fsS "http://127.0.0.1:$PORT/api/state" | python3 -c 'import json,sys; s=json.load(sys.stdin); assert "meta" in s' \
          && { echo "up: pid $(cat "$PIDF") port $PORT dir $S data $DATA"; exit 0; }
      fi
      alive || { echo "server exited; last log lines:" >&2; tail -20 "$S/verify-server.log" >&2; exit 1; }
      sleep 0.5
    done
    echo "not ready after 20 s; log: $S/verify-server.log" >&2; exit 1 ;;
  down|wipe)
    if alive; then
      P="$(cat "$PIDF")"; kill "$P"
      for _ in $(seq 1 20); do kill -0 "$P" 2>/dev/null || break; sleep 0.25; done
      kill -0 "$P" 2>/dev/null && kill -9 "$P"
      echo "stopped pid $P"
    else echo "not running (no live pid in $PIDF)"; fi
    rm -f "$PIDF"
    if [ "$1" = wipe ]; then rm -rf "${S:?}"; echo "removed $S"; fi ;;
  path) echo "$S" ;;
  *) sed -n '2,10p' "$0"; exit 2 ;;
esac
