import { ethers } from "ethers";
import { createJsonStore } from "./fileStore";
import type { EnergyBalance, EnergyLedgerEntry, EnergyLedgerType, HarvestEvent } from "./types";

const STORE_NAME = "dyoor-energy-ledger";
const store = createJsonStore(STORE_NAME);

type WalletLedger = {
  wallet: string;
  updatedAt: string;
  entries: EnergyLedgerEntry[];
};

type Checkpoint = {
  name: string;
  block: string;
  updatedAt: string;
  meta?: Record<string, unknown>;
};

const WALLET_INDEX_KEY = "wallet-index.json";

function nowIso() {
  return new Date().toISOString();
}

export function normalizeWallet(value: unknown) {
  try {
    return ethers.getAddress(String(value || "")).toLowerCase();
  } catch {
    return "";
  }
}

export function safeBigInt(value: unknown, fallback = 0n) {
  try {
    return BigInt(String(value || "0"));
  } catch {
    return fallback;
  }
}

export function formatEnergy(raw: bigint) {
  return ethers.formatUnits(raw, 18).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function walletKey(wallet: string) {
  return `wallets/${wallet}.json`;
}

function eventKey(id: string) {
  return `harvest-events/${id.toLowerCase().replace(/[^a-z0-9:_-]/g, "-")}.json`;
}

function checkpointKey(name: string) {
  return `checkpoints/${name.replace(/[^a-zA-Z0-9:_-]/g, "-")}.json`;
}

function entryAmount(entry: EnergyLedgerEntry) {
  return safeBigInt(entry.amountRaw);
}

function ensureWallet(value: unknown) {
  const wallet = normalizeWallet(value);
  if (!wallet) throw Object.assign(new Error("Invalid wallet address."), { status: 400 });
  return wallet;
}

function ensureAmount(value: unknown, allowNegative = false) {
  const amount = safeBigInt(value);
  if (allowNegative ? amount === 0n : amount <= 0n) {
    throw Object.assign(new Error("Energy amount must be greater than zero."), { status: 400 });
  }
  return amount;
}

function isDebit(type: EnergyLedgerType) {
  return type === "DEBIT_REROLL" || type === "DEBIT_UPGRADE" || type === "DEBIT_MARKETPLACE" || type === "DEBIT_TRANSFER";
}

function isOtherCredit(type: EnergyLedgerType) {
  return type === "CREDIT_RECHARGE" || type === "CREDIT_TRANSFER";
}

async function readLedger(wallet: string): Promise<WalletLedger> {
  return await store.getJson<WalletLedger>(walletKey(wallet), {
    wallet,
    updatedAt: "",
    entries: [],
  });
}

async function writeLedger(wallet: string, ledger: WalletLedger) {
  await store.setJson(walletKey(wallet), {
    ...ledger,
    wallet,
    updatedAt: nowIso(),
    entries: [...ledger.entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  });
  const index = await store.getJson<string[]>(WALLET_INDEX_KEY, []);
  if (!index.includes(wallet)) {
    await store.setJson(WALLET_INDEX_KEY, index.concat(wallet).sort());
  }
}

export async function getEnergyLedger(walletInput: unknown) {
  const wallet = ensureWallet(walletInput);
  return await readLedger(wallet);
}

export async function getEnergyWalletIndex() {
  return await store.getJson<string[]>(WALLET_INDEX_KEY, []);
}

export async function exportEnergyLedgers() {
  const wallets = await getEnergyWalletIndex();
  const ledgers = await Promise.all(wallets.map(async (wallet) => await readLedger(wallet)));
  return {
    generatedAt: nowIso(),
    walletCount: wallets.length,
    ledgers,
  };
}

export async function addEnergyLedgerEntry(input: Omit<EnergyLedgerEntry, "wallet" | "createdAt"> & {
  wallet: string;
  createdAt?: string;
}) {
  const wallet = ensureWallet(input.wallet);
  const amount = ensureAmount(input.amountRaw, input.type === "ADJUSTMENT_ADMIN");
  const ledger = await readLedger(wallet);
  const existing = ledger.entries.find((entry) => entry.id === input.id);
  if (existing) {
    return { entry: existing, ledger, deduped: true };
  }

  if (isDebit(input.type)) {
    const balance = balanceFromEntries(wallet, ledger.entries, "0");
    if (safeBigInt(balance.spendableRaw) < amount) {
      throw Object.assign(new Error("Insufficient spendable Energy."), { status: 400 });
    }
  }

  const entry: EnergyLedgerEntry = {
    ...input,
    wallet,
    amountRaw: amount.toString(),
    createdAt: input.createdAt || nowIso(),
  };
  const nextLedger = {
    ...ledger,
    wallet,
    entries: ledger.entries.concat(entry),
  };
  await writeLedger(wallet, nextLedger);
  return { entry, ledger: nextLedger, deduped: false };
}

function balanceFromEntries(wallet: string, entries: EnergyLedgerEntry[], pendingRaw: string): EnergyBalance {
  let harvestedRaw = 0n;
  let airdroppedRaw = 0n;
  let otherCreditRaw = 0n;
  let spentRaw = 0n;
  let adjustmentRaw = 0n;
  let lastUpdatedAt = "";

  for (const entry of entries) {
    const amount = entryAmount(entry);
    if (entry.createdAt > lastUpdatedAt) lastUpdatedAt = entry.createdAt;
    if (entry.type === "CREDIT_HARVEST") harvestedRaw += amount;
    if (entry.type === "CREDIT_AIRDROP") airdroppedRaw += amount;
    if (isOtherCredit(entry.type)) otherCreditRaw += amount;
    if (isDebit(entry.type)) spentRaw += amount;
    if (entry.type === "ADJUSTMENT_ADMIN") adjustmentRaw += amount;
  }

  const lifetimeRaw = harvestedRaw + airdroppedRaw + otherCreditRaw;
  const spendableRaw = harvestedRaw + airdroppedRaw + otherCreditRaw + adjustmentRaw - spentRaw;

  return {
    wallet,
    pendingRaw: safeBigInt(pendingRaw).toString(),
    harvestedRaw: harvestedRaw.toString(),
    airdroppedRaw: airdroppedRaw.toString(),
    otherCreditRaw: otherCreditRaw.toString(),
    spentRaw: spentRaw.toString(),
    adjustmentRaw: adjustmentRaw.toString(),
    spendableRaw: (spendableRaw > 0n ? spendableRaw : 0n).toString(),
    lifetimeRaw: lifetimeRaw.toString(),
    entryCount: entries.length,
    lastUpdatedAt,
  };
}

export async function getEnergyBalance(walletInput: unknown, pendingRaw = "0") {
  const wallet = ensureWallet(walletInput);
  const ledger = await readLedger(wallet);
  return balanceFromEntries(wallet, ledger.entries, pendingRaw);
}

export async function upsertHarvestEvent(event: HarvestEvent) {
  const wallet = ensureWallet(event.wallet);
  const amount = ensureAmount(event.amountRaw);
  const id = String(event.id || `${event.txHash}:${event.logIndex}`).toLowerCase();
  const existing = await store.getJson<HarvestEvent | null>(eventKey(id), null);
  if (existing) {
    const ledger = await readLedger(wallet);
    return { event: existing, ledger, deduped: true };
  }

  const normalizedEvent: HarvestEvent = {
    ...event,
    id,
    wallet,
    amountRaw: amount.toString(),
    txHash: String(event.txHash || "").toLowerCase(),
    logIndex: String(event.logIndex || "0"),
    blockNumber: String(event.blockNumber || "0"),
    source: event.source || "staking-event",
  };
  await store.setJson(eventKey(id), normalizedEvent);
  const { ledger } = await addEnergyLedgerEntry({
    id: `harvest:${id}`,
    wallet,
    amountRaw: amount.toString(),
    type: "CREDIT_HARVEST",
    source: normalizedEvent.source || "staking-event",
    txHash: normalizedEvent.txHash,
    blockNumber: normalizedEvent.blockNumber,
    notes: "Indexed PointsClaimed harvest event.",
  });
  return { event: normalizedEvent, ledger, deduped: false };
}

export async function addEnergyDebit(params: {
  id: string;
  wallet: string;
  amountRaw: string;
  type: Extract<EnergyLedgerType, "DEBIT_REROLL" | "DEBIT_UPGRADE" | "DEBIT_MARKETPLACE">;
  source: string;
  tokenId?: string;
  notes?: string;
}) {
  return await addEnergyLedgerEntry(params);
}

export async function getCheckpoint(name: string) {
  return await store.getJson<Checkpoint | null>(checkpointKey(name), null);
}

export async function setCheckpoint(name: string, block: string | number | bigint, meta?: Record<string, unknown>) {
  const checkpoint: Checkpoint = {
    name,
    block: safeBigInt(block).toString(),
    updatedAt: nowIso(),
    meta,
  };
  await store.setJson(checkpointKey(name), checkpoint);
  return checkpoint;
}
