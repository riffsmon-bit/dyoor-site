import {
  assertDyoorWorldRateLimit,
  dyoorWorldClientIp,
  dyoorWorldErrorStatus,
  dyoorWorldPublicConfig,
  getDyoorWorldProfile,
  requireDyoorWorldRequest,
  reserveDyoorWorldName,
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
      wallet,
      profile: await getDyoorWorldProfile(wallet),
      config: dyoorWorldPublicConfig(),
    });
  } catch (error) {
    return json(dyoorWorldErrorStatus(error), {
      ok: false,
      error: (error as Error)?.message || "Could not load the dYOOR World identity.",
    });
  }
}

export async function POST(request: Request) {
  try {
    const { wallet } = await requireDyoorWorldRequest(request);
    assertDyoorWorldRateLimit(
      `profile:${wallet}:${dyoorWorldClientIp(request)}`,
      10,
      60_000,
    );
    const body = await request.json().catch(() => ({}));
    return json(201, {
      ok: true,
      wallet,
      profile: await reserveDyoorWorldName(wallet, body?.label),
      config: dyoorWorldPublicConfig(),
    });
  } catch (error) {
    return json(dyoorWorldErrorStatus(error), {
      ok: false,
      error: (error as Error)?.message || "Could not reserve the dYOOR World identity.",
    });
  }
}
