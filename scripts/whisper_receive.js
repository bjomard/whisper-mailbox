#!/usr/bin/env node

import * as x25519 from "@stablelib/x25519";
import fs from "fs";

const MAILBOX_URL = process.env.MAILBOX_URLS || "http://localhost:8080";

function base64urlToUint8Array(str) {
  if (!str) {
    throw new Error(`String is undefined or null`);
  }
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - base64.length % 4) % 4);
  return Uint8Array.from(Buffer.from(base64 + padding, 'base64'));
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
        throw new Error(`Missing ephemeral_public or ciphertext`);
      }
      
      // ✅ Utiliser x25519_sk_b64u au lieu de x25519_seed
      const decrypted = decryptMessage(
        recipient.keys.private.x25519_sk_b64u,
        envelope.ephemeral_public,
        envelope.ciphertext
      );
      
      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`From: ${envelope.from}`);
      console.log(`Time: ${new Date(envelope.timestamp).toLocaleString()}`);
      console.log(`Message: ${decrypted}`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      
      msgIds.push(msg.msg_id);
    } catch (err) {
      console.error(`❌ Failed to process message:`, err.message);
    }
  }
  
  if (msgIds.length > 0) {
    console.log(`\n🔄 Acknowledging ${msgIds.length} message(s)...`);
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
📥 Whisper Receive Messages

Usage:
  node scripts/whisper_receive.js <recipient_alias>

Example:
  node scripts/whisper_receive.js bob
  `);
  process.exit(1);
}

await receiveMessages(recipientAlias);
