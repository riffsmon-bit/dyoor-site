import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { getAddress } from "viem";
import {
  S2_ASCENDED_AIRDROP_EXPECTED,
  buildAirdropBatches,
  mergeDuplicateRows,
  parseAirdropCsv,
  projectedSupplyStatus,
  validateFinalAirdropCsv,
} from "../lib/s2-airdrop.ts";

const A = getAddress("0x1000000000000000000000000000000000000001");
const B = getAddress("0x1000000000000000000000000000000000000002");
const C = getAddress("0x1000000000000000000000000000000000000003");
const CONTRACT = getAddress("0x2000000000000000000000000000000000000001");
const SNAPSHOT = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function csv(rows, header = "wallet,quantity") {
  return [header, ...rows].join("\n");
}

test("parses canonical wallet,quantity CSV", () => {
  const parsed = parseAirdropCsv(csv([`${A},3`, `${B},1`]));
  assert.equal(parsed.invalidRows.length, 0);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.totalQuantity, 4n);
  assert.equal(parsed.rows[0].quantity, 3n);
});

test("parses backward-compatible wallet,amount CSV", () => {
  const parsed = parseAirdropCsv(csv([`${A},3`], "wallet,amount"));
  assert.equal(parsed.invalidRows.length, 0);
  assert.equal(parsed.totalQuantity, 3n);
});

test("handles BOM, CRLF, whitespace, mixed-case headers, blanks, and quoted values", () => {
  const parsed = parseAirdropCsv(`\uFEFF Wallet , Quantity \r\n "${A}" , "2" \r\n\r\n ${B} , 4 \r\n`);
  assert.equal(parsed.invalidRows.length, 0);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.totalQuantity, 6n);
});

test("rejects invalid addresses and malformed populated rows", () => {
  const parsed = parseAirdropCsv(csv([
    "not-address,1",
    `${A},1,unexpected`,
    `"${B},2`,
  ]));
  assert.equal(parsed.invalidRows.length, 3);
});

test("rejects zero, negative, decimal, scientific, and empty quantities", () => {
  const parsed = parseAirdropCsv(csv([
    `${A},0`,
    `${B},-1`,
    `${C},1.5`,
    `${getAddress("0x1000000000000000000000000000000000000004")},1e3`,
    `${getAddress("0x1000000000000000000000000000000000000005")},`,
  ]));
  assert.equal(parsed.invalidRows.length, 5);
});

test("rejects missing headers and empty files", () => {
  assert.equal(parseAirdropCsv("").invalidRows.length, 1);
  assert.equal(parseAirdropCsv("wallet\n0x1000000000000000000000000000000000000001").invalidRows.length, 2);
});

test("rejects conflicting quantity and amount values", () => {
  const parsed = parseAirdropCsv(csv([`${A},2,3`], "wallet,quantity,amount"));
  assert.equal(parsed.invalidRows.length, 1);
  assert.match(parsed.invalidRows[0].reason, /Conflicting/);
});

test("detects duplicate wallets case-insensitively and merges only when explicit", () => {
  const parsed = parseAirdropCsv(csv([`${A},2`, `${A.toLowerCase()},5`, `${B},1`]));
  assert.equal(parsed.duplicateRows.length, 1);
  assert.equal(parsed.duplicateRows[0].totalQuantity, 7n);

  const merged = mergeDuplicateRows(parsed);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((row) => row.wallet === A).quantity, 7n);
  assert.deepEqual(merged.find((row) => row.wallet === A).sourceLineNumbers, [2, 3]);
});

test("parses large bigint quantities without unsafe number handling", () => {
  const parsed = parseAirdropCsv(csv([`${A},900719925474099312345`]));
  assert.equal(parsed.invalidRows.length, 0);
  assert.equal(parsed.totalQuantity, 900719925474099312345n);
});

test("builds deterministic ABI-encoded batch IDs", () => {
  const parsed = parseAirdropCsv(csv([`${A},2`, `${B},1`, `${C},3`]));
  const first = buildAirdropBatches({
    batchSize: 2,
    chainId: 10143,
    contractAddress: CONTRACT,
    rows: parsed.rows,
    snapshotChecksum: SNAPSHOT,
  });
  const second = buildAirdropBatches({
    batchSize: 2,
    chainId: 10143,
    contractAddress: CONTRACT,
    rows: parsed.rows,
    snapshotChecksum: SNAPSHOT,
  });
  assert.equal(first.length, 2);
  assert.equal(first[0].batchId, second[0].batchId);
  assert.equal(first[0].quantityMinted, 3n);
  assert.equal(first[1].quantityMinted, 3n);
});

test("detects supply changes before batch execution", () => {
  const ok = projectedSupplyStatus(100n, 3333n, 610n);
  assert.equal(ok.exceedsSupply, false);
  assert.equal(ok.projected, 710n);

  const overflow = projectedSupplyStatus(3000n, 3333n, 610n);
  assert.equal(overflow.exceedsSupply, true);
});

test("validates finalized file totals when finalized CSV is present", { skip: !fs.existsSync(S2_ASCENDED_AIRDROP_EXPECTED.csvFilename) }, () => {
  const parsed = parseAirdropCsv(fs.readFileSync(S2_ASCENDED_AIRDROP_EXPECTED.csvFilename, "utf8"));
  const validation = validateFinalAirdropCsv(parsed);
  assert.equal(validation.ok, true, validation.errors.join("\n"));
  assert.equal(parsed.invalidRows.length, 0);
  assert.equal(parsed.duplicateRows.length, 0);
  assert.equal(new Set(parsed.rows.map((row) => row.wallet.toLowerCase())).size, 56);
  assert.equal(parsed.totalQuantity, 610n);
});
