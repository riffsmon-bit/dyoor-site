import {
  AbiCoder,
  ZeroAddress,
  getAddress,
  isHexString,
  keccak256,
} from "ethers";
import type {
  DroidRewardPoolView,
  RevenueAssetAmount,
  RevenueReceipt,
  RevenueSourceKind,
  RevenueSplitPolicy,
} from "@/lib/droid-economy/types";

export const REVENUE_BPS_DENOMINATOR = 10_000;

/** Preview policy only. It cannot route funds or activate a revenue source. */
export const STAGED_REVENUE_SPLIT: RevenueSplitPolicy = Object.freeze({
  status: "PROPOSED_STAGED",
  projectTreasuryBps: 6_000,
  droidRewardsBps: 3_000,
  otherApprovedBps: 1_000,
  totalBps: 10_000,
});

export const SUPPORTED_REVENUE_SOURCES: readonly RevenueSourceKind[] = Object.freeze([
  "SECONDARY_MARKET_REVENUE",
  "DYOOR_BUILD",
  "PLATFORM_FEES",
  "PARTNER_REVENUE",
  "OTHER_APPROVED",
]);

export type RevenueSplitAmounts = {
  grossAmount: bigint;
  projectTreasuryAmount: bigint;
  droidRewardsAmount: bigint;
  otherApprovedAmount: bigint;
};

export type SecondarySaleObservation = {
  kind: "SECONDARY_SALE_OBSERVATION";
  chainId: number;
  collectionAddress: string;
  transactionHash: string;
  saleValue: string;
};

function nonNegativeBps(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value > REVENUE_BPS_DENOMINATOR) {
    throw new Error(`${label} must be an integer between 0 and 10,000 basis points.`);
  }
  return value;
}

export function validateRevenueSplit(policy: RevenueSplitPolicy) {
  const treasury = nonNegativeBps(policy.projectTreasuryBps, "Project Treasury allocation");
  const rewards = nonNegativeBps(policy.droidRewardsBps, "Droid Rewards allocation");
  const other = nonNegativeBps(policy.otherApprovedBps, "Other Approved allocation");
  if (treasury + rewards + other !== REVENUE_BPS_DENOMINATOR) {
    throw new Error("Revenue allocations must total exactly 10,000 basis points.");
  }
  return policy;
}

/**
 * Mirrors HoodYoorRevenueVault integer accounting. Rounding remainder stays with
 * Project Treasury so the three outputs always equal the verified receipt.
 */
export function previewRevenueSplit(
  grossAmountInput: bigint | string,
  policy: RevenueSplitPolicy = STAGED_REVENUE_SPLIT,
): RevenueSplitAmounts {
  validateRevenueSplit(policy);
  const grossAmount = BigInt(grossAmountInput);
  if (grossAmount < 0n) throw new Error("Revenue amount cannot be negative.");
  const droidRewardsAmount = grossAmount
    * BigInt(policy.droidRewardsBps)
    / BigInt(REVENUE_BPS_DENOMINATOR);
  const otherApprovedAmount = grossAmount
    * BigInt(policy.otherApprovedBps)
    / BigInt(REVENUE_BPS_DENOMINATOR);
  const projectTreasuryAmount = grossAmount - droidRewardsAmount - otherApprovedAmount;
  return {
    grossAmount,
    projectTreasuryAmount,
    droidRewardsAmount,
    otherApprovedAmount,
  };
}

export function assertSupportedRevenueSource(value: string): RevenueSourceKind {
  if (!SUPPORTED_REVENUE_SOURCES.includes(value as RevenueSourceKind)) {
    throw new Error("Unsupported revenue source. Unknown sources remain inactive.");
  }
  return value as RevenueSourceKind;
}

export function assertVerifiedReceiptCandidate(
  candidate: RevenueReceipt | SecondarySaleObservation,
): asserts candidate is RevenueReceipt {
  if ("kind" in candidate && candidate.kind === "SECONDARY_SALE_OBSERVATION") {
    throw new Error(
      "A marketplace sale event is not proof that creator revenue was received.",
    );
  }
}

export function canonicalRevenueId(input: {
  chainId: number;
  collectionAddress: string;
  receiverAddress: string;
  transactionHash: string;
  transferIndex: number;
  asset: string;
}) {
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) {
    throw new Error("Revenue chain ID is invalid.");
  }
  if (!Number.isSafeInteger(input.transferIndex) || input.transferIndex < 0) {
    throw new Error("Revenue transfer index is invalid.");
  }
  if (!isHexString(input.transactionHash, 32)) {
    throw new Error("Revenue transaction hash is invalid.");
  }
  return keccak256(AbiCoder.defaultAbiCoder().encode(
    ["uint256", "address", "address", "bytes32", "uint256", "address"],
    [
      input.chainId,
      getAddress(input.collectionAddress),
      getAddress(input.receiverAddress),
      input.transactionHash,
      input.transferIndex,
      getAddress(input.asset || ZeroAddress),
    ],
  ));
}

export function aggregateRevenueAmounts(
  receipts: RevenueReceipt[],
): RevenueAssetAmount[] {
  const grouped = new Map<string, RevenueAssetAmount>();
  for (const receipt of receipts) {
    const key = `${receipt.chainId}:${receipt.asset.toLowerCase()}`;
    const current = grouped.get(key);
    grouped.set(key, {
      asset: getAddress(receipt.asset),
      symbol: receipt.assetSymbol,
      decimals: receipt.assetDecimals,
      rawAmount: (BigInt(current?.rawAmount || 0) + BigInt(receipt.grossAmount)).toString(),
    });
  }
  return [...grouped.values()].sort((left, right) => left.symbol.localeCompare(right.symbol));
}

export function insertUniqueRevenueReceipt(
  receipts: readonly RevenueReceipt[],
  receipt: RevenueReceipt,
) {
  if (receipts.some((existing) => (
    existing.chainId === receipt.chainId
    && existing.revenueId.toLowerCase() === receipt.revenueId.toLowerCase()
  ))) {
    throw Object.assign(new Error("This verified revenue ID has already been indexed."), { status: 409 });
  }
  return [receipt, ...receipts];
}

export function stagedDroidRewardPool(): DroidRewardPoolView {
  return {
    status: "STAGED",
    currentFundedPool: null,
    pendingAccountedRevenue: null,
    distributedRewards: null,
    nextEpoch: null,
    claimsStatus: "OFF",
  };
}
