import {
  assertDyoorWorldRateLimit,
  dyoorWorldClientIp,
  dyoorWorldErrorStatus,
  requireDyoorWorldEntitlement,
  requireDyoorWorldRequest,
  verifyDyoorWorldTip,
} from "@/lib/dyoor-world-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { wallet } = await requireDyoorWorldRequest(request);
    await requireDyoorWorldEntitlement(wallet, "season2");
    assertDyoorWorldRateLimit(
      `world-tip:${wallet}:${dyoorWorldClientIp(request)}`,
      12,
      60_000,
    );
    const body = await request.json().catch(() => ({}));
    return Response.json({
      ok: true,
      ...await verifyDyoorWorldTip({
        wallet,
        recipient: body?.recipient,
        txHash: body?.txHash,
      }),
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({
      ok: false,
      error: (error as Error)?.message || "Could not verify the MON tip.",
    }, {
      status: dyoorWorldErrorStatus(error),
      headers: { "cache-control": "no-store" },
    });
  }
}
