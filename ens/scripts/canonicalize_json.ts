
import fs from "node:fs";
import crypto from "node:crypto";
import { canonicalStringify } from "./_canonical_json.js";

const file = process.argv[2];
if (!file) {
  console.error("Usage: canonicalize_json.ts <input.json>");
  process.exit(2);
}

function b64uToBuf(s: string): Buffer {
  s = (s || "").trim();
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function mustKeyTypeFromSpkiB64u(
  spki_b64u: string,
  expectedType: "x25519" | "ed25519",
  field: string
) {
  if (typeof spki_b64u !== "string" || spki_b64u.length < 16) {
    throw new Error(`${field}: missing/too short`);
  }

  let der: Buffer;
  try {
    der = b64uToBuf(spki_b64u);
  } catch {
    throw new Error(`${field}: not valid base64url`);
  }

  let key: crypto.KeyObject;
  try {
    key = crypto.createPublicKey({ key: der, format: "der", type: "spki" });
  } catch (e: any) {
    throw new Error(`${field}: invalid SPKI DER (${e?.message ?? e})`);
  }

  const typ = key.asymmetricKeyType; // "x25519" | "ed25519" | ...
  if (typ !== expectedType) {
    throw new Error(`${field}: expected ${expectedType} but got ${typ}`);
  }
}

function validateContactCard(card: any) {
  if (!card || typeof card !== "object") throw new Error("ContactCard: not an object");
  if (card.v !== 1) throw new Error(`ContactCard.v: expected 1, got ${card.v}`);
  if (card.service !== "whisper") throw new Error(`ContactCard.service: expected "whisper", got ${card.service}`);
  if (typeof card.handle !== "string" || !card.handle.trim()) throw new Error("ContactCard.handle: missing");

  if (!card.pub || typeof card.pub !== "object") throw new Error("ContactCard.pub: missing");
  mustKeyTypeFromSpkiB64u(card.pub.x25519_spki_b64u, "x25519", "pub.x25519_spki_b64u");
  mustKeyTypeFromSpkiB64u(card.pub.ed25519_spki_b64u, "ed25519", "pub.ed25519_spki_b64u");

  if (card.pub.x25519_spki_b64u === card.pub.ed25519_spki_b64u) {
    throw new Error("pub: x25519 and ed25519 keys must differ");
  }

  if (!Array.isArray(card.mailboxes) || card.mailboxes.length === 0) {
    throw new Error("mailboxes: must be a non-empty array");
  }
  for (const [i, mb] of card.mailboxes.entries()) {
    if (!mb || typeof mb !== "object") throw new Error(`mailboxes[${i}]: not an object`);
    if (typeof mb.url !== "string" || !/^https?:\/\//.test(mb.url)) throw new Error(`mailboxes[${i}].url: invalid`);
    if (typeof mb.id !== "string" || !mb.id.trim()) throw new Error(`mailboxes[${i}].id: missing`);
    if (!Number.isInteger(mb.prio)) throw new Error(`mailboxes[${i}].prio: must be integer`);
  }

  if (typeof card.updated !== "number" || !Number.isFinite(card.updated) || card.updated <= 0) {
    throw new Error("updated: must be a unix timestamp (seconds) > 0");
  }
}

const raw = fs.readFileSync(file, "utf8");
const obj = JSON.parse(raw);

// ✅ Validation (fail fast)
validateContactCard(obj);

// ✅ Canonical output
process.stdout.write(canonicalStringify(obj));

