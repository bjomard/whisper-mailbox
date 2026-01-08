#!/usr/bin/env node

import fs from "fs";

const ALIAS = process.argv[2];
const SIGNATURE = process.argv[3];

if (!ALIAS || !SIGNATURE || !SIGNATURE.startsWith("0x")) {
  console.error("Usage: node finalize_delegation_minimal.js <alias> <signature>");
  console.error("Example: node finalize_delegation_minimal.js alice 0x2fc48456...");
  process.exit(1);
}

const unsignedFile = `ens/scripts/delegation_${ALIAS}_unsigned.json`;
if (!fs.existsSync(unsignedFile)) {
  console.error(`❌ File not found: ${unsignedFile}`);
  process.exit(1);
}

const delegation = JSON.parse(fs.readFileSync(unsignedFile, "utf8"));

// Ajouter la signature
delegation.sig = `eip191:${SIGNATURE}`;

// Sauvegarder la version signée
const signedFile = `ens/scripts/delegation_${ALIAS}_signed.json`;
fs.writeFileSync(signedFile, JSON.stringify(delegation, null, 2));

console.log(`✅ Délégation signée sauvegardée: ${signedFile}`);
console.log("\n📋 Contenu:");
console.log(JSON.stringify(delegation, null, 2));
