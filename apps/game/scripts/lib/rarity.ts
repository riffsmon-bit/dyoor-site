import type { NormalizedMetadata } from "./metadata";
import type { TraitManifest } from "./traits";

const EMPTY_VALUES = new Set(["", "none", "empty slot", "n/a", "na", "unknown"]);

export type RarityBreakdown = {
  tokenId: number;
  rarityScore: number;
  visualDistinctiveness: number;
  specialTraitCount: number;
  rareTraitCount: number;
  traits: Array<{
    traitType: string;
    value: string;
    count: number;
    contribution: number;
  }>;
};

export function scoreMetadata(metadata: NormalizedMetadata, manifest: TraitManifest): RarityBreakdown {
  const traits = metadata.attributes.flatMap((attribute) => {
    const entry = manifest.categories[attribute.traitType]?.find((item) => item.value === attribute.value);
    if (!entry) return [];
    return [{
      traitType: attribute.traitType,
      value: attribute.value,
      count: entry.count,
      contribution: Math.log2(Math.max(1, manifest.recordCount / entry.count)),
    }];
  });
  const rareTraitCount = traits.filter((trait) => trait.count / manifest.recordCount <= 0.01).length;
  const specialTraitCount = traits.filter((trait) => (
    trait.traitType === "Special" && !EMPTY_VALUES.has(trait.value.toLowerCase())
  )).length;
  const rarityScore = traits.reduce((sum, trait) => sum + trait.contribution, 0);
  const visualDistinctiveness = rareTraitCount * 2 + specialTraitCount * 4;
  return {
    tokenId: metadata.tokenId,
    rarityScore: Number(rarityScore.toFixed(6)),
    visualDistinctiveness,
    specialTraitCount,
    rareTraitCount,
    traits,
  };
}

type CompatibilityRule = {
  name?: string;
  enabled?: boolean;
  if?: Record<string, string[]>;
  cannot?: Record<string, string[]>;
};

export function compatibilityConflicts(
  metadata: NormalizedMetadata,
  rules: CompatibilityRule[],
) {
  const traits = new Map(metadata.attributes.map((attribute) => [attribute.traitType, attribute.value]));
  return rules.flatMap((rule) => {
    if (rule.enabled === false || !rule.if || !rule.cannot) return [];
    const trigger = Object.entries(rule.if).every(([traitType, values]) => (
      values.includes(traits.get(traitType) || "")
    ));
    if (!trigger) return [];
    const conflict = Object.entries(rule.cannot).some(([traitType, values]) => (
      values.includes(traits.get(traitType) || "")
    ));
    return conflict ? [rule.name || "Unnamed compatibility conflict"] : [];
  });
}
