#!/usr/bin/env node

import * as x25519 from "@stablelib/x25519";

function base64urlToUint8Array(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - base64.length % 4) % 4);
  return Uint8Array.from(Buffer.from(base64 + padding, 'base64'));
}

function uint8ArrayToBase64url(arr) {
  return Buffer.from(arr).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function spkiToRaw(spkiBase64url) {
  const spki = base64urlToUint8Array(spkiBase64url);
  console.log(`  SPKI total length: ${spki.length} bytes`);
  console.log(`  SPKI first 12 bytes (header): ${Buffer.from(spki.slice(0, 12)).toString('hex')}`);
  return spki.slice(-32);
}

// Test simple de bout en bout
console.log("🧪 Testing X25519 encryption/decryption\n");

// 1. Générer une paire de clés pour le destinataire
const recipientKeyPair = x25519.generateKeyPair();
console.log("1️⃣ Recipient keys:");
console.log(`   Private: ${uint8ArrayToBase64url(recipientKeyPair.secretKey)}`);
console.log(`   Public:  ${uint8ArrayToBase64url(recipientKeyPair.publicKey)}`);

// 2. Chiffrer un message (expéditeur)
const message = "Hello World!";
const messageBytes = new TextEncoder().encode(message);
const ephemeralKeyPair = x25519.generateKeyPair();
const sharedSecretSender = x25519.sharedKey(ephemeralKeyPair.secretKey, recipientKeyPair.publicKey);

const encrypted = new Uint8Array(messageBytes.length);
for (let i = 0; i < messageBytes.length; i++) {
  encrypted[i] = messageBytes[i] ^ sharedSecretSender[i % sharedSecretSender.length];
}

console.log("\n2️⃣ Encryption:");
console.log(`   Message: "${message}"`);
console.log(`   Ephemeral public: ${uint8ArrayToBase64url(ephemeralKeyPair.publicKey)}`);
console.log(`   Encrypted: ${uint8ArrayToBase64url(encrypted)}`);
console.log(`   Shared secret (sender): ${Buffer.from(sharedSecretSender).toString('hex').substring(0, 32)}...`);

// 3. Déchiffrer (destinataire)
const sharedSecretRecipient = x25519.sharedKey(recipientKeyPair.secretKey, ephemeralKeyPair.publicKey);
const decrypted = new Uint8Array(encrypted.length);
for (let i = 0; i < encrypted.length; i++) {
  decrypted[i] = encrypted[i] ^ sharedSecretRecipient[i % sharedSecretRecipient.length];
}

console.log("\n3️⃣ Decryption:");
console.log(`   Shared secret (recipient): ${Buffer.from(sharedSecretRecipient).toString('hex').substring(0, 32)}...`);
console.log(`   Decrypted: "${new TextDecoder().decode(decrypted)}"`);
console.log(`   ✅ Match: ${new TextDecoder().decode(decrypted) === message}`);

// 4. Test avec extraction SPKI (comme dans notre code)
console.log("\n4️⃣ Testing SPKI extraction:");

// Créer un SPKI factice (12 bytes header + 32 bytes key)
const spkiHeader = new Uint8Array([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x03, 0x21, 0x00
]);
const fullSPKI = new Uint8Array(44);
fullSPKI.set(spkiHeader, 0);
fullSPKI.set(recipientKeyPair.publicKey, 12);

const spkiBase64url = uint8ArrayToBase64url(fullSPKI);
console.log(`   SPKI format: ${spkiBase64url}`);

const extractedKey = spkiToRaw(spkiBase64url);
console.log(`   Extracted key: ${uint8ArrayToBase64url(extractedKey)}`);
console.log(`   Original key:  ${uint8ArrayToBase64url(recipientKeyPair.publicKey)}`);
console.log(`   ✅ Extraction works: ${Buffer.from(extractedKey).equals(Buffer.from(recipientKeyPair.publicKey))}`);
