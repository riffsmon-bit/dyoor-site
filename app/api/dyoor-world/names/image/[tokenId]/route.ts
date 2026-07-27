import {
  assertDyoorWorldRateLimit,
  dyoorWorldClientIp,
  dyoorWorldErrorStatus,
  getDyoorWorldNameToken,
} from "@/lib/dyoor-world-server";
import { dyoorWorldNamePng } from "@/lib/dyoor-world-name-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ tokenId: string }> },
) {
  try {
    const { tokenId: requestedTokenId } = await context.params;
    const tokenId = requestedTokenId.replace(/(?:\.v\d+)?\.png$/i, "");
    assertDyoorWorldRateLimit(
      `name-image:${tokenId}:${dyoorWorldClientIp(request)}`,
      60,
      60_000,
    );
    const record = await getDyoorWorldNameToken(tokenId);
    const png = await dyoorWorldNamePng({
      displayName: record.profile.displayName,
      wallet: record.wallet,
    });
    return new Response(new Uint8Array(png), {
      status: 200,
      headers: {
        "content-type": "image/png",
        "content-disposition": `inline; filename="${record.tokenId}.png"`,
        "cache-control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
        "access-control-allow-origin": "*",
        "cross-origin-resource-policy": "cross-origin",
        "x-content-type-options": "nosniff",
        "x-dyoor-media-version": "3",
      },
    });
  } catch (error) {
    return Response.json({
      error: (error as Error)?.message || "Could not render the dYOOR World name.",
    }, {
      status: dyoorWorldErrorStatus(error),
      headers: { "cache-control": "no-store" },
    });
  }
}
