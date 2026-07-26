import {
  assertDyoorWorldRateLimit,
  dyoorWorldClientIp,
  dyoorWorldErrorStatus,
  requireDyoorWorldRequest,
} from "@/lib/dyoor-world-server";
import {
  dyoorWorldPushStatus,
  sendDyoorWorldTestPush,
  subscribeDyoorWorldPush,
  unsubscribeDyoorWorldPush,
  updateDyoorWorldPushPreferences,
} from "@/lib/dyoor-world-push-server";

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
    assertDyoorWorldRateLimit(
      `world-push-read:${wallet}:${dyoorWorldClientIp(request)}`,
      45,
      60_000,
    );
    const endpoint = new URL(request.url).searchParams.get("endpoint");
    return json(200, {
      ok: true,
      ...await dyoorWorldPushStatus(wallet, endpoint),
    });
  } catch (error) {
    return json(dyoorWorldErrorStatus(error), {
      ok: false,
      error: (error as Error)?.message || "Could not load notification settings.",
    });
  }
}

export async function POST(request: Request) {
  try {
    const { wallet } = await requireDyoorWorldRequest(request);
    assertDyoorWorldRateLimit(
      `world-push-write:${wallet}:${dyoorWorldClientIp(request)}`,
      20,
      60_000,
    );
    const body = await request.json().catch(() => ({}));
    if (body?.action === "subscribe") {
      return json(200, {
        ok: true,
        ...await subscribeDyoorWorldPush({
          wallet,
          subscription: body?.subscription,
          preferences: body?.preferences,
          userAgent: request.headers.get("user-agent"),
        }),
      });
    }
    if (body?.action === "preferences") {
      return json(200, {
        ok: true,
        ...await updateDyoorWorldPushPreferences({
          wallet,
          endpoint: body?.endpoint,
          preferences: body?.preferences,
        }),
      });
    }
    if (body?.action === "test") {
      return json(200, {
        ok: true,
        ...await sendDyoorWorldTestPush(wallet, body?.endpoint),
      });
    }
    return json(400, {
      ok: false,
      error: "Choose a supported dYOOR World notification action.",
    });
  } catch (error) {
    return json(dyoorWorldErrorStatus(error), {
      ok: false,
      error: (error as Error)?.message || "Could not update notification settings.",
    });
  }
}

export async function DELETE(request: Request) {
  try {
    const { wallet } = await requireDyoorWorldRequest(request);
    assertDyoorWorldRateLimit(
      `world-push-delete:${wallet}:${dyoorWorldClientIp(request)}`,
      10,
      60_000,
    );
    const body = await request.json().catch(() => ({}));
    return json(200, {
      ok: true,
      ...await unsubscribeDyoorWorldPush(wallet, body?.endpoint),
    });
  } catch (error) {
    return json(dyoorWorldErrorStatus(error), {
      ok: false,
      error: (error as Error)?.message || "Could not disable notifications.",
    });
  }
}
