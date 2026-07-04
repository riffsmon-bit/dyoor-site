import fs from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { ethers } from "ethers";

loadEnv({ path: ".env.local", override: false, quiet: true });
loadEnv({ path: ".env", override: false, quiet: true });

const CHAIN_ID = 143n;
const DEFAULT_RPC = "https://rpc.monad.xyz";
const DEFAULT_TRANSFER_RPC = "https://143.rpc.thirdweb.com";
const DEFAULT_S1_CONTRACT = "0x2c79c9e233fea4b4dcfe6561d9209dc292cd932f";
const DEFAULT_STAKING_CONTRACT = "0xf9611226c1CcCcCa37951938d6f358D3d5106549";
const DEFAULT_START_BLOCK = 54_985_442;
const DEFAULT_MAX_TOKEN_ID = 1111;
const DEFAULT_OUTPUT_CSV = "exports/dyoor-s1-airdrop-wallets-staked-count.csv";
const DEFAULT_OUT_DIR = "data/snapshots";
const DEFAULT_OVERRIDE_PATH = "data/ascension-depositor-overrides.json";
const DEFAULT_TRANSFER_EVIDENCE_PATH = "data/ascension-transfer-evidence-to-staking.json";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const GOLDSKY_PAGE_SIZE = 1000;

const ERC721_ABI = [
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
  "function balanceOf(address owner) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
];

const STAKING_ABI = [
  "function stakeInfo(uint256 tokenId) view returns (address owner,uint64 stakedAt)",
  "event Staked(address indexed user,uint256 indexed tokenId)",
  "event Staked(address indexed user,uint256[] tokenIds)",
  "event Stake(address indexed user,uint256 indexed tokenId)",
  "event Stake(address indexed user,uint256[] tokenIds)",
  "event Deposited(address indexed user,uint256 indexed tokenId)",
  "event Deposited(address indexed user,uint256[] tokenIds)",
  "event Deposit(address indexed user,uint256 indexed tokenId)",
  "event Deposit(address indexed user,uint256[] tokenIds)",
  "event TokenStaked(address indexed user,uint256 indexed tokenId)",
  "event NFTStaked(address indexed user,uint256 indexed tokenId)",
  "event Ascended(address indexed user,uint256 indexed tokenId)",
  "event Registered(address indexed user,uint256 indexed tokenId)",
  "event Unstaked(address indexed user,uint256 indexed tokenId)",
  "event Unstaked(address indexed user,uint256[] tokenIds)",
  "event Withdrawn(address indexed user,uint256 indexed tokenId)",
  "event Withdrawn(address indexed user,uint256[] tokenIds)",
  "event Withdraw(address indexed user,uint256 indexed tokenId)",
  "event Withdraw(address indexed user,uint256[] tokenIds)",
  "event TokenUnstaked(address indexed user,uint256 indexed tokenId)",
  "event NFTUnstaked(address indexed user,uint256 indexed tokenId)",
  "event Departed(address indexed user,uint256 indexed tokenId)",
  "event PointsClaimed(address indexed user,uint256 amount)",
];

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function readEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function readNumber(value, fallback) {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function readPositiveNumber(value, fallback) {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeAddress(value) {
  try {
    return ethers.getAddress(String(value || "")).toLowerCase();
  } catch {
    return "";
  }
}

function compareTokenIds(a, b) {
  const left = BigInt(a);
  const right = BigInt(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

function csvEscape(value) {
  const text = Array.isArray(value) ? value.join(" ") : String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows, columns) {
  return [
    columns.map((column) => csvEscape(column.label)).join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column.key])).join(",")),
  ].join("\n") + "\n";
}

function timestampForFile(date = new Date()) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}-${hh}${min}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorText(error) {
  return String(error?.shortMessage || error?.reason || error?.message || error?.error?.message || error || "");
}

async function retry(label, task, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await sleep(500 * attempt);
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${errorText(lastError)}`);
}

async function withTimeout(task, timeoutMs, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await task(controller.signal);
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`${label} timed out after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function promiseTimeout(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }).catch((error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function mapWithConcurrency(items, concurrency, task) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await task(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()));
  return results;
}

function topicAddress(topic) {
  return normalizeAddress(`0x${String(topic || "").slice(-40)}`);
}

function tokenTopic(tokenId) {
  return ethers.zeroPadValue(ethers.toBeHex(BigInt(tokenId)), 32);
}

function eventOrdinal(id) {
  const suffix = String(id || "").split("-").pop();
  const value = Number(suffix);
  return Number.isFinite(value) ? value : 0;
}

function eventBlock(event) {
  const value = Number(event.block_number || event.blockNumber || 0);
  return Number.isFinite(value) ? value : 0;
}

function sortEvents(events) {
  return events.sort((a, b) => {
    const blockDiff = eventBlock(a) - eventBlock(b);
    if (blockDiff) return blockDiff;
    const ordinalDiff = eventOrdinal(a.id) - eventOrdinal(b.id);
    if (ordinalDiff) return ordinalDiff;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
}

function applyStateEvent(active, event, source) {
  const tokenId = String(event.tokenId || event.token || "").trim();
  const wallet = normalizeAddress(event.user || event.wallet || event.owner || event.staker || event.depositor);
  if (!/^\d+$/.test(tokenId)) return;
  if (event.kind === "unstake") {
    active.delete(tokenId);
    return;
  }
  if (!wallet) return;
  active.set(tokenId, {
    tokenId,
    wallet,
    source,
    blockNumber: eventBlock(event),
    txHash: String(event.transactionHash_ || event.transactionHash || event.id || "").split("-")[0].toLowerCase(),
    logIndex: eventOrdinal(event.id),
  });
}

async function fetchGoldskyEntity(endpoint, field, snapshotBlock) {
  const rows = [];
  const where = snapshotBlock ? ", where: { block_number_lte: $snapshotBlock }" : "";
  const variables = snapshotBlock ? { snapshotBlock: String(snapshotBlock) } : {};

  for (let skip = 0; skip < 100_000; skip += GOLDSKY_PAGE_SIZE) {
    const query = `
      query DyoorS1Events($snapshotBlock: BigInt) {
        ${field}(first: ${GOLDSKY_PAGE_SIZE}, skip: ${skip}${where}, orderBy: block_number, orderDirection: asc) {
          id
          block_number
          transactionHash_
          user
          tokenId
        }
      }
    `;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) throw new Error(`Goldsky ${field} HTTP ${response.status}`);
    const payload = await response.json();
    if (payload?.errors?.length) throw new Error(`Goldsky ${field} query failed: ${JSON.stringify(payload.errors)}`);
    const batch = Array.isArray(payload?.data?.[field]) ? payload.data[field] : [];
    rows.push(...batch);
    if (batch.length < GOLDSKY_PAGE_SIZE) break;
  }
  return rows;
}

async function readGoldskyState(snapshotBlock) {
  const endpoint = readEnv("GOLDSKY_SUBGRAPH_URL", "NEXT_PUBLIC_GOLDSKY_SUBGRAPH_URL", "ASCENSION_GOLDSKY_SUBGRAPH_URL");
  if (!endpoint) return { active: new Map(), events: [], source: "none", warning: "Goldsky subgraph env is missing." };

  const [staked, unstaked] = await Promise.all([
    fetchGoldskyEntity(endpoint, "stakeds", snapshotBlock),
    fetchGoldskyEntity(endpoint, "unstakeds", snapshotBlock),
  ]);
  const active = new Map();
  const events = sortEvents([
    ...staked.map((event) => ({ ...event, kind: "stake" })),
    ...unstaked.map((event) => ({ ...event, kind: "unstake" })),
  ]);
  for (const event of events) applyStateEvent(active, event, "goldsky-staking-events");

  return {
    active,
    events,
    source: "goldsky:stakeds+unstakeds",
    warning: "",
  };
}

function parsedKind(name) {
  const normalized = String(name || "").toLowerCase();
  if (/(unstak|withdraw|depart)/.test(normalized)) return "unstake";
  if (/(stake|deposit|ascend|register)/.test(normalized)) return "stake";
  return "";
}

function eventWallet(parsed) {
  const candidates = [];
  parsed.fragment.inputs.forEach((input, index) => {
    if (input.type !== "address") return;
    const name = String(input.name || "").toLowerCase();
    const value = normalizeAddress(parsed.args[index]);
    if (!value || value === ZERO_ADDRESS) return;
    const score = /(user|wallet|owner|staker|depositor|account)/.test(name) ? 0 : 1;
    candidates.push({ value, score });
  });
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0]?.value || "";
}

function eventTokenIds(parsed) {
  const ids = new Set();
  parsed.fragment.inputs.forEach((input, index) => {
    const name = String(input.name || "").toLowerCase();
    const value = parsed.args[index];
    if (!/^uint/.test(input.type) && !/^uint/.test(input.arrayChildren?.type || "")) return;
    if (!/(token|nft|id)/.test(name)) return;
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      try {
        ids.add(BigInt(item).toString());
      } catch {}
    }
  });
  return Array.from(ids);
}

function parseStakingLog(log, iface) {
  let parsed;
  try {
    parsed = iface.parseLog(log);
  } catch {
    return [];
  }
  const kind = parsedKind(parsed.name);
  if (!kind || parsed.name === "PointsClaimed") return [];
  const wallet = eventWallet(parsed);
  const tokenIds = eventTokenIds(parsed);
  return tokenIds.map((tokenId) => ({
    kind,
    tokenId,
    user: wallet,
    blockNumber: Number(BigInt(log.blockNumber)),
    id: `${String(log.transactionHash || "").toLowerCase()}-${Number(BigInt(log.logIndex || "0x0"))}`,
    transactionHash: String(log.transactionHash || "").toLowerCase(),
  }));
}

async function rawRpcGetLogs({ rpcUrl, filter, timeoutMs, headers = {} }) {
  return await withTimeout(async (signal) => {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getLogs",
        params: [filter],
      }),
      signal,
    });
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(text.slice(0, 160));
    }
    if (payload.error) throw new Error(payload.error.message || JSON.stringify(payload.error));
    return Array.isArray(payload.result) ? payload.result : [];
  }, timeoutMs, `eth_getLogs ${filter.fromBlock}-${filter.toBlock}`);
}

async function scanRawStakingEvents({ rpcUrl, stakingAddress, fromBlock, toBlock, chunkSize, timeoutMs, headers }) {
  const iface = new ethers.Interface(STAKING_ABI);
  const active = new Map();
  const events = [];
  let logsScanned = 0;

  for (let from = fromBlock; from <= toBlock; from += chunkSize) {
    const to = Math.min(toBlock, from + chunkSize - 1);
    const logs = await rawRpcGetLogs({
      rpcUrl,
      filter: {
        address: stakingAddress,
        fromBlock: ethers.toQuantity(from),
        toBlock: ethers.toQuantity(to),
      },
      timeoutMs,
      headers,
    });
    logsScanned += logs.length;
    for (const log of logs) {
      events.push(...parseStakingLog(log, iface));
    }
    if (logs.length) console.log(`staking logs ${from}-${to}: ${logs.length}`);
  }

  for (const event of sortEvents(events)) applyStateEvent(active, event, "raw-staking-events");
  return { active, events, logsScanned };
}

async function scanAlchemyTransfers({ rpcUrl, nftAddress, stakingAddress, fromBlock, toBlock }) {
  const byToken = new Map();
  let pageKey = "";
  let requestCount = 0;
  let transferCount = 0;

  do {
    const params = {
      fromBlock: ethers.toQuantity(fromBlock),
      toBlock: ethers.toQuantity(toBlock),
      toAddress: stakingAddress,
      contractAddresses: [nftAddress],
      category: ["erc721"],
      withMetadata: false,
      excludeZeroValue: false,
      maxCount: "0x3e8",
      order: "asc",
    };
    if (pageKey) params.pageKey = pageKey;

    const result = await retry("alchemy_getAssetTransfers", async () => {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "alchemy_getAssetTransfers",
          params: [params],
        }),
      });
      const payload = await response.json();
      if (payload.error) throw new Error(payload.error.message || JSON.stringify(payload.error));
      return payload.result || {};
    }, 5);

    requestCount += 1;
    const transfers = Array.isArray(result.transfers) ? result.transfers : [];
    transferCount += transfers.length;
    for (const transfer of transfers) {
      const tokenHex = transfer.tokenId || transfer.erc721TokenId;
      if (!tokenHex) continue;
      const tokenId = BigInt(tokenHex).toString();
      const wallet = normalizeAddress(transfer.from);
      if (!wallet || wallet === ZERO_ADDRESS) continue;
      byToken.set(tokenId, {
        tokenId,
        wallet,
        source: "alchemy-asset-transfers",
        blockNumber: transfer.blockNum ? Number(BigInt(transfer.blockNum)) : 0,
        txHash: String(transfer.hash || "").toLowerCase(),
      });
    }
    pageKey = String(result.pageKey || "");
    console.log(`alchemy_getAssetTransfers page ${requestCount}: ${transfers.length}`);
  } while (pageKey);

  return { byToken, transferCount, requestCount };
}

async function scanRawTransferLogs({
  rpcUrl,
  nftAddress,
  stakingAddress,
  fromBlock,
  toBlock,
  chunkSize,
  timeoutMs,
  headers,
  onlyTokenIds,
  maxChunks,
  delayMs,
  initialByToken = new Map(),
  cachePath = "",
  cacheMetadata = {},
}) {
  const transferTopic = ethers.id("Transfer(address,address,uint256)");
  const stakingTopic = ethers.zeroPadValue(ethers.getAddress(stakingAddress), 32);
  const byToken = new Map(initialByToken);
  let chunksScanned = 0;
  let logsScanned = 0;
  const foundWantedCount = () => onlyTokenIds?.size
    ? Array.from(onlyTokenIds).filter((tokenId) => byToken.has(tokenId)).length
    : byToken.size;

  for (let from = fromBlock; from <= toBlock; from += chunkSize) {
    const to = Math.min(toBlock, from + chunkSize - 1);
    chunksScanned += 1;
    if (maxChunks && chunksScanned > maxChunks) break;

    const filter = {
      address: nftAddress,
      fromBlock: ethers.toQuantity(from),
      toBlock: ethers.toQuantity(to),
      topics: [transferTopic, null, stakingTopic],
    };
    const logs = await retry(
      `transfer logs ${from}-${to}`,
      () => rawRpcGetLogs({ rpcUrl, filter, timeoutMs, headers }),
      6
    );
    logsScanned += logs.length;
    for (const log of logs) {
      const tokenId = BigInt(log.topics[3]).toString();
      if (onlyTokenIds?.size && !onlyTokenIds.has(tokenId)) continue;
      byToken.set(tokenId, {
        tokenId,
        wallet: topicAddress(log.topics[1]),
        source: "erc721-transfer-to-staking",
        blockNumber: Number(BigInt(log.blockNumber)),
        txHash: String(log.transactionHash || "").toLowerCase(),
        logIndex: Number(BigInt(log.logIndex || "0x0")),
      });
      if (cachePath) writeTransferEvidenceCache(cachePath, byToken, cacheMetadata);
      if (onlyTokenIds?.size && foundWantedCount() >= onlyTokenIds.size) break;
    }
    if (logs.length || chunksScanned % 500 === 0) {
      const found = onlyTokenIds?.size ? `; found ${foundWantedCount()}/${onlyTokenIds.size}` : "";
      console.log(`transfer logs ${from}-${to}: ${logs.length}; scanned ${chunksScanned}${found}`);
    }
    if (onlyTokenIds?.size && foundWantedCount() >= onlyTokenIds.size) break;
    if (delayMs > 0) await sleep(delayMs);
  }

  return { byToken, logsScanned, chunksScanned };
}

function transferChunkSize(rpcUrl) {
  const configured = readEnv("ASCENSION_TRANSFER_LOG_CHUNK_SIZE", "ASCENSION_LOG_CHUNK_SIZE");
  if (configured) return readPositiveNumber(configured, 1000);
  if (/alchemy\.com/i.test(rpcUrl)) return 10;
  if (/rpc\.monad\.xyz/i.test(rpcUrl)) return 100;
  if (/drpc\.org/i.test(rpcUrl)) return 10_000;
  return 1000;
}

function thirdwebHeaders(rpcUrl) {
  const clientId = readEnv("THIRDWEB_CLIENT_ID", "NEXT_PUBLIC_THIRDWEB_CLIENT_ID");
  return /thirdweb/i.test(rpcUrl) && clientId ? { "x-client-id": clientId } : {};
}

function readOverrides(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const rows = Array.isArray(value)
      ? value.map((row) => [row.tokenId, row.wallet || row.depositor])
      : Object.entries(value || {});
    return new Map(rows.map(([tokenId, wallet]) => [String(tokenId), normalizeAddress(wallet)]).filter(([, wallet]) => wallet));
  } catch {
    return new Map();
  }
}

function readTransferEvidenceCache(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const rows = Array.isArray(value?.transfers) ? value.transfers : [];
    return new Map(rows
      .map((row) => ({
        ...row,
        tokenId: String(row.tokenId || row.token || ""),
        wallet: normalizeAddress(row.wallet),
      }))
      .filter((row) => /^\d+$/.test(row.tokenId) && row.wallet)
      .map((row) => [row.tokenId, row]));
  } catch {
    return new Map();
  }
}

function readTransferEvidenceFile(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const rows = Array.isArray(value?.transfers) ? value.transfers : Array.isArray(value) ? value : [];
    return new Map(rows
      .map((row) => {
        const tokenId = String(row.tokenId || row.token || "");
        const blockNumber = Number(row.blockNumber || row.block || 0);
        return {
          tokenId,
          wallet: normalizeAddress(row.wallet || row.from),
          source: String(row.source || "verified-erc721-transfer-to-staking"),
          blockNumber: Number.isFinite(blockNumber) ? blockNumber : 0,
          txHash: String(row.txHash || row.tx || row.transactionHash || "").toLowerCase(),
          logIndex: Number(row.logIndex ?? row.index ?? 0),
        };
      })
      .filter((row) => /^\d+$/.test(row.tokenId) && row.wallet)
      .map((row) => [row.tokenId, row]));
  } catch {
    return new Map();
  }
}

function writeTransferEvidenceCache(filePath, byToken, metadata = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const transfers = Array.from(byToken.values())
    .sort((a, b) => compareTokenIds(a.tokenId, b.tokenId));
  fs.writeFileSync(filePath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    ...metadata,
    transfers,
  }, null, 2) + "\n", "utf8");
}

async function scanCurrentStakedTokens({ provider, nft, stakingAddress, minTokenId, maxTokenId, blockTag, concurrency }) {
  const tokenIds = Array.from({ length: maxTokenId - minTokenId + 1 }, (_, index) => String(minTokenId + index));
  const staking = normalizeAddress(stakingAddress);
  const staked = [];
  const ownerFailures = [];

  await mapWithConcurrency(tokenIds, concurrency, async (tokenId, index) => {
    try {
      const owner = normalizeAddress(await retry(`ownerOf #${tokenId}`, () => nft.ownerOf(BigInt(tokenId), { blockTag }), 5));
      if (owner === staking) staked.push(tokenId);
    } catch (error) {
      ownerFailures.push({ tokenId, error: errorText(error) });
    }
    if ((index + 1) % 100 === 0 || index + 1 === tokenIds.length) {
      console.log(`ownerOf scan ${index + 1}/${tokenIds.length}; staked found ${staked.length}`);
    }
  });

  staked.sort(compareTokenIds);
  return { stakedTokenIds: staked, ownerFailures };
}

async function readStakeInfo(staking, tokenId, blockTag) {
  const timeoutMs = readPositiveNumber(readEnv("ASCENSION_STAKE_INFO_TIMEOUT_MS", "ASCENSION_SNAPSHOT_RPC_TIMEOUT_MS"), 10_000);
  try {
    const info = await retry(
      `stakeInfo #${tokenId}`,
      () => promiseTimeout(staking.stakeInfo(BigInt(tokenId), { blockTag }), timeoutMs, `stakeInfo #${tokenId}`),
      4
    );
    const wallet = normalizeAddress(info?.owner ?? info?.[0]);
    const stakedAtRaw = String(info?.stakedAt ?? info?.[1] ?? "");
    const stakedAt = stakedAtRaw && stakedAtRaw !== "0" ? new Date(Number(stakedAtRaw) * 1000).toISOString() : "";
    return { wallet: wallet === ZERO_ADDRESS ? "" : wallet, stakedAtRaw, stakedAt, error: "" };
  } catch (error) {
    return { wallet: "", stakedAtRaw: "", stakedAt: "", error: errorText(error) };
  }
}

function groupWallets(tokenRows) {
  const byWallet = new Map();
  for (const row of tokenRows) {
    if (!row.wallet) continue;
    const existing = byWallet.get(row.wallet) || { wallet: row.wallet, stakedCount: 0, tokenIds: [], sources: new Set() };
    existing.stakedCount += 1;
    existing.tokenIds.push(row.tokenId);
    existing.sources.add(row.source);
    byWallet.set(row.wallet, existing);
  }
  return Array.from(byWallet.values())
    .map((row) => ({
      wallet: row.wallet,
      stakedCount: row.stakedCount,
      tokenIds: row.tokenIds.sort(compareTokenIds),
      dataSource: Array.from(row.sources).sort().join("+"),
    }))
    .sort((a, b) => b.stakedCount - a.stakedCount || a.wallet.localeCompare(b.wallet));
}

async function main() {
  const rpcUrl = argValue("rpc", readEnv("ALCHEMY_MONAD_RPC_URL", "NEXT_PUBLIC_MONAD_RPC_URL", "MONAD_RPC_URL", "RPC_URL") || DEFAULT_RPC);
  const transferRpcUrl = argValue("transfer-rpc", readEnv("ASCENSION_TRANSFER_RPC_URL", "DYOOR_S1_TRANSFER_RPC_URL") || (/alchemy\.com/i.test(rpcUrl) ? DEFAULT_TRANSFER_RPC : rpcUrl));
  const nftAddress = ethers.getAddress(argValue("nft", readEnv("DYOOR_S1_CONTRACT", "DYOOR_S1_NFT_ADDRESS", "NEXT_PUBLIC_DYOOR_S1_CONTRACT") || DEFAULT_S1_CONTRACT));
  const stakingAddress = ethers.getAddress(argValue("staking", readEnv("ASCENSION_STAKING_ADDRESS", "ASCENSION_STAKING_CONTRACT", "NEXT_PUBLIC_ASCENSION_STAKING_CONTRACT") || DEFAULT_STAKING_CONTRACT));
  const minTokenId = readNumber(argValue("min-token-id", ""), 1);
  const maxTokenId = readPositiveNumber(argValue("max-token-id", readEnv("DYOOR_S1_MAX_SUPPLY", "NEXT_PUBLIC_DYOOR_S1_MAX_SUPPLY")), DEFAULT_MAX_TOKEN_ID);
  const startBlock = readPositiveNumber(argValue("start-block", readEnv("ASCENSION_START_BLOCK", "NEXT_PUBLIC_DYOOR_S1_START_BLOCK")), DEFAULT_START_BLOCK);
  const outputCsv = argValue("output-csv", readEnv("OUTPUT_CSV") || DEFAULT_OUTPUT_CSV);
  const unresolvedCsv = argValue("unresolved-csv", readEnv("UNRESOLVED_CSV") || outputCsv.replace(/\.csv$/i, "-unresolved.csv"));
  const outDir = argValue("out-dir", DEFAULT_OUT_DIR);
  const overridePath = argValue("override-file", readEnv("ASCENSION_DEPOSITOR_OVERRIDE_FILE") || DEFAULT_OVERRIDE_PATH);
  const concurrency = readPositiveNumber(argValue("concurrency", readEnv("ASCENSION_SNAPSHOT_OWNER_SCAN_CONCURRENCY")), 4);
  const rawTimeoutMs = readPositiveNumber(readEnv("ASCENSION_LOG_TIMEOUT_MS", "ASCENSION_SNAPSHOT_RPC_TIMEOUT_MS"), 12_000);
  const rawChunkSize = readPositiveNumber(argValue("transfer-log-chunk-size", readEnv("ASCENSION_TRANSFER_LOG_CHUNK_SIZE")), transferChunkSize(transferRpcUrl));
  const rawDelayMs = readNumber(argValue("transfer-log-delay-ms", readEnv("ASCENSION_TRANSFER_LOG_DELAY_MS")), /thirdweb/i.test(transferRpcUrl) ? 250 : 0);
  const maxTransferChunks = readNumber(argValue("max-transfer-chunks", readEnv("ASCENSION_TRANSFER_LOG_MAX_CHUNKS")), 0);
  const transferCachePath = argValue("transfer-cache", readEnv("ASCENSION_TRANSFER_CACHE") || path.join(outDir, "s1-transfer-evidence-cache.json"));
  const transferEvidencePath = argValue("transfer-evidence-file", readEnv("ASCENSION_TRANSFER_EVIDENCE_FILE") || DEFAULT_TRANSFER_EVIDENCE_PATH);
  const snapshotBlockInput = argValue("snapshot-block", readEnv("SNAPSHOT_BLOCK"));

  const provider = new ethers.JsonRpcProvider(rpcUrl, Number(CHAIN_ID), { staticNetwork: true, batchMaxCount: 1 });
  const nft = new ethers.Contract(nftAddress, ERC721_ABI, provider);
  const staking = new ethers.Contract(stakingAddress, STAKING_ABI, provider);
  const network = await retry("network check", () => provider.getNetwork(), 3);
  if (network.chainId !== CHAIN_ID) throw new Error(`Wrong RPC network. Expected chain ${CHAIN_ID}, got ${network.chainId}.`);

  const latestBlock = await retry("latest block", () => provider.getBlockNumber(), 4);
  const snapshotBlock = snapshotBlockInput ? readPositiveNumber(snapshotBlockInput, latestBlock) : latestBlock;
  const blockTag = snapshotBlock;
  const stakingContractBalance = Number(await retry("S1 balanceOf staking", () => nft.balanceOf(stakingAddress, { blockTag }), 4));

  console.log("DYOOR S1 airdrop stakedCount snapshot");
  console.log("Snapshot block:", snapshotBlock);
  console.log("S1:", nftAddress);
  console.log("Staking:", stakingAddress);
  console.log("Token ID range:", `${minTokenId}-${maxTokenId}`);
  console.log("S1 balanceOf(staking):", stakingContractBalance);

  const goldsky = await readGoldskyState(snapshotBlock).catch((error) => ({
    active: new Map(),
    events: [],
    source: "goldsky-error",
    warning: errorText(error),
  }));
  if (goldsky.warning) console.log("Goldsky warning:", goldsky.warning);
  console.log("Goldsky active registered tokens:", goldsky.active.size);

  let rawStaking = { active: new Map(), events: [], logsScanned: 0 };
  if (hasFlag("scan-staking-events")) {
    console.log("Scanning raw staking contract logs...");
    rawStaking = await scanRawStakingEvents({
      rpcUrl: transferRpcUrl,
      stakingAddress,
      fromBlock: startBlock,
      toBlock: snapshotBlock,
      chunkSize: rawChunkSize,
      timeoutMs: rawTimeoutMs,
      headers: thirdwebHeaders(transferRpcUrl),
    }).catch((error) => {
      console.log("Raw staking log scan failed:", errorText(error));
      return rawStaking;
    });
    console.log("Raw staking active tokens:", rawStaking.active.size);
  }

  const { stakedTokenIds, ownerFailures } = await scanCurrentStakedTokens({
    provider,
    nft,
    stakingAddress,
    minTokenId,
    maxTokenId,
    blockTag,
    concurrency,
  });

  const mergedEventState = new Map([...goldsky.active, ...rawStaking.active]);
  const missingFromEvents = stakedTokenIds.filter((tokenId) => !mergedEventState.has(tokenId));
  console.log("Current ownerOf staked tokens:", stakedTokenIds.length);
  console.log("Current staked tokens missing event wallet:", missingFromEvents.length);

  let transferEvidence = readTransferEvidenceFile(transferEvidencePath);
  if (transferEvidence.size) console.log("Loaded tracked transfer evidence:", transferEvidence.size, "from", transferEvidencePath);
  const cachedTransferEvidence = readTransferEvidenceCache(transferCachePath);
  if (cachedTransferEvidence.size) {
    transferEvidence = new Map([...transferEvidence, ...cachedTransferEvidence]);
    console.log("Loaded cached transfer evidence:", cachedTransferEvidence.size, "from", transferCachePath);
  }
  if (transferEvidence.size) console.log("Transfer evidence available:", transferEvidence.size);
  if (missingFromEvents.length && !hasFlag("skip-transfer-index")) {
    if (/alchemy\.com/i.test(rpcUrl)) {
      console.log("Trying Alchemy indexed transfer fallback...");
      const result = await scanAlchemyTransfers({ rpcUrl, nftAddress, stakingAddress, fromBlock: startBlock, toBlock: snapshotBlock }).catch((error) => {
        console.log("Alchemy transfer fallback failed:", errorText(error));
        return null;
      });
      if (result) transferEvidence = result.byToken;
    }

    const missingAfterIndexedTransfers = missingFromEvents.filter((tokenId) => !transferEvidence.has(tokenId));
    if (missingAfterIndexedTransfers.length && !hasFlag("skip-raw-transfer-logs")) {
      console.log("Scanning raw ERC721 Transfer logs into staking contract...");
      const result = await scanRawTransferLogs({
        rpcUrl: transferRpcUrl,
        nftAddress,
        stakingAddress,
        fromBlock: startBlock,
        toBlock: snapshotBlock,
        chunkSize: rawChunkSize,
        timeoutMs: rawTimeoutMs,
        headers: thirdwebHeaders(transferRpcUrl),
        onlyTokenIds: new Set(missingAfterIndexedTransfers),
        maxChunks: maxTransferChunks,
        delayMs: rawDelayMs,
        initialByToken: transferEvidence,
        cachePath: transferCachePath,
        cacheMetadata: {
          chainId: Number(CHAIN_ID),
          nftAddress,
          stakingAddress,
          transferRpcUrl,
          fromBlock: startBlock,
          toBlock: snapshotBlock,
        },
      }).catch((error) => {
        console.log("Raw transfer log fallback failed:", errorText(error));
        return null;
      });
      if (result) {
        transferEvidence = new Map([...transferEvidence, ...result.byToken]);
        console.log("Raw transfer logs scanned:", result.chunksScanned, "chunks,", result.logsScanned, "logs.");
      }
    }
  }

  const overrides = readOverrides(overridePath);
  if (overrides.size) console.log("Loaded depositor overrides:", overrides.size, "from", overridePath);

  console.log("Reading stakeInfo fallback for current staked tokens...");
  const stakeInfoFailures = [];
  const tokenRows = await mapWithConcurrency(stakedTokenIds, concurrency, async (tokenId) => {
    const eventRecord = mergedEventState.get(tokenId);
    const transferRecord = transferEvidence.get(tokenId);
    const overrideWallet = overrides.get(tokenId) || "";
    const needsStakeInfo = !eventRecord?.wallet && !transferRecord?.wallet && !overrideWallet;
    const stakeInfo = needsStakeInfo
      ? await readStakeInfo(staking, tokenId, blockTag)
      : { wallet: "", stakedAtRaw: "", stakedAt: "", error: "" };
    if (stakeInfo.error) stakeInfoFailures.push({ tokenId, error: stakeInfo.error });

    const wallet = eventRecord?.wallet || transferRecord?.wallet || stakeInfo.wallet || overrideWallet || "";
    const source = eventRecord?.source
      || transferRecord?.source
      || (stakeInfo.wallet ? "stakeInfo-fallback" : "")
      || (overrideWallet ? "manual-depositor-override" : "")
      || "unresolved";

    return {
      tokenId,
      wallet,
      stakedAt: stakeInfo.stakedAt,
      stakedAtRaw: stakeInfo.stakedAtRaw,
      source,
      eventBlock: eventRecord?.blockNumber || "",
      eventTxHash: eventRecord?.txHash || "",
      transferBlock: transferRecord?.blockNumber || "",
      transferTxHash: transferRecord?.txHash || "",
      validationStatus: wallet ? "verified" : "unresolved",
      validationNotes: wallet ? "" : "Current owner is staking contract, but no staking event, transfer evidence, stakeInfo wallet, or manual depositor override resolved a wallet.",
    };
  });

  const unresolved = tokenRows.filter((row) => !row.wallet).sort((a, b) => compareTokenIds(a.tokenId, b.tokenId));
  const walletRows = groupWallets(tokenRows);
  const attributedTotal = tokenRows.filter((row) => row.wallet).length;
  const verified = ownerFailures.length === 0
    && unresolved.length === 0
    && stakedTokenIds.length === stakingContractBalance
    && attributedTotal === stakingContractBalance;

  const generatedAt = new Date().toISOString();
  const stamp = timestampForFile(new Date(generatedAt));
  const detailWalletCsv = path.join(outDir, `ascended-s1-wallets-${stamp}.csv`);
  const tokenCsv = path.join(outDir, `ascended-s1-tokens-${stamp}.csv`);
  const jsonPath = path.join(outDir, `ascended-s1-snapshot-${stamp}.json`);
  const partialCsv = outputCsv.replace(/\.csv$/i, ".partial.csv");

  fs.mkdirSync(path.dirname(outputCsv), { recursive: true });
  fs.mkdirSync(path.dirname(unresolvedCsv), { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  const airdropRows = walletRows.map((row) => ({
    wallet: row.wallet,
    stakedCount: row.stakedCount,
  }));

  const airdropCsv = toCsv(airdropRows, [
    { key: "wallet", label: "wallet" },
    { key: "stakedCount", label: "stakedCount" },
  ]);

  if (verified || hasFlag("allow-unresolved")) {
    fs.writeFileSync(outputCsv, airdropCsv, "utf8");
  } else {
    fs.writeFileSync(partialCsv, airdropCsv, "utf8");
  }

  fs.writeFileSync(unresolvedCsv, toCsv(unresolved, [
    { key: "tokenId", label: "tokenId" },
    { key: "source", label: "source" },
    { key: "validationNotes", label: "validationNotes" },
  ]), "utf8");

  fs.writeFileSync(detailWalletCsv, toCsv(walletRows, [
    { key: "wallet", label: "wallet" },
    { key: "stakedCount", label: "staked_count" },
    { key: "tokenIds", label: "token_ids" },
    { key: "dataSource", label: "data_source" },
  ]), "utf8");

  fs.writeFileSync(tokenCsv, toCsv(tokenRows.sort((a, b) => compareTokenIds(a.tokenId, b.tokenId)), [
    { key: "tokenId", label: "token_id" },
    { key: "wallet", label: "wallet" },
    { key: "source", label: "data_source" },
    { key: "stakedAt", label: "staked_at" },
    { key: "eventBlock", label: "event_block" },
    { key: "eventTxHash", label: "event_tx_hash" },
    { key: "transferBlock", label: "transfer_block" },
    { key: "transferTxHash", label: "transfer_tx_hash" },
    { key: "validationStatus", label: "validation_status" },
    { key: "validationNotes", label: "validation_notes" },
  ]), "utf8");

  fs.writeFileSync(jsonPath, JSON.stringify({
    generatedAt,
    verified,
    chainId: Number(CHAIN_ID),
    snapshotBlock,
    nftContract: nftAddress,
    stakingContract: stakingAddress,
    tokenIdRange: `${minTokenId}-${maxTokenId}`,
    totalSupplyScanned: maxTokenId - minTokenId + 1,
    stakingContractBalance,
    currentStakedTokenCount: stakedTokenIds.length,
    attributedTotal,
    unresolvedCount: unresolved.length,
    walletCount: walletRows.length,
    dataSources: {
      stakingEvents: goldsky.source,
      rawStakingEvents: hasFlag("scan-staking-events") ? "enabled" : "disabled",
      transferEvidence: transferEvidence.size ? "available" : "none",
      stakeInfoFallback: "enabled",
      manualOverrides: overrides.size ? overridePath : "none",
    },
    ownerFailures,
    stakeInfoFailures,
    unresolved,
    wallets: walletRows,
    tokens: tokenRows.sort((a, b) => compareTokenIds(a.tokenId, b.tokenId)),
  }, null, 2) + "\n", "utf8");

  const top10 = airdropRows.slice(0, 10);
  console.log("");
  console.log("Snapshot complete");
  console.log("Total supply scanned:", maxTokenId - minTokenId + 1);
  console.log("Total tokens currently owned by staking contract:", stakedTokenIds.length);
  console.log("S1 balanceOf(staking):", stakingContractBalance);
  console.log("Total attributed tokens:", attributedTotal);
  console.log("Unresolved count:", unresolved.length);
  console.log("Wallet count:", walletRows.length);
  console.log("Top 10 wallets:");
  top10.forEach((row, index) => console.log(`${index + 1}. ${row.wallet}, ${row.stakedCount}`));
  console.log("Airdrop CSV:", verified || hasFlag("allow-unresolved") ? outputCsv : partialCsv);
  console.log("Unresolved CSV:", unresolvedCsv);
  console.log("Detail wallet CSV:", detailWalletCsv);
  console.log("Token CSV:", tokenCsv);
  console.log("Snapshot JSON:", jsonPath);

  if (!verified && !hasFlag("allow-unresolved")) {
    const tokenList = unresolved.map((row) => row.tokenId).join(", ");
    throw new Error(`Snapshot is not fully attributed. Unresolved token IDs: ${tokenList}`);
  }
}

main().catch((error) => {
  console.error(errorText(error));
  process.exitCode = 1;
});
