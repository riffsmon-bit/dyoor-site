import fs from "node:fs/promises";
import path from "node:path";
import { getStore } from "@netlify/blobs";
import { ethers } from "ethers";
import { adminOwnerWallet, verifyAdmin } from "@/lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHAIN_ID = 143;
const DEFAULT_RPC = "https://rpc.monad.xyz";
const DEFAULT_ASCENSION_STAKING = "0xf9611226c1CcCcCa37951938d6f358D3d5106549";
const DEFAULT_DYOOR_S1 = "0x2c79c9e233fea4b4dcfe6561d9209dc292cd932f";
const DEFAULT_ENERGY_BANK = "0x291a8cC0FCa08EBd64a0e4d67B4455d24e9E6767";
const BLUEPRINTS_KEY = "ascension-blueprints.json";
const LOCAL_BLUEPRINTS_PATH = path.join(process.cwd(), "data", "ascension-blueprints.json");
const LOCAL_HARVEST_LEDGER_PATH = path.join(process.cwd(), "data", "harvested-energy.json");
const DEFAULT_S1_MAX_SUPPLY = 1111;
const DEFAULT_ASCENSION_START_BLOCK = 54_985_442;
const DEFAULT_ASCENSION_LOG_CHUNK_SIZE = 50_000;
const DEFAULT_DISCOVERY_BATCH_BLOCKS = 100_000;
const DEFAULT_OWNER_SCAN_BATCH_SIZE = 100;
const DEFAULT_OWNER_SCAN_CONCURRENCY = 6;
const GOLDSKY_PAGE_SIZE = 1000;
const DEFAULT_DISCOVERY_BUDGET_MS = 8_000;
const DEFAULT_RPC_TIMEOUT_MS = 7_000;
const DEFAULT_ENERGY_RPC_TIMEOUT_MS = 1_500;
const DEFAULT_FINALIZE_CONCURRENCY = 4;
const DEFAULT_INDEXED_FINALIZE_CONCURRENCY = 16;

const TRAIT_EXPORT_ORDER = [
  ["background", "Background"],
  ["droid", "Droid"],
  ["eyes", "Eyes"],
  ["clothes", "Clothes"],
  ["mouth", "Mouth"],
  ["hat", "Hat"],
  ["special", "Special"],
  ["accessories", "Accessories"],
] as const;

const stakingAbi = [
  "function tokensOfStaker(address user) view returns (uint256[])",
  "function getStakedTokens(address user) view returns (uint256[])",
  "function stakedBalance(address user) view returns (uint256)",
  "function balanceOf(address user) view returns (uint256)",
  "function pendingPoints(address user) view returns (uint256)",
  "function stakeInfo(uint256 tokenId) view returns (address owner,uint64 stakedAt)",
];

const erc721Abi = [
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
  "function ownerOf(uint256 tokenId) view returns (address)",
];

const energyBankAbi = [
  "function spendableEnergy(address user) view returns (uint256)",
  "function lifetimeEnergy(address user) view returns (uint256)",
];

type GoldskyStakeEvent = {
  id?: string;
  block_number?: string;
  timestamp_?: string;
  transactionHash_?: string;
  user?: string;
  tokenId?: string;
};

function readEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function readWholeNumberEnv(names: string[], fallback: number, allowZero = false) {
  for (const name of names) {
    const value = readEnv(name);
    if (!/^\d+$/.test(value)) continue;
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && (allowZero ? parsed >= 0 : parsed > 0)) return parsed;
  }
  return fallback;
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
}

function normalizeAddress(value: unknown) {
  try {
    return ethers.getAddress(String(value || "")).toLowerCase();
  } catch {
    return "";
  }
}

function normalizeAddressList(value: unknown) {
  return Array.from(new Set(readStringArray(value).map(normalizeAddress).filter(Boolean))).sort();
}

function compareNumericStrings(a: string, b: string) {
  const left = BigInt(a);
  const right = BigInt(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeTokenIdList(value: unknown) {
  return Array.from(new Set(readStringArray(value).filter((item) => /^\d+$/.test(item)))).sort(compareNumericStrings);
}

function normalizeTokenOwnerMap(value: unknown) {
  const owners = new Map<string, string>();
  if (!value || typeof value !== "object" || Array.isArray(value)) return owners;
  for (const [tokenId, wallet] of Object.entries(value as Record<string, unknown>)) {
    if (!/^\d+$/.test(tokenId)) continue;
    const normalizedWallet = normalizeAddress(wallet);
    if (normalizedWallet) owners.set(tokenId, normalizedWallet);
  }
  return owners;
}

function tokenOwnerRecord(owners: Map<string, string>) {
  return Object.fromEntries(Array.from(owners.entries()).sort(([a], [b]) => compareNumericStrings(a, b)));
}

function readDiscoveryInput(value: unknown) {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const numberValue = (key: string) => {
    const raw = input[key];
    return typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0 ? raw : undefined;
  };
  return {
    startBlock: numberValue("startBlock"),
    latestBlock: numberValue("latestBlock"),
    lastScannedBlock: numberValue("lastScannedBlock"),
    chunkSize: numberValue("chunkSize"),
    chunksScanned: numberValue("chunksScanned") || 0,
    failedChunks: numberValue("failedChunks") || 0,
    limited: Boolean(input.limited),
    discoveredWallets: numberValue("discoveredWallets") || 0,
    discoveredTokenIds: numberValue("discoveredTokenIds") || 0,
    scanMode: typeof input.scanMode === "string" ? input.scanMode : "",
    startTokenId: numberValue("startTokenId"),
    lastScannedTokenId: numberValue("lastScannedTokenId"),
    maxTokenId: numberValue("maxTokenId"),
    batchTokens: numberValue("batchTokens"),
    failedTokenReads: numberValue("failedTokenReads") || 0,
  };
}

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function formatUnits(raw: bigint) {
  const whole = raw / 10n ** 18n;
  const frac = (raw % 10n ** 18n).toString().padStart(18, "0").slice(0, 4).replace(/0+$/, "");
  return frac ? `${whole.toString()}.${frac}` : whole.toString();
}

function serialize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, serialize(val)]));
  }
  return value;
}

function getBlueprintStore() {
  const siteID = readEnv("NETLIFY_BLOBS_SITE_ID", "NETLIFY_SITE_ID", "SITE_ID");
  const token = readEnv("NETLIFY_BLOBS_TOKEN", "NETLIFY_ACCESS_TOKEN", "NETLIFY_AUTH_TOKEN");
  return siteID && token
    ? getStore({ name: "ascension-blueprints", siteID, token, consistency: "strong" })
    : getStore({ name: "ascension-blueprints", consistency: "strong" });
}

async function readBlueprints() {
  try {
    const value = await getBlueprintStore().get(BLUEPRINTS_KEY, { type: "json", consistency: "strong" });
    return Array.isArray(value) ? value : [];
  } catch {
    const local = await fs.readFile(LOCAL_BLUEPRINTS_PATH, "utf8").catch(() => "[]");
    const value = JSON.parse(local);
    return Array.isArray(value) ? value : [];
  }
}

async function readHarvestLedger() {
  try {
    const local = await fs.readFile(LOCAL_HARVEST_LEDGER_PATH, "utf8");
    const value = JSON.parse(local);
    return value && typeof value === "object" ? value as Record<string, { harvestedRaw?: string }> : {};
  } catch {
    return {};
  }
}

async function safeContract<T>(task: () => Promise<T>, fallback: T) {
  try {
    return await withTimeout(task(), readWholeNumberEnv(["ASCENSION_SNAPSHOT_RPC_TIMEOUT_MS"], DEFAULT_RPC_TIMEOUT_MS));
  } catch {
    return fallback;
  }
}

async function safeContractWithTimeout<T>(task: () => Promise<T>, fallback: T, timeoutMs: number) {
  try {
    return await withTimeout(task(), timeoutMs);
  } catch {
    return fallback;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("RPC request timed out.")), Math.max(1000, timeoutMs));
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function mapLimit<T, R>(items: T[], limit: number, mapper: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let index = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await mapper(items[current], current);
    }
  }));
  return results;
}

async function getLogsWithSplit(
  provider: ethers.JsonRpcProvider,
  filter: { address: string; topics: Array<string | Array<string> | null> },
  fromBlock: number,
  toBlock: number,
  deadline: number,
  stats: { failedRanges: number; timedOut: boolean },
): Promise<ethers.Log[]> {
  if (Date.now() >= deadline) {
    stats.failedRanges += 1;
    stats.timedOut = true;
    return [];
  }
  try {
    const timeoutMs = Math.min(readWholeNumberEnv(["ASCENSION_SNAPSHOT_RPC_TIMEOUT_MS"], DEFAULT_RPC_TIMEOUT_MS), Math.max(1000, deadline - Date.now()));
    return await withTimeout(provider.getLogs({ ...filter, fromBlock, toBlock }), timeoutMs);
  } catch {
    if (fromBlock >= toBlock || Date.now() >= deadline) {
      stats.failedRanges += 1;
      stats.timedOut = Date.now() >= deadline;
      return [];
    }
    const mid = Math.floor((fromBlock + toBlock) / 2);
    const left = await getLogsWithSplit(provider, filter, fromBlock, mid, deadline, stats);
    const right = await getLogsWithSplit(provider, filter, mid + 1, toBlock, deadline, stats);
    return left.concat(right);
  }
}

async function discoverStakingWallets(provider: ethers.JsonRpcProvider, stakingAddress: string, nftAddress: string) {
  const wallets = new Set<string>();
  const tokenIds = new Set<string>();
  const latest = await provider.getBlockNumber();
  const start = Math.min(latest, readWholeNumberEnv(["ASCENSION_START_BLOCK", "NEXT_PUBLIC_DYOOR_S1_START_BLOCK"], DEFAULT_ASCENSION_START_BLOCK, true));
  const chunk = readWholeNumberEnv(["ASCENSION_LOG_CHUNK_SIZE"], DEFAULT_ASCENSION_LOG_CHUNK_SIZE);
  const budgetMs = readWholeNumberEnv(["ASCENSION_SNAPSHOT_LOG_BUDGET_MS", "ASCENSION_SNAPSHOT_DISCOVERY_BUDGET_MS"], DEFAULT_DISCOVERY_BUDGET_MS);
  const deadline = Date.now() + budgetMs;
  let chunksScanned = 0;
  let failedChunks = 0;
  let lastScannedBlock = start > 0 ? start - 1 : 0;
  let limited = false;

  for (let from = start; from <= latest; from += chunk) {
    if (Date.now() >= deadline) {
      limited = true;
      break;
    }
    const batch = await discoverStakingWalletBatch(provider, stakingAddress, nftAddress, from, Math.min(latest, from + chunk - 1), deadline);
    for (const wallet of batch.wallets) wallets.add(wallet);
    for (const tokenId of batch.tokenIds) tokenIds.add(tokenId);
    chunksScanned += batch.discovery.chunksScanned || 1;
    failedChunks += batch.discovery.failedChunks || 0;
    lastScannedBlock = batch.discovery.lastScannedBlock || lastScannedBlock;
    limited = Boolean(batch.discovery.limited);
    if (limited) break;
  }

  const warnings: string[] = [];
  if (limited) {
    warnings.push(`Transfer-log discovery stopped at block ${lastScannedBlock} of ${latest} to keep the hosted snapshot request responsive.`);
  }
  if (failedChunks > 0) {
    warnings.push(`${failedChunks} transfer-log range${failedChunks === 1 ? "" : "s"} could not be read from the RPC and were skipped.`);
  }

  return {
    wallets,
    tokenIds,
    discovery: {
      startBlock: start,
      latestBlock: latest,
      lastScannedBlock,
      chunkSize: chunk,
      chunksScanned,
      failedChunks,
      limited,
      discoveredWallets: wallets.size,
      discoveredTokenIds: tokenIds.size,
    },
    warnings,
  };
}

async function discoverStakingWalletBatch(
  provider: ethers.JsonRpcProvider,
  stakingAddress: string,
  nftAddress: string,
  fromBlock: number,
  toBlock: number,
  deadline: number,
) {
  const wallets = new Set<string>();
  const tokenIds = new Set<string>();
  const warnings: string[] = [];
  const iface = new ethers.Interface(erc721Abi);
  const transferTopic = ethers.id("Transfer(address,address,uint256)");
  const stakingTopic = ethers.zeroPadValue(stakingAddress, 32);
  const filter = {
    address: nftAddress,
    topics: [transferTopic, null, stakingTopic],
  };
  let failedChunks = 0;
  let limited = false;
  const stats = { failedRanges: 0, timedOut: false };

  const logs = await getLogsWithSplit(provider, filter, fromBlock, toBlock, deadline, stats);
  for (const log of logs) {
    try {
      const parsed = iface.parseLog(log);
      const fromWallet = normalizeAddress(parsed?.args?.from);
      const tokenId = parsed?.args?.tokenId?.toString();
      if (fromWallet) wallets.add(fromWallet);
      if (tokenId) tokenIds.add(tokenId);
    } catch {}
  }
  if (stats.failedRanges > 0) {
    failedChunks = 1;
    limited = stats.timedOut;
    warnings.push(`${stats.failedRanges} transfer-log sub-range${stats.failedRanges === 1 ? "" : "s"} inside ${fromBlock}-${toBlock} could not be read from the RPC.`);
  }

  return {
    wallets,
    tokenIds,
    warnings,
    discovery: {
      lastScannedBlock: toBlock,
      chunksScanned: 1,
      failedChunks,
      limited,
    },
  };
}

function goldskyEventBlock(event: GoldskyStakeEvent) {
  const value = Number(event.block_number || 0);
  return Number.isFinite(value) ? value : 0;
}

function activeGoldskyStakes(staked: GoldskyStakeEvent[], unstaked: GoldskyStakeEvent[]) {
  const events = [
    ...staked.map((event) => ({ ...event, kind: "staked" as const })),
    ...unstaked.map((event) => ({ ...event, kind: "unstaked" as const })),
  ].filter((event) => /^\d+$/.test(String(event.tokenId || "")));

  events.sort((a, b) => {
    const blockDiff = goldskyEventBlock(a) - goldskyEventBlock(b);
    if (blockDiff !== 0) return blockDiff;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });

  const active = new Map<string, string>();
  for (const event of events) {
    const tokenId = String(event.tokenId);
    if (event.kind === "unstaked") {
      active.delete(tokenId);
      continue;
    }
    const wallet = normalizeAddress(event.user);
    if (wallet) active.set(tokenId, wallet);
  }

  return active;
}

async function fetchGoldskyEvents(endpoint: string, field: "stakeds" | "unstakeds") {
  const rows: GoldskyStakeEvent[] = [];
  let indexedBlock = 0;

  for (let skip = 0; skip < 50_000; skip += GOLDSKY_PAGE_SIZE) {
    const query = `
      query DyoorGoldskySnapshotEvents($skip: Int!) {
        _meta { block { number } }
        ${field}(first: ${GOLDSKY_PAGE_SIZE}, skip: $skip, orderBy: block_number, orderDirection: asc) {
          id
          block_number
          timestamp_
          transactionHash_
          user
          tokenId
        }
      }
    `;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables: { skip } }),
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.errors?.length) {
      throw Object.assign(new Error(`Goldsky ${field} query failed.`), { status: 502 });
    }

    indexedBlock = Math.max(indexedBlock, Number(payload?.data?._meta?.block?.number || 0));
    const batch = Array.isArray(payload?.data?.[field]) ? payload.data[field] as GoldskyStakeEvent[] : [];
    rows.push(...batch);
    if (batch.length < GOLDSKY_PAGE_SIZE) break;
  }

  return { rows, indexedBlock };
}

async function discoverGoldskySnapshotPage(endpoint: string) {
  const [staked, unstaked] = await Promise.all([
    fetchGoldskyEvents(endpoint, "stakeds"),
    fetchGoldskyEvents(endpoint, "unstakeds"),
  ]);
  const tokenOwners = activeGoldskyStakes(staked.rows, unstaked.rows);
  const wallets = Array.from(new Set(tokenOwners.values())).sort();
  const tokenIds = Array.from(tokenOwners.keys()).sort(compareNumericStrings);
  const indexedBlock = Math.max(staked.indexedBlock, unstaked.indexedBlock);

  return {
    ok: true,
    phase: "discover",
    complete: true,
    wallets,
    tokenIds,
    tokenOwners: tokenOwnerRecord(tokenOwners),
    cursor: null,
    discovery: {
      scanMode: "goldsky-events",
      startBlock: 0,
      latestBlock: indexedBlock,
      lastScannedBlock: indexedBlock,
      chunkSize: GOLDSKY_PAGE_SIZE,
      chunksScanned: Math.ceil((staked.rows.length + unstaked.rows.length) / GOLDSKY_PAGE_SIZE) || 1,
      failedChunks: 0,
      limited: false,
      discoveredWallets: wallets.length,
      discoveredTokenIds: tokenIds.length,
    },
    warnings: [
      `Goldsky active stake index used: ${staked.rows.length} stake event${staked.rows.length === 1 ? "" : "s"}, ${unstaked.rows.length} unstake event${unstaked.rows.length === 1 ? "" : "s"}.`,
    ],
  };
}

async function discoverOwnerOfSnapshotPage(body: Record<string, unknown>) {
  const provider = new ethers.JsonRpcProvider(readEnv("MONAD_RPC_URL", "NEXT_PUBLIC_MONAD_RPC_URL") || DEFAULT_RPC, CHAIN_ID);
  const stakingAddress = ethers.getAddress(readEnv("ASCENSION_STAKING_ADDRESS", "ASCENSION_STAKING_CONTRACT", "NEXT_PUBLIC_ASCENSION_STAKING_CONTRACT") || DEFAULT_ASCENSION_STAKING);
  const nftAddress = ethers.getAddress(readEnv("DYOOR_S1_CONTRACT", "NEXT_PUBLIC_DYOOR_S1_CONTRACT") || DEFAULT_DYOOR_S1);
  const nft = new ethers.Contract(nftAddress, erc721Abi, provider);
  const cursor = body.cursor && typeof body.cursor === "object" ? body.cursor as Record<string, unknown> : {};
  const maxTokenId = readWholeNumberEnv(["DYOOR_S1_MAX_SUPPLY", "NEXT_PUBLIC_DYOOR_S1_MAX_SUPPLY"], DEFAULT_S1_MAX_SUPPLY);
  const configuredBatchTokens = readWholeNumberEnv(["ASCENSION_SNAPSHOT_TOKEN_BATCH_SIZE"], DEFAULT_OWNER_SCAN_BATCH_SIZE);
  const requestedBatchTokens = Number(cursor.batchTokens || 0);
  const batchTokens = Number.isSafeInteger(requestedBatchTokens) && requestedBatchTokens > 0
    ? Math.min(configuredBatchTokens, Math.max(1, requestedBatchTokens))
    : configuredBatchTokens;
  const requestedNextTokenId = Number(cursor.nextTokenId || 1);
  const fromTokenId = Math.min(maxTokenId + 1, Math.max(1, Number.isSafeInteger(requestedNextTokenId) ? requestedNextTokenId : 1));
  const toTokenId = fromTokenId > maxTokenId ? maxTokenId : Math.min(maxTokenId, fromTokenId + batchTokens - 1);
  const timeoutMs = readWholeNumberEnv(["ASCENSION_SNAPSHOT_RPC_TIMEOUT_MS"], DEFAULT_RPC_TIMEOUT_MS);
  const concurrency = readWholeNumberEnv(["ASCENSION_SNAPSHOT_OWNER_SCAN_CONCURRENCY"], DEFAULT_OWNER_SCAN_CONCURRENCY);

  if (fromTokenId > maxTokenId) {
    return {
      ok: true,
      phase: "discover",
      complete: true,
      wallets: [],
      tokenIds: [],
      cursor: null,
      discovery: {
        scanMode: "ownerOf",
        startTokenId: 1,
        lastScannedTokenId: maxTokenId,
        maxTokenId,
        batchTokens,
        chunksScanned: 0,
        failedChunks: 0,
        failedTokenReads: 0,
        limited: false,
        discoveredWallets: 0,
        discoveredTokenIds: 0,
      },
      warnings: [],
    };
  }

  const tokenIdsToRead = Array.from({ length: toTokenId - fromTokenId + 1 }, (_, index) => fromTokenId + index);
  const reads = await mapLimit(tokenIdsToRead, concurrency, async (tokenId) => {
    try {
      const owner = normalizeAddress(await withTimeout(nft.ownerOf(BigInt(tokenId)), timeoutMs));
      return {
        tokenId: String(tokenId),
        staked: owner === stakingAddress.toLowerCase(),
        failed: false,
      };
    } catch {
      return {
        tokenId: String(tokenId),
        staked: false,
        failed: true,
      };
    }
  });
  const failedReads = reads.filter((row) => row.failed);
  const stakedTokenIds = reads.filter((row) => row.staked).map((row) => row.tokenId);
  if (failedReads.length > 0 && batchTokens <= 1) {
    throw Object.assign(new Error(`ownerOf failed for token #${failedReads[0].tokenId}. Retry the scan range.`), { status: 502 });
  }
  const rangeNeedsRetry = failedReads.length > 0;
  const nextBatchTokens = rangeNeedsRetry ? Math.max(1, Math.floor(batchTokens / 2)) : configuredBatchTokens;
  const nextTokenId = rangeNeedsRetry ? fromTokenId : toTokenId + 1;
  const complete = !rangeNeedsRetry && toTokenId >= maxTokenId;
  const warnings = failedReads.length
    ? [`${failedReads.length} ownerOf read${failedReads.length === 1 ? "" : "s"} failed inside token range ${fromTokenId}-${toTokenId}. Retrying this range with ${nextBatchTokens}-token batches.`]
    : [];

  return {
    ok: true,
    phase: "discover",
    complete,
    wallets: [],
    tokenIds: stakedTokenIds,
    cursor: complete ? null : { scanMode: "ownerOf", nextTokenId, maxTokenId, batchTokens: nextBatchTokens },
    discovery: {
      scanMode: "ownerOf",
      startTokenId: 1,
      lastScannedTokenId: rangeNeedsRetry ? Math.max(0, fromTokenId - 1) : toTokenId,
      maxTokenId,
      batchTokens,
      chunksScanned: 1,
      failedChunks: 0,
      failedTokenReads: failedReads.length,
      limited: rangeNeedsRetry,
      discoveredWallets: 0,
      discoveredTokenIds: stakedTokenIds.length,
    },
    warnings,
  };
}

async function discoverSnapshotPage(body: Record<string, unknown>) {
  const cursor = body.cursor && typeof body.cursor === "object" ? body.cursor as Record<string, unknown> : {};
  const requestedMode = typeof cursor.scanMode === "string" ? cursor.scanMode : "";
  const goldskyEndpoint = readEnv("GOLDSKY_SUBGRAPH_URL", "NEXT_PUBLIC_GOLDSKY_SUBGRAPH_URL");
  if (goldskyEndpoint && (!requestedMode || requestedMode === "goldsky-events")) {
    return discoverGoldskySnapshotPage(goldskyEndpoint);
  }
  return discoverOwnerOfSnapshotPage(body);
}

async function discoverTransferLogSnapshotPage(body: Record<string, unknown>) {
  const provider = new ethers.JsonRpcProvider(readEnv("MONAD_RPC_URL", "NEXT_PUBLIC_MONAD_RPC_URL") || DEFAULT_RPC, CHAIN_ID);
  const stakingAddress = ethers.getAddress(readEnv("ASCENSION_STAKING_ADDRESS", "ASCENSION_STAKING_CONTRACT", "NEXT_PUBLIC_ASCENSION_STAKING_CONTRACT") || DEFAULT_ASCENSION_STAKING);
  const nftAddress = ethers.getAddress(readEnv("DYOOR_S1_CONTRACT", "NEXT_PUBLIC_DYOOR_S1_CONTRACT") || DEFAULT_DYOOR_S1);
  const cursor = body.cursor && typeof body.cursor === "object" ? body.cursor as Record<string, unknown> : {};
  const cursorLatestBlock = typeof cursor.latestBlock === "number" && Number.isSafeInteger(cursor.latestBlock) && cursor.latestBlock > 0 ? cursor.latestBlock : 0;
  let latest = cursorLatestBlock;
  try {
    latest = await withTimeout(provider.getBlockNumber(), readWholeNumberEnv(["ASCENSION_SNAPSHOT_RPC_TIMEOUT_MS"], DEFAULT_RPC_TIMEOUT_MS));
  } catch (error) {
    if (!cursorLatestBlock) throw error;
  }
  const start = Math.min(latest, readWholeNumberEnv(["ASCENSION_START_BLOCK", "NEXT_PUBLIC_DYOOR_S1_START_BLOCK"], DEFAULT_ASCENSION_START_BLOCK, true));
  const configuredBatchBlocks = readWholeNumberEnv(["ASCENSION_SNAPSHOT_BATCH_BLOCKS"], DEFAULT_DISCOVERY_BATCH_BLOCKS);
  const requestedBatchBlocks = Number(cursor.batchBlocks || 0);
  const maxBatchBlocks = Number.isSafeInteger(requestedBatchBlocks) && requestedBatchBlocks > 0
    ? Math.min(configuredBatchBlocks, Math.max(250, requestedBatchBlocks))
    : configuredBatchBlocks;
  const requestedNext = Number(cursor.nextBlock || start);
  const fromBlock = Math.min(latest + 1, Math.max(start, Number.isSafeInteger(requestedNext) ? requestedNext : start));
  const toBlock = fromBlock > latest ? latest : Math.min(latest, fromBlock + maxBatchBlocks - 1);
  const deadline = Date.now() + readWholeNumberEnv(["ASCENSION_SNAPSHOT_LOG_BUDGET_MS", "ASCENSION_SNAPSHOT_DISCOVERY_BUDGET_MS"], DEFAULT_DISCOVERY_BUDGET_MS);

  if (fromBlock > latest) {
    return {
      ok: true,
      phase: "discover",
      complete: true,
      wallets: [],
      tokenIds: [],
      cursor: null,
      discovery: {
        startBlock: start,
        latestBlock: latest,
        lastScannedBlock: latest,
        chunkSize: maxBatchBlocks,
        chunksScanned: 0,
        failedChunks: 0,
        limited: false,
        discoveredWallets: 0,
        discoveredTokenIds: 0,
      },
      warnings: [],
    };
  }

  const page = await discoverStakingWalletBatch(provider, stakingAddress, nftAddress, fromBlock, toBlock, deadline);
  let complete = toBlock >= latest;
  const warnings = [...page.warnings];
  const rangeSize = toBlock >= fromBlock ? toBlock - fromBlock + 1 : 0;
  const rangeNeedsRetry = page.discovery.failedChunks > 0 && rangeSize > 250;
  const nextBatchBlocks = rangeNeedsRetry ? Math.max(250, Math.floor(rangeSize / 2)) : configuredBatchBlocks;
  const nextBlock = rangeNeedsRetry ? fromBlock : toBlock + 1;
  if (page.discovery.limited) {
    warnings.push(`Transfer-log discovery paused at block ${toBlock} of ${latest}. Continuing in the next request.`);
  }
  if (rangeNeedsRetry) {
    complete = false;
    warnings.push(`Retrying block range ${fromBlock}-${toBlock} with ${nextBatchBlocks.toLocaleString()}-block batches.`);
  }

  return {
    ok: true,
    phase: "discover",
    complete,
    wallets: Array.from(page.wallets),
    tokenIds: Array.from(page.tokenIds),
    cursor: complete ? null : { nextBlock, latestBlock: latest, batchBlocks: nextBatchBlocks },
    discovery: {
      startBlock: start,
      latestBlock: latest,
      lastScannedBlock: rangeNeedsRetry ? Math.max(start, fromBlock - 1) : toBlock,
      chunkSize: maxBatchBlocks,
      chunksScanned: 1,
      failedChunks: page.discovery.failedChunks,
      limited: page.discovery.limited,
      discoveredWallets: page.wallets.size,
      discoveredTokenIds: page.tokenIds.size,
    },
    warnings,
  };
}

async function tokenOwnerFromStakeInfo(staking: ethers.Contract, tokenId: string) {
  const info = await safeContract(async () => await staking.stakeInfo(BigInt(tokenId)), null);
  return normalizeAddress(info?.owner);
}

async function stakingRow(
  wallet: string,
  staking: ethers.Contract,
  energyBank: ethers.Contract,
  harvestLedger: Record<string, { harvestedRaw?: string }>,
  timestamp: string,
  supplementalTokenIds: string[] = [],
) {
  let tokenIds = normalizeTokenIdList(supplementalTokenIds);
  let fallbackCount = 0n;
  if (!tokenIds.length) {
    const tokenValues = await safeContract(async () => await staking.tokensOfStaker(wallet), null)
      || await safeContract(async () => await staking.getStakedTokens(wallet), null)
      || [];
    tokenIds = normalizeTokenIdList(Array.isArray(tokenValues) ? tokenValues.map((id) => id.toString()) : []);
    fallbackCount = await safeContract(async () => await staking.stakedBalance(wallet), 0n)
      || await safeContract(async () => await staking.balanceOf(wallet), 0n);
  }
  const energyTimeoutMs = readWholeNumberEnv(["ASCENSION_SNAPSHOT_ENERGY_RPC_TIMEOUT_MS"], DEFAULT_ENERGY_RPC_TIMEOUT_MS);
  const [pendingRaw, lifetimeRaw] = await Promise.all([
    safeContractWithTimeout(async () => await staking.pendingPoints(wallet), 0n, energyTimeoutMs),
    safeContractWithTimeout(async () => await energyBank.lifetimeEnergy(wallet), 0n, energyTimeoutMs),
  ]);
  const harvestedRaw = BigInt(String(harvestLedger[wallet.toLowerCase()]?.harvestedRaw || "0"));

  return {
    wallet,
    stakedCount: Math.max(tokenIds.length, Number(fallbackCount || 0n)),
    tokenIds,
    pendingEnergy: formatUnits(pendingRaw),
    pendingEnergyRaw: pendingRaw.toString(),
    harvestedEnergy: formatUnits(harvestedRaw),
    harvestedEnergyRaw: harvestedRaw.toString(),
    lifetimeEnergy: formatUnits(lifetimeRaw),
    lifetimeEnergyRaw: lifetimeRaw.toString(),
    ascended: tokenIds.length > 0 || Number(fallbackCount || 0n) > 0,
    snapshotTimestamp: timestamp,
  };
}

function blueprintRows(blueprints: Array<Record<string, any>>, timestamp: string) {
  return blueprints.map((entry) => {
    const traits = entry.traits && typeof entry.traits === "object" ? entry.traits : {};
    const row: Record<string, unknown> = {
      wallet: normalizeAddress(entry.wallet),
      savedBlueprint: Boolean(entry.ascensionBlueprint || entry.blueprintId || entry.createdAt),
      savedBlueprintTimestamp: String(entry.createdAt || ""),
      blueprintId: String(entry.blueprintId || entry.hash || ""),
      imageUrl: String(entry.imageUrl || entry.image || entry.png || ""),
      eligibilityStatus: entry.ascensionBlueprint ? "eligible" : "",
      snapshotTimestamp: timestamp,
    };
    for (const [key, label] of TRAIT_EXPORT_ORDER) row[label] = String(traits[key] || "");
    return row;
  }).filter((row) => row.wallet);
}

async function generateSnapshots(input?: {
  wallets: Set<string>;
  tokenIds: Set<string>;
  tokenOwners?: Map<string, string>;
  discovery: ReturnType<typeof readDiscoveryInput>;
  warnings: string[];
}) {
  const timestamp = new Date().toISOString();
  const provider = new ethers.JsonRpcProvider(readEnv("MONAD_RPC_URL", "NEXT_PUBLIC_MONAD_RPC_URL") || DEFAULT_RPC, CHAIN_ID);
  const stakingAddress = ethers.getAddress(readEnv("ASCENSION_STAKING_ADDRESS", "ASCENSION_STAKING_CONTRACT", "NEXT_PUBLIC_ASCENSION_STAKING_CONTRACT") || DEFAULT_ASCENSION_STAKING);
  const nftAddress = ethers.getAddress(readEnv("DYOOR_S1_CONTRACT", "NEXT_PUBLIC_DYOOR_S1_CONTRACT") || DEFAULT_DYOOR_S1);
  const energyBankAddress = ethers.getAddress(readEnv("ENERGY_BANK_ADDRESS", "NEXT_PUBLIC_ENERGY_BANK_ADDRESS") || DEFAULT_ENERGY_BANK);
  const staking = new ethers.Contract(stakingAddress, stakingAbi, provider);
  const nft = new ethers.Contract(nftAddress, erc721Abi, provider);
  const energyBank = new ethers.Contract(energyBankAddress, energyBankAbi, provider);
  const blueprints = await readBlueprints() as Array<Record<string, any>>;
  const harvestLedger = await readHarvestLedger();
  const blueprint = blueprintRows(blueprints, timestamp);
  const discovered = input || await discoverStakingWallets(provider, stakingAddress, nftAddress);
  const warnings = [...discovered.warnings];
  const ascendedTokenOwners = new Map<string, string>();
  const walletSet = new Set<string>(blueprint.map((row) => String(row.wallet)));
  const hasIndexedOwners = Boolean(input?.tokenOwners?.size);
  const finalizeConcurrency = hasIndexedOwners
    ? readWholeNumberEnv(["ASCENSION_SNAPSHOT_INDEXED_FINALIZE_CONCURRENCY", "ASCENSION_SNAPSHOT_FINALIZE_CONCURRENCY"], DEFAULT_INDEXED_FINALIZE_CONCURRENCY)
    : readWholeNumberEnv(["ASCENSION_SNAPSHOT_FINALIZE_CONCURRENCY"], DEFAULT_FINALIZE_CONCURRENCY);

  for (const [tokenId, wallet] of input?.tokenOwners || []) {
    if (!/^\d+$/.test(tokenId) || !wallet) continue;
    ascendedTokenOwners.set(tokenId, wallet);
    walletSet.add(wallet);
  }

  const unresolvedTokenIds = Array.from(discovered.tokenIds).filter((tokenId) => !ascendedTokenOwners.has(tokenId));
  const ascendedOwnerRows = await mapLimit(unresolvedTokenIds, finalizeConcurrency, async (tokenId) => {
    const currentOwner = normalizeAddress(await safeContract(async () => await nft.ownerOf(BigInt(tokenId)), ""));
    if (currentOwner !== stakingAddress.toLowerCase()) return null;
    const staker = await tokenOwnerFromStakeInfo(staking, tokenId);
    return { tokenId, staker, registered: Boolean(staker) };
  });
  for (const row of ascendedOwnerRows) {
    if (!row) continue;
    if (row.staker) {
      ascendedTokenOwners.set(row.tokenId, row.staker);
      walletSet.add(row.staker);
    } else {
      ascendedTokenOwners.set(row.tokenId, "");
    }
  }
  for (const wallet of discovered.wallets) walletSet.add(wallet);

  const indexedTokenIdsByWallet = new Map<string, string[]>();
  for (const [tokenId, wallet] of ascendedTokenOwners.entries()) {
    if (!wallet) continue;
    const tokenIds = indexedTokenIdsByWallet.get(wallet) || [];
    tokenIds.push(tokenId);
    indexedTokenIdsByWallet.set(wallet, tokenIds);
  }

  const blueprintWallets = new Set(blueprint.map((item) => String(item.wallet)));
  const stakingRows = (await mapLimit(Array.from(walletSet), finalizeConcurrency, (wallet) => (
    stakingRow(wallet, staking, energyBank, harvestLedger, timestamp, indexedTokenIdsByWallet.get(wallet) || [])
  )))
    .filter((row) => row.stakedCount > 0 || blueprintWallets.has(row.wallet));
  const stakingByWallet = new Map(stakingRows.map((row) => [row.wallet, row]));
  const ascendedS1ByToken = new Map<string, Record<string, unknown>>();

  function addAscendedS1Row(tokenId: string, wallet: string, source: string) {
    if (!/^\d+$/.test(tokenId)) return;
    const stake = stakingByWallet.get(wallet);
    ascendedS1ByToken.set(tokenId, {
      tokenId,
      wallet: wallet || "unregistered",
      ascended: "yes",
      tokenIdSource: source,
      stakedCountForWallet: stake?.stakedCount || "",
      pendingEnergy: stake?.pendingEnergy || "0",
      pendingEnergyRaw: stake?.pendingEnergyRaw || "0",
      harvestedEnergy: stake?.harvestedEnergy || "",
      harvestedEnergyRaw: stake?.harvestedEnergyRaw || "0",
      lifetimeEnergy: stake?.lifetimeEnergy || "0",
      lifetimeEnergyRaw: stake?.lifetimeEnergyRaw || "0",
      nftContract: nftAddress.toLowerCase(),
      stakingContract: stakingAddress.toLowerCase(),
      snapshotTimestamp: timestamp,
    });
  }

  for (const row of stakingRows) {
    for (const tokenId of row.tokenIds || []) {
      const tokenIdString = String(tokenId);
      addAscendedS1Row(tokenIdString, row.wallet, ascendedTokenOwners.has(tokenIdString) ? "goldsky-events" : "staking-wallet-read");
    }
  }
  for (const [tokenId, wallet] of ascendedTokenOwners.entries()) {
    if (!ascendedS1ByToken.has(tokenId)) addAscendedS1Row(tokenId, wallet, wallet ? "goldsky-events" : "ownerOf-unregistered");
  }

  const ascendedS1 = Array.from(ascendedS1ByToken.values())
    .sort((a, b) => compareNumericStrings(String(a.tokenId || "0"), String(b.tokenId || "0")));
  const blueprintByWallet = new Map(blueprint.map((row) => [String(row.wallet), row]));
  const combined = Array.from(new Set([...stakingByWallet.keys(), ...blueprintByWallet.keys()])).sort().map((wallet) => {
    const stake = stakingByWallet.get(wallet);
    const bp = blueprintByWallet.get(wallet);
    return {
      wallet,
      stakedCount: stake?.stakedCount || 0,
      ascended: stake?.ascended ? "yes" : "no",
      savedBlueprint: bp ? "yes" : "no",
      Background: bp?.Background || "",
      Droid: bp?.Droid || "",
      Eyes: bp?.Eyes || "",
      Clothes: bp?.Clothes || "",
      Mouth: bp?.Mouth || "",
      Hat: bp?.Hat || "",
      Special: bp?.Special || "",
      Accessories: bp?.Accessories || "",
      pendingEnergy: stake?.pendingEnergy || "0",
      harvestedEnergy: stake?.harvestedEnergy || "",
      lifetimeEnergy: stake?.lifetimeEnergy || "0",
      snapshotTimestamp: timestamp,
    };
  });

  return {
    ok: true,
    generatedAt: timestamp,
    totals: {
      walletsFound: combined.length,
      totalStaked: Math.max(stakingRows.reduce((sum, row) => sum + Number(row.stakedCount || 0), 0), ascendedS1.length),
      totalAscendedS1: ascendedS1.length,
      ascendedS1Wallets: new Set(ascendedS1.map((row) => String(row.wallet)).filter((wallet) => wallet.startsWith("0x"))).size,
      totalBlueprintsSaved: blueprint.length,
    },
    staking: stakingRows,
    ascendedS1,
    blueprints: blueprint,
    combined,
    discovery: discovered.discovery,
    warnings,
  };
}

async function finalizeSnapshotFromBody(body: Record<string, unknown>) {
  const discoveredWallets = normalizeAddressList(body.discoveredWallets);
  const discoveredTokenIds = normalizeTokenIdList(body.discoveredTokenIds);
  const tokenOwners = normalizeTokenOwnerMap(body.tokenOwners);
  const incomingDiscovery = readDiscoveryInput(body.discovery);
  const incomingWarnings = Array.from(new Set(readStringArray(body.warnings))).slice(0, 40);
  if (incomingDiscovery.scanMode === "ownerOf" && incomingDiscovery.maxTokenId && incomingDiscovery.lastScannedTokenId !== incomingDiscovery.maxTokenId) {
    throw Object.assign(new Error("Exact S1 owner scan is not complete. Scan the remaining token ranges before building exports."), { status: 409 });
  }
  for (const [tokenId, wallet] of tokenOwners.entries()) {
    discoveredTokenIds.push(tokenId);
    discoveredWallets.push(wallet);
  }
  const finalTokenIds = normalizeTokenIdList(discoveredTokenIds);
  const finalWallets = normalizeAddressList(discoveredWallets);
  return generateSnapshots({
    wallets: new Set(finalWallets),
    tokenIds: new Set(finalTokenIds),
    tokenOwners,
    discovery: {
      ...incomingDiscovery,
      discoveredWallets: finalWallets.length,
      discoveredTokenIds: finalTokenIds.length,
    },
    warnings: incomingWarnings,
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const wallet = normalizeAddress(url.searchParams.get("wallet"));
  const owner = normalizeAddress(adminOwnerWallet());
  if (!owner) return json(500, { ok: false, error: "Admin owner wallet is not configured." });
  return json(200, { ok: true, connected: Boolean(wallet), authorized: Boolean(wallet && wallet === owner) });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    await verifyAdmin(body, "snapshot", { consumeNonce: false, windowMs: 15 * 60 * 1000 });
    const mode = String(body.mode || "full");
    if (mode === "discover") {
      return json(200, serialize(await discoverSnapshotPage(body)) as Record<string, unknown>);
    }
    if (mode === "finalize") {
      return json(200, serialize(await finalizeSnapshotFromBody(body)) as Record<string, unknown>);
    }
    return json(200, serialize(await generateSnapshots()) as Record<string, unknown>);
  } catch (error: any) {
    return json(Number(error?.status || 500), { ok: false, error: error?.message || "Admin snapshot failed." });
  }
}
