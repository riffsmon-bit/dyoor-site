import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashJson, sha256 } from "./lib/release-artifacts.js";
import { assertReadOnlyReleaseEnvironment } from "./lib/release-safety.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILES = Object.freeze({
  release: "deployments/authorization/dual-chain-release.json",
  source: "deployments/authorization/release-source-snapshot.json",
  monadTransactions: "deployments/authorization/monad-transactions.json",
  robinhoodTransactions: "deployments/authorization/robinhood-transactions.json",
  monadRelease: "deployments/monad/release-candidate-143.json",
  robinhoodRelease: "deployments/robinhood/pre-mint-release-plan.json",
  artifacts: "deployments/release-freeze/contract-artifacts.json",
  reproducibility: "deployments/release-freeze/reproducibility.json",
  cleanRoom: "deployments/release-freeze/clean-room-check.json",
});
const REQUIRED_DOCS = Object.freeze([
  "docs/deployment-authorization-master.md",
  "docs/owner-release-checklist.md",
  "docs/treasury-policy.md",
  "docs/emergency-runbook.md",
  "docs/monad-canary-runbook.md",
  "docs/robinhood-economic-activation-plan.md",
  "docs/release-source-snapshot.md",
  "docs/release-change-classification.md",
  "docs/artifact-drift-analysis.md",
  "docs/release-environment-separation.md",
  "docs/robinhood-eoa-safe-migration.md",
  "docs/independent-audit-package.md",
  "docs/release-validation-report.md",
]);
const FORBIDDEN_EXECUTION_SWITCHES = Object.freeze([
  "EXECUTE_MONAD_DROID_DEPLOYMENT",
  "ALLOW_MONAD_DROID_MAINNET",
  "EXECUTE_HOODYOOR_ECONOMIC_DEPLOYMENT",
  "EXECUTE_HOODYOOR_DROID_DEPLOYMENT",
  "EXECUTE_HOODYOOR_MAINNET_DEPLOYMENT",
  "EXECUTE_HOODYOOR_SEADROP_V2_DEPLOYMENT",
  "BROADCAST",
]);

function truthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function fail(message) {
  throw new Error(`Authorization package verification failed: ${message}`);
}

function bytes(relativePath) {
  const target = path.join(ROOT, relativePath);
  if (!fs.existsSync(target)) fail(`missing ${relativePath}`);
  return fs.readFileSync(target);
}

function json(relativePath) {
  try {
    return JSON.parse(bytes(relativePath).toString("utf8"));
  } catch (error) {
    fail(`${relativePath} is not valid JSON (${error.message})`);
  }
}

function assertFalseApprovals(value, trail = []) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const next = [...trail, key];
    if (typeof child === "boolean" && /(approved|authorized)$/i.test(key) && child !== false) {
      fail(`${next.join(".")} must remain false`);
    }
    assertFalseApprovals(child, next);
  }
}

function compareRecords(expected, actual, label) {
  const fields = [
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
  ];
  for (const field of fields) {
    if (String(expected[field]).toLowerCase() !== String(actual[field]).toLowerCase()) {
      fail(`${label} ${field} differs from the reproducible freeze`);
    }
  }
  if (hashJson(expected.constructorSchema) !== expected.constructorSchemaSha256) {
    fail(`${label} constructor schema hash is internally inconsistent`);
  }
}

function parseEnvironmentExample() {
  const values = new Map();
  for (const raw of bytes(".env.example").toString("utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index >= 0) values.set(line.slice(0, index), line.slice(index + 1));
  }
  return values;
}

function main() {
  assertReadOnlyReleaseEnvironment();
  for (const variable of FORBIDDEN_EXECUTION_SWITCHES) {
    if (truthy(process.env[variable])) fail(`${variable} cannot be enabled in verification mode`);
  }

  const release = json(FILES.release);
  const source = json(FILES.source);
  const monadTransactions = json(FILES.monadTransactions);
  const robinhoodTransactions = json(FILES.robinhoodTransactions);
  const monad = json(FILES.monadRelease);
  const robinhood = json(FILES.robinhoodRelease);
  const artifactFreeze = json(FILES.artifacts);
  const reproducibility = json(FILES.reproducibility);
  const cleanRoom = json(FILES.cleanRoom);
  for (const document of REQUIRED_DOCS) bytes(document);

  if (release.packageStatus !== "AUDIT_REQUIRED") fail("package status is not AUDIT_REQUIRED");
  if (release.releaseGate !== "INDEPENDENT_AUDIT_NOT_STARTED") {
    fail("independent-audit gate is not active");
  }
  if (release.independentAudit?.overallStatus !== "NOT_STARTED") {
    fail("independent audit must remain NOT_STARTED without external evidence");
  }
  if ((release.independentAudit?.contracts || []).some((entry) => entry.status !== "NOT_STARTED")) {
    fail("a contract was incorrectly marked externally audited");
  }
  if (!source.cleanSourceSnapshot || !source.cleanCheckoutVerified) {
    fail("clean source snapshot is not proven");
  }
  if (source.privateKeyRead !== false || source.verificationMode !== "KEYLESS_READ_ONLY") {
    fail("source verification is not keyless");
  }
  if (!source.historicalSecretAccessIncident?.occurredInPriorBlockedPass) {
    fail("historical secret-loading incident is not preserved in the audit record");
  }
  if (source.productionAuthorizationEligible !== false) {
    fail("audit-required snapshot was incorrectly marked production eligible");
  }
  if (
    release.deploymentAuthorized !== false
    || release.economicConfigurationAuthorized !== false
    || release.featureActivationAuthorized !== false
    || release.broadcastCapability !== false
    || release.broadcastAttempted !== false
    || release.fundsMoved !== false
  ) {
    fail("package exposes deployment, activation, broadcast, or fund movement authority");
  }
  assertFalseApprovals(release);
  assertFalseApprovals(monadTransactions);
  assertFalseApprovals(robinhoodTransactions);

  const sourceCommit = artifactFreeze.sourceCommit;
  for (const record of artifactFreeze.candidates || []) {
    if (record.sourceCommit !== sourceCommit) fail(`${record.contract} source commit differs`);
    if (sha256(bytes(record.source)) !== record.sourceSha256) {
      fail(`${record.contract} source hash changed`);
    }
    if (record.auditStatus !== "NOT_STARTED") fail(`${record.contract} audit status changed`);
  }
  if ((artifactFreeze.candidates || []).length !== 8) fail("expected eight compiled candidates");
  if (
    artifactFreeze.previousFreeze?.status !== "INVALIDATED"
    || artifactFreeze.reproducibility?.fullArtifactJsonReproducibleUnderReleaseScope !== true
  ) {
    fail("new reproducible freeze did not explicitly invalidate the old freeze");
  }
  if (
    reproducibility.result !== "PASS"
    || !reproducibility.canonicalOutputsIdentical
    || !reproducibility.wholeArtifactJsonIdentical
    || cleanRoom.result !== "PASS"
    || !cleanRoom.cleanRoomThirdMatches
    || reproducibility.sourceCommit !== sourceCommit
    || cleanRoom.sourceCommit !== sourceCommit
  ) {
    fail("reproducibility evidence is incomplete or does not bind the source commit");
  }
  for (const candidate of artifactFreeze.candidates) {
    const runA = reproducibility.runA.records.find((record) => record.contract === candidate.contract);
    const runB = reproducibility.runB.records.find((record) => record.contract === candidate.contract);
    const third = cleanRoom.records.find((record) => record.contract === candidate.contract);
    if (!runA || !runB || !third) fail(`${candidate.contract} lacks three-build evidence`);
    compareRecords(candidate, runA, candidate.contract);
    compareRecords(candidate, runB, candidate.contract);
    compareRecords(candidate, third, candidate.contract);
  }

  if (monad.chain?.chainId !== 143 || robinhood.chain?.chainId !== 4663) fail("chain changed");
  if (
    monad.collection?.address?.toLowerCase() !== "0x349d8eb480c92cf75371fba5c6344a4d11b9103a"
    || robinhood.collection?.address?.toLowerCase() !== "0x8277f8126722b11d7b44c5c453bcf62a78aafa25"
  ) {
    fail("collection address changed");
  }
  if (robinhood.collection.lifecycle !== "deployed-pre-mint" || robinhood.collection.totalSupplyAtFreeze !== 0) {
    fail("Robinhood collection is not frozen pre-mint at zero supply");
  }
  if (monad.independentAuditStatus !== "NOT_STARTED" || robinhood.independentAuditStatus !== "NOT_STARTED") {
    fail("chain release incorrectly passed independent audit");
  }
  if (
    monadTransactions.safeCommands?.productionDeploymentCommand !== null
    || robinhoodTransactions.safeCommands?.productionDeploymentCommand !== null
  ) {
    fail("production deployment command must remain withheld");
  }
  for (const candidate of [
    ...monad.releaseCandidates.filter((entry) => entry.canonicalArtifactSha256),
    ...robinhood.plannedEconomicDeployments,
  ]) {
    const frozen = artifactFreeze.candidates.find((entry) => entry.contract === candidate.contract);
    if (!frozen) fail(`${candidate.contract} is absent from the artifact freeze`);
    compareRecords(frozen, candidate, candidate.contract);
  }
  if (
    robinhood.revenueVault?.requiredTotalBps !== 10_000
    || robinhood.revenueVault?.allocationBuckets?.join("|")
      !== "PROJECT_TREASURY|DROID_REWARDS|OTHER_APPROVED"
  ) {
    fail("Revenue Vault three-way 10,000-bps invariant is absent");
  }
  if (!robinhood.currentEoaConcentrationRisk?.sameAddressControlsCollectionTreasuryAndRoyalties) {
    fail("Robinhood EOA concentration risk is not recorded");
  }
  if (
    robinhood.governanceConfiguration.mainGovernanceSafe !== null
    || robinhood.governanceConfiguration.treasurySafe !== null
    || Object.keys(robinhood.governanceConfiguration.roleAssignments).length !== 0
  ) {
    fail("unapproved Robinhood governance values are populated");
  }

  const environment = parseEnvironmentExample();
  for (const flag of [
    "DROID_REWARDS_ENABLED",
    "DROID_STRATEGIES_ENABLED",
    "CROSS_CHAIN_BRIDGE_ENABLED",
    "DROID_AGENT_ENABLED",
  ]) {
    if (environment.get(flag) !== "false") fail(`${flag} must remain false`);
  }
  if (environment.get("BROADCAST") !== "false") fail("BROADCAST must default false");

  const hardhatConfig = bytes("hardhat.config.js").toString("utf8");
  if (/dotenv\/config|dotenv\.config|loadEnvConfig/.test(hardhatConfig)) {
    fail("Hardhat config auto-loads root environment files");
  }
  for (const preflight of [
    "scripts/preflight-monad-droid-accounts.js",
    "scripts/preflight-hoodyoor-economic-droids.js",
    "scripts/preflight-robinhood-mainnet.js",
    "scripts/preflight-robinhood-seadrop-v2.js",
  ]) {
    const sourceCode = bytes(preflight).toString("utf8");
    if (/loadHoodyoorLocalEnvironment|verifyRevealSecretBackup|new Wallet\s*\(/.test(sourceCode)) {
      fail(`${preflight} contains a forbidden secret-dependent verification path`);
    }
  }

  const result = {
    mode: "offline-keyless-audit-gated-release-verification",
    packageStatus: release.packageStatus,
    releaseGate: release.releaseGate,
    sourceCommit,
    cleanSourceSnapshot: true,
    reproducibleBuilds: 3,
    artifactsChecked: artifactFreeze.candidates.length,
    independentAudit: "NOT_STARTED",
    deploymentAuthorized: false,
    broadcastCapability: false,
    privateKeyRead: false,
    result: "PASS_AUDIT_REQUIRED",
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
