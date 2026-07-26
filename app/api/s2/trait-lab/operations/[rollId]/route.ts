import {
  assertTraitLabRateLimit,
  getTraitLabOperationStatus,
  normalizeWallet,
} from "@/lib/s2-trait-lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OperationRouteContext = {
  params: Promise<{ rollId: string }>;
};

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

export async function GET(request: Request, context: OperationRouteContext) {
  try {
    const { rollId } = await context.params;
    const wallet = normalizeWallet(new URL(request.url).searchParams.get("wallet"));
    if (!wallet) return json(400, { ok: false, error: "A valid wallet is required." });
    assertTraitLabRateLimit(`operation:${wallet}:${clientIp(request)}`, 30, 60_000);
    return json(200, await getTraitLabOperationStatus(rollId, wallet));
  } catch (error: any) {
    return json(Number(error?.status || 500), {
      ok: false,
      error: error?.message || "Trait Lab operation lookup failed.",
    });
  }
}
