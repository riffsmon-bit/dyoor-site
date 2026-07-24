import {
  assertDyoorWorldRateLimit,
  dyoorWorldClientIp,
  dyoorWorldErrorStatus,
  getDyoorWorldNameToken,
} from "@/lib/dyoor-world-server";
import { dyoorWorldNameSvg } from "@/lib/dyoor-world-name-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ tokenId: string }> },
) {
  try {
    const { tokenId } = await context.params;
    assertDyoorWorldRateLimit(
      `name-image:${dyoorWorldClientIp(request)}`,
      60,
      60_000,
    );
    const record = await getDyoorWorldNameToken(tokenId);
    return new Response(dyoorWorldNameSvg({
      displayName: record.profile.displayName,
      wallet: record.wallet,
    }), {
      status: 200,
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
        "access-control-allow-origin": "*",
        "cross-origin-resource-policy": "cross-origin",
        "x-content-type-options": "nosniff",
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
