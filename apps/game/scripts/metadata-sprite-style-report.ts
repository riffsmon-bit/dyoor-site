import path from "node:path";
import { buildMetadataDroidVisual, METADATA_SPRITE_SPEC_VERSION } from "../src/systems/sprites/MetadataDroidVisual";
import { printReadOnlyBanner } from "./lib/cli";
import { writeJson } from "./lib/json";
import { loadAllMetadata } from "./lib/metadata";
import { GAME_DATA_ROOT } from "./lib/paths";

printReadOnlyBanner("Validate metadata-driven sprite style coverage for all 3,333 records");

const metadata = await loadAllMetadata();
if (metadata.failures.length) {
  throw new Error(`Sprite style coverage requires complete metadata; ${metadata.failures.length} record(s) failed.`);
}

function increment(record: Record<string, number>, value: string) {
  record[value] = (record[value] || 0) + 1;
}

const distributions = {
  clothing: {} as Record<string, number>,
  eyes: {} as Record<string, number>,
  mouth: {} as Record<string, number>,
  hat: {} as Record<string, number>,
  condition: {} as Record<string, number>,
  special: {} as Record<string, number>,
  accessory: {} as Record<string, number>,
};
const signatures = new Set<number>();
const invalidTokens: Array<{ tokenId: number; error: string }> = [];

for (const record of metadata.records) {
  try {
    const visual = buildMetadataDroidVisual(record.attributes);
    increment(distributions.clothing, visual.clothing.kind);
    increment(distributions.eyes, visual.eyes.kind);
    increment(distributions.mouth, visual.mouth.kind);
    increment(distributions.hat, visual.hat.kind);
    increment(distributions.condition, visual.condition);
    increment(distributions.special, visual.special);
    for (const accessory of visual.accessories) increment(distributions.accessory, accessory.kind);
    if (!visual.accessories.length) increment(distributions.accessory, "none");
    signatures.add(visual.signature);
  } catch (error) {
    invalidTokens.push({
      tokenId: record.tokenId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  specVersion: METADATA_SPRITE_SPEC_VERSION,
  recordCount: metadata.records.length,
  validRecords: metadata.records.length - invalidTokens.length,
  invalidRecords: invalidTokens.length,
  uniqueVisualSignatures: signatures.size,
  runtimeStrategy: "compose-selected-token-on-demand-from-normalized-metadata",
  status: "engineering-placeholder-until-directional-trait-layers-are-artist-approved",
  categoryTreatment: {
    Background: "selection-card/environment accent only; intentionally excluded from the overworld body silhouette",
    Droid: "body palette, shadow, highlight, and chrome treatment",
    Conditions: "damage, dirt, or S1-skin overlay",
    "Stickers/Body art": "face or torso emblem",
    Clothes: "clothing silhouette, palette, trim, and torso details",
    Mouth: "mouth shape and held-item/drool details",
    Eyes: "eye shape, eyewear, glow, and laser details",
    Hat: "direction-aware headwear silhouette",
    Accessories: "neckwear, shoulder companion, bandana, or emblem",
    "Accessories 2": "second independently composited accessory",
    Special: "highest-priority suit or mask overlay",
  },
  distributions,
  ownershipBoundary: "runtime composition does not grant selection; wallet mode still requires server-verified surviving ownership",
  invalidTokens,
};

await writeJson(path.join(GAME_DATA_ROOT, "metadata-sprite-style-report.json"), report);
console.log(JSON.stringify(report, null, 2));
if (invalidTokens.length) process.exitCode = 1;
