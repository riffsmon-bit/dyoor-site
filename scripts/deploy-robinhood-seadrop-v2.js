import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Contract,
  ContractFactory,
  JsonRpcProvider,
  Wallet,
  ZeroAddress,
  ZeroHash,
  getAddress,
  keccak256,
  toUtf8Bytes,
} from "ethers";
import {
  HOODYOOR_CHAIN_ID,
  artifactBytecode,
  loadHoodyoorLocalEnvironment,
  normalizePrivateKey,
  readJson,
  requireContract,
  saveCheckpoint,
} from "./lib/hoodyoor-mainnet.js";
import {
  HOODYOOR_ENERGY_BANK,
  HOODYOOR_LEGACY_COLLECTION,
  HOODYOOR_LEGACY_REROLL_CONTROLLER,
  HOODYOOR_PACKED_TRAIT_STORE,
  HOODYOOR_PIXEL_RENDERER,
  HOODYOOR_SEADROP,
  HOODYOOR_SEADROP_V2_CHECKPOINT_PATH,
  HOODYOOR_SEADROP_V2_MANIFEST_PATH,
  HOODYOOR_TRAIT_RULES,
  HOODYOOR_USDG,
  assertSeaDropV2BroadcastSafety,
  seaDropV2GateReport,
  verifySeaDropV2ManifestLocal,
} from "./lib/hoodyoor-seadrop-v2.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadHoodyoorLocalEnvironment(projectRoot);
const execute = process.env.EXECUTE_HOODYOOR_SEADROP_V2_DEPLOYMENT === "1";
const config = readJson(path.join(
  projectRoot,
  "data",
  "robinhood",
  "dyoor-collection-config.json",
));
const manifest = readJson(path.join(projectRoot, HOODYOOR_SEADROP_V2_MANIFEST_PATH));
const assignmentManifest = readJson(path.join(
  projectRoot,
  "data",
  "robinhood",
  "onchain-128",
  "hoodyoor-initial-assignments.json",
));
const assignmentBytes = fs.readFileSync(path.join(
  projectRoot,
  "data",
  "robinhood",
  "onchain-128",
  "hoodyoor-initial-assignments.bin",
));
const artifactRoot = path.join(projectRoot, "contracts", "hoodyoor", "out");
const collectionArtifact = readJson(path.join(
  artifactRoot,
  "HoodYOORSeaDrop.sol",
  "HoodYOORSeaDrop.json",
));
const controllerArtifact = readJson(path.join(
  artifactRoot,
  "HoodYOORRerollControllerV2.sol",
  "HoodYOORRerollControllerV2.json",
));
const storeArtifact = readJson(path.join(
  artifactRoot,
  "HoodYOORPackedTraitStore.sol",
  "HoodYOORPackedTraitStore.json",
));
const rendererArtifact = readJson(path.join(
  artifactRoot,
  "HoodYOORPixelRenderer.sol",
  "HoodYOORPixelRenderer.json",
));
const energyArtifact = readJson(path.join(
  artifactRoot,
  "HoodYOOREnergyBank.sol",
  "HoodYOOREnergyBank.json",
));
const rulesArtifact = readJson(path.join(
  artifactRoot,
  "HoodYOORTraitRules.sol",
  "HoodYOORTraitRules.json",
));
const legacyCollectionArtifact = readJson(path.join(
  artifactRoot,
  "HoodYOOR.sol",
  "HoodYOOR.json",
));
const checkpointPath = path.join(projectRoot, HOODYOOR_SEADROP_V2_CHECKPOINT_PATH);
const assignmentBatchSize = 50;

const seaDropReadAbi = [
  "function getPublicDrop(address) view returns (tuple(uint80 mintPrice,uint48 startTime,uint48 endTime,uint16 maxTotalMintableByWallet,uint16 feeBps,bool restrictFeeRecipients))",
  "function getCreatorPayoutAddress(address) view returns (address)",
  "function getAllowListMerkleRoot(address) view returns (bytes32)",
];
const usdGAbi = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

function packedAssignment(assignmentId) {
  const start = (assignmentId - 1) * 18;
  return BigInt(`0x${assignmentBytes.subarray(start, start + 18).toString("hex")}`);
}

function sameAddress(left, right) {
  return getAddress(left) === getAddress(right);
}

async function recordTransaction(checkpoint, label, transaction) {
  const receipt = await transaction.wait();
  const record = { label, hash: receipt.hash, blockNumber: receipt.blockNumber };
  checkpoint.transactions.push(record);
  saveCheckpoint(checkpointPath, checkpoint);
  console.log(`confirmed ${label}: ${receipt.hash}`);
  return record;
}

function assertCheckpointValue(checkpoint, key, expected) {
  const actual = checkpoint[key];
  if (typeof expected === "string" && /^0x[0-9a-f]{40}$/i.test(expected)) {
    if (!actual || !sameAddress(actual, expected)) {
      throw new Error(`Existing SeaDrop v2 checkpoint has a different ${key}.`);
    }
    return;
  }
  if (actual !== expected) {
    throw new Error(`Existing SeaDrop v2 checkpoint has a different ${key}.`);
  }
}

function publicDropIsZero(drop) {
  return BigInt(drop.mintPrice) === 0n
    && BigInt(drop.startTime) === 0n
    && BigInt(drop.endTime) === 0n
    && BigInt(drop.maxTotalMintableByWallet) === 0n
    && BigInt(drop.feeBps) === 0n
    && drop.restrictFeeRecipients === false;
}

artifactBytecode(collectionArtifact);
artifactBytecode(controllerArtifact);
if (
  assignmentManifest.totals.assignments !== config.maxSupply
  || assignmentBytes.length !== config.maxSupply * 18
  || keccak256(assignmentBytes).toLowerCase()
    !== manifest.reusedPayloads.assignmentBinaryKeccak256.toLowerCase()
) throw new Error("Initial assignment payload differs from the SeaDrop v2 manifest.");
if (
  keccak256(toUtf8Bytes(manifest.metadata.contractURI)).toLowerCase()
  !== manifest.metadata.contractURIKeccak256.toLowerCase()
) throw new Error("Onchain collection metadata differs from the SeaDrop v2 manifest.");

const local = verifySeaDropV2ManifestLocal(projectRoot, manifest);
const gates = seaDropV2GateReport(config.owner, manifest);
if (!execute) {
  console.log(JSON.stringify({
    mode: "dry-run",
    chainId: HOODYOOR_CHAIN_ID,
    broadcastAttempted: false,
    localIntegrity: local.passed,
    sourceTreeKeccak256: manifest.sourceTree.canonicalKeccak256,
    canonicalSeaDrop: getAddress(HOODYOOR_SEADROP),
    canonicalUSDG: getAddress(HOODYOOR_USDG),
    rerollPayments: ["Energy", "ETH", "USDG"],
    rates: gates.pricing,
    blockers: [...new Set([
      ...gates.blockers,
      ...(!local.passed ? local.blockers.map((id) => `local:${id}`) : []),
    ])],
    stages: manifest.deploymentCeremony.orderedSteps,
    stagedEndState: manifest.deploymentCeremony.stagedEndState,
    executeWith:
      "EXECUTE_HOODYOOR_SEADROP_V2_DEPLOYMENT=1 npm run deploy:robinhood:seadrop-v2",
    note: "No transaction was sent. Execution remains blocked until every fresh v2 gate passes.",
  }, null, 2));
  process.exit(0);
}

const safety = assertSeaDropV2BroadcastSafety(config.owner, manifest, process.env, projectRoot);
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
if (!sameAddress(wallet.address, config.owner)) {
  throw new Error("Deployment wallet is not the configured collection owner and treasury.");
}

for (const [address, label] of [
  [HOODYOOR_SEADROP, "Canonical SeaDrop"],
  [HOODYOOR_USDG, "Canonical USDG"],
  [HOODYOOR_PACKED_TRAIT_STORE, "Packed trait store"],
  [HOODYOOR_PIXEL_RENDERER, "Pixel renderer"],
  [HOODYOOR_ENERGY_BANK, "Energy Bank"],
  [HOODYOOR_TRAIT_RULES, "Trait rules"],
  [HOODYOOR_LEGACY_COLLECTION, "Superseded collection"],
  [HOODYOOR_LEGACY_REROLL_CONTROLLER, "Superseded reroll controller"],
]) await requireContract(provider, address, label);

const store = new Contract(HOODYOOR_PACKED_TRAIT_STORE, storeArtifact.abi, wallet);
const renderer = new Contract(HOODYOOR_PIXEL_RENDERER, rendererArtifact.abi, wallet);
const energyBank = new Contract(HOODYOOR_ENERGY_BANK, energyArtifact.abi, wallet);
const rules = new Contract(HOODYOOR_TRAIT_RULES, rulesArtifact.abi, wallet);
const legacyCollection = new Contract(
  HOODYOOR_LEGACY_COLLECTION,
  legacyCollectionArtifact.abi,
  wallet,
);
const usdg = new Contract(HOODYOOR_USDG, usdGAbi, provider);
const seaDrop = new Contract(HOODYOOR_SEADROP, seaDropReadAbi, provider);
const [
  storeFrozen,
  catalogHash,
  rendererFrozen,
  rendererStore,
  energyOwner,
  energyPaused,
  rulesFrozen,
  rulesHash,
  legacySupply,
  legacyReserveMinted,
  legacyGTD,
  legacyPublic,
  legacySecondary,
  usdgName,
  usdgSymbol,
  usdgDecimals,
] = await Promise.all([
  store.frozen(),
  store.catalogHash(),
  renderer.isFrozen(),
  renderer.traitStore(),
  energyBank.owner(),
  energyBank.paused(),
  rules.frozen(),
  rules.rulesHash(),
  legacyCollection.totalSupply(),
  legacyCollection.ownerReserveMinted(),
  legacyCollection.gtdSaleActive(),
  legacyCollection.publicSaleActive(),
  legacyCollection.secondaryTradingEnabled(),
  usdg.name(),
  usdg.symbol(),
  usdg.decimals(),
]);
if (
  !storeFrozen
  || catalogHash.toLowerCase() !== manifest.reusedPayloads.artCatalogHash.toLowerCase()
  || !rendererFrozen
  || !sameAddress(rendererStore, HOODYOOR_PACKED_TRAIT_STORE)
  || !sameAddress(energyOwner, config.owner)
  || energyPaused
  || !rulesFrozen
  || rulesHash.toLowerCase() !== manifest.reusedPayloads.rulesHash.toLowerCase()
  || legacySupply !== 0n
  || legacyReserveMinted
  || legacyGTD
  || legacyPublic
  || legacySecondary
  || usdgName !== "Global Dollar"
  || usdgSymbol !== "USDG"
  || Number(usdgDecimals) !== 6
) throw new Error("A canonical, reused, or superseded contract failed pre-deployment checks.");

const checkpoint = fs.existsSync(checkpointPath) ? readJson(checkpointPath) : {
  schema: "dyoor-hoodyoor-seadrop-v2-deployment-v1",
  chainId: HOODYOOR_CHAIN_ID,
  deployer: getAddress(wallet.address),
  ownerTreasury: getAddress(config.owner),
  sourceTree: manifest.sourceTree.canonicalKeccak256,
  seaDrop: getAddress(HOODYOOR_SEADROP),
  usdg: getAddress(HOODYOOR_USDG),
  store: getAddress(HOODYOOR_PACKED_TRAIT_STORE),
  renderer: getAddress(HOODYOOR_PIXEL_RENDERER),
  energyBank: getAddress(HOODYOOR_ENERGY_BANK),
  rules: getAddress(HOODYOOR_TRAIT_RULES),
  supersededCollection: getAddress(HOODYOOR_LEGACY_COLLECTION),
  supersededController: getAddress(HOODYOOR_LEGACY_REROLL_CONTROLLER),
  resultSigner: getAddress(safety.resultSigner),
  relayer: getAddress(safety.relayer),
  provenanceHash: manifest.reusedPayloads.assignmentProvenanceHash,
  revealCommitment: process.env.HOODYOOR_REVEAL_COMMITMENT,
  contractURIKeccak256: manifest.metadata.contractURIKeccak256,
  weiPerEnergy: safety.pricing.weiPerEnergy,
  usdgUnitsPerEnergy: safety.pricing.usdgUnitsPerEnergy,
  collection: "",
  controller: "",
  assignmentBatches: [],
  transactions: [],
  status: "in-progress",
};
for (const [key, expected] of Object.entries({
  schema: "dyoor-hoodyoor-seadrop-v2-deployment-v1",
  chainId: HOODYOOR_CHAIN_ID,
  deployer: getAddress(wallet.address),
  ownerTreasury: getAddress(config.owner),
  sourceTree: manifest.sourceTree.canonicalKeccak256,
  seaDrop: getAddress(HOODYOOR_SEADROP),
  usdg: getAddress(HOODYOOR_USDG),
  store: getAddress(HOODYOOR_PACKED_TRAIT_STORE),
  renderer: getAddress(HOODYOOR_PIXEL_RENDERER),
  energyBank: getAddress(HOODYOOR_ENERGY_BANK),
  rules: getAddress(HOODYOOR_TRAIT_RULES),
  supersededCollection: getAddress(HOODYOOR_LEGACY_COLLECTION),
  supersededController: getAddress(HOODYOOR_LEGACY_REROLL_CONTROLLER),
  resultSigner: getAddress(safety.resultSigner),
  relayer: getAddress(safety.relayer),
  provenanceHash: manifest.reusedPayloads.assignmentProvenanceHash,
  revealCommitment: process.env.HOODYOOR_REVEAL_COMMITMENT,
  contractURIKeccak256: manifest.metadata.contractURIKeccak256,
  weiPerEnergy: safety.pricing.weiPerEnergy,
  usdgUnitsPerEnergy: safety.pricing.usdgUnitsPerEnergy,
})) assertCheckpointValue(checkpoint, key, expected);
if (!Array.isArray(checkpoint.assignmentBatches) || !Array.isArray(checkpoint.transactions)) {
  throw new Error("SeaDrop v2 checkpoint has invalid transaction records.");
}
saveCheckpoint(checkpointPath, checkpoint);

let collection;
if (checkpoint.collection) {
  await requireContract(provider, checkpoint.collection, "Replacement HoodYØØR collection");
  collection = new Contract(checkpoint.collection, collectionArtifact.abi, wallet);
} else {
  const factory = new ContractFactory(
    collectionArtifact.abi,
    artifactBytecode(collectionArtifact),
    wallet,
  );
  collection = await factory.deploy(
    wallet.address,
    config.treasury,
    HOODYOOR_PIXEL_RENDERER,
    [HOODYOOR_SEADROP],
  );
  await collection.waitForDeployment();
  const receipt = await collection.deploymentTransaction().wait();
  checkpoint.collection = getAddress(await collection.getAddress());
  checkpoint.transactions.push({
    label: "deploy-replacement-collection",
    hash: receipt.hash,
    blockNumber: receipt.blockNumber,
  });
  saveCheckpoint(checkpointPath, checkpoint);
  console.log(`deployed replacement HoodYØØR collection ${checkpoint.collection}`);
}
if (
  !sameAddress(await collection.owner(), wallet.address)
  || !sameAddress(await collection.treasury(), config.treasury)
  || !sameAddress(await collection.renderer(), HOODYOOR_PIXEL_RENDERER)
  || Number(await collection.MAX_SUPPLY()) !== config.maxSupply
  || Number(await collection.OWNER_RESERVE_ALLOCATION()) !== config.ownerReserve.allocation
  || Number(await collection.SECONDARY_TRADING_AUTO_UNLOCK_SUPPLY())
    !== config.secondaryTrading.autoUnlockMintedSupply
) throw new Error("Replacement collection constructor configuration is inconsistent.");
const allowedSeaDrop = await collection.allowedSeaDrop();
if (allowedSeaDrop.length !== 1 || !sameAddress(allowedSeaDrop[0], HOODYOOR_SEADROP)) {
  throw new Error("Replacement collection does not allow exactly canonical SeaDrop.");
}

let controller;
if (checkpoint.controller) {
  await requireContract(provider, checkpoint.controller, "Replacement reroll controller");
  controller = new Contract(checkpoint.controller, controllerArtifact.abi, wallet);
} else {
  const factory = new ContractFactory(
    controllerArtifact.abi,
    artifactBytecode(controllerArtifact),
    wallet,
  );
  controller = await factory.deploy(
    wallet.address,
    checkpoint.collection,
    HOODYOOR_ENERGY_BANK,
    HOODYOOR_TRAIT_RULES,
    safety.resultSigner,
    HOODYOOR_USDG,
    config.treasury,
  );
  await controller.waitForDeployment();
  const receipt = await controller.deploymentTransaction().wait();
  checkpoint.controller = getAddress(await controller.getAddress());
  checkpoint.transactions.push({
    label: "deploy-reroll-controller-v2",
    hash: receipt.hash,
    blockNumber: receipt.blockNumber,
  });
  saveCheckpoint(checkpointPath, checkpoint);
  console.log(`deployed HoodYØØR reroll controller v2 ${checkpoint.controller}`);
}
for (const [getter, expected] of [
  ["owner", wallet.address],
  ["collection", checkpoint.collection],
  ["energyBank", HOODYOOR_ENERGY_BANK],
  ["traitRules", HOODYOOR_TRAIT_RULES],
  ["resultSigner", safety.resultSigner],
  ["usdg", HOODYOOR_USDG],
  ["treasury", config.treasury],
]) {
  if (!sameAddress(await controller[getter](), expected)) {
    throw new Error(`Replacement controller ${getter} is inconsistent.`);
  }
}
if (!await controller.paymentConfigurationFrozen()) {
  const currentWeiRate = await controller.weiPerEnergy();
  const currentUSDGRate = await controller.usdgUnitsPerEnergy();
  if (currentWeiRate === 0n && currentUSDGRate === 0n) {
    await recordTransaction(
      checkpoint,
      "set-exact-reroll-payment-rates",
      await controller.setPaymentRates(
        safety.pricing.weiPerEnergy,
        safety.pricing.usdgUnitsPerEnergy,
      ),
    );
  } else if (
    currentWeiRate.toString() !== safety.pricing.weiPerEnergy
    || currentUSDGRate.toString() !== safety.pricing.usdgUnitsPerEnergy
  ) throw new Error("Unfrozen controller already contains different reroll rates.");
  await recordTransaction(
    checkpoint,
    "freeze-reroll-payment-rates",
    await controller.freezePaymentConfiguration(),
  );
}
if (
  (await controller.weiPerEnergy()).toString() !== safety.pricing.weiPerEnergy
  || (await controller.usdgUnitsPerEnergy()).toString() !== safety.pricing.usdgUnitsPerEnergy
) throw new Error("Frozen controller reroll prices differ from the approved checkpoint.");

const configuredController = await collection.rerollController();
if (configuredController !== ZeroAddress && !sameAddress(configuredController, checkpoint.controller)) {
  throw new Error("Replacement collection already points to a different reroll controller.");
}
if (configuredController === ZeroAddress) {
  await recordTransaction(
    checkpoint,
    "set-reroll-controller-v2",
    await collection.setRerollController(checkpoint.controller),
  );
}
if (!await collection.rerollControllerFrozen()) {
  await recordTransaction(
    checkpoint,
    "freeze-reroll-controller-v2",
    await collection.freezeRerollController(),
  );
}

const creditRole = await energyBank.CREDIT_ROLE();
const spenderRole = await energyBank.SPENDER_ROLE();
if (!await energyBank.hasRole(creditRole, checkpoint.collection)) {
  await recordTransaction(
    checkpoint,
    "grant-replacement-collection-credit-role",
    await energyBank.grantRole(creditRole, checkpoint.collection),
  );
}
if (!await energyBank.hasRole(spenderRole, checkpoint.controller)) {
  await recordTransaction(
    checkpoint,
    "grant-replacement-controller-spender-role",
    await energyBank.grantRole(spenderRole, checkpoint.controller),
  );
}

const configuredEnergy = await collection.energyBank();
if (configuredEnergy !== ZeroAddress && !sameAddress(configuredEnergy, HOODYOOR_ENERGY_BANK)) {
  throw new Error("Replacement collection already points to a different Energy Bank.");
}
if (configuredEnergy === ZeroAddress) {
  await recordTransaction(
    checkpoint,
    "set-paid-mint-energy-reward",
    await collection.setEnergyConfiguration(
      HOODYOOR_ENERGY_BANK,
      config.reroll.mintEnergy.rewardPerPaidToken,
    ),
  );
}
if (Number(await collection.mintEnergyReward()) !== config.reroll.mintEnergy.rewardPerPaidToken) {
  throw new Error("Replacement collection has an unexpected paid-mint Energy reward.");
}
if (!await collection.energyConfigurationFrozen()) {
  await recordTransaction(
    checkpoint,
    "freeze-paid-mint-energy-reward",
    await collection.freezeEnergyConfiguration(),
  );
}

if (!await collection.initialTraitsFrozen()) {
  for (let offset = 0; offset < config.maxSupply; offset += assignmentBatchSize) {
    const end = Math.min(offset + assignmentBatchSize, config.maxSupply);
    const label = `assignments-${offset + 1}-${end}`;
    const existing = checkpoint.assignmentBatches.find((batch) => batch.label === label);
    if (existing?.hash) {
      const receipt = await provider.getTransactionReceipt(existing.hash);
      if (receipt?.status !== 1) {
        throw new Error(`Previously recorded ${label} transaction is not canonical and successful.`);
      }
      console.log(`verified ${label}`);
      continue;
    }
    if (existing?.recovered) {
      console.log(`verified recovered ${label}`);
      continue;
    }

    const candidateIds = Array.from(
      { length: end - offset },
      (_, index) => offset + index + 1,
    );
    const initialized = await Promise.all(
      candidateIds.map((tokenId) => collection.traitsInitialized(tokenId)),
    );
    const tokenIds = [];
    const packedTraits = [];
    for (let index = 0; index < candidateIds.length; index += 1) {
      if (initialized[index]) continue;
      tokenIds.push(candidateIds[index]);
      packedTraits.push(packedAssignment(candidateIds[index]));
    }
    if (tokenIds.length === 0) {
      checkpoint.assignmentBatches.push({ label, recovered: true });
      saveCheckpoint(checkpointPath, checkpoint);
      console.log(`recovered ${label}`);
      continue;
    }
    const receipt = await (
      await collection.setInitialTraitsBatch(tokenIds, packedTraits)
    ).wait();
    const record = {
      label,
      hash: receipt.hash,
      blockNumber: receipt.blockNumber,
      count: tokenIds.length,
    };
    checkpoint.assignmentBatches.push(record);
    checkpoint.transactions.push(record);
    saveCheckpoint(checkpointPath, checkpoint);
    console.log(`loaded ${label}`);
  }
  if (Number(await collection.initialTraitsAssigned()) !== config.maxSupply) {
    throw new Error("Replacement collection does not contain all 3,333 assignments.");
  }
  await recordTransaction(
    checkpoint,
    "freeze-initial-traits-and-reveal-commitment",
    await collection.freezeInitialTraits(
      manifest.reusedPayloads.assignmentProvenanceHash,
      process.env.HOODYOOR_REVEAL_COMMITMENT,
    ),
  );
}
if (
  (await collection.provenanceHash()).toLowerCase()
    !== manifest.reusedPayloads.assignmentProvenanceHash.toLowerCase()
  || (await collection.revealCommitment()).toLowerCase()
    !== process.env.HOODYOOR_REVEAL_COMMITMENT.toLowerCase()
) throw new Error("Replacement assignment provenance or reveal commitment is inconsistent.");

if (!await collection.rendererFrozen()) {
  await recordTransaction(checkpoint, "freeze-renderer", await collection.freezeRenderer());
}
const currentContractURI = await collection.contractURI();
if (currentContractURI && currentContractURI !== manifest.metadata.contractURI) {
  throw new Error("Replacement collection already contains different contract metadata.");
}
if (!currentContractURI) {
  await recordTransaction(
    checkpoint,
    "set-fully-onchain-contract-metadata",
    await collection.setContractURI(manifest.metadata.contractURI),
  );
}
if (!await collection.contractMetadataFrozen()) {
  await recordTransaction(
    checkpoint,
    "freeze-fully-onchain-contract-metadata",
    await collection.freezeContractMetadata(),
  );
}
if (!await collection.allowedSeaDropFrozen()) {
  await recordTransaction(
    checkpoint,
    "freeze-canonical-seadrop",
    await collection.freezeAllowedSeaDrop(),
  );
}

const creatorPayout = await seaDrop.getCreatorPayoutAddress(checkpoint.collection);
if (creatorPayout !== ZeroAddress && !sameAddress(creatorPayout, config.treasury)) {
  throw new Error("SeaDrop already contains a different creator payout address.");
}
if (creatorPayout === ZeroAddress) {
  await recordTransaction(
    checkpoint,
    "set-seadrop-creator-payout",
    await collection.updateCreatorPayoutAddress(HOODYOOR_SEADROP, config.treasury),
  );
}

async function launchState() {
  const [
    publicDrop,
    allowListRoot,
    payout,
    totalSupply,
    ownerReserveMinted,
    secondaryTradingEnabled,
    initialTraitsAssigned,
    indahoodBackgroundsAssigned,
    initialTraitsFrozen,
    rendererIsFrozen,
    energyIsFrozen,
    rerollIsFrozen,
    seaDropIsFrozen,
    metadataIsFrozen,
    paymentIsFrozen,
    newCredit,
    newSpend,
    oldCredit,
    oldSpend,
  ] = await Promise.all([
    seaDrop.getPublicDrop(checkpoint.collection),
    seaDrop.getAllowListMerkleRoot(checkpoint.collection),
    seaDrop.getCreatorPayoutAddress(checkpoint.collection),
    collection.totalSupply(),
    collection.ownerReserveMinted(),
    collection.secondaryTradingEnabled(),
    collection.initialTraitsAssigned(),
    collection.indahoodBackgroundsAssigned(),
    collection.initialTraitsFrozen(),
    collection.rendererFrozen(),
    collection.energyConfigurationFrozen(),
    collection.rerollControllerFrozen(),
    collection.allowedSeaDropFrozen(),
    collection.contractMetadataFrozen(),
    controller.paymentConfigurationFrozen(),
    energyBank.hasRole(creditRole, checkpoint.collection),
    energyBank.hasRole(spenderRole, checkpoint.controller),
    energyBank.hasRole(creditRole, HOODYOOR_LEGACY_COLLECTION),
    energyBank.hasRole(spenderRole, HOODYOOR_LEGACY_REROLL_CONTROLLER),
  ]);
  return {
    publicDrop,
    allowListRoot,
    payout,
    totalSupply,
    ownerReserveMinted,
    secondaryTradingEnabled,
    initialTraitsAssigned,
    indahoodBackgroundsAssigned,
    initialTraitsFrozen,
    rendererIsFrozen,
    energyIsFrozen,
    rerollIsFrozen,
    seaDropIsFrozen,
    metadataIsFrozen,
    paymentIsFrozen,
    newCredit,
    newSpend,
    oldCredit,
    oldSpend,
  };
}

const beforeRoleMigration = await launchState();
if (
  !publicDropIsZero(beforeRoleMigration.publicDrop)
  || beforeRoleMigration.allowListRoot !== ZeroHash
  || !sameAddress(beforeRoleMigration.payout, config.treasury)
  || beforeRoleMigration.totalSupply !== 0n
  || beforeRoleMigration.ownerReserveMinted
  || beforeRoleMigration.secondaryTradingEnabled
  || Number(beforeRoleMigration.initialTraitsAssigned) !== config.maxSupply
  || Number(beforeRoleMigration.indahoodBackgroundsAssigned) !== 3_323
  || !beforeRoleMigration.initialTraitsFrozen
  || !beforeRoleMigration.rendererIsFrozen
  || !beforeRoleMigration.energyIsFrozen
  || !beforeRoleMigration.rerollIsFrozen
  || !beforeRoleMigration.seaDropIsFrozen
  || !beforeRoleMigration.metadataIsFrozen
  || !beforeRoleMigration.paymentIsFrozen
  || !beforeRoleMigration.newCredit
  || !beforeRoleMigration.newSpend
) throw new Error("Replacement launch graph failed final checks before role migration.");

checkpoint.status = "replacement-verified-before-role-migration";
saveCheckpoint(checkpointPath, checkpoint);
if (beforeRoleMigration.oldCredit) {
  await recordTransaction(
    checkpoint,
    "revoke-superseded-collection-credit-role",
    await energyBank.revokeRole(creditRole, HOODYOOR_LEGACY_COLLECTION),
  );
}
if (beforeRoleMigration.oldSpend) {
  await recordTransaction(
    checkpoint,
    "revoke-superseded-controller-spender-role",
    await energyBank.revokeRole(spenderRole, HOODYOOR_LEGACY_REROLL_CONTROLLER),
  );
}

const finalState = await launchState();
if (
  !publicDropIsZero(finalState.publicDrop)
  || finalState.allowListRoot !== ZeroHash
  || finalState.totalSupply !== 0n
  || finalState.ownerReserveMinted
  || finalState.secondaryTradingEnabled
  || !finalState.newCredit
  || !finalState.newSpend
  || finalState.oldCredit
  || finalState.oldSpend
) throw new Error("SeaDrop v2 staged state or Energy role migration is incomplete.");

checkpoint.status = "staged-sale-closed";
checkpoint.completedAtBlock = await provider.getBlockNumber();
checkpoint.finalState = {
  totalSupply: Number(finalState.totalSupply),
  ownerReserveMinted: finalState.ownerReserveMinted,
  secondaryTradingEnabled: finalState.secondaryTradingEnabled,
  publicDropConfigured: !publicDropIsZero(finalState.publicDrop),
  allowListRoot: finalState.allowListRoot,
  creatorPayout: getAddress(finalState.payout),
  replacementCollectionCreditRole: finalState.newCredit,
  replacementControllerSpenderRole: finalState.newSpend,
  supersededCollectionCreditRole: finalState.oldCredit,
  supersededControllerSpenderRole: finalState.oldSpend,
};
saveCheckpoint(checkpointPath, checkpoint);

console.log(JSON.stringify({
  mode: "executed",
  chainId: HOODYOOR_CHAIN_ID,
  status: checkpoint.status,
  collection: checkpoint.collection,
  controller: checkpoint.controller,
  energyBank: checkpoint.energyBank,
  seaDrop: checkpoint.seaDrop,
  usdg: checkpoint.usdg,
  rerollRates: {
    weiPerEnergy: checkpoint.weiPerEnergy,
    usdgUnitsPerEnergy: checkpoint.usdgUnitsPerEnergy,
    frozen: true,
  },
  finalState: checkpoint.finalState,
  checkpoint: path.relative(projectRoot, checkpointPath),
  nextSteps: [
    "Verify the two replacement contracts on the Robinhood explorer.",
    "Point the Trait Lab server and browser configuration at the replacement addresses, but keep rerolls disabled until reveal.",
    "Choose the GTD schedule and generate a new SeaDrop-specific allowlist root from the frozen wallet list and exact MintParams.",
    "In a separate owner transaction, mint the 150 reserve before activating any SeaDrop stage.",
  ],
}, null, 2));
