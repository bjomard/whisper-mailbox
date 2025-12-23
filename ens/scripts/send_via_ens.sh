#!/usr/bin/env bash
set -euo pipefail

command -v jq >/dev/null || { echo "ERROR: jq is required"; exit 2; }

NAME="${1:-bob.wspr.f3nixid.eth}"
PLAINTEXT="${2:-hello via ENS}"

echo "[send_via_ens] name=$NAME"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ENS_DIR"
echo "[send_via_ens] ens_dir=$ENS_DIR"

# Load env
if [[ -f ".env" ]]; then
  set -a; source .env; set +a
  echo "[send_via_ens] loaded .env"
fi

: "${RPC_URL:?RPC_URL missing (set in ens/.env)}"
: "${DEPOSIT_TOKEN:?DEPOSIT_TOKEN missing (export it in this shell)}"
echo "[send_via_ens] RPC_URL ok, DEPOSIT_TOKEN ok"

echo "[send_via_ens] resolve_verify..."
RESOLVE_JSON="$(node dist/resolve_verify.js "$NAME")"
echo "$RESOLVE_JSON" | jq

OK="$(echo "$RESOLVE_JSON" | jq -r '.ok')"
if [[ "$OK" != "true" ]]; then
  echo "ERROR: resolve_verify not ok" >&2
  exit 4
fi

URI="$(echo "$RESOLVE_JSON" | jq -r '.uri')"
echo "[send_via_ens] uri=$URI"

echo "[send_via_ens] fetch contactcard..."
CARD_JSON="$(curl -fsSL "$URI")"
echo "$CARD_JSON" | jq '.mailboxes'

# pick highest priority mailbox
MB_URL="$(echo "$CARD_JSON" | jq -r '.mailboxes | sort_by(.prio) | reverse | .[0].url')"
MB_ID="$(echo "$CARD_JSON" | jq -r  '.mailboxes | sort_by(.prio) | reverse | .[0].id')"

if [[ -z "$MB_URL" || "$MB_URL" == "null" || -z "$MB_ID" || "$MB_ID" == "null" ]]; then
  echo "ERROR: ContactCard missing mailbox url/id" >&2
  exit 5
fi

echo "[send_via_ens] mailbox=$MB_URL id=$MB_ID"

MSG_ID="$(python3 - <<'PY'
import os,base64
print(base64.urlsafe_b64encode(os.urandom(16)).decode().rstrip("="))
PY
)"
echo "[send_via_ens] msg_id=$MSG_ID"

TMP_OUT="$(mktemp)"
HTTP_CODE="$(curl -s -o "$TMP_OUT" -w "%{http_code}" \
  -X POST "$MB_URL/v1/mailboxes/$MB_ID/deposit" \
  -H "Authorization: Bearer $DEPOSIT_TOKEN" \
  -H "X-Whisper-MsgId: $MSG_ID" \
  -H "Content-Type: application/octet-stream" \
  --data-binary "$PLAINTEXT")"

BODY="$(cat "$TMP_OUT" || true)"
rm -f "$TMP_OUT"

echo "[send_via_ens] deposit http=$HTTP_CODE"
echo "$BODY" | (command -v jq >/dev/null && jq || cat)

if [[ "$HTTP_CODE" == "401" ]]; then
  echo "ERROR: 401 Unauthorized (bad/missing deposit token)" >&2
  exit 20
fi
if [[ "$HTTP_CODE" == "403" ]]; then
  echo "ERROR: 403 Forbidden (token not allowed)" >&2
  exit 21
fi
if [[ "$HTTP_CODE" != "200" && "$HTTP_CODE" != "201" && "$HTTP_CODE" != "204" ]]; then
  echo "ERROR: deposit failed (HTTP $HTTP_CODE)" >&2
  exit 22
fi

echo "[send_via_ens] OK"
