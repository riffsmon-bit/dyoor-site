import { defineChain } from "viem";

const configuredChainId = Number(
  process.env.NEXT_PUBLIC_DYOOR_S2_CHAIN_ID
  || process.env.DYOOR_S2_CHAIN_ID
  || process.env.NEXT_PUBLIC_MONAD_CHAIN_ID
  || process.env.EXPECTED_CHAIN_ID
  || process.env.CHAIN_ID
  || "143",
);

export const MONAD_MAINNET_CHAIN_ID = 143;
const resolvedChainId = configuredChainId === 10143 ? MONAD_MAINNET_CHAIN_ID : configuredChainId;

export const MONAD_CHAIN_ID = Number.isFinite(resolvedChainId) && resolvedChainId > 0 ? resolvedChainId : MONAD_MAINNET_CHAIN_ID;
export const MONAD_CHAIN_HEX = `0x${MONAD_CHAIN_ID.toString(16)}`;
export const DEFAULT_MONAD_RPC_URL = "https://rpc.monad.xyz";

export function isMonadChainId(value: unknown) {
  const chainId = String(value || "").trim().toLowerCase();
  if (!chainId) return false;
  if (chainId === MONAD_CHAIN_HEX.toLowerCase()) return true;
  if (chainId === `eip155:${MONAD_CHAIN_ID}`) return true;
  if (/^\d+$/.test(chainId)) return Number(chainId) === MONAD_CHAIN_ID;
  if (/^0x[0-9a-f]+$/.test(chainId)) return Number.parseInt(chainId.slice(2), 16) === MONAD_CHAIN_ID;
  return false;
}

function isTestnetLikeUrl(value: string) {
  return /testnet/i.test(value);
}

const configuredRpcUrl = process.env.NEXT_PUBLIC_DYOOR_S2_RPC_URL
  || process.env.DYOOR_S2_RPC_URL
  || process.env.NEXT_PUBLIC_MONAD_RPC_URL
  || process.env.MONAD_RPC_URL
  || "";
const configuredExplorerUrl = process.env.NEXT_PUBLIC_DYOOR_S2_EXPLORER_URL || "";
const mainnetMode = MONAD_CHAIN_ID === MONAD_MAINNET_CHAIN_ID;

export const MONAD_RPC_URL = configuredRpcUrl && (!mainnetMode || !isTestnetLikeUrl(configuredRpcUrl))
  ? configuredRpcUrl
  : DEFAULT_MONAD_RPC_URL;
export const MONAD_EXPLORER_URL = configuredExplorerUrl && (!mainnetMode || !isTestnetLikeUrl(configuredExplorerUrl))
  ? configuredExplorerUrl.replace(/\/+$/, "")
  : "https://monadscan.com";

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
