import fs from "node:fs/promises";
import path from "node:path";
import { getStore } from "@netlify/blobs";
import { ethers } from "ethers";
import {
  attributesToTraitMap,
  compareBlueprintToMintedNFT,
  getBlueprintRewardTier,
  normalizeWalletAddress,
} from "@/lib/ascension/blueprint";
import { dyoorS2Contract } from "@/lib/contracts/addresses";
import {
  buildTokenMetadataAsync,
  getRuntimeMetadataConfig,
  parseTokenId,
} from "@/lib/dyoor-s2-metadata.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STORE_NAME = "ascension-blueprints";
const BLUEPRINTS_KEY = "ascension-blueprints.json";
const LOCAL_BLUEPRINTS_PATH = path.join(process.cwd(), "data", "ascension-blueprints.json");
const ERC721_OWNER_ABI = [
  "function ownerOf(uint256 tokenId) view returns (address)",
];
const DEFAULT_MONAD_MAINNET_RPC_URL = "https://rpc.monad.xyz";

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function readEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function isTestnetLikeUrl(value: string) {
  return /testnet/i.test(value);
}

function mainnetRpcUrl() {
  for (const name of ["DYOOR_S2_RPC_URL", "MONAD_RPC_URL", "NEXT_PUBLIC_MONAD_RPC_URL", "NEXT_PUBLIC_DYOOR_S2_RPC_URL", "RPC_URL"]) {
    const value = readEnv(name);
    if (value && !isTestnetLikeUrl(value)) return value;
  }
  return DEFAULT_MONAD_MAINNET_RPC_URL;
}

function getBlobStore() {
  const siteID = readEnv("NETLIFY_BLOBS_SITE_ID", "NETLIFY_SITE_ID", "SITE_ID");
  const token = readEnv("NETLIFY_BLOBS_TOKEN", "NETLIFY_ACCESS_TOKEN", "NETLIFY_AUTH_TOKEN");
  if (siteID && token) {
    return getStore({ name: STORE_NAME, siteID, token, consistency: "strong" });
  }
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

async function readBlueprints() {
  try {
    const value = await getBlobStore().get(BLUEPRINTS_KEY, { type: "json", consistency: "strong" });
    return Array.isArray(value) ? value : [];
  } catch {
    const local = await fs.readFile(LOCAL_BLUEPRINTS_PATH, "utf8").catch(() => "[]");
    const value = JSON.parse(local);
    return Array.isArray(value) ? value : [];
  }
}

function provider() {
  const rpcUrl = mainnetRpcUrl();
  if (!rpcUrl) throw Object.assign(new Error("DYOOR_S2_RPC_URL or MONAD_RPC_URL is required for Blueprint checking."), { status: 500 });
  return new ethers.JsonRpcProvider(rpcUrl);
}

async function ownerOfToken(tokenId: number) {
  if (!dyoorS2Contract) {
    throw Object.assign(new Error("DYOOR_S2_CONTRACT_ADDRESS or NEXT_PUBLIC_DYOOR_S2_CONTRACT_ADDRESS is required for Blueprint checking."), { status: 500 });
  }
  const contract = new ethers.Contract(dyoorS2Contract, ERC721_OWNER_ABI, provider());
  try {
    return ethers.getAddress(await contract.ownerOf(BigInt(tokenId))).toLowerCase();
  } catch {
    throw Object.assign(new Error("Token is not minted on the configured D.Y.O.O.R Season 2 contract."), { status: 404 });
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const wallet = normalizeWalletAddress(url.searchParams.get("wallet"));
    if (!wallet) return json(400, { ok: false, error: "Missing or invalid wallet." });

    const config = await getRuntimeMetadataConfig();
    const parsed = parseTokenId(url.searchParams.get("tokenId"), config.maxSupply);
    if (!parsed.ok || typeof parsed.tokenId !== "number") {
      return json(Number(parsed.status || 400), { ok: false, error: parsed.error || "Invalid token ID." });
    }

    const blueprints = await readBlueprints();
    const blueprint = blueprints.find((entry: { wallet?: string }) => normalizeWalletAddress(entry.wallet) === wallet) || null;
    if (!blueprint) return json(404, { ok: false, error: "No saved Ascension Blueprint for this wallet." });

    const [owner, metadataResult] = await Promise.all([
      ownerOfToken(parsed.tokenId),
      buildTokenMetadataAsync(parsed.tokenId, config),
    ]);
    const mintedNFTMetadata = metadataResult.metadata;
    const mintedTraits = attributesToTraitMap(mintedNFTMetadata);
    const comparison = compareBlueprintToMintedNFT(blueprint.traits, mintedTraits);
    const rewardTier = comparison.exactMatch ? getBlueprintRewardTier(mintedNFTMetadata) : "";

    return json(200, {
      ok: true,
      wallet,
      blueprint,
      tokenId: String(parsed.tokenId),
      contractAddress: dyoorS2Contract,
      onChainOwner: owner,
      ownershipConfirmed: owner === wallet,
      mintedNFTMetadata,
      mintedTraits,
      rewardTier,
      metadataSource: {
        baseFound: metadataResult.baseFound,
        baseSource: metadataResult.baseSource,
        remoteBaseFound: metadataResult.remoteBaseFound,
        overrideFound: metadataResult.overrideFound,
        usedFallback: metadataResult.usedFallback,
      },
      ...comparison,
    });
  } catch (error: any) {
    return json(Number(error?.status || 500), {
      ok: false,
      error: error?.message || "Blueprint checker failed.",
    });
  }
}
