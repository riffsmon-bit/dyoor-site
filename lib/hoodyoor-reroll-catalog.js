import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const dataRoot = path.join(process.cwd(), "data", "robinhood");
const generatedRoot = path.join(dataRoot, "onchain-128");
const catalog = JSON.parse(fs.readFileSync(path.join(dataRoot, "dyoor-trait-catalog.json"), "utf8"));
const assetManifest = JSON.parse(fs.readFileSync(
  path.join(dataRoot, "dyoor-trait-asset-manifest.json"),
  "utf8",
));
const artManifest = JSON.parse(fs.readFileSync(
  path.join(generatedRoot, "hoodyoor-onchain-art-manifest.json"),
  "utf8",
));
const ruleManifest = JSON.parse(fs.readFileSync(
  path.join(generatedRoot, "hoodyoor-reroll-rules.json"),
  "utf8",
));
const artPayload = fs.readFileSync(path.join(generatedRoot, "hoodyoor-onchain-art.bin"));
const encodedRules = fs.readFileSync(path.join(generatedRoot, "hoodyoor-reroll-rules.bin"));

const layerNames = Object.freeze([...catalog.renderOrder]);
const mutableLayers = Object.freeze([2, 3, 4, 5, 6, 7, 8]);
const packedTraitMask = (1n << 144n) - 1n;
const traitByEndpoint = new Map();
const traitsByLayer = new Map(layerNames.map((_, layer) => [layer, []]));
const artByEndpoint = new Map();
const incompatiblePairs = new Set();

for (const trait of assetManifest.traits) {
  const layer = layerNames.indexOf(trait.slot);
  if (layer < 0) throw new Error(`Unknown HoodYØØR layer ${trait.slot}.`);
  const normalized = {
    layer,
    slot: trait.slot,
    traitId: Number(trait.traitId),
    name: trait.name,
    weight: Math.max(1, Number(trait.weight) || 1),
  };
  traitByEndpoint.set(`${layer}:${normalized.traitId}`, normalized);
  traitsByLayer.get(layer).push(normalized);
}

for (const record of artManifest.records) {
  artByEndpoint.set(`${record.layer}:${record.traitId}`, record);
}

for (let cursor = 0; cursor < encodedRules.length; cursor += 6) {
  const layerA = encodedRules[cursor];
  const traitA = encodedRules.readUInt16BE(cursor + 1);
  const layerB = encodedRules[cursor + 3];
  const traitB = encodedRules.readUInt16BE(cursor + 4);
  incompatiblePairs.add(`${layerA}:${traitA}:${layerB}:${traitB}`);
}

function parsePackedTraits(value) {
  let packed;
  try {
    packed = BigInt(value);
  } catch {
    throw new Error("Invalid packed HoodYØØR traits.");
  }
  if (packed < 0n || (packed & ~packedTraitMask) !== 0n) {
    throw new Error("Packed HoodYØØR traits use reserved bits.");
  }
  return packed;
}

function pairKey(layerA, traitA, layerB, traitB) {
  return layerA < layerB
    ? `${layerA}:${traitA}:${layerB}:${traitB}`
    : `${layerB}:${traitB}:${layerA}:${traitA}`;
}

function secureRandomInt(maxExclusive) {
  return crypto.randomInt(maxExclusive);
}

function weightedChoice(options, randomInt) {
  const total = options.reduce((sum, option) => sum + option.weight, 0);
  if (total <= 0) throw new Error("No weighted HoodYØØR traits are available.");
  let roll = randomInt(total);
  if (!Number.isInteger(roll) || roll < 0 || roll >= total) {
    throw new Error("HoodYØØR random source returned an invalid value.");
  }
  for (const option of options) {
    if (roll < option.weight) return option;
    roll -= option.weight;
  }
  return options.at(-1);
}

export function unpackHoodYoorTraits(value) {
  const packed = parsePackedTraits(value);
  return layerNames.map((_, layer) => Number((packed >> BigInt(layer * 16)) & 0xffffn));
}

export function packHoodYoorTraits(traits) {
  if (!Array.isArray(traits) || traits.length !== layerNames.length) {
    throw new Error("HoodYØØR requires exactly nine packed trait layers.");
  }
  return traits.reduce((packed, traitId, layer) => {
    if (!Number.isInteger(traitId) || traitId < 0 || traitId > 0xffff) {
      throw new Error(`Invalid HoodYØØR trait ID at layer ${layer}.`);
    }
    return packed | (BigInt(traitId) << BigInt(layer * 16));
  }, 0n);
}

export function hoodYoorTraitsAreCompatible(value) {
  const traits = Array.isArray(value) ? value : unpackHoodYoorTraits(value);
  for (let left = 0; left < traits.length; left += 1) {
    if (!traits[left]) continue;
    for (let right = left + 1; right < traits.length; right += 1) {
      if (traits[right] && incompatiblePairs.has(pairKey(left, traits[left], right, traits[right]))) {
        return false;
      }
    }
  }
  return true;
}

export function hoodYoorTraitSnapshot(value) {
  return unpackHoodYoorTraits(value).map((traitId, layer) => {
    const trait = traitId ? traitByEndpoint.get(`${layer}:${traitId}`) : null;
    if (traitId && !trait) throw new Error(`Unknown ${layerNames[layer]} trait ID ${traitId}.`);
    return {
      layer,
      slot: layerNames[layer],
      traitId,
      name: trait?.name || "None",
      mutable: mutableLayers.includes(layer),
    };
  });
}

export function generateHoodYoorRerollCandidate({
  packedTraits,
  action,
  layer,
  randomInt = secureRandomInt,
}) {
  const current = unpackHoodYoorTraits(packedTraits);
  if (!hoodYoorTraitsAreCompatible(current)) {
    throw new Error("The current HoodYØØR trait combination is incompatible.");
  }

  if (action === "single") {
    if (!mutableLayers.includes(layer)) throw new Error("Choose a mutable HoodYØØR layer.");
    if (!current[layer]) throw new Error(`${layerNames[layer]} is empty and cannot be rerolled.`);
    const candidates = traitsByLayer.get(layer).filter((trait) => {
      if (trait.traitId === current[layer]) return false;
      const next = [...current];
      next[layer] = trait.traitId;
      return hoodYoorTraitsAreCompatible(next);
    });
    if (!candidates.length) throw new Error(`No compatible ${layerNames[layer]} reroll is available.`);
    const selected = weightedChoice(candidates, randomInt);
    const next = [...current];
    next[layer] = selected.traitId;
    return {
      nextTraits: packHoodYoorTraits(next).toString(),
      changedLayers: [layer],
      selectedTraitId: selected.traitId,
    };
  }

  if (action !== "all") throw new Error("Unknown HoodYØØR reroll action.");
  const filledLayers = mutableLayers.filter((mutableLayer) => current[mutableLayer] !== 0);
  if (!filledLayers.length) throw new Error("No filled mutable HoodYØØR layers are available.");

  for (let attempt = 0; attempt < 200; attempt += 1) {
    const next = [...current];
    for (const mutableLayer of filledLayers) {
      const candidates = traitsByLayer.get(mutableLayer).filter(
        (trait) => trait.traitId !== current[mutableLayer],
      );
      next[mutableLayer] = weightedChoice(candidates, randomInt).traitId;
    }
    if (hoodYoorTraitsAreCompatible(next)) {
      return {
        nextTraits: packHoodYoorTraits(next).toString(),
        changedLayers: filledLayers,
        selectedTraitId: 0,
      };
    }
  }
  throw new Error("No compatible Reroll All result was found. Try again.");
}

function colorHex(red, green, blue) {
  return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function renderPackedLayer(packed) {
  let cursor = 0;
  const colorCount = packed[cursor++];
  const fragments = [];
  for (let colorIndex = 0; colorIndex < colorCount; colorIndex += 1) {
    const color = colorHex(packed[cursor], packed[cursor + 1], packed[cursor + 2]);
    cursor += 3;
    const rectangleCount = packed.readUInt16BE(cursor);
    cursor += 2;
    const commands = [];
    for (let rectangleIndex = 0; rectangleIndex < rectangleCount; rectangleIndex += 1) {
      const rectangle = packed.readUInt32BE(cursor);
      cursor += 4;
      const x = rectangle & 0x7f;
      const y = (rectangle >>> 7) & 0x7f;
      const width = ((rectangle >>> 14) & 0x7f) + 1;
      const height = ((rectangle >>> 21) & 0x7f) + 1;
      commands.push(`M${x} ${y}h${width}v${height}h-${width}z`);
    }
    fragments.push(`<path fill="${color}" d="${commands.join("")}"/>`);
  }
  if (cursor !== packed.length) throw new Error("Malformed HoodYØØR packed art layer.");
  return fragments.join("");
}

export function renderHoodYoorPackedSvg(value) {
  const traits = unpackHoodYoorTraits(value);
  const fragments = [];
  for (let layer = 0; layer < traits.length; layer += 1) {
    const traitId = traits[layer];
    if (!traitId) continue;
    const record = artByEndpoint.get(`${layer}:${traitId}`);
    if (!record) throw new Error(`Missing onchain art for ${layerNames[layer]} trait ${traitId}.`);
    const packed = artPayload.subarray(record.artOffset, record.artOffset + record.artLength);
    fragments.push(renderPackedLayer(packed));
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 128 128" shape-rendering="crispEdges">${fragments.join("")}</svg>`;
}

export const hoodYoorCatalogSummary = Object.freeze({
  layers: layerNames,
  mutableLayers,
  traits: assetManifest.traits.length,
  incompatibilities: incompatiblePairs.size,
  expectedPairCount: ruleManifest.contract.expectedPairCount,
  rulesHash: ruleManifest.contract.rulesHash,
});
