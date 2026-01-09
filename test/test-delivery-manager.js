#!/usr/bin/env node

/**
 * Test Delivery Manager with DHT + Mailbox
 */

import { DeliveryManager } from '../lib/delivery/delivery-manager.js';
import { MailboxProvider } from '../lib/delivery/mailbox-provider.js';
import { DHTProvider } from '../lib/delivery/dht-provider.js';

async function main() {
  console.log('🧪 Testing Delivery Manager\n');
  
  // Create delivery manager
  const manager = new DeliveryManager({
    strategy: 'cascade' // Try DHT first, fallback to mailbox
  });
  
  // Add providers
  const dht = new DHTProvider({
    priority: 1,
    enabled: false // Disable for now (no bootstrap nodes yet)
  });
  
  const mailbox = new MailboxProvider({
    priority: 2,
    enabled: true
  });
  
  manager.addProvider(dht);
  manager.addProvider(mailbox);
  
  // Check health
  await manager.checkHealth();
  
  // Test send (will use mailbox since DHT disabled)
  console.log('\n📤 Test: Sending message\n');
  
  const testEnvelope = {
    version: 2,
    from: 'alice.wspr.f3nixid.eth',
    to: 'bertrand.wspr.f3nixid.eth',
    timestamp: Date.now(),
    ratchet: {
      ciphertext: 'test_ciphertext_base64',
      mac: 'test_mac_base64',
      header: {
        dhPublicKey: 'test_dh_key',
        messageNumber: 0,
        previousChainLength: 0
      }
    },
    signature: 'test_signature'
  };
  
  try {
    const results = await manager.send(
      'bertrand.wspr.f3nixid.eth',
      testEnvelope,
      { guaranteed: false }
    );
    
    console.log('\n📊 Send results:', results);
  } catch (error) {
    console.error('\n❌ Send failed:', error);
  }
  
  // Cleanup
  await manager.close();
  
  console.log('\n✅ Test complete');
}

main().catch(console.error);
