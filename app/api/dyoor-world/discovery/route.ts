import {
  assertDyoorWorldRateLimit,
  dyoorWorldClientIp,
  dyoorWorldErrorStatus,
  getDyoorWorldAccess,
} from "@/lib/dyoor-world-server";
import {
  DYOOR_WORLD_COLLECTIONS,
  normalizeWorldWallet,
} from "@/lib/dyoor-world";

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
    const wallet = normalizeWorldWallet(new URL(request.url).searchParams.get("wallet"));
    if (!wallet) return json(400, { ok: false, eligible: false, error: "wallet must be a valid address." });
    assertDyoorWorldRateLimit(
      `discovery:${wallet}:${dyoorWorldClientIp(request)}`,
      30,
      60_000,
    );
    const access = await getDyoorWorldAccess(wallet);
    return json(200, {
      ok: true,
      eligible: access.eligible,
      wallet,
      entitlements: access.entitlements,
      balances: access.balances,
      unavailable: access.unavailable,
      collections: DYOOR_WORLD_COLLECTIONS,
    });
  } catch (error) {
    return json(dyoorWorldErrorStatus(error), {
      ok: false,
      eligible: false,
      error: (error as Error)?.message || "Could not verify dYOOR World access.",
    });
  }
}
