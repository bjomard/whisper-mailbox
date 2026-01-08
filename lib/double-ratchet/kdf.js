/**
 * Key Derivation Functions for Double Ratchet
 */

import { createHmac } from 'crypto';

export function hkdf(ikm, salt = null, info = new Uint8Array(0), length = 32) {
  const actualSalt = salt || new Uint8Array(32);
  const prk = hmacSha256(actualSalt, ikm);
  
  const hashLen = 32;
  const n = Math.ceil(length / hashLen);
  
  if (n > 255) {
    throw new Error('HKDF output too long');
  }
  
  let t = new Uint8Array(0);
  const okm = new Uint8Array(length);
  let offset = 0;
  
  for (let i = 1; i <= n; i++) {
    const input = new Uint8Array(t.length + info.length + 1);
    input.set(t, 0);
    input.set(info, t.length);
    input[t.length + info.length] = i;
    
    t = hmacSha256(prk, input);
    
    const copyLength = Math.min(hashLen, length - offset);
    okm.set(t.subarray(0, copyLength), offset);
    offset += copyLength;
  }
  
  return okm;
}

function hmacSha256(key, data) {
  const hmac = createHmac('sha256', Buffer.from(key));
  hmac.update(Buffer.from(data));
  return new Uint8Array(hmac.digest());
}

export function kdfRootKey(rootKey, dhOutput) {
  const salt = rootKey;
  const ikm = dhOutput;
  const info = new TextEncoder().encode('WhisperDoubleRatchetRootKey');
  
  const output = hkdf(ikm, salt, info, 64);
  
  return {
    rootKey: output.subarray(0, 32),
    chainKey: output.subarray(32, 64)
  };
}

export function kdfChainKey(chainKey) {
  const CHAIN_KEY_CONSTANT = new Uint8Array([0x02]);
  const MESSAGE_KEY_CONSTANT = new Uint8Array([0x01]);
  
  return {
    chainKey: hmacSha256(chainKey, CHAIN_KEY_CONSTANT),
    messageKey: hmacSha256(chainKey, MESSAGE_KEY_CONSTANT)
  };
}

export function deriveMessageKeys(messageKey) {
  const salt = new Uint8Array(32);
  const info = new TextEncoder().encode('WhisperMessageKeys');
  
  const output = hkdf(messageKey, salt, info, 80);
  
  return {
    encKey: output.subarray(0, 32),
    authKey: output.subarray(32, 64),
    iv: output.subarray(64, 80)
  };
}
