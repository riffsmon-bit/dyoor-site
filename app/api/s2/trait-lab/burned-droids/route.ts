import { getBurnedDroidGallery } from "@/src/lib/storage/s2TraitLabStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const gallery = await getBurnedDroidGallery();
  return Response.json({
    ok: true,
    updatedAt: gallery.updatedAt,
    items: gallery.items.slice(0, 100),
  }, {
    headers: { "cache-control": "no-store" },
  });
}
