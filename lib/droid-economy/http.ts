import "server-only";
import { NextResponse } from "next/server";
import { isSupportedDroidChainId } from "@/lib/droid-accounts/network";
import { checkedDroidProtocolConfig, parseDroidTokenId } from "@/lib/droid-accounts/server";
import { getDroidEconomySnapshot } from "@/lib/droid-economy/server";
import type { DroidEconomyApiResponse } from "@/lib/droid-economy/types";

function response(body: DroidEconomyApiResponse, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function handleDroidEconomyRequest(
  request: Request,
  forcedChainId?: number,
) {
  const params = new URL(request.url).searchParams;
  const chainId = forcedChainId ?? Number(params.get("chainId"));
  if (!isSupportedDroidChainId(chainId)) {
    return response({ ok: false, error: "Unsupported native Droid chain." }, 400);
  }
  try {
    const droidConfig = await checkedDroidProtocolConfig(chainId);
    const tokenId = parseDroidTokenId(params.get("tokenId"), droidConfig.maxSupply);
    if (!tokenId) {
      return response({ ok: false, error: `Invalid ${droidConfig.collectionName} token ID.` }, 400);
    }
    return response({
      ok: true,
      snapshot: await getDroidEconomySnapshot(tokenId, chainId),
    });
  } catch (error) {
    return response({
      ok: false,
      error: error instanceof Error ? error.message : "Droid economy data is unavailable.",
    }, 503);
  }
}
