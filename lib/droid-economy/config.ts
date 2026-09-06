import "server-only";
import { getAddress } from "ethers";
import { getDroidProtocolConfig } from "@/lib/droid-accounts/config";
import { droidEconomyFeatureFlags } from "@/lib/droid-economy/feature-flags";
import type {
  DroidEconomyAddresses,
  DroidEconomyConfig,
} from "@/lib/droid-economy/types";

function optionalAddress(...names: string[]) {
  for (const name of names) {
    const raw = String(process.env[name] || "").trim();
    if (!raw) continue;
    try {
      return getAddress(raw);
    } catch {
      return "";
    }
  }
  return "";
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function serverEnabled(value: string | undefined, fallback: boolean) {
  if (value === undefined || value.trim() === "") return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function strategyOptions(raw: string | undefined): DroidEconomyConfig["strategyOptions"] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const record = value as Record<string, unknown>;
      const strategyId = String(record.strategyId || "");
      const label = String(record.label || "").trim();
      const description = String(record.description || "").trim();
      if (!/^0x[a-fA-F0-9]{64}$/.test(strategyId) || !label) return [];
      return [{ strategyId: strategyId.toLowerCase(), label: label.slice(0, 48), description: description.slice(0, 180) }];
    });
  } catch {
    return [];
  }
}

export function getDroidEconomyConfig(chainId?: number): DroidEconomyConfig {
  const droid = getDroidProtocolConfig(chainId);
  const monad = droid.chainId === 143;
  const prefix = monad ? "MONAD" : "HOODYOOR";
  const addresses: DroidEconomyAddresses = {
    droidRegistry: optionalAddress(
      `${prefix}_ECONOMY_DROID_REGISTRY_ADDRESS`,
      `NEXT_PUBLIC_${prefix}_ECONOMY_DROID_REGISTRY_ADDRESS`,
    ),
    assetRegistry: optionalAddress(
      `${prefix}_ASSET_REGISTRY_ADDRESS`,
      `NEXT_PUBLIC_${prefix}_ASSET_REGISTRY_ADDRESS`,
    ),
    strategyRegistry: optionalAddress(
      `${prefix}_STRATEGY_REGISTRY_ADDRESS`,
      `NEXT_PUBLIC_${prefix}_STRATEGY_REGISTRY_ADDRESS`,
    ),
    revenueVault: optionalAddress(
      `${prefix}_REVENUE_VAULT_ADDRESS`,
      `NEXT_PUBLIC_${prefix}_REVENUE_VAULT_ADDRESS`,
    ),
    rewardsDistributor: optionalAddress(
      `${prefix}_REWARDS_DISTRIBUTOR_ADDRESS`,
      `NEXT_PUBLIC_${prefix}_REWARDS_DISTRIBUTOR_ADDRESS`,
    ),
    achievementRegistry: optionalAddress(
      `${prefix}_ACHIEVEMENT_REGISTRY_ADDRESS`,
      `NEXT_PUBLIC_${prefix}_ACHIEVEMENT_REGISTRY_ADDRESS`,
    ),
  };
  const contractsConfigured = Object.values(addresses).every(Boolean);
  const publicFlags = droidEconomyFeatureFlags();
  const flags = {
    ...publicFlags,
    droidRewardsEnabled: publicFlags.droidRewardsEnabled
      && serverEnabled(process.env.DROID_REWARDS_ENABLED, false),
    droidStrategiesEnabled: publicFlags.droidStrategiesEnabled
      && serverEnabled(process.env.DROID_STRATEGIES_ENABLED, false),
    sharedTreasuryEnabled: publicFlags.sharedTreasuryEnabled
      && serverEnabled(process.env.SHARED_TREASURY_ENABLED, false),
    ownerTradingEnabled: monad
      && Boolean(droid.ownerTradingAddress)
      && publicFlags.ownerTradingEnabled
      && serverEnabled(process.env.MONAD_DROID_OWNER_TRADING_ENABLED, false),
    autonomousTradingEnabled: false as const,
    // Server-side locks repeat the public code locks deliberately.
    secondaryRevenueDistributionEnabled: false as const,
    crossChainBridgeEnabled: false as const,
    droidAgentEnabled: false as const,
  };
  return {
    chainId: droid.chainId,
    chainName: droid.chainName,
    collectionAddress: droid.collectionAddress,
    defaultAccountVersion: positiveInteger(
      process.env[`${prefix}_ECONOMY_ACCOUNT_VERSION`],
      1,
    ),
    explorerUrl: droid.explorerUrl,
    addresses,
    strategyOptions: strategyOptions(
      process.env[`${prefix}_STRATEGY_OPTIONS`]
        || process.env[`NEXT_PUBLIC_${prefix}_STRATEGY_OPTIONS`],
    ),
    flags,
    contractsConfigured,
    setupIssue: contractsConfigured
      ? ""
      : "Economic contracts are staged but have not been deployed and configured on this chain.",
  };
}
