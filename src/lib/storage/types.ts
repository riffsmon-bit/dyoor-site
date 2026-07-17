export type EnergyLedgerType =
  | "CREDIT_HARVEST"
  | "CREDIT_AIRDROP"
  | "CREDIT_RECHARGE"
  | "CREDIT_TRANSFER"
  | "DEBIT_REROLL"
  | "DEBIT_UPGRADE"
  | "DEBIT_MARKETPLACE"
  | "DEBIT_TRANSFER"
  | "ADJUSTMENT_ADMIN";

export type EnergyLedgerEntry = {
  id: string;
  wallet: string;
  amountRaw: string;
  type: EnergyLedgerType;
  source: string;
  txHash?: string;
  tokenId?: string;
  createdAt: string;
  blockNumber?: string;
  notes?: string;
};

export type HarvestEvent = {
  id: string;
  wallet: string;
  amountRaw: string;
  txHash: string;
  logIndex: string;
  blockNumber: string;
  timestamp?: string;
  source?: string;
};

export type EnergyBalance = {
  wallet: string;
  pendingRaw: string;
  harvestedRaw: string;
  airdroppedRaw: string;
  otherCreditRaw: string;
  spentRaw: string;
  adjustmentRaw: string;
  spendableRaw: string;
  lifetimeRaw: string;
  entryCount: number;
  lastUpdatedAt: string;
};

export type SnapshotTokenRow = {
  tokenId: string;
  wallet: string;
  depositedAtBlock: string;
  depositedAtTx: string;
  status: "ascended" | "unstaked" | "unknown";
};

export type SnapshotWalletRow = {
  wallet: string;
  ascendedCount: number;
  tokenIds: string[];
};

export type AscendedS1Snapshot = {
  id: string;
  generatedAt: string;
  fromBlock: string;
  toBlock: string;
  totalAscendedTokens: number;
  uniqueWallets: number;
  tokens: SnapshotTokenRow[];
  wallets: SnapshotWalletRow[];
  warnings: string[];
  errors: string[];
};

export type TraitOverride = {
  version?: number;
  frozen?: boolean;
  name?: string;
  description?: string;
  image?: string;
  attributes?: Record<string, string>;
  updatedAt?: string;
  updatedBy?: string;
  notes?: string;
};
