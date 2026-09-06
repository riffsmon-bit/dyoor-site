import {
  buildTokenMetadataAsync,
  getRuntimeMetadataConfig,
  parseTokenId,
} from "@/lib/dyoor-s2-metadata.js";

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
  const metadata = normalizeMetadataUrls(result.metadata, requestOrigin);

  return jsonResponse(metadata, {
    headers: metadataCacheHeaders(),
  });
}

function metadataResponseOrigin(request: Request) {
  const configured = firstEnv("DYOOR_METADATA_PUBLIC_ORIGIN", "NEXT_PUBLIC_DYOOR_METADATA_ORIGIN");
  if (configured) return configured.replace(/\/+$/, "");

  const url = new URL(request.url);
  if (
    url.hostname === "dyoor.xyz"
    || url.hostname === "www.dyoor.xyz"
    || url.hostname === "dyoor.netlify.app"
    || url.hostname.endsWith("--dyoor.netlify.app")
  ) {
    return "https://dyoor.fun";
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
