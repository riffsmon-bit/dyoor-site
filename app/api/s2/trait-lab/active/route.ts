import {
  assertTraitLabRateLimit,
  getActiveTraitLabOperationStatus,
  normalizeWallet,
} from "@/lib/s2-trait-lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function clientIp(request: Request) {
  return String(request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown")
    .split(",")[0]
    .trim();
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const wallet = normalizeWallet(url.searchParams.get("wallet"));
    const tokenId = url.searchParams.get("tokenId");
    if (!wallet) return json(400, { ok: false, error: "A valid wallet is required." });
    assertTraitLabRateLimit(`active-operation:${wallet}:${clientIp(request)}`, 30, 60_000);
    return json(200, await getActiveTraitLabOperationStatus(tokenId, wallet));
  } catch (error: any) {
    return json(Number(error?.status || 500), {
      ok: false,
      error: error?.message || "Active Trait Lab operation lookup failed.",
    });
  }
}
