import { defineChain } from "viem";

export const ROBINHOOD_MAINNET_CHAIN_ID = 4_663;
export const ROBINHOOD_TESTNET_CHAIN_ID = 46_630;
export const ROBINHOOD_MAINNET_RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
export const ROBINHOOD_TESTNET_RPC_URL = "https://rpc.testnet.chain.robinhood.com";
export const ROBINHOOD_MAINNET_EXPLORER_URL = "https://robinhoodchain.blockscout.com";
export const ROBINHOOD_TESTNET_EXPLORER_URL =
  "https://explorer.testnet.chain.robinhood.com";

export type RobinhoodChainId =
  | typeof ROBINHOOD_MAINNET_CHAIN_ID
  | typeof ROBINHOOD_TESTNET_CHAIN_ID;

export type RobinhoodEip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

export function isRobinhoodChainId(value: unknown): value is RobinhoodChainId {
  const parsed = Number(value);
  return parsed === ROBINHOOD_MAINNET_CHAIN_ID || parsed === ROBINHOOD_TESTNET_CHAIN_ID;
}

export function robinhoodChainDetails(chainId: RobinhoodChainId) {
  if (chainId === ROBINHOOD_TESTNET_CHAIN_ID) {
    return {
      chainId,
      chainHex: `0x${chainId.toString(16)}`,
      name: "Robinhood Chain Testnet",
      rpcUrl: ROBINHOOD_TESTNET_RPC_URL,
      explorerUrl: ROBINHOOD_TESTNET_EXPLORER_URL,
    } as const;
  }
  return {
    chainId,
    chainHex: `0x${chainId.toString(16)}`,
    name: "Robinhood Chain",
    rpcUrl: ROBINHOOD_MAINNET_RPC_URL,
    explorerUrl: ROBINHOOD_MAINNET_EXPLORER_URL,
  } as const;
}

function parsedChainId(value: unknown) {
  try {
    return Number(BigInt(String(value ?? "")));
  } catch {
    return 0;
  }
}

function walletErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message || "");
  }
  return typeof error === "string" ? error : "";
}

function walletRejected(error: unknown) {
  const code = error && typeof error === "object" && "code" in error
    ? Number(error.code)
    : 0;
  return code === 4_001 || /reject|denied|cancel/i.test(walletErrorMessage(error));
}

export async function providerRobinhoodChainId(provider: RobinhoodEip1193Provider) {
  const value = await provider.request({ method: "eth_chainId" }).catch(() => "");
  return parsedChainId(value);
}

export async function switchProviderToRobinhoodChain(
  provider: RobinhoodEip1193Provider,
  chainId: RobinhoodChainId,
) {
  const details = robinhoodChainDetails(chainId);
  if (await providerRobinhoodChainId(provider) === chainId) return;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: details.chainHex }],
    });
  } catch (switchError) {
    if (walletRejected(switchError)) {
      throw new Error(`${details.name} switch was cancelled in the wallet.`);
    }
    try {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: details.chainHex,
          chainName: details.name,
          rpcUrls: [details.rpcUrl],
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          blockExplorerUrls: [details.explorerUrl],
        }],
      });
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: details.chainHex }],
      });
    } catch (addError) {
      if (walletRejected(addError)) {
        throw new Error(`${details.name} switch was cancelled in the wallet.`);
      }
      const detail = walletErrorMessage(addError) || walletErrorMessage(switchError);
      throw new Error(
        `Wallet could not switch to ${details.name} (chain ${chainId})${
          detail ? `: ${detail}` : "."
        }`,
      );
    }
  }

  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (await providerRobinhoodChainId(provider) === chainId) return;
    if (attempt < 11) await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Wallet is not connected to ${details.name} (chain ${chainId}).`);
}

export const robinhoodMainnet = defineChain({
  id: ROBINHOOD_MAINNET_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
  rpcUrls: {
    default: { http: [ROBINHOOD_MAINNET_RPC_URL] },
    public: { http: [ROBINHOOD_MAINNET_RPC_URL] },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: ROBINHOOD_MAINNET_EXPLORER_URL },
  },
});

export const robinhoodTestnet = defineChain({
  id: ROBINHOOD_TESTNET_CHAIN_ID,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
  rpcUrls: {
    default: { http: [ROBINHOOD_TESTNET_RPC_URL] },
    public: { http: [ROBINHOOD_TESTNET_RPC_URL] },
  },
  blockExplorers: {
    default: { name: "Robinhood Testnet Explorer", url: ROBINHOOD_TESTNET_EXPLORER_URL },
  },
});
