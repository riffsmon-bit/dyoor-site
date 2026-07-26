import {
  assertDyoorWorldRateLimit,
  dyoorWorldClientIp,
  dyoorWorldErrorStatus,
  hasDyoorWorldAccess,
} from "@/lib/dyoor-world-server";
import { normalizeWorldWallet } from "@/lib/dyoor-world";
import { dyoorS2Contract } from "@/lib/contracts/addresses";

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
    return json(200, {
      ok: true,
      eligible: await hasDyoorWorldAccess(wallet),
      wallet,
      contractAddress: dyoorS2Contract,
      chainId: 143,
    });
  } catch (error) {
    return json(dyoorWorldErrorStatus(error), {
      ok: false,
      eligible: false,
      error: (error as Error)?.message || "Could not verify dYOOR World access.",
    });
  }
}
