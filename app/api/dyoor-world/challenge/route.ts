import {
  createDyoorWorldChallenge,
  dyoorWorldErrorStatus,
} from "@/lib/dyoor-world-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const challenge = await createDyoorWorldChallenge(request, body?.wallet);
    return json(200, { ok: true, challenge });
  } catch (error) {
    return json(dyoorWorldErrorStatus(error), {
      ok: false,
      error: (error as Error)?.message || "Could not create a holder challenge.",
    });
  }
}
