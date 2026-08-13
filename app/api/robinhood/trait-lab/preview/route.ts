import {
  assertHoodYoorRateLimit,
  createHoodYoorRerollPreview,
  hoodYoorPublicErrorMessage,
} from "@/lib/hoodyoor-reroll-server";
import { normalizeHoodYoorWallet } from "@/lib/hoodyoor-reroll";

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

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const wallet = normalizeHoodYoorWallet(body.wallet);
    assertHoodYoorRateLimit(`preview:${wallet || "invalid"}:${clientIp(request)}`, 8, 60_000);
    return json(200, await createHoodYoorRerollPreview(body));
  } catch (error) {
    return json(Number((error as { status?: number })?.status || 500), {
      ok: false,
      error: hoodYoorPublicErrorMessage(error, "HoodYØØR preview generation failed."),
    });
  }
}
