import "server-only";
import { ZeroHash, getAddress } from "ethers";
import {
  DEFAULT_MONAD_RPC_URL,
  MONAD_EXPLORER_URL,
  MONAD_MAINNET_CHAIN_ID,
} from "@/lib/monad";
import {
  ROBINHOOD_MAINNET_CHAIN_ID,
  ROBINHOOD_MAINNET_EXPLORER_URL,
  ROBINHOOD_MAINNET_RPC_URL,
  ROBINHOOD_TESTNET_CHAIN_ID,
  ROBINHOOD_TESTNET_EXPLORER_URL,
  ROBINHOOD_TESTNET_RPC_URL,
  isRobinhoodChainId,
} from "@/lib/robinhood-chain";
import type {
  DroidConfiguredNftCollection,
  DroidConfiguredToken,
  DroidProtocolConfig,
} from "@/lib/droid-accounts/types";

export const CANONICAL_ERC6551_REGISTRY_ADDRESS =
  "0x000000006551c19487814612e58FE06813775758";
export const CANONICAL_ERC6551_REGISTRY_RUNTIME_CODE_HASH =
  "0xda1d5b06e579f9e42e59b00fbc22939896ecb38dc8830d40de0a2508fecd6735";
export const HOODYOOR_MAINNET_COLLECTION_ADDRESS =
  "0x8277F8126722B11D7b44C5C453bcF62A78AAFa25";
export const HOODYOOR_MAINNET_COLLECTION_START_BLOCK = 32_414_048;
export const HOODYOOR_MAINNET_ENERGY_BANK_ADDRESS =
  "0x9bA9aa6c6A1CB04bc0477E90f4D93214c6b1D7c3";
export const HOODYOOR_MAINNET_DROID_IMPLEMENTATION_ADDRESS =
  "0x0FFDc6ACb41D39ee7b535026202AA8fe0054F52A";
export const HOODYOOR_MAINNET_DROID_REGISTRY_ADDRESS =
  "0x190602Aa70199ec3623ad3bc97a10B534b26fE48";
export const HOODYOOR_MAINNET_DROID_START_BLOCK = 33_356_761;
export const ROBINHOOD_MAINNET_USDG_ADDRESS =
  "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
export const DYOOR_MONAD_MAINNET_COLLECTION_ADDRESS =
  "0x349D8eb480c92cF75371fbA5C6344A4d11b9103A";
export const DYOOR_MONAD_MAINNET_COLLECTION_START_BLOCK = 87_616_887;
export const DYOOR_MONAD_MAINNET_ENERGY_BANK_ADDRESS =
  "0x291a8cC0FCa08EBd64a0e4d67B4455d24e9E6767";
export const MONAD_MAINNET_WMON_ADDRESS =
  "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A";
export const MONAD_MAINNET_USDC_ADDRESS =
  "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";

function readEnv(name: string) {
  return String(process.env[name] || "").trim();
}

function optionalAddress(value: string) {
  if (!value) return "";
  try {
    return getAddress(value);
  } catch {
    return "";
  }
}

function positiveInteger(value: string, fallback: number) {
  if (!value.trim()) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function enabled(value: string, fallback: boolean) {
  if (!value.trim()) return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function parseConfiguredTokens(
  raw: string,
  defaults: DroidConfiguredToken[],
): DroidConfiguredToken[] {
  if (!raw) return defaults;
  try {
    const values = JSON.parse(raw) as unknown;
    if (!Array.isArray(values)) return defaults;
    const parsed = values.flatMap((value): DroidConfiguredToken[] => {
      if (!value || typeof value !== "object") return [];
      const record = value as Record<string, unknown>;
      const address = optionalAddress(String(record.address || ""));
      const decimals = Number(record.decimals);
      const name = String(record.name || "").trim();
      const symbol = String(record.symbol || "").trim().toUpperCase();
      if (
        !address || !name || !/^[A-Z0-9.\-]{1,12}$/.test(symbol)
        || !Number.isInteger(decimals) || decimals < 0 || decimals > 36
      ) return [];
      return [{
        address,
        name: name.slice(0, 64),
        symbol,
        decimals,
        prominent: record.prominent === true,
      }];
    });
    return parsed.length ? parsed : defaults;
  } catch {
    return defaults;
  }
}

function parseNftCollections(raw: string): DroidConfiguredNftCollection[] {
  if (!raw) return [];
  try {
    const values = JSON.parse(raw) as unknown;
    if (!Array.isArray(values)) return [];
    return values.flatMap((value): DroidConfiguredNftCollection[] => {
      if (!value || typeof value !== "object") return [];
      const record = value as Record<string, unknown>;
      const address = optionalAddress(String(record.address || ""));
      const name = String(record.name || "").trim();
      const startBlock = Number(record.startBlock);
      if (
        !address || !name || !Number.isSafeInteger(startBlock) || startBlock < 0
      ) return [];
      return [{
        address,
        name: name.slice(0, 64),
        startBlock,
        equipment: record.equipment === true,
      }];
    });
  } catch {
    return [];
  }
}

export function droidServerRpcUrl(chainId: number) {
  if (chainId === MONAD_MAINNET_CHAIN_ID) {
    return readEnv("MONAD_DROID_RPC_URL")
      || readEnv("DYOOR_S2_RPC_URL")
      || readEnv("MONAD_RPC_URL")
      || DEFAULT_MONAD_RPC_URL;
  }
  const dedicated = readEnv("HOODYOOR_DROID_RPC_URL");
  if (dedicated) return dedicated;
  if (chainId === ROBINHOOD_TESTNET_CHAIN_ID) {
    return readEnv("HOODYOOR_DROID_TESTNET_RPC_URL") || ROBINHOOD_TESTNET_RPC_URL;
  }
  return readEnv("HOODYOOR_RPC_URL") || ROBINHOOD_MAINNET_RPC_URL;
}

export function getDroidProtocolConfig(requestedChainIdInput?: number): DroidProtocolConfig {
  const requestedChainId = requestedChainIdInput ?? Number(
    readEnv("HOODYOOR_DROID_CHAIN_ID")
      || readEnv("NEXT_PUBLIC_HOODYOOR_DROID_CHAIN_ID")
      || ROBINHOOD_MAINNET_CHAIN_ID,
  );
  if (requestedChainId === MONAD_MAINNET_CHAIN_ID) {
    const collectionAddress = optionalAddress(
      readEnv("MONAD_DROID_COLLECTION_ADDRESS")
        || readEnv("NEXT_PUBLIC_MONAD_DROID_COLLECTION_ADDRESS")
        || DYOOR_MONAD_MAINNET_COLLECTION_ADDRESS,
    );
    const registryAddress = optionalAddress(
      readEnv("MONAD_DROID_REGISTRY_ADDRESS")
        || readEnv("NEXT_PUBLIC_MONAD_DROID_REGISTRY_ADDRESS"),
    );
    const implementationAddress = optionalAddress(
      readEnv("MONAD_DROID_IMPLEMENTATION_ADDRESS")
        || readEnv("NEXT_PUBLIC_MONAD_DROID_IMPLEMENTATION_ADDRESS"),
    );
    const canonicalRegistryAddress = optionalAddress(
      readEnv("MONAD_DROID_CANONICAL_REGISTRY_ADDRESS")
        || CANONICAL_ERC6551_REGISTRY_ADDRESS,
    );
    const rawSalt = readEnv("MONAD_DROID_ACCOUNT_SALT")
      || readEnv("NEXT_PUBLIC_MONAD_DROID_ACCOUNT_SALT");
    const accountSalt = /^0x[a-fA-F0-9]{64}$/.test(rawSalt) ? rawSalt : ZeroHash;
    const defaultTokens: DroidConfiguredToken[] = [
      {
        address: MONAD_MAINNET_WMON_ADDRESS,
        name: "Wrapped MON",
        symbol: "WMON",
        decimals: 18,
        prominent: true,
      },
      {
        address: MONAD_MAINNET_USDC_ADDRESS,
        name: "USDC",
        symbol: "USDC",
        decimals: 6,
        prominent: true,
      },
    ];
    const tokens = parseConfiguredTokens(
      readEnv("MONAD_DROID_ERC20_TOKENS"),
      defaultTokens,
    );
    const nftCollections = parseNftCollections(
      readEnv("MONAD_DROID_NFT_COLLECTIONS"),
    ).filter((entry) => entry.address !== collectionAddress);
    const configured = Boolean(
      collectionAddress && registryAddress && implementationAddress
        && canonicalRegistryAddress,
    );
    const activationEnabled = enabled(readEnv("MONAD_DROIDS_ENABLED"), false)
      && enabled(readEnv("NEXT_PUBLIC_MONAD_DROIDS_ENABLED"), false);
    return {
      configured,
      activationEnabled,
      setupIssue: configured
        ? ""
        : "Monad Droid Account contracts are not configured yet.",
      chainId: MONAD_MAINNET_CHAIN_ID,
      chainName: "Monad",
      nativeCurrencyName: "Monad",
      nativeCurrencySymbol: "MON",
      rpcUrl: DEFAULT_MONAD_RPC_URL,
      explorerUrl: MONAD_EXPLORER_URL,
      canonicalRegistryAddress,
      registryAddress,
      implementationAddress,
      accountSalt,
      accountStartBlock: positiveInteger(readEnv("MONAD_DROID_START_BLOCK"), 0),
      collectionAddress,
      collectionStartBlock: positiveInteger(
        readEnv("MONAD_DROID_COLLECTION_START_BLOCK"),
        DYOOR_MONAD_MAINNET_COLLECTION_START_BLOCK,
      ),
      collectionName: "D.Y.O.O.R",
      maxSupply: 3_333,
      imageUrlTemplate: "/api/dyoor-world/pfp-image/{tokenId}",
      controllerPolicy: "DIRECT_ERC721_OWNER",
      parentTokenBurnable: true,
      energyBankAddress: optionalAddress(
        readEnv("MONAD_DROID_ENERGY_BANK_ADDRESS")
          || DYOOR_MONAD_MAINNET_ENERGY_BANK_ADDRESS,
      ),
      energyDecimals: 18,
      tokens,
      nftCollections,
    };
  }
  const chainId = isRobinhoodChainId(requestedChainId)
    ? requestedChainId
    : ROBINHOOD_MAINNET_CHAIN_ID;
  const mainnet = chainId === ROBINHOOD_MAINNET_CHAIN_ID;
  const collectionAddress = optionalAddress(
    readEnv("HOODYOOR_DROID_COLLECTION_ADDRESS")
      || readEnv("NEXT_PUBLIC_HOODYOOR_DROID_COLLECTION_ADDRESS")
      || (mainnet ? HOODYOOR_MAINNET_COLLECTION_ADDRESS : ""),
  );
  const energyBankAddress = optionalAddress(
    readEnv("HOODYOOR_DROID_ENERGY_BANK_ADDRESS")
      || readEnv("NEXT_PUBLIC_HOODYOOR_DROID_ENERGY_BANK_ADDRESS")
      || (mainnet ? HOODYOOR_MAINNET_ENERGY_BANK_ADDRESS : ""),
  );
  const registryAddress = optionalAddress(
    readEnv("HOODYOOR_DROID_REGISTRY_ADDRESS")
      || readEnv("NEXT_PUBLIC_HOODYOOR_DROID_REGISTRY_ADDRESS")
      || (mainnet ? HOODYOOR_MAINNET_DROID_REGISTRY_ADDRESS : ""),
  );
  const implementationAddress = optionalAddress(
    readEnv("HOODYOOR_DROID_IMPLEMENTATION_ADDRESS")
      || readEnv("NEXT_PUBLIC_HOODYOOR_DROID_IMPLEMENTATION_ADDRESS")
      || (mainnet ? HOODYOOR_MAINNET_DROID_IMPLEMENTATION_ADDRESS : ""),
  );
  const canonicalRegistryAddress = optionalAddress(
    readEnv("HOODYOOR_DROID_CANONICAL_REGISTRY_ADDRESS")
      || CANONICAL_ERC6551_REGISTRY_ADDRESS,
  );
  const accountSalt = /^0x[a-fA-F0-9]{64}$/.test(readEnv("HOODYOOR_DROID_ACCOUNT_SALT"))
    ? readEnv("HOODYOOR_DROID_ACCOUNT_SALT")
    : ZeroHash;
  const defaultTokens: DroidConfiguredToken[] = mainnet
    ? [{
        address: ROBINHOOD_MAINNET_USDG_ADDRESS,
        name: "Global Dollar",
        symbol: "USDG",
        decimals: 6,
        prominent: true,
      }]
    : [];
  const tokens = parseConfiguredTokens(
    readEnv("HOODYOOR_DROID_ERC20_TOKENS"),
    defaultTokens,
  );
  const nftCollections = parseNftCollections(
    readEnv("HOODYOOR_DROID_NFT_COLLECTIONS"),
  ).filter((entry) => entry.address !== collectionAddress);
  const configured = Boolean(
    collectionAddress && registryAddress && implementationAddress && canonicalRegistryAddress,
  );
  const activationEnabled = enabled(readEnv("ROBINHOOD_DROIDS_ENABLED"), false)
    && enabled(readEnv("NEXT_PUBLIC_ROBINHOOD_DROIDS_ENABLED"), false);

  return {
    configured,
    activationEnabled,
    setupIssue: configured
      ? ""
      : "Droid Account contracts are not configured on this network yet.",
    chainId,
    chainName: mainnet ? "Robinhood Chain" : "Robinhood Chain Testnet",
    nativeCurrencyName: "Ether",
    nativeCurrencySymbol: "ETH",
    rpcUrl: mainnet ? ROBINHOOD_MAINNET_RPC_URL : ROBINHOOD_TESTNET_RPC_URL,
    explorerUrl: mainnet
      ? ROBINHOOD_MAINNET_EXPLORER_URL
      : ROBINHOOD_TESTNET_EXPLORER_URL,
    canonicalRegistryAddress,
    registryAddress,
    implementationAddress,
    accountSalt,
    accountStartBlock: positiveInteger(
      readEnv("HOODYOOR_DROID_START_BLOCK"),
      mainnet ? HOODYOOR_MAINNET_DROID_START_BLOCK : 0,
    ),
    collectionAddress,
    collectionStartBlock: positiveInteger(
      readEnv("HOODYOOR_DROID_COLLECTION_START_BLOCK"),
      mainnet ? HOODYOOR_MAINNET_COLLECTION_START_BLOCK : 0,
    ),
    collectionName: "HoodYØØR",
    maxSupply: 3_333,
    imageUrlTemplate: "",
    controllerPolicy: "DIRECT_ERC721_OWNER",
    parentTokenBurnable: false,
    energyBankAddress,
    energyDecimals: 0,
    tokens,
    nftCollections,
  };
}
