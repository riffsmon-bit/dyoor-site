import { getStore } from "@netlify/blobs";
import traitItemMetadataJson from "@/data/dyoor-s2-trait-item-metadata.json";
import crypto from "node:crypto";
import sharp from "sharp";

type MetadataJson = {
  image?: string;
  attributes?: Array<{ trait_type?: string; value?: unknown }>;
};

type TraitItemMetadata = {
  image?: string;
};

const STORE_NAME = "dyoor-s2-metadata";
const IMAGE_PREFIX = "trait-lab/images";
const DEFAULT_RENDER_SIZE = 1024;
export const RENDER_PIPELINE_VERSION = "trait-assets-v6";

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
const REQUIRED_RENDER_LAYER_TRAITS = ["Background", "Droid"];

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

function safeImageId(value: string) {
  return String(value || "").replace(/[^a-zA-Z0-9._-]/g, "-");
}

function slugFile(value: string) {
  return `${String(value || "")
    .trim()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .toLowerCase()}.png`;
}

function traitFolder(traitType: string) {
  return traitType === "Stickers/Body art" ? "Stickers:Body art" : traitType;
}

function uniqueStrings(items: Array<string | null | undefined>) {
  return [...new Set(items.map((item) => String(item || "").trim()).filter(Boolean))];
}

function gatewayUrl(cid: string, parts: string[]) {
  const gateway = readEnv("DYOOR_S2_LAYER_GATEWAY", "NEXT_PUBLIC_PINATA_GATEWAY_URL", "PINATA_GATEWAY_URL") || "https://ipfs.io";
  const cleanGateway = gateway.replace(/\/+$/, "");
  return `${cleanGateway}/ipfs/${cid}/${parts.map((part) => encodeURIComponent(part)).join("/")}`;
}

function ipfsImageToGatewayUrl(value: unknown) {
  const uri = String(value || "").trim();
  if (!uri) return "";
  if (/^https?:\/\//i.test(uri)) return uri;
  if (!uri.startsWith("ipfs://")) return "";

  const [, rest = ""] = uri.split("ipfs://");
  const [cid = "", ...parts] = rest.split("/").filter(Boolean);
  return cid ? gatewayUrl(cid, parts) : "";
}

function traitItemMetadataImageUrl(traitType: string, value: string) {
  const items = traitItemMetadataJson as Record<string, TraitItemMetadata>;
  return ipfsImageToGatewayUrl(items[`${traitType}::${value}`]?.image);
}

function publicLayerBaseUrl(origin = "") {
  const configured = readEnv(
    "DYOOR_S2_PUBLIC_LAYER_BASE_URL",
    "NEXT_PUBLIC_DYOOR_S2_PUBLIC_LAYER_BASE_URL",
  );
  const base = configured || origin || readEnv("DYOOR_SITE_URL", "NEXT_PUBLIC_SITE_URL", "URL");
  return String(base || "").replace(/\/+$/, "");
}

function publicLayerUrl(origin: string, traitType: string, fileName: string) {
  const base = publicLayerBaseUrl(origin);
  if (!base) return "";
  return `${base}/s2-trait-layers/${[traitFolder(traitType), fileName].map((part) => encodeURIComponent(part)).join("/")}`;
}

async function fetchBuffer(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { accept: "image/png,image/*" },
  });
  if (!response.ok) return null;
  return Buffer.from(await response.arrayBuffer());
}

async function remoteLayerBuffer(traitType: string, value: unknown, origin = "") {
  const cid = readEnv("DYOOR_S2_LAYER_IMAGE_CID", "NEXT_PUBLIC_DYOOR_S2_LAYER_IMAGE_CID");
  if (isEmptyTraitValue(value)) return null;

  const folder = traitFolder(traitType);
  const rawName = String(value || "").trim().replace(/\.[a-z0-9]+$/i, "");
  const publicCandidates = [
    publicLayerUrl(origin, traitType, `${rawName}.png`),
    publicLayerUrl(origin, traitType, `${rawName}.PNG`),
  ];
  const cidCandidates = cid ? [
    traitItemMetadataImageUrl(traitType, rawName),
    gatewayUrl(cid, [slugFile(rawName)]),
    gatewayUrl(cid, ["layers", folder, `${rawName}.png`]),
    gatewayUrl(cid, ["layers", folder, `${rawName}.PNG`]),
    gatewayUrl(cid, [folder, `${rawName}.png`]),
    gatewayUrl(cid, [folder, `${rawName}.PNG`]),
  ] : [];
  const requiredLockedLayer = REQUIRED_RENDER_LAYER_TRAITS.includes(traitType);
  const candidates = uniqueStrings([
    ...(requiredLockedLayer ? publicCandidates : []),
    ...cidCandidates,
    ...(requiredLockedLayer ? [] : publicCandidates),
  ]);

  for (const url of candidates) {
    const buffer = await fetchBuffer(url);
    if (buffer) return buffer;
  }

  return null;
}

function imageStore() {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

async function writeImage(imageId: string, png: Buffer) {
  const key = `${IMAGE_PREFIX}/${safeImageId(imageId)}.png`;
  const body = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;
  await imageStore().set(key, body);
}

export async function readRenderedTraitImage(imageId: string) {
  const key = `${IMAGE_PREFIX}/${safeImageId(imageId)}.png`;
  const value = await imageStore().get(key, { type: "arrayBuffer", consistency: "strong" });
  return value ? Buffer.from(value) : null;
}

export function renderedTraitImageUrl(imageId: string, origin = "") {
  const pathName = `/api/s2/trait-lab/render/${encodeURIComponent(safeImageId(imageId))}`;
  const base = String(origin || readEnv("DYOOR_SITE_URL", "NEXT_PUBLIC_SITE_URL", "URL")).replace(/\/+$/, "");
  return base ? `${base}${pathName}` : pathName;
}

export async function findMissingTraitLabLayers(metadata: MetadataJson, origin = "") {
  const traits = traitMapFromMetadata(metadata as any);
  const missing: string[] = [];

  for (const traitType of REQUIRED_RENDER_LAYER_TRAITS) {
    if (isEmptyTraitValue(traits[traitType])) missing.push(`${traitType}: missing required layer`);
  }

  for (const traitType of RENDER_LAYER_ORDER) {
    const value = traits[traitType];
    if (isEmptyTraitValue(value)) continue;
    const buffer = await remoteLayerBuffer(traitType, value, origin);
    if (!buffer) missing.push(`${traitType}: ${value}`);
  }

  return missing;
}

export async function renderTraitLabImage(tokenId: number, metadata: MetadataJson, origin = "") {
  const traits = traitMapFromMetadata(metadata as any);
  const size = renderSize();
  const composites: sharp.OverlayOptions[] = [];

  for (const traitType of REQUIRED_RENDER_LAYER_TRAITS) {
    if (isEmptyTraitValue(traits[traitType])) {
      return {
        imageId: "",
        imageUrl: metadata.image || "",
        rendered: false,
        missingLayer: `${traitType}: missing required layer`,
      };
    }
  }

  for (const traitType of RENDER_LAYER_ORDER) {
    const value = traits[traitType];
    if (isEmptyTraitValue(value)) continue;
    const buffer = await remoteLayerBuffer(traitType, value, origin);
    if (!buffer) {
      return {
        imageId: "",
        imageUrl: metadata.image || "",
        rendered: false,
        missingLayer: `${traitType}: ${value}`,
      };
    }
    composites.push({
      input: await sharp(buffer).resize(size, size, { fit: "fill" }).png().toBuffer(),
      top: 0,
      left: 0,
    });
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
