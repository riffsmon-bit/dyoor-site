import { createJsonStore } from "./fileStore";
import type { DroidActivityItem } from "../../../lib/droid-accounts/types";

const STORE_NAME = "droid-activity-index";
const store = createJsonStore(STORE_NAME);

export type DroidActivityCheckpoint = {
  schemaVersion: 1;
  chainId: number;
  collectionAddress: string;
  tokenId: number;
  droidAccount: string;
  startBlock: number;
  indexedThroughBlock: number;
  chainHeadBlock?: number;
  updatedAt: string;
  provider: string;
  lastError?: string;
  retryState?: "idle" | "retrying" | "reduced-range" | "fallback" | "budget-exhausted" | "failed";
  lastAttemptAt?: string;
  rangesProcessed?: number;
  retries?: number;
  events: DroidActivityItem[];
};

function checkpointKey(chainId: number, collectionAddress: string, tokenId: number) {
  return `v1/${chainId}/${collectionAddress.toLowerCase()}/${tokenId}.json`;
}

function validCheckpoint(
  value: DroidActivityCheckpoint | null,
  chainId: number,
  collectionAddress: string,
  tokenId: number,
  droidAccount: string,
) {
  return Boolean(
    value
    && value.schemaVersion === 1
    && value.chainId === chainId
    && value.collectionAddress.toLowerCase() === collectionAddress.toLowerCase()
    && value.tokenId === tokenId
    && value.droidAccount.toLowerCase() === droidAccount.toLowerCase()
    && Number.isSafeInteger(value.indexedThroughBlock)
    && Array.isArray(value.events),
  );
}

export async function getDroidActivityCheckpoint(input: {
  chainId: number;
  collectionAddress: string;
  tokenId: number;
  droidAccount: string;
}) {
  const checkpoint = await store.getJsonStrict<DroidActivityCheckpoint>(
    checkpointKey(input.chainId, input.collectionAddress, input.tokenId),
  );
  return validCheckpoint(
    checkpoint,
    input.chainId,
    input.collectionAddress,
    input.tokenId,
    input.droidAccount,
  ) ? checkpoint : null;
}

export async function setDroidActivityCheckpoint(
  checkpoint: Omit<DroidActivityCheckpoint, "schemaVersion" | "updatedAt">,
) {
  const key = checkpointKey(
    checkpoint.chainId,
    checkpoint.collectionAddress,
    checkpoint.tokenId,
  );
  const current = await store.getJsonStrict<DroidActivityCheckpoint>(key);
  if (
    validCheckpoint(
      current,
      checkpoint.chainId,
      checkpoint.collectionAddress,
      checkpoint.tokenId,
      checkpoint.droidAccount,
    )
    && current!.indexedThroughBlock > checkpoint.indexedThroughBlock
  ) {
    return current!;
  }
  const value: DroidActivityCheckpoint = {
    ...checkpoint,
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
  };
  await store.setJson(key, value);
  return value;
}
