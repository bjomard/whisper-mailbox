#!/usr/bin/env node

import { createLibp2p } from 'libp2p';
import { kadDHT } from '@libp2p/kad-dht';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { mplex } from '@libp2p/mplex';
import { identify } from '@libp2p/identify';
import { ping } from '@libp2p/ping';

const DHT_PORT = process.env.DHT_PORT || 4001;
const DHT_HOST = process.env.DHT_HOST || '0.0.0.0';

async function startBootstrapNode() {
  console.log('🚀 Starting Whisper DHT Bootstrap Node...\n');
  
  const node = await createLibp2p({
    addresses: {
      listen: [
        `/ip4/0.0.0.0/tcp/${DHT_PORT}`
     ],
     announce: [
        `/ip4/51.77.145.37/tcp/${DHT_PORT}`
      ]
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
        protocolPrefix: '/whisper',
        allowQueryWithZeroPeers: true
      })
    },
    connectionManager: {
      maxConnections: 1000,
      minConnections: 10
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
console.log('    /ip4/51.77.145.37/tcp/4001/p2p/' + node.peerId.toString());


  console.log('');
  console.log('🔗 Bootstrap multiaddr (use this in clients):');
  addrs.forEach(addr => {
    console.log('   ', `${addr}/p2p/${node.peerId.toString()}`);
  });
  
  console.log('');
  console.log('📊 Stats:');
  
  setInterval(() => {
    const peers = node.services.dht.routingTable.size;
    const connections = node.getConnections().length;
    console.log(`[${new Date().toISOString()}] Peers: ${peers}, Connections: ${connections}`);
  }, 60000);
  
  const shutdown = async () => {
    console.log('\n🛑 Shutting down...');
    await node.stop();
    console.log('✅ Node stopped');
    process.exit(0);
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startBootstrapNode().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
