export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return Response.json({
    ok: false,
    error: "Legacy direct rerolls are disabled. Use /api/s2/trait-lab/preview and /api/s2/trait-lab/confirm so the server can generate the trait result.",
  }, {
    status: 410,
    headers: { "cache-control": "no-store" },
  });
}
