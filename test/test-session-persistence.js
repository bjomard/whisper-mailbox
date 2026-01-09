#!/usr/bin/env node

import * as x25519 from '@stablelib/x25519';
import { DoubleRatchetSession } from '../lib/double-ratchet/session.js';
import { SessionManager } from '../lib/double-ratchet/session-manager.js';
import { randomBytes } from 'crypto';
import { tmpdir } from 'os';
import path from 'path';
import fs from 'fs';

console.log('🔍 Test: Session Persistence\n');

const testDir = path.join(tmpdir(), 'session-test-' + Date.now());
const manager = new SessionManager(testDir);

const rootKey = new Uint8Array(randomBytes(32));
const aliceKP = x25519.generateKeyPair();
const bobKP = x25519.generateKeyPair();

// Create Alice session
const aliceSession1 = new DoubleRatchetSession(rootKey, aliceKP, bobKP.publicKey, true);
const bobSession1 = new DoubleRatchetSession(rootKey, bobKP, aliceKP.publicKey, false);

// Message 1: Alice → Bob
const msg1 = new TextEncoder().encode('Test 1');
const { ciphertext: ct1, mac: mac1, header: h1 } = aliceSession1.encrypt(msg1);
bobSession1.decrypt(ct1, mac1, h1);

console.log('After Message 1:');
console.log(`  Alice sending chain: ${aliceSession1.sendingChain ? 'EXISTS' : 'NULL'}`);
console.log(`  Alice receiving chain: ${aliceSession1.receivingChain ? 'EXISTS' : 'NULL'}`);
console.log(`  Bob sending chain: ${bobSession1.sendingChain ? 'EXISTS' : 'NULL'}`);
console.log(`  Bob receiving chain: ${bobSession1.receivingChain ? 'EXISTS' : 'NULL'}\n`);

// Message 2: Bob → Alice
const msg2 = new TextEncoder().encode('Test 2');
const { ciphertext: ct2, mac: mac2, header: h2 } = bobSession1.encrypt(msg2);
aliceSession1.decrypt(ct2, mac2, h2);

console.log('After Message 2:');
console.log(`  Alice sending chain: ${aliceSession1.sendingChain ? 'EXISTS' : 'NULL'}`);
console.log(`  Alice receiving chain: ${aliceSession1.receivingChain ? 'EXISTS' : 'NULL'}\n`);

// Save Alice's session
console.log('💾 Saving Alice session...');
manager.saveSession('alice', 'bob', aliceSession1);

// Load Alice's session
console.log('📂 Loading Alice session...');
const aliceSession2 = manager.loadSession('alice', 'bob');

console.log('After reload:');
console.log(`  Alice sending chain: ${aliceSession2.sendingChain ? 'EXISTS' : 'NULL'}`);
console.log(`  Alice receiving chain: ${aliceSession2.receivingChain ? 'EXISTS' : 'NULL'}`);

if (aliceSession2.sendingChain) {
  console.log(`  Sending chain msg #: ${aliceSession2.sendingChain.messageNumber}`);
}
if (aliceSession2.receivingChain) {
  console.log(`  Receiving chain msg #: ${aliceSession2.receivingChain.messageNumber}`);
}

// Try Message 3 with reloaded session
console.log('\nMessage 3 with reloaded session:');
try {
  const msg3 = new TextEncoder().encode('Test 3');
  const { ciphertext: ct3, mac: mac3, header: h3 } = aliceSession2.encrypt(msg3);
  console.log(`  ✅ Alice encrypted successfully`);
  console.log(`  Current DH PK in header: ${Buffer.from(h3.dhPublicKey).toString('hex').substring(0, 32)}...`);
  
  const decrypted = bobSession1.decrypt(ct3, mac3, h3);
  console.log(`  ✅ Bob decrypted: "${new TextDecoder().decode(decrypted)}"`);
} catch (err) {
  console.error(`  ❌ FAILED: ${err.message}`);
}

// Cleanup
fs.rmSync(testDir, { recursive: true, force: true });
