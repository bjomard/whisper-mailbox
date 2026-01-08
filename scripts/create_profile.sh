#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# create_profile.sh — Generate keys + Onboard to ENS
# ==============================================================================

ALIAS="${1:-}"
[[ -n "$ALIAS" ]] || { echo "Usage: create_profile.sh <alias>"; exit 2; }

# Paths
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
MAILBOX_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

echo "=========================================="
echo "  Creating Whisper profile: $ALIAS"
echo "=========================================="
echo ""

# Step 1: Generate keys
echo "[1/2] Generating keys..."
bash "$MAILBOX_ROOT/ens/scripts/whisper-keygen.sh" "$ALIAS"

# Get the PUBKEYS path
SECRETS_ROOT="${SECRETS_ROOT:-$HOME/F3NIX-Secrets/whisper}"
PUBKEYS="$SECRETS_ROOT/users/$ALIAS/whisper.keys.json"

if [[ ! -f "$PUBKEYS" ]]; then
  echo "❌ Keys file not found: $PUBKEYS" >&2
  exit 1
fi

# Step 2: Onboard to ENS
echo ""
echo "[2/2] Onboarding to ENS..."
cd "$MAILBOX_ROOT"
bash ens/scripts/whisper_onboard.sh "$ALIAS" "$PUBKEYS"

echo ""
echo "=========================================="
echo "  ✅ Profile created: $ALIAS.wspr.f3nixid.eth"
echo "=========================================="
echo ""
echo "📋 Keys stored at:"
echo "   $PUBKEYS"
echo ""
echo "🔍 Verify with:"
echo "   cd ens && NODE_NO_WARNINGS=1 node --loader ts-node/esm scripts/resolve_verify.ts $ALIAS.wspr.f3nixid.eth"
```

## **Structure finale recommandée**
```
whisper-mailbox/
├── scripts/
│   └── create_profile.sh          # Script wrapper (racine)
│
└── ens/
    └── scripts/
        ├── whisper-keygen.sh       # Génération de clés
        ├── whisper-keygen.js       # Module JS
        ├── whisper_onboard.sh      # Onboarding ENS
        └── resolve_verify.ts       # Vérification
