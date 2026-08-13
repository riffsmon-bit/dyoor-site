import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress, keccak256, toUtf8Bytes } from "ethers";
import {
  HOODYOOR_ENERGY_BANK,
  HOODYOOR_LEGACY_COLLECTION,
  HOODYOOR_LEGACY_REROLL_CONTROLLER,
  HOODYOOR_PACKED_TRAIT_STORE,
  HOODYOOR_PIXEL_RENDERER,
  HOODYOOR_SEADROP,
  HOODYOOR_SEADROP_V2_MANIFEST_PATH,
  HOODYOOR_TRAIT_RULES,
  HOODYOOR_USDG,
  artifactRecord,
  buildHoodYoorOnchainContractURI,
  fileRecord,
  sourceTreeHashes,
} from "./lib/hoodyoor-seadrop-v2.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contractRoot = path.join(projectRoot, "contracts", "hoodyoor");
const generatedRoot = path.join(projectRoot, "data", "robinhood", "onchain-128");
const outputPath = path.join(projectRoot, HOODYOOR_SEADROP_V2_MANIFEST_PATH);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function relativeRecord(relativePath) {
  return fileRecord(projectRoot, path.join(projectRoot, relativePath));
}

const config = readJson(path.join(
  projectRoot,
  "data",
  "robinhood",
  "dyoor-collection-config.json",
));
const abandonment = readJson(path.join(
  projectRoot,
  "deployments",
  "robinhood",
  "hoodyoor-v1-abandonment-4663.json",
));
const oldManifest = readJson(path.join(
  generatedRoot,
  "hoodyoor-mainnet-launch-manifest.json",
));
const assignments = readJson(path.join(
  generatedRoot,
  "hoodyoor-initial-assignments.json",
));
const art = readJson(path.join(generatedRoot, "hoodyoor-onchain-art-manifest.json"));
const rules = readJson(path.join(generatedRoot, "hoodyoor-reroll-rules.json"));
const energy = readJson(path.join(
  generatedRoot,
  "hoodyoor-energy-migration-ledger.json",
));
const gtd = readJson(path.join(generatedRoot, "hoodyoor-gtd-allowlist.json"));
const liveVerification = readJson(path.join(
  projectRoot,
  "deployments",
  "robinhood",
  "hoodyoor-live-verification-4663.json",
));
const branding = readJson(path.join(
  projectRoot,
  "data",
  "robinhood",
  "branding",
  "opensea",
  "opensea-branding-manifest.json",
));

if (
  abandonment.status !== "superseded-before-mint"
  || getAddress(abandonment.supersededCollection.address)
    !== getAddress(HOODYOOR_LEGACY_COLLECTION)
  || abandonment.supersededCollection.totalSupplyAtDecision !== 0
) {
  throw new Error("The v1 abandonment record is missing or inconsistent.");
}
if (
  config.maxSupply !== 3_333
  || config.ownerReserve.allocation !== 150
  || config.secondaryTrading.autoUnlockMintedSupply !== 1_667
  || config.reroll.mintEnergy.rewardPerPaidToken !== 1_000
  || getAddress(config.owner) !== getAddress(config.treasury)
) {
  throw new Error("The collection configuration differs from the approved v2 economics.");
}
if (
  assignments.totals.assignments !== config.maxSupply
  || assignments.totals.provenanceHash.toLowerCase()
    !== config.assignments.provenanceHash.toLowerCase()
  || rules.contract.rulesHash.toLowerCase() !== config.reroll.rulesHash.toLowerCase()
  || energy.status !== "frozen"
) {
  throw new Error("A frozen HoodYØØR payload differs from the approved configuration.");
}

const contractNames = ["HoodYOORSeaDrop", "HoodYOORRerollControllerV2"];
const artifacts = contractNames.map((name) => artifactRecord(projectRoot, name));
const sourceNames = new Set();
for (const name of contractNames) {
  const artifact = readJson(path.join(
    contractRoot,
    "out",
    `${name}.sol`,
    `${name}.json`,
  ));
  for (const sourceName of Object.keys(artifact.metadata.sources)) sourceNames.add(sourceName);
}
const sourceFiles = [...sourceNames]
  .sort()
  .map((sourceName) => fileRecord(projectRoot, path.join(contractRoot, sourceName)));
const sourceTree = { files: sourceFiles, ...sourceTreeHashes(sourceFiles) };

const integrityPaths = [
  "data/robinhood/dyoor-collection-config.json",
  "deployments/robinhood/hoodyoor-v1-abandonment-4663.json",
  "deployments/robinhood/hoodyoor-live-verification-4663.json",
  "data/robinhood/onchain-128/hoodyoor-onchain-art-manifest.json",
  "data/robinhood/onchain-128/hoodyoor-onchain-art.bin",
  "data/robinhood/onchain-128/hoodyoor-trait-records.bin",
  "data/robinhood/onchain-128/hoodyoor-initial-assignments.json",
  "data/robinhood/onchain-128/hoodyoor-initial-assignments.bin",
  "data/robinhood/onchain-128/hoodyoor-reroll-rules.json",
  "data/robinhood/onchain-128/hoodyoor-reroll-rules.bin",
  "data/robinhood/onchain-128/hoodyoor-energy-migration-ledger.json",
  "data/robinhood/onchain-128/hoodyoor-energy-migration.bin",
  "data/robinhood/onchain-128/hoodyoor-energy-migration.csv",
  "data/robinhood/onchain-128/hoodyoor-gtd-allowlist.json",
  "data/robinhood/onchain-128/hoodyoor-gtd-allowlist.csv",
  "data/robinhood/onchain-128/hoodyoor-gtd-allowlist.bin",
  "data/robinhood/branding/opensea/opensea-branding-manifest.json",
  ...branding.assets.map(({ path: assetPath }) => assetPath),
];
const integrityFiles = [...new Set(integrityPaths)].sort().map(relativeRecord);

const deployedRuntime = Object.fromEntries(
  liveVerification.contracts.map((contract) => [contract.name, {
    address: getAddress(contract.address),
    runtimeBytes: contract.runtimeBytes,
    normalizedRuntimeHash: contract.normalizedRuntimeHash,
    explorerUrl: contract.explorerUrl,
  }]),
);
const collectionArtifactMetadata = readJson(path.join(
  contractRoot,
  "out",
  "HoodYOORSeaDrop.sol",
  "HoodYOORSeaDrop.json",
)).metadata;
const contractURI = buildHoodYoorOnchainContractURI(config.treasury);

const manifest = {
  schema: "dyoor-hoodyoor-seadrop-v2-launch-v1",
  collection: config.name,
  targetChain: {
    name: "Robinhood Chain",
    chainId: 4_663,
    nativeCurrency: "ETH",
    publicRpc: "https://rpc.mainnet.chain.robinhood.com",
    explorer: "https://robinhoodchain.blockscout.com",
  },
  broadcast: {
    status: "not-deployed",
    authorized: false,
    note: "This manifest is preparation evidence only. A fresh exact-source, exact-price, security, and irreversible broadcast gate is still required.",
  },
  externalContracts: {
    seaDrop: getAddress(HOODYOOR_SEADROP),
    seaDropVersion: "1.0",
    seaDropUpstreamCommit: "6ab8b2ce1da7a750301fa34eb60a2bb8b26aebc1",
    usdg: getAddress(HOODYOOR_USDG),
    usdgName: "Global Dollar",
    usdgSymbol: "USDG",
    usdgDecimals: 6,
    usdgPaymentFlow: "holder approves the reroll controller, then the controller transfers the exact signed amount directly to treasury",
  },
  officialSeaDropProvenance: {
    upstream: "ProjectOpenSea/seadrop",
    commit: "6ab8b2ce1da7a750301fa34eb60a2bb8b26aebc1",
    verifiedChecksums: {
      "src/interfaces/INonFungibleSeaDropToken.sol": "9a6c8267278c9e2c33841d24a1f1036e42d2dc5aeeffab809e90e736cd150cf5",
      "src/interfaces/ISeaDrop.sol": "cbf430bf51097fc644eb12a5a0d652a9c2af5de9a8d9bd4e8b8421334c7dbd08",
      "src/interfaces/ISeaDropTokenContractMetadata.sol": "cdd04d0f4d374554131314c8d7e11e68fe0cb34afec636a2d0326d3fd857d931",
      "src/lib/SeaDropStructs.sol": "b2ba6712b9100c98b445fa47bb0926499440039fe606b2dbfb1ff2ad6f75460d",
    },
    implementationNote: "The HoodYØØR collection implements the exact SeaDrop token selectors while retaining the fully onchain renderer, reveal, Energy reward, reroll hook, reserve, and transfer lock.",
  },
  economics: {
    maxSupply: config.maxSupply,
    ownerReserve: config.ownerReserve.allocation,
    paidAllocation: config.maxSupply - config.ownerReserve.allocation,
    mintPriceWei: config.gtd.mintPriceWei,
    openSeaPrimaryFeeBasisPoints: 1_000,
    royaltyBasisPoints: config.royalty.basisPoints,
    ownerAndTreasury: getAddress(config.owner),
    paidMintEnergyReward: config.reroll.mintEnergy.rewardPerPaidToken,
    reserveEarnsEnergy: false,
    secondaryAutoUnlockSupply: config.secondaryTrading.autoUnlockMintedSupply,
    reserveCountsTowardSecondaryUnlock: true,
  },
  rerolls: {
    authorizationDomainVersion: "2",
    paymentMethods: {
      Energy: {
        code: 1,
        submission: "gasless relayer transaction",
        settlement: "Energy Bank debit",
      },
      ETH: {
        code: 2,
        submission: "direct current-holder transaction",
        settlement: "controller balance, owner withdrawal only to immutable treasury",
      },
      USDG: {
        code: 3,
        submission: "direct current-holder transaction after any required ERC-20 approval",
        settlement: "direct transfer to immutable treasury",
        token: getAddress(HOODYOOR_USDG),
        decimals: 6,
      },
    },
    energyCosts: {
      mouthOrNeck: 100,
      bodyEyesOrClothes: 200,
      headOrAccessory: 300,
      allMutableLayers: 1_000,
    },
    pricing: {
      status: "owner-selection-required-before-deployment",
      weiPerEnergy: null,
      usdgUnitsPerEnergy: null,
      permanentlyFrozenBeforeRerolls: true,
      note: "No test-only rate is approved for mainnet by this manifest.",
    },
    replayProtection: "one shared per-token nonce; payment method, token, amount, current owner, expected traits, result, action, layer, and deadline are all signed",
  },
  metadata: {
    tokenStorage: "fully-onchain data:application/json;base64",
    imageStorage: "fully-onchain SVG assembled from frozen bytecode chunks",
    contractURI,
    contractURIKeccak256: keccak256(toUtf8Bytes(contractURI)),
    contractURIFrozenBeforeMint: true,
  },
  migration: {
    supersededCollection: getAddress(HOODYOOR_LEGACY_COLLECTION),
    supersededController: getAddress(HOODYOOR_LEGACY_REROLL_CONTROLLER),
    supersededSupply: 0,
    reusedFrozenContracts: {
      packedTraitStore: getAddress(HOODYOOR_PACKED_TRAIT_STORE),
      pixelRenderer: getAddress(HOODYOOR_PIXEL_RENDERER),
      energyBank: getAddress(HOODYOOR_ENERGY_BANK),
      traitRules: getAddress(HOODYOOR_TRAIT_RULES),
    },
    deployedRuntime,
    roleChangeOrder: [
      "grant the replacement collection Energy CREDIT_ROLE",
      "grant the replacement controller Energy SPENDER_ROLE",
      "verify the complete replacement launch graph while total supply remains zero",
      "revoke the superseded collection CREDIT_ROLE",
      "revoke the superseded controller SPENDER_ROLE",
    ],
  },
  allowlist: {
    eligibleWallets: gtd.totals.uniqueWallets,
    aggregateMaximumMints: gtd.totals.aggregateMaxMint,
    sourceCsv: "data/robinhood/onchain-128/hoodyoor-gtd-allowlist.csv",
    legacyCustomCollectionRoot: gtd.merkleTree.root,
    legacyRootReusableWithSeaDrop: false,
    status: "wallet list frozen; SeaDrop root waits for final stage MintParams and schedule",
    note: "SeaDrop hashes the wallet together with price, wallet cap, timestamps, stage index, stage supply, fee basis points, and fee-recipient restriction. Generate the final root only after those values are chosen.",
  },
  reusedPayloads: {
    artPayloadKeccak256: art.totals.payloadKeccak256,
    artCatalogHash: art.contracts.catalogHash,
    assignmentBinaryKeccak256: assignments.totals.binaryKeccak256,
    assignmentProvenanceHash: assignments.totals.provenanceHash,
    rulesHash: rules.contract.rulesHash,
    energyLedgerKeccak256: energy.binary.keccak256,
    energyDestinationTotal: energy.totals.destinationEnergy,
    previousLaunchSourceTree: oldManifest.sourceTree.canonicalKeccak256,
  },
  deploymentCeremony: {
    assignmentsPerTransaction: 50,
    orderedSteps: [
      "verify canonical SeaDrop, canonical six-decimal USDG, every reused frozen dependency, and the zero-supply superseded collection",
      "deploy the replacement HoodYOORSeaDrop with sale configuration closed",
      "deploy HoodYOORRerollControllerV2 against the replacement collection and frozen dependencies",
      "set and permanently freeze the exact owner-approved ETH and USDG rates",
      "wire and permanently freeze the collection reroll controller, Energy reward, renderer, contract metadata, and canonical SeaDrop",
      "grant replacement Energy roles",
      "load all 3,333 assignments in resumable 50-record batches and freeze provenance plus reveal commitment",
      "set SeaDrop creator payout to owner treasury while public drop and allowlist root remain zero",
      "verify supply zero, reserve unminted, secondary closed, and every replacement dependency",
      "revoke the two obsolete Energy roles only after all replacement checks pass",
    ],
    stagedEndState: {
      totalSupply: 0,
      ownerReserveMinted: false,
      secondaryTradingEnabled: false,
      publicDropStart: 0,
      publicDropEnd: 0,
      allowListRoot: "0x0000000000000000000000000000000000000000000000000000000000000000",
    },
    laterDropActivation: "Mint the 150 owner reserve in a separate owner transaction before any SeaDrop mint, then configure the final GTD stage through the collection's SeaDrop wrapper or OpenSea Studio.",
  },
  compiler: {
    version: collectionArtifactMetadata.compiler.version,
    optimizer: collectionArtifactMetadata.settings.optimizer,
    viaIR: collectionArtifactMetadata.settings.viaIR,
    evmVersion: collectionArtifactMetadata.settings.evmVersion,
    metadataBytecodeHash: collectionArtifactMetadata.settings.metadata.bytecodeHash,
  },
  sourceTree,
  artifacts,
  integrityFiles,
  verificationCommands: [
    "forge test --offline --root contracts/hoodyoor",
    "forge test --root contracts/hoodyoor --fork-url https://rpc.mainnet.chain.robinhood.com --match-contract HoodYOORSeaDropForkTest -vv",
    "npm run typecheck",
    "npm test",
    "npm run lint",
    "npm run build",
  ],
  blockers: [
    "select and explicitly acknowledge exact weiPerEnergy and six-decimal usdgUnitsPerEnergy rates",
    "review or explicitly waive security review for this exact v2 source tree",
    "acknowledge the exact v2 source-tree hash",
    "give a fresh irreversible v2 mainnet broadcast acknowledgement",
  ],
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({
  output: path.relative(projectRoot, outputPath),
  sourceTreeKeccak256: manifest.sourceTree.canonicalKeccak256,
  collectionRuntimeBytes: artifacts.find(({ contract }) => contract === "HoodYOORSeaDrop").runtimeBytes,
  controllerRuntimeBytes: artifacts.find(
    ({ contract }) => contract === "HoodYOORRerollControllerV2",
  ).runtimeBytes,
  broadcastAuthorized: false,
  rerollPrices: "pending-owner-selection",
}, null, 2));
