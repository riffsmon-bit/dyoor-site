import type { CharacterProfile, Trait } from "../types/game";
import { metadataSpriteTextureKey } from "../systems/sprites/MetadataDroidVisual";

const MAX_METADATA_BYTES = 512_000;
const MAX_TRAITS = 64;

export function safeAssetUrl(
  value: unknown,
  baseOrigin = typeof window === "undefined" ? "https://localhost" : window.location.origin,
) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 2048) return "";
  if (raw.startsWith("ipfs://")) {
    const path = raw.slice(7);
    return /^[a-zA-Z0-9/._-]+$/.test(path) ? raw : "";
  }
  try {
    const parsed = new URL(raw, baseOrigin);
    if (!["https:", "http:"].includes(parsed.protocol)) return "";
    if (parsed.protocol === "http:" && !["localhost", "127.0.0.1"].includes(parsed.hostname)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

export function normalizeMetadataTraits(value: unknown): Trait[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_TRAITS).flatMap((entry): Trait[] => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const traitType = String(record.trait_type || record.traitType || "").trim().slice(0, 64);
    const traitValue = String(record.value || "").trim().slice(0, 160);
    if (!traitType || !traitValue) return [];
    return [{ traitType, value: traitValue }];
  });
}

export function stableTraitHash(traits: Trait[], metadataVersion = "") {
  const canonical = JSON.stringify({
    metadataVersion,
    traits: [...traits]
      .map((trait) => ({ traitType: trait.traitType.trim(), value: trait.value.trim() }))
      .sort((left, right) => (
        left.traitType.localeCompare(right.traitType) || left.value.localeCompare(right.value)
      )),
  });
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export type TokenMetadata = {
  tokenId: number;
  name: string;
  image: string;
  traits: Trait[];
  metadataVersion: string;
  traitHash: string;
};

export function normalizeTokenMetadata(tokenId: number, value: unknown): TokenMetadata {
  if (!Number.isSafeInteger(tokenId) || tokenId < 1 || tokenId > 3333) {
    throw new Error("Token ID must be between 1 and 3333.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Metadata for token ${tokenId} is not an object.`);
  }
  const record = value as Record<string, unknown>;
  const traits = normalizeMetadataTraits(record.attributes);
  if (!traits.length) throw new Error(`Metadata for token ${tokenId} has no valid traits.`);
  const versionTrait = traits.find((trait) => trait.traitType === "Metadata Version");
  const metadataVersion = String(versionTrait?.value || record.metadata_version || "1").slice(0, 64);
  return {
    tokenId,
    name: String(record.name || `D.Y.O.O.R #${tokenId}`).trim().slice(0, 128),
    image: safeAssetUrl(record.image),
    traits,
    metadataVersion,
    traitHash: stableTraitHash(traits, metadataVersion),
  };
}

export class MetadataService {
  constructor(private readonly baseUrl: string) {}

  async loadToken(tokenId: number, signal?: AbortSignal): Promise<TokenMetadata> {
    if (!Number.isSafeInteger(tokenId) || tokenId < 1 || tokenId > 3333) {
      throw new Error("Token ID must be between 1 and 3333.");
    }
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), 8_000);
    const forwardAbort = () => controller.abort();
    signal?.addEventListener("abort", forwardAbort, { once: true });
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/+$/, "")}/${tokenId}`, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Metadata request failed with status ${response.status}.`);
      const declaredSize = Number(response.headers.get("content-length") || 0);
      if (declaredSize > MAX_METADATA_BYTES) throw new Error("Metadata response is too large.");
      const raw = await response.text();
      if (raw.length > MAX_METADATA_BYTES) throw new Error("Metadata response is too large.");
      return normalizeTokenMetadata(tokenId, JSON.parse(raw));
    } finally {
      globalThis.clearTimeout(timeout);
      signal?.removeEventListener("abort", forwardAbort);
    }
  }

  toCharacter(metadata: TokenMetadata): CharacterProfile {
    const profile: CharacterProfile = {
      id: `s2-${metadata.tokenId}`,
      displayName: metadata.name,
      tokenId: metadata.tokenId,
      textureKey: "droid-metadata-pending",
      placeholder: true,
      traits: metadata.traits,
      metadataVersion: metadata.metadataVersion,
      traitHash: metadata.traitHash,
    };
    return {
      ...profile,
      textureKey: metadataSpriteTextureKey(profile),
    };
  }
}
