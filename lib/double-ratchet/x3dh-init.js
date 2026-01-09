/**
 * Simplified X3DH-like initial key agreement
 */

import * as x25519 from '@stablelib/x25519';
import { createHash } from 'crypto';

export function initiatorKeyAgreement(localIdentityKeys, remoteIdentityPublicKey) {
  const ephemeralKeyPair = x25519.generateKeyPair();
  
  const dh1 = x25519.sharedKey(localIdentityKeys.secretKey, remoteIdentityPublicKey);
  const dh2 = x25519.sharedKey(ephemeralKeyPair.secretKey, remoteIdentityPublicKey);
  
  const combined = new Uint8Array(dh1.length + dh2.length);
  combined.set(dh1, 0);
  combined.set(dh2, dh1.length);
  
  const hash = createHash('sha256');
  hash.update(Buffer.from(combined));
  hash.update(Buffer.from('WhisperX3DHRootKey'));
  const rootKey = new Uint8Array(hash.digest());
  
  return {
    rootKey,
    localEphemeralKeyPair: ephemeralKeyPair,
    ephemeralPublicKey: ephemeralKeyPair.publicKey
  };
}

export function responderKeyAgreement(
  localIdentityKeys,
  remoteIdentityPublicKey,
  remoteEphemeralPublicKey
) {
  const dh1 = x25519.sharedKey(localIdentityKeys.secretKey, remoteIdentityPublicKey);
  const dh2 = x25519.sharedKey(localIdentityKeys.secretKey, remoteEphemeralPublicKey);
  
  const combined = new Uint8Array(dh1.length + dh2.length);
  combined.set(dh1, 0);
  combined.set(dh2, dh1.length);
  
  const hash = createHash('sha256');
  hash.update(Buffer.from(combined));
  hash.update(Buffer.from('WhisperX3DHRootKey'));
  const rootKey = new Uint8Array(hash.digest());
  
  return { rootKey };
}
