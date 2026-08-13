import { describe, expect, it } from "vitest";
import { normalizeMetadataRecord } from "../scripts/lib/metadata";
import { computeTraitManifest } from "../scripts/lib/traits";
import { metadataFixture } from "./fixtures";

describe("trait manifest", () => {
  it("uses explicit production layer order before discovered categories", () => {
    const first = normalizeMetadataRecord(1, metadataFixture(1));
    const secondFixture = metadataFixture(2);
    secondFixture.attributes[1] = { trait_type: "Droid", value: "Blue" };
    const second = normalizeMetadataRecord(2, secondFixture);
    const manifest = computeTraitManifest([first, second], ["Droid", "Background"]);
    expect(manifest.attributeOrder.slice(0, 2)).toEqual(["Droid", "Background"]);
    expect(manifest.categories.Droid?.find((entry) => entry.value === "Red")?.count).toBe(1);
    expect(manifest.categories.Droid?.find((entry) => entry.value === "Blue")?.count).toBe(1);
  });
});
