#!/usr/bin/env bash
set -euo pipefail

ALIAS="${1:-}"
[[ -n "$ALIAS" ]] || { echo "Usage: create_and_onboard.sh <alias>"; exit 2; }

echo "=========================================="
echo "  Creating profile: $ALIAS"
echo "=========================================="

# 1. Générer les clés
echo "[1/4] Generating keys..."
bash ens/scripts/whisper-keygen.sh "$ALIAS"

PUBKEYS="$HOME/F3NIX-Secrets/whisper/users/$ALIAS/whisper.keys.json"

# 2. Créer le sous-domaine avec le Public Resolver
echo "[2/4] Creating ENS subdomain..."
PUBLIC_RESOLVER="0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63"

cast send --rpc-url "$RPC_URL" --private-key "$PUBLISHER_PRIVATE_KEY" \
  0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e \
  "setSubnodeRecord(bytes32,bytes32,address,address,uint64)" \
  $(cast namehash wspr.f3nixid.eth) \
  $(cast keccak "$ALIAS") \
  "0xa8ABBb681425370962CaA2a713cf1b40b3a64A3c" \
  "$PUBLIC_RESOLVER" \
  0

echo "Waiting for confirmation..."
sleep 15

# 3. Onboarder
echo "[3/4] Onboarding to ENS..."
env -u EXPECTED_RESOLVER \
SKIP_PROVISION=1 \
ens/scripts/whisper_onboard.sh "$ALIAS" "$PUBKEYS"

echo ""
echo "=========================================="
echo "  ✅ Profile created: $ALIAS.wspr.f3nixid.eth"
echo "=========================================="

# 4. Vérifier
echo "[4/4] Verifying..."
cd ens
NODE_NO_WARNINGS=1 node --loader ts-node/esm scripts/resolve_verify.ts "$ALIAS.wspr.f3nixid.eth"
