# 🚀 Whisper Quick Start

## 5-Minute Setup

### **1. Install**
```bash
git clone <repo>
cd whisper-mailbox
npm install
export SECRETS_ROOT="$HOME/F3NIX-Secrets/whisper"
```

### **2. Create User**
```bash
node scripts/whisper_keygen.js alice
node scripts/whisper_mailbox_setup.js alice
```

### **3. Send Message**
```bash
node scripts/whisper_send_v3.js alice bob.wspr.f3nixid.eth "Hello!"
```

### **4. Receive Messages**
```bash
node scripts/whisper_receive_v3.js bob
```

## Common Commands

| Task | Command |
|------|---------|
| **Send** | `node scripts/whisper_send_v3.js <from> <to> "<message>"` |
| **Receive** | `node scripts/whisper_receive_v3.js <user>` |
| **Test DHT** | `node test/test-delivery-manager.js` |
| **Full test** | `./test/test-full-conversation.sh` |

## Architecture at a Glance
```
Message Flow:
  User → Encrypt (Double Ratchet)
       → Sign (Ed25519)
       → Delivery Manager
         ├─ Try DHT (free, decentralized)
         └─ Fallback Mailbox
       → Network
       → Recipient Delivery Manager
       → Verify signature
       → Decrypt
       → User
```

## Configuration
```bash
# Environment variables
export SECRETS_ROOT="$HOME/F3NIX-Secrets/whisper"
export RPC_URL="https://1rpc.io/eth"
export MAILBOX_URLS="http://localhost:8080"
```

## Troubleshooting

**DHT not working?**
- Normal without bootstrap nodes
- Mailbox fallback handles it automatically

**Messages not received?**
- Check mailbox is running
- Verify ENS resolution works
- Check recipient keys exist

**Session errors?**
- Delete sessions: `rm -rf $SECRETS_ROOT/users/*/sessions`
- Re-establish on next message

## Security Tips

✅ **DO:**
- Keep private keys secure (`$SECRETS_ROOT/users/*/whisper.keys.json`)
- Verify recipient ENS before first message
- Use unique ENS names per identity

❌ **DON'T:**
- Share private keys
- Commit secrets to git
- Reuse keys across systems

## Performance

| Metric | Value |
|--------|-------|
| DHT storage | 100-150ms |
| Mailbox | 50-150ms |
| Encryption | <10ms |
| Signatures | <5ms |

## Next Steps

1. Read [WHISPER_ONBOARDING.md](WHISPER_ONBOARDING.md) for full setup
2. Check [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for technical details
3. Run tests in `test/` directory

---

**Need help?** Check GitHub issues or documentation.
