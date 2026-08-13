import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { ZeroAddress, getAddress, keccak256, toUtf8Bytes } from "ethers";
import { canonicalAdminPayload } from "../adminMessage";
import {
  canonicalDroidId,
  canonicalDroidKey,
  normalizeBytes32,
  normalizeDroidIdentity,
  rewardAllocationLeaf,
} from "./identity";
import type {
  RewardEpochManifest,
  RewardManifestAllocation,
  RewardManifestAllocationInput,
} from "./types";

const LEAF_TYPES = [
  "bytes32",
  "uint256",
  "address",
  "uint256",
  "uint32",
  "address",
  "bytes32",
  "uint256",
  "uint256",
] as const;

type RewardLeafTuple = [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

function unsignedString(value: unknown, label: string, allowZero = true) {
  try {
    const parsed = BigInt(String(value));
    if (parsed < 0n || (!allowZero && parsed === 0n)) throw new Error();
    return parsed.toString();
  } catch {
    throw new Error(`Invalid ${label}.`);
  }
}

function unixSeconds(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 4_102_444_800) {
    throw new Error(`Invalid ${label}.`);
  }
  return parsed;
}

function normalizeAllocation(
  epochId: string,
  expectedChainId: number,
  input: RewardManifestAllocationInput,
): RewardManifestAllocation {
  const identity = normalizeDroidIdentity(input);
  if (identity.chainId !== expectedChainId) throw new Error("Reward allocation chain mismatch.");
  const accountVersion = Number(input.accountVersion);
  if (!Number.isSafeInteger(accountVersion) || accountVersion <= 0 || accountVersion > 0xffff_ffff) {
    throw new Error("Invalid reward account version.");
  }
  const normalized: RewardManifestAllocationInput = {
    ...identity,
    accountVersion,
    droidAccount: getAddress(input.droidAccount),
    strategyId: normalizeBytes32(input.strategyId, "strategy ID"),
    rewardWeight: unsignedString(input.rewardWeight, "reward weight"),
    amount: unsignedString(input.amount, "reward amount", false),
  };
  return {
    ...normalized,
    droidKey: canonicalDroidKey(normalized),
    leaf: rewardAllocationLeaf(epochId, normalized),
    proof: [],
  };
}

function leafTuple(epochId: string, allocation: RewardManifestAllocation): RewardLeafTuple {
  return [
    epochId,
    String(allocation.chainId),
    allocation.collectionAddress,
    allocation.tokenId,
    String(allocation.accountVersion),
    allocation.droidAccount,
    allocation.strategyId,
    allocation.rewardWeight,
    allocation.amount,
  ];
}

export function buildRewardEpochManifest(input: {
  epochId: string;
  chainId: number;
  asset: string;
  assetSymbol: string;
  assetDecimals: number;
  startsAt: number;
  endsAt: number;
  metadataUri?: string;
  allocations: RewardManifestAllocationInput[];
}): RewardEpochManifest {
  const epochId = normalizeBytes32(input.epochId, "reward epoch ID");
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) {
    throw new Error("Invalid reward epoch chain ID.");
  }
  const asset = getAddress(input.asset || ZeroAddress);
  const assetSymbol = String(input.assetSymbol || "").trim().toUpperCase();
  if (!/^[A-Z0-9.\-]{1,16}$/.test(assetSymbol)) throw new Error("Invalid reward asset symbol.");
  if (!Number.isInteger(input.assetDecimals) || input.assetDecimals < 0 || input.assetDecimals > 36) {
    throw new Error("Invalid reward asset decimals.");
  }
  const startsAt = unixSeconds(input.startsAt, "reward start time");
  const endsAt = unixSeconds(input.endsAt, "reward end time");
  if (endsAt - startsAt < 3_600) throw new Error("Reward epoch must remain open for at least one hour.");
  if (!Array.isArray(input.allocations) || input.allocations.length === 0) {
    throw new Error("Reward epoch needs at least one allocation.");
  }
  if (input.allocations.length > 10_000) throw new Error("Reward epoch allocation limit exceeded.");

  const allocations = input.allocations
    .map((allocation) => normalizeAllocation(epochId, input.chainId, allocation))
    .sort((left, right) => canonicalDroidId(left).localeCompare(canonicalDroidId(right)));
  const unique = new Set<string>();
  let totalAllocated = 0n;
  for (const allocation of allocations) {
    const id = canonicalDroidId(allocation);
    if (unique.has(id)) throw new Error(`Duplicate reward allocation for ${id}.`);
    unique.add(id);
    totalAllocated += BigInt(allocation.amount);
  }

  const tree = StandardMerkleTree.of<RewardLeafTuple>(
    allocations.map((allocation) => leafTuple(epochId, allocation)),
    [...LEAF_TYPES],
  );
  const proofByDroid = new Map<string, string[]>();
  for (const [index, value] of tree.entries()) {
    const identity = {
      chainId: Number(value[1]),
      collectionAddress: value[2],
      tokenId: value[3],
    };
    proofByDroid.set(canonicalDroidId(identity), tree.getProof(index));
  }
  const withProofs = allocations.map((allocation) => ({
    ...allocation,
    proof: proofByDroid.get(canonicalDroidId(allocation)) || [],
  }));

  const commitment = {
    schemaVersion: 1,
    epochId,
    chainId: input.chainId,
    asset,
    assetSymbol,
    assetDecimals: input.assetDecimals,
    startsAt,
    endsAt,
    metadataUri: String(input.metadataUri || "").trim(),
    totalAllocated: totalAllocated.toString(),
    allocations: withProofs.map(({ proof: _proof, leaf: _leaf, droidKey: _key, ...allocation }) => allocation),
  };
  const manifestHash = keccak256(toUtf8Bytes(canonicalAdminPayload(commitment)));

  return {
    ...commitment,
    schemaVersion: 1,
    merkleRoot: tree.root,
    manifestHash,
    allocationCount: withProofs.length,
    allocations: withProofs,
    preparedAt: new Date().toISOString(),
    deploymentStatus: "prepared",
    transactionHash: "",
  };
}
