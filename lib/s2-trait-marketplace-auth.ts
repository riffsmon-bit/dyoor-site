export type TraitMarketplaceQuoteAuthorization = {
  wallet: string;
  tokenId: string | number;
  listingId: string;
  traitType: string;
  traitValue: string;
  paymentMode: string;
  timestamp: string;
  nonce: string;
};

export type TraitMarketplacePurchaseAuthorization = {
  wallet: string;
  tokenId: string | number;
  quoteId: string;
  listingId: string;
  traitType: string;
  traitValue: string;
  paymentMode: string;
  costLabel: string;
  costRaw: string;
  expiresAt: string;
  nonce: string;
};

export function traitMarketplaceQuoteAuthorizationMessage(input: TraitMarketplaceQuoteAuthorization) {
  return [
    "DYOOR Trait Marketplace Quote",
    `Wallet: ${input.wallet.toLowerCase()}`,
    `Token ID: ${String(input.tokenId)}`,
    `Listing: ${input.listingId}`,
    `Trait: ${input.traitType}`,
    `Value: ${input.traitValue}`,
    `Payment: ${input.paymentMode}`,
    `Timestamp: ${input.timestamp}`,
    `Nonce: ${input.nonce}`,
  ].join("\n");
}
export function traitMarketplacePurchaseAuthorizationMessage(input: TraitMarketplacePurchaseAuthorization) {
  return [
    "DYOOR Trait Marketplace Purchase",
    `Wallet: ${input.wallet.toLowerCase()}`,
    `Token ID: ${String(input.tokenId)}`,
    `Quote ID: ${input.quoteId}`,
    `Listing: ${input.listingId}`,
    `Trait: ${input.traitType}`,
    `Value: ${input.traitValue}`,
    `Payment: ${input.paymentMode}`,
    `Cost: ${input.costLabel}`,
    `CostRaw: ${input.costRaw}`,
    `Expires At: ${input.expiresAt}`,
    `Nonce: ${input.nonce}`,
  ].join("\n");
}
