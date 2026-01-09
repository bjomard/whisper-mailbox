/**
 * DHT delivery provider
 * Uses libp2p with Kademlia DHT for distributed message storage
 */

import { BaseProvider } from './base-provider.js';
import { createLibp2p } from 'libp2p';
import { kadDHT } from '@libp2p/kad-dht';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { mplex } from '@libp2p/mplex';
import { identify } from '@libp2p/identify';
import { ping } from '@libp2p/ping';
import { createHash } from 'crypto';
import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import { sha256 } from 'multiformats/hashes/sha2';

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
    this.ttl = config.ttl || 48 * 3600;
    this.initialized = false;
  }
  
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
        services: {
          identify: identify(),
          ping: ping(),
          dht: kadDHT({
            clientMode: false,
            kBucketSize: 20,
            allowQueryWithZeroPeers: true
          })
        }
      };
      
      if (this.bootstrapNodes.length > 0) {
        const { bootstrap } = await import('@libp2p/bootstrap');
        config.peerDiscovery = [
          bootstrap({ list: this.bootstrapNodes })
        ];
      }
      
      this.node = await createLibp2p(config);
      await this.node.start();
      
      this.initialized = true;
      
      console.log('✅ DHT node started');
      console.log('   Peer ID:', this.node.peerId.toString());
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.error('❌ DHT init failed:', error.message);
      this.enabled = false;
      throw error;
    }
  }
  
  async send(recipientENS, envelope, options = {}) {
    const startTime = Date.now();
    
    try {
      if (!this.node) await this.initialize();
      
      const key = this.generateKey(recipientENS, envelope.timestamp);
      const value = Buffer.from(JSON.stringify(envelope), 'utf8');
      
      const hash = await sha256.digest(value);
      const cid = CID.create(1, raw.code, hash);
      
      console.log(`📤 DHT: Storing message...`);
      console.log(`   Key: ${key.substring(0, 32)}...`);
      console.log(`   Size: ${value.length} bytes`);
      
      await this.node.services.dht.put(
        Buffer.from(key),
        value
      );
      
      console.log(`   ✅ Stored in DHT`);
      
      return {
        success: true,
        provider: this.name,
        messageId: key,
        dhtKey: key,
        cid: cid.toString(),
        latency: Date.now() - startTime,
        ttl: this.ttl
      };
      
    } catch (error) {
      console.error('❌ DHT send error:', error.message);
      return {
        success: false,
        provider: this.name,
        error: error.message,
        latency: Date.now() - startTime
      };
    }
  }
  
  async receive(myENS, options = {}) {
    try {
      if (!this.node) await this.initialize();
      
      const messages = [];
      const since = options.since || Date.now() - (48 * 3600 * 1000);
      const now = Date.now();
      
      console.log(`📥 DHT: Querying for messages...`);
      
      const hourMs = 3600 * 1000;
      const queries = [];
      
      for (let ts = since; ts < now; ts += hourMs) {
        const key = this.generateKey(myENS, ts);
        queries.push(this.fetchMessage(key));
      }
      
      console.log(`   Checking ${queries.length} time slots...`);
      
      const results = await Promise.allSettled(queries);
      
      let found = 0;
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          messages.push({
            ...result.value,
            _metadata: {
              provider: this.name,
              receivedAt: Date.now()
            }
          });
          found++;
        }
      }
      
      console.log(`   📊 Found ${found} message(s) in DHT`);
      return messages;
      
    } catch (error) {
      console.error('❌ DHT receive error:', error.message);
      return [];
    }
  }
  
  async fetchMessage(key) {
    try {
      const value = await this.node.services.dht.get(Buffer.from(key));
      if (!value) return null;
      return JSON.parse(value.toString('utf8'));
    } catch (error) {
      return null;
    }
  }
  
  async isHealthy() {
    if (!this.enabled || !this.node || !this.initialized) return false;
    try {
      return this.node.services.dht !== undefined;
    } catch {
      return false;
    }
  }
  
  async close() {
    if (this.node) {
      await this.node.stop();
      this.node = null;
      this.initialized = false;
    }
  }
  
  generateKey(recipientENS, timestamp) {
    const hourTimestamp = Math.floor(timestamp / 3600000) * 3600000;
    const hash = createHash('sha256');
    hash.update(`whisper-v3:${recipientENS}:${hourTimestamp}`);
    return hash.digest('hex');
  }
}
