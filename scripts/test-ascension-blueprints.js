import assert from "node:assert/strict";
import {
  compareBlueprintToMintedNFT,
  getAscensionBlueprintBadgeFromList,
  isAscensionBlueprintWalletFromList,
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
  accessories: "BOB-chain"
};

assert.equal(normalizeTraitName("  BOB--chain  "), "bob chain");
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
