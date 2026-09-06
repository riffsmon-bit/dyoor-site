import traitItemMetadataJson from "@/data/dyoor-s2-trait-item-metadata.json";
import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

const DEFAULT_TRAIT_ASSETS_CID = "bafybeigzwmixppsb5hff7hioos3j427l7esli742p6p6hvyoxz3jfv7oiu";
const DEFAULT_PINATA_GATEWAY = "https://jade-efficient-beaver-697.mypinata.cloud";
const BUNDLED_BASE_LAYER_DIR = "data/dyoor-s2-base-layers";

type TraitItemMetadata = {
  slot?: string;
  name?: string;
  image?: string;
};

function readEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
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

function gatewayBase() {
  return (readEnv("IPFS_GATEWAY_URL", "NEXT_PUBLIC_IPFS_GATEWAY_URL", "NEXT_PUBLIC_PINATA_GATEWAY_URL", "PINATA_GATEWAY_URL") || DEFAULT_PINATA_GATEWAY).replace(/\/+$/, "");
}

function ipfsGatewayUrl(uri: string) {
  const raw = String(uri || "").trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  if (!raw.startsWith("ipfs://")) return "";
  return `${gatewayBase()}/ipfs/${raw.slice(7).replace(/^\/+/, "")}`;
}

function traitSlotFromRoute(value: string) {
  return value === "Stickers:Body art" ? "Stickers/Body art" : value;
}

function contentTypeFor(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".webp") return "image/webp";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "image/png";
}

async function bundledLayer(traitType: string, value: string) {
  const root = path.resolve(process.cwd(), BUNDLED_BASE_LAYER_DIR);
  const folder = traitType === "Stickers/Body art" ? "Stickers:Body art" : traitType;
  const rawName = String(value || "").trim().replace(/\.[a-z0-9]+$/i, "");
  const directory = path.join(root, folder);
  const candidateNames = [`${rawName}.png`, `${rawName}.PNG`, `${rawName}.webp`, `${rawName}.WEBP`, rawName];

  for (const candidateName of candidateNames) {
    const filePath = path.normalize(path.join(directory, candidateName));
    if (!filePath.startsWith(root)) continue;
    try {
      const body = await fs.readFile(filePath);
      return { body, filePath };
    } catch {}
  }

  try {
    const entries = await fs.readdir(directory);
    const match = entries.find((entry) => normalizeComparable(entry) === normalizeComparable(rawName));
    if (match) {
      const filePath = path.join(directory, match);
      const body = await fs.readFile(filePath);
      return { body, filePath };
    }
  } catch {}

  return null;
}

function traitItemAssetUrl(traitType: string, value: string) {
  const entries = traitItemMetadataJson as Record<string, TraitItemMetadata>;
  const direct = entries[`${traitType}::${value}`];
  if (direct?.image) return ipfsGatewayUrl(direct.image);

  const normalizedTrait = normalizeComparable(traitType);
  const normalizedValue = normalizeComparable(value);
  const match = Object.values(entries).find((item) => {
    return normalizeComparable(item?.slot) === normalizedTrait && normalizeComparable(item?.name) === normalizedValue;
  });
  if (match?.image) return ipfsGatewayUrl(match.image);

  const cid = readEnv("DYOOR_S2_TRAIT_ASSETS_CID", "NEXT_PUBLIC_DYOOR_S2_TRAIT_ASSETS_CID") || DEFAULT_TRAIT_ASSETS_CID;
  return `${gatewayBase()}/ipfs/${cid}/${encodeURIComponent(slugFile(value))}`;
}

export async function GET(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await context.params;
  if (!Array.isArray(parts) || parts.length < 2) {
    return new NextResponse("Not found", { status: 404 });
  }

  const traitType = traitSlotFromRoute(String(parts[0] || "").trim());
  const value = decodeURIComponent(String(parts.slice(1).join("/") || ""))
    .trim()
    .replace(/\.[a-z0-9]+$/i, "");
  if (!traitType || !value) return new NextResponse("Not found", { status: 404 });

  const local = await bundledLayer(traitType, value);
  if (local) {
    return new NextResponse(new Uint8Array(local.body), {
      status: 200,
      headers: {
        "cache-control": "public, max-age=31536000, immutable",
        "content-type": contentTypeFor(local.filePath),
      },
    });
  }

  const url = traitItemAssetUrl(traitType, value);
  return NextResponse.redirect(url, {
    status: 302,
    headers: {
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
