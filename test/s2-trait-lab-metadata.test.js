import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mergeMetadata,
  sanitizeOverrideAttributes,
} from "../lib/dyoor-s2-metadata.js";

const baseMetadata = {
  name: "D.Y.O.O.R #486",
  description: "Directive: Yield Opportunity Optimization Robots",
  image: "ipfs://base/486.png",
  attributes: [
    { trait_type: "Background", value: "Eye Sea U-Project M.A.D." },
    { trait_type: "Droid", value: "Lime Green" },
    { trait_type: "Eyes", value: "Okay" },
    { trait_type: "Clothes", value: "Neverland Tee" },
    { trait_type: "Mouth", value: "Joint Mouth" },
    { trait_type: "Hat", value: "Gotta Catchem Cap" },
    { trait_type: "Special", value: "None" },
    { trait_type: "Accessories", value: "None" },
    { trait_type: "Accessories 2", value: "The Hive" },
    { trait_type: "Stickers/Body art", value: "None" },
  ],
};

function traitMap(metadata) {
  return Object.fromEntries(metadata.attributes.map((attribute) => [attribute.trait_type, attribute.value]));
}

test("Trait Lab overrides cannot replace locked Background or Droid traits", () => {
  const metadata = mergeMetadata(baseMetadata, {
    version: 3,
    attributes: {
      Background: "Unknown",
      Droid: "Unknown",
      Special: "Anime Mask",
      Clothes: "None",
      Hat: "None",
      Accessories: "None",
      "Accessories 2": "None",
      "Stickers/Body art": "None",
    },
  }, 486);

  const traits = traitMap(metadata);
  assert.equal(traits.Background, "Eye Sea U-Project M.A.D.");
  assert.equal(traits.Droid, "Lime Green");
  assert.equal(traits.Special, "Anime Mask");
  assert.equal(traits.Clothes, "None");
  assert.equal(traits.Hat, "None");
  assert.equal(traits.Accessories, "None");
  assert.equal(traits["Accessories 2"], "None");
  assert.equal(traits["Stickers/Body art"], "None");
  assert.equal(traits.Eyes, "Okay");
  assert.equal(traits.Mouth, "Joint Mouth");
});

test("locked traits are stripped before Trait Lab overrides are saved", () => {
  assert.deepEqual(sanitizeOverrideAttributes({
    Background: "Unknown",
    Droid: "Unknown",
    Special: "Anime Mask",
    Clothes: "None",
  }), {
    Special: "Anime Mask",
    Clothes: "None",
  });
});
