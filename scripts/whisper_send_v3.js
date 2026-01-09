#!/usr/bin/env node

/**
 * Whisper Send v3.0 - Multi-provider delivery
 * Supports DHT + Mailbox with automatic fallback
 */

import { ethers } from "ethers";
import nacl from "tweetnacl";
import { randomBytes } from "crypto";
import fs from "fs";
import { DoubleRatchetSession } from '../lib/double-ratchet/session.js';
import { SessionManager } from '../lib/double-ratchet/session-manager.js';
import { initiatorKeyAgreement } from '../lib/double-ratchet/x3dh-init.js';
import { DeliveryManager } from '../lib/delivery/delivery-manager.js';
import { MailboxProvider } from '../lib/delivery/mailbox-provider.js';
import { DHTProvider } from '../lib/delivery/dht-provider.js';

const ENS_REGISTRY_ADDR = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
const RPC_URL = process.env.RPC_URL || "https://1rpc.io/eth";
const SECRETS_ROOT = process.env.SECRETS_ROOT || `${process.env.HOME}/F3NIX-Secrets/whisper`;

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
  const keyFile = `${SECRETS_ROOT}/users/${alias}/whisper.keys.json`;
  if (!fs.existsSync(keyFile)) {
    throw new Error(`Keys not found for ${alias}`);
  }
  return JSON.parse(fs.readFileSync(keyFile, "utf8"));
}

async function sendMessage(senderAlias, recipientName, message, options = {}) {
  console.log(`📤 Whisper Send v3.0 (Multi-provider)`);
  console.log(`   From: ${senderAlias}`);
  console.log(`   To: ${recipientName}`);
  console.log(`   Strategy: ${options.strategy || 'cascade'}`);
  console.log(`   Message: "${message}"\n`);
  
  // Load keys
  const sender = loadKeys(senderAlias);
  const recipientCard = await resolveWhisperProfile(recipientName);
  const senderIdentity = `${senderAlias}.wspr.f3nixid.eth`;
  const recipientIdentity = recipientName;
  
  // Session management
  const sessionsDir = `${SECRETS_ROOT}/users/${senderAlias}/sessions`;
  const sessionManager = new SessionManager(sessionsDir);
  
  let session = sessionManager.loadSession(senderIdentity, recipientIdentity);
  let initialEphemeralPublicKey = null;
  
  if (!session) {
    console.log('🔑 Creating new session...');
    const senderX25519PrivateKey = base64urlToUint8Array(sender.private.x25519_sk_b64u);
    const senderX25519Keys = {
      publicKey: spkiToRaw(sender.public.x25519_spki_b64u),
      secretKey: senderX25519PrivateKey
    };
    const recipientX25519PublicKey = spkiToRaw(recipientCard.usage_identity.pub.x25519_spki_b64u);
    const { rootKey, ephemeralPublicKey } = initiatorKeyAgreement(
      senderX25519Keys,
      recipientX25519PublicKey
    );
    initialEphemeralPublicKey = ephemeralPublicKey;
    session = new DoubleRatchetSession(
      rootKey,
      senderX25519Keys,
      recipientX25519PublicKey,
      true
    );
    sessionManager.saveSession(senderIdentity, recipientIdentity, session);
    console.log('   ✅ Session created\n');
  }
  
  // Encrypt
  const plaintext = new TextEncoder().encode(message);
  const { ciphertext, mac, header } = session.encrypt(plaintext);
  sessionManager.saveSession(senderIdentity, recipientIdentity, session);
  
  // Build envelope
  const envelope = {
    version: 2,
    from: senderIdentity,
    to: recipientIdentity,
    timestamp: Date.now(),
    ratchet: {
      ciphertext: uint8ArrayToBase64url(ciphertext),
      mac: uint8ArrayToBase64url(mac),
      header: {
        dhPublicKey: uint8ArrayToBase64url(new Uint8Array(header.dhPublicKey)),
        messageNumber: header.messageNumber,
        previousChainLength: header.previousChainLength
      }
    }
  };
  
  if (initialEphemeralPublicKey) {
    envelope.initialEphemeralKey = uint8ArrayToBase64url(initialEphemeralPublicKey);
  }
  
  // Sign
  const envelopeJSON = JSON.stringify({
    from: envelope.from,
    to: envelope.to,
    timestamp: envelope.timestamp,
    ratchet_header: envelope.ratchet.header
  });
  
  const senderEd25519SecretKey = base64urlToUint8Array(sender.private.ed25519_sk_b64u);
  const signature = nacl.sign.detached(new TextEncoder().encode(envelopeJSON), senderEd25519SecretKey);
  envelope.signature = uint8ArrayToBase64url(signature);
  
  // Setup delivery manager
  const delivery = new DeliveryManager({
    strategy: options.strategy || 'cascade'
  });
  
  // Add providers
  delivery.addProvider(new DHTProvider({
    priority: 1,
    enabled: false // Not implemented yet
  }));
  
  delivery.addProvider(new MailboxProvider({
    priority: 2,
    enabled: true
  }));
  
  // Send via delivery manager
  const results = await delivery.send(recipientIdentity, envelope, options);
  
  // Cleanup
  await delivery.close();
  
  console.log('\n📊 Delivery Summary:');
  for (const result of results) {
    if (result.success) {
      console.log(`   ✅ ${result.provider}: ${result.messageId} (${result.latency}ms)`);
    } else {
      console.log(`   ❌ ${result.provider}: ${result.error}`);
    }
  }
  
  return results;
}

// CLI
const senderAlias = process.argv[2];
const recipientName = process.argv[3];
const message = process.argv.slice(4).join(" ");

if (!senderAlias || !recipientName || !message) {
  console.log(`
📤 Whisper Send v3.0 (Multi-provider)

Usage:
  node scripts/whisper_send_v3.js <sender> <recipient> <message> [options]

Examples:
  node scripts/whisper_send_v3.js alice bob.wspr.f3nixid.eth "Hello!"
  
Options (TODO):
  --strategy=cascade|parallel|redundant
  --guaranteed (use premium mailbox)
  `);
  process.exit(1);
}

await sendMessage(senderAlias, recipientName, message);
