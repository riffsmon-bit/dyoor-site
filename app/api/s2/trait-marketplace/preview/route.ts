import { createTraitMarketplaceLivePreview } from "@/lib/s2-trait-marketplace";
import { assertTraitLabRateLimit, normalizeWallet, traitLabPublicErrorMessage } from "@/lib/s2-trait-lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clientIp(request: Request) {
  return String(request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown").split(",")[0].trim();
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const wallet = normalizeWallet(body.wallet);
    assertTraitLabRateLimit(`marketplace-live-preview:${wallet || "invalid"}:${clientIp(request)}`, 30, 60_000);
    return Response.json(await createTraitMarketplaceLivePreview({
      ...body,
      origin: new URL(request.url).origin,
    }), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error: any) {
    return Response.json({
      ok: false,
      error: traitLabPublicErrorMessage(error, "Trait Marketplace live preview failed."),
    }, {
      status: Number(error?.status || 500),
      headers: { "cache-control": "no-store" },
    });
  }
}
