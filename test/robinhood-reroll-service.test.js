import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  generateHoodYoorRerollCandidate,
  hoodYoorCatalogSummary,
  hoodYoorTraitsAreCompatible,
  packHoodYoorTraits,
  renderHoodYoorPackedSvg,
  unpackHoodYoorTraits,
} from "../lib/hoodyoor-reroll-catalog.js";

const assetManifest = JSON.parse(fs.readFileSync(
  "data/robinhood/dyoor-trait-asset-manifest.json",
  "utf8",
));
const layerNames = [...hoodYoorCatalogSummary.layers];
const optionsByLayer = layerNames.map((slot) => (
  assetManifest.traits.filter((trait) => trait.slot === slot).map((trait) => trait.traitId)
));

function compatibleFullTraitSet() {
  const traits = Array.from({ length: layerNames.length }, () => 0);
  function fill(layer) {
    if (layer === traits.length) return true;
    for (const traitId of optionsByLayer[layer]) {
      traits[layer] = traitId;
      if (hoodYoorTraitsAreCompatible(traits) && fill(layer + 1)) return true;
    }
    traits[layer] = 0;
    return false;
  }
  assert.equal(fill(0), true, "catalog should contain a compatible full trait set");
  return traits;
}

function seededRandom(seed = 0x5eed1234) {
  let state = seed >>> 0;
  return (maxExclusive) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % maxExclusive;
  };
}

test("HoodYØØR reroll service loads the complete frozen catalog", () => {
  assert.equal(hoodYoorCatalogSummary.traits, 201);
  assert.equal(hoodYoorCatalogSummary.incompatibilities, 329);
  assert.equal(hoodYoorCatalogSummary.expectedPairCount, 329);
  assert.equal(
    hoodYoorCatalogSummary.rulesHash,
    "0x14a33149be765254e70441c4ba2674c662f5b3f746fb3ac8a717a4f49b47ab0f",
  );
  assert.deepEqual(hoodYoorCatalogSummary.mutableLayers, [2, 3, 4, 5, 6, 7, 8]);
});

test("packed HoodYØØR traits round-trip nine uint16 layers and reject reserved bits", () => {
  const traits = compatibleFullTraitSet();
  const packed = packHoodYoorTraits(traits);
  assert.deepEqual(unpackHoodYoorTraits(packed), traits);
  assert.throws(() => unpackHoodYoorTraits(1n << 144n), /reserved bits/i);
  assert.throws(() => packHoodYoorTraits(traits.slice(0, 8)), /exactly nine/i);
});

test("single rerolls change only the chosen layer and remain compatible", () => {
  const current = compatibleFullTraitSet();
  const layer = 4;
  const result = generateHoodYoorRerollCandidate({
    packedTraits: packHoodYoorTraits(current),
    action: "single",
    layer,
    randomInt: seededRandom(),
  });
  const next = unpackHoodYoorTraits(result.nextTraits);
  assert.notEqual(next[layer], current[layer]);
  assert.deepEqual(result.changedLayers, [layer]);
  for (let index = 0; index < current.length; index += 1) {
    if (index !== layer) assert.equal(next[index], current[index]);
  }
  assert.equal(hoodYoorTraitsAreCompatible(next), true);
});

test("reroll all preserves locked layers and replaces every filled mutable layer", () => {
  const current = compatibleFullTraitSet();
  const result = generateHoodYoorRerollCandidate({
    packedTraits: packHoodYoorTraits(current),
    action: "all",
    layer: 255,
    randomInt: seededRandom(0xd1007),
  });
  const next = unpackHoodYoorTraits(result.nextTraits);
  assert.equal(next[0], current[0]);
  assert.equal(next[1], current[1]);
  for (const layer of hoodYoorCatalogSummary.mutableLayers) {
    assert.notEqual(next[layer], current[layer], `${layerNames[layer]} should change`);
  }
  assert.equal(hoodYoorTraitsAreCompatible(next), true);
});

test("exact preview SVG decodes committed art, including a standalone mouth", () => {
  const current = compatibleFullTraitSet();
  const fullSvg = renderHoodYoorPackedSvg(packHoodYoorTraits(current));
  assert.match(fullSvg, /^<svg /);
  assert.match(fullSvg, /viewBox="0 0 128 128"/);
  assert.match(fullSvg, /shape-rendering="crispEdges"/);
  assert.match(fullSvg, /<path fill="#[a-f0-9]{6}" d="M/);
  assert.doesNotMatch(fullSvg, /<script|<image|(?:xlink:)?href=/i);

  const mouthOnly = Array.from({ length: 9 }, () => 0);
  mouthOnly[4] = current[4];
  const mouthSvg = renderHoodYoorPackedSvg(packHoodYoorTraits(mouthOnly));
  assert.match(mouthSvg, /<path fill=/, "the chosen mouth must have committed pixel art");
});

test("Robinhood Trait Lab binds signed previews to Energy, ETH, or USDG settlement", () => {
  const server = fs.readFileSync("lib/hoodyoor-reroll-server.ts", "utf8");
  const client = fs.readFileSync("components/robinhood/HoodYoorTraitLabClient.tsx", "utf8");
  const controller = fs.readFileSync("contracts/hoodyoor/src/HoodYOORRerollControllerV2.sol", "utf8");
  const nextConfig = fs.readFileSync("next.config.mjs", "utf8");

  assert.match(server, /HOODYOOR_TRAIT_LAB_ENABLED/);
  assert.match(server, /personalSignatureMatches/);
  assert.match(server, /ERC1271_MAGIC_VALUE/);
  assert.match(server, /deterministicRerollRandomInt/);
  assert.match(server, /resultSigner\.signTypedData/);
  assert.match(server, /quotePayment/);
  assert.match(server, /confirmRerollEnergy\.staticCall/);
  assert.match(server, /controller\.confirmRerollEnergy\(/);
  assert.match(server, /DIRECT_PAYMENT_REQUIRED/);
  assert.match(server, /energyBank\.hasRole/);
  assert.match(server, /collection\.revealed/);
  assert.match(server, /COLLECTION_UNREVEALED/);
  assert.match(server, /tokenNonces/);
  assert.doesNotMatch(server, /NEXT_PUBLIC_[A-Z_]*PRIVATE_KEY/);
  assert.match(client, /eth_signTypedData_v4/);
  assert.match(client, /hoodYoorPreviewRequestMessage/);
  assert.match(client, /\/api\/robinhood\/trait-lab\/confirm/);
  assert.match(client, /confirmRerollETH/);
  assert.match(client, /confirmRerollUSDG/);
  assert.match(client, /allowance/);
  assert.match(client, /approve/);
  assert.match(controller, /energyBank\.spendEnergy/);
  assert.match(controller, /msg\.value != authorization\.paymentAmount/);
  assert.match(controller, /_safeUSDGTransferFrom/);
  assert.match(controller, /collection\.applyReroll/);
  assert.match(controller, /tokenNonces\[authorization\.tokenId\] = nonce \+ 1/);
  assert.match(controller, /paymentConfigurationFrozen/);
  assert.match(nextConfig, /hoodyoor-onchain-art\.bin/);
  assert.match(nextConfig, /hoodyoor-reroll-rules\.bin/);
});
