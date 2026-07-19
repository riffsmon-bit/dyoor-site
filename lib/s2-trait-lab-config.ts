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
export type S2TraitLabPaymentMode = "energy" | "mon" | "meme";

export const S2_TRAIT_LAB_ENERGY_PER_MON = 50;
export const S2_TRAIT_LAB_FLAT_UNLOCK_COST = 2500;
export const S2_TRAIT_LAB_SPECIAL_MAX_ACTIVE_SUPPLY = 10;
export const S2_TRAIT_LAB_TOKEN_COOLDOWN_MS = 10 * 60 * 1000;
export const S2_TRAIT_LAB_BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD";
export const S2_TRAIT_LAB_MEME_PAYMENT_TOKENS = [
  { label: "Meme Token 1", symbol: "MEME1", address: "0x43cF5407BDA1400498b8064d50A7e17528d87777" },
  { label: "Meme Token 2", symbol: "MEME2", address: "0x350035555E10d9AfAF1566AaebfCeD5BA6C27777" },
  { label: "Meme Token 3", symbol: "MEME3", address: "0x81A224F8A62f52BdE942dBF23A56df77A10b7777" },
  { label: "Meme Token 4", symbol: "MEME4", address: "0x21E325B059Cd83d4037C82F0F5998Ba2dF3d7777" },
  { label: "Meme Token 5", symbol: "MEME5", address: "0xFD97581D397622f6E6662917ea3DeEEfB9F57777" },
  { label: "Meme Token 6", symbol: "MEME6", address: "0x42a4aA89864A794dE135B23C6a8D2E05513d7777" },
  { label: "Meme Token 7", symbol: "MEME7", address: "0x0CC9B2e2AcD7BACfF79eb7dB48F5662B622E7777" },
] as const;
export const S2_TRAIT_LAB_RECYCLE_REWARDS: Partial<Record<S2TraitLabTrait, number>> = {
  Hat: 250,
  Clothes: 250,
  Special: 750,
  Accessories: 250,
  "Accessories 2": 250,
  "Stickers/Body art": 250,
};

export const S2_TRAIT_LAB_COSTS: Record<S2TraitLabAction, Partial<Record<S2TraitLabTrait, number>>> = {
  reroll: {
    Eyes: 2500,
    Mouth: 2500,
    Hat: 5000,
    Clothes: 5000,
    Accessories: 7500,
    "Accessories 2": 7500,
    "Stickers/Body art": 7500,
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

function monCostFromEnergy(energyCost: number | undefined) {
  if (typeof energyCost !== "number" || energyCost <= 0) return "0";
  return String(energyCost / S2_TRAIT_LAB_ENERGY_PER_MON);
}

function convertedPaymentCosts(action: S2TraitLabAction) {
  return Object.fromEntries(
    Object.entries(S2_TRAIT_LAB_COSTS[action]).map(([trait, cost]) => [trait, monCostFromEnergy(cost)]),
  ) as Partial<Record<S2TraitLabTrait, string>>;
}

export const S2_TRAIT_LAB_MON_COSTS: Record<S2TraitLabAction, Partial<Record<S2TraitLabTrait, string>>> = {
  reroll: convertedPaymentCosts("reroll"),
  unlock: convertedPaymentCosts("unlock"),
  remove: convertedPaymentCosts("remove"),
  recycle: convertedPaymentCosts("recycle"),
};

export const S2_TRAIT_LAB_MEME_TOKEN_COSTS = S2_TRAIT_LAB_MON_COSTS;

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
  return value === "energy" || value === "mon" || value === "meme";
}
