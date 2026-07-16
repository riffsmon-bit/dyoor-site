import { createJsonStore } from "./fileStore";

const STORE_NAME = "dyoor-s2-metadata";
const SUPPLY_LEDGER_KEY = "trait-lab/supply-ledger.json";
const ROLL_PREFIX = "trait-lab/rolls";
const MON_PAYMENT_PREFIX = "trait-lab/mon-payments";

const store = createJsonStore(STORE_NAME);

export type TraitLabRollStatus = "created" | "charged" | "confirmed";

export type TraitLabRollRecord = {
  rollId: string;
  previewId: string;
  wallet: string;
  tokenId: string;
  traitType: string;
  action: string;
  paymentMode: string;
  costRaw: string;
  costLabel: string;
  previousValue: string;
  proposedValue: string;
  proposedAttributes: Record<string, string>;
  status: TraitLabRollStatus;
  createdAt: string;
  expiresAt: string;
  chargedAt?: string;
  confirmedAt?: string;
  energyDebitId?: string;
  energyDebitDeduped?: boolean;
  energySpendTxHash?: string;
  energySpendBlockNumber?: string;
  monPaymentTxHash?: string;
  monPaymentAmountRaw?: string;
  monPaymentBlockNumber?: string;
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

function nowIso() {
  return new Date().toISOString();
}

function traitSupplyKey(traitType: string, value: string) {
  return `${traitType}::${value}`.toLowerCase();
}

function rollKey(rollId: string) {
  return `${ROLL_PREFIX}/${rollId.replace(/[^a-zA-Z0-9:_-]/g, "-")}.json`;
}

function monPaymentKey(txHash: string) {
  return `${MON_PAYMENT_PREFIX}/${txHash.toLowerCase().replace(/[^a-z0-9]/g, "-")}.json`;
}

function emptyLedger(): TraitSupplyLedger {
  return {
    version: 1,
    updatedAt: "",
    items: {},
    events: [],
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
  return await store.getJson<TraitLabRollRecord | null>(rollKey(rollId), null);
}

export async function saveTraitLabRoll(roll: TraitLabRollRecord) {
  const next = {
    ...roll,
    createdAt: roll.createdAt || nowIso(),
  };
  await store.setJson(rollKey(roll.rollId), next);
  return next;
}

export async function claimTraitLabMonPayment(payment: TraitLabMonPaymentRecord) {
  const key = monPaymentKey(payment.txHash);
  const existing = await store.getJson<TraitLabMonPaymentRecord | null>(key, null);
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

export async function getTraitSupplyLedger() {
  return await store.getJson<TraitSupplyLedger>(SUPPLY_LEDGER_KEY, emptyLedger());
}

export async function getTraitSupplyItem(traitType: string, value: string) {
  const ledger = await getTraitSupplyLedger();
  return ledger.items[traitSupplyKey(traitType, value)] || null;
}

export async function assertTraitSupplyAvailable(delta: TraitSupplyDelta) {
  if (delta.delta <= 0) return;
  const existing = await getTraitSupplyItem(delta.traitType, delta.value);
  const item = itemFromDelta(delta, existing || undefined);
  const maxActiveSupply = positiveNumber(delta.maxActiveSupply || item.maxActiveSupply);
  if (maxActiveSupply > 0 && item.activeSupply + delta.delta > maxActiveSupply) {
    throw Object.assign(new Error(`${delta.traitType} ${delta.value} has reached its active supply cap.`), { status: 409 });
  }
}

export async function applyTraitSupplyDeltas(event: TraitSupplyEvent) {
  const ledger = await getTraitSupplyLedger();
  const existingEvent = ledger.events.find((entry) => entry.id === event.id);
  if (existingEvent) {
    return { ledger, event: existingEvent, deduped: true };
  }

  const updatedAt = nowIso();
  const items = { ...ledger.items };

  for (const delta of event.deltas) {
    const key = traitSupplyKey(delta.traitType, delta.value);
    const item = itemFromDelta(delta, items[key]);
    const maxActiveSupply = positiveNumber(delta.maxActiveSupply || item.maxActiveSupply);
    const nextActive = item.activeSupply + delta.delta;

    if (delta.delta > 0 && maxActiveSupply > 0 && nextActive > maxActiveSupply) {
      throw Object.assign(new Error(`${delta.traitType} ${delta.value} has reached its active supply cap.`), { status: 409 });
    }

    items[key] = {
      ...item,
      activeSupply: Math.max(0, nextActive),
      burnedSupply: delta.reason === "burn" ? item.burnedSupply + Math.abs(delta.delta) : item.burnedSupply,
      equippedCount: delta.reason === "equip" ? item.equippedCount + delta.delta : item.equippedCount,
      updatedAt,
    };
  }

  const nextLedger: TraitSupplyLedger = {
    version: 1,
    updatedAt,
    items,
    events: ledger.events.concat({ ...event, createdAt: event.createdAt || updatedAt }),
  };
  await store.setJson(SUPPLY_LEDGER_KEY, nextLedger);
  return { ledger: nextLedger, event, deduped: false };
}
