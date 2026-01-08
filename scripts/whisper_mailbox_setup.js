#!/usr/bin/env node

import fs from "fs";
import { randomBytes } from "crypto";

const MAILBOX_URL = process.env.MAILBOX_URLS || "http://localhost:8080";

function base64urlEncode(buffer) {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// Créer une mailbox pour un profil
async function createMailbox(alias) {
  console.log(`📬 Creating mailbox for ${alias}...`);
  
  // Générer un poll_token
  const pollTokenRaw = randomBytes(32);
  const pollToken = base64urlEncode(pollTokenRaw);
  
  const response = await fetch(`${MAILBOX_URL}/v1/mailboxes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ poll_token: pollToken })
  });
  
  if (!response.ok) {
    throw new Error(`Failed to create mailbox: ${response.statusText}`);
  }
  
  const data = await response.json();
  console.log(`✅ Mailbox created:`);
  console.log(`   Mailbox ID: ${data.mailbox_id}`);
  console.log(`   Poll Token: ${pollToken}`);
  console.log(`   Limits:`, data.limits);
  
  // Générer des deposit tokens (pour que d'autres puissent envoyer des messages)
  const depositTokens = [];
  for (let i = 0; i < 10; i++) {
    depositTokens.push(base64urlEncode(randomBytes(32)));
  }
  
  // Enregistrer les deposit tokens
  const regResponse = await fetch(
    `${MAILBOX_URL}/v1/mailboxes/${data.mailbox_id}/deposit-tokens`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${pollToken}`
      },
      body: JSON.stringify({ deposit_tokens: depositTokens })
    }
  );
  
  if (!regResponse.ok) {
    throw new Error(`Failed to register deposit tokens: ${regResponse.statusText}`);
  }
  
  const regData = await regResponse.json();
  console.log(`✅ Registered ${regData.added} deposit tokens`);
  
  // Sauvegarder la configuration
  const secretsDir = process.env.SECRETS_ROOT || `${process.env.HOME}/F3NIX-Secrets/whisper`;
  const mailboxConfig = {
    mailbox_id: data.mailbox_id,
    poll_token: pollToken,
    deposit_tokens: depositTokens,
    created_at: new Date().toISOString()
  };
  
  const configFile = `${secretsDir}/users/${alias}/mailbox.json`;
  fs.writeFileSync(configFile, JSON.stringify(mailboxConfig, null, 2));
  console.log(`💾 Saved to: ${configFile}`);
  
  return mailboxConfig;
}

// === MAIN ===
const command = process.argv[2];
const alias = process.argv[3];

if (command === "create" && alias) {
  await createMailbox(alias);
} else {
  console.log(`
📬 Whisper Mailbox Setup

Usage:
  node scripts/whisper_mailbox_setup.js create <alias>

Example:
  node scripts/whisper_mailbox_setup.js create alice
  `);
}
