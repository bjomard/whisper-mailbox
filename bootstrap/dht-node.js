#!/usr/bin/env node

/**
 * Whisper DHT Bootstrap Node
 * 
 * A persistent DHT node that helps other peers discover each other.
 * Should be deployed on a VPS with a public IP.
 * 
 * Usage:
 *   node bootstrap/dht-node.js
 *   
 * Environment variables:
 *   DHT_PORT - Port to listen on (default: 4001)
 *   DHT_HOST - Host to bind to (default: 0.0.0.0)
 */

import { createLibp2p } from 'libp2p';
import { kadDHT } from '@libp2p/kad-dht';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { mplex } from '@libp2p/mplex';
import { identify } from '@libp2p/identify';
import { ping } from '@libp2p/ping';
import fs from 'fs';
import { createFromPrivKey } from '@libp2p/peer-id-factory';
import { unmarshalPrivateKey } from '@libp2p/crypto/keys';

const DHT_PORT = process.env.DHT_PORT || 4001;
const DHT_HOST = process.env.DHT_HOST || '0.0.0.0';
const PEER_ID_FILE = process.env.PEER_ID_FILE || './bootstrap/peer-id.json';

/**
 * Load or generate peer ID
 */
async function loadOrGeneratePeerId() {
  if (fs.existsSync(PEER_ID_FILE)) {
    console.log('📂 Loading existing peer ID...');
    const data = JSON.parse(fs.readFileSync(PEER_ID_FILE, 'utf8'));
    const privateKey = unmarshalPrivateKey(Buffer.from(data.privateKey, 'base64'));
    return await createFromPrivKey(privateKey);
  }
  
  console.log('🔑 Generating new peer ID...');
  const { generateKeyPair } = await import('@libp2p/crypto/keys');
  const privateKey = await generateKeyPair('Ed25519');
  const peerId = await createFromPrivKey(privateKey);
  
  // Save for persistence
  fs.mkdirSync('./bootstrap', { recursive: true });
  fs.writeFileSync(PEER_ID_FILE, JSON.stringify({
    id: peerId.toString(),
    privateKey: Buffer.from(privateKey.bytes).toString('base64')
  }));
  
  console.log('💾 Peer ID saved to', PEER_ID_FILE);
  return peerId;
}

/**
 * Start bootstrap node
 */
async function startBootstrapNode() {
  console.log('🚀 Starting Whisper DHT Bootstrap Node...\n');
  
  const peerId = await loadOrGeneratePeerId();
  
  const node = await createLibp2p({
    peerId,
    addresses: {
      listen: [
        `/ip4/${DHT_HOST}/tcp/${DHT_PORT}`,
        `/ip6/::/tcp/${DHT_PORT}`
      ]
    },
    transports: [tcp()],
    connectionEncryption: [noise()],
    streamMuxers: [mplex()],
    services: {
      identify: identify(),
      ping: ping(),
      dht: kadDHT({
        clientMode: false, // Full DHT server
        kBucketSize: 20,
        protocolPrefix: '/whisper',
        allowQueryWithZeroPeers: true
      })
    },
    connectionManager: {
      maxConnections: 1000,
      minConnections: 10,
      pollInterval: 2000
    }
  });
  
  await node.start();
  
  console.log('✅ Bootstrap node started!');
  console.log('');
  console.log('📋 Node Information:');
  console.log('   Peer ID:', node.peerId.toString());
  console.log('');
  console.log('📡 Listening on:');
  
  const addrs = node.getMultiaddrs();
  addrs.forEach(addr => {
    console.log('   ', addr.toString());
  });
  
  console.log('');
  console.log('🔗 Bootstrap multiaddr (use this in clients):');
  addrs.forEach(addr => {
    console.log('   ', `${addr}/p2p/${node.peerId.toString()}`);
  });
  
  console.log('');
  console.log('📊 Stats:');
  
  // Log stats every 60 seconds
  setInterval(() => {
    const peers = node.services.dht.routingTable.size;
    const connections = node.getConnections().length;
    
    console.log(`[${new Date().toISOString()}] Peers: ${peers}, Connections: ${connections}`);
  }, 60000);
  
  // Handle shutdown gracefully
  const shutdown = async () => {
    console.log('\n🛑 Shutting down...');
    await node.stop();
    console.log('✅ Node stopped');
    process.exit(0);
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  
  return node;
}

// Run
startBootstrapNode().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
