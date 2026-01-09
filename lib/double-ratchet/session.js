/**
 * Double Ratchet Session
 */

import { DHRatchet } from './dh-ratchet.js';
import { SymmetricRatchet } from './symmetric-ratchet.js';
import { deriveMessageKeys } from './kdf.js';
import { createCipheriv, createDecipheriv, createHmac } from 'crypto';

export class DoubleRatchetSession {
  constructor(rootKey, localKeyPair, remotePublicKey, isSender) {
    this.dhRatchet = new DHRatchet(rootKey, localKeyPair, remotePublicKey);
    
    if (isSender) {
      const { chainKey, publicKey } = this.dhRatchet.ratchetSend();
      this.sendingChain = new SymmetricRatchet(chainKey);
      this.receivingChain = null;
      this.currentDHPublicKey = publicKey;
    } else {
      this.sendingChain = null;
      this.receivingChain = null;
      this.currentDHPublicKey = null;
    }
    
    this.skippedMessageKeys = new Map();
    this.previousChainLength = 0;
  }
  
  encrypt(plaintext, associatedData = new Uint8Array(0)) {
    if (!this.sendingChain) {
      this.previousChainLength = this.receivingChain ? this.receivingChain.messageNumber : 0;
      
      const { chainKey, publicKey } = this.dhRatchet.ratchetSend();
      this.sendingChain = new SymmetricRatchet(chainKey);
      this.currentDHPublicKey = publicKey;
    }
    
    const { messageKey, messageNumber } = this.sendingChain.ratchetForward();
    const { encKey, authKey, iv } = deriveMessageKeys(messageKey);
    
    const cipher = createCipheriv('aes-256-cbc', Buffer.from(encKey), Buffer.from(iv));
    let ciphertext = cipher.update(Buffer.from(plaintext));
    ciphertext = Buffer.concat([ciphertext, cipher.final()]);
    
    const header = {
      dhPublicKey: Array.from(this.currentDHPublicKey),
      messageNumber: messageNumber,
      previousChainLength: this.previousChainLength
    };
    
    const macInput = Buffer.concat([
      Buffer.from(associatedData),
      Buffer.from(JSON.stringify(header)),
      ciphertext
    ]);
    
    const hmac = createHmac('sha256', Buffer.from(authKey));
    hmac.update(macInput);
    const mac = hmac.digest();
    
    return {
      ciphertext: new Uint8Array(ciphertext),
      mac: new Uint8Array(mac),
      header
    };
  }
  
  decrypt(ciphertext, mac, header, associatedData = new Uint8Array(0)) {
    const dhPublicKey = new Uint8Array(header.dhPublicKey);
    
    const needsRatchet = !this.receivingChain || 
      !this.dhRatchet.remotePublicKey ||
      !arraysEqual(dhPublicKey, this.dhRatchet.remotePublicKey);
    
    if (needsRatchet) {
      if (this.receivingChain) {
        this.skipMessageKeys(header.previousChainLength);
      }
      
      const { chainKey } = this.dhRatchet.ratchetReceive(dhPublicKey);
      this.receivingChain = new SymmetricRatchet(chainKey);
      this.sendingChain = null;
      
      // ✅ CORRECTION CRITIQUE: Mettre à jour currentDHPublicKey avec la clé locale
      this.currentDHPublicKey = this.dhRatchet.localKeyPair.publicKey;
    }
    
    this.skipMessageKeys(header.messageNumber);
    
    const { messageKey } = this.receivingChain.ratchetForward();
    const { encKey, authKey, iv } = deriveMessageKeys(messageKey);
    
    const macInput = Buffer.concat([
      Buffer.from(associatedData),
      Buffer.from(JSON.stringify(header)),
      Buffer.from(ciphertext)
    ]);
    
    const hmac = createHmac('sha256', Buffer.from(authKey));
    hmac.update(macInput);
    const expectedMac = hmac.digest();
    
    if (!constantTimeEqual(mac, new Uint8Array(expectedMac))) {
      throw new Error('MAC verification failed');
    }
    
    const decipher = createDecipheriv('aes-256-cbc', Buffer.from(encKey), Buffer.from(iv));
    let plaintext = decipher.update(Buffer.from(ciphertext));
    plaintext = Buffer.concat([plaintext, decipher.final()]);
    
    return new Uint8Array(plaintext);
  }
  
  skipMessageKeys(untilMessageNumber) {
    if (!this.receivingChain) return;
    
    while (this.receivingChain.messageNumber < untilMessageNumber) {
      const { messageKey, messageNumber } = this.receivingChain.ratchetForward();
      const key = `${Array.from(this.dhRatchet.remotePublicKey).join(',')}-${messageNumber}`;
      this.skippedMessageKeys.set(key, messageKey);
    }
  }
  
  getState() {
    return {
      dhRatchet: this.dhRatchet.getState(),
      sendingChain: this.sendingChain ? this.sendingChain.getState() : null,
      receivingChain: this.receivingChain ? this.receivingChain.getState() : null,
      currentDHPublicKey: this.currentDHPublicKey,
      previousChainLength: this.previousChainLength,
      skippedMessageKeys: Array.from(this.skippedMessageKeys.entries())
    };
  }
  
  static fromState(state) {
    const session = Object.create(DoubleRatchetSession.prototype);
    
    session.dhRatchet = DHRatchet.fromState(state.dhRatchet);
    session.sendingChain = state.sendingChain ? 
      SymmetricRatchet.fromState(state.sendingChain) : null;
    session.receivingChain = state.receivingChain ? 
      SymmetricRatchet.fromState(state.receivingChain) : null;
    session.currentDHPublicKey = state.currentDHPublicKey;
    session.previousChainLength = state.previousChainLength;
    session.skippedMessageKeys = new Map(state.skippedMessageKeys);
    
    return session;
  }
}

function arraysEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((val, i) => val === b[i]);
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}
