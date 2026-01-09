/**
 * Mailbox delivery provider
 * Wraps existing mailbox functionality
 */

import { BaseProvider } from './base-provider.js';
import fs from 'fs';
import { randomBytes } from 'crypto';

export class MailboxProvider extends BaseProvider {
  constructor(config = {}) {
    super({
      name: 'mailbox',
      priority: config.priority || 2,
      paid: config.paid || false,
      enabled: config.enabled !== false,
      ...config
    });
    
    this.mailboxUrl = config.url || process.env.MAILBOX_URLS || 'http://localhost:8080';
  }
  
  /**
   * Send message via mailbox
   */
  async send(recipientENS, envelope, options = {}) {
    const startTime = Date.now();
    
    try {
      // Load recipient's mailbox info
      const recipientAlias = recipientENS.split('.')[0];
      const recipient = this.loadMailboxInfo(recipientAlias);
      
      const blob = Buffer.from(JSON.stringify(envelope), 'utf8');
      const depositToken = recipient.mailbox.deposit_tokens[0];
      
      const response = await fetch(
        `${this.mailboxUrl}/v1/mailboxes/${recipient.mailbox.mailbox_id}/deposit`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${depositToken}`,
            'X-Whisper-MsgId': envelope.messageId || this.generateMessageId(),
            'Content-Type': 'application/octet-stream'
          },
          body: blob,
          signal: AbortSignal.timeout(this.timeout)
        }
      );
      
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Mailbox deposit failed: ${response.status} ${text}`);
      }
      
      const result = await response.json();
      
      return {
        success: true,
        provider: this.name,
        messageId: result.msg_id,
        latency: Date.now() - startTime,
        expiresAt: result.expires_at
      };
      
    } catch (error) {
      return {
        success: false,
        provider: this.name,
        error: error.message,
        latency: Date.now() - startTime
      };
    }
  }
  
  /**
   * Receive messages from mailbox
   */
  async receive(myENS, options = {}) {
    try {
      const myAlias = myENS.split('.')[0];
      const myInfo = this.loadMailboxInfo(myAlias);
      
      const response = await fetch(
        `${this.mailboxUrl}/v1/mailboxes/${myInfo.mailbox.mailbox_id}/poll`,
        {
          headers: {
            'Authorization': `Bearer ${myInfo.mailbox.poll_token}`
          },
          signal: AbortSignal.timeout(this.timeout)
        }
      );
      
      if (!response.ok) {
        throw new Error(`Mailbox poll failed: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      return data.messages.map(msg => ({
        ...JSON.parse(Buffer.from(msg.blob_b64, 'base64').toString('utf8')),
        _metadata: {
          provider: this.name,
          messageId: msg.msg_id,
          receivedAt: Date.now()
        }
      }));
      
    } catch (error) {
      console.error(`Mailbox receive error:`, error.message);
      return [];
    }
  }
  
  /**
   * Check mailbox health
   */
  async isHealthy() {
    try {
      const response = await fetch(`${this.mailboxUrl}/health`, {
        signal: AbortSignal.timeout(5000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }
  
  // Helper methods
  
  loadMailboxInfo(alias) {
    const secretsRoot = process.env.SECRETS_ROOT || `${process.env.HOME}/F3NIX-Secrets/whisper`;
    const mailboxFile = `${secretsRoot}/users/${alias}/mailbox.json`;
    
    if (!fs.existsSync(mailboxFile)) {
      throw new Error(`Mailbox info not found for ${alias}`);
    }
    
    return {
      mailbox: JSON.parse(fs.readFileSync(mailboxFile, 'utf8'))
    };
  }
  
  generateMessageId() {
    return Buffer.from(randomBytes(24))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }
}
