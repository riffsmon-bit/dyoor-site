import {
  assertDyoorWorldRateLimit,
  dyoorWorldClientIp,
  dyoorWorldErrorStatus,
  requireDyoorWorldRequest,
} from "@/lib/dyoor-world-server";
import { normalizeDyoorWorldMediaUrl } from "@/lib/dyoor-world-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type KlipyMedia = {
  url?: unknown;
};

type KlipyResult = {
  id?: unknown;
  title?: unknown;
  content_description?: unknown;
  media_formats?: Record<string, KlipyMedia | undefined>;
};

type GifSearchResult = {
  id: string;
  title: string;
  previewUrl: string;
  url: string;
};

const GIF_CACHE_TTL_MS = 10 * 60_000;
const gifCache = new Map<string, {
  expiresAt: number;
  results: GifSearchResult[];
}>();

function readEnv(...names: string[]) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

function cleanQuery(value: unknown) {
  return String(value || "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 50);
}

function cleanTitle(value: unknown) {
  return String(value || "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function safeMediaUrl(value: unknown) {
  const normalized = normalizeDyoorWorldMediaUrl(value);
  return normalized?.url || "";
}

function normalizeKlipyResult(value: unknown): GifSearchResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as KlipyResult;
  const formats = result.media_formats || {};
  const fullUrl = safeMediaUrl(
    formats.gif?.url
      || formats.mediumgif?.url
      || formats.tinygif?.url
      || formats.nanogif?.url,
  );
  const previewUrl = safeMediaUrl(
    formats.tinygif?.url
      || formats.nanogif?.url
      || formats.mediumgif?.url
      || formats.gif?.url,
  );
  if (!fullUrl || !previewUrl) return null;
  const id = cleanTitle(result.id);
  if (!id) return null;
  return {
    id,
    title: cleanTitle(result.content_description || result.title) || "KLIPY GIF",
    previewUrl,
    url: fullUrl,
  };
}

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function GET(request: Request) {
  try {
    const { wallet } = await requireDyoorWorldRequest(request);
    const query = cleanQuery(new URL(request.url).searchParams.get("q"));
    if (query.length < 2) {
      return json(200, {
        ok: true,
        enabled: Boolean(readEnv("KLIPY_API_KEY", "DYOOR_WORLD_KLIPY_API_KEY")),
        results: [],
      });
    }

    const cacheKey = query.toLowerCase();
    const cached = gifCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return json(200, {
        ok: true,
        enabled: true,
        cached: true,
        results: cached.results,
      });
    }

    const apiKey = readEnv("KLIPY_API_KEY", "DYOOR_WORLD_KLIPY_API_KEY");
    if (!apiKey) {
      return json(503, {
        ok: false,
        enabled: false,
        error: "GIF search is not configured yet.",
      });
    }

    assertDyoorWorldRateLimit(
      `world-gif-search:${wallet}:${dyoorWorldClientIp(request)}`,
      20,
      60 * 60_000,
    );
    assertDyoorWorldRateLimit(
      "world-gif-search:upstream",
      80,
      60 * 60_000,
    );

    const clientKey = (
      readEnv("DYOOR_WORLD_KLIPY_CLIENT_KEY") || "dyoor_world"
    ).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "dyoor_world";
    const upstreamUrl = new URL("https://api.klipy.com/v2/search");
    upstreamUrl.searchParams.set("q", query);
    upstreamUrl.searchParams.set("key", apiKey);
    upstreamUrl.searchParams.set("client_key", clientKey);
    upstreamUrl.searchParams.set("limit", "18");
    upstreamUrl.searchParams.set("contentfilter", "medium");
    upstreamUrl.searchParams.set("media_filter", "tinygif,gif");
    upstreamUrl.searchParams.set("locale", "en_US");

    const upstream = await fetch(upstreamUrl, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(7_000),
    });
    if (!upstream.ok) {
      throw Object.assign(
        new Error(
          upstream.status === 429
            ? "GIF search reached its temporary provider limit. Try again later."
            : "The GIF provider is temporarily unavailable.",
        ),
        { status: upstream.status === 429 ? 429 : 502 },
      );
    }
    const payload = await upstream.json().catch(() => ({})) as {
      results?: unknown[];
    };
    const results = (Array.isArray(payload.results) ? payload.results : [])
      .map(normalizeKlipyResult)
      .filter((result): result is GifSearchResult => Boolean(result))
      .slice(0, 18);
    gifCache.set(cacheKey, {
      expiresAt: Date.now() + GIF_CACHE_TTL_MS,
      results,
    });
    return json(200, {
      ok: true,
      enabled: true,
      results,
    });
  } catch (error) {
    return json(dyoorWorldErrorStatus(error), {
      ok: false,
      error: (error as Error)?.message || "Could not search GIFs.",
    });
  }
}
