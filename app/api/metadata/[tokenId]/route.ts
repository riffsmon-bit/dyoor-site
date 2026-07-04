import {
  METADATA_CACHE_CONTROL,
  buildTokenMetadataAsync,
  getRuntimeMetadataConfig,
  parseTokenId,
} from "@/lib/dyoor-s2-metadata.js";

export const runtime = "nodejs";

type MetadataRouteContext = {
  params: Promise<{ tokenId: string }> | { tokenId: string };
};

export async function GET(_request: Request, context: MetadataRouteContext) {
  const params = await context.params;
  const config = await getRuntimeMetadataConfig();
  const parsed = parseTokenId(params.tokenId, config.maxSupply);

  if (!parsed.ok) {
    return jsonResponse({ error: parsed.error }, {
      status: parsed.status,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }

  const { metadata } = await buildTokenMetadataAsync(parsed.tokenId, config);

  return jsonResponse(metadata, {
    headers: metadataCacheHeaders(),
  });
}

function metadataCacheHeaders() {
  return {
    "Cache-Control": METADATA_CACHE_CONTROL,
    "CDN-Cache-Control": METADATA_CACHE_CONTROL,
    "Netlify-CDN-Cache-Control": METADATA_CACHE_CONTROL,
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}
