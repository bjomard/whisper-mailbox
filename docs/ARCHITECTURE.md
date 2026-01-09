# 🏗️ Whisper Architecture

## System Overview

Whisper is a layered architecture with clear separation of concerns:
```
┌──────────────────────────────────────────┐
│         Application Layer                │
│  (scripts/whisper_send_v3.js, etc.)     │
├──────────────────────────────────────────┤
│         Delivery Manager                 │
│  (Multi-provider orchestration)          │
├──────────────────────────────────────────┤
│    Providers (DHT, Mailbox, ...)        │
│  (Transport abstraction)                 │
├──────────────────────────────────────────┤
│      Double Ratchet Session              │
│  (Encryption & key management)           │
├──────────────────────────────────────────┤
│      Cryptographic Primitives            │
│  (X25519, Ed25519, AES, HMAC)           │
└──────────────────────────────────────────┘
```

## Component Details

### **1. Identity Layer**

**ENS Resolution**
```javascript
alice.wspr.f3nixid.eth
  → ENS Registry
  → Resolver Contract
  → f3nix.wspr.uri text record
  → IPFS/Arweave URL
  → Contact Card JSON
```

**Contact Card Structure**
```json
{
   "v": 1,
   "type": "whisper.contact_card",
   "subject": "bob.wspr.f3nixid.eth",
 
   "profile": {
     "scope": "whisper",
     "min_security_tier": "C"
   },
 
   "root_identity": {
     "alg": "secp256k1_eip191",
     "chain": "eip155:1",
     "address": "0x98...3E7Bb",
     "fingerprint": "eip155:1:0x98...E7Bb"
   },
 
   "usage_identity": {
     "alg": "ed25519+x25519",
     "pub": {
       "x25519_spki_b64u": "MCow...hBXAk",
       "ed25519_spki_b64u": "MCow...QxgpU"
     },
     "fingerprint": "spki:ed25519:MCow...xgpU"
   },
 
   "delegation": {
     "ref": "sha256:0x52ec...9b56",
     "object": {
       "v": 1,
       "type": "f3nix.delegation",
       "issuer": {
         "alg": "secp256k1_eip191",
         "chain": "eip155:1",
         "address": "0x983...DE7Bb",
         "fingerprint": "eip155:1:0x9835...de7bb"
       },
       "subject": {
         "alg": "ed25519",
         "fingerprint": "spki:ed25519:MCow...fQxgpU"
       },
       "scope": "whisper",
       "constraints": {
         "min_security_tier": "C",
         "not_before": "2026-01-01T00:00:00Z",
         "expires_at": "2027-01-01T00:00:00Z",
         "audience": ["whisper.client", "whisper.mailbox", "whisper.relay"],
         "allowed_ops": [
           "whisper_msg_sign",
           "whisper_handshake",
           "whisper_card_sign"
         ]
       },
      "sig": {
         "alg": "secp256k1_eip191",
         "address": "0x983...DE7Bb",
         "value": "0x2fc4...2a961b"
       }
     }
   },
 
   "card": {
     "version": 1,
     "updated_at": 1767084329
   },

   "mailboxes": [
     {
       "url": "https://hyacinth-bromidic-cordell.ngrok-free.dev",
       "id": "xZBn...w011",
       "prio": 100
     },
     {
       "url": "http://localhost:8080",
       "id": "xZBncGluWkgUI444GWwmzniqLUqiw011",
       "prio": 10
     }
   ],
 
   "capabilities": {
     "multi_mailbox": false,
     "pow": false,
     "nfc_pairing": false
   }
 }
```

### **2. Encryption Layer (Double Ratchet)**

**Session Initialization (X3DH)**
```
Alice (Initiator)              Bob (Responder)
─────────────────              ───────────────

Identity Key: IK_A             Identity Key: IK_B
Ephemeral Key: EK_A            

DH1 = ECDH(IK_A, IK_B)
DH2 = ECDH(EK_A, IK_B)

Root Key = HKDF(DH1 || DH2, "WhisperX3DHRootKey")

─────────────────────────────────────────────→
    Encrypted Message + EK_A (public)
```

**Message Encryption**
```
For each message:

1. DH Ratchet (if direction changed)
   - Generate new ephemeral key pair
   - Derive new root key: RK, CK = KDF_RK(RK, DH_output)

2. Symmetric Ratchet
   - Derive message key: MK, CK = KDF_CK(CK)
   
3. Encrypt
   - enc_key, auth_key, iv = HKDF(MK)
   - ciphertext = AES-256-CBC(plaintext, enc_key, iv)
   - mac = HMAC-SHA256(auth_key, header || ciphertext)

4. Build envelope
   - Include: ciphertext, mac, DH public key, message number
   - Sign with Ed25519
```

### **3. Delivery Layer**

**Multi-Provider Architecture**
```javascript
DeliveryManager
  ├─ DHTProvider (priority: 1)
  │   ├─ libp2p node
  │   ├─ Kademlia DHT
  │   └─ put/get operations
  │
  └─ MailboxProvider (priority: 2)
      ├─ HTTP API
      └─ Fallback mechanism
```

**Cascade Strategy**
```
1. Try DHT (primary, free)
   ├─ Success → Done ✅
   └─ Fail → Continue
   
2. Try Mailbox (fallback)
   ├─ Success → Done ✅
   └─ Fail → Error ❌
```

**Message Deduplication**
```javascript
hash = SHA256(from + to + timestamp + ciphertext + mac)

if (seen.has(hash)) {
  // Keep message from higher priority provider
  if (new.priority < existing.priority) {
    replace(existing, new);
  }
}
```

### **4. DHT Storage**

**Key Generation**
```javascript
// Round timestamp to hour for efficient querying
hourTimestamp = floor(timestamp / 3600000) * 3600000

// Generate deterministic key
key = SHA256("whisper-v3:" + recipientENS + ":" + hourTimestamp)
```

**Storage**
```javascript
// Store in DHT
await dht.put(key, encrypted_envelope)

// TTL: 48 hours (configurable)
```

**Retrieval**
```javascript
// Query 48 hours of hourly buckets
for (hour in last_48_hours) {
  key = generateKey(myENS, hour)
  message = await dht.get(key)
  if (message) messages.push(message)
}
```

### **5. Session Management**

**Session Storage**
```
$SECRETS_ROOT/users/alice/sessions/
  ├─ alice.wspr.f3nixid.eth__bob.wspr.f3nixid.eth.json
  └─ alice.wspr.f3nixid.eth__charlie.wspr.f3nixid.eth.json
```

**Session State**
```json
{
  "dhRatchet": {
    "rootKey": [...],
    "localKeyPair": {...},
    "remotePublicKey": [...]
  },
  "sendingChain": {
    "chainKey": [...],
    "messageNumber": 5
  },
  "receivingChain": {
    "chainKey": [...],
    "messageNumber": 3
  },
  "skippedMessageKeys": []
}
```

## Data Flow

### **Sending a Message**
```
1. User: "Hello Bob!"
   ↓
2. Load/create session with Bob
   ↓
3. Encrypt with Double Ratchet
   → ciphertext, mac, header
   ↓
4. Build envelope v2.0
   → Add timestamp, from, to
   ↓
5. Sign with Ed25519
   → Add signature
   ↓
6. DeliveryManager.send()
   → Try DHT → Try Mailbox
   ↓
7. Return results
   → {dht: success, latency: 138ms}
```

### **Receiving Messages**
```
1. DeliveryManager.receive()
   ↓
2. Query all providers in parallel
   → DHT: 48 time slots
   → Mailbox: poll API
   ↓
3. Deduplicate messages
   → SHA256 hash of content
   ↓
4. For each message:
   - Verify Ed25519 signature
   - Load/create session
   - Decrypt with Double Ratchet
   - Return plaintext
   ↓
5. Acknowledge mailbox messages
   → Delete from server
```

## Security Considerations

### **Forward Secrecy**

Each message uses a unique key derived from a ratcheting chain. Compromise of current keys does NOT reveal past messages.

### **Post-Compromise Security**

DH ratchet updates with each direction change. After compromise, fresh DH exchange re-establishes security.

### **Metadata Leakage**

**Current exposure:**
- Mailbox sees: sender ENS, recipient ENS, message size, timestamp
- DHT sees: query patterns, message locations

**Future mitigations:**
- Sealed Sender (hide sender from mailbox)
- Padding (constant message sizes)
- Timing obfuscation (random delays)

## Performance Optimization

### **Key Caching**
- Sessions cached in memory during runtime
- Avoid disk I/O on every message

### **Batch Operations**
- Query DHT in parallel (48 time slots)
- Deduplicate before decryption

### **Lazy Initialization**
- DHT node starts only when needed
- Bootstrap connection on-demand

## Failure Modes

### **DHT Node Offline**
→ Fallback to mailbox (seamless)

### **Mailbox Down**
→ DHT still works (partial degradation)

### **Session Desync**
→ Skipped message key handling (future)

### **Key Compromise**
→ Forward secrecy protects past messages
→ Post-compromise security restores future security

---

**Last Updated**: January 9, 2026
