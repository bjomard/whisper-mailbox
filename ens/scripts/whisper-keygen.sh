#!/usr/bin/env bash
set -euo pipefail

# base secrets root
SECRETS_ROOT="${SECRETS_ROOT:-$HOME/F3NIX-Secrets/whisper}"

ALIAS="${1:-}"
[[ -n "$ALIAS" ]] || { echo "Usage: whisper-keygen.sh <alias>"; exit 2; }

if [[ "$ALIAS" == /* || "$ALIAS" == ~* || "$ALIAS" == *"/"* ]]; then
  echo "❌ Expected an alias (e.g. 'christophe'), not a path: $ALIAS" >&2
  exit 2
fi

# IMPORTANT: ne jamais re-préfixer un chemin absolu
OUTDIR="$SECRETS_ROOT/users/$ALIAS"
OUTFILE="$OUTDIR/whisper.keys.json"

echo "🔑 Generating Whisper keys for: $ALIAS"
echo "   Output directory: $OUTDIR"

mkdir -p "$OUTDIR"

# puis appelle le JS en lui passant OUTFILE uniquement
node "$(dirname "$0")/whisper-keygen.js" "$OUTFILE"


# Check if keys were generated successfully
if [[ ! -f "$OUTFILE" ]]; then
  echo "❌ Failed to generate keys file: $OUTFILE" >&2
  exit 1
fi

echo "✅ Keys generated successfully!"
echo ""
echo "📋 Key file location:"
echo "   $OUTFILE"
echo ""

# Display public keys (for verification)
echo "🔍 Public keys:"
jq '.public // {ed25519_spki_b64u, x25519_spki_b64u}' "$OUTFILE"
echo ""

# Export PUBKEYS variable
export PUBKEYS="$OUTFILE"

echo "✅ PUBKEYS variable exported:"
echo "   export PUBKEYS=\"$OUTFILE\""
echo ""
echo "🚀 Ready to onboard! Run:"
echo "   ens/scripts/whisper_onboard.sh $ALIAS \"\$PUBKEYS\""
echo ""
echo "   Or source this in your current shell:"
echo "   source <(echo \"export PUBKEYS='$OUTFILE'\")"

#ALIAS="$1"
#[[ -n "$ALIAS" ]] || { echo "usage: whisper-keygen <alias>"; exit 1; }

#OUT="$HOME/F3NIX-Secrets/whisper/users/$ALIAS/whisper.keys.json"

#mkdir -p "$(dirname "$OUT")"
#node "$(dirname "$0")/whisper-keygen.js" "$OUT"

