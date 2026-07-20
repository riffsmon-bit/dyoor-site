export const S2_REQUIRED_TRAITS = [
  "Background",
  "Droid",
  "Eyes",
  "Clothes",
  "Mouth",
  "Hat",
  "Special",
  "Accessories",
  "Accessories 2",
  "Stickers/Body art",
] as const;

export const S2_LOCKED_TRAITS = ["Background", "Droid"] as const;

export const S2_EDITABLE_TRAITS = [
  "Eyes",
  "Clothes",
  "Mouth",
  "Hat",
  "Accessories",
  "Accessories 2",
  "Stickers/Body art",
] as const;

export const S2_GUARANTEED_TRAITS = ["Eyes", "Mouth"] as const;

export const S2_UNLOCKABLE_TRAITS = [
  "Clothes",
  "Hat",
  "Accessories",
  "Accessories 2",
  "Stickers/Body art",
] as const;

export const S2_REMOVABLE_TRAITS = [
  "Clothes",
  "Hat",
  "Special",
  "Accessories",
  "Accessories 2",
  "Stickers/Body art",
] as const;

export const S2_RECYCLABLE_TRAITS = S2_REMOVABLE_TRAITS;

export const S2_TRAIT_LAB_TRAITS = [
  "Eyes",
  "Clothes",
  "Mouth",
  "Hat",
  "Special",
  "Accessories",
  "Accessories 2",
  "Stickers/Body art",
] as const;

export type S2RequiredTrait = typeof S2_REQUIRED_TRAITS[number];
export type S2LockedTrait = typeof S2_LOCKED_TRAITS[number];
export type S2EditableTrait = typeof S2_EDITABLE_TRAITS[number];
export type S2GuaranteedTrait = typeof S2_GUARANTEED_TRAITS[number];
export type S2UnlockableTrait = typeof S2_UNLOCKABLE_TRAITS[number];
export type S2RemovableTrait = typeof S2_REMOVABLE_TRAITS[number];
export type S2RecyclableTrait = typeof S2_RECYCLABLE_TRAITS[number];
export type S2TraitLabTrait = typeof S2_TRAIT_LAB_TRAITS[number];
export type S2TraitLabAction = "reroll" | "unlock" | "remove" | "recycle";
export type S2TraitLabPaymentMode = "energy";

export const S2_TRAIT_LAB_FLAT_UNLOCK_COST = 100;
export const S2_TRAIT_LAB_SPECIAL_MAX_ACTIVE_SUPPLY = 10;
export const S2_TRAIT_LAB_TOKEN_COOLDOWN_MS = 10 * 60 * 1000;
export const S2_TRAIT_LAB_DROID_BURN_REWARD_ENERGY = 2500;
export const S2_TRAIT_LAB_RECYCLE_REWARDS: Partial<Record<S2TraitLabTrait, number>> = {
  Hat: 50,
  Clothes: 50,
  Special: 150,
  Accessories: 50,
  "Accessories 2": 50,
  "Stickers/Body art": 50,
};

export const S2_TRAIT_LAB_COSTS: Record<S2TraitLabAction, Partial<Record<S2TraitLabTrait, number>>> = {
  reroll: {
    Eyes: 100,
    Mouth: 100,
    Hat: 200,
    Clothes: 200,
    Accessories: 300,
    "Accessories 2": 300,
    "Stickers/Body art": 300,
  },
  unlock: {
    Eyes: 0,
    Mouth: 0,
    Hat: S2_TRAIT_LAB_FLAT_UNLOCK_COST,
    Clothes: S2_TRAIT_LAB_FLAT_UNLOCK_COST,
    Accessories: S2_TRAIT_LAB_FLAT_UNLOCK_COST,
    "Accessories 2": S2_TRAIT_LAB_FLAT_UNLOCK_COST,
    "Stickers/Body art": S2_TRAIT_LAB_FLAT_UNLOCK_COST,
  },
  remove: {
    Hat: S2_TRAIT_LAB_FLAT_UNLOCK_COST,
    Clothes: S2_TRAIT_LAB_FLAT_UNLOCK_COST,
    Special: S2_TRAIT_LAB_FLAT_UNLOCK_COST,
    Accessories: S2_TRAIT_LAB_FLAT_UNLOCK_COST,
    "Accessories 2": S2_TRAIT_LAB_FLAT_UNLOCK_COST,
    "Stickers/Body art": S2_TRAIT_LAB_FLAT_UNLOCK_COST,
  },
  recycle: {
    Hat: 0,
    Clothes: 0,
    Special: 0,
    Accessories: 0,
    "Accessories 2": 0,
    "Stickers/Body art": 0,
  },
};

export function isS2EditableTrait(value: unknown): value is S2EditableTrait {
  return S2_EDITABLE_TRAITS.includes(value as S2EditableTrait);
}

export function isS2LockedTrait(value: unknown): value is S2LockedTrait {
  return S2_LOCKED_TRAITS.includes(value as S2LockedTrait);
}

export function isS2GuaranteedTrait(value: unknown): value is S2GuaranteedTrait {
  return S2_GUARANTEED_TRAITS.includes(value as S2GuaranteedTrait);
}

export function isS2UnlockableTrait(value: unknown): value is S2UnlockableTrait {
  return S2_UNLOCKABLE_TRAITS.includes(value as S2UnlockableTrait);
}

export function isS2RemovableTrait(value: unknown): value is S2RemovableTrait {
  return S2_REMOVABLE_TRAITS.includes(value as S2RemovableTrait);
}

export function isS2RecyclableTrait(value: unknown): value is S2RecyclableTrait {
  return S2_RECYCLABLE_TRAITS.includes(value as S2RecyclableTrait);
}

export function isS2TraitLabTrait(value: unknown): value is S2TraitLabTrait {
  return S2_TRAIT_LAB_TRAITS.includes(value as S2TraitLabTrait);
}

export function isS2TraitLabAction(value: unknown): value is S2TraitLabAction {
  return value === "reroll" || value === "unlock" || value === "remove" || value === "recycle";
}

export function isS2TraitLabPaymentMode(value: unknown): value is S2TraitLabPaymentMode {
  return value === "energy";
}
