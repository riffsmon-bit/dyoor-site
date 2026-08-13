import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

test("deployment authorization package is fail-closed", () => {
  const release = readJson("deployments/authorization/dual-chain-release.json");
  const source = readJson("deployments/authorization/release-source-snapshot.json");
  const monad = readJson("deployments/authorization/monad-transactions.json");
  const robinhood = readJson("deployments/authorization/robinhood-transactions.json");

  assert.equal(release.packageStatus, "BLOCKED");
  assert.equal(release.releaseGate, "ARTIFACT_FREEZE_BROKEN");
  assert.equal(source.cleanSourceSnapshot, false);
  assert.equal(source.privateKeyRead, true);
  assert.equal(release.deploymentAuthorized, false);
  assert.equal(release.broadcastCapability, false);
  assert.equal(monad.transactionAuthorizationPrepared, false);
  assert.equal(robinhood.transactionAuthorizationPrepared, false);
  assert.equal(monad.safeCommands.productionDeploymentCommand, null);
  assert.equal(robinhood.safeCommands.productionDeploymentCommand, null);
  assert.ok(Object.values(release.featureActivationAuthorizations).every((value) => value === false));
});

test("treasury, asset, source, strategy, agent, and bridge defaults remain inactive", () => {
  const release = readJson("deployments/authorization/dual-chain-release.json");
  const split = release.treasuryPolicy.launchRecommendation;
  assert.equal(split.projectTreasuryBps + split.droidRewardsBps + split.otherApprovedBps, 10_000);
  assert.equal(split.ownerApproved, false);
  assert.deepEqual(release.approvedRevenueSources, []);
  assert.ok(release.assetCandidates.monad.every((asset) => asset.approved === false));
  assert.ok(release.assetCandidates.robinhood.every((asset) => asset.approved === false));
  assert.ok(release.strategyCandidates.every((strategy) => strategy.active === false));
  assert.equal(release.featureActivationAuthorizations.AGENT_APPROVED, false);
  assert.equal(release.featureActivationAuthorizations.BRIDGE_APPROVED, false);
});

test("offline package verifier accepts only the intentionally blocked state", () => {
  const output = execFileSync(
    process.execPath,
    [path.join(ROOT, "scripts", "verify-deployment-authorization-package.js")],
    { cwd: ROOT, encoding: "utf8" },
  );
  const result = JSON.parse(output);
  assert.equal(result.result, "PASS_BLOCKED");
  assert.equal(result.artifactFileMismatches, 6);
  assert.equal(result.deploymentAuthorized, false);
  assert.equal(result.broadcastCapability, false);
});
