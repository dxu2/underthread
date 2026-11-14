#!/bin/bash
# Read-only: is the scratch instance safe and worth driving? Prints one line per check; exit 1 on any FAIL.
# Env: VERIFY_PORT (default 8799), VERIFY_SCRATCH (default /tmp/rt-verify-$VERIFY_PORT)
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${VERIFY_PORT:-8799}"
S="${VERIFY_SCRATCH:-/tmp/rt-verify-$PORT}"
bad=0
ok()   { echo "ok    $*"; }
fail() { echo "FAIL  $*"; bad=1; }
warn() { echo "warn  $*"; }

[ "$PORT" != "8765" ] && ok "port $PORT is not the live 8765" || fail "port is 8765 (live dashboard): never drive it"
PID="$(cat "$S/.verify.pid" 2>/dev/null)"
if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then ok "server pid $PID alive"; else fail "no live pid in $S/.verify.pid (run scratch.sh up)"; fi
L="$(lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null | head -1)"
[ -n "$PID" ] && [ "$L" = "$PID" ] && ok "port $PORT owned by our pid" || fail "port $PORT listener is '${L:-none}', expected '$PID'"
CWD="$(lsof -a -p "${PID:-0}" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
[ "$CWD" = "$S" ] || [ "$(cd "$S" 2>/dev/null && pwd -P)" = "$CWD" ] && ok "server cwd is the scratch copy" || fail "server cwd '$CWD' is not $S"
[ ! -e "$S/push_subs.json" ] && ok "no push_subs.json in scratch" || fail "$S/push_subs.json exists: test messages would push to the user's phone"
H="$(curl -fsS -m 3 "http://127.0.0.1:$PORT/api/health" 2>/dev/null)"
if [ -n "$H" ]; then
  echo "$H" | python3 -c '
import json,sys; h=json.load(sys.stdin); s=h["server"]
print(("ok    " if not s["loops"] else "FAIL  ") + "loops=%s (NO_LOOPS must be set)" % s["loops"])
print(("ok    " if h["push"]["devices"]==0 else "FAIL  ") + "push devices=%d" % h["push"]["devices"])
print("info  rev=%s uptime=%ss" % (s["rev"], s["uptime"]))' | tee /dev/stderr | grep -q '^FAIL' && bad=1
else fail "/api/health did not answer on $PORT"; fi
A="$(grep -o 'app\.js?v=[0-9]*' "$ROOT/web/index.html" 2>/dev/null)"; B="$(grep -o 'app\.js?v=[0-9]*' "$S/web/index.html" 2>/dev/null)"
[ "$A" = "$B" ] && ok "scratch web matches project ($A)" || warn "scratch $B vs project $A: scratch is stale or carries an unlanded change (intended?)"
exit $bad
