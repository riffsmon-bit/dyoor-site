#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  S2_ASCENDED_AIRDROP_EXPECTED,
  canonicalRecipientChecksum,
  parseAirdropCsv,
  validateFinalAirdropCsv,
} from "../lib/s2-airdrop.ts";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : String(process.argv[index + 1] || fallback);
}

function sha256Hex(text) {
  return createHash("sha256").update(text).digest("hex");
}

function bigintJson(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

const input = arg("--input", S2_ASCENDED_AIRDROP_EXPECTED.csvFilename);
const manifestPath = arg("--manifest", "airdrop-manifests/dyoor-s2-ascended-airdrop.json");
const validationPath = arg("--report", "airdrop-manifests/dyoor-s2-ascended-airdrop.validation.json");
const noWrite = process.argv.includes("--no-write");

if (!existsSync(input)) {
  console.error(`Missing finalized CSV: ${input}`);
  process.exit(1);
}

const contents = readFileSync(input, "utf8");
const csvSha256 = sha256Hex(contents);
const parsed = parseAirdropCsv(contents);
const finalValidation = validateFinalAirdropCsv(parsed);
const uniqueWallets = new Set(parsed.rows.map((row) => row.wallet.toLowerCase())).size;

const report = {
  generatedAt: new Date().toISOString(),
  csvFilename: input,
  csvSha256,
  canonicalRecipientChecksum: canonicalRecipientChecksum(parsed.rows),
  validRows: parsed.rows.length,
  invalidRows: parsed.invalidRows.length,
  duplicateWallets: parsed.duplicateRows.length,
  uniqueWallets,
  totalQuantity: parsed.totalQuantity,
  expected: S2_ASCENDED_AIRDROP_EXPECTED,
  finalValidation,
  invalidRowSample: parsed.invalidRows.slice(0, 25),
  duplicateRows: parsed.duplicateRows,
};

const manifest = {
  schemaVersion: 1,
  collection: "D.Y.O.O.R Season 2",
  source: "Ascended Season 1 staking snapshot",
  airdropRatio: "1:1",
  chainId: null,
  contractAddress: null,
  csvFilename: S2_ASCENDED_AIRDROP_EXPECTED.csvFilename,
  csvSha256,
  canonicalRecipientChecksum: report.canonicalRecipientChecksum,
  uniqueWallets,
  holderSnapshotAllocation: S2_ASCENDED_AIRDROP_EXPECTED.holderSnapshotQuantity.toString(),
  additionalTreasuryReserve: {
    wallet: S2_ASCENDED_AIRDROP_EXPECTED.treasuryAddress,
    quantity: S2_ASCENDED_AIRDROP_EXPECTED.additionalTreasuryQuantity.toString(),
    note: "Added to the existing treasury wallet row; no duplicate treasury row.",
  },
  totalQuantity: parsed.totalQuantity.toString(),
  treasuryAddress: S2_ASCENDED_AIRDROP_EXPECTED.treasuryAddress,
  treasuryFinalQuantity: S2_ASCENDED_AIRDROP_EXPECTED.treasuryFinalQuantity.toString(),
  recipients: parsed.rows.map((row) => ({
    wallet: row.wallet,
    quantity: row.quantity.toString(),
  })),
};

console.log(JSON.stringify(report, bigintJson, 2));

if (!noWrite) {
  mkdirSync(dirname(manifestPath), { recursive: true });
  mkdirSync(dirname(validationPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(validationPath, `${JSON.stringify(report, bigintJson, 2)}\n`);
}

if (!finalValidation.ok) {
  console.error(finalValidation.errors.join("\n"));
  process.exit(1);
}
