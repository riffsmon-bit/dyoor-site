import { getAddress } from "viem";
import { dyoorS2Contract } from "@/lib/contracts/addresses";
import {
  processDueOpenSeaMetadataRefreshes,
  refreshOpenSeaTokenMetadataNowAndLater,
} from "@/lib/opensea-metadata-refresh";
import { verifyTraitBountyProcessorSecret } from "@/lib/s2-trait-bounties";
import { assertTraitLabRateLimit } from "@/lib/s2-trait-lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_WORLD_NAMES_CONTRACT = "0xDE073c0ea9052a51c7fC67BE6fc311a1C0c00357";
const MAX_UINT256 = (1n << 256n) - 1n;

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function clientIp(request: Request) {
  return String(request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown").split(",")[0].trim();
}

async function processRefreshQueue(request: Request) {
  assertTraitLabRateLimit(`opensea-refresh:${clientIp(request)}`, 20, 60_000);
  return json(200, await processDueOpenSeaMetadataRefreshes({ limit: 10 }) as unknown as Record<string, unknown>);
}

function routeError(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

function targetedRefreshRequest(body: unknown) {
  if (!body || typeof body !== "object") return false;
  return (body as { action?: unknown }).action === "refresh-token";
}

function allowedRefreshTarget(body: unknown) {
  const value = body as {
    contractAddress?: unknown;
    tokenId?: unknown;
  };
  const tokenId = String(value.tokenId ?? "").trim();
  if (!/^\d+$/.test(tokenId) || BigInt(tokenId) > MAX_UINT256) {
    throw routeError("A valid uint256 token ID is required.", 400);
  }

  let contractAddress: `0x${string}`;
  try {
    contractAddress = getAddress(String(value.contractAddress || ""));
  } catch {
    throw routeError("A valid contract address is required.", 400);
  }

  const worldNamesContract = getAddress(
    process.env.DYOOR_WORLD_NAMES_CONTRACT
      || process.env.NEXT_PUBLIC_DYOOR_WORLD_NAMES_CONTRACT
      || DEFAULT_WORLD_NAMES_CONTRACT,
  );
  const allowedContracts = new Set([
    getAddress(dyoorS2Contract),
    worldNamesContract,
  ]);
  if (!allowedContracts.has(contractAddress)) {
    throw routeError("That contract is not eligible for metadata refreshes.", 403);
  }

  return { contractAddress, tokenId };
}

async function refreshAllowedToken(request: Request, body: unknown) {
  assertTraitLabRateLimit(`opensea-targeted-refresh:${clientIp(request)}`, 6, 60_000);
  const supplied = request.headers.get("x-dyoor-bounty-secret")
    || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    || "";
  if (!verifyTraitBountyProcessorSecret(supplied)) {
    return json(401, { ok: false, error: "Unauthorized metadata refresh." });
  }

  const target = allowedRefreshTarget(body);
  const result = await refreshOpenSeaTokenMetadataNowAndLater({
    ...target,
    reason: "owner_metadata_refresh",
  });
  return json(200, {
    ok: result.immediate?.status === "queued",
    result,
  });
}

export async function GET(request: Request) {
  try {
    return await processRefreshQueue(request);
  } catch (error: any) {
    return json(Number(error?.status || 500), { ok: false, error: error?.message || "OpenSea refresh processing failed." });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (targetedRefreshRequest(body)) {
      return await refreshAllowedToken(request, body);
    }
    return await processRefreshQueue(request);
  } catch (error: any) {
    return json(Number(error?.status || 500), { ok: false, error: error?.message || "OpenSea refresh processing failed." });
  }
}
