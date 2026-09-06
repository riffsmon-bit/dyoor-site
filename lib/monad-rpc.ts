import { ethers } from "ethers";

export const MONAD_MAINNET_CHAIN_ID = 143;

// Official, keyless Monad mainnet endpoints. Keeping providers from different
// operators here prevents one exhausted account or one provider outage from
// taking holder reads offline.
export const MONAD_PUBLIC_RPC_URLS = [
  "https://rpc.monad.xyz",
  "https://rpc1.monad.xyz",
  "https://rpc2.monad.xyz",
  "https://rpc3.monad.xyz",
  "https://rpc-mainnet.monadinfra.com",
] as const;

function readEnv(name: string) {
  return String(process.env[name] || "").trim();
}

function rpcList(value: string) {
  return value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter((item) => /^https:\/\//i.test(item) && !/testnet/i.test(item));
}

export function monadReadRpcUrls() {
  const configured = [
    ...rpcList(readEnv("MONAD_READ_RPC_URLS")),
    readEnv("DYOOR_S2_RPC_URL"),
    readEnv("MONAD_RPC_URL"),
    readEnv("NEXT_PUBLIC_MONAD_FALLBACK_RPC"),
    readEnv("NEXT_PUBLIC_DYOOR_S2_RPC_URL"),
  ].filter((item) => item && /^https:\/\//i.test(item) && !/testnet/i.test(item));

  // Paid/keyed URLs are intentionally last. They remain useful as a fallback,
  // but an exhausted Alchemy allowance must not shadow healthy free RPCs.
  const keyed = [
    readEnv("ALCHEMY_MONAD_RPC_URL"),
    readEnv("NEXT_PUBLIC_MONAD_RPC_URL"),
  ].filter((item) => item && /^https:\/\//i.test(item) && !/testnet/i.test(item));

  return Array.from(new Set([...configured, ...MONAD_PUBLIC_RPC_URLS, ...keyed]));
}

export function createMonadReadProvider() {
  const allUrls = monadReadRpcUrls();
  // FallbackProvider validates every backend before serving its first request.
  // An exhausted Alchemy endpoint can therefore block the pool even when it is
  // ranked last. Exclude Alchemy from ordinary reads whenever keyless endpoints
  // are available; Alchemy-only methods have their own explicitly opt-in path.
  const freeUrls = allUrls.filter((url) => !/alchemy/i.test(url));
  const readUrls = freeUrls.length > 0 ? freeUrls : allUrls;
  const providers = readUrls.map((url, index) => ({
    provider: new ethers.JsonRpcProvider(url, MONAD_MAINNET_CHAIN_ID, {
      staticNetwork: true,
    }),
    priority: index + 1,
    stallTimeout: 650,
    weight: 1,
  }));

  return new ethers.FallbackProvider(
    providers,
    MONAD_MAINNET_CHAIN_ID,
    { quorum: 1 },
  );
}
