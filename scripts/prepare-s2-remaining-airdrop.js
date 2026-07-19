#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getAddress, isAddress } from "viem";

const TREASURY_ADDRESS = getAddress("0x4d540f7d0eb841c839334655c9f88313d750c6d5");
const HOLDER_SNAPSHOT_EXPECTED = 510n;
const ORIGINAL_EXTRA_TREASURY_RESERVE = 100n;
const ALREADY_AIRDROPPED_TO_TREASURY = 1n;
const REMAINING_EXTRA_TREASURY_RESERVE =
  ORIGINAL_EXTRA_TREASURY_RESERVE - ALREADY_AIRDROPPED_TO_TREASURY;
const EXPECTED_UNIQUE_WALLETS = 56;
const EXPECTED_TOTAL_QUANTITY = HOLDER_SNAPSHOT_EXPECTED + REMAINING_EXTRA_TREASURY_RESERVE;
const EXPECTED_TREASURY_QUANTITY = 34n + REMAINING_EXTRA_TREASURY_RESERVE;

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : String(process.argv[index + 1] || fallback);
}

function sha256Hex(text) {
  return createHash("sha256").update(text).digest("hex");
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && quoted && next === "\"") {
      current += "\"";
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  if (quoted) throw new Error(`Malformed CSV line: ${line}`);
  return values;
}

function parseQuantity(value, lineNumber) {
  const raw = String(value || "").trim();
  if (!/^\d+$/.test(raw)) throw new Error(`Invalid quantity on line ${lineNumber}: ${raw}`);
  const quantity = BigInt(raw);
  if (quantity <= 0n) throw new Error(`Quantity must be positive on line ${lineNumber}`);
  return quantity;
}

function parseHolderCsv(input) {
  if (!existsSync(input)) throw new Error(`Missing holder snapshot CSV: ${input}`);
  const text = readFileSync(input, "utf8");
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.trim());
  if (headerIndex === -1) throw new Error("CSV is empty.");
  const headers = parseCsvLine(lines[headerIndex]).map((header) => header.toLowerCase());
  const walletIndex = headers.indexOf("wallet");
  const quantityIndex = headers.findIndex((header) =>
    ["quantity", "amount", "stakedcount", "staked_count", "count"].includes(header)
  );
  if (walletIndex === -1 || quantityIndex === -1) {
    throw new Error("CSV must include wallet and quantity/amount/stakedCount/staked_count.");
  }

  const rows = [];
  const seen = new Set();
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    if (!lines[index].trim()) continue;
    const columns = parseCsvLine(lines[index]);
    const lineNumber = index + 1;
    const rawWallet = String(columns[walletIndex] || "").trim();
    if (!isAddress(rawWallet)) throw new Error(`Invalid wallet on line ${lineNumber}: ${rawWallet}`);
    const wallet = getAddress(rawWallet);
    const key = wallet.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate wallet in holder snapshot: ${wallet}`);
    seen.add(key);
    rows.push({
      lineNumber,
      wallet,
      holderQuantity: parseQuantity(columns[quantityIndex], lineNumber),
      quantity: parseQuantity(columns[quantityIndex], lineNumber),
    });
  }
  return rows;
}

function bigintJson(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

const source = arg("--source", "exports/dyoor-s1-airdrop-wallets-staked-count.csv");
const output = arg("--output", "airdrop-manifests/dyoor-s2-remaining-airdrop-609.csv");
const reportPath = arg("--report", "airdrop-manifests/dyoor-s2-remaining-airdrop-609.prepare.json");

const rows = parseHolderCsv(source);
const holderTotal = rows.reduce((total, row) => total + row.holderQuantity, 0n);
if (rows.length !== EXPECTED_UNIQUE_WALLETS) {
  throw new Error(`Expected ${EXPECTED_UNIQUE_WALLETS} holder wallets; found ${rows.length}.`);
}
if (holderTotal !== HOLDER_SNAPSHOT_EXPECTED) {
  throw new Error(`Expected holder total ${HOLDER_SNAPSHOT_EXPECTED}; found ${holderTotal}.`);
}

const treasuryRow = rows.find((row) => row.wallet.toLowerCase() === TREASURY_ADDRESS.toLowerCase());
if (!treasuryRow) throw new Error("Treasury wallet is missing from holder snapshot.");
treasuryRow.quantity += REMAINING_EXTRA_TREASURY_RESERVE;

const totalQuantity = rows.reduce((total, row) => total + row.quantity, 0n);
if (totalQuantity !== EXPECTED_TOTAL_QUANTITY) {
  throw new Error(`Expected remaining total ${EXPECTED_TOTAL_QUANTITY}; found ${totalQuantity}.`);
}
if (treasuryRow.quantity !== EXPECTED_TREASURY_QUANTITY) {
  throw new Error(`Expected treasury remaining quantity ${EXPECTED_TREASURY_QUANTITY}; found ${treasuryRow.quantity}.`);
}

const csv = [
  "wallet,quantity",
  ...rows.map((row) => `${row.wallet},${row.quantity.toString()}`),
  "",
].join("\n");

const report = {
  generatedAt: new Date().toISOString(),
  source,
  output,
  sourceSha256: sha256Hex(readFileSync(source, "utf8")),
  outputSha256: sha256Hex(csv),
  uniqueWallets: rows.length,
  holderSnapshotAllocation: holderTotal,
  originalExtraTreasuryReserve: ORIGINAL_EXTRA_TREASURY_RESERVE,
  alreadyAirdroppedToTreasury: ALREADY_AIRDROPPED_TO_TREASURY,
  remainingExtraTreasuryReserve: REMAINING_EXTRA_TREASURY_RESERVE,
  combinedRemainingAllocation: totalQuantity,
  treasuryAddress: TREASURY_ADDRESS,
  treasuryHolderAllocation: treasuryRow.holderQuantity,
  treasuryRemainingAllocation: treasuryRow.quantity,
  note: "Derived file for the remaining mainnet airdrop after token #1 was already airdropped to treasury for OpenSea indexing.",
};

mkdirSync(dirname(output), { recursive: true });
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(output, csv);
writeFileSync(reportPath, `${JSON.stringify(report, bigintJson, 2)}\n`);
console.log(JSON.stringify(report, bigintJson, 2));
