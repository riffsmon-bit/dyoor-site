import { getStore } from "@netlify/blobs";
import traitItemMetadataJson from "@/data/dyoor-s2-trait-item-metadata.json";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

type MetadataJson = {
  image?: string;
  attributes?: Array<{ trait_type?: string; value?: unknown }>;
};

type TraitItemMetadata = {
  slot?: string;
  name?: string;
  image?: string;
};

const STORE_NAME = "dyoor-s2-metadata";
const IMAGE_PREFIX = "trait-lab/images";
const DEFAULT_S2_LAYER_DIR = "/Volumes/DYOOR Hard Drive/dyoor-generator-local 3/layers";
const DEFAULT_RENDER_SIZE = 1024;
export const RENDER_PIPELINE_VERSION = "trait-assets-v4";

const REQUIRED_RENDER_BASE_LAYERS = new Set(["Background", "Droid"]);

const RENDER_LAYER_ORDER = [
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

function readEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function renderSize() {
  const parsed = Number(readEnv("DYOOR_S2_RENDER_SIZE", "NEXT_PUBLIC_DYOOR_S2_RENDER_SIZE"));
  return Number.isFinite(parsed) && parsed >= 256 && parsed <= 4096 ? Math.floor(parsed) : DEFAULT_RENDER_SIZE;
}

function normalizeComparable(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isEmptyTraitValue(value: unknown) {
  const normalized = normalizeComparable(value);
  return !normalized
    || normalized === "none"
    || normalized === "null"
    || normalized === "undefined"
    || normalized === "n a"
    || normalized === "na"
    || normalized === "unknown";
}

function traitMapFromMetadata(metadata: MetadataJson) {
  const attributes = Array.isArray(metadata?.attributes) ? metadata.attributes : [];
  return attributes.reduce<Record<string, string>>((acc, attribute) => {
    const traitType = String(attribute?.trait_type || "").trim();
    if (traitType) acc[traitType] = String(attribute?.value ?? "").trim() || "None";
    return acc;
  }, {});
}

function metadataVersion(metadata: MetadataJson) {
  const value = traitMapFromMetadata(metadata)["Metadata Version"];
  const parsed = Number.parseInt(String(value || "1"), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function runtimeDataRoot() {
  const configured = readEnv("DYOOR_RUNTIME_DATA_DIR");
  return configured
    ? path.resolve(process.cwd(), configured)
    : path.join(process.cwd(), "data", "runtime");
}

function localImagePath(imageId: string) {
  return path.join(runtimeDataRoot(), STORE_NAME, IMAGE_PREFIX, `${safeImageId(imageId)}.png`);
}

function safeImageId(value: string) {
  return String(value || "").replace(/[^a-zA-Z0-9._-]/g, "-");
}

function traitFolder(traitType: string) {
  return traitType === "Stickers/Body art" ? "Stickers:Body art" : traitType;
}

function layerRoots() {
  return [
    readEnv("DYOOR_S2_LAYER_DIR"),
    DEFAULT_S2_LAYER_DIR,
    path.join(process.cwd(), "dyoor-builder", "layers"),
  ].filter(Boolean).map((root) => path.resolve(root));
}

async function existingLocalLayer(traitType: string, value: unknown) {
  if (isEmptyTraitValue(value)) return "";
  const folder = traitFolder(traitType);
  const rawName = String(value || "").trim().replace(/\.[a-z0-9]+$/i, "");
  const candidateNames = [`${rawName}.png`, `${rawName}.PNG`, rawName];

  for (const root of layerRoots()) {
    const directory = path.join(root, folder);
    for (const candidateName of candidateNames) {
      const filePath = path.normalize(path.join(directory, candidateName));
      if (!filePath.startsWith(root)) continue;
      try {
        await fs.access(filePath);
        return filePath;
      } catch {}
    }

    try {
      const entries = await fs.readdir(directory);
      const match = entries.find((entry) => normalizeComparable(entry) === normalizeComparable(rawName));
      if (match) return path.join(directory, match);
    } catch {}
  }

  return "";
}

function gatewayUrl(cid: string, parts: string[]) {
  const gateway = readEnv("DYOOR_S2_LAYER_GATEWAY", "NEXT_PUBLIC_PINATA_GATEWAY_URL", "PINATA_GATEWAY_URL") || "https://ipfs.io";
  const cleanGateway = gateway.replace(/\/+$/, "");
  return `${cleanGateway}/ipfs/${cid}/${parts.map((part) => encodeURIComponent(part)).join("/")}`;
}

function ipfsGatewayUrl(uri: string) {
  const raw = String(uri || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (!raw.startsWith("ipfs://")) return "";

  const gateway = readEnv("NEXT_PUBLIC_PINATA_GATEWAY_URL", "PINATA_GATEWAY_URL", "DYOOR_S2_LAYER_GATEWAY") || "https://ipfs.io";
  return `${gateway.replace(/\/+$/, "")}/ipfs/${raw.slice(7).replace(/^\/+/, "")}`;
}

async function fetchBuffer(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { accept: "image/png,image/*" },
  });
  if (!response.ok) return null;
  return Buffer.from(await response.arrayBuffer());
}

async function remoteLayerBuffer(traitType: string, value: unknown) {
  const cid = readEnv("DYOOR_S2_LAYER_IMAGE_CID", "NEXT_PUBLIC_DYOOR_S2_LAYER_IMAGE_CID");
  if (!cid || isEmptyTraitValue(value)) return null;

  const folder = traitFolder(traitType);
  const rawName = String(value || "").trim().replace(/\.[a-z0-9]+$/i, "");
  const candidates = [
    ["layers", folder, `${rawName}.png`],
    ["layers", folder, `${rawName}.PNG`],
    [folder, `${rawName}.png`],
    [folder, `${rawName}.PNG`],
  ];

  for (const parts of candidates) {
    const buffer = await fetchBuffer(gatewayUrl(cid, parts));
    if (buffer) return buffer;
  }

  return null;
}

function traitItemAssetUri(traitType: string, value: unknown) {
  if (isEmptyTraitValue(value)) return "";

  const entries = traitItemMetadataJson as Record<string, TraitItemMetadata>;
  const direct = entries[`${traitType}::${String(value || "").trim()}`];
  if (direct?.image) return direct.image;

  const normalizedTrait = normalizeComparable(traitType);
  const normalizedValue = normalizeComparable(value);
  const match = Object.values(entries).find((item) => {
    return normalizeComparable(item?.slot) === normalizedTrait && normalizeComparable(item?.name) === normalizedValue;
  });
  return match?.image || "";
}

async function traitItemAssetBuffer(traitType: string, value: unknown) {
  const uri = traitItemAssetUri(traitType, value);
  const url = ipfsGatewayUrl(uri);
  return url ? await fetchBuffer(url) : null;
}

async function layerBuffer(traitType: string, value: unknown) {
  const localPath = await existingLocalLayer(traitType, value);
  if (localPath) return await fs.readFile(localPath);
  const assetBuffer = await traitItemAssetBuffer(traitType, value);
  if (assetBuffer) return assetBuffer;
  return await remoteLayerBuffer(traitType, value);
}

function imageStore() {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

async function writeImage(imageId: string, png: Buffer) {
  const key = `${IMAGE_PREFIX}/${safeImageId(imageId)}.png`;
  try {
    const body = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;
    await imageStore().set(key, body);
  } catch {
    const filePath = localImagePath(imageId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, png);
  }
}

export async function readRenderedTraitImage(imageId: string) {
  const key = `${IMAGE_PREFIX}/${safeImageId(imageId)}.png`;
  try {
    const value = await imageStore().get(key, { type: "arrayBuffer", consistency: "strong" });
    if (value) return Buffer.from(value);
  } catch {}

  try {
    return await fs.readFile(localImagePath(imageId));
  } catch {
    return null;
  }
}

export function renderedTraitImageUrl(imageId: string, origin = "") {
  const pathName = `/api/s2/trait-lab/render/${encodeURIComponent(safeImageId(imageId))}`;
  const base = String(origin || readEnv("DYOOR_SITE_URL", "NEXT_PUBLIC_SITE_URL", "URL")).replace(/\/+$/, "");
  return base ? `${base}${pathName}` : pathName;
}

export async function renderTraitLabImage(tokenId: number, metadata: MetadataJson, origin = "") {
  const traits = traitMapFromMetadata(metadata as any);
  const size = renderSize();
  const composites: sharp.OverlayOptions[] = [];
  const missingRequiredLayers: string[] = [];

  for (const traitType of RENDER_LAYER_ORDER) {
    const buffer = await layerBuffer(traitType, traits[traitType]);
    if (!buffer) {
      if (REQUIRED_RENDER_BASE_LAYERS.has(traitType) && !isEmptyTraitValue(traits[traitType])) {
        missingRequiredLayers.push(traitType);
      }
      continue;
    }
    composites.push({
      input: await sharp(buffer).resize(size, size, { fit: "fill" }).png().toBuffer(),
      top: 0,
      left: 0,
    });
  }

  if (missingRequiredLayers.length) {
    return {
      imageId: "",
      imageUrl: metadata.image || "",
      rendered: false,
      missingRequiredLayers,
    };
  }

  if (!composites.length) {
    return {
      imageId: "",
      imageUrl: metadata.image || "",
      rendered: false,
    };
  }

  const version = metadataVersion(metadata as any);
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify({
    renderer: RENDER_PIPELINE_VERSION,
    tokenId,
    version,
    traits,
  })).digest("hex").slice(0, 16);
  const imageId = `${tokenId}-v${version}-${RENDER_PIPELINE_VERSION}-${fingerprint}`;
  const png = await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite(composites).png().toBuffer();

  await writeImage(imageId, png);

  return {
    imageId,
    imageUrl: renderedTraitImageUrl(imageId, origin),
    rendererVersion: RENDER_PIPELINE_VERSION,
    rendered: true,
  };
}
