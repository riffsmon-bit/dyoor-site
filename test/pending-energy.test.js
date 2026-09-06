import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { readPendingEnergySnapshot, resolvePendingEnergy, hasPendingEnergy } from "../lib/pending-energy.ts";

test("pending snapshots distinguish positive, zero and unknown reads", async () => {
  assert.deepEqual(await readPendingEnergySnapshot(async () => 24n * 10n ** 18n), {
    pendingReadStatus: "ok", pendingRaw: "24000000000000000000", pendingEnergy: "24.0",
  });
  assert.deepEqual(await readPendingEnergySnapshot(async () => 0n), {
    pendingReadStatus: "ok", pendingRaw: "0", pendingEnergy: "0.0",
  });
  for (const read of [() => Promise.reject(Error("RPC down")), () => { throw Error("RPC failed"); }, () => new Promise(() => {}), async () => -1n, async () => "0"]) {
    assert.deepEqual(await readPendingEnergySnapshot(read, 5), {
      pendingReadStatus: "unavailable", pendingRaw: null, pendingEnergy: null,
    });
  }
});

test("API failure or legacy false zero cannot overwrite a successful direct read", () => {
  for (const api of [undefined, { pendingEnergy: "0" }, { pendingReadStatus: "unavailable", pendingEnergy: null }, { pendingReadStatus: "ok", pendingEnergy: "0" }]) {
    assert.equal(resolvePendingEnergy("24.123", api), "24.123");
  }
  assert.equal(resolvePendingEnergy("0", { pendingReadStatus: "ok", pendingEnergy: "24" }), "0");
});

test("API fallback requires explicit successful read evidence and valid amount", () => {
  assert.equal(resolvePendingEnergy(undefined, { pendingReadStatus: "ok", pendingEnergy: "24.5" }), "24.5");
  assert.equal(resolvePendingEnergy(undefined, { pendingReadStatus: "ok", pendingEnergy: "0" }), "0");
  for (const value of [null, undefined, "", "NaN", "Infinity", "-1", "1e5", "0.0000000000000000001", 24]) {
    assert.equal(resolvePendingEnergy(value, { pendingReadStatus: "ok", pendingEnergy: value }), "Unavailable");
    assert.equal(hasPendingEnergy(value), false);
  }
  assert.equal(resolvePendingEnergy(undefined, { pendingEnergy: "0" }), "Unavailable");
  assert.equal(resolvePendingEnergy(undefined, { pendingReadStatus: "unavailable", pendingEnergy: "24" }), "Unavailable");
});

test("harvest eligibility is exact, including fractional Energy, and denies unknown", () => {
  for (const value of ["0", "00.000", "Unavailable", ""]) assert.equal(hasPendingEnergy(value), false);
  for (const value of ["24", "0.000000000000000001", "999999999999999999999999.5"]) assert.equal(hasPendingEnergy(value), true);
});

test("failure followed by a fresh read recovers without retaining an old wallet balance", async () => {
  const failure = await readPendingEnergySnapshot(async () => { throw Error("timeout"); });
  assert.equal(resolvePendingEnergy(undefined, failure), "Unavailable");
  const success = await readPendingEnergySnapshot(async () => 10n ** 18n);
  assert.equal(resolvePendingEnergy(undefined, success), "1.0");
  // Resolver has no memory: a different wallet's unknown read must remain unknown.
  assert.equal(resolvePendingEnergy(undefined, failure), "Unavailable");
});

test("display wiring preserves legacy settlement and protects the harvest control", () => {
  const route = fs.readFileSync("app/api/energy/[wallet]/route.ts", "utf8");
  const chain = fs.readFileSync("src/lib/energy/chain.ts", "utf8");
  const hook = fs.readFileSync("hooks/useAscension.ts", "utf8");
  const page = fs.readFileSync("app/ascension/page.tsx", "utf8");
  assert.match(route, /readPendingEnergySnapshot\(\(\) => readPendingEnergyRawStrict/);
  assert.equal((route.match(/\.\.\.pending,/g) || []).length, 2);
  assert.match(chain, /contract.pendingPoints\(normalized\).catch\(\(\) => 0n\)/);
  assert.doesNotMatch(chain.split("export async function readPendingEnergyRawStrict")[1].split("function eventFromLog")[0], /catch/);
  assert.match(hook, /resolvePendingEnergy\(directPending, json\)/);
  assert.match(hook, /formatUnits\(pendingResult.value as bigint, 18\)/);
  assert.match(hook, /energyQuery.data.walletAddress, address/);
  assert.match(page, /disabled=\{working \|\| ascension.energyLoading \|\| !hasPendingEnergy\(ascension.pendingEnergy\)\}/);
  assert.match(page, /Pending Energy is temporarily unavailable/);
});
