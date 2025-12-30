/**
 * Provision: <alias>.wspr.<root>
 * - creates subnode
 * - sets resolver
 * - (optionally) publishes pointer records later via publish_pointer.ts
 *
 * Usage:
 *   provision_wspr_subdomain.ts <alias> [serviceLabel=wspr]
 */
import { ethers } from "ethers";
import { ENS_REGISTRY_ABI, ENS_REGISTRY_ADDR } from "./_ens_abis.js";
const alias = process.argv[2];
const serviceLabel = process.argv[3] || "wspr";
if (!alias) {
    console.error("Usage: provision_wspr_subdomain.ts <alias> [serviceLabel=wspr]");
    process.exit(2);
}
const rpc = process.env.RPC_URL;
const pk = process.env.SIGNER_PRIVATE_KEY;
const root = process.env.ENS_ROOT;
const resolverAddr = process.env.PUBLIC_RESOLVER;
if (!rpc)
    throw new Error("Missing RPC_URL");
if (!pk)
    throw new Error("Missing SIGNER_PRIVATE_KEY");
if (!root)
    throw new Error("Missing ENS_ROOT");
if (!resolverAddr)
    throw new Error("Missing PUBLIC_RESOLVER");
const provider = new ethers.JsonRpcProvider(rpc);
const wallet = new ethers.Wallet(pk, provider);
const signerAddr = await wallet.getAddress();
const registry = new ethers.Contract(ENS_REGISTRY_ADDR, ENS_REGISTRY_ABI, wallet);
const rootNode = ethers.namehash(root);
const serviceName = `${serviceLabel}.${root}`;
const serviceNode = ethers.namehash(serviceName);
// Ensure <wspr>.<root> exists and is owned by signer (optional but practical)
{
    const labelHash = ethers.id(serviceLabel);
    const tx = await registry.setSubnodeOwner(rootNode, labelHash, signerAddr);
    await tx.wait();
    const tx2 = await registry.setResolver(serviceNode, resolverAddr);
    await tx2.wait();
}
// Now create <alias>.<wspr>.<root>
const fullName = `${alias}.${serviceLabel}.${root}`;
const node = ethers.namehash(fullName);
const aliasLabelHash = ethers.id(alias);
// Set subnode owner to signer (F3NIX provisioning model)
const tx3 = await registry.setSubnodeOwner(serviceNode, aliasLabelHash, signerAddr);
await tx3.wait();
// Ensure resolver set
const tx4 = await registry.setResolver(node, resolverAddr);
await tx4.wait();
console.log(JSON.stringify({
    ok: true,
    fullName,
    node,
    resolver: resolverAddr,
    owner: signerAddr
}, null, 2));
