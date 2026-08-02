import { getTraitMarketplaceQuoteStatus } from "@/lib/s2-trait-marketplace";
import { assertTraitLabRateLimit, normalizeWallet, traitLabPublicErrorMessage } from "@/lib/s2-trait-lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type QuoteRouteContext = {
  params: Promise<{ quoteId: string }>;
};

function clientIp(request: Request) {
  return String(request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown").split(",")[0].trim();
}
export async function GET(request: Request, context: QuoteRouteContext) {
  try {
    const { quoteId } = await context.params;
    const wallet = normalizeWallet(new URL(request.url).searchParams.get("wallet"));
    assertTraitLabRateLimit(`marketplace-status:${wallet || "invalid"}:${clientIp(request)}`, 30, 60_000);
    return Response.json(await getTraitMarketplaceQuoteStatus(quoteId, wallet), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error: any) {
    return Response.json({
      ok: false,
      error: traitLabPublicErrorMessage(error, "Trait Marketplace quote status is unavailable."),
    }, {
      status: Number(error?.status || 500),
      headers: { "cache-control": "no-store" },
    });
  }
}
