import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const freezeScript = "scripts/preflight-droid-os-release-freeze.js";

function manifest(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

test("dual-chain manifests remain at the non-broadcast deployment hold", () => {
  const monad = manifest("deployments/monad/release-candidate-143.json");
  const robinhood = manifest("deployments/robinhood/pre-mint-release-plan.json");
  for (const release of [monad, robinhood]) {
    assert.equal(release.deploymentAuthorized, false);
    assert.equal(release.broadcastCapability, false);
    assert.equal(release.broadcastAttempted, false);
    assert.equal(release.privateKeyRead, false);
    assert.ok(Object.values(release.featureFlagsAtFreeze).every((value) => value === false));
  }
  assert.equal(monad.chain.chainId, 143);
  assert.equal(robinhood.chain.chainId, 4663);
  assert.equal(robinhood.collection.lifecycle, "deployed-pre-mint");
  assert.equal(robinhood.collection.totalSupplyAtFreeze, 0);
  assert.deepEqual(robinhood.governanceConfiguration.approvedAssets, []);
  assert.deepEqual(robinhood.governanceConfiguration.approvedRevenueSources, []);
});

test("superseded offline freeze verifier fails closed after artifact-container drift", () => {
  const source = fs.readFileSync(freezeScript, "utf8");
  assert.doesNotMatch(source, /JsonRpcProvider|ContractFactory|new Wallet|sendTransaction|broadcastTransaction/);

  const result = spawnSync(process.execPath, [freezeScript], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /artifact SHA-256 changed/);

  const authorization = manifest("deployments/authorization/dual-chain-release.json");
  assert.equal(authorization.packageStatus, "BLOCKED");
  assert.equal(authorization.releaseGate, "ARTIFACT_FREEZE_BROKEN");
  assert.equal(authorization.broadcastCapability, false);
});

test("offline freeze verifier rejects an execution switch", () => {
  const result = spawnSync(process.execPath, [freezeScript], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, EXECUTE_DROID_OS_RELEASE_FREEZE: "1" },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /forbidden in read-only freeze mode/);
});
