import { BrowserProvider, Contract, getAddress } from "ethers";
import { DROID_COLLECTION_ABI } from "@/lib/droid-accounts/abis";
import {
  ECONOMY_REWARDS_ABI,
  ECONOMY_STRATEGY_ABI,
} from "@/lib/droid-economy/abis";
import type {
  DroidEconomyConfig,
  DroidRewardAllocationView,
} from "@/lib/droid-economy/types";
import {
  isSupportedDroidChainId,
  switchProviderToDroidChain,
  type DroidEip1193Provider,
} from "@/lib/droid-accounts/network";

function sameAddress(left: string, right: string) {
  return getAddress(left) === getAddress(right);
}

async function ownerSigner(
  provider: DroidEip1193Provider,
  config: DroidEconomyConfig,
  tokenId: number,
) {
  if (!isSupportedDroidChainId(config.chainId)) throw new Error("Unsupported native Droid chain.");
  await switchProviderToDroidChain(provider, config.chainId);
  const browserProvider = new BrowserProvider(provider);
  const signer = await browserProvider.getSigner();
  const signerAddress = await signer.getAddress();
  const collection = new Contract(config.collectionAddress, DROID_COLLECTION_ABI, browserProvider);
  const currentOwner = await collection.ownerOf(tokenId) as string;
  if (!sameAddress(currentOwner, signerAddress)) {
    throw new Error("The connected wallet is no longer the current owner of this Droid.");
  }
  return { browserProvider, signer };
}

export async function claimRewardToDroid(input: {
  provider: DroidEip1193Provider;
  config: DroidEconomyConfig;
  tokenId: number;
  allocation: DroidRewardAllocationView;
}) {
  const { provider, config, tokenId, allocation } = input;
  if (!config.flags.droidRewardsEnabled || !config.contractsConfigured) {
    throw new Error("Droid rewards are not enabled on this chain.");
  }
  if (!config.addresses.rewardsDistributor) throw new Error("Rewards distributor is not configured.");
  if (
    allocation.chainId !== config.chainId
    || !sameAddress(allocation.collectionAddress, config.collectionAddress)
    || BigInt(allocation.tokenId) !== BigInt(tokenId)
  ) throw new Error("Reward allocation does not match this native Droid.");

  const { browserProvider, signer } = await ownerSigner(provider, config, tokenId);
  if (await browserProvider.getCode(allocation.droidAccount) === "0x") {
    throw new Error("Activate the Droid Account before claiming rewards.");
  }
  const rewards = new Contract(
    config.addresses.rewardsDistributor,
    ECONOMY_REWARDS_ABI,
    signer,
  );
  const args = [
    allocation.epochId,
    config.collectionAddress,
    tokenId,
    allocation.accountVersion,
    allocation.strategyId,
    allocation.rewardWeight,
    allocation.amount,
    allocation.proof,
  ] as const;
  await rewards.claim.estimateGas(...args);
  const transaction = await rewards.claim(...args);
  await transaction.wait();
  return transaction.hash as string;
}

export async function selectFutureRewardStrategy(input: {
  provider: DroidEip1193Provider;
  config: DroidEconomyConfig;
  tokenId: number;
  strategyId: string;
}) {
  const { provider, config, tokenId, strategyId } = input;
  if (!config.flags.droidStrategiesEnabled || !config.contractsConfigured) {
    throw new Error("Droid strategies are not enabled on this chain.");
  }
  if (!config.addresses.strategyRegistry) throw new Error("Strategy registry is not configured.");
  if (!config.strategyOptions.some((option) => option.strategyId === strategyId.toLowerCase())) {
    throw new Error("Select an approved strategy.");
  }
  const { signer } = await ownerSigner(provider, config, tokenId);
  const strategies = new Contract(
    config.addresses.strategyRegistry,
    ECONOMY_STRATEGY_ABI,
    signer,
  );
  await strategies.selectStrategy.estimateGas(config.collectionAddress, tokenId, strategyId);
  const transaction = await strategies.selectStrategy(config.collectionAddress, tokenId, strategyId);
  await transaction.wait();
  return transaction.hash as string;
}
