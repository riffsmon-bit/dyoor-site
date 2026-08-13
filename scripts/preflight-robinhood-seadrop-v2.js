import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Contract,
  JsonRpcProvider,
  ZeroHash,
  formatEther,
  formatUnits,
  getAddress,
  keccak256,
  toUtf8Bytes,
} from "ethers";
import {
  HOODYOOR_CHAIN_ID,
  readJson,
  verifyFrozenEnergyMigrationLedger,
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
  seaDropV2GateReport,
  verifySeaDropV2ManifestLocal,
} from "./lib/hoodyoor-seadrop-v2.js";
import { assertReadOnlyReleaseEnvironment } from "./lib/release-safety.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
assertReadOnlyReleaseEnvironment();
const offline = process.env.HOODYOOR_PREFLIGHT_OFFLINE === "1";
const strict = process.env.REQUIRE_HOODYOOR_SEADROP_V2_READY === "1";
const config = readJson(path.join(
  projectRoot,
  "data",
  "robinhood",
  "dyoor-collection-config.json",
));
const manifest = readJson(path.join(projectRoot, HOODYOOR_SEADROP_V2_MANIFEST_PATH));
const checkpointPath = path.join(projectRoot, HOODYOOR_SEADROP_V2_CHECKPOINT_PATH);
const checkpoint = fs.existsSync(checkpointPath) ? readJson(checkpointPath) : null;

const storeAbi = [
  "function frozen() view returns (bool)",
  "function catalogHash() view returns (bytes32)",
];
const rendererAbi = [
  "function isFrozen() view returns (bool)",
  "function traitStore() view returns (address)",
];
const energyAbi = [
  "function owner() view returns (address)",
  "function paused() view returns (bool)",
  "function CREDIT_ROLE() view returns (bytes32)",
  "function SPENDER_ROLE() view returns (bytes32)",
  "function hasRole(bytes32,address) view returns (bool)",
];
const rulesAbi = [
  "function frozen() view returns (bool)",
  "function rulesHash() view returns (bytes32)",
];
const legacyCollectionAbi = [
  "function totalSupply() view returns (uint256)",
  "function ownerReserveMinted() view returns (bool)",
  "function gtdSaleActive() view returns (bool)",
  "function publicSaleActive() view returns (bool)",
  "function secondaryTradingEnabled() view returns (bool)",
];
const usdGAbi = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];
const seaDropReadAbi = [
  "function getPublicDrop(address) view returns (tuple(uint80 mintPrice,uint48 startTime,uint48 endTime,uint16 maxTotalMintableByWallet,uint16 feeBps,bool restrictFeeRecipients))",
  "function getCreatorPayoutAddress(address) view returns (address)",
  "function getAllowListMerkleRoot(address) view returns (bytes32)",
];

function priceExamples(gates) {
  if (!gates.pricing.weiPerEnergy || !gates.pricing.usdgUnitsPerEnergy) return null;
  const weiRate = BigInt(gates.pricing.weiPerEnergy);
  const usdGRate = BigInt(gates.pricing.usdgUnitsPerEnergy);
  return Object.fromEntries([100n, 200n, 300n, 1_000n].map((energy) => [
    energy.toString(),
    {
      energy: energy.toString(),
      ethWei: (energy * weiRate).toString(),
      eth: formatEther(energy * weiRate),
      usdgUnits: (energy * usdGRate).toString(),
      usdg: formatUnits(energy * usdGRate, 6),
    },
  ]));
}

async function inspectStaged(provider, energyBank) {
  if (!checkpoint) return { status: "not-deployed", checkpoint: null };
  if (
    checkpoint.schema !== "dyoor-hoodyoor-seadrop-v2-deployment-v1"
    || checkpoint.chainId !== HOODYOOR_CHAIN_ID
  ) return { status: "invalid-checkpoint", checkpoint: path.relative(projectRoot, checkpointPath) };
  if (!checkpoint.collection || !checkpoint.controller) {
    return {
      status: "in-progress",
      checkpoint: path.relative(projectRoot, checkpointPath),
      collection: checkpoint.collection || null,
      controller: checkpoint.controller || null,
    };
  }

  const collectionArtifact = readJson(path.join(
    projectRoot,
    "contracts",
    "hoodyoor",
    "out",
    "HoodYOORSeaDrop.sol",
    "HoodYOORSeaDrop.json",
  ));
  const controllerArtifact = readJson(path.join(
    projectRoot,
    "contracts",
    "hoodyoor",
    "out",
    "HoodYOORRerollControllerV2.sol",
    "HoodYOORRerollControllerV2.json",
  ));
  const collection = new Contract(checkpoint.collection, collectionArtifact.abi, provider);
  const controller = new Contract(checkpoint.controller, controllerArtifact.abi, provider);
  const seaDrop = new Contract(HOODYOOR_SEADROP, seaDropReadAbi, provider);
  const [
    collectionCode,
    controllerCode,
    owner,
    treasury,
    renderer,
    configuredEnergy,
    rerollController,
    totalSupply,
    ownerReserveMinted,
    secondaryTradingEnabled,
    rendererFrozen,
    energyConfigurationFrozen,
    rerollControllerFrozen,
    initialTraitsFrozen,
    allowedSeaDropFrozen,
    contractMetadataFrozen,
    paymentConfigurationFrozen,
    weiPerEnergy,
    usdgUnitsPerEnergy,
    controllerUSDG,
    controllerTreasury,
    creatorPayout,
    publicDrop,
    allowListRoot,
    creditRole,
    spenderRole,
  ] = await Promise.all([
    provider.getCode(checkpoint.collection),
    provider.getCode(checkpoint.controller),
    collection.owner(),
    collection.treasury(),
    collection.renderer(),
    collection.energyBank(),
    collection.rerollController(),
    collection.totalSupply(),
    collection.ownerReserveMinted(),
    collection.secondaryTradingEnabled(),
    collection.rendererFrozen(),
    collection.energyConfigurationFrozen(),
    collection.rerollControllerFrozen(),
    collection.initialTraitsFrozen(),
    collection.allowedSeaDropFrozen(),
    collection.contractMetadataFrozen(),
    controller.paymentConfigurationFrozen(),
    controller.weiPerEnergy(),
    controller.usdgUnitsPerEnergy(),
    controller.usdg(),
    controller.treasury(),
    seaDrop.getCreatorPayoutAddress(checkpoint.collection),
    seaDrop.getPublicDrop(checkpoint.collection),
    seaDrop.getAllowListMerkleRoot(checkpoint.collection),
    energyBank.CREDIT_ROLE(),
    energyBank.SPENDER_ROLE(),
  ]);
  const [newCredit, newSpend, oldCredit, oldSpend] = await Promise.all([
    energyBank.hasRole(creditRole, checkpoint.collection),
    energyBank.hasRole(spenderRole, checkpoint.controller),
    energyBank.hasRole(creditRole, HOODYOOR_LEGACY_COLLECTION),
    energyBank.hasRole(spenderRole, HOODYOOR_LEGACY_REROLL_CONTROLLER),
  ]);
  const saleClosed = BigInt(publicDrop.startTime) === 0n
    && BigInt(publicDrop.endTime) === 0n
    && allowListRoot === ZeroHash;
  const complete = collectionCode !== "0x"
    && controllerCode !== "0x"
    && getAddress(owner) === getAddress(config.owner)
    && getAddress(treasury) === getAddress(config.treasury)
    && getAddress(renderer) === getAddress(HOODYOOR_PIXEL_RENDERER)
    && getAddress(configuredEnergy) === getAddress(HOODYOOR_ENERGY_BANK)
    && getAddress(rerollController) === getAddress(checkpoint.controller)
    && getAddress(controllerUSDG) === getAddress(HOODYOOR_USDG)
    && getAddress(controllerTreasury) === getAddress(config.treasury)
    && getAddress(creatorPayout) === getAddress(config.treasury)
    && totalSupply === 0n
    && !ownerReserveMinted
    && !secondaryTradingEnabled
    && rendererFrozen
    && energyConfigurationFrozen
    && rerollControllerFrozen
    && initialTraitsFrozen
    && allowedSeaDropFrozen
    && contractMetadataFrozen
    && paymentConfigurationFrozen
    && weiPerEnergy.toString() === checkpoint.weiPerEnergy
    && usdgUnitsPerEnergy.toString() === checkpoint.usdgUnitsPerEnergy
    && newCredit
    && newSpend
    && !oldCredit
    && !oldSpend
    && saleClosed;
  return {
    status: complete ? "staged-sale-closed" : "incomplete-or-inconsistent",
    checkpoint: path.relative(projectRoot, checkpointPath),
    collection: getAddress(checkpoint.collection),
    controller: getAddress(checkpoint.controller),
    totalSupply: Number(totalSupply),
    ownerReserveMinted,
    secondaryTradingEnabled,
    launchConfigurationFrozen: rendererFrozen
      && energyConfigurationFrozen
      && rerollControllerFrozen
      && initialTraitsFrozen
      && allowedSeaDropFrozen
      && contractMetadataFrozen
      && paymentConfigurationFrozen,
    saleClosed,
    roles: { newCredit, newSpend, oldCredit, oldSpend },
  };
}

async function inspectNetwork() {
  if (offline) return { status: "skipped-offline", staged: { status: "not-inspected" } };
  const rpcUrl = process.env.HOODYOOR_RPC_URL || manifest.targetChain.publicRpc;
  try {
    const provider = new JsonRpcProvider(rpcUrl);
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== HOODYOOR_CHAIN_ID) {
      return { status: "wrong-chain", chainId: Number(network.chainId) };
    }
    const addresses = {
      seaDrop: HOODYOOR_SEADROP,
      usdg: HOODYOOR_USDG,
      packedTraitStore: HOODYOOR_PACKED_TRAIT_STORE,
      pixelRenderer: HOODYOOR_PIXEL_RENDERER,
      energyBank: HOODYOOR_ENERGY_BANK,
      traitRules: HOODYOOR_TRAIT_RULES,
      legacyCollection: HOODYOOR_LEGACY_COLLECTION,
      legacyController: HOODYOOR_LEGACY_REROLL_CONTROLLER,
    };
    const codeEntries = await Promise.all(Object.entries(addresses).map(
      async ([label, address]) => [label, await provider.getCode(address) !== "0x"],
    ));
    const contractsPresent = Object.fromEntries(codeEntries);
    const store = new Contract(HOODYOOR_PACKED_TRAIT_STORE, storeAbi, provider);
    const renderer = new Contract(HOODYOOR_PIXEL_RENDERER, rendererAbi, provider);
    const energyBank = new Contract(HOODYOOR_ENERGY_BANK, energyAbi, provider);
    const rules = new Contract(HOODYOOR_TRAIT_RULES, rulesAbi, provider);
    const legacy = new Contract(
      HOODYOOR_LEGACY_COLLECTION,
      legacyCollectionAbi,
      provider,
    );
    const usdg = new Contract(HOODYOOR_USDG, usdGAbi, provider);
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
      ownerBalance,
    ] = await Promise.all([
      store.frozen(),
      store.catalogHash(),
      renderer.isFrozen(),
      renderer.traitStore(),
      energyBank.owner(),
      energyBank.paused(),
      rules.frozen(),
      rules.rulesHash(),
      legacy.totalSupply(),
      legacy.ownerReserveMinted(),
      legacy.gtdSaleActive(),
      legacy.publicSaleActive(),
      legacy.secondaryTradingEnabled(),
      usdg.name(),
      usdg.symbol(),
      usdg.decimals(),
      provider.getBalance(config.owner),
    ]);
    const dependenciesValid = Object.values(contractsPresent).every(Boolean)
      && storeFrozen
      && catalogHash.toLowerCase() === manifest.reusedPayloads.artCatalogHash.toLowerCase()
      && rendererFrozen
      && getAddress(rendererStore) === getAddress(HOODYOOR_PACKED_TRAIT_STORE)
      && getAddress(energyOwner) === getAddress(config.owner)
      && !energyPaused
      && rulesFrozen
      && rulesHash.toLowerCase() === manifest.reusedPayloads.rulesHash.toLowerCase()
      && legacySupply === 0n
      && !legacyReserveMinted
      && !legacyGTD
      && !legacyPublic
      && !legacySecondary
      && usdgName === "Global Dollar"
      && usdgSymbol === "USDG"
      && Number(usdgDecimals) === 6;
    const staged = await inspectStaged(provider, energyBank);
    return {
      status: dependenciesValid ? "pass" : "dependency-mismatch",
      chainId: Number(network.chainId),
      blockNumber: await provider.getBlockNumber(),
      rpcSource: process.env.HOODYOOR_RPC_URL ? "configured" : "official-public-fallback",
      ownerBalanceEth: formatEther(ownerBalance),
      contractsPresent,
      dependencies: {
        storeFrozen,
        catalogHash,
        rendererFrozen,
        rendererStore,
        energyOwner,
        energyPaused,
        rulesFrozen,
        rulesHash,
        usdg: { name: usdgName, symbol: usdgSymbol, decimals: Number(usdgDecimals) },
      },
      supersededCollection: {
        address: getAddress(HOODYOOR_LEGACY_COLLECTION),
        totalSupply: Number(legacySupply),
        ownerReserveMinted: legacyReserveMinted,
        gtdSaleActive: legacyGTD,
        publicSaleActive: legacyPublic,
        secondaryTradingEnabled: legacySecondary,
      },
      staged,
    };
  } catch (error) {
    return { status: "unavailable", error: error.message };
  }
}

if (manifest.targetChain.chainId !== HOODYOOR_CHAIN_ID) {
  throw new Error("SeaDrop v2 manifest targets an unexpected chain.");
}
if (getAddress(manifest.economics.ownerAndTreasury) !== getAddress(config.owner)) {
  throw new Error("SeaDrop v2 owner differs from collection configuration.");
}
if (
  keccak256(toUtf8Bytes(manifest.metadata.contractURI)).toLowerCase()
  !== manifest.metadata.contractURIKeccak256.toLowerCase()
) throw new Error("Frozen onchain contract metadata hash is inconsistent.");

// This command is intentionally keyless. Deployment credentials and the private reveal
// backup are checked only inside the separately gated execution workflow, never preflight.
const gates = seaDropV2GateReport(config.owner, manifest, Object.create(null));
const local = verifySeaDropV2ManifestLocal(projectRoot, manifest);
const energyMigration = verifyFrozenEnergyMigrationLedger(projectRoot);
const revealBackup = {
  passed: false,
  status: "not-inspected-keyless-preflight",
  privateSecretRead: false,
};
const network = await inspectNetwork();
const ready = gates.ready
  && local.passed
  && energyMigration.passed
  && revealBackup.passed
  && network.status === "pass";
const blockers = [...new Set([
  ...gates.blockers,
  ...(!local.passed ? local.blockers.map((id) => `local:${id}`) : []),
  ...(!energyMigration.passed ? ["energy-migration-ledger-integrity"] : []),
  ...(!revealBackup.passed ? ["reveal-secret-offline-backup"] : []),
  ...(network.status !== "pass" ? [`robinhood-rpc-${network.status}`] : []),
])];

const report = {
  schema: "dyoor-hoodyoor-seadrop-v2-preflight-v1",
  mode: offline ? "offline" : "read-only-live",
  ready,
  broadcastAttempted: false,
  privateKeyRead: false,
  privateRevealSecretRead: false,
  chainId: HOODYOOR_CHAIN_ID,
  configuredOwnerAndTreasury: getAddress(config.owner),
  sourceTreeKeccak256: manifest.sourceTree.canonicalKeccak256,
  contracts: {
    canonicalSeaDrop: getAddress(HOODYOOR_SEADROP),
    canonicalUSDG: getAddress(HOODYOOR_USDG),
    reusedEnergyBank: getAddress(HOODYOOR_ENERGY_BANK),
    supersededCollection: getAddress(HOODYOOR_LEGACY_COLLECTION),
    replacementCollection: checkpoint?.collection || null,
    replacementController: checkpoint?.controller || null,
  },
  rerollPayments: {
    methods: ["Energy", "ETH", "USDG"],
    weiPerEnergy: gates.pricing.weiPerEnergy,
    usdgUnitsPerEnergy: gates.pricing.usdgUnitsPerEnergy,
    examples: priceExamples(gates),
    permanentlyFrozenAtDeployment: true,
  },
  securityReviewV2: gates.securityReviewV2,
  launchGates: gates.gates,
  blockers,
  localIntegrity: local,
  energyMigration,
  revealBackup,
  network,
  nextCommand: ready
    ? "EXECUTE_HOODYOOR_SEADROP_V2_DEPLOYMENT=1 npm run deploy:robinhood:seadrop-v2"
    : "Resolve every blocker, then rerun npm run preflight:robinhood:seadrop-v2",
};

console.log(JSON.stringify(report, null, 2));
if (strict && !ready) process.exitCode = 1;
