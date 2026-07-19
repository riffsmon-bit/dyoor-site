#!/usr/bin/env node
import "dotenv/config";

const DEFAULT_CHAIN = "monad";
const DEFAULT_CONTRACT = "0x349d8eb480c92cf75371fba5c6344a4d11b9103a";

function readEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function usage() {
  console.log("Usage:");
  console.log("  OPENSEA_API_KEY=... node scripts/refresh-opensea-metadata.js 957 1008");
  console.log("");
  console.log("Optional env:");
  console.log("  OPENSEA_CHAIN=monad");
  console.log("  DYOOR_S2_CONTRACT_ADDRESS=0x...");
}

function tokenIdsFromArgs(argv) {
  const ids = argv
    .flatMap((arg) => String(arg || "").split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  const invalid = ids.filter((value) => !/^[0-9]+$/.test(value));
  if (invalid.length) throw new Error(`Invalid token ID(s): ${invalid.join(", ")}`);
  return ids;
}

async function refreshToken({ chain, contractAddress, tokenId, apiKey }) {
  const endpoint = `https://api.opensea.io/api/v2/chain/${encodeURIComponent(chain)}/contract/${encodeURIComponent(contractAddress)}/nfts/${encodeURIComponent(tokenId)}/refresh?ignoreCachedItemUrls=true`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      "x-api-key": apiKey,
    },
  });
  const text = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`Token ${tokenId} refresh failed with HTTP ${response.status}: ${text.slice(0, 240)}`);
  }
  return {
    tokenId,
    status: response.status,
    response: text ? text.slice(0, 500) : "",
  };
}

async function main() {
  const tokenIds = tokenIdsFromArgs(process.argv.slice(2));
  if (!tokenIds.length) {
    usage();
    process.exit(1);
  }

  const apiKey = readEnv("OPENSEA_API_KEY");
  if (!apiKey) throw new Error("OPENSEA_API_KEY is required.");

  const chain = readEnv("OPENSEA_CHAIN", "OPENSEA_METADATA_CHAIN", "DYOOR_OPENSEA_CHAIN") || DEFAULT_CHAIN;
  const contractAddress = readEnv("DYOOR_S2_CONTRACT_ADDRESS", "NEXT_PUBLIC_DYOOR_S2_CONTRACT_ADDRESS") || DEFAULT_CONTRACT;

  console.log("OpenSea metadata refresh");
  console.log("Chain:", chain);
  console.log("Contract:", contractAddress);
  console.log("Token IDs:", tokenIds.join(", "));

  for (const tokenId of tokenIds) {
    const result = await refreshToken({ chain, contractAddress, tokenId, apiKey });
    console.log(`Queued token ${result.tokenId}: HTTP ${result.status}`);
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
