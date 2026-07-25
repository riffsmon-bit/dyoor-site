export const DYOOR_WORLD_CHAT_REWARD_ENERGY = 5;
export const DYOOR_WORLD_CHAT_REWARD_MIN_LENGTH = 20;
export const DYOOR_WORLD_CHAT_REWARD_COOLDOWN_MS = 10 * 60 * 1000;
export const DYOOR_WORLD_CHAT_REWARD_DAILY_CAP = 5;

export const DYOOR_WORLD_TIP_REWARD_ENERGY = 10;
export const DYOOR_WORLD_TIP_REWARD_MIN_MON = "0.1";
export const DYOOR_WORLD_TIP_REWARD_DAILY_CAP = 3;

export const DYOOR_WORLD_TRADE_REWARD_ENERGY = 100;
export const DYOOR_WORLD_TRADE_REWARD_DAILY_CAP = 1;

export const DYOOR_WORLD_DAILY_REWARD_TABLE = [
  { upperBound: 60, energy: 50 },
  { upperBound: 85, energy: 100 },
  { upperBound: 95, energy: 250 },
  { upperBound: 99, energy: 500 },
  { upperBound: 100, energy: 1_000 },
] as const;

export type DyoorWorldRewardKind = "chat" | "daily" | "tip" | "trade";

export type DyoorWorldRewardRecord = {
  version: 1;
  id: string;
  wallet: string;
  kind: DyoorWorldRewardKind;
  amountEnergy: number;
  amountRaw: string;
  createdAt: string;
  utcDate: string;
  messageId?: string;
  referenceId?: string;
};

export type DyoorWorldRewardClaim = {
  version: 1;
  id: string;
  wallet: string;
  rewardIds: string[];
  amountEnergy: number;
  amountRaw: string;
  claimHash: string;
  status: "pending" | "credited" | "failed";
  createdAt: string;
  updatedAt: string;
  txHash?: string;
  error?: string;
};

export function dyoorWorldUtcDate(value: Date | number | string = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid dYOOR World reward date.");
  return date.toISOString().slice(0, 10);
}

export function dyoorWorldDailyPrize(sample: number) {
  const normalized = Math.max(0, Math.min(99, Math.floor(sample)));
  return DYOOR_WORLD_DAILY_REWARD_TABLE.find(
    (entry) => normalized < entry.upperBound,
  )?.energy || 50;
}

export function qualifiesForDyoorWorldChatReward(content: unknown) {
  const normalized = String(content || "").replace(/\s+/g, " ").trim();
  if (normalized.length < DYOOR_WORLD_CHAT_REWARD_MIN_LENGTH) return false;
  const meaningful = normalized.replace(/[^a-z0-9]/gi, "");
  return meaningful.length >= 12;
}
