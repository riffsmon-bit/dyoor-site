export const ASCENSION_BLUEPRINT_TRAITS = [
  "background",
  "droid",
  "condition",
  "eyes",
  "clothes",
  "mouth",
  "hat",
  "special",
  "accessories",
  "accessories 2",
] as const;

export const ASCENSION_BLUEPRINT_LIMIT = 500;
export const ASCENSION_BLUEPRINT_LAUNCH_ISO = "2026-06-10T12:00:00-04:00";

export type BlueprintTrait = typeof ASCENSION_BLUEPRINT_TRAITS[number];
export type BlueprintTraits = Record<BlueprintTrait, string>;

export type BlueprintRegistration = {
  wallet?: string;
  traits: Partial<BlueprintTraits>;
  rank?: number;
  blueprintId?: string;
};

export type TraitDifference = {
  trait: BlueprintTrait;
  expected: string;
  actual: string;
};

export type BlueprintMatchResult = {
  wallet: string;
  blueprint: BlueprintRegistration;
  tokenId: string;
  mintedTraits: BlueprintTraits;
  ownershipConfirmed: boolean | null;
  rewardTier: string;
  exactMatch: boolean;
  matchedTraits: BlueprintTrait[];
  missingTraits: TraitDifference[];
  mismatchTraits: TraitDifference[];
  completionPercent: number;
};

const PUNCTUATION_NORMALIZERS: Array<[RegExp, string]> = [
  [/[\u2018\u2019]/g, "'"],
  [/[\u201C\u201D]/g, "\""],
  [/[\u2010-\u2015]/g, "-"],
  [/[._/\\]+/g, " "],
  [/\s*-\s*/g, " "],
  [/[^\w\s'"]/g, ""],
];

type MetadataAttribute = {
  trait_type?: string;
  name?: string;
  value?: string | number;
};

type MintedMetadata = {
  attributes?: MetadataAttribute[];
  traits?: Partial<Record<string, string>>;
  wallet?: string;
  owner?: string;
  minter?: string;
  rarity?: string;
  tier?: string;
  rewardTier?: string;
};

export function normalizeWalletAddress(walletAddress: string | undefined | null) {
  const value = String(walletAddress || "").trim();
  return /^0x[a-fA-F0-9]{40}$/.test(value) ? value.toLowerCase() : "";
}

export function normalizeTraitName(value: string | undefined | null) {
  let normalized = String(value || "").toLowerCase().trim();
  for (const [pattern, replacement] of PUNCTUATION_NORMALIZERS) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized.replace(/\s+/g, " ").trim();
}

export function normalizeBlueprintTraits(traits: Partial<Record<string, string>> = {}): BlueprintTraits {
  return ASCENSION_BLUEPRINT_TRAITS.reduce((acc, trait) => {
    acc[trait] = String(traits?.[trait] || "").trim();
    return acc;
  }, {} as BlueprintTraits);
}

export async function ascensionBlueprintTraitHash(traits: Partial<Record<string, string>> = {}) {
  const normalized = JSON.stringify(normalizeBlueprintTraits(traits));
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(normalized));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function ascensionBlueprintSignMessage(walletAddress: string, traits: Partial<Record<string, string>> = {}) {
  const wallet = normalizeWalletAddress(walletAddress);
  const hash = await ascensionBlueprintTraitHash(traits);
  return [
    "DYOOR Ascension Blueprint",
    `Wallet: ${wallet}`,
    `Traits: ${hash}`,
    `Launch: ${ASCENSION_BLUEPRINT_LAUNCH_ISO}`,
  ].join("\n");
}

export function attributesToTraitMap(metadata: MintedMetadata = {}) {
  const attributes = Array.isArray(metadata.attributes) ? metadata.attributes : [];
  const traits: Partial<Record<string, string>> = {};

  for (const item of attributes) {
    const type = normalizeTraitName(item?.trait_type || item?.name || "");
    const key = ASCENSION_BLUEPRINT_TRAITS.find((trait) => normalizeTraitName(trait) === type);
    if (key) traits[key] = String(item?.value || "").trim();
  }

  return normalizeBlueprintTraits({
    ...metadata.traits,
    ...traits,
  });
}

export function compareBlueprintToMintedNFT(
  blueprintTraits: Partial<Record<string, string>>,
  mintedTraits: Partial<Record<string, string>>,
) {
  const normalizedBlueprint = normalizeBlueprintTraits(blueprintTraits);
  const normalizedMinted = normalizeBlueprintTraits(mintedTraits);
  const matchedTraits: BlueprintTrait[] = [];
  const missingTraits: TraitDifference[] = [];
  const mismatchTraits: TraitDifference[] = [];

  for (const trait of ASCENSION_BLUEPRINT_TRAITS) {
    const expected = normalizedBlueprint[trait] || "";
    const actual = normalizedMinted[trait] || "";

    if (!actual) {
      missingTraits.push({ trait, expected, actual });
      continue;
    }

    if (normalizeTraitName(expected) === normalizeTraitName(actual)) {
      matchedTraits.push(trait);
    } else {
      mismatchTraits.push({ trait, expected, actual });
    }
  }

  return {
    exactMatch:
      matchedTraits.length === ASCENSION_BLUEPRINT_TRAITS.length
      && missingTraits.length === 0
      && mismatchTraits.length === 0,
    matchedTraits,
    missingTraits,
    mismatchTraits,
    completionPercent: Math.round((matchedTraits.length / ASCENSION_BLUEPRINT_TRAITS.length) * 100),
  };
}

export function getBlueprintRewardTier(mintedNFTMetadata: MintedMetadata = {}) {
  const rarity = normalizeTraitName(
    mintedNFTMetadata.rarity
    || mintedNFTMetadata.tier
    || mintedNFTMetadata.rewardTier
    || "",
  );

  if (rarity.includes("mythic")) return "Mythic Match";
  if (rarity.includes("legendary")) return "Legendary Match";
  if (rarity.includes("epic")) return "Epic Match";
  if (rarity.includes("rare")) return "Rare Match";
  return "Common Match";
}

export function rewardDescriptionForTier(tier: string) {
  switch (tier) {
    case "Mythic Match": return "Jackpot tier";
    case "Legendary Match": return "Larger MON prize + Monad NFT/token prize";
    case "Epic Match": return "Energy + MON + Monad ecosystem token";
    case "Rare Match": return "Energy + MON";
    case "Common Match":
    default:
      return "Energy";
  }
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url, { cache: "no-store" }).catch(() => null);
  if (!response?.ok) return null;
  return response.json().catch(() => null) as Promise<T | null>;
}

export async function fetchMintedNFTMetadata(tokenId: string) {
  const token = String(tokenId || "").trim();
  if (!token) throw new Error("Missing token ID.");

  const localPaths = [
    `/data/season2-metadata/${encodeURIComponent(token)}.json`,
    `/metadata/${encodeURIComponent(token)}.json`,
  ];

  for (const path of localPaths) {
    const metadata = await fetchJson<MintedMetadata>(path);
    if (metadata) return metadata;
  }

  throw new Error("Minted NFT metadata is not available yet. Add a metadata folder/API after reveal.");
}

export async function checkExactBlueprintMatch(walletAddress: string, tokenId: string): Promise<BlueprintMatchResult> {
  const wallet = normalizeWalletAddress(walletAddress);
  if (!wallet) throw new Error("Missing or invalid wallet.");

  const data = await fetchJson<{ registration?: BlueprintRegistration }>(
    `/api/ascension-blueprints?wallet=${encodeURIComponent(wallet)}`,
  );
  const blueprint = data?.registration;
  if (!blueprint) throw new Error("No saved Ascension Blueprint for this wallet.");

  const mintedNFTMetadata = await fetchMintedNFTMetadata(tokenId);
  const mintedOwner = normalizeWalletAddress(
    mintedNFTMetadata.wallet || mintedNFTMetadata.owner || mintedNFTMetadata.minter || "",
  );
  const ownershipConfirmed = mintedOwner ? mintedOwner === wallet : null;
  const mintedTraits = attributesToTraitMap(mintedNFTMetadata);
  const comparison = compareBlueprintToMintedNFT(blueprint.traits, mintedTraits);
  const rewardTier = comparison.exactMatch ? getBlueprintRewardTier(mintedNFTMetadata) : "";

  return {
    wallet,
    blueprint,
    tokenId: String(tokenId || "").trim(),
    mintedTraits,
    ownershipConfirmed,
    rewardTier,
    ...comparison,
  };
}
