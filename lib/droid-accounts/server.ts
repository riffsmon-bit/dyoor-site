import "server-only";
import {
  Contract,
  Interface,
  JsonRpcProvider,
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
  DROID_REGISTRY_ABI,
} from "@/lib/droid-accounts/abis";
import {
  CANONICAL_ERC6551_REGISTRY_RUNTIME_CODE_HASH,
  droidServerRpcUrl,
  getDroidProtocolConfig,
} from "@/lib/droid-accounts/config";
import type {
  DroidAccountSnapshot,
  DroidActivityItem,
  DroidConfiguredNftCollection,
  DroidNftInventoryItem,
  DroidProtocolConfig,
  DroidSquadItem,
  DroidTokenBalance,
} from "@/lib/droid-accounts/types";
import { unavailableDroidPrice } from "@/lib/droid-accounts/pricing";
import { totalDroidPortfolio, valueDroidAsset } from "@/lib/droid-accounts/valuation";

const collectionInterface = new Interface(DROID_COLLECTION_ABI);
const accountInterface = new Interface(DROID_ACCOUNT_ABI);
const registryInterface = new Interface(DROID_REGISTRY_ABI);
const erc721Interface = new Interface(DROID_ERC721_ABI);
const transferTopic = collectionInterface.getEvent("Transfer")!.topicHash;
const ZERO_CODE = "0x";
const MAX_ACTIVITY_ITEMS = 30;
const MAX_NFT_INVENTORY_PER_COLLECTION = 250;

let providerCache: { key: string; provider: JsonRpcProvider } | null = null;

function droidProvider(config: DroidProtocolConfig) {
  const rpcUrl = droidServerRpcUrl(config.chainId);
  const key = `${config.chainId}:${rpcUrl}`;
  if (providerCache?.key === key) return providerCache.provider;
  const provider = new JsonRpcProvider(rpcUrl, config.chainId, {
    staticNetwork: true,
    batchMaxCount: 100,
    batchStallTime: 10,
  });
  providerCache = { key, provider };
  return provider;
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
  const provider = droidProvider(config);
  try {
    const collectionCode = await provider.getCode(config.collectionAddress);
    if (collectionCode === ZERO_CODE) {
      return { ...config, configured: false, setupIssue: `Configured ${config.collectionName} collection has no code.` };
    }
    if (!config.configured) return config;

    const [canonicalCode, registryCode, implementationCode] = await Promise.all([
      provider.getCode(config.canonicalRegistryAddress),
      provider.getCode(config.registryAddress),
      provider.getCode(config.implementationAddress),
    ]);
    if (
      canonicalCode === ZERO_CODE
      || keccak256(canonicalCode).toLowerCase()
        !== CANONICAL_ERC6551_REGISTRY_RUNTIME_CODE_HASH.toLowerCase()
    ) {
      return { ...config, configured: false, setupIssue: "Canonical ERC-6551 registry verification failed." };
    }
    if (registryCode === ZERO_CODE || implementationCode === ZERO_CODE) {
      return { ...config, configured: false, setupIssue: "Configured Droid Account contracts have no code." };
    }

    const registry = new Contract(config.registryAddress, DROID_REGISTRY_ABI, provider);
    const [canonical, implementation, collection, chainId, salt] = await Promise.all([
      registry.canonicalRegistry() as Promise<string>,
      registry.implementation() as Promise<string>,
      registry.tokenContract() as Promise<string>,
      registry.tokenChainId() as Promise<bigint>,
      registry.accountSalt() as Promise<string>,
    ]);
    const wiringValid = sameAddress(canonical, config.canonicalRegistryAddress)
      && sameAddress(implementation, config.implementationAddress)
      && sameAddress(collection, config.collectionAddress)
      && Number(chainId) === config.chainId
      && salt.toLowerCase() === config.accountSalt.toLowerCase();
    if (!wiringValid) {
      return { ...config, configured: false, setupIssue: "Droid Account registry wiring does not match configuration." };
    }
    return config;
  } catch {
    return { ...config, configured: false, setupIssue: "Droid Account RPC verification is unavailable." };
  }
}

async function predictedAccount(
  config: DroidProtocolConfig,
  provider: JsonRpcProvider,
  tokenId: number,
) {
  if (!config.configured) return "";
  const facade = new Contract(config.registryAddress, DROID_REGISTRY_ABI, provider);
  const canonical = new Contract(
    config.canonicalRegistryAddress,
    CANONICAL_ERC6551_REGISTRY_ABI,
    provider,
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
  provider: JsonRpcProvider,
  accountAddress: string,
  collectionConfig: DroidConfiguredNftCollection,
) {
  const logs = await provider.getLogs({
    address: collectionConfig.address,
    fromBlock: collectionConfig.startBlock,
    toBlock: "latest",
    topics: [erc721Interface.getEvent("Transfer")!.topicHash, null, addressTopic(accountAddress)],
  });
  const candidates = [...new Set(logs.map((log) => BigInt(log.topics[3]).toString()))]
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
      };
    } catch {
      return null;
    }
  }));
  return items.filter((item): item is DroidNftInventoryItem => Boolean(item));
}

async function nftInventory(
  config: DroidProtocolConfig,
  provider: JsonRpcProvider,
  accountAddress: string,
  errors: string[],
) {
  const results = await Promise.all(config.nftCollections.map(async (collection) => {
    try {
      return await inventoryForCollection(provider, accountAddress, collection);
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

async function droidActivity(
  config: DroidProtocolConfig,
  provider: JsonRpcProvider,
  tokenId: number,
  accountAddress: string,
  active: boolean,
  errors: string[],
) {
  const activity: DroidActivityItem[] = [];
  try {
    const ownershipLogs = await provider.getLogs({
      address: config.collectionAddress,
      fromBlock: config.collectionStartBlock,
      toBlock: "latest",
      topics: [transferTopic, null, null, tokenTopic(tokenId)],
    });
    for (const log of ownershipLogs) {
      const parsed = collectionInterface.parseLog(log);
      if (!parsed) continue;
      const from = parsed.args.from as string;
      activity.push({
        id: `${log.transactionHash}:${log.index}`,
        kind: "owner-changed",
        label: from === "0x0000000000000000000000000000000000000000"
          ? "DROID MINTED"
          : "OWNER CHANGED",
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
      });
    }
  } catch {
    partialError(errors, "Ownership activity unavailable.");
  }

  if (active && accountAddress && config.accountStartBlock > 0) {
    try {
      const logs = await provider.getLogs({
        address: accountAddress,
        fromBlock: config.accountStartBlock,
        toBlock: "latest",
      });
      for (const log of logs) {
        const parsed = accountInterface.parseLog(log);
        if (!parsed) continue;
        let kind: DroidActivityItem["kind"] = "executed";
        let label = "OWNER COMMAND EXECUTED";
        if (parsed.name === "NativeReceived") {
          kind = "native-received";
          label = `+ ${conciseUnits(parsed.args.amount as bigint, 18)} ${config.nativeCurrencySymbol} DEPOSITED`;
        } else if (parsed.name === "ERC721Received" || parsed.name === "ERC1155Received") {
          kind = "nft-received";
          label = "NFT RECEIVED";
        } else if (parsed.name !== "Executed") {
          continue;
        }
        activity.push({
          id: `${log.transactionHash}:${log.index}`,
          kind,
          label,
          blockNumber: log.blockNumber,
          transactionHash: log.transactionHash,
        });
      }
    } catch {
      partialError(errors, "Droid Account activity unavailable.");
    }
  }

  if (active && config.registryAddress && config.accountStartBlock > 0) {
    try {
      const logs = await provider.getLogs({
        address: config.registryAddress,
        fromBlock: config.accountStartBlock,
        toBlock: "latest",
        topics: [
          registryInterface.getEvent("DroidAccountActivated")!.topicHash,
          accountAddress ? addressTopic(accountAddress) : null,
          addressTopic(config.collectionAddress),
          tokenTopic(tokenId),
        ],
      });
      for (const log of logs) {
        activity.push({
          id: `${log.transactionHash}:${log.index}`,
          kind: "activated",
          label: "DROID ACTIVATED",
          blockNumber: log.blockNumber,
          transactionHash: log.transactionHash,
        });
      }
    } catch {
      partialError(errors, "Activation activity unavailable.");
    }
  }

  return activity
    .sort((left, right) => right.blockNumber - left.blockNumber)
    .slice(0, MAX_ACTIVITY_ITEMS);
}

export async function getDroidSnapshot(
  config: DroidProtocolConfig,
  tokenId: number,
  requestedWallet = "",
): Promise<DroidAccountSnapshot> {
  const provider = droidProvider(config);
  const errors: string[] = [];
  const collection = new Contract(config.collectionAddress, DROID_COLLECTION_ABI, provider);
  const owner = getAddress(await collection.ownerOf(tokenId) as string);
  let accountAddress = "";
  if (config.configured) {
    try {
      accountAddress = await predictedAccount(config, provider, tokenId);
    } catch {
      partialError(errors, "Deterministic Droid Account address unavailable.");
    }
  }
  const active = Boolean(
    accountAddress && await provider.getCode(accountAddress).catch(() => ZERO_CODE) !== ZERO_CODE,
  );
  if (active) {
    try {
      const account = new Contract(accountAddress, DROID_ACCOUNT_ABI, provider);
      const [accountOwner, binding] = await Promise.all([
        account.owner() as Promise<string>,
        account.token() as Promise<[bigint, string, bigint]>,
      ]);
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
      accountAddress ? provider.getBalance(accountAddress).catch(() => {
        partialError(errors, "Native balance unavailable.");
        return 0n;
      }) : 0n,
      accountAddress ? tokenBalances(config, provider, balanceAddress, errors) : [],
      accountAddress ? nftInventory(config, provider, balanceAddress, errors) : [],
      accountAddress
        ? energyBalance(config, provider, balanceAddress, errors, "Droid")
        : Promise.resolve("0"),
      energyBalance(config, provider, owner, errors, "Commander"),
      droidImageUrl(config, provider, tokenId),
    ]);
  const activity = await droidActivity(
    config,
    provider,
    tokenId,
    accountAddress,
    active,
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
    active,
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
    activity,
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
