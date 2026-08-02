import { defineChain } from "viem";

export const MONAD_MAINNET_CHAIN_ID = 143;
export const MONAD_TESTNET_CHAIN_ID = 10143;
const configuredChainId = String(
  process.env.NEXT_PUBLIC_MONAD_CHAIN_ID
  || process.env.NEXT_PUBLIC_DYOOR_S2_CHAIN_ID
  || "",
).trim();
if (configuredChainId && Number(configuredChainId) !== MONAD_MAINNET_CHAIN_ID) {
  throw new Error(`Production wallet configuration must use Monad mainnet chain ${MONAD_MAINNET_CHAIN_ID}.`);
}

export const MONAD_CHAIN_ID = MONAD_MAINNET_CHAIN_ID;
export const MONAD_CHAIN_HEX = `0x${MONAD_CHAIN_ID.toString(16)}`;
export const MONAD_EXPLORER_URL = "https://monadscan.com";
export const DEFAULT_MONAD_RPC_URL = "https://rpc.monad.xyz";
// Wallet-facing code must never inline a vendor RPC credential. Protected RPC
// endpoints belong in server-only environment variables.
export const MONAD_RPC_URL = DEFAULT_MONAD_RPC_URL;

export type MonadEip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (value: unknown) => void) => void;
  removeListener?: (event: string, listener: (value: unknown) => void) => void;
};

export function evmChainId(value: unknown) {
  try {
    const raw = typeof value === "bigint" || typeof value === "number"
      ? value
      : String(value ?? "").trim();
    if (raw === "") return 0;
    const parsed = BigInt(raw);
    return parsed > 0n && parsed <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(parsed) : 0;
  } catch {
    return 0;
  }
}

export function isMonadMainnetChain(value: unknown) {
  return evmChainId(value) === MONAD_MAINNET_CHAIN_ID;
}

export function describeEvmChain(value: unknown) {
  const chainId = evmChainId(value);
  if (chainId === MONAD_MAINNET_CHAIN_ID) return `Monad mainnet (${MONAD_MAINNET_CHAIN_ID})`;
  if (chainId === MONAD_TESTNET_CHAIN_ID) return `Monad testnet (${MONAD_TESTNET_CHAIN_ID})`;
  return chainId ? `chain ${chainId}` : "an unknown network";
}

function walletErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error) return String(error.message || "");
  return typeof error === "string" ? error : "";
}

function walletActionRejected(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? Number(error.code) : 0;
  return code === 4001 || /reject|denied|cancel/i.test(walletErrorMessage(error));
}

export async function providerChainId(provider: MonadEip1193Provider) {
  return await provider.request({ method: "eth_chainId" }).catch(() => "");
}

export async function waitForMonadMainnet(provider: MonadEip1193Provider, attempts = 12) {
  let currentChain: unknown = "";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    currentChain = await providerChainId(provider);
    if (isMonadMainnetChain(currentChain)) return currentChain;
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  return currentChain;
}

export async function switchProviderToMonadMainnet(provider: MonadEip1193Provider) {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: MONAD_CHAIN_HEX }],
    });
  } catch (switchError) {
    if (walletActionRejected(switchError)) {
      throw new Error("Monad mainnet switch was cancelled in the wallet.");
    }
    try {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: MONAD_CHAIN_HEX,
          chainName: "Monad",
          rpcUrls: [MONAD_RPC_URL],
          nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
          blockExplorerUrls: [MONAD_EXPLORER_URL],
        }],
      });
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: MONAD_CHAIN_HEX }],
      });
    } catch (fallbackError) {
      if (walletActionRejected(fallbackError)) {
        throw new Error("Monad mainnet switch was cancelled in the wallet.");
      }
      const detail = walletErrorMessage(fallbackError) || walletErrorMessage(switchError);
      throw new Error(`Wallet could not switch to Monad mainnet (chain ${MONAD_MAINNET_CHAIN_ID})${detail ? `: ${detail}` : "."}`);
    }
  }

  const currentChain = await waitForMonadMainnet(provider);
  if (!isMonadMainnetChain(currentChain)) {
    throw new Error(`Wallet is still on ${describeEvmChain(currentChain)}. Switch it manually to Monad mainnet (chain ${MONAD_MAINNET_CHAIN_ID}) and retry.`);
  }
  return currentChain;
}

export const monadMainnet = defineChain({
  id: MONAD_CHAIN_ID,
  name: "Monad",
  nativeCurrency: {
    decimals: 18,
    name: "MON",
    symbol: "MON",
  },
  rpcUrls: {
    default: {
      http: [MONAD_RPC_URL],
    },
    public: {
      http: [MONAD_RPC_URL],
    },
  },
  blockExplorers: {
    default: {
      name: "Monadscan",
      url: MONAD_EXPLORER_URL,
    },
  },
});
