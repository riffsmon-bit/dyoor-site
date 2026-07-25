import {
  assertTraitLabRateLimit,
  forfeitTraitLabPreview,
  normalizeWallet,
  traitLabPublicErrorMessage,
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

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const wallet = normalizeWallet(body.wallet);
    assertTraitLabRateLimit(`forfeit:${wallet || "invalid"}:${clientIp(request)}`, 12, 60_000);
    return json(200, await forfeitTraitLabPreview(body));
  } catch (error: any) {
    return json(Number(error?.status || 500), {
      ok: false,
      error: traitLabPublicErrorMessage(error, "Trait Lab result could not be left behind."),
      operationId: error?.operationId,
      recoveryRequired: Boolean(error?.recoveryRequired),
    });
  }
}
