#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# whisper_onboard.sh — v1.0 (A-model, production-ready)
# ==============================================================================

need() { command -v "$1" >/dev/null 2>&1 || { echo "❌ missing command: $1" >&2; exit 127; }; }
die() { echo "❌ $*" >&2; exit 2; }

need jq
need git
need node
need curl
need npm
need cast
need shasum
need python3

# ------------------------------------------------------------------------------
# Paths
# ------------------------------------------------------------------------------
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENS_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd -- "$ENS_DIR/.." && pwd)"
CONTACTCARDS_DIR="${CONTACTCARDS_DIR:-$ROOT_DIR/contactcards}"

# ------------------------------------------------------------------------------
# Inputs
# ------------------------------------------------------------------------------
ALIAS="${1:-}"
[[ -n "$ALIAS" ]] || die "Usage: whisper_onboard.sh <alias> [whisper.keys.json]"

PUBKEYS_FILE="${2:-}"

ZONE="${ZONE:-wspr.f3nixid.eth}"
NAME="${ALIAS}.${ZONE}"

REUSE_EXISTING="${REUSE_EXISTING:-0}"
SKIP_PROVISION="${SKIP_PROVISION:-0}"

# ------------------------------------------------------------------------------
# RPC + Keys
# ------------------------------------------------------------------------------
RPC="${RPC_URL:-${ETH_RPC_URL:-}}"
[[ -n "$RPC" ]] || die "Missing RPC_URL"

ENS_REGISTRY="${ENS_REGISTRY:-0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e}"

PUBLISHER_PRIVATE_KEY="${PUBLISHER_PRIVATE_KEY:-}"
[[ -n "$PUBLISHER_PRIVATE_KEY" ]] || die "Missing PUBLISHER_PRIVATE_KEY"

ROOT_SIGNER="${ROOT_SIGNER:-}"
[[ -n "$ROOT_SIGNER" ]] || die "Missing ROOT_SIGNER"

#DELEGATION_FILE="${DELEGATION_FILE:-$ENS_DIR/scripts/delegation_signed.json}"
#export DELEGATION_FILE
#HAS_DELEGATION=0
#if [[ -f "$DELEGATION_FILE" && -s "$DELEGATION_FILE" ]]; then
#  HAS_DELEGATION=1
#else
#  echo "    note: no delegation file (missing or empty) → will omit delegation in ContactCard"
#fi

# Chercher la délégation signée du profil
DELEGATION_FILE="$ENS_DIR/scripts/delegation_${ALIAS}_signed.json"

if [[ -f "$DELEGATION_FILE" ]]; then
  echo "   Using signed delegation: $DELEGATION_FILE"
  DELEGATION_JSON=$(cat "$DELEGATION_FILE")
  
  # Calculer le hash de référence
  DELEGATION_SHA256=$(echo -n "$DELEGATION_JSON" | shasum -a 256 | awk '{print $1}')
  DELEGATION_REF="sha256:0x$DELEGATION_SHA256"
  
  HAS_DELEGATION="true"
else
  echo "   ⚠️  No signed delegation found for $ALIAS"
  DELEGATION_JSON='null'
  DELEGATION_REF='null'
  HAS_DELEGATION="false"
fi


# ------------------------------------------------------------------------------
# Read user pubkeys
# ------------------------------------------------------------------------------
if [[ -n "$PUBKEYS_FILE" ]]; then
  PUBKEYS_FILE="$(cd "$(dirname "$PUBKEYS_FILE")" && pwd)/$(basename "$PUBKEYS_FILE")"
  [[ -f "$PUBKEYS_FILE" ]] || die "pubkeys.json not found: $PUBKEYS_FILE"

  ED25519_SPKI_B64U="$(jq -r '.public.ed25519_spki_b64u // .ed25519_spki_b64u // empty' "$PUBKEYS_FILE")"
  X25519_SPKI_B64U="$(jq -r '.public.x25519_spki_b64u  // .x25519_spki_b64u  // empty' "$PUBKEYS_FILE")"
else
  ED25519_SPKI_B64U="${ED25519_SPKI_B64U:-}"
  X25519_SPKI_B64U="${X25519_SPKI_B64U:-}"
fi

[[ -n "$ED25519_SPKI_B64U" ]] || die "Missing ed25519_spki_b64u"
[[ -n "$X25519_SPKI_B64U"  ]] || die "Missing x25519_spki_b64u"

# ------------------------------------------------------------------------------
# Step 1 — ENS availability
# ------------------------------------------------------------------------------
echo "[1] Check availability: $NAME"

NODE="$(cast namehash "$NAME")"
OWNER="$(cast call --rpc-url "$RPC" "$ENS_REGISTRY" "owner(bytes32)(address)" "$NODE")"
PUB_ADDR="$(cast wallet address --private-key "$PUBLISHER_PRIVATE_KEY")"

if [[ "$OWNER" == "0x0000000000000000000000000000000000000000" ]]; then
  echo "    ok: available"
else
  if [[ "$REUSE_EXISTING" == "1" && "$(echo "$OWNER" | tr '[:upper:]' '[:lower:]')" == "$(echo "$PUB_ADDR" | tr '[:upper:]' '[:lower:]')" ]]; then
    echo "    note: already owned by publisher ($PUB_ADDR) → reuse mode"
  else
    die "ENS name already owned: owner=$OWNER"
  fi
fi

# ------------------------------------------------------------------------------
# Step 2 — Provision (optional)
# ------------------------------------------------------------------------------
if [[ "$SKIP_PROVISION" != "1" ]]; then
  echo "[2] Provision subdomain"
  ( cd "$ENS_DIR" && npm run -s provision -- "$ALIAS" )
else
  echo "[2] Provision skipped"
fi

# ------------------------------------------------------------------------------
# Step 3 — Build ContactCard
# ------------------------------------------------------------------------------
echo "[3] Build ContactCard JSON"

TMP_DIR="$(mktemp -d)"
SRC_JSON="$TMP_DIR/${ALIAS}.json"
CANON_JSON="$TMP_DIR/${ALIAS}.canon.json"
MIN_JSON="$TMP_DIR/${ALIAS}.min.json"

#ROOT_FP="eip155:1:${ROOT_SIGNER,,}"
ROOT_FP="eip155:1:$(echo "$ROOT_SIGNER" | tr '[:upper:]' '[:lower:]')"
USAGE_FP="spki:ed25519:${ED25519_SPKI_B64U}"

MAILBOX_URLS="${MAILBOX_URLS:-https://example-mailbox.f3nix.dev}"

# Lire le mailbox_id depuis mailbox.json si disponible
MAILBOX_FILE="${SECRETS_ROOT:-$HOME/F3NIX-Secrets/whisper}/users/${ALIAS}/mailbox.json"

if [[ -f "$MAILBOX_FILE" ]]; then
  MAILBOX_ID=$(jq -r .mailbox_id "$MAILBOX_FILE")
  echo "   Using mailbox ID from config: $MAILBOX_ID"
else
  MAILBOX_ID="default"
  echo "   Warning: No mailbox.json found, using ID: default"
fi

MAILBOX_URLS="${MAILBOX_URLS:-https://example-mailbox.f3nix.dev}"

MAILBOXES_JSON="$(python3 - <<PY
import os, json
urls=os.environ["MAILBOX_URLS"].split(",")
mailbox_id=os.environ.get("MAILBOX_ID", "default")
out=[]
for i,u in enumerate(urls):
    out.append({"url":u.strip(),"id":mailbox_id,"prio":100-i*10})
print(json.dumps(out))
PY
)"

export MAILBOX_ID


jq -n \
  --arg name "$NAME" \
  --arg root "$ROOT_SIGNER" \
  --arg root_fp "$ROOT_FP" \
  --arg ed "$ED25519_SPKI_B64U" \
  --arg x "$X25519_SPKI_B64U" \
  --arg usage_fp "$USAGE_FP" \
  --argjson mailboxes "$MAILBOXES_JSON" \
  --argjson delegation_obj "$DELEGATION_JSON" \
  --arg delegation_ref "$DELEGATION_REF" \
  --arg has_delegation "$HAS_DELEGATION" \
'{
  v: 1,
  type: "whisper.contact_card",
  service: "whisper",
  name: $name,
  subject: $name,
  fingerprint: $root_fp,
  profile: { scope: "whisper", min_security_tier: "C" },
  root_identity: {
    alg: "secp256k1_eip191",
    chain: "eip155:1",
    address: $root,
    fingerprint: $root_fp
  },
  usage_identity: {
    alg: "ed25519+x25519",
    pub: {
      ed25519_spki_b64u: $ed,
      x25519_spki_b64u: $x
    },
    fingerprint: $usage_fp
  },
  card: { version: 1, updated_at: (now|floor) },
  mailboxes: $mailboxes,
  delegation: (if $has_delegation == "true" then {
  ref: $delegation_ref,
  object: $delegation_obj
} else null end),
  capabilities: { multi_mailbox: false }
}' > "$SRC_JSON"

if [[ "$HAS_DELEGATION" == "1" ]]; then
  DELEG_HASH="$(node - <<'NODE'
import { ethers } from "ethers";
import fs from "fs";
const raw = fs.readFileSync(process.env.DELEGATION_FILE,"utf8").trim();
if (!raw) process.exit(0);
console.log(ethers.sha256(ethers.toUtf8Bytes(JSON.stringify(JSON.parse(raw)))));
NODE
)"
  if [[ -n "$DELEG_HASH" ]]; then
    jq --arg h "$DELEG_HASH" --slurpfile d "$DELEGATION_FILE" \
      '.delegation = { object: $d[0], ref: ("sha256:" + $h) }' \
      "$SRC_JSON" > "$SRC_JSON.tmp" && mv "$SRC_JSON.tmp" "$SRC_JSON"
  fi
fi

# ------------------------------------------------------------------------------
# Step 4 — Canonicalize + minify
# ------------------------------------------------------------------------------
echo "[4] Canonicalize + minify"
( cd "$ENS_DIR" && npm run -s canon -- "$SRC_JSON" ) > "$CANON_JSON"
jq -c . "$CANON_JSON" > "$MIN_JSON"

# ------------------------------------------------------------------------------
# Step 5 — Publish to ContactCards (commit-pinned)
# ------------------------------------------------------------------------------
echo "[5] Publish JSON"

DST_DIR="$CONTACTCARDS_DIR/wspr/$ALIAS"
mkdir -p "$DST_DIR"
cp "$MIN_JSON" "$DST_DIR/${ALIAS}.min.json"

cd "$CONTACTCARDS_DIR"
git add "wspr/$ALIAS/${ALIAS}.min.json"
git commit -m "Add ${ALIAS} contactcard" || true
git push
COMMIT="$(git rev-parse HEAD)"
RAW_URI="https://raw.githubusercontent.com/bjomard/ContactCards/$COMMIT/wspr/$ALIAS/${ALIAS}.min.json"
echo "    uri(raw,pinned)=$RAW_URI"
cd "$ROOT_DIR"  # Retour au répertoire d'origine

# ------------------------------------------------------------------------------
# Step 6 — sha256 + sign
# ------------------------------------------------------------------------------
echo "[6] Compute sha256 + sign"
SHA="0x$(curl -fsSL "$RAW_URI" | shasum -a 256 | awk '{print $1}')"

export SHA
export PUBLISHER_PRIVATE_KEY

SIG="$(cd "$ROOT_DIR" && node - <<'NODE'
import { ethers } from "ethers";
const w = new ethers.Wallet(process.env.PUBLISHER_PRIVATE_KEY);
console.log(await w.signMessage(ethers.getBytes(process.env.SHA)));
NODE
)"

echo "    uri=$RAW_URI"
echo "    sha=$SHA"
echo "    sig=$SIG"

# ------------------------------------------------------------------------------
# Step 7 — ENS publish pointer
# ------------------------------------------------------------------------------
echo "[7] ENS publish"
( cd "$ENS_DIR" && npm run -s publish -- "$NAME" "$RAW_URI" "$SHA" "$SIG" "$ROOT_SIGNER" )

# ------------------------------------------------------------------------------
# Step 8 — Verify
# ------------------------------------------------------------------------------
echo "[8] Verify resolve"
( cd "$ENS_DIR" && NODE_NO_WARNINGS=1 node --loader ts-node/esm scripts/resolve_verify.ts "$NAME" )

echo "✅ Onboarding complete for $NAME"

