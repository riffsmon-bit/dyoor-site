import { getRuntimeMetadataConfig } from "@/lib/dyoor-s2-metadata.js";
import { dyoorS2Contract } from "@/lib/contracts/addresses";
import { assertTraitLabRateLimit, normalizeWallet, ownedS2TokenIds } from "@/lib/s2-trait-lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function clientIp(request: Request) {
  return String(request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown").split(",")[0].trim();
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const wallet = normalizeWallet(url.searchParams.get("wallet"));
    if (!wallet) return json(400, { ok: false, error: "wallet must be a valid address." });

    assertTraitLabRateLimit(`owned:${wallet}:${clientIp(request)}`, 30, 60_000);
    const config = await getRuntimeMetadataConfig();
    const tokenIds = Array.from(new Set(await ownedS2TokenIds(wallet, config.maxSupply)))
      .sort((a, b) => Number(a) - Number(b));

    return json(200, {
      ok: true,
      wallet,
      contractAddress: dyoorS2Contract,
      tokenIds,
      count: tokenIds.length,
      contractBaseUri: "https://dyoor.netlify.app/api/metadata/",
    });
  } catch (error: any) {
    return json(Number(error?.status || 500), { ok: false, error: error?.message || "Could not load owned Season 2 tokens." });
  }
}
