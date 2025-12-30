#!/usr/bin/env bash
set -euo pipefail

MB_URL="${MB_URL:-http://localhost:8080}"
MAILBOX_ID="${MAILBOX_ID:?export MAILBOX_ID=...}"
POLL_TOKEN="${POLL_TOKEN:?export POLL_TOKEN=...}"

echo "Polling $MB_URL mailbox=$MAILBOX_ID"

FIRST="$(curl -fsSL "$MB_URL/v1/mailboxes/$MAILBOX_ID/poll" \
  -H "Authorization: Bearer $POLL_TOKEN")"

echo "$FIRST" | (command -v jq >/dev/null && jq || cat)

MSG_ID="$(echo "$FIRST" | node -p '
  const r=JSON.parse(fs.readFileSync(0,"utf8"));
  const m=(r.messages||[])[0];
  if(!m) process.exit(0);
  process.stdout.write(m.msg_id);
' || true)"

if [[ -z "${MSG_ID:-}" ]]; then
  echo "No message."
  exit 0
fi

B64="$(echo "$FIRST" | node -p '
  const r=JSON.parse(fs.readFileSync(0,"utf8"));
  process.stdout.write((r.messages||[])[0].blob_b64 || "");
')"

echo
echo "Decoded message:"
printf '%s' "$B64" | python3 - <<'PY'
import sys, base64
b64 = sys.stdin.read().strip()
print(base64.b64decode(b64).decode("utf-8", errors="replace"))
PY

echo
echo "Acking msg_id=$MSG_ID ..."
ACK_HTTP="$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$MB_URL/v1/mailboxes/$MAILBOX_ID/ack" \
  -H "Authorization: Bearer $POLL_TOKEN" \
  -H "Content-Type: application/json" \
  --data "{\"msg_ids\":[\"$MSG_ID\"]}")"

echo "Ack HTTP: $ACK_HTTP"

echo
echo "Poll again:"
curl -fsSL "$MB_URL/v1/mailboxes/$MAILBOX_ID/poll" \
  -H "Authorization: Bearer $POLL_TOKEN" | (command -v jq >/dev/null && jq || cat)
