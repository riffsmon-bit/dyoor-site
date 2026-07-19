#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { getAddress } from "ethers";

const DEFAULT_INPUT = "DYOOR_WL_Comma_Separated_Merged_Deduped_v3.txt";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] || fallback;
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function parseAddresses(contents) {
  return contents
    .replace(/^\uFEFF/, "")
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeAddresses(rawAddresses) {
  const seen = new Map();
  const invalid = [];
  const excluded = [];

  rawAddresses.forEach((raw, index) => {
    try {
      const checksum = getAddress(raw);
      const lower = checksum.toLowerCase();
      if (lower === ZERO_ADDRESS || lower === DEAD_ADDRESS.toLowerCase()) {
        excluded.push({ input: raw, index: index + 1, reason: "burn/null address" });
        return;
      }
      if (!seen.has(lower)) {
        seen.set(lower, checksum);
      }
    } catch (error) {
      invalid.push({ input: raw, index: index + 1, reason: error.shortMessage || error.message });
    }
  });

  return {
    addresses: Array.from(seen.values()).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
    duplicateCount: rawAddresses.length - invalid.length - excluded.length - seen.size,
    invalid,
    excluded,
  };
}

function main() {
  const input = arg("--input", process.env.DYOOR_OPENSEA_WALLET_LIST_INPUT || DEFAULT_INPUT);
  const stage = arg("--stage", process.env.DYOOR_OPENSEA_WALLET_LIST_STAGE || "regular-wl");
  const limit = BigInt(arg("--limit", process.env.DYOOR_OPENSEA_WALLET_LIMIT || "3"));
  const outputDir = arg("--output-dir", process.env.DYOOR_OPENSEA_WALLET_LIST_OUTPUT || "wallet-list-exports/opensea");

  if (limit <= 0n) throw new Error("--limit must be a positive integer.");
  if (!existsSync(input)) {
    throw new Error(`Wallet list source not found: ${input}. Add the finalized source file or pass --input.`);
  }

  const contents = readFileSync(input, "utf8");
  const rawAddresses = parseAddresses(contents);
  const normalized = normalizeAddresses(rawAddresses);
  if (normalized.invalid.length || normalized.excluded.length) {
    throw new Error(`Wallet list contains ${normalized.invalid.length} invalid and ${normalized.excluded.length} excluded addresses.`);
  }

  const canonical = normalized.addresses.map((address) => address.toLowerCase()).join("\n") + "\n";
  const addressOnlyPath = join(outputDir, `${stage}-addresses.csv`);
  const withLimitPath = join(outputDir, `${stage}-with-limit.csv`);
  const manifestPath = join(outputDir, `${stage}-manifest.json`);
  const validationPath = join(outputDir, `${stage}-validation.json`);
  mkdirSync(outputDir, { recursive: true });

  writeFileSync(addressOnlyPath, `address\n${normalized.addresses.join("\n")}\n`);
  writeFileSync(
    withLimitPath,
    `address,maxMintable\n${normalized.addresses.map((address) => `${address},${limit.toString()}`).join("\n")}\n`,
  );

  const report = {
    generatedAt: new Date().toISOString(),
    stage,
    sourceFile: input,
    sourceSha256: sha256(contents),
    canonicalSha256: sha256(canonical),
    rawEntries: rawAddresses.length,
    uniqueWallets: normalized.addresses.length,
    duplicateAddressesRemoved: normalized.duplicateCount,
    invalidAddresses: normalized.invalid,
    excludedAddresses: normalized.excluded,
    perWalletLimit: limit.toString(),
    outputs: {
      addressOnlyCsv: addressOnlyPath,
      withLimitCsv: withLimitPath,
      manifest: manifestPath,
      validation: validationPath,
    },
    notes: [
      "OpenSea UI format must be confirmed manually before upload.",
      "Use the one-address-per-row file if the UI asks only for wallets.",
      "Use the with-limit file if the UI supports per-wallet limit columns.",
    ],
  };

  writeFileSync(manifestPath, `${JSON.stringify({ ...report, addresses: normalized.addresses }, null, 2)}\n`);
  writeFileSync(validationPath, `${JSON.stringify(report, null, 2)}\n`);
  mkdirSync(dirname(validationPath), { recursive: true });
  console.log(JSON.stringify(report, null, 2));
}

main();
