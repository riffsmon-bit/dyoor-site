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
const DEFAULT_ASCENSION_START_BLOCK = 54_985_442;
const DEFAULT_ASCENSION_LOG_CHUNK_SIZE = 50_000;
const DEFAULT_DISCOVERY_BATCH_BLOCKS = 500_000;
const DEFAULT_DISCOVERY_BUDGET_MS = 8_000;
const DEFAULT_RPC_TIMEOUT_MS = 7_000;
const DEFAULT_FINALIZE_CONCURRENCY = 4;

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

async function discoverSnapshotPage(body: Record<string, unknown>) {
  const provider = new ethers.JsonRpcProvider(readEnv("MONAD_RPC_URL", "NEXT_PUBLIC_MONAD_RPC_URL") || DEFAULT_RPC, CHAIN_ID);
  const stakingAddress = ethers.getAddress(readEnv("ASCENSION_STAKING_ADDRESS", "ASCENSION_STAKING_CONTRACT", "NEXT_PUBLIC_ASCENSION_STAKING_CONTRACT") || DEFAULT_ASCENSION_STAKING);
  const nftAddress = ethers.getAddress(readEnv("DYOOR_S1_CONTRACT", "NEXT_PUBLIC_DYOOR_S1_CONTRACT") || DEFAULT_DYOOR_S1);
  const latest = await withTimeout(provider.getBlockNumber(), readWholeNumberEnv(["ASCENSION_SNAPSHOT_RPC_TIMEOUT_MS"], DEFAULT_RPC_TIMEOUT_MS));
  const start = Math.min(latest, readWholeNumberEnv(["ASCENSION_START_BLOCK", "NEXT_PUBLIC_DYOOR_S1_START_BLOCK"], DEFAULT_ASCENSION_START_BLOCK, true));
  const configuredBatchBlocks = readWholeNumberEnv(["ASCENSION_SNAPSHOT_BATCH_BLOCKS"], DEFAULT_DISCOVERY_BATCH_BLOCKS);
  const cursor = body.cursor && typeof body.cursor === "object" ? body.cursor as Record<string, unknown> : {};
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

async function stakingRow(wallet: string, staking: ethers.Contract, energyBank: ethers.Contract, harvestLedger: Record<string, { harvestedRaw?: string }>, timestamp: string) {
  const tokenValues = await safeContract(async () => await staking.tokensOfStaker(wallet), null)
    || await safeContract(async () => await staking.getStakedTokens(wallet), null)
    || [];
  const tokenIds = Array.from(new Set((Array.isArray(tokenValues) ? tokenValues : []).map((id) => id.toString()))).sort((a, b) => Number(a) - Number(b));
  const fallbackCount = await safeContract(async () => await staking.stakedBalance(wallet), 0n)
    || await safeContract(async () => await staking.balanceOf(wallet), 0n);
  const pendingRaw = await safeContract(async () => await staking.pendingPoints(wallet), 0n);
  const lifetimeRaw = await safeContract(async () => await energyBank.lifetimeEnergy(wallet), 0n);
  const harvestedRaw = BigInt(String(harvestLedger[wallet.toLowerCase()]?.harvestedRaw || "0"));

  return {
    wallet,
    stakedCount: tokenIds.length || Number(fallbackCount || 0n),
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
  const finalizeConcurrency = readWholeNumberEnv(["ASCENSION_SNAPSHOT_FINALIZE_CONCURRENCY"], DEFAULT_FINALIZE_CONCURRENCY);

  const ascendedOwnerRows = await mapLimit(Array.from(discovered.tokenIds), finalizeConcurrency, async (tokenId) => {
    const currentOwner = normalizeAddress(await safeContract(async () => await nft.ownerOf(BigInt(tokenId)), ""));
    if (currentOwner !== stakingAddress.toLowerCase()) return null;
    const staker = await tokenOwnerFromStakeInfo(staking, tokenId);
    return staker ? { tokenId, staker } : null;
  });
  for (const row of ascendedOwnerRows) {
    if (!row) continue;
    ascendedTokenOwners.set(row.tokenId, row.staker);
    walletSet.add(row.staker);
  }
  for (const wallet of discovered.wallets) walletSet.add(wallet);

  const blueprintWallets = new Set(blueprint.map((item) => String(item.wallet)));
  const stakingRows = (await mapLimit(Array.from(walletSet), finalizeConcurrency, (wallet) => stakingRow(wallet, staking, energyBank, harvestLedger, timestamp)))
    .filter((row) => row.stakedCount > 0 || blueprintWallets.has(row.wallet));
  const stakingByWallet = new Map(stakingRows.map((row) => [row.wallet, row]));
  const ascendedS1ByToken = new Map<string, Record<string, unknown>>();

  function addAscendedS1Row(tokenId: string, wallet: string, source: string) {
    if (!/^\d+$/.test(tokenId) || !wallet) return;
    const stake = stakingByWallet.get(wallet);
    ascendedS1ByToken.set(tokenId, {
      tokenId,
      wallet,
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
    for (const tokenId of row.tokenIds || []) addAscendedS1Row(String(tokenId), row.wallet, "staking-wallet-read");
  }
  for (const [tokenId, wallet] of ascendedTokenOwners.entries()) {
    if (!ascendedS1ByToken.has(tokenId)) addAscendedS1Row(tokenId, wallet, "transfer-log-stakeInfo");
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
      totalStaked: stakingRows.reduce((sum, row) => sum + Number(row.stakedCount || 0), 0),
      totalAscendedS1: ascendedS1.length,
      ascendedS1Wallets: new Set(ascendedS1.map((row) => String(row.wallet))).size,
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
  const incomingDiscovery = readDiscoveryInput(body.discovery);
  const incomingWarnings = Array.from(new Set(readStringArray(body.warnings))).slice(0, 40);
  return generateSnapshots({
    wallets: new Set(discoveredWallets),
    tokenIds: new Set(discoveredTokenIds),
    discovery: {
      ...incomingDiscovery,
      discoveredWallets: discoveredWallets.length,
      discoveredTokenIds: discoveredTokenIds.length,
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
