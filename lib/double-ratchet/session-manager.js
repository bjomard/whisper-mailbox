/**
 * Double Ratchet Session Manager
 * 
 * Manages multiple concurrent sessions and their persistence
 */

import { DoubleRatchetSession } from './session.js';
import fs from 'fs';
import path from 'path';

export class SessionManager {
  constructor(storageDir) {
    this.storageDir = storageDir;
    this.sessions = new Map(); // In-memory cache
    
    // Create storage directory if it doesn't exist
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }
  }
  
  /**
   * Get session key for storage
   * 
   * @param {string} localIdentity - e.g. "alice.wspr.f3nixid.eth"
   * @param {string} remoteIdentity - e.g. "bob.wspr.f3nixid.eth"
   * @returns {string}
   */
  static getSessionKey(localIdentity, remoteIdentity) {
    // Sort to ensure consistent key regardless of who initiates
    const [a, b] = [localIdentity, remoteIdentity].sort();
    return `${a}__${b}`;
  }
  
  /**
   * Get session file path
   */
  getSessionPath(sessionKey) {
    return path.join(this.storageDir, `${sessionKey}.json`);
  }
  
  /**
   * Load session from disk or memory
   * 
   * @param {string} localIdentity
   * @param {string} remoteIdentity
   * @returns {DoubleRatchetSession | null}
   */
  loadSession(localIdentity, remoteIdentity) {
    const sessionKey = SessionManager.getSessionKey(localIdentity, remoteIdentity);
    
    // Check memory cache first
    if (this.sessions.has(sessionKey)) {
      return this.sessions.get(sessionKey);
    }
    
    // Try to load from disk
    const sessionPath = this.getSessionPath(sessionKey);
    if (fs.existsSync(sessionPath)) {
      try {
        const data = fs.readFileSync(sessionPath, 'utf8');
        const sessionData = JSON.parse(data);
        
        // Restore Uint8Arrays from arrays
        const restoredState = this.restoreUint8Arrays(sessionData.state);
        
        const session = DoubleRatchetSession.fromState(restoredState);
        
        // Cache in memory
        this.sessions.set(sessionKey, session);
        
        console.log(`📂 Loaded session: ${localIdentity} ↔ ${remoteIdentity}`);
        return session;
      } catch (err) {
        console.error(`❌ Failed to load session ${sessionKey}:`, err.message);
        return null;
      }
    }
    
    return null;
  }
  
  /**
   * Save session to disk and memory
   * 
   * @param {string} localIdentity
   * @param {string} remoteIdentity
   * @param {DoubleRatchetSession} session
   */
  saveSession(localIdentity, remoteIdentity, session) {
    const sessionKey = SessionManager.getSessionKey(localIdentity, remoteIdentity);
    
    // Save to memory cache
    this.sessions.set(sessionKey, session);
    
    // Save to disk
    const sessionPath = this.getSessionPath(sessionKey);
    const sessionData = {
      version: 1,
      localIdentity,
      remoteIdentity,
      createdAt: Date.now(),
      state: session.getState()
    };
    
    // Convert Uint8Arrays to regular arrays for JSON
    const serializable = this.convertUint8ArraysForJSON(sessionData);
    
    fs.writeFileSync(sessionPath, JSON.stringify(serializable, null, 2), 'utf8');
    
    console.log(`💾 Saved session: ${localIdentity} ↔ ${remoteIdentity}`);
  }
  
  /**
   * Delete session
   */
  deleteSession(localIdentity, remoteIdentity) {
    const sessionKey = SessionManager.getSessionKey(localIdentity, remoteIdentity);
    
    // Remove from memory
    this.sessions.delete(sessionKey);
    
    // Remove from disk
    const sessionPath = this.getSessionPath(sessionKey);
    if (fs.existsSync(sessionPath)) {
      fs.unlinkSync(sessionPath);
      console.log(`🗑️  Deleted session: ${localIdentity} ↔ ${remoteIdentity}`);
    }
  }
  
  /**
   * List all sessions
   */
  listSessions() {
    const files = fs.readdirSync(this.storageDir);
    return files
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''))
      .map(key => {
        const [localIdentity, remoteIdentity] = key.split('__');
        return { localIdentity, remoteIdentity, sessionKey: key };
      });
  }
  
  /**
   * Convert Uint8Arrays to regular arrays for JSON serialization
   */
  convertUint8ArraysForJSON(obj) {
    if (obj instanceof Uint8Array) {
      return Array.from(obj);
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.convertUint8ArraysForJSON(item));
    }
    
    if (obj && typeof obj === 'object') {
      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.convertUint8ArraysForJSON(value);
      }
      return result;
    }
    
    return obj;
  }
  
  /**
   * Restore Uint8Arrays from regular arrays
   */
  restoreUint8Arrays(obj) {
    if (Array.isArray(obj)) {
      // Check if it's a serialized Uint8Array (all numbers)
      if (obj.length > 0 && obj.every(item => typeof item === 'number')) {
        return new Uint8Array(obj);
      }
      return obj.map(item => this.restoreUint8Arrays(item));
    }
    
    if (obj && typeof obj === 'object') {
      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.restoreUint8Arrays(value);
      }
      return result;
    }
    
    return obj;
  }
  
  /**
   * Clean up old skipped message keys to prevent memory bloat
   * 
   * @param {string} localIdentity
   * @param {string} remoteIdentity
   * @param {number} maxSkippedKeys - Maximum skipped keys to keep
   */
  cleanupSkippedKeys(localIdentity, remoteIdentity, maxSkippedKeys = 100) {
    const session = this.loadSession(localIdentity, remoteIdentity);
    if (!session) return;
    
    const skippedKeys = session.skippedMessageKeys;
    if (skippedKeys.size > maxSkippedKeys) {
      // Keep only the most recent keys
      const entries = Array.from(skippedKeys.entries());
      const toKeep = entries.slice(-maxSkippedKeys);
      
      session.skippedMessageKeys = new Map(toKeep);
      this.saveSession(localIdentity, remoteIdentity, session);
      
      console.log(`🧹 Cleaned up ${entries.length - maxSkippedKeys} old skipped keys`);
    }
  }
}
