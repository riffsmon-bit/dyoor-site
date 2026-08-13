import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256 } from "ethers";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const FILES = {
  release: "deployments/authorization/dual-chain-release.json",
  source: "deployments/authorization/release-source-snapshot.json",
  monad: "deployments/authorization/monad-transactions.json",
  robinhood: "deployments/authorization/robinhood-transactions.json",
};

const REQUIRED_DOCS = [
  "docs/deployment-authorization-master.md",
  "docs/owner-release-checklist.md",
  "docs/treasury-policy.md",
  "docs/emergency-runbook.md",
  "docs/monad-canary-runbook.md",
  "docs/robinhood-economic-activation-plan.md",
  "docs/release-source-snapshot.md",
];

const FORBIDDEN_SWITCHES = [
  "EXECUTE_MONAD_DROID_DEPLOYMENT",
  "ALLOW_MONAD_DROID_MAINNET",
  "EXECUTE_HOODYOOR_ECONOMIC_DEPLOYMENT",
  "EXECUTE_HOODYOOR_DROID_DEPLOYMENT",
  "EXECUTE_HOODYOOR_MAINNET_DEPLOYMENT",
  "EXECUTE_HOODYOOR_SEADROP_V2_DEPLOYMENT",
  "BROADCAST",
];

function truthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function fail(message) {
  throw new Error(`Authorization package verification failed: ${message}`);
}

function bytes(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolutePath)) fail(`missing ${relativePath}`);
  return fs.readFileSync(absolutePath);
}

function json(relativePath) {
  try {
    return JSON.parse(bytes(relativePath).toString("utf8"));
  } catch (error) {
    fail(`${relativePath} is not valid JSON (${error.message})`);
  }
}

function sha256(value) {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}

function assertFalseApprovals(value, trail = []) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const nextTrail = [...trail, key];
    if (
      typeof child === "boolean"
      && /(approved|authorized)$/i.test(key)
      && child !== false
    ) {
      fail(`${nextTrail.join(".")} must remain false`);
    }
    assertFalseApprovals(child, nextTrail);
  }
}

function assertArtifact(record) {
  const artifactBytes = bytes(record.artifact);
  const artifact = JSON.parse(artifactBytes.toString("utf8"));
  const creation = String(artifact?.bytecode?.object || "");
  const runtime = String(artifact?.deployedBytecode?.object || "");
  if (!/^0x[0-9a-f]+$/i.test(creation) || !/^0x[0-9a-f]+$/i.test(runtime)) {
    fail(`${record.contract} has invalid bytecode`);
  }
  const actualArtifact = sha256(artifactBytes).toLowerCase();
  if (actualArtifact !== String(record.rebuiltArtifactSha256).toLowerCase()) {
    fail(`${record.contract} rebuilt artifact SHA changed again`);
  }
  if (keccak256(creation).toLowerCase() !== String(record.creationCodeHash).toLowerCase()) {
    fail(`${record.contract} creation bytecode changed`);
  }
  if (keccak256(runtime).toLowerCase() !== String(record.runtimeTemplateHash).toLowerCase()) {
    fail(`${record.contract} runtime template changed`);
  }
  const artifactMatched = String(record.frozenArtifactSha256).toLowerCase() === actualArtifact;
  if (artifactMatched !== record.artifactFreezeMatched) {
    fail(`${record.contract} artifactFreezeMatched is inaccurate`);
  }
  if (record.ownerApproved !== false || record.maxAuthorizedGas !== null) {
    fail(`${record.contract} contains transaction authorization`);
  }
  return artifactMatched;
}

function parseEnvironmentExample() {
  const result = new Map();
  for (const rawLine of bytes(".env.example").toString("utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 0) continue;
    result.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return result;
}

function main() {
  for (const variable of FORBIDDEN_SWITCHES) {
    if (truthy(process.env[variable])) fail(`${variable} cannot be enabled in package mode`);
  }

  const release = json(FILES.release);
  const source = json(FILES.source);
  const monad = json(FILES.monad);
  const robinhood = json(FILES.robinhood);

  for (const document of REQUIRED_DOCS) bytes(document);

  if (release.packageStatus !== "BLOCKED" || release.releaseGate !== "ARTIFACT_FREEZE_BROKEN") {
    fail("release must remain blocked on the broken artifact freeze");
  }
  if (source.cleanSourceSnapshot !== false || source.productionAuthorizationEligible !== false) {
    fail("dirty source snapshot was incorrectly approved");
  }
  if (source.privateKeyRead !== true || !source.privateKeyReadIncident) {
    fail("the legacy preflight key-read incident is not recorded");
  }
  if (release.broadcastCapability !== false || release.broadcastAttempted !== false) {
    fail("release package exposes or records broadcast capability");
  }
  if (release.fundsMoved !== false) fail("release package records moved funds");
  if (monad.chain?.chainId !== 143 || robinhood.chain?.chainId !== 4663) {
    fail("chain ID changed");
  }
  if (
    monad.chain?.collection?.toLowerCase()
      !== "0x349d8eb480c92cf75371fba5c6344a4d11b9103a"
    || robinhood.chain?.collection?.toLowerCase()
      !== "0x8277f8126722b11d7b44c5c453bcf62a78aafa25"
  ) {
    fail("collection address changed");
  }
  if (monad.safeCommands?.productionDeploymentCommand !== null) {
    fail("Monad production deployment command must be withheld");
  }
  if (robinhood.safeCommands?.productionDeploymentCommand !== null) {
    fail("Robinhood production deployment command must be withheld");
  }

  assertFalseApprovals(release);
  assertFalseApprovals(monad);
  assertFalseApprovals(robinhood);

  const artifactMatches = [];
  for (const record of monad.proposedTransactions.filter((entry) => entry.artifact)) {
    artifactMatches.push([record.contract, assertArtifact(record)]);
  }
  for (const record of robinhood.proposedTransactions) {
    artifactMatches.push([record.contract, assertArtifact(record)]);
  }
  const mismatchCount = artifactMatches.filter(([, matched]) => !matched).length;
  if (mismatchCount !== 6 || source.artifactDrift?.length !== 6) {
    fail(`expected six recorded artifact-file mismatches, found ${mismatchCount}`);
  }

  const environment = parseEnvironmentExample();
  for (const flag of Object.keys(release.codeFeatureFlagsRequiredFalse)) {
    if (environment.get(flag) !== "false") fail(`${flag} must be false in .env.example`);
  }
  for (const [name, address] of Object.entries(release.governance?.safeAddresses || {})) {
    if (address !== null) fail(`${name} must remain UNSET`);
  }
  if (release.treasuryPolicy?.launchRecommendation?.totalBps !== 10_000) {
    fail("launch treasury proposal does not total 10,000 bps");
  }
  if (
    release.treasuryPolicy.launchRecommendation.projectTreasuryBps
      + release.treasuryPolicy.launchRecommendation.droidRewardsBps
      + release.treasuryPolicy.launchRecommendation.otherApprovedBps
      !== 10_000
  ) {
    fail("launch treasury components do not total 10,000 bps");
  }
  if ((release.approvedRevenueSources || []).length !== 0) {
    fail("revenue sources must remain empty");
  }
  if ((release.strategyCandidates || []).some((strategy) => strategy.active)) {
    fail("a strategy is active");
  }
  if ((release.assetCandidates?.monad || []).some((asset) => asset.approved)) {
    fail("a Monad asset is approved");
  }
  if ((release.assetCandidates?.robinhood || []).some((asset) => asset.approved)) {
    fail("a Robinhood asset is approved");
  }

  const keylessRobinhoodPreflight = bytes("scripts/preflight-hoodyoor-economic-droids.js")
    .toString("utf8");
  const keylessSeaDropPreflight = bytes("scripts/preflight-robinhood-seadrop-v2.js")
    .toString("utf8");
  for (const forbidden of [
    "HOODYOOR_DEPLOYER_PRIVATE_KEY",
    "DEPLOYER_PRIVATE_KEY",
    "loadHoodyoorLocalEnvironment",
    "new Wallet",
  ]) {
    if (keylessRobinhoodPreflight.includes(forbidden)) {
      fail(`keyless Robinhood preflight contains ${forbidden}`);
    }
    if (keylessSeaDropPreflight.includes(forbidden)) {
      fail(`keyless SeaDrop preflight contains ${forbidden}`);
    }
  }
  if (keylessSeaDropPreflight.includes("verifyRevealSecretBackup")) {
    fail("keyless SeaDrop preflight reads the private reveal backup");
  }

  const result = {
    mode: "offline-blocked-authorization-package",
    packageStatus: release.packageStatus,
    releaseGate: release.releaseGate,
    cleanSourceSnapshot: source.cleanSourceSnapshot,
    independentAudit: release.independentAudit.overallStatus,
    artifactsChecked: artifactMatches.map(([contract, matched]) => ({
      contract,
      wholeArtifactFreezeMatched: matched,
    })),
    artifactFileMismatches: mismatchCount,
    deploymentAuthorized: false,
    broadcastCapability: false,
    privateKeyIncidentRecorded: true,
    result: "PASS_BLOCKED",
    nextAction: release.exactNextAction,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error?.message || error}\n`);
  process.exitCode = 1;
}
