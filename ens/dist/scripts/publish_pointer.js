import { ethers } from "ethers";
import { ENS_REGISTRY_ABI, ENS_REGISTRY_ADDR, RESOLVER_ABI, KEYS, } from "./_ens_abis.js";
const WS = {
    ver: "f3nix.wspr.ver",
    uri: "f3nix.wspr.uri",
    sha256: "f3nix.wspr.sha256",
    sig: "f3nix.wspr.sig",
    publisher: "f3nix.wspr.publisher",
    root_signer: "f3nix.wspr.root_signer",
    signer: "f3nix.wspr.signer",
};
function usage() {
    console.error("Usage: publish_pointer.ts <name> <uri> <sha256> <sig> <root_signer>");
    process.exit(2);
}
const name = process.argv[2];
const uri = process.argv[3];
const sha256 = process.argv[4];
const sig = process.argv[5];
const rootSigner = process.argv[6];
if (!name || !uri || !sha256 || !sig || !rootSigner)
    usage();
const rpc = process.env.RPC_URL || process.env.ETH_RPC_URL;
if (!rpc)
    throw new Error("Missing RPC_URL (or ETH_RPC_URL)");
const pk = process.env.PUBLISHER_PRIVATE_KEY ||
    process.env.SIGNER_PRIVATE_KEY ||
    process.env.PRIVATE_KEY;
if (!pk)
    throw new Error("Missing PUBLISHER_PRIVATE_KEY (or SIGNER_PRIVATE_KEY)");
if (!sha256.startsWith("0x") || sha256.length !== 66) {
    throw new Error(`Invalid sha256='${sha256}'`);
}
if (!sig.startsWith("0x")) {
    throw new Error(`Invalid sig='${sig}'`);
}
if (!rootSigner.startsWith("0x") || rootSigner.length !== 42) {
    throw new Error(`Invalid root_signer='${rootSigner}'`);
}
const provider = new ethers.JsonRpcProvider(rpc);
const wallet = new ethers.Wallet(pk, provider);
const publisherAddr = await wallet.getAddress();
const node = ethers.namehash(name);
const registry = new ethers.Contract(ENS_REGISTRY_ADDR, ENS_REGISTRY_ABI, provider);
// SAFETY: never overwrite resolver
const resolverAddr = await registry.resolver(node);
if (!resolverAddr || resolverAddr === ethers.ZeroAddress) {
    throw new Error(`No resolver set for ${name}. Refusing to set resolver automatically (safety).`);
}
// Optional: pin expected resolver
const expectedResolver = (process.env.EXPECTED_RESOLVER || "").toLowerCase();
if (expectedResolver && resolverAddr.toLowerCase() !== expectedResolver) {
    throw new Error(`Resolver mismatch: expected=${expectedResolver} got=${resolverAddr}`);
}
const resolver = new ethers.Contract(resolverAddr, RESOLVER_ABI, wallet);
async function tx(p) {
    const t = await p;
    const r = await t.wait();
    return r;
}
// A-model keys
await tx(resolver.setText(node, WS.uri, uri));
await tx(resolver.setText(node, WS.sha256, sha256));
await tx(resolver.setText(node, WS.sig, sig));
await tx(resolver.setText(node, WS.ver, "1"));
await tx(resolver.setText(node, WS.publisher, publisherAddr));
await tx(resolver.setText(node, WS.root_signer, rootSigner));
await tx(resolver.setText(node, WS.signer, publisherAddr)); // signer = hot key (sig over sha)
// Legacy keys (backward compat)
await tx(resolver.setText(node, KEYS.uri, uri));
await tx(resolver.setText(node, KEYS.sha256, sha256));
await tx(resolver.setText(node, KEYS.sig, sig));
await tx(resolver.setText(node, KEYS.ver, "1"));
await tx(resolver.setText(node, KEYS.signer, publisherAddr));
console.log(JSON.stringify({
    name,
    resolver: resolverAddr,
    uri,
    sha256,
    root_signer: rootSigner,
    publisher: publisherAddr,
    signer: publisherAddr,
    ok: true,
}, null, 2));
