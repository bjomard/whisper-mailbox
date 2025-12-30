import fs from "node:fs";
import { ethers } from "ethers";
import { canonicalStringify } from "./_canonical_json.js";

const pk = process.env.SIGNER_PRIVATE_KEY;
if (!pk) throw new Error("Missing SIGNER_PRIVATE_KEY");

const inFile = process.argv[2];
const outFile = process.argv[3];

if (!inFile) {
  console.error("Usage: sign_profile.ts <profile.json> [out.signed.json]");
  process.exit(2);
}

const profileObj = JSON.parse(fs.readFileSync(inFile, "utf8"));
const canonical = canonicalStringify(profileObj);

// sha256 over canonical JSON bytes
const bytes = ethers.toUtf8Bytes(canonical);
const sha256 = ethers.sha256(bytes);

// EIP-191 signature over the *hash string* (stable)
const wallet = new ethers.Wallet(pk);
const sig = await wallet.signMessage(ethers.getBytes(sha256));

const signer = await wallet.getAddress();

const result = {
  canonical,          // keep for debugging (optional)
  sha256,
  sig,
  signer
};

const output = JSON.stringify(result, null, 2);

if (outFile) fs.writeFileSync(outFile, output);
else process.stdout.write(output);
