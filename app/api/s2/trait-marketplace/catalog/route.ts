import { getTraitMarketplaceCatalog } from "@/lib/s2-trait-marketplace";
import { assertTraitLabRateLimit } from "@/lib/s2-trait-lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clientIp(request: Request) {
  return String(request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown").split(",")[0].trim();
}
export async function GET(request: Request) {
  try {
    assertTraitLabRateLimit(`marketplace-catalog:${clientIp(request)}`, 60, 60_000);
    return Response.json(await getTraitMarketplaceCatalog(), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error: any) {
    return Response.json({
      ok: false,
      error: error?.message || "Trait Marketplace catalog is unavailable.",
    }, {
      status: Number(error?.status || 500),
      headers: { "cache-control": "no-store" },
    });
  }
}
