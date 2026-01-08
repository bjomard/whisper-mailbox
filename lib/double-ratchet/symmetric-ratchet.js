/**
 * Symmetric Key Ratchet
 */

import { kdfChainKey } from './kdf.js';

export class SymmetricRatchet {
  constructor(initialChainKey) {
    this.chainKey = initialChainKey;
    this.messageNumber = 0;
  }
  
  ratchetForward() {
    const { chainKey, messageKey } = kdfChainKey(this.chainKey);
    
    this.chainKey = chainKey;
    const messageNumber = this.messageNumber;
    this.messageNumber++;
    
    return {
      messageKey,
      messageNumber
    };
  }
  
  getState() {
    return {
      chainKey: this.chainKey,
      messageNumber: this.messageNumber
    };
  }
  
  static fromState(state) {
    const ratchet = new SymmetricRatchet(state.chainKey);
    ratchet.messageNumber = state.messageNumber;
    return ratchet;
  }
}
