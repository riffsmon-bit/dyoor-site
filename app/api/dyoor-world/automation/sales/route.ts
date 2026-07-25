import {
  dyoorWorldErrorStatus,
  processDyoorWorldSales,
  requireDyoorWorldAutomationRequest,
} from "@/lib/dyoor-world-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    requireDyoorWorldAutomationRequest(request);
    return Response.json({
      ok: true,
      ...await processDyoorWorldSales(),
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({
      ok: false,
      error: (error as Error)?.message || "World sales processing failed.",
    }, {
      status: dyoorWorldErrorStatus(error),
      headers: { "cache-control": "no-store" },
    });
  }
}
