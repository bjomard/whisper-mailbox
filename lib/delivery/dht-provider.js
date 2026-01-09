/**
 * DHT delivery provider (MVP version)
 * Uses libp2p with Kademlia DHT
 */

import { BaseProvider } from './base-provider.js';
import { createLibp2p } from 'libp2p';
import { kadDHT } from '@libp2p/kad-dht';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { mplex } from '@libp2p/mplex';
import { createHash } from 'crypto';

export class DHTProvider extends BaseProvider {
  constructor(config = {}) {
    super({
      name: 'dht',
      priority: config.priority || 1,
      paid: false,
      enabled: config.enabled !== false,
      ...config
    });
    
    this.node = null;
    this.bootstrapNodes = config.bootstrapNodes || [];
    this.ttl = config.ttl || 48 * 3600; // 48 hours
  }
  
  /**
   * Initialize libp2p node
   */
  async initialize() {
    if (this.node) return;
    
    console.log('🔧 Initializing DHT node...');
    
    try {
      const config = {
        addresses: {
          listen: ['/ip4/0.0.0.0/tcp/0']
        },
        transports: [tcp()],
        connectionEncryption: [noise()],
        streamMuxers: [mplex()],
        dht: kadDHT({
          clientMode: true, // Client mode for now (lighter)
          kBucketSize: 20,
        })
      };
      
      // Only add bootstrap if we have valid nodes
      if (this.bootstrapNodes.length > 0) {
        const { bootstrap } = await import('@libp2p/bootstrap');
        config.peerDiscovery = [
          bootstrap({
            list: this.bootstrapNodes
          })
        ];
      }
      
      this.node = await createLibp2p(config);
      
      await this.node.start();
      console.log('✅ DHT node started');
      console.log('   Peer ID:', this.node.peerId.toString());
      
    } catch (error) {
      console.error('❌ Failed to initialize DHT:', error.message);
      this.enabled = false;
      throw error;
    }
  }
  
  /**
   * Send message via DHT
   */
  async send(recipientENS, envelope, options = {}) {
    const startTime = Date.now();
    
    try {
      if (!this.node) await this.initialize();
      
      // For now, DHT is not fully implemented
      // Return success=false so it falls back to mailbox
      return {
        success: false,
        provider: this.name,
        error: 'DHT not yet fully implemented',
        latency: Date.now() - startTime
      };
      
    } catch (error) {
      console.error('DHT send error:', error.message);
      return {
        success: false,
        provider: this.name,
        error: error.message,
        latency: Date.now() - startTime
      };
    }
  }
  
  /**
   * Receive messages from DHT
   */
  async receive(myENS, options = {}) {
    // Not yet implemented
    return [];
  }
  
  /**
   * Check DHT health
   */
  async isHealthy() {
    if (!this.enabled || !this.node) return false;
    
    try {
      const peers = await this.node.peerStore.all();
      return peers.length > 0;
    } catch {
      return false;
    }
  }
  
  /**
   * Cleanup
   */
  async close() {
    if (this.node) {
      await this.node.stop();
      this.node = null;
    }
  }
  
  // Helper methods
  
  generateKey(recipientENS, timestamp) {
    const hourTimestamp = Math.floor(timestamp / 3600000) * 3600000;
    const hash = createHash('sha256');
    hash.update(`whisper:${recipientENS}:${hourTimestamp}`);
    return hash.digest('hex');
  }
}
