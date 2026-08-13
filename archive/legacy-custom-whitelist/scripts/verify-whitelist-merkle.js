#!/usr/bin/env node
import { readFileSync } from "node:fs";
import {
  DEFAULT_WHITELIST_ALLOWANCE,
  DEFAULT_WHITELIST_COUNT,
  DEFAULT_WHITELIST_OUTPUT_DIR,
  DEFAULT_WHITELIST_SOURCE,
  readAndBuildWhitelistMerkle,
  verifyProof,
} from "./regular-whitelist-merkle-lib.js";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : String(process.argv[index + 1] || fallback);
}

try {
  const sourceFile = arg("--input", DEFAULT_WHITELIST_SOURCE);
  const outputDir = arg("--output-dir", DEFAULT_WHITELIST_OUTPUT_DIR);
  const expectedCount = Number(arg("--expected-count", String(DEFAULT_WHITELIST_COUNT)));
  const allowance = BigInt(arg("--allowance", DEFAULT_WHITELIST_ALLOWANCE.toString()));
  const rootPath = `${outputDir}/regular-whitelist-root.json`;
  const proofsPath = `${outputDir}/regular-whitelist-proofs.json`;

  const rebuilt = readAndBuildWhitelistMerkle({ sourceFile, expectedCount, allowance });
  const rootFile = JSON.parse(readFileSync(rootPath, "utf8"));
  const generatedProofs = JSON.parse(readFileSync(proofsPath, "utf8"));

  if (rootFile.root.toLowerCase() !== rebuilt.root.toLowerCase()) {
    throw new Error(`Generated root mismatch. File=${rootFile.root} rebuilt=${rebuilt.root}`);
  }
  if (Number(rootFile.walletCount) !== expectedCount) {
    throw new Error(`Root file wallet count mismatch. Expected ${expectedCount}; got ${rootFile.walletCount}.`);
  }

  let verified = 0;
  for (const row of rebuilt.rows) {
    const entry = generatedProofs[row.lower];
    if (!entry) throw new Error(`Missing proof for ${row.address}`);
    if (String(entry.allowance) !== allowance.toString()) {
      throw new Error(`Allowance mismatch for ${row.address}: ${entry.allowance}`);
    }
    if (!verifyProof({ proof: entry.proof, root: rebuilt.root, leaf: row.leaf })) {
      throw new Error(`Proof failed for ${row.address}`);
    }
    verified += 1;
  }

  console.log("Regular whitelist proofs verified.");
  console.log(`Final unique wallets: ${rebuilt.walletCount}`);
  console.log(`Allowance per wallet: ${rebuilt.defaultAllowance}`);
  console.log(`Verified proofs: ${verified}`);
  console.log(`Merkle root: ${rebuilt.root}`);
  console.log(`Source SHA-256: ${rebuilt.sourceSha256}`);
  console.log(`Canonical SHA-256: ${rebuilt.canonicalEntriesSha256}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
