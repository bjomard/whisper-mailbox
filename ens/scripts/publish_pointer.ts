import { ethers } from "ethers";
import { ENS_REGISTRY_ABI, ENS_REGISTRY_ADDR, RESOLVER_ABI, KEYS } from "./_ens_abis.js";

const name = process.argv[2];
const uri = process.argv[3];
const sha256 = process.argv[4];
const sig = process.argv[5];
const rootSigner = process.argv[6];

if (!name || !uri || !sha256 || !sig || !rootSigner) {
  console.error("Usage: publish_pointer.ts <name> <uri> <sha256> <sig> <root_signer>");
  process.exit(2);
}

const rpc = process.env.RPC_URL;
const pk = process.env.SIGNER_PRIVATE_KEY;
const resolverAddr = process.env.PUBLIC_RESOLVER;

if (!rpc) throw new Error("Missing RPC_URL");
if (!pk) throw new Error("Missing SIGNER_PRIVATE_KEY");
if (!resolverAddr) throw new Error("Missing PUBLIC_RESOLVER");

const provider = new ethers.JsonRpcProvider(rpc);
const wallet = new ethers.Wallet(pk, provider);
const signerAddr = await wallet.getAddress();
const rootSignerAddr = ethers.getAddress(rootSigner); // checksum normalize

const node = ethers.namehash(name);

// Guard rail: NEVER change resolver here.
const STRICT_RESOLVER = (process.env.STRICT_RESOLVER ?? "1") !== "0";

const registry = new ethers.Contract(ENS_REGISTRY_ADDR, ENS_REGISTRY_ABI, wallet);
const currentResolver: string = await registry.resolver(node);

if (currentResolver.toLowerCase() !== resolverAddr.toLowerCase()) {
  const msg =
    `Resolver mismatch for ${name}\n` +
    `- registry.resolver(node) = ${currentResolver}\n` +
    `- PUBLIC_RESOLVER       = ${resolverAddr}\n\n` +
    `Refusing to call setResolver() automatically (to avoid losing records).\n` +
    `Fix: set the resolver once in ENS UI (or manual tx), then rerun.\n` +
    `If you *really* want to bypass, set STRICT_RESOLVER=0 (not recommended).`;
  if (STRICT_RESOLVER) throw new Error(msg);
}


// Write records
const resolverToUse =
  currentResolver && currentResolver !== ethers.ZeroAddress ? currentResolver : resolverAddr;

const resolver = new ethers.Contract(resolverToUse, RESOLVER_ABI, wallet);

// Namespaced keys for Whisper v1 pointers
await (await resolver.setText(node, "f3nix.wspr.ver", "1")).wait();
await (await resolver.setText(node, "f3nix.wspr.uri", uri)).wait();
await (await resolver.setText(node, "f3nix.wspr.sha256", sha256)).wait();
await (await resolver.setText(node, "f3nix.wspr.sig", sig)).wait();
await (await resolver.setText(node, "f3nix.wspr.signer", rootSigner)).wait();
await (await resolver.setText(node, "f3nix.wspr.publisher", signerAddr)).wait();

console.log(
  JSON.stringify(
    { name, resolver: resolverToUse, uri, sha256, root_signer: rootSigner, publisher: signerAddr, ok: true },
    null,
    2
  )
);

console.log(JSON.stringify({ name, uri, sha256, signer: signerAddr, root_signer: rootSignerAddr, ok: true }, null, 2));
