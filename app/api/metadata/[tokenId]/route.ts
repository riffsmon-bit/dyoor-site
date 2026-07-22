import {
  buildTokenMetadataAsync,
  getRuntimeMetadataConfig,
  getRuntimeTraitOverrides,
  parseTokenId,
  saveRuntimeTraitOverride,
} from "@/lib/dyoor-s2-metadata.js";
import { processDueOpenSeaMetadataRefreshes, refreshOpenSeaTokenMetadataNowAndLater } from "@/lib/opensea-metadata-refresh";
import { RENDER_PIPELINE_VERSION, renderTraitLabImage, traitRenderImageId } from "@/lib/s2-trait-lab-render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type MetadataRouteContext = {
  params: Promise<{ tokenId: string }>;
};

export async function GET(_request: Request, context: MetadataRouteContext) {
  const requestOrigin = metadataResponseOrigin(_request);
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
  const externalRenderUrl = isExternalTraitLabRenderUrl(override?.image || override?.imageRender?.url, requestOrigin);
  const overrideImageIsStaticBase = isStaticBaseTokenImageUrl(override?.image, tokenId);
  const metadataImageIsStaticBase = isStaticBaseTokenImageUrl((metadata as any)?.image, tokenId);
  const staleRenderer = Boolean(override?.imageRender?.rendererVersion)
    ? override?.imageRender?.rendererVersion !== RENDER_PIPELINE_VERSION
    : Boolean(override?.imageRender);
  const staleTraitRender = Boolean(override?.imageRender?.imageId)
    && override?.imageRender?.imageId !== traitRenderImageId(tokenId, metadata as any);
  const reconciledAttributes = reconciledOverrideAttributes(override?.attributes, metadata);
  const overrideAttributesNeedReconciliation = !overrideAttributesMatch(override?.attributes, reconciledAttributes);
  const shouldRenderOverrideImage = Boolean(
    override?.attributes
      && (!override.image || legacyRenderId || externalRenderUrl || overrideImageIsStaticBase || metadataImageIsStaticBase || staleRenderer || staleTraitRender || /image recomposition TODO/i.test(String(override.notes || "")))
      && !result.usedFallback,
  );
  if (shouldRenderOverrideImage) {
    const rendered = await renderTraitLabImage(tokenId, metadata as any, requestOrigin);
    if (rendered.rendered) {
      await saveRuntimeTraitOverride(tokenId, {
        ...override,
        attributes: reconciledAttributes,
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
      await processDueOpenSeaMetadataRefreshes().catch(() => undefined);
      await refreshOpenSeaTokenMetadataNowAndLater({
        tokenId,
        reason: "metadata_route_image_repair",
      }).catch(() => undefined);
    } else if (staleRenderer || externalRenderUrl || legacyRenderId) {
      const nextOverride = { ...override };
      delete nextOverride.image;
      delete nextOverride.imageRender;
      await saveRuntimeTraitOverride(tokenId, {
        ...nextOverride,
        notes: [String(override.notes || "").replace(/;?\s*image recomposition TODO\.?/i, "").trim(), "image render skipped because a locked base layer asset is unavailable."]
          .filter(Boolean)
          .join("; "),
      });
      metadata = (await buildTokenMetadataAsync(tokenId, config)).metadata;
    }
  } else if (overrideAttributesNeedReconciliation) {
    await saveRuntimeTraitOverride(tokenId, {
      ...override,
      attributes: reconciledAttributes,
      updatedAt: new Date().toISOString(),
    });
    metadata = (await buildTokenMetadataAsync(tokenId, config)).metadata;
    await processDueOpenSeaMetadataRefreshes().catch(() => undefined);
    await refreshOpenSeaTokenMetadataNowAndLater({
      tokenId,
      reason: "metadata_route_attribute_reconcile",
    }).catch(() => undefined);
  }

  metadata = normalizeMetadataUrls(metadata, requestOrigin);

  return jsonResponse(metadata, {
    headers: metadataCacheHeaders(),
  });
}

function metadataResponseOrigin(request: Request) {
  const configured = firstEnv("DYOOR_METADATA_PUBLIC_ORIGIN", "NEXT_PUBLIC_DYOOR_METADATA_ORIGIN");
  if (configured) return configured.replace(/\/+$/, "");

  const url = new URL(request.url);
  if (url.hostname === "dyoor.xyz" || url.hostname.endsWith("--dyoor.netlify.app")) {
    return "https://dyoor.netlify.app";
  }
  return url.origin;
}

function firstEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function isExternalTraitLabRenderUrl(value: unknown, requestOrigin: string) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const parsed = new URL(value);
    const origin = new URL(requestOrigin);
    return parsed.pathname.startsWith("/api/s2/trait-lab/render/")
      && (isLocalHost(parsed.hostname) || parsed.origin !== origin.origin);
  } catch {
    return false;
  }
}

function isStaticBaseTokenImageUrl(value: unknown, tokenId: number) {
  if (typeof value !== "string" || !value.trim()) return false;
  const raw = value.trim();
  const tokenFile = `${tokenId}.png`;
  if (raw.startsWith("ipfs://")) return raw.endsWith(`/${tokenFile}`);

  try {
    const parsed = new URL(raw);
    return parsed.pathname.endsWith(`/${tokenFile}`)
      && !parsed.pathname.includes("/api/s2/trait-lab/render/");
  } catch {
    return false;
  }
}

function reconciledOverrideAttributes(attributes: unknown, _metadata: any) {
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) return attributes;

  // Compatibility is enforced by Trait Lab before saving overrides. Keep the
  // metadata endpoint non-destructive so independent wearable slots survive.
  return { ...(attributes as Record<string, unknown>) };
}

function overrideAttributesMatch(left: unknown, right: unknown) {
  if (left === right) return true;
  if (!left || typeof left !== "object" || Array.isArray(left)) return left === right;
  if (!right || typeof right !== "object" || Array.isArray(right)) return false;

  const leftEntries = Object.entries(left as Record<string, unknown>);
  const rightEntries = Object.entries(right as Record<string, unknown>);
  if (leftEntries.length !== rightEntries.length) return false;

  for (const [key, value] of leftEntries) {
    if (!Object.hasOwn(right as Record<string, unknown>, key)) return false;
    if (String((right as Record<string, unknown>)[key] ?? "") !== String(value ?? "")) return false;
  }

  return true;
}

function isLocalHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "::1";
}

function normalizeRenderUrl(value: unknown, requestOrigin: string) {
  if (typeof value !== "string" || !value.trim()) return value;
  if (value.startsWith("/api/s2/trait-lab/render/")) return `${requestOrigin}${value}`;

  try {
    const parsed = new URL(value);
    if (!parsed.pathname.startsWith("/api/s2/trait-lab/render/")) return value;
    return `${requestOrigin}${parsed.pathname}${parsed.search}`;
  } catch {
    return value;
  }
}

function normalizeMetadataUrls(metadata: any, requestOrigin: string) {
  if (!metadata || typeof metadata !== "object") return metadata;

  const next = { ...metadata };
  next.image = normalizeRenderUrl(next.image, requestOrigin);

  if (next.properties && typeof next.properties === "object" && !Array.isArray(next.properties)) {
    next.properties = { ...next.properties };
    if (Array.isArray(next.properties.files)) {
      next.properties.files = next.properties.files.map((file: any) => (
        file && typeof file === "object"
          ? { ...file, uri: normalizeRenderUrl(file.uri, requestOrigin) }
          : file
      ));
    }
  }

  return next;
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
