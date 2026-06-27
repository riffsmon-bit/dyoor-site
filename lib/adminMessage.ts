export type AdminAction = "snapshot" | "energy-airdrop";

export function adminMessage(wallet: string, timestamp: string, nonce: string, action: AdminAction) {
  return [
    "DYOOR Admin Command",
    `Action: ${action}`,
    `Wallet: ${wallet}`,
    `Timestamp: ${timestamp}`,
    `Nonce: ${nonce}`,
  ].join("\n");
}
