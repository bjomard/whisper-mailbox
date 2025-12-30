#!/usr/bin/env bash
set -euo pipefail

MB_URL="${MB_URL:-http://localhost:8080}"
MAILBOX_ID="${MAILBOX_ID:?export MAILBOX_ID=...}"
POLL_TOKEN="${POLL_TOKEN:?export POLL_TOKEN=...}"

# Generate a base64url token (32 bytes)
DEPOSIT_TOKEN="$(python3 - <<'PY'
import os,base64
print(base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip("="))
PY
)"

echo "Registering deposit token for mailbox=$MAILBOX_ID on $MB_URL ..."

# Register token (server expects {"deposit_tokens":[...]} )
HTTP_CODE="$(curl -s -o /tmp/register_deposit_token.out -w "%{http_code}" \
  -X POST "$MB_URL/v1/mailboxes/$MAILBOX_ID/deposit-tokens" \
  -H "Authorization: Bearer $POLL_TOKEN" \
  -H "Content-Type: application/json" \
  --data "{\"deposit_tokens\":[\"$DEPOSIT_TOKEN\"]}")"

BODY="$(cat /tmp/register_deposit_token.out || true)"
rm -f /tmp/register_deposit_token.out

if [[ "$HTTP_CODE" != "200" && "$HTTP_CODE" != "201" && "$HTTP_CODE" != "204" ]]; then
  echo "ERROR: register deposit token failed (HTTP $HTTP_CODE)" >&2
  echo "$BODY" >&2
  exit 1
fi

echo "OK (HTTP $HTTP_CODE)"
if [[ -n "$BODY" ]]; then
  echo "$BODY" | (command -v jq >/dev/null && jq || cat)
fi

echo
echo "=== Give this to Alice (out-of-band) ==="
echo "export DEPOSIT_TOKEN=\"$DEPOSIT_TOKEN\""
