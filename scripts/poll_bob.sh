#!/usr/bin/env bash
set -euo pipefail

MB_URL="${MB_URL:-http://localhost:8080}"
MAILBOX_ID="${MAILBOX_ID:?export MAILBOX_ID=...}"
POLL_TOKEN="${POLL_TOKEN:?export POLL_TOKEN=...}"

command -v jq >/dev/null || { echo "ERROR: jq is required for this script"; exit 2; }

echo "Polling $MB_URL mailbox=$MAILBOX_ID"

FIRST="$(curl -fsSL "$MB_URL/v1/mailboxes/$MAILBOX_ID/poll" \
  -H "Authorization: Bearer $POLL_TOKEN")"

echo "$FIRST" | jq

# msg_ids as JSON array string
MSG_IDS_JSON="$(echo "$FIRST" | jq -c '[.messages[].msg_id]')"

if [[ "$MSG_IDS_JSON" == "[]" ]]; then
  echo "No message."
  exit 0
fi

# decode first message
B64="$(echo "$FIRST" | jq -r '.messages[0].blob_b64 // ""')"

echo
echo "Decoded first message:"
python3 - <<PY
import base64
b64 = """$B64""".strip()
if not b64:
    print("(empty)")
else:
    print(base64.b64decode(b64).decode("utf-8", errors="replace"))
PY

# Ack all msg_ids
echo
echo "Acking msg_ids=$MSG_IDS_JSON"

ACK_PAYLOAD="$(jq -cn --argjson ids "$MSG_IDS_JSON" '{msg_ids:$ids}')"

TMP_OUT="$(mktemp)"
ACK_HTTP="$(curl -s -o "$TMP_OUT" -w "%{http_code}" \
  -X POST "$MB_URL/v1/mailboxes/$MAILBOX_ID/ack" \
  -H "Authorization: Bearer $POLL_TOKEN" \
  -H "Content-Type: application/json" \
  --data "$ACK_PAYLOAD")"

echo "Ack HTTP: $ACK_HTTP"
if [[ "$ACK_HTTP" != "200" && "$ACK_HTTP" != "204" ]]; then
  echo "Ack body:"
  cat "$TMP_OUT" || true
fi
rm -f "$TMP_OUT"

echo
echo "Poll again:"
curl -fsSL "$MB_URL/v1/mailboxes/$MAILBOX_ID/poll" \
  -H "Authorization: Bearer $POLL_TOKEN" | jq
