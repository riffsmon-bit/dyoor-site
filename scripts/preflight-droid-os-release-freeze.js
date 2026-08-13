import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256 } from "ethers";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MONAD_MANIFEST = "deployments/monad/release-candidate-143.json";
const ROBINHOOD_MANIFEST = "deployments/robinhood/pre-mint-release-plan.json";
const REQUIRED_DOCS = [
  "docs/droid-os-core-spec.md",
  "docs/droid-os-chain-compatibility.md",
  "docs/dual-chain-production-readiness.md",
  "docs/monad-production-readiness.md",
  "docs/robinhood-pre-mint-readiness.md",
  "docs/dual-chain-security-model.md",
];
const REQUIRED_FALSE_FLAGS = [
  "MONAD_DROIDS_ENABLED",
  "NEXT_PUBLIC_MONAD_DROIDS_ENABLED",
  "ROBINHOOD_DROIDS_ENABLED",
  "NEXT_PUBLIC_ROBINHOOD_DROIDS_ENABLED",
  "DROID_REWARDS_ENABLED",
  "NEXT_PUBLIC_DROID_REWARDS_ENABLED",
  "DROID_STRATEGIES_ENABLED",
  "NEXT_PUBLIC_DROID_STRATEGIES_ENABLED",
  "SHARED_TREASURY_ENABLED",
  "NEXT_PUBLIC_SHARED_TREASURY_ENABLED",
  "CROSS_CHAIN_BRIDGE_ENABLED",
  "NEXT_PUBLIC_CROSS_CHAIN_BRIDGE_ENABLED",
  "DROID_AGENT_ENABLED",
  "NEXT_PUBLIC_DROID_AGENT_ENABLED",
];
const REQUIRED_UNSET_ROBINHOOD_GOVERNANCE = [
  "HOODYOOR_ECONOMY_DEFAULT_ADMIN_SAFE",
  "HOODYOOR_TREASURY_SAFE",
  "HOODYOOR_REWARD_SAFE",
  "HOODYOOR_OTHER_ALLOCATION_SAFE",
  "HOODYOOR_COLLECTION_ADMIN",
  "HOODYOOR_ASSET_ADMIN",
  "HOODYOOR_STRATEGY_ADMIN",
  "HOODYOOR_ACHIEVEMENT_ADMIN",
  "HOODYOOR_REVENUE_SOURCE_ADMIN",
  "HOODYOOR_ALLOCATION_ADMIN",
  "HOODYOOR_RELEASE_ADMIN",
  "HOODYOOR_DESTINATION_ADMIN",
  "HOODYOOR_REWARD_ADMIN",
  "HOODYOOR_PAUSER",
  "HOODYOOR_TREASURY_BPS",
  "HOODYOOR_REWARD_BPS",
  "HOODYOOR_OTHER_ALLOCATION_BPS",
];
const FORBIDDEN_EXECUTION_SWITCHES = [
  "EXECUTE_DROID_OS_RELEASE_FREEZE",
  "EXECUTE_MONAD_DROID_DEPLOYMENT",
  "ALLOW_MONAD_DROID_MAINNET",
  "EXECUTE_HOODYOOR_ECONOMIC_DEPLOYMENT",
];

function truthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function fail(message) {
  throw new Error(`Release freeze failed: ${message}`);
}

function read(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolutePath)) fail(`missing ${relativePath}`);
  return fs.readFileSync(absolutePath);
}

function json(relativePath) {
  try {
    return JSON.parse(read(relativePath).toString("utf8"));
  } catch (error) {
    fail(`${relativePath} is not valid JSON (${error.message})`);
  }
}

function sha256(bytes) {
  return `0x${createHash("sha256").update(bytes).digest("hex")}`;
}

function parseEnvironmentExample() {
  const values = new Map();
  for (const rawLine of read(".env.example").toString("utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 0) continue;
    values.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return values;
}

function assertManifestIsFrozen(manifest, expectedStatus, expectedChainId) {
  if (manifest.status !== expectedStatus) fail(`unexpected status ${manifest.status}`);
  if (manifest.deploymentAuthorized !== false) fail("deployment must not be authorized");
  if (manifest.broadcastCapability !== false || manifest.broadcastAttempted !== false) {
    fail("manifest permits or records a broadcast");
  }
  if (manifest.privateKeyRead !== false) fail("manifest does not prohibit private-key reads");
  if (manifest.chain?.chainId !== expectedChainId) fail(`expected chain ${expectedChainId}`);
  for (const [name, value] of Object.entries(manifest.featureFlagsAtFreeze || {})) {
    if (value !== false) fail(`${name} is not frozen false in the manifest`);
  }
}

function assertArtifact(record, sourcePath) {
  const artifactPath = record.artifact
    || `contracts/hoodyoor/out/${record.contractName}.sol/${record.contractName}.json`;
  const artifactBytes = read(artifactPath);
  const sourceBytes = read(sourcePath || record.source);
  const artifact = JSON.parse(artifactBytes.toString("utf8"));
  const creation = String(artifact?.bytecode?.object || "");
  const runtime = String(artifact?.deployedBytecode?.object || "");
  if (!/^0x[0-9a-f]+$/i.test(creation) || !/^0x[0-9a-f]+$/i.test(runtime)) {
    fail(`${record.contractName} artifact has invalid bytecode`);
  }
  const assertions = [
    ["artifact SHA-256", sha256(artifactBytes), record.artifactSha256],
    ["source SHA-256", sha256(sourceBytes), record.sourceSha256],
    ["creation code hash", keccak256(creation), record.creationCodeHash],
    ["runtime template hash", keccak256(runtime), record.runtimeTemplateArtifactHash],
  ];
  for (const [label, actual, expected] of assertions) {
    if (actual.toLowerCase() !== String(expected || "").toLowerCase()) {
      fail(`${record.contractName} ${label} changed (expected ${expected}, got ${actual})`);
    }
  }
  if ((runtime.length - 2) / 2 > 24_576) fail(`${record.contractName} exceeds EIP-170`);
  return record.contractName;
}

function main() {
  for (const name of FORBIDDEN_EXECUTION_SWITCHES) {
    if (truthy(process.env[name])) fail(`${name} is forbidden in read-only freeze mode`);
  }

  const monad = json(MONAD_MANIFEST);
  const robinhood = json(ROBINHOOD_MANIFEST);
  assertManifestIsFrozen(monad, "DEPLOYMENT_HOLD", 143);
  assertManifestIsFrozen(robinhood, "PRE_MINT_CONFIGURATION_HOLD", 4663);
  if (monad.collection?.address?.toLowerCase()
    !== "0x349d8eb480c92cf75371fba5c6344a4d11b9103a") {
    fail("Monad collection changed");
  }
  if (robinhood.collection?.address?.toLowerCase()
    !== "0x8277f8126722b11d7b44c5c453bcf62a78aafa25") {
    fail("Robinhood pre-mint collection changed");
  }
  if (robinhood.collection?.lifecycle !== "deployed-pre-mint") {
    fail("Robinhood lifecycle must remain deployed-pre-mint");
  }
  if (robinhood.governanceConfiguration?.failClosed !== true) {
    fail("Robinhood governance placeholders are not fail-closed");
  }
  for (const field of ["approvedAssets", "approvedRevenueSources", "strategies"]) {
    if (!Array.isArray(robinhood.governanceConfiguration?.[field])
      || robinhood.governanceConfiguration[field].length !== 0) {
      fail(`Robinhood ${field} must remain empty`);
    }
  }

  const environment = parseEnvironmentExample();
  for (const name of REQUIRED_FALSE_FLAGS) {
    if (environment.get(name) !== "false") fail(`${name} must be explicitly false`);
  }
  for (const name of REQUIRED_UNSET_ROBINHOOD_GOVERNANCE) {
    if (environment.get(name) !== "") fail(`${name} must remain explicitly unset`);
  }
  if (environment.get("HOODYOOR_APPROVED_ASSETS") !== "[]") {
    fail("HOODYOOR_APPROVED_ASSETS must remain empty");
  }
  if (environment.get("HOODYOOR_APPROVED_REVENUE_SOURCES") !== "[]") {
    fail("HOODYOOR_APPROVED_REVENUE_SOURCES must remain empty");
  }

  for (const documentPath of REQUIRED_DOCS) {
    const document = read(documentPath).toString("utf8");
    if (document.includes("<!-- TEST_RESULTS_START -->")) {
      fail(`${documentPath} still contains pending test results`);
    }
  }

  const checkedArtifacts = [];
  for (const deployment of monad.deployments) {
    if (!deployment.artifactSha256) continue;
    checkedArtifacts.push(assertArtifact(deployment));
  }
  for (const deployment of robinhood.plannedEconomicDeployments) {
    checkedArtifacts.push(assertArtifact(
      deployment,
      `contracts/hoodyoor/src/economic/${deployment.contractName}.sol`,
    ));
    if (deployment.address !== null) fail(`${deployment.contractName} address must remain unset`);
  }

  const result = {
    mode: "offline-release-freeze",
    deploymentAuthorized: false,
    broadcastCapability: false,
    privateKeyRead: false,
    chains: {
      monad: { chainId: 143, status: monad.status },
      robinhood: { chainId: 4663, status: robinhood.status },
    },
    documentsChecked: REQUIRED_DOCS.length,
    artifactsChecked: checkedArtifacts,
    flagsChecked: REQUIRED_FALSE_FLAGS.length,
    result: "PASS",
    nextAction: "Independent audit and owner decisions; this command cannot deploy.",
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error?.message || error}\n`);
  process.exitCode = 1;
}
