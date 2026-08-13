import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import {
  getAddress,
  getBytes,
  keccak256,
  toBeHex,
  zeroPadValue,
} from "ethers";

const ledger = JSON.parse(fs.readFileSync(
  "data/robinhood/onchain-128/hoodyoor-energy-migration-ledger.json",
  "utf8",
));
const binary = fs.readFileSync(
  "data/robinhood/onchain-128/hoodyoor-energy-migration.bin",
);
const UNIT = 10n ** 18n;

test("HoodYØØR Energy migration is frozen to an exact verified Monad block", () => {
  assert.equal(ledger.schema, "dyoor-hoodyoor-energy-migration-v1");
  assert.equal(ledger.status, "frozen");
  assert.equal(ledger.source.chainId, 143);
  assert.equal(
    getAddress(ledger.source.energyBank),
    "0x291a8cC0FCa08EBd64a0e4d67B4455d24e9E6767",
  );
  assert.equal(ledger.source.snapshotBlock, 94583241);
  assert.equal(ledger.destination.chainId, 4663);
  assert.equal(ledger.destination.conversion.rounding, "floor");
  assert.equal(ledger.destination.conversion.divisor, UNIT.toString());
  assert.equal(ledger.source.energyLogCount, Object.values(ledger.source.eventCounts)
    .reduce((total, count) => total + count, 0));
  assert.equal(ledger.totals.sourceWallets, 129);
  assert.equal(ledger.totals.migratedWallets, 126);
  assert.equal(ledger.totals.destinationEnergy, "2023191");
});

test("every Energy row applies the production debit overlay before whole-unit conversion", () => {
  let previous = "";
  let destinationTotal = 0n;
  for (const row of ledger.rows) {
    const wallet = getAddress(row.wallet).toLowerCase();
    assert.ok(wallet > previous, `wallet order: ${wallet}`);
    previous = wallet;
    const source = BigInt(row.sourceSpendableRaw);
    const debit = BigInt(row.serverSettledDebitRaw);
    const effective = BigInt(row.effectiveSpendableRaw);
    assert.equal(effective, source > debit ? source - debit : 0n, row.wallet);
    assert.equal(BigInt(row.destinationEnergy), effective / UNIT, row.wallet);
    assert.equal(BigInt(row.discardedFractionRaw), effective % UNIT, row.wallet);
    destinationTotal += BigInt(row.destinationEnergy);
  }
  assert.equal(destinationTotal.toString(), ledger.totals.destinationEnergy);
});

test("Energy migration binary and replay-protected batches match the frozen rows", () => {
  const migrated = ledger.rows.filter((row) => BigInt(row.destinationEnergy) > 0n);
  const expected = Buffer.concat(migrated.flatMap((row) => [
    Buffer.from(getBytes(getAddress(row.wallet))),
    Buffer.from(getBytes(zeroPadValue(toBeHex(BigInt(row.destinationEnergy)), 32))),
  ]));
  assert.deepEqual(binary, expected);
  assert.equal(binary.length, migrated.length * 52);
  assert.equal(keccak256(binary), ledger.binary.keccak256);
  assert.equal(
    crypto.createHash("sha256").update(binary).digest("hex"),
    ledger.binary.sha256,
  );

  let cursor = 0;
  let total = 0n;
  const campaignIds = new Set();
  for (const batch of ledger.batches) {
    assert.equal(batch.start, cursor);
    assert.equal(batch.end, cursor + batch.count - 1);
    const rows = migrated.slice(batch.start, batch.end + 1);
    const batchTotal = rows.reduce(
      (sum, row) => sum + BigInt(row.destinationEnergy),
      0n,
    );
    assert.equal(batchTotal.toString(), batch.totalEnergy);
    assert.match(batch.campaignId, /^0x[0-9a-f]{64}$/i);
    assert.ok(!campaignIds.has(batch.campaignId));
    campaignIds.add(batch.campaignId);
    total += batchTotal;
    cursor += batch.count;
  }
  assert.equal(cursor, migrated.length);
  assert.equal(total.toString(), ledger.totals.destinationEnergy);
});
