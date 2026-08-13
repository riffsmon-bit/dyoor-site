import {
  assertHoodYoorRateLimit,
  getHoodYoorTraitLabStatus,
  hoodYoorPublicErrorMessage,
} from "@/lib/hoodyoor-reroll-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function clientIp(request: Request) {
  return String(request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown")
    .split(",")[0]
    .trim();
}

export async function GET(request: Request) {
  try {
    assertHoodYoorRateLimit(`status:${clientIp(request)}`, 30, 60_000);
    const url = new URL(request.url);
    return json(200, await getHoodYoorTraitLabStatus({
      wallet: url.searchParams.get("wallet"),
      tokenId: url.searchParams.get("tokenId"),
    }));
  } catch (error) {
    return json(Number((error as { status?: number })?.status || 500), {
      ok: false,
      error: hoodYoorPublicErrorMessage(error, "HoodYØØR Trait Lab status is unavailable."),
    });
  }
}
