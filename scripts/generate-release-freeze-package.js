import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RELEASE_CONTRACTS } from "./lib/release-artifacts.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MONAD_COLLECTION = "0x349D8eb480c92cF75371fbA5C6344A4d11b9103A";
const ROBINHOOD_COLLECTION = "0x8277F8126722B11D7b44C5C453bcF62A78AAFa25";
const CANONICAL_REGISTRY = "0x000000006551c19487814612e58FE06813775758";
const ZERO_SALT = `0x${"00".repeat(32)}`;
const RH_CONSTRUCTOR_GAS = Object.freeze({
  HoodYoorDroidRegistry: "2007992",
  HoodYoorAssetRegistry: "1804850",
  HoodYoorRewardsDistributor: "2422400",
  HoodYoorRevenueVault: "2564760",
  HoodYoorStrategyRegistry: "2171725",
  HoodYoorAchievementRegistry: "1693949",
});
const RH_GAS_TOTAL = Object.values(RH_CONSTRUCTOR_GAS)
  .reduce((total, value) => total + BigInt(value), 0n);

function option(name) {
  const inline = process.argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function requiredPath(name) {
  const value = option(name);
  if (!value) throw new Error(`${name} is required.`);
  return path.isAbsolute(value) ? value : path.resolve(ROOT, value);
}

function run(command, args) {
  return execFileSync(command, args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(relativePath, value) {
  const target = path.join(ROOT, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256File(relativePath) {
  return `0x${createHash("sha256").update(fs.readFileSync(path.join(ROOT, relativePath))).digest("hex")}`;
}

function ethForGas(gas, feeWei) {
  const value = BigInt(gas) * BigInt(feeWei);
  const whole = value / 10n ** 18n;
  const fraction = (value % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function artifactByName(artifacts, name) {
  const record = artifacts.find((candidate) => candidate.contract === name);
  if (!record) throw new Error(`Missing frozen artifact ${name}.`);
  return record;
}

function auditRecord(contract, chainId, immutable) {
  return {
    contract,
    chainId,
    immutable,
    status: "NOT_STARTED",
    findings: [],
    productionBlocking: true,
  };
}

const sourceCommit = option("--source-commit");
if (!/^[0-9a-f]{40}$/.test(sourceCommit)) throw new Error("--source-commit must be a full SHA.");
if (run("git", ["rev-parse", "HEAD"]) !== sourceCommit) {
  throw new Error("Generate the freeze package from the exact source commit being frozen.");
}
if (run("git", ["status", "--porcelain=v1", "--untracked-files=no"])) {
  throw new Error("Tracked source changes must be committed before generating the freeze package.");
}

const reproducibility = readJson(requiredPath("--reproducibility"));
const cleanRoom = readJson(requiredPath("--clean-room-check"));
const monadPreflight = readJson(requiredPath("--monad-preflight"));
const robinhoodPreflight = readJson(requiredPath("--robinhood-preflight"));
if (
  reproducibility.result !== "PASS"
  || !reproducibility.canonicalOutputsIdentical
  || !reproducibility.wholeArtifactJsonIdentical
  || reproducibility.sourceCommit !== sourceCommit
  || cleanRoom.result !== "PASS"
  || cleanRoom.sourceCommit !== sourceCommit
) {
  throw new Error("Reproducibility evidence does not bind to the requested source commit.");
}
if (
  monadPreflight.chainId !== 143
  || monadPreflight.privateKeyRead !== false
  || monadPreflight.broadcastCapability !== false
  || robinhoodPreflight.chainId !== 4663
  || robinhoodPreflight.privateKeyRead !== false
  || robinhoodPreflight.broadcastCapability !== false
) {
  throw new Error("Live preflight evidence is not keyless/read-only on the expected chains.");
}
if (
  monadPreflight.collection.address.toLowerCase() !== MONAD_COLLECTION.toLowerCase()
  || robinhoodPreflight.collectionState.address.toLowerCase() !== ROBINHOOD_COLLECTION.toLowerCase()
) {
  throw new Error("Collection address mismatch in live evidence.");
}
if (
  robinhoodPreflight.collectionState.totalSupply !== 0
  || robinhoodPreflight.collectionState.lifecycle !== "deployed-pre-mint"
) {
  throw new Error("Robinhood collection is no longer in the frozen pre-mint state.");
}

const frozenAt = new Date().toISOString();
const branch = run("git", ["branch", "--show-current"]);
const artifacts = reproducibility.runA.records.map((record) => {
  const definition = RELEASE_CONTRACTS.find((candidate) => candidate.contract === record.contract);
  if (!definition) throw new Error(`Missing release definition for ${record.contract}.`);
  return {
    ...record,
    source: definition.source,
    chainTargets: definition.chains,
    sourceCommit,
    compiler: "0.8.24+commit.e11b9ed9",
    compilerSettings: {
      optimizerEnabled: true,
      optimizerRuns: 200,
      viaIR: true,
      evmVersion: "paris",
      metadataBytecodeHash: "ipfs",
      foundryProfile: "release",
      releaseScope: ["src/droid", "src/economic"],
    },
    libraries: [],
    linkedAddresses: [],
    createBehavior: "CREATE",
    auditStatus: "NOT_STARTED",
  };
});
const artifactManifest = {
  schema: "hoodyoor-contract-artifact-freeze-v2",
  frozenAt,
  sourceCommit,
  previousFreeze: {
    status: "INVALIDATED",
    reason: "Whole Foundry JSON hashes changed with compiler source/AST indexing; no previous approval carries forward.",
  },
  hashingPolicy: {
    implementation: "scripts/lib/release-artifacts.js",
    canonicalSchema: "hoodyoor-canonical-solidity-artifact-v1",
    included: [
      "ABI and constructor schema",
      "creation and runtime bytecode",
      "creation/runtime link references",
      "immutable reference start/length locations",
      "method identifiers",
      "raw compiler metadata embedded by the compiler",
      "storage labels, slots, offsets, encodings, and normalized semantic types",
    ],
    excluded: [
      "source maps and top-level compiler source IDs",
      "AST IDs used only as immutable-reference JSON keys",
      "AST IDs and source-order suffixes in storage-layout type identifiers",
    ],
    exclusionReason: "The excluded values locate source/debug AST nodes. They are neither deployed nor linked and do not change ABI, bytecode, storage slots/types, links, immutables, or constructor semantics.",
  },
  reproducibility: {
    buildAEqualsBuildB: true,
    thirdCleanRoomMatches: true,
    fullArtifactJsonReproducibleUnderReleaseScope: true,
    report: "deployments/release-freeze/reproducibility.json",
    cleanRoomReport: "deployments/release-freeze/clean-room-check.json",
  },
  compiler: {
    solidity: "0.8.24+commit.e11b9ed9",
    foundry: "1.5.1-stable (b0a9dd9ceda36f63e2326ce530c10e6916f4b8a2)",
    optimizerEnabled: true,
    optimizerRuns: 200,
    viaIR: true,
    evmVersion: "paris",
  },
  candidates: artifacts,
  canonicalErc6551Registry: {
    chainTarget: 143,
    address: CANONICAL_REGISTRY,
    sourceArtifactAvailableInRepository: false,
    provenance: "Exact canonical EIP-6551 deterministic deployment payload reviewed by the Monad preflight.",
    reviewedDeploymentDataHash: monadPreflight.canonicalRegistry.reviewedDeploymentDataHash,
    expectedRuntimeCodeHash: monadPreflight.canonicalRegistry.expectedRuntimeCodeHash,
    deploymentFactory: monadPreflight.canonicalRegistry.deploymentFactory,
    auditStatus: "NOT_STARTED",
  },
};

const sourceSnapshot = {
  schema: "hoodyoor-release-source-snapshot-v2",
  capturedAt: frozenAt,
  branch,
  sourceCommit,
  cleanSourceSnapshot: true,
  cleanCheckoutVerified: true,
  trackedSourceChangesAtFreeze: false,
  originalAuthoringWorktreeExcludedFilesPreserved: true,
  trackedFileCount: Number(run("git", ["ls-tree", "-r", "--name-only", sourceCommit]).split("\n").filter(Boolean).length),
  submodules: run("git", ["submodule", "status"]) || "NONE",
  dependencyLocks: {
    rootPackageLockSha256: sha256File("package-lock.json"),
    gamePackageLockSha256: sha256File("apps/game/package-lock.json"),
    discordPackageLockSha256: sha256File("apps/discord/package-lock.json"),
  },
  toolchain: {
    node: process.version,
    npm: run("npm", ["--version"]),
    foundry: "1.5.1-stable",
    hardhat: "3.11.1",
    releaseSolidity: "0.8.24+commit.e11b9ed9",
  },
  environmentClasses: [
    "development",
    "testing",
    "read-only preflight",
    "deployment simulation",
    "production broadcast",
  ],
  verificationMode: "KEYLESS_READ_ONLY",
  privateKeyRead: false,
  broadcastCapability: false,
  historicalSecretAccessIncident: {
    occurredInPriorBlockedPass: true,
    description: "Legacy Robinhood preflight loaded local deployer key material only to derive its public address.",
    secretPrinted: false,
    signatureCreated: false,
    transactionBroadcast: false,
    remediation: "Release preflights no longer load root env files or private reveal data and use explicit public HOODYOOR_DEPLOYER_ADDRESS when an address is needed.",
    regressionTest: "test/release-secret-isolation.test.js",
  },
  artifactFreezeStatus: "REISSUED_REPRODUCIBLE",
  independentAuditStatus: "NOT_STARTED",
  productionAuthorizationEligible: false,
};

const monadArtifacts = [
  artifactByName(artifacts, "DroidAccountV1"),
  artifactByName(artifacts, "DroidAccountRegistry"),
];
const monadRelease = {
  schema: "hoodyoor-monad-droid-release-candidate-v2",
  frozenAt,
  status: "AUDIT_REQUIRED",
  sourceCommit,
  deploymentAuthorized: false,
  broadcastCapability: false,
  broadcastAttempted: false,
  privateKeyRead: false,
  independentAuditStatus: "NOT_STARTED",
  chain: { name: "Monad Mainnet", chainId: 143, nativeGasSymbol: "MON" },
  collection: {
    name: "D.Y.O.O.R",
    address: MONAD_COLLECTION,
    runtimeCodeHash: monadPreflight.collection.runtimeCodeHash,
    totalSupplyAtCheckpoint: monadPreflight.collection.totalSupply,
    controllerPolicy: "DIRECT_ERC721_OWNER",
    season2AscensionCustodyBalance: monadPreflight.controllerResolution.season2BalanceAtAscension,
    existingContractUntouched: true,
  },
  releaseCandidates: [
    {
      order: 1,
      contract: "Canonical ERC-6551 Registry",
      artifactType: "reviewed-deterministic-payload",
      reviewedDeploymentDataHash: monadPreflight.canonicalRegistry.reviewedDeploymentDataHash,
      expectedRuntimeCodeHash: monadPreflight.canonicalRegistry.expectedRuntimeCodeHash,
      deploymentFactory: monadPreflight.canonicalRegistry.deploymentFactory,
      expectedAddress: CANONICAL_REGISTRY,
      currentlyDeployed: monadPreflight.canonicalRegistry.present,
      constructorArguments: [],
      estimatedGas: monadPreflight.gas.canonicalRegistry,
      deployer: null,
      ownerAdmin: "NONE",
      immutableDeployment: true,
      deploymentApproved: false,
    },
    {
      order: 2,
      ...monadArtifacts[0],
      constructorArguments: [],
      expectedAddress: null,
      deployer: null,
      ownerAdmin: "NONE",
      estimatedGas: monadPreflight.gas.implementation,
      immutableDeployment: true,
      deploymentApproved: false,
    },
    {
      order: 3,
      ...monadArtifacts[1],
      constructorArguments: [CANONICAL_REGISTRY, MONAD_COLLECTION, null, 143, ZERO_SALT],
      constructorArgumentNames: ["canonicalRegistry", "tokenContract", "deployedDroidAccountV1", "tokenChainId", "accountSalt"],
      expectedAddress: null,
      deployer: null,
      ownerAdmin: "NONE",
      estimatedGas: monadPreflight.gas.facade,
      immutableDeployment: true,
      deploymentApproved: false,
    },
  ],
  gasCheckpoint: {
    generatedAt: monadPreflight.generatedAt,
    observedBlock: monadPreflight.latestBlock,
    gasPriceWei: monadPreflight.gas.gasPriceWei,
    totalEstimatedGas: monadPreflight.gas.total,
    estimatedDeploymentMon: monadPreflight.gas.estimatedDeploymentMon,
    recommendedThreeTimesReserveMon: monadPreflight.gas.recommendedThreeTimesBufferMon,
    refreshRequiredBeforeAuthorization: true,
  },
  governance: {
    deployerAddress: null,
    safeAddress: null,
    canaryTokenId: null,
    canaryOwnerA: null,
    canaryOwnerB: null,
    canaryFundingCapMon: null,
    canaryTestAsset: null,
  },
  activation: { modelRecommendation: "LAZY_HYBRID", massActivation: false, approved: false },
  featureFlagsAtFreeze: {
    MONAD_DROIDS_ENABLED: false,
    DROID_REWARDS_ENABLED: false,
    DROID_STRATEGIES_ENABLED: false,
    CROSS_CHAIN_BRIDGE_ENABLED: false,
    DROID_AGENT_ENABLED: false,
  },
  blockers: ["independent audit", "owner artifact approval", "deployer/Safe decision", "gas budget", "canary selection", "separate deployment authorization"],
};

const rhArtifacts = artifacts.filter((record) => record.chainTargets.includes(4663));
const maxFee = robinhoodPreflight.feeData.maxFeePerGasWei;
const robinhoodRelease = {
  schema: "hoodyoor-robinhood-economic-release-candidate-v2",
  frozenAt,
  status: "AUDIT_REQUIRED_PRE_MINT_HOLD",
  sourceCommit,
  deploymentAuthorized: false,
  broadcastCapability: false,
  broadcastAttempted: false,
  privateKeyRead: false,
  independentAuditStatus: "NOT_STARTED",
  chain: { name: "Robinhood Chain", chainId: 4663, nativeGasSymbol: "ETH" },
  collection: {
    address: ROBINHOOD_COLLECTION,
    runtimeCodeHash: robinhoodPreflight.existingContractsUntouched.collection.runtimeCodeHash,
    lifecycle: robinhoodPreflight.collectionState.lifecycle,
    totalSupplyAtFreeze: robinhoodPreflight.collectionState.totalSupply,
    mintingFinalized: robinhoodPreflight.collectionState.mintingFinalized,
    owner: robinhoodPreflight.collectionState.owner,
    treasury: robinhoodPreflight.collectionState.treasury,
    royaltyReceiver: robinhoodPreflight.collectionState.royaltyReceiver,
    existingContractUntouched: true,
  },
  existingDroidAccountV1: { ...robinhoodPreflight.droidAccountWiring, redeploy: false },
  plannedEconomicDeployments: rhArtifacts.map((record, index) => ({
    order: index + 1,
    ...record,
    address: null,
    initialAdminSafe: null,
    estimatedGas: RH_CONSTRUCTOR_GAS[record.contract],
    expectedAddress: null,
    deploymentApproved: false,
    featureEnabledAfterDeployment: false,
  })),
  revenueVault: {
    contract: "HoodYoorRevenueVault",
    canonicalArtifactSha256: artifactByName(artifacts, "HoodYoorRevenueVault").canonicalArtifactSha256,
    creationBytecodeHash: artifactByName(artifacts, "HoodYoorRevenueVault").creationBytecodeHash,
    runtimeBytecodeHash: artifactByName(artifacts, "HoodYoorRevenueVault").runtimeBytecodeHash,
    allocationBuckets: ["PROJECT_TREASURY", "DROID_REWARDS", "OTHER_APPROVED"],
    requiredTotalBps: 10000,
    initialSplit: null,
    independentReviewRequired: true,
  },
  gasCheckpoint: {
    generatedAt: robinhoodPreflight.generatedAt,
    observedBlock: robinhoodPreflight.latestBlock,
    benchmark: "Fresh Foundry --gas-report constructor deployments",
    gasByContract: RH_CONSTRUCTOR_GAS,
    totalEstimatedGas: RH_GAS_TOTAL.toString(),
    maxFeePerGasWei: maxFee,
    estimatedEthAtCheckpointMaxFee: ethForGas(RH_GAS_TOTAL, maxFee),
    recommendedThreeTimesReserveEth: ethForGas(RH_GAS_TOTAL * 3n, maxFee),
    refreshRequiredBeforeAuthorization: true,
  },
  governanceConfiguration: {
    mainGovernanceSafe: null,
    treasurySafe: null,
    operationsSafe: null,
    royaltyReceiver: null,
    roleAssignments: {},
    treasurySplit: null,
    approvedAssets: [],
    approvedRevenueSources: [],
    strategies: [],
    failClosed: true,
  },
  currentEoaConcentrationRisk: {
    sameAddressControlsCollectionTreasuryAndRoyalties: true,
    address: robinhoodPreflight.collectionState.owner,
    migrationExecuted: false,
    plan: "docs/robinhood-eoa-safe-migration.md",
  },
  featureFlagsAtFreeze: {
    ROBINHOOD_DROIDS_ENABLED: false,
    DROID_REWARDS_ENABLED: false,
    DROID_STRATEGIES_ENABLED: false,
    CROSS_CHAIN_BRIDGE_ENABLED: false,
    DROID_AGENT_ENABLED: false,
  },
  blockers: ["independent audit", "Revenue Vault independent review", "Safe/role decisions", "treasury split", "asset/source/strategy approvals", "separate deployment authorization"],
};

const approvals = {
  MONAD_DROID_ACCOUNT_DEPLOYMENT_APPROVED: false,
  MONAD_CANARY_APPROVED: false,
  MONAD_GENERAL_ACTIVATION_APPROVED: false,
  MONAD_REWARDS_APPROVED: false,
  MONAD_STRATEGIES_APPROVED: false,
  ROBINHOOD_ECONOMIC_DEPLOYMENT_APPROVED: false,
  ROBINHOOD_REWARDS_APPROVED: false,
  ROBINHOOD_STRATEGIES_APPROVED: false,
  SHARED_TREASURY_VIEW_APPROVED: false,
  BRIDGE_APPROVED: false,
  AGENT_APPROVED: false,
};
const audits = [
  auditRecord("Canonical ERC-6551 Registry payload", 143, true),
  auditRecord("DroidAccountV1", 143, true),
  auditRecord("DroidAccountRegistry", 143, true),
  ...rhArtifacts.map((record) => auditRecord(record.contract, 4663, false)),
];
const dualChain = {
  schema: "hoodyoor-dual-chain-authorization-package-v2",
  generatedAt: frozenAt,
  packageStatus: "AUDIT_REQUIRED",
  releaseGate: "INDEPENDENT_AUDIT_NOT_STARTED",
  sourceCommit,
  deploymentAuthorized: false,
  economicConfigurationAuthorized: false,
  featureActivationAuthorized: false,
  broadcastCapability: false,
  broadcastAttempted: false,
  fundsMoved: false,
  privateKeyRead: false,
  artifactFreeze: { status: "REISSUED_REPRODUCIBLE", manifest: "deployments/release-freeze/contract-artifacts.json", priorApprovalsInvalidated: true },
  independentAudit: { overallStatus: "NOT_STARTED", contracts: audits, criticalOrHighOpen: null },
  governance: {
    safeAddresses: { mainGovernanceSafe: null, treasurySafe: null, operationsSafe: null, emergencySafe: null },
    recommendations: { mainGovernanceSafe: "3-of-5", treasurySafe: "3-of-5", restrictedOperationsSafe: "2-of-3", oneOfOneTreasury: "NOT_RECOMMENDED" },
  },
  treasuryPolicy: {
    launchRecommendation: { projectTreasuryBps: 6000, droidRewardsBps: 3000, otherApprovedBps: 1000, totalBps: 10000, ownerApproved: false },
    laterTarget: { projectTreasuryBps: 5500, droidRewardsBps: 3500, otherApprovedBps: 1000, totalBps: 10000, automatic: false },
    governanceRangesArePolicyOnly: true,
  },
  approvedRevenueSources: [],
  assetCandidates: { monad: [], robinhood: [] },
  strategyCandidates: [],
  featureActivationAuthorizations: approvals,
  exactNextAction: "Send the frozen source commit, artifact manifest, reproducibility evidence, threat model, and test report to an independent smart-contract auditor. Do not deploy.",
};

const monadTransactions = {
  schema: "hoodyoor-monad-proposed-transactions-v2",
  generatedAt: frozenAt,
  status: "AUDIT_REQUIRED",
  sourceCommit,
  chain: { chainId: 143, collection: MONAD_COLLECTION },
  transactionAuthorizationPrepared: false,
  deploymentAuthorized: false,
  proposedTransactions: monadRelease.releaseCandidates.map((candidate) => ({
    txNumber: candidate.order,
    purpose: `Deploy ${candidate.contract}`,
    contract: candidate.contract,
    artifactHash: candidate.canonicalArtifactSha256 || candidate.reviewedDeploymentDataHash,
    from: null,
    to: candidate.order === 1 ? monadPreflight.canonicalRegistry.deploymentFactory : null,
    value: "0",
    constructorArguments: candidate.constructorArguments,
    estimatedGas: candidate.estimatedGas,
    maxAuthorizedGas: null,
    expectedContractAddress: candidate.expectedAddress,
    ownerApprovalRequired: true,
    ownerApproved: false,
    immutableDeployment: true,
    postCondition: "Exact bytecode and immutable configuration must match before the next transaction.",
  })),
  safeCommands: {
    dryRun: "npm run preflight:monad:droid-accounts",
    fork: "npm run test:monad:droid-accounts:fork",
    productionDeploymentCommand: null,
  },
};
const robinhoodTransactions = {
  schema: "hoodyoor-robinhood-proposed-transactions-v2",
  generatedAt: frozenAt,
  status: "AUDIT_REQUIRED_PRE_MINT_HOLD",
  sourceCommit,
  chain: { chainId: 4663, collection: ROBINHOOD_COLLECTION },
  transactionAuthorizationPrepared: false,
  deploymentAuthorized: false,
  proposedTransactions: robinhoodRelease.plannedEconomicDeployments.map((candidate) => ({
    txNumber: candidate.order,
    purpose: `Deploy ${candidate.contract}`,
    contract: candidate.contract,
    canonicalArtifactSha256: candidate.canonicalArtifactSha256,
    creationBytecodeHash: candidate.creationBytecodeHash,
    runtimeBytecodeHash: candidate.runtimeBytecodeHash,
    from: null,
    to: null,
    value: "0",
    constructorArguments: null,
    constructorSchema: candidate.constructorSchema,
    estimatedGas: candidate.estimatedGas,
    maxAuthorizedGas: null,
    expectedContractAddress: null,
    ownerApprovalRequired: true,
    ownerApproved: false,
    postCondition: "Exact bytecode, constructor values, roles, and disabled flags must be independently verified.",
  })),
  safeCommands: {
    dryRun: "npm run preflight:hoodyoor:economy",
    fork: "npm run test:robinhood:droid-accounts:fork",
    productionDeploymentCommand: null,
  },
};

writeJson("deployments/release-freeze/reproducibility.json", reproducibility);
writeJson("deployments/release-freeze/clean-room-check.json", cleanRoom);
writeJson("deployments/release-freeze/contract-artifacts.json", artifactManifest);
writeJson("deployments/authorization/release-source-snapshot.json", sourceSnapshot);
writeJson("deployments/monad/release-candidate-143.json", monadRelease);
writeJson("deployments/robinhood/pre-mint-release-plan.json", robinhoodRelease);
writeJson("deployments/authorization/dual-chain-release.json", dualChain);
writeJson("deployments/authorization/monad-transactions.json", monadTransactions);
writeJson("deployments/authorization/robinhood-transactions.json", robinhoodTransactions);
process.stdout.write(`${JSON.stringify({ sourceCommit, artifacts: artifacts.length, result: "GENERATED_AUDIT_REQUIRED_PACKAGE" }, null, 2)}\n`);
