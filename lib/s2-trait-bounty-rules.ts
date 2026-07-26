export const TRAIT_BOUNTY_ACTION_REROLL = 1;
export const TRAIT_BOUNTY_ACTION_UNLOCK = 2;
export const TRAIT_BOUNTY_ACTION_REROLL_ALL = 4;
export const TRAIT_BOUNTY_SUPPORTED_ACTION_MASK = (
  TRAIT_BOUNTY_ACTION_REROLL
  | TRAIT_BOUNTY_ACTION_UNLOCK
  | TRAIT_BOUNTY_ACTION_REROLL_ALL
);

type CompletionLike = {
  result?: Record<string, unknown>;
};

type SupplyDeltaResult = {
  traitType?: unknown;
  value?: unknown;
  delta?: unknown;
  reason?: unknown;
};

export function traitBountyActions(actionMaskValue: unknown) {
  const actionMask = Number(actionMaskValue || 0);
  const actions: string[] = [];
  if (actionMask & TRAIT_BOUNTY_ACTION_REROLL) actions.push("Reroll");
  if (actionMask & TRAIT_BOUNTY_ACTION_UNLOCK) actions.push("Unlock");
  if (actionMask & TRAIT_BOUNTY_ACTION_REROLL_ALL) actions.push("Reroll All");
  return actions;
}

export function traitBountyRevealsFromCompletion(completion: CompletionLike) {
  const deltas = Array.isArray(completion.result?.supplyDeltas)
    ? completion.result.supplyDeltas as SupplyDeltaResult[]
    : [];
  const seen = new Set<string>();
  return deltas.flatMap((delta) => {
    const traitType = String(delta?.traitType || "").trim();
    const traitValue = String(delta?.value || "").trim();
    const amount = Number(delta?.delta || 0);
    const reason = String(delta?.reason || "");
    const key = `${traitType}\u0000${traitValue}`;
    if (
      !traitType
      || !traitValue
      || amount <= 0
      || reason !== "equip"
      || seen.has(key)
    ) {
      return [];
    }
    seen.add(key);
    return [{ traitType, traitValue }];
  });
}
