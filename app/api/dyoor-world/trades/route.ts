import {
  assertDyoorWorldRateLimit,
  dyoorWorldClientIp,
  dyoorWorldErrorStatus,
  getDyoorWorldTrade,
  requireDyoorWorldEntitlement,
  requireDyoorWorldRequest,
  verifyDyoorWorldTradeTransaction,
} from "@/lib/dyoor-world-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { wallet } = await requireDyoorWorldRequest(request);
    await requireDyoorWorldEntitlement(wallet, "season2");
    assertDyoorWorldRateLimit(
      `world-trade-read:${wallet}:${dyoorWorldClientIp(request)}`,
      30,
      60_000,
    );
    const tradeId = new URL(request.url).searchParams.get("id");
    return Response.json({
      ok: true,
      trade: await getDyoorWorldTrade(tradeId),
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({
      ok: false,
      error: (error as Error)?.message || "Could not load the World escrow offer.",
    }, {
      status: dyoorWorldErrorStatus(error),
      headers: { "cache-control": "no-store" },
    });
  }
}

export async function POST(request: Request) {
  try {
    const { wallet } = await requireDyoorWorldRequest(request);
    await requireDyoorWorldEntitlement(wallet, "season2");
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
