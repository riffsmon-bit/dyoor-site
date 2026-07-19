export type AdminAction =
  | "snapshot"
  | "energy-airdrop"
  | "energy-reconciliation"
  | "energy-index"
  | "metadata"
  | "airdrop";

export function adminMessage(wallet: string, timestamp: string, nonce: string, action: AdminAction) {
  return [
    "DYOOR Admin Command",
    `Action: ${action}`,
    `Wallet: ${wallet}`,
    `Timestamp: ${timestamp}`,
    `Nonce: ${nonce}`,
  ].join("\n");
}

export function adminAirdropMessage({
  chainId,
  contractAddress,
  expiresAt,
  nonce,
  timestamp,
  wallet,
}: {
  chainId: string;
  contractAddress: string;
  expiresAt: string;
  nonce: string;
  timestamp: string;
  wallet: string;
}) {
  return [
    "DYOOR Admin Command",
    "Action: airdrop",
    `Wallet: ${wallet}`,
    `Chain ID: ${chainId}`,
    `Contract: ${contractAddress}`,
    `Issued At: ${timestamp}`,
    `Expires At: ${expiresAt}`,
    `Nonce: ${nonce}`,
  ].join("\n");
}
