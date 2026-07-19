#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const DEFAULT_IMAGE_CID = "bafybeifz4gwsvqbypeki3wwwmmvng2z2lusqjndevfqemzibisk266vepq";
const DEFAULT_MAX_SUPPLY = 3333;
const VALID_TRAITS = new Set([
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
  "Conditions",
]);

function usage() {
  console.error(`Usage: node ${basename(process.argv[1])} --dir <metadata-dir> [--image-cid <cid>] [--max-supply 3333]`);
  console.error("Validates local extensionless or .json metadata files before Pinata upload.");
}

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : String(process.argv[index + 1] || fallback);
}

function tokenIdFromFile(fileName) {
  const normalized = fileName.replace(/\.json$/i, "");
  return /^\d+$/.test(normalized) ? Number(normalized) : null;
}

const dir = arg("--dir", process.env.DYOOR_S2_METADATA_DIR || process.env.SEASON2_METADATA_DIR || "");
const imageCid = arg("--image-cid", process.env.DYOOR_S2_IMAGE_CID || DEFAULT_IMAGE_CID);
const maxSupply = Number(arg("--max-supply", process.env.DYOOR_S2_MAX_SUPPLY || String(DEFAULT_MAX_SUPPLY)));

if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) {
  usage();
  process.exit(1);
}
if (!Number.isSafeInteger(maxSupply) || maxSupply <= 0) {
  throw new Error(`Invalid max supply: ${maxSupply}`);
}

const files = readdirSync(dir)
  .filter((fileName) => tokenIdFromFile(fileName))
  .sort((a, b) => tokenIdFromFile(a) - tokenIdFromFile(b));
const seen = new Set();
const invalid = [];
const warnings = [];
let jsonSuffixCount = 0;
let extensionlessCount = 0;

for (const fileName of files) {
  const tokenId = tokenIdFromFile(fileName);
  if (!tokenId || tokenId < 1 || tokenId > maxSupply) {
    invalid.push({ fileName, errors: [`token ID outside 1-${maxSupply}`] });
    continue;
  }
  if (seen.has(tokenId)) invalid.push({ fileName, tokenId, errors: ["duplicate token ID"] });
  seen.add(tokenId);
  if (/\.json$/i.test(fileName)) jsonSuffixCount += 1;
  else extensionlessCount += 1;

  const errors = [];
  let metadata;
  try {
    metadata = JSON.parse(readFileSync(join(dir, fileName), "utf8"));
  } catch (error) {
    invalid.push({ fileName, tokenId, errors: [`JSON parse failed: ${error.message}`] });
    continue;
  }

  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) errors.push("metadata is not an object");
  if (typeof metadata.name !== "string" || !metadata.name.trim()) errors.push("missing name");
  if (metadata.name && !metadata.name.includes(`#${tokenId}`)) warnings.push({ tokenId, warning: "name does not include token ID" });
  if (typeof metadata.description !== "string") errors.push("missing description");
  if (typeof metadata.image !== "string" || !metadata.image.trim()) {
    errors.push("missing image");
  } else {
    if (metadata.image !== `ipfs://${imageCid}/${tokenId}.png`) {
      errors.push(`image must be ipfs://${imageCid}/${tokenId}.png`);
    }
    if (/REPLACE_ME|localhost|testnet|127\.0\.0\.1/i.test(metadata.image)) {
      errors.push("image contains placeholder, localhost, or testnet URL");
    }
  }
  if (!Array.isArray(metadata.attributes)) {
    errors.push("attributes is not an array");
  } else {
    for (const attribute of metadata.attributes) {
      if (!attribute || typeof attribute !== "object") {
        errors.push("attribute entry is not an object");
        continue;
      }
      const traitType = String(attribute.trait_type || "");
      if (!VALID_TRAITS.has(traitType)) errors.push(`invalid trait type ${traitType || "(blank)"}`);
      if (!Object.prototype.hasOwnProperty.call(attribute, "value")) errors.push(`missing value for ${traitType || "trait"}`);
    }
  }

  const serialized = JSON.stringify(metadata);
  if (/REPLACE_ME|localhost|127\.0\.0\.1/i.test(serialized)) {
    errors.push("metadata contains placeholder or localhost text");
  }
  if (/testnet/i.test(serialized)) {
    errors.push("metadata contains testnet-only text");
  }

  if (errors.length) invalid.push({ fileName, tokenId, errors });
}

const missing = [];
for (let tokenId = 1; tokenId <= maxSupply; tokenId += 1) {
  if (!seen.has(tokenId)) missing.push(tokenId);
}

const summary = {
  metadataDir: dir,
  maxSupply,
  imageCid,
  fileCount: files.length,
  jsonSuffixCount,
  extensionlessCount,
  missingCount: missing.length,
  missingSample: missing.slice(0, 25),
  invalidCount: invalid.length,
  invalidSample: invalid.slice(0, 25),
  warningCount: warnings.length,
  warningSample: warnings.slice(0, 25),
};

console.log(JSON.stringify(summary, null, 2));

if (missing.length || invalid.length) {
  process.exit(1);
}
