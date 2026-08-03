import { createJsonStore } from "./fileStore";
import type { TraitSupplyDelta } from "./s2TraitLabStore";

const STORE_NAME = "dyoor-s2-metadata";
const QUOTE_PREFIX = "trait-marketplace/quotes";
const MON_PAYMENT_PREFIX = "trait-marketplace/mon-payments";
const store = createJsonStore(STORE_NAME);

export type TraitMarketplaceQuoteStatus =
  | "quoted"
  | "charging"
  | "charged"
  | "committing"
  | "metadata_committed"
  | "recovery_required"
  | "completed"
  | "expired";

export type TraitMarketplaceQuoteRecord = {
  version: 1;
  quoteId: string;
  wallet: string;
  tokenId: string;
  listingId: string;
  traitId: number;
  traitType: string;
  traitValue: string;
  rarity: string;
  image: string;
  paymentMode: "energy" | "mon";
  costEnergy: number;
  costEnergyRaw: string;
  costMon: string;
  costMonRaw: string;
  costLabel: string;
  previousValue: string;
  previousAttributes: Record<string, string>;
  proposedAttributes: Record<string, string>;
  metadataVersion: number;
  supplyDeltas: TraitSupplyDelta[];
  currentMetadata?: Record<string, unknown>;
  proposedMetadata?: Record<string, unknown>;
  previewImageUrl?: string;
  purchaseNonce: string;
  status: TraitMarketplaceQuoteStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  chargedAt?: string;
  committingAt?: string;
  metadataCommittedAt?: string;
  completedAt?: string;
  failedAt?: string;
  lastError?: string;
  energyDebitId?: string;
  energyDebitDeduped?: boolean;
  monPaymentTxHash?: string;
  monPaymentBlockNumber?: string;
  monPaymentDeduped?: boolean;
  result?: Record<string, unknown>;
};

export type TraitMarketplaceMonPaymentRecord = {
  version: 1;
  txHash: string;
  quoteId: string;
  wallet: string;
  tokenId: string;
  listingId: string;
  amountRaw: string;
  treasuryWallet: string;
  blockNumber: string;
  createdAt: string;
};

function safeHash(value: string, label: string) {
  const hash = String(value || "").trim().toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(hash)) {
    throw Object.assign(new Error(`${label} must be a 32-byte hash.`), { status: 400 });
  }
  return hash;
}

function quoteKey(quoteId: string) {
  return `${QUOTE_PREFIX}/${safeHash(quoteId, "quoteId")}.json`;
}

function monPaymentKey(txHash: string) {
  return `${MON_PAYMENT_PREFIX}/${safeHash(txHash, "txHash")}.json`;
}

function nowIso() {
  return new Date().toISOString();
}

export async function getTraitMarketplaceQuote(quoteId: string) {
  return await store.getJsonStrict<TraitMarketplaceQuoteRecord>(quoteKey(quoteId));
}

export async function saveTraitMarketplaceQuote(record: TraitMarketplaceQuoteRecord) {
  const existing = await getTraitMarketplaceQuote(record.quoteId);
  const next: TraitMarketplaceQuoteRecord = {
    ...existing,
    ...record,
    version: 1,
    quoteId: safeHash(record.quoteId, "quoteId"),
    createdAt: existing?.createdAt || record.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
  await store.setJson(quoteKey(next.quoteId), next);
  return next;
}

export async function claimTraitMarketplaceMonPayment(payment: TraitMarketplaceMonPaymentRecord) {
  const txHash = safeHash(payment.txHash, "txHash");
  const quoteId = safeHash(payment.quoteId, "quoteId");
  const key = monPaymentKey(txHash);
  const existing = await store.getJsonStrict<TraitMarketplaceMonPaymentRecord>(key);
  if (existing && existing.quoteId !== quoteId) {
    throw Object.assign(new Error("This MON transaction has already been used for another marketplace purchase."), { status: 409 });
  }
  if (existing) return { payment: existing, deduped: true };

  const next: TraitMarketplaceMonPaymentRecord = {
    ...payment,
    version: 1,
    txHash,
    quoteId,
    wallet: payment.wallet.toLowerCase(),
    createdAt: payment.createdAt || nowIso(),
  };
  await store.setJson(key, next);
  return { payment: next, deduped: false };
}
