import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  admittedServerEnergyDebitIds,
  effectiveEnergyBalance,
} from "../lib/trait-lab-energy-accounting.ts";

test("server-settled Trait Lab debits reduce spendable Energy without an on-chain write", () => {
  assert.deepEqual(effectiveEnergyBalance({
    energyBankSpendableRaw: "2900",
    energyBankSpentRaw: "7100",
    serverSettledDebitRaw: "600",
  }), {
    spendableRaw: "2300",
    spentRaw: "7700",
    serverSettledDebitRaw: "600",
  });
  assert.equal(effectiveEnergyBalance({
    energyBankSpendableRaw: "100",
    energyBankSpentRaw: "900",
    serverSettledDebitRaw: "250",
  }).spendableRaw, "0");
});

test("concurrent server debits have deterministic admission and cannot exceed the balance", () => {
  const result = admittedServerEnergyDebitIds([
    { id: "roll-b", amountRaw: "700", createdAt: "2026-07-24T12:00:00.001Z", status: "pending" },
    { id: "roll-a", amountRaw: "400", createdAt: "2026-07-24T12:00:00.000Z", status: "pending" },
    { id: "roll-c", amountRaw: "100", createdAt: "2026-07-24T12:00:00.002Z", status: "pending" },
    { id: "voided", amountRaw: "900", createdAt: "2026-07-24T11:00:00.000Z", status: "voided" },
  ], "1000");

  assert.deepEqual([...result.admitted], ["roll-a", "roll-c"]);
  assert.equal(result.committedRaw, "500");
});

test("a later pending debit can never displace a charge that already returned", () => {
  const result = admittedServerEnergyDebitIds([
    { id: "later-but-sorts-first", amountRaw: "700", createdAt: "2026-07-24T12:00:00.000Z", status: "pending" },
    { id: "already-returned", amountRaw: "400", createdAt: "2026-07-24T12:00:00.000Z", status: "charged" },
  ], "1000");

  assert.deepEqual([...result.admitted], ["already-returned"]);
  assert.equal(result.committedRaw, "400");
});

test("new rerolls use the server ledger while legacy transaction receipt recovery remains supported", () => {
  const source = fs.readFileSync("lib/s2-trait-lab.ts", "utf8");
  const publicSource = fs.readFileSync("lib/s2-trait-lab-public.ts", "utf8");
  const debitStart = source.indexOf("async function debitTraitLabEnergy");
  const debitEnd = source.indexOf("async function creditTraitLabRecycleEnergy", debitStart);
  const debitSource = source.slice(debitStart, debitEnd);

  assert.ok(debitStart >= 0 && debitEnd > debitStart);
  assert.match(debitSource, /claimTraitLabEnergyDebit/);
  assert.doesNotMatch(debitSource, /spendEnergy|sendTransaction|getTransactionCount|\.wait\(/);
  assert.match(source, /energySettlementMode === "server-ledger"/);
  assert.match(source, /receiptContainsTraitLabEnergySpend/);
  assert.match(publicSource, /rerollSettlementMode:\s*"server-ledger"/);
  assert.match(publicSource, /rerollRequiresTransaction:\s*false/);
});

test("restore-required preview errors preserve and rediscover the actual active operation", () => {
  const traitLabSource = fs.readFileSync("lib/s2-trait-lab.ts", "utf8");
  const previewRoute = fs.readFileSync("app/api/s2/trait-lab/preview/route.ts", "utf8");
  const clientSource = fs.readFileSync("components/s2/TraitLabClient.tsx", "utf8");

  assert.match(traitLabSource, /upstreamRecovery \? upstream\.operationId : rollId/);
  assert.match(traitLabSource, /recoveryPreview: recoveryPreviewFromRoll\(currentRoll\)/);
  assert.match(previewRoute, /getTraitLabOperationStatus/);
  assert.match(previewRoute, /status\?\.retryPreview/);
  assert.match(clientSource, /\/api\/s2\/trait-lab\/active/);
  assert.match(clientSource, /setPreview\(data\.recoveryPreview\)/);
});
