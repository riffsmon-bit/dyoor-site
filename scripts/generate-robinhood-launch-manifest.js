import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getBytes, keccak256, toUtf8Bytes } from "ethers";
import {
  HOODYOOR_APPROVED_MINT_ENERGY_REWARD,
  loadHoodyoorLocalEnvironment,
  mainnetGateReport,
  verifyRevealSecretBackup,
} from "./lib/hoodyoor-mainnet.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadHoodyoorLocalEnvironment(projectRoot);
const contractRoot = path.join(projectRoot, "contracts", "hoodyoor");
const generatedRoot = path.join(projectRoot, "data", "robinhood", "onchain-128");
const outputPath = path.join(generatedRoot, "hoodyoor-mainnet-launch-manifest.json");

const contracts = [
  "HoodYOOR",
  "HoodYOOREnergyBank",
  "HoodYOORPackedTraitStore",
  "HoodYOORPixelRenderer",
  "HoodYOORTraitRules",
  "HoodYOORRerollController",
];
const productionSources = [
  "src/HoodYOOR.sol",
  "src/HoodYOOREnergyBank.sol",
  "src/HoodYOORPackedTraitStore.sol",
  "src/HoodYOORPixelRenderer.sol",
  "src/HoodYOORRerollController.sol",
  "src/HoodYOORTraitRules.sol",
  "src/interfaces/IHoodYOORCollection.sol",
  "src/interfaces/IHoodYOOREnergyBank.sol",
  "src/interfaces/IHoodYOORRenderer.sol",
  "src/interfaces/IHoodYOORRerollController.sol",
  "src/interfaces/IHoodYOORTraitRules.sol",
  "src/interfaces/IHoodYOORTraitStore.sol",
  "src/interfaces/TokenInterfaces.sol",
  "src/lib/Base64.sol",
  "src/lib/BytecodeStorage.sol",
  "src/lib/ECDSA.sol",
  "src/lib/Json.sol",
  "src/lib/MerkleProof.sol",
  "src/lib/PixelSVG.sol",
  "src/lib/SignatureChecker.sol",
  "src/lib/Strings.sol",
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizedBytecode(value) {
  const encoded = value?.object || value;
  if (!encoded || encoded === "0x") throw new Error("Missing compiled contract bytecode.");
  return encoded.startsWith("0x") ? encoded : `0x${encoded}`;
}

function fileRecord(relativePath, root = projectRoot) {
  const absolutePath = path.join(root, relativePath);
  const bytes = fs.readFileSync(absolutePath);
  return {
    path: path.relative(projectRoot, absolutePath),
    bytes: bytes.length,
    sha256: sha256(bytes),
    keccak256: keccak256(bytes),
  };
}

const config = readJson(path.join(projectRoot, "data", "robinhood", "dyoor-collection-config.json"));
const art = readJson(path.join(generatedRoot, "hoodyoor-onchain-art-manifest.json"));
const assignments = readJson(path.join(generatedRoot, "hoodyoor-initial-assignments.json"));
const rules = readJson(path.join(generatedRoot, "hoodyoor-reroll-rules.json"));
const gtd = readJson(path.join(generatedRoot, "hoodyoor-gtd-allowlist.json"));
const energyMigration = readJson(path.join(
  generatedRoot,
  "hoodyoor-energy-migration-ledger.json",
));
const canaryCheckpointPath = path.join(
  projectRoot,
  "deployments",
  "robinhood",
  "hoodyoor-blockhash-canary-4663.json",
);
const canary = fs.existsSync(canaryCheckpointPath)
  ? readJson(canaryCheckpointPath)
  : null;
const canaryValidated = Boolean(
  canary
  && canary.schema === "dyoor-hoodyoor-blockhash-canary-v1"
  && canary.chainId === 4_663
  && canary.status === "validated"
  && canary.targetBlock - canary.requestBlock === 64
  && canary.canonicalTargetChainId === 4_663
  && canary.canonicalTargetParentBlockNumber === canary.targetBlock
  && canary.canonicalTargetBlockHash?.toLowerCase() === canary.observedBlockHash?.toLowerCase()
  && /^0x[0-9a-f]{64}$/i.test(canary.deploymentTransaction || "")
  && /^0x[0-9a-f]{64}$/i.test(canary.observationTransaction || "")
);
const revealBackup = verifyRevealSecretBackup(projectRoot);
const ownerLaunchGates = mainnetGateReport(config.owner);

const sourceFiles = productionSources.map((relativePath) => fileRecord(relativePath, contractRoot));
const sourceTree = sourceFiles.map(({ path: filePath, sha256: hash }) => `${filePath}\0${hash}`).join("\n");

const artifacts = contracts.map((name) => {
  const artifactPath = path.join(contractRoot, "out", `${name}.sol`, `${name}.json`);
  const artifact = readJson(artifactPath);
  const creation = normalizedBytecode(artifact.bytecode);
  const runtime = normalizedBytecode(artifact.deployedBytecode);
  return {
    contract: name,
    source: `contracts/hoodyoor/src/${name}.sol`,
    artifact: path.relative(projectRoot, artifactPath),
    creationBytes: getBytes(creation).length,
    creationKeccak256: keccak256(creation),
    runtimeBytes: getBytes(runtime).length,
    runtimeKeccak256: keccak256(runtime),
    abiKeccak256: keccak256(toUtf8Bytes(JSON.stringify(artifact.abi))),
  };
});
const compiler = readJson(
  path.join(contractRoot, "out", "HoodYOOR.sol", "HoodYOOR.json"),
).metadata;

const payloads = {
  art: {
    binary: fileRecord("data/robinhood/onchain-128/hoodyoor-onchain-art.bin"),
    records: fileRecord("data/robinhood/onchain-128/hoodyoor-trait-records.bin"),
    binaryHash: art.totals.payloadKeccak256,
    catalogHash: art.contracts.catalogHash,
    traits: art.totals.traits,
    chunks: art.totals.chunks,
  },
  assignments: {
    binary: fileRecord("data/robinhood/onchain-128/hoodyoor-initial-assignments.bin"),
    binaryHash: assignments.totals.binaryKeccak256,
    provenanceHash: assignments.totals.provenanceHash,
    assignments: assignments.totals.assignments,
    batches: assignments.assignmentBatches.length,
  },
  rules: {
    binary: fileRecord("data/robinhood/onchain-128/hoodyoor-reroll-rules.bin"),
    binaryHash: rules.contract.rulesHash,
    rulesHash: rules.contract.rulesHash,
    pairs: rules.contract.expectedPairCount,
  },
  energyMigration: {
    binary: fileRecord("data/robinhood/onchain-128/hoodyoor-energy-migration.bin"),
    ledger: fileRecord(
      "data/robinhood/onchain-128/hoodyoor-energy-migration-ledger.json",
    ),
    csv: fileRecord("data/robinhood/onchain-128/hoodyoor-energy-migration.csv"),
    binaryHash: energyMigration.binary.keccak256,
    sourceChainId: energyMigration.source.chainId,
    sourceEnergyBank: energyMigration.source.energyBank,
    snapshotBlock: energyMigration.source.snapshotBlock,
    sourceWallets: energyMigration.totals.sourceWallets,
    migratedWallets: energyMigration.totals.migratedWallets,
    destinationEnergy: energyMigration.totals.destinationEnergy,
    batches: energyMigration.batches.length,
  },
  gtd: {
    binary: fileRecord("data/robinhood/onchain-128/hoodyoor-gtd-allowlist.bin"),
    tree: fileRecord("data/robinhood/onchain-128/hoodyoor-gtd-tree.json"),
    csv: fileRecord("data/robinhood/onchain-128/hoodyoor-gtd-allowlist.csv"),
    binaryHash: gtd.totals.binaryKeccak256,
    payloadHash: gtd.totals.binaryKeccak256,
    merkleRoot: gtd.merkleTree.root,
    uniqueWallets: gtd.totals.uniqueWallets,
    aggregateMaxMint: gtd.totals.aggregateMaxMint,
    monadHolderWallets: gtd.totals.monadHolderWallets,
    robinhoodTopHolderWallets: gtd.totals.robinhoodTopHolderWallets,
    overlapWallets: gtd.totals.overlapWallets,
  },
};

for (const payload of Object.values(payloads)) {
  const expected = payload.binaryHash;
  if (expected && payload.binary.keccak256.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`${payload.binary.path} does not match its frozen hash.`);
  }
}

const manifest = {
  schema: "dyoor-hoodyoor-mainnet-launch-v2",
  collection: config.name,
  targetChain: {
    ...config.targetChain,
    nativeCurrency: "ETH",
    publicRpc: "https://rpc.mainnet.chain.robinhood.com",
    explorer: "https://robinhoodchain.blockscout.com",
  },
  broadcast: {
    status: "not-deployed",
    authorized: false,
    readiness: "blocked",
    note: "This manifest is preparation evidence and never authorizes a transaction.",
  },
  economics: {
    maxSupply: config.maxSupply,
    ownerReserveAllocation: config.ownerReserve.allocation,
    paidAllocation: config.maxSupply - config.ownerReserve.allocation,
    gtdEligibleWallets: gtd.totals.uniqueWallets,
    aggregateGtdMaxMint: gtd.totals.aggregateMaxMint,
    mintPriceWei: "2500000000000000",
    royaltyBasisPoints: config.royalty.basisPoints,
    configuredOwner: config.owner,
    configuredTreasury: config.treasury,
    paidMintEnergyReward: config.reroll.mintEnergy.rewardPerPaidToken,
    ownerReserveEarnsMintEnergy: config.reroll.mintEnergy.ownerReserveEligible,
  },
  ownerDecisions: {
    mintEnergy: {
      rewardPerPaidToken: HOODYOOR_APPROVED_MINT_ENERGY_REWARD,
      status: ownerLaunchGates.mintEnergyRewardApproved ? "approved" : "unconfirmed",
    },
    securityReview: {
      status: ownerLaunchGates.securityReview.independentReviewApproved
        ? "independently-reviewed"
        : ownerLaunchGates.securityReview.explicitOwnerWaiver
          ? "explicit-owner-waiver"
          : "unresolved",
      independentlyReviewed: ownerLaunchGates.securityReview.independentReviewApproved,
      explicitOwnerWaiver: ownerLaunchGates.securityReview.explicitOwnerWaiver,
      note: ownerLaunchGates.securityReview.explicitOwnerWaiver
        ? "Owner explicitly accepted unaudited mainnet deployment risk. This is a waiver, not an audit or independent security approval."
        : "No independent review waiver is recorded.",
    },
  },
  ownerReserve: config.ownerReserve,
  secondaryTrading: config.secondaryTrading,
  compiler: {
    version: compiler.compiler.version,
    optimizer: compiler.settings.optimizer,
    viaIR: compiler.settings.viaIR,
    evmVersion: compiler.settings.evmVersion,
    metadataBytecodeHash: compiler.settings.metadata.bytecodeHash,
  },
  sourceTree: {
    files: sourceFiles,
    canonicalSha256: sha256(Buffer.from(sourceTree)),
    canonicalKeccak256: keccak256(toUtf8Bytes(sourceTree)),
  },
  artifacts,
  payloads,
  ceremony: {
    batchLimits: {
      artChunkBytes: 24_000,
      traitRecordsPerTransaction: 20,
      rulesPerTransaction: 40,
      assignmentsPerTransaction: 50,
      energyWalletsPerTransaction: energyMigration.destination.batchSize,
    },
    irreversibleOrder: [
      "deploy and freeze packed art store",
      "deploy renderer, collection, Energy Bank, frozen trait rules, and reroll controller",
      "migrate the exact-block Monad Energy ledger in replay-protected batches",
      "load all 3,333 assignment slots",
      "set and freeze the collection reroll controller",
      "grant the controller Energy SPENDER_ROLE",
      "grant the collection Energy CREDIT_ROLE and permanently freeze the 1,000-Energy paid-mint reward",
      "freeze assignments with provenance hash and a privately generated reveal commitment",
      "freeze the renderer",
      "set the independently reproduced combined GTD root",
      "open GTD and atomically mint the 150-token reserve to the current collection owner",
      "keep secondary trading locked until total minted supply reaches 1,667, including the owner reserve, or a permanent owner early-unlock",
      "open and close sale phases",
      "permanently finalize minting and request the delayed reveal",
      "permissionlessly complete reveal, then enable the Trait Lab service",
    ],
    reveal: {
      delayBlocks: 64,
      blockHashWindow: 256,
      blockClock: "Ethereum-parent height exposed by Robinhood Nitro's Solidity NUMBER opcode",
      entropySource: "Canonical Robinhood L2 block hash associated with the target parent height",
      approximateDelayMinutes: 13,
      approximateHashWindowMinutes: 51,
      permutation: "16-round swap-or-not over 3,333 assignments",
      secretPolicy: "Generate 32 random bytes offline; publish only its keccak256 commitment before mint.",
    },
  },
  verification: {
    localChainId4663Rehearsal: {
      status: "pass",
      command: "forge test --offline --match-contract HoodYOORLaunchRehearsalTest -vv",
      test: "testFullChain4663DeploymentGTDRevealAndReroll",
      aggregateTestGas: 422_655_619,
      note: "Aggregate gas covers many simulated transactions and is not a single-transaction estimate.",
    },
    assignmentTests: "pass",
    publicTestnetDeployment: "skipped",
    externalDeployment: "none",
    publicMainnetBlockhashCanary: canaryValidated ? {
      status: "pass",
      address: canary.canary,
      deploymentTransaction: canary.deploymentTransaction,
      observationTransaction: canary.observationTransaction,
      targetParentBlock: canary.targetBlock,
      canonicalRobinhoodBlock: canary.canonicalTargetBlockNumber,
      observedBlockHash: canary.observedBlockHash,
    } : {
      status: "incomplete",
    },
  },
  blockers: [
    {
      id: "verify-owner-and-treasury-control-on-robinhood",
      status: "open",
      note: "Confirm the configured owner and treasury are controllable Robinhood-chain receivers before constructor use. If the owner is a contract, verify it accepts ERC-721 safe mints before the 150-token GTD reserve transaction.",
    },
    {
      id: "final-energy-migration-ledger",
      status: "complete",
      snapshotBlock: energyMigration.source.snapshotBlock,
      ledgerHash: energyMigration.binary.keccak256,
    },
    { id: "result-signer-relayer-and-deployer-addresses", status: "open" },
    {
      id: "public-chain-reveal-blockhash-validation",
      status: canaryValidated ? "complete" : "open",
      note: canaryValidated
        ? `Validated on Robinhood mainnet with canary ${canary.canary}; Solidity NUMBER uses the Ethereum-parent height and BLOCKHASH returned canonical Robinhood block ${canary.canonicalTargetBlockNumber}.`
        : "Validate the Nitro future-block-hash reveal window on a public deployment because testnet was skipped.",
    },
    {
      id: "reveal-secret-offline-backup",
      status: revealBackup.passed ? "complete" : "open",
      note: revealBackup.passed
        ? "Owner confirmed an offline backup; the private record matches the frozen commitment and remains excluded from this manifest."
        : "Back up the reveal secret outside the deployment machine and confirm the matching private backup record before freezing its commitment.",
    },
    {
      id: "paid-mint-energy-owner-approval",
      status: ownerLaunchGates.mintEnergyRewardApproved ? "complete" : "open",
      note: `Owner approval is required for the permanently frozen ${HOODYOOR_APPROVED_MINT_ENERGY_REWARD}-Energy reward on every paid NFT.`,
    },
    {
      id: "independent-smart-contract-security-review",
      status: ownerLaunchGates.securityReview.independentReviewApproved
        ? "complete"
        : ownerLaunchGates.securityReview.explicitOwnerWaiver ? "waived" : "open",
      note: ownerLaunchGates.securityReview.explicitOwnerWaiver
        ? "Owner explicitly waived independent review and accepted unaudited deployment risk; this status must never be represented as audited."
        : "Complete an independent review or record an explicit owner risk waiver.",
    },
  ],
};

fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({
  output: path.relative(projectRoot, outputPath),
  readiness: manifest.broadcast.readiness,
  sourceTree: manifest.sourceTree.canonicalKeccak256,
  contracts: manifest.artifacts.length,
  blockers: manifest.blockers.length,
}, null, 2));
