import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  accessoryLayerGroup,
  accessoryLayerSideEffect,
  accessoryLayersConflict,
} from "../lib/s2-trait-accessory-rules.ts";

const sameShoulderCompanions = ["The Hive", "Molandak", "Mouch", "10KSquad"];

test("Shramp occupies the opposite shoulder and preserves either accessory slot", () => {
  assert.equal(accessoryLayerGroup("Shramp"), "opposite-shoulder companion accessory");

  for (const companion of sameShoulderCompanions) {
    assert.equal(accessoryLayersConflict("Shramp", companion), false);
    assert.deepEqual(accessoryLayerSideEffect({
      Accessories: "Shramp",
      "Accessories 2": companion,
    }, "Accessories"), {});
    assert.deepEqual(accessoryLayerSideEffect({
      Accessories: "Shramp",
      "Accessories 2": companion,
    }, "Accessories 2"), {});
    assert.deepEqual(accessoryLayerSideEffect({
      Accessories: companion,
      "Accessories 2": "Shramp",
    }, "Accessories"), {});
    assert.deepEqual(accessoryLayerSideEffect({
      Accessories: companion,
      "Accessories 2": "Shramp",
    }, "Accessories 2"), {});
  }
});

test("same-shoulder companions still replace one another", () => {
  assert.equal(accessoryLayersConflict("The Hive", "10KSquad"), true);
  assert.deepEqual(accessoryLayerSideEffect({
    Accessories: "The Hive",
    "Accessories 2": "10KSquad",
  }, "Accessories"), {
    "Accessories 2": "None",
  });
});

test("Marketplace and Trait Lab consume the same accessory side-effect policy", () => {
  const traitLabSource = fs.readFileSync("lib/s2-trait-lab.ts", "utf8");
  const marketplaceSource = fs.readFileSync("lib/s2-trait-marketplace.ts", "utf8");

  assert.match(traitLabSource, /accessoryLayerSideEffect\(traits, changedTraitType\)/);
  assert.match(marketplaceSource, /prepareTraitMarketplaceSelection/);
});
