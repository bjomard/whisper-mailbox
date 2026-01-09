/**
 * Delivery Manager
 * Orchestrates multiple delivery providers (DHT, Mailbox, etc.)
 */

import { createHash } from 'crypto';

export class DeliveryManager {
  constructor(config = {}) {
    this.providers = [];
    this.strategy = config.strategy || 'cascade'; // cascade, parallel, redundant
    this.deduplicationCache = new Map();
  }
  
  /**
   * Register a provider
   */
  addProvider(provider) {
    this.providers.push(provider);
    // Sort by priority (lower = higher priority)
    this.providers.sort((a, b) => a.priority - b.priority);
  }
  
  /**
   * Send message using configured strategy
   */
  async send(recipientENS, envelope, options = {}) {
    const results = [];
    const guaranteedDelivery = options.guaranteed || false;
    const redundant = options.redundant || false;
    
    console.log(`\n📤 Delivery Manager: Sending message`);
    console.log(`   Strategy: ${this.strategy}`);
    console.log(`   Guaranteed: ${guaranteedDelivery}`);
    console.log(`   Providers: ${this.providers.length}\n`);
    
    if (this.strategy === 'cascade') {
      // Try providers in order until one succeeds
      return await this.sendCascade(recipientENS, envelope, options);
      
    } else if (this.strategy === 'parallel') {
      // Try all providers in parallel
      return await this.sendParallel(recipientENS, envelope, options);
      
    } else if (this.strategy === 'redundant') {
      // Send via all providers for maximum reliability
      return await this.sendRedundant(recipientENS, envelope, options);
    }
    
    throw new Error(`Unknown strategy: ${this.strategy}`);
  }
  
  /**
   * Cascade: Try providers one by one until success
   */
  async sendCascade(recipientENS, envelope, options) {
    const results = [];
    
    for (const provider of this.providers) {
      // Skip paid providers unless guaranteed delivery requested
      if (provider.paid && !options.guaranteed) {
        console.log(`   ⏭️  Skipping ${provider.name} (paid, not requested)`);
        continue;
      }
      
      console.log(`   🔄 Trying ${provider.name}...`);
      
      try {
        const result = await provider.send(recipientENS, envelope, options);
        results.push(result);
        
        if (result.success) {
          console.log(`   ✅ ${provider.name} succeeded (${result.latency}ms)`);
          
          // If one free provider succeeded and not asking for redundancy, stop
          if (!provider.paid && !options.redundant) {
            break;
          }
        } else {
          console.log(`   ❌ ${provider.name} failed: ${result.error}`);
        }
      } catch (error) {
        console.error(`   ❌ ${provider.name} error:`, error.message);
        results.push({
          success: false,
          provider: provider.name,
          error: error.message
        });
      }
    }
    
    const successful = results.filter(r => r.success);
    
    if (successful.length === 0) {
      throw new Error('All delivery providers failed');
    }
    
    console.log(`\n✅ Message delivered via ${successful.length} provider(s)`);
    return results;
  }
  
  /**
   * Parallel: Try all providers at once
   */
  async sendParallel(recipientENS, envelope, options) {
    const promises = this.providers
      .filter(p => !p.paid || options.guaranteed)
      .map(provider => 
        provider.send(recipientENS, envelope, options)
          .catch(error => ({
            success: false,
            provider: provider.name,
            error: error.message
          }))
      );
    
    const results = await Promise.all(promises);
    const successful = results.filter(r => r.success);
    
    if (successful.length === 0) {
      throw new Error('All delivery providers failed');
    }
    
    console.log(`✅ Message delivered via ${successful.length}/${results.length} provider(s)`);
    return results;
  }
  
  /**
   * Redundant: Send via ALL providers
   */
  async sendRedundant(recipientENS, envelope, options) {
    return await this.sendParallel(recipientENS, envelope, { ...options, redundant: true });
  }
  
  /**
   * Receive messages from all providers
   */
  async receive(myENS, options = {}) {
    console.log(`\n📥 Delivery Manager: Receiving messages`);
    console.log(`   Providers: ${this.providers.length}\n`);
    
    // Query all providers in parallel
    const promises = this.providers.map(provider => 
      provider.receive(myENS, options)
        .catch(error => {
          console.warn(`   ⚠️  ${provider.name} failed:`, error.message);
          return [];
        })
    );
    
    const results = await Promise.all(promises);
    
    // Flatten and deduplicate
    const allMessages = results.flat();
    const deduplicated = this.deduplicate(allMessages);
    
    console.log(`   📊 Total: ${allMessages.length}, Unique: ${deduplicated.length}`);
    
    return deduplicated;
  }
  
  /**
   * Deduplicate messages from different providers
   */
  deduplicate(messages) {
    const seen = new Map();
    
    for (const msg of messages) {
      // Generate hash from message content (not metadata)
      const hash = this.messageHash(msg);
      
      if (!seen.has(hash)) {
        seen.set(hash, msg);
      } else {
        // Keep the one from higher priority provider
        const existing = seen.get(hash);
        const existingPriority = this.getProviderPriority(existing._metadata?.provider);
        const newPriority = this.getProviderPriority(msg._metadata?.provider);
        
        if (newPriority < existingPriority) {
          seen.set(hash, msg);
        }
      }
    }
    
    return Array.from(seen.values());
  }
  
  messageHash(msg) {
    const hash = createHash('sha256');
    hash.update(msg.from || '');
    hash.update(msg.to || '');
    hash.update(String(msg.timestamp || 0));
    hash.update(msg.ratchet?.ciphertext || '');
    hash.update(msg.ratchet?.mac || '');
    return hash.digest('hex');
  }
  
  getProviderPriority(providerName) {
    const provider = this.providers.find(p => p.name === providerName);
    return provider?.priority || 999;
  }
  
  /**
   * Check health of all providers
   */
  async checkHealth() {
    console.log('\n🏥 Checking provider health...\n');
    
    const checks = await Promise.all(
      this.providers.map(async (provider) => {
        try {
          const healthy = await provider.isHealthy();
          console.log(`   ${healthy ? '✅' : '❌'} ${provider.name}`);
          return { provider: provider.name, healthy };
        } catch (error) {
          console.log(`   ❌ ${provider.name} (${error.message})`);
          return { provider: provider.name, healthy: false, error: error.message };
        }
      })
    );
    
    return checks;
  }
  
  /**
   * Cleanup all providers
   */
  async close() {
    await Promise.all(this.providers.map(p => p.close()));
  }
}
