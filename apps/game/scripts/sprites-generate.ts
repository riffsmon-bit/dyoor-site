import path from "node:path";
import fs from "node:fs/promises";
import { argValue, printReadOnlyBanner } from "./lib/cli";
import { REPOSITORY_ROOT, assertPathInside } from "./lib/paths";
import {
  generateTokenSprite,
  loadCachedMetadataToken,
  loadTraitManifest,
  validateSpriteSheet,
} from "./lib/sprites";

printReadOnlyBanner("Generate or recompose one cached droid sprite");

const rawTokenId = argValue("--token-id");
const tokenId = Number(rawTokenId);
if (!Number.isSafeInteger(tokenId) || tokenId < 1 || tokenId > 3333) {
  throw new Error("Usage: npm run game:sprites:generate -- --token-id 1100");
}
const result = await generateTokenSprite(
  await loadCachedMetadataToken(tokenId),
  await loadTraitManifest(),
);
const output = argValue("--output");
if (output) {
  const destination = path.resolve(REPOSITORY_ROOT, output);
  assertPathInside(REPOSITORY_ROOT, destination, "Published placeholder sprite");
  if (!destination.endsWith(".png")) throw new Error("--output must end with .png.");
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(result.outputPath, destination);
  await fs.copyFile(
    result.outputPath.replace(/\.png$/i, ".sprite.json"),
    destination.replace(/\.png$/i, ".sprite.json"),
  );
}
console.log(JSON.stringify({
  ...result,
  validation: await validateSpriteSheet(result.outputPath),
  note: result.status === "placeholder"
    ? "Directional pixel layers are incomplete; generated a labeled engineering placeholder."
    : "Composed from approved directional pixel layers.",
}, null, 2));
