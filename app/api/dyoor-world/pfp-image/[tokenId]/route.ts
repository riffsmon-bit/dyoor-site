import {
  buildTokenMetadataAsync,
  getRuntimeMetadataConfig,
  parseTokenId,
} from "@/lib/dyoor-s2-metadata.js";
import { ipfsGatewayUrl } from "@/lib/ipfs-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ tokenId: string }>;
};

function publicImageUrl(value: unknown, origin: string) {
  const image = String(value || "").trim();
  if (image.startsWith("ipfs://")) return ipfsGatewayUrl(image);
  if (image.startsWith("/")) return `${origin}${image}`;
  try {
    const url = new URL(image);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export async function GET(request: Request, context: Context) {
  const { tokenId: tokenIdValue } = await context.params;
  const config = await getRuntimeMetadataConfig();
  const parsed = parseTokenId(tokenIdValue, config.maxSupply);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, {
      status: parsed.status,
      headers: { "cache-control": "no-store" },
    });
  }
  const { metadata } = await buildTokenMetadataAsync(Number(parsed.tokenId), config);
  const image = publicImageUrl(metadata?.image, new URL(request.url).origin);
  if (!image) {
    return Response.json({ error: "This S2 Droid has no usable image." }, {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }
  return Response.redirect(image, 307);
}
