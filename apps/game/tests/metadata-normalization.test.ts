import { describe, expect, it } from "vitest";
import {
  normalizeMetadataRecord,
  normalizeTokenId,
  validateImageUrl,
} from "../scripts/lib/metadata";
import {
  normalizeTokenMetadata,
  safeAssetUrl,
  stableTraitHash,
} from "../src/services/MetadataService";
import { metadataFixture } from "./fixtures";

describe("metadata normalization", () => {
  it("accepts the verified 1–3333 range and rejects ambiguous IDs", () => {
    expect(normalizeTokenId("1")).toBe(1);
    expect(normalizeTokenId(3333)).toBe(3333);
    expect(normalizeTokenId(0)).toBeNull();
    expect(normalizeTokenId("1.5")).toBeNull();
    expect(normalizeTokenId("0x10")).toBeNull();
  });

  it("normalizes all required collection traits", () => {
    const record = normalizeMetadataRecord(16, metadataFixture(16));
    expect(record.tokenId).toBe(16);
    expect(record.attributes).toHaveLength(11);
    expect(record.attributes[1]).toEqual({ traitType: "Droid", value: "Red" });
  });

  it("produces a deterministic trait hash independent of input ordering", () => {
    const metadata = normalizeTokenMetadata(16, metadataFixture(16));
    const reversed = stableTraitHash([...metadata.traits].reverse(), metadata.metadataVersion);
    expect(reversed).toBe(metadata.traitHash);
  });

  it("rejects unsafe image schemes", () => {
    expect(validateImageUrl("javascript:alert(1)")).toBe("");
    expect(safeAssetUrl("data:text/html,boom")).toBe("");
    expect(safeAssetUrl("ipfs://bafyvalid/1.png")).toBe("ipfs://bafyvalid/1.png");
  });
});
