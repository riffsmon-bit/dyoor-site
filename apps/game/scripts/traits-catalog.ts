import path from "node:path";
import { printReadOnlyBanner } from "./lib/cli";
import { writeJson } from "./lib/json";
import { GAME_DATA_ROOT } from "./lib/paths";
import { loadAllMetadata } from "./lib/metadata";
import {
  attachLayerStatus,
  compactFrequencyReport,
  computeTraitManifest,
  existingTraitOrder,
} from "./lib/traits";

printReadOnlyBanner("Catalog collection traits and pixel-layer requirements");

const metadata = await loadAllMetadata();
if (metadata.failures.length) {
  throw new Error(`Trait catalog requires a complete metadata scan; ${metadata.failures.length} record(s) failed.`);
}
const manifest = await attachLayerStatus(
  computeTraitManifest(metadata.records, await existingTraitOrder()),
);
const missingLayers = Object.entries(manifest.categories).flatMap(([traitType, values]) => (
  values
    .filter((entry) => entry.spriteStatus === "missing")
    .map((entry) => ({
      traitType,
      value: entry.value,
      layerId: entry.layerId,
      requiredSheet: `apps/game/public/assets/sprites/layers/${entry.layerId.split("--")[0]}/${entry.layerId}.png`,
      requiredCanvas: "256x256 transparent PNG (4 directions × 4 frames at 64x64)",
      status: "artist_required",
    }))
));

await Promise.all([
  writeJson(path.join(GAME_DATA_ROOT, "trait-manifest.json"), manifest),
  writeJson(path.join(GAME_DATA_ROOT, "trait-frequency.json"), compactFrequencyReport(manifest)),
  writeJson(path.join(GAME_DATA_ROOT, "artist-task-list.json"), {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    missingLayerCount: missingLayers.length,
    tasks: missingLayers,
  }),
]);

console.log(JSON.stringify({
  records: metadata.records.length,
  categories: Object.keys(manifest.categories).length,
  traitValues: Object.values(manifest.categories).reduce((sum, values) => sum + values.length, 0),
  readyLayers: Object.values(manifest.categories).flat().filter((entry) => entry.spriteStatus === "ready").length,
  missingLayers: missingLayers.length,
}, null, 2));
