#!/usr/bin/env node

import { ethers } from "ethers";
import * as x25519 from "@stablelib/x25519";
import nacl from "tweetnacl";
import { createHash } from "crypto";
import fs from "fs";

const ENS_REGISTRY_ADDR = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
const RPC_URL = process.env.RPC_URL || "https://1rpc.io/eth";
const MAILBOX_URL = process.env.MAILBOX_URLS || "http://localhost:8080";

function sha256(data) {
  return createHash('sha256').update(data).digest();
}

function base64urlToUint8Array(str) {
  if (!str) {
    throw new Error(`String is undefined or null`);
  }
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
  return spki.slice(-32);
}

async function resolveWhisperProfile(name) {
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
  return await response.json();
}

function loadKeys(alias) {
  const secretsDir = process.env.SECRETS_ROOT || `${process.env.HOME}/F3NIX-Secrets/whisper`;
  const keyFile = `${secretsDir}/users/${alias}/whisper.keys.json`;
  const mailboxFile = `${secretsDir}/users/${alias}/mailbox.json`;
  
  if (!fs.existsSync(keyFile) || !fs.existsSync(mailboxFile)) {
    throw new Error(`Keys or mailbox not found for ${alias}`);
  }
  
  return {
    keys: JSON.parse(fs.readFileSync(keyFile, "utf8")),
    mailbox: JSON.parse(fs.readFileSync(mailboxFile, "utf8"))
  };
}

function decryptMessage(recipientPrivateKey, ephemeralPublic, ciphertext) {
  const ephemeralPub = base64urlToUint8Array(ephemeralPublic);
  const recipientPriv = base64urlToUint8Array(recipientPrivateKey);
  
  const sharedSecret = x25519.sharedKey(recipientPriv, ephemeralPub);
  const encrypted = base64urlToUint8Array(ciphertext);
  const decrypted = new Uint8Array(encrypted.length);
  for (let i = 0; i < encrypted.length; i++) {
    decrypted[i] = encrypted[i] ^ sharedSecret[i % sharedSecret.length];
  }
  
  return new TextDecoder().decode(decrypted);
}

async function verifySignature(envelope, recipientAlias) {
  const senderCard = await resolveWhisperProfile(envelope.from);
  const senderEd25519PubKey = spkiToRaw(
    senderCard.usage_identity.pub.ed25519_spki_b64u
  );
  
  const ciphertextHash = sha256(Buffer.from(envelope.ciphertext, 'utf8'));
  const messageToVerify = JSON.stringify({
    from: envelope.from,
    to: `${recipientAlias}.wspr.f3nixid.eth`,
    ephemeral_public: envelope.ephemeral_public,
    ciphertext_hash: uint8ArrayToBase64url(ciphertextHash),
    timestamp: envelope.timestamp
  });
  
  const signatureBytes = base64urlToUint8Array(envelope.signature);
  const messageBytes = new TextEncoder().encode(messageToVerify);
  
  const isValid = nacl.sign.detached.verify(messageBytes, signatureBytes, senderEd25519PubKey);
  
  return isValid;
}

async function receiveMessages(recipientAlias) {
  console.log(`📥 Fetching messages for ${recipientAlias}...`);
  
  const recipient = loadKeys(recipientAlias);
  
  const response = await fetch(
    `${MAILBOX_URL}/v1/mailboxes/${recipient.mailbox.mailbox_id}/poll`,
    {
      headers: {
        "Authorization": `Bearer ${recipient.mailbox.poll_token}`
      }
    }
  );
  
  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.statusText}`);
  }
  
  const data = await response.json();
  console.log(`📬 Found ${data.messages.length} message(s)`);
  
  const msgIds = [];
  
  for (const msg of data.messages) {
    try {
      const blob = Buffer.from(msg.blob_b64, 'base64').toString('utf8');
      const envelope = JSON.parse(blob);
      
      if (!envelope.ephemeral_public || !envelope.ciphertext) {
        throw new Error(`Missing required fields`);
      }
      
      if (!envelope.signature) {
        console.error(`⚠️  SECURITY WARNING: Message from ${envelope.from} has NO SIGNATURE!`);
        console.error(`    Skipping for security.`);
        continue;
      }
      
      console.log(`🔐 Verifying signature from ${envelope.from}...`);
      const isValid = await verifySignature(envelope, recipientAlias);
      
      if (!isValid) {
        console.error(`⚠️  SECURITY ALERT: Invalid signature from ${envelope.from}!`);
        console.error(`    Message is likely FORGED! Skipping...`);
        continue;
      }
      
      console.log(`✅ Signature verified`);
      
      const decrypted = decryptMessage(
        recipient.keys.private.x25519_sk_b64u,
        envelope.ephemeral_public,
        envelope.ciphertext
      );
      
      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`From: ${envelope.from} ✓ verified`);
      console.log(`Time: ${new Date(envelope.timestamp).toLocaleString()}`);
      console.log(`Message: ${decrypted}`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      
      msgIds.push(msg.msg_id);
    } catch (err) {
      console.error(`❌ Failed:`, err.message);
    }
  }
  
  if (msgIds.length > 0) {
    console.log(`\n🔄 Acknowledging ${msgIds.length} verified message(s)...`);
    const ackResponse = await fetch(
      `${MAILBOX_URL}/v1/mailboxes/${recipient.mailbox.mailbox_id}/ack`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${recipient.mailbox.poll_token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ msg_ids: msgIds })
      }
    );
    
    if (ackResponse.ok) {
      const ackData = await ackResponse.json();
      console.log(`✅ Acknowledged ${ackData.deleted} message(s)`);
    }
  }
}

const recipientAlias = process.argv[2];

if (!recipientAlias) {
  console.log(`
📥 Whisper Receive Messages (with Ed25519 signature verification)

Usage:
  node scripts/whisper_receive.js <recipient_alias>

Example:
  node scripts/whisper_receive.js bob
  `);
  process.exit(1);
}

await receiveMessages(recipientAlias);
