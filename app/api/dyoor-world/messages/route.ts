import {
  assertDyoorWorldRateLimit,
  createDyoorWorldMessage,
  dyoorWorldClientIp,
  dyoorWorldErrorStatus,
  listDyoorWorldMessages,
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
      `world-message-read:${wallet}:${dyoorWorldClientIp(request)}`,
      45,
      60_000,
    );
    const channelId = new URL(request.url).searchParams.get("channel");
    return json(200, {
      ok: true,
      messages: await listDyoorWorldMessages(wallet, channelId),
    });
  } catch (error) {
    return json(dyoorWorldErrorStatus(error), {
      ok: false,
      error: (error as Error)?.message || "Could not load dYOOR World messages.",
    });
  }
}

export async function POST(request: Request) {
  try {
    const { wallet } = await requireDyoorWorldRequest(request);
    const body = await request.json().catch(() => ({}));
    return json(201, {
      ok: true,
      message: await createDyoorWorldMessage({
        wallet,
        channelId: body?.channelId,
        content: body?.content,
        attachment: body?.attachment,
        replyToMessageId: body?.replyToMessageId,
      }),
    });
  } catch (error) {
    return json(dyoorWorldErrorStatus(error), {
      ok: false,
      error: (error as Error)?.message || "Could not send the dYOOR World message.",
    });
  }
}
