import {
  buildTokenMetadataAsync,
  getRuntimeMetadataConfig,
  getRuntimeTraitOverrides,
  parseTokenId,
  saveRuntimeTraitOverride,
} from "@/lib/dyoor-s2-metadata.js";
import { RENDER_PIPELINE_VERSION, renderTraitLabImage } from "@/lib/s2-trait-lab-render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

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

  const tokenId = Number(parsed.tokenId);
  const result = await buildTokenMetadataAsync(tokenId, config);
  let { metadata } = result;
  const override = await getRuntimeTraitOverrides(tokenId);
  const legacyRenderId = String(override?.imageRender?.imageId || "").includes("eyJ0b2tlbklk");
  const staleRenderer = Boolean(override?.imageRender?.rendererVersion)
    ? override?.imageRender?.rendererVersion !== RENDER_PIPELINE_VERSION
    : Boolean(override?.imageRender);
  const shouldRenderOverrideImage = Boolean(
    override?.attributes
      && (!override.image || legacyRenderId || staleRenderer || /image recomposition TODO/i.test(String(override.notes || "")))
      && !result.usedFallback,
  );
  if (shouldRenderOverrideImage) {
    const rendered = await renderTraitLabImage(tokenId, metadata as any, new URL(_request.url).origin);
    if (rendered.rendered) {
      await saveRuntimeTraitOverride(tokenId, {
        ...override,
        image: rendered.imageUrl,
        imageRender: {
          imageId: rendered.imageId,
          url: rendered.imageUrl,
          rendererVersion: rendered.rendererVersion,
          renderedAt: new Date().toISOString(),
        },
        notes: String(override.notes || "").replace(/;?\s*image recomposition TODO\.?/i, "").trim() || override.notes,
      });
      metadata = (await buildTokenMetadataAsync(tokenId, config)).metadata;
    }
  }

  return jsonResponse(metadata, {
    headers: metadataCacheHeaders(),
  });
}

function metadataCacheHeaders() {
  return {
    "Cache-Control": "no-store",
    "CDN-Cache-Control": "no-store",
    "Netlify-CDN-Cache-Control": "no-store",
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
