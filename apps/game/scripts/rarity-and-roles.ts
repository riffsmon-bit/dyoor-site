import path from "node:path";
import { printReadOnlyBanner } from "./lib/cli";
import { readJson, readJsonOrNull, writeJson } from "./lib/json";
import { loadAllMetadata } from "./lib/metadata";
import { GAME_DATA_ROOT, REPOSITORY_ROOT } from "./lib/paths";
import { compatibilityConflicts, scoreMetadata } from "./lib/rarity";
import { loadTraitManifest } from "./lib/sprites";
import type { PublicDroidRegistryRecord } from "./lib/classification";
import type { GameRole } from "./lib/classification";
import { applyManualRoleOverride } from "./lib/roles";

type ManualRoleOverride = {
  gameRole?: GameRole;
  region?: string | null;
  recruitable?: boolean;
  notes?: string;
};

type ManualOverridesFile = {
  schemaVersion: 1;
  overrides: Record<string, ManualRoleOverride>;
};

type RegistryFile = {
  schemaVersion: 1;
  generatedAt: string;
  chainScanBlock: number;
  records: PublicDroidRegistryRecord[];
};

type TraitCatalog = {
  incompatibilityRules?: Array<{
    name?: string;
    enabled?: boolean;
    if?: Record<string, string[]>;
    cannot?: Record<string, string[]>;
  }>;
};

printReadOnlyBanner("Calculate transparent rarity scores and generate role candidates");

const [metadataResult, manifest, registry, overrides, catalog] = await Promise.all([
  loadAllMetadata(),
  loadTraitManifest(),
  readJson<RegistryFile>(path.join(GAME_DATA_ROOT, "droid-registry.json")),
  readJsonOrNull<ManualOverridesFile>(path.join(GAME_DATA_ROOT, "manual-role-overrides.json")),
  readJsonOrNull<TraitCatalog>(path.join(REPOSITORY_ROOT, "data", "dyoor-s2-trait-catalog.json")),
]);
if (metadataResult.failures.length) throw new Error("Role generation requires a complete metadata scan.");
if (registry.schemaVersion !== 1) throw new Error("Droid registry version is unsupported.");
const manualOverrides = overrides?.schemaVersion === 1 ? overrides.overrides : {};
const metadataById = new Map(metadataResult.records.map((metadata) => [metadata.tokenId, metadata]));
const scores = metadataResult.records.map((metadata) => ({
  ...scoreMetadata(metadata, manifest),
  conflicts: compatibilityConflicts(metadata, catalog?.incompatibilityRules || []),
}));
const scoreById = new Map(scores.map((score) => [score.tokenId, score]));

for (const record of registry.records) {
  const score = scoreById.get(record.tokenId);
  record.rarityScore = score?.rarityScore || 0;
  const manual = manualOverrides[String(record.tokenId)];
  Object.assign(record, applyManualRoleOverride(record, manual));
}

const unminted = scores
  .filter((score) => registry.records.find((record) => record.tokenId === score.tokenId)?.blockchainStatus === "unminted")
  .sort((left, right) => right.rarityScore - left.rarityScore || left.tokenId - right.tokenId);
const percentile60 = unminted[Math.floor(unminted.length * 0.4)]?.rarityScore || 0;

function candidate(score: typeof scores[number], suggestedRole: string, reason: string) {
  const metadata = metadataById.get(score.tokenId);
  return {
    tokenId: score.tokenId,
    suggestedRole,
    rarityScore: score.rarityScore,
    visualDistinctiveness: score.visualDistinctiveness,
    specialTraitCount: score.specialTraitCount,
    rareTraitCount: score.rareTraitCount,
    conflicts: score.conflicts,
    traits: metadata?.attributes || [],
    reason,
    requiresHumanReview: true,
    manualOverride: manualOverrides[String(score.tokenId)] || null,
  };
}

const regionalBossCandidates = unminted
  .filter((score) => !score.conflicts.length && score.visualDistinctiveness >= 4)
  .slice(0, 12)
  .map((score) => candidate(
    score,
    "regional_boss",
    "High collection-wide information score plus multiple visually distinctive traits; not automatically assigned.",
  ));
const regionalIds = new Set(regionalBossCandidates.map((entry) => entry.tokenId));
const dungeonBossCandidates = unminted
  .filter((score) => !regionalIds.has(score.tokenId) && !score.conflicts.length && score.rareTraitCount >= 1)
  .slice(0, 24)
  .map((score) => candidate(
    score,
    "dungeon_boss",
    "Distinctive but reserved below the regional shortlist; story and sprite feasibility still require review.",
  ));
const companionCandidates = unminted
  .filter((score) => !score.conflicts.length && score.specialTraitCount === 0 && score.rareTraitCount <= 2)
  .slice(0, 30)
  .map((score) => candidate(
    score,
    "companion",
    "Readable trait combination without compatibility conflicts; rarity is not being treated as automatic boss status.",
  ));
const visuallyDistinctiveCommonCharacters = unminted
  .filter((score) => score.rarityScore <= percentile60 && score.visualDistinctiveness >= 2 && !score.conflicts.length)
  .sort((left, right) => right.visualDistinctiveness - left.visualDistinctiveness || left.tokenId - right.tokenId)
  .slice(0, 30)
  .map((score) => candidate(
    score,
    "quest_npc",
    "Lower aggregate rarity with one or more visually legible hooks suitable for recurring world characters.",
  ));
const specialTraitConflicts = scores
  .filter((score) => score.conflicts.length)
  .map((score) => ({
    tokenId: score.tokenId,
    conflicts: score.conflicts,
    rarityScore: score.rarityScore,
  }));
const rarityValues = scores.map((score) => score.rarityScore).sort((left, right) => left - right);
const rarityMean = rarityValues.reduce((total, value) => total + value, 0) / Math.max(1, rarityValues.length);
const rarityMedian = rarityValues.length
  ? rarityValues[Math.floor(rarityValues.length / 2)] || 0
  : 0;
const compactScores = scores.map((score) => ({
  tokenId: score.tokenId,
  rarityScore: score.rarityScore,
  visualDistinctiveness: score.visualDistinctiveness,
  specialTraitCount: score.specialTraitCount,
  rareTraitCount: score.rareTraitCount,
  conflicts: score.conflicts,
}));
const topDetailedScores = [...scores]
  .sort((left, right) => right.rarityScore - left.rarityScore || left.tokenId - right.tokenId)
  .slice(0, 100);

const candidateReport = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  scoringModel: {
    name: "collection-wide trait information score",
    formula: "sum(log2(total metadata records / trait value count))",
    purpose: "story-role candidate review only",
    marketValueClaim: false,
  },
  policy: [
    "Rarity never assigns a boss role automatically.",
    "Manual overrides always take priority.",
    "Only unminted metadata records are considered for game-controlled roles.",
    "Surviving minted tokens remain player characters and burned tokens remain Burned Echoes.",
  ],
  regionalBossCandidates,
  dungeonBossCandidates,
  companionCandidates,
  visuallyDistinctiveCommonCharacters,
  specialTraitConflicts,
  missingMetadataOrImages: metadataResult.failures,
};

await Promise.all([
  writeJson(path.join(GAME_DATA_ROOT, "droid-registry.json"), registry),
  writeJson(path.join(GAME_DATA_ROOT, "unminted-role-candidates.json"), candidateReport),
  writeJson(path.join(GAME_DATA_ROOT, "rarity-report.json"), {
    schemaVersion: 1,
    generatedAt: candidateReport.generatedAt,
    scoringModel: candidateReport.scoringModel,
    summary: {
      records: scores.length,
      minimum: rarityValues[0] || 0,
      maximum: rarityValues[rarityValues.length - 1] || 0,
      mean: Number(rarityMean.toFixed(6)),
      median: rarityMedian,
    },
    records: compactScores,
    topDetailedScores,
    traitFrequenciesFile: "data/game/trait-frequency.json",
  }),
]);

console.log(JSON.stringify({
  scored: scores.length,
  unmintedCandidates: unminted.length,
  regionalBossCandidates: regionalBossCandidates.length,
  dungeonBossCandidates: dungeonBossCandidates.length,
  companionCandidates: companionCandidates.length,
  visuallyDistinctiveCommonCharacters: visuallyDistinctiveCommonCharacters.length,
  specialTraitConflicts: specialTraitConflicts.length,
  manualOverrides: Object.keys(manualOverrides).length,
}, null, 2));
