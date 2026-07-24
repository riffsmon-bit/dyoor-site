import type { TraitLabCompletionRecord } from "@/src/lib/storage/s2TraitLabStore";

export type TraitLabLeaderboardRow = {
  rank: number;
  wallet: string;
  completedOperations: number;
  rerolls: number;
  rerollAlls: number;
  unlocks: number;
  recycles: number;
  energySpentRaw: string;
  energyEarnedRaw: string;
  lastCompletedAt: string;
};

function enabled(value: unknown) {
  return /^(1|true|yes|on|enabled)$/i.test(String(value || "").trim());
}

export function traitLabLeaderboardEnabled(env: NodeJS.ProcessEnv = process.env) {
  return enabled(
    env.DYOOR_TRAIT_LAB_ENABLE_LEADERBOARD
    || env.NEXT_PUBLIC_DYOOR_TRAIT_LAB_ENABLE_LEADERBOARD,
  );
}

export function traitLabBountiesEnabled(env: NodeJS.ProcessEnv = process.env) {
  return enabled(env.DYOOR_TRAIT_LAB_ENABLE_BOUNTIES);
}

function unsignedBigInt(value: unknown) {
  const raw = String(value || "0");
  return /^\d+$/.test(raw) ? BigInt(raw) : 0n;
}

export function buildTraitLabLeaderboard(
  completions: TraitLabCompletionRecord[],
  requestedLimit = 50,
): TraitLabLeaderboardRow[] {
  const limit = Math.min(100, Math.max(1, Math.floor(requestedLimit) || 50));
  const seenRollIds = new Set<string>();
  const rows = new Map<string, Omit<TraitLabLeaderboardRow, "rank"> & {
    energySpent: bigint;
    energyEarned: bigint;
  }>();

  for (const completion of completions) {
    const rollId = String(completion?.rollId || "").trim().toLowerCase();
    const wallet = String(completion?.wallet || "").trim().toLowerCase();
    const completedAt = String(completion?.completedAt || "").trim();
    if (
      !/^0x[a-f0-9]{64}$/.test(rollId)
      || !/^0x[a-f0-9]{40}$/.test(wallet)
      || !completedAt
      || seenRollIds.has(rollId)
    ) {
      continue;
    }
    seenRollIds.add(rollId);

    const current = rows.get(wallet) || {
      wallet,
      completedOperations: 0,
      rerolls: 0,
      rerollAlls: 0,
      unlocks: 0,
      recycles: 0,
      energySpentRaw: "0",
      energyEarnedRaw: "0",
      energySpent: 0n,
      energyEarned: 0n,
      lastCompletedAt: "",
    };
    const action = String(completion.action || "");
    current.completedOperations += 1;
    if (action === "reroll") current.rerolls += 1;
    if (action === "rerollAll") current.rerollAlls += 1;
    if (action === "unlock") current.unlocks += 1;
    if (action === "recycle") {
      current.recycles += 1;
      current.energyEarned += unsignedBigInt(completion.rewardRaw);
    } else {
      current.energySpent += unsignedBigInt(completion.costRaw);
    }
    if (completedAt > current.lastCompletedAt) current.lastCompletedAt = completedAt;
    rows.set(wallet, current);
  }

  return Array.from(rows.values())
    .sort((left, right) => (
      right.completedOperations - left.completedOperations
      || right.rerolls + right.rerollAlls - left.rerolls - left.rerollAlls
      || right.lastCompletedAt.localeCompare(left.lastCompletedAt)
      || left.wallet.localeCompare(right.wallet)
    ))
    .slice(0, limit)
    .map(({ energySpent, energyEarned, ...row }, index) => ({
      ...row,
      rank: index + 1,
      energySpentRaw: energySpent.toString(),
      energyEarnedRaw: energyEarned.toString(),
    }));
}
