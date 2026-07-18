import { readRenderedTraitImage } from "@/lib/s2-trait-lab-render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RenderContext = {
  params: Promise<{ imageId: string }>;
};

export async function GET(_request: Request, context: RenderContext) {
  const params = await context.params;
  const imageId = String(params.imageId || "").trim();
  const png = imageId ? await readRenderedTraitImage(imageId) : null;

  if (!png) {
    return new Response("Not found", {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }

  return new Response(new Uint8Array(png), {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
