import { MONAD_CHAIN_HEX, MONAD_CHAIN_ID, MONAD_RPC_URL } from "@/lib/monad";

export const SWAP_CHAIN_ID_DEC = MONAD_CHAIN_ID;
export const SWAP_CHAIN_ID_HEX = MONAD_CHAIN_HEX;
export const SWAP_MONAD_RPC = MONAD_RPC_URL;
export const SWAP_NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
export const SWAP_WMON = "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A";
export const TOKEN_CACHE_KEY = "dyoor_kuru_tokens_v7";

export type SwapToken = {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  chainId?: number;
  logoURI?: string;
  popular?: boolean;
};

export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
};

export type SwapQuote = {
  ok?: boolean;
  source?: string;
  buyAmount: string;
  minBuyAmount?: string;
  priceImpactBps?: number | null;
  route?: {
    label?: string;
    path?: string[];
  };
  issues?: {
    allowance?: {
      spender?: string;
    };
  };
  warnings?: string[];
  fee?: {
    bps?: number;
    recipient?: string;
  } | null;
  transaction: {
    to: string;
    data?: string;
    value?: string;
  };
};

export const baseSwapTokens: SwapToken[] = [
  { symbol: "MON", name: "Monad", address: SWAP_NATIVE, decimals: 18, logoURI: "https://raw.githubusercontent.com/monad-crypto/token-list/main/mainnet/MON/logo.svg" },
  { symbol: "WMON", name: "Wrapped MON", address: SWAP_WMON, decimals: 18, chainId: 143, logoURI: "https://raw.githubusercontent.com/monad-crypto/token-list/main/mainnet/WMON/logo.svg" },
  { symbol: "USDC", name: "USD Coin", address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", decimals: 6, chainId: 143, logoURI: "https://raw.githubusercontent.com/monad-crypto/token-list/main/mainnet/USDC/logo.svg" },
  { symbol: "BOB", name: "BOB", address: "0x21E325B059Cd83d4037C82F0F5998Ba2dF3d7777", decimals: 18, chainId: 143, logoURI: "/assets/tokens/bob.png", popular: true },
  { symbol: "PamPam", name: "PamPam", address: "0x44812436147d162CE0A6b573DBCC7492eF117777", decimals: 18, chainId: 143, logoURI: "/tokens/pampam-token.png", popular: true },
  { symbol: "shramp", name: "shramp", address: "0x42a4aA89864A794dE135B23C6a8D2E05513d7777", decimals: 18, chainId: 143, logoURI: "/tokens/shramp-token.png", popular: true },
  { symbol: "BCHOG", name: "Burning Chog", address: "0xFD97581D397622f6E6662917ea3DeEEfB9F57777", decimals: 18, chainId: 143, logoURI: "/tokens/bchog-token.jpg", popular: true },
];

export function isAddress(value?: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value || "");
}

export function shortAddress(value?: string) {
  return value ? `${value.slice(0, 6)}...${value.slice(-4)}` : "";
}

export function isNativeToken(token?: SwapToken) {
  return String(token?.address || "").toLowerCase() === SWAP_NATIVE;
}

export function normalizeLogo(uri?: string) {
  if (!uri) return "";
  if (uri.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${uri.slice(7)}`;
  return uri;
}

export function tokenBadge(symbol?: string) {
  const label = String(symbol || "TOK").slice(0, 3).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0%" stop-color="#9d68ff"/><stop offset="100%" stop-color="#42f1c8"/></linearGradient></defs><circle cx="48" cy="48" r="48" fill="url(#g)"/><text x="48" y="58" text-anchor="middle" font-family="Arial" font-size="26" font-weight="800" fill="white">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function parseUnits(value: string, decimals: number) {
  const raw = String(value || "").trim();
  if (!raw || !/^\d*\.?\d*$/.test(raw)) return null;
  const [wholeRaw, fracRaw = ""] = raw.split(".");
  const whole = BigInt(wholeRaw || "0");
  const frac = BigInt((fracRaw + "0".repeat(decimals)).slice(0, decimals) || "0");
  return whole * (10n ** BigInt(decimals)) + frac;
}

export function formatUnits(value: bigint | string | number, decimals: number, maxFrac = 6) {
  try {
    const amount = BigInt(value);
    const base = 10n ** BigInt(decimals);
    const whole = amount / base;
    const rawFrac = (amount % base).toString().padStart(decimals, "0");
    const frac = rawFrac.slice(0, maxFrac).replace(/0+$/, "");
    return frac ? `${whole}.${frac}` : whole.toString();
  } catch {
    return "-";
  }
}

export function pad32(value: string) {
  return String(value).toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

export function hexAmount(value: bigint) {
  return value.toString(16).padStart(64, "0");
}

export function mergeTokenLists(lists: Array<SwapToken[] | undefined>) {
  const map = new Map<string, SwapToken>();
  for (const token of baseSwapTokens) {
    map.set(token.address.toLowerCase(), { ...token, logoURI: normalizeLogo(token.logoURI) });
  }
  for (const list of lists) {
    for (const token of list || []) {
      if (!token?.address || token.chainId !== SWAP_CHAIN_ID_DEC) continue;
      const key = token.address.toLowerCase();
      const existing = map.get(key);
      map.set(key, {
        ...existing,
        symbol: token.symbol || existing?.symbol || "TOKEN",
        name: token.name || existing?.name || "Token",
        address: token.address,
        decimals: Number(token.decimals ?? existing?.decimals ?? 18),
        chainId: SWAP_CHAIN_ID_DEC,
        logoURI: normalizeLogo(token.logoURI || existing?.logoURI || ""),
        popular: Boolean(token.popular ?? existing?.popular),
      });
    }
  }
  const priority = new Map(["MON", "WMON", "USDC", "BOB", "PamPam", "shramp", "BCHOG", "CHOG", "emo", "AUSD", "WETH", "sMON", "gMON", "shMON", "CETES"].map((symbol, index) => [symbol, index]));
  return Array.from(map.values()).sort((a, b) => {
    const pa = priority.get(a.symbol) ?? 99;
    const pb = priority.get(b.symbol) ?? 99;
    return pa === pb ? a.symbol.localeCompare(b.symbol) : pa - pb;
  });
}

export async function fetchTokenList(url: string, timeout = 6000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return (Array.isArray(data) ? data : data.tokens) as SwapToken[];
  } finally {
    window.clearTimeout(timer);
  }
}

export function normalizeSwapError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 0;
  if (/no route/i.test(message)) return "No route found on Kuru Flow.";
  if (/allowance/i.test(message)) return "Insufficient allowance. Approve before swapping.";
  if (/slippage/i.test(message)) return "Slippage exceeded. Increase slippage or retry.";
  if (/network|chain/i.test(message)) return "Wrong network. Switch to Monad.";
  if (status === 429 || /rate.?limit|rate_limited/i.test(message)) return "Kuru Flow is rate limiting quotes. Wait a few seconds, then try again.";
  if (/user rejected|denied|rejected/i.test(message)) return "Transaction rejected in wallet.";
  if (/fetch failed|network/i.test(message)) return "Kuru API unavailable. Try again shortly.";
  return message || "Swap quote failed.";
}
