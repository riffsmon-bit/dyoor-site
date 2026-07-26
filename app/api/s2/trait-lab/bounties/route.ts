import {
  traitBountyPublicState,
} from "@/lib/s2-trait-bounties";
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
  return String(
    request.headers.get("x-forwarded-for")
      || request.headers.get("x-real-ip")
      || "unknown",
  ).split(",")[0].trim();
}

export async function GET(request: Request) {
  try {
    assertTraitLabRateLimit(`trait-bounties:${clientIp(request)}`, 30, 60_000);
    return json(200, {
      ok: true,
      ...await traitBountyPublicState(),
    });
  } catch (error) {
    return json(Number((error as { status?: number })?.status || 500), {
      ok: false,
      error: error instanceof Error ? error.message : "Trait bounties are unavailable.",
    });
  }
}
