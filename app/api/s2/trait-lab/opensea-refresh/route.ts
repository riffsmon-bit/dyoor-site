import { processDueOpenSeaMetadataRefreshes } from "@/lib/opensea-metadata-refresh";
import { assertTraitLabRateLimit } from "@/lib/s2-trait-lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function clientIp(request: Request) {
  return String(request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown").split(",")[0].trim();
}

async function processRefreshQueue(request: Request) {
  assertTraitLabRateLimit(`opensea-refresh:${clientIp(request)}`, 20, 60_000);
  return json(200, await processDueOpenSeaMetadataRefreshes({ limit: 10 }) as unknown as Record<string, unknown>);
}

export async function GET(request: Request) {
  try {
    return await processRefreshQueue(request);
  } catch (error: any) {
    return json(Number(error?.status || 500), { ok: false, error: error?.message || "OpenSea refresh processing failed." });
  }
}

export async function POST(request: Request) {
  try {
    return await processRefreshQueue(request);
  } catch (error: any) {
    return json(Number(error?.status || 500), { ok: false, error: error?.message || "OpenSea refresh processing failed." });
  }
}
