#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"
CURL_OPTS=(--silent --show-error --fail --max-time 5)

need(){ command -v "$1" >/dev/null 2>&1 || { echo "missing $1" >&2; exit 1; }; }
need curl; need jq; need python3

echo "[init] creating mailbox…"

MB_JSON="$(curl "${CURL_OPTS[@]}" \
  -X POST "$BASE_URL/v1/mailboxes" \
  -H "Content-Type: application/json" \
  -d '{}' \
)"

MAILBOX_ID="$(echo "$MB_JSON" | jq -r '.mailbox_id')"
POLL_TOKEN="$(echo "$MB_JSON" | jq -r '.poll_token')"

if [[ -z "$MAILBOX_ID" || "$MAILBOX_ID" == "null" ]]; then
  echo "❌ invalid mailbox response:" >&2
  echo "$MB_JSON" | jq . >&2
  exit 1
fi

echo "[init] mailbox_id=$MAILBOX_ID"

DEPOSIT_TOKEN="$(python3 - <<'PY'
import os,base64
print(base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip("="))
PY
)"

echo "[init] registering deposit token…"

curl "${CURL_OPTS[@]}" \
  -X POST "$BASE_URL/v1/mailboxes/$MAILBOX_ID/deposit-tokens" \
  -H "Authorization: Bearer $POLL_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"deposit_tokens\":[\"$DEPOSIT_TOKEN\"]}" \
  | jq .

echo
echo "✅ DONE"
echo
echo "export MAILBOX_ID=\"$MAILBOX_ID\""
echo "export POLL_TOKEN=\"$POLL_TOKEN\""
echo "export DEPOSIT_TOKEN=\"$DEPOSIT_TOKEN\""
