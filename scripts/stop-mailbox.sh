#!/usr/bin/env bash
set -euo pipefail
PIDFILE="/tmp/whisper-mailbox.pid"
if [[ ! -f "$PIDFILE" ]]; then
  echo "[stop] no pidfile"
  exit 0
fi
pid="$(cat "$PIDFILE" || true)"
if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
  echo "[stop] killing PID $pid"
  kill "$pid" || true
else
  echo "[stop] PID not running"
fi
rm -f "$PIDFILE"
