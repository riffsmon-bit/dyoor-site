import { ethers } from "ethers";
import { createMonadReadProvider } from "@/lib/monad-rpc";
import { DEFAULT_TREASURY_WALLET, dyoorS2Contract } from "@/lib/contracts/addresses";
import {
  S2_GUARANTEED_TRAITS,
  S2_RECYCLABLE_TRAITS,
  S2_REMOVABLE_TRAITS,
  S2_TRAIT_LAB_FLAT_UNLOCK_COST,
  S2_TRAIT_LAB_DROID_BURN_REWARD_ENERGY,
  S2_TRAIT_LAB_REROLL_ALL_COST,
  S2_TRAIT_LAB_RECYCLE_REWARDS,
  S2_TRAIT_LAB_SPECIAL_MAX_ACTIVE_SUPPLY,
  S2_TRAIT_LAB_TOKEN_COOLDOWN_MS,
  S2_UNLOCKABLE_TRAITS,
} from "@/lib/s2-trait-lab-config";
import {
  traitLabLeaderboardEnabled,
} from "@/lib/s2-trait-lab-leaderboard";
import { traitBountyEngineEnabled } from "@/lib/s2-trait-bounties";

const ERC721_ABI = [
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
  "function balanceOf(address owner) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function totalMinted() view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenOfOwnerByIndex(address owner,uint256 index) view returns (uint256)",
];

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");
const DEFAULT_MONAD_MAINNET_RPC_URL = "https://rpc.monad.xyz";
const DEFAULT_MONAD_MAINNET_EXPLORER_URL = "https://monadscan.com";
const DEFAULT_ETHERSCAN_V2_API_URL = "https://api.etherscan.io/v2/api";
const DEFAULT_S2_DEPLOYMENT_BLOCK = 87616887;
const SERVERLESS_LOG_SPAN = 25_000;
const MIN_OWNED_TOKEN_LOG_SPAN = 10_000;
const OWNED_TOKEN_CACHE_VERSION = "s2-owned-v11";
const DEFAULT_OWNER_OF_CONCURRENCY = 4;
const ALCHEMY_TRANSFER_PAGE_SIZE = "0x3e8";

const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
const ownedTokenCache = new Map<string, { tokenIds: string[]; expiresAt: number }>();

function readEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function optionalAddress(value: unknown) {
  try {
    return ethers.getAddress(String(value || ""));
  } catch {
    return "";
  }
}

function traitLabTreasuryWallet() {
  const value = readEnv(
    "DYOOR_TRAIT_LAB_TREASURY_WALLET",
    "NEXT_PUBLIC_DYOOR_TRAIT_LAB_TREASURY_WALLET",
    "TREASURY_WALLET",
    "NEXT_PUBLIC_TREASURY_WALLET",
    "DYOOR_TREASURY",
    "DYOOR_TREASURY_ADDRESS",
  ) || DEFAULT_TREASURY_WALLET;
  const address = optionalAddress(value);
  if (!address) throw Object.assign(new Error("Trait Lab treasury wallet is not configured."), { status: 500 });
  return address;
}

function configuredS2ChainId() {
  return 143;
}

function isTestnetLikeUrl(value: string) {
  return /testnet/i.test(value);
}

function firstUsableRpc(names: string[], mainnet: boolean) {
  for (const name of names) {
    const value = readEnv(name);
    if (!value) continue;
    if (mainnet && isTestnetLikeUrl(value)) {
      throw Object.assign(new Error(`${name} points to a testnet RPC; Trait Lab requires Monad mainnet.`), { status: 500 });
    }
    return value;
  }
  return "";
}

function configuredS2RpcUrl() {
  return firstUsableRpc(
    ["DYOOR_S2_RPC_URL", "MONAD_RPC_URL", "NEXT_PUBLIC_DYOOR_S2_RPC_URL", "RPC_URL", "ALCHEMY_MONAD_RPC_URL", "NEXT_PUBLIC_MONAD_RPC_URL"],
    true,
  ) || DEFAULT_MONAD_MAINNET_RPC_URL;
}

function configuredS2PublicRpcUrl() {
  return DEFAULT_MONAD_MAINNET_RPC_URL;
}

function isAlchemyLikeUrl(value: string) {
  return /alchemy/i.test(value);
}

function configuredS2LogRpcUrl() {
  const explicit = firstUsableRpc(
    ["DYOOR_S2_LOG_RPC_URL", "MONAD_LOG_RPC_URL", "NEXT_PUBLIC_DYOOR_S2_LOG_RPC_URL", "NEXT_PUBLIC_MONAD_LOG_RPC_URL"],
    true,
  );
  if (explicit) return explicit;

  for (const name of ["DYOOR_S2_RPC_URL", "MONAD_RPC_URL", "NEXT_PUBLIC_DYOOR_S2_RPC_URL", "RPC_URL"]) {
    const value = readEnv(name);
    if (!value || isAlchemyLikeUrl(value)) continue;
    if (isTestnetLikeUrl(value)) {
      throw Object.assign(new Error(`${name} points to a testnet RPC; Trait Lab requires Monad mainnet.`), { status: 500 });
    }
    return value;
  }

  return DEFAULT_MONAD_MAINNET_RPC_URL;
}

function configuredS2ExplorerUrl() {
  const configured = readEnv("NEXT_PUBLIC_DYOOR_S2_EXPLORER_URL");
  if (configured && isTestnetLikeUrl(configured)) {
    throw Object.assign(new Error("Trait Lab explorer configuration must use Monad mainnet."), { status: 500 });
  }
  if (configured) return configured.replace(/\/+$/, "");
  return DEFAULT_MONAD_MAINNET_EXPLORER_URL;
}

function configuredExplorerApiKey() {
  return readEnv("MONADSCAN_API_KEY", "ETHERSCAN_API_KEY", "ETHERSCAN_V2_API_KEY", "DYOOR_S2_EXPLORER_API_KEY");
}

function configuredExplorerApiUrl() {
  const configured = readEnv("ETHERSCAN_V2_API_URL", "MONADSCAN_V2_API_URL", "DYOOR_S2_EXPLORER_API_URL");
  return configured ? configured.replace(/\/+$/, "") : DEFAULT_ETHERSCAN_V2_API_URL;
}

function traitLabTokenCooldownMs() {
  const raw = readEnv("DYOOR_TRAIT_LAB_TOKEN_COOLDOWN_MS", "NEXT_PUBLIC_DYOOR_TRAIT_LAB_TOKEN_COOLDOWN_MS");
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : S2_TRAIT_LAB_TOKEN_COOLDOWN_MS;
}

function traitLabDroidBurnEnabled() {
  const configured = readEnv("DYOOR_TRAIT_LAB_ENABLE_DROID_BURN", "NEXT_PUBLIC_DYOOR_TRAIT_LAB_ENABLE_DROID_BURN");
  if (/^(0|false|no|off|disabled)$/i.test(configured)) return false;
  if (/^(1|true|yes|on|enabled)$/i.test(configured)) return true;
  return true;
}

function traitLabDroidBurnRewardEnergy() {
  const raw = readEnv("DYOOR_TRAIT_LAB_DROID_BURN_REWARD_ENERGY", "NEXT_PUBLIC_DYOOR_TRAIT_LAB_DROID_BURN_REWARD_ENERGY");
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : S2_TRAIT_LAB_DROID_BURN_REWARD_ENERGY;
}

function parsePositiveInt(value: string, fallback: number) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function ownerOfConcurrency() {
  const configured = readEnv("DYOOR_S2_OWNER_OF_CONCURRENCY", "NEXT_PUBLIC_DYOOR_S2_OWNER_OF_CONCURRENCY");
  return Math.min(20, Math.max(1, parsePositiveInt(configured, DEFAULT_OWNER_OF_CONCURRENCY)));
}

function alchemyTransferLookupEnabled() {
  const configured = readEnv("DYOOR_S2_ENABLE_ALCHEMY_TRANSFERS", "NEXT_PUBLIC_DYOOR_S2_ENABLE_ALCHEMY_TRANSFERS");
  if (/^(1|true|yes|on)$/i.test(configured)) return true;
  if (/^(0|false|no|off)$/i.test(configured)) return false;
  return false;
}

function enumerableOwnershipEnabled() {
  const configured = readEnv("DYOOR_S2_ERC721_ENUMERABLE", "NEXT_PUBLIC_DYOOR_S2_ERC721_ENUMERABLE");
  return /^(1|true|yes|on)$/i.test(configured);
}

let readProvider: ethers.FallbackProvider | null = null;
let transferProvider: ethers.JsonRpcProvider | null = null;

function provider() {
  const rpcUrl = configuredS2RpcUrl();
  if (!rpcUrl) {
    throw Object.assign(new Error("DYOOR_S2_RPC_URL or MONAD_RPC_URL is required before Trait Lab can verify ownership."), { status: 500 });
  }
  if (!readProvider) readProvider = createMonadReadProvider();
  return readProvider;
}

function alchemyProvider() {
  const rpcUrl = readEnv("ALCHEMY_MONAD_RPC_URL", "NEXT_PUBLIC_MONAD_RPC_URL");
  if (!isAlchemyLikeUrl(rpcUrl)) {
    throw new Error("Alchemy transfer lookup is enabled without an Alchemy RPC URL.");
  }
  if (!transferProvider) {
    transferProvider = new ethers.JsonRpcProvider(rpcUrl, configuredS2ChainId(), {
      staticNetwork: true,
    });
  }
  return transferProvider;
}

function logProvider() {
  return new ethers.JsonRpcProvider(configuredS2LogRpcUrl(), configuredS2ChainId());
}

function s2ContractAddress() {
  if (!dyoorS2Contract) {
    throw Object.assign(new Error("DYOOR_S2_CONTRACT_ADDRESS or NEXT_PUBLIC_DYOOR_S2_CONTRACT_ADDRESS is required before Trait Lab can be enabled."), { status: 500 });
  }
  return dyoorS2Contract;
}

function s2Contract() {
  return new ethers.Contract(s2ContractAddress(), ERC721_ABI, provider());
}

function topicAddress(address: string) {
  return ethers.zeroPadValue(address, 32);
}

function hexQuantity(value: number) {
  return `0x${Math.max(0, Math.floor(value)).toString(16)}`;
}

function tokenIdFromAssetTransfer(transfer: Record<string, unknown>) {
  const rawContract = transfer.rawContract as Record<string, unknown> | undefined;
  const value = transfer.tokenId ?? transfer.erc721TokenId ?? rawContract?.tokenId;
  try {
    return BigInt(String(value || "")).toString();
  } catch {
    return "";
  }
}

async function alchemyAssetTransfers(
  rpcProvider: ethers.JsonRpcProvider,
  params: Record<string, unknown>,
) {
  const transfers: Array<Record<string, unknown>> = [];
  let pageKey = "";

  for (let page = 0; page < 50; page += 1) {
    const response = await rpcProvider.send("alchemy_getAssetTransfers", [{
      ...params,
      ...(pageKey ? { pageKey } : {}),
    }]) as { transfers?: Array<Record<string, unknown>>; pageKey?: string };
    transfers.push(...(Array.isArray(response?.transfers) ? response.transfers : []));
    pageKey = String(response?.pageKey || "");
    if (!pageKey) break;
  }

  return transfers;
}

async function getLogsWithSplit(
  rpcProvider: ethers.JsonRpcProvider,
  filter: ethers.Filter,
  fromBlock: number,
  toBlock: number,
): Promise<ethers.Log[]> {
  if (fromBlock > toBlock) return [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await rpcProvider.getLogs({ ...filter, fromBlock, toBlock });
    } catch (error) {
      if (!isTransientOwnerReadError(error) || attempt >= 3) {
        if (fromBlock === toBlock) throw error;
        const mid = Math.floor((fromBlock + toBlock) / 2);
        const left = await getLogsWithSplit(rpcProvider, filter, fromBlock, mid);
        const right = await getLogsWithSplit(rpcProvider, filter, mid + 1, toBlock);
        return left.concat(right);
      }
      await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
    }
  }
  return [];
}

async function ownedTokensFromEnumerable(contract: ethers.Contract, wallet: string, balance: number) {
  const tokenIds: string[] = [];
  for (let index = 0; index < balance; index += 1) {
    const tokenId = await contract.tokenOfOwnerByIndex(wallet, BigInt(index));
    tokenIds.push(BigInt(tokenId).toString());
  }
  return tokenIds;
}

function isTransientOwnerReadError(error: unknown) {
  const message = String((error as { shortMessage?: string; message?: string })?.shortMessage || (error as Error)?.message || "");
  return /429|timeout|timed out|rate|coalesce|missing revert data|network|server|fetch|ECONN/i.test(message);
}

async function ownerOfToken(contract: ethers.Contract, tokenId: number, attempts = 3) {
  let transient = false;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const owner = normalizeWallet(await contract.ownerOf(BigInt(tokenId)));
      if (owner) return { owner, transient: false };
    } catch (error) {
      transient = transient || isTransientOwnerReadError(error);
    }
    if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 125 * (attempt + 1)));
  }
  return { owner: "", transient };
}

async function balanceOfWallet(contract: ethers.Contract, wallet: string, attempts = 3) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const balance = Number(await contract.balanceOf(wallet));
      if (Number.isFinite(balance) && balance >= 0) return balance;
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
  }

  const message = isTransientOwnerReadError(lastError)
    ? "Could not read Season 2 wallet balance from Monad RPC. Wait a moment and refresh."
    : "Could not read Season 2 wallet balance.";
  throw Object.assign(new Error(message), { status: 503 });
}

async function verifyCandidateTokenIds(
  contract: ethers.Contract,
  wallet: string,
  candidateIds: Iterable<string>,
  expectedBalance = 0,
) {
  const candidates = Array.from(new Set(candidateIds))
    .filter(Boolean)
    .sort((a, b) => Number(a) - Number(b));
  const verified: string[] = [];
  const concurrency = Math.max(1, Math.min(12, ownerOfConcurrency()));

  for (let start = 0; start < candidates.length; start += concurrency) {
    const batch = candidates.slice(start, start + concurrency);
    const owners = await Promise.all(batch.map(async (tokenId) => {
      const result = await ownerOfToken(contract, Number(tokenId), 3);
      return { tokenId, ...result };
    }));
    for (const item of owners) {
      if (item.owner === wallet) verified.push(item.tokenId);
    }
    if (expectedBalance > 0 && verified.length >= expectedBalance) break;
  }

  return verified;
}

async function ownedTokensFromAlchemyTransfers(contract: ethers.Contract, wallet: string, balance: number) {
  if (!alchemyTransferLookupEnabled()) return [];
  const rpcProvider = alchemyProvider();
  const baseParams = {
    fromBlock: hexQuantity(DEFAULT_S2_DEPLOYMENT_BLOCK),
    toBlock: "latest",
    contractAddresses: [s2ContractAddress()],
    category: ["erc721"],
    withMetadata: false,
    excludeZeroValue: false,
    maxCount: ALCHEMY_TRANSFER_PAGE_SIZE,
    order: "asc",
  };
  const [incoming, outgoing] = await Promise.all([
    alchemyAssetTransfers(rpcProvider, { ...baseParams, toAddress: wallet }),
    alchemyAssetTransfers(rpcProvider, { ...baseParams, fromAddress: wallet }),
  ]);
  const candidates = incoming.concat(outgoing).map(tokenIdFromAssetTransfer).filter(Boolean);
  if (!candidates.length) return [];
  return verifyCandidateTokenIds(contract, wallet, candidates, balance);
}

function tokenIdFromExplorerTransfer(transfer: Record<string, unknown>) {
  try {
    return BigInt(String(transfer.tokenID ?? transfer.tokenId ?? "")).toString();
  } catch {
    return "";
  }
}

function explorerTransferOrder(transfer: Record<string, unknown>) {
  const blockNumber = Number(transfer.blockNumber || 0);
  const transactionIndex = Number(transfer.transactionIndex || 0);
  const logIndex = Number(transfer.logIndex || 0);
  return { blockNumber, transactionIndex, logIndex };
}

async function ownedTokensFromExplorerTransfers(contract: ethers.Contract, wallet: string, balance: number) {
  const apiKey = configuredExplorerApiKey();
  if (!apiKey) return [];

  const transfers: Array<Record<string, unknown>> = [];
  const pageSize = 1000;
  for (let page = 1; page <= 20; page += 1) {
    const url = new URL(configuredExplorerApiUrl());
    url.searchParams.set("chainid", String(configuredS2ChainId()));
    url.searchParams.set("module", "account");
    url.searchParams.set("action", "tokennfttx");
    url.searchParams.set("address", wallet);
    url.searchParams.set("contractaddress", s2ContractAddress());
    url.searchParams.set("page", String(page));
    url.searchParams.set("offset", String(pageSize));
    url.searchParams.set("sort", "asc");
    url.searchParams.set("apikey", apiKey);

    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Explorer ownership lookup failed with status ${response.status}.`);
    const payload = await response.json() as { status?: string; message?: string; result?: unknown };
    if (!Array.isArray(payload.result)) {
      if (payload.status === "0" && /no transactions found/i.test(String(payload.result || payload.message || ""))) break;
      throw new Error(String(payload.result || payload.message || "Explorer ownership lookup failed."));
    }

    transfers.push(...payload.result as Array<Record<string, unknown>>);
    if (payload.result.length < pageSize) break;
  }

  if (!transfers.length) return [];

  transfers.sort((a, b) => {
    const left = explorerTransferOrder(a);
    const right = explorerTransferOrder(b);
    if (left.blockNumber !== right.blockNumber) return left.blockNumber - right.blockNumber;
    if (left.transactionIndex !== right.transactionIndex) return left.transactionIndex - right.transactionIndex;
    return left.logIndex - right.logIndex;
  });

  const tokenIds = new Set<string>();
  for (const transfer of transfers) {
    const tokenId = tokenIdFromExplorerTransfer(transfer);
    if (!tokenId) continue;
    const from = normalizeWallet(transfer.from);
    const to = normalizeWallet(transfer.to);
    if (to === wallet) tokenIds.add(tokenId);
    if (from === wallet) tokenIds.delete(tokenId);
  }

  if (!tokenIds.size) return [];
  return verifyCandidateTokenIds(contract, wallet, tokenIds, balance);
}

async function ownedTokensFromTransferLogs(contract: ethers.Contract, wallet: string, balance = 0) {
  const rpcProvider = logProvider();
  const latest = await rpcProvider.getBlockNumber();
  const startBlock = Math.max(
    0,
    parsePositiveInt(readEnv("DYOOR_S2_START_BLOCK", "NEXT_PUBLIC_DYOOR_S2_START_BLOCK"), DEFAULT_S2_DEPLOYMENT_BLOCK),
  );
  const configuredChunk = readEnv(
    "DYOOR_S2_OWNED_TOKEN_LOG_CHUNK_SIZE",
    "NEXT_PUBLIC_DYOOR_S2_OWNED_TOKEN_LOG_CHUNK_SIZE",
    "DYOOR_S2_LOG_CHUNK_SIZE",
    "NEXT_PUBLIC_DYOOR_S2_LOG_CHUNK_SIZE",
  );
  const chunkSize = Math.max(
    MIN_OWNED_TOKEN_LOG_SPAN,
    parsePositiveInt(configuredChunk, SERVERLESS_LOG_SPAN),
  );
  const changes: Array<{ tokenId: string; owns: boolean; blockNumber: number; logIndex: number }> = [];

  for (let fromBlock = startBlock; fromBlock <= latest; fromBlock += chunkSize) {
    const toBlock = Math.min(latest, fromBlock + chunkSize - 1);
    const incoming = await getLogsWithSplit(rpcProvider, {
      address: s2ContractAddress(),
      topics: [TRANSFER_TOPIC, null, topicAddress(wallet)],
    }, fromBlock, toBlock);
    const outgoing = await getLogsWithSplit(rpcProvider, {
      address: s2ContractAddress(),
      topics: [TRANSFER_TOPIC, topicAddress(wallet), null],
    }, fromBlock, toBlock);

    for (const log of incoming) {
      const tokenId = BigInt(log.topics[3] || "0").toString();
      changes.push({ tokenId, owns: true, blockNumber: Number(log.blockNumber || 0), logIndex: Number(log.index || 0) });
    }
    for (const log of outgoing) {
      const tokenId = BigInt(log.topics[3] || "0").toString();
      changes.push({ tokenId, owns: false, blockNumber: Number(log.blockNumber || 0), logIndex: Number(log.index || 0) });
    }
  }

  changes.sort((a, b) => a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber - b.blockNumber);
  const tokenIds = new Set<string>();
  for (const change of changes) {
    if (change.owns) tokenIds.add(change.tokenId);
    else tokenIds.delete(change.tokenId);
  }

  return verifyCandidateTokenIds(contract, wallet, tokenIds, balance);
}

function ownerScanOrder(maxSupply: number) {
  const firstWindow = Math.min(250, maxSupply);
  const tailStart = Math.max(firstWindow + 1, maxSupply - 250 + 1);
  const tokenIds: number[] = [];
  const seen = new Set<number>();

  function add(tokenId: number) {
    if (tokenId >= 1 && tokenId <= maxSupply && !seen.has(tokenId)) {
      seen.add(tokenId);
      tokenIds.push(tokenId);
    }
  }

  for (let tokenId = 1; tokenId <= firstWindow; tokenId += 1) add(tokenId);
  for (let tokenId = tailStart; tokenId <= maxSupply; tokenId += 1) add(tokenId);
  for (let tokenId = firstWindow + 1; tokenId < tailStart; tokenId += 1) add(tokenId);

  return tokenIds;
}

async function ownedTokensFromOwnerScan(contract: ethers.Contract, wallet: string, maxSupply: number, expectedBalance = 0) {
  const tokenIds: string[] = [];
  const concurrency = ownerOfConcurrency();
  const transientFailures: number[] = [];
  const scanOrder = ownerScanOrder(maxSupply);

  async function scanBatch(batch: number[], attempts: number) {
    const owners = await Promise.all(batch.map(async (tokenId) => {
      const result = await ownerOfToken(contract, tokenId, attempts);
      return { tokenId, ...result };
    }));
    for (const item of owners) {
      if (item.owner === wallet) tokenIds.push(String(item.tokenId));
      else if (!item.owner && item.transient) transientFailures.push(item.tokenId);
    }
  }

  for (let start = 0; start < scanOrder.length; start += concurrency) {
    const batch = scanOrder.slice(start, start + concurrency);
    await scanBatch(batch, 4);
    if (expectedBalance > 0 && tokenIds.length >= expectedBalance) return tokenIds;
  }

  if (expectedBalance > 0 && tokenIds.length < expectedBalance && transientFailures.length > 0) {
    const retryTokenIds = Array.from(new Set(transientFailures));
    const retryConcurrency = Math.max(1, Math.min(8, concurrency));
    for (let start = 0; start < retryTokenIds.length; start += retryConcurrency) {
      await scanBatch(retryTokenIds.slice(start, start + retryConcurrency), 4);
      if (tokenIds.length >= expectedBalance) return tokenIds;
    }
  }

  return tokenIds;
}

async function ownedTokenScanMax(contract: ethers.Contract, configuredMaxSupply: number, balance = 0) {
  const envMax = parsePositiveInt(readEnv("DYOOR_S2_OWNED_TOKEN_SCAN_MAX", "NEXT_PUBLIC_DYOOR_S2_OWNED_TOKEN_SCAN_MAX"), 0);
  if (envMax > 0) return envMax;

  const chainValues = await Promise.all([
    contract.totalSupply().catch(() => 0n),
    contract.totalMinted().catch(() => 0n),
  ]);
  const chainMax = Math.max(...chainValues.map((value) => Number(value || 0n)).filter(Number.isFinite));
  if (chainMax > 0) return chainMax;

  const balanceBound = Number.isFinite(balance) && balance > 0 ? Math.max(100, Math.ceil(balance * 4)) : configuredMaxSupply;
  return Math.min(configuredMaxSupply, balanceBound);
}

export function normalizeWallet(value: unknown) {
  try {
    const address = ethers.getAddress(String(value || "")).toLowerCase();
    return address === ZERO_ADDRESS ? "" : address;
  } catch {
    return "";
  }
}

export function assertTraitLabRateLimit(key: string, limit = 20, windowMs = 60_000) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (bucket.count >= limit) {
    throw Object.assign(new Error("Too many Trait Lab requests. Wait a moment and try again."), { status: 429 });
  }
  bucket.count += 1;
}

export function traitLabPublicConfig() {
  const chainId = configuredS2ChainId();
  const configuredChainName = readEnv("DYOOR_S2_CHAIN_NAME", "NEXT_PUBLIC_DYOOR_S2_CHAIN_NAME");
  const safeChainName = !configuredChainName || /testnet/i.test(configuredChainName) ? "Monad" : configuredChainName;
  return {
    ok: true,
    treasuryWallet: traitLabTreasuryWallet(),
    contractAddress: s2ContractAddress(),
    chainId,
    chainHex: chainId > 0 ? `0x${chainId.toString(16)}` : "",
    chainName: safeChainName,
    rpcUrl: configuredS2PublicRpcUrl(),
    explorerUrl: configuredS2ExplorerUrl(),
    flatUnlockCostEnergy: S2_TRAIT_LAB_FLAT_UNLOCK_COST,
    rerollAllCostEnergy: S2_TRAIT_LAB_REROLL_ALL_COST,
    specialMaxActiveSupply: S2_TRAIT_LAB_SPECIAL_MAX_ACTIVE_SUPPLY,
    tokenCooldownMs: traitLabTokenCooldownMs(),
    droidBurnEnabled: traitLabDroidBurnEnabled(),
    droidBurnRewardEnergy: traitLabDroidBurnRewardEnergy(),
    rerollSettlementMode: "server-ledger",
    rerollRequiresTransaction: false,
    leaderboardEnabled: traitLabLeaderboardEnabled(),
    bountyEnabled: traitBountyEngineEnabled(),
    guaranteedTraits: S2_GUARANTEED_TRAITS,
    unlockableTraits: S2_UNLOCKABLE_TRAITS,
    removableTraits: S2_REMOVABLE_TRAITS,
    recyclableTraits: S2_RECYCLABLE_TRAITS,
    recycleRewards: S2_TRAIT_LAB_RECYCLE_REWARDS,
  };
}

export async function ownedS2TokenIds(wallet: string, maxSupply: number) {
  const cacheKey = `${OWNED_TOKEN_CACHE_VERSION}:${s2ContractAddress().toLowerCase()}:${wallet}:${maxSupply}`;
  const cached = ownedTokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return [...cached.tokenIds];

  const contract = s2Contract();
  const balance = await balanceOfWallet(contract, wallet);
  const tokenIds = new Set<string>();

  if (Number.isFinite(balance) && balance <= 0) {
    ownedTokenCache.set(cacheKey, { tokenIds: [], expiresAt: Date.now() + 120_000 });
    return [];
  }

  function done() {
    return Number.isFinite(balance) && balance > 0 && tokenIds.size >= balance;
  }

  function sortedResult() {
    return Array.from(tokenIds).sort((a, b) => Number(a) - Number(b));
  }

  // The production S2 contract does not implement tokenOfOwnerByIndex. Calling
  // it through a multi-provider RPC pool can spend the whole serverless budget
  // waiting for matching revert responses, so enumeration is strictly opt-in.
  if (Number.isFinite(balance) && balance > 0 && enumerableOwnershipEnabled()) {
    try {
      for (const tokenId of await ownedTokensFromEnumerable(contract, wallet, balance)) tokenIds.add(tokenId);
      if (done()) {
        const sorted = sortedResult();
        ownedTokenCache.set(cacheKey, { tokenIds: sorted, expiresAt: Date.now() + 120_000 });
        return sorted;
      }
    } catch {}
  }

  try {
    for (const tokenId of await ownedTokensFromAlchemyTransfers(contract, wallet, balance)) tokenIds.add(tokenId);
    if (done()) {
      const sorted = sortedResult();
      ownedTokenCache.set(cacheKey, { tokenIds: sorted, expiresAt: Date.now() + 120_000 });
      return sorted;
    }
  } catch {}

  try {
    for (const tokenId of await ownedTokensFromExplorerTransfers(contract, wallet, balance)) tokenIds.add(tokenId);
    if (done()) {
      const sorted = sortedResult();
      ownedTokenCache.set(cacheKey, { tokenIds: sorted, expiresAt: Date.now() + 120_000 });
      return sorted;
    }
  } catch {}

  try {
    for (const tokenId of await ownedTokensFromTransferLogs(contract, wallet, balance)) tokenIds.add(tokenId);
    if (done()) {
      const sorted = sortedResult();
      ownedTokenCache.set(cacheKey, { tokenIds: sorted, expiresAt: Date.now() + 120_000 });
      return sorted;
    }
  } catch {}

  const scanMax = await ownedTokenScanMax(contract, maxSupply, balance);
  try {
    for (const tokenId of await ownedTokensFromOwnerScan(contract, wallet, scanMax, balance)) tokenIds.add(tokenId);
    if (done()) {
      const sorted = sortedResult();
      ownedTokenCache.set(cacheKey, { tokenIds: sorted, expiresAt: Date.now() + 120_000 });
      return sorted;
    }
  } catch {}

  const sorted = sortedResult();
  if (!Number.isFinite(balance) || balance <= 0 || sorted.length >= balance) {
    ownedTokenCache.set(cacheKey, { tokenIds: sorted, expiresAt: Date.now() + 120_000 });
  }
  if (Number.isFinite(balance) && balance > 0 && sorted.length < balance) {
    throw Object.assign(
      new Error(`Could only verify ${sorted.length} of ${balance} owned Season 2 droids. Monad RPC is behind or rate-limited; refresh in a moment.`),
      { status: 503 },
    );
  }
  return sorted;
}
