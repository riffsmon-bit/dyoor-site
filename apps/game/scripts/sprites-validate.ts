import fs from "node:fs/promises";
import path from "node:path";
import { printReadOnlyBanner } from "./lib/cli";
import { writeJson } from "./lib/json";
import {
  GAME_DATA_ROOT,
  PILOT_SPRITE_ROOT,
  PIXEL_LAYER_ROOT,
  REPOSITORY_ROOT,
  SPRITE_CACHE_ROOT,
} from "./lib/paths";
import { validateSpriteSheet } from "./lib/sprites";

printReadOnlyBanner("Validate directional sprite layers and generated sheets");

async function findPngFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const files: string[] = [];
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findPngFiles(candidate));
    else if (/\.png$/i.test(entry.name)) files.push(candidate);
  }
  return files.sort();
}

const layerFiles = await findPngFiles(PIXEL_LAYER_ROOT);
const generatedFiles = await findPngFiles(SPRITE_CACHE_ROOT);
const pilotFiles = await findPngFiles(PILOT_SPRITE_ROOT);
const results = [];
for (const file of layerFiles) results.push(await validateSpriteSheet(file));
for (const file of generatedFiles) results.push(await validateSpriteSheet(file));
for (const file of pilotFiles) results.push(await validateSpriteSheet(file));
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  spec: "dyoor-overworld-v1",
  layerSheets: layerFiles.length,
  generatedSheets: generatedFiles.length,
  pilotSheets: pilotFiles.length,
  valid: results.filter((result) => result.valid).length,
  invalid: results.filter((result) => !result.valid).length,
  repositoryRoot: path.basename(REPOSITORY_ROOT),
  results,
};
await writeJson(path.join(GAME_DATA_ROOT, "sprite-validation-report.json"), report);
console.log(JSON.stringify(report, null, 2));
if (report.invalid) process.exitCode = 1;
