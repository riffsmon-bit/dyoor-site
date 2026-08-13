import { createHash } from "node:crypto";
import path from "node:path";
import { printReadOnlyBanner } from "./lib/cli";
import { writeJson } from "./lib/json";
import { GAME_DATA_ROOT } from "./lib/paths";
import { loadAllMetadata, METADATA_MAX_SUPPLY } from "./lib/metadata";

printReadOnlyBanner("Scan and validate all Season 2 metadata records");

const result = await loadAllMetadata();
const digest = createHash("sha256");
for (const record of result.records) digest.update(record.sourceHashInput);
const categories = new Map<string, Set<string>>();
for (const record of result.records) {
  for (const attribute of record.attributes) {
    if (!categories.has(attribute.traitType)) categories.set(attribute.traitType, new Set());
    categories.get(attribute.traitType)?.add(attribute.value);
  }
}
const report = {
  schemaVersion: 1,
  scannedAt: new Date().toISOString(),
  expectedRecords: METADATA_MAX_SUPPLY,
  validRecords: result.records.length,
  invalidOrUnavailableRecords: result.failures.length,
  tokenRange: result.records.length
    ? { minimum: result.records[0]?.tokenId, maximum: result.records.at(-1)?.tokenId }
    : null,
  cacheHits: result.cacheHits,
  remoteReads: result.remoteReads,
  localReads: result.localReads,
  metadataBaseUrl: result.metadataBaseUrl,
  canonicalDigest: digest.digest("hex"),
  categories: [...categories].map(([traitType, values]) => ({
    traitType,
    uniqueValues: values.size,
  })),
  failures: result.failures,
};

await writeJson(path.join(GAME_DATA_ROOT, "metadata-scan-report.json"), report);
console.log(JSON.stringify(report, null, 2));
if (result.failures.length || result.records.length !== METADATA_MAX_SUPPLY) process.exitCode = 1;
