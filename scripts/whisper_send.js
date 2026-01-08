#!/usr/bin/env node

import { ethers } from "ethers";
import * as x25519 from "@stablelib/x25519";
import nacl from "tweetnacl";
import { createHash, randomBytes } from "crypto";
import fs from "fs";

const ENS_REGISTRY_ADDR = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
const RPC_URL = process.env.RPC_URL || "https://1rpc.io/eth";
const MAILBOX_URL = process.env.MAILBOX_URLS || "http://localhost:8080";

function sha256(data) {
  return createHash('sha256').update(data).digest();
}

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

function loadKeys(alias) {
  const secretsDir = process.env.SECRETS_ROOT || `${process.env.HOME}/F3NIX-Secrets/whisper`;
  const keyFile = `${secretsDir}/users/${alias}/whisper.keys.json`;
  const mailboxFile = `${secretsDir}/users/${alias}/mailbox.json`;
  
  if (!fs.existsSync(keyFile)) {
    throw new Error(`Keys not found: ${keyFile}`);
  }
  if (!fs.existsSync(mailboxFile)) {
    throw new Error(`Mailbox not found: ${mailboxFile}`);
  }
  
  return {
    keys: JSON.parse(fs.readFileSync(keyFile, "utf8")),
    mailbox: JSON.parse(fs.readFileSync(mailboxFile, "utf8"))
  };
}

function encryptMessage(recipientPublicKeySPKI, message) {
  const ephemeralKeyPair = x25519.generateKeyPair();
  const recipientPubKey = spkiToRaw(recipientPublicKeySPKI);
  
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

async function sendMessage(senderAlias, recipientName, message) {
  console.log(`📤 Sending from ${senderAlias} to ${recipientName}`);
  console.log(`   Message: "${message}"`);
  
  const sender = loadKeys(senderAlias);
  const recipientCard = await resolveWhisperProfile(recipientName);
  const recipientAlias = recipientName.split('.')[0];
  const recipient = loadKeys(recipientAlias);
  
  const encrypted = encryptMessage(
    recipientCard.usage_identity.pub.x25519_spki_b64u,
    message
  );
  
  const envelope = {
    from: `${senderAlias}.wspr.f3nixid.eth`,
    to: recipientName,
    ephemeral_public: encrypted.ephemeralPublic,
    ciphertext: encrypted.ciphertext,
    timestamp: Date.now()
  };
  
  console.log(`🔐 Message encrypted`);
  
  // Signer avec tweetnacl (Ed25519)
  const ciphertextHash = sha256(Buffer.from(envelope.ciphertext, 'utf8'));
  const messageToSign = JSON.stringify({
    from: envelope.from,
    to: envelope.to,
    ephemeral_public: envelope.ephemeral_public,
    ciphertext_hash: uint8ArrayToBase64url(ciphertextHash),
    timestamp: envelope.timestamp
  });
  
  const senderEd25519SecretKey = base64urlToUint8Array(sender.keys.private.ed25519_sk_b64u);
  const messageBytes = new TextEncoder().encode(messageToSign);
  
  const signature = nacl.sign.detached(messageBytes, senderEd25519SecretKey);
  envelope.signature = uint8ArrayToBase64url(signature);
  
  console.log(`✍️  Message signed with Ed25519`);
  
  const blob = Buffer.from(JSON.stringify(envelope), 'utf8');
  const msgId = uint8ArrayToBase64url(randomBytes(24));
  
  const depositToken = recipient.mailbox.deposit_tokens[0];
  
  const response = await fetch(
    `${MAILBOX_URL}/v1/mailboxes/${recipient.mailbox.mailbox_id}/deposit`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${depositToken}`,
        "X-Whisper-MsgId": msgId,
        "Content-Type": "application/octet-stream"
      },
      body: blob
    }
  );
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to send: ${response.statusText} - ${text}`);
  }
  
  const result = await response.json();
  console.log(`✅ Message sent!`);
  console.log(`   Msg ID: ${result.msg_id}`);
  console.log(`   Expires: ${new Date(result.expires_at * 1000).toLocaleString()}`);
}

const senderAlias = process.argv[2];
const recipientName = process.argv[3];
const message = process.argv.slice(4).join(" ");

if (!senderAlias || !recipientName || !message) {
  console.log(`
📨 Whisper Send Message (with Ed25519 signatures)

Usage:
  node scripts/whisper_send.js <sender_alias> <recipient_name> <message>

Example:
  node scripts/whisper_send.js alice bob.wspr.f3nixid.eth "Hello!"
  `);
  process.exit(1);
}

await sendMessage(senderAlias, recipientName, message);
