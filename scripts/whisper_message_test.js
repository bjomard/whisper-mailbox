#!/usr/bin/env node

import { ethers } from "ethers";
import * as x25519 from "@stablelib/x25519";
import fs from "fs";

const ENS_REGISTRY_ADDR = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
const RPC_URL = process.env.RPC_URL || "https://1rpc.io/eth";

// [... Gardez toutes les fonctions précédentes identiques jusqu'à sendMessage ...]

function spkiToRaw(spkiBase64url) {
  const spki = base64urlToUint8Array(spkiBase64url);
  return spki.slice(-32);
}

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

async function resolveWhisperProfile(name) {
  console.log(`🔍 Resolving ${name}...`);
  
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const registry = new ethers.Contract(ENS_REGISTRY_ADDR, [
    "function resolver(bytes32) view returns (address)"
  ], provider);
  
  const node = ethers.namehash(name);
  const resolverAddr = await registry.resolver(node);
  
  if (!resolverAddr || resolverAddr === ethers.ZeroAddress) {
    throw new Error(`No resolver for ${name}`);
  }
  
  const resolver = new ethers.Contract(resolverAddr, [
    "function text(bytes32,string) view returns (string)"
  ], provider);
  
  const uri = await resolver.text(node, "f3nix.wspr.uri");
  const response = await fetch(uri);
  const contactCard = await response.json();
  
  console.log(`✅ Resolved ${name}`);
  return contactCard;
}

function loadPrivateKeys(alias) {
  const secretsDir = process.env.SECRETS_ROOT || `${process.env.HOME}/F3NIX-Secrets/whisper`;
  const keyFile = `${secretsDir}/users/${alias}/whisper.keys.json`;
  
  if (!fs.existsSync(keyFile)) {
    throw new Error(`Keys not found for ${alias}: ${keyFile}`);
  }
  
  return JSON.parse(fs.readFileSync(keyFile, "utf8"));
}

function encryptMessage(senderPrivateKeySeed, recipientPublicKeySPKI, message) {
  const ephemeralKeyPair = x25519.generateKeyPair();
  const recipientPubKey = spkiToRaw(recipientPublicKeySPKI);
  
  if (recipientPubKey.length !== 32) {
    throw new Error(`Invalid recipient public key length: ${recipientPubKey.length}`);
  }
  
  const sharedSecret = x25519.sharedKey(ephemeralKeyPair.secretKey, recipientPubKey);
  const messageBytes = new TextEncoder().encode(message);
  const encrypted = new Uint8Array(messageBytes.length);
  for (let i = 0; i < messageBytes.length; i++) {
    encrypted[i] = messageBytes[i] ^ sharedSecret[i % sharedSecret.length];
  }
  
  return {
    ephemeralPublic: uint8ArrayToBase64url(ephemeralKeyPair.publicKey),
    ciphertext: uint8ArrayToBase64url(encrypted)
  };
}

function decryptMessage(recipientPrivateKeySeed, ephemeralPublic, ciphertext) {
  const ephemeralPub = base64urlToUint8Array(ephemeralPublic);
  const recipientPriv = base64urlToUint8Array(recipientPrivateKeySeed);
  
  if (recipientPriv.length !== 32 || ephemeralPub.length !== 32) {
    throw new Error(`Invalid key length`);
  }
  
  const sharedSecret = x25519.sharedKey(recipientPriv, ephemeralPub);
  const encrypted = base64urlToUint8Array(ciphertext);
  const decrypted = new Uint8Array(encrypted.length);
  for (let i = 0; i < encrypted.length; i++) {
    decrypted[i] = encrypted[i] ^ sharedSecret[i % sharedSecret.length];
  }
  
  return new TextDecoder().decode(decrypted);
}

// MODIFIÉ: Essayer différents endpoints
async function sendMessage(mailboxUrl, recipient, encryptedMsg, sender) {
  const endpoints = [
    '/api/messages',
    '/messages',
    '/v1/messages',
    '/deposit'
  ];
  
  for (const endpoint of endpoints) {
    const url = `${mailboxUrl}${endpoint}`;
    console.log(`   Trying: ${url}`);
    
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient,
          sender,
          ephemeral_public: encryptedMsg.ephemeralPublic,
          ciphertext: encryptedMsg.ciphertext,
          timestamp: Date.now()
        })
      });
      
      if (response.ok) {
        console.log(`   ✅ Success with ${endpoint}`);
        return await response.json();
      }
    } catch (err) {
      console.log(`   ❌ Failed: ${err.message}`);
    }
  }
  
  throw new Error(`No working endpoint found. Please check your mailbox server.`);
}

// MODIFIÉ: Essayer différents endpoints
async function fetchMessages(mailboxUrl, recipient) {
  const endpoints = [
    `/api/messages/${recipient}`,
    `/messages/${recipient}`,
    `/v1/messages/${recipient}`,
    `/retrieve/${recipient}`
  ];
  
  for (const endpoint of endpoints) {
    const url = `${mailboxUrl}${endpoint}`;
    console.log(`   Trying: ${url}`);
    
    try {
      const response = await fetch(url);
      
      if (response.ok) {
        console.log(`   ✅ Success with ${endpoint}`);
        return await response.json();
      }
    } catch (err) {
      console.log(`   ❌ Failed: ${err.message}`);
    }
  }
  
  throw new Error(`No working endpoint found. Please check your mailbox server.`);
}

// === MAIN ===
const command = process.argv[2];

if (command === "send") {
  const senderAlias = process.argv[3];
  const recipientName = process.argv[4];
  const message = process.argv.slice(5).join(" ");
  
  if (!senderAlias || !recipientName || !message) {
    console.error("Usage: send <sender_alias> <recipient_name> <message>");
    process.exit(1);
  }
  
  console.log(`📤 Sending from ${senderAlias} to ${recipientName}`);
  console.log(`   Message: "${message}"`);
  
  const senderKeys = loadPrivateKeys(senderAlias);
  const recipientCard = await resolveWhisperProfile(recipientName);
  
  const encrypted = encryptMessage(
    senderKeys.private.x25519_seed,
    recipientCard.usage_identity.pub.x25519_spki_b64u,
    message
  );
  
  console.log(`🔐 Message encrypted`);
  
  const mailboxUrl = process.env.MAILBOX_URLS || "http://localhost:3000";
  const result = await sendMessage(
    mailboxUrl,
    recipientName,
    encrypted,
    `${senderAlias}.wspr.f3nixid.eth`
  );
  
  console.log(`✅ Message sent!`, result);
  
} else if (command === "receive") {
  const recipientAlias = process.argv[3];
  
  if (!recipientAlias) {
    console.error("Usage: receive <recipient_alias>");
    process.exit(1);
  }
  
  console.log(`📥 Fetching messages for ${recipientAlias}...`);
  
  const recipientKeys = loadPrivateKeys(recipientAlias);
  const mailboxUrl = process.env.MAILBOX_URLS || "http://localhost:3000";
  const messages = await fetchMessages(mailboxUrl, `${recipientAlias}.wspr.f3nixid.eth`);
  
  console.log(`📬 Found ${messages.length} message(s)`);
  
  for (const msg of messages) {
    try {
      const decrypted = decryptMessage(
        recipientKeys.private.x25519_seed,
        msg.ephemeral_public,
        msg.ciphertext
      );
      
      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`From: ${msg.sender}`);
      console.log(`Time: ${new Date(msg.timestamp).toLocaleString()}`);
      console.log(`Message: ${decrypted}`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    } catch (err) {
      console.error(`❌ Failed to decrypt:`, err.message);
    }
  }
  
} else {
  console.log(`
📨 Whisper Message Test

Usage:
  node scripts/whisper_message_test.js send <sender> <recipient> <message>
  node scripts/whisper_message_test.js receive <recipient>

Examples:
  node scripts/whisper_message_test.js send alice bob.wspr.f3nixid.eth "Hi!"
  node scripts/whisper_message_test.js receive bob
  `);
}
