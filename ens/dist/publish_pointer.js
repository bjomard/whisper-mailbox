import { ethers } from "ethers";
import { ENS_REGISTRY_ABI, ENS_REGISTRY_ADDR, RESOLVER_ABI, KEYS } from "./_ens_abis.js";
const name = process.argv[2];
const uri = process.argv[3];
const sha256 = process.argv[4];
const sig = process.argv[5];
if (!name || !uri || !sha256 || !sig) {
    console.error("Usage: publish_pointer.ts <name> <uri> <sha256> <sig>");
    process.exit(2);
}
const rpc = process.env.RPC_URL;
const pk = process.env.SIGNER_PRIVATE_KEY;
const resolverAddr = process.env.PUBLIC_RESOLVER;
if (!rpc)
    throw new Error("Missing RPC_URL");
if (!pk)
    throw new Error("Missing SIGNER_PRIVATE_KEY");
if (!resolverAddr)
    throw new Error("Missing PUBLIC_RESOLVER");
const provider = new ethers.JsonRpcProvider(rpc);
const wallet = new ethers.Wallet(pk, provider);
const signerAddr = await wallet.getAddress();
const node = ethers.namehash(name);
// Ensure resolver set (safe no-op if already set)
const registry = new ethers.Contract(ENS_REGISTRY_ADDR, ENS_REGISTRY_ABI, wallet);
const currentResolver = await registry.resolver(node);
if (currentResolver.toLowerCase() !== resolverAddr.toLowerCase()) {
    const tx = await registry.setResolver(node, resolverAddr);
    await tx.wait();
}
// Write records
const resolver = new ethers.Contract(resolverAddr, RESOLVER_ABI, wallet);
await (await resolver.setText(node, KEYS.ver, "1")).wait();
await (await resolver.setText(node, KEYS.uri, uri)).wait();
await (await resolver.setText(node, KEYS.sha256, sha256)).wait();
await (await resolver.setText(node, KEYS.sig, sig)).wait();
await (await resolver.setText(node, KEYS.signer, signerAddr)).wait();
console.log(JSON.stringify({ name, uri, sha256, signer: signerAddr, ok: true }, null, 2));
