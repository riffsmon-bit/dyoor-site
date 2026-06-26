import { defineChain } from "viem";

export const MONAD_CHAIN_ID = 143;
export const MONAD_CHAIN_HEX = "0x8f";
export const MONAD_EXPLORER_URL = "https://monadscan.com";
export const DEFAULT_MONAD_RPC_URL = "https://rpc.monad.xyz";

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
      http: [process.env.NEXT_PUBLIC_MONAD_RPC_URL || DEFAULT_MONAD_RPC_URL],
    },
    public: {
      http: [process.env.NEXT_PUBLIC_MONAD_RPC_URL || DEFAULT_MONAD_RPC_URL],
    },
  },
  blockExplorers: {
    default: {
      name: "Monadscan",
      url: MONAD_EXPLORER_URL,
    },
  },
});
