#!/usr/bin/env node

import fs from 'fs';

// Lire les sessions sauvegardées après message 2
const aliceSession = JSON.parse(fs.readFileSync(
  `${process.env.HOME}/F3NIX-Secrets/whisper/users/alice/sessions/alice.wspr.f3nixid.eth__bertrand.wspr.f3nixid.eth.json`,
  'utf8'
));

const bertrandSession = JSON.parse(fs.readFileSync(
  `${process.env.HOME}/F3NIX-Secrets/whisper/users/bertrand/sessions/alice.wspr.f3nixid.eth__bertrand.wspr.f3nixid.eth.json`,
  'utf8'
));

console.log('🔍 Session Comparison after Message 2\n');

console.log('Alice session:');
console.log('  Has sending chain:', !!aliceSession.state.sendingChain);
console.log('  Has receiving chain:', !!aliceSession.state.receivingChain);
console.log('  Current DH PK:', aliceSession.state.currentDHPublicKey?.slice(0, 16));
console.log('  DH Ratchet remote PK:', aliceSession.state.dhRatchet.remotePublicKey?.slice(0, 16));

console.log('\nBertrand session:');
console.log('  Has sending chain:', !!bertrandSession.state.sendingChain);
console.log('  Has receiving chain:', !!bertrandSession.state.receivingChain);
console.log('  Current DH PK:', bertrandSession.state.currentDHPublicKey?.slice(0, 16));
console.log('  DH Ratchet remote PK:', bertrandSession.state.dhRatchet.remotePublicKey?.slice(0, 16));

console.log('\n📊 Analysis:');
console.log('Alice currentDH == Bertrand remoteDH?', 
  JSON.stringify(aliceSession.state.currentDHPublicKey) === 
  JSON.stringify(bertrandSession.state.dhRatchet.remotePublicKey) ? '✅' : '❌');

console.log('Bertrand currentDH == Alice remoteDH?',
  JSON.stringify(bertrandSession.state.currentDHPublicKey) === 
  JSON.stringify(aliceSession.state.dhRatchet.remotePublicKey) ? '✅' : '❌');

// Le problème probable
console.log('\n🐛 Issue:');
console.log('When Alice sends message 3, she will use currentDHPublicKey:', 
  aliceSession.state.currentDHPublicKey?.slice(0, 16));
console.log('But Bertrand expects remoteDH to be:', 
  bertrandSession.state.dhRatchet.remotePublicKey?.slice(0, 16));
console.log('These should match but might not after DH ratchet.');
