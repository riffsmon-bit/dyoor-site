import {
  assertDyoorWorldRateLimit,
  dyoorWorldClientIp,
  dyoorWorldErrorStatus,
  requireDyoorWorldRequest,
} from "@/lib/dyoor-world-server";
import { saveDyoorWorldImage } from "@/lib/dyoor-world-media-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanAlt(value: unknown) {
  return String(value || "")
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, 120);
}

export async function POST(request: Request) {
  try {
    const { wallet } = await requireDyoorWorldRequest(request);
    assertDyoorWorldRateLimit(
      `world-media-upload:${wallet}:${dyoorWorldClientIp(request)}`,
      6,
      60_000,
    );
    const form = await request.formData();
    const file = form.get("image");
    if (!(file instanceof File) || !file.size) {
      throw Object.assign(new Error("Choose an image to upload."), { status: 400 });
    }
    if (file.size > 5 * 1024 * 1024) {
      throw Object.assign(new Error("Choose an image no larger than 5 MB."), { status: 400 });
    }
    const saved = await saveDyoorWorldImage(
      wallet,
      Buffer.from(await file.arrayBuffer()),
    );
    return Response.json({
      ok: true,
      attachment: {
        kind: "image",
        url: saved.url,
        alt: cleanAlt(file.name) || "Uploaded chat image",
      },
    }, {
      status: 201,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: (error as Error)?.message || "Could not upload this World image.",
    }, {
      status: dyoorWorldErrorStatus(error),
      headers: { "cache-control": "no-store" },
    });
  }
}
