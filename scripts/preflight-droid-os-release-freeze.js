import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashJson, sha256 } from "./lib/release-artifacts.js";
import { assertReadOnlyReleaseEnvironment } from "./lib/release-safety.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACTS = "deployments/release-freeze/contract-artifacts.json";
const REPRODUCIBILITY = "deployments/release-freeze/reproducibility.json";
const CLEAN_ROOM = "deployments/release-freeze/clean-room-check.json";
const MONAD = "deployments/monad/release-candidate-143.json";
const ROBINHOOD = "deployments/robinhood/pre-mint-release-plan.json";
const FORBIDDEN_SWITCHES = [
  "EXECUTE_DROID_OS_RELEASE_FREEZE",
  "EXECUTE_MONAD_DROID_DEPLOYMENT",
  "ALLOW_MONAD_DROID_MAINNET",
  "EXECUTE_HOODYOOR_ECONOMIC_DEPLOYMENT",
  "BROADCAST",
];

function truthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function fail(message) {
  throw new Error(`Release freeze failed: ${message}`);
}

function read(relativePath) {
  const target = path.join(ROOT, relativePath);
  if (!fs.existsSync(target)) fail(`missing ${relativePath}`);
  return fs.readFileSync(target);
}

function json(relativePath) {
  try {
    return JSON.parse(read(relativePath).toString("utf8"));
  } catch (error) {
    fail(`${relativePath} is invalid JSON (${error.message})`);
  }
}

function same(left, right) {
  return String(left || "").toLowerCase() === String(right || "").toLowerCase();
}

function assertRecord(frozen, evidence, label) {
  for (const field of [
    "sourceSha256",
    "wholeArtifactSha256",
    "canonicalArtifactSha256",
    "abiSha256",
    "constructorSchemaSha256",
    "creationBytecodeHash",
    "runtimeBytecodeHash",
    "storageLayoutSha256",
    "linkReferencesSha256",
    "immutableReferencesSha256",
  ]) {
    if (!same(frozen[field], evidence[field])) fail(`${label} ${field} changed`);
  }
  if (!same(hashJson(frozen.constructorSchema), frozen.constructorSchemaSha256)) {
    fail(`${label} constructor schema hash is inconsistent`);
  }
}

function main() {
  assertReadOnlyReleaseEnvironment();
  for (const name of FORBIDDEN_SWITCHES) {
    if (truthy(process.env[name])) fail(`${name} is forbidden in read-only freeze mode`);
  }

  const artifactFreeze = json(ARTIFACTS);
  const reproducibility = json(REPRODUCIBILITY);
  const cleanRoom = json(CLEAN_ROOM);
  const monad = json(MONAD);
  const robinhood = json(ROBINHOOD);
  if (artifactFreeze.schema !== "hoodyoor-contract-artifact-freeze-v2") {
    fail("new artifact freeze is not installed");
  }
  if (
    artifactFreeze.previousFreeze?.status !== "INVALIDATED"
    || !artifactFreeze.reproducibility?.fullArtifactJsonReproducibleUnderReleaseScope
  ) {
    fail("old approvals were not invalidated or reproducibility is not proven");
  }
  if (
    reproducibility.result !== "PASS"
    || !reproducibility.canonicalOutputsIdentical
    || !reproducibility.wholeArtifactJsonIdentical
    || cleanRoom.result !== "PASS"
    || !cleanRoom.cleanRoomThirdMatches
  ) {
    fail("three-build reproducibility evidence is incomplete");
  }
  if (
    artifactFreeze.sourceCommit !== reproducibility.sourceCommit
    || artifactFreeze.sourceCommit !== cleanRoom.sourceCommit
  ) {
    fail("freeze evidence does not bind one source commit");
  }

  const checked = [];
  for (const record of artifactFreeze.candidates || []) {
    if (!same(sha256(read(record.source)), record.sourceSha256)) {
      fail(`${record.contract} source hash changed`);
    }
    const runA = reproducibility.runA.records.find((candidate) => candidate.contract === record.contract);
    const runB = reproducibility.runB.records.find((candidate) => candidate.contract === record.contract);
    const third = cleanRoom.records.find((candidate) => candidate.contract === record.contract);
    if (!runA || !runB || !third) fail(`${record.contract} lacks three-build evidence`);
    assertRecord(record, runA, record.contract);
    assertRecord(record, runB, record.contract);
    assertRecord(record, third, record.contract);
    checked.push(record.contract);
  }
  if (checked.length !== 8) fail(`expected eight compiled candidates, checked ${checked.length}`);

  for (const release of [monad, robinhood]) {
    if (
      release.deploymentAuthorized !== false
      || release.broadcastCapability !== false
      || release.broadcastAttempted !== false
      || release.privateKeyRead !== false
      || release.independentAuditStatus !== "NOT_STARTED"
    ) {
      fail("a chain manifest is not audit-gated and non-broadcast");
    }
    if (Object.values(release.featureFlagsAtFreeze || {}).some((enabled) => enabled !== false)) {
      fail("a release feature flag is not frozen false");
    }
  }
  if (monad.chain.chainId !== 143 || robinhood.chain.chainId !== 4663) fail("chain ID changed");
  if (
    robinhood.collection.lifecycle !== "deployed-pre-mint"
    || robinhood.collection.totalSupplyAtFreeze !== 0
    || !robinhood.governanceConfiguration.failClosed
  ) {
    fail("Robinhood pre-mint/configuration hold changed");
  }

  process.stdout.write(`${JSON.stringify({
    mode: "offline-reproducible-release-freeze",
    sourceCommit: artifactFreeze.sourceCommit,
    artifactsChecked: checked,
    buildsMatched: 3,
    deploymentAuthorized: false,
    broadcastCapability: false,
    privateKeyRead: false,
    independentAudit: "NOT_STARTED",
    result: "PASS_AUDIT_REQUIRED",
    nextAction: "Independent smart-contract audit; this command cannot deploy.",
  }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error?.message || error}\n`);
  process.exitCode = 1;
}
