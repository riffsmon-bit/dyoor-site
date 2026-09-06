import type { DroidPriceQuote } from "@/lib/droid-accounts/pricing";

export type DroidAssetValuation = {
  rawBalance: string;
  price: DroidPriceQuote;
  valueUsd: null;
  status: "unavailable";
};

export type DroidPortfolioValuation = {
  valueUsd: null;
  status: "unavailable";
};

export function valueDroidAsset(
  rawBalance: string,
  price: DroidPriceQuote,
): DroidAssetValuation {
  return {
    rawBalance,
    price,
    valueUsd: null,
    status: "unavailable",
  };
}

export function totalDroidPortfolio(
  assets: readonly DroidAssetValuation[],
): DroidPortfolioValuation {
  void assets;
  return { valueUsd: null, status: "unavailable" };
}
