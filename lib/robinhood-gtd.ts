export const ROBINHOOD_GTD_CAMPAIGN = "hoodyoor-robinhood-gtd-v1";
export const ROBINHOOD_GTD_CHAIN_ID = 4663;
export const ROBINHOOD_GTD_CHAIN_NAME = "Robinhood Chain";
export const ROBINHOOD_GTD_COLLECTION_NAME = "HoodYØØR";
export const ROBINHOOD_GTD_SIGNATURE_TTL_MS = 10 * 60 * 1000;

export function normalizeRobinhoodGtdWallet(value: unknown) {
  const wallet = String(value || "").trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(wallet) ? wallet : "";
}

export function robinhoodGtdConfirmationMessage({
  wallet,
  issuedAt,
  nonce,
}: {
  wallet: string;
  issuedAt: string;
  nonce: string;
}) {
  const normalizedWallet = normalizeRobinhoodGtdWallet(wallet);

  return [
    `${ROBINHOOD_GTD_COLLECTION_NAME} GTD Wallet Confirmation`,
    `I am confirming this wallet for the ${ROBINHOOD_GTD_COLLECTION_NAME} GTD list.`,
    "This signature is free and does not authorize a transaction, token approval, or transfer.",
    `Wallet: ${normalizedWallet}`,
    `Campaign: ${ROBINHOOD_GTD_CAMPAIGN}`,
    `Destination Chain: ${ROBINHOOD_GTD_CHAIN_NAME} (${ROBINHOOD_GTD_CHAIN_ID})`,
    `Issued At: ${issuedAt}`,
    `Nonce: ${nonce}`,
  ].join("\n");
}
