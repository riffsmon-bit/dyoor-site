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
const DEFAULT_OWNER_SCAN_BATCH_SIZE = 50;
const DEFAULT_OWNER_SCAN_CONCURRENCY = 2;
const GOLDSKY_PAGE_SIZE = 1000;
const DEFAULT_DISCOVERY_BUDGET_MS = 8_000;
const DEFAULT_RPC_TIMEOUT_MS = 15_000;
const DEFAULT_ENERGY_RPC_TIMEOUT_MS = 1_500;
const DEFAULT_FINALIZE_CONCURRENCY = 4;
const DEFAULT_INDEXED_FINALIZE_CONCURRENCY = 16;
const DEFAULT_TRANSFER_FALLBACK_BUDGET_MS = 25_000;

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

const NONE_VALUE = "None";

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
  "function balanceOf(address owner) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenOfOwnerByIndex(address owner,uint256 index) view returns (uint256)",
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

type SnapshotCheckStatus = "pass" | "warning" | "fail";

type SnapshotValidationCheck = {
  scope: "staking" | "blueprint" | "combined";
  label: string;
  status: SnapshotCheckStatus;
  detail: string;
};

type StakeTokenMeta = {
  tokenId: string;
  wallet: string;
  stakedAtRaw: string;
  stakedAt: string;
  source: string;
  validationStatus: "verified" | "warning";
  depositTxHash?: string;
  depositBlock?: number;
  validationNotes?: string;
};

type TransferEvidence = {
  tokenId: string;
  fallbackWallet: string;
  depositTxHash: string;
  depositBlock: number;
};

function readEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function snapshotRpcUrl() {
  return readEnv("ALCHEMY_MONAD_RPC_URL", "NEXT_PUBLIC_MONAD_RPC_URL", "MONAD_RPC_URL", "RPC_URL") || DEFAULT_RPC;
}

function isAlchemyRpc(value: string) {
  return /alchemy\.com/i.test(value);
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
    stakingContractBalance: numberValue("stakingContractBalance"),
    startIndex: numberValue("startIndex"),
    lastScannedIndex: numberValue("lastScannedIndex"),
    maxIndex: numberValue("maxIndex"),
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

function snapshotFileStamp(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}-${hh}${min}`;
}

function snapshotFilenames(timestamp: string) {
  const stamp = snapshotFileStamp(timestamp);
  return {
    stakingCsv: `ascension-staking-snapshot-${stamp}.csv`,
    stakingJson: `ascension-staking-snapshot-${stamp}.json`,
    blueprintCsv: `ascension-blueprint-snapshot-${stamp}.csv`,
    blueprintJson: `ascension-blueprint-snapshot-${stamp}.json`,
    combinedCsv: `combined-ascension-snapshot-${stamp}.csv`,
    combinedJson: `combined-ascension-snapshot-${stamp}.json`,
  };
}

function traitValue(traits: Record<string, unknown>, key: string) {
  const value = String(traits?.[key] || "").trim();
  if (value) return value;
  if (key === "accessories") {
    const legacy = String(traits?.["accessories 2"] || traits?.accessories2 || "").trim();
    if (legacy) return legacy;
  }
  return NONE_VALUE;
}

function rowStatus(statuses: Array<"verified" | "warning" | "failed">) {
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("warning")) return "warning";
  return "verified";
}

function formatStakeTimestamp(raw: unknown) {
  try {
    const value = BigInt(String(raw || "0"));
    if (value <= 0n) return { raw: "0", iso: "" };
    const seconds = Number(value);
    if (!Number.isSafeInteger(seconds) || seconds < 1_000_000_000 || seconds > 4_102_444_800) {
      return { raw: value.toString(), iso: "" };
    }
    return { raw: value.toString(), iso: new Date(seconds * 1000).toISOString() };
  } catch {
    return { raw: "0", iso: "" };
  }
}

function validationSummary(checks: SnapshotValidationCheck[]) {
  const errors = checks.filter((check) => check.status === "fail").map((check) => check.detail);
  const warnings = checks.filter((check) => check.status === "warning").map((check) => check.detail);
  return {
    verified: errors.length === 0 && warnings.length === 0,
    status: errors.length ? "failed" : warnings.length ? "warning" : "verified",
    checks,
    warnings,
    errors,
  };
}

function isTransientSnapshotWarning(message: string) {
  return /ownerOf read.*failed inside the current token batch.*Retrying/i.test(message)
    || /tokenOfOwnerByIndex read.*failed inside the current staking-contract index batch.*Retrying/i.test(message)
    || /Retrying snapshot collection with/i.test(message);
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

async function readHarvestRecord(wallet: string, localLedger: Record<string, { harvestedRaw?: string }>) {
  const normalized = wallet.toLowerCase();
  try {
    const store = getStore("ascension-energy-ledger");
    const record = await store.get(`${normalized}.json`, { type: "json", consistency: "strong" });
    if (record && typeof record === "object") {
      return {
        record: record as { harvestedRaw?: string },
        source: "ascension-energy-ledger-blob",
      };
    }
  } catch {}
  return {
    record: localLedger[normalized] || null,
    source: localLedger[normalized] ? "local-harvest-ledger" : "none",
  };
}

function snapshotHistoryStore() {
  return getStore({ name: "admin-snapshots", consistency: "strong" });
}

async function appendSnapshotHistory(entry: Record<string, unknown>) {
  try {
    const store = snapshotHistoryStore();
    const current = await store.get("snapshot-history.json", { type: "json", consistency: "strong" }).catch(() => []);
    const history = Array.isArray(current) ? current : [];
    const next = [entry, ...history].slice(0, 25);
    await store.setJSON("snapshot-history.json", next);
    return next;
  } catch {
    return [];
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
    warnings.push(`Transfer-log collection paused at block ${lastScannedBlock} of ${latest} to keep the hosted snapshot request responsive.`);
  }
  if (failedChunks > 0) {
    warnings.push(`${failedChunks} transfer-log batch${failedChunks === 1 ? "" : "es"} could not be read from the RPC and were skipped.`);
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
    warnings.push(`${stats.failedRanges} transfer-log batch${stats.failedRanges === 1 ? "" : "es"} inside ${fromBlock}-${toBlock} could not be read from the RPC.`);
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

async function scanTransferEvidence(
  provider: ethers.JsonRpcProvider,
  stakingAddress: string,
  nftAddress: string,
  tokenFilter?: Set<string>,
  rpcUrl = snapshotRpcUrl(),
  latestBlockOverride = 0,
) {
  const depositsByToken = new Map<string, TransferEvidence>();
  const warnings: string[] = [];

  if (isAlchemyRpc(rpcUrl)) {
    try {
      return await scanAlchemyTransferEvidence(rpcUrl, stakingAddress, nftAddress, tokenFilter, latestBlockOverride);
    } catch (error: any) {
      warnings.push(`Alchemy transfer fallback failed: ${error?.message || "unknown error"}. Falling back to RPC logs.`);
    }
  }

  const iface = new ethers.Interface(erc721Abi);
  const transferTopic = ethers.id("Transfer(address,address,uint256)");
  const stakingTopic = ethers.zeroPadValue(stakingAddress, 32);
  const latest = latestBlockOverride || await safeContract(async () => await provider.getBlockNumber(), 0);
  if (!latest) {
    return { depositsByToken, logsScanned: 0, warnings: ["Transfer fallback could not read the latest block."] };
  }

  const start = Math.min(latest, readWholeNumberEnv(["ASCENSION_START_BLOCK", "NEXT_PUBLIC_DYOOR_S1_START_BLOCK"], DEFAULT_ASCENSION_START_BLOCK, true));
  const chunk = readWholeNumberEnv(["ASCENSION_LOG_CHUNK_SIZE"], DEFAULT_ASCENSION_LOG_CHUNK_SIZE);
  const budgetMs = readWholeNumberEnv(["ASCENSION_SNAPSHOT_TRANSFER_FALLBACK_BUDGET_MS"], DEFAULT_TRANSFER_FALLBACK_BUDGET_MS);
  const deadline = Date.now() + budgetMs;
  let logsScanned = 0;
  let lastScannedBlock = start > 0 ? start - 1 : 0;
  const stats = { failedRanges: 0, timedOut: false };

  for (let fromBlock = start; fromBlock <= latest; fromBlock += chunk) {
    if (Date.now() >= deadline) {
      stats.timedOut = true;
      break;
    }
    const toBlock = Math.min(fromBlock + chunk - 1, latest);
    const logs = await getLogsWithSplit(provider, {
      address: nftAddress,
      topics: [transferTopic, null, stakingTopic],
    }, fromBlock, toBlock, deadline, stats);
    lastScannedBlock = toBlock;

    for (const log of logs) {
      try {
        const parsed = iface.parseLog(log);
        const tokenId = parsed?.args?.tokenId?.toString();
        if (!tokenId || (tokenFilter && !tokenFilter.has(tokenId))) continue;
        const fallbackWallet = normalizeAddress(parsed?.args?.from);
        if (!fallbackWallet) continue;
        depositsByToken.set(tokenId, {
          tokenId,
          fallbackWallet,
          depositTxHash: String(log.transactionHash || "").toLowerCase(),
          depositBlock: Number(log.blockNumber || 0),
        });
        logsScanned += 1;
      } catch {}
    }
  }

  if (stats.failedRanges > 0) {
    warnings.push(`${stats.failedRanges} transfer fallback range${stats.failedRanges === 1 ? "" : "s"} could not be read from the RPC.`);
  }
  if (stats.timedOut) {
    warnings.push(`Transfer fallback stopped at block ${lastScannedBlock.toLocaleString()} of ${latest.toLocaleString()}. Increase ASCENSION_SNAPSHOT_TRANSFER_FALLBACK_BUDGET_MS if unresolved token owners remain.`);
  }

  return { depositsByToken, logsScanned, warnings };
}

async function scanAlchemyTransferEvidence(
  rpcUrl: string,
  stakingAddress: string,
  nftAddress: string,
  tokenFilter?: Set<string>,
  latestBlockOverride = 0,
) {
  const depositsByToken = new Map<string, TransferEvidence>();
  const warnings: string[] = [];
  const start = readWholeNumberEnv(["ASCENSION_START_BLOCK", "NEXT_PUBLIC_DYOOR_S1_START_BLOCK"], DEFAULT_ASCENSION_START_BLOCK, true);
  const latestBlock = latestBlockOverride || 0;
  let pageKey = "";
  let requestCount = 0;
  let transferCount = 0;

  do {
    const params: Record<string, unknown> = {
      fromBlock: ethers.toQuantity(start),
      toBlock: latestBlock ? ethers.toQuantity(latestBlock) : "latest",
      toAddress: stakingAddress,
      contractAddresses: [nftAddress],
      category: ["erc721"],
      withMetadata: false,
      excludeZeroValue: false,
      maxCount: "0x3e8",
      order: "asc",
    };
    if (pageKey) params.pageKey = pageKey;

    const response = await withTimeout(fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "alchemy_getAssetTransfers",
        params: [params],
      }),
    }), readWholeNumberEnv(["ASCENSION_SNAPSHOT_RPC_TIMEOUT_MS"], DEFAULT_RPC_TIMEOUT_MS));
    const text = await response.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error("alchemy_getAssetTransfers returned invalid JSON.");
    }
    if (!response.ok || json?.error) {
      throw new Error(json?.error?.message || `alchemy_getAssetTransfers failed (${response.status}).`);
    }
    if (!json?.result || !Array.isArray(json.result.transfers)) {
      throw new Error("alchemy_getAssetTransfers returned no transfer result.");
    }

    requestCount += 1;
    const transfers = json.result.transfers;
    transferCount += transfers.length;

    for (const transfer of transfers) {
      const tokenHex = transfer?.tokenId || transfer?.erc721TokenId;
      if (!tokenHex) continue;
      const tokenId = BigInt(tokenHex).toString();
      if (tokenFilter && !tokenFilter.has(tokenId)) continue;
      const fallbackWallet = normalizeAddress(transfer?.from);
      if (!fallbackWallet) continue;
      depositsByToken.set(tokenId, {
        tokenId,
        fallbackWallet,
        depositTxHash: String(transfer?.hash || "").toLowerCase(),
        depositBlock: transfer?.blockNum ? Number(BigInt(transfer.blockNum)) : 0,
      });
    }

    pageKey = String(json?.result?.pageKey || "");
  } while (pageKey);

  return { depositsByToken, logsScanned: transferCount, warnings };
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
  const provider = new ethers.JsonRpcProvider(snapshotRpcUrl(), CHAIN_ID);
  const stakingAddress = ethers.getAddress(readEnv("ASCENSION_STAKING_ADDRESS", "ASCENSION_STAKING_CONTRACT", "NEXT_PUBLIC_ASCENSION_STAKING_CONTRACT") || DEFAULT_ASCENSION_STAKING);
  const nftAddress = ethers.getAddress(readEnv("DYOOR_S1_CONTRACT", "NEXT_PUBLIC_DYOOR_S1_CONTRACT") || DEFAULT_DYOOR_S1);
  const nft = new ethers.Contract(nftAddress, erc721Abi, provider);
  const cursor = body.cursor && typeof body.cursor === "object" ? body.cursor as Record<string, unknown> : {};
  const cursorLatestBlock = typeof cursor.latestBlock === "number" && Number.isSafeInteger(cursor.latestBlock) && cursor.latestBlock > 0 ? cursor.latestBlock : 0;
  const latestBlock = cursorLatestBlock || await withTimeout(provider.getBlockNumber(), readWholeNumberEnv(["ASCENSION_SNAPSHOT_RPC_TIMEOUT_MS"], DEFAULT_RPC_TIMEOUT_MS));
  const stakingContractBalance = Number(await safeContract(async () => await nft.balanceOf(stakingAddress, { blockTag: latestBlock }), 0n));
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
        latestBlock,
        startTokenId: 1,
        lastScannedTokenId: maxTokenId,
        maxTokenId,
        batchTokens,
        chunksScanned: 0,
        failedChunks: 0,
        failedTokenReads: 0,
        stakingContractBalance,
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
      const owner = normalizeAddress(await withTimeout(nft.ownerOf(BigInt(tokenId), { blockTag: latestBlock }), timeoutMs));
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
  const previousDiscoveredTokenIds = normalizeTokenIdList(body.discoveredTokenIds);
  const failedReads = reads.filter((row) => row.failed);
  const stakedTokenIds = failedReads.length ? [] : reads.filter((row) => row.staked).map((row) => row.tokenId);
  const discoveredCount = new Set([...previousDiscoveredTokenIds, ...stakedTokenIds]).size;
  if (failedReads.length > 0 && batchTokens <= 1) {
    throw Object.assign(new Error(`ownerOf failed for token #${failedReads[0].tokenId}. Retry snapshot generation.`), { status: 502 });
  }
  const rangeNeedsRetry = failedReads.length > 0;
  const nextBatchTokens = rangeNeedsRetry ? Math.max(1, Math.floor(batchTokens / 2)) : configuredBatchTokens;
  const nextTokenId = rangeNeedsRetry ? fromTokenId : toTokenId + 1;
  const complete = !rangeNeedsRetry && (toTokenId >= maxTokenId || (stakingContractBalance > 0 && discoveredCount >= stakingContractBalance));
  const warnings = failedReads.length
    ? [`${failedReads.length} ownerOf read${failedReads.length === 1 ? "" : "s"} failed inside the current token batch. Retrying with ${nextBatchTokens}-token batches.`]
    : [];
  if (complete && stakingContractBalance > 0 && discoveredCount !== stakingContractBalance) {
    warnings.push(`Owner scan found ${discoveredCount} staked token ID${discoveredCount === 1 ? "" : "s"}, but the S1 contract reports ${stakingContractBalance} NFTs at the staking contract.`);
  }

  return {
    ok: true,
    phase: "discover",
    complete,
    wallets: [],
    tokenIds: stakedTokenIds,
    cursor: complete ? null : { scanMode: "ownerOf", nextTokenId, maxTokenId, batchTokens: nextBatchTokens, latestBlock },
    discovery: {
      scanMode: "ownerOf",
      latestBlock,
      startTokenId: 1,
      lastScannedTokenId: rangeNeedsRetry ? Math.max(0, fromTokenId - 1) : toTokenId,
      maxTokenId,
      batchTokens,
      chunksScanned: 1,
      failedChunks: 0,
      failedTokenReads: failedReads.length,
      stakingContractBalance,
      limited: rangeNeedsRetry,
      discoveredWallets: 0,
      discoveredTokenIds: stakedTokenIds.length,
    },
    warnings,
  };
}

async function discoverOwnerEnumerableSnapshotPage(body: Record<string, unknown>) {
  const provider = new ethers.JsonRpcProvider(snapshotRpcUrl(), CHAIN_ID);
  const stakingAddress = ethers.getAddress(readEnv("ASCENSION_STAKING_ADDRESS", "ASCENSION_STAKING_CONTRACT", "NEXT_PUBLIC_ASCENSION_STAKING_CONTRACT") || DEFAULT_ASCENSION_STAKING);
  const nftAddress = ethers.getAddress(readEnv("DYOOR_S1_CONTRACT", "NEXT_PUBLIC_DYOOR_S1_CONTRACT") || DEFAULT_DYOOR_S1);
  const nft = new ethers.Contract(nftAddress, erc721Abi, provider);
  const cursor = body.cursor && typeof body.cursor === "object" ? body.cursor as Record<string, unknown> : {};
  const cursorLatestBlock = typeof cursor.latestBlock === "number" && Number.isSafeInteger(cursor.latestBlock) && cursor.latestBlock > 0 ? cursor.latestBlock : 0;
  const latestBlock = cursorLatestBlock || await withTimeout(provider.getBlockNumber(), readWholeNumberEnv(["ASCENSION_SNAPSHOT_RPC_TIMEOUT_MS"], DEFAULT_RPC_TIMEOUT_MS));
  const stakingContractBalance = Number(await safeContract(async () => await nft.balanceOf(stakingAddress, { blockTag: latestBlock }), 0n));
  const maxIndex = Math.max(0, stakingContractBalance - 1);
  const configuredBatchIndexes = readWholeNumberEnv(["ASCENSION_SNAPSHOT_TOKEN_BATCH_SIZE"], DEFAULT_OWNER_SCAN_BATCH_SIZE);
  const requestedBatchIndexes = Number(cursor.batchTokens || 0);
  const batchTokens = Number.isSafeInteger(requestedBatchIndexes) && requestedBatchIndexes > 0
    ? Math.min(configuredBatchIndexes, Math.max(1, requestedBatchIndexes))
    : configuredBatchIndexes;
  const requestedNextIndex = Number(cursor.nextIndex || 0);
  const fromIndex = Math.max(0, Number.isSafeInteger(requestedNextIndex) ? requestedNextIndex : 0);
  const toIndex = stakingContractBalance <= 0 ? -1 : Math.min(maxIndex, fromIndex + batchTokens - 1);
  const timeoutMs = readWholeNumberEnv(["ASCENSION_SNAPSHOT_RPC_TIMEOUT_MS"], DEFAULT_RPC_TIMEOUT_MS);
  const concurrency = readWholeNumberEnv(["ASCENSION_SNAPSHOT_OWNER_SCAN_CONCURRENCY"], DEFAULT_OWNER_SCAN_CONCURRENCY);

  if (stakingContractBalance <= 0 || fromIndex > maxIndex) {
    return {
      ok: true,
      phase: "discover",
      complete: true,
      wallets: [],
      tokenIds: [],
      cursor: null,
      discovery: {
        scanMode: "owner-enumerable",
        latestBlock,
        startIndex: 0,
        lastScannedIndex: maxIndex,
        maxIndex,
        batchTokens,
        chunksScanned: 0,
        failedChunks: 0,
        failedTokenReads: 0,
        stakingContractBalance,
        limited: false,
        discoveredWallets: 0,
        discoveredTokenIds: 0,
      },
      warnings: stakingContractBalance <= 0 ? ["S1 balanceOf(staking contract) returned zero."] : [],
    };
  }

  const indexesToRead = Array.from({ length: toIndex - fromIndex + 1 }, (_, index) => fromIndex + index);
  const reads = await mapLimit(indexesToRead, concurrency, async (index) => {
    try {
      const tokenId = await withTimeout(nft.tokenOfOwnerByIndex(stakingAddress, BigInt(index), { blockTag: latestBlock }), timeoutMs);
      return {
        index,
        tokenId: String(tokenId),
        failed: false,
      };
    } catch {
      return {
        index,
        tokenId: "",
        failed: true,
      };
    }
  });
  const failedReads = reads.filter((row) => row.failed);
  if (failedReads.length > 0 && batchTokens <= 1) {
    throw Object.assign(new Error(`tokenOfOwnerByIndex failed for staking-contract index #${failedReads[0].index}. Retry snapshot generation.`), { status: 502 });
  }

  const rangeNeedsRetry = failedReads.length > 0;
  const tokenIds = rangeNeedsRetry ? [] : normalizeTokenIdList(reads.map((row) => row.tokenId).filter(Boolean));
  const previousDiscoveredTokenIds = normalizeTokenIdList(body.discoveredTokenIds);
  const discoveredCount = new Set([...previousDiscoveredTokenIds, ...tokenIds]).size;
  const nextBatchTokens = rangeNeedsRetry ? Math.max(1, Math.floor(batchTokens / 2)) : configuredBatchIndexes;
  const nextIndex = rangeNeedsRetry ? fromIndex : toIndex + 1;
  const complete = !rangeNeedsRetry && discoveredCount >= stakingContractBalance;
  const warnings = failedReads.length
    ? [`${failedReads.length} tokenOfOwnerByIndex read${failedReads.length === 1 ? "" : "s"} failed inside the current staking-contract index batch. Retrying with ${nextBatchTokens}-index batches.`]
    : [];

  return {
    ok: true,
    phase: "discover",
    complete,
    wallets: [],
    tokenIds,
    cursor: complete ? null : { scanMode: "owner-enumerable", nextIndex, maxIndex, batchTokens: nextBatchTokens, latestBlock },
    discovery: {
      scanMode: "owner-enumerable",
      latestBlock,
      startIndex: 0,
      lastScannedIndex: rangeNeedsRetry ? Math.max(0, fromIndex - 1) : toIndex,
      maxIndex,
      batchTokens,
      chunksScanned: 1,
      failedChunks: 0,
      failedTokenReads: failedReads.length,
      stakingContractBalance,
      limited: rangeNeedsRetry,
      discoveredWallets: 0,
      discoveredTokenIds: tokenIds.length,
    },
    warnings,
  };
}

async function discoverSnapshotPage(body: Record<string, unknown>) {
  const cursor = body.cursor && typeof body.cursor === "object" ? body.cursor as Record<string, unknown> : {};
  const requestedMode = typeof cursor.scanMode === "string" ? cursor.scanMode : "";
  const configuredMode = readEnv("ASCENSION_SNAPSHOT_DISCOVERY_MODE").toLowerCase();
  const goldskyEndpoint = readEnv("GOLDSKY_SUBGRAPH_URL", "NEXT_PUBLIC_GOLDSKY_SUBGRAPH_URL");
  if (goldskyEndpoint && requestedMode === "goldsky-events") {
    return discoverGoldskySnapshotPage(goldskyEndpoint);
  }
  if (requestedMode === "owner-enumerable" || configuredMode === "owner-enumerable") {
    return discoverOwnerEnumerableSnapshotPage(body);
  }
  if (requestedMode === "ownerOf" || configuredMode === "ownerof") {
    return discoverOwnerOfSnapshotPage(body);
  }
  return discoverOwnerOfSnapshotPage(body);
}

async function discoverTransferLogSnapshotPage(body: Record<string, unknown>) {
  const provider = new ethers.JsonRpcProvider(snapshotRpcUrl(), CHAIN_ID);
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
    warnings.push(`Retrying snapshot collection with ${nextBatchBlocks.toLocaleString()}-block batches.`);
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

async function tokenStakeMeta(
  staking: ethers.Contract,
  tokenId: string,
  indexedOwner = "",
  blockTag?: number,
): Promise<StakeTokenMeta> {
  const info = await safeContract(async () => await staking.stakeInfo(BigInt(tokenId), blockTag ? { blockTag } : {}), null);
  const stakeInfoOwner = normalizeAddress(info?.owner ?? info?.[0]);
  const stakedAt = formatStakeTimestamp(info?.stakedAt ?? info?.[1]);
  const fallbackOwner = normalizeAddress(indexedOwner);
  const wallet = stakeInfoOwner || fallbackOwner;
  return {
    tokenId,
    wallet,
    stakedAtRaw: stakedAt.raw,
    stakedAt: stakedAt.iso,
    source: stakeInfoOwner ? "stakeInfo" : fallbackOwner ? "indexed-owner-fallback" : "unregistered",
    validationStatus: stakeInfoOwner ? "verified" : "warning",
  };
}

async function stakingRow(
  wallet: string,
  staking: ethers.Contract,
  energyBank: ethers.Contract,
  harvestLedger: Record<string, { harvestedRaw?: string }>,
  timestamp: string,
  supplementalTokenIds: string[] = [],
  tokenMetaById: Map<string, StakeTokenMeta> = new Map(),
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
  const [pendingRaw, lifetimeRaw, bankRaw, harvestRecord] = await Promise.all([
    safeContractWithTimeout(async () => await staking.pendingPoints(wallet), 0n, energyTimeoutMs),
    safeContractWithTimeout(async () => await energyBank.lifetimeEnergy(wallet), 0n, energyTimeoutMs),
    safeContractWithTimeout(async () => await energyBank.spendableEnergy(wallet), 0n, energyTimeoutMs),
    readHarvestRecord(wallet, harvestLedger),
  ]);
  const harvestedRaw = BigInt(String(harvestRecord.record?.harvestedRaw || "0"));
  const tokenMetas = tokenIds.map((tokenId) => tokenMetaById.get(String(tokenId))).filter(Boolean) as StakeTokenMeta[];
  const stakeTimes = tokenMetas
    .map((meta) => meta.stakedAt)
    .filter(Boolean)
    .sort();
  const stakedCount = Math.max(tokenIds.length, Number(fallbackCount || 0n));
  const validationNotes: string[] = [];
  if (!tokenIds.length && stakedCount > 0) validationNotes.push("Staked count is from staking contract balance fallback; token IDs were not verified by ownerOf.");
  if (tokenMetas.some((meta) => meta.validationStatus !== "verified")) validationNotes.push("One or more token owners came from an indexed fallback because stakeInfo did not return a staker.");

  return {
    wallet,
    staked: stakedCount > 0 ? "yes" : "no",
    stakedCount,
    tokenIds,
    stakedTokenIds: tokenIds.join(", "),
    ascendedStatus: stakedCount > 0 ? "yes" : "no",
    firstAscendedAt: stakeTimes[0] || "",
    firstAscendedBlock: "",
    lastStakeAt: stakeTimes[stakeTimes.length - 1] || "",
    lastStakeBlock: "",
    pendingEnergy: formatUnits(pendingRaw),
    pendingEnergyRaw: pendingRaw.toString(),
    harvestedEnergy: formatUnits(harvestedRaw),
    harvestedEnergyRaw: harvestedRaw.toString(),
    lifetimeEnergy: formatUnits(lifetimeRaw),
    lifetimeEnergyRaw: lifetimeRaw.toString(),
    energyBank: formatUnits(bankRaw),
    energyBankRaw: bankRaw.toString(),
    ascended: stakedCount > 0,
    snapshotTimestamp: timestamp,
    dataSourceUsed: tokenIds.length ? "s1-ownerOf+ascension-stakeInfo+energy-bank-contract" : "staking-contract-fallback+energy-bank-contract",
    energyDataSource: `energy-bank-contract+${harvestRecord.source}`,
    validationStatus: rowStatus([
      tokenIds.length === stakedCount ? "verified" : "warning",
      tokenMetas.some((meta) => meta.validationStatus !== "verified") ? "warning" : "verified",
    ]),
    validationNotes: validationNotes.join(" "),
  };
}

function blueprintTimestamp(entry: Record<string, any>) {
  const value = Date.parse(String(entry.updatedAt || entry.createdAt || entry.savedAt || ""));
  return Number.isFinite(value) ? value : Number(entry.rank || 0);
}

function blueprintRows(blueprints: Array<Record<string, any>>, timestamp: string) {
  const warnings: string[] = [];
  const versions = blueprints.map((entry, index) => {
    const wallet = normalizeAddress(entry.wallet);
    const traits = entry.traits && typeof entry.traits === "object" ? entry.traits : {};
    const row: Record<string, unknown> = {
      wallet,
      savedBlueprint: Boolean(entry.ascensionBlueprint || entry.blueprintId || entry.createdAt),
      savedBlueprintStatus: Boolean(entry.ascensionBlueprint || entry.blueprintId || entry.createdAt) ? "yes" : "no",
      savedBlueprintTimestamp: String(entry.createdAt || entry.savedAt || ""),
      lastUpdatedTimestamp: String(entry.updatedAt || entry.createdAt || entry.savedAt || ""),
      blueprintId: String(entry.blueprintId || entry.hash || ""),
      blueprintHash: String(entry.hash || entry.blueprintHash || ""),
      imageUrl: String(entry.imageUrl || entry.image || entry.png || ""),
      eligibilityStatus: entry.ascensionBlueprint ? "eligible" : "",
      dataSourceUsed: "ascension-blueprints-store",
      snapshotTimestamp: timestamp,
      sourceIndex: index,
    };
    for (const [key, label] of TRAIT_EXPORT_ORDER) row[label] = traitValue(traits, key);
    const rowWarnings: string[] = [];
    if (!wallet) rowWarnings.push("invalid wallet");
    if (!row.blueprintId && !row.blueprintHash) rowWarnings.push("missing blueprint ID/hash");
    if (!row.imageUrl) rowWarnings.push("missing blueprint image");
    row.validationStatus = rowWarnings.length ? "warning" : "verified";
    row.validationNotes = rowWarnings.join("; ");
    return row;
  });

  const validVersions = versions.filter((row) => row.wallet);
  const byWallet = new Map<string, Array<Record<string, unknown>>>();
  for (const row of validVersions) {
    const wallet = String(row.wallet);
    const bucket = byWallet.get(wallet) || [];
    bucket.push(row);
    byWallet.set(wallet, bucket);
  }

  const rows = Array.from(byWallet.entries()).map(([wallet, bucket]) => {
    bucket.sort((a, b) => blueprintTimestamp(a as Record<string, any>) - blueprintTimestamp(b as Record<string, any>));
    const latest = { ...bucket[bucket.length - 1] };
    latest.versionCount = bucket.length;
    latest.allBlueprintIds = bucket.map((row) => String(row.blueprintId || row.blueprintHash || "")).filter(Boolean).join(", ");
    if (bucket.length > 1) {
      latest.validationStatus = rowStatus([latest.validationStatus as "verified" | "warning" | "failed", "warning"]);
      latest.validationNotes = [latest.validationNotes, `duplicate wallet records found; latest selected from ${bucket.length} versions`].filter(Boolean).join("; ");
      warnings.push(`${wallet} has ${bucket.length} stored Blueprint records; latest timestamp selected for CSV.`);
    }
    return latest;
  }).sort((a, b) => String(a.wallet).localeCompare(String(b.wallet)));

  const invalidCount = versions.length - validVersions.length;
  if (invalidCount > 0) warnings.push(`${invalidCount} Blueprint record${invalidCount === 1 ? "" : "s"} had invalid or missing wallets and were excluded from latest-wallet exports.`);

  return {
    rows,
    versions,
    warnings,
    rawCount: blueprints.length,
    invalidCount,
    duplicateWalletCount: rows.filter((row) => Number(row.versionCount || 0) > 1).length,
  };
}

async function generateSnapshots(input?: {
  wallets: Set<string>;
  tokenIds: Set<string>;
  tokenOwners?: Map<string, string>;
  discovery: ReturnType<typeof readDiscoveryInput>;
  warnings: string[];
}) {
  const timestamp = new Date().toISOString();
  const rpcUrl = snapshotRpcUrl();
  const provider = new ethers.JsonRpcProvider(rpcUrl, CHAIN_ID);
  const stakingAddress = ethers.getAddress(readEnv("ASCENSION_STAKING_ADDRESS", "ASCENSION_STAKING_CONTRACT", "NEXT_PUBLIC_ASCENSION_STAKING_CONTRACT") || DEFAULT_ASCENSION_STAKING);
  const nftAddress = ethers.getAddress(readEnv("DYOOR_S1_CONTRACT", "NEXT_PUBLIC_DYOOR_S1_CONTRACT") || DEFAULT_DYOOR_S1);
  const energyBankAddress = ethers.getAddress(readEnv("ENERGY_BANK_ADDRESS", "NEXT_PUBLIC_ENERGY_BANK_ADDRESS") || DEFAULT_ENERGY_BANK);
  const staking = new ethers.Contract(stakingAddress, stakingAbi, provider);
  const nft = new ethers.Contract(nftAddress, erc721Abi, provider);
  const energyBank = new ethers.Contract(energyBankAddress, energyBankAbi, provider);
  const blueprints = await readBlueprints() as Array<Record<string, any>>;
  const harvestLedger = await readHarvestLedger();
  const blueprintSnapshot = blueprintRows(blueprints, timestamp);
  const blueprint = blueprintSnapshot.rows;
  const discovered = input || await discoverStakingWallets(provider, stakingAddress, nftAddress);
  const warnings = [...discovered.warnings, ...blueprintSnapshot.warnings];
  const discoveryRecord = discovered.discovery as { scanMode?: string; latestBlock?: number };
  const discoveryMode = String(discoveryRecord.scanMode || "");
  const snapshotBlock = typeof discoveryRecord.latestBlock === "number" && Number.isSafeInteger(discoveryRecord.latestBlock) && discoveryRecord.latestBlock > 0
    ? discoveryRecord.latestBlock
    : await safeContract(async () => await provider.getBlockNumber(), 0);
  const indexedTokenSource = discoveryMode === "ownerOf"
    ? "ownerOf-staking-contract"
    : discoveryMode === "goldsky-events"
      ? "goldsky-events"
      : "transfer-log-ownerOf";
  const ascendedTokenOwners = new Map<string, string>();
  const tokenMetaById = new Map<string, StakeTokenMeta>();
  const walletSet = new Set<string>(blueprint.map((row) => String(row.wallet)));
  const hasIndexedOwners = Boolean(input?.tokenOwners?.size);
  const finalizeConcurrency = hasIndexedOwners
    ? readWholeNumberEnv(["ASCENSION_SNAPSHOT_INDEXED_FINALIZE_CONCURRENCY", "ASCENSION_SNAPSHOT_FINALIZE_CONCURRENCY"], DEFAULT_INDEXED_FINALIZE_CONCURRENCY)
    : readWholeNumberEnv(["ASCENSION_SNAPSHOT_FINALIZE_CONCURRENCY"], DEFAULT_FINALIZE_CONCURRENCY);
  const stakingContractBalance = Number(await safeContract(async () => await nft.balanceOf(stakingAddress, snapshotBlock ? { blockTag: snapshotBlock } : {}), 0n));
  const candidateTokenIds = normalizeTokenIdList([
    ...Array.from(discovered.tokenIds),
    ...Array.from(input?.tokenOwners?.keys() || []),
  ]);

  const activeTokenRows = await mapLimit(candidateTokenIds, finalizeConcurrency, async (tokenId) => {
    if (discoveryMode !== "owner-enumerable") {
      const currentOwner = normalizeAddress(await safeContract(async () => await nft.ownerOf(BigInt(tokenId), snapshotBlock ? { blockTag: snapshotBlock } : {}), ""));
      if (currentOwner !== stakingAddress.toLowerCase()) return null;
    }
    const indexedOwner = input?.tokenOwners?.get(tokenId) || "";
    const meta = await tokenStakeMeta(staking, tokenId, indexedOwner, snapshotBlock || undefined);
    return meta;
  });

  const missingOwnerRows = activeTokenRows.filter((row): row is StakeTokenMeta => Boolean(row && !row.wallet));
  if (missingOwnerRows.length) {
    const fallback = await scanTransferEvidence(provider, stakingAddress, nftAddress, new Set(missingOwnerRows.map((row) => row.tokenId)), rpcUrl, snapshotBlock);
    warnings.push(...fallback.warnings);
    let resolved = 0;
    for (const row of missingOwnerRows) {
      const evidence = fallback.depositsByToken.get(row.tokenId);
      if (!evidence?.fallbackWallet) continue;
      row.wallet = evidence.fallbackWallet;
      row.source = "transfer-log-fallback";
      row.validationStatus = "warning";
      row.depositTxHash = evidence.depositTxHash;
      row.depositBlock = evidence.depositBlock;
      row.validationNotes = "Deposited into the staking contract but stakeInfo did not return a registered staker; latest Transfer into staking contract was used for depositor address.";
      resolved += 1;
    }
    if (resolved < missingOwnerRows.length) {
      warnings.push(`Transfer fallback resolved ${resolved} of ${missingOwnerRows.length} token owner${missingOwnerRows.length === 1 ? "" : "s"} missing from stakeInfo.`);
    }
  }

  const unregisteredTokenIds: string[] = [];
  for (const row of activeTokenRows) {
    if (!row) continue;
    tokenMetaById.set(row.tokenId, row);
    ascendedTokenOwners.set(row.tokenId, row.wallet);
    if (row.wallet) {
      walletSet.add(row.wallet);
    } else {
      unregisteredTokenIds.push(row.tokenId);
    }
  }
  if (unregisteredTokenIds.length) {
    const preview = unregisteredTokenIds.slice(0, 20).map((tokenId) => `#${tokenId}`).join(", ");
    const hiddenCount = unregisteredTokenIds.length > 20 ? `, plus ${unregisteredTokenIds.length - 20} more` : "";
    warnings.push(`${unregisteredTokenIds.length} currently deposited S1 token(s) are not registered in stakeInfo and are exported under Pending / Unregistered Deposits: ${preview}${hiddenCount}.`);
  }

  const indexedTokenIdsByWallet = new Map<string, string[]>();
  for (const [tokenId, wallet] of ascendedTokenOwners.entries()) {
    if (!wallet) continue;
    const tokenIds = indexedTokenIdsByWallet.get(wallet) || [];
    tokenIds.push(tokenId);
    indexedTokenIdsByWallet.set(wallet, tokenIds);
  }

  const blueprintWallets = new Set(blueprint.map((item) => String(item.wallet)));
  const stakingRows = (await mapLimit(Array.from(walletSet), finalizeConcurrency, (wallet) => (
    stakingRow(wallet, staking, energyBank, harvestLedger, timestamp, indexedTokenIdsByWallet.get(wallet) || [], tokenMetaById)
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
      stakedAt: tokenMetaById.get(tokenId)?.stakedAt || "",
      stakedAtRaw: tokenMetaById.get(tokenId)?.stakedAtRaw || "",
      depositTxHash: tokenMetaById.get(tokenId)?.depositTxHash || "",
      depositBlock: tokenMetaById.get(tokenId)?.depositBlock || "",
      stakedCountForWallet: stake?.stakedCount || "",
      pendingEnergy: stake?.pendingEnergy || "0",
      pendingEnergyRaw: stake?.pendingEnergyRaw || "0",
      harvestedEnergy: stake?.harvestedEnergy || "",
      harvestedEnergyRaw: stake?.harvestedEnergyRaw || "0",
      lifetimeEnergy: stake?.lifetimeEnergy || "0",
      lifetimeEnergyRaw: stake?.lifetimeEnergyRaw || "0",
      energyBank: stake?.energyBank || "0",
      energyBankRaw: stake?.energyBankRaw || "0",
      nftContract: nftAddress.toLowerCase(),
      stakingContract: stakingAddress.toLowerCase(),
      dataSourceUsed: source,
      validationStatus: wallet ? tokenMetaById.get(tokenId)?.validationStatus || "verified" : "warning",
      validationNotes: tokenMetaById.get(tokenId)?.validationNotes || "",
      snapshotTimestamp: timestamp,
    });
  }

  for (const row of stakingRows) {
    for (const tokenId of row.tokenIds || []) {
      const tokenIdString = String(tokenId);
      addAscendedS1Row(tokenIdString, row.wallet, tokenMetaById.get(tokenIdString)?.source || (ascendedTokenOwners.has(tokenIdString) ? indexedTokenSource : "staking-wallet-read"));
    }
  }
  for (const [tokenId, wallet] of ascendedTokenOwners.entries()) {
    if (!ascendedS1ByToken.has(tokenId)) addAscendedS1Row(tokenId, wallet, wallet ? indexedTokenSource : "ownerOf-unregistered");
  }

  const ascendedS1 = Array.from(ascendedS1ByToken.values())
    .sort((a, b) => compareNumericStrings(String(a.tokenId || "0"), String(b.tokenId || "0")));
  const unregisteredDeposits = ascendedS1
    .filter((row) => String(row.wallet || "") === "unregistered" || String(row.tokenIdSource || "").includes("unregistered") || String(row.tokenIdSource || "") === "transfer-log-fallback")
    .map((row) => ({
      tokenId: row.tokenId,
      wallet: row.wallet,
      depositorWallet: row.wallet === "unregistered" ? "" : row.wallet,
      currentOwner: stakingAddress.toLowerCase(),
      needsRegistration: "yes",
      recoveryFunction: "stakeDeposited(uint256[])",
      tokenIdSource: row.tokenIdSource,
      depositTxHash: row.depositTxHash || "",
      depositBlock: row.depositBlock || "",
      nftContract: nftAddress.toLowerCase(),
      stakingContract: stakingAddress.toLowerCase(),
      dataSourceUsed: "S1 ownerOf(tokenId)+Ascension stakeInfo(tokenId)",
      validationStatus: "warning",
      snapshotTimestamp: timestamp,
    }));
  const blueprintByWallet = new Map(blueprint.map((row) => [String(row.wallet), row]));
  const combined = Array.from(new Set([...stakingByWallet.keys(), ...blueprintByWallet.keys()])).sort().map((wallet) => {
    const stake = stakingByWallet.get(wallet);
    const bp = blueprintByWallet.get(wallet);
    return {
      wallet,
      stakedCount: stake?.stakedCount || 0,
      ascended: stake?.ascended ? "yes" : "no",
      staked: stake?.ascended ? "yes" : "no",
      savedBlueprint: bp ? "yes" : "no",
      stakedTokenIds: stake?.stakedTokenIds || "",
      blueprintId: bp?.blueprintId || "",
      blueprintHash: bp?.blueprintHash || "",
      blueprintImage: bp?.imageUrl || "",
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
      energyBank: stake?.energyBank || "0",
      eligibilityStatus: bp?.eligibilityStatus || "",
      snapshotTimestamp: timestamp,
      validationStatus: rowStatus([
        stake?.validationStatus === "warning" ? "warning" : "verified",
        bp?.validationStatus === "warning" ? "warning" : "verified",
      ]),
    };
  });
  const stakedWallets = stakingRows.filter((row) => row.stakedCount > 0);
  const stakedWalletSet = new Set(stakedWallets.map((row) => row.wallet));
  const blueprintWalletSet = new Set(blueprint.map((row) => String(row.wallet)));
  const combinedWalletSet = new Set(combined.map((row) => String(row.wallet)));
  const duplicateTokenCount = candidateTokenIds.length - new Set(candidateTokenIds).size;
  const validationChecks: SnapshotValidationCheck[] = [
    {
      scope: "staking",
      label: "Owner scan matches staking contract balance",
      status: ascendedS1.length === stakingContractBalance ? "pass" : "fail",
      detail: `ownerOf verified ${ascendedS1.length} staked token ID(s); S1 balanceOf(staking contract) reports ${stakingContractBalance}.`,
    },
    {
      scope: "staking",
      label: "No duplicate token IDs",
      status: duplicateTokenCount === 0 ? "pass" : "fail",
      detail: duplicateTokenCount === 0 ? "No duplicate token IDs found." : `${duplicateTokenCount} duplicate token ID(s) were present before normalization.`,
    },
    {
      scope: "staking",
      label: "No staked wallet has zero tokens",
      status: stakedWallets.every((row) => row.stakedCount > 0 && row.tokenIds.length > 0) ? "pass" : "warning",
      detail: stakedWallets.every((row) => row.stakedCount > 0 && row.tokenIds.length > 0)
        ? "Every staked wallet row has at least one verified token ID."
        : "At least one staking row used a balance fallback without verified token IDs.",
    },
    {
      scope: "blueprint",
      label: "Latest blueprint rows are wallet-unique",
      status: blueprint.length === blueprintWalletSet.size ? "pass" : "fail",
      detail: `${blueprint.length} latest Blueprint row(s), ${blueprintWalletSet.size} unique wallet(s).`,
    },
    {
      scope: "blueprint",
      label: "Blueprint source records parsed",
      status: blueprintSnapshot.invalidCount === 0 ? "pass" : "warning",
      detail: `${blueprintSnapshot.rawCount} source Blueprint record(s), ${blueprintSnapshot.invalidCount} invalid wallet record(s).`,
    },
    {
      scope: "combined",
      label: "Combined snapshot includes both source sets",
      status: combinedWalletSet.size === new Set([...stakedWalletSet, ...blueprintWalletSet]).size ? "pass" : "fail",
      detail: `${combinedWalletSet.size} combined wallet row(s) from staking and Blueprint sources.`,
    },
  ];
  if (blueprint.some((row) => row.validationStatus !== "verified")) {
    validationChecks.push({
      scope: "blueprint",
      label: "Blueprint records have complete metadata",
      status: "warning",
      detail: "One or more Blueprint records are missing image or ID/hash metadata; wallet and traits are still exported.",
    });
  }
  if (activeTokenRows.some((row) => row && row.validationStatus !== "verified")) {
    validationChecks.push({
      scope: "staking",
      label: "All active tokens have registered stakers",
      status: "warning",
      detail: unregisteredDeposits.length
        ? `${unregisteredDeposits.length} currently deposited token ID(s) are missing stakeInfo registration and are exported separately.`
        : "One or more currently staked token IDs required indexed-owner fallback.",
    });
  }
  const validation = validationSummary(validationChecks);
  const totals = {
    walletsFound: combined.length,
    totalStaked: Math.max(stakingRows.reduce((sum, row) => sum + Number(row.stakedCount || 0), 0), ascendedS1.length),
    totalAscendedS1: ascendedS1.length,
    ascendedS1Wallets: new Set(ascendedS1.map((row) => String(row.wallet)).filter((wallet) => wallet.startsWith("0x"))).size,
    unregisteredDeposits: unregisteredDeposits.length,
    totalBlueprintsSaved: blueprint.length,
    totalBlueprintSourceRecords: blueprintSnapshot.rawCount,
    walletsWithBoth: combined.filter((row) => row.staked === "yes" && row.savedBlueprint === "yes").length,
    walletsStakedNoBlueprint: combined.filter((row) => row.staked === "yes" && row.savedBlueprint !== "yes").length,
    walletsBlueprintNoStake: combined.filter((row) => row.staked !== "yes" && row.savedBlueprint === "yes").length,
    stakingContractBalance,
  };
  const dataSources = {
    staking: indexedTokenSource,
    stakingAuthority: "S1 ownerOf(tokenId) equals Ascension staking contract",
    stakerAssignment: "Ascension stakeInfo(tokenId)",
    blueprint: "Netlify Blob ascension-blueprints/ascension-blueprints.json with local file fallback",
    energy: "Energy Bank contract reads plus harvest ledger blob/local fallback",
  };
  const fileNames = snapshotFilenames(timestamp);
  const historyEntry = {
    generatedAt: timestamp,
    validationStatus: validation.status,
    totals,
    dataSources,
    fileNames,
  };
  const exportHistory = await appendSnapshotHistory(historyEntry);

  const allWarnings = Array.from(new Set([...warnings, ...validation.warnings]))
    .filter((warning) => !(ascendedS1.length === stakingContractBalance && isTransientSnapshotWarning(warning)));

  return {
    ok: true,
    generatedAt: timestamp,
    verified: validation.verified,
    validation,
    totals,
    staking: stakingRows,
    ascendedS1,
    unregisteredDeposits,
    blueprints: blueprint,
    blueprintVersions: blueprintSnapshot.versions,
    combined,
    discovery: discovered.discovery,
    contracts: {
      chainId: CHAIN_ID,
      s1: nftAddress.toLowerCase(),
      ascensionStaking: stakingAddress.toLowerCase(),
      energyBank: energyBankAddress.toLowerCase(),
    },
    dataSources,
    fileNames,
    exportHistory,
    warnings: allWarnings,
  };
}

async function finalizeSnapshotFromBody(body: Record<string, unknown>) {
  const discoveredWallets = normalizeAddressList(body.discoveredWallets);
  const discoveredTokenIds = normalizeTokenIdList(body.discoveredTokenIds);
  const tokenOwners = normalizeTokenOwnerMap(body.tokenOwners);
  const incomingDiscovery = readDiscoveryInput(body.discovery);
  const incomingWarnings = Array.from(new Set(readStringArray(body.warnings))).slice(0, 40);
  if (incomingDiscovery.scanMode === "ownerOf" && incomingDiscovery.maxTokenId && incomingDiscovery.lastScannedTokenId !== incomingDiscovery.maxTokenId) {
    const discoveredCount = new Set([...discoveredTokenIds, ...tokenOwners.keys()]).size;
    const contractBalance = incomingDiscovery.stakingContractBalance || 0;
    const scanReachedKnownBalance = contractBalance > 0 && discoveredCount >= contractBalance;
    if (!scanReachedKnownBalance) {
      throw Object.assign(new Error("Snapshot collection is not complete. Regenerate the snapshot before exporting."), { status: 409 });
    }
  }
  if (incomingDiscovery.scanMode === "owner-enumerable" && incomingDiscovery.stakingContractBalance) {
    const discoveredCount = new Set([...discoveredTokenIds, ...tokenOwners.keys()]).size;
    const lastScannedIndex = incomingDiscovery.lastScannedIndex ?? -1;
    const maxIndex = incomingDiscovery.maxIndex ?? incomingDiscovery.stakingContractBalance - 1;
    const scanReachedKnownBalance = discoveredCount >= incomingDiscovery.stakingContractBalance;
    if (!scanReachedKnownBalance && lastScannedIndex < maxIndex) {
      throw Object.assign(new Error("Snapshot collection is not complete. Regenerate the snapshot before exporting."), { status: 409 });
    }
  }
  for (const [tokenId, wallet] of tokenOwners.entries()) {
    discoveredTokenIds.push(tokenId);
    discoveredWallets.push(wallet);
  }
  const finalTokenIds = normalizeTokenIdList(discoveredTokenIds);
  const finalWallets = normalizeAddressList(discoveredWallets);
  if ((incomingDiscovery.scanMode === "ownerOf" || incomingDiscovery.scanMode === "owner-enumerable") && incomingDiscovery.stakingContractBalance && finalTokenIds.length !== incomingDiscovery.stakingContractBalance) {
    throw Object.assign(new Error(`Exact S1 owner scan found ${finalTokenIds.length} token ID${finalTokenIds.length === 1 ? "" : "s"}, but the S1 contract reports ${incomingDiscovery.stakingContractBalance} NFTs at the staking contract. Reset and rescan before exporting.`), { status: 409 });
  }
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
  const stakingAddress = normalizeAddress(readEnv("ASCENSION_STAKING_ADDRESS", "ASCENSION_STAKING_CONTRACT", "NEXT_PUBLIC_ASCENSION_STAKING_CONTRACT") || DEFAULT_ASCENSION_STAKING);
  const nftAddress = normalizeAddress(readEnv("DYOOR_S1_CONTRACT", "NEXT_PUBLIC_DYOOR_S1_CONTRACT") || DEFAULT_DYOOR_S1);
  const energyBankAddress = normalizeAddress(readEnv("ENERGY_BANK_ADDRESS", "NEXT_PUBLIC_ENERGY_BANK_ADDRESS") || DEFAULT_ENERGY_BANK);
  return json(200, {
    ok: true,
    connected: Boolean(wallet),
    authorized: Boolean(wallet && wallet === owner),
    backendStatus: "ok",
    snapshotSystemStatus: stakingAddress && nftAddress ? "ready" : "contract-config-missing",
    chainId: CHAIN_ID,
    contracts: {
      s1: nftAddress,
      ascensionStaking: stakingAddress,
      energyBank: energyBankAddress,
    },
    dataSources: {
      staking: "exact S1 ownership + Ascension staking metadata",
      blueprint: "ascension-blueprints store",
      energy: "Energy Bank contract + harvest ledger",
    },
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const mode = String(body.mode || "full");
    await verifyAdmin(body, "snapshot", {
      windowMs: 15 * 60 * 1000,
      consumeNonce: mode !== "discover",
    });
    if (mode === "discover") {
      return json(200, serialize(await discoverSnapshotPage(body)) as Record<string, unknown>);
    }
    if (mode === "finalize") {
      return json(200, serialize(await finalizeSnapshotFromBody(body)) as Record<string, unknown>);
    }
    return json(400, {
      ok: false,
      error: "Use the paged ownerOf discovery and finalize flow for verified snapshots.",
    });
  } catch (error: any) {
    return json(Number(error?.status || 500), { ok: false, error: error?.message || "Admin snapshot failed." });
  }
}
