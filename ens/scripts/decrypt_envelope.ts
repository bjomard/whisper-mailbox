import fs from "node:fs";
import sodium from "libsodium-wrappers";

function b64uToBytes(b64u: string): Uint8Array {
  let s = b64u.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4 !== 0) s += "=";
  return new Uint8Array(Buffer.from(s, "base64"));
}

async function readJsonMaybeUrlOrStdin(p?: string): Promise<any> {
  if (!p || p === "-") {
    const buf = fs.readFileSync(0, "utf8");
    return JSON.parse(buf);
  }
  if (/^https?:\/\//i.test(p)) {
    const res = await fetch(p);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${p}`);
    return await res.json();
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function main() {
  const envSk = process.env.WSPR_X25519_SK_B64U;
  if (!envSk) {
    console.error("Missing env WSPR_X25519_SK_B64U (raw 32-byte X25519 secret key, base64url)");
    process.exit(2);
  }

  await sodium.ready;

  const sk = b64uToBytes(envSk);
  if (sk.length !== 32) throw new Error("WSPR_X25519_SK_B64U must decode to 32 bytes");

  // derive pk from sk
  const pk = sodium.crypto_scalarmult_base(sk);

  const envPath = process.argv[2];
  const envelope = await readJsonMaybeUrlOrStdin(envPath);

  if (!envelope || envelope.alg !== "x25519-sealedbox" || !envelope.ct_b64) {
    throw new Error("Not a supported envelope (expected alg=x25519-sealedbox and ct_b64)");
  }

  const ct = b64uToBytes(envelope.ct_b64);
  const pt = sodium.crypto_box_seal_open(ct, pk, sk);
  process.stdout.write(sodium.to_string(pt) + "\n");
}

main().catch((e) => {
  console.error(String(e?.stack || e));
  process.exit(1);
});
