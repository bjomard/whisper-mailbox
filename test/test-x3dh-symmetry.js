#!/usr/bin/env node

import * as x25519 from '@stablelib/x25519';
import { initiatorKeyAgreement, responderKeyAgreement } from '../lib/double-ratchet/x3dh-init.js';

const aliceIdentity = x25519.generateKeyPair();
const bobIdentity = x25519.generateKeyPair();

console.log('🔍 Test X3DH Symmetry\n');

// Alice (initiator) génère le root key
const { rootKey: aliceRootKey, ephemeralPublicKey } = initiatorKeyAgreement(
  aliceIdentity,
  bobIdentity.publicKey
);

// Bob (responder) doit dériver le MÊME root key
const { rootKey: bobRootKey } = responderKeyAgreement(
  bobIdentity,
  aliceIdentity.publicKey,
  ephemeralPublicKey
);

const aliceHex = Buffer.from(aliceRootKey).toString('hex');
const bobHex = Buffer.from(bobRootKey).toString('hex');

console.log('Alice root key:', aliceHex);
console.log('Bob root key:  ', bobHex);
console.log();
console.log('Match:', aliceHex === bobHex ? '✅ YES' : '❌ NO - BUG TROUVÉ!');

if (aliceHex !== bobHex) {
  console.log('\n🐛 Les root keys ne matchent pas !');
  console.log('C\'est pour ça que le ratchet ne peut pas se synchroniser.');
}
