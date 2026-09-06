import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createEnergyRpcProvider } from "../lib/energy-rpc.ts";

test("harvest settlement does not inherit exhausted general/browser RPC subscriptions", () => {
  const provider = createEnergyRpcProvider({ MONAD_RPC_URL: "https://broken.invalid", NEXT_PUBLIC_MONAD_RPC_URL: "https://quota.alchemy.invalid" });
  assert.equal(provider._getConnection().url, "https://rpc.monad.xyz");
  provider.destroy();
});

test("an explicit HTTPS Energy provider is configurable without disabling chain detection", () => {
  const provider = createEnergyRpcProvider({ ENERGY_RPC_URL: " https://rpc1.monad.xyz " });
  assert.equal(provider._getConnection().url, "https://rpc1.monad.xyz");
  provider.destroy();
  assert.throws(() => createEnergyRpcProvider({ ENERGY_RPC_URL: "http://rpc.monad.xyz" }), /HTTPS/);
});

test("receipt and bank credit share the repaired provider and retain exact event/dedupe safeguards", () => {
  const chain = fs.readFileSync("src/lib/energy/chain.ts", "utf8");
  const sync = fs.readFileSync("app/api/energy/sync-wallet/route.ts", "utf8");
  const legacy = fs.readFileSync("app/api/energy-harvest-credit/route.ts", "utf8");
  assert.match(chain, /return createEnergyRpcProvider\(\)/);
  assert.match(chain, /await assertMonadMainnet\(provider\);\s*let receipt/);
  assert.match(chain, /receipt.status !== 1/);
  assert.match(chain, /log.address.toLowerCase\(\) === stakingAddress/);
  assert.match(chain, /event.wallet === normalizedWallet/);
  assert.match(sync, /events = await harvestEventsFromReceipt\(txHash, wallet\)/);
  assert.match(sync, /const provider = energyRpcProvider\(\);\s*await assertMonadMainnet/);
  assert.match(sync, /bank.usedClaimTxHash\(claimKey\)/);
  assert.match(sync, /bank.creditEnergy.staticCall\(event.wallet, amount, claimKey\)/);
  assert.match(legacy, /const provider = createEnergyRpcProvider\(\)/);
  assert.match(legacy, /bank.usedClaimTxHash\(txHash\)/);
});

test("post-harvest balance refresh does not run the historical settlement scanner", () => {
  const page = fs.readFileSync("app/ascension/page.tsx", "utf8");
  const harvest = page.split("async function harvestEnergy()")[1].split("async function recoverTokenIds")[0];
  assert.match(harvest, /txHash: tx.hash/);
  assert.match(harvest, /await ascension.refresh\(\)/);
  assert.doesNotMatch(harvest, /scanLogs: true/);
});
