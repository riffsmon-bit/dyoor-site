import { AbiCoder, getAddress, keccak256 } from "ethers";
import type {
  ChainQualifiedDroidId,
  RewardManifestAllocationInput,
} from "./types";

const coder = AbiCoder.defaultAbiCoder();
const BYTES32_PATTERN = /^0x[a-fA-F0-9]{64}$/;

function positiveChainId(value: number) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Invalid Droid chain ID.");
  return value;
}

function unsignedInteger(value: string | number | bigint, label: string) {
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) throw new Error();
    return parsed;
  } catch {
    throw new Error(`Invalid ${label}.`);
  }
}

export function normalizeDroidIdentity(input: ChainQualifiedDroidId): ChainQualifiedDroidId {
  return {
    chainId: positiveChainId(input.chainId),
    collectionAddress: getAddress(input.collectionAddress),
    tokenId: unsignedInteger(input.tokenId, "Droid token ID").toString(),
  };
}

export function canonicalDroidKey(input: ChainQualifiedDroidId) {
  const identity = normalizeDroidIdentity(input);
  return keccak256(coder.encode(
    ["uint256", "address", "uint256"],
    [identity.chainId, identity.collectionAddress, identity.tokenId],
  ));
}

export function canonicalDroidId(input: ChainQualifiedDroidId) {
  const identity = normalizeDroidIdentity(input);
  return `${identity.chainId}:${identity.collectionAddress.toLowerCase()}:${identity.tokenId}`;
}

export function normalizeBytes32(value: string, label: string) {
  if (!BYTES32_PATTERN.test(value)) throw new Error(`Invalid ${label}.`);
  return value.toLowerCase();
}

export function rewardAllocationLeaf(
  epochIdInput: string,
  allocationInput: RewardManifestAllocationInput,
) {
  const epochId = normalizeBytes32(epochIdInput, "reward epoch ID");
  const identity = normalizeDroidIdentity(allocationInput);
  const accountVersion = Number(allocationInput.accountVersion);
  if (!Number.isSafeInteger(accountVersion) || accountVersion <= 0 || accountVersion > 0xffff_ffff) {
    throw new Error("Invalid Droid Account version.");
  }
  const droidAccount = getAddress(allocationInput.droidAccount);
  const strategyId = normalizeBytes32(allocationInput.strategyId, "strategy ID");
  const rewardWeight = unsignedInteger(allocationInput.rewardWeight, "reward weight");
  const amount = unsignedInteger(allocationInput.amount, "reward amount");
  if (amount === 0n) throw new Error("Reward amount must be greater than zero.");

  const inner = keccak256(coder.encode(
    [
      "bytes32",
      "uint256",
      "address",
      "uint256",
      "uint32",
      "address",
      "bytes32",
      "uint256",
      "uint256",
    ],
    [
      epochId,
      identity.chainId,
      identity.collectionAddress,
      identity.tokenId,
      accountVersion,
      droidAccount,
      strategyId,
      rewardWeight,
      amount,
    ],
  ));
  return keccak256(inner);
}
