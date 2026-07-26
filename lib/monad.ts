import { defineChain } from "viem";

export const MONAD_MAINNET_CHAIN_ID = 143;
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
const configuredRpcUrl = String(process.env.NEXT_PUBLIC_MONAD_RPC_URL || "").trim();
if (configuredRpcUrl && /testnet/i.test(configuredRpcUrl)) {
  throw new Error("Production wallet configuration cannot use a Monad testnet RPC URL.");
}
export const MONAD_RPC_URL = configuredRpcUrl || DEFAULT_MONAD_RPC_URL;

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
