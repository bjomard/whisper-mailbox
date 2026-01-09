#!/usr/bin/env node

/**
 * Test de synchronisation du Double Ratchet
 */

import * as x25519 from '@stablelib/x25519';
import { DoubleRatchetSession } from '../lib/double-ratchet/session.js';
import { randomBytes } from 'crypto';

function hex(arr, len = 16) {
  return Array.from(arr.slice(0, len)).map(b => b.toString(16).padStart(2, '0')).join('');
}

console.log('🔍 Debug: Double Ratchet Synchronization\n');

// Setup
const rootKey = new Uint8Array(randomBytes(32));
const aliceKeyPair = x25519.generateKeyPair();
const bobKeyPair = x25519.generateKeyPair();

console.log('📋 Initial Setup');
console.log(`  Root Key: ${hex(rootKey)}...`);
console.log(`  Alice PK: ${hex(aliceKeyPair.publicKey)}...`);
console.log(`  Bob PK:   ${hex(bobKeyPair.publicKey)}...\n`);

// Alice is initiator
const aliceSession = new DoubleRatchetSession(
  rootKey,
  aliceKeyPair,
  bobKeyPair.publicKey,
  true
);

// Bob is responder
const bobSession = new DoubleRatchetSession(
  rootKey,
  bobKeyPair,
  aliceKeyPair.publicKey,
  false
);

console.log('✅ Sessions initialized\n');

// Message 1: Alice → Bob
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Message 1: Alice → Bob');
const msg1 = new TextEncoder().encode('Message 1 from Alice');
const { ciphertext: ct1, mac: mac1, header: h1 } = aliceSession.encrypt(msg1);

console.log(`  Alice state after encrypt:`);
console.log(`    Sending chain: ${aliceSession.sendingChain ? 'EXISTS' : 'NULL'}`);
console.log(`    Receiving chain: ${aliceSession.receivingChain ? 'EXISTS' : 'NULL'}`);
console.log(`    Current DH PK: ${hex(aliceSession.currentDHPublicKey)}...`);
console.log(`    Header DH PK:  ${hex(new Uint8Array(h1.dhPublicKey))}...\n`);

const decrypted1 = bobSession.decrypt(ct1, mac1, h1);
console.log(`  Bob decrypted: "${new TextDecoder().decode(decrypted1)}"`);
console.log(`  Bob state after decrypt:`);
console.log(`    Sending chain: ${bobSession.sendingChain ? 'EXISTS' : 'NULL'}`);
console.log(`    Receiving chain: ${bobSession.receivingChain ? 'EXISTS' : 'NULL'}`);
console.log(`    Remote DH PK: ${hex(bobSession.dhRatchet.remotePublicKey)}...\n`);

// Message 2: Bob → Alice
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Message 2: Bob → Alice');
const msg2 = new TextEncoder().encode('Message 2 from Bob');
const { ciphertext: ct2, mac: mac2, header: h2 } = bobSession.encrypt(msg2);

console.log(`  Bob state after encrypt:`);
console.log(`    Sending chain: ${bobSession.sendingChain ? 'EXISTS' : 'NULL'}`);
console.log(`    Receiving chain: ${bobSession.receivingChain ? 'EXISTS' : 'NULL'}`);
console.log(`    Current DH PK: ${hex(bobSession.currentDHPublicKey)}...`);
console.log(`    Header DH PK:  ${hex(new Uint8Array(h2.dhPublicKey))}...\n`);

const decrypted2 = aliceSession.decrypt(ct2, mac2, h2);
console.log(`  Alice decrypted: "${new TextDecoder().decode(decrypted2)}"`);
console.log(`  Alice state after decrypt:`);
console.log(`    Sending chain: ${aliceSession.sendingChain ? 'EXISTS' : 'NULL'}`);
console.log(`    Receiving chain: ${aliceSession.receivingChain ? 'EXISTS' : 'NULL'}`);
console.log(`    Remote DH PK: ${hex(aliceSession.dhRatchet.remotePublicKey)}...\n`);

// Message 3: Alice → Bob (PROBLEMATIC)
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Message 3: Alice → Bob (problematic)');
const msg3 = new TextEncoder().encode('Message 3 from Alice');
const { ciphertext: ct3, mac: mac3, header: h3 } = aliceSession.encrypt(msg3);

console.log(`  Alice state after encrypt:`);
console.log(`    Sending chain: ${aliceSession.sendingChain ? 'EXISTS' : 'NULL'}`);
console.log(`    Receiving chain: ${aliceSession.receivingChain ? 'EXISTS' : 'NULL'}`);
console.log(`    Current DH PK: ${hex(aliceSession.currentDHPublicKey)}...`);
console.log(`    Header DH PK:  ${hex(new Uint8Array(h3.dhPublicKey))}...\n`);

console.log(`  Bob state before decrypt:`);
console.log(`    Sending chain: ${bobSession.sendingChain ? 'EXISTS' : 'NULL'}`);
console.log(`    Receiving chain: ${bobSession.receivingChain ? 'EXISTS' : 'NULL'}`);
console.log(`    Remote DH PK: ${hex(bobSession.dhRatchet.remotePublicKey)}...`);
console.log(`    Header DH PK: ${hex(new Uint8Array(h3.dhPublicKey))}...\n`);

console.log(`  DH keys match: ${hex(bobSession.dhRatchet.remotePublicKey) === hex(new Uint8Array(h3.dhPublicKey)) ? '✅ YES' : '❌ NO'}\n`);

try {
  const decrypted3 = bobSession.decrypt(ct3, mac3, h3);
  console.log(`  ✅ Bob decrypted: "${new TextDecoder().decode(decrypted3)}"`);
} catch (err) {
  console.error(`  ❌ Bob decrypt FAILED: ${err.message}`);
  
  console.log(`\n  🔍 Diagnostic:`);
  console.log(`    Bob's stored remote DH PK: ${hex(bobSession.dhRatchet.remotePublicKey)}...`);
  console.log(`    Message header DH PK:      ${hex(new Uint8Array(h3.dhPublicKey))}...`);
  console.log(`    Alice's current DH PK:     ${hex(aliceSession.currentDHPublicKey)}...`);
}
