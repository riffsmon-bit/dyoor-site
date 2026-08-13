import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const catalog = JSON.parse(fs.readFileSync("data/robinhood/dyoor-trait-catalog.json", "utf8"));
const collectionConfig = JSON.parse(fs.readFileSync("data/robinhood/dyoor-collection-config.json", "utf8"));
const itemMetadata = JSON.parse(fs.readFileSync("data/robinhood/dyoor-trait-item-metadata.json", "utf8"));
const assetManifest = JSON.parse(fs.readFileSync("data/robinhood/dyoor-trait-asset-manifest.json", "utf8"));
const layerPopulation = JSON.parse(fs.readFileSync("data/robinhood/dyoor-layer-population.json", "utf8"));
const exclusionAudit = JSON.parse(fs.readFileSync("data/robinhood/dyoor-trait-exclusions.json", "utf8"));
const holderSnapshot = JSON.parse(fs.readFileSync(
  "data/robinhood/snapshots/hoodyoor-s2-holders-block-93374159.json",
  "utf8",
));
const excludedName = /(monad|10k|bob|hive|molandak|mouch|salmonad|shramp)/i;

test("Robinhood collection supply is fixed at 3,333", () => {
  assert.equal(collectionConfig.name, "HoodYØØR");
  assert.equal(collectionConfig.maxSupply, 3333);
  assert.equal(catalog.maxSupply, 3333);
  assert.equal(assetManifest.maxSupply, 3333);
  assert.equal(collectionConfig.metadata.storage, "fully-on-chain");
  assert.equal(collectionConfig.reroll.status, "implemented-local-rehearsal");
  assert.equal(collectionConfig.reroll.contractHookRequiredAtLaunch, true);
  assert.equal(collectionConfig.metadata.reveal, "commit-future-block-permutation");
  assert.equal(
    collectionConfig.assignments.provenanceHash,
    "0x2b3049a8235d705dba39542b53990e584e3815e4e6a32efae6ecb810b8f506a3",
  );
  assert.equal(collectionConfig.owner, "0xC7f55cE6A7dF9A79cc4A643a5081230F890c7AA6");
  assert.equal(collectionConfig.treasury, collectionConfig.owner);
  assert.equal(collectionConfig.royalty.basisPoints, 300);
  assert.equal(collectionConfig.royalty.receiver, collectionConfig.treasury);
  assert.deepEqual(collectionConfig.ownerReserve, {
    allocation: 150,
    recipientPolicy: "current-collection-owner",
    mintTiming: "first-gtd-activation",
    paid: false,
    countsTowardSecondaryTradingThreshold: true,
  });
  assert.equal(collectionConfig.gtd.mintType, "paid");
  assert.equal(collectionConfig.gtd.monadHolders.sourceContract, "0x349D8eb480c92cF75371fbA5C6344A4d11b9103A");
  assert.equal(collectionConfig.gtd.monadHolders.snapshotBlock, 93374159);
  assert.equal(collectionConfig.gtd.monadHolders.snapshotManifest, "data/robinhood/snapshots/hoodyoor-s2-holders-block-93374159.json");
  assert.equal(collectionConfig.gtd.monadHolders.maxMintPerHolder, 1);
  assert.equal(collectionConfig.gtd.robinhoodTopHolders.maxMintPerWallet, 3);
  assert.equal(collectionConfig.gtd.mergePolicy, "highest-source-allowance");
  assert.deepEqual(collectionConfig.secondaryTrading, {
    initiallyLocked: true,
    autoUnlockMintedSupply: 1667,
    threshold: "50%-rounded-up",
    ownerCanUnlockEarly: true,
    unlockIsPermanent: true,
    newApprovalsBlockedWhileLocked: true,
    ownerReserveCountsTowardThreshold: true,
  });
});

test("HoodYØØR holder snapshot grants one paid GTD spot per Monad holder", () => {
  assert.equal(holderSnapshot.source.blockNumber, 93374159);
  assert.equal(holderSnapshot.source.contract, collectionConfig.gtd.monadHolders.sourceContract);
  assert.equal(holderSnapshot.source.owner, collectionConfig.owner);
  assert.equal(holderSnapshot.source.treasury, "0x4D540f7D0Eb841c839334655C9f88313D750c6d5");
  assert.equal(holderSnapshot.summary.liveSourceTokens, 1038);
  assert.equal(holderSnapshot.summary.burnedSourceTokens, 58);
  assert.equal(holderSnapshot.summary.holderWallets, 133);
  assert.equal(holderSnapshot.summary.gtdEligibleWallets, 133);
  assert.equal(holderSnapshot.summary.gtdSpots, 133);
  assert.equal(
    holderSnapshot.holders.reduce((sum, holder) => sum + holder.quantity, 0),
    holderSnapshot.summary.liveSourceTokens,
  );
  assert.equal(new Set(holderSnapshot.holders.map((holder) => holder.address)).size, 133);
});

test("HoodYØØR backgrounds are ten 1/1s plus 3,323 INDAHOOD", () => {
  const oneOfOnes = [
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
  assert.deepEqual(catalog.traits.Background.map((trait) => trait.name), [...oneOfOnes, "INDAHOOD"]);
  assert.deepEqual(catalog.exactTraitCounts.Background, {
    ...Object.fromEntries(oneOfOnes.map((name) => [name, 1])),
    INDAHOOD: 3323,
  });
  assert.equal(Object.values(catalog.exactTraitCounts.Background).reduce((sum, count) => sum + count, 0), 3333);
  assert.equal(exclusionAudit.summary.removedBackgroundTraitEntries, 12);
});

test("Robinhood catalog removes every requested Monad-specific trait", () => {
  const activeCatalogSections = {
    traits: catalog.traits,
    exactTraitCounts: catalog.exactTraitCounts,
    incompatibilityRules: catalog.incompatibilityRules,
    sequenceRules: catalog.sequenceRules,
  };

  assert.doesNotMatch(JSON.stringify(activeCatalogSections), excludedName);
  assert.equal(Object.values(catalog.traits).flat().length, 208);
  assert.equal(exclusionAudit.traits.length, 20);
  assert.deepEqual(
    Array.from(new Set(exclusionAudit.traits.map((trait) => trait.name))).sort(),
    [
      "10KSquad",
      "BOB Mask",
      "BOB-chain",
      "Emonad",
      "Shramp",
      "Shramp Beanie",
      "The Hive",
      "Molandak",
      "Monad Cap",
      "Monad Cap Black",
      "Monad Specs Black",
      "Monad Specs Gold",
      "Mouch",
      "Salmonad Mask",
    ].sort(),
  );
});

test("Robinhood catalog removes Special and Stickers/Body art as complete slots", () => {
  for (const slot of ["Special", "Stickers/Body art"]) {
    assert.equal(catalog.traits[slot], undefined);
    assert.ok(!catalog.attributeOrder.includes(slot));
    assert.ok(!catalog.renderOrder.includes(slot));
    assert.ok(!catalog.mutableLayers.includes(slot));
    assert.ok(!catalog.requiredLayers.includes(slot));
    assert.equal(catalog.none[slot], undefined);
    assert.equal(catalog.sequenceRules.traitCooldowns[slot], undefined);
  }
  assert.equal(exclusionAudit.summary.removedSlotTraitEntries, 13);
});

test("Robinhood catalog adds the background and three Robinhood wearables", () => {
  const expected = [
    ["Background", 122, "INDAHOOD"],
    ["Clothes", 3057, "Robinhood Green Tee"],
    ["Eyes", 5032, "Robinhood Green Shades"],
    ["Hat", 6042, "Robinhood Feather Cap"],
  ];

  for (const [slot, traitId, name] of expected) {
    const trait = catalog.traits[slot].find((entry) => entry.name === name);
    assert.equal(trait?.traitId, traitId);
  }
});

test("Robinhood catalog excludes the paused chain, GameStop, and AMC traits", () => {
  const removedNames = [
    "Robinhood Feather Chain",
    "GameStop Tee",
    "AMC Tee",
    "GameStop Cap",
    "AMC Cap",
  ];
  const activeNames = Object.values(catalog.traits).flat().map((entry) => entry.name);
  const manifestNames = assetManifest.traits.map((entry) => entry.name);

  for (const name of removedNames) {
    assert.ok(!activeNames.includes(name));
    assert.ok(!manifestNames.includes(name));
    assert.ok(!Object.keys(itemMetadata).some((key) => key.endsWith(`::${name}`)));
  }
});

test("Robinhood trait-item metadata contains no excluded trait records", () => {
  assert.equal(Object.keys(itemMetadata).length, 171);
  for (const [key, value] of Object.entries(itemMetadata)) {
    assert.doesNotMatch(key, excludedName);
    assert.doesNotMatch(String(value?.name || ""), excludedName);
  }
});

test("Robinhood asset manifest covers every retained and newly added layer", () => {
  assert.equal(assetManifest.summary.nonNoneTraitEntries, 201);
  assert.equal(assetManifest.summary.excludedTraitEntries, 20);
  assert.deepEqual(assetManifest.summary.missing, []);
  assert.deepEqual(assetManifest.summary.availability, {
    local: 33,
    "local-and-remote": 168,
  });

  for (const trait of assetManifest.traits) {
    assert.ok(trait.localPath.startsWith("data/robinhood/layers/"));
    assert.ok(fs.existsSync(trait.localPath), trait.localPath);
  }
});

test("Robinhood layer folders contain every retained non-None trait", () => {
  assert.equal(layerPopulation.summary.activeTraitLayers, 201);
  assert.equal(layerPopulation.summary.populatedTraitLayers, 201);
  assert.deepEqual(layerPopulation.summary.resolutions, {
    "4096x4096": 172,
    "1024x1024": 29,
  });
  assert.deepEqual(layerPopulation.summary.invalid, []);

  for (const layer of layerPopulation.layers) {
    assert.ok(layer.path.startsWith("data/robinhood/layers/"));
    assert.ok(fs.existsSync(layer.path), layer.path);
    assert.doesNotMatch(layer.name, excludedName);
    assert.ok(!["Special", "Stickers/Body art"].includes(layer.slot));
  }
});

test("Robinhood item metadata points at populated local layers", () => {
  for (const value of Object.values(itemMetadata)) {
    if (!value?.localImage) continue;
    assert.ok(value.localImage.startsWith("data/robinhood/layers/"));
    assert.ok(fs.existsSync(value.localImage), value.localImage);
  }
});
