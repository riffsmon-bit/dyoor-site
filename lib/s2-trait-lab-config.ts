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
  "Special",
  "Accessories",
  "Accessories 2",
  "Stickers/Body art",
] as const;

export const S2_GUARANTEED_TRAITS = ["Eyes", "Mouth"] as const;

export const S2_UNLOCKABLE_TRAITS = [
  "Clothes",
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
export type S2TraitLabAction = "reroll" | "unlock";
export type S2TraitLabPaymentMode = "energy" | "mon";

export const S2_TRAIT_LAB_ENERGY_PER_MON = 50;
export const S2_TRAIT_LAB_FLAT_UNLOCK_COST = 750;
export const S2_TRAIT_LAB_SPECIAL_MAX_ACTIVE_SUPPLY = 10;

export const S2_TRAIT_LAB_COSTS = {
  reroll: {
    Eyes: 500,
    Mouth: 500,
    Hat: 750,
    Clothes: 750,
    Accessories: 1000,
    "Accessories 2": 1000,
    "Stickers/Body art": 1000,
    Special: 2500,
  },
  unlock: {
    Eyes: 0,
    Mouth: 0,
    Hat: S2_TRAIT_LAB_FLAT_UNLOCK_COST,
    Clothes: S2_TRAIT_LAB_FLAT_UNLOCK_COST,
    Accessories: S2_TRAIT_LAB_FLAT_UNLOCK_COST,
    "Accessories 2": S2_TRAIT_LAB_FLAT_UNLOCK_COST,
    "Stickers/Body art": S2_TRAIT_LAB_FLAT_UNLOCK_COST,
    Special: S2_TRAIT_LAB_FLAT_UNLOCK_COST,
  },
} as const satisfies Record<S2TraitLabAction, Record<S2EditableTrait, number>>;

export const S2_TRAIT_LAB_MON_COSTS = {
  reroll: {
    Eyes: "10",
    Mouth: "10",
    Hat: "15",
    Clothes: "15",
    Accessories: "20",
    "Accessories 2": "20",
    "Stickers/Body art": "20",
    Special: "50",
  },
  unlock: {
    Eyes: "0",
    Mouth: "0",
    Hat: "15",
    Clothes: "15",
    Accessories: "15",
    "Accessories 2": "15",
    "Stickers/Body art": "15",
    Special: "15",
  },
} as const satisfies Record<S2TraitLabAction, Record<S2EditableTrait, string>>;

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

export function isS2TraitLabAction(value: unknown): value is S2TraitLabAction {
  return value === "reroll" || value === "unlock";
}

export function isS2TraitLabPaymentMode(value: unknown): value is S2TraitLabPaymentMode {
  return value === "energy" || value === "mon";
}
