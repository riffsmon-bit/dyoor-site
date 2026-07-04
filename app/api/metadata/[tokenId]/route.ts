import {
  METADATA_CACHE_CONTROL,
  buildTokenMetadata,
  getMetadataConfig,
  parseTokenId,
} from "@/lib/dyoor-s2-metadata.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MetadataRouteContext = {
  params: Promise<{ tokenId: string }> | { tokenId: string };
};

export async function GET(_request: Request, context: MetadataRouteContext) {
  const params = await context.params;
  const config = getMetadataConfig();
  const parsed = parseTokenId(params.tokenId, config.maxSupply);

  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, {
      status: parsed.status,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json",
      },
    });
  }

  const { metadata } = buildTokenMetadata(parsed.tokenId, config);

  return Response.json(metadata, {
    headers: {
      "cache-control": METADATA_CACHE_CONTROL,
      "content-type": "application/json",
    },
  });
}
