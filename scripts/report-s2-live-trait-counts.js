import dotenv from "dotenv";
import { ethers } from "ethers";
import fs from "node:fs/promises";

dotenv.config({ path: ".env.local" });
dotenv.config();

const CONTRACT_ADDRESS = "0x349D8eb480c92cF75371fbA5C6344A4d11b9103A";
const METADATA_BASE = "https://dyoor.netlify.app/api/metadata/";
const CONCURRENCY = 12;

const rpc = process.env.MONAD_MAINNET_RPC_URL
  || process.env.MONAD_RPC_URL
  || process.env.NEXT_PUBLIC_MONAD_RPC_URL
  || "https://rpc.monad.xyz";

const provider = new ethers.JsonRpcProvider(rpc, 143);
const contract = new ethers.Contract(CONTRACT_ADDRESS, [
  "function totalSupply() view returns (uint256)",
  "function totalMinted() view returns (uint256)",
], provider);

let totalSupply;
try {
  totalSupply = Number(await contract.totalSupply());
} catch {
  totalSupply = Number(await contract.totalMinted());
}

if (!Number.isSafeInteger(totalSupply) || totalSupply <= 0) {
  throw new Error("Could not read minted supply.");
}

console.log("Minted supply", totalSupply);

const counts = new Map();
const traitTotals = new Map();
const versionCounts = new Map();
const tokenFailures = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchToken(tokenId, attempt = 0) {
  try {
    const response = await fetch(`${METADATA_BASE}${tokenId}`, { cache: "no-store" });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 120)}`);
    return JSON.parse(text);
  } catch (error) {
    if (attempt < 3) {
      await sleep(250 * (attempt + 1));
      return fetchToken(tokenId, attempt + 1);
    }
    throw error;
  }
}

let nextTokenId = 1;

async function worker() {
  while (nextTokenId <= totalSupply) {
    const tokenId = nextTokenId;
    nextTokenId += 1;

    try {
      const metadata = await fetchToken(tokenId);
      const attributes = Array.isArray(metadata.attributes) ? metadata.attributes : [];

      for (const attribute of attributes) {
        const traitType = String(attribute?.trait_type || "").trim();
        if (!traitType || traitType === "Metadata Version") continue;

        const value = String(attribute?.value ?? "").trim() || "None";
        const key = `${traitType}\u0000${value}`;
        counts.set(key, (counts.get(key) || 0) + 1);
        traitTotals.set(traitType, (traitTotals.get(traitType) || 0) + 1);
      }

      const version = attributes.find((attribute) => String(attribute?.trait_type || "").trim() === "Metadata Version")?.value;
      if (version !== undefined && version !== null && String(version).trim()) {
        const key = String(version).trim();
        versionCounts.set(key, (versionCounts.get(key) || 0) + 1);
      }

      if (tokenId % 100 === 0) console.log("Fetched", tokenId);
    } catch (error) {
      tokenFailures.push({ tokenId, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

const rows = [...counts.entries()].map(([key, count]) => {
  const [traitType, value] = key.split("\u0000");
  const totalForTrait = traitTotals.get(traitType) || totalSupply;
  return {
    trait_type: traitType,
    value,
    count,
    total_tokens: totalSupply,
    trait_rows_counted: totalForTrait,
    percent_of_minted: ((count / totalSupply) * 100).toFixed(4),
    percent_within_trait: ((count / totalForTrait) * 100).toFixed(4),
  };
}).sort((left, right) => (
  left.trait_type.localeCompare(right.trait_type)
  || right.count - left.count
  || left.value.localeCompare(right.value)
));

function csvEscape(value) {
  return `"${String(value ?? "").replaceAll("\"", "\"\"")}"`;
}

const csv = [
  "trait_type,value,count,total_tokens,trait_rows_counted,percent_of_minted,percent_within_trait",
  ...rows.map((row) => [
    row.trait_type,
    row.value,
    row.count,
    row.total_tokens,
    row.trait_rows_counted,
    row.percent_of_minted,
    row.percent_within_trait,
  ].map(csvEscape).join(",")),
].join("\n");

const date = new Date().toISOString().slice(0, 10);
await fs.mkdir("data/reports", { recursive: true });
const csvPath = `data/reports/s2-live-trait-counts-${date}.csv`;
const jsonPath = `data/reports/s2-live-trait-counts-${date}.json`;

await fs.writeFile(csvPath, csv);
await fs.writeFile(jsonPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  contractAddress: CONTRACT_ADDRESS,
  metadataBase: METADATA_BASE,
  totalSupply,
  traitValueRows: rows.length,
  metadataVersionCounts: Object.fromEntries([...versionCounts.entries()].sort()),
  failures: tokenFailures,
  rows,
}, null, 2));

console.log("CSV", csvPath);
console.log("JSON", jsonPath);
console.log("Trait value rows", rows.length);
console.log("Failures", tokenFailures.length);
console.log("Metadata versions", JSON.stringify(Object.fromEntries([...versionCounts.entries()].sort())));
