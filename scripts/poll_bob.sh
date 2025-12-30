#!/usr/bin/env bash
set -euo pipefail

# Resolve repo root (works even if script is symlinked)
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

ENS_DIST="$REPO_ROOT/ens/dist"
DECRYPT_JS="$ENS_DIST/decrypt_envelope.js"

if [[ ! -f "$DECRYPT_JS" ]]; then
  echo "❌ decrypt_envelope.js not found at $DECRYPT_JS" >&2
  echo "Have you run: (cd ens && npm run build) ?" >&2
  exit 1
fi

MB_URL="${MB_URL:-http://localhost:8080}"
MAILBOX_ID="${MAILBOX_ID:?export MAILBOX_ID=...}"
POLL_TOKEN="${POLL_TOKEN:?export POLL_TOKEN=...}"

command -v jq >/dev/null || { echo "ERROR: jq is required for this script"; exit 2; }

echo "Polling $MB_URL mailbox=$MAILBOX_ID"

FIRST="$(curl -fsSL "$MB_URL/v1/mailboxes/$MAILBOX_ID/poll" \
  -H "Authorization: Bearer $POLL_TOKEN")"

echo "$FIRST" | jq

MSG_IDS_JSON="$(echo "$FIRST" | jq -c '[.messages[].msg_id]')"
if [[ "$MSG_IDS_JSON" == "[]" ]]; then
  echo "No message."
  exit 0
fi

B64="$(echo "$FIRST" | jq -r '.messages[0].blob_b64 // ""')"

echo
echo "Decoded first message (raw bytes):"
RAW="$(printf '%s' "$B64" | python3 - <<'PY'
import sys, base64
b64 = sys.stdin.read().strip()
if not b64:
    sys.exit(0)
sys.stdout.write(base64.b64decode(b64).decode("utf-8", errors="replace"))
PY
)"
echo "$RAW"

echo
echo "If envelope detected, try E2E decrypt:"
if echo "$RAW" | jq -e '.alg=="x25519-sealedbox" and .ct_b64!=null' >/dev/null 2>&1; then
  : "${WSPR_X25519_SK_B64U:?Missing WSPR_X25519_SK_B64U (Bob secret key, base64url)}"
  echo "$RAW" | WSPR_X25519_SK_B64U="$WSPR_X25519_SK_B64U" node "$DECRYPT_JS" - \
    || echo "(decrypt failed)"
fi

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
