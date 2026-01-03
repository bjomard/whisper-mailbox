import { ethers } from "ethers";
import { ENS_REGISTRY_ABI, ENS_REGISTRY_ADDR, RESOLVER_ABI, KEYS } from "./_ens_abis.js";

const COMPROMISED = "0x521CbC77196B7B69A9d3D8c7e3D50887e7046Bad".toLowerCase();
const name = process.argv[2];
const WS = {
  ver: "f3nix.wspr.ver",
  uri: "f3nix.wspr.uri",
  sha256: "f3nix.wspr.sha256",
  sig: "f3nix.wspr.sig",
  signer: "f3nix.wspr.signer",
  publisher: "f3nix.wspr.publisher",
};

if (!name) {
  console.error("Usage: resolve_verify.ts <name>");
  process.exit(2);
}

const rpc = process.env.RPC_URL;
if (!rpc) throw new Error("Missing RPC_URL");

const provider = new ethers.JsonRpcProvider(rpc);

// ENS namehash
const node = ethers.namehash(name);

// Read resolver from registry
const registry = new ethers.Contract(ENS_REGISTRY_ADDR, ENS_REGISTRY_ABI, provider);
const resolverAddr: string = await registry.resolver(node);
if (!resolverAddr || resolverAddr === ethers.ZeroAddress) {
  throw new Error(`No resolver set for ${name}`);
}

const resolver = new ethers.Contract(resolverAddr, RESOLVER_ABI, provider);

const ver = (await resolver.text(node, WS.ver)) || (await resolver.text(node, KEYS.ver));
const uri = (await resolver.text(node, WS.uri)) || (await resolver.text(node, KEYS.uri));
const sha256 = (await resolver.text(node, WS.sha256)) || (await resolver.text(node, KEYS.sha256));
const sig = (await resolver.text(node, WS.sig)) || (await resolver.text(node, KEYS.sig));
const signer = (await resolver.text(node, WS.signer)) || (await resolver.text(node, KEYS.signer));
const publisher = (await resolver.text(node, WS.publisher)) || "";

//const resolver = new ethers.Contract(resolverAddr, RESOLVER_ABI, provider);
//const ver = await resolver.text(node, KEYS.ver);
//const uri = await resolver.text(node, KEYS.uri);
//const sha256 = await resolver.text(node, KEYS.sha256);
//const sig = await resolver.text(node, KEYS.sig);
//const signer = await resolver.text(node, KEYS.signer);

if (ver !== "1") throw new Error(`Unsupported ver='${ver}'`);
if (!uri) throw new Error("Missing uri");
if (!sha256?.startsWith("0x") || sha256.length !== 66) throw new Error(`Invalid sha256='${sha256}'`);
if (!sig?.startsWith("0x")) throw new Error(`Invalid sig='${sig}'`);
if (!signer?.startsWith("0x") || signer.length !== 42) throw new Error(`Invalid signer='${signer}'`);

// Fetch JSON
const res = await fetch(uri, { redirect: "follow" });
if (!res.ok) throw new Error(`HTTP ${res.status} for ${uri}`);
const jsonText = await res.text();

// Hash fetched JSON bytes (assumes you serve canonical JSON as-is)
const fetchedHash = ethers.sha256(ethers.toUtf8Bytes(jsonText));
if (fetchedHash.toLowerCase() !== sha256.toLowerCase()) {
  throw new Error(`Hash mismatch: ens=${sha256} fetched=${fetchedHash}`);
}

// Verify signature over sha256 string
const recovered = ethers.verifyMessage(ethers.getBytes(sha256), sig);
if (recovered.toLowerCase() !== signer.toLowerCase()) {
  throw new Error(`Signature mismatch: expected=${signer} recovered=${recovered}`);
}

console.log(JSON.stringify({
  name,
  resolver: resolverAddr,
  ver,
  uri,
  sha256,
  signer,
  ok: true
}, null, 2));
