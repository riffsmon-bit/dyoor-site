import {
  assertDyoorWorldRateLimit,
  createDyoorWorldDirectMessage,
  dyoorWorldClientIp,
  dyoorWorldErrorStatus,
  listDyoorWorldDirectConversations,
  listDyoorWorldDirectMessages,
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
    assertDyoorWorldRateLimit(
      `world-direct-read:${wallet}:${dyoorWorldClientIp(request)}`,
      90,
      60_000,
    );
    const otherWallet = new URL(request.url).searchParams.get("with");
    if (otherWallet) {
      return json(200, {
        ok: true,
        ...await listDyoorWorldDirectMessages({ wallet, otherWallet }),
      });
    }
    return json(200, {
      ok: true,
      ...await listDyoorWorldDirectConversations(wallet),
    });
  } catch (error) {
    return json(dyoorWorldErrorStatus(error), {
      ok: false,
      error: (error as Error)?.message || "Could not load direct messages.",
    });
  }
}

export async function POST(request: Request) {
  try {
    const { wallet } = await requireDyoorWorldRequest(request);
    assertDyoorWorldRateLimit(
      `world-direct-send:${wallet}:${dyoorWorldClientIp(request)}`,
      20,
      60_000,
    );
    const body = await request.json().catch(() => ({}));
    return json(201, {
      ok: true,
      message: await createDyoorWorldDirectMessage({
        wallet,
        recipient: body?.recipient,
        content: body?.content,
        attachment: body?.attachment,
      }),
    });
  } catch (error) {
    return json(dyoorWorldErrorStatus(error), {
      ok: false,
      error: (error as Error)?.message || "Could not send the direct message.",
    });
  }
}
