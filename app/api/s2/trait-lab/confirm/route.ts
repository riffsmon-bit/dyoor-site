import { assertTraitLabRateLimit, confirmTraitLabPreview, normalizeWallet } from "@/lib/s2-trait-lab";

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

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const wallet = normalizeWallet(body.wallet);
    assertTraitLabRateLimit(`confirm:${wallet || "invalid"}:${clientIp(request)}`, 8, 60_000);
    return json(200, await confirmTraitLabPreview({
      ...body,
      origin: new URL(request.url).origin,
    }));
  } catch (error: any) {
    return json(Number(error?.status || 500), { ok: false, error: error?.message || "Trait Lab confirm failed." });
  }
}
