import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
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
    version: 2,
    attributes: {
      Background: "Unknown",
      Droid: "Unknown",
      Eyes: "Scared",
      Clothes: "Black Hoodie",
    },
  }, 123);

  const traits = traitMap(metadata);
  assert.equal(traits.Background, "Eye Sea U-Project M.A.D.");
  assert.equal(traits.Droid, "Lime Green");
  assert.equal(traits.Eyes, "Scared");
  assert.equal(traits.Clothes, "Black Hoodie");
  assert.equal(traits.Mouth, "Joint Mouth");
  assert.equal(traits["Metadata Version"], "2");
});

test("legacy broken Special reroll for token 486 is ignored so base metadata is restored", () => {
  const metadata = mergeMetadata(baseMetadata, {
    version: 3,
    image: "ipfs://bad-render/486.png",
    attributes: {
      Background: "Unknown",
      Droid: "Unknown",
      Eyes: "None",
      Clothes: "None",
      Mouth: "None",
      Hat: "None",
      Special: "Anime Mask",
      Accessories: "None",
      "Accessories 2": "None",
      "Stickers/Body art": "None",
    },
  }, 486);

  const traits = traitMap(metadata);
  assert.equal(metadata.image, "ipfs://base/486.png");
  assert.equal(traits.Background, "Eye Sea U-Project M.A.D.");
  assert.equal(traits.Droid, "Lime Green");
  assert.equal(traits.Eyes, "Okay");
  assert.equal(traits.Clothes, "Neverland Tee");
  assert.equal(traits.Mouth, "Joint Mouth");
  assert.equal(traits.Hat, "Gotta Catchem Cap");
  assert.equal(traits.Special, "None");
  assert.equal(traits.Accessories, "None");
  assert.equal(traits["Accessories 2"], "The Hive");
  assert.equal(traits["Stickers/Body art"], "None");
  assert.equal(traits["Metadata Version"], "1");
});

test("locked traits are stripped before Trait Lab overrides are saved", () => {
  assert.deepEqual(sanitizeOverrideAttributes({
    Background: "Unknown",
    Droid: "Unknown",
    Special: "Anime Mask",
    Clothes: "None",
  }), {
    Clothes: "None",
  });
});

test("Trait Lab can save Special removal while still blocking new Special values", () => {
  assert.deepEqual(sanitizeOverrideAttributes({
    Special: "None",
    Hat: "None",
  }), {
    Special: "None",
    Hat: "None",
  });

  const metadata = mergeMetadata({
    ...baseMetadata,
    attributes: baseMetadata.attributes.map((attribute) => (
      attribute.trait_type === "Special" ? { ...attribute, value: "Anime Mask" } : attribute
    )),
  }, {
    version: 2,
    attributes: {
      Special: "None",
    },
  }, 123);

  const traits = traitMap(metadata);
  assert.equal(traits.Special, "None");
  assert.equal(traits.Background, "Eye Sea U-Project M.A.D.");
  assert.equal(traits.Droid, "Lime Green");
  assert.equal(traits["Metadata Version"], "2");
});

test("Hat overrides clear existing Bandanna accessory layers", () => {
  const metadata = mergeMetadata({
    ...baseMetadata,
    attributes: baseMetadata.attributes.map((attribute) => (
      attribute.trait_type === "Hat"
        ? { ...attribute, value: "None" }
        : attribute.trait_type === "Mouth"
          ? { ...attribute, value: "None" }
        : attribute.trait_type === "Accessories 2"
          ? { ...attribute, value: "Bandana Black" }
          : attribute
    )),
  }, {
    version: 2,
    attributes: {
      Hat: "Durag",
    },
  }, 759);

  const traits = traitMap(metadata);
  assert.equal(traits.Hat, "Durag");
  assert.equal(traits.Mouth, "Displeased");
  assert.equal(traits["Accessories 2"], "None");
  assert.equal(traits.Background, "Eye Sea U-Project M.A.D.");
  assert.equal(traits.Droid, "Lime Green");
  assert.equal(traits["Metadata Version"], "2");
});

test("category-specific bundled layers protect flat trait asset name collisions", () => {
  const requiredCollisionLayers = [
    "data/dyoor-s2-base-layers/Clothes/Tech Bro.png",
    "data/dyoor-s2-base-layers/Hat/Tech bro.png",
    "data/dyoor-s2-base-layers/Clothes/Luffy.png",
    "data/dyoor-s2-base-layers/Hat/Luffy.png",
  ];

  for (const filePath of requiredCollisionLayers) {
    assert.ok(fs.existsSync(filePath), `${filePath} is required for category-specific rendering`);
  }

  const techBroClothes = crypto.createHash("sha256")
    .update(fs.readFileSync("data/dyoor-s2-base-layers/Clothes/Tech Bro.png"))
    .digest("hex");
  const techBroHat = crypto.createHash("sha256")
    .update(fs.readFileSync("data/dyoor-s2-base-layers/Hat/Tech bro.png"))
    .digest("hex");

  assert.notEqual(techBroClothes, techBroHat);
});
