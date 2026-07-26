import {
  buildTraitLabLeaderboard,
  traitLabBountiesEnabled,
  traitLabLeaderboardEnabled,
} from "@/lib/s2-trait-lab-leaderboard";
import { listTraitLabCompletions } from "@/src/lib/storage/s2TraitLabStore";

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
    if (!traitLabLeaderboardEnabled()) {
      return json(404, {
        ok: false,
        enabled: false,
        error: "Trait Lab leaderboard is disabled.",
      });
    }
    const requestedLimit = Number(new URL(request.url).searchParams.get("limit") || 50);
    const completions = await listTraitLabCompletions();
    return json(200, {
      ok: true,
      enabled: true,
      bountyEnabled: traitLabBountiesEnabled(),
      generatedAt: new Date().toISOString(),
      completedOperationCount: completions.length,
      rows: buildTraitLabLeaderboard(completions, requestedLimit),
    });
  } catch (error) {
    return json(500, {
      ok: false,
      error: error instanceof Error ? error.message : "Trait Lab leaderboard unavailable.",
    });
  }
}
