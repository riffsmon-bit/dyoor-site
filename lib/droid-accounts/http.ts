import "server-only";
import { NextResponse } from "next/server";
import {
  checkedDroidProtocolConfig,
  getDroidSnapshot,
  getDroidSquad,
  normalizeDroidWallet,
  parseDroidTokenId,
} from "@/lib/droid-accounts/server";
import { isSupportedDroidChainId } from "@/lib/droid-accounts/network";
import type { DroidAccountApiResponse } from "@/lib/droid-accounts/types";

function response(body: DroidAccountApiResponse, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

/** Shared chain-qualified HTTP reader. All ownership is re-read from the native collection. */
export async function handleDroidAccountsRequest(
  request: Request,
  forcedChainId?: number,
) {
  const params = new URL(request.url).searchParams;
  const requestedChainId = forcedChainId ?? Number(params.get("chainId"));
  if (!isSupportedDroidChainId(requestedChainId)) {
    return NextResponse.json({ ok: false, error: "Unsupported native Droid chain." }, {
      status: 400,
      headers: { "cache-control": "no-store" },
    });
  }

  const config = await checkedDroidProtocolConfig(requestedChainId);
  const rawTokenId = params.get("tokenId");
  const rawOwner = params.get("owner");

  try {
    if (rawTokenId !== null) {
      const tokenId = parseDroidTokenId(rawTokenId, config.maxSupply);
      if (!tokenId) {
        return response({ ok: false, config, error: `Invalid ${config.collectionName} token ID.` }, 400);
      }
      const requestedWallet = rawOwner ? normalizeDroidWallet(rawOwner) : "";
      if (rawOwner && !requestedWallet) {
        return response({ ok: false, config, error: "Invalid wallet address." }, 400);
      }
      const droid = await getDroidSnapshot(config, tokenId, requestedWallet);
      return response({ ok: true, config, droid });
    }

    if (rawOwner !== null) {
      const owner = normalizeDroidWallet(rawOwner);
      if (!owner) {
        return response({ ok: false, config, error: "Invalid wallet address." }, 400);
      }
      const squad = await getDroidSquad(config, owner);
      return response({ ok: true, config, squad });
    }

    return response({ ok: true, config });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Droid Account read failed.";
    const missing = /does not exist|TokenDoesNotExist|missing revert data/i.test(message);
    return response({
      ok: false,
      config,
      error: missing
        ? `That ${config.collectionName} has not been minted or has been burned.`
        : "Droid Account data is temporarily unavailable.",
    }, missing ? 404 : 503);
  }
}
