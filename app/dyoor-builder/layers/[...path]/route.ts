import traitItemMetadataJson from "@/data/dyoor-s2-trait-item-metadata.json";
import { NextResponse } from "next/server";

const DEFAULT_TRAIT_ASSETS_CID = "bafybeigzwmixppsb5hff7hioos3j427l7esli742p6p6hvyoxz3jfv7oiu";
const DEFAULT_PINATA_GATEWAY = "https://jade-efficient-beaver-697.mypinata.cloud";

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
  return (readEnv("NEXT_PUBLIC_PINATA_GATEWAY_URL", "PINATA_GATEWAY_URL") || DEFAULT_PINATA_GATEWAY).replace(/\/+$/, "");
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

  const url = traitItemAssetUrl(traitType, value);
  return NextResponse.redirect(url, {
    status: 302,
    headers: {
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
