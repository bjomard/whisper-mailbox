/**
 * Base interface for delivery providers
 * All providers (DHT, Mailbox, etc.) must implement this interface
 */

export class BaseProvider {
  constructor(config = {}) {
    this.name = config.name || 'unknown';
    this.priority = config.priority || 999;
    this.enabled = config.enabled !== false;
    this.paid = config.paid || false;
    this.timeout = config.timeout || 30000; // 30s default
  }
  
  /**
   * Send a message
   * @param {string} recipientENS - Recipient's ENS name
   * @param {Object} envelope - Encrypted message envelope
   * @param {Object} options - Send options
   * @returns {Promise<Object>} - Result with status, messageId, etc.
   */
  async send(recipientENS, envelope, options = {}) {
    throw new Error('send() must be implemented by subclass');
  }
  
  /**
   * Receive messages
   * @param {string} myENS - My ENS name
   * @param {Object} options - Receive options (since, limit, etc.)
   * @returns {Promise<Array>} - Array of message envelopes
   */
  async receive(myENS, options = {}) {
    throw new Error('receive() must be implemented by subclass');
  }
  
  /**
   * Check if provider is available/healthy
   * @returns {Promise<boolean>}
   */
  async isHealthy() {
    return this.enabled;
  }
  
  /**
   * Cleanup/shutdown
   */
  async close() {
    // Override if needed
  }
}
