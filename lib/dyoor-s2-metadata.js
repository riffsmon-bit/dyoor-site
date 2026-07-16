import fs from "node:fs";
import path from "node:path";
import { getStore } from "@netlify/blobs";

export const DEFAULT_S2_MAX_SUPPLY = 3333;
export const DEFAULT_S2_IMAGE_CID = "bafybeifz4gwsvqbypeki3wwwmmvng2z2lusqjndevfqemzibisk266vepq";
export const DEFAULT_S2_METADATA_CID = "bafybeidz7htb3digthznwvl4ytdpckq2q3d2ytgxtsie5bcp7a4lgtb2sq";
export const DEFAULT_S2_METADATA_BASE_URL = `https://jade-efficient-beaver-697.mypinata.cloud/ipfs/${DEFAULT_S2_METADATA_CID}`;
const DEFAULT_S2_CHAIN_ID = 143;
const DEFAULT_DYOOR_S2_MAINNET_CONTRACT = "0x349d8eb480c92cf75371fba5c6344a4d11b9103a";
const LEGACY_DYOOR_S2_TESTNET_CONTRACT = "0xce586aa467f6351bf819dbf134bc69947125cd92";
const LEGACY_S2_IMAGE_CIDS = new Set([
  "bafybeidh5ilyx54iklgazcdzwrzyr3llnj6v7jc3ll2hbrn36mxk2xle7i",
]);
const LEGACY_S2_METADATA_CIDS = new Set([
  "bafybeictzn54rbfnqd7vdqfhtu2vwy2bp7vnqj4zp2tswsrosge43frapi",
]);
export const DEFAULT_S2_METADATA_SOURCE = "remote";
export const DEFAULT_S2_COLLECTION_NAME = "D.Y.O.O.R";
export const DEFAULT_S2_DESCRIPTION = "Directive: Yield Opportunity Optimization Robots";
export const METADATA_CACHE_CONTROL = "s-maxage=60, stale-while-revalidate=300";
export const METADATA_BLOB_STORE = "dyoor-s2-metadata";
export const METADATA_BLOB_CONFIG_KEY = "config.json";
export const METADATA_BLOB_INDEX_KEY = "index.json";
export const METADATA_BLOB_OVERRIDES_KEY = "overrides.json";

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
const REMOTE_METADATA_CACHE_TTL_MS = 60_000;
const REMOTE_METADATA_TIMEOUT_MS = 6_000;
const remoteMetadataCache = new Map();

export function uploadedMetadataBlobKey(tokenId) {
  return `metadata/${tokenId}.json`;
}

function getMetadataBlobStore() {
  return getStore({ name: METADATA_BLOB_STORE, consistency: "strong" });
}

async function readBlobJson(key, fallback = null) {
  try {
    const value = await getMetadataBlobStore().get(key, { type: "json", consistency: "strong" });
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function runtimeDataRoot() {
  const configured = readEnv("DYOOR_RUNTIME_DATA_DIR");
  return configured
    ? normalizeDirectory(configured)
    : path.join(process.cwd(), "data", "runtime");
}

function runtimeStorePath(key) {
  const safeKey = String(key || "").replace(/^\/+/, "").replace(/\.\.+/g, "").replace(/\\/g, "/");
  return path.join(runtimeDataRoot(), METADATA_BLOB_STORE, safeKey);
}

function readRuntimeFileJson(key, fallback = null) {
  try {
    const filePath = runtimeStorePath(key);
    if (!fs.existsSync(filePath)) return fallback;
    return readJsonFile(filePath);
  } catch {
    return fallback;
  }
}

function writeRuntimeFileJson(key, value) {
  const filePath = runtimeStorePath(key);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function readRuntimeJson(key, fallback = null) {
  if (process.env.NODE_ENV !== "production") {
    return readRuntimeFileJson(key, fallback);
  }
  const blobValue = await readBlobJson(key, undefined);
  if (blobValue !== undefined) return blobValue;
  return readRuntimeFileJson(key, fallback);
}

async function writeRuntimeJson(key, value) {
  if (process.env.NODE_ENV !== "production") {
    writeRuntimeFileJson(key, value);
    return;
  }
  try {
    await getMetadataBlobStore().setJSON(key, value);
  } catch {
    writeRuntimeFileJson(key, value);
  }
}

function readEnv(name, fallback = "") {
  const value = process.env[name];
  return value && String(value).trim() ? String(value).trim() : fallback;
}

function firstEnv(...names) {
  for (const name of names) {
    const value = readEnv(name);
    if (value) return value;
  }
  return "";
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

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${raw.slice(7)}`.replace(/\/+$/, "");
  if (/^bafy[a-z0-9]+$/i.test(raw)) return `https://ipfs.io/ipfs/${raw}`.replace(/\/+$/, "");
  return raw.replace(/\/+$/, "");
}

function canonicalImageCid(value) {
  const cid = String(value || "").trim();
  if (!cid || LEGACY_S2_IMAGE_CIDS.has(cid)) return DEFAULT_S2_IMAGE_CID;
  return cid;
}

function canonicalMetadataCid(value) {
  const cid = String(value || "").trim();
  if (!cid || LEGACY_S2_METADATA_CIDS.has(cid)) return DEFAULT_S2_METADATA_CID;
  return cid;
}

function metadataUsesLegacyCids(metadata) {
  if (!metadata || typeof metadata !== "object") return false;
  let serialized = "";
  try {
    serialized = JSON.stringify(metadata);
  } catch {
    return false;
  }
  for (const cid of LEGACY_S2_IMAGE_CIDS) {
    if (serialized.includes(cid)) return true;
  }
  for (const cid of LEGACY_S2_METADATA_CIDS) {
    if (serialized.includes(cid)) return true;
  }
  return false;
}

function replaceLegacyMetadataCid(value) {
  let next = String(value || "");
  for (const legacyCid of LEGACY_S2_METADATA_CIDS) {
    next = next.replaceAll(legacyCid, DEFAULT_S2_METADATA_CID);
  }
  return next;
}

function normalizeAddressKey(value) {
  const raw = String(value || "").trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(raw) ? raw : "";
}

function configuredS2ChainId(env = process.env) {
  const parsed = Number(
    env.DYOOR_S2_CHAIN_ID
    || env.NEXT_PUBLIC_DYOOR_S2_CHAIN_ID
    || env.NEXT_PUBLIC_MONAD_CHAIN_ID
    || env.EXPECTED_CHAIN_ID
    || env.CHAIN_ID
    || DEFAULT_S2_CHAIN_ID,
  );
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_S2_CHAIN_ID;
  return Math.floor(parsed) === 10143 ? DEFAULT_S2_CHAIN_ID : Math.floor(parsed);
}

function configuredS2ContractAddress(env = process.env) {
  const configured = normalizeAddressKey(env.DYOOR_S2_CONTRACT_ADDRESS || env.NEXT_PUBLIC_DYOOR_S2_CONTRACT_ADDRESS);
  if (!configured || configured === LEGACY_DYOOR_S2_TESTNET_CONTRACT) return DEFAULT_DYOOR_S2_MAINNET_CONTRACT;
  return configured;
}

function legacyUnscopedOverridesEnabled(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String(env.DYOOR_S2_ALLOW_LEGACY_UNSCOPED_OVERRIDES || ""));
}

export function runtimeTraitOverrideKey(tokenId, env = process.env) {
  return `${configuredS2ChainId(env)}:${configuredS2ContractAddress(env)}:${String(tokenId)}`;
}

function resolveRuntimeTraitOverride(overrides, tokenId, env = process.env) {
  if (!overrides || typeof overrides !== "object") return null;
  const scoped = overrides[runtimeTraitOverrideKey(tokenId, env)];
  if (scoped && typeof scoped === "object") return scoped;
  if (!legacyUnscopedOverridesEnabled(env)) return null;
  const legacy = overrides[String(tokenId)];
  return legacy && typeof legacy === "object" ? legacy : null;
}

function remoteMetadataBaseUrl(env = process.env) {
  const configured = firstEnv(
    "DYOOR_S2_METADATA_BASE_URL",
    "DYOOR_S2_METADATA_URL",
    "NEXT_PUBLIC_DYOOR_S2_METADATA_BASE_URL",
  );
  if (configured) return replaceLegacyMetadataCid(normalizeBaseUrl(configured));

  const cid = canonicalMetadataCid(env.DYOOR_S2_METADATA_CID || env.NEXT_PUBLIC_DYOOR_S2_METADATA_CID || DEFAULT_S2_METADATA_CID);
  if (!cid) return "";

  const gateway = String(env.DYOOR_S2_METADATA_GATEWAY || env.NEXT_PUBLIC_DYOOR_S2_METADATA_GATEWAY || "").trim().replace(/\/+$/, "");
  if (gateway) return `${gateway}/ipfs/${cid}`.replace(/\/+$/, "");

  return normalizeBaseUrl(DEFAULT_S2_METADATA_BASE_URL);
}

function metadataSourceMode(env = process.env) {
  const raw = String(env.DYOOR_S2_METADATA_SOURCE || env.NEXT_PUBLIC_DYOOR_S2_METADATA_SOURCE || DEFAULT_S2_METADATA_SOURCE)
    .trim()
    .toLowerCase();
  if (["uploaded", "blob", "blobs", "netlify"].includes(raw)) return "uploaded";
  if (["local", "repo", "filesystem"].includes(raw)) return "local";
  if (["remote-only", "pinata-only", "ipfs-only"].includes(raw)) return "remote-only";
  return "remote";
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
  const imageCid = canonicalImageCid(env.DYOOR_S2_IMAGE_CID || env.NEXT_PUBLIC_DYOOR_S2_IMAGE_CID || DEFAULT_S2_IMAGE_CID);
  const collectionName = String(env.DYOOR_S2_COLLECTION_NAME || DEFAULT_S2_COLLECTION_NAME).trim() || DEFAULT_S2_COLLECTION_NAME;
  const description = String(env.DYOOR_S2_DESCRIPTION || DEFAULT_S2_DESCRIPTION).trim() || DEFAULT_S2_DESCRIPTION;

  return {
    maxSupply,
    imageCid,
    collectionName,
    description,
    imageBaseUri: `ipfs://${imageCid}`,
    uploadedMetadataPublished: false,
    uploadedMetadataPublishedAt: "",
  };
}

function normalizeRuntimeConfig(baseConfig, storedConfig) {
  const raw = storedConfig && typeof storedConfig === "object" ? storedConfig : {};
  const maxSupply = parsePositiveInteger(raw.maxSupply, baseConfig.maxSupply);
  const imageCid = canonicalImageCid(raw.imageCid || baseConfig.imageCid);
  const collectionName = String(raw.collectionName || baseConfig.collectionName).trim() || baseConfig.collectionName;
  const description = String(raw.description || baseConfig.description).trim() || baseConfig.description;

  return {
    ...baseConfig,
    maxSupply,
    imageCid,
    collectionName,
    description,
    imageBaseUri: `ipfs://${imageCid}`,
    uploadedMetadataPublished: raw.published === true,
    uploadedMetadataPublishedAt: String(raw.publishedAt || ""),
  };
}

export async function getUploadedMetadataConfig() {
  return await readBlobJson(METADATA_BLOB_CONFIG_KEY, null);
}

export async function getRuntimeMetadataConfig(env = process.env) {
  const baseConfig = getMetadataConfig(env);
  const storedConfig = await getUploadedMetadataConfig();
  return normalizeRuntimeConfig(baseConfig, storedConfig);
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

function isPlaceholderImageUri(value) {
  return typeof value === "string" && (
    value.includes("REPLACE_ME")
    || value.includes("PLACEHOLDER")
    || value.includes("localhost")
  );
}

function normalizeTokenImageUri(value, tokenId, config = getMetadataConfig()) {
  if (!value || typeof value !== "string" || isPlaceholderImageUri(value)) {
    return imageUri(tokenId, config);
  }
  return value;
}

function normalizePropertiesFiles(metadata, tokenId, config = getMetadataConfig()) {
  const image = normalizeTokenImageUri(metadata.image, tokenId, config);
  metadata.image = image;
  metadata.properties = metadata.properties && typeof metadata.properties === "object" && !Array.isArray(metadata.properties)
    ? metadata.properties
    : {};

  const files = Array.isArray(metadata.properties.files) ? metadata.properties.files : [];
  if (!files.length) {
    metadata.properties.files = [{ uri: image, type: "image/png" }];
  } else {
    metadata.properties.files = files.map((file, index) => {
      if (!file || typeof file !== "object") return file;
      if (index !== 0) return file;
      return {
        ...file,
        uri: !file.uri || isPlaceholderImageUri(file.uri) ? image : normalizeTokenImageUri(file.uri, tokenId, config),
        type: file.type || "image/png",
      };
    });
    if (isPlaceholderImageUri(metadata.properties.files[0]?.uri) || !metadata.properties.files[0]?.uri) {
      metadata.properties.files[0] = { ...metadata.properties.files[0], uri: image, type: metadata.properties.files[0]?.type || "image/png" };
    }
  }

  metadata.properties.category = metadata.properties.category || "image";
  return metadata;
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

async function fetchRemoteMetadataJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_METADATA_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        accept: "application/json",
      },
    });
    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") || "";
    if (contentType && !contentType.includes("json") && !contentType.includes("text/plain")) {
      return null;
    }

    const json = await response.json();
    return json && typeof json === "object" && !Array.isArray(json) ? json : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function getRemoteBaseMetadata(tokenId, env = process.env) {
  const baseUrl = remoteMetadataBaseUrl(env);
  if (!baseUrl) return null;

  const cacheKey = `${baseUrl}/${tokenId}`;
  const cached = remoteMetadataCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < REMOTE_METADATA_CACHE_TTL_MS) {
    return cached.value;
  }

  const candidates = [`${baseUrl}/${tokenId}`, `${baseUrl}/${tokenId}.json`];
  for (const url of candidates) {
    const metadata = await fetchRemoteMetadataJson(url);
    if (!metadata) continue;

    const value = {
      metadata,
      found: true,
      source: url,
      usedFallback: false,
    };
    remoteMetadataCache.set(cacheKey, { cachedAt: Date.now(), value });
    return value;
  }

  return null;
}

export async function getUploadedBaseMetadata(tokenId, config = getMetadataConfig()) {
  if (config.uploadedMetadataPublished !== true) return null;

  const metadata = await readBlobJson(uploadedMetadataBlobKey(tokenId), null);
  if (!metadata || typeof metadata !== "object") return null;
  if (metadataUsesLegacyCids(metadata)) return null;

  return {
    metadata,
    found: true,
    source: `${METADATA_BLOB_STORE}:${uploadedMetadataBlobKey(tokenId)}`,
    usedFallback: false,
  };
}

export function getTraitOverrides(tokenId) {
  if (!fs.existsSync(OVERRIDE_PATH)) return null;

  const overrides = readJsonFile(OVERRIDE_PATH);
  return resolveRuntimeTraitOverride(overrides, tokenId);
}

export async function getUploadedTraitOverrides(tokenId) {
  const overrides = await readRuntimeJson(METADATA_BLOB_OVERRIDES_KEY, null);
  return resolveRuntimeTraitOverride(overrides, tokenId);
}

export async function getRuntimeTraitOverrides(tokenId) {
  return await getUploadedTraitOverrides(tokenId) || getTraitOverrides(tokenId);
}

export async function getAllRuntimeTraitOverrides() {
  const uploaded = await readRuntimeJson(METADATA_BLOB_OVERRIDES_KEY, null);
  if (uploaded && typeof uploaded === "object") return uploaded;
  if (!fs.existsSync(OVERRIDE_PATH)) return {};
  const local = readJsonFile(OVERRIDE_PATH);
  return local && typeof local === "object" ? local : {};
}

export async function saveRuntimeTraitOverride(tokenId, override) {
  const overrides = await getAllRuntimeTraitOverrides();
  const key = runtimeTraitOverrideKey(tokenId);
  const next = {
    ...overrides,
    [key]: {
      ...override,
      chainId: configuredS2ChainId(),
      contractAddress: configuredS2ContractAddress(),
      tokenId: String(tokenId),
      updatedAt: override?.updatedAt || new Date().toISOString(),
    },
  };
  await writeRuntimeJson(METADATA_BLOB_OVERRIDES_KEY, next);
  return next[key];
}

export function mergeMetadata(baseMetadata, overrides, tokenId, config = getMetadataConfig()) {
  const metadata = cloneJson(baseMetadata || {});
  const version = overrides?.version || 1;

  metadata.name = overrides?.name || metadata.name || `${config.collectionName} #${tokenId}`;
  metadata.description = overrides?.description || metadata.description || config.description;
  metadata.image = overrides?.image || normalizeTokenImageUri(metadata.image, tokenId, config);
  if (overrides?.image) {
    metadata.properties = metadata.properties && typeof metadata.properties === "object" ? metadata.properties : {};
    metadata.properties.files = [{ uri: overrides.image, type: "image/png" }];
    metadata.properties.category = metadata.properties.category || "image";
  }
  normalizePropertiesFiles(metadata, tokenId, config);

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

export async function buildTokenMetadataAsync(tokenId, config) {
  const runtimeConfig = config || await getRuntimeMetadataConfig();
  const sourceMode = metadataSourceMode();
  let uploadedBase = null;
  let localBase = null;
  let remoteBase = null;
  let base = null;

  if (sourceMode === "uploaded") {
    uploadedBase = await getUploadedBaseMetadata(tokenId, runtimeConfig);
    localBase = uploadedBase ? null : getBaseMetadata(tokenId, runtimeConfig);
    remoteBase = uploadedBase || localBase?.found ? null : await getRemoteBaseMetadata(tokenId);
    base = uploadedBase || (localBase?.found ? localBase : null) || remoteBase || localBase;
  } else if (sourceMode === "local") {
    localBase = getBaseMetadata(tokenId, runtimeConfig);
    remoteBase = localBase?.found ? null : await getRemoteBaseMetadata(tokenId);
    uploadedBase = localBase?.found || remoteBase ? null : await getUploadedBaseMetadata(tokenId, runtimeConfig);
    base = (localBase?.found ? localBase : null) || remoteBase || uploadedBase || localBase;
  } else {
    remoteBase = await getRemoteBaseMetadata(tokenId);
    uploadedBase = remoteBase || sourceMode === "remote-only" ? null : await getUploadedBaseMetadata(tokenId, runtimeConfig);
    localBase = remoteBase || uploadedBase ? null : getBaseMetadata(tokenId, runtimeConfig);
    base = remoteBase || uploadedBase || (localBase?.found ? localBase : null) || localBase;
  }

  base = base || getBaseMetadata(tokenId, runtimeConfig);
  const overrides = await getRuntimeTraitOverrides(tokenId);
  const metadata = mergeMetadata(base.metadata, overrides, tokenId, runtimeConfig);

  return {
    metadata,
    baseFound: base.found,
    baseSource: base.source,
    usedFallback: base.usedFallback,
    overrideFound: Boolean(overrides),
    uploadedBaseFound: Boolean(uploadedBase),
    remoteBaseFound: Boolean(remoteBase),
  };
}

export function validateMetadataObject(metadata, tokenId, config = getMetadataConfig()) {
  const errors = [];
  const warnings = [];

  try {
    JSON.parse(JSON.stringify(metadata));
  } catch {
    errors.push("metadata is not JSON serializable");
  }

  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    errors.push("metadata is not an object");
    return { ok: false, errors, warnings };
  }

  if (!metadata.name || typeof metadata.name !== "string") errors.push("missing name");
  if (!metadata.image || typeof metadata.image !== "string") {
    errors.push("missing image");
  } else if (!metadata.image.startsWith(`ipfs://${config.imageCid}/`)) {
    errors.push(`image does not use expected CID ${config.imageCid}`);
  } else if (!metadata.image.endsWith(`/${tokenId}.png`)) {
    warnings.push(`image does not end with /${tokenId}.png`);
  }

  if (!Array.isArray(metadata.attributes)) errors.push("attributes is not an array");

  const traitTypes = new Set(Array.isArray(metadata.attributes)
    ? metadata.attributes.map((attribute) => String(attribute?.trait_type || ""))
    : []);

  for (const traitType of REQUIRED_TRAIT_TYPES) {
    if (!traitTypes.has(traitType)) {
      errors.push(`missing trait type ${traitType}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}
