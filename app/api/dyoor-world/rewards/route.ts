import {
  assertDyoorWorldRateLimit,
  checkInDyoorWorldDailyReward,
  claimDyoorWorldRewards,
  dyoorWorldClientIp,
  dyoorWorldErrorStatus,
  getDyoorWorldRewardStatus,
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
    return json(200, {
      ok: true,
      status: await getDyoorWorldRewardStatus(wallet),
    });
  } catch (error) {
    return json(dyoorWorldErrorStatus(error), {
      ok: false,
      error: (error as Error)?.message || "Could not load World Energy rewards.",
    });
  }
}

export async function POST(request: Request) {
  try {
    const { wallet } = await requireDyoorWorldRequest(request);
    assertDyoorWorldRateLimit(
      `world-reward:${wallet}:${dyoorWorldClientIp(request)}`,
      12,
      60_000,
    );
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "");
    if (action === "check-in") {
      const result = await checkInDyoorWorldDailyReward(wallet);
      return json(200, {
        ok: true,
        ...result,
        status: await getDyoorWorldRewardStatus(wallet),
      });
    }
    if (action === "claim") {
      return json(200, {
        ok: true,
        ...await claimDyoorWorldRewards(wallet),
      });
    }
    return json(400, { ok: false, error: "Choose check-in or claim." });
  } catch (error) {
    return json(dyoorWorldErrorStatus(error), {
      ok: false,
      error: (error as Error)?.message || "World Energy reward request failed.",
    });
  }
}
