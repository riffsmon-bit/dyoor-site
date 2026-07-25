import { createJsonStore } from "./fileStore";

const STORE_NAME = "dyoor-s2-metadata";
const SUPPLY_LEDGER_KEY = "trait-lab/supply-ledger.json";
const BURNED_DROIDS_KEY = "trait-lab/burned-droids.json";
const ROLL_PREFIX = "trait-lab/rolls";
const ACTIVE_ROLL_PREFIX = "trait-lab/active-rolls";
const COMPLETION_PREFIX = "trait-lab/completions";
const SUPPLY_EVENT_PREFIX = "trait-lab/supply-events";
const SUPPLY_RESERVATION_PREFIX = "trait-lab/supply-reservations";
const BURNED_DROID_RECORD_PREFIX = "trait-lab/burned-droid-records";
const MON_PAYMENT_PREFIX = "trait-lab/mon-payments";
const MEME_PAYMENT_PREFIX = "trait-lab/meme-payments";
const LEGACY_SUPPLY_RESERVATION_TTL_MS = 15 * 60 * 1000;

const store = createJsonStore(STORE_NAME);

export type TraitLabRollStatus =
  | "created"
  | "prepared"
  | "charging"
  | "charged"
  | "confirming"
  | "metadata_committed"
  | "recovery_required"
  | "failed"
  | "superseded"
  | "forfeited"
  | "confirmed"
  | "completed";

export type TraitLabRollRecord = {
  rollId: string;
  previewClaimId?: string;
  previewId: string;
  wallet: string;
  tokenId: string;
  traitType: string;
  action: string;
  paymentMode: string;
  costRaw: string;
  costLabel: string;
  recycleRewardRaw?: string;
  recycleRewardLabel?: string;
  recycleCreditClaim?: string;
  recycleCreditTxHash?: string;
  recycleCreditBlockNumber?: string;
  recycleCreditDeduped?: boolean;
  previousValue: string;
  proposedValue: string;
  previousAttributes?: Record<string, string>;
  proposedAttributes: Record<string, string>;
  status: TraitLabRollStatus;
  createdAt: string;
  updatedAt?: string;
  expiresAt: string;
  preparedAt?: string;
  chargingAt?: string;
  chargedAt?: string;
  confirmingAt?: string;
  metadataCommittedAt?: string;
  confirmedAt?: string;
  completedAt?: string;
  failedAt?: string;
  supersededAt?: string;
  supersededByRollId?: string;
  forfeitedAt?: string;
  failureStage?: "preview" | "charge" | "confirm" | "metadata" | "supply" | "reward" | "completion";
  lastError?: string;
  recoveryRequired?: boolean;
  energyDebitId?: string;
  energyDebitDeduped?: boolean;
  energySpendReason?: string;
  energySpendSubmittedAt?: string;
  energySpendTxHash?: string;
  energySpendBlockNumber?: string;
  monPaymentTxHash?: string;
  monPaymentAmountRaw?: string;
  monPaymentBlockNumber?: string;
  memePaymentTokenAddress?: string;
  memePaymentTokenSymbol?: string;
  memePaymentTotalAmountRaw?: string;
  memePaymentTreasuryAmountRaw?: string;
  memePaymentBurnAmountRaw?: string;
  memePaymentTreasuryTxHash?: string;
  memePaymentBurnTxHash?: string;
  memePaymentTreasuryBlockNumber?: string;
  memePaymentBurnBlockNumber?: string;
};

export type TraitLabActiveRollRecord = {
  version: 1;
  tokenId: string;
  activeRollId: string;
  activeWallet: string;
  updatedAt: string;
  lastRollId?: string;
  lastDisposition?: "completed" | "forfeited" | "superseded";
};

export type TraitLabCompletionRecord = {
  version: 1;
  rollId: string;
  wallet: string;
  tokenId: string;
  traitType: string;
  action: string;
  paymentMode: string;
  costRaw: string;
  rewardRaw?: string;
  completedAt: string;
  result: Record<string, unknown>;
};

export type TraitSupplyDelta = {
  traitType: string;
  value: string;
  delta: number;
  reason: "equip" | "burn";
  initialSupply?: number;
  maxActiveSupply?: number;
};

export type TraitSupplyEvent = {
  id: string;
  rollId: string;
  wallet: string;
  tokenId: string;
  action: string;
  traitType: string;
  deltas: TraitSupplyDelta[];
  createdAt: string;
};

export type TraitSupplyReservation = {
  version: 1;
  rollId: string;
  wallet: string;
  tokenId: string;
  action: string;
  traitType: string;
  deltas: TraitSupplyDelta[];
  createdAt: string;
  expiresAt?: string;
};

export type TraitSupplyItem = {
  traitType: string;
  value: string;
  activeSupply: number;
  burnedSupply: number;
  equippedCount: number;
  initialSupply: number;
  maxActiveSupply: number;
  updatedAt: string;
};

export type TraitSupplyLedger = {
  version: 1;
  updatedAt: string;
  items: Record<string, TraitSupplyItem>;
  events: TraitSupplyEvent[];
};

export type BurnedDroidRecord = {
  tokenId: string;
  wallet: string;
  burnTxHash: string;
  rewardEnergy: number;
  rewardRaw: string;
  rewardLabel: string;
  claim: string;
  burnedAt: string;
  name?: string;
  image?: string;
  metadataVersion?: string;
  rewardTxHash?: string;
  rewardBlockNumber?: string;
  deduped?: boolean;
};

export type BurnedDroidGallery = {
  version: 1;
  updatedAt: string;
  items: BurnedDroidRecord[];
};

export type TraitLabMonPaymentRecord = {
  txHash: string;
  rollId: string;
  wallet: string;
  tokenId: string;
  traitType: string;
  action: string;
  amountRaw: string;
  treasuryWallet: string;
  blockNumber: string;
  createdAt: string;
};

export type TraitLabMemePaymentRecord = {
  txHash: string;
  rollId: string;
  wallet: string;
  tokenId: string;
  traitType: string;
  action: string;
  tokenAddress: string;
  tokenSymbol: string;
  totalAmountRaw: string;
  treasuryAmountRaw: string;
  burnAmountRaw: string;
  treasuryWallet: string;
  burnAddress: string;
  treasuryTxHash: string;
  burnTxHash: string;
  treasuryBlockNumber: string;
  burnBlockNumber: string;
  createdAt: string;
};

function nowIso() {
  return new Date().toISOString();
}

function traitSupplyKey(traitType: string, value: string) {
  return `${traitType}::${value}`.toLowerCase();
}

function rollKey(rollId: string) {
  return `${ROLL_PREFIX}/${rollId.replace(/[^a-zA-Z0-9:_-]/g, "-")}.json`;
}

function activeRollKey(tokenId: string) {
  return `${ACTIVE_ROLL_PREFIX}/${tokenId.replace(/[^0-9]/g, "") || "invalid"}.json`;
}

function completionKey(rollId: string) {
  return `${COMPLETION_PREFIX}/${rollId.replace(/[^a-zA-Z0-9:_-]/g, "-")}.json`;
}

function supplyEventKey(eventId: string) {
  return `${SUPPLY_EVENT_PREFIX}/${eventId.replace(/[^a-zA-Z0-9:_-]/g, "-")}.json`;
}

function supplyReservationKey(rollId: string) {
  return `${SUPPLY_RESERVATION_PREFIX}/${rollId.replace(/[^a-zA-Z0-9:_-]/g, "-")}.json`;
}

function burnedDroidRecordKey(burnTxHash: string) {
  return `${BURNED_DROID_RECORD_PREFIX}/${burnTxHash.toLowerCase().replace(/[^a-z0-9]/g, "-")}.json`;
}

function monPaymentKey(txHash: string) {
  return `${MON_PAYMENT_PREFIX}/${txHash.toLowerCase().replace(/[^a-z0-9]/g, "-")}.json`;
}

function memePaymentKey(txHash: string) {
  return `${MEME_PAYMENT_PREFIX}/${txHash.toLowerCase().replace(/[^a-z0-9]/g, "-")}.json`;
}

function emptyLedger(): TraitSupplyLedger {
  return {
    version: 1,
    updatedAt: "",
    items: {},
    events: [],
  };
}

function emptyBurnedDroidGallery(): BurnedDroidGallery {
  return {
    version: 1,
    updatedAt: "",
    items: [],
  };
}

function positiveNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function itemFromDelta(delta: TraitSupplyDelta, existing?: TraitSupplyItem): TraitSupplyItem {
  const initialSupply = existing?.initialSupply ?? positiveNumber(delta.initialSupply);
  return {
    traitType: delta.traitType,
    value: delta.value,
    activeSupply: existing?.activeSupply ?? initialSupply,
    burnedSupply: existing?.burnedSupply ?? 0,
    equippedCount: existing?.equippedCount ?? 0,
    initialSupply,
    maxActiveSupply: existing?.maxActiveSupply ?? positiveNumber(delta.maxActiveSupply),
    updatedAt: existing?.updatedAt || "",
  };
}

export async function getTraitLabRoll(rollId: string) {
  return await store.getJsonStrict<TraitLabRollRecord>(rollKey(rollId));
}

export async function saveTraitLabRoll(roll: TraitLabRollRecord) {
  const existing = await getTraitLabRoll(roll.rollId);
  const updatedAt = nowIso();
  const next = {
    ...existing,
    ...roll,
    createdAt: existing?.createdAt || roll.createdAt || updatedAt,
    updatedAt,
  };
  await store.setJson(rollKey(roll.rollId), next);
  return next;
}

export async function listTraitLabRollsForToken(tokenId: string) {
  const keys = await store.listKeys(`${ROLL_PREFIX}/`);
  const records = await Promise.all(keys.map((key) => store.getJsonStrict<TraitLabRollRecord>(key)));
  return records
    .filter((record): record is TraitLabRollRecord => Boolean(record?.rollId && record.tokenId === tokenId))
    .sort((left, right) => {
      const leftTime = left.updatedAt || left.createdAt;
      const rightTime = right.updatedAt || right.createdAt;
      return rightTime.localeCompare(leftTime);
    });
}

export async function getTraitLabActiveRoll(tokenId: string) {
  return await store.getJsonStrict<TraitLabActiveRollRecord>(activeRollKey(tokenId));
}

export async function saveTraitLabActiveRoll(record: TraitLabActiveRollRecord) {
  const next = {
    ...record,
    version: 1 as const,
    tokenId: String(record.tokenId),
    updatedAt: nowIso(),
  };
  await store.setJson(activeRollKey(next.tokenId), next);
  return next;
}

export async function getTraitLabCompletion(rollId: string) {
  return await store.getJsonStrict<TraitLabCompletionRecord>(completionKey(rollId));
}

export async function saveTraitLabCompletion(completion: TraitLabCompletionRecord) {
  const existing = await getTraitLabCompletion(completion.rollId);
  if (existing) return { completion: existing, deduped: true };
  const next = {
    ...completion,
    version: 1 as const,
    completedAt: completion.completedAt || nowIso(),
  };
  await store.setJson(completionKey(completion.rollId), next);
  return { completion: next, deduped: false };
}

export async function listTraitLabCompletions() {
  const keys = await store.listKeys(`${COMPLETION_PREFIX}/`);
  const records = await Promise.all(keys.map((key) => store.getJsonStrict<TraitLabCompletionRecord>(key)));
  return records
    .filter((record): record is TraitLabCompletionRecord => Boolean(record?.rollId && record?.completedAt))
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt));
}

export async function claimTraitLabMonPayment(payment: TraitLabMonPaymentRecord) {
  const key = monPaymentKey(payment.txHash);
  const existing = await store.getJsonStrict<TraitLabMonPaymentRecord>(key);
  if (existing && existing.rollId !== payment.rollId) {
    throw Object.assign(new Error("This MON transaction has already been used for a Trait Lab roll."), { status: 409 });
  }
  if (existing) return { payment: existing, deduped: true };

  const next = {
    ...payment,
    txHash: payment.txHash.toLowerCase(),
    createdAt: payment.createdAt || nowIso(),
  };
  await store.setJson(key, next);
  return { payment: next, deduped: false };
}

export async function claimTraitLabMemePayment(payment: TraitLabMemePaymentRecord) {
  const txHashes = Array.from(new Set([payment.treasuryTxHash, payment.burnTxHash].filter(Boolean).map((txHash) => txHash.toLowerCase())));
  if (!txHashes.length) {
    throw Object.assign(new Error("Missing meme token payment transaction."), { status: 400 });
  }

  const existing = await Promise.all(txHashes.map((txHash) => store.getJsonStrict<TraitLabMemePaymentRecord>(memePaymentKey(txHash))));
  for (const record of existing) {
    if (record && record.rollId !== payment.rollId) {
      throw Object.assign(new Error("This meme token transaction has already been used for a Trait Lab roll."), { status: 409 });
    }
  }
  const firstExisting = existing.find(Boolean);
  if (firstExisting) return { payment: firstExisting, deduped: true };

  const next = {
    ...payment,
    txHash: payment.txHash.toLowerCase(),
    treasuryTxHash: payment.treasuryTxHash.toLowerCase(),
    burnTxHash: payment.burnTxHash.toLowerCase(),
    createdAt: payment.createdAt || nowIso(),
  };
  await Promise.all(txHashes.map((txHash) => store.setJson(memePaymentKey(txHash), next)));
  return { payment: next, deduped: false };
}

export async function getTraitSupplyLedger(): Promise<TraitSupplyLedger> {
  const legacy = await store.getJson<TraitSupplyLedger>(SUPPLY_LEDGER_KEY, emptyLedger());
  const keys = await store.listKeys(`${SUPPLY_EVENT_PREFIX}/`);
  if (!keys.length) return legacy;

  const storedEvents = await Promise.all(keys.map((key) => store.getJsonStrict<TraitSupplyEvent>(key)));
  const knownIds = new Set(legacy.events.map((event) => event.id));
  const missingEvents = storedEvents
    .filter((event): event is TraitSupplyEvent => Boolean(event?.id && !knownIds.has(event.id)))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  if (!missingEvents.length) return legacy;

  const items = { ...legacy.items };
  for (const event of missingEvents) {
    for (const delta of event.deltas) {
      const key = traitSupplyKey(delta.traitType, delta.value);
      const item = itemFromDelta(delta, items[key]);
      items[key] = {
        ...item,
        activeSupply: Math.max(0, item.activeSupply + delta.delta),
        burnedSupply: delta.reason === "burn" ? item.burnedSupply + Math.abs(delta.delta) : item.burnedSupply,
        equippedCount: delta.reason === "equip" ? item.equippedCount + delta.delta : item.equippedCount,
        updatedAt: event.createdAt || legacy.updatedAt,
      };
    }
  }

  const events = legacy.events.concat(missingEvents);
  return {
    version: 1,
    updatedAt: events.reduce((latest, event) => event.createdAt > latest ? event.createdAt : latest, legacy.updatedAt),
    items,
    events,
  };
}

export async function getTraitSupplyReservation(rollId: string) {
  return await store.getJsonStrict<TraitSupplyReservation>(supplyReservationKey(rollId));
}

export async function saveTraitSupplyReservation(reservation: TraitSupplyReservation) {
  const existing = await getTraitSupplyReservation(reservation.rollId);
  if (existing) return { reservation: existing, deduped: true };
  const next = {
    ...reservation,
    version: 1 as const,
    createdAt: reservation.createdAt || nowIso(),
    deltas: reservation.deltas.filter((delta) => delta.delta > 0),
  };
  await store.setJson(supplyReservationKey(reservation.rollId), next);
  return { reservation: next, deduped: false };
}

export async function deleteTraitSupplyReservation(rollId: string) {
  await store.deleteJson(supplyReservationKey(rollId));
}

export async function getTraitSupplyAvailabilityLedger({
  excludeRollId = "",
}: {
  excludeRollId?: string;
} = {}): Promise<TraitSupplyLedger> {
  const ledger = await getTraitSupplyLedger();
  const committedRollIds = new Set(ledger.events.map((event) => event.rollId));
  const keys = await store.listKeys(`${SUPPLY_RESERVATION_PREFIX}/`);
  const reservations = await Promise.all(keys.map((key) => store.getJsonStrict<TraitSupplyReservation>(key)));
  const items = { ...ledger.items };

  for (const reservation of reservations) {
    const explicitExpiry = Date.parse(String(reservation?.expiresAt || ""));
    const legacyExpiry = Date.parse(String(reservation?.createdAt || "")) + LEGACY_SUPPLY_RESERVATION_TTL_MS;
    const expiresAt = Number.isFinite(explicitExpiry) ? explicitExpiry : legacyExpiry;
    if (
      !reservation?.rollId
      || reservation.rollId === excludeRollId
      || committedRollIds.has(reservation.rollId)
      || (Number.isFinite(expiresAt) && expiresAt <= Date.now())
    ) {
      continue;
    }
    for (const delta of reservation.deltas) {
      if (delta.delta <= 0) continue;
      const key = traitSupplyKey(delta.traitType, delta.value);
      const item = itemFromDelta(delta, items[key]);
      items[key] = {
        ...item,
        activeSupply: item.activeSupply + delta.delta,
        equippedCount: item.equippedCount + delta.delta,
        updatedAt: reservation.createdAt || item.updatedAt,
      };
    }
  }

  return {
    ...ledger,
    items,
  };
}

export async function getBurnedDroidGallery() {
  const legacy = await store.getJson<BurnedDroidGallery>(BURNED_DROIDS_KEY, emptyBurnedDroidGallery());
  const keys = await store.listKeys(`${BURNED_DROID_RECORD_PREFIX}/`);
  const stored = await Promise.all(keys.map((key) => store.getJsonStrict<BurnedDroidRecord>(key)));
  const records = legacy.items.concat(stored.filter((record): record is BurnedDroidRecord => Boolean(record?.burnTxHash)));
  const byBurn = new Map<string, BurnedDroidRecord>();
  for (const record of records) {
    const key = record.burnTxHash.toLowerCase();
    const current = byBurn.get(key);
    if (!current || record.burnedAt >= current.burnedAt) byBurn.set(key, record);
  }
  const items = Array.from(byBurn.values())
    .sort((left, right) => right.burnedAt.localeCompare(left.burnedAt));
  return {
    version: 1,
    updatedAt: items[0]?.burnedAt || legacy.updatedAt,
    items,
  };
}

export async function saveBurnedDroidRecord(record: BurnedDroidRecord) {
  const gallery = await getBurnedDroidGallery();
  const updatedAt = nowIso();
  const txHash = record.burnTxHash.toLowerCase();
  const tokenId = String(record.tokenId);
  const existing = gallery.items.find((item) => item.tokenId === tokenId || item.burnTxHash.toLowerCase() === txHash);
  const nextRecord = {
    ...existing,
    ...record,
    tokenId,
    wallet: record.wallet.toLowerCase(),
    burnTxHash: txHash,
    burnedAt: record.burnedAt || updatedAt,
  };
  await store.setJson(burnedDroidRecordKey(txHash), nextRecord);
  return nextRecord;
}

export async function getTraitSupplyItem(traitType: string, value: string) {
  const ledger = await getTraitSupplyLedger();
  return ledger.items[traitSupplyKey(traitType, value)] || null;
}

export async function assertTraitSupplyAvailable(delta: TraitSupplyDelta, excludeRollId = "") {
  if (delta.delta <= 0) return;
  const availability = await getTraitSupplyAvailabilityLedger({ excludeRollId });
  const existing = availability.items[traitSupplyKey(delta.traitType, delta.value)] || null;
  const item = itemFromDelta(delta, existing || undefined);
  const maxActiveSupply = positiveNumber(delta.maxActiveSupply || item.maxActiveSupply);
  if (maxActiveSupply > 0 && item.activeSupply + delta.delta > maxActiveSupply) {
    throw Object.assign(new Error(`${delta.traitType} ${delta.value} has reached its active supply cap.`), { status: 409 });
  }
}

export async function getTraitSupplyEvent(eventId: string) {
  return await store.getJsonStrict<TraitSupplyEvent>(supplyEventKey(eventId));
}

export async function applyTraitSupplyDeltas(event: TraitSupplyEvent) {
  const key = supplyEventKey(event.id);
  const existingEvent = await store.getJsonStrict<TraitSupplyEvent>(key);
  if (existingEvent) {
    const ledger = await getTraitSupplyLedger();
    return { ledger, event: existingEvent, deduped: true };
  }

  const ledger = await getTraitSupplyLedger();
  for (const delta of event.deltas) {
    if (delta.delta <= 0) continue;
    const item = itemFromDelta(delta, ledger.items[traitSupplyKey(delta.traitType, delta.value)]);
    const maxActiveSupply = positiveNumber(delta.maxActiveSupply || item.maxActiveSupply);
    if (maxActiveSupply > 0 && item.activeSupply + delta.delta > maxActiveSupply) {
      throw Object.assign(new Error(`${delta.traitType} ${delta.value} has reached its active supply cap.`), { status: 409 });
    }
  }

  const updatedAt = nowIso();
  const nextEvent = { ...event, createdAt: event.createdAt || updatedAt };
  await store.setJson(key, nextEvent);
  const nextLedger = await getTraitSupplyLedger();
  await store.setJson(SUPPLY_LEDGER_KEY, nextLedger);
  return { ledger: nextLedger, event: nextEvent, deduped: false };
}
