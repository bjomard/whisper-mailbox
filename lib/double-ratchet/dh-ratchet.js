/**
 * Diffie-Hellman Ratchet
 * 
 * Manages DH key pair rotation and root key updates
 */

import * as x25519 from '@stablelib/x25519';
import { kdfRootKey } from './kdf.js';

export class DHRatchet {
  constructor(rootKey, localKeyPair = null, remotePublicKey = null) {
    this.rootKey = rootKey;
    this.localKeyPair = localKeyPair || x25519.generateKeyPair();
    this.remotePublicKey = remotePublicKey;
  }
  
  /**
   * Perform DH ratchet step when receiving a new remote public key
   * Updates root key and returns new receiving chain key
   * 
   * @param {Uint8Array} newRemotePublicKey - New public key from remote party
   * @returns {{ rootKey: Uint8Array, chainKey: Uint8Array }}
   */
  ratchetReceive(newRemotePublicKey) {
    this.remotePublicKey = newRemotePublicKey;
    
    // Compute DH output
    const dhOutput = x25519.sharedKey(
      this.localKeyPair.secretKey,
      this.remotePublicKey
    );
    
    // Derive new root key and receiving chain key
    const { rootKey, chainKey } = kdfRootKey(this.rootKey, dhOutput);
    
    this.rootKey = rootKey;
    
    return { rootKey, chainKey };
  }
  
  /**
   * Perform DH ratchet step when sending
   * Generates new local key pair, updates root key, returns new sending chain key
   * 
   * @returns {{ rootKey: Uint8Array, chainKey: Uint8Array, publicKey: Uint8Array }}
   */
  ratchetSend() {
    if (!this.remotePublicKey) {
      throw new Error('Cannot ratchet send without remote public key');
    }
    
    // Generate new local key pair
    this.localKeyPair = x25519.generateKeyPair();
    
    // Compute DH output
    const dhOutput = x25519.sharedKey(
      this.localKeyPair.secretKey,
      this.remotePublicKey
    );
    
    // Derive new root key and sending chain key
    const { rootKey, chainKey } = kdfRootKey(this.rootKey, dhOutput);
    
    this.rootKey = rootKey;
    
    return {
      rootKey,
      chainKey,
      publicKey: this.localKeyPair.publicKey
    };
  }
  
  /**
   * Get current state for persistence
   */
  getState() {
    return {
      rootKey: this.rootKey,
      localKeyPair: {
        publicKey: this.localKeyPair.publicKey,
        secretKey: this.localKeyPair.secretKey
      },
      remotePublicKey: this.remotePublicKey
    };
  }
  
  /**
   * Restore from saved state
   */
  static fromState(state) {
    return new DHRatchet(
      state.rootKey,
      state.localKeyPair,
      state.remotePublicKey
    );
  }
}
