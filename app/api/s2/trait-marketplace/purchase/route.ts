import { purchaseTraitMarketplaceQuote } from "@/lib/s2-trait-marketplace";
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
    assertTraitLabRateLimit(`marketplace-purchase:${wallet || "invalid"}:${clientIp(request)}`, 8, 60_000);
    return Response.json(await purchaseTraitMarketplaceQuote({
      ...body,
      origin: new URL(request.url).origin,
    }), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error: any) {
    return Response.json({
      ok: false,
      error: traitLabPublicErrorMessage(error, "Trait Marketplace purchase failed."),
      quoteId: error?.quoteId,
      recoveryRequired: Boolean(error?.recoveryRequired),
    }, {
      status: Number(error?.status || 500),
      headers: { "cache-control": "no-store" },
    });
  }
}
