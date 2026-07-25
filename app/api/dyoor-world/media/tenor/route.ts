import {
  assertDyoorWorldRateLimit,
  dyoorWorldClientIp,
  dyoorWorldError,
  dyoorWorldErrorStatus,
  requireDyoorWorldRequest,
} from "@/lib/dyoor-world-server";
import { normalizeDyoorWorldMediaUrl } from "@/lib/dyoor-world-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TenorMedia = {
  url?: string;
  dims?: number[];
};

type TenorResult = {
  id?: string;
  title?: string;
  content_description?: string;
  media_formats?: Record<string, TenorMedia | undefined>;
};

function readEnv(...names: string[]) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

function tenorConfig() {
  const apiKey = readEnv("TENOR_API_KEY", "GOOGLE_TENOR_API_KEY");
  if (!apiKey) {
    throw dyoorWorldError(
      "Tenor search needs TENOR_API_KEY in the Netlify Functions environment.",
      503,
    );
  }
  return {
    apiKey,
    clientKey: readEnv("TENOR_CLIENT_KEY") || "dyoor_world",
  };
}

async function tenorRequest(endpoint: "featured" | "registershare" | "search", params: URLSearchParams) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6_000);
  try {
    return await fetch(`https://tenor.googleapis.com/v2/${endpoint}?${params}`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timeout);
  }
}

function mappedTenorResult(result: TenorResult) {
  const full = result.media_formats?.gif || result.media_formats?.mediumgif;
  const preview = result.media_formats?.tinygif
    || result.media_formats?.nanogif
    || full;
  const media = normalizeDyoorWorldMediaUrl(full?.url);
  const thumbnail = normalizeDyoorWorldMediaUrl(preview?.url);
  if (!result.id || !media || !thumbnail) return null;
  return {
    id: String(result.id),
    title: String(result.content_description || result.title || "Tenor GIF").slice(0, 120),
    url: media.url,
    previewUrl: thumbnail.url,
    width: Number(full?.dims?.[0] || 0),
    height: Number(full?.dims?.[1] || 0),
  };
}

export async function GET(request: Request) {
  try {
    const { wallet } = await requireDyoorWorldRequest(request);
    assertDyoorWorldRateLimit(
      `world-tenor-search:${wallet}:${dyoorWorldClientIp(request)}`,
      30,
      60_000,
    );
    const { apiKey, clientKey } = tenorConfig();
    const query = String(new URL(request.url).searchParams.get("q") || "")
      .replace(/[\u0000-\u001F\u007F]/g, "")
      .trim()
      .slice(0, 80);
    const params = new URLSearchParams({
      key: apiKey,
      client_key: clientKey,
      country: "US",
      locale: "en_US",
      contentfilter: "high",
      media_filter: "gif,mediumgif,tinygif,nanogif",
      ar_range: "standard",
      limit: "18",
    });
    if (query) params.set("q", query);
    const response = await tenorRequest(query ? "search" : "featured", params);
    const data = await response.json().catch(() => ({})) as {
      results?: TenorResult[];
      next?: string;
      error?: { message?: string };
    };
    if (!response.ok) {
      throw dyoorWorldError(
        data.error?.message || `Tenor search failed (${response.status}).`,
        503,
      );
    }
    return Response.json({
      ok: true,
      query,
      results: (data.results || []).map(mappedTenorResult).filter(Boolean),
      next: String(data.next || ""),
    }, {
      headers: { "cache-control": "private, max-age=60" },
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: (error as Error)?.message || "Could not search Tenor.",
    }, {
      status: dyoorWorldErrorStatus(error),
      headers: { "cache-control": "no-store" },
    });
  }
}

export async function POST(request: Request) {
  try {
    const { wallet } = await requireDyoorWorldRequest(request);
    assertDyoorWorldRateLimit(
      `world-tenor-share:${wallet}:${dyoorWorldClientIp(request)}`,
      30,
      60_000,
    );
    const body = await request.json().catch(() => ({}));
    const id = String(body?.id || "").trim();
    const query = String(body?.query || "").trim().slice(0, 80);
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
      throw dyoorWorldError("Choose a valid Tenor GIF.", 400);
    }
    const { apiKey, clientKey } = tenorConfig();
    const params = new URLSearchParams({
      key: apiKey,
      client_key: clientKey,
      id,
      q: query,
      locale: "en_US",
    });
    const response = await tenorRequest("registershare", params);
    return Response.json({ ok: response.ok }, {
      status: response.ok ? 200 : 502,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: (error as Error)?.message || "Could not register the Tenor share.",
    }, {
      status: dyoorWorldErrorStatus(error),
      headers: { "cache-control": "no-store" },
    });
  }
}
