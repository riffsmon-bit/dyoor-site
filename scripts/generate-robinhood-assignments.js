import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { concat, getBytes, keccak256, toBeHex, toUtf8Bytes } from "ethers";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = path.join(projectRoot, "data", "robinhood");
const generatedRoot = path.join(dataRoot, "onchain-128");
const catalogPath = path.join(dataRoot, "dyoor-trait-catalog.json");
const assetManifestPath = path.join(dataRoot, "dyoor-trait-asset-manifest.json");
const artManifestPath = path.join(generatedRoot, "hoodyoor-onchain-art-manifest.json");
const rulesManifestPath = path.join(generatedRoot, "hoodyoor-reroll-rules.json");
const rulesBinaryPath = path.join(generatedRoot, "hoodyoor-reroll-rules.bin");
const outputManifestPath = path.join(generatedRoot, "hoodyoor-initial-assignments.json");
const outputBinaryPath = path.join(generatedRoot, "hoodyoor-initial-assignments.bin");

const catalog = readJson(catalogPath);
const assetManifest = readJson(assetManifestPath);
const artManifest = readJson(artManifestPath);
const rulesManifest = readJson(rulesManifestPath);
const encodedRules = fs.readFileSync(rulesBinaryPath);
const maxSupply = 3_333;
const layerNames = [...catalog.renderOrder];
const layerIndex = new Map(layerNames.map((slot, index) => [slot, index]));
const excludedSequenceValues = new Set(catalog.sequenceRules?.excludeValues || []);
const noImmediateRepeatLayers = new Set(catalog.sequenceRules?.noImmediateRepeatLayers || []);
const traitCooldowns = catalog.sequenceRules?.traitCooldowns || {};
const incompatiblePairs = parseIncompatiblePairs(encodedRules);
const artEndpoints = new Set(
  assetManifest.traits.map((trait) => `${layerIndex.get(trait.slot)}:${trait.traitId}`),
);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonicalPair(layerA, traitA, layerB, traitB) {
  return layerA < layerB
    ? `${layerA}:${traitA}:${layerB}:${traitB}`
    : `${layerB}:${traitB}:${layerA}:${traitA}`;
}

function parseIncompatiblePairs(encoded) {
  if (!encoded.length || encoded.length % 6 !== 0) {
    throw new Error("HoodYØØR reroll rules must contain complete six-byte records.");
  }
  const pairs = new Set();
  for (let cursor = 0; cursor < encoded.length; cursor += 6) {
    const layerA = encoded[cursor];
    const traitA = encoded.readUInt16BE(cursor + 1);
    const layerB = encoded[cursor + 3];
    const traitB = encoded.readUInt16BE(cursor + 4);
    pairs.add(canonicalPair(layerA, traitA, layerB, traitB));
  }
  return pairs;
}

class DeterministicRandom {
  constructor(seed) {
    this.seed = getBytes(seed);
    this.counter = 0n;
  }

  integer(maxExclusive) {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
      throw new Error(`Invalid deterministic random range ${maxExclusive}.`);
    }
    const digest = keccak256(concat([this.seed, getBytes(toBeHex(this.counter, 32))]));
    this.counter += 1n;
    return Number(BigInt(digest) % BigInt(maxExclusive));
  }

  fork(label) {
    return new DeterministicRandom(keccak256(concat([this.seed, toUtf8Bytes(String(label))])));
  }
}

function optionRecords(slot) {
  const options = (catalog.traits?.[slot] || [])
    .filter((trait) => trait?.name !== "None")
    .map((trait) => ({
      layer: layerIndex.get(slot),
      slot,
      traitId: Number(trait.traitId),
      name: trait.name,
      weight: Math.max(0, Number(trait.weight) || 0),
      selectable: trait.selectable !== false,
    }));
  const none = catalog.none?.[slot];
  if (none?.enabled) {
    options.push({
      layer: layerIndex.get(slot),
      slot,
      traitId: 0,
      name: "None",
      weight: Math.max(0, Number(none.weight) || 0),
      selectable: Number(none.weight) > 0,
    });
  }
  return options;
}

const optionsByLayer = layerNames.map(optionRecords);
const optionByName = new Map(
  optionsByLayer.flatMap((options) => options.map((option) => [`${option.slot}::${option.name}`, option])),
);

function weightedChoice(options, random, weightFor = (option) => option.weight) {
  const weights = options.map((option) => Math.max(0, Number(weightFor(option)) || 0));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!total) throw new Error("Cannot choose from an empty HoodYØØR weighted set.");
  let roll = random.integer(total);
  for (let index = 0; index < options.length; index += 1) {
    if (roll < weights[index]) return options[index];
    roll -= weights[index];
  }
  return options.at(-1);
}

function targetCountsForLayer(layer, random) {
  const slot = layerNames[layer];
  const options = optionsByLayer[layer];
  const exact = catalog.exactTraitCounts?.[slot] || {};
  const counts = new Map(options.map((option) => [option.name, 0]));
  let assigned = 0;

  for (const [name, rawCount] of Object.entries(exact)) {
    const option = optionByName.get(`${slot}::${name}`);
    const count = Number(rawCount);
    if (!option || !Number.isSafeInteger(count) || count < 0) {
      throw new Error(`Invalid exact count for ${slot}::${name}.`);
    }
    counts.set(name, count);
    assigned += count;
  }
  if (assigned > maxSupply) throw new Error(`${slot} exact counts exceed collection supply.`);

  const weighted = options.filter((option) => (
    !Object.hasOwn(exact, option.name)
    && option.selectable
    && option.weight > 0
  ));
  while (assigned < maxSupply) {
    const selected = weightedChoice(weighted, random);
    counts.set(selected.name, (counts.get(selected.name) || 0) + 1);
    assigned += 1;
  }
  return counts;
}

function sequenceGap(slot, name) {
  if (excludedSequenceValues.has(name)) return 1;
  const noImmediateGap = noImmediateRepeatLayers.has(slot) ? 2 : 1;
  const cooldown = Math.max(0, Number(traitCooldowns?.[slot]?.[name]) || 0);
  return Math.max(noImmediateGap, cooldown + 1);
}

function rowCompatible(row) {
  for (let left = 0; left < row.length; left += 1) {
    if (!row[left]?.traitId) continue;
    for (let right = left + 1; right < row.length; right += 1) {
      if (
        row[right]?.traitId
        && incompatiblePairs.has(canonicalPair(left, row[left].traitId, right, row[right].traitId))
      ) return false;
    }
  }
  return true;
}

function partialCompatible(row, layer, option) {
  if (!option.traitId) return true;
  for (let otherLayer = 0; otherLayer < layer; otherLayer += 1) {
    const other = row[otherLayer];
    if (
      other?.traitId
      && incompatiblePairs.has(canonicalPair(otherLayer, other.traitId, layer, option.traitId))
    ) return false;
  }
  return true;
}

function compatibleWithAssigned(row, layer, option) {
  if (!option.traitId) return true;
  for (let otherLayer = 0; otherLayer < row.length; otherLayer += 1) {
    if (otherLayer === layer) continue;
    const other = row[otherLayer];
    if (
      other?.traitId
      && incompatiblePairs.has(canonicalPair(otherLayer, other.traitId, layer, option.traitId))
    ) return false;
  }
  return true;
}

function candidateOrder(candidates, counts, slot, position, random) {
  const forced = candidates.filter((option) => {
    const count = counts.get(option.name) || 0;
    const gap = sequenceGap(slot, option.name);
    return position >= maxSupply - 1 - ((count - 1) * gap);
  });
  return [...(forced.length ? forced : candidates)]
    .map((option) => {
      const weight = Math.max(
        1,
        (counts.get(option.name) || 0) * sequenceGap(slot, option.name),
      );
      const uniform = (random.integer(4_294_967_296) + 1) / 4_294_967_297;
      return { option, priority: -Math.log(uniform) / weight };
    })
    .sort((left, right) => left.priority - right.priority)
    .map(({ option }) => option);
}

function futureSequenceFeasible(layer, position, counts, lastOccurrence) {
  const slot = layerNames[layer];
  for (const option of optionsByLayer[layer]) {
    const remaining = counts.get(option.name) || 0;
    if (!remaining) continue;
    const gap = sequenceGap(slot, option.name);
    const previous = lastOccurrence.get(option.name);
    const earliest = previous === undefined
      ? position + 1
      : Math.max(position + 1, previous + gap);
    if (earliest + ((remaining - 1) * gap) > maxSupply - 1) return false;
  }
  return true;
}

function generateRows(targetCounts, seed) {
  const tailSize = 32;
  const searchNodeLimit = 50_000;
  // Generate the densely-connected hat/accessory layers before mouth and eyes.
  // This leaves the larger mouth/eye option sets to absorb their exclusions.
  const generationOrder = [0, 1, 2, 3, 6, 7, 8, 4, 5];

  for (let attempt = 0; attempt < 32; attempt += 1) {
    const random = new DeterministicRandom(
      keccak256(concat([getBytes(seed), toUtf8Bytes(`rows:${attempt}`)])),
    );
    const rows = Array.from(
      { length: maxSupply },
      () => Array.from({ length: layerNames.length }, () => null),
    );
    let failed = false;

    for (const layer of generationOrder) {
      const slot = layerNames[layer];
      let layerComplete = false;

      for (let layerAttempt = 0; layerAttempt < 16 && !layerComplete; layerAttempt += 1) {
        const layerRandom = random.fork(`${slot}:${layerAttempt}`);
        const counts = new Map(targetCounts[layer]);
        const lastOccurrence = new Map();
        const compatibleSuffix = new Map();
        const enforceUniqueRows = layer === generationOrder.at(-1);
        const seenRows = new Set();

        for (const option of optionsByLayer[layer]) {
          const suffix = new Uint16Array(maxSupply + 1);
          for (let position = maxSupply - 1; position >= 0; position -= 1) {
            suffix[position] = suffix[position + 1]
              + (compatibleWithAssigned(rows[position], layer, option) ? 1 : 0);
          }
          compatibleSuffix.set(option.name, suffix);
          if ((counts.get(option.name) || 0) > suffix[0]) {
            throw new Error(`${slot}::${option.name} has too few compatible assignment positions.`);
          }
        }

        rows.forEach((row) => { row[layer] = null; });

        function futureCompatible(position) {
          for (const option of optionsByLayer[layer]) {
            const remaining = counts.get(option.name) || 0;
            if (remaining > compatibleSuffix.get(option.name)[position + 1]) return false;
          }
          return true;
        }

        function chooseOption(position, onComplete) {
          const eligible = optionsByLayer[layer].filter((option) => {
            if ((counts.get(option.name) || 0) <= 0) return false;
            if (!compatibleWithAssigned(rows[position], layer, option)) return false;
            const previous = lastOccurrence.get(option.name);
            return previous === undefined || position - previous >= sequenceGap(slot, option.name);
          });
          const compatibilityForced = eligible.filter((option) => (
            (counts.get(option.name) || 0) > compatibleSuffix.get(option.name)[position + 1]
          ));
          if (compatibilityForced.length > 1) return false;
          const ordered = candidateOrder(
            compatibilityForced.length ? compatibilityForced : eligible,
            counts,
            slot,
            position,
            layerRandom,
          );

          for (const option of ordered) {
            const previousCount = counts.get(option.name);
            const previousOccurrence = lastOccurrence.get(option.name);
            counts.set(option.name, previousCount - 1);
            lastOccurrence.set(option.name, position);
            rows[position][layer] = option;
            const rowKey = enforceUniqueRows
              ? rows[position].map((rowOption) => rowOption.traitId).join(":")
              : null;

            if (
              futureSequenceFeasible(layer, position, counts, lastOccurrence)
              && futureCompatible(position)
              && (!enforceUniqueRows || !seenRows.has(rowKey))
              && onComplete(rowKey)
            ) return true;

            rows[position][layer] = null;
            counts.set(option.name, previousCount);
            if (previousOccurrence === undefined) lastOccurrence.delete(option.name);
            else lastOccurrence.set(option.name, previousOccurrence);
          }
          return false;
        }

        const tailStart = maxSupply - tailSize;
        let greedyComplete = true;
        for (let position = 0; position < tailStart; position += 1) {
          if (!chooseOption(position, (rowKey) => {
            if (rowKey) seenRows.add(rowKey);
            return true;
          })) {
            greedyComplete = false;
            break;
          }
        }

        let searchNodes = 0;
        function fillTail(position) {
          if (position === maxSupply) return true;
          searchNodes += 1;
          if (searchNodes > searchNodeLimit) return false;
          return chooseOption(position, (rowKey) => {
            if (rowKey) seenRows.add(rowKey);
            if (fillTail(position + 1)) return true;
            if (rowKey) seenRows.delete(rowKey);
            return false;
          });
        }

        layerComplete = greedyComplete && fillTail(tailStart);
        if (!layerComplete) {
          console.warn(
            `assignment attempt ${attempt + 1}, ${slot} pass ${layerAttempt + 1} failed after ${searchNodes} tail nodes`,
          );
        }
      }

      if (!layerComplete) {
        failed = true;
        console.warn(`assignment attempt ${attempt + 1} could not complete ${slot}; retrying`);
        break;
      }
      console.log(`assignment attempt ${attempt + 1}: completed ${slot}`);
    }

    if (failed) continue;
    const unique = new Set(rows.map((row) => row.map((option) => option.traitId).join(":")));
    if (unique.size === maxSupply) return rows;
    console.warn(
      `assignment attempt ${attempt + 1} produced ${maxSupply - unique.size} duplicate rows; retrying`,
    );
  }
  throw new Error("Unable to generate 3,333 unique compatible HoodYØØR assignments.");
}

function packTraits(row) {
  return row.reduce(
    (packed, option, layer) => packed | (BigInt(option.traitId) << BigInt(layer * 16)),
    0n,
  );
}

function packedBytes(packed) {
  const encoded = Buffer.alloc(18);
  let remaining = packed;
  for (let cursor = encoded.length - 1; cursor >= 0; cursor -= 1) {
    encoded[cursor] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  if (remaining !== 0n) throw new Error("Packed HoodYØØR assignment exceeds uint144.");
  return encoded;
}

function validateAssignments(rows, targetCounts) {
  if (rows.length !== maxSupply) throw new Error("Assignment supply mismatch.");
  const seen = new Set();
  const actualCounts = layerNames.map((slot, layer) => new Map(
    optionsByLayer[layer].map((option) => [option.name, 0]),
  ));
  const lastOccurrence = layerNames.map(() => new Map());

  rows.forEach((row, position) => {
    if (!rowCompatible(row)) throw new Error(`Incompatible assignment ${position + 1}.`);
    const packed = packTraits(row).toString();
    if (seen.has(packed)) throw new Error(`Duplicate assignment ${position + 1}.`);
    seen.add(packed);

    row.forEach((option, layer) => {
      if (option.traitId && !artEndpoints.has(`${layer}:${option.traitId}`)) {
        throw new Error(`Assignment ${position + 1} references missing art ${layer}:${option.traitId}.`);
      }
      actualCounts[layer].set(option.name, (actualCounts[layer].get(option.name) || 0) + 1);
      const gap = sequenceGap(layerNames[layer], option.name);
      const previous = lastOccurrence[layer].get(option.name);
      if (previous !== undefined && position - previous < gap) {
        throw new Error(`Assignment sequence violates ${layerNames[layer]}::${option.name}.`);
      }
      lastOccurrence[layer].set(option.name, position);
    });
  });

  for (let layer = 0; layer < layerNames.length; layer += 1) {
    for (const option of optionsByLayer[layer]) {
      const expected = targetCounts[layer].get(option.name) || 0;
      const actual = actualCounts[layer].get(option.name) || 0;
      if (actual !== expected) {
        throw new Error(`${layerNames[layer]}::${option.name} count ${actual} does not match ${expected}.`);
      }
    }
  }
  return actualCounts;
}

if (catalog.maxSupply !== maxSupply || layerNames.length !== 9) {
  throw new Error("HoodYØØR assignment generator requires the reviewed 3,333-token, nine-layer catalog.");
}
if (incompatiblePairs.size !== rulesManifest.contract.expectedPairCount || incompatiblePairs.size !== 329) {
  throw new Error("HoodYØØR assignment generator requires the frozen 329-pair rule set.");
}
if (assetManifest.traits.length !== 201 || artManifest.records.length !== 201) {
  throw new Error("HoodYØØR assignment generator requires all 201 retained art records.");
}

const catalogBytes = fs.readFileSync(catalogPath);
const catalogSha256 = sha256(catalogBytes);
const seed = keccak256(toUtf8Bytes([
  "HoodYOOR initial assignments v1",
  catalogSha256,
  artManifest.catalogHash,
  rulesManifest.contract.rulesHash,
].join("|")));
const countRandom = new DeterministicRandom(seed).fork("target-counts");
const targetCounts = layerNames.map((_, layer) => (
  targetCountsForLayer(layer, countRandom.fork(layerNames[layer]))
));
const rows = generateRows(targetCounts, seed);
const actualCounts = validateAssignments(rows, targetCounts);
const packed = rows.map(packTraits);
const binary = Buffer.concat(packed.map(packedBytes));
const assignmentsHash = keccak256(binary);
const oneOfOneAssignments = rows.flatMap((row, index) => (
  Number(catalog.exactTraitCounts?.Background?.[row[0].name]) === 1
    ? [{ assignmentId: index + 1, background: row[0].name, packedTraits: packed[index].toString() }]
    : []
));

const manifest = {
  schema: "dyoor-hoodyoor-initial-assignments-v1",
  collection: "HoodYØØR",
  targetChain: { name: "Robinhood Chain", chainId: 4663 },
  maxSupply,
  generator: {
    seed,
    algorithm: "weighted-exact-count-compatible-sequence-v1",
  },
  sources: {
    catalog: path.relative(projectRoot, catalogPath),
    catalogSha256,
    artManifest: path.relative(projectRoot, artManifestPath),
    artCatalogHash: artManifest.catalogHash,
    rulesManifest: path.relative(projectRoot, rulesManifestPath),
    rulesHash: rulesManifest.contract.rulesHash,
  },
  encoding: {
    byteOrder: "big-endian",
    bytesPerAssignment: 18,
    packedLayers: layerNames.map((slot, layer) => ({ slot, layer, offsetBits: layer * 16 })),
  },
  totals: {
    assignments: rows.length,
    uniqueAssignments: new Set(packed.map(String)).size,
    compatibleAssignments: rows.filter(rowCompatible).length,
    bytes: binary.length,
    binarySha256: sha256(binary),
    binaryKeccak256: assignmentsHash,
    provenanceHash: assignmentsHash,
  },
  exactBackgrounds: {
    INDAHOOD: actualCounts[0].get("INDAHOOD"),
    oneOfOnes: oneOfOneAssignments,
  },
  traitCounts: Object.fromEntries(layerNames.map((slot, layer) => [
    slot,
    Object.fromEntries(
      optionsByLayer[layer].map((option) => [option.name, actualCounts[layer].get(option.name) || 0]),
    ),
  ])),
  assignmentBatches: Array.from({ length: Math.ceil(maxSupply / 50) }, (_, index) => ({
    startAssignmentId: (index * 50) + 1,
    endAssignmentId: Math.min(maxSupply, (index + 1) * 50),
  })),
  packedTraits: packed.map(String),
};

fs.writeFileSync(outputBinaryPath, binary);
fs.writeFileSync(outputManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(JSON.stringify({
  outputManifest: path.relative(projectRoot, outputManifestPath),
  outputBinary: path.relative(projectRoot, outputBinaryPath),
  assignments: manifest.totals.assignments,
  uniqueAssignments: manifest.totals.uniqueAssignments,
  compatibleAssignments: manifest.totals.compatibleAssignments,
  bytes: manifest.totals.bytes,
  provenanceHash: manifest.totals.provenanceHash,
  oneOfOneAssignments: oneOfOneAssignments.length,
  assignmentBatches: manifest.assignmentBatches.length,
}, null, 2));
