import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const collectionConfigPath = path.join(projectRoot, "data", "robinhood", "dyoor-collection-config.json");
const collectionConfig = JSON.parse(fs.readFileSync(collectionConfigPath, "utf8"));
const outputRoot = path.join(projectRoot, "data", "robinhood", "snapshots");
const rpcUrl = String(process.env.MONAD_RPC_URL || "https://rpc.monad.xyz").trim();
const sourceContract = ethers.getAddress(collectionConfig.gtd.monadHolders.sourceContract);
const snapshotBlock = readPositiveInteger(
  argumentValue("block"),
  collectionConfig.gtd.monadHolders.snapshotBlock,
);
const batchSize = readPositiveInteger(argumentValue("batch-size"), 10);
const batchDelayMs = readPositiveInteger(argumentValue("batch-delay-ms"), 350);

const abi = new ethers.Interface([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function owner() view returns (address)",
  "function treasury() view returns (address)",
  "function totalSupply() view returns (uint256)",
  "function totalMinted() view returns (uint256)",
  "function maxSupply() view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
]);

function argumentValue(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : "";
}

function readPositiveInteger(value, fallback) {
  const parsed = Number(value || fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received ${JSON.stringify(value)}.`);
  }
  return parsed;
}

function blockTag(value) {
  return `0x${value.toString(16)}`;
}

function rpcRequest(method, params, id) {
  return { jsonrpc: "2.0", id, method, params };
}

async function rpc(payload, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Monad RPC returned HTTP ${response.status}.`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

async function rpcBatch(payload, attempts = 6) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const responses = await rpc(payload);
    const rateLimited = Array.isArray(responses) && responses.some((response) => (
      /request limit|rate limit|too many requests/i.test(String(response?.error?.message || ""))
    ));
    if (!rateLimited) return responses;
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
  }
  throw new Error("Monad RPC rate limit persisted after all batch retries.");
}

async function contractReads(functionNames) {
  const tag = blockTag(snapshotBlock);
  const responses = await rpcBatch(functionNames.map((name, index) => rpcRequest(
    "eth_call",
    [{ to: sourceContract, data: abi.encodeFunctionData(name) }, tag],
    index + 1,
  )));
  const byId = new Map(responses.map((response) => [response.id, response]));
  return Object.fromEntries(functionNames.map((name, index) => {
    const response = byId.get(index + 1);
    if (!response?.result) throw new Error(`${name} failed: ${response?.error?.message || "missing result"}`);
    return [name, abi.decodeFunctionResult(name, response.result)[0]];
  }));
}

async function tokenOwners(totalMinted) {
  const owners = new Map();
  const burnedTokenIds = [];
  const tag = blockTag(snapshotBlock);

  for (let start = 1; start <= totalMinted; start += batchSize) {
    const end = Math.min(totalMinted, start + batchSize - 1);
    const requests = [];
    for (let tokenId = start; tokenId <= end; tokenId += 1) {
      requests.push(rpcRequest(
        "eth_call",
        [{ to: sourceContract, data: abi.encodeFunctionData("ownerOf", [tokenId]) }, tag],
        tokenId,
      ));
    }
    const responses = await rpcBatch(requests);
    const byId = new Map(responses.map((response) => [Number(response.id), response]));
    for (let tokenId = start; tokenId <= end; tokenId += 1) {
      const response = byId.get(tokenId);
      if (!response) throw new Error(`Monad RPC omitted ownerOf(${tokenId}) from its batch response.`);
      if (response.error) {
        const message = String(response.error.message || "");
        if (!/revert|nonexistent|invalid token|owner query/i.test(message)) {
          throw new Error(`ownerOf(${tokenId}) failed: ${message || "unknown RPC error"}`);
        }
        burnedTokenIds.push(tokenId);
        continue;
      }
      if (!response.result || response.result === "0x") {
        throw new Error(`ownerOf(${tokenId}) returned an empty result without a revert.`);
      }
      const owner = ethers.getAddress(abi.decodeFunctionResult("ownerOf", response.result)[0]);
      owners.set(tokenId, owner);
    }
    process.stderr.write(`Scanned token IDs ${start}-${end}\n`);
    await new Promise((resolve) => setTimeout(resolve, batchDelayMs));
  }

  return { owners, burnedTokenIds };
}

async function contractRecipients(addresses) {
  if (!addresses.length) return new Set();
  const tag = blockTag(snapshotBlock);
  const contracts = new Set();
  for (let start = 0; start < addresses.length; start += batchSize) {
    const batch = addresses.slice(start, start + batchSize);
    const responses = await rpcBatch(batch.map((address, index) => rpcRequest(
      "eth_getCode",
      [address, tag],
      index + 1,
    )));
    const byId = new Map(responses.map((response) => [Number(response.id), response]));
    batch.forEach((address, index) => {
      const response = byId.get(index + 1);
      if (!response?.result) throw new Error(`Monad RPC omitted eth_getCode for ${address}.`);
      if (response.result !== "0x" && response.result !== "0x0") contracts.add(address);
    });
    await new Promise((resolve) => setTimeout(resolve, batchDelayMs));
  }
  return contracts;
}

const blockResponse = await rpc(rpcRequest("eth_getBlockByNumber", [blockTag(snapshotBlock), false], 1));
if (!blockResponse?.result?.hash) throw new Error(`Snapshot block ${snapshotBlock} is unavailable.`);

const reads = await contractReads([
  "name",
  "symbol",
  "owner",
  "treasury",
  "totalSupply",
  "totalMinted",
  "maxSupply",
]);
const totalSupply = Number(reads.totalSupply);
const totalMinted = Number(reads.totalMinted);
const { owners, burnedTokenIds } = await tokenOwners(totalMinted);
if (owners.size !== totalSupply) {
  throw new Error(`Ownership scan found ${owners.size} live tokens; contract reports ${totalSupply}.`);
}

const holdings = new Map();
for (const [tokenId, owner] of owners) {
  const entry = holdings.get(owner) || [];
  entry.push(tokenId);
  holdings.set(owner, entry);
}
const recipientAddresses = Array.from(holdings.keys()).sort((left, right) => left.localeCompare(right));
const smartContracts = await contractRecipients(recipientAddresses);
const holders = recipientAddresses.map((address) => ({
  address,
  quantity: holdings.get(address).length,
  sourceTokenIds: holdings.get(address).sort((left, right) => left - right),
  isContract: smartContracts.has(address),
}));
const heldTokenCount = holders.reduce((sum, holder) => sum + holder.quantity, 0);
if (heldTokenCount !== totalSupply) {
  throw new Error("Snapshot holdings do not match live source supply.");
}

const report = {
  schema: "hoodyoor-s2-holder-snapshot-v2",
  generatedAt: new Date().toISOString(),
  source: {
    chain: "Monad",
    chainId: 143,
    contract: sourceContract,
    blockNumber: snapshotBlock,
    blockHash: blockResponse.result.hash,
    blockTimestamp: new Date(Number(BigInt(blockResponse.result.timestamp)) * 1000).toISOString(),
    name: reads.name,
    symbol: reads.symbol,
    owner: ethers.getAddress(reads.owner),
    treasury: ethers.getAddress(reads.treasury),
    totalSupply,
    totalMinted,
    maxSupply: Number(reads.maxSupply),
  },
  destination: {
    collection: collectionConfig.name,
    chain: collectionConfig.targetChain.name,
    chainId: collectionConfig.targetChain.chainId,
    eligibility: "paid-gtd",
    maxMintPerHolder: collectionConfig.gtd.monadHolders.maxMintPerHolder,
  },
  summary: {
    liveSourceTokens: owners.size,
    burnedSourceTokens: burnedTokenIds.length,
    holderWallets: holders.length,
    contractHolderWallets: smartContracts.size,
    gtdEligibleWallets: holders.length,
    gtdSpots: holders.length * collectionConfig.gtd.monadHolders.maxMintPerHolder,
  },
  burnedSourceTokenIds: burnedTokenIds,
  holders,
};

fs.mkdirSync(outputRoot, { recursive: true });
const baseName = `hoodyoor-s2-holders-block-${snapshotBlock}`;
const jsonPath = path.join(outputRoot, `${baseName}.json`);
const csvPath = path.join(outputRoot, `${baseName}.csv`);
fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(csvPath, [
  "address,quantity,isContract,sourceTokenIds",
  ...holders.map((holder) => [
    holder.address,
    holder.quantity,
    holder.isContract,
    `\"${holder.sourceTokenIds.join(" ")}\"`,
  ].join(",")),
].join("\n") + "\n");

console.log(JSON.stringify({
  json: path.relative(projectRoot, jsonPath),
  csv: path.relative(projectRoot, csvPath),
  snapshotBlock,
  ...report.summary,
}, null, 2));
