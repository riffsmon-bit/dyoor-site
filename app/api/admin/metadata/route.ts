import { getStore } from "@netlify/blobs";
import { adminOwnerWallet, verifyAdmin } from "@/lib/adminAuth";
import {
  METADATA_BLOB_CONFIG_KEY,
  METADATA_BLOB_INDEX_KEY,
  METADATA_BLOB_OVERRIDES_KEY,
  METADATA_BLOB_STORE,
  REQUIRED_TRAIT_TYPES,
  buildTokenMetadataAsync,
  getRuntimeTraitOverrides,
  getRuntimeMetadataConfig,
  parseTokenId,
  runtimeTraitOverrideKey,
  uploadedMetadataBlobKey,
  validateMetadataObject,
} from "@/lib/dyoor-s2-metadata.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UPLOAD_RECORDS_PER_BATCH = 250;

type MetadataRecord = {
  tokenId: number;
  metadata: Record<string, unknown>;
};

type MetadataIndexEntry = {
  uploadedAt: string;
  name: string;
  image: string;
  attributeCount: number;
  warnings: string[];
};

type MetadataIndex = {
  updatedAt?: string;
  tokens?: Record<string, MetadataIndexEntry>;
};

type StoredConfig = {
  maxSupply?: number;
  imageCid?: string;
  collectionName?: string;
  description?: string;
  published?: boolean;
  publishedAt?: string;
  updatedAt?: string;
};

type TokenOverride = {
  version?: number;
  name?: string;
  description?: string;
  image?: string;
  attributes?: Record<string, string>;
};

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function metadataStore() {
  return getStore({ name: METADATA_BLOB_STORE, consistency: "strong" });
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const value = await metadataStore().get(key, { type: "json", consistency: "strong" });
    return (value ?? fallback) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(key: string, value: unknown) {
  await metadataStore().setJSON(key, value);
}

function normalizeWallet(value: unknown) {
  const raw = String(value || "").trim();
  return /^0x[a-fA-F0-9]{40}$/.test(raw) ? raw.toLowerCase() : "";
}

function tokenCount(index: MetadataIndex) {
  return Object.keys(index.tokens || {}).length;
}

function summarizeIndex(index: MetadataIndex, maxSupply: number) {
  const tokenIds = Object.keys(index.tokens || {}).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const uploadedCount = tokenIds.length;
  const missingSample: number[] = [];
  for (let tokenId = 1; tokenId <= maxSupply && missingSample.length < 25; tokenId += 1) {
    if (!index.tokens?.[String(tokenId)]) missingSample.push(tokenId);
  }

  return {
    uploadedCount,
    missingCount: Math.max(0, maxSupply - uploadedCount),
    firstTokenId: tokenIds[0] || null,
    lastTokenId: tokenIds[tokenIds.length - 1] || null,
    missingSample,
    updatedAt: index.updatedAt || "",
  };
}

function publicConfig(config: Awaited<ReturnType<typeof getRuntimeMetadataConfig>>) {
  return {
    maxSupply: config.maxSupply,
    imageCid: config.imageCid,
    collectionName: config.collectionName,
    description: config.description,
    imageBaseUri: config.imageBaseUri,
    uploadedMetadataPublished: config.uploadedMetadataPublished,
    uploadedMetadataPublishedAt: config.uploadedMetadataPublishedAt,
  };
}

function parseWholeNumber(value: unknown, fallback: number) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function cleanString(value: unknown, fallback = "") {
  const raw = String(value || "").trim();
  return raw || fallback;
}

function normalizeConfigPatch(body: Record<string, unknown>, current: Awaited<ReturnType<typeof getRuntimeMetadataConfig>>) {
  const maxSupply = parseWholeNumber(body.maxSupply, current.maxSupply);
  const imageCid = cleanString(body.imageCid, current.imageCid);
  const collectionName = cleanString(body.collectionName, current.collectionName);
  const description = cleanString(body.description, current.description);

  if (!/^[a-zA-Z0-9]+$/.test(imageCid)) {
    throw Object.assign(new Error("Image CID is invalid."), { status: 400 });
  }

  return {
    maxSupply,
    imageCid,
    collectionName,
    description,
  };
}

function requireTokenId(value: unknown, maxSupply: number) {
  const parsed = parseTokenId(value, maxSupply);
  if (!parsed.ok || typeof parsed.tokenId !== "number") {
    throw Object.assign(new Error(parsed.error || "Invalid token ID."), { status: parsed.status || 400 });
  }
  return parsed.tokenId;
}

function normalizeRecord(item: unknown, maxSupply: number): MetadataRecord {
  const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
  const tokenId = requireTokenId(record.tokenId, maxSupply);

  const metadata = record.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw Object.assign(new Error(`Token ${tokenId} metadata must be an object.`), { status: 400 });
  }

  return {
    tokenId,
    metadata: metadata as Record<string, unknown>,
  };
}

function normalizeOverride(body: Record<string, unknown>): TokenOverride {
  const raw = body.override && typeof body.override === "object" ? body.override as Record<string, unknown> : body;
  const version = parseWholeNumber(raw.version, 2);
  const attributesInput = raw.attributes && typeof raw.attributes === "object" ? raw.attributes as Record<string, unknown> : {};
  const attributes = Object.fromEntries(Object.entries(attributesInput)
    .map(([traitType, value]) => [String(traitType || "").trim(), String(value || "").trim()])
    .filter(([traitType, value]) => traitType && value));

  const override: TokenOverride = { version };
  if (Object.keys(attributes).length) override.attributes = attributes;
  const name = cleanString(raw.name);
  const description = cleanString(raw.description);
  const image = cleanString(raw.image);
  if (name) override.name = name;
  if (description) override.description = description;
  if (image) override.image = image;

  return override;
}

async function statusPayload(wallet: string, tokenId?: string) {
  const owner = adminOwnerWallet();
  const authorized = Boolean(owner && wallet && wallet === owner.toLowerCase());
  const config = await getRuntimeMetadataConfig();
  const [index, overrides] = await Promise.all([
    readJson<MetadataIndex>(METADATA_BLOB_INDEX_KEY, { tokens: {} }),
    readJson<Record<string, TokenOverride>>(METADATA_BLOB_OVERRIDES_KEY, {}),
  ]);

  const body: Record<string, unknown> = {
    ok: true,
    ownerConfigured: Boolean(owner),
    authorized,
    config: publicConfig(config),
    index: summarizeIndex(index, config.maxSupply),
    overrideCount: Object.keys(overrides || {}).length,
    requiredTraitTypes: REQUIRED_TRAIT_TYPES,
  };

  if (tokenId) {
    const parsed = parseTokenId(tokenId, config.maxSupply);
    if (!parsed.ok) {
      body.token = { ok: false, error: parsed.error };
    } else {
      const result = await buildTokenMetadataAsync(parsed.tokenId, config);
      const override = authorized ? await getRuntimeTraitOverrides(parsed.tokenId) : null;
      body.token = {
        ok: true,
        tokenId: parsed.tokenId,
        metadata: result.metadata,
        uploadedBaseFound: Boolean(index.tokens?.[String(parsed.tokenId)]),
        liveUploadedBase: result.uploadedBaseFound,
        override,
      };
    }
  }

  return body;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const wallet = normalizeWallet(url.searchParams.get("wallet"));
  const tokenId = url.searchParams.get("tokenId") || undefined;
  return json(200, await statusPayload(wallet, tokenId));
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const mode = String(body.mode || "");
    await verifyAdmin(body, "metadata", { consumeNonce: mode !== "upload-metadata-batch" });

    if (mode === "save-config") {
      const currentConfig = await getRuntimeMetadataConfig();
      const stored = await readJson<StoredConfig>(METADATA_BLOB_CONFIG_KEY, {});
      const patch = normalizeConfigPatch(body, currentConfig);
      const next = {
        ...stored,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      await writeJson(METADATA_BLOB_CONFIG_KEY, next);
      return json(200, await statusPayload(normalizeWallet(body.wallet)));
    }

    if (mode === "upload-metadata-batch") {
      const config = await getRuntimeMetadataConfig();
      const recordsInput = Array.isArray(body.records) ? body.records : [];
      if (!recordsInput.length) return json(400, { ok: false, error: "No metadata records were provided." });
      if (recordsInput.length > MAX_UPLOAD_RECORDS_PER_BATCH) {
        return json(400, { ok: false, error: `Upload at most ${MAX_UPLOAD_RECORDS_PER_BATCH} records per batch.` });
      }

      const records = recordsInput.map((item) => normalizeRecord(item, config.maxSupply));
      const seen = new Set<number>();
      const invalid: Array<Record<string, unknown>> = [];
      for (const record of records) {
        if (seen.has(record.tokenId)) invalid.push({ tokenId: record.tokenId, errors: ["duplicate token ID in batch"] });
        seen.add(record.tokenId);
        const validation = validateMetadataObject(record.metadata, record.tokenId, config);
        if (!validation.ok) invalid.push({ tokenId: record.tokenId, errors: validation.errors, warnings: validation.warnings });
      }
      if (invalid.length) return json(400, { ok: false, error: "Metadata batch failed validation.", invalid });

      const index = await readJson<MetadataIndex>(METADATA_BLOB_INDEX_KEY, { tokens: {} });
      const now = new Date().toISOString();
      const nextTokens = { ...(index.tokens || {}) };
      await Promise.all(records.map(async (record) => {
        await writeJson(uploadedMetadataBlobKey(record.tokenId), record.metadata);
        const validation = validateMetadataObject(record.metadata, record.tokenId, config);
        nextTokens[String(record.tokenId)] = {
          uploadedAt: now,
          name: String(record.metadata.name || ""),
          image: String(record.metadata.image || ""),
          attributeCount: Array.isArray(record.metadata.attributes) ? record.metadata.attributes.length : 0,
          warnings: validation.warnings,
        };
      }));
      await writeJson(METADATA_BLOB_INDEX_KEY, { ...index, updatedAt: now, tokens: nextTokens });
      return json(200, {
        ok: true,
        uploaded: records.length,
        index: summarizeIndex({ ...index, tokens: nextTokens, updatedAt: now }, config.maxSupply),
      });
    }

    if (mode === "publish-uploaded-metadata" || mode === "unpublish-uploaded-metadata") {
      const config = await getRuntimeMetadataConfig();
      const stored = await readJson<StoredConfig>(METADATA_BLOB_CONFIG_KEY, {});
      const index = await readJson<MetadataIndex>(METADATA_BLOB_INDEX_KEY, { tokens: {} });
      const allowFallback = body.allowFallback === true;
      const uploadedCount = tokenCount(index);
      if (mode === "publish-uploaded-metadata" && uploadedCount < config.maxSupply && !allowFallback) {
        return json(409, {
          ok: false,
          error: `Only ${uploadedCount} of ${config.maxSupply} metadata records are uploaded. Enable fallback publishing or upload the missing records.`,
          index: summarizeIndex(index, config.maxSupply),
        });
      }

      const now = new Date().toISOString();
      const next = {
        ...stored,
        published: mode === "publish-uploaded-metadata",
        publishedAt: mode === "publish-uploaded-metadata" ? now : stored.publishedAt || "",
        updatedAt: now,
      };
      await writeJson(METADATA_BLOB_CONFIG_KEY, next);
      return json(200, await statusPayload(normalizeWallet(body.wallet)));
    }

    if (mode === "save-token-overrides") {
      const config = await getRuntimeMetadataConfig();
      const tokenId = requireTokenId(body.tokenId, config.maxSupply);
      const overrides = await readJson<Record<string, TokenOverride>>(METADATA_BLOB_OVERRIDES_KEY, {});
      const override = normalizeOverride(body);
      overrides[runtimeTraitOverrideKey(tokenId)] = override;
      await writeJson(METADATA_BLOB_OVERRIDES_KEY, overrides);
      return json(200, await statusPayload(normalizeWallet(body.wallet), String(tokenId)));
    }

    if (mode === "delete-token-overrides") {
      const config = await getRuntimeMetadataConfig();
      const tokenId = requireTokenId(body.tokenId, config.maxSupply);
      const overrides = await readJson<Record<string, TokenOverride>>(METADATA_BLOB_OVERRIDES_KEY, {});
      delete overrides[runtimeTraitOverrideKey(tokenId)];
      await writeJson(METADATA_BLOB_OVERRIDES_KEY, overrides);
      return json(200, await statusPayload(normalizeWallet(body.wallet), String(tokenId)));
    }

    if (mode === "validate-uploaded-metadata") {
      const config = await getRuntimeMetadataConfig();
      const index = await readJson<MetadataIndex>(METADATA_BLOB_INDEX_KEY, { tokens: {} });
      return json(200, {
        ok: true,
        config: publicConfig(config),
        index: summarizeIndex(index, config.maxSupply),
      });
    }

    return json(400, { ok: false, error: "Unknown metadata admin mode." });
  } catch (error: any) {
    return json(error?.status || 500, {
      ok: false,
      error: error?.message || "Metadata admin request failed.",
    });
  }
}
