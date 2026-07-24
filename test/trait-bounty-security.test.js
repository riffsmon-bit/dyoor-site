import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  traitBountyActions,
  traitBountyRevealsFromCompletion,
} from "../lib/s2-trait-bounty-rules.ts";

function completion(overrides = {}) {
  return {
    version: 1,
    rollId: `0x${"1".repeat(64)}`,
    wallet: `0x${"2".repeat(40)}`,
    tokenId: "42",
    traitType: "Eyes",
    action: "reroll",
    paymentMode: "energy",
    costRaw: "100000000000000000000",
    completedAt: "2026-07-24T12:00:00.000Z",
    result: {
      supplyDeltas: [
        { traitType: "Eyes", value: "Old Eyes", delta: -1, reason: "equip" },
        { traitType: "Eyes", value: "Abyss Laser", delta: 1, reason: "equip" },
      ],
    },
    ...overrides,
  };
}

test("bounty matching considers only newly equipped positive supply deltas", () => {
  const reveals = traitBountyRevealsFromCompletion(completion({
    result: {
      supplyDeltas: [
        { traitType: "Eyes", value: "Old Eyes", delta: -1, reason: "equip" },
        { traitType: "Eyes", value: "Abyss Laser", delta: 1, reason: "equip" },
        { traitType: "Hat", value: "Rare Hat", delta: -1, reason: "burn" },
        { traitType: "Eyes", value: "Abyss Laser", delta: 1, reason: "equip" },
      ],
      override: {
        attributes: {
          Eyes: "Abyss Laser",
          Hat: "Unchanged Hat",
        },
      },
    },
  }));

  assert.deepEqual(reveals, [{ traitType: "Eyes", traitValue: "Abyss Laser" }]);
});

test("action masks expose only supported reveal operations", () => {
  assert.deepEqual(traitBountyActions(1 | 4), ["Reroll", "Reroll All"]);
  assert.deepEqual(traitBountyActions(2), ["Unlock"]);
  assert.deepEqual(traitBountyActions(0), []);
});

test("bounty mutation is processor-secret protected and completion payout is best effort", () => {
  const processRoute = fs.readFileSync(
    "app/api/s2/trait-lab/bounties/process/route.ts",
    "utf8",
  );
  assert.match(processRoute, /verifyTraitBountyProcessorSecret/);
  assert.match(processRoute, /x-dyoor-bounty-secret/);

  const traitLabSource = fs.readFileSync("lib/s2-trait-lab.ts", "utf8");
  assert.match(traitLabSource, /settleTraitLabBountiesForCompletion/);
  assert.match(traitLabSource, /\.catch\(\(error\) => \[\{/);

  const contractSource = fs.readFileSync(
    "contracts/DYOORTraitBounties.sol",
    "utf8",
  );
  assert.match(contractSource, /walletClaimCount/);
  assert.match(contractSource, /tokenClaimCount/);
  assert.match(contractSource, /GlobalClaimLimitReached/);
  assert.match(contractSource, /ENERGY_BANK\.creditEnergy/);

  const engineSource = fs.readFileSync("lib/s2-trait-bounties.ts", "utf8");
  assert.match(engineSource, /isPermanentBountyRejection/);
  assert.match(engineSource, /GlobalClaimLimitReached/);
  assert.match(engineSource, /status: isPermanentBountyRejection\(message\) \? "ineligible" : "pending"/);
  assert.match(engineSource, /await readContract\.settled\(settlementKey\)/);
});
