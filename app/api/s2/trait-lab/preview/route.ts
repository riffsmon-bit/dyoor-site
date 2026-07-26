import {
  assertTraitLabRateLimit,
  createTraitLabPreview,
  getTraitLabOperationStatus,
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
  return String(request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown").split(",")[0].trim();
}

export async function POST(request: Request) {
  let wallet = "";
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    wallet = normalizeWallet(body.wallet);
    assertTraitLabRateLimit(`preview:${wallet || "invalid"}:${clientIp(request)}`, 12, 60_000);
    return json(200, await createTraitLabPreview({
      ...body,
      origin: new URL(request.url).origin,
    }));
  } catch (error: any) {
    let recoveryPreview = error?.recoveryPreview;
    if (!recoveryPreview && error?.recoveryRequired && error?.operationId && wallet) {
      const status = await getTraitLabOperationStatus(error.operationId, wallet).catch(() => null);
      recoveryPreview = status?.retryPreview;
    }
    return json(Number(error?.status || 500), {
      ok: false,
      error: traitLabPublicErrorMessage(error, "Trait Lab preview failed."),
      operationId: error?.operationId,
      recoveryRequired: Boolean(error?.recoveryRequired),
      recoveryPreview,
    });
  }
}
