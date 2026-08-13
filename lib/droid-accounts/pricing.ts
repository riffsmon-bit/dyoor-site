export type DroidPriceQuote = {
  asset: string;
  priceUsd: null;
  status: "unavailable";
  source: null;
  observedAt: null;
};

/**
 * V1 has no trusted price source. Keeping this boundary explicit prevents a
 * balance reader or UI component from silently inventing a price.
 */
export function unavailableDroidPrice(asset: string): DroidPriceQuote {
  return {
    asset,
    priceUsd: null,
    status: "unavailable",
    source: null,
    observedAt: null,
  };
}
