import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  attributesToTraitMap,
  compareBlueprintToMintedNFT,
  getBlueprintRewardTier,
  normalizeWalletAddress
} from "../src/ascensionBlueprintHelpers.js";

const BLUEPRINTS_PATH = "data/ascension-blueprints.json";
const MATCHES_PATH = "data/ascension-blueprint-matches.json";
const WINNERS_PATH = "data/ascension-blueprint-winners.json";
const DEFAULT_METADATA_DIR = "data/season2-metadata";

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function loadMetadataRecords(metadataDir) {
  const files = await readdir(metadataDir).catch(() => []);
  const records = [];
  for (const file of files.filter((name) => name.endsWith(".json"))) {
    const fullPath = path.join(metadataDir, file);
    const metadata = await readJson(fullPath, null);
    if (!metadata) continue;
    const tokenId = String(metadata.tokenId || metadata.token_id || file.replace(/\.json$/i, ""));
    const wallet = normalizeWalletAddress(metadata.wallet || metadata.owner || metadata.minter || "");
    records.push({ tokenId, wallet, metadata });
  }
  return records;
}

function matchRecord(wallet, blueprint, tokenId, rewardTier, traits) {
  return {
    wallet,
    blueprintId: blueprint.blueprintId,
    tokenId: String(tokenId),
    exactMatch: true,
    rewardTier,
    checkedAt: new Date().toISOString(),
    claimed: false,
    traits
  };
}

async function main() {
  const metadataDir = process.env.SEASON2_METADATA_DIR || process.argv.find((arg) => arg.startsWith("--metadata-dir="))?.split("=", 2)[1] || DEFAULT_METADATA_DIR;
  const blueprints = await readJson(BLUEPRINTS_PATH, []);
  const previousMatches = await readJson(MATCHES_PATH, []);
  if (!Array.isArray(blueprints)) throw new Error(`${BLUEPRINTS_PATH} must contain an array.`);
  if (!Array.isArray(previousMatches)) throw new Error(`${MATCHES_PATH} must contain an array.`);

  const metadataRecords = await loadMetadataRecords(metadataDir);
  const nextMatches = [...previousMatches];
  const seen = new Set(nextMatches.map((entry) => `${normalizeWalletAddress(entry.wallet)}:${String(entry.tokenId)}`));

  for (const blueprint of blueprints) {
    const wallet = normalizeWalletAddress(blueprint.wallet);
    if (!wallet) continue;

    const walletMints = metadataRecords.filter((record) => !record.wallet || record.wallet === wallet);
    for (const record of walletMints) {
      const mintedTraits = attributesToTraitMap(record.metadata);
      const comparison = compareBlueprintToMintedNFT(blueprint.traits, mintedTraits);
      if (!comparison.exactMatch) continue;

      const key = `${wallet}:${record.tokenId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      nextMatches.push(matchRecord(wallet, blueprint, record.tokenId, getBlueprintRewardTier(record.metadata), mintedTraits));
    }
  }

  const winners = nextMatches.filter((entry) => entry.exactMatch);
  await writeFile(MATCHES_PATH, `${JSON.stringify(nextMatches, null, 2)}\n`, "utf8");
  await writeFile(WINNERS_PATH, `${JSON.stringify(winners, null, 2)}\n`, "utf8");
  console.log(`Checked ${blueprints.length} Blueprint wallet(s) against ${metadataRecords.length} metadata record(s).`);
  console.log(`Wrote ${winners.length} winner record(s) to ${WINNERS_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
