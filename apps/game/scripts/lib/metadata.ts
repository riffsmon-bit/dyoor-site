import fs from "node:fs/promises";
import path from "node:path";
import { argValue, envValue, hasFlag, positiveIntegerArg } from "./cli";
import { readJsonOrNull, writeJson } from "./json";
import {
  METADATA_CACHE_ROOT,
  REPOSITORY_ROOT,
  assertPathInside,
} from "./paths";

export const METADATA_MAX_SUPPLY = 3333;
export const CANONICAL_METADATA_CID = "bafybeidz7htb3digthznwvl4ytdpckq2q3d2ytgxtsie5bcp7a4lgtb2sq";
export const CANONICAL_METADATA_BASE_URL =
  `https://jade-efficient-beaver-697.mypinata.cloud/ipfs/${CANONICAL_METADATA_CID}`;
const MAX_RESPONSE_BYTES = 512_000;
const REQUIRED_TRAITS = [
  "Background",
  "Droid",
  "Conditions",
  "Stickers/Body art",
  "Clothes",
  "Mouth",
  "Eyes",
  "Hat",
  "Accessories",
  "Accessories 2",
  "Special",
];

export type NormalizedAttribute = {
  traitType: string;
  value: string;
};

export type NormalizedMetadata = {
  tokenId: number;
  name: string;
  description: string;
  image: string;
  attributes: NormalizedAttribute[];
  sourceHashInput: string;
};

export type MetadataFailure = {
  tokenId: number;
  error: string;
};

export type MetadataLoadResult = {
  records: NormalizedMetadata[];
  failures: MetadataFailure[];
  cacheHits: number;
  remoteReads: number;
  localReads: number;
  metadataBaseUrl: string;
};

export function normalizeTokenId(value: unknown, maxSupply = METADATA_MAX_SUPPLY) {
  if (typeof value === "string" && !/^[0-9]+$/.test(value.trim())) return null;
  const tokenId = Number(value);
  if (!Number.isSafeInteger(tokenId) || tokenId < 1 || tokenId > maxSupply) return null;
  return tokenId;
}

function safeText(value: unknown, maximum: number) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.slice(0, maximum);
}

export function validateImageUrl(value: unknown) {
  const raw = safeText(value, 2048);
  if (!raw) return "";
  if (raw.startsWith("ipfs://")) {
    const remainder = raw.slice(7);
    return /^[a-zA-Z0-9/._-]+$/.test(remainder) ? raw : "";
  }
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

export function normalizeMetadataRecord(tokenIdInput: unknown, value: unknown): NormalizedMetadata {
  const tokenId = normalizeTokenId(tokenIdInput);
  if (!tokenId) throw new Error("Token ID is outside 1–3333.");
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Metadata is not a JSON object.");
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.attributes)) throw new Error("Metadata attributes are missing.");
  const attributes = record.attributes.slice(0, 64).flatMap((entry): NormalizedAttribute[] => {
    if (!entry || typeof entry !== "object") return [];
    const attribute = entry as Record<string, unknown>;
    const traitType = safeText(attribute.trait_type ?? attribute.traitType, 80);
    const traitValue = safeText(attribute.value, 180);
    return traitType && traitValue ? [{ traitType, value: traitValue }] : [];
  });
  const duplicateTraits = attributes
    .map((attribute) => attribute.traitType)
    .filter((traitType, index, list) => list.indexOf(traitType) !== index);
  if (duplicateTraits.length) {
    throw new Error(`Duplicate trait categories: ${[...new Set(duplicateTraits)].join(", ")}`);
  }
  const image = validateImageUrl(record.image);
  if (!image) throw new Error("Metadata image URL is missing or unsafe.");
  const name = safeText(record.name, 160) || `D.Y.O.O.R #${tokenId}`;
  const description = safeText(record.description, 2_000);
  const attributeMap = new Map(attributes.map((attribute) => [attribute.traitType, attribute.value]));
  const missingTraits = REQUIRED_TRAITS.filter((traitType) => !attributeMap.has(traitType));
  if (missingTraits.length) throw new Error(`Missing traits: ${missingTraits.join(", ")}`);
  const sourceHashInput = JSON.stringify({
    tokenId,
    image,
    attributes: attributes.map((attribute) => [attribute.traitType, attribute.value]),
  });
  return { tokenId, name, description, image, attributes, sourceHashInput };
}

function metadataBaseUrl() {
  const configured = argValue(
    "--metadata-base-url",
    envValue("DYOOR_GAME_METADATA_BASE_URL", "DYOOR_S2_METADATA_BASE_URL") || CANONICAL_METADATA_BASE_URL,
  ).replace(/\/+$/, "");
  const url = new URL(configured);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("Metadata base URL must use HTTPS (or localhost HTTP).");
  }
  return url.toString().replace(/\/+$/, "");
}

function metadataDirectory() {
  const configured = argValue(
    "--metadata-dir",
    envValue("DYOOR_GAME_METADATA_DIR", "DYOOR_S2_METADATA_DIR", "SEASON2_METADATA_DIR"),
  );
  if (!configured) return "";
  const resolved = path.resolve(REPOSITORY_ROOT, configured);
  if (!hasFlag("--allow-external-metadata-dir")) {
    assertPathInside(REPOSITORY_ROOT, resolved, "Metadata directory");
  }
  return resolved;
}

async function fetchJson(url: string) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const declared = Number(response.headers.get("content-length") || 0);
      if (declared > MAX_RESPONSE_BYTES) throw new Error("Metadata response is too large.");
      const raw = await response.text();
      if (raw.length > MAX_RESPONSE_BYTES) throw new Error("Metadata response is too large.");
      return JSON.parse(raw) as unknown;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function readLocalToken(directory: string, tokenId: number) {
  for (const filename of [String(tokenId), `${tokenId}.json`]) {
    const candidate = path.join(directory, filename);
    if (!hasFlag("--allow-external-metadata-dir")) {
      assertPathInside(directory, candidate, "Metadata token path");
    }
    const value = await readJsonOrNull<unknown>(candidate);
    if (value) return value;
  }
  throw new Error(`No local metadata file for token ${tokenId}.`);
}

async function loadToken(
  tokenId: number,
  options: {
    baseUrl: string;
    directory: string;
    offline: boolean;
    refresh: boolean;
  },
) {
  const cachePath = path.join(METADATA_CACHE_ROOT, `${tokenId}.json`);
  assertPathInside(METADATA_CACHE_ROOT, cachePath, "Metadata cache path");
  if (!options.refresh) {
    const cached = await readJsonOrNull<unknown>(cachePath);
    if (cached) return { value: cached, source: "cache" as const };
  }
  if (options.directory) {
    const value = await readLocalToken(options.directory, tokenId);
    await writeJson(cachePath, value);
    return { value, source: "local" as const };
  }
  if (options.offline) throw new Error("Metadata is not cached and --offline was set.");
  const value = await fetchJson(`${options.baseUrl}/${tokenId}`);
  await writeJson(cachePath, value);
  return { value, source: "remote" as const };
}

export async function loadAllMetadata(): Promise<MetadataLoadResult> {
  const maxSupply = positiveIntegerArg("--max-supply", METADATA_MAX_SUPPLY, METADATA_MAX_SUPPLY);
  const concurrency = positiveIntegerArg("--concurrency", 12, 24);
  const options = {
    baseUrl: metadataBaseUrl(),
    directory: metadataDirectory(),
    offline: hasFlag("--offline"),
    refresh: hasFlag("--refresh"),
  };
  await fs.mkdir(METADATA_CACHE_ROOT, { recursive: true });
  const records: NormalizedMetadata[] = [];
  const failures: MetadataFailure[] = [];
  let cacheHits = 0;
  let remoteReads = 0;
  let localReads = 0;
  let completed = 0;
  let cursor = 1;

  async function worker() {
    while (cursor <= maxSupply) {
      const tokenId = cursor;
      cursor += 1;
      try {
        const loaded = await loadToken(tokenId, options);
        if (loaded.source === "cache") cacheHits += 1;
        if (loaded.source === "remote") remoteReads += 1;
        if (loaded.source === "local") localReads += 1;
        records.push(normalizeMetadataRecord(tokenId, loaded.value));
      } catch (error) {
        failures.push({
          tokenId,
          error: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
        });
      }
      completed += 1;
      if (completed % 100 === 0 || completed === maxSupply) {
        console.log(`metadata ${completed}/${maxSupply} · valid=${records.length} · failures=${failures.length}`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  records.sort((left, right) => left.tokenId - right.tokenId);
  failures.sort((left, right) => left.tokenId - right.tokenId);
  return {
    records,
    failures,
    cacheHits,
    remoteReads,
    localReads,
    metadataBaseUrl: options.baseUrl,
  };
}
