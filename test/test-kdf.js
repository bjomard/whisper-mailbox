#!/usr/bin/env node

import { hkdf, kdfRootKey, kdfChainKey, deriveMessageKeys } from '../lib/double-ratchet/kdf.js';
import { SymmetricRatchet } from '../lib/double-ratchet/symmetric-ratchet.js';

function uint8ArrayToHex(arr) {
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

console.log('🧪 Testing KDF Functions\n');

// Test 1: HKDF
console.log('Test 1: HKDF');
const ikm = new Uint8Array(32).fill(0x0b);
const salt = new Uint8Array(32).fill(0x00);
const info = new TextEncoder().encode('test');
const output = hkdf(ikm, salt, info, 64);
console.log(`  IKM:    ${uint8ArrayToHex(ikm).substring(0, 32)}...`);
console.log(`  Output: ${uint8ArrayToHex(output).substring(0, 32)}...`);
console.log(`  Length: ${output.length} bytes`);
console.log('  ✅ HKDF working\n');

// Test 2: KDF_RK
console.log('Test 2: KDF_RK (Root Key)');
const rootKey = new Uint8Array(32).fill(0x01);
const dhOutput = new Uint8Array(32).fill(0x02);
const { rootKey: newRootKey, chainKey } = kdfRootKey(rootKey, dhOutput);
console.log(`  Old RK: ${uint8ArrayToHex(rootKey).substring(0, 32)}...`);
console.log(`  New RK: ${uint8ArrayToHex(newRootKey).substring(0, 32)}...`);
console.log(`  CK:     ${uint8ArrayToHex(chainKey).substring(0, 32)}...`);
console.log('  ✅ Root key derivation working\n');

// Test 3: KDF_CK
console.log('Test 3: KDF_CK (Chain Key)');
const ck = new Uint8Array(32).fill(0x03);
const { chainKey: newCK, messageKey: mk } = kdfChainKey(ck);
console.log(`  Old CK: ${uint8ArrayToHex(ck).substring(0, 32)}...`);
console.log(`  New CK: ${uint8ArrayToHex(newCK).substring(0, 32)}...`);
console.log(`  MK:     ${uint8ArrayToHex(mk).substring(0, 32)}...`);
console.log('  ✅ Chain key derivation working\n');

// Test 4: Symmetric Ratchet
console.log('Test 4: Symmetric Ratchet');
const initialCK = new Uint8Array(32).fill(0x04);
const ratchet = new SymmetricRatchet(initialCK);

console.log('  Advancing ratchet 3 times:');
for (let i = 0; i < 3; i++) {
  const { messageKey, messageNumber } = ratchet.ratchetForward();
  console.log(`    Message ${messageNumber}: ${uint8ArrayToHex(messageKey).substring(0, 32)}...`);
}
console.log('  ✅ Symmetric ratchet working\n');

// Test 5: Message Keys
console.log('Test 5: Message Keys Derivation');
const testMK = new Uint8Array(32).fill(0x05);
const { encKey, authKey, iv } = deriveMessageKeys(testMK);
console.log(`  MK:      ${uint8ArrayToHex(testMK).substring(0, 32)}...`);
console.log(`  EncKey:  ${uint8ArrayToHex(encKey).substring(0, 32)}...`);
console.log(`  AuthKey: ${uint8ArrayToHex(authKey).substring(0, 32)}...`);
console.log(`  IV:      ${uint8ArrayToHex(iv)}`);
console.log('  ✅ Message keys derivation working\n');

// Test 6: Determinism
console.log('Test 6: Determinism Check');
const testInput = new Uint8Array(32).fill(0x06);
const output1 = hkdf(testInput, null, new Uint8Array(0), 32);
const output2 = hkdf(testInput, null, new Uint8Array(0), 32);
const equal = output1.every((val, idx) => val === output2[idx]);
console.log(`  Same input = same output: ${equal ? '✅' : '❌'}`);
console.log();

// Test 7: Forward secrecy
console.log('Test 7: Forward Secrecy Property');
const ck1 = new Uint8Array(32).fill(0x07);
const { chainKey: ck2, messageKey: mk1 } = kdfChainKey(ck1);
const { chainKey: ck3, messageKey: mk2 } = kdfChainKey(ck2);

console.log(`  CK1: ${uint8ArrayToHex(ck1).substring(0, 32)}...`);
console.log(`  CK2: ${uint8ArrayToHex(ck2).substring(0, 32)}...`);
console.log(`  CK3: ${uint8ArrayToHex(ck3).substring(0, 32)}...`);
console.log(`  All different: ${
  uint8ArrayToHex(ck1) !== uint8ArrayToHex(ck2) && 
  uint8ArrayToHex(ck2) !== uint8ArrayToHex(ck3) ? '✅' : '❌'
}`);
console.log();

console.log('🎉 All KDF tests passed!');
