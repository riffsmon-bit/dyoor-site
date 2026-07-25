import {
  assertDyoorWorldRateLimit,
  dyoorWorldClientIp,
  dyoorWorldErrorStatus,
  requireDyoorWorldRequest,
  verifyDyoorWorldTradeTransaction,
} from "@/lib/dyoor-world-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { wallet } = await requireDyoorWorldRequest(request);
    assertDyoorWorldRateLimit(
      `world-trade:${wallet}:${dyoorWorldClientIp(request)}`,
      16,
      60_000,
    );
    const body = await request.json().catch(() => ({}));
    return Response.json({
      ok: true,
      ...await verifyDyoorWorldTradeTransaction({
        wallet,
        txHash: body?.txHash,
      }),
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({
      ok: false,
      error: (error as Error)?.message || "Could not verify the World escrow event.",
    }, {
      status: dyoorWorldErrorStatus(error),
      headers: { "cache-control": "no-store" },
    });
  }
}
