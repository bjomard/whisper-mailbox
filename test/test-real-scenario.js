#!/usr/bin/env node

/**
 * Reproduire le scénario exact de send_v2/receive_v2
 */

import * as x25519 from '@stablelib/x25519';
import { DoubleRatchetSession } from '../lib/double-ratchet/session.js';
import { SessionManager } from '../lib/double-ratchet/session-manager.js';
import { initiatorKeyAgreement, responderKeyAgreement } from '../lib/double-ratchet/x3dh-init.js';
import { randomBytes } from 'crypto';
import { tmpdir } from 'os';
import path from 'path';
import fs from 'fs';

const testDir = path.join(tmpdir(), 'real-test-' + Date.now());
const aliceManager = new SessionManager(path.join(testDir, 'alice'));
const bobManager = new SessionManager(path.join(testDir, 'bob'));

const aliceIdentity = x25519.generateKeyPair();
const bobIdentity = x25519.generateKeyPair();

console.log('🔍 Real Scenario Test\n');

// Message 1: Alice (initiator) → Bob
console.log('━━━ Message 1: Alice → Bob ━━━');

// Alice sends
const { rootKey: aliceRootKey, localEphemeralKeyPair, ephemeralPublicKey } = initiatorKeyAgreement(
  aliceIdentity,
  bobIdentity.publicKey
);

let aliceSession = new DoubleRatchetSession(
  aliceRootKey,
  localEphemeralKeyPair,
  bobIdentity.publicKey,
  true
);

const msg1 = new TextEncoder().encode('Message 1');
const { ciphertext: ct1, mac: mac1, header: h1 } = aliceSession.encrypt(msg1);
aliceManager.saveSession('alice', 'bob', aliceSession);
console.log('Alice sent and saved');

// Bob receives
const { rootKey: bobRootKey } = responderKeyAgreement(
  bobIdentity,
  aliceIdentity.publicKey,
  ephemeralPublicKey
);

let bobSession = new DoubleRatchetSession(
  bobRootKey,
  bobIdentity,
  aliceIdentity.publicKey,
  false
);

bobSession.decrypt(ct1, mac1, h1);
bobManager.saveSession('bob', 'alice', bobSession);
console.log('Bob received and saved\n');

// Message 2: Bob → Alice
console.log('━━━ Message 2: Bob → Alice ━━━');

// Bob reloads and sends
bobSession = bobManager.loadSession('bob', 'alice');
const msg2 = new TextEncoder().encode('Message 2');
const { ciphertext: ct2, mac: mac2, header: h2 } = bobSession.encrypt(msg2);
bobManager.saveSession('bob', 'alice', bobSession);
console.log('Bob reloaded, sent and saved');

// Alice reloads and receives
aliceSession = aliceManager.loadSession('alice', 'bob');
aliceSession.decrypt(ct2, mac2, h2);
aliceManager.saveSession('alice', 'bob', aliceSession);
console.log('Alice reloaded, received and saved\n');

// Message 3: Alice → Bob (PROBLEMATIC)
console.log('━━━ Message 3: Alice → Bob (problematic) ━━━');

// Alice reloads and sends
aliceSession = aliceManager.loadSession('alice', 'bob');

console.log('Alice state before encrypt:');
console.log(`  Sending chain: ${aliceSession.sendingChain ? 'EXISTS' : 'NULL'}`);
console.log(`  Receiving chain: ${aliceSession.receivingChain ? 'EXISTS' : 'NULL'}`);
console.log(`  Current DH PK: ${aliceSession.currentDHPublicKey ? Buffer.from(aliceSession.currentDHPublicKey).toString('hex').substring(0, 32) : 'NULL'}...`);

const msg3 = new TextEncoder().encode('Message 3');
const { ciphertext: ct3, mac: mac3, header: h3 } = aliceSession.encrypt(msg3);

console.log('Alice state after encrypt:');
console.log(`  Current DH PK: ${Buffer.from(aliceSession.currentDHPublicKey).toString('hex').substring(0, 32)}...`);
console.log(`  Header DH PK:  ${Buffer.from(h3.dhPublicKey).toString('hex').substring(0, 32)}...`);

aliceManager.saveSession('alice', 'bob', aliceSession);
console.log('Alice sent and saved');

// Bob reloads and receives
bobSession = bobManager.loadSession('bob', 'alice');

console.log('\nBob state before decrypt:');
console.log(`  Sending chain: ${bobSession.sendingChain ? 'EXISTS' : 'NULL'}`);
console.log(`  Receiving chain: ${bobSession.receivingChain ? 'EXISTS' : 'NULL'}`);
console.log(`  Remote DH PK: ${bobSession.dhRatchet.remotePublicKey ? Buffer.from(bobSession.dhRatchet.remotePublicKey).toString('hex').substring(0, 32) : 'NULL'}...`);
console.log(`  Header DH PK: ${Buffer.from(h3.dhPublicKey).toString('hex').substring(0, 32)}...`);

try {
  bobSession.decrypt(ct3, mac3, h3);
  console.log('\n✅ SUCCESS: Bob decrypted message 3!');
} catch (err) {
  console.log(`\n❌ FAILED: ${err.message}`);
  
  console.log('\n🔍 Diagnostic:');
  console.log('Alice sent with DH PK:', Buffer.from(h3.dhPublicKey).toString('hex').substring(0, 32));
  console.log('Bob expects DH PK:    ', bobSession.dhRatchet.remotePublicKey ? Buffer.from(bobSession.dhRatchet.remotePublicKey).toString('hex').substring(0, 32) : 'NULL');
  
  // Check saved sessions
  const aliceSaved = JSON.parse(fs.readFileSync(
    path.join(testDir, 'alice', 'alice__bob.json'), 'utf8'
  ));
  const bobSaved = JSON.parse(fs.readFileSync(
    path.join(testDir, 'bob', 'alice__bob.json'), 'utf8'
  ));
  
  console.log('\n📄 Saved session comparison:');
  console.log('Alice currentDHPublicKey:', aliceSaved.state.currentDHPublicKey ? aliceSaved.state.currentDHPublicKey.slice(0, 16) : 'NULL');
  console.log('Bob remotePublicKey:     ', bobSaved.state.dhRatchet.remotePublicKey ? bobSaved.state.dhRatchet.remotePublicKey.slice(0, 16) : 'NULL');
}

// Cleanup
fs.rmSync(testDir, { recursive: true, force: true });
