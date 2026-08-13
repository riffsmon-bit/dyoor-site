import { describe, expect, it } from "vitest";
import { validateOwnedSelection } from "../src/services/OwnershipSelection";
import type { OwnedDroid, WalletPort } from "../src/types/wallet";

function droid(tokenId: number): OwnedDroid {
  return {
    id: `s2-${tokenId}`,
    displayName: `D.Y.O.O.R #${tokenId}`,
    tokenId,
    textureKey: "droid-training",
    placeholder: true,
    traits: [{ traitType: "Droid", value: "Red" }],
    metadataVersion: "1",
    traitHash: "fixture",
  };
}

function wallet(owned: number[], fail = false): WalletPort {
  return {
    kind: "host",
    available: true,
    connect: async () => ({ address: "0x1111111111111111111111111111111111111111", authenticated: true }),
    disconnect: async () => {},
    getAddress: async () => "0x1111111111111111111111111111111111111111",
    getOwnedDroids: async () => owned.map(droid),
    recheckOwnership: async (tokenId) => {
      if (fail) throw new Error("RPC failed");
      return owned.includes(tokenId);
    },
  };
}

describe("ownership selection", () => {
  it("accepts only a listed token that passes a fresh ownership read", async () => {
    await expect(validateOwnedSelection(wallet([16]), 16, [droid(16)])).resolves.toEqual({
      valid: true,
      reason: "",
    });
    expect((await validateOwnedSelection(wallet([]), 16, [droid(16)])).valid).toBe(false);
  });

  it("handles no-token and failed-RPC states without selecting", async () => {
    expect((await validateOwnedSelection(wallet([]), 16, [])).valid).toBe(false);
    expect((await validateOwnedSelection(wallet([16], true), 16, [droid(16)])).valid).toBe(false);
  });
});
