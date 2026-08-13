import path from "node:path";
import dotenv from "dotenv";
import { ethers } from "ethers";
import { argValue, envValue, hasFlag, positiveIntegerArg } from "./cli";
import { readJsonOrNull, writeJson } from "./json";
import { GAME_CACHE_ROOT, REPOSITORY_ROOT, assertPathInside } from "./paths";

dotenv.config({ path: path.join(REPOSITORY_ROOT, ".env.local"), quiet: true });
dotenv.config({ path: path.join(REPOSITORY_ROOT, ".env"), quiet: true });

export const MONAD_CHAIN_ID = 143;
export const S2_CONTRACT = "0x349D8eb480c92cF75371fbA5C6344A4d11b9103A";
export const S2_DEPLOYMENT_BLOCK = 87_616_887;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");

const CONTRACT_ABI = [
  "function totalSupply() view returns (uint256)",
  "function totalMinted() view returns (uint256)",
  "function maxSupply() view returns (uint256)",
  "function MAX_SUPPLY() view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
] as const;

export type CompactTransferLog = {
  blockNumber: number;
  transactionIndex: number;
  logIndex: number;
  transactionHash: string;
  from: string;
  to: string;
  tokenId: number;
  sequence?: number;
};

export type ChainSnapshot = {
  blockNumber: number;
  totalSupply: number;
  totalMinted: number;
  maxSupply: number;
  logs: CompactTransferLog[];
  rpcHost: string;
};

export type S2ReadContract = ethers.Contract & {
  totalSupply(): Promise<bigint>;
  totalMinted(): Promise<bigint>;
  maxSupply(): Promise<bigint>;
  MAX_SUPPLY(): Promise<bigint>;
  ownerOf(tokenId: bigint): Promise<string>;
};

function rpcUrl() {
  const configured = argValue(
    "--rpc-url",
    envValue(
      "DYOOR_GAME_RPC_URL",
      "ALCHEMY_MONAD_RPC_URL",
      "DYOOR_S2_LOG_RPC_URL",
      "MONAD_LOG_RPC_URL",
      "MONAD_RPC_URL",
      "NEXT_PUBLIC_MONAD_RPC_URL",
    ) || "https://rpc.monad.xyz",
  );
  const url = new URL(configured);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("Game classifier RPC must use HTTPS (or localhost HTTP).");
  }
  if (/testnet/i.test(url.toString())) throw new Error("Game classifier requires Monad mainnet.");
  return url.toString();
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function topicAddress(topic: string | undefined) {
  if (!topic || !/^0x[a-fA-F0-9]{64}$/.test(topic)) return "";
  try {
    return ethers.getAddress(`0x${topic.slice(-40)}`).toLowerCase();
  } catch {
    return "";
  }
}

function compactLog(log: ethers.Log): CompactTransferLog {
  const from = topicAddress(log.topics[1]);
  const to = topicAddress(log.topics[2]);
  const rawToken = log.topics[3];
  const tokenId = rawToken ? Number(BigInt(rawToken)) : 0;
  if (!from || !to || !Number.isSafeInteger(tokenId) || tokenId < 1 || tokenId > 3333) {
    throw new Error(`Malformed Season 2 Transfer log at block ${log.blockNumber}.`);
  }
  return {
    blockNumber: Number(log.blockNumber),
    transactionIndex: Number(log.transactionIndex),
    logIndex: Number(log.index),
    transactionHash: String(log.transactionHash || "").toLowerCase(),
    from,
    to,
    tokenId,
  };
}

function transientRpcError(error: unknown) {
  return /429|timeout|timed out|rate|limit|network|server|fetch|ECONN|range|response size|too many/i.test(
    String((error as { shortMessage?: string; message?: string })?.shortMessage || (error as Error)?.message || error),
  );
}

async function getLogsAdaptive(
  provider: ethers.JsonRpcProvider,
  fromBlock: number,
  toBlock: number,
): Promise<ethers.Log[]> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await withTimeout(provider.getLogs({
        address: S2_CONTRACT,
        topics: [TRANSFER_TOPIC],
        fromBlock,
        toBlock,
      }), 18_000, `Transfer logs ${fromBlock}-${toBlock}`);
    } catch (error) {
      lastError = error;
      if (transientRpcError(error) && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
        continue;
      }
      break;
    }
  }
  if (fromBlock < toBlock) {
    const midpoint = Math.floor((fromBlock + toBlock) / 2);
    const left = await getLogsAdaptive(provider, fromBlock, midpoint);
    const right = await getLogsAdaptive(provider, midpoint + 1, toBlock);
    return left.concat(right);
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function normalizeAlchemyAddress(value: unknown) {
  const raw = typeof value === "string"
    ? value
    : value && typeof value === "object"
      ? String((value as Record<string, unknown>).address || "")
      : "";
  try {
    return ethers.getAddress(raw).toLowerCase();
  } catch {
    return "";
  }
}

function alchemyTokenId(transfer: Record<string, unknown>) {
  const rawContract = transfer.rawContract as Record<string, unknown> | undefined;
  const value = transfer.tokenId ?? transfer.erc721TokenId ?? rawContract?.tokenId;
  try {
    const tokenId = Number(BigInt(String(value || "")));
    return Number.isSafeInteger(tokenId) && tokenId >= 1 && tokenId <= 3333 ? tokenId : 0;
  } catch {
    return 0;
  }
}

async function loadAlchemyTransfers(
  provider: ethers.JsonRpcProvider,
  url: string,
  fromBlock: number,
  toBlock: number,
) {
  if (!/alchemy/i.test(url) || hasFlag("--raw-logs-only")) return null;
  const cacheRoot = path.join(GAME_CACHE_ROOT, "chain", "alchemy-transfers");
  const cachePath = path.join(cacheRoot, `${fromBlock}-${toBlock}.json`);
  assertPathInside(cacheRoot, cachePath, "Alchemy transfer cache");
  if (!hasFlag("--refresh-chain")) {
    const cached = await readJsonOrNull<CompactTransferLog[]>(cachePath);
    if (cached) {
      console.log(`alchemy transfers cache · records=${cached.length}`);
      return cached;
    }
  }

  const logs: CompactTransferLog[] = [];
  let pageKey = "";
  for (let page = 0; page < 200; page += 1) {
    const response = await withTimeout(provider.send("alchemy_getAssetTransfers", [{
      fromBlock: `0x${fromBlock.toString(16)}`,
      toBlock: `0x${toBlock.toString(16)}`,
      contractAddresses: [S2_CONTRACT],
      category: ["erc721"],
      withMetadata: false,
      excludeZeroValue: false,
      maxCount: "0x3e8",
      order: "asc",
      ...(pageKey ? { pageKey } : {}),
    }]), 25_000, `Alchemy transfer page ${page + 1}`) as {
      transfers?: Array<Record<string, unknown>>;
      pageKey?: string;
    };
    const transfers = Array.isArray(response.transfers) ? response.transfers : [];
    for (const transfer of transfers) {
      const tokenId = alchemyTokenId(transfer);
      const from = normalizeAlchemyAddress(transfer.from);
      const to = normalizeAlchemyAddress(transfer.to);
      const rawBlock = String(transfer.blockNum || transfer.blockNumber || "0");
      const blockNumber = Number(BigInt(rawBlock));
      if (!tokenId || !from || !to || !Number.isSafeInteger(blockNumber)) {
        throw new Error("Alchemy returned a malformed Season 2 transfer.");
      }
      logs.push({
        blockNumber,
        transactionIndex: 0,
        logIndex: 0,
        sequence: logs.length,
        transactionHash: String(transfer.hash || transfer.transactionHash || "").toLowerCase(),
        from,
        to,
        tokenId,
      });
    }
    pageKey = String(response.pageKey || "");
    console.log(`alchemy transfers page ${page + 1} · pageRecords=${transfers.length} · total=${logs.length}`);
    if (!pageKey) break;
    if (page === 199) throw new Error("Alchemy transfer pagination exceeded 200 pages.");
  }
  await writeJson(cachePath, logs);
  return logs;
}

async function cachedLogRange(
  provider: ethers.JsonRpcProvider,
  fromBlock: number,
  toBlock: number,
) {
  const cacheRoot = path.join(GAME_CACHE_ROOT, "chain", "transfer-logs");
  const cachePath = path.join(cacheRoot, `${fromBlock}-${toBlock}.json`);
  assertPathInside(cacheRoot, cachePath, "Transfer-log cache");
  if (!hasFlag("--refresh-chain")) {
    const cached = await readJsonOrNull<CompactTransferLog[]>(cachePath);
    if (cached) return { logs: cached, cached: true };
  }
  const logs = (await getLogsAdaptive(provider, fromBlock, toBlock)).map(compactLog);
  await writeJson(cachePath, logs);
  return { logs, cached: false };
}

function safeSupply(value: bigint, label: string) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > 100_000) {
    throw new Error(`${label} returned an invalid value.`);
  }
  return number;
}

export async function loadChainSnapshot(): Promise<{
  snapshot: ChainSnapshot;
  provider: ethers.JsonRpcProvider;
  contract: S2ReadContract;
}> {
  const url = rpcUrl();
  const provider = new ethers.JsonRpcProvider(url, MONAD_CHAIN_ID, {
    staticNetwork: true,
    batchMaxCount: 20,
    batchStallTime: 20,
  });
  const contract = new ethers.Contract(
    S2_CONTRACT,
    CONTRACT_ABI,
    provider,
  ) as unknown as S2ReadContract;
  const [network, blockNumber, totalSupplyRaw, totalMintedRaw, maxSupplyRaw] = await Promise.all([
    provider.getNetwork(),
    provider.getBlockNumber(),
    contract.totalSupply(),
    contract.totalMinted(),
    contract.maxSupply().catch(() => contract.MAX_SUPPLY()),
  ]);
  if (Number(network.chainId) !== MONAD_CHAIN_ID) throw new Error("RPC did not return Monad mainnet chain ID 143.");
  const totalSupply = safeSupply(totalSupplyRaw, "totalSupply");
  const totalMinted = safeSupply(totalMintedRaw, "totalMinted");
  const maxSupply = safeSupply(maxSupplyRaw, "maxSupply");
  if (totalSupply > totalMinted || totalMinted > maxSupply) {
    throw new Error("Contract supply invariants are inconsistent.");
  }

  const startBlock = positiveIntegerArg("--start-block", S2_DEPLOYMENT_BLOCK, blockNumber);
  const chunkSize = positiveIntegerArg("--log-chunk-size", 25_000, 100_000);
  const indexedTransfers = await loadAlchemyTransfers(provider, url, startBlock, blockNumber);
  const logs: CompactTransferLog[] = indexedTransfers || [];
  if (!indexedTransfers) {
    let cachedChunks = 0;
    let fetchedChunks = 0;
    for (let fromBlock = startBlock; fromBlock <= blockNumber; fromBlock += chunkSize) {
      const toBlock = Math.min(blockNumber, fromBlock + chunkSize - 1);
      const range = await cachedLogRange(provider, fromBlock, toBlock);
      logs.push(...range.logs);
      if (range.cached) cachedChunks += 1;
      else fetchedChunks += 1;
      console.log(
        `chain logs ${fromBlock}-${toBlock} · transfers=${logs.length} · cache=${cachedChunks} · fetched=${fetchedChunks}`,
      );
    }
  }
  logs.sort((left, right) => (
    left.blockNumber - right.blockNumber
    || left.transactionIndex - right.transactionIndex
    || left.logIndex - right.logIndex
    || (left.sequence || 0) - (right.sequence || 0)
  ));
  return {
    snapshot: {
      blockNumber,
      totalSupply,
      totalMinted,
      maxSupply,
      logs,
      rpcHost: new URL(url).hostname,
    },
    provider,
    contract,
  };
}

export async function verifyOwners(
  contract: S2ReadContract,
  tokenIds: number[],
  expectedOwners: Map<number, string>,
) {
  const concurrency = positiveIntegerArg("--owner-concurrency", 10, 20);
  const owners = new Map<number, string>();
  const failures = new Map<number, string>();
  let cursor = 0;
  let completed = 0;

  async function readOwner(tokenId: number) {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const owner = ethers.getAddress(await contract.ownerOf(BigInt(tokenId))).toLowerCase();
        owners.set(tokenId, owner);
        failures.delete(tokenId);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 180 * (attempt + 1)));
      }
    }
    failures.set(
      tokenId,
      String((lastError as { shortMessage?: string; message?: string })?.shortMessage || (lastError as Error)?.message || lastError).slice(0, 200),
    );
  }

  async function worker() {
    while (cursor < tokenIds.length) {
      const index = cursor;
      cursor += 1;
      const tokenId = tokenIds[index];
      if (tokenId === undefined) continue;
      await readOwner(tokenId);
      completed += 1;
      if (completed % 100 === 0 || completed === tokenIds.length) {
        console.log(`ownerOf ${completed}/${tokenIds.length} · failures=${failures.size}`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const slowRetryTokenIds = [...failures.keys()];
  if (slowRetryTokenIds.length) {
    console.log(`ownerOf slow retry · tokens=${slowRetryTokenIds.length}`);
    for (const tokenId of slowRetryTokenIds) {
      await new Promise((resolve) => setTimeout(resolve, 750));
      await readOwner(tokenId);
    }
  }
  const mismatches = [...owners.entries()].flatMap(([tokenId, owner]) => {
    const expected = expectedOwners.get(tokenId);
    return expected && expected !== owner ? [{ tokenId, expected, actual: owner }] : [];
  });
  return { owners, failures, mismatches };
}
