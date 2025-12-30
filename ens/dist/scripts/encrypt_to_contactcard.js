import fs from "node:fs";
import sodium from "libsodium-wrappers";
function b64uToBytes(b64u) {
    // pad + convert URL-safe to standard
    let s = b64u.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4 !== 0)
        s += "=";
    return new Uint8Array(Buffer.from(s, "base64"));
}
function bytesToB64u(bytes) {
    return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
/**
 * Minimal SPKI parser for X25519:
 * Extract last 32 bytes from SubjectPublicKey BIT STRING.
 * Works for standard X25519 SPKI (RFC 8410).
 */
function x25519PkFromSpkiDer(der) {
    // Find BIT STRING tag 0x03; then length; then unused-bits byte; then key bytes.
    // We'll scan for 0x03 and take the LAST 32 bytes of the whole structure as a fallback.
    for (let i = 0; i < der.length - 35; i++) {
        if (der[i] === 0x03) {
            // length may be short/long; parse length
            let len = der[i + 1];
            let off = i + 2;
            if (len & 0x80) {
                const n = len & 0x7f;
                len = 0;
                for (let k = 0; k < n; k++)
                    len = (len << 8) | der[off + k];
                off += n;
            }
            const unusedBits = der[off];
            const bitString = der.slice(off + 1, off + len);
            // unusedBits should be 0
            if (unusedBits === 0 && bitString.length >= 32) {
                return bitString.slice(bitString.length - 32);
            }
        }
    }
    // fallback: last 32 bytes
    return der.slice(der.length - 32);
}
async function readJsonMaybeUrl(p) {
    if (/^https?:\/\//i.test(p)) {
        const res = await fetch(p);
        if (!res.ok)
            throw new Error(`HTTP ${res.status} for ${p}`);
        return await res.json();
    }
    return JSON.parse(fs.readFileSync(p, "utf8"));
}
async function main() {
    const [cardPathOrUrl, toHandle, fromHandle, ...msgParts] = process.argv.slice(2);
    if (!cardPathOrUrl || !toHandle || !fromHandle || msgParts.length === 0) {
        console.error("Usage: encrypt_to_contactcard.ts <contactcard_path_or_url> <to_handle> <from_handle> <plaintext...>");
        process.exit(2);
    }
    const plaintext = msgParts.join(" ");
    await sodium.ready;
    const card = (await readJsonMaybeUrl(cardPathOrUrl));
    const pub = card.pub || {};
    let pkRaw = null;
    if (pub.x25519_pk_b64u) {
        pkRaw = b64uToBytes(pub.x25519_pk_b64u);
    }
    else if (pub.x25519_spki_b64u) {
        const der = b64uToBytes(pub.x25519_spki_b64u);
        pkRaw = x25519PkFromSpkiDer(der);
    }
    if (!pkRaw || pkRaw.length !== 32) {
        throw new Error("ContactCard missing valid X25519 public key (pub.x25519_spki_b64u or pub.x25519_pk_b64u)");
    }
    const ct = sodium.crypto_box_seal(sodium.from_string(plaintext), pkRaw);
    const envelope = {
        v: 1,
        alg: "x25519-sealedbox",
        to: toHandle,
        from: fromHandle,
        kid: `${toHandle}#x25519-1`,
        ct_b64: bytesToB64u(ct),
    };
    process.stdout.write(JSON.stringify(envelope));
}
main().catch((e) => {
    console.error(String(e?.stack || e));
    process.exit(1);
});
