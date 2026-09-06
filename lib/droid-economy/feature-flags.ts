import type { DroidEconomyFeatureFlags } from "@/lib/droid-economy/types";

function enabled(value: string | undefined, fallback: boolean) {
  if (value === undefined || value.trim() === "") return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

/// Public product flags. Contract authorization never relies on these values.
export function droidEconomyFeatureFlags(): DroidEconomyFeatureFlags {
  return {
    droidWalletsEnabled: enabled(process.env.NEXT_PUBLIC_DROID_WALLETS_ENABLED, true),
    droidPortfoliosEnabled: enabled(process.env.NEXT_PUBLIC_DROID_PORTFOLIOS_ENABLED, true),
    droidRewardsEnabled: enabled(process.env.NEXT_PUBLIC_DROID_REWARDS_ENABLED, false),
    droidStrategiesEnabled: enabled(process.env.NEXT_PUBLIC_DROID_STRATEGIES_ENABLED, false),
    monadDroidsEnabled: enabled(process.env.NEXT_PUBLIC_MONAD_DROIDS_ENABLED, false),
    ownerTradingEnabled: enabled(
      process.env.NEXT_PUBLIC_MONAD_DROID_OWNER_TRADING_ENABLED,
      false,
    ),
    autonomousTradingEnabled: false,
    robinhoodDroidsEnabled: enabled(process.env.NEXT_PUBLIC_ROBINHOOD_DROIDS_ENABLED, false),
    sharedTreasuryEnabled: enabled(process.env.NEXT_PUBLIC_SHARED_TREASURY_ENABLED, false),
    // These gates are deliberately code-locked until separately approved releases.
    secondaryRevenueDistributionEnabled: false,
    crossChainBridgeEnabled: false,
    droidAgentEnabled: false,
  };
}
