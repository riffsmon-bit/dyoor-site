const PUBLIC_IPFS_GATEWAYS = [
  // Keep the collection's existing pin online until our gateway is verified.
  "https://jade-efficient-beaver-697.mypinata.cloud",
  "https://ipfs.io",
  "https://dweb.link",
] as const;

function cleanGateway(value: string) {
  return value.trim().replace(/\/+$/, "").replace(/\/ipfs$/i, "");
}

export function configuredIpfsGateways() {
  const configured = [
    process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL || "",
    process.env.NEXT_PUBLIC_IPFS_GATEWAY || "",
    process.env.NEXT_PUBLIC_PINATA_GATEWAY_URL || "",
    typeof window === "undefined" ? process.env.IPFS_GATEWAY_URL || "" : "",
    typeof window === "undefined" ? process.env.PINATA_GATEWAY_URL || "" : "",
    ...PUBLIC_IPFS_GATEWAYS,
  ].map(cleanGateway).filter((value) => /^https:\/\//i.test(value));

  return Array.from(new Set(configured));
}

export function ipfsContentPath(value: unknown) {
  const uri = String(value || "").trim();
  if (uri.startsWith("ipfs://")) return uri.slice("ipfs://".length).replace(/^ipfs\//, "");
  const match = uri.match(/\/ipfs\/(.+)$/i);
  return match?.[1] || "";
}

export function ipfsGatewayUrls(value: unknown) {
  const uri = String(value || "").trim();
  const path = ipfsContentPath(uri);
  if (!path) return uri ? [uri] : [];
  return configuredIpfsGateways().map((gateway) => `${gateway}/ipfs/${path}`);
}

export function ipfsGatewayUrl(value: unknown) {
  return ipfsGatewayUrls(value)[0] || "";
}
