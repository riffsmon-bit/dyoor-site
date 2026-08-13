import assert from "node:assert/strict";
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
const rulesManifest = JSON.parse(fs.readFileSync(
  "data/robinhood/onchain-128/hoodyoor-reroll-rules.json",
  "utf8",
));
const encodedRules = fs.readFileSync(
  "data/robinhood/onchain-128/hoodyoor-reroll-rules.bin",
);

const layers = new Map(catalog.renderOrder.map((slot, layer) => [slot, layer]));
const traits = new Map(assetManifest.traits.map((trait) => [
  `${trait.slot}::${trait.name}`,
  { ...trait, layer: layers.get(trait.slot) },
]));

function encodedPair(left, right) {
  const lower = left.layer < right.layer ? left : right;
  const upper = left.layer < right.layer ? right : left;
  const encoded = Buffer.alloc(6);
  encoded[0] = lower.layer;
  encoded.writeUInt16BE(lower.traitId, 1);
  encoded[3] = upper.layer;
  encoded.writeUInt16BE(upper.traitId, 4);
  return encoded;
}

function expectedPairs() {
  const pairs = new Map();
  const add = (left, right) => {
    const encoded = encodedPair(left, right);
    pairs.set(encoded.toString("hex"), encoded);
  };

  for (const rule of catalog.incompatibilityRules || []) {
    if (rule?.enabled === false) continue;
    const triggerEntries = Object.entries(rule.if || {});
    assert.equal(triggerEntries.length, 1, rule.name);
    const [triggerSlot, triggerNames] = triggerEntries[0];
    for (const triggerName of triggerNames) {
      const trigger = traits.get(`${triggerSlot}::${triggerName}`);
      if (!trigger) continue;
      for (const [blockedSlot, blockedNames] of Object.entries(rule.cannot || {})) {
        for (const blockedName of blockedNames) {
          const blocked = traits.get(`${blockedSlot}::${blockedName}`);
          if (blocked) add(trigger, blocked);
        }
      }
    }
  }

  for (const trait of assetManifest.traits.filter(({ slot }) => slot === "Accessories")) {
    const duplicate = traits.get(`Accessories 2::${trait.name}`);
    if (duplicate) add(traits.get(`Accessories::${trait.name}`), duplicate);
  }
  return [...pairs.values()].sort(Buffer.compare);
}

test("Robinhood reroll rule payload exactly encodes the retained catalog", () => {
  const expected = Buffer.concat(expectedPairs());
  assert.equal(expected.length, 329 * 6);
  assert.deepEqual(encodedRules, expected);
  assert.equal(rulesManifest.contract.expectedPairCount, 329);
  assert.equal(rulesManifest.totals.pairs, 329);
  assert.equal(rulesManifest.totals.catalogPairs, 323);
  assert.equal(rulesManifest.totals.duplicateAccessoryPairs, 6);
  assert.equal(rulesManifest.totals.bytes, 1974);
  assert.equal(keccak256(encodedRules), rulesManifest.contract.rulesHash);
  assert.equal(rulesManifest.totals.binaryKeccak256, rulesManifest.contract.rulesHash);
});

test("Robinhood reroll pairs are canonical, unique, and reference real traits", () => {
  const endpoints = new Set(assetManifest.traits.map((trait) => (
    `${layers.get(trait.slot)}:${trait.traitId}`
  )));
  const seen = new Set();
  let previous = -1n;

  for (let cursor = 0; cursor < encodedRules.length; cursor += 6) {
    const layerA = encodedRules[cursor];
    const traitA = encodedRules.readUInt16BE(cursor + 1);
    const layerB = encodedRules[cursor + 3];
    const traitB = encodedRules.readUInt16BE(cursor + 4);
    const endpointA = (BigInt(layerA) << 16n) | BigInt(traitA);
    const endpointB = (BigInt(layerB) << 16n) | BigInt(traitB);
    const pairKey = (endpointA << 24n) | endpointB;

    assert.ok(endpointA < endpointB, `non-canonical pair at ${cursor / 6}`);
    assert.ok(pairKey > previous, `unsorted or duplicate pair at ${cursor / 6}`);
    assert.ok(endpoints.has(`${layerA}:${traitA}`));
    assert.ok(endpoints.has(`${layerB}:${traitB}`));
    seen.add(`${layerA}:${traitA}:${layerB}:${traitB}`);
    previous = pairKey;
  }

  assert.equal(seen.size, 329);
  assert.ok(seen.has("4:4001:6:6008"), "Black Shystie must block AHHH Tongue");
  assert.ok(seen.has("7:7001:8:8001"), "duplicate Bandaid slots must be blocked");
});
