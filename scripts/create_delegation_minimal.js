#!/usr/bin/env node

import { ethers } from "ethers";
import fs from "fs";
import crypto from "crypto";

const ROOT_SIGNER = process.env.ROOT_SIGNER;
const ALIAS = process.argv[2];

if (!ALIAS || !ROOT_SIGNER) {
  console.error("Usage: ROOT_SIGNER=0x... node create_delegation_minimal.js <alias>");
  process.exit(1);
}

// Lire les clés publiques du profil
const keysFile = `${process.env.HOME}/F3NIX-Secrets/whisper/users/${ALIAS}/whisper.keys.json`;
if (!fs.existsSync(keysFile)) {
  console.error(`❌ Keys not found for ${ALIAS}: ${keysFile}`);
  process.exit(1);
}

const keys = JSON.parse(fs.readFileSync(keysFile, "utf8"));

// Lire la policy standard
const policy = JSON.parse(fs.readFileSync("ens/scripts/whisper_policy_v1.json", "utf8"));

// Calculer le hash de la policy
const policyBytes = Buffer.from(JSON.stringify(policy), "utf8");
const policyHash = crypto.createHash("sha256").update(policyBytes).digest("hex");

// Dates (nbf = 2026-01-01, exp = 2027-01-01)
const nbf = Math.floor(new Date("2026-01-01T00:00:00Z").getTime() / 1000);
const exp = Math.floor(new Date("2027-01-01T00:00:00Z").getTime() / 1000);

// Construire la délégation minimale
const delegation = {
  v: 1,
  t: "del",
  iss: `eip155:1:${ROOT_SIGNER.toLowerCase()}`,
  sub: `spki:ed25519:${keys.public.ed25519_spki_b64u}`,
  scp: "whisper",
  nbf: nbf,
  exp: exp,
  h: `sha256:${policyHash}`
};

// Canonicaliser pour signature
const canonicalJSON = JSON.stringify(delegation);
const hashToSign = ethers.keccak256(ethers.toUtf8Bytes(canonicalJSON));

console.log("📜 Delegation minimale pour:", ALIAS);
console.log(JSON.stringify(delegation, null, 2));
console.log("\n🔐 Hash à signer avec Ledger:");
console.log(hashToSign);
console.log("\n📋 Commande Ledger (si disponible):");
console.log(`cast wallet sign --ledger "${hashToSign}"`);

// Sauvegarder
const outputFile = `ens/scripts/delegation_${ALIAS}_unsigned.json`;
fs.writeFileSync(outputFile, JSON.stringify(delegation, null, 2));
console.log(`\n✅ Sauvegardé: ${outputFile}`);
console.log("\n🔄 Prochaine étape:");
console.log(`node scripts/finalize_delegation_minimal.js ${ALIAS} <SIGNATURE>`);
