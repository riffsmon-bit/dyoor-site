import "server-only";
import { Contract, JsonRpcProvider, getAddress } from "ethers";
import { droidServerRpcUrl } from "@/lib/droid-accounts/config";
import { getDroidEconomyConfig } from "@/lib/droid-economy/config";
import {
  ECONOMY_REWARDS_ABI,
  ECONOMY_STRATEGY_ABI,
} from "@/lib/droid-economy/abis";
import { canonicalDroidKey } from "@/lib/droid-economy/identity";
import { stagedDroidRewardPool } from "@/lib/droid-economy/revenue";
import type {
  DroidEconomySnapshot,
  DroidRewardAllocationView,
} from "@/lib/droid-economy/types";
import { getDroidRewardAllocations } from "@/src/lib/storage/droidEconomyStore";

type EpochResult = readonly [
  boolean,
  boolean,
  string,
  string,
  string,
  bigint,
  bigint,
  bigint,
  bigint,
  string,
] & {
  exists: boolean;
  closed: boolean;
  asset: string;
  merkleRoot: string;
  manifestHash: string;
  totalAllocated: bigint;
  totalClaimed: bigint;
  startsAt: bigint;
  endsAt: bigint;
  metadataURI: string;
};

function sameAddress(left: string, right: string) {
  try {
    return getAddress(left) === getAddress(right);
  } catch {
    return false;
  }
}

function claimStatus(input: {
  enabled: boolean;
  deployed: boolean;
  claimed: boolean | null;
  startsAt: number;
  endsAt: number;
}) : DroidRewardAllocationView["claimStatus"] {
  if (!input.enabled) return "MODULE_DISABLED";
  if (!input.deployed) return "EPOCH_PREPARED";
  if (input.claimed === null) return "VALUE_UNAVAILABLE";
  if (input.claimed) return "CLAIMED";
  const now = Math.floor(Date.now() / 1_000);
  if (now < input.startsAt) return "NOT_STARTED";
  if (now > input.endsAt) return "EXPIRED";
  return "CLAIMABLE";
}

export async function getDroidEconomySnapshot(
  tokenId: number,
  chainId?: number,
): Promise<DroidEconomySnapshot> {
  const config = getDroidEconomyConfig(chainId);
  const identity = {
    chainId: config.chainId,
    collectionAddress: config.collectionAddress,
    tokenId: String(tokenId),
  };
  const droidKey = canonicalDroidKey(identity);
  const partialErrors: string[] = [];
  const indexed = await getDroidRewardAllocations(identity);
  const published = indexed.filter(({ manifest }) => manifest.deploymentStatus === "onchain");
  let pendingRewards: DroidRewardAllocationView[] = [];
  let strategy: DroidEconomySnapshot["strategy"] = null;
  const lifetimeRewards: DroidEconomySnapshot["lifetimeRewards"] = [];

  const rewardReadsEnabled = config.flags.droidRewardsEnabled
    && config.contractsConfigured
    && Boolean(config.addresses.rewardsDistributor);
  const strategyReadsEnabled = config.flags.droidStrategiesEnabled
    && config.contractsConfigured
    && Boolean(config.addresses.strategyRegistry);
  const provider = (rewardReadsEnabled || strategyReadsEnabled)
    ? new JsonRpcProvider(droidServerRpcUrl(config.chainId), config.chainId, { staticNetwork: true })
    : null;

  if (rewardReadsEnabled && provider) {
    const rewards = new Contract(
      config.addresses.rewardsDistributor,
      ECONOMY_REWARDS_ABI,
      provider,
    );
    pendingRewards = await Promise.all(published.map(async ({ manifest, allocation }) => {
      let isClaimed: boolean | null = null;
      let deployed = false;
      try {
        const [epoch, claimed] = await Promise.all([
          rewards.epoch(manifest.epochId) as Promise<EpochResult>,
          rewards.claimed(manifest.epochId, allocation.droidKey) as Promise<boolean>,
        ]);
        deployed = Boolean(epoch.exists)
          && epoch.merkleRoot.toLowerCase() === manifest.merkleRoot.toLowerCase()
          && epoch.manifestHash.toLowerCase() === manifest.manifestHash.toLowerCase()
          && sameAddress(epoch.asset, manifest.asset);
        if (!deployed) {
          partialErrors.push(`Reward epoch ${manifest.epochId.slice(0, 10)} does not match its published manifest.`);
        } else {
          isClaimed = claimed;
        }
      } catch {
        partialErrors.push(`Reward epoch ${manifest.epochId.slice(0, 10)} is temporarily unavailable.`);
      }
      return {
        ...allocation,
        epochId: manifest.epochId,
        asset: manifest.asset,
        assetSymbol: manifest.assetSymbol,
        assetDecimals: manifest.assetDecimals,
        startsAt: manifest.startsAt,
        endsAt: manifest.endsAt,
        metadataUri: manifest.metadataUri,
        deploymentStatus: manifest.deploymentStatus,
        claimed: isClaimed,
        claimStatus: claimStatus({
          enabled: config.flags.droidRewardsEnabled,
          deployed,
          claimed: isClaimed,
          startsAt: manifest.startsAt,
          endsAt: manifest.endsAt,
        }),
      };
    }));

    const assets = new Map<string, { symbol: string; decimals: number }>();
    for (const { manifest } of published) {
      assets.set(manifest.asset.toLowerCase(), {
        symbol: manifest.assetSymbol,
        decimals: manifest.assetDecimals,
      });
    }
    for (const [asset, metadata] of assets) {
      try {
        const amount = await rewards.lifetimeRewards(droidKey, asset) as bigint;
        lifetimeRewards.push({ asset: getAddress(asset), ...metadata, amount: amount.toString() });
      } catch {
        partialErrors.push(`${metadata.symbol} lifetime rewards are temporarily unavailable.`);
      }
    }
  }

  if (strategyReadsEnabled && provider) {
    try {
      const strategies = new Contract(
        config.addresses.strategyRegistry,
        ECONOMY_STRATEGY_ABI,
        provider,
      );
      const selection = await strategies.selections(droidKey) as readonly [string, bigint, bigint];
      const strategyId = String(selection[0]);
      const strategyVersion = Number(selection[1]);
      if (strategyId !== `0x${"0".repeat(64)}` && strategyVersion > 0) {
        const [header, version] = await Promise.all([
          strategies.strategies(strategyId) as Promise<readonly [boolean, boolean, bigint]>,
          strategies.strategyVersion(strategyId, strategyVersion) as Promise<readonly [
            string,
            string,
            string,
            string[],
            bigint[],
          ]>,
        ]);
        strategy = {
          strategyId,
          strategyVersion,
          selectedAt: Number(selection[2]),
          metadataUri: version[1],
          riskMetadataUri: version[2],
          enabled: Boolean(header[1]),
        };
      }
    } catch {
      partialErrors.push("Current strategy is temporarily unavailable.");
    }
  }

  const activePublished = pendingRewards
    .filter((allocation) => allocation.claimStatus !== "CLAIMED" && allocation.claimStatus !== "EXPIRED")
    .sort((left, right) => right.startsAt - left.startsAt);

  return {
    identity,
    droidKey,
    nativeChain: config.chainName,
    config,
    strategy,
    rewardWeight: activePublished[0]?.rewardWeight || null,
    pendingRewards: activePublished,
    lifetimeRewards,
    achievements: [],
    rewardPool: stagedDroidRewardPool(),
    potentialEligibilityInputs: [
      "Staking",
      "DYOOR Build",
      "Achievements",
      "Ecosystem participation",
      "Future reward weight",
    ],
    partialErrors: [...new Set(partialErrors)],
  };
}
