#!/usr/bin/env bash
set -euo pipefail

need() { command -v "$1" >/dev/null 2>&1 || { echo "❌ missing command: $1" >&2; exit 127; }; }

need git
need jq
need curl
need node
need python3
need npx

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENS_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd -- "$ENS_DIR/.." && pwd)"

# Inputs
PROFILE_BASENAME="${1:-bob}"                        # bob -> profiles/bob.json
ENS_NAME="${2:-bob.wspr.f3nixid.eth}"               # ENS name to publish pointer for
URI_DEFAULT="https://bjomard.github.io/whisper-mailbox/profiles/${PROFILE_BASENAME}.canon.json"
URI="${3:-$URI_DEFAULT}"                            # can override if needed
COMMIT_MSG="${4:-"Publish ${PROFILE_BASENAME} ContactCard (canon+ENS pointer)"}"

SRC_PROFILE="$ENS_DIR/profiles/${PROFILE_BASENAME}.json"
TMP_CANON="/tmp/${PROFILE_BASENAME}.canon.json"
DOCS_PROFILES="$ROOT_DIR/docs/profiles"
DST_CANON="$DOCS_PROFILES/${PROFILE_BASENAME}.canon.json"
DST_JSON="$DOCS_PROFILES/${PROFILE_BASENAME}.json"

echo "[publish] ens_dir=$ENS_DIR"
echo "[publish] root_dir=$ROOT_DIR"
echo "[publish] src_profile=$SRC_PROFILE"
echo "[publish] ens_name=$ENS_NAME"
echo "[publish] uri=$URI"

[[ -f "$SRC_PROFILE" ]] || { echo "❌ missing $SRC_PROFILE" >&2; exit 2; }
mkdir -p "$DOCS_PROFILES"

# Load ENS env (SIGNER_PRIVATE_KEY, RPC_URL, etc.)
if [[ -f "$ENS_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ENS_DIR/.env"
  set +a
fi

: "${SIGNER_PRIVATE_KEY:?Missing SIGNER_PRIVATE_KEY (set it in ens/.env or env)}"

# 1) Canonicalize with validation (TS version)
echo "[publish] canonicalize (with validation) -> $TMP_CANON"
cd "$ENS_DIR"
npx tsx scripts/canonicalize_json.ts "$SRC_PROFILE" > "$TMP_CANON"

# 2) Copy to docs/profiles (published by GitHub Pages)
echo "[publish] copy -> $DST_CANON"
cp -f "$TMP_CANON" "$DST_CANON"
cp -f "$SRC_PROFILE" "$DST_JSON"

# 3) git commit/push (only if changes)
cd "$ROOT_DIR"

if git diff --quiet -- "$DST_CANON" "$DST_JSON" "$SRC_PROFILE"; then
  echo "[publish] git: no changes to commit (skipping commit/push)"
else
  echo "[publish] git add/commit/push"
  git add "$SRC_PROFILE" "$DST_JSON" "$DST_CANON"

  # commit can fail if nothing staged (race), so guard
  if git diff --cached --quiet; then
    echo "[publish] git: nothing staged (skip commit)"
  else
    git commit -m "$COMMIT_MSG"
    git push
  fi
fi

# 4) Wait for GitHub Pages to serve the new canon (best-effort)
echo "[publish] wait for GitHub Pages update (best-effort)"
tries=0
while :; do
  tries=$((tries+1))
  # fetch text; if empty, keep trying
  body="$(curl -fsSL "$URI" 2>/dev/null || true)"
  if [[ -n "$body" ]]; then
    # quick sanity: must be JSON and contain handle
    if echo "$body" | jq -e ".handle and .pub and .mailboxes" >/dev/null 2>&1; then
      echo "[publish] github pages: ok (attempt $tries)"
      break
    fi
  fi
  if [[ $tries -ge 20 ]]; then
    echo "⚠️  github pages not confirmed after $tries attempts, continuing anyway" >&2
    break
  fi
  sleep 3
done

# 5) Compute sha256 exactly like resolve_verify (sha256 of UTF-8 JSON text)
echo "[publish] compute sha256"
SHA256="$(curl -fsSL "$URI" | node -e 'import { ethers } from "ethers";
const chunks=[]; process.stdin.on("data",d=>chunks.push(d));
process.stdin.on("end",()=>{const t=Buffer.concat(chunks).toString("utf8");
console.log(ethers.sha256(ethers.toUtf8Bytes(t)));});')"
echo "[publish] sha256=$SHA256"

# 6) Sign sha256 bytes (EVM signMessage(getBytes(sha256)))
echo "[publish] sign sha256"
SIG="$(node -e 'import { ethers } from "ethers";
const pk=process.env.SIGNER_PRIVATE_KEY; if(!pk) throw new Error("Missing SIGNER_PRIVATE_KEY");
const sha=process.argv[1];
const w=new ethers.Wallet(pk);
console.log(await w.signMessage(ethers.getBytes(sha)));' "$SHA256")"
echo "[publish] sig=$SIG"

# 7) Publish ENS pointer: (name, uri, sha256, sig)
echo "[publish] publish ENS pointer"
cd "$ENS_DIR"

# Optional timeout to avoid hanging forever (set PUBLISH_TIMEOUT_SEC, default 0 = no timeout)
PUBLISH_TIMEOUT_SEC="${PUBLISH_TIMEOUT_SEC:-0}"
if [[ "$PUBLISH_TIMEOUT_SEC" != "0" ]]; then
  need timeout || true
  if command -v timeout >/dev/null 2>&1; then
    timeout "$PUBLISH_TIMEOUT_SEC" node dist/publish_pointer.js "$ENS_NAME" "$URI" "$SHA256" "$SIG"
  else
    node dist/publish_pointer.js "$ENS_NAME" "$URI" "$SHA256" "$SIG"
  fi
else
  node dist/publish_pointer.js "$ENS_NAME" "$URI" "$SHA256" "$SIG"
fi

# 8) Verify resolution & signature
echo "[publish] resolve_verify"
node dist/resolve_verify.js "$ENS_NAME" | jq .

echo "✅ Done."
