import { describe, expect, it } from "vitest";
import {
  calculateCollectionRarityScore,
  createDefaultCoreEmission,
  emissionTierForScore,
  MAX_EMISSION_CREDIT_MS,
  normalizeCoreEmission,
} from "../src/systems/emission/CoreEmission";
import { MOCK_HOLDER_DROIDS, TRAINING_DROID } from "../src/data/characters";

describe("local-only passive Core Emission", () => {
  it("derives transparent rarity tiers and keeps Commons at 10 Energy per hour", () => {
    expect(emissionTierForScore(20).tier).toBe("common");
    expect(emissionTierForScore(20).energyPerHour).toBe(10);
    expect(emissionTierForScore(27.6).tier).toBe("uncommon");
    expect(emissionTierForScore(30).tier).toBe("rare");
    expect(emissionTierForScore(33).tier).toBe("epic");
    expect(emissionTierForScore(36).tier).toBe("legendary");
    expect(emissionTierForScore(41).tier).toBe("mythic");
  });

  it("scores actual normalized traits using the collection-wide frequency model", () => {
    const token16 = MOCK_HOLDER_DROIDS[0];
    expect(token16).toBeDefined();
    expect(calculateCollectionRarityScore(token16!)).toBeCloseTo(32.2805, 4);
    expect(createDefaultCoreEmission(token16!, 1_700_000_000_000).tier).toBe("rare");
    expect(createDefaultCoreEmission(TRAINING_DROID, 1_700_000_000_000).tier).toBe("common");
  });

  it("accrues while the player is away or completing quests", () => {
    const now = 1_700_000_000_000;
    const token16 = MOCK_HOLDER_DROIDS[0]!;
    const initial = createDefaultCoreEmission(token16, now);
    const accrued = normalizeCoreEmission(
      initial,
      token16,
      now + (2 * 60 * 60 * 1_000),
    );
    expect(accrued.tier).toBe("rare");
    expect(accrued.energyPerHour).toBe(25);
    expect(accrued.bankedEnergy).toBe(50);
    expect(accrued.lifetimeEnergy).toBe(50);
  });

  it("caps offline credit and ignores stored tier or rate manipulation", () => {
    const now = 1_700_000_000_000;
    const token16 = MOCK_HOLDER_DROIDS[0]!;
    const normalized = normalizeCoreEmission(
      {
        tier: "mythic",
        energyPerHour: 99_999,
        rarityScore: 999,
        bankedEnergy: 5,
        lifetimeEnergy: 7,
        lastAccruedAt: now - (30 * 24 * 60 * 60 * 1_000),
      },
      token16,
      now,
    );
    expect(normalized.tier).toBe("rare");
    expect(normalized.energyPerHour).toBe(25);
    expect(normalized.bankedEnergy).toBe(5 + (25 * MAX_EMISSION_CREDIT_MS / 3_600_000));
  });
});
