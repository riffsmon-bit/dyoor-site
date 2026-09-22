import { getBurnedDroidGallery } from "@/src/lib/storage/s2TraitLabStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const gallery = await getBurnedDroidGallery();
  const wallet = new URL(request.url).searchParams.get("wallet")?.trim().toLowerCase() || "";
  const walletBurnCount = wallet
    ? gallery.items.filter((item) => item.wallet.toLowerCase() === wallet).length
    : undefined;
  return Response.json({
    ok: true,
    updatedAt: gallery.updatedAt,
    items: gallery.items.slice(0, 100),
    totalBurns: gallery.items.length,
    ...(wallet ? { walletBurnCount } : {}),
  }, {
    headers: { "cache-control": "no-store" },
  });
}
