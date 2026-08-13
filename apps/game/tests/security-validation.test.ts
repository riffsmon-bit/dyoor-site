import { describe, expect, it, vi } from "vitest";
import { assertPathInside, GAME_CACHE_ROOT } from "../scripts/lib/paths";
import { MetadataService, normalizeTokenMetadata } from "../src/services/MetadataService";
import { metadataFixture } from "./fixtures";

describe("untrusted input controls", () => {
  it("rejects path traversal outside pipeline roots", () => {
    expect(() => assertPathInside(GAME_CACHE_ROOT, "/tmp/escape.json", "fixture")).toThrow(/escapes/);
  });

  it("rejects missing and malicious metadata", () => {
    expect(() => normalizeTokenMetadata(1, null)).toThrow(/not an object/);
    const malicious = metadataFixture(1);
    malicious.image = "javascript:alert(1)";
    expect(normalizeTokenMetadata(1, malicious).image).toBe("");
  });

  it("surfaces a failed metadata request", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      throw new Error("RPC unavailable");
    }) as typeof fetch;
    try {
      await expect(new MetadataService("https://example.com/metadata").loadToken(1)).rejects.toThrow(
        /RPC unavailable/,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
