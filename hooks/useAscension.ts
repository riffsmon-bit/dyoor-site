"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAddress, isAddress, parseAbiItem, type Address } from "viem";
import { ascensionStakingAbi, energyBankAbi, erc721EnumerableAbi } from "@/lib/contracts/abis";
import { ascensionStakingContract, dyoorS1Contract, energyBankContract } from "@/lib/contracts/addresses";
import { createMonadPublicClient, readContractWithFailover, readWithFailover } from "@/lib/rpc";
import { fetchGoldskyStakedTokens } from "@/lib/ascension/goldsky";
import { useWalletService } from "@/providers/WalletServiceProvider";

const MAX_S1_SUPPLY = 1111;
const DEFAULT_S1_START_BLOCK = 54_985_442n;
const OWNER_SCAN_CHUNK_SIZE = 35;
const OWNER_SCAN_CONCURRENCY = 2;
const OWNER_SCAN_ATTEMPTS = 5;
const ENUMERABLE_CONCURRENCY = 8;
const GOLDSKY_TIMEOUT_MS = 3500;
const RECOVERY_SCAN_TIMEOUT_MS = 9000;
const TRANSFER_LOG_CHUNK_SIZE = 50_000n;
const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)");

export type AscensionNft = {
  tokenId: string;
  name: string;
  image: string;
  imageFallbacks: string[];
  source: "wallet" | "ascended";
  metadataStatus: "loaded" | "fallback";
};

export type AscensionState = {
  walletAddress: string;
  walletNfts: AscensionNft[];
  walletUnstakedCount: number;
  ascendedNfts: AscensionNft[];
  ascendedCount: number;
  pendingEnergy: string;
  bankedEnergy: string;
  spendableEnergy: string;
  calculatedBankEnergy: string;
  missingSpendableEnergy: string;
  harvestedEnergy: string;
  lifetimeEnergy: string;
  totalControlled: number;
  isPartial: boolean;
  recovery: AscensionRecoveryState;
  warnings: string[];
  sources: {
    walletBalance: number | null;
    indexedWalletIds: string[];
    ownerScanWalletIds: string[];
    ownerScanStakedIds: string[];
    nftFetchPageCount: number;
    nftFetchSource: string;
    goldskyStakedIds: string[];
    rpcStakedIds: string[];
    rpcStakedCount: number | null;
  };
};

export type AscensionRecoveryCandidate = {
  tokenId: string;
  reason: string;
};

export type AscensionRecoveryState = {
  status: "clear" | "available" | "limited" | "error";
  recoverableTokenIds: string[];
  candidates: AscensionRecoveryCandidate[];
  estimatedTransactions: number;
  message: string;
  source: string;
  timingMs: number;
};

function uniqSorted(values: string[]) {
  return Array.from(new Set(values.filter((value) => /^\d+$/.test(value))))
    .sort((a, b) => Number(a) - Number(b));
}

function sameAddress(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}

function configuredS1StartBlock() {
  try {
    const raw = process.env.NEXT_PUBLIC_DYOOR_S1_START_BLOCK || DEFAULT_S1_START_BLOCK.toString();
    return BigInt(raw);
  } catch {
    return DEFAULT_S1_START_BLOCK;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapLimit<T, R>(items: T[], limit: number, task: (item: T, index: number) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function formatUnits18(raw: bigint) {
  const whole = raw / 10n ** 18n;
  const frac = (raw % 10n ** 18n).toString().padStart(18, "0").slice(0, 2);
  return `${whole.toString()}.${frac}`;
}

function configuredIpfsGateways() {
  const configured = process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL
    || process.env.NEXT_PUBLIC_IPFS_GATEWAY
    || process.env.NEXT_PUBLIC_PINATA_GATEWAY_URL
    || "";
  return [
    configured,
    "https://ipfs.io/ipfs/",
    "https://gateway.pinata.cloud/ipfs/",
    "https://dweb.link/ipfs/",
  ].filter(Boolean).map((gateway) => gateway.endsWith("/") ? gateway : `${gateway}/`);
}

function ipfsPath(uri: string) {
  const trimmed = String(uri || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("ipfs://")) return trimmed.slice("ipfs://".length).replace(/^ipfs\//, "");
  const match = trimmed.match(/\/ipfs\/(.+)$/);
  return match?.[1] || "";
}

function ipfsGatewayUrls(uri: string) {
  const path = ipfsPath(uri);
  if (!path) return uri ? [uri] : [];
  return Array.from(new Set(configuredIpfsGateways().map((gateway) => `${gateway}${path}`)));
}

function normalizeIpfs(uri: string) {
  return ipfsGatewayUrls(uri)[0] || "";
}

async function fetchJsonFromUrls(urls: string[]) {
  let lastError: unknown = null;
  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(url, {
        cache: "force-cache",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) throw new Error(`Metadata HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Metadata unavailable.");
}

function fallbackNft(tokenId: string, source: AscensionNft["source"]): AscensionNft {
  return {
    tokenId,
    source,
    name: `DYOOR #${tokenId}`,
    image: "",
    imageFallbacks: [],
    metadataStatus: "fallback",
  };
}

const tokenMetadataCache = new Map<string, Promise<AscensionNft>>();

export async function fetchTokenMetadata(tokenId: string, source: AscensionNft["source"]): Promise<AscensionNft> {
  const key = `${source}:${tokenId}`;
  const cached = tokenMetadataCache.get(key);
  if (cached) return cached;

  const request = fetchTokenMetadataUncached(tokenId, source);
  tokenMetadataCache.set(key, request);
  return request;
}

async function fetchTokenMetadataUncached(tokenId: string, source: AscensionNft["source"]): Promise<AscensionNft> {
  try {
    let uri = await readContractWithFailover({
      address: dyoorS1Contract,
      abi: erc721EnumerableAbi,
      functionName: "tokenURI",
      args: [BigInt(tokenId)],
      label: `S1 tokenURI #${tokenId}`,
    }) as string;

    if (uri.startsWith("data:application/json;base64,")) {
      const json = JSON.parse(atob(uri.split(",")[1] || ""));
      return {
        tokenId,
        source,
        name: json.name || `DYOOR #${tokenId}`,
        image: normalizeIpfs(json.image || ""),
        imageFallbacks: ipfsGatewayUrls(json.image || ""),
        metadataStatus: "loaded",
      };
    }

    const json = await fetchJsonFromUrls(ipfsGatewayUrls(uri));
    return {
      tokenId,
      source,
      name: json.name || `DYOOR #${tokenId}`,
      image: normalizeIpfs(json.image || ""),
      imageFallbacks: ipfsGatewayUrls(json.image || ""),
      metadataStatus: "loaded",
    };
  } catch {
    return {
      tokenId,
      source,
      name: `DYOOR #${tokenId}`,
      image: "",
      imageFallbacks: [],
      metadataStatus: "fallback",
    };
  }
}

type OwnerScanResult = {
  walletIds: string[];
  stakingContractIds: string[];
  pageCount: number;
};

type WalletTransferScanResult = {
  tokenIds: string[];
  candidateIds: string[];
  pageCount: number;
};

type EnergyRefreshOptions = {
  scanLogs?: boolean;
  scanGrants?: boolean;
};

type EnergyStatsResponse = {
  pendingEnergy?: string;
  harvestedEnergy?: string;
  creditedEnergy?: string;
  incomingTransfersEnergy?: string;
  outgoingTransfersEnergy?: string;
  spentEnergy?: string;
  lifetimeEnergy?: string;
  spendableEnergy?: string;
  bankedEnergy?: string;
  calculatedBankEnergy?: string;
  missingSpendableEnergy?: string;
  harvestEventsFound?: number;
  fromBlock?: string;
  toBlock?: string;
  dataSource?: string;
  energyDebug?: Record<string, unknown>;
};

const clearRecoveryState: AscensionRecoveryState = {
  status: "clear",
  recoverableTokenIds: [],
  candidates: [],
  estimatedTransactions: 0,
  message: "No recovery required.",
  source: "not-scanned",
  timingMs: 0,
};

function limitedRecoveryState(message: string, source = "bounded-scan") {
  return {
    ...clearRecoveryState,
    status: "limited" as const,
    message: formatRecoveryScanMessage(message),
    source,
  };
}

function formatRecoveryScanMessage(message: string) {
  if (/eth_getLogs|block range|range should work|valid request object|RPC Request failed/i.test(message)) {
    return "Automatic recovery scan could not finish on the current RPC. If support provided a token ID, use manual recovery below; it verifies the token on-chain before submitting.";
  }
  return message.length > 160 ? `${message.slice(0, 157)}...` : message;
}

async function scanWalletTransferCandidateIds(wallet: Address) {
  return readWithFailover("S1 wallet Transfer log scan", async (rpcUrl) => {
    const client = createMonadPublicClient(rpcUrl);
    const latest = await client.getBlockNumber();
    const start = configuredS1StartBlock();
    const fromBlock = start > latest ? latest : start;
    const received = new Set<string>();
    const sent = new Set<string>();
    let pageCount = 0;

    async function scanDirection(args: { from?: Address; to?: Address }, target: Set<string>) {
      for (let from = fromBlock; from <= latest; from += TRANSFER_LOG_CHUNK_SIZE) {
        const toBlock = from + TRANSFER_LOG_CHUNK_SIZE - 1n > latest ? latest : from + TRANSFER_LOG_CHUNK_SIZE - 1n;
        const logs = await client.getLogs({
          address: dyoorS1Contract,
          event: TRANSFER_EVENT,
          args,
          fromBlock: from,
          toBlock,
        });
        pageCount += 1;

        for (const log of logs) {
          const tokenId = log.args.tokenId;
          if (tokenId !== undefined) target.add(tokenId.toString());
        }
      }
    }

    await scanDirection({ to: wallet }, received);
    await scanDirection({ from: wallet }, sent);

    return {
      candidateIds: uniqSorted([...received, ...sent]),
      pageCount,
    };
  });
}

async function scanWalletTransfers(wallet: Address): Promise<WalletTransferScanResult> {
  const transferScan = await scanWalletTransferCandidateIds(wallet);
  const owners = await mapLimit(transferScan.candidateIds, ENUMERABLE_CONCURRENCY, async (tokenId) => {
    try {
      const owner = await readContractWithFailover({
        address: dyoorS1Contract,
        abi: erc721EnumerableAbi,
        functionName: "ownerOf",
        args: [BigInt(tokenId)],
        label: `S1 ownerOf transfer candidate #${tokenId}`,
      }) as string;
      return sameAddress(owner, wallet) ? tokenId : "";
    } catch {
      return "";
    }
  });

  return {
    tokenIds: uniqSorted(owners),
    candidateIds: transferScan.candidateIds,
    pageCount: transferScan.pageCount,
  };
}

async function detectRecoverableDeposits(wallet: Address): Promise<AscensionRecoveryState> {
  const startedAt = performance.now();
  if (configuredS1StartBlock() === 0n) {
    return {
      ...clearRecoveryState,
      status: "limited",
      message: "No recovery required from loaded state. Full automatic recovery scan needs NEXT_PUBLIC_DYOOR_S1_START_BLOCK.",
      source: "start-block-not-configured",
      timingMs: Math.round(performance.now() - startedAt),
    };
  }

  try {
    const transferScan = await scanWalletTransferCandidateIds(wallet);
    const checks = await mapLimit(transferScan.candidateIds, ENUMERABLE_CONCURRENCY, async (tokenId) => {
      const [ownerResult, infoResult] = await Promise.allSettled([
        readContractWithFailover({
          address: dyoorS1Contract,
          abi: erc721EnumerableAbi,
          functionName: "ownerOf",
          args: [BigInt(tokenId)],
          label: `S1 ownerOf recovery candidate #${tokenId}`,
        }),
        readContractWithFailover({
          address: ascensionStakingContract,
          abi: ascensionStakingAbi,
          functionName: "stakeInfo",
          args: [BigInt(tokenId)],
          label: `Ascension stakeInfo recovery candidate #${tokenId}`,
        }),
      ]);

      const owner = ownerResult.status === "fulfilled" ? getAddress(ownerResult.value as Address) : "";
      const info = infoResult.status === "fulfilled" ? infoResult.value as readonly [string, number | bigint] : null;
      const staker = info?.[0] ? getAddress(info[0] as Address) : "";
      const isInsideStaking = owner && sameAddress(owner, ascensionStakingContract);
      const unregistered = !staker || sameAddress(staker, "0x0000000000000000000000000000000000000000");

      if (isInsideStaking && unregistered) {
        return {
          tokenId,
          reason: "Transferred to Ascension contract but final stake registration is missing.",
        };
      }

      return null;
    });

    const candidates = checks.filter(Boolean) as AscensionRecoveryCandidate[];
    const recoverableTokenIds = uniqSorted(candidates.map((candidate) => candidate.tokenId));
    return {
      status: recoverableTokenIds.length ? "available" : "clear",
      recoverableTokenIds,
      candidates,
      estimatedTransactions: recoverableTokenIds.length ? 1 : 0,
      message: recoverableTokenIds.length ? "Recovery available." : "No recovery required.",
      source: "wallet-transfer-log-scan",
      timingMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    return {
      ...clearRecoveryState,
      status: "limited",
      message: formatRecoveryScanMessage(error instanceof Error ? error.message : "Recovery scan failed."),
      source: "wallet-transfer-log-scan",
      timingMs: Math.round(performance.now() - startedAt),
    };
  }
}

async function scanAllS1Owners(wallet: Address, expectedWalletCount: number | null = null): Promise<OwnerScanResult> {
  const walletIds: string[] = [];
  const stakingContractIds: string[] = [];
  let tokenIds = Array.from({ length: MAX_S1_SUPPLY }, (_, index) => index + 1);
  let pageCount = 0;

  for (let attempt = 0; attempt < OWNER_SCAN_ATTEMPTS && tokenIds.length; attempt += 1) {
    const failedTokenIds: number[] = [];

    for (let page = 0; page < Math.ceil(tokenIds.length / OWNER_SCAN_CHUNK_SIZE); page += 1) {
      if (expectedWalletCount !== null && uniqSorted(walletIds).length >= expectedWalletCount) break;

      const chunk = tokenIds.slice(page * OWNER_SCAN_CHUNK_SIZE, (page + 1) * OWNER_SCAN_CHUNK_SIZE);
      pageCount += 1;
      const owners = await mapLimit(chunk, OWNER_SCAN_CONCURRENCY, async (tokenId) => {
      try {
        const owner = await readContractWithFailover({
          address: dyoorS1Contract,
          abi: erc721EnumerableAbi,
          functionName: "ownerOf",
          args: [BigInt(tokenId)],
          label: `S1 ownerOf full scan #${tokenId}`,
        }) as string;
        return { tokenId: String(tokenId), owner: getAddress(owner as Address) };
      } catch {
        return { tokenId: String(tokenId), owner: "" };
      }
      });

      for (const result of owners) {
        if (!result.owner) {
          failedTokenIds.push(Number(result.tokenId));
          continue;
        }
        if (sameAddress(result.owner, wallet)) walletIds.push(result.tokenId);
        if (sameAddress(result.owner, ascensionStakingContract)) stakingContractIds.push(result.tokenId);
      }

      if (expectedWalletCount !== null && uniqSorted(walletIds).length >= expectedWalletCount) break;
      await delay(250);
    }

    if (expectedWalletCount !== null && uniqSorted(walletIds).length >= expectedWalletCount) break;
    tokenIds = failedTokenIds;
  }

  return {
    walletIds: uniqSorted(walletIds),
    stakingContractIds: uniqSorted(stakingContractIds),
    pageCount,
  };
}

async function discoverWalletTokenIds(wallet: Address) {
  const indexedIds: string[] = [];
  let walletBalance: number | null = null;

  try {
    const balance = await readContractWithFailover({
      address: dyoorS1Contract,
      abi: erc721EnumerableAbi,
      functionName: "balanceOf",
      args: [wallet],
      label: "S1 balanceOf(wallet)",
    }) as bigint;
    walletBalance = Number(balance);
  } catch {
    walletBalance = null;
  }

  if (walletBalance && walletBalance > 0) {
    let indexes = Array.from({ length: walletBalance }, (_, index) => index);
    for (let attempt = 0; attempt < 2 && indexes.length; attempt += 1) {
      const indexedResults = await mapLimit(indexes, ENUMERABLE_CONCURRENCY, async (index) => {
      try {
        const tokenId = await readContractWithFailover({
        address: dyoorS1Contract,
        abi: erc721EnumerableAbi,
        functionName: "tokenOfOwnerByIndex",
        args: [wallet, BigInt(index)],
        label: `S1 tokenOfOwnerByIndex ${index}`,
        }) as bigint;
        return { index, tokenId: tokenId.toString() };
      } catch {
        return { index, tokenId: "" };
      }
      });
      indexedIds.push(...indexedResults.map((result) => result.tokenId).filter(Boolean));
      const completedIndexes = new Set(indexedResults.filter((result) => result.tokenId).map((result) => result.index));
      indexes = indexes.filter((index) => !completedIndexes.has(index));
      if (uniqSorted(indexedIds).length === walletBalance) break;
    }
  }

  const indexedSorted = uniqSorted(indexedIds);
  if (walletBalance !== null && indexedSorted.length === walletBalance) {
    return {
      walletBalance,
      indexedIds: indexedSorted,
      ownerScanIds: [],
      tokenIds: indexedSorted,
      pageCount: walletBalance ? Math.ceil(walletBalance / ENUMERABLE_CONCURRENCY) : 0,
      source: "erc721-enumerable",
    };
  }

  let transferScan: WalletTransferScanResult = { tokenIds: [], candidateIds: [], pageCount: 0 };
  if (configuredS1StartBlock() > 0n) {
    try {
      transferScan = await scanWalletTransfers(wallet);
      if (walletBalance === null || transferScan.tokenIds.length === walletBalance) {
        return {
          walletBalance,
          indexedIds: indexedSorted,
          ownerScanIds: transferScan.tokenIds,
          tokenIds: transferScan.tokenIds,
          pageCount: transferScan.pageCount,
          source: "transfer-log-ownerOf-fallback",
        };
      }
    } catch {}
  }

  const ownerScan = await scanAllS1Owners(wallet, walletBalance);
  const tokenIds = uniqSorted([...indexedSorted, ...transferScan.tokenIds, ...ownerScan.walletIds]);
  return {
    walletBalance,
    indexedIds: indexedSorted,
    ownerScanIds: tokenIds,
    tokenIds,
    pageCount: transferScan.pageCount + ownerScan.pageCount,
    source: transferScan.tokenIds.length ? "transfer-log-plus-full-ownerOf-fallback" : "full-ownerOf-scan-fallback",
  };
}

async function discoverStakedTokenIds(wallet: Address) {
  const warnings: string[] = [];
  const idMethods = ["tokensOfStaker", "getStakedTokens"] as const;
  const countMethods = ["stakedBalance", "balanceOf"] as const;

  const [goldsky, idResults, countResults] = await Promise.all([
    withTimeout(fetchGoldskyStakedTokens(wallet), GOLDSKY_TIMEOUT_MS, null),
    Promise.allSettled(idMethods.map((functionName) => readContractWithFailover({
        address: ascensionStakingContract,
        abi: ascensionStakingAbi,
        functionName,
        args: [wallet],
        label: `Ascension ${functionName}`,
      }))),
    Promise.allSettled(countMethods.map((functionName) => readContractWithFailover({
        address: ascensionStakingContract,
        abi: ascensionStakingAbi,
        functionName,
        args: [wallet],
        label: `Ascension ${functionName}`,
      }))),
  ]);

  const goldskyIds = goldsky?.tokenIds || [];
  const rpcIds = idResults.flatMap((result, index) => {
    if (result.status === "fulfilled") return (result.value as bigint[]).map((id) => id.toString());
    warnings.push(`${idMethods[index]} unavailable`);
    return [];
  });
  const counts = countResults.map((result, index) => {
    if (result.status === "fulfilled") return Number(result.value as bigint);
    warnings.push(`${countMethods[index]} unavailable`);
    return null;
  }).filter((value): value is number => value !== null);
  const rpcCount = counts.length ? Math.max(...counts) : null;
  const ownerScanStakedIds: string[] = [];

  let tokenIds = uniqSorted([...goldskyIds, ...rpcIds]);
  if (rpcCount !== null && tokenIds.length < rpcCount) {
    warnings.push("Staked token IDs are still indexing. Count is loaded from staking balance.");
  }

  const visibleWarnings = tokenIds.length >= (rpcCount || 0) ? [] : warnings;
  return {
    tokenIds,
    goldskyIds: uniqSorted(goldskyIds),
    rpcIds: uniqSorted(rpcIds),
    ownerScanStakedIds: uniqSorted(ownerScanStakedIds),
    count: Math.max(tokenIds.length, rpcCount || 0),
    rpcCount,
    warnings: visibleWarnings,
  };
}

async function fetchEnergy(wallet: Address, options: EnergyRefreshOptions = {}) {
  const [pendingResult, bankedResult, lifetimeResult, statsResult] = await Promise.allSettled([
    readContractWithFailover({
      address: ascensionStakingContract,
      abi: ascensionStakingAbi,
      functionName: "pendingPoints",
      args: [wallet],
      label: "Ascension pendingPoints",
    }),
    readContractWithFailover({
      address: energyBankContract,
      abi: energyBankAbi,
      functionName: "spendableEnergy",
      args: [wallet],
      label: "Energy Bank spendableEnergy",
    }),
    readContractWithFailover({
      address: energyBankContract,
      abi: energyBankAbi,
      functionName: "lifetimeEnergy",
      args: [wallet],
      label: "Energy Bank lifetimeEnergy",
    }),
    options.scanLogs
      ? fetch("/api/energy/sync-wallet", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ wallet }),
          cache: "no-store",
        })
      : fetch(`/api/energy/${wallet}`, { cache: "no-store" }),
  ]);

  let pendingEnergy = pendingResult.status === "fulfilled" ? formatUnits18(pendingResult.value as bigint) : "0.00";
  const contractBankedEnergy = bankedResult.status === "fulfilled" ? formatUnits18(bankedResult.value as bigint) : "0.00";
  let bankedEnergy = contractBankedEnergy;
  let spendableEnergy = contractBankedEnergy;
  let calculatedBankEnergy = contractBankedEnergy;
  let missingSpendableEnergy = "0";
  let lifetimeEnergy = lifetimeResult.status === "fulfilled" ? formatUnits18(lifetimeResult.value as bigint) : "0.00";
  let harvestedEnergy = "0.00";

  try {
    const response = statsResult.status === "fulfilled" ? statsResult.value : null;
    if (response?.ok) {
      const json = await response.json() as EnergyStatsResponse;
      pendingEnergy = String(json.pendingEnergy || pendingEnergy);
      bankedEnergy = String(json.bankedEnergy || json.spendableEnergy || bankedEnergy);
      spendableEnergy = String(json.spendableEnergy || json.bankedEnergy || spendableEnergy);
      calculatedBankEnergy = String(json.calculatedBankEnergy || json.spendableEnergy || calculatedBankEnergy);
      missingSpendableEnergy = "0";
      harvestedEnergy = String(json.harvestedEnergy || harvestedEnergy);
      lifetimeEnergy = String(json.lifetimeEnergy || lifetimeEnergy);
      if (process.env.NODE_ENV !== "production") {
        console.table({
          wallet,
          pendingEnergy,
          harvestedEnergy,
          creditedEnergy: json.creditedEnergy || "0",
          incomingTransfers: json.incomingTransfersEnergy || "0",
          outgoingTransfers: json.outgoingTransfersEnergy || "0",
          spentEnergy: json.spentEnergy || "0",
          lifetimeEnergy,
          energyBank: contractBankedEnergy,
          calculatedBankEnergy,
          missingSpendableEnergy,
          harvestEventsFound: json.harvestEventsFound || 0,
          blockRangeScanned: `${json.fromBlock || "0"}-${json.toBlock || "0"}`,
          dataSource: json.dataSource || "unknown",
        });
      }
    }
  } catch {}

  return { pendingEnergy, bankedEnergy, spendableEnergy, calculatedBankEnergy, missingSpendableEnergy, harvestedEnergy, lifetimeEnergy };
}

async function loadAscensionState(walletAddress: string): Promise<AscensionState> {
  const startedAt = performance.now();
  if (!isAddress(walletAddress)) throw new Error("Connect a valid Monad wallet.");
  const wallet = getAddress(walletAddress);
  const warnings: string[] = [];

  const [walletDiscovery, stakedDiscovery] = await Promise.all([
    discoverWalletTokenIds(wallet),
    discoverStakedTokenIds(wallet),
  ]);
  const recovery = clearRecoveryState;

  if (walletDiscovery.walletBalance !== null && walletDiscovery.tokenIds.length !== walletDiscovery.walletBalance) {
    warnings.push(`Wallet balance check returned ${walletDiscovery.walletBalance}. Verified token IDs loaded ${walletDiscovery.tokenIds.length}; count is displayed while token cards are deferred.`);
  }
  if (stakedDiscovery.rpcCount !== null && stakedDiscovery.tokenIds.length < stakedDiscovery.rpcCount) {
    warnings.push("Some ascended NFTs may still be loading. Click Refresh NFTs.");
  }

  const walletNfts = walletDiscovery.tokenIds.map((tokenId) => fallbackNft(tokenId, "wallet"));
  const ascendedNfts = stakedDiscovery.tokenIds.map((tokenId) => fallbackNft(tokenId, "ascended"));
  const walletUnstakedCount = walletDiscovery.walletBalance ?? walletNfts.length;
  const totalControlled = walletUnstakedCount + stakedDiscovery.count;
  const nextState = {
    walletAddress: wallet,
    walletNfts,
    walletUnstakedCount,
    ascendedNfts,
    ascendedCount: stakedDiscovery.count,
    totalControlled,
    pendingEnergy: "0.00",
    bankedEnergy: "0.00",
    spendableEnergy: "0.00",
    calculatedBankEnergy: "0.00",
    missingSpendableEnergy: "0",
    harvestedEnergy: "0.00",
    lifetimeEnergy: "0.00",
    isPartial: warnings.length > 0,
    recovery,
    warnings: [...warnings, ...stakedDiscovery.warnings],
    sources: {
      walletBalance: walletDiscovery.walletBalance,
      indexedWalletIds: walletDiscovery.indexedIds,
      ownerScanWalletIds: walletDiscovery.ownerScanIds,
      ownerScanStakedIds: stakedDiscovery.ownerScanStakedIds,
      nftFetchPageCount: walletDiscovery.pageCount,
      nftFetchSource: walletDiscovery.source,
      goldskyStakedIds: stakedDiscovery.goldskyIds,
      rpcStakedIds: stakedDiscovery.rpcIds,
      rpcStakedCount: stakedDiscovery.rpcCount,
    },
  };

  if (process.env.NODE_ENV !== "production") {
    console.table({
      wallet,
      dyoorContract: dyoorS1Contract,
      walletUnstakedCount,
      ascendedCount: stakedDiscovery.count,
      totalControlled,
      walletTokenIds: walletDiscovery.tokenIds.join(", "),
      ascendedTokenIds: stakedDiscovery.tokenIds.join(", "),
      nftFetchPageCount: walletDiscovery.pageCount,
      nftFetchSource: walletDiscovery.source,
      fetchTimingMs: Math.round(performance.now() - startedAt),
      recoverableTokenIds: recovery.recoverableTokenIds.join(", "),
      recoveryStatus: recovery.status,
      recoveryTimingMs: recovery.timingMs,
    });
  }

  return nextState;
}

async function loadAscensionEnergy(walletAddress: string, options: EnergyRefreshOptions = {}) {
  if (!isAddress(walletAddress)) return {
    walletAddress: "",
    pendingEnergy: "0.00",
    bankedEnergy: "0.00",
    spendableEnergy: "0.00",
    calculatedBankEnergy: "0.00",
    missingSpendableEnergy: "0",
    harvestedEnergy: "0.00",
    lifetimeEnergy: "0.00",
  };
  return {
    walletAddress: getAddress(walletAddress),
    ...await fetchEnergy(getAddress(walletAddress), options),
  };
}

export function useAscension() {
  const wallet = useWalletService();
  const queryClient = useQueryClient();
  const address = isAddress(wallet.address || "") ? getAddress(wallet.address as Address) : "";

  const query = useQuery({
    queryKey: ["ascension", address],
    enabled: Boolean(address),
    queryFn: () => loadAscensionState(address),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: 1,
    placeholderData: (previousData) => previousData,
  });

  const energyQuery = useQuery({
    queryKey: ["ascension-energy", address],
    enabled: Boolean(address),
    queryFn: () => loadAscensionEnergy(address),
    staleTime: 10_000,
    gcTime: 5 * 60_000,
    retry: 1,
    placeholderData: (previousData) => previousData,
  });

  const recoveryQuery = useQuery({
    queryKey: ["ascension-recovery", address],
    enabled: Boolean(address && query.data?.walletAddress && sameAddress(query.data.walletAddress, address)),
    queryFn: () => withTimeout(
      detectRecoverableDeposits(getAddress(address as Address)),
      RECOVERY_SCAN_TIMEOUT_MS,
      limitedRecoveryState("Automatic recovery scan timed out on the current RPC. If support provided a token ID, use manual recovery below; it verifies the token on-chain before submitting."),
    ),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 0,
  });

  const stateData = query.data?.walletAddress && address && sameAddress(query.data.walletAddress, address) ? query.data : undefined;
  const energyData = energyQuery.data?.walletAddress && address && sameAddress(energyQuery.data.walletAddress, address) ? energyQuery.data : undefined;

  return {
    walletAddress: address,
    walletNfts: stateData?.walletNfts || [],
    walletUnstakedCount: stateData?.walletUnstakedCount || 0,
    ascendedNfts: stateData?.ascendedNfts || [],
    ascendedCount: stateData?.ascendedCount || 0,
    totalControlled: stateData?.totalControlled || 0,
    pendingEnergy: energyData?.pendingEnergy || stateData?.pendingEnergy || "0.00",
    bankedEnergy: energyData?.bankedEnergy || stateData?.bankedEnergy || "0.00",
    spendableEnergy: energyData?.spendableEnergy || stateData?.spendableEnergy || "0.00",
    calculatedBankEnergy: energyData?.calculatedBankEnergy || stateData?.calculatedBankEnergy || "0.00",
    missingSpendableEnergy: energyData?.missingSpendableEnergy || stateData?.missingSpendableEnergy || "0",
    harvestedEnergy: energyData?.harvestedEnergy || stateData?.harvestedEnergy || "0.00",
    lifetimeEnergy: energyData?.lifetimeEnergy || stateData?.lifetimeEnergy || "0.00",
    loading: query.isLoading,
    refreshing: query.isFetching && !query.isLoading,
    energyLoading: energyQuery.isLoading || energyQuery.isFetching,
    hasLoaded: Boolean(stateData),
    error: query.error,
    isPartial: stateData?.isPartial || false,
    recovery: recoveryQuery.data || stateData?.recovery || clearRecoveryState,
    warnings: stateData?.warnings || [],
    sources: stateData?.sources,
    refresh: async (options: EnergyRefreshOptions = {}) => {
      await queryClient.cancelQueries({ queryKey: ["ascension", address] });
      await queryClient.cancelQueries({ queryKey: ["ascension-energy", address] });
      await queryClient.cancelQueries({ queryKey: ["ascension-recovery", address] });
      void queryClient.invalidateQueries({ queryKey: ["ascension-recovery", address] });
      if (options.scanLogs || options.scanGrants) {
        const [energy] = await Promise.all([
          loadAscensionEnergy(address, options),
          query.refetch(),
        ]);
        queryClient.setQueryData(["ascension-energy", address], energy);
        return;
      }
      await Promise.all([query.refetch(), energyQuery.refetch()]);
    },
  };
}
