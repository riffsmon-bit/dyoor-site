import {
  authenticateDyoorWorldRequest,
  clearDyoorWorldSessionCookie,
  completeDyoorWorldChallenge,
  dyoorWorldErrorStatus,
  dyoorWorldPublicConfig,
  dyoorWorldSessionCookie,
  getDyoorWorldProfile,
} from "@/lib/dyoor-world-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(
  status: number,
  body: Record<string, unknown>,
  headers?: Record<string, string>,
) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export async function GET(request: Request) {
  try {
    const authenticated = await authenticateDyoorWorldRequest(request);
    if (!authenticated) return json(401, { ok: false, authenticated: false });
    return json(200, {
      ok: true,
      authenticated: true,
      wallet: authenticated.wallet,
      profile: await getDyoorWorldProfile(authenticated.wallet),
      config: dyoorWorldPublicConfig(),
    });
  } catch (error) {
    return json(dyoorWorldErrorStatus(error), {
      ok: false,
      authenticated: false,
      error: (error as Error)?.message || "Could not verify the holder session.",
    });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const completed = await completeDyoorWorldChallenge(request, body || {});
    return json(
      200,
      {
        ok: true,
        authenticated: true,
        wallet: completed.wallet,
        config: dyoorWorldPublicConfig(),
      },
      { "set-cookie": dyoorWorldSessionCookie(completed.token) },
    );
  } catch (error) {
    return json(dyoorWorldErrorStatus(error), {
      ok: false,
      authenticated: false,
      error: (error as Error)?.message || "Could not create the holder session.",
    });
  }
}

export async function DELETE() {
  return json(
    200,
    { ok: true, authenticated: false },
    { "set-cookie": clearDyoorWorldSessionCookie() },
  );
}
