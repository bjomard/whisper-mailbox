#!/usr/bin/env bash
set -euo pipefail

#cd whisper-mailbox

# charge .env si présent
if [[ -f .env ]]; then
  set -a; . .env; set +a
fi

: "${SERVER_SECRET:?missing SERVER_SECRET}"
: "${DATABASE_URL:?missing DATABASE_URL}"

# kill ancien si PID file
PIDFILE="/tmp/whisper-mailbox.pid"
LOGFILE="/tmp/whisper-mailbox.log"

if [[ -f "$PIDFILE" ]]; then
  old="$(cat "$PIDFILE" || true)"
  if [[ -n "${old:-}" ]] && kill -0 "$old" 2>/dev/null; then
    echo "[run] stopping previous PID $old"
    kill "$old" || true
    sleep 0.2
  fi
  rm -f "$PIDFILE"
fi

echo "[run] starting whisper-mailbox… logs: $LOGFILE"
( cargo run >"$LOGFILE" 2>&1 ) &
echo $! > "$PIDFILE"
echo "[run] PID=$(cat "$PIDFILE")"
