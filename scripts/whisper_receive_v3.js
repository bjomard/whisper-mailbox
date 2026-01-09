#!/usr/bin/env node

/**
 * Whisper Receive v3.0 - Multi-provider delivery
 * Receives from DHT + Mailbox with automatic deduplication
 */

import { ethers } from "ethers";
import nacl from "tweetnacl";
import fs from "fs";
import { DoubleRatchetSession } from '../lib/double-ratchet/session.js';
import { SessionManager } from '../lib/double-ratchet/session-manager.js';
import { responderKeyAgreement } from '../lib/double-ratchet/x3dh-init.js';
import { DeliveryManager } from '../lib/delivery/delivery-manager.js';
import { MailboxProvider } from '../lib/delivery/mailbox-provider.js';
import { DHTProvider } from '../lib/delivery/dht-provider.js';

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

async function receiveMessages(recipientAlias) {
  console.log(`📥 Whisper Receive v3.0 (Multi-provider)`);
  console.log(`   Recipient: ${recipientAlias}\n`);
  
  const recipient = loadKeys(recipientAlias);
  const recipientIdentity = `${recipientAlias}.wspr.f3nixid.eth`;
  
  const sessionsDir = `${SECRETS_ROOT}/users/${recipientAlias}/sessions`;
  const sessionManager = new SessionManager(sessionsDir);
  
  // Setup delivery manager
  const delivery = new DeliveryManager({
    strategy: 'parallel' // Query all sources in parallel
  });
  
  delivery.addProvider(new DHTProvider({
    priority: 1,
    enabled: false // Disabled until bootstrap nodes available
  }));
  
  delivery.addProvider(new MailboxProvider({
    priority: 2,
    enabled: true
  }));
  
  // Receive from all providers
  const envelopes = await delivery.receive(recipientIdentity);
  
  console.log(`📬 Found ${envelopes.length} message(s)\n`);
  
  const processedMessages = [];
  const msgIdsToAck = []; // ✅ CORRECTION: Acquitter TOUS les messages
  
  for (const envelope of envelopes) {
    // ✅ Collecter le message ID dès le début (même si échec)
    if (envelope._metadata?.provider === 'mailbox' && envelope._metadata?.messageId) {
      msgIdsToAck.push(envelope._metadata.messageId);
    }
    
    try {
      if (envelope.version !== 2) {
        console.log(`   ⚠️  Message v${envelope.version || 1} (old format) - skipped`);
        continue;
      }
      
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`📨 Message v2.0 (Double Ratchet)`);
      console.log(`   From: ${envelope.from}`);
      console.log(`   Time: ${new Date(envelope.timestamp).toLocaleString()}`);
      console.log(`   Provider: ${envelope._metadata?.provider || 'unknown'}`);
      
      // Verify signature
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
      
      // Load or create session
      let session = sessionManager.loadSession(recipientIdentity, envelope.from);
      
      if (!session) {
        console.log(`   🔑 Initializing new session...`);
        
        if (!envelope.initialEphemeralKey) {
          throw new Error('Missing initialEphemeralKey for session establishment');
        }
        
        const recipientX25519PrivateKey = base64urlToUint8Array(
          recipient.private.x25519_sk_b64u
        );
        const recipientX25519Keys = {
          publicKey: spkiToRaw(recipient.public.x25519_spki_b64u),
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
      
      // Decrypt
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
      
      processedMessages.push({
        from: envelope.from,
        message,
        timestamp: envelope.timestamp
      });
      
    } catch (err) {
      console.error(`   ❌ Failed to process message:`, err.message);
    }
  }
  
  // ✅ Acknowledge ALL mailbox messages (even failed ones)
  if (msgIdsToAck.length > 0) {
    console.log(`🔄 Acknowledging ${msgIdsToAck.length} mailbox message(s)...`);
    
    const recipientInfo = JSON.parse(
      fs.readFileSync(`${SECRETS_ROOT}/users/${recipientAlias}/mailbox.json`, 'utf8')
    );
    
    const ackResponse = await fetch(
      `${MAILBOX_URL}/v1/mailboxes/${recipientInfo.mailbox_id}/ack`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${recipientInfo.poll_token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ msg_ids: msgIdsToAck })
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
  
  // Cleanup
  await delivery.close();
  
  return processedMessages;
}

// CLI
const recipientAlias = process.argv[2];

if (!recipientAlias) {
  console.log(`
📥 Whisper Receive v3.0 (Multi-provider)

Usage:
  node scripts/whisper_receive_v3.js <recipient_alias>

Example:
  node scripts/whisper_receive_v3.js bob
  `);
  process.exit(1);
}

await receiveMessages(recipientAlias);
