import { ARTWORK_TOKEN_IDS, readLiveArtwork } from "@/lib/droid-os/live-artwork.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ tokenId: string }> }) {
  if (process.env.DROID_OS_UI_PREVIEW !== "true") return new Response("Not found", { status: 404 });
  const { tokenId } = await context.params;
  const headers = { "Cache-Control": "no-store", "Netlify-CDN-Cache-Control": "no-store" };
  if (!ARTWORK_TOKEN_IDS.includes(tokenId)) return Response.json({ error: "Unsupported preview token" }, { status: 404, headers });
  try {
    return Response.json(await readLiveArtwork(tokenId), { headers });
  } catch {
    return Response.json({ error: "Live artwork unavailable. Retry without changing your saved traits." }, { status: 502, headers });
  }
}
