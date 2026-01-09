# Changelog

All notable changes to the Whisper project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-01-08

### Added
- **Ed25519 message authentication**: All messages are now signed with Ed25519
- Signature verification on message receipt
- Security warnings for unsigned or improperly signed messages
- Message integrity verification using SHA-256 hashes
- `tweetnacl` dependency for Ed25519 operations

### Changed
- Message envelope format now includes `signature` field
- `whisper_send.js`: Signs messages with sender's Ed25519 private key
- `whisper_receive.js`: Verifies signatures before displaying messages

### Security
- **Protection against impersonation**: Recipients can verify sender identity
- **Non-repudiation**: Messages are cryptographically linked to sender
- **Integrity checking**: Ciphertext hash prevents tampering
- Unsigned messages are rejected by default

### Technical Details
- Signature algorithm: Ed25519 (via tweetnacl)
- Message to sign: `{ from, to, ephemeral_public, ciphertext_hash, timestamp }`
- Public keys extracted from ENS ContactCards
- Compatible with existing Ledger-signed delegations

## [1.0.0] - 2026-01-08

### Added
- Complete Whisper messaging system with ENS integration
- X25519 end-to-end encryption
- Mailbox server (Rust + Axum + SQLite)
- Ledger-signed delegations (ROOT_SIGNER → usage_identity)
- ContactCards published on GitHub with commit pinning
- 5 operational user profiles (alice, bertrand, charlie, david, testuser)
- ENS resolution and verification
- Message send/receive CLI scripts
- Automated onboarding workflow

### Features
- **Confidentiality**: X25519 ECDH encryption
- **Decentralized identity**: ENS-based naming
- **Delegation model**: Cold storage Ledger signs hot keys
- **Revocability**: Delegations can be renewed without changing ENS name
- **Off-chain storage**: ContactCards on GitHub, messages in SQLite
- **Mailbox API**: deposit, poll, ack endpoints

### Infrastructure
- ENS Registry: 0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e
- Public Resolver: 0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63
- Custom Resolver: 0xF29100983E058B709F3D539b0c765937B804AC15
- ROOT_SIGNER (Ledger): 0x9835687c0eC5228913A79Fcfc11F6ac0712DE7Bb
- Publisher: 0xa8ABBb681425370962CaA2a713cf1b40b3a64A3c

### Security
- Ledger hardware wallet for root signatures
- Separate cold/hot key hierarchy
- EIP-191 signature standard
- SPKI format for public keys
- SHA-256 for ContactCard verification

## [Unreleased]

### Planned for v2.0
- Double Ratchet protocol (forward secrecy)
- Metadata protection (padding, timing obfuscation)
- Group messaging with sender keys
- Prekeys for offline messaging
- Web UI and mobile apps
- MLS (Messaging Layer Security) integration

---

## Version History

- **v1.1.0** (2026-01-08): Ed25519 authentication added
- **v1.0.0** (2026-01-08): Initial release with X25519 encryption

[1.1.0]: https://github.com/bjomard/whisper-mailbox/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/bjomard/whisper-mailbox/releases/tag/v1.0.0

## [3.0.1] - 2026-01-09

### 🎉 DHT Storage Implementation

**Major Features:**
- ✅ **DHT Storage Working!** - libp2p Kademlia DHT with put/get
- ✅ Multi-provider delivery architecture
- ✅ Automatic cascade fallback (DHT → Mailbox)
- ✅ Message deduplication across providers

**Technical Implementation:**
- libp2p full DHT node with identify + ping services
- CID-based content addressing
- Time-bucketed key generation (hourly)
- 48-hour message TTL
- Zero-cost message delivery (DHT mode)

**Performance:**
- DHT storage: 100-150ms
- DHT retrieval: Code functional (needs bootstrap)
- Mailbox fallback: 50-150ms

**Known Limitations:**
- DHT nodes isolated without bootstrap network
- Cross-node retrieval pending (Phase 9.2)
- Local testing only

**Dependencies Added:**
- @libp2p/identify
- @libp2p/ping  
- multiformats (CID support)

---

## [3.0.0] - 2026-01-09

### 🔐 Multi-Provider Delivery System

**Major Features:**
- ✅ Modular provider architecture
- ✅ DeliveryManager with cascade/parallel/redundant strategies
- ✅ DHT Provider (structure complete)
- ✅ Mailbox Provider (fully functional)
- ✅ Message acknowledgment (even for failed messages)

**Scripts:**
- whisper_send_v3.js - Multi-provider send
- whisper_receive_v3.js - Multi-source receive with dedup

---

## [2.0.0] - 2026-01-09

### 🔒 Double Ratchet Protocol

**CRITICAL BUG FIX:**
- Fixed `currentDHPublicKey` not updating after decrypt with DH ratchet
- Resolved asymmetric message 3 failure pattern

**Major Features:**
- ✅ Complete Double Ratchet implementation (Signal Protocol)
- ✅ Forward Secrecy
- ✅ Post-Compromise Security
- ✅ Per-message key rotation
- ✅ Session persistence with SessionManager
- ✅ X3DH-like initial key agreement

**Components:**
- `lib/double-ratchet/kdf.js` - HKDF-based key derivation
- `lib/double-ratchet/symmetric-ratchet.js` - Chain key ratcheting
- `lib/double-ratchet/dh-ratchet.js` - X25519 DH ratchet
- `lib/double-ratchet/session.js` - Complete Double Ratchet
- `lib/double-ratchet/session-manager.js` - Multi-session storage
- `lib/double-ratchet/x3dh-init.js` - Initial key agreement

**Scripts:**
- whisper_send_v2.js - Send with Double Ratchet
- whisper_receive_v2.js - Receive with Double Ratchet

**Tests:**
- 9 comprehensive test suites
- Full conversation test passing
- Session persistence verified

---

## [1.1.0] - 2026-01-08

### ✍️ Ed25519 Message Authentication

**Major Features:**
- ✅ Ed25519 signatures on all messages
- ✅ Signature verification on receive
- ✅ Protection against message forgery

**Security Improvements:**
- Sender authentication
- Message integrity verification
- Replay attack protection (timestamp-based)

---

## [1.0.1] - 2026-01-07

### 🎯 Whisper v1 Baseline

**Initial Release:**
- ENS-based identity resolution
- Contact card system (IPFS/Arweave)
- Mailbox message delivery
- Basic send/receive scripts
- User onboarding flow

---

**Format**: [Major.Minor.Patch]
**Date**: YYYY-MM-DD

## [3.0.1] - 2026-01-09

### 🎉 DHT Storage Implementation

**Major Features:**
- ✅ **DHT Storage Working!** - libp2p Kademlia DHT with put/get
- ✅ Multi-provider delivery architecture
- ✅ Automatic cascade fallback (DHT → Mailbox)
- ✅ Message deduplication across providers

**Technical Implementation:**
- libp2p full DHT node with identify + ping services
- CID-based content addressing
- Time-bucketed key generation (hourly)
- 48-hour message TTL
- Zero-cost message delivery (DHT mode)

**Performance:**
- DHT storage: 100-150ms
- DHT retrieval: Code functional (needs bootstrap)
- Mailbox fallback: 50-150ms

**Known Limitations:**
- DHT nodes isolated without bootstrap network
- Cross-node retrieval pending (Phase 9.2)
- Local testing only

**Dependencies Added:**
- @libp2p/identify
- @libp2p/ping  
- multiformats (CID support)

---

## [3.0.0] - 2026-01-09

### 🔐 Multi-Provider Delivery System

**Major Features:**
- ✅ Modular provider architecture
- ✅ DeliveryManager with cascade/parallel/redundant strategies
- ✅ DHT Provider (structure complete)
- ✅ Mailbox Provider (fully functional)
- ✅ Message acknowledgment (even for failed messages)

**Scripts:**
- whisper_send_v3.js - Multi-provider send
- whisper_receive_v3.js - Multi-source receive with dedup

---

## [2.0.0] - 2026-01-09

### 🔒 Double Ratchet Protocol

**CRITICAL BUG FIX:**
- Fixed `currentDHPublicKey` not updating after decrypt with DH ratchet
- Resolved asymmetric message 3 failure pattern

**Major Features:**
- ✅ Complete Double Ratchet implementation (Signal Protocol)
- ✅ Forward Secrecy
- ✅ Post-Compromise Security
- ✅ Per-message key rotation
- ✅ Session persistence with SessionManager
- ✅ X3DH-like initial key agreement

**Components:**
- `lib/double-ratchet/kdf.js` - HKDF-based key derivation
- `lib/double-ratchet/symmetric-ratchet.js` - Chain key ratcheting
- `lib/double-ratchet/dh-ratchet.js` - X25519 DH ratchet
- `lib/double-ratchet/session.js` - Complete Double Ratchet
- `lib/double-ratchet/session-manager.js` - Multi-session storage
- `lib/double-ratchet/x3dh-init.js` - Initial key agreement

**Scripts:**
- whisper_send_v2.js - Send with Double Ratchet
- whisper_receive_v2.js - Receive with Double Ratchet

**Tests:**
- 9 comprehensive test suites
- Full conversation test passing
- Session persistence verified

---

## [1.1.0] - 2026-01-08

### ✍️ Ed25519 Message Authentication

**Major Features:**
- ✅ Ed25519 signatures on all messages
- ✅ Signature verification on receive
- ✅ Protection against message forgery

**Security Improvements:**
- Sender authentication
- Message integrity verification
- Replay attack protection (timestamp-based)

---

## [1.0.1] - 2026-01-07

### 🎯 Whisper v1 Baseline

**Initial Release:**
- ENS-based identity resolution
- Contact card system (IPFS/Arweave)
- Mailbox message delivery
- Basic send/receive scripts
- User onboarding flow

---

**Format**: [Major.Minor.Patch]
**Date**: YYYY-MM-DD

## [3.0.1] - 2026-01-09

### 🎉 DHT Storage Implementation

**Major Features:**
- ✅ **DHT Storage Working!** - libp2p Kademlia DHT with put/get
- ✅ Multi-provider delivery architecture
- ✅ Automatic cascade fallback (DHT → Mailbox)
- ✅ Message deduplication across providers

**Technical Implementation:**
- libp2p full DHT node with identify + ping services
- CID-based content addressing
- Time-bucketed key generation (hourly)
- 48-hour message TTL
- Zero-cost message delivery (DHT mode)

**Performance:**
- DHT storage: 100-150ms
- DHT retrieval: Code functional (needs bootstrap)
- Mailbox fallback: 50-150ms

**Known Limitations:**
- DHT nodes isolated without bootstrap network
- Cross-node retrieval pending (Phase 9.2)
- Local testing only

**Dependencies Added:**
- @libp2p/identify
- @libp2p/ping  
- multiformats (CID support)

---

## [3.0.0] - 2026-01-09

### 🔐 Multi-Provider Delivery System

**Major Features:**
- ✅ Modular provider architecture
- ✅ DeliveryManager with cascade/parallel/redundant strategies
- ✅ DHT Provider (structure complete)
- ✅ Mailbox Provider (fully functional)
- ✅ Message acknowledgment (even for failed messages)

**Scripts:**
- whisper_send_v3.js - Multi-provider send
- whisper_receive_v3.js - Multi-source receive with dedup

---

## [2.0.0] - 2026-01-09

### 🔒 Double Ratchet Protocol

**CRITICAL BUG FIX:**
- Fixed `currentDHPublicKey` not updating after decrypt with DH ratchet
- Resolved asymmetric message 3 failure pattern

**Major Features:**
- ✅ Complete Double Ratchet implementation (Signal Protocol)
- ✅ Forward Secrecy
- ✅ Post-Compromise Security
- ✅ Per-message key rotation
- ✅ Session persistence with SessionManager
- ✅ X3DH-like initial key agreement

**Components:**
- `lib/double-ratchet/kdf.js` - HKDF-based key derivation
- `lib/double-ratchet/symmetric-ratchet.js` - Chain key ratcheting
- `lib/double-ratchet/dh-ratchet.js` - X25519 DH ratchet
- `lib/double-ratchet/session.js` - Complete Double Ratchet
- `lib/double-ratchet/session-manager.js` - Multi-session storage
- `lib/double-ratchet/x3dh-init.js` - Initial key agreement

**Scripts:**
- whisper_send_v2.js - Send with Double Ratchet
- whisper_receive_v2.js - Receive with Double Ratchet

**Tests:**
- 9 comprehensive test suites
- Full conversation test passing
- Session persistence verified

---

## [1.1.0] - 2026-01-08

### ✍️ Ed25519 Message Authentication

**Major Features:**
- ✅ Ed25519 signatures on all messages
- ✅ Signature verification on receive
- ✅ Protection against message forgery

**Security Improvements:**
- Sender authentication
- Message integrity verification
- Replay attack protection (timestamp-based)

---

## [1.0.1] - 2026-01-07

### 🎯 Whisper v1 Baseline

**Initial Release:**
- ENS-based identity resolution
- Contact card system (IPFS/Arweave)
- Mailbox message delivery
- Basic send/receive scripts
- User onboarding flow

---

**Format**: [Major.Minor.Patch]
**Date**: YYYY-MM-DD
