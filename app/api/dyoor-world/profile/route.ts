import {
  assertDyoorWorldRateLimit,
  dyoorWorldConfigForWallet,
  dyoorWorldClientIp,
  dyoorWorldErrorStatus,
  clearDyoorWorldAvatar,
  getDyoorWorldAvatar,
  getDyoorWorldProfile,
  requireDyoorWorldEntitlement,
  requireDyoorWorldRequest,
  reserveDyoorWorldName,
  setDyoorWorldAvatar,
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
    const [profile, avatar, config] = await Promise.all([
      getDyoorWorldProfile(wallet),
      getDyoorWorldAvatar(wallet),
      dyoorWorldConfigForWallet(wallet),
    ]);
    return json(200, {
      ok: true,
      wallet,
      profile,
      avatar,
      config,
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
    await requireDyoorWorldEntitlement(wallet, "season2");
    assertDyoorWorldRateLimit(
      `profile:${wallet}:${dyoorWorldClientIp(request)}`,
      10,
      60_000,
    );
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || (body?.label ? "reserve-name" : ""));
    if (action === "set-pfp") {
      const avatar = await setDyoorWorldAvatar(wallet, body?.tokenId);
      return json(200, {
        ok: true,
        wallet,
        profile: await getDyoorWorldProfile(wallet),
        avatar,
        config: await dyoorWorldConfigForWallet(wallet),
      });
    }
    if (action === "clear-pfp") {
      await clearDyoorWorldAvatar(wallet);
      return json(200, {
        ok: true,
        wallet,
        profile: await getDyoorWorldProfile(wallet),
        avatar: null,
        config: await dyoorWorldConfigForWallet(wallet),
      });
    }
    if (action !== "reserve-name") {
      throw Object.assign(new Error("Choose a supported World profile action."), { status: 400 });
    }
    const profile = await reserveDyoorWorldName(wallet, body?.label);
    return json(201, {
      ok: true,
      wallet,
      profile,
      avatar: await getDyoorWorldAvatar(wallet),
      config: await dyoorWorldConfigForWallet(wallet),
    });
  } catch (error) {
    return json(dyoorWorldErrorStatus(error), {
      ok: false,
      error: (error as Error)?.message || "Could not reserve the dYOOR World identity.",
    });
  }
}
