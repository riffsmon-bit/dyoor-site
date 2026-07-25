import {
  assertDyoorWorldRateLimit,
  dyoorWorldClientIp,
  dyoorWorldErrorStatus,
  dyoorWorldNamesContractAddress,
  getDyoorWorldNameToken,
} from "@/lib/dyoor-world-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, {
    status,
    headers: { "cache-control": status === 200 ? "public, max-age=60" : "no-store" },
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ tokenId: string }> },
) {
  try {
    const { tokenId } = await context.params;
    assertDyoorWorldRateLimit(
      `name-metadata:${dyoorWorldClientIp(request)}`,
      30,
      60_000,
    );
    const record = await getDyoorWorldNameToken(tokenId);
    const origin = new URL(request.url).origin;
    const image = `${origin}/api/dyoor-world/names/image/${record.tokenId}`;
    return json(200, {
      name: record.profile.displayName,
      description: "A soulbound, S2 holder-gated identity for dYOOR World on Monad.",
      image,
      external_url: `${origin}/dyoor-world`,
      background_color: "070818",
      attributes: [
        { trait_type: "Name", value: record.profile.displayName },
        { trait_type: "Label", value: record.profile.label },
        { trait_type: "Network", value: "Monad Mainnet" },
        { trait_type: "Transferability", value: "Soulbound" },
        { trait_type: "Holder Gate", value: "D.Y.O.O.R S2" },
        { trait_type: "Registry", value: dyoorWorldNamesContractAddress() },
      ],
    });
  } catch (error) {
    return json(dyoorWorldErrorStatus(error), {
      error: (error as Error)?.message || "Could not load the dYOOR World name.",
    });
  }
}
