import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256 } from "ethers";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = path.join(projectRoot, "data", "robinhood");
const outputRoot = path.join(dataRoot, "onchain-128");
const catalogPath = path.join(dataRoot, "dyoor-trait-catalog.json");
const assetManifestPath = path.join(dataRoot, "dyoor-trait-asset-manifest.json");
const binaryPath = path.join(outputRoot, "hoodyoor-reroll-rules.bin");
const manifestPath = path.join(outputRoot, "hoodyoor-reroll-rules.json");

const recordBytes = 6;
const expectedPairCount = 329;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function relative(filePath) {
  return path.relative(projectRoot, filePath);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

const catalog = readJson(catalogPath);
const assetManifest = readJson(assetManifestPath);
const layerIndex = new Map(catalog.renderOrder.map((slot, index) => [slot, index]));
const traitByKey = new Map();
const traitByEndpoint = new Map();

for (const trait of assetManifest.traits) {
  const layer = layerIndex.get(trait.slot);
  if (layer === undefined) throw new Error(`Unknown trait slot ${trait.slot}.`);
  if (!Number.isInteger(trait.traitId) || trait.traitId <= 0 || trait.traitId > 0xffff) {
    throw new Error(`Invalid trait ID for ${trait.slot}::${trait.name}.`);
  }

  const key = `${trait.slot}::${trait.name}`;
  const endpoint = (layer << 16) | trait.traitId;
  if (traitByKey.has(key) || traitByEndpoint.has(endpoint)) {
    throw new Error(`Duplicate trait mapping for ${key}.`);
  }
  traitByKey.set(key, { ...trait, layer, endpoint });
  traitByEndpoint.set(endpoint, { ...trait, layer, endpoint });
}

const pairs = new Map();
const skippedReferences = [];
const skippedReferenceKeys = new Set();

function resolveTrait(slot, name, context) {
  const trait = traitByKey.get(`${slot}::${name}`);
  if (!trait) {
    const skippedKey = `${context.rule}::${context.side}::${slot}::${name}`;
    if (!skippedReferenceKeys.has(skippedKey)) {
      skippedReferenceKeys.add(skippedKey);
      skippedReferences.push({ ...context, slot, name });
    }
  }
  return trait;
}

function addPair(left, right, reason) {
  if (left.layer === right.layer) {
    throw new Error(`Pair ${left.slot}::${left.name} / ${right.slot}::${right.name} uses one layer.`);
  }

  const [lower, upper] = left.endpoint < right.endpoint ? [left, right] : [right, left];
  const pairKey = (BigInt(lower.endpoint) << 24n) | BigInt(upper.endpoint);
  const key = pairKey.toString();
  const existing = pairs.get(key);
  if (existing) {
    if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
    return;
  }

  pairs.set(key, {
    pairKey,
    layerA: lower.layer,
    slotA: lower.slot,
    traitA: lower.traitId,
    nameA: lower.name,
    layerB: upper.layer,
    slotB: upper.slot,
    traitB: upper.traitId,
    nameB: upper.name,
    reasons: [reason],
  });
}

for (const rule of catalog.incompatibilityRules || []) {
  if (rule?.enabled === false) continue;
  const triggers = Object.entries(rule?.if || {});
  if (triggers.length !== 1) {
    throw new Error(`Rule ${rule?.name || "unnamed"} must have exactly one trigger layer.`);
  }

  const [triggerSlot, triggerNames] = triggers[0];
  if (!Array.isArray(triggerNames) || triggerNames.length === 0) {
    throw new Error(`Rule ${rule?.name || "unnamed"} has no trigger traits.`);
  }

  for (const triggerName of triggerNames) {
    const trigger = resolveTrait(triggerSlot, triggerName, {
      rule: rule.name,
      side: "if",
    });
    if (!trigger) continue;

    for (const [blockedSlot, blockedNames] of Object.entries(rule?.cannot || {})) {
      if (!Array.isArray(blockedNames)) {
        throw new Error(`Rule ${rule?.name || "unnamed"} has invalid blocked traits.`);
      }
      for (const blockedName of blockedNames) {
        const blocked = resolveTrait(blockedSlot, blockedName, {
          rule: rule.name,
          side: "cannot",
        });
        if (blocked) addPair(trigger, blocked, rule.name || "Catalog incompatibility");
      }
    }
  }
}

const catalogPairCount = pairs.size;
const accessories = assetManifest.traits.filter((trait) => trait.slot === "Accessories");
for (const accessory of accessories) {
  const duplicate = traitByKey.get(`Accessories 2::${accessory.name}`);
  if (!duplicate) continue;
  addPair(
    traitByKey.get(`Accessories::${accessory.name}`),
    duplicate,
    `Duplicate visible accessory: ${accessory.name}`,
  );
}

const sortedPairs = [...pairs.values()].sort((left, right) => (
  left.pairKey < right.pairKey ? -1 : left.pairKey > right.pairKey ? 1 : 0
));
if (sortedPairs.length !== expectedPairCount) {
  throw new Error(`Expected ${expectedPairCount} incompatibilities, received ${sortedPairs.length}.`);
}

const binary = Buffer.alloc(sortedPairs.length * recordBytes);
sortedPairs.forEach((pair, index) => {
  const cursor = index * recordBytes;
  binary[cursor] = pair.layerA;
  binary.writeUInt16BE(pair.traitA, cursor + 1);
  binary[cursor + 3] = pair.layerB;
  binary.writeUInt16BE(pair.traitB, cursor + 4);
});

const rulesHash = keccak256(binary);
const report = {
  schema: "dyoor-hoodyoor-reroll-rules-v1",
  generatedAt: new Date().toISOString(),
  collection: "HoodYØØR",
  targetChain: assetManifest.targetChain,
  contract: {
    name: "HoodYOORTraitRules",
    expectedPairCount,
    rulesHash,
  },
  encoding: {
    byteOrder: "big-endian",
    recordBytes,
    fields: [
      { name: "layerA", bytes: 1 },
      { name: "traitA", bytes: 2 },
      { name: "layerB", bytes: 1 },
      { name: "traitB", bytes: 2 },
    ],
  },
  totals: {
    pairs: sortedPairs.length,
    catalogPairs: catalogPairCount,
    duplicateAccessoryPairs: sortedPairs.length - catalogPairCount,
    bytes: binary.length,
    binarySha256: sha256(binary),
    binaryKeccak256: rulesHash,
    skippedCatalogReferences: skippedReferences.length,
  },
  sources: {
    catalog: relative(catalogPath),
    catalogSha256: sha256(fs.readFileSync(catalogPath)),
    assetManifest: relative(assetManifestPath),
    assetManifestSha256: sha256(fs.readFileSync(assetManifestPath)),
  },
  binary: relative(binaryPath),
  skippedReferences,
  pairs: sortedPairs.map(({ pairKey, ...pair }) => ({
    pairKey: `0x${pairKey.toString(16).padStart(12, "0")}`,
    ...pair,
  })),
};

fs.mkdirSync(outputRoot, { recursive: true });
fs.writeFileSync(binaryPath, binary);
fs.writeFileSync(manifestPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(JSON.stringify({
  manifest: relative(manifestPath),
  binary: relative(binaryPath),
  rulesHash,
  totals: report.totals,
}, null, 2));
