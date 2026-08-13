import traitFrequency from "../../../../../data/game/trait-frequency.json";
import type {
  CharacterProfile,
  CoreEmissionState,
  EmissionTier,
  Trait,
} from "../../types/game";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const MAX_BANKED_ENERGY = 1_000_000;
const MIN_COLLECTION_SCORE = 20.075773;

export const MAX_EMISSION_CREDIT_MS = 8 * HOUR;

export type EmissionTierDefinition = {
  tier: EmissionTier;
  minimumScore: number;
  energyPerHour: number;
  color: string;
};

/**
 * Score boundaries are fixed collection-wide percentiles from the verified
 * 3,333-record rarity report. Rates are prototype balance values only.
 */
export const EMISSION_TIERS: readonly EmissionTierDefinition[] = [
  { tier: "mythic", minimumScore: 40.469005, energyPerHour: 100, color: "#ffdf69" },
  { tier: "legendary", minimumScore: 35.803753, energyPerHour: 65, color: "#ff7edb" },
  { tier: "epic", minimumScore: 32.463521, energyPerHour: 40, color: "#aa82ff" },
  { tier: "rare", minimumScore: 29.729391, energyPerHour: 25, color: "#55d8ff" },
  { tier: "uncommon", minimumScore: 27.533511, energyPerHour: 15, color: "#61f2a7" },
  { tier: "common", minimumScore: Number.NEGATIVE_INFINITY, energyPerHour: 10, color: "#d5dbe8" },
] as const;

type FrequencyData = {
  recordCount: number;
  categories: Record<string, Record<string, { count: number }>>;
};

const frequencies = traitFrequency as FrequencyData;

function safeNumber(value: unknown, fallback: number, maximum = MAX_BANKED_ENERGY) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(maximum, parsed));
}

function rounded(value: number, places = 6) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function findTraitCount(trait: Trait) {
  const category = frequencies.categories[trait.traitType]
    || Object.entries(frequencies.categories).find(
      ([name]) => name.toLowerCase() === trait.traitType.toLowerCase(),
    )?.[1];
  if (!category) return frequencies.recordCount;
  const exact = category[trait.value];
  if (exact) return exact.count;
  return Object.entries(category).find(
    ([value]) => value.toLowerCase() === trait.value.toLowerCase(),
  )?.[1].count || frequencies.recordCount;
}

export function calculateCollectionRarityScore(character: CharacterProfile) {
  if (!character.tokenId) return MIN_COLLECTION_SCORE;
  return rounded(character.traits.reduce((score, trait) => {
    const count = Math.max(1, findTraitCount(trait));
    return score + Math.log2(frequencies.recordCount / count);
  }, 0));
}

export function emissionTierForScore(score: number) {
  return EMISSION_TIERS.find((definition) => score >= definition.minimumScore)
    || EMISSION_TIERS[EMISSION_TIERS.length - 1]!;
}

export function createDefaultCoreEmission(
  character: CharacterProfile,
  now = Date.now(),
): CoreEmissionState {
  const rarityScore = calculateCollectionRarityScore(character);
  const definition = emissionTierForScore(rarityScore);
  return {
    rarityScore,
    tier: definition.tier,
    energyPerHour: definition.energyPerHour,
    bankedEnergy: 0,
    lifetimeEnergy: 0,
    lastAccruedAt: Math.max(0, Math.floor(now)),
  };
}

/**
 * Re-derives tier and hourly rate from current normalized metadata every time.
 * Stored rarity labels and rates are never trusted.
 */
export function normalizeCoreEmission(
  value: unknown,
  character: CharacterProfile,
  now = Date.now(),
): CoreEmissionState {
  const calculated = createDefaultCoreEmission(character, now);
  if (!value || typeof value !== "object" || Array.isArray(value)) return calculated;
  const input = value as Record<string, unknown>;
  const parsedLastAccruedAt = Number(input.lastAccruedAt);
  const validTimestamp = Number.isSafeInteger(parsedLastAccruedAt)
    && parsedLastAccruedAt >= 0
    && parsedLastAccruedAt <= now + MINUTE;
  const lastAccruedAt = validTimestamp
    ? Math.max(parsedLastAccruedAt, now - MAX_EMISSION_CREDIT_MS)
    : now;
  const elapsedMs = Math.max(0, now - lastAccruedAt);
  const emitted = calculated.energyPerHour * (elapsedMs / HOUR);
  const bankedEnergy = safeNumber(input.bankedEnergy, 0);
  const lifetimeEnergy = safeNumber(input.lifetimeEnergy, bankedEnergy);
  return {
    ...calculated,
    bankedEnergy: rounded(Math.min(MAX_BANKED_ENERGY, bankedEnergy + emitted)),
    lifetimeEnergy: rounded(Math.min(MAX_BANKED_ENERGY, lifetimeEnergy + emitted)),
    lastAccruedAt: Math.max(0, Math.floor(now)),
  };
}

export function addEmissionEnergy(
  state: CoreEmissionState,
  quantity: number,
): CoreEmissionState {
  const award = safeNumber(quantity, 0, 100_000);
  return {
    ...state,
    bankedEnergy: rounded(Math.min(MAX_BANKED_ENERGY, state.bankedEnergy + award)),
    lifetimeEnergy: rounded(Math.min(MAX_BANKED_ENERGY, state.lifetimeEnergy + award)),
  };
}

export function formatEmissionEnergy(value: number) {
  if (value >= 1_000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
