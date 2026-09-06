import {
  assertDyoorWorldRateLimit,
  dyoorWorldClientIp,
  dyoorWorldErrorStatus,
  getDyoorWorldNameAvailability,
  requireDyoorWorldEntitlement,
  requireDyoorWorldRequest,
} from "@/lib/dyoor-world-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function GET(request: Request) {
  try {
    const { wallet } = await requireDyoorWorldRequest(request);
    await requireDyoorWorldEntitlement(wallet, "season2");
    assertDyoorWorldRateLimit(
      `world-name-availability:${wallet}:${dyoorWorldClientIp(request)}`,
      45,
      60_000,
    );
    const label = new URL(request.url).searchParams.get("label");
    return json(200, {
      ok: true,
      availability: await getDyoorWorldNameAvailability(wallet, label),
    });
  } catch (error) {
    return json(dyoorWorldErrorStatus(error), {
      ok: false,
      error: (error as Error)?.message || "Could not check this dYOOR World name.",
    });
  }
}
