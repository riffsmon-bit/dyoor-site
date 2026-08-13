import { MOCK_HOLDER_DROIDS } from "../data/characters";
import { runtimeConfig } from "../config/runtimeConfig";
import { metadataSpriteTextureKey } from "../systems/sprites/MetadataDroidVisual";
import type { OwnedDroid, WalletConnection, WalletPort } from "../types/wallet";
import { normalizeMetadataTraits, stableTraitHash } from "./MetadataService";

const MOCK_ADDRESS = "0x000000000000000000000000000000000000d007";

function normalizeAddress(value: unknown) {
  const address = String(value || "").trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(address) ? address : "";
}

function validateDroids(value: unknown): OwnedDroid[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): OwnedDroid[] => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as OwnedDroid;
    if (!Number.isSafeInteger(candidate.tokenId) || candidate.tokenId < 1 || candidate.tokenId > 3333) return [];
    const traits = normalizeMetadataTraits(candidate.traits);
    if (!traits.length) return [];
    const metadataVersion = String(candidate.metadataVersion || "1").trim().slice(0, 64) || "1";
    const profile: OwnedDroid = {
      id: String(candidate.id || `s2-${candidate.tokenId}`).trim().slice(0, 96),
      displayName: String(candidate.displayName || `D.Y.O.O.R #${candidate.tokenId}`).trim().slice(0, 128),
      tokenId: candidate.tokenId,
      textureKey: "droid-metadata-pending",
      placeholder: candidate.placeholder !== false,
      traits,
      metadataVersion,
      traitHash: stableTraitHash(traits, metadataVersion),
    };
    return [{
      ...profile,
      // The host can supply metadata, but it cannot select an arbitrary local
      // texture key. Visual identity is derived only from normalized traits.
      textureKey: metadataSpriteTextureKey(profile),
    }];
  });
}

class UnavailableWallet implements WalletPort {
  readonly kind = "unavailable";
  readonly available = false;

  async connect(): Promise<WalletConnection> {
    throw new Error("Wallet mode requires the approved D.Y.O.O.R host bridge.");
  }

  async disconnect() {}

  async getAddress(): Promise<string> {
    throw new Error("Wallet is not connected.");
  }

  async getOwnedDroids() {
    return [];
  }

  async recheckOwnership() {
    return false;
  }
}

class HostWallet implements WalletPort {
  readonly kind = "host";
  readonly available = true;

  private bridge() {
    const bridge = window.dyoorGameHost;
    if (!bridge) throw new Error("D.Y.O.O.R host bridge is unavailable.");
    return bridge;
  }

  async connect() {
    const result = await this.bridge().connect();
    const address = normalizeAddress(result.address);
    if (!address || !result.authenticated) throw new Error("The host did not return an authenticated wallet.");
    return { address, authenticated: true };
  }

  async disconnect() {
    await this.bridge().disconnect?.();
  }

  async getAddress() {
    const address = normalizeAddress(await this.bridge().getAddress());
    if (!address) throw new Error("The host returned an invalid wallet.");
    return address;
  }

  async getOwnedDroids() {
    return validateDroids(await this.bridge().getOwnedS2Droids());
  }

  async recheckOwnership(tokenId: number) {
    if (!Number.isSafeInteger(tokenId) || tokenId < 1 || tokenId > 3333) return false;
    return Boolean(await this.bridge().verifyS2Ownership(tokenId));
  }
}

class MockWallet implements WalletPort {
  readonly kind = "mock";
  readonly available = true;
  private connected = false;

  async connect() {
    this.connected = true;
    return { address: MOCK_ADDRESS, authenticated: true };
  }

  async disconnect() {
    this.connected = false;
  }

  async getAddress() {
    if (!this.connected) throw new Error("Mock wallet is not connected.");
    return MOCK_ADDRESS;
  }

  async getOwnedDroids() {
    if (!this.connected) return [];
    return validateDroids(MOCK_HOLDER_DROIDS);
  }

  async recheckOwnership(tokenId: number) {
    return this.connected && MOCK_HOLDER_DROIDS.some((droid) => droid.tokenId === tokenId);
  }
}

export function createWalletService(): WalletPort {
  if (window.dyoorGameHost) return new HostWallet();
  if (runtimeConfig.mockWalletEnabled) return new MockWallet();
  return new UnavailableWallet();
}
