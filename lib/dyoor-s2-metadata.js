import fs from "node:fs";
import path from "node:path";

export const DEFAULT_S2_MAX_SUPPLY = 3333;
export const DEFAULT_S2_IMAGE_CID = "bafybeidh5ilyx54iklgazcdzwrzyr3llnj6v7jc3ll2hbrn36mxk2xle7i";
export const DEFAULT_S2_COLLECTION_NAME = "D.Y.O.O.R";
export const DEFAULT_S2_DESCRIPTION = "Directive: Yield Opportunity Optimization Robots";
export const METADATA_CACHE_CONTROL = "s-maxage=60, stale-while-revalidate=300";

export const REQUIRED_TRAIT_TYPES = [
  "Background",
  "Droid",
  "Eyes",
  "Clothes",
  "Mouth",
  "Hat",
  "Special",
  "Accessories",
];

const FALLBACK_TRAIT_VALUES = {
  Background: "Unknown",
  Droid: "Unknown",
  Eyes: "Unknown",
  Clothes: "Unknown",
  Mouth: "Unknown",
  Hat: "Unknown",
  Special: "None",
  Accessories: "Unknown",
};

const DEFAULT_METADATA_DIRS = [
  "metadata-extensionless",
  "metadata",
  "public/metadata-extensionless",
  "public/metadata",
  "data/metadata-extensionless",
  "data/metadata",
  "data/dyoor-s2-metadata",
  "src/data/metadata-extensionless",
  "src/data/metadata",
  "src/data/dyoor-s2-metadata",
];

const OVERRIDE_PATH = path.join(process.cwd(), "data", "dyoor-s2-trait-overrides.json");

function readEnv(name, fallback = "") {
  const value = process.env[name];
  return value && String(value).trim() ? String(value).trim() : fallback;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeDirectory(value) {
  if (!value) return "";
  return path.isAbsolute(value)
    ? value
    : path.join(/* turbopackIgnore: true */ process.cwd(), value);
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function metadataDirectories() {
  const envDirs = [
    readEnv("DYOOR_S2_METADATA_DIR"),
    readEnv("SEASON2_METADATA_DIR"),
    readEnv("DYOOR_METADATA_DIR"),
  ];

  return unique(envDirs.concat(DEFAULT_METADATA_DIRS).map(normalizeDirectory));
}

function findBaseMetadataFile(tokenId) {
  const fileNames = [String(tokenId), `${tokenId}.json`];

  for (const directory of metadataDirectories()) {
    for (const fileName of fileNames) {
      const filePath = path.join(directory, fileName);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        return filePath;
      }
    }
  }

  return "";
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeAttribute(attribute) {
  if (!attribute || typeof attribute !== "object") return null;
  const traitType = String(attribute.trait_type || "").trim();
  if (!traitType) return null;

  return {
    ...attribute,
    trait_type: traitType,
    value: attribute.value ?? "",
  };
}

function normalizeAttributes(attributes) {
  if (!Array.isArray(attributes)) return [];
  return attributes.map(normalizeAttribute).filter(Boolean);
}

function setAttribute(attributes, traitType, value) {
  const index = attributes.findIndex((attribute) => attribute.trait_type === traitType);
  if (index >= 0) {
    attributes[index] = { ...attributes[index], value };
    return;
  }

  attributes.push({ trait_type: traitType, value });
}

function ensureRequiredAttributes(attributes) {
  for (const traitType of REQUIRED_TRAIT_TYPES) {
    if (!attributes.some((attribute) => attribute.trait_type === traitType)) {
      attributes.push({ trait_type: traitType, value: FALLBACK_TRAIT_VALUES[traitType] || "Unknown" });
    }
  }
}

function sortAttributes(attributes) {
  const required = [];
  const extras = [];
  let version = null;

  for (const attribute of attributes) {
    if (attribute.trait_type === "Metadata Version") {
      version = attribute;
    } else if (REQUIRED_TRAIT_TYPES.includes(attribute.trait_type)) {
      required.push(attribute);
    } else {
      extras.push(attribute);
    }
  }

  required.sort((a, b) => REQUIRED_TRAIT_TYPES.indexOf(a.trait_type) - REQUIRED_TRAIT_TYPES.indexOf(b.trait_type));
  extras.sort((a, b) => a.trait_type.localeCompare(b.trait_type));

  return version ? required.concat(extras, version) : required.concat(extras);
}

export function getMetadataConfig(env = process.env) {
  const maxSupply = parsePositiveInteger(env.DYOOR_S2_MAX_SUPPLY, DEFAULT_S2_MAX_SUPPLY);
  const imageCid = String(env.DYOOR_S2_IMAGE_CID || DEFAULT_S2_IMAGE_CID).trim() || DEFAULT_S2_IMAGE_CID;
  const collectionName = String(env.DYOOR_S2_COLLECTION_NAME || DEFAULT_S2_COLLECTION_NAME).trim() || DEFAULT_S2_COLLECTION_NAME;
  const description = String(env.DYOOR_S2_DESCRIPTION || DEFAULT_S2_DESCRIPTION).trim() || DEFAULT_S2_DESCRIPTION;

  return {
    maxSupply,
    imageCid,
    collectionName,
    description,
    imageBaseUri: `ipfs://${imageCid}`,
  };
}

export function parseTokenId(value, maxSupply = getMetadataConfig().maxSupply) {
  const raw = String(value || "").trim();
  if (!/^[0-9]+$/.test(raw)) {
    return { ok: false, status: 400, error: "Invalid token ID." };
  }

  const tokenId = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(tokenId) || tokenId < 1 || tokenId > maxSupply) {
    return { ok: false, status: 404, error: "Token ID out of range." };
  }

  return { ok: true, tokenId };
}

export function imageUri(tokenId, config = getMetadataConfig()) {
  return `${config.imageBaseUri}/${tokenId}.png`;
}

export function buildFallbackMetadata(tokenId, config = getMetadataConfig()) {
  return {
    name: `${config.collectionName} #${tokenId}`,
    description: config.description,
    image: imageUri(tokenId, config),
    attributes: REQUIRED_TRAIT_TYPES.map((traitType) => ({
      trait_type: traitType,
      value: FALLBACK_TRAIT_VALUES[traitType] || "Unknown",
    })).concat([{ trait_type: "Metadata Version", value: "1" }]),
  };
}

export function getBaseMetadata(tokenId, config = getMetadataConfig()) {
  const filePath = findBaseMetadataFile(tokenId);
  if (!filePath) {
    return {
      metadata: buildFallbackMetadata(tokenId, config),
      found: false,
      source: "",
      usedFallback: true,
    };
  }

  const metadata = readJsonFile(filePath);
  return {
    metadata,
    found: true,
    source: filePath,
    usedFallback: false,
  };
}

export function getTraitOverrides(tokenId) {
  if (!fs.existsSync(OVERRIDE_PATH)) return null;

  const overrides = readJsonFile(OVERRIDE_PATH);
  const override = overrides?.[String(tokenId)];
  return override && typeof override === "object" ? override : null;
}

export function mergeMetadata(baseMetadata, overrides, tokenId, config = getMetadataConfig()) {
  const metadata = cloneJson(baseMetadata || {});
  const version = overrides?.version || 1;

  metadata.name = overrides?.name || metadata.name || `${config.collectionName} #${tokenId}`;
  metadata.description = overrides?.description || metadata.description || config.description;
  metadata.image = overrides?.image || metadata.image || imageUri(tokenId, config);

  const attributes = normalizeAttributes(metadata.attributes);
  ensureRequiredAttributes(attributes);

  if (overrides?.attributes && typeof overrides.attributes === "object") {
    for (const [traitType, value] of Object.entries(overrides.attributes)) {
      setAttribute(attributes, traitType, value);
    }
  }

  setAttribute(attributes, "Metadata Version", String(version));
  metadata.attributes = sortAttributes(attributes);

  return metadata;
}

export function buildTokenMetadata(tokenId, config = getMetadataConfig()) {
  const base = getBaseMetadata(tokenId, config);
  const overrides = getTraitOverrides(tokenId);
  const metadata = mergeMetadata(base.metadata, overrides, tokenId, config);

  return {
    metadata,
    baseFound: base.found,
    baseSource: base.source,
    usedFallback: base.usedFallback,
    overrideFound: Boolean(overrides),
  };
}
