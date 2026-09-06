import "server-only";
import { NextResponse } from "next/server";
import { isSupportedDroidChainId } from "@/lib/droid-accounts/network";
import { getEcosystemRevenueSnapshot } from "@/lib/droid-economy/revenue-server";
import type { EcosystemRevenueApiResponse } from "@/lib/droid-economy/types";

function response(body: EcosystemRevenueApiResponse, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function handleEcosystemRevenueRequest(
  request: Request,
  forcedChainId?: number,
) {
  const params = new URL(request.url).searchParams;
  const chainId = forcedChainId ?? Number(params.get("chainId"));
  if (!isSupportedDroidChainId(chainId)) {
    return response({ ok: false, error: "Unsupported ecosystem revenue chain." }, 400);
  }
  try {
    return response({
      ok: true,
      snapshot: await getEcosystemRevenueSnapshot(chainId),
    });
  } catch (error) {
    return response({
      ok: false,
      error: error instanceof Error ? error.message : "Ecosystem revenue data is unavailable.",
    }, 503);
  }
}
