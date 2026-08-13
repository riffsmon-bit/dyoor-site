import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import { keccak256 } from "ethers";

const catalog = JSON.parse(fs.readFileSync(
  "data/robinhood/dyoor-trait-catalog.json",
  "utf8",
));
const assetManifest = JSON.parse(fs.readFileSync(
  "data/robinhood/dyoor-trait-asset-manifest.json",
  "utf8",
));
const assignmentsManifest = JSON.parse(fs.readFileSync(
  "data/robinhood/onchain-128/hoodyoor-initial-assignments.json",
  "utf8",
));
const assignmentsBinary = fs.readFileSync(
  "data/robinhood/onchain-128/hoodyoor-initial-assignments.bin",
);
const rulesBinary = fs.readFileSync(
  "data/robinhood/onchain-128/hoodyoor-reroll-rules.bin",
);

const maxSupply = 3_333;
const bytesPerAssignment = 18;
const layerNames = catalog.renderOrder;
const excludedSequenceValues = new Set(catalog.sequenceRules.excludeValues || []);
const noImmediateRepeatLayers = new Set(catalog.sequenceRules.noImmediateRepeatLayers || []);
const traitCooldowns = catalog.sequenceRules.traitCooldowns || {};
const expectedProvenance = "0x2b3049a8235d705dba39542b53990e584e3815e4e6a32efae6ecb810b8f506a3";

const optionsByLayer = layerNames.map((slot) => {
  const options = (catalog.traits[slot] || [])
    .filter((trait) => trait.name !== "None")
    .map((trait) => ({ name: trait.name, traitId: Number(trait.traitId) }));
  if (catalog.none?.[slot]?.enabled) options.push({ name: "None", traitId: 0 });
  return new Map(options.map((option) => [option.traitId, option]));
});
const artEndpoints = new Set(assetManifest.traits.map((trait) => (
  `${layerNames.indexOf(trait.slot)}:${trait.traitId}`
)));

function canonicalPair(layerA, traitA, layerB, traitB) {
  return layerA < layerB
    ? `${layerA}:${traitA}:${layerB}:${traitB}`
    : `${layerB}:${traitB}:${layerA}:${traitA}`;
}

const incompatiblePairs = new Set();
for (let cursor = 0; cursor < rulesBinary.length; cursor += 6) {
  incompatiblePairs.add(canonicalPair(
    rulesBinary[cursor],
    rulesBinary.readUInt16BE(cursor + 1),
    rulesBinary[cursor + 3],
    rulesBinary.readUInt16BE(cursor + 4),
  ));
}

function decodePacked(buffer) {
  let packed = 0n;
  for (const byte of buffer) packed = (packed << 8n) | BigInt(byte);
  return {
    packed,
    traitIds: layerNames.map((_, layer) => (
      Number((packed >> BigInt(layer * 16)) & 0xffffn)
    )),
  };
}

const assignments = Array.from({ length: maxSupply }, (_, index) => (
  decodePacked(assignmentsBinary.subarray(
    index * bytesPerAssignment,
    (index + 1) * bytesPerAssignment,
  ))
));

function sequenceGap(slot, name) {
  if (excludedSequenceValues.has(name)) return 1;
  const immediateGap = noImmediateRepeatLayers.has(slot) ? 2 : 1;
  const cooldown = Math.max(0, Number(traitCooldowns?.[slot]?.[name]) || 0);
  return Math.max(immediateGap, cooldown + 1);
}

test("HoodYØØR assignment provenance is frozen to the exact 3,333-token payload", () => {
  assert.equal(assignmentsManifest.schema, "dyoor-hoodyoor-initial-assignments-v1");
  assert.deepEqual(assignmentsManifest.targetChain, { name: "Robinhood Chain", chainId: 4663 });
  assert.equal(assignmentsManifest.maxSupply, maxSupply);
  assert.equal(assignmentsBinary.length, maxSupply * bytesPerAssignment);
  assert.equal(assignmentsManifest.totals.assignments, maxSupply);
  assert.equal(assignmentsManifest.totals.bytes, assignmentsBinary.length);
  assert.equal(assignmentsManifest.totals.provenanceHash, expectedProvenance);
  assert.equal(assignmentsManifest.totals.binaryKeccak256, expectedProvenance);
  assert.equal(keccak256(assignmentsBinary), expectedProvenance);
  assert.equal(
    crypto.createHash("sha256").update(assignmentsBinary).digest("hex"),
    assignmentsManifest.totals.binarySha256,
  );
  assert.deepEqual(
    assignments.map(({ packed }) => packed.toString()),
    assignmentsManifest.packedTraits,
  );
});

test("every HoodYØØR assignment is unique, renderable, and reroll-rule compatible", () => {
  const unique = new Set();

  assignments.forEach(({ packed, traitIds }, assignmentIndex) => {
    assert.ok(!unique.has(packed.toString()), `duplicate assignment ${assignmentIndex + 1}`);
    unique.add(packed.toString());

    traitIds.forEach((traitId, layer) => {
      assert.ok(
        optionsByLayer[layer].has(traitId),
        `unknown trait ${layer}:${traitId} in assignment ${assignmentIndex + 1}`,
      );
      if (traitId) {
        assert.ok(
          artEndpoints.has(`${layer}:${traitId}`),
          `missing art ${layer}:${traitId} in assignment ${assignmentIndex + 1}`,
        );
      }
    });

    for (let left = 0; left < traitIds.length; left += 1) {
      if (!traitIds[left]) continue;
      for (let right = left + 1; right < traitIds.length; right += 1) {
        if (!traitIds[right]) continue;
        assert.ok(
          !incompatiblePairs.has(canonicalPair(left, traitIds[left], right, traitIds[right])),
          `incompatible assignment ${assignmentIndex + 1}`,
        );
      }
    }
  });

  assert.equal(unique.size, maxSupply);
  assert.equal(assignmentsManifest.totals.uniqueAssignments, maxSupply);
  assert.equal(assignmentsManifest.totals.compatibleAssignments, maxSupply);
});

test("HoodYØØR assignment counts preserve every generated and exact rarity", () => {
  const actualCounts = layerNames.map(() => new Map());
  assignments.forEach(({ traitIds }) => {
    traitIds.forEach((traitId, layer) => {
      const name = optionsByLayer[layer].get(traitId).name;
      actualCounts[layer].set(name, (actualCounts[layer].get(name) || 0) + 1);
    });
  });

  layerNames.forEach((slot, layer) => {
    const expected = assignmentsManifest.traitCounts[slot];
    assert.equal(Object.values(expected).reduce((sum, count) => sum + count, 0), maxSupply);
    for (const [name, count] of Object.entries(expected)) {
      assert.equal(actualCounts[layer].get(name) || 0, count, `${slot}::${name}`);
    }
    for (const [name, count] of Object.entries(catalog.exactTraitCounts?.[slot] || {})) {
      assert.equal(actualCounts[layer].get(name) || 0, count, `${slot}::${name} exact count`);
    }
  });

  assert.equal(actualCounts[0].get("INDAHOOD"), 3_323);
  assert.equal(assignmentsManifest.exactBackgrounds.oneOfOnes.length, 10);
  assert.equal(new Set(
    assignmentsManifest.exactBackgrounds.oneOfOnes.map(({ assignmentId }) => assignmentId),
  ).size, 10);
});

test("HoodYØØR assignment order obeys all cooldown and no-repeat rules", () => {
  const lastOccurrence = layerNames.map(() => new Map());

  assignments.forEach(({ traitIds }, position) => {
    traitIds.forEach((traitId, layer) => {
      const name = optionsByLayer[layer].get(traitId).name;
      const previous = lastOccurrence[layer].get(name);
      const gap = sequenceGap(layerNames[layer], name);
      if (previous !== undefined) {
        assert.ok(
          position - previous >= gap,
          `${layerNames[layer]}::${name} repeated at ${previous + 1} and ${position + 1}`,
        );
      }
      lastOccurrence[layer].set(name, position);
    });
  });
});

test("HoodYØØR assignment batches cover every assignment exactly once", () => {
  let expectedStart = 1;
  for (const batch of assignmentsManifest.assignmentBatches) {
    assert.equal(batch.startAssignmentId, expectedStart);
    assert.ok(batch.endAssignmentId >= batch.startAssignmentId);
    assert.ok(batch.endAssignmentId - batch.startAssignmentId < 50);
    expectedStart = batch.endAssignmentId + 1;
  }
  assert.equal(expectedStart, maxSupply + 1);
  assert.equal(assignmentsManifest.assignmentBatches.length, 67);
});
