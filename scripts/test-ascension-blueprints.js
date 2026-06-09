import assert from "node:assert/strict";
import {
  compareBlueprintToMintedNFT,
  getAscensionBlueprintBadgeFromList,
  isAscensionBlueprintWalletFromList,
  normalizeBlueprintTraits,
  normalizeTraitName
} from "../src/ascensionBlueprintHelpers.js";

const wallet = "0x1234567890abcdef1234567890abcdef12345678";
const traits = {
  background: "Kinda Blue",
  droid: "Gold Chrome",
  condition: "S1 Skin",
  eyes: "Abyss Laser",
  clothes: "White Tee",
  mouth: "Gold Grill",
  hat: "Monad Cap",
  special: "None",
  accessories: "BOB-chain",
  "accessories 2": "Molandak"
};

assert.equal(normalizeTraitName("  BOB--chain  "), "bob chain");
assert.deepEqual(Object.keys(normalizeBlueprintTraits(traits)), [
  "background",
  "droid",
  "condition",
  "eyes",
  "clothes",
  "mouth",
  "hat",
  "special",
  "accessories",
  "accessories 2"
]);
assert.equal(isAscensionBlueprintWalletFromList(`0x${wallet.slice(2).toUpperCase()}`, [wallet]), true);
assert.deepEqual(getAscensionBlueprintBadgeFromList(wallet, [wallet]), {
  trait_type: "Ascension Blueprint",
  value: "Architect"
});

const exact = compareBlueprintToMintedNFT(traits, traits);
assert.equal(exact.exactMatch, true);
assert.equal(exact.completionPercent, 100);

const mismatch = compareBlueprintToMintedNFT(traits, { ...traits, hat: "Halo" });
assert.equal(mismatch.exactMatch, false);
assert.equal(mismatch.mismatchTraits.length, 1);
assert.equal(mismatch.mismatchTraits[0].trait, "hat");

console.log("Ascension Blueprint helper tests passed.");
