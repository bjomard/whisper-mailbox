#!/usr/bin/env node
import { ethers } from "ethers";
import nacl from "tweetnacl";
import { randomBytes } from "crypto";
import fs from "fs";
import { DoubleRatchetSession } from '../lib/double-ratchet/session.js';
import { SessionManager } from '../lib/double-ratchet/session-manager.js';
import { initiatorKeyAgreement } from '../lib/double-ratchet/x3dh-init.js';

const ENS_REGISTRY_ADDR = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
const RPC_URL = process.env.RPC_URL || "https://1rpc.io/eth";
const MAILBOX_URL = process.env.MAILBOX_URLS || "http://localhost:8080";
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
  const mailboxFile = `${SECRETS_ROOT}/users/${alias}/mailbox.json`;
  if (!fs.existsSync(keyFile) || !fs.existsSync(mailboxFile)) {
    throw new Error(`Keys or mailbox not found for ${alias}`);
  }
  return {
    keys: JSON.parse(fs.readFileSync(keyFile, "utf8")),
    mailbox: JSON.parse(fs.readFileSync(mailboxFile, "utf8"))
  };
}

async function sendMessage(senderAlias, recipientName, message) {
  console.log(`📤 Sending with Double Ratchet v2.0`);
  console.log(`   From: ${senderAlias}`);
  console.log(`   To: ${recipientName}`);
  console.log(`   Message: "${message}"\n`);
  
  const sender = loadKeys(senderAlias);
  const recipientCard = await resolveWhisperProfile(recipientName);
  const recipientAlias = recipientName.split('.')[0];
  const recipient = loadKeys(recipientAlias);
  const senderIdentity = `${senderAlias}.wspr.f3nixid.eth`;
  const recipientIdentity = recipientName;
  const sessionsDir = `${SECRETS_ROOT}/users/${senderAlias}/sessions`;
  const sessionManager = new SessionManager(sessionsDir);
  
  let session = sessionManager.loadSession(senderIdentity, recipientIdentity);
  let initialEphemeralPublicKey = null;
  
  if (!session) {
    console.log('🔑 Creating new session...');
    const senderX25519PrivateKey = base64urlToUint8Array(sender.keys.private.x25519_sk_b64u);
    const senderX25519Keys = {
      publicKey: spkiToRaw(sender.keys.public.x25519_spki_b64u),
      secretKey: senderX25519PrivateKey
    };
    const recipientX25519PublicKey = spkiToRaw(recipientCard.usage_identity.pub.x25519_spki_b64u);
    const { rootKey, localEphemeralKeyPair, ephemeralPublicKey } = initiatorKeyAgreement(
      senderX25519Keys,
      recipientX25519PublicKey
    );
    console.log(`   Root key OK`);
    initialEphemeralPublicKey = ephemeralPublicKey;
    session = new DoubleRatchetSession(rootKey, localEphemeralKeyPair, recipientX25519PublicKey, true);
    sessionManager.saveSession(senderIdentity, recipientIdentity, session);
    console.log('   ✅ Session created\n');
  } else {
    console.log('🔄 Existing session\n');
  }
  
  const plaintext = new TextEncoder().encode(message);
  const { ciphertext, mac, header } = session.encrypt(plaintext);
  console.log('🔐 Encrypted');
  sessionManager.saveSession(senderIdentity, recipientIdentity, session);
  
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
    console.log('🔑 Initial ephemeral key included');
  }
  
  const envelopeJSON = JSON.stringify({
    from: envelope.from,
    to: envelope.to,
    timestamp: envelope.timestamp,
    ratchet_header: envelope.ratchet.header
  });
  
  const senderEd25519SecretKey = base64urlToUint8Array(sender.keys.private.ed25519_sk_b64u);
  const signature = nacl.sign.detached(new TextEncoder().encode(envelopeJSON), senderEd25519SecretKey);
  envelope.signature = uint8ArrayToBase64url(signature);
  console.log('✍️  Signed\n');
  
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
    throw new Error(`Failed: ${response.statusText} - ${text}`);
  }
  
  const result = await response.json();
  console.log(`✅ Sent! ID: ${result.msg_id}`);
}

const senderAlias = process.argv[2];
const recipientName = process.argv[3];
const message = process.argv.slice(4).join(" ");

if (!senderAlias || !recipientName || !message) {
  console.log(`Usage: node scripts/whisper_send_v2.js <sender> <recipient> <message>`);
  process.exit(1);
}

await sendMessage(senderAlias, recipientName, message);
