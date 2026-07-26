import { createJsonStore } from "./fileStore";

const STORE_NAME = "dyoor-trait-bounties";
const SETTLEMENT_PREFIX = "settlements";
const COMPLETION_PREFIX = "processed-completions";
const store = createJsonStore(STORE_NAME);

export type TraitBountySettlementRecord = {
  version: 1;
  settlementKey: string;
  bountyId: string;
  bountyLabel: string;
  rollId: string;
  wallet: string;
  tokenId: string;
  action: string;
  traitType: string;
  traitValue: string;
  rewardRaw: string;
  rewardEnergy: string;
  completedAt: string;
  settledAt: string;
  txHash?: string;
  blockNumber?: string;
  deduped?: boolean;
};

export type TraitBountyCompletionProcessingRecord = {
  version: 1;
  rollId: string;
  status: "complete" | "pending";
  processedAt: string;
  settlementKeys: string[];
  errors: string[];
};

function safeHex(value: string) {
  const normalized = String(value || "").toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(normalized)) {
    throw new Error("Trait bounty settlement key must be bytes32.");
  }
  return normalized.slice(2);
}

function settlementKey(value: string) {
  return `${SETTLEMENT_PREFIX}/${safeHex(value)}.json`;
}

function completionKey(value: string) {
  return `${COMPLETION_PREFIX}/${safeHex(value)}.json`;
}

export async function getTraitBountySettlement(value: string) {
  return await store.getJsonStrict<TraitBountySettlementRecord>(settlementKey(value));
}

export async function saveTraitBountySettlement(
  settlement: TraitBountySettlementRecord,
) {
  const existing = await getTraitBountySettlement(settlement.settlementKey);
  if (existing) return { settlement: existing, deduped: true };
  const next = {
    ...settlement,
    version: 1 as const,
  };
  await store.setJson(settlementKey(next.settlementKey), next);
  return { settlement: next, deduped: false };
}

export async function listTraitBountySettlements(limit = 250) {
  const keys = await store.listKeys(`${SETTLEMENT_PREFIX}/`);
  const selected = keys.slice(-Math.min(1_000, Math.max(1, Math.floor(limit) || 250)));
  const records = await Promise.all(
    selected.map((key) => store.getJsonStrict<TraitBountySettlementRecord>(key)),
  );
  return records
    .filter((record): record is TraitBountySettlementRecord => Boolean(
      record
        && record.version === 1
        && /^0x[a-f0-9]{64}$/.test(record.settlementKey)
        && /^0x[a-f0-9]{40}$/.test(record.wallet)
        && record.completedAt
        && record.settledAt,
    ))
    .sort((left, right) => (
      right.settledAt.localeCompare(left.settledAt)
      || left.settlementKey.localeCompare(right.settlementKey)
    ));
}

export async function getTraitBountyCompletionProcessing(value: string) {
  return await store.getJsonStrict<TraitBountyCompletionProcessingRecord>(
    completionKey(value),
  );
}

export async function saveTraitBountyCompletionProcessing(
  processing: TraitBountyCompletionProcessingRecord,
) {
  const next = {
    ...processing,
    rollId: `0x${safeHex(processing.rollId)}`,
    version: 1 as const,
  };
  await store.setJson(completionKey(next.rollId), next);
  return next;
}
