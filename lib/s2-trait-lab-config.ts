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

export type S2RequiredTrait = typeof S2_REQUIRED_TRAITS[number];
export type S2LockedTrait = typeof S2_LOCKED_TRAITS[number];
export type S2EditableTrait = typeof S2_EDITABLE_TRAITS[number];
export type S2TraitLabAction = "reroll" | "unlock";
export type S2TraitLabPaymentMode = "energy" | "mon";

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
    Eyes: 750,
    Mouth: 750,
    Hat: 1000,
    Clothes: 1000,
    Accessories: 1500,
    "Accessories 2": 1500,
    "Stickers/Body art": 1500,
    Special: 3500,
  },
} as const satisfies Record<S2TraitLabAction, Record<S2EditableTrait, number>>;

export const S2_TRAIT_LAB_MON_COSTS = {
  reroll: {
    Eyes: "0",
    Mouth: "0",
    Hat: "0",
    Clothes: "0",
    Accessories: "0",
    "Accessories 2": "0",
    "Stickers/Body art": "0",
    Special: "0",
  },
  unlock: {
    Eyes: "0",
    Mouth: "0",
    Hat: "0",
    Clothes: "0",
    Accessories: "0",
    "Accessories 2": "0",
    "Stickers/Body art": "0",
    Special: "0",
  },
} as const satisfies Record<S2TraitLabAction, Record<S2EditableTrait, string>>;

export function isS2EditableTrait(value: unknown): value is S2EditableTrait {
  return S2_EDITABLE_TRAITS.includes(value as S2EditableTrait);
}

export function isS2LockedTrait(value: unknown): value is S2LockedTrait {
  return S2_LOCKED_TRAITS.includes(value as S2LockedTrait);
}

export function isS2TraitLabAction(value: unknown): value is S2TraitLabAction {
  return value === "reroll" || value === "unlock";
}

export function isS2TraitLabPaymentMode(value: unknown): value is S2TraitLabPaymentMode {
  return value === "energy" || value === "mon";
}
