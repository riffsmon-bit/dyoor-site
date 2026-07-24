import {
  processPendingTraitBounties,
  verifyTraitBountyProcessorSecret,
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

export async function POST(request: Request) {
  try {
    assertTraitLabRateLimit(`trait-bounty-processor:${clientIp(request)}`, 8, 60_000);
    const supplied = request.headers.get("x-dyoor-bounty-secret")
      || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
      || "";
    if (!verifyTraitBountyProcessorSecret(supplied)) {
      return json(401, { ok: false, error: "Unauthorized bounty processor." });
    }
    const body = await request.json().catch(() => ({}));
    return json(200, await processPendingTraitBounties(Number(body.limit || 50)));
  } catch (error) {
    return json(Number((error as { status?: number })?.status || 500), {
      ok: false,
      error: error instanceof Error ? error.message : "Trait bounty processing failed.",
    });
  }
}
