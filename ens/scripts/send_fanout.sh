#!/usr/bin/env bash
set -euo pipefail

die() { echo "❌ $*" >&2; exit 1; }
need_cmd() { command -v "$1" >/dev/null || die "Missing required command: $1"; }

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$ENS_DIR/dist"
ENCRYPT_JS="$DIST_DIR/encrypt_to_contactcard.js"
RESOLVE_JS="$DIST_DIR/resolve_verify.js"

need_cmd jq
need_cmd curl
need_cmd node
need_cmd python3

[[ -f "$ENCRYPT_JS" ]] || die "Missing $ENCRYPT_JS (run: cd ens && npm i && npm run build)"
[[ -f "$RESOLVE_JS" ]] || die "Missing $RESOLVE_JS (run: cd ens && npm i && npm run build)"

NAME="${1:?usage: send_fanout.sh <ens_name> <message>}"
PLAINTEXT="${2:?missing message}"
FROM_HANDLE="${FROM_HANDLE:-alice.wspr.f3nixid.eth}"
FANOUT_PARALLEL="${FANOUT_PARALLEL:-4}"          # max concurrent deposits
FANOUT_MAX_MB="${FANOUT_MAX_MB:-0}"              # 0=all, else top N by prio
MB_HTTP_TIMEOUT="${MB_HTTP_TIMEOUT:-15}"         # seconds
# Validate DEPOSIT_TOKEN is base64url and decodes to 32 bytes
MB_CONNECT_TIMEOUT="${MB_CONNECT_TIMEOUT:-5}"    # seconds

# Optional expiry override: seconds from now. (Only used if set)
WHISPER_EXPIRES_IN_SEC="${WHISPER_EXPIRES_IN_SEC:-}"

cd "$ENS_DIR"
[[ -f .env ]] && { set -a; source .env; set +a; }

: "${RPC_URL:?missing RPC_URL}"
: "${DEPOSIT_TOKEN:?missing DEPOSIT_TOKEN (out-of-band for MVP)}"

python3 - <<'PY'
import os, re, base64, sys
t=os.environ.get("DEPOSIT_TOKEN","")
if not t: print("DEPOSIT_TOKEN missing", file=sys.stderr); sys.exit(2)
if re.search(r"[^A-Za-z0-9_-]", t): print("DEPOSIT_TOKEN contains non-base64url chars", file=sys.stderr); sys.exit(3)
pad="="*((4-len(t)%4)%4)
raw=base64.urlsafe_b64decode(t+pad)
if len(raw)!=32: print(f"DEPOSIT_TOKEN must decode to 32 bytes (got {len(raw)})", file=sys.stderr); sys.exit(5)
PY

echo "[send_fanout] name=$NAME"
echo "[send_fanout] from=$FROM_HANDLE"
echo "[send_fanout] parallel=$FANOUT_PARALLEL max_mb=$FANOUT_MAX_MB"
MB_LIST_JSON="$(echo "$CARD_JSON" | jq -c --argjson n "$FANOUT_MAX_MB" '

# Resolve + verify ENS pointer
RESOLVE_JSON="$(node "$RESOLVE_JS" "$NAME")"
OK="$(echo "$RESOLVE_JSON" | jq -r '.ok')"
[[ "$OK" == "true" ]] || die "resolve_verify not ok"
URI="$(echo "$RESOLVE_JSON" | jq -r '.uri')"
[[ -n "$URI" && "$URI" != "null" ]] || die "missing uri from resolve_verify"

echo "[send_fanout] contactcard uri=$URI"

# Fetch contactcard
CARD_JSON="$(curl -fsSL "$URI")"
HANDLE="$(echo "$CARD_JSON" | jq -r '.handle // empty')"
[[ -n "$HANDLE" ]] || die "ContactCard missing .handle"
MAILBOXES_COUNT="$(echo "$CARD_JSON" | jq '.mailboxes | length')"
[[ "$MAILBOXES_COUNT" != "0" ]] || die "ContactCard has no mailboxes"

# Select mailboxes by prio desc, optionally truncate
  .mailboxes
  | sort_by(.prio)
  | reverse
  | (if ($n|tonumber) > 0 then .[0:($n|tonumber)] else . end)
')"

echo "[send_fanout] mailboxes selected: $(echo "$MB_LIST_JSON" | jq 'length')"

# Build one encrypted envelope (same payload for all deposits)
# Fresh msg id (16 bytes base64url, no '=')
  url="$(echo "$mb_json" | jq -r '.url')"
TMP_CARD="$(mktemp)"
TMP_ENV="$(mktemp)"
cleanup() { rm -f "$TMP_CARD" "$TMP_ENV"; }
trap cleanup EXIT

echo "$CARD_JSON" > "$TMP_CARD"
node "$ENCRYPT_JS" "$TMP_CARD" "$NAME" "$FROM_HANDLE" "$PLAINTEXT" > "$TMP_ENV"

MSG_ID="$(python3 - <<'PY'
import os,base64
print(base64.urlsafe_b64encode(os.urandom(16)).decode().rstrip("="))
PY
)"
export MSG_ID

# Optional expires header
EXTRA_EXPIRES_HEADER=()
if [[ -n "$WHISPER_EXPIRES_IN_SEC" ]]; then
  [[ "$WHISPER_EXPIRES_IN_SEC" =~ ^[0-9]+$ ]] || die "WHISPER_EXPIRES_IN_SEC must be integer"
  EXP=$(( $(date +%s) + WHISPER_EXPIRES_IN_SEC ))
  EXTRA_EXPIRES_HEADER=(-H "X-Whisper-ExpiresAt: $EXP")
  echo "[send_fanout] expires_at=$EXP override"
fi

# Fanout worker: deposit to one mailbox and emit JSON line result
deposit_one() {
  local mb_json="$1"
  local url id prio
  id="$(echo "$mb_json" | jq -r '.id')"
  prio="$(echo "$mb_json" | jq -r '.prio')"

  # Basic sanity
  [[ -n "$url" && "$url" != "null" ]] || { echo "{\"ok\":false,\"err\":\"missing url\",\"prio\":$prio}" ; return 0; }
    -X POST "$url/v1/mailboxes/$id/deposit" \
  [[ -n "$id" && "$id" != "null" ]] || { echo "{\"ok\":false,\"err\":\"missing id\",\"prio\":$prio,\"url\":\"$url\"}" ; return 0; }

  local tmp_out http
  tmp_out="$(mktemp)"
  http="$(curl -sS -o "$tmp_out" -w "%{http_code}" \
    --connect-timeout "$MB_CONNECT_TIMEOUT" \
    --max-time "$MB_HTTP_TIMEOUT" \
    -H "Authorization: Bearer $DEPOSIT_TOKEN" \
    -H "X-Whisper-MsgId: $MSG_ID" \
    -H "Content-Type: application/octet-stream" \
    "${EXTRA_EXPIRES_HEADER[@]}" \
    --data-binary @"$TMP_ENV" || true
  )"

  local body
  body="$(cat "$tmp_out" 2>/dev/null || true)"
  rm -f "$tmp_out"

  # ok if 200/201/204
  if [[ "$http" =~ ^(200|201|204)$ ]]; then
    echo "{\"ok\":true,\"http\":$http,\"prio\":$prio,\"url\":\"$url\",\"id\":\"$id\"}"
  else
    # shrink body to avoid huge logs
    body="$(echo "$body" | head -c 300 | tr '\n' ' ' | tr '\r' ' ')"
    done
    echo "{\"ok\":false,\"http\":$http,\"prio\":$prio,\"url\":\"$url\",\"id\":\"$id\",\"body\":\"${body//\"/\\\"}\"}"
  fi
}

export -f deposit_one
export DEPOSIT_TOKEN MSG_ID TMP_ENV MB_CONNECT_TIMEOUT MB_HTTP_TIMEOUT
export WHISPER_EXPIRES_IN_SEC
# Bash can't export arrays; we only pass via env if needed (not critical)

# Run deposits in parallel
RESULTS="$(mktemp)"
rm -f "$RESULTS"; : > "$RESULTS"

# Produce one mailbox per line (compact json) and parallelize
echo "$MB_LIST_JSON" | jq -c '.[]' | {
  if command -v xargs >/dev/null; then
    # Use xargs -P for parallel fanout
    xargs -P "$FANOUT_PARALLEL" -I {} bash -lc 'deposit_one "$1"' _ {} >> "$RESULTS"
  else
    while read -r line; do
      deposit_one "$line" >> "$RESULTS"
  fi
}

# Summary
TOTAL="$(wc -l < "$RESULTS" | tr -d ' ')"
OKS="$(jq -s '[.[] | select(.ok==true)] | length' "$RESULTS")"
FAILS="$(jq -s '[.[] | select(.ok==false)] | length' "$RESULTS")"

echo
echo "[send_fanout] msg_id=$MSG_ID"
echo "[send_fanout] total=$TOTAL ok=$OKS fail=$FAILS"
echo

# Print results as JSON array (CI-friendly)
jq -s '.' "$RESULTS"
rm -f "$RESULTS"

# Exit non-zero if all failed
[[ "$OKS" -gt 0 ]] || exit 2
