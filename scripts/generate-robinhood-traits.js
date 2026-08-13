import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceCatalogPath = path.join(projectRoot, "data", "dyoor-s2-trait-catalog.json");
const sourceItemMetadataPath = path.join(projectRoot, "data", "dyoor-s2-trait-item-metadata.json");
const outputDirectory = path.join(projectRoot, "data", "robinhood");

export const ROBINHOOD_COLLECTION_MAX_SUPPLY = 3333;
export const ROBINHOOD_COLLECTION_NAME = "HoodYØØR";
export const ROBINHOOD_COLLECTION_OWNER = "0xC7f55cE6A7dF9A79cc4A643a5081230F890c7AA6";
export const ROBINHOOD_COLLECTION_TREASURY = ROBINHOOD_COLLECTION_OWNER;
export const ROBINHOOD_COLLECTION_ROYALTY_BPS = 300;
export const ROBINHOOD_OWNER_RESERVE_ALLOCATION = 150;
export const ROBINHOOD_S2_SNAPSHOT_CONTRACT = "0x349D8eb480c92cF75371fbA5C6344A4d11b9103A";
export const ROBINHOOD_S2_SNAPSHOT_BLOCK = 93374159;

export const ROBINHOOD_ONE_OF_ONE_BACKGROUNDS = [
  "Cynically Censored-Project M.A.D.",
  "Don't Look At The Lighthouse-Project M.A.D.",
  "Eye Sea U-Project M.A.D.",
  "Fxxk Crabs-Project M.A.D.",
  "Painfully Here-Project M.A.D.",
  "Sad Cook-Project M.A.D.",
  "Simovision-Project M.A.D.",
  "Soul Catcher-Project M.A.D.",
  "The Way-Project M.A.D.",
  "Tisumusem-Project M.A.D.",
];

const robinhoodOneOfOneBackgrounds = new Set(ROBINHOOD_ONE_OF_ONE_BACKGROUNDS);

export const ROBINHOOD_TRAIT_EXCLUSION_TERMS = [
  "monad",
  "10k",
  "bob",
  "hive",
  "molandak",
  "mouch",
  "salmonad",
  "shramp",
];

export const ROBINHOOD_REMOVED_TRAIT_SLOTS = [
  "Stickers/Body art",
  "Special",
];

export const ROBINHOOD_TRAIT_ADDITIONS = {
  Background: [
    {
      traitId: 122,
      name: "INDAHOOD",
      weight: ROBINHOOD_COLLECTION_MAX_SUPPLY - ROBINHOOD_ONE_OF_ONE_BACKGROUNDS.length,
      selectable: true,
      mutable: false,
    },
  ],
  Clothes: [
    {
      traitId: 3057,
      name: "Robinhood Green Tee",
      weight: 3,
      selectable: true,
      mutable: true,
    },
  ],
  Eyes: [
    {
      traitId: 5032,
      name: "Robinhood Green Shades",
      weight: 3,
      selectable: true,
      mutable: true,
    },
  ],
  Hat: [
    {
      traitId: 6042,
      name: "Robinhood Feather Cap",
      weight: 3,
      selectable: true,
      mutable: true,
    },
  ],
};

const robinhoodItemMetadataAdditions = Object.fromEntries(
  Object.entries(ROBINHOOD_TRAIT_ADDITIONS).flatMap(([slot, entries]) => (
    slot === "Background"
      ? []
      : entries.map((entry) => [
          `${slot}::${entry.name}`,
          {
            slot,
            name: entry.name,
            rarity: entry.weight <= 2 ? "Mythic" : "Super Rare",
            initialSupply: 0,
            maxActiveSupply: entry.weight <= 2 ? 100 : 300,
            burnOnEquip: "Yes",
            image: "",
            localImage: `data/robinhood/layers/${slot}/${entry.name}.png`,
          },
        ])
  )),
);

const targetChain = {
  name: "Robinhood Chain",
  chainId: 4663,
};

const collectionConfig = {
  schema: "dyoor-robinhood-collection-v1",
  name: ROBINHOOD_COLLECTION_NAME,
  targetChain,
  maxSupply: ROBINHOOD_COLLECTION_MAX_SUPPLY,
  owner: ROBINHOOD_COLLECTION_OWNER,
  treasury: ROBINHOOD_COLLECTION_TREASURY,
  royalty: {
    receiver: ROBINHOOD_COLLECTION_TREASURY,
    basisPoints: ROBINHOOD_COLLECTION_ROYALTY_BPS,
    percentage: 3,
  },
  ownerReserve: {
    allocation: ROBINHOOD_OWNER_RESERVE_ALLOCATION,
    recipientPolicy: "current-collection-owner",
    mintTiming: "first-gtd-activation",
    paid: false,
    countsTowardSecondaryTradingThreshold: true,
  },
  metadata: {
    storage: "fully-on-chain",
    renderer: "on-chain-layer-composition",
    reveal: "commit-future-block-permutation",
  },
  reroll: {
    status: "implemented-local-rehearsal",
    contractHookRequiredAtLaunch: true,
    energyBank: "contracts/hoodyoor/src/HoodYOOREnergyBank.sol",
    mintEnergy: {
      rewardPerPaidToken: 1000,
      ownerReserveEligible: false,
      configurationFrozenBeforeSale: true,
    },
    rulesHash: "0x14a33149be765254e70441c4ba2674c662f5b3f746fb3ac8a717a4f49b47ab0f",
  },
  gtd: {
    mintType: "paid",
    mintPriceWei: "2500000000000000",
    mergePolicy: "highest-source-allowance",
    monadHolders: {
      sourceChain: {
        name: "Monad",
        chainId: 143,
      },
      sourceContract: ROBINHOOD_S2_SNAPSHOT_CONTRACT,
      snapshotBlock: ROBINHOOD_S2_SNAPSHOT_BLOCK,
      snapshotManifest: "data/robinhood/snapshots/hoodyoor-s2-holders-block-93374159.json",
      snapshotCsv: "data/robinhood/snapshots/hoodyoor-s2-holders-block-93374159.csv",
      maxMintPerHolder: 1,
      basis: "positive-balance-at-snapshot",
    },
    robinhoodTopHolders: {
      sourceAllowlist: "data/robinhood/gtd-sources/opensea-top-holders-block-32071198.csv",
      sourceSummary: "data/robinhood/gtd-sources/opensea-top-holders-block-32071198-summary.json",
      maxMintPerWallet: 3,
    },
    allowlistManifest: "data/robinhood/onchain-128/hoodyoor-gtd-allowlist.json",
    treeDump: "data/robinhood/onchain-128/hoodyoor-gtd-tree.json",
  },
  assignments: {
    manifest: "data/robinhood/onchain-128/hoodyoor-initial-assignments.json",
    provenanceHash: "0x2b3049a8235d705dba39542b53990e584e3815e4e6a32efae6ecb810b8f506a3",
  },
  secondaryTrading: {
    initiallyLocked: true,
    autoUnlockMintedSupply: 1667,
    threshold: "50%-rounded-up",
    ownerCanUnlockEarly: true,
    unlockIsPermanent: true,
    newApprovalsBlockedWhileLocked: true,
    ownerReserveCountsTowardThreshold: true,
  },
  backgrounds: {
    default: "INDAHOOD",
    defaultCount: ROBINHOOD_COLLECTION_MAX_SUPPLY - ROBINHOOD_ONE_OF_ONE_BACKGROUNDS.length,
    oneOfOnes: ROBINHOOD_ONE_OF_ONE_BACKGROUNDS.map((name) => ({ name, count: 1 })),
  },
  branding: {
    profileImage: "data/robinhood/branding/robinhood-collection-pfp-pixel-v2.png",
    banner: "data/robinhood/branding/robinhood-collection-banner-pixel-v2.png",
  },
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function normalizedText(value) {
  return String(value || "").normalize("NFKC").toLowerCase();
}

function isRobinhoodRemovedSlot(value) {
  return ROBINHOOD_REMOVED_TRAIT_SLOTS.includes(String(value || ""));
}

function filterSlotList(values = []) {
  return values.filter((slot) => !isRobinhoodRemovedSlot(slot));
}

export function isRobinhoodExcludedTrait(value) {
  const normalized = normalizedText(value);
  return ROBINHOOD_TRAIT_EXCLUSION_TERMS.some((term) => normalized.includes(term));
}

function filterNamedRecord(record = {}) {
  return Object.fromEntries(
    Object.entries(record).filter(([name]) => !isRobinhoodExcludedTrait(name)),
  );
}

function filterSlotRecords(records = {}) {
  return Object.fromEntries(
    Object.entries(records)
      .filter(([slot]) => !isRobinhoodRemovedSlot(slot))
      .map(([slot, values]) => [slot, filterNamedRecord(values)]),
  );
}

function filterRuleMap(ruleMap = {}) {
  const filtered = {};
  for (const [slot, values] of Object.entries(ruleMap || {})) {
    if (isRobinhoodRemovedSlot(slot)) continue;
    const allowed = Array.isArray(values)
      ? values.filter((value) => !isRobinhoodExcludedTrait(value))
      : [];
    if (allowed.length) filtered[slot] = allowed;
  }
  return filtered;
}

function ruleMapHasValues(ruleMap) {
  return Object.values(ruleMap || {}).some((values) => Array.isArray(values) && values.length > 0);
}

function compatibilityRuleName(rule, filteredIf) {
  if (!isRobinhoodExcludedTrait(rule?.name)) return rule?.name || "Trait compatibility rule";
  const remainingConditions = Object.values(filteredIf).flat().join(" / ");
  return remainingConditions
    ? `${remainingConditions} compatibility`
    : "Trait compatibility rule";
}

function filterCompatibilityRules(rules = []) {
  return rules.flatMap((rule) => {
    const filteredIf = filterRuleMap(rule?.if);
    const filteredCannot = filterRuleMap(rule?.cannot);
    if (!ruleMapHasValues(filteredIf) || !ruleMapHasValues(filteredCannot)) return [];

    return [{
      ...rule,
      name: compatibilityRuleName(rule, filteredIf),
      if: filteredIf,
      cannot: filteredCannot,
    }];
  });
}

function filterSequenceRules(sequenceRules = {}) {
  const traitCooldowns = filterSlotRecords(sequenceRules.traitCooldowns || {});
  return {
    ...sequenceRules,
    excludeValues: (sequenceRules.excludeValues || []).filter((value) => !isRobinhoodExcludedTrait(value)),
    noImmediateRepeatLayers: filterSlotList(sequenceRules.noImmediateRepeatLayers || []),
    traitCooldowns,
  };
}

function insertTraitAdditions(slot, entries) {
  const additions = ROBINHOOD_TRAIT_ADDITIONS[slot] || [];
  if (!additions.length) return entries;
  const none = entries.filter((entry) => entry?.name === "None");
  const active = entries.filter((entry) => entry?.name !== "None");
  return active.concat(additions, none);
}

function filteredTraitsBySlot(traits = {}) {
  return Object.fromEntries(
    Object.entries(traits)
      .filter(([slot]) => !isRobinhoodRemovedSlot(slot))
      .map(([slot, entries]) => [
        slot,
        insertTraitAdditions(
          slot,
          (entries || [])
            .filter((entry) => !isRobinhoodExcludedTrait(entry?.name))
            .filter((entry) => (
              slot !== "Background"
              || entry?.name === "None"
              || robinhoodOneOfOneBackgrounds.has(entry?.name)
            )),
        ),
      ]),
  );
}

function collectionExactTraitCounts(exactTraitCounts = {}) {
  return {
    ...filterSlotRecords(exactTraitCounts),
    Background: Object.fromEntries([
      ...ROBINHOOD_ONE_OF_ONE_BACKGROUNDS.map((name) => [name, 1]),
      ["INDAHOOD", ROBINHOOD_COLLECTION_MAX_SUPPLY - ROBINHOOD_ONE_OF_ONE_BACKGROUNDS.length],
    ]),
  };
}

function excludedTraitsBySlot(traits = {}) {
  return Object.entries(traits).flatMap(([slot, entries]) => (
    (entries || [])
      .filter((entry) => isRobinhoodExcludedTrait(entry?.name))
      .map((entry) => ({ slot, ...entry }))
  ));
}

function normalizeAssetName(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function slotDirectoryAliases(slot) {
  if (slot === "Conditions") return ["Conditions", "Condition"];
  if (slot === "Stickers/Body art") return ["Stickers/Body art", "Stickers:Body art"];
  return [slot];
}

function findLocalLayer(slot, traitName) {
  const roots = [
    path.join(projectRoot, "data", "robinhood", "layers"),
    path.join(projectRoot, "data", "dyoor-s2-base-layers"),
    path.join(projectRoot, "dyoor-builder", "layers"),
  ];
  const expected = normalizeAssetName(traitName);

  for (const root of roots) {
    for (const directoryName of slotDirectoryAliases(slot)) {
      const directory = path.join(root, directoryName);
      if (!fs.existsSync(directory)) continue;
      const match = fs.readdirSync(directory, { withFileTypes: true }).find((entry) => (
        entry.isFile() && normalizeAssetName(entry.name) === expected
      ));
      if (match) return path.relative(projectRoot, path.join(directory, match.name));
    }
  }
  return "";
}

function filteredItemMetadata(itemMetadata = {}) {
  const filtered = Object.fromEntries(
    Object.entries(itemMetadata).filter(([key, value]) => (
      !isRobinhoodRemovedSlot(value?.slot)
      && !ROBINHOOD_REMOVED_TRAIT_SLOTS.some((slot) => key.startsWith(`${slot}::`))
      && !isRobinhoodExcludedTrait(key)
      && !isRobinhoodExcludedTrait(value?.name)
    )),
  );
  const merged = {
    ...filtered,
    ...robinhoodItemMetadataAdditions,
  };
  return Object.fromEntries(Object.entries(merged).map(([key, value]) => {
    const localImage = findLocalLayer(value?.slot, value?.name);
    return [key, localImage ? { ...value, localImage } : value];
  }));
}

function createAssetManifest(catalog, itemMetadata, excludedTraits) {
  const traits = [];

  for (const [slot, entries] of Object.entries(catalog.traits || {})) {
    for (const entry of entries || []) {
      if (entry?.name === "None") continue;
      const metadataKey = `${slot}::${entry.name}`;
      const remoteUri = String(itemMetadata[metadataKey]?.image || "");
      const localPath = findLocalLayer(slot, entry.name);
      const availability = localPath && remoteUri
        ? "local-and-remote"
        : localPath
          ? "local"
          : remoteUri
            ? "remote"
            : "missing";

      traits.push({
        slot,
        traitId: entry.traitId,
        name: entry.name,
        weight: entry.weight,
        localPath,
        remoteUri,
        availability,
      });
    }
  }

  const availability = traits.reduce((counts, trait) => {
    counts[trait.availability] = (counts[trait.availability] || 0) + 1;
    return counts;
  }, {});

  return {
    schema: "dyoor-robinhood-trait-assets-v1",
    collection: ROBINHOOD_COLLECTION_NAME,
    targetChain,
    maxSupply: ROBINHOOD_COLLECTION_MAX_SUPPLY,
    sourceCatalog: path.relative(projectRoot, sourceCatalogPath),
    sourceItemMetadata: path.relative(projectRoot, sourceItemMetadataPath),
    exclusionTerms: ROBINHOOD_TRAIT_EXCLUSION_TERMS,
    summary: {
      catalogEntries: Object.values(catalog.traits || {}).flat().length,
      nonNoneTraitEntries: traits.length,
      excludedTraitEntries: excludedTraits.length,
      availability,
      missing: traits.filter((trait) => trait.availability === "missing").map(({ slot, name }) => ({ slot, name })),
    },
    traits,
  };
}

function createExclusionAudit(excludedTraits, removedSlotTraits, removedBackgroundTraits) {
  return {
    schema: "dyoor-robinhood-trait-exclusions-v1",
    targetChain,
    sourceCatalog: path.relative(projectRoot, sourceCatalogPath),
    policy: {
      mode: "case-insensitive-name-substring",
      terms: ROBINHOOD_TRAIT_EXCLUSION_TERMS,
    },
    summary: {
      excludedTraitEntries: excludedTraits.length,
      distinctExcludedNames: new Set(excludedTraits.map((trait) => trait.name)).size,
      removedSlots: ROBINHOOD_REMOVED_TRAIT_SLOTS.length,
      removedSlotTraitEntries: removedSlotTraits.length,
      removedBackgroundTraitEntries: removedBackgroundTraits.length,
    },
    traits: excludedTraits,
    removedSlots: ROBINHOOD_REMOVED_TRAIT_SLOTS.map((slot) => ({
      slot,
      traits: removedSlotTraits.filter((trait) => trait.slot === slot),
    })),
    backgroundPolicy: {
      default: "INDAHOOD",
      oneOfOnes: ROBINHOOD_ONE_OF_ONE_BACKGROUNDS,
      removed: removedBackgroundTraits,
    },
  };
}

export function generateRobinhoodTraits() {
  const sourceCatalog = readJson(sourceCatalogPath);
  const sourceItemMetadata = readJson(sourceItemMetadataPath);
  const excludedTraits = excludedTraitsBySlot(sourceCatalog.traits);
  const removedSlotTraits = Object.entries(sourceCatalog.traits).flatMap(([slot, entries]) => (
    isRobinhoodRemovedSlot(slot) ? (entries || []).map((entry) => ({ slot, ...entry })) : []
  ));
  const removedBackgroundTraits = (sourceCatalog.traits?.Background || [])
    .filter((entry) => entry?.name !== "None")
    .filter((entry) => !robinhoodOneOfOneBackgrounds.has(entry?.name))
    .map((entry) => ({ slot: "Background", ...entry }));
  const traits = filteredTraitsBySlot(sourceCatalog.traits);

  const catalog = {
    ...sourceCatalog,
    schema: "dyoor-dynamic-v1-robinhood",
    collection: ROBINHOOD_COLLECTION_NAME,
    targetChain,
    maxSupply: ROBINHOOD_COLLECTION_MAX_SUPPLY,
    derivedFrom: {
      path: path.relative(projectRoot, sourceCatalogPath),
      schema: sourceCatalog.schema,
      generatedAt: sourceCatalog.generatedAt,
    },
    exclusionPolicy: {
      mode: "case-insensitive-name-substring",
      terms: ROBINHOOD_TRAIT_EXCLUSION_TERMS,
    },
    removedTraitSlots: ROBINHOOD_REMOVED_TRAIT_SLOTS,
    attributeOrder: filterSlotList(sourceCatalog.attributeOrder),
    renderOrder: filterSlotList(sourceCatalog.renderOrder),
    lockedLayers: filterSlotList(sourceCatalog.lockedLayers),
    mutableLayers: filterSlotList(sourceCatalog.mutableLayers),
    requiredLayers: filterSlotList(sourceCatalog.requiredLayers),
    none: Object.fromEntries(
      Object.entries(sourceCatalog.none || {}).filter(([slot]) => !isRobinhoodRemovedSlot(slot)),
    ),
    exactTraitCounts: collectionExactTraitCounts(sourceCatalog.exactTraitCounts),
    incompatibilityRules: filterCompatibilityRules(sourceCatalog.incompatibilityRules),
    sequenceRules: filterSequenceRules(sourceCatalog.sequenceRules),
    traits,
  };
  const itemMetadata = filteredItemMetadata(sourceItemMetadata);
  const assetManifest = createAssetManifest(catalog, itemMetadata, excludedTraits);
  const exclusionAudit = createExclusionAudit(excludedTraits, removedSlotTraits, removedBackgroundTraits);

  writeJson(path.join(outputDirectory, "dyoor-trait-catalog.json"), catalog);
  writeJson(path.join(outputDirectory, "dyoor-collection-config.json"), collectionConfig);
  writeJson(path.join(outputDirectory, "dyoor-trait-item-metadata.json"), itemMetadata);
  writeJson(path.join(outputDirectory, "dyoor-trait-asset-manifest.json"), assetManifest);
  writeJson(path.join(outputDirectory, "dyoor-trait-exclusions.json"), exclusionAudit);

  return { catalog, itemMetadata, assetManifest, exclusionAudit };
}

const { catalog, itemMetadata, assetManifest, exclusionAudit } = generateRobinhoodTraits();
console.log(JSON.stringify({
  outputDirectory: path.relative(projectRoot, outputDirectory),
  maxSupply: ROBINHOOD_COLLECTION_MAX_SUPPLY,
  catalogEntries: Object.values(catalog.traits).flat().length,
  itemMetadataEntries: Object.keys(itemMetadata).length,
  excludedTraitEntries: exclusionAudit.summary.excludedTraitEntries,
  assetAvailability: assetManifest.summary.availability,
  missingAssets: assetManifest.summary.missing,
}, null, 2));
