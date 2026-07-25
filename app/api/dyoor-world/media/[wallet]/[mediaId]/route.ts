import {
  dyoorWorldErrorStatus,
  requireDyoorWorldRequest,
} from "@/lib/dyoor-world-server";
import { readDyoorWorldImage } from "@/lib/dyoor-world-media-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{
    wallet: string;
    mediaId: string;
  }>;
};

export async function GET(request: Request, context: Context) {
  try {
    await requireDyoorWorldRequest(request);
    const { wallet, mediaId } = await context.params;
    const image = await readDyoorWorldImage(wallet, mediaId);
    if (!image) {
      return new Response("Not found", {
        status: 404,
        headers: { "cache-control": "private, no-store" },
      });
    }
    return new Response(new Uint8Array(image), {
      headers: {
        "content-type": "image/webp",
        "cache-control": "private, max-age=3600",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: (error as Error)?.message || "Could not load this World image.",
    }, {
      status: dyoorWorldErrorStatus(error),
      headers: { "cache-control": "private, no-store" },
    });
  }
}
