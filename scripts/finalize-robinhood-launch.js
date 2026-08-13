import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Contract,
  JsonRpcProvider,
  Wallet,
  ZeroAddress,
  getAddress,
  keccak256,
} from "ethers";
import {
  HOODYOOR_CHAIN_ID,
  assertMainnetBroadcastSafety,
  loadHoodyoorLocalEnvironment,
  normalizePrivateKey,
  readJson,
  requireContract,
  saveCheckpoint,
} from "./lib/hoodyoor-mainnet.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadHoodyoorLocalEnvironment(projectRoot);
const generatedRoot = path.join(projectRoot, "data", "robinhood", "onchain-128");
const artifactRoot = path.join(projectRoot, "contracts", "hoodyoor", "out");
const config = readJson(path.join(
  projectRoot,
  "data",
  "robinhood",
  "dyoor-collection-config.json",
));
const launchManifest = readJson(path.join(
  generatedRoot,
  "hoodyoor-mainnet-launch-manifest.json",
));
const assignmentManifest = readJson(path.join(
  generatedRoot,
  "hoodyoor-initial-assignments.json",
));
const assignmentBytes = fs.readFileSync(path.join(
  generatedRoot,
  "hoodyoor-initial-assignments.bin",
));
const collectionArtifact = readJson(path.join(
  artifactRoot,
  "HoodYOOR.sol",
  "HoodYOOR.json",
));
const energyBankArtifact = readJson(path.join(
  artifactRoot,
  "HoodYOOREnergyBank.sol",
  "HoodYOOREnergyBank.json",
));
const controllerArtifact = readJson(path.join(
  artifactRoot,
  "HoodYOORRerollController.sol",
  "HoodYOORRerollController.json",
));
const rendererArtifact = readJson(path.join(
  artifactRoot,
  "HoodYOORPixelRenderer.sol",
  "HoodYOORPixelRenderer.json",
));
const rulesArtifact = readJson(path.join(
  artifactRoot,
  "HoodYOORTraitRules.sol",
  "HoodYOORTraitRules.json",
));
const execute = process.env.EXECUTE_HOODYOOR_LAUNCH_FINALIZATION === "1";
const assignmentBatchSize = 50;

function deploymentPath(name) {
  return path.join(
    projectRoot,
    "deployments",
    "robinhood",
    `${name}-${HOODYOOR_CHAIN_ID}.json`,
  );
}

function requiredCheckpoint(name, schema) {
  const filePath = deploymentPath(name);
  if (!fs.existsSync(filePath)) throw new Error(`Missing ${name} deployment checkpoint.`);
  const checkpoint = readJson(filePath);
  if (checkpoint.schema !== schema || checkpoint.chainId !== HOODYOOR_CHAIN_ID) {
    throw new Error(`${name} checkpoint does not target the reviewed mainnet build.`);
  }
  return checkpoint;
}

function packedAssignment(assignmentId) {
  const start = (assignmentId - 1) * 18;
  return BigInt(`0x${assignmentBytes.subarray(start, start + 18).toString("hex")}`);
}

async function recordTransaction(checkpoint, checkpointPath, label, transaction) {
  const receipt = await transaction.wait();
  const record = { label, hash: receipt.hash, blockNumber: receipt.blockNumber };
  checkpoint.transactions.push(record);
  saveCheckpoint(checkpointPath, checkpoint);
  return record;
}

if (
  assignmentManifest.totals.assignments !== config.maxSupply
  || assignmentBytes.length !== config.maxSupply * 18
  || keccak256(assignmentBytes).toLowerCase()
    !== launchManifest.payloads.assignments.binaryHash.toLowerCase()
) {
  throw new Error("Initial assignment payload does not match the frozen launch manifest.");
}

if (!execute) {
  console.log(JSON.stringify({
    mode: "dry-run",
    chainId: HOODYOOR_CHAIN_ID,
    assignments: assignmentManifest.totals.assignments,
    assignmentTransactions: Math.ceil(config.maxSupply / assignmentBatchSize),
    provenanceHash: launchManifest.payloads.assignments.provenanceHash,
    gtdMerkleRoot: launchManifest.payloads.gtd.merkleRoot,
    irreversibleSteps: [
      "freeze reroll controller address",
      "freeze the Energy Bank and 1,000-Energy paid-mint reward",
      "freeze all 3,333 initial assignments with the reveal commitment",
      "freeze renderer address",
    ],
    saleStateAfterFinalization: "closed",
    ownerReserveMintedAfterFinalization: false,
    executeWith: "EXECUTE_HOODYOOR_LAUNCH_FINALIZATION=1",
  }, null, 2));
  process.exit(0);
}

const rpcUrl = process.env.HOODYOOR_RPC_URL || "";
const privateKey = normalizePrivateKey(process.env.HOODYOOR_DEPLOYER_PRIVATE_KEY || "");
if (!rpcUrl || !privateKey) {
  throw new Error("HOODYOOR_RPC_URL and HOODYOOR_DEPLOYER_PRIVATE_KEY are required.");
}
const provider = new JsonRpcProvider(rpcUrl);
const wallet = new Wallet(privateKey, provider);
const network = await provider.getNetwork();
if (Number(network.chainId) !== HOODYOOR_CHAIN_ID) {
  throw new Error(`Refusing chain ${network.chainId}; expected ${HOODYOOR_CHAIN_ID}.`);
}
const gates = assertMainnetBroadcastSafety(config.owner);
const revealCommitment = process.env.HOODYOOR_REVEAL_COMMITMENT;

const artCheckpoint = requiredCheckpoint(
  "hoodyoor-onchain-art",
  "dyoor-hoodyoor-art-deployment-v1",
);
const coreCheckpoint = requiredCheckpoint(
  "hoodyoor-core",
  "dyoor-hoodyoor-core-deployment-v1",
);
const energyMigrationCheckpoint = requiredCheckpoint(
  "hoodyoor-energy-migration",
  "dyoor-hoodyoor-energy-migration-deployment-v1",
);
const rerollCheckpoint = requiredCheckpoint(
  "hoodyoor-reroll",
  "dyoor-hoodyoor-reroll-deployment-v1",
);
if (
  getAddress(coreCheckpoint.renderer) !== getAddress(artCheckpoint.renderer)
  || energyMigrationCheckpoint.status !== "complete"
  || getAddress(energyMigrationCheckpoint.energyBank) !== getAddress(coreCheckpoint.energyBank)
  || energyMigrationCheckpoint.ledgerHash.toLowerCase()
    !== gates.energyMigration.ledgerHash.toLowerCase()
  || getAddress(rerollCheckpoint.collection) !== getAddress(coreCheckpoint.collection)
  || getAddress(rerollCheckpoint.energyBank) !== getAddress(coreCheckpoint.energyBank)
  || getAddress(rerollCheckpoint.resultSigner) !== getAddress(gates.resultSigner)
) {
  throw new Error("Deployment checkpoints do not describe one consistent launch graph.");
}

for (const [address, label] of [
  [artCheckpoint.renderer, "Pixel renderer"],
  [coreCheckpoint.collection, "HoodYØØR collection"],
  [coreCheckpoint.energyBank, "HoodYØØR Energy Bank"],
  [rerollCheckpoint.rules, "Trait rules"],
  [rerollCheckpoint.controller, "Reroll controller"],
]) await requireContract(provider, getAddress(address), label);

const collection = new Contract(coreCheckpoint.collection, collectionArtifact.abi, wallet);
const energyBank = new Contract(coreCheckpoint.energyBank, energyBankArtifact.abi, wallet);
const controller = new Contract(rerollCheckpoint.controller, controllerArtifact.abi, wallet);
const renderer = new Contract(artCheckpoint.renderer, rendererArtifact.abi, wallet);
const rules = new Contract(rerollCheckpoint.rules, rulesArtifact.abi, wallet);

if (getAddress(await collection.owner()) !== wallet.address) {
  throw new Error("Deployment wallet is not the collection owner.");
}
if (getAddress(await energyBank.owner()) !== wallet.address) {
  throw new Error("Deployment wallet is not the Energy Bank owner.");
}
if (getAddress(await controller.owner()) !== wallet.address) {
  throw new Error("Deployment wallet is not the reroll controller owner.");
}
if (!await renderer.isFrozen() || !await rules.frozen()) {
  throw new Error("Art and reroll rules must already be frozen.");
}
if (getAddress(await controller.collection()) !== getAddress(coreCheckpoint.collection)) {
  throw new Error("Reroll controller points to an unexpected collection.");
}
if (getAddress(await controller.energyBank()) !== getAddress(coreCheckpoint.energyBank)) {
  throw new Error("Reroll controller points to an unexpected Energy Bank.");
}
if (getAddress(await controller.traitRules()) !== getAddress(rerollCheckpoint.rules)) {
  throw new Error("Reroll controller points to unexpected trait rules.");
}

const checkpointPath = deploymentPath("hoodyoor-launch-finalization");
const checkpoint = fs.existsSync(checkpointPath) ? readJson(checkpointPath) : {
  schema: "dyoor-hoodyoor-launch-finalization-v1",
  chainId: HOODYOOR_CHAIN_ID,
  deployer: wallet.address,
  collection: getAddress(coreCheckpoint.collection),
  energyBank: getAddress(coreCheckpoint.energyBank),
  renderer: getAddress(artCheckpoint.renderer),
  rules: getAddress(rerollCheckpoint.rules),
  controller: getAddress(rerollCheckpoint.controller),
  resultSigner: getAddress(gates.resultSigner),
  relayer: getAddress(gates.relayer),
  provenanceHash: launchManifest.payloads.assignments.provenanceHash,
  revealCommitment,
  gtdMerkleRoot: launchManifest.payloads.gtd.merkleRoot,
  mintEnergyReward: config.reroll.mintEnergy.rewardPerPaidToken,
  assignmentBatches: [],
  transactions: [],
  status: "in-progress",
};
for (const [key, expected] of Object.entries({
  chainId: HOODYOOR_CHAIN_ID,
  deployer: wallet.address,
  collection: getAddress(coreCheckpoint.collection),
  energyBank: getAddress(coreCheckpoint.energyBank),
  renderer: getAddress(artCheckpoint.renderer),
  rules: getAddress(rerollCheckpoint.rules),
  controller: getAddress(rerollCheckpoint.controller),
  resultSigner: getAddress(gates.resultSigner),
  relayer: getAddress(gates.relayer),
  provenanceHash: launchManifest.payloads.assignments.provenanceHash,
  revealCommitment,
  gtdMerkleRoot: launchManifest.payloads.gtd.merkleRoot,
  mintEnergyReward: config.reroll.mintEnergy.rewardPerPaidToken,
})) {
  const actual = typeof expected === "string" && expected.length === 42
    ? getAddress(checkpoint[key])
    : checkpoint[key];
  if (actual !== expected) throw new Error(`Finalization checkpoint has a different ${key}.`);
}

const configuredController = getAddress(await collection.rerollController());
if (configuredController !== ZeroAddress && configuredController !== getAddress(rerollCheckpoint.controller)) {
  throw new Error("Collection already points to a different reroll controller.");
}
if (configuredController === ZeroAddress) {
  await recordTransaction(
    checkpoint,
    checkpointPath,
    "set-reroll-controller",
    await collection.setRerollController(rerollCheckpoint.controller),
  );
}
if (!await collection.rerollControllerFrozen()) {
  await recordTransaction(
    checkpoint,
    checkpointPath,
    "freeze-reroll-controller",
    await collection.freezeRerollController(),
  );
}

const spenderRole = await energyBank.SPENDER_ROLE();
if (!await energyBank.hasRole(spenderRole, rerollCheckpoint.controller)) {
  await recordTransaction(
    checkpoint,
    checkpointPath,
    "grant-controller-spender-role",
    await energyBank.grantRole(spenderRole, rerollCheckpoint.controller),
  );
}

const creditRole = await energyBank.CREDIT_ROLE();
if (!await energyBank.hasRole(creditRole, coreCheckpoint.collection)) {
  await recordTransaction(
    checkpoint,
    checkpointPath,
    "grant-collection-mint-energy-credit-role",
    await energyBank.grantRole(creditRole, coreCheckpoint.collection),
  );
}
const configuredEnergyBank = getAddress(await collection.energyBank());
if (configuredEnergyBank !== ZeroAddress && configuredEnergyBank !== getAddress(coreCheckpoint.energyBank)) {
  throw new Error("Collection already points to a different mint-reward Energy Bank.");
}
if (configuredEnergyBank === ZeroAddress) {
  await recordTransaction(
    checkpoint,
    checkpointPath,
    "set-mint-energy-configuration",
    await collection.setEnergyConfiguration(
      coreCheckpoint.energyBank,
      config.reroll.mintEnergy.rewardPerPaidToken,
    ),
  );
}
if (Number(await collection.mintEnergyReward()) !== config.reroll.mintEnergy.rewardPerPaidToken) {
  throw new Error("Collection paid-mint Energy reward differs from launch configuration.");
}
if (!await collection.energyConfigurationFrozen()) {
  await recordTransaction(
    checkpoint,
    checkpointPath,
    "freeze-mint-energy-configuration",
    await collection.freezeEnergyConfiguration(),
  );
}

if (!await collection.initialTraitsFrozen()) {
  for (let offset = 0; offset < config.maxSupply; offset += assignmentBatchSize) {
    const end = Math.min(offset + assignmentBatchSize, config.maxSupply);
    const label = `assignments-${offset + 1}-${end}`;
    const prior = checkpoint.assignmentBatches.find((batch) => batch.label === label);
    if (prior) {
      const receipt = await provider.getTransactionReceipt(prior.hash);
      if (receipt?.status === 1) {
        console.log(`verified ${label}`);
        continue;
      }
      checkpoint.assignmentBatches = checkpoint.assignmentBatches
        .filter((batch) => batch.label !== label);
    }

    const assignmentIds = [];
    const packedTraits = [];
    for (let assignmentId = offset + 1; assignmentId <= end; assignmentId += 1) {
      assignmentIds.push(assignmentId);
      packedTraits.push(packedAssignment(assignmentId));
    }
    const receipt = await (
      await collection.setInitialTraitsBatch(assignmentIds, packedTraits)
    ).wait();
    const record = { label, hash: receipt.hash, blockNumber: receipt.blockNumber };
    checkpoint.assignmentBatches.push(record);
    checkpoint.transactions.push(record);
    saveCheckpoint(checkpointPath, checkpoint);
    console.log(`loaded ${label}`);
  }

  if (Number(await collection.initialTraitsAssigned()) !== config.maxSupply) {
    throw new Error("Collection does not contain all 3,333 initial assignments.");
  }
  await recordTransaction(
    checkpoint,
    checkpointPath,
    "freeze-initial-traits",
    await collection.freezeInitialTraits(
      launchManifest.payloads.assignments.provenanceHash,
      revealCommitment,
    ),
  );
}
if (
  (await collection.provenanceHash()).toLowerCase()
    !== launchManifest.payloads.assignments.provenanceHash.toLowerCase()
  || (await collection.revealCommitment()).toLowerCase()
    !== revealCommitment.toLowerCase()
) {
  throw new Error("Frozen assignment provenance or reveal commitment differs.");
}

if (!await collection.rendererFrozen()) {
  await recordTransaction(
    checkpoint,
    checkpointPath,
    "freeze-renderer",
    await collection.freezeRenderer(),
  );
}
if ((await collection.gtdMerkleRoot()).toLowerCase()
  !== launchManifest.payloads.gtd.merkleRoot.toLowerCase()) {
  await recordTransaction(
    checkpoint,
    checkpointPath,
    "set-gtd-merkle-root",
    await collection.setGTDMerkleRoot(launchManifest.payloads.gtd.merkleRoot),
  );
}

const finalChecks = {
  assignments: Number(await collection.initialTraitsAssigned()),
  indahoodBackgrounds: Number(await collection.indahoodBackgroundsAssigned()),
  initialTraitsFrozen: await collection.initialTraitsFrozen(),
  rendererFrozen: await collection.rendererFrozen(),
  rerollControllerFrozen: await collection.rerollControllerFrozen(),
  controllerCanSpendEnergy: await energyBank.hasRole(spenderRole, rerollCheckpoint.controller),
  collectionCanCreditMintEnergy: await energyBank.hasRole(
    creditRole,
    coreCheckpoint.collection,
  ),
  energyConfigurationFrozen: await collection.energyConfigurationFrozen(),
  mintEnergyBank: await collection.energyBank(),
  mintEnergyReward: Number(await collection.mintEnergyReward()),
  gtdMerkleRoot: await collection.gtdMerkleRoot(),
  gtdSaleActive: await collection.gtdSaleActive(),
  publicSaleActive: await collection.publicSaleActive(),
  totalSupply: Number(await collection.totalSupply()),
  ownerReserveMinted: await collection.ownerReserveMinted(),
  secondaryTradingEnabled: await collection.secondaryTradingEnabled(),
};
if (
  finalChecks.assignments !== config.maxSupply
  || finalChecks.indahoodBackgrounds !== 3_323
  || !finalChecks.initialTraitsFrozen
  || !finalChecks.rendererFrozen
  || !finalChecks.rerollControllerFrozen
  || !finalChecks.controllerCanSpendEnergy
  || !finalChecks.collectionCanCreditMintEnergy
  || !finalChecks.energyConfigurationFrozen
  || getAddress(finalChecks.mintEnergyBank) !== getAddress(coreCheckpoint.energyBank)
  || finalChecks.mintEnergyReward !== config.reroll.mintEnergy.rewardPerPaidToken
  || finalChecks.gtdMerkleRoot.toLowerCase()
    !== launchManifest.payloads.gtd.merkleRoot.toLowerCase()
  || finalChecks.gtdSaleActive
  || finalChecks.publicSaleActive
  || finalChecks.totalSupply !== 0
  || finalChecks.ownerReserveMinted
  || finalChecks.secondaryTradingEnabled
) throw new Error("Final launch-state verification failed.");

checkpoint.status = "staged-sale-closed";
checkpoint.completedAtBlock = await provider.getBlockNumber();
saveCheckpoint(checkpointPath, checkpoint);

console.log(JSON.stringify({
  mode: "executed",
  chainId: HOODYOOR_CHAIN_ID,
  status: checkpoint.status,
  collection: checkpoint.collection,
  finalChecks,
  checkpoint: path.relative(projectRoot, checkpointPath),
  nextStep: "Verify the contract on the explorer and publish OpenSea branding before separately opening GTD.",
}, null, 2));
