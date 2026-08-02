export const S2_TRAIT_MARKETPLACE_SLOTS = [
  "Clothes",
  "Hat",
  "Accessories",
  "Accessories 2",
  "Stickers/Body art",
] as const;

export const S2_TRAIT_MARKETPLACE_RARITIES = [
  "Common",
  "Uncommon",
  "Rare",
  "Super Rare",
  "Legendary",
  "Mythic",
] as const;

export type S2TraitMarketplaceSlot = typeof S2_TRAIT_MARKETPLACE_SLOTS[number];
export type S2TraitMarketplaceRarity = typeof S2_TRAIT_MARKETPLACE_RARITIES[number];
export type S2TraitMarketplacePaymentMode = "energy" | "mon";

export const S2_TRAIT_MARKETPLACE_QUOTE_TTL_MS = 10 * 60 * 1000;

// Direct selection is intentionally more expensive than a random Trait Lab
// roll. Energy and MON are separate fixed-price tracks.
export const S2_TRAIT_MARKETPLACE_ENERGY_PRICES: Record<S2TraitMarketplaceRarity, number> = {
  Common: 300,
  Uncommon: 450,
  Rare: 700,
  "Super Rare": 1000,
  Legendary: 1500,
  Mythic: 2500,
};

export const S2_TRAIT_MARKETPLACE_MON_PRICES: Record<S2TraitMarketplaceRarity, number> = {
  Common: 6,
  Uncommon: 9,
  Rare: 14,
  "Super Rare": 75,
  Legendary: 125,
  Mythic: 300,
};

export function isS2TraitMarketplaceSlot(value: unknown): value is S2TraitMarketplaceSlot {
  return S2_TRAIT_MARKETPLACE_SLOTS.includes(value as S2TraitMarketplaceSlot);
}

export function isS2TraitMarketplaceRarity(value: unknown): value is S2TraitMarketplaceRarity {
  return S2_TRAIT_MARKETPLACE_RARITIES.includes(value as S2TraitMarketplaceRarity);
}

export function isS2TraitMarketplacePaymentMode(value: unknown): value is S2TraitMarketplacePaymentMode {
  return value === "energy" || value === "mon";
}

export function traitMarketplaceListingId(traitType: S2TraitMarketplaceSlot, traitId: number) {
  return `${traitType}:${traitId}`;
}

export function traitMarketplacePrice(rarity: S2TraitMarketplaceRarity) {
  const energy = S2_TRAIT_MARKETPLACE_ENERGY_PRICES[rarity];
  const mon = S2_TRAIT_MARKETPLACE_MON_PRICES[rarity];
  return {
    energy,
    energyRaw: (BigInt(energy) * 10n ** 18n).toString(),
    mon: String(mon),
    monRaw: (BigInt(mon) * 10n ** 18n).toString(),
  };
}
