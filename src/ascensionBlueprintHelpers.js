export const ASCENSION_BLUEPRINT_LIMIT = 500;
export const ASCENSION_BLUEPRINT_LAUNCH_ISO = "2026-06-10T12:00:00-04:00";
export const ASCENSION_BLUEPRINT_LAUNCH_LABEL = "EST";
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
  "accessories 2"
];

const PUNCTUATION_NORMALIZERS = [
  [/[\u2018\u2019]/g, "'"],
  [/[\u201C\u201D]/g, "\""],
  [/[\u2010-\u2015]/g, "-"],
  [/[._/\\]+/g, " "],
  [/\s*-\s*/g, " "],
  [/[^\w\s'"]/g, ""]
];

export function normalizeWalletAddress(walletAddress) {
  const value = String(walletAddress || "").trim();
  return /^0x[a-fA-F0-9]{40}$/.test(value) ? value.toLowerCase() : "";
}

export function blueprintIdForRank(rank) {
  const value = Number(rank);
  return `AB-${String(Number.isFinite(value) && value > 0 ? Math.floor(value) : 0).padStart(4, "0")}`;
}

export async function ascensionBlueprintTraitHash(traits = {}) {
  const normalized = JSON.stringify(normalizeBlueprintTraits(traits));
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(normalized));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function ascensionBlueprintSignMessage(walletAddress, traits = {}) {
  const wallet = normalizeWalletAddress(walletAddress);
  const hash = await ascensionBlueprintTraitHash(traits);
  return [
    "DYOOR Ascension Blueprint",
    `Wallet: ${wallet}`,
    `Traits: ${hash}`,
    `Launch: ${ASCENSION_BLUEPRINT_LAUNCH_ISO}`
  ].join("\n");
}

export function normalizeTraitName(value) {
  let normalized = String(value || "").toLowerCase().trim();
  for (const [pattern, replacement] of PUNCTUATION_NORMALIZERS) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized.replace(/\s+/g, " ").trim();
}

export function normalizeBlueprintTraits(traits = {}) {
  return ASCENSION_BLUEPRINT_TRAITS.reduce((acc, trait) => {
    acc[trait] = String(traits?.[trait] || "").trim();
    return acc;
  }, {});
}

export function attributesToTraitMap(metadata = {}) {
  const attributes = Array.isArray(metadata?.attributes) ? metadata.attributes : [];
  const traits = {};

  for (const item of attributes) {
    const type = normalizeTraitName(item?.trait_type || item?.name || "");
    const key = ASCENSION_BLUEPRINT_TRAITS.find((trait) => normalizeTraitName(trait) === type);
    if (key) traits[key] = String(item?.value || "").trim();
  }

  return normalizeBlueprintTraits({
    ...metadata?.traits,
    ...traits
  });
}

export function compareBlueprintToMintedNFT(blueprintTraits, mintedTraits) {
  const normalizedBlueprint = normalizeBlueprintTraits(blueprintTraits);
  const normalizedMinted = normalizeBlueprintTraits(mintedTraits);
  const matchedTraits = [];
  const missingTraits = [];
  const mismatchTraits = [];

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

  const exactMatch = matchedTraits.length === ASCENSION_BLUEPRINT_TRAITS.length
    && missingTraits.length === 0
    && mismatchTraits.length === 0;

  return {
    exactMatch,
    matchedTraits,
    missingTraits,
    mismatchTraits,
    completionPercent: Math.round((matchedTraits.length / ASCENSION_BLUEPRINT_TRAITS.length) * 100)
  };
}

export function isAscensionBlueprintWalletFromList(walletAddress, wallets = []) {
  const normalized = normalizeWalletAddress(walletAddress);
  if (!normalized || !Array.isArray(wallets)) return false;
  return wallets.map(normalizeWalletAddress).includes(normalized);
}

export function getAscensionBlueprintBadgeFromList(walletAddress, wallets = []) {
  if (!isAscensionBlueprintWalletFromList(walletAddress, wallets)) return null;
  // During Season 2 reveal, NFTs minted by registered wallets can receive this metadata badge.
  return {
    trait_type: "Ascension Blueprint",
    value: "Architect"
  };
}

export async function loadAscensionBlueprintWallets() {
  const response = await fetch("/data/ascension-blueprint-wallets.json", { cache: "no-store" });
  if (!response.ok) return [];
  const wallets = await response.json().catch(() => []);
  return Array.isArray(wallets) ? wallets.map(normalizeWalletAddress).filter(Boolean) : [];
}

export async function isAscensionBlueprintWallet(walletAddress) {
  const wallets = await loadAscensionBlueprintWallets();
  return isAscensionBlueprintWalletFromList(walletAddress, wallets);
}

export async function getAscensionBlueprintBadge(walletAddress) {
  const wallets = await loadAscensionBlueprintWallets();
  return getAscensionBlueprintBadgeFromList(walletAddress, wallets);
}

export function getBlueprintRewardTier(mintedNFTMetadata = {}) {
  const rarity = normalizeTraitName(
    mintedNFTMetadata?.rarity
    || mintedNFTMetadata?.tier
    || mintedNFTMetadata?.rewardTier
    || ""
  );

  if (rarity.includes("mythic")) return "Mythic Match";
  if (rarity.includes("legendary")) return "Legendary Match";
  if (rarity.includes("epic")) return "Epic Match";
  if (rarity.includes("rare")) return "Rare Match";
  return "Common Match";
}

export function rewardDescriptionForTier(tier) {
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

export async function fetchMintedNFTMetadata(tokenId) {
  const token = String(tokenId || "").trim();
  if (!token) throw new Error("Missing token ID.");

  const localPaths = [
    `/data/season2-metadata/${encodeURIComponent(token)}.json`,
    `/metadata/${encodeURIComponent(token)}.json`
  ];

  for (const path of localPaths) {
    const response = await fetch(path, { cache: "no-store" }).catch(() => null);
    if (response?.ok) return response.json();
  }

  throw new Error("Minted NFT metadata is not available yet. Add a metadata folder/API after reveal.");
}

export async function checkExactBlueprintMatch(walletAddress, tokenId, options = {}) {
  const wallet = normalizeWalletAddress(walletAddress);
  if (!wallet) throw new Error("Missing or invalid wallet.");

  const blueprint = options.blueprint || await fetch(`/.netlify/functions/ascension-blueprints?wallet=${encodeURIComponent(wallet)}`, {
    cache: "no-store"
  }).then((response) => response.json()).then((data) => data.registration);

  if (!blueprint) throw new Error("No saved Ascension Blueprint for this wallet.");

  const mintedNFTMetadata = options.mintedNFTMetadata || await fetchMintedNFTMetadata(tokenId);
  const mintedOwner = normalizeWalletAddress(mintedNFTMetadata?.wallet || mintedNFTMetadata?.owner || mintedNFTMetadata?.minter || "");
  const ownershipConfirmed = mintedOwner ? mintedOwner === wallet : null;
  const mintedTraits = attributesToTraitMap(mintedNFTMetadata);
  const comparison = compareBlueprintToMintedNFT(blueprint.traits, mintedTraits);
  const rewardTier = comparison.exactMatch ? getBlueprintRewardTier(mintedNFTMetadata) : "";

  return {
    wallet,
    blueprint,
    tokenId: String(tokenId || "").trim(),
    mintedNFTMetadata,
    mintedTraits,
    ownershipConfirmed,
    rewardTier,
    ...comparison
  };
}
