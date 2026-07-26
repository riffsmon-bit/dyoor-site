import {
  dyoorWorldErrorStatus,
  processDyoorWorldBurns,
  requireDyoorWorldAutomationRequest,
} from "@/lib/dyoor-world-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    requireDyoorWorldAutomationRequest(request);
    return Response.json({
      ok: true,
      ...await processDyoorWorldBurns(),
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({
      ok: false,
      error: (error as Error)?.message || "World burn processing failed.",
    }, {
      status: dyoorWorldErrorStatus(error),
      headers: { "cache-control": "no-store" },
    });
  }
}
