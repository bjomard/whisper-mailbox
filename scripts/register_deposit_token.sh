#!/usr/bin/env bash
set -euo pipefail

MB_URL="${MB_URL:-http://localhost:8080}"
MAILBOX_ID="${MAILBOX_ID:?export MAILBOX_ID=...}"
POLL_TOKEN="${POLL_TOKEN:?export POLL_TOKEN=... (owner token from create mailbox)}"

command -v curl >/dev/null || { echo "ERROR: curl not found" >&2; exit 1; }
command -v python3 >/dev/null || { echo "ERROR: python3 not found" >&2; exit 1; }
command -v jq >/dev/null || { echo "ERROR: jq not found (brew install jq)" >&2; exit 1; }

echo "Registering deposit token for mailbox=$MAILBOX_ID on $MB_URL ..."

# Generate a base64url token that decodes to exactly 32 bytes (no '=' padding)
NEW_DEPOSIT_TOKEN="$(python3 - <<'PY'
import os, base64, re, sys
t = base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip("=")
# sanity: only base64url chars
if re.search(r"[^A-Za-z0-9_-]", t):
    print("BAD_TOKEN_CHARS", file=sys.stderr)
    sys.exit(2)
# sanity: decodes back to 32 bytes
pad = "=" * ((4 - (len(t) % 4)) % 4)
raw = base64.urlsafe_b64decode(t + pad)
if len(raw) != 32:
    print(f"BAD_TOKEN_LEN decoded={len(raw)}", file=sys.stderr)
    sys.exit(3)
print(t)
PY
)"

echo "Generated DEPOSIT_TOKEN (len=${#NEW_DEPOSIT_TOKEN})"

PAYLOAD="$(jq -cn --arg t "$NEW_DEPOSIT_TOKEN" '{deposit_tokens:[$t]}')"

TMP_OUT="$(mktemp)"
HTTP="$(curl -sS -o "$TMP_OUT" -w "%{http_code}" \
  -X POST "$MB_URL/v1/mailboxes/$MAILBOX_ID/deposit-tokens" \
  -H "Authorization: Bearer $POLL_TOKEN" \
  -H "Content-Type: application/json" \
  --data "$PAYLOAD")"

BODY="$(cat "$TMP_OUT" || true)"
rm -f "$TMP_OUT"

if [[ "$HTTP" != "200" && "$HTTP" != "204" ]]; then
  echo "ERROR: register deposit token failed (HTTP $HTTP)" >&2
  echo "$BODY" | (command -v jq >/dev/null && jq || cat) >&2
  exit 1
fi

export DEPOSIT_TOKEN="$NEW_DEPOSIT_TOKEN"
echo "OK. Exported DEPOSIT_TOKEN (share it out-of-band for MVP)."
echo "DEPOSIT_TOKEN=$DEPOSIT_TOKEN"

