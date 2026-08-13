#!/usr/bin/env node
import {
  DEFAULT_WHITELIST_ALLOWANCE,
  DEFAULT_WHITELIST_COUNT,
  DEFAULT_WHITELIST_OUTPUT_DIR,
  DEFAULT_WHITELIST_SOURCE,
  readAndBuildWhitelistMerkle,
  writeWhitelistOutputs,
} from "./regular-whitelist-merkle-lib.js";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : String(process.argv[index + 1] || fallback);
}

function usage() {
  console.error("Usage: node scripts/generate-whitelist-merkle.js [--input <file>] [--output-dir <dir>] [--expected-count 12612] [--allowance 3]");
}

try {
  if (process.argv.includes("--help")) {
    usage();
    process.exit(0);
  }

  const sourceFile = arg("--input", DEFAULT_WHITELIST_SOURCE);
  const outputDir = arg("--output-dir", DEFAULT_WHITELIST_OUTPUT_DIR);
  const expectedCount = Number(arg("--expected-count", String(DEFAULT_WHITELIST_COUNT)));
  const allowance = BigInt(arg("--allowance", DEFAULT_WHITELIST_ALLOWANCE.toString()));

  const result = readAndBuildWhitelistMerkle({ sourceFile, expectedCount, allowance });
  const paths = writeWhitelistOutputs(result, outputDir);

  console.log("Regular whitelist Merkle tree generated.");
  console.log(`Source addresses found: ${result.sourceAddressesFound}`);
  console.log(`Duplicate addresses removed: ${result.duplicateRows.length}`);
  console.log(`Invalid addresses: ${result.invalid.length}`);
  console.log(`Excluded burn/null addresses: ${result.excluded.length}`);
  console.log(`Final unique wallets: ${result.walletCount}`);
  console.log(`Allowance per wallet: ${result.defaultAllowance}`);
  console.log(`Merkle root: ${result.root}`);
  console.log(`Source SHA-256: ${result.sourceSha256}`);
  console.log(`Canonical SHA-256: ${result.canonicalEntriesSha256}`);
  console.log(`Root file: ${paths.root}`);
  console.log(`Proofs file: ${paths.proofs}`);
  console.log(`Entries CSV: ${paths.entriesCsv}`);
  console.log(`Manifest: ${paths.manifest}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
