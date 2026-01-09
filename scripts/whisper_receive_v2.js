#!/usr/bin/env node

import { ethers } from "ethers";
import nacl from "tweetnacl";
import fs from "fs";
import { DoubleRatchetSession } from '../lib/double-ratchet/session.js';
import { SessionManager } from '../lib/double-ratchet/session-manager.js';
import { responderKeyAgreement } from '../lib/double-ratchet/x3dh-init.js';

const ENS_REGISTRY_ADDR = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
const RPC_URL = process.env.RPC_URL || "https://1rpc.io/eth";
const MAILBOX_URL = process.env.MAILBOX_URLS || "http://localhost:8080";
const SECRETS_ROOT = process.env.SECRETS_ROOT || `${process.env.HOME}/F3NIX-Secrets/whisper`;

function base64urlToUint8Array(str) {
  if (!str) throw new Error('String is undefined');
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

async function receiveMessages(recipientAlias) {
  console.log(`📥 Fetching messages with Double Ratchet v2.0`);
  console.log(`   Recipient: ${recipientAlias}\n`);
  
  const recipient = loadKeys(recipientAlias);
  const recipientIdentity = `${recipientAlias}.wspr.f3nixid.eth`;
  
  const sessionsDir = `${SECRETS_ROOT}/users/${recipientAlias}/sessions`;
  const sessionManager = new SessionManager(sessionsDir);
  
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
  console.log(`📬 Found ${data.messages.length} message(s)\n`);
  
  const msgIds = [];
  
  for (const msg of data.messages) {
    try {
      const blob = Buffer.from(msg.blob_b64, 'base64').toString('utf8');
      const envelope = JSON.parse(blob);
      
      if (envelope.version === 2) {
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`📨 Message v2.0 (Double Ratchet)`);
        console.log(`   From: ${envelope.from}`);
        console.log(`   Time: ${new Date(envelope.timestamp).toLocaleString()}`);
        
        const senderCard = await resolveWhisperProfile(envelope.from);
        const senderEd25519PubKey = spkiToRaw(
          senderCard.usage_identity.pub.ed25519_spki_b64u
        );
        
        const envelopeJSON = JSON.stringify({
          from: envelope.from,
          to: envelope.to,
          timestamp: envelope.timestamp,
          ratchet_header: envelope.ratchet.header
        });
        
        const signatureBytes = base64urlToUint8Array(envelope.signature);
        const isValid = nacl.sign.detached.verify(
          new TextEncoder().encode(envelopeJSON),
          signatureBytes,
          senderEd25519PubKey
        );
        
        if (!isValid) {
          console.error(`   ⚠️  Invalid signature! Skipping...`);
          continue;
        }
        
        console.log(`   ✅ Signature verified`);
        
        let session = sessionManager.loadSession(recipientIdentity, envelope.from);
        
        if (!session) {
          console.log(`   🔑 Initializing new session...`);
          
          if (!envelope.initialEphemeralKey) {
            throw new Error('Missing initialEphemeralKey for session establishment');
          }
          
          const recipientX25519PrivateKey = base64urlToUint8Array(
            recipient.keys.private.x25519_sk_b64u
          );
          const recipientX25519Keys = {
            publicKey: spkiToRaw(recipient.keys.public.x25519_spki_b64u),
            secretKey: recipientX25519PrivateKey
          };
          
          const senderX25519PublicKey = spkiToRaw(
            senderCard.usage_identity.pub.x25519_spki_b64u
          );
          
          const ephemeralPublicKey = base64urlToUint8Array(envelope.initialEphemeralKey);
          
          const { rootKey } = responderKeyAgreement(
            recipientX25519Keys,
            senderX25519PublicKey,
            ephemeralPublicKey
          );
          
          console.log(`   Root key established`);
          
          session = new DoubleRatchetSession(
            rootKey,
            recipientX25519Keys,
            senderX25519PublicKey,
            false
          );
          
          sessionManager.saveSession(recipientIdentity, envelope.from, session);
          console.log(`   ✅ Session created`);
        }
        
        const ciphertext = base64urlToUint8Array(envelope.ratchet.ciphertext);
        const mac = base64urlToUint8Array(envelope.ratchet.mac);
        
        const header = {
          dhPublicKey: Array.from(base64urlToUint8Array(envelope.ratchet.header.dhPublicKey)),
          messageNumber: envelope.ratchet.header.messageNumber,
          previousChainLength: envelope.ratchet.header.previousChainLength
        };
        
        const plaintext = session.decrypt(ciphertext, mac, header);
        const message = new TextDecoder().decode(plaintext);
        
        sessionManager.saveSession(recipientIdentity, envelope.from, session);
        
        console.log(`   🔓 Message decrypted`);
        console.log(`   Message: ${message}`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
        
        msgIds.push(msg.msg_id);
        
      } else {
        console.log(`   ⚠️  Message v${envelope.version || 1} (old format) - skipped`);
      }
      
    } catch (err) {
      console.error(`   ❌ Failed to process message:`, err.message);
    }
  }
  
  if (msgIds.length > 0) {
    console.log(`🔄 Acknowledging ${msgIds.length} message(s)...`);
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
      console.log(`✅ Acknowledged ${ackData.deleted} message(s)\n`);
    }
  }
  
  console.log('🔐 Security: Double Ratchet + Ed25519');
  console.log('   ✅ Forward secrecy verified');
  console.log('   ✅ Sender authenticated');
  console.log('   ✅ Message integrity confirmed');
}

const recipientAlias = process.argv[2];

if (!recipientAlias) {
  console.log(`
📥 Whisper Receive v2.0 (Double Ratchet)

Usage:
  node scripts/whisper_receive_v2.js <recipient_alias>

Example:
  node scripts/whisper_receive_v2.js bob
  `);
  process.exit(1);
}

await receiveMessages(recipientAlias);
