#!/usr/bin/env node
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sodium = require("libsodium-wrappers"); // force CJS entry

await sodium.ready;

// ===== generate keys =====
const ed = sodium.crypto_sign_keypair(); // ed25519
const x  = sodium.crypto_box_keypair();  // x25519

// ===== base64url helper =====
const b64u = (buf) =>
  Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

// ===== output =====
const out = {
  usage: "whisper",
  generated_at: new Date().toISOString(),

  public: {
    ed25519_spki_b64u: b64u(ed.publicKey),
    x25519_spki_b64u:  b64u(x.publicKey),
  },

  private: {
    ed25519_sk_b64u: b64u(ed.privateKey),
    x25519_sk_b64u:  b64u(x.privateKey),
  }
};

// ===== destination =====
const filename = process.argv[2] || "whisper.keys.json";

// ⚠️ protection basique contre overwrite accidentel
if (fs.existsSync(filename)) {
  console.error(`❌ File already exists: ${filename}`);
  console.error(`   Refusing to overwrite keys.`);
  process.exit(1);
}

fs.writeFileSync(filename, JSON.stringify(out, null, 2), { mode: 0o600 });

console.log(`✅ Keys generated: ${filename}`);
console.log(`⚠️  KEEP THIS FILE SECRET (contains private keys)`);

