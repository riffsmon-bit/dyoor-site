import {
  Contract,
  Interface,
  JsonRpcProvider,
  type Log,
  formatEther,
  formatUnits,
  getAddress,
  isAddress,
  keccak256,
  toBeHex,
  zeroPadValue,
} from "ethers";
import {
  CANONICAL_ERC6551_REGISTRY_ABI,
  DROID_ACCOUNT_ABI,
  DROID_COLLECTION_ABI,
  DROID_ENERGY_ABI,
  DROID_ERC20_ABI,
  DROID_ERC721_ABI,
  DROID_OWNER_TRADING_ABI,
  DROID_REGISTRY_ABI,
} from "@/lib/droid-accounts/abis";
import { droidActivationAllowed } from "@/lib/droid-accounts/activation";
import {
  MONAD_CANARY_ACTIVITY_EVIDENCE,
  MONAD_CANARY_OBSERVATION_FINAL_BLOCK,
  matchesMonadCanaryActivityEvidence,
} from "@/lib/droid-accounts/canary-activity-bootstrap";
import {
  CANONICAL_ERC6551_REGISTRY_RUNTIME_CODE_HASH,
  droidServerRpcUrl,
  droidServerRpcUrls,
  getDroidProtocolConfig,
} from "@/lib/droid-accounts/config-runtime";
import {
  activityResumeBlock,
  chooseCatchupChunkSize,
  dedupeActivityItems,
  scanAdaptiveLogRanges,
} from "@/lib/droid-accounts/adaptive-log-scan";
import type {
  DroidAccountSnapshot,
  DroidActivityHealth,
  DroidActivityItem,
  DroidConfiguredNftCollection,
  DroidNftInventoryItem,
  DroidProtocolConfig,
  DroidSquadItem,
  DroidTokenBalance,
} from "@/lib/droid-accounts/types";
import { unavailableDroidPrice } from "@/lib/droid-accounts/pricing";
import { totalDroidPortfolio, valueDroidAsset } from "@/lib/droid-accounts/valuation";
import {
  getDroidActivityCheckpoint,
  setDroidActivityCheckpoint,
} from "@/src/lib/storage/droidActivityStore";

const collectionInterface = new Interface(DROID_COLLECTION_ABI);
const accountInterface = new Interface(DROID_ACCOUNT_ABI);
const tradingInterface = new Interface(DROID_OWNER_TRADING_ABI);
const registryInterface = new Interface(DROID_REGISTRY_ABI);
const erc721Interface = new Interface(DROID_ERC721_ABI);
const transferTopic = collectionInterface.getEvent("Transfer")!.topicHash;
const ZERO_CODE = "0x";
const MAX_ACTIVITY_ITEMS = 30;
const MAX_NFT_INVENTORY_PER_COLLECTION = 250;

const providerCache = new Map<string, JsonRpcProvider>();
const verifiedConfigCache = new Map<string, DroidProtocolConfig>();
const configVerificationRequests = new Map<string, Promise<DroidProtocolConfig>>();
const activityRequestCache = new Map<string, Promise<{
  activity: DroidActivityItem[];
  health: DroidActivityHealth;
}>>();

function droidProvider(config: DroidProtocolConfig) {
  const rpcUrl = droidServerRpcUrl(config.chainId);
  const key = `${config.chainId}:${rpcUrl}`;
  const cached = providerCache.get(key);
  if (cached) return cached;
  const provider = new JsonRpcProvider(rpcUrl, config.chainId, {
    staticNetwork: true,
    batchMaxCount: 100,
    batchStallTime: 10,
  });
  providerCache.set(key, provider);
  return provider;
}

function providerForUrl(config: DroidProtocolConfig, rpcUrl: string) {
  const key = `${config.chainId}:${rpcUrl}`;
  const cached = providerCache.get(key);
  if (cached) return cached;
  const provider = new JsonRpcProvider(rpcUrl, config.chainId, {
    staticNetwork: true,
    batchMaxCount: 100,
    batchStallTime: 10,
  });
  providerCache.set(key, provider);
  return provider;
}

function publicProviderLabel(value: string) {
  try {
    return new URL(value).hostname || "configured RPC";
  } catch {
    return "configured RPC";
  }
}

function boundedActivityInteger(
  chainId: number,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const prefix = chainId === 143 ? "MONAD" : "HOODYOOR";
  const chainValue = process.env[`${prefix}_${name}`];
  const parsed = Number(chainValue === undefined ? process.env[name] : chainValue);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

function sameAddress(left: string, right: string) {
  try {
    return getAddress(left) === getAddress(right);
  } catch {
    return false;
  }
}

function addressTopic(address: string) {
  return zeroPadValue(address, 32);
}

function tokenTopic(tokenId: bigint | number | string) {
  return zeroPadValue(toBeHex(tokenId), 32);
}

function conciseUnits(value: bigint, decimals: number) {
  const formatted = formatUnits(value, decimals);
  const [whole, fraction = ""] = formatted.split(".");
  const trimmed = fraction.replace(/0+$/, "").slice(0, 8);
  return trimmed ? `${whole}.${trimmed}` : whole;
}

function partialError(errors: string[], message: string) {
  if (!errors.includes(message)) errors.push(message);
}

async function boundedServerRead<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
      timer.unref?.();
    });
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function configuredProviderCandidates(
  config: DroidProtocolConfig,
  preferred?: JsonRpcProvider,
) {
  const providers = preferred ? [preferred] : [];
  for (const rpcUrl of droidServerRpcUrls(config.chainId)) {
    const candidate = providerForUrl(config, rpcUrl);
    if (!providers.includes(candidate)) providers.push(candidate);
  }
  return providers;
}

async function criticalDroidRead<T>(
  config: DroidProtocolConfig,
  label: string,
  read: (provider: JsonRpcProvider) => Promise<T>,
  preferred?: JsonRpcProvider,
) {
  for (const provider of configuredProviderCandidates(config, preferred)) {
    try {
      return await boundedServerRead(read(provider), 4_000, label);
    } catch {
      // Try the next explicitly configured read-only provider. Never convert a
      // failed authoritative read into an inactive account or zero balance.
    }
  }
  throw new Error(`${label} is temporarily unavailable.`);
}

export function normalizeDroidWallet(value: unknown) {
  const candidate = String(value || "").trim();
  return isAddress(candidate) ? getAddress(candidate) : "";
}

export function parseDroidTokenId(value: unknown, maxSupply = 3_333) {
  const tokenId = Number(value);
  return Number.isSafeInteger(tokenId) && tokenId >= 1 && tokenId <= maxSupply
    ? tokenId
    : 0;
}

export async function checkedDroidProtocolConfig(chainId?: number) {
  const config = getDroidProtocolConfig(chainId);
  if (!config.collectionAddress) {
    return { ...config, configured: false, setupIssue: `${config.collectionName} collection is not configured.` };
  }
  const cacheKey = [
    config.chainId,
    config.collectionAddress,
    config.canonicalRegistryAddress,
    config.registryAddress,
    config.implementationAddress,
    config.accountSalt,
  ].join(":").toLowerCase();
  const cached = verifiedConfigCache.get(cacheKey);
  if (cached) return cached;
  const existing = configVerificationRequests.get(cacheKey);
  if (existing) return await existing;

  const verification = (async () => {
    for (const provider of configuredProviderCandidates(config)) {
      try {
        const collectionCode = await boundedServerRead(
          provider.getCode(config.collectionAddress),
          4_000,
          "Droid collection verification",
        );
        if (collectionCode === ZERO_CODE) throw new Error("collection code mismatch");
        if (!config.configured) return config;

        const [canonicalCode, registryCode, implementationCode] = await boundedServerRead(
          Promise.all([
            provider.getCode(config.canonicalRegistryAddress),
            provider.getCode(config.registryAddress),
            provider.getCode(config.implementationAddress),
          ]),
          4_000,
          "Droid infrastructure verification",
        );
        if (
          canonicalCode === ZERO_CODE
          || keccak256(canonicalCode).toLowerCase()
            !== CANONICAL_ERC6551_REGISTRY_RUNTIME_CODE_HASH.toLowerCase()
          || registryCode === ZERO_CODE
          || implementationCode === ZERO_CODE
        ) throw new Error("infrastructure code mismatch");

        const registry = new Contract(config.registryAddress, DROID_REGISTRY_ABI, provider);
        const [canonical, implementation, collection, tokenChainId, salt] = await boundedServerRead(
          Promise.all([
            registry.canonicalRegistry() as Promise<string>,
            registry.implementation() as Promise<string>,
            registry.tokenContract() as Promise<string>,
            registry.tokenChainId() as Promise<bigint>,
            registry.accountSalt() as Promise<string>,
          ]),
          4_000,
          "Droid registry wiring verification",
        );
        if (
          !sameAddress(canonical, config.canonicalRegistryAddress)
          || !sameAddress(implementation, config.implementationAddress)
          || !sameAddress(collection, config.collectionAddress)
          || Number(tokenChainId) !== config.chainId
          || salt.toLowerCase() !== config.accountSalt.toLowerCase()
        ) throw new Error("registry wiring mismatch");

        verifiedConfigCache.set(cacheKey, config);
        return config;
      } catch {
        // A second read-only provider must independently recover a transient
        // timeout/503. No failed verification is cached.
      }
    }
    return {
      ...config,
      configured: false,
      setupIssue: "Droid Account RPC verification is unavailable or inconsistent.",
    };
  })().finally(() => configVerificationRequests.delete(cacheKey));
  configVerificationRequests.set(cacheKey, verification);
  return await verification;
}

async function predictedAccount(
  config: DroidProtocolConfig,
  provider: JsonRpcProvider,
  tokenId: number,
) {
  if (!config.configured) return "";
  return await criticalDroidRead(config, "Deterministic Droid Account derivation", async (candidate) => {
    const facade = new Contract(config.registryAddress, DROID_REGISTRY_ABI, candidate);
    const canonical = new Contract(
      config.canonicalRegistryAddress,
      CANONICAL_ERC6551_REGISTRY_ABI,
      candidate,
    );
    const [facadeAddress, canonicalAddress] = await Promise.all([
      facade.account(tokenId) as Promise<string>,
      canonical.account(
        config.implementationAddress,
        config.accountSalt,
        config.chainId,
        config.collectionAddress,
        tokenId,
      ) as Promise<string>,
    ]);
    if (!sameAddress(facadeAddress, canonicalAddress)) {
      throw new Error("Registry address derivation mismatch.");
    }
    return getAddress(facadeAddress);
  }, provider);
}

async function ownedTokenIdsFromInboundLogs(
  config: DroidProtocolConfig,
  provider: JsonRpcProvider,
  owner: string,
) {
  const logs = await provider.getLogs({
    address: config.collectionAddress,
    fromBlock: config.collectionStartBlock,
    toBlock: "latest",
    topics: [transferTopic, null, addressTopic(owner)],
  });
  const candidates = [...new Set(logs.map((log) => BigInt(log.topics[3]).toString()))];
  const collection = new Contract(config.collectionAddress, DROID_COLLECTION_ABI, provider);
  const ownership = await Promise.all(candidates.map(async (tokenId) => {
    try {
      const currentOwner = await collection.ownerOf(tokenId) as string;
      return sameAddress(currentOwner, owner) ? Number(tokenId) : 0;
    } catch {
      return 0;
    }
  }));
  return ownership.filter((tokenId) => tokenId > 0).sort((a, b) => a - b);
}

async function ownedTokenIdsByEnumeration(
  config: DroidProtocolConfig,
  provider: JsonRpcProvider,
  owner: string,
  expectedBalance: number,
) {
  const collection = new Contract(config.collectionAddress, DROID_COLLECTION_ABI, provider);
  let issuedUpperBound = config.maxSupply;
  try {
    issuedUpperBound = Number(await collection.totalMinted() as bigint);
  } catch {
    try {
      issuedUpperBound = Number(await collection.totalSupply() as bigint);
    } catch {
      // Keep the configured bounded maximum for non-enumerable collections.
    }
  }
  const totalSupply = Math.min(config.maxSupply, issuedUpperBound);
  const found: number[] = [];
  for (let start = 1; start <= totalSupply && found.length < expectedBalance; start += 150) {
    const end = Math.min(totalSupply, start + 149);
    const owners = await Promise.all(Array.from(
      { length: end - start + 1 },
      async (_, offset) => {
        const tokenId = start + offset;
        try {
          return {
            tokenId,
            owner: await collection.ownerOf(tokenId) as string,
          };
        } catch {
          return { tokenId, owner: "" };
        }
      },
    ));
    for (const item of owners) {
      if (sameAddress(item.owner, owner)) found.push(item.tokenId);
    }
  }
  return found;
}

export async function discoverOwnedDroidTokenIds(
  config: DroidProtocolConfig,
  owner: string,
) {
  const provider = droidProvider(config);
  const collection = new Contract(config.collectionAddress, DROID_COLLECTION_ABI, provider);
  const balance = Number(await collection.balanceOf(owner) as bigint);
  if (!balance) return [];
  try {
    const fromLogs = await ownedTokenIdsFromInboundLogs(config, provider, owner);
    if (fromLogs.length === balance) return fromLogs;
  } catch {
    // The small fixed collection has a bounded direct-read fallback for RPCs without archive logs.
  }
  return await ownedTokenIdsByEnumeration(config, provider, owner, balance);
}

async function droidImageUrl(
  config: DroidProtocolConfig,
  provider: JsonRpcProvider,
  tokenId: number,
) {
  if (config.imageUrlTemplate) {
    return config.imageUrlTemplate.replace("{tokenId}", String(tokenId));
  }
  const collection = new Contract(config.collectionAddress, DROID_COLLECTION_ABI, provider);
  try {
    const traits = await collection.tokenTraits(tokenId) as bigint;
    return `/api/robinhood/trait-lab/image?traits=${traits.toString()}`;
  } catch {
    // Before reveal, use the collection's own tokenURI image instead of assigning sample art.
  }
  try {
    const tokenUri = await collection.tokenURI(tokenId) as string;
    const prefix = "data:application/json;base64,";
    if (tokenUri.startsWith(prefix)) {
      const metadata = JSON.parse(
        Buffer.from(tokenUri.slice(prefix.length), "base64").toString("utf8"),
      ) as { image?: unknown };
      if (typeof metadata.image === "string" && metadata.image.startsWith("data:image/")) {
        return metadata.image;
      }
    }
  } catch {
    // A final static fallback mirrors the collection's onchain reveal-pending SVG.
  }
  return "/assets/robinhood/collection/hoodyoor-reveal-pending.png";
}

async function tokenBalances(
  config: DroidProtocolConfig,
  provider: JsonRpcProvider,
  accountAddress: string,
  errors: string[],
) {
  return await Promise.all(config.tokens.map(async (token): Promise<DroidTokenBalance> => {
    try {
      const contract = new Contract(token.address, DROID_ERC20_ABI, provider);
      const rawBalance = await contract.balanceOf(accountAddress) as bigint;
      const valuation = valueDroidAsset(
        rawBalance.toString(),
        unavailableDroidPrice(token.address),
      );
      return {
        ...token,
        rawBalance: rawBalance.toString(),
        formattedBalance: conciseUnits(rawBalance, token.decimals),
        valueStatus: valuation.status,
        fiatValue: valuation.valueUsd,
      };
    } catch {
      partialError(errors, `${token.symbol} balance unavailable.`);
      return {
        ...token,
        rawBalance: "0",
        formattedBalance: "Unavailable",
        valueStatus: "unavailable",
        fiatValue: null,
      };
    }
  }));
}

async function inventoryForCollection(
  config: DroidProtocolConfig,
  provider: JsonRpcProvider,
  accountAddress: string,
  collectionConfig: DroidConfiguredNftCollection,
) {
  const logs: Log[] = [];
  if (!collectionConfig.seedTokenIds.length) {
    const latestBlock = await boundedServerRead(
      provider.getBlockNumber(),
      4_000,
      `${collectionConfig.name} inventory chain-head read`,
    );
    const scan = await scanAdaptiveLogRanges({
      fromBlock: collectionConfig.startBlock,
      toBlock: latestBlock,
      initialChunkSize: 100,
      minimumChunkSize: 25,
      retriesPerProvider: 1,
      concurrency: 4,
      maxRanges: 200,
      maxDurationMs: 10_000,
      requestTimeoutMs: 4_000,
      providers: droidServerRpcUrls(config.chainId).map((rpcUrl) => ({
        label: publicProviderLabel(rpcUrl),
        readRange: async (fromBlock: number, toBlock: number) => await providerForUrl(
          config,
          rpcUrl,
        ).getLogs({
          address: collectionConfig.address,
          fromBlock,
          toBlock,
          topics: [
            erc721Interface.getEvent("Transfer")!.topicHash,
            null,
            addressTopic(accountAddress),
          ],
        }),
      })),
      onRange: ({ items }) => {
        logs.push(...items);
      },
    });
    if (!scan.completed) {
      throw new Error(scan.lastError || `${collectionConfig.name} inventory scan incomplete.`);
    }
  }
  const candidates = [...new Set([
    ...collectionConfig.seedTokenIds,
    ...logs.map((log) => BigInt(log.topics[3]).toString()),
  ])]
    .slice(-MAX_NFT_INVENTORY_PER_COLLECTION);
  const collection = new Contract(collectionConfig.address, DROID_ERC721_ABI, provider);
  const items = await Promise.all(candidates.map(async (tokenId): Promise<DroidNftInventoryItem | null> => {
    try {
      const currentOwner = await collection.ownerOf(tokenId) as string;
      if (!sameAddress(currentOwner, accountAddress)) return null;
      return {
        collectionAddress: collectionConfig.address,
        collectionName: collectionConfig.name,
        tokenId,
        equipment: collectionConfig.equipment,
        imageUrls: inventoryImageUrls(collectionConfig.imageUriTemplate, tokenId),
      };
    } catch {
      return null;
    }
  }));
  return items.filter((item): item is DroidNftInventoryItem => Boolean(item));
}

function inventoryImageUrls(template: string, tokenId: string) {
  if (!template) return [];
  const uri = template.replaceAll("{tokenId}", tokenId);
  if (!uri.startsWith("ipfs://")) return [];
  const path = uri.slice("ipfs://".length);
  if (!/^[A-Za-z0-9]+(?:\/[A-Za-z0-9._~-]+)*$/.test(path)) return [];
  return [
    `https://gateway.ipfs.io/ipfs/${path}`,
    `https://dweb.link/ipfs/${path}`,
    `https://nftstorage.link/ipfs/${path}`,
    `https://gateway.pinata.cloud/ipfs/${path}`,
  ];
}

async function nftInventory(
  config: DroidProtocolConfig,
  provider: JsonRpcProvider,
  accountAddress: string,
  errors: string[],
) {
  const results = await Promise.all(config.nftCollections.map(async (collection) => {
    try {
      return await inventoryForCollection(config, provider, accountAddress, collection);
    } catch {
      partialError(errors, `${collection.name} inventory unavailable.`);
      return [];
    }
  }));
  return results.flat();
}

async function energyBalance(
  config: DroidProtocolConfig,
  provider: JsonRpcProvider,
  address: string,
  errors: string[],
  label: string,
) {
  if (!config.energyBankAddress) return "0";
  try {
    const bank = new Contract(config.energyBankAddress, DROID_ENERGY_ABI, provider);
    return (await bank.energyBalance(address) as bigint).toString();
  } catch {
    partialError(errors, `${label} Energy unavailable.`);
    return "Unavailable";
  }
}

type TaggedActivityLog = {
  source: "ownership" | "account" | "activation" | "trade";
  log: Log;
};

function parseActivityLogs(
  logs: TaggedActivityLog[],
  config: DroidProtocolConfig,
  tokenId: number,
  accountAddress: string,
) {
  const activity: DroidActivityItem[] = [];
  for (const item of logs) {
    try {
      if (item.source === "ownership") {
        const parsed = collectionInterface.parseLog(item.log);
        if (!parsed) continue;
        const from = getAddress(parsed.args.from as string);
        const to = getAddress(parsed.args.to as string);
        activity.push({
          id: `${item.log.transactionHash}:${item.log.index}`,
          kind: "owner-changed",
          label: from === "0x0000000000000000000000000000000000000000"
            ? "DROID MINTED"
            : "OWNER CHANGED",
          chainId: config.chainId,
          tokenId,
          droidAccount: accountAddress,
          controller: to,
          blockNumber: item.log.blockNumber,
          transactionHash: item.log.transactionHash,
          timestamp: null,
        });
        continue;
      }

      if (item.source === "activation") {
        const parsed = registryInterface.parseLog(item.log);
        if (!parsed || parsed.name !== "DroidAccountActivated") continue;
        activity.push({
          id: `${item.log.transactionHash}:${item.log.index}`,
          kind: "activated",
          label: "DROID ACTIVATED",
          chainId: config.chainId,
          tokenId,
          droidAccount: accountAddress,
          controller: getAddress(parsed.args.owner as string),
          blockNumber: item.log.blockNumber,
          transactionHash: item.log.transactionHash,
          timestamp: null,
        });
        continue;
      }

      if (item.source === "trade") {
        const parsed = tradingInterface.parseLog(item.log);
        if (!parsed || parsed.name !== "NativeTradeExecuted") continue;
        const tokenOut = getAddress(parsed.args.tokenOut as string);
        const configuredToken = config.tokens.find((token) => sameAddress(token.address, tokenOut));
        const amountOut = parsed.args.amountOut as bigint;
        activity.push({
          id: `${item.log.transactionHash}:${item.log.index}`,
          kind: "traded",
          label: `OWNER TRADE · ${conciseUnits(parsed.args.amountIn as bigint, 18)} ${config.nativeCurrencySymbol} → ${conciseUnits(amountOut, configuredToken?.decimals ?? 18)} ${configuredToken?.symbol || "TOKEN"}`,
          chainId: config.chainId,
          tokenId,
          droidAccount: accountAddress,
          controller: getAddress(parsed.args.owner as string),
          blockNumber: item.log.blockNumber,
          transactionHash: item.log.transactionHash,
          timestamp: null,
          trade: {
            tokenIn: "native",
            tokenOut,
            amountIn: (parsed.args.amountIn as bigint).toString(),
            amountOut: amountOut.toString(),
            router: getAddress(parsed.args.router as string),
            market: getAddress(parsed.args.market as string),
          },
        });
        continue;
      }

      const parsed = accountInterface.parseLog(item.log);
      if (!parsed) continue;
      let kind: DroidActivityItem["kind"] = "executed";
      let label = "OWNER COMMAND EXECUTED";
      let controller = "";
      if (parsed.name === "NativeReceived") {
        kind = "native-received";
        label = `+ ${conciseUnits(parsed.args.amount as bigint, 18)} ${config.nativeCurrencySymbol} DEPOSITED`;
        controller = getAddress(parsed.args.sender as string);
      } else if (parsed.name === "ERC721Received" || parsed.name === "ERC1155Received") {
        kind = "nft-received";
        label = "NFT RECEIVED";
        controller = getAddress(parsed.args.from as string);
      } else if (parsed.name === "Executed") {
        controller = getAddress(parsed.args.executor as string);
      } else {
        continue;
      }
      activity.push({
        id: `${item.log.transactionHash}:${item.log.index}`,
        kind,
        label,
        chainId: config.chainId,
        tokenId,
        droidAccount: accountAddress,
        controller,
        blockNumber: item.log.blockNumber,
        transactionHash: item.log.transactionHash,
        timestamp: null,
      });
    } catch {
      // Ignore unrelated or malformed events without weakening direct state reads.
    }
  }
  return activity;
}

async function activityTimestamps(
  provider: JsonRpcProvider,
  activity: DroidActivityItem[],
) {
  const blocks = [...new Set(activity.filter((item) => item.timestamp === null)
    .map((item) => item.blockNumber))];
  const values = await Promise.all(blocks.map(async (blockNumber) => {
    try {
      const block = await boundedServerRead(
        provider.getBlock(blockNumber),
        4_000,
        "Activity timestamp read",
      );
      return [blockNumber, block?.timestamp ?? null] as const;
    } catch {
      return [blockNumber, null] as const;
    }
  }));
  const timestamps = new Map(values);
  return activity.map((item) => ({
    ...item,
    timestamp: item.timestamp ?? timestamps.get(item.blockNumber) ?? null,
  }));
}

async function indexDroidActivity(
  config: DroidProtocolConfig,
  provider: JsonRpcProvider,
  tokenId: number,
  accountAddress: string,
  active: boolean,
) {
  const startBlock = config.activityStartBlock > 0
    ? Math.max(config.collectionStartBlock, config.activityStartBlock)
    : config.collectionStartBlock;
  const latestBlock = await criticalDroidRead(
    config,
    "Activity chain-head read",
    (candidate) => candidate.getBlockNumber(),
    provider,
  );
  const reorgBlocks = boundedActivityInteger(
    config.chainId,
    "DROID_ACTIVITY_REORG_BLOCKS",
    32,
    0,
    512,
  );
  const checkpointInput = {
    chainId: config.chainId,
    collectionAddress: config.collectionAddress,
    tokenId,
    droidAccount: accountAddress,
  };
  let checkpointed = true;
  let persistenceError = "";
  let checkpoint = null as Awaited<ReturnType<typeof getDroidActivityCheckpoint>>;
  try {
    checkpoint = await getDroidActivityCheckpoint(checkpointInput);
    if (
      checkpoint
      && checkpoint.indexedThroughBlock < MONAD_CANARY_OBSERVATION_FINAL_BLOCK
      && latestBlock >= MONAD_CANARY_OBSERVATION_FINAL_BLOCK
      && matchesMonadCanaryActivityEvidence({
        ...checkpointInput,
        events: checkpoint.events,
      })
    ) {
      try {
        const receipts = await boundedServerRead(
          Promise.all(MONAD_CANARY_ACTIVITY_EVIDENCE.map(async (expected) => {
            const transactionHash = expected.id.split(":")[0];
            const logIndex = Number(expected.id.split(":")[1]);
            return await criticalDroidRead(
              config,
              "Canary observation receipt verification",
              async (candidate) => {
                const receipt = await candidate.getTransactionReceipt(transactionHash);
                const log = receipt?.logs.find((item) => item.index === logIndex);
                return Boolean(
                  receipt
                  && receipt.status === 1
                  && receipt.blockNumber === expected.blockNumber
                  && log?.address.toLowerCase() === expected.logAddress,
                );
              },
              provider,
            );
          })),
          20_000,
          "Canary observation evidence verification",
        );
        if (receipts.every(Boolean)) {
          checkpoint = await setDroidActivityCheckpoint({
            ...checkpointInput,
            startBlock,
            indexedThroughBlock: MONAD_CANARY_OBSERVATION_FINAL_BLOCK,
            chainHeadBlock: latestBlock,
            provider: "verified-canary-observation",
            lastError: "",
            retryState: "idle",
            lastAttemptAt: new Date().toISOString(),
            rangesProcessed: 0,
            retries: 0,
            events: checkpoint.events,
          });
        }
      } catch {
        persistenceError = "Canary observation bootstrap unavailable; bounded scanning will continue.";
      }
    }
  } catch {
    checkpointed = false;
    persistenceError = "Activity checkpoint storage unavailable.";
  }

  const resumeBlock = activityResumeBlock({
    startBlock,
    latestBlock,
    indexedThroughBlock: checkpoint?.indexedThroughBlock ?? null,
    reorgBlocks,
  });
  let activity = (checkpoint?.events || []).filter((item) => item.blockNumber < resumeBlock);
  let indexedThroughBlock = resumeBlock - 1;
  let lastSuccessfulSync = checkpoint?.updatedAt || "";
  let lastProvider = publicProviderLabel(droidServerRpcUrl(config.chainId));
  let rangesSinceCheckpoint = 0;

  const providers = droidServerRpcUrls(config.chainId).map((rpcUrl) => {
    const candidate = providerForUrl(config, rpcUrl);
    return {
      label: publicProviderLabel(rpcUrl),
      async readRange(fromBlock: number, toBlock: number) {
        const queries: Promise<Log[]>[] = [candidate.getLogs({
          address: config.collectionAddress,
          fromBlock,
          toBlock,
          topics: [transferTopic, null, null, tokenTopic(tokenId)],
        })];
        if (active && accountAddress) {
          queries.push(candidate.getLogs({ address: accountAddress, fromBlock, toBlock }));
          queries.push(candidate.getLogs({
            address: config.registryAddress,
            fromBlock,
            toBlock,
            topics: [
              registryInterface.getEvent("DroidAccountActivated")!.topicHash,
              addressTopic(accountAddress),
              addressTopic(config.collectionAddress),
              tokenTopic(tokenId),
            ],
          }));
          if (config.ownerTradingAddress) {
            queries.push(candidate.getLogs({
              address: config.ownerTradingAddress,
              fromBlock,
              toBlock,
              topics: [
                tradingInterface.getEvent("NativeTradeExecuted")!.topicHash,
                addressTopic(accountAddress),
                tokenTopic(tokenId),
              ],
            }));
          }
        }
        const values = await Promise.all(queries);
        return [
          ...values[0].map((log): TaggedActivityLog => ({ source: "ownership", log })),
          ...(values[1] || []).map((log): TaggedActivityLog => ({ source: "account", log })),
          ...(values[2] || []).map((log): TaggedActivityLog => ({ source: "activation", log })),
          ...(values[3] || []).map((log): TaggedActivityLog => ({ source: "trade", log })),
        ];
      },
    };
  });

  const maxRanges = boundedActivityInteger(
    config.chainId,
    "DROID_ACTIVITY_MAX_RANGES_PER_SYNC",
    5_000,
    1,
    10_000,
  );
  const initialChunkSize = chooseCatchupChunkSize({
    fromBlock: resumeBlock,
    toBlock: latestBlock,
    configuredChunkSize: boundedActivityInteger(
      config.chainId,
      "DROID_ACTIVITY_LOG_CHUNK_SIZE",
      100,
      10,
      100_000,
    ),
    maxRanges,
    maximumChunkSize: 100_000,
  });
  const checkpointEveryRanges = boundedActivityInteger(
    config.chainId,
    "DROID_ACTIVITY_CHECKPOINT_RANGES",
    50,
    1,
    500,
  );
  const scan = await scanAdaptiveLogRanges({
    fromBlock: resumeBlock,
    toBlock: latestBlock,
    initialChunkSize,
    minimumChunkSize: boundedActivityInteger(config.chainId, "DROID_ACTIVITY_MIN_CHUNK_SIZE", 25, 10, 10_000),
    retriesPerProvider: boundedActivityInteger(config.chainId, "DROID_ACTIVITY_RPC_RETRIES", 2, 0, 5),
    concurrency: boundedActivityInteger(
      config.chainId,
      "DROID_ACTIVITY_CONCURRENT_RANGES",
      4,
      1,
      8,
    ),
    maxRanges,
    maxDurationMs: boundedActivityInteger(
      config.chainId,
      "DROID_ACTIVITY_SYNC_BUDGET_MS",
      30_000,
      5_000,
      14 * 60_000,
    ),
    requestTimeoutMs: boundedActivityInteger(
      config.chainId,
      "DROID_ACTIVITY_RPC_TIMEOUT_MS",
      8_000,
      1_000,
      30_000,
    ),
    providers,
    async onRange(range) {
      activity = dedupeActivityItems([
        ...activity,
        ...parseActivityLogs(range.items, config, tokenId, accountAddress),
      ]);
      indexedThroughBlock = range.toBlock;
      lastSuccessfulSync = new Date().toISOString();
      lastProvider = range.provider;
      rangesSinceCheckpoint += 1;
      if (checkpointed && rangesSinceCheckpoint >= checkpointEveryRanges) {
        try {
          await setDroidActivityCheckpoint({
            ...checkpointInput,
            startBlock,
            indexedThroughBlock,
            chainHeadBlock: latestBlock,
            provider: lastProvider,
            lastError: "",
            retryState: "idle",
            lastAttemptAt: lastSuccessfulSync,
            rangesProcessed: rangesSinceCheckpoint,
            retries: 0,
            events: activity,
          });
          rangesSinceCheckpoint = 0;
        } catch {
          checkpointed = false;
          persistenceError = "Activity checkpoint storage unavailable.";
        }
      }
    },
  });

  indexedThroughBlock = Math.max(indexedThroughBlock, scan.indexedThroughBlock);
  activity = await activityTimestamps(provider, activity);
  activity = dedupeActivityItems(activity)
    .sort((left, right) => right.blockNumber - left.blockNumber)
    .slice(0, MAX_ACTIVITY_ITEMS);
  if (scan.completed) lastSuccessfulSync = new Date().toISOString();
  if (checkpointed && indexedThroughBlock >= startBlock) {
    try {
      await setDroidActivityCheckpoint({
        ...checkpointInput,
        startBlock,
        indexedThroughBlock,
        chainHeadBlock: latestBlock,
        provider: scan.provider || lastProvider,
        lastError: scan.lastError,
        retryState: scan.retryState,
        lastAttemptAt: new Date().toISOString(),
        rangesProcessed: scan.ranges,
        retries: scan.retries,
        events: activity,
      });
    } catch {
      checkpointed = false;
      persistenceError = "Activity checkpoint storage unavailable.";
    }
  }

  const blocksBehind = Math.max(0, latestBlock - indexedThroughBlock);
  const synced = scan.completed && blocksBehind === 0;
  const health: DroidActivityHealth = {
    status: synced ? "synced" : "partial",
    startBlock,
    indexedThroughBlock,
    latestBlock,
    blocksBehind,
    lastSuccessfulSync,
    lastError: synced ? persistenceError : scan.lastError || persistenceError,
    provider: scan.provider || lastProvider,
    retryState: synced ? "idle" : scan.retryState,
    checkpointed,
  };
  return { activity, health };
}

async function readDroidActivity(
  config: DroidProtocolConfig,
  provider: JsonRpcProvider,
  tokenId: number,
  accountAddress: string,
  errors: string[],
) {
  const startBlock = config.activityStartBlock > 0
    ? Math.max(config.collectionStartBlock, config.activityStartBlock)
    : config.collectionStartBlock;
  const checkpointInput = {
    chainId: config.chainId,
    collectionAddress: config.collectionAddress,
    tokenId,
    droidAccount: accountAddress,
  };
  let checkpoint = null as Awaited<ReturnType<typeof getDroidActivityCheckpoint>>;
  const readErrors: string[] = [];
  let latestBlock = 0;
  const publicReadTimeout = boundedActivityInteger(
    config.chainId,
    "DROID_ACTIVITY_PUBLIC_READ_TIMEOUT_MS",
    2_000,
    250,
    10_000,
  );
  const [checkpointResult, headResult] = await Promise.allSettled([
    boundedServerRead(
      getDroidActivityCheckpoint(checkpointInput),
      publicReadTimeout,
      "Activity checkpoint read",
    ),
    boundedServerRead(
      provider.getBlockNumber(),
      publicReadTimeout,
      "Activity chain-head read",
    ),
  ]);
  if (checkpointResult.status === "fulfilled") {
    checkpoint = checkpointResult.value;
  } else {
    readErrors.push("Activity checkpoint storage unavailable.");
  }
  if (headResult.status === "fulfilled") {
    latestBlock = headResult.value;
  } else {
    latestBlock = checkpoint?.chainHeadBlock || 0;
    readErrors.push("Activity chain head unavailable.");
  }

  const rawIndexedThrough = checkpoint?.indexedThroughBlock ?? startBlock - 1;
  const checkpointAhead = latestBlock > 0 && rawIndexedThrough > latestBlock;
  const indexedThroughBlock = checkpointAhead ? latestBlock : rawIndexedThrough;
  const blocksBehind = latestBlock > 0
    ? Math.max(0, latestBlock - indexedThroughBlock)
    : 0;
  const synced = Boolean(checkpoint && latestBlock > 0 && blocksBehind === 0 && !checkpointAhead);
  const lastError = readErrors.join(" ")
    || (checkpointAhead ? "Activity checkpoint is ahead of the current RPC chain head." : "")
    || checkpoint?.lastError
    || "";
  const status: DroidActivityHealth["status"] = synced
    ? "synced"
    : lastError
      ? "partial"
      : "syncing";
  if (status !== "synced") {
    partialError(errors, "Some historical Droid activity is still syncing.");
  }
  const activity = dedupeActivityItems(checkpoint?.events || [])
    .sort((left, right) => right.blockNumber - left.blockNumber)
    .slice(0, MAX_ACTIVITY_ITEMS);
  return {
    activity,
    health: {
      status,
      startBlock,
      indexedThroughBlock,
      latestBlock,
      blocksBehind,
      lastSuccessfulSync: checkpoint?.updatedAt || "",
      lastError,
      provider: checkpoint?.provider || publicProviderLabel(droidServerRpcUrl(config.chainId)),
      retryState: checkpoint?.retryState || (lastError ? "failed" : "idle"),
      checkpointed: Boolean(checkpoint),
    } satisfies DroidActivityHealth,
  };
}

/**
 * Advances informational history only. Public profile reads never await this
 * work; the background indexer invokes it in bounded, resumable passes.
 */
export async function syncDroidActivity(
  config: DroidProtocolConfig,
  tokenId: number,
) {
  if (!config.configured) {
    throw new Error("Droid infrastructure must verify before activity synchronization.");
  }
  const provider = droidProvider(config);
  await criticalDroidRead(config, "Current Droid owner read", async (candidate) => {
    const collection = new Contract(config.collectionAddress, DROID_COLLECTION_ABI, candidate);
    return await collection.ownerOf(tokenId) as string;
  }, provider);
  const accountAddress = await predictedAccount(config, provider, tokenId);
  const active = Boolean(
    accountAddress
    && await criticalDroidRead(
      config,
      "Droid Account deployment read",
      (candidate) => candidate.getCode(accountAddress),
      provider,
    ) !== ZERO_CODE,
  );
  const cacheKey = `${config.chainId}:${config.collectionAddress.toLowerCase()}:${tokenId}`;
  const current = activityRequestCache.get(cacheKey);
  if (current) return await current;
  const request = indexDroidActivity(
    config,
    provider,
    tokenId,
    accountAddress,
    active,
  ).finally(() => {
    activityRequestCache.delete(cacheKey);
  });
  activityRequestCache.set(cacheKey, request);
  return await request;
}

export async function getDroidSnapshot(
  config: DroidProtocolConfig,
  tokenId: number,
  requestedWallet = "",
): Promise<DroidAccountSnapshot> {
  const provider = droidProvider(config);
  const errors: string[] = [];
  const owner = getAddress(await criticalDroidRead(
    config,
    "Current Droid owner read",
    async (candidate) => {
      const collection = new Contract(config.collectionAddress, DROID_COLLECTION_ABI, candidate);
      return await collection.ownerOf(tokenId) as string;
    },
    provider,
  ));
  let accountAddress = "";
  if (config.configured) {
    accountAddress = await predictedAccount(config, provider, tokenId);
  }
  const accountCode = accountAddress
    ? await criticalDroidRead(
        config,
        "Droid Account deployment read",
        (candidate) => candidate.getCode(accountAddress),
        provider,
      )
    : ZERO_CODE;
  const active = accountCode !== ZERO_CODE;
  if (active) {
    try {
      const [accountOwner, binding] = await criticalDroidRead(
        config,
        "Droid Account binding read",
        async (candidate) => {
          const account = new Contract(accountAddress, DROID_ACCOUNT_ABI, candidate);
          return await Promise.all([
            account.owner() as Promise<string>,
            account.token() as Promise<[bigint, string, bigint]>,
          ]);
        },
        provider,
      );
      if (
        !sameAddress(accountOwner, owner)
        || Number(binding[0]) !== config.chainId
        || !sameAddress(binding[1], config.collectionAddress)
        || Number(binding[2]) !== tokenId
      ) {
        throw new Error("binding mismatch");
      }
    } catch {
      throw new Error("Deployed Droid Account failed ownership or token-binding validation.");
    }
  }

  const balanceAddress = accountAddress || "0x0000000000000000000000000000000000000000";
  const [nativeBalance, tokens, nfts, droidEnergy, commanderEnergy, imageUrl] =
    await Promise.all([
      accountAddress
        ? criticalDroidRead(
            config,
            "Droid native balance read",
            (candidate) => candidate.getBalance(accountAddress),
            provider,
          )
        : 0n,
      accountAddress ? tokenBalances(config, provider, balanceAddress, errors) : [],
      accountAddress ? nftInventory(config, provider, balanceAddress, errors) : [],
      accountAddress
        ? energyBalance(config, provider, balanceAddress, errors, "Droid")
        : Promise.resolve("0"),
      energyBalance(config, provider, owner, errors, "Commander"),
      droidImageUrl(config, provider, tokenId),
    ]);
  const activityResult = await readDroidActivity(
    config,
    provider,
    tokenId,
    accountAddress,
    errors,
  );
  const portfolio = totalDroidPortfolio([
    valueDroidAsset(nativeBalance.toString(), unavailableDroidPrice("native")),
    ...tokens.map((token) => valueDroidAsset(
      token.rawBalance,
      unavailableDroidPrice(token.address),
    )),
  ]);

  return {
    tokenId,
    owner,
    ownedByRequestedWallet: Boolean(requestedWallet && sameAddress(requestedWallet, owner)),
    imageUrl,
    accountAddress,
    accountCodeHash: active ? keccak256(accountCode) : "",
    active,
    activationAllowed: active || droidActivationAllowed(config, tokenId),
    nativeBalance: nativeBalance.toString(),
    nativeFormatted: conciseUnits(nativeBalance, 18),
    nativeFiatValue: null,
    tokens,
    nfts,
    energyBalance: droidEnergy,
    commanderEnergyBalance: commanderEnergy,
    portfolioValue: portfolio.valueUsd,
    portfolioValueStatus: portfolio.status,
    directive: "MANUAL",
    agent: "OFFLINE",
    activeSessionKeys: 0,
    activity: activityResult.activity,
    activityHealth: activityResult.health,
    partialErrors: errors,
  };
}

async function squadItem(
  config: DroidProtocolConfig,
  provider: JsonRpcProvider,
  tokenId: number,
  owner: string,
): Promise<DroidSquadItem> {
  const accountAddress = config.configured
    ? await predictedAccount(config, provider, tokenId).catch(() => "")
    : "";
  const [code, nativeBalance, energy, imageUrl] = await Promise.all([
    accountAddress ? provider.getCode(accountAddress).catch(() => ZERO_CODE) : ZERO_CODE,
    accountAddress ? provider.getBalance(accountAddress).catch(() => 0n) : 0n,
    accountAddress && config.energyBankAddress
      ? new Contract(config.energyBankAddress, DROID_ENERGY_ABI, provider)
          .energyBalance(accountAddress).then((value: bigint) => value.toString()).catch(() => "Unavailable")
      : Promise.resolve("0"),
    droidImageUrl(config, provider, tokenId),
  ]);
  return {
    tokenId,
    owner,
    imageUrl,
    accountAddress,
    active: code !== ZERO_CODE,
    nativeFormatted: conciseUnits(nativeBalance, 18),
    energyBalance: energy,
    portfolioValue: null,
    portfolioValueStatus: "unavailable",
    directive: "MANUAL",
  };
}

export async function getDroidSquad(config: DroidProtocolConfig, owner: string) {
  const provider = droidProvider(config);
  const tokenIds = await discoverOwnedDroidTokenIds(config, owner);
  const squad: DroidSquadItem[] = [];
  for (let start = 0; start < tokenIds.length; start += 12) {
    squad.push(...await Promise.all(
      tokenIds.slice(start, start + 12).map((tokenId) => squadItem(config, provider, tokenId, owner)),
    ));
  }
  return squad;
}
