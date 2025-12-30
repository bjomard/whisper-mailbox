export const ENS_REGISTRY_ADDR = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
// Minimal ENS Registry ABI
export const ENS_REGISTRY_ABI = [
    "function owner(bytes32 node) view returns (address)",
    "function resolver(bytes32 node) view returns (address)",
    "function setSubnodeOwner(bytes32 node, bytes32 label, address owner) returns (bytes32)",
    "function setResolver(bytes32 node, address resolver)"
];
// Minimal PublicResolver ABI (text records)
export const RESOLVER_ABI = [
    "function setText(bytes32 node, string key, string value)",
    "function text(bytes32 node, string key) view returns (string)"
];
export const KEYS = {
    ver: "f3nix.wspr.ver",
    uri: "f3nix.wspr.uri",
    sha256: "f3nix.wspr.sha256",
    sig: "f3nix.wspr.sig",
    signer: "f3nix.wspr.signer"
};
