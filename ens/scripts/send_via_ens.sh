#!/usr/bin/env bash
set -euo pipefail

die() { echo "❌ $*" >&2; exit 1; }
need_cmd() { command -v "$1" >/dev/null || die "Missing required command: $1"; }

b64url_check_32bytes() {
  python3 - <<'PY'
import os, re, base64, sys
t=os.environ.get("DEPOSIT_TOKEN","")
if not t:
  print("DEPOSIT_TOKEN missing", file=sys.stderr); sys.exit(2)
if re.search(r"[^A-Za-z0-9_-]", t):
  print("DEPOSIT_TOKEN contains non-base64url chars", file=sys.stderr); sys.exit(3)
pad="="*((4-len(t)%4)%4)
raw=base64.urlsafe_b64decode(t+pad)
if len(raw)!=32:
  print(f"DEPOSIT_TOKEN must decode to 32 bytes (got {len(raw)})", file=sys.stderr); sys.exit(5)
print("OK")
PY
}

b64url_check_16bytes_msgid() {
  python3 - <<'PY'
import os, re, base64, sys
t=os.environ.get("MSG_ID","")
if not t:
  print("MSG_ID missing", file=sys.stderr); sys.exit(2)
pad="="*((4-len(t)%4)%4)
raw=base64.urlsafe_b64decode(t+pad)
if len(raw)!=16:
  print(f"MSG_ID must decode to 16 bytes (got {len(raw)})", file=sys.stderr); sys.exit(5)
[[ -f "$ENCRYPT_JS" ]] || die "Missing encrypt_to_contactcard.js (run npm run build)"
RL:?missing RPC_URL}"
print("OK")
PY
}

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$ENS_DIR/dist"
ENCRYPT_JS="$DIST_DIR/encrypt_to_contactcard.js"

need_cmd jq
need_cmd curl
need_cmd node
need_cmd python3


NAME="${1:?usage: send_via_ens.sh <ens_name> <message>}"
PLAINTEXT="${2:?missing message}"
FROM_HANDLE="${FROM_HANDLE:-alice.wspr.f3nixid.eth}"

cd "$ENS_DIR"
[[ -f .env ]] && { set -a; source .env; set +a; }

: "${RPC_URL:?missing RPC_URL}"
: "${DEPOSIT_TOKEN:?missing DEPOSIT_TOKEN}"

b64url_check_32bytes >/dev/null

RESOLVE="$(node dist/resolve_verify.js "$NAME")"
echo "$RESOLVE" | jq
: "${DEPOSIT_TOKEN:?missing DEPOSIT_TOKEN}"

b64url_check_32bytes >/dev/null

RESOLVE="$(node dist/resolve_verify.js "$N0].url')"
MB_ID="$(echo "$CARD" | jq -r  '.mailboxes | sort_by(.prio) | reverse | .[0].id')"

MSG_ID="$(python3 - <<'PY'
import os,base64
print(base64.urlsafe_b64encode(os.urandom(16)).decode().rstrip("="))
PY
)"
export MSG_ID
b64url_check_16bytes_msgid >/dev/null

TMP_CARD="$(mktemp)"
TMP_ENV="$(mktemp)"
trap 'rm -f "$TMP_CARD" "$TMP_ENV"' EXIT

echo "$CARD" > "$TMP_CARD"
node "$ENCRYPT_JS" "$TMP_CARD" "$NAME" "$FROM_HANDLE" "$PLAINTEXT" > "$TMP_ENV"

HTTP="$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$MB_URL/v1/mailboxes/$MB_ID/deposit" \
  -H "Authorization: Bearer $DEPOSIT_TOKEN" \
  -H "X-Whisper-MsgId: $MSG_ID" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @"$TMP_ENV")"

[[ "$HTTP" =~ ^(200|201|204)$ ]] || die "Deposit failed HTTP $HTTP"
echo "✅ Message sent to $NAME"
