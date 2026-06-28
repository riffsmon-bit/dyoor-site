import { defineChain } from "viem";

const configuredChainId = Number(
  process.env.NEXT_PUBLIC_MONAD_CHAIN_ID
  || process.env.EXPECTED_CHAIN_ID
  || process.env.CHAIN_ID
  || "143",
);

export const MONAD_MAINNET_CHAIN_ID = 143;
const resolvedChainId = configuredChainId === 10143 ? MONAD_MAINNET_CHAIN_ID : configuredChainId;

export const MONAD_CHAIN_ID = Number.isFinite(resolvedChainId) && resolvedChainId > 0 ? resolvedChainId : MONAD_MAINNET_CHAIN_ID;
export const MONAD_CHAIN_HEX = `0x${MONAD_CHAIN_ID.toString(16)}`;
export const MONAD_EXPLORER_URL = "https://monadscan.com";
export const DEFAULT_MONAD_RPC_URL = "https://rpc.monad.xyz";
export const MONAD_RPC_URL = process.env.NEXT_PUBLIC_MONAD_RPC_URL || DEFAULT_MONAD_RPC_URL;

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
